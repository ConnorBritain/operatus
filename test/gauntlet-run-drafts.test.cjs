'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-ts.cjs');
const {RunDrafts}=load('src/renderer/src/gauntlet/runDrafts.ts');
const {createGauntletRun}=load('src/main/gauntlet/core.ts');
const {runViewReducer:reduce,initialRunView}=load('src/renderer/src/gauntlet/runViewState.ts');
const run=(id='one',repository='/project/one')=>({...createGauntletRun({id,repository,objective:id,branch:`run/${id}`,baseSha:'a'.repeat(40),now:1}),status:'human_required',version:3});
const snapshot=run=>({run,launches:[],reports:[],artifacts:[],events:[],acknowledgments:[],repairPackets:[]});
test('same-run refresh clears stale evidence, not unsaved drafts or their original evidence basis',()=>{
  const drafts=new RunDrafts(),original=run();
  let state=reduce(initialRunView,{type:'listed',epoch:0,runs:[original]});
  state=reduce(state,{type:'detail',epoch:state.selectionEpoch,snapshot:snapshot(original)});
  drafts.review(original,'Keep the failed attempt while I compare requirements');
  drafts.priority(original,{level:'high',note:'Blocks release review'});
  const saved=drafts.read(original);
  state=reduce(state,{type:'select',id:original.id});assert.equal(state.snapshot,null);
  state=reduce(state,{type:'detail-failed',epoch:state.selectionEpoch,error:'offline'});
  assert.equal(drafts.read(original),saved);
  const newer={...original,version:4,runtimeAttention:{sequence:8,count:1}};
  state=reduce(state,{type:'select',id:original.id});state=reduce(state,{type:'detail',epoch:state.selectionEpoch,snapshot:snapshot(newer)});
  assert.equal(drafts.read(newer),saved);
  assert.deepEqual(saved.review.basis,{version:3,sequence:0},'Retained draft must not be silently authorized against new evidence');
  assert.notEqual(saved.review.basis.version,state.snapshot.run.version);
});
test('switching projects and returning restores only the original run draft',()=>{
  const drafts=new RunDrafts(),one=run(),two=run('two','/unrelated/project');
  drafts.review(one,'Private to project one');drafts.priority(two,{note:'Separate strategy'});
  assert.equal(drafts.read(two).review.note,'');assert.equal(drafts.read(one).priority.note,'');
  assert.equal(drafts.read(one).review.note,'Private to project one');
  assert.equal(drafts.read({...one,repository:'/different/repository'}).review.note,'');
});
test('late successful save cannot clear text entered afterward, even identical text',()=>{
  const drafts=new RunDrafts(),one=run();drafts.review(one,'Initial');const first=drafts.read(one).review.edit;
  drafts.review(one,'Initial');assert.equal(drafts.clearReview(one,first),false);assert.equal(drafts.read(one).review.note,'Initial');
  const second=drafts.read(one).review.edit;assert.equal(drafts.clearReview(one,second),true);assert.equal(drafts.read(one).review.note,'');
  assert.equal(drafts.clearReview(one,second),false,'Duplicate completion is inert');
  drafts.priority(one,{level:'high',note:'Original'});const priority=drafts.read(one).priority.edit;
  drafts.priority(one,{note:'Newer reason'});assert.equal(drafts.clearPriority(one,priority),false);assert.equal(drafts.read(one).priority.note,'Newer reason');
});
test('success clears only the saved section and not a peer run or another form',()=>{
  const drafts=new RunDrafts(),one=run(),two=run('two');drafts.review(one,'Decision');drafts.priority(one,{note:'Priority'});drafts.review(two,'Peer');
  drafts.clearReview(one,drafts.read(one).review.edit);
  assert.equal(drafts.read(one).priority.note,'Priority');assert.equal(drafts.read(two).review.note,'Peer');
});
test('subscriptions notify only the current run and survive detail remounts',()=>{
  const drafts=new RunDrafts(),one=run(),two=run('two');let first=0,second=0,remount=0;
  const off=drafts.subscribe(one,()=>first++),offPeer=drafts.subscribe(two,()=>second++);
  drafts.review(one,'draft');assert.equal(first,1);assert.equal(second,0);off();
  const offNew=drafts.subscribe(one,()=>remount++);drafts.clearReview(one,drafts.read(one).review.edit);
  assert.equal(first,1);assert.equal(remount,1);assert.equal(second,0);offNew();offPeer();
});
test('pristine priority follows current server choice; edited drafts keep their choice until reset',()=>{
  const drafts=new RunDrafts(),one=run();drafts.read(one);
  const high={...one,operatorPriority:{revision:7,level:'high',note:'Important',at:5}};
  drafts.priority(high,{note:'Keep focusing here'});assert.equal(drafts.read(high).priority.level,'high');assert.equal(drafts.read(high).priority.revision,7);
  drafts.priority(high,{level:'low'});const normal={...high,operatorPriority:{...high.operatorPriority,revision:8,level:'normal'}};
  assert.equal(drafts.read(normal).priority.level,'low');assert.equal(drafts.read(normal).priority.revision,7);
  drafts.clearPriority(normal,drafts.read(normal).priority.edit);drafts.priority(normal,{note:'New reason'});
  assert.equal(drafts.read(normal).priority.level,'normal');assert.equal(drafts.read(normal).priority.revision,8);
});
test('draft edits do not mutate input snapshots and a new Runs surface starts without unsaved drafts',()=>{
  const one=run(),before=JSON.stringify(one),drafts=new RunDrafts();drafts.review(one,'Draft');drafts.priority(one,{level:'high',note:'Focus'});
  assert.equal(JSON.stringify(one),before);assert.equal(new RunDrafts().read(one).review.note,'');
});
