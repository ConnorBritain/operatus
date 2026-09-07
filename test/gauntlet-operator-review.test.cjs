'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const load=require('./load-ts.cjs');
const {GauntletStore}=load('src/main/gauntlet/store.ts');
const {createGauntletRun,applyGauntletEvent:apply}=load('src/main/gauntlet/core.ts');
const {needsOperator,isClosedRun,isTerminalRun,nextRunStep,runViewReducer,initialRunView}=load('src/renderer/src/gauntlet/runViewState.ts');
const run=id=>createGauntletRun({id,repository:'/fixture/repo',objective:'Review fixture',branch:`run/${id}`,baseSha:'a'.repeat(40),now:1});
const review={type:'OPERATOR_REVIEW_RECORDED',at:3,reviewed:true,note:'Handled separately; preserve this failed attempt.'};
test('human review changes queue disposition without altering terminal protocol evidence',()=>{
 const stopped=apply(run('one'),{type:'HUMAN_ESCALATED',at:2,reason:'Conflicting requirements'});
 const reviewed=apply(stopped,review);
 const {operatorReview,version,updatedAt,...rest}=reviewed;
 assert.deepEqual(rest,((({version,updatedAt,...rest})=>rest)(stopped)));
 assert.equal(operatorReview.note,review.note);assert.equal(version,stopped.version+1);
 assert.equal(needsOperator(reviewed),false);assert.equal(isClosedRun(reviewed),true);assert.equal(isTerminalRun(reviewed),true);
 assert.equal(nextRunStep(reviewed).owner,'None');
 const reopened=apply(reviewed,{...review,at:4,reviewed:false,note:'New information needs a decision'});
 assert.equal(reopened.status,'human_required');assert.equal(needsOperator(reopened),true);assert.equal(isTerminalRun(reopened),true);
 assert.throws(()=>apply(reviewed,{type:'CANCELLED',at:5,reason:'must remain terminal'}),/terminal/);
});
test('review cannot close active work, create success, or accept empty, excessive or invalid records',()=>{
 for(const status of ['orienting','implementer_in_flight','awaiting_lead_ack','passed','cancelled']){
  assert.throws(()=>apply({...run(status),status},review),/only stopped attention/);
 }
 const stopped={...run('failure'),status:'infrastructure_failure',updatedAt:2};
 for(const override of [{note:''},{note:'   '},{note:'x'.repeat(4001)},{reviewed:'yes'},{at:1},{at:NaN}])assert.throws(()=>apply(stopped,{...review,...override}));
});
test('review and restoration are transactional, stale writes fail, and notes survive SQLite reopen',()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'op-review-')),db=new GauntletStore(join(root,'state.db'));db.open();
 try{
  db.createRun(run('one'));db.transition('one',0,{type:'HUMAN_ESCALATED',at:2,reason:'Choose requirement'});
  const marked=db.transition('one',1,review);
  assert.equal(marked.events.at(-1).event.note,review.note);
  assert.throws(()=>db.transition('one',1,{...review,note:'stale overwrite'}),/stale run version/);
  assert.equal(db.snapshot('one').events.length,2);
  db.close();db.open();assert.deepEqual(db.snapshot('one'),marked);
  const restored=db.transition('one',2,{...review,at:4,reviewed:false,note:'Reconsider the requirement'});
  assert.equal(restored.events.length,3);assert.equal(restored.run.status,'human_required');
  assert.equal(restored.events[1].event.note,review.note);
 }finally{db.close();}
});
test('reviewed history is bounded while older unresolved attention and active work remain discoverable',()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'op-review-list-')),db=new GauntletStore(join(root,'state.db'));db.open();
 try{
  db.createRun(run('active'));db.createRun(run('unresolved'));
  db.transition('unresolved',0,{type:'HUMAN_ESCALATED',at:2,reason:'Still needs a decision'});
  for(let i=0;i<105;i++){
   const id=`reviewed-${i}`;db.createRun(run(id));db.transition(id,0,{type:'HUMAN_ESCALATED',at:2,reason:'Fixture'});
   db.transition(id,1,{...review,at:10+i});
  }
  const runs=db.listOperatorRuns();assert.equal(runs.length,102);
  assert.ok(runs.some(r=>r.id==='active'));assert.ok(runs.some(r=>r.id==='unresolved'));
  assert.ok(!runs.some(r=>r.id==='reviewed-0'));
  assert.deepEqual(db.listRecoverableRuns().map(r=>r.id),['active']);
  db.transition('reviewed-0',2,{...review,at:200,reviewed:false,note:'Return this old decision'});
  assert.ok(db.listOperatorRuns().some(r=>r.id==='reviewed-0'&&needsOperator(r)));
  const projection=runViewReducer(initialRunView,{type:'listed',epoch:0,runs:db.listOperatorRuns()});
  assert.equal(projection.runs.length,103);assert.equal(projection.runs.filter(isClosedRun).length,100);
 }finally{db.close();}
});
