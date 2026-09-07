'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),load=require('./load-ts.cjs');
const {GauntletStore}=load('src/main/gauntlet/store.ts');
const {createGauntletRun,freezeContract}=load('src/main/gauntlet/core.ts');
const {desktopPriority}=load('src/main/gauntlet/operatorPriority.ts');
const {orderRuns,needsOperator,runViewReducer:reduce,initialRunView}=load('src/renderer/src/gauntlet/runViewState.ts');
const make=id=>createGauntletRun({id,repository:'/fixture/repo',objective:`Objective ${id}`,branch:`run/${id}`,baseSha:'a'.repeat(40),now:1});
function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'op-priority-'));const store=new GauntletStore(join(root,'state.db'));store.open();t.after(()=>store.close());store.createRun(make('one'));return store;}
test('priority is durable human metadata and never changes protocol, bar, dispatch or run activity time',t=>{
  const store=fixture(t);
  const contract=freezeContract({objective:'Objective one',criteria:['observable'],checks:[],constraints:[],exclusions:[]});
  store.transition('one',0,{type:'BAR_FROZEN',at:2,contract},{contract});
  const before=store.snapshot('one'),dispatchBefore=store.db.prepare('SELECT * FROM gauntlet_dispatches').all();
  store.priorities.set('one',0,'high','This unblocks the next release.');const after=store.snapshot('one');
  assert.deepEqual({...after.run,operatorPriority:undefined},{...before.run,operatorPriority:undefined});
  assert.deepEqual(after.events,before.events);assert.deepEqual(after.run.contract,before.run.contract);
  assert.deepEqual(store.db.prepare('SELECT * FROM gauntlet_dispatches').all(),dispatchBefore);
  assert.equal(after.operatorPriorityHistory.length,1);assert.equal(after.run.operatorPriority.level,'high');
  store.close();store.open();assert.deepEqual(store.snapshot('one'),after);
  // The unchanged expected protocol version remains valid after annotation.
  store.transition('one',before.run.version,{type:'HUMAN_ESCALATED',at:3,reason:'Need a scope choice'});
  assert.equal(store.snapshot('one').run.operatorPriority.level,'high');
});
test('stale and malformed changes fail, history is append-only, and normal is an explicit reset',t=>{
  const store=fixture(t);store.priorities.set('one',0,'high','Important');const first=store.priorities.current('one');
  assert.throws(()=>store.priorities.set('one',0,'low','Stale'),/changed/);
  for(const [level,note] of [['urgent','why'],['high',''],['low',' '],['normal','x'.repeat(2001)],['normal','bad\0note']])assert.throws(()=>store.priorities.set('one',first.revision,level,note),/Invalid/);
  assert.throws(()=>store.priorities.set('missing',0,'high','Missing'),/Unknown/);
  assert.throws(()=>store.db.prepare('DELETE FROM gauntlet_operator_priorities').run(),/immutable/);
  assert.throws(()=>store.db.prepare("UPDATE gauntlet_operator_priorities SET level='low'").run(),/immutable/);
  store.priorities.set('one',first.revision,'normal','No longer blocks the release');
  assert.deepEqual(store.priorities.history('one').map(p=>p.level),['high','normal']);
});
test('attention cannot be hidden by priority and closed history stays recent-first',()=>{
  const high={...make('active-high'),operatorPriority:{revision:1,level:'high',note:'why',at:3}},
    low={...make('warning-low'),status:'human_required',operatorPriority:{revision:2,level:'low',note:'why',at:3}},
    urgent={...make('warning-high'),status:'infrastructure_failure',operatorPriority:{revision:3,level:'high',note:'why',at:3}},
    recent={...make('recent'),status:'passed',updatedAt:10,currentArtifactSha:'b'.repeat(40),candidateHandoff:{artifactSha:'b'.repeat(40),reviewed:true,note:'Disposition',at:10}},
    old={...make('old'),status:'passed',currentArtifactSha:'b'.repeat(40),candidateHandoff:{artifactSha:'b'.repeat(40),reviewed:true,note:'Disposition',at:10},operatorPriority:{revision:4,level:'high',note:'why',at:11}};
  assert.deepEqual(orderRuns([high,low,urgent,recent,old]).map(run=>run.id),['warning-high','warning-low','active-high','recent','old']);
  assert.equal(needsOperator(low),true);
});
test('priority and protocol revisions independently reject stale responses',()=>{
  const current={...make('one'),version:4,operatorPriority:{revision:9,level:'high',note:'focus',at:9}};
  let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[current]});
  state=reduce(state,{type:'listed',epoch:0,runs:[{...make('one'),version:5,operatorPriority:{revision:8,level:'low',note:'old',at:8}}]});
  assert.equal(state.runs[0].operatorPriority.revision,9);assert.equal(state.runs[0].version,4);
  state=reduce(state,{type:'listed',epoch:0,runs:[{...current,version:5}]});assert.equal(state.runs[0].version,5);
});
test('main-frame-only handler refuses foreign callers before invoking priority storage',()=>{
  const mainFrame={},window={mainFrame};let calls=0;
  const set=desktopPriority({localWindow:()=>window,set:()=>{calls++;return 'saved';}});
  for(const event of [{sender:{},senderFrame:mainFrame},{sender:window,senderFrame:{}}])assert.throws(()=>set(event,'one',0,'high','reason'),/local desktop/);
  assert.equal(calls,0);assert.throws(()=>set({sender:window,senderFrame:mainFrame},'one',NaN,'high','why'),/Invalid/);
  assert.equal(set({sender:window,senderFrame:mainFrame},'one',0,'normal','why'),'saved');assert.equal(calls,1);
});
test('schema nine upgrades without inventing historical priorities',t=>{
  const store=fixture(t);store.db.exec('DROP TABLE gauntlet_operator_priorities');store.db.pragma('user_version=9');store.close();store.open();
  assert.equal(store.db.pragma('user_version',{simple:true}),10);
  assert.deepEqual(store.snapshot('one').operatorPriorityHistory,[]);assert.equal(store.snapshot('one').run.operatorPriority,undefined);
});
