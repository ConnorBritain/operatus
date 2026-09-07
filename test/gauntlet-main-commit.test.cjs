'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const {join}=require('node:path');const {tmpdir}=require('node:os');
const {execFileSync,execFile}=require('node:child_process');const load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {prepareSubscriptionSandbox}=load('src/main/subscriptionSandbox.ts');
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const mac={skip:process.platform!=='darwin'};
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-main-commit-'))),repository=join(root,'repo');fs.mkdirSync(repository);
 git(repository,'init','-b','main');git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
 fs.writeFileSync(join(repository,'value.txt'),'base');git(repository,'add','.');git(repository,'commit','-m','base');
 const options={stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')};
 const backend=new LocalGauntletBackend(options);backend.open();const run=backend.start({repository,objective:'Main-owned commit'}).run;
 backend.freeze(run.id,{objective:run.requestedObjective,criteria:['Correct value'],checks:[],constraints:[],exclusions:[]});
 const worker=backend.prepareImplementer(run.id);
 const request={runId:run.id,launchId:worker.launch.id,token:worker.token,expectedSha:worker.launch.expectedSha,
  contractDigest:backend.status(run.id).run.contract.digest,message:'Implement the scoped change'};
 return {root,repository,backend,run,worker,request};
}
test('sandboxed worker edits files; main commits exact parent without touching main or invoking hooks',mac,async()=>{
 const f=fixture();try{
  const marker=join(f.root,'hook-ran');
  fs.writeFileSync(join(f.repository,'.git','hooks','pre-commit'),`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o700});
  const profile=await prepareSubscriptionProfile(f.root,'claude');
  const boundary=prepareSubscriptionSandbox({artifact:f.worker.launch.worktreePath,profile,executable:'/bin/bash',role:'implementer'});
  const result=await new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c','printf changed > value.txt'],
   {cwd:boundary.cwd,env:profile.env,encoding:'utf8'},(e)=>resolve(e?.code??0)));
  assert.equal(result,0);
  const snapshot=await f.backend.commitWorkingArtifact(f.request), artifact=snapshot.artifacts.at(-1);
  assert.equal(snapshot.run.status,'awaiting_critic');assert.equal(artifact.parentSha,f.run.baseSha);
  assert.equal(git(f.repository,'rev-parse',`${artifact.sha}^`),f.run.baseSha);
  assert.equal(git(f.repository,'show',`${artifact.sha}:value.txt`),'changed');
  assert.equal(git(f.repository,'rev-parse','main'),f.run.baseSha);
  assert.equal(fs.readFileSync(join(f.repository,'value.txt'),'utf8'),'base');
  assert.equal(fs.existsSync(marker),false);assert.equal(git(f.worker.launch.worktreePath,'status','--porcelain'),'');
  await assert.rejects(f.backend.commitWorkingArtifact(f.request));assert.equal(f.backend.status(f.run.id).artifacts.length,1);
 }finally{f.backend.close();}
});
test('wrong token, bar, SHA, or switched branch cannot create a commit',mac,async()=>{
 const f=fixture();try{
  fs.writeFileSync(join(f.worker.launch.worktreePath,'value.txt'),'pending');
  for(const override of [{token:'forged'},{contractDigest:'f'.repeat(64)},{expectedSha:'f'.repeat(40)}]){
   await assert.rejects(f.backend.commitWorkingArtifact({...f.request,...override}));
   assert.equal(git(f.worker.launch.worktreePath,'rev-parse','HEAD'),f.run.baseSha);
  }
  git(f.worker.launch.worktreePath,'switch','-c','unrelated');
  await assert.rejects(f.backend.commitWorkingArtifact(f.request),/assigned branch/);
  assert.equal(git(f.repository,'rev-parse','unrelated'),f.run.baseSha);
 }finally{f.backend.close();}
});
test('required custom filters cannot execute and failed commit preserves edited work',mac,async()=>{
 const f=fixture();try{
  const marker=join(f.root,'filter-ran'), helper=join(f.root,'filter.sh');
  fs.writeFileSync(helper,`#!/bin/sh\ntouch '${marker}'\ncat\n`,{mode:0o700});
  git(f.repository,'config','filter.hostile.clean',helper);git(f.repository,'config','filter.hostile.required','true');
  fs.writeFileSync(join(f.worker.launch.worktreePath,'.gitattributes'),'value.txt filter=hostile\n');
  fs.writeFileSync(join(f.worker.launch.worktreePath,'value.txt'),'keep this');
  await assert.rejects(f.backend.commitWorkingArtifact(f.request),/offline candidate/);
  assert.equal(fs.existsSync(marker),false);assert.equal(git(f.worker.launch.worktreePath,'rev-parse','HEAD'),f.run.baseSha);
  assert.equal(fs.readFileSync(join(f.worker.launch.worktreePath,'value.txt'),'utf8'),'keep this');
  assert.equal(f.backend.status(f.run.id).artifacts.length,0);
 }finally{f.backend.close();}
});
test('scoped socket commit supports a fresh repair and re-critique without merging',mac,async()=>{
 const net=require('node:net');const {GauntletControlServer}=load('src/main/gauntlet/controlServer.ts');
 const f=fixture();const server=new GauntletControlServer(join(f.root,'state'),f.backend,()=>{});await server.start();
 const send=request=>new Promise((resolve,reject)=>{
  const socket=net.createConnection(server.info().socketPath);let body='';socket.setEncoding('utf8');
  socket.on('connect',()=>socket.write(JSON.stringify(request)+'\n'));socket.on('data',chunk=>body+=chunk);
  socket.on('error',reject);socket.on('end',()=>resolve(JSON.parse(body)));
 });
 try{
  fs.writeFileSync(join(f.worker.launch.worktreePath,'value.txt'),'first');
  const command={action:'commit',runId:f.run.id,launchId:f.worker.launch.id,token:f.worker.token,payload:f.request};
  assert.equal((await send({...command,token:'wrong'})).ok,false);
  const completed=await send(command);assert.equal(completed.ok,true);
  const firstSha=completed.snapshot.run.currentArtifactSha;
  const firstCritic=f.backend.prepareCritic(f.run.id);
  let snapshot=f.backend.submitCritic({runId:f.run.id,launchId:firstCritic.launch.id,token:firstCritic.token,
   artifactSha:firstSha,contractDigest:f.request.contractDigest,verdict:'REVISE',summary:'Synthetic fixture review',
   findings:[{id:'fix',severity:'major',title:'Fixture repair',evidence:'Synthetic evidence',criterionIds:[]}]});
  snapshot=f.backend.acknowledge({runId:f.run.id,reportId:snapshot.reports[0].id,conductorLaunchId:'conductor',decision:'repair',
   acceptedFindingIds:['fix'],rejectedFindings:[],rationale:'Fixture acknowledgment',repairInstructions:['Repair value']});
  const repair=f.backend.prepareRepairer(f.run.id,snapshot.repairPackets[0]);
  fs.writeFileSync(join(repair.launch.worktreePath,'value.txt'),'repaired');
  const repaired=await send({...command,launchId:repair.launch.id,token:repair.token,payload:{
   expectedSha:firstSha,contractDigest:f.request.contractDigest,message:'Fixture repair'}});
  assert.equal(repaired.ok,true);const repairedSha=repaired.snapshot.run.currentArtifactSha;
  assert.equal(git(f.repository,'rev-parse',`${repairedSha}^`),firstSha);
  const secondCritic=f.backend.prepareCritic(f.run.id);
  assert.notEqual(secondCritic.launch.sessionId,firstCritic.launch.sessionId);
  assert.notEqual(repair.launch.sessionId,f.worker.launch.sessionId);
  snapshot=f.backend.submitCritic({runId:f.run.id,launchId:secondCritic.launch.id,token:secondCritic.token,
   artifactSha:repairedSha,contractDigest:f.request.contractDigest,verdict:'PASS',summary:'Synthetic fixture pass',findings:[]});
  assert.equal(snapshot.run.status,'awaiting_lead_ack');
  snapshot=f.backend.acknowledge({runId:f.run.id,reportId:snapshot.reports.at(-1).id,conductorLaunchId:'conductor',decision:'pass',
   acceptedFindingIds:[],rejectedFindings:[],rationale:'Fixture acknowledgment'});
  assert.equal(snapshot.run.status,'passed');assert.equal(git(f.repository,'rev-parse','main'),f.run.baseSha);
 }finally{await server.stop();f.backend.close();}
});
