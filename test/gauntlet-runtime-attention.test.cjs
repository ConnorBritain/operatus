'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), {join} = require('node:path'), {tmpdir} = require('node:os'), {randomUUID} = require('node:crypto');
const load = require('./load-ts.cjs');
const {GauntletStore} = load('src/main/gauntlet/store.ts');
const {createGauntletRun} = load('src/main/gauntlet/core.ts');
const {runtimeEventNeedsAttention} = load('src/shared/gauntletRuntime.ts');
const {needsOperator,isClosedRun,nextRunStep,runViewReducer,initialRunView} = load('src/renderer/src/gauntlet/runViewState.ts');
function fixture(t) {
  const db = new GauntletStore(join(fs.mkdtempSync(join(tmpdir(),'op-runtime-attention-')),'state.db')); db.open(); t.after(()=>db.close());
  function run(status = 'passed') {
    const id = randomUUID();
    db.createRun(createGauntletRun({id,repository:'/fixture',objective:'Attention fixture',branch:`test/${id}`,baseSha:'a'.repeat(40),now:1}));
    const launch = {id:randomUUID(),runId:id,sessionId:randomUUID(),role:'conductor',provider:'claude',worktreePath:'/fixture',expectedSha:'a'.repeat(40),tokenHash:'a'.repeat(64),status:'created',createdAt:1,capability:{filesystem:'advisory',cleanContext:'advisory',toolRestrictions:'advisory',notes:[]}};
    db.transition(id,0,{type:'CONDUCTOR_PREPARED',at:2,launchId:launch.id},{launch});
    // A terminal fixture is assembled without pretending this is a real loop.
    if(status !== 'orienting') db.transition(id,1,{type:'CANCELLED',at:3,reason:'Fixture'});
    return {id,launch,observe:event=>db.recordRuntimeObservation({runId:id,launchId:launch.id,sessionId:launch.sessionId,at:4,event})};
  }
  return {db,run};
}
const exit = {type:'process_exited',reason:'result',exitCode:0,processExited:true,gatewayRevocation:'confirmed',descendantsQuiescent:false};
const warning = {...exit,reason:'gateway_revocation_failed',gatewayRevocation:'unconfirmed'};
const review = (snapshot, extra={}) => ({type:'OPERATOR_REVIEW_RECORDED',at:Date.now(),reviewed:true,note:'Inspected retained evidence; follow-up tracked separately.',runtimeSequence:snapshot.run.runtimeAttention?.sequence ?? 0,...extra});
test('post-terminal warning returns an old run to the uncapped operator queue without changing its verdict', t=>{
  const {db,run}=fixture(t), old=run(); old.observe(warning);
  for(let n=0;n<105;n++) run();
  const snap=db.snapshot(old.id);
  assert.equal(snap.run.status,'cancelled'); assert.equal(snap.run.version,2);
  assert.equal(needsOperator(snap.run),true); assert.equal(isClosedRun(snap.run),false);
  assert.match(nextRunStep(snap.run).action,/runtime warning/);
  assert.ok(db.listOperatorRuns().some(r=>r.id===old.id));
  const marked=db.transition(old.id,2,review(snap));
  assert.equal(needsOperator(marked.run),false); assert.equal(marked.run.status,'cancelled');
  assert.deepEqual(marked.artifacts,snap.artifacts); assert.deepEqual(marked.reports,snap.reports);
  db.close(); db.open(); assert.deepEqual(db.snapshot(old.id),marked);
});
test('new evidence invalidates an old review form and reopens an already reviewed run',t=>{
  const {db,run}=fixture(t), f=run(); f.observe(warning); const first=db.snapshot(f.id);
  const marked=db.transition(f.id,2,review(first));
  const messageId=randomUUID();
  f.observe({type:'delivery_queued',messageId,purpose:'orientation',promptSha256:'b'.repeat(64),reportId:null});
  f.observe({type:'delivery_completed',messageId,ok:false,resultSha256:'c'.repeat(64)});
  assert.throws(()=>db.transition(f.id,marked.run.version,review(marked)),/runtime evidence changed/);
  const latest=db.snapshot(f.id); assert.equal(latest.run.version,marked.run.version);
  assert.equal(latest.run.runtimeAttention.count,2); assert.equal(needsOperator(latest.run),true);
  assert.equal(latest.events.length,marked.events.length);
  const accepted=db.transition(f.id,latest.run.version,review(latest));
  assert.equal(needsOperator(accepted.run),false);
  assert.throws(()=>db.transition(f.id,marked.run.version,review(latest)),/stale run version/);
});
test('runtime warnings on active work cannot be dismissed as if execution had stopped',t=>{
  const {db,run}=fixture(t), f=run('orienting'); f.observe(warning); const snap=db.snapshot(f.id);
  assert.equal(needsOperator(snap.run),true);
  assert.throws(()=>db.transition(f.id,snap.run.version,review(snap)),/only stopped attention/);
});
test('SQL queue and shared classification agree on exit and delivery outcomes beyond history cutoff',t=>{
  const {db,run}=fixture(t), cases=[exit,{...exit,reason:'finished'},{...exit,reason:'cancelled',exitCode:137},warning,
    {...exit,processExited:false},{...exit,exitCode:null},{...exit,exitCode:1},{...exit,reason:'timeout'},
    {type:'delivery_completed',ok:true},{type:'delivery_completed',ok:false},{type:'recovery_interrupted'}];
  const ids=cases.map(event=>{
    const f=run();
    if(event.type==='recovery_interrupted') f.observe({type:'process_started',pid:42,model:'claude-fable-5-1',profileSha256:'a'.repeat(64),boundarySha256:'b'.repeat(64)});
    if(event.type==='delivery_completed') {
      const messageId=randomUUID(); f.observe({type:'delivery_queued',messageId,purpose:'orientation',promptSha256:'b'.repeat(64),reportId:null});
      event={...event,messageId,resultSha256:'c'.repeat(64)};
    }
    f.observe(event); return {id:f.id,warn:runtimeEventNeedsAttention(event)};
  });
  // Newer timestamp rather than random-ID tie breaking makes the cutoff exact.
  for(let i=0;i<105;i++) {
    const id=randomUUID(); db.createRun({...createGauntletRun({id,repository:'/fixture',objective:'Recent',branch:id,baseSha:'a'.repeat(40),now:100+i}),status:'cancelled'});
  }
  const listed=db.listOperatorRuns();
  for(const c of ids) {assert.equal(listed.some(r=>r.id===c.id),c.warn); assert.equal(needsOperator(db.snapshot(c.id).run),c.warn);}
});
test('late lists and detail events cannot erase newer runtime evidence at the same protocol version',t=>{
  const {db,run}=fixture(t), f=run(), before=db.snapshot(f.id); f.observe(warning); const after=db.snapshot(f.id);
  let state=runViewReducer(initialRunView,{type:'changed',snapshot:after,select:true});
  state=runViewReducer(state,{type:'listed',epoch:0,runs:[before.run]});
  assert.equal(needsOperator(state.runs[0]),true);
  state=runViewReducer(state,{type:'changed',snapshot:before}); assert.equal(state.snapshot.run.runtimeRevision,after.run.runtimeRevision);
  state=runViewReducer(state,{type:'detail',epoch:state.selectionEpoch,snapshot:before}); assert.match(state.detailError,/Run changed/);
});
