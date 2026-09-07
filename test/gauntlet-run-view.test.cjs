'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const {createGauntletRun}=load('src/main/gauntlet/core.ts');
const {initialRunView,runViewReducer:reduce,filterRuns,roleLaunchLabel,nextRunStep,orderRuns}=load('src/renderer/src/gauntlet/runViewState.ts');
function run(id,status='orienting',version=0,repository='/work/product') {
  return {...createGauntletRun({id,repository,objective:`Objective ${id}`,branch:`run/${id}`,baseSha:'a'.repeat(40),now:100}),status,version};
}
test('preparation evidence returns a terminal run to attention and rejects stale same-version projections',()=>{
  const old=run('prep','cancelled',2),current={...old,preparationRevision:3,preparationPending:1};
  assert.equal(filterRuns([current],'closed','','').length,0);
  assert.equal(filterRuns([current],'attention','','').length,1);
  assert.match(nextRunStep(current).action,/preparation/);
  let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[old]});
  state=reduce(state,{type:'detail',epoch:state.selectionEpoch,snapshot:snapshot(old)});
  state=reduce(state,{type:'listed',epoch:0,runs:[current]});
  assert.equal(state.snapshot,null);assert.equal(state.detailPending,true);
  state=reduce(state,{type:'listed',epoch:0,runs:[old]});
  assert.equal(state.runs[0].preparationPending,1);
});
const snapshot=r=>({run:r,launches:[],artifacts:[],reports:[],acknowledgments:[],repairPackets:[],events:[]});
test('initial load is distinct from empty and a failed list never erases pushed data',()=>{
  assert.equal(initialRunView.listPending,true);
  let state=reduce(initialRunView,{type:'changed',snapshot:snapshot(run('a'))});
  state=reduce(state,{type:'list-failed',epoch:0,error:'database unavailable'});
  assert.equal(state.runs.length,1);assert.equal(state.listError,'database unavailable');assert.equal(state.listPending,false);
});
test('late initial listing preserves newer event versions and the selected evidence',()=>{
  let state=reduce(initialRunView,{type:'changed',snapshot:snapshot(run('a','human_required',3))});
  state=reduce(state,{type:'listed',epoch:0,runs:[run('a'),run('b')]});
  assert.equal(state.runs.find(r=>r.id==='a').version,3);assert.equal(state.selectedId,'a');assert.equal(state.snapshot.run.version,3);
});
test('rapid A to B selection rejects late A responses and errors, clearing old detail immediately',()=>{
  let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[run('a'),run('b')]});
  const aEpoch=state.selectionEpoch;
  state=reduce(state,{type:'detail',epoch:aEpoch,snapshot:snapshot(run('a'))});
  state=reduce(state,{type:'select',id:'b'});const bEpoch=state.selectionEpoch;
  assert.equal(state.snapshot,null);assert.equal(state.detailPending,true);
  assert.equal(reduce(state,{type:'detail',epoch:aEpoch,snapshot:snapshot(run('a'))}),state);
  assert.equal(reduce(state,{type:'detail-failed',epoch:aEpoch,error:'late A error'}),state);
  state=reduce(state,{type:'detail',epoch:bEpoch,snapshot:snapshot(run('b'))});
  assert.equal(state.snapshot.run.id,'b');assert.equal(state.detailPending,false);
});
test('same-run push invalidates older reads even with equal version, and other-run cancellation cannot steal selection',()=>{
  let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[run('a'),run('b')]});const epoch=state.selectionEpoch;
  const pushed=snapshot(run('a'));pushed.launches=[{id:'receipt'}];
  state=reduce(state,{type:'changed',snapshot:pushed});
  assert.equal(reduce(state,{type:'detail',epoch,snapshot:snapshot(run('a'))}),state);
  state=reduce(state,{type:'select',id:'b'});
  state=reduce(state,{type:'changed',snapshot:snapshot(run('a','cancelled',1))});
  assert.equal(state.selectedId,'b');assert.equal(state.snapshot,null);
});
test('mismatched or stale detail cannot display as the selected current evidence',()=>{
  const state=reduce(initialRunView,{type:'listed',epoch:0,runs:[run('a','needs_repair',7)]});
  const mismatched=reduce(state,{type:'detail',epoch:state.selectionEpoch,snapshot:snapshot(run('b'))});
  assert.equal(mismatched.snapshot,null);assert.equal(mismatched.detailPending,false);assert.match(mismatched.detailError,/different run/);
  const stale=reduce(state,{type:'detail',epoch:state.selectionEpoch,snapshot:snapshot(run('a'))});
  assert.equal(stale.snapshot,null);assert.match(stale.detailError,/changed while loading/);
});
test('operator escalation and failures rank ahead of active work, with conductor acknowledgment not a human decision',()=>{
  const runs=[run('closed','cancelled'),run('ack','awaiting_lead_ack'),run('human','human_required'),run('failure','infrastructure_failure')];
  assert.deepEqual(orderRuns(runs).map(r=>r.id),['failure','human','ack','closed']);
  assert.deepEqual(filterRuns(runs,'attention','','').map(r=>r.id),['failure','human']);
  assert.equal(nextRunStep(runs[1]).owner,'Conductor');
  assert.equal(nextRunStep(runs[2]).owner,'You');
});
test('project/status/search filters compose without conflating repositories',()=>{
  const runs=[run('one','orienting',0,'/work/same'),run('two','passed',0,'/other/same'),run('three','human_required',0,'/work/same')];
  assert.deepEqual(filterRuns(runs,'active','/work/same','OBJECTIVE').map(r=>r.id),['one']);
  assert.deepEqual(filterRuns(runs,'attention','/other/same','two').map(r=>r.id),['two']);
  assert.deepEqual(filterRuns(runs,'closed','/other/same','two'),[],'unreviewed passed candidate is not closed');
  assert.deepEqual(filterRuns(runs,'attention','/work/same','no match'),[]);
});
test('terminal unlaunched roles and configured authority never imply live workers',()=>{
  assert.equal(roleLaunchLabel(run('a','cancelled'),'critic'),'Not launched in this run');
  assert.equal(roleLaunchLabel(run('a'),'critic'),'Not launched yet');
  assert.match(roleLaunchLabel(run('a'),'conductor'),/no launch receipt/);
  assert.match(roleLaunchLabel(run('a','cancelled'),'implementer',{status:'cancelled',sessionId:'12345678xxxx'}),/^cancelled/);
});
test('live updates preserve all attention work while keeping the advertised closed-history bound',()=>{
  let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[run('old-active'),run('old-human','human_required')]});
  for(let i=0;i<105;i++)state=reduce(state,{type:'changed',snapshot:snapshot({...run(`closed-${i}`,'cancelled'),updatedAt:200+i})});
  assert.equal(state.runs.filter(r=>r.status==='cancelled').length,100);
  assert.ok(state.runs.some(r=>r.id==='old-active'));assert.ok(state.runs.some(r=>r.id==='old-human'));
  assert.equal(state.runs.some(r=>r.id==='closed-0'),false);
});
test('late list results and failures cannot overwrite a newer refresh',()=>{
 let state=reduce(initialRunView,{type:'list-requested',epoch:1});
 state=reduce(state,{type:'list-requested',epoch:2});
 assert.equal(reduce(state,{type:'list-failed',epoch:1,error:'older failure'}),state);
 assert.equal(reduce(state,{type:'listed',epoch:1,runs:[run('obsolete')]}),state);
 state=reduce(state,{type:'listed',epoch:2,runs:[run('current')]});
 assert.equal(state.listPending,false);assert.equal(state.listError,null);assert.equal(state.selectedId,'current');
 assert.equal(reduce(state,{type:'list-requested',epoch:1}),state);
});
test('newer list version clears stale evidence and reloads without changing selection',()=>{
 let state=reduce(initialRunView,{type:'changed',snapshot:snapshot(run('a','awaiting_lead_ack',2))});
 const oldEpoch=state.selectionEpoch;
 state=reduce(state,{type:'list-requested',epoch:1});
 state=reduce(state,{type:'listed',epoch:1,runs:[run('a','needs_repair',3)]});
 assert.equal(state.snapshot,null);assert.equal(state.detailPending,true);assert.equal(state.selectedId,'a');
 assert.equal(state.runs[0].status,'needs_repair');assert.ok(state.selectionEpoch>oldEpoch);
 assert.equal(reduce(state,{type:'detail',epoch:oldEpoch,snapshot:snapshot(run('a','awaiting_lead_ack',2))}),state);
 state=reduce(state,{type:'detail',epoch:state.selectionEpoch,snapshot:snapshot(run('a','needs_repair',3))});
 assert.equal(state.snapshot.run.version,3);assert.equal(state.detailPending,false);
});
test('a newer list restarts a pending read but equal versions retain pushed receipts',()=>{
 let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[run('a')]});
 const epoch=state.selectionEpoch;
 state=reduce(state,{type:'list-requested',epoch:1});
 state=reduce(state,{type:'listed',epoch:1,runs:[run('a','implementer_in_flight',1)]});
 assert.ok(state.selectionEpoch>epoch);assert.equal(state.detailPending,true);
 const pushed=snapshot(run('a','implementer_in_flight',1));pushed.launches=[{id:'fresh-receipt'}];
 state=reduce(state,{type:'changed',snapshot:pushed});
 state=reduce(state,{type:'list-requested',epoch:2});
 state=reduce(state,{type:'listed',epoch:2,runs:[run('a','implementer_in_flight',1)]});
 assert.equal(state.snapshot,pushed);assert.equal(state.detailPending,false);
});
