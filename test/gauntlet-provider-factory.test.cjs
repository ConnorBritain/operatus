'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os');
const load=require('./load-ts.cjs');
const {createIsolatedProviderFactory}=load('src/main/gauntlet/isolatedProviderFactory.ts');
const {codexSubscriptionEvidence}=load('src/main/gauntlet/subscriptionEvidence.ts');
const {GauntletStore}=load('src/main/gauntlet/store.ts');
const journal=require('./fixtures/codex-journal.cjs');
const noop=()=>{};
test('Codex Conductor rejects unrecognized models and missing identity writers before native inspection',async()=>{
  let reads=0;const factory=createIsolatedProviderFactory({root:'/must-not-write',assertAdmissionOpen:noop},
    {codex:{inspect:async()=>{reads++;throw Error('unexpected');}}});
  assert.equal(factory.supportsCodexConductor,true);
  const launch={provider:'codex',role:'conductor',model:'gpt-other'};
  await assert.rejects(factory.conductor({launch},new AbortController().signal,noop,noop,noop,noop,noop),/no fallback/);
  await assert.rejects(factory.conductor({launch:{...launch,model:'gpt-6-astra'}},new AbortController().signal,noop,noop,noop,noop,undefined),/writers are required/);
  assert.equal(reads,0);
});
test('mixed factory hold precedes accounts, inspection and filesystem work for every role',async()=>{
  let reads=0;
  const dependencies={account:{verify:async()=>{reads++;throw Error('unexpected');}},inspect:async()=>{reads++;throw Error('unexpected');}};
  const factory=createIsolatedProviderFactory({root:'/must-not-write',assertAdmissionOpen:()=>{throw Error('held');}},{claude:dependencies,codex:dependencies});
  for(const [method,provider,role] of [['conductor','claude','conductor'],['conductor','codex','conductor'],['worker','claude','implementer'],['worker','codex','critic']]) {
    await assert.rejects(factory[method]({launch:{provider,role}},new AbortController().signal,noop,noop,noop,noop,noop),/held/);
  }
  assert.equal(reads,0);
});
test('Codex refuses wrong role/model/evidence and absent durable writers before touching credentials or pins',async()=>{
  let reads=0;const factory=createIsolatedProviderFactory({root:'/must-not-write',assertAdmissionOpen:noop},{codex:{inspect:async()=>{reads++;throw Error('unexpected');}}});
  const launch={provider:'codex',role:'critic',model:'gpt-5.6-sol',reviewEvidence:{directory:'/fixture'}};
  for(const change of [{role:'implementer'},{role:'conductor'},{provider:'other'},{model:'gpt-other'},{reviewEvidence:undefined}]) {
    await assert.rejects(factory.worker({launch:{...launch,...change}},new AbortController().signal,noop,noop,noop,noop,noop),/no fallback/);
  }
  for(const callbacks of [[undefined,noop],[noop,undefined]]) await assert.rejects(factory.worker({launch},new AbortController().signal,noop,noop,noop,...callbacks),/writers are required/);
  const abort=new AbortController();abort.abort();await assert.rejects(factory.worker({launch},abort.signal,noop,noop,noop,noop,noop),/abort/i);
  assert.equal(reads,0);
});
test('Codex admission history records no credential, rejects stronger billing claims and survives reopen',t=>{
  const store=new GauntletStore(join(fs.mkdtempSync(join(tmpdir(),'op-codex-admission-')),'gauntlet.db'));store.open();t.after(()=>store.close());
  const f=journal(store),now=Date.now();
  const event=codexSubscriptionEvidence({component:'codex-subscription-account-v1',accountHash:'a'.repeat(64),credentialHash:'secret',accessToken:'secret',
    plan:'pro',credits:'none-observed',topUps:'not-programmatically-verified',observedAt:now,validUntil:now+30000,launchAllowed:false},
    {version:'0.153.4',sha256:'b'.repeat(64),companionSha256:'c'.repeat(64),model:f.launch.model,source:'injected-dependencies'});
  assert.doesNotMatch(JSON.stringify(event),/secret|credentialHash|accessToken/);
  for(const change of [{topUps:'disabled'},{credits:'guaranteed-free'},{plan:'max'},{companionSha256:'invalid'},
    {organizationHash:'a'.repeat(64)},{extraUsage:'disabled'},{credentialHash:'secret'},{launchAllowed:true}]) {
    assert.throws(()=>f.record({...event,...change}));
  }
  const observation=f.observation(event);store.recordRuntimeObservation(observation);store.recordRuntimeObservation(observation);
  store.close();store.open();const saved=store.snapshot(f.run.id);assert.deepEqual(saved.runtimeObservations[0].event,event);
  assert.equal(saved.reports.length,0);assert.equal(saved.run.status,'critic_in_flight');
});
