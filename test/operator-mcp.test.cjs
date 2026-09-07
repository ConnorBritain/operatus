const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {execFileSync}=require('node:child_process');
const load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {createOperatorService,operatorSnapshot}=load('src/main/gauntlet/operatorService.ts');
const {OperatorServer,readOperatorPolicy}=load('src/main/gauntlet/operatorServer.ts');
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'op-mcp-test-'))),repo=path.join(root,'repo');fs.mkdirSync(repo);
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
  git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(repo,'sample.cjs'),'module.exports=1;\n');git('add','.');git('commit','-m','fixture');
  const profile=path.join(root,'profile'),backend=new LocalGauntletBackend({stateRoot:profile,primitiveRoot:path.resolve('vendor/agent-primitives')});backend.open();
  let calls=0,held=null;const published=[];
  const service=createOperatorService({policy:{enabled:true,repositoryRoots:[repo]},backend,
    runner:{advance:async()=>{calls++;},capacity:()=>({revision:0,maxConcurrentRuns:2,dispatches:[]})},
    hold:()=>held,publish:s=>published.push(s),conductor:()=>({conductor:{provider:'codex',model:'gpt-6-astra'},implementer:{provider:'claude'},repairer:{provider:'claude'},critic:{provider:'codex'}})});
  t.after(()=>{backend.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,repo,profile,backend,service,published,calls:()=>calls,hold:value=>held=value,
    intent:{requestId:'test-intent-001',repository:repo,objective:'Inspect the sample',baseSha:git('rev-parse','HEAD')}};
}
test('operator starts exactly once, binds intent and preserves its receipt across restart',t=>{
  const f=fixture(t),a=f.service('operatus_start',f.intent),b=f.service('operatus_start',f.intent);
  assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.equal(a.runId,b.runId);assert.equal(f.calls(),1);
  assert.equal(a.run.providers.conductor.model,'gpt-6-astra');assert.equal(a.run.baseSha,f.intent.baseSha);
  assert.throws(()=>f.service('operatus_start',{...f.intent,objective:'Changed'}),/different start parameters/);
  f.backend.close();f.backend.open();f.hold('hold');
  assert.equal(f.service('operatus_start',f.intent).runId,a.runId);assert.equal(f.calls(),1);
  assert.throws(()=>f.service('operatus_start',{...f.intent,requestId:'new-intent-001'}),/hold/);
  assert.equal(f.backend.list().length,1);
});
test('operator rejects escaped paths, unknown authority, extra fields and stale or mismatched cancellation',t=>{
  const f=fixture(t);fs.symlinkSync(f.root,path.join(f.repo,'escape'));
  assert.throws(()=>f.service('operatus_start',{...f.intent,repository:path.join(f.repo,'escape')}),/outside/);
  assert.throws(()=>f.service('freeze',{}),/authority/);
  assert.throws(()=>f.service('operatus_start',{...f.intent,token:'pretend'}),/arguments/);
  assert.throws(()=>f.service('operatus_start',{...f.intent,conductorProvider:'codex',conductorModel:'gpt-unknown'}),/Unsupported|unsupported/);
  assert.equal(f.backend.list().length,0);
  const run=f.service('operatus_start',f.intent).run;
  assert.throws(()=>f.service('operatus_cancel',{runId:run.id,repository:f.repo,expectedVersion:run.version+1,reason:'Test'}),/changed/);
  assert.throws(()=>f.service('operatus_cancel',{runId:run.id,repository:f.root,expectedVersion:run.version,reason:'Test'}),/outside/);
  const cancelled=f.service('operatus_cancel',{runId:run.id,repository:f.repo,expectedVersion:run.version,reason:'Test'});
  assert.equal(cancelled.run.status,'cancelled');assert.match(cancelled.run.stopReason,/Local MCP operator/);
  assert.equal(f.service('operatus_cancel',{runId:run.id,repository:f.repo,expectedVersion:run.version,reason:'Test'}).run.status,'cancelled');
});
test('failed transaction leaves neither run nor operator receipt, and output never includes capability secrets',t=>{
  const f=fixture(t);
  assert.throws(()=>f.backend.store.operatorStart('rollback-test','digest',()=>{f.backend.start({repository:f.repo,objective:'Test'});throw Error('rollback');}),/rollback/);
  assert.equal(f.backend.list().length,0);
  const run=f.service('operatus_start',f.intent).run;
  const prepared=f.backend.prepareConductor(run.id);
  const projected=JSON.stringify(operatorSnapshot(f.backend.status(run.id),true));
  assert.ok(!projected.includes(prepared.token));assert.ok(!projected.includes(prepared.launch.tokenHash));
  assert.ok(!projected.includes('tokenHash'));
});
test('policy is opt-in and refuses world-readable files and symlinks',t=>{
  const f=fixture(t);assert.equal(readOperatorPolicy(f.profile),null);
  const root=path.join(f.profile,'operator-mcp'),file=path.join(root,'config.json');fs.mkdirSync(root,{mode:0o700});
  fs.writeFileSync(file,JSON.stringify({enabled:true,repositoryRoots:[f.repo]}),{mode:0o600});assert.equal(readOperatorPolicy(f.profile).enabled,true);
  fs.chmodSync(file,0o644);assert.throws(()=>readOperatorPolicy(f.profile),/owner-only/);fs.unlinkSync(file);
  fs.symlinkSync(path.join(f.repo,'sample.cjs'),file);assert.throws(()=>readOperatorPolicy(f.profile));
});
test('real stdio MCP handshake, tools, authenticated socket, start replay and cancellation',async t=>{
  const f=fixture(t),server=new OperatorServer(f.profile,f.service);await server.start();
  const {Client}=await import('../packages/operatus-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const {StdioClientTransport}=await import('../packages/operatus-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const client=new Client({name:'operator-test',version:'1.0.0'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('packages/operatus-mcp/server.mjs'),'--profile',f.profile],env:{ELECTRON_RUN_AS_NODE:'1'}}));
    const tools=await client.listTools();assert.equal(tools.tools.length,5);assert.ok(tools.tools.every(x=>!x.name.includes('ack')));
    const call=async(name,args={})=>client.callTool({name,arguments:args});
    assert.equal(JSON.parse((await call('operatus_status')).content[0].text).capacity.maxConcurrentRuns,2);
    assert.equal((await call('operatus_start',{...f.intent,token:'bad'})).isError,true);
    const start=JSON.parse((await call('operatus_start',f.intent)).content[0].text);
    assert.equal(JSON.parse((await call('operatus_start',f.intent)).content[0].text).runId,start.runId);assert.equal(f.calls(),1);
    assert.equal(JSON.parse((await call('operatus_runs')).content[0].text).runs.length,1);
    const detail=JSON.parse((await call('operatus_run',{runId:start.runId,evidence:true})).content[0].text);assert.equal(detail.run.id,start.runId);
    const cancel=await call('operatus_cancel',{runId:start.runId,repository:f.repo,expectedVersion:detail.run.version,reason:'MCP integration test'});
    assert.equal(JSON.parse(cancel.content[0].text).run.status,'cancelled');
    const e=JSON.parse(fs.readFileSync(path.join(f.profile,'operator-mcp/endpoint.json'),'utf8'));
    const bad=await new Promise((resolve,reject)=>{const s=net.connect(e.socketPath);let out='';s.on('error',reject);s.on('data',b=>out+=b);s.on('end',()=>resolve(JSON.parse(out)));s.on('connect',()=>s.write(JSON.stringify({token:'a'.repeat(64),method:'operatus_status',args:{}})+'\n'));});
    assert.equal(bad.ok,false);assert.match(bad.error,/authentication/);
  }finally{await client.close();await server.stop();}
  assert.equal(fs.existsSync(path.join(f.profile,'operator-mcp/endpoint.json')),false);
});
