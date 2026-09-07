'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), net=require('node:net');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto'),{execFileSync,execFile}=require('node:child_process');
const load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {GauntletControlServer}=load('src/main/gauntlet/controlServer.ts');
const {prepareControlClient}=load('src/main/gauntlet/controlClient.ts');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {prepareSubscriptionSandbox}=load('src/main/subscriptionSandbox.ts');
const mac={skip:process.platform!=='darwin'};
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-isolated-control-'))), repository=join(root,'repo');fs.mkdirSync(repository);
 git(repository,'init','-b','main');git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
 fs.writeFileSync(join(repository,'value.txt'),'base');git(repository,'add','.');git(repository,'commit','-m','base');
 const backend=new LocalGauntletBackend({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();
 const run=backend.start({repository,objective:'Isolated helper smoke'}).run;
 const lead=backend.prepareConductor(run.id);
 backend.freeze(run.id,{objective:run.requestedObjective,criteria:['Exact value'],checks:[],constraints:[],exclusions:[]},lead.launch.id);
 const worker=backend.prepareImplementer(run.id),server=new GauntletControlServer(join(root,'state'),backend,()=>{});await server.start();
 const profile=await prepareSubscriptionProfile(root,'claude'),helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
 const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
  socketPath:server.info().socketPath,nodePath:process.execPath,token:worker.token});
 const boundary=prepareSubscriptionSandbox({artifact:worker.launch.worktreePath,profile,executable:'/bin/bash',role:'implementer',controlClient:client.capability});
 const shell=command=>new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c',command],
  {cwd:boundary.cwd,env:client.env,timeout:10000,encoding:'utf8',maxBuffer:1024*1024},(e,stdout,stderr)=>resolve({code:e?.code??0,stdout,stderr})));
 return {root,repository,backend,run,lead,worker,server,profile,client,boundary,shell,close:async()=>{await server.stop();backend.close();}};
}
test('protected Node launcher survives empty child environments and remains read-only in the actual sandbox',mac,async()=>{
 const f=await fixture();try{
  const probe=join(f.profile.scratch,'node-launcher-probe.cjs');
  fs.writeFileSync(probe,`const {spawnSync}=require('node:child_process');const a=require('node:assert/strict');const path=require('node:path');
const launcher=process.env.HIVE_NODE;const env={PATH:path.dirname(launcher)+':/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR};
a.equal(env.ELECTRON_RUN_AS_NODE,undefined);
for(const command of [launcher,'node']){const r=spawnSync(command,['-e','console.log(process.versions.node)'],{env,encoding:'utf8',timeout:5000});a.equal(r.status,0,r.stderr);a.equal(r.signal,null);a.match(r.stdout,/^\\d+\\./);}
const minimal=spawnSync(launcher,['-e','console.log("empty env works")'],{env:{},encoding:'utf8',timeout:5000});a.equal(minimal.status,0,minimal.stderr);
const suite=path.join(process.env.TMPDIR,'launcher.test.cjs');require('node:fs').writeFileSync(suite,'require("node:test")("child",()=>require("node:assert/strict").equal(2+2,4))');
const r=spawnSync(launcher,['--test',suite],{env,encoding:'utf8',timeout:5000});a.equal(r.status,0,r.stderr);a.match(r.stdout,/# pass 1/);console.log('bare-env and nested test children passed');`);
  const result=await f.shell(`"$HIVE_NODE" '${probe}'`);assert.equal(result.code,0,result.stderr+result.stdout);assert.match(result.stdout,/children passed/);
  const write=await f.shell('printf broken > "$HIVE_NODE"');assert.notEqual(write.code,0);
  const again=await f.shell('env -i "$HIVE_NODE" -e \'console.log("still protected")\'');assert.equal(again.code,0,again.stderr);assert.match(again.stdout,/still protected/);
  assert.equal(f.boundary.receipt.network,'control-socket-only');
 }finally{await f.close();}
});
test('real helper inside the worker boundary commits and cannot claim Conductor authority',mac,async()=>{
 const f=await fixture();try{
  const rejected=await f.shell(`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" cancel --run ${f.run.id} --reason forbidden`);
  assert.notEqual(rejected.code,0);assert.match(rejected.stderr,/invalid Conductor authority/);
  assert.equal(f.backend.status(f.run.id).run.status,'implementer_in_flight');
  const digest=f.backend.status(f.run.id).run.contract.digest;
  const done=await f.shell(`printf changed > value.txt && "$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" commit --run ${f.run.id} --launch ${f.worker.launch.id} --expected-sha ${f.run.baseSha} --bar-digest ${digest} --message "Confined worker change"`);
  assert.equal(done.code,0,done.stderr);const result=JSON.parse(done.stdout);
  assert.equal(result.status,'awaiting_critic');assert.equal(result.artifactSha,f.backend.status(f.run.id).run.currentArtifactSha);
  assert.equal(git(f.repository,'show',`${result.artifactSha}:value.txt`),'changed');
  assert.equal(git(f.repository,'rev-parse','main'),f.run.baseSha);
  assert.equal(f.boundary.receipt.network,'control-socket-only');assert.equal(f.boundary.receipt.launchAllowed,false);
  const critic=f.backend.prepareCritic(f.run.id);
  const roleShell=async(role,token,artifact,evidence)=>{
   const profile=await prepareSubscriptionProfile(f.root,'claude');
   const helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
   const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
    socketPath:f.server.info().socketPath,nodePath:process.execPath,token});
   const boundary=prepareSubscriptionSandbox({artifact,profile,executable:'/bin/bash',role,controlClient:client.capability,reviewEvidenceDirectory:evidence});
   return command=>new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c',command],
    {cwd:artifact,env:client.env,timeout:10000,encoding:'utf8',maxBuffer:1024*1024},(e,stdout,stderr)=>resolve({code:e?.code??0,stdout,stderr})));
  };
  const criticize=await roleShell('critic',critic.token,critic.launch.worktreePath,critic.launch.reviewEvidence.directory);
  const report={artifactSha:result.artifactSha,contractDigest:digest,verdict:'PASS',summary:'Synthetic boundary fixture, not model judgment',findings:[]};
  const reviewed=await criticize(`cat '${critic.launch.reviewEvidence.directory}/manifest.json' >/dev/null && "$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" critic --run ${f.run.id} --launch ${critic.launch.id} --json '${JSON.stringify(report)}'`);
  assert.equal(reviewed.code,0,reviewed.stderr);assert.equal(JSON.parse(reviewed.stdout).status,'awaiting_lead_ack');
  const acknowledgment={reportId:f.backend.status(f.run.id).reports.at(-1).id,decision:'pass',acceptedFindingIds:[],rejectedFindings:[],rationale:'Synthetic acknowledgment fixture'};
  const conductor=await roleShell('conductor',f.lead.token,f.worker.launch.worktreePath);
  const acknowledged=await conductor(`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" acknowledge --run ${f.run.id} --launch ${f.lead.launch.id} --json '${JSON.stringify(acknowledgment)}'`);
  assert.equal(acknowledged.code,0,acknowledged.stderr);assert.equal(JSON.parse(acknowledged.stdout).status,'passed');
  assert.equal(git(f.repository,'rev-parse','main'),f.run.baseSha);
 }finally{await f.close();}
});
test('control capability grants no other Unix socket, TCP listener, helper rewrite or binding',mac,async()=>{
 const f=await fixture();let unixConnections=0,tcpConnections=0;
 const unrelated=net.createServer(s=>{unixConnections++;s.destroy();}),tcp=net.createServer(s=>{tcpConnections++;s.destroy();});
 const unrelatedPath=join(f.root,'other.sock');
 await new Promise(r=>unrelated.listen(unrelatedPath,r));await new Promise(r=>tcp.listen(0,'127.0.0.1',r));
 try{
  const js="const n=require('net'),s=n.createConnection(process.argv[1]);s.on('error',()=>process.exit(3));s.on('connect',()=>process.exit(0));";
  assert.notEqual((await f.shell(`"$HIVE_NODE" -e ${JSON.stringify(js)} '${unrelatedPath}'`)).code,0);
  const tcpDenied=await f.shell(`echo probe > /dev/tcp/127.0.0.1/${tcp.address().port}`);
  assert.notEqual(tcpDenied.code,0);assert.match(tcpDenied.stderr,/Operation not permitted/);
  assert.equal(unixConnections,0);assert.equal(tcpConnections,0);
  assert.notEqual((await f.shell('printf changed > "$OPERATUS_GAUNTLET_HELPER"')).code,0);
  assert.notEqual((await f.shell(`printf changed > '${f.client.capability.credentialPath}'`)).code,0);
  const bind="require('net').createServer().on('error',()=>process.exit(3)).listen(process.argv[1],()=>process.exit(0))";
  assert.notEqual((await f.shell(`"$HIVE_NODE" -e ${JSON.stringify(bind)} '${f.worker.launch.worktreePath}/worker.sock'`)).code,0);
  assert.equal(fs.existsSync(join(f.worker.launch.worktreePath,'worker.sock')),false);
 }finally{await new Promise(r=>unrelated.close(r));await new Promise(r=>tcp.close(r));await f.close();}
});
test('helper digest mismatch fails before materialization and receipts never contain the scoped token',mac,async()=>{
 const f=await fixture();try{
  const profile=await prepareSubscriptionProfile(f.root,'claude');
  assert.throws(()=>prepareControlClient({profile,helperSource:join(__dirname,'../resources/operatus-gauntlet.cjs'),
   expectedHelperSha256:'0'.repeat(64),socketPath:f.server.info().socketPath,nodePath:process.execPath,token:f.worker.token}),/identity changed/);
  assert.equal(fs.existsSync(join(profile.directory,'control-client')),false);
  assert.equal(JSON.stringify(f.client.receipt).includes(f.worker.token),false);
  assert.equal(JSON.stringify(f.boundary.receipt).includes(f.worker.token),false);
  assert.equal(fs.readFileSync(f.client.capability.helperPath,'utf8').includes(f.worker.token),false);
  assert.equal(JSON.stringify(f.client.env).includes(f.worker.token),false);
  assert.equal(fs.statSync(f.client.capability.credentialPath).mode&0o777,0o400);
 }finally{await f.close();}
});
test('helper rejects malformed, public, oversized and symlinked control sidecars without leaking their content',mac,async()=>{
 const f=await fixture();try{
  const helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
  for(const kind of ['malformed','public','oversized','symlink','partial-env']){
   const profile=await prepareSubscriptionProfile(f.root,'claude');
   const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
    socketPath:f.server.info().socketPath,nodePath:process.execPath,token:f.worker.token});
   const file=client.capability.credentialPath;
   if(kind==='malformed'||kind==='oversized'){
    fs.chmodSync(file,0o600);fs.writeFileSync(file,kind==='malformed'?`INVALID ${f.worker.token}`:'x'.repeat(4097));
   }else if(kind==='public')fs.chmodSync(file,0o644);
   else if(kind==='symlink'){fs.renameSync(file,`${file}.original`);fs.symlinkSync(`${file}.original`,file);}
   const result=await new Promise(resolve=>execFile(process.execPath,[client.capability.helperPath,'cancel','--run',f.run.id],{
    env:{...client.env,...(kind==='partial-env'?{OPERATUS_GAUNTLET_SOCKET:f.server.info().socketPath}:{})},timeout:5000,encoding:'utf8'
   },(e,stdout,stderr)=>resolve({code:e?.code??0,stdout,stderr})));
   assert.notEqual(result.code,0,kind);assert.match(result.stderr,/control environment is unavailable/,kind);
   assert.equal((result.stdout+result.stderr).includes(f.worker.token),false,kind);
  }
  assert.equal(f.backend.status(f.run.id).run.status,'implementer_in_flight');
 }finally{await f.close();}
});
