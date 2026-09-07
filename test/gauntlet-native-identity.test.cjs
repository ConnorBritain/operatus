'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{randomUUID}=require('node:crypto');
const load=require('./load-ts.cjs'),journal=require('./fixtures/codex-journal.cjs');
const {GauntletStore}=load('src/main/gauntlet/store.ts');
const {runtimeView}=load('src/renderer/src/gauntlet/runtimeView.ts');
function fixture(t) {
  const store=new GauntletStore(join(fs.mkdtempSync(join(tmpdir(),'op-native-id-')),'gauntlet.db'));store.open();t.after(()=>store.close());
  return journal(store);
}
const start={type:'process_started',pid:1234,model:'gpt-5.6-sol',profileSha256:'a'.repeat(64),boundarySha256:'b'.repeat(64)};
const thread=()=>({type:'native_identity',provider:'codex',threadId:randomUUID(),turnId:null});
test('Codex Conductor admission and successive turn identities survive freeze and restart without widening Critic identity', t => {
  const {createGauntletRun,freezeContract}=load('src/main/gauntlet/core.ts');
  const {codexSubscriptionEvidence}=load('src/main/gauntlet/subscriptionEvidence.ts');
  const f=fixture(t),now=Date.now();
  const run=createGauntletRun({repository:'/fixture',objective:'Codex lead',branch:randomUUID(),baseSha:'a'.repeat(40),
    providers:{conductor:{provider:'codex',model:'gpt-6-astra'}}});f.store.createRun(run);
  const lead={...f.launch,id:randomUUID(),runId:run.id,role:'conductor',model:'gpt-6-astra',sessionId:randomUUID(),expectedSha:run.baseSha,createdAt:now};
  f.store.transition(run.id,0,{type:'CONDUCTOR_PREPARED',launchId:lead.id,at:now},{launch:lead});
  const record=event=>f.store.recordRuntimeObservation({runId:run.id,launchId:lead.id,sessionId:lead.sessionId,at:now,event});
  record(codexSubscriptionEvidence({component:'codex-subscription-account-v1',accountHash:'a'.repeat(64),plan:'pro',
    credits:'none-observed',topUps:'not-programmatically-verified',observedAt:now,validUntil:now+30000,launchAllowed:false},
    {version:'0.153.4',sha256:'b'.repeat(64),companionSha256:'c'.repeat(64),model:lead.model,source:'injected-dependencies'}));
  record({...start,model:lead.model});const event=thread(),first=randomUUID(),second=randomUUID();
  record(event);record({...event,turnId:first});
  const contract=freezeContract({objective:run.requestedObjective,criteria:['Inspect'],checks:[],constraints:[],exclusions:[]},lead.id);
  f.store.transition(run.id,1,{type:'BAR_FROZEN',contract,at:now},{contract});
  assert.equal(f.store.snapshot(run.id).run.currentLaunchId,null);
  record({...event,turnId:second});f.store.close();f.store.open();
  record({...event,turnId:second});
  const saved=f.store.snapshot(run.id);assert.equal(saved.runtimeObservations.filter(o=>o.event.type==='native_identity').length,3);
  assert.equal(saved.run.status,'awaiting_implementation');
  const peer=journal(f.store);peer.record(start);const peerThread=thread();peer.record(peerThread);
  assert.throws(()=>peer.record({...peerThread,turnId:second}),/UNIQUE/);
  assert.throws(()=>record({...event,threadId:'foreign',turnId:randomUUID()}),/recorded thread/);
});
test('native identities persist across restart, never replace allocated identity or advance protocol',t=>{
  const f=fixture(t),before=f.store.snapshot(f.run.id),event=thread();f.record(start);
  const first=f.observation(event);f.store.recordRuntimeObservation(first);f.store.recordRuntimeObservation(first);
  const second=f.observation({...event,turnId:randomUUID()});f.store.recordRuntimeObservation(second);
  f.store.close();f.store.open();const after=f.store.snapshot(f.run.id);
  assert.equal(after.run.version,before.run.version);assert.deepEqual(after.events,before.events);
  assert.deepEqual(after.artifacts,before.artifacts);assert.deepEqual(after.reports,[]);assert.deepEqual(after.acknowledgments,[]);
  assert.deepEqual(after.launches,before.launches);assert.equal(after.run.runtimeAttention,undefined);
  assert.deepEqual(runtimeView(f.launch.id,after.runtimeObservations).nativeIdentity,second.event);
  assert.equal(runtimeView('absent').nativeIdentity,null);
  assert.throws(()=>f.store.recordRuntimeObservation({...second,event:{...second.event,turnId:randomUUID()}}),/immutable/);
});
test('thread and turn identities cannot be reused across runs after restart',t=>{
  const f=fixture(t),event=thread(),turnId=randomUUID();f.record(start);f.record(event);f.record({...event,turnId});
  f.store.close();f.store.open();const peer=journal(f.store);peer.record(start);
  assert.throws(()=>peer.record(event),/UNIQUE/);
  const other=thread();peer.record(other);assert.throws(()=>peer.record({...other,turnId}),/UNIQUE/);
  assert.equal(f.store.snapshot(peer.run.id).runtimeObservations.length,2);
});
test('identity requires exact active launch, ordered thread/turn, narrow fields and observed process',t=>{
  const f=fixture(t),event=thread();assert.throws(()=>f.record(event),/active observed/);f.record(start);
  for(const changed of [{provider:'claude'},{threadId:''},{threadId:'a'.repeat(129)},{threadId:'/secret'},
    {turnId:undefined},{turnId:0},{accessToken:'secret'}]) assert.throws(()=>f.record({...event,...changed}));
  assert.throws(()=>f.record({...event,turnId:randomUUID()}),/recorded thread/);
  assert.throws(()=>f.store.recordRuntimeObservation({...f.observation(event),sessionId:randomUUID()}),/identity mismatch/);
  f.record(event);assert.throws(()=>f.record({...event,threadId:randomUUID(),turnId:randomUUID()}),/recorded thread/);
  f.record({type:'recovery_interrupted'});assert.throws(()=>f.record({...event,turnId:randomUUID()}),/active observed/);
});
test('post-cancellation new identity is rejected while exact historical replay remains idempotent',t=>{
  const f=fixture(t);f.record(start);const first=f.observation(thread());f.store.recordRuntimeObservation(first);
  const snapshot=f.store.snapshot(f.run.id);f.store.transition(f.run.id,snapshot.run.version,{type:'CANCELLED',at:Date.now(),reason:'fixture'});
  f.store.recordRuntimeObservation(first);
  assert.throws(()=>f.record({...first.event,turnId:randomUUID()}),/active observed/);
});
