'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{randomUUID}=require('node:crypto');
const load=require('./load-ts.cjs');
const {GauntletStore}=load('src/main/gauntlet/store.ts');
const {createGauntletRun}=load('src/main/gauntlet/core.ts');
const {subscriptionEvidence}=load('src/main/gauntlet/subscriptionEvidence.ts');
const {runtimeView}=load('src/renderer/src/gauntlet/runtimeView.ts');
function fixture(t){
  const store=new GauntletStore(join(fs.mkdtempSync(join(tmpdir(),'op-admission-evidence-')),'gauntlet.db'));store.open();t.after(()=>store.close());
  const run=createGauntletRun({repository:'/fixture',objective:'Admission journal',branch:'fixture',baseSha:'a'.repeat(40)});store.createRun(run);
  const launch={id:randomUUID(),runId:run.id,role:'conductor',provider:'claude',sessionId:randomUUID(),worktreePath:'/fixture',
    expectedSha:run.baseSha,tokenHash:'a'.repeat(64),status:'created',createdAt:Date.now(),model:'claude-fable-5-1',
    capability:{filesystem:'advisory',cleanContext:'advisory',toolRestrictions:'advisory',notes:[]}};
  store.transition(run.id,0,{type:'CONDUCTOR_PREPARED',at:Date.now(),launchId:launch.id},{launch});
  const at=Date.now(),event=subscriptionEvidence({component:'claude-max-account-v1',accountHash:'a'.repeat(64),organizationHash:'b'.repeat(64),
    credentialHash:'DO-NOT-PERSIST',accessToken:'DO-NOT-PERSIST',plan:'max',extraUsage:'disabled',observedAt:at,validUntil:at+30000,launchAllowed:false},
    {version:'2.1.263',sha256:'c'.repeat(64),model:launch.model,source:'injected-dependencies'});
  const observation={runId:run.id,launchId:launch.id,sessionId:launch.sessionId,at,event};
  return{store,run,launch,event,observation};
}
test('redacted admission persists before startup, remains historical and cannot change protocol authority',t=>{
  const f=fixture(t),before=f.store.snapshot(f.run.id);
  assert.equal(JSON.stringify(f.event).includes('DO-NOT-PERSIST'),false);
  f.store.recordRuntimeObservation(f.observation);f.store.recordRuntimeObservation(f.observation);
  f.store.recordRuntimeObservation({...f.observation,event:{type:'process_started',pid:1234,model:f.launch.model,profileSha256:'d'.repeat(64),boundarySha256:'e'.repeat(64)}});
  f.store.recordRuntimeObservation(f.observation); // exact delivery replay after start
  f.store.close();f.store.open();const after=f.store.snapshot(f.run.id),view=runtimeView(f.launch.id,after.runtimeObservations);
  assert.deepEqual(after.events,before.events);assert.equal(after.run.status,before.run.status);
  assert.equal(after.runtimeObservations.filter(r=>r.event.type==='subscription_admission').length,1);
  assert.deepEqual(view.admission,f.event);assert.equal(view.admission.launchAllowed,false);
  assert.equal(runtimeView('absent').admission,null);
  assert.throws(()=>f.store.recordRuntimeObservation({...f.observation,event:{...f.event,accountHash:'f'.repeat(64)}}),/immutable/);
});
test('admission rejects credentials, extra keys, expiry, wrong launch identity and stronger authorization claims',t=>{
  const f=fixture(t);
  for(const change of [{credentialHash:'secret'},{accessToken:'secret'},{launchAllowed:true},{extraUsage:'enabled'},
    {plan:'pro'},{provider:'codex'},{model:'claude-other'},{executableSha256:'invalid'},
    {validUntil:f.event.checkedAt},{validUntil:f.event.checkedAt+30001},{checkedAt:f.launch.createdAt-1},
    {metadataObservedAt:f.event.checkedAt+1},{metadataObservedAt:f.event.validUntil-300001},
    {component:'unknown'},{source:'unknown'}]) assert.throws(()=>f.store.recordRuntimeObservation({...f.observation,event:{...f.event,...change}}));
  assert.throws(()=>f.store.recordRuntimeObservation({...f.observation,sessionId:randomUUID()}),/identity/);
  assert.throws(()=>f.store.recordRuntimeObservation({...f.observation,at:f.event.validUntil}),/invalid/);
  assert.equal(f.store.snapshot(f.run.id).runtimeObservations.length,0);
});
test('cached billing evidence retains its real observation time separately from the fresh credential check',t=>{
  const f=fixture(t),metadataObservedAt=f.event.checkedAt-60000;
  f.store.recordRuntimeObservation({...f.observation,event:{...f.event,metadataObservedAt}});
  const recorded=f.store.snapshot(f.run.id).runtimeObservations[0].event;
  assert.equal(recorded.metadataObservedAt,metadataObservedAt);
  assert.equal(recorded.checkedAt,f.event.checkedAt);
});
test('a post-start or cancelled launch cannot acquire a retroactive admission check',t=>{
  const f=fixture(t);
  f.store.recordRuntimeObservation({...f.observation,event:{type:'process_started',pid:1234,model:f.launch.model,profileSha256:'d'.repeat(64),boundarySha256:'e'.repeat(64)}});
  assert.throws(()=>f.store.recordRuntimeObservation(f.observation),/before native startup/);
  const g=fixture(t);g.store.transition(g.run.id,1,{type:'CANCELLED',at:Date.now(),reason:'Fixture cancellation'});
  assert.throws(()=>g.store.recordRuntimeObservation(g.observation),/invalid/);
});
test('production factory refuses missing durable evidence writer before reading accounts or creating profiles',async()=>{
  const {createIsolatedClaudeFactory}=load('src/main/gauntlet/isolatedClaudeFactory.ts');let reads=0;
  const factory=createIsolatedClaudeFactory({root:'/must-not-write',helperSource:'/missing',nodePath:'/missing',socketPath:()=>'/missing',reviewEvidenceRoot:'/missing',assertAdmissionOpen:()=>{}},
    {account:{verify:async()=>{reads++;throw Error('not allowed');}},inspect:async()=>{reads++;throw Error('not allowed');}});
  for(const method of ['conductor','worker']) await assert.rejects(factory[method]({launch:{role:method==='conductor'?'conductor':'implementer'}},new AbortController().signal,()=>{}),/evidence writer/);
  assert.equal(reads,0);
});
