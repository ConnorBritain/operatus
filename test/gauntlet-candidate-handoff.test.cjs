const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),load=require('./load-ts.cjs');
const {GauntletStore}=load('src/main/gauntlet/store.ts');
const {createGauntletRun,applyGauntletEvent:apply}=load('src/main/gauntlet/core.ts');
const {needsOperator,isClosedRun,nextRunStep,orderRuns,runViewReducer,initialRunView}=load('src/renderer/src/gauntlet/runViewState.ts');
const {desktopCandidateHandoff}=load('src/main/gauntlet/desktopCandidateHandoff.ts');
const {RunDrafts}=load('src/renderer/src/gauntlet/runDrafts.ts');
const sha='b'.repeat(40);
const run=id=>({...createGauntletRun({id,repository:'/fixture/repo',objective:'Handoff fixture',branch:`run/${id}`,baseSha:'a'.repeat(40),now:1}),status:'passed',currentArtifactSha:sha});
const event={type:'CANDIDATE_HANDOFF_RECORDED',artifactSha:sha,reviewed:true,note:'Owner: operator. Hold for independent integration review.',at:2};

test('exact candidate disposition is separate from verdict and runtime warning review',()=>{
  const before=run('one');assert.equal(needsOperator(before),true);assert.equal(isClosedRun(before),false);
  const after=apply(before,event);
  const {candidateHandoff,version,updatedAt,...rest}=after;
  assert.deepEqual(rest,((({version,updatedAt,...r})=>r)(before)));
  assert.equal(needsOperator(after),false);assert.equal(isClosedRun(after),true);assert.match(nextRunStep(after).action,/integration is not tracked/);
  const warning={...after,runtimeAttention:{sequence:4,count:1}};
  assert.equal(needsOperator(warning),true);assert.equal(isClosedRun(warning),false);
  const runtimeReviewed={...before,runtimeAttention:{sequence:4,count:1},operatorReview:{reviewed:true,runtimeSequence:4,note:'Only runtime',at:2}};
  assert.equal(needsOperator(runtimeReviewed),true,'runtime review cannot dismiss the candidate');
  const reopened=apply(after,{...event,reviewed:false,at:3,note:'Operator will reconsider'});
  assert.equal(needsOperator(reopened),true);assert.equal(reopened.status,'passed');
});

test('active or failed work cannot be passed through disposition; identity and input checks fail closed',()=>{
  for(const status of ['orienting','implementer_in_flight','awaiting_lead_ack','human_required','cancelled','infrastructure_failure'])assert.throws(()=>apply({...run(status),status},event),/only passed/);
  for(const patch of [{artifactSha:'c'.repeat(40)},{artifactSha:sha.slice(0,8)},{reviewed:'yes'},{at:NaN},{at:0},{note:''},{note:'x'.repeat(4001)},{note:'bad\0note'}])assert.throws(()=>apply(run('one'),{...event,...patch}));
  assert.throws(()=>apply({...run('one'),currentArtifactSha:null},event),/candidate changed/);
});

test('all pending candidates survive SQL and renderer history limits; stale/missing identities never count as handled',t=>{
  const db=new GauntletStore(join(fs.mkdtempSync(join(tmpdir(),'op-handoff-')),'state.db'));db.open();t.after(()=>db.close());
  const variants=[run('pending'),{...run('wrong-sha'),candidateHandoff:{...event,artifactSha:'c'.repeat(40)}},
    {...run('missing-sha'),currentArtifactSha:null,candidateHandoff:event},
    {...run('runtime-warning'),runtimeAttention:{sequence:1,count:1}}];
  // Runtime warning projection itself is tested separately; these are candidate states.
  for(const item of variants)db.createRun(item);
  for(let i=0;i<105;i++)db.createRun({...run(`handled-${i}`),candidateHandoff:event,updatedAt:100+i});
  const runs=db.listOperatorRuns();
  for(const item of variants)assert.ok(runs.some(r=>r.id===item.id),item.id);
  assert.equal(runs.filter(isClosedRun).length,100);
  const projected=runViewReducer(initialRunView,{type:'listed',epoch:0,runs});
  assert.equal(projected.runs.length,104);assert.equal(db.listRecoverableRuns().length,0,'handoff is never resumed execution');
  assert.throws(()=>db.transition('pending',0,event),/artifact receipt is missing/);
  assert.equal(db.snapshot('pending').events.length,0);
});

test('critical warnings stay above even high-priority verified candidates',()=>{
  const candidate={...run('candidate'),operatorPriority:{revision:1,level:'high',note:'Important',at:2}};
  const warning={...run('warning'),status:'human_required',operatorPriority:{revision:2,level:'low',note:'Low',at:2}};
  const active={...run('active'),status:'orienting'};
  assert.deepEqual(orderRuns([active,candidate,warning]).map(r=>r.id),['warning','candidate','active']);
});

test('candidate endpoint is local-main-frame only and refuses malformed input before saving',()=>{
  const local={mainFrame:{}};let calls=0;
  const save=desktopCandidateHandoff({localWindow:()=>local,save:()=>++calls});
  for(const e of [{sender:{},senderFrame:local.mainFrame},{sender:local,senderFrame:{}}])assert.throws(()=>save(e,'one',0,sha,true,'Disposition'),/local desktop/);
  assert.equal(calls,0);
  assert.throws(()=>save({sender:local,senderFrame:local.mainFrame},'one',0,sha.slice(0,8),true,'Disposition'),/invalid/);
  assert.equal(save({sender:local,senderFrame:local.mainFrame},'one',0,sha,true,'Disposition'),1);
});

test('handoff draft retains its exact basis and newer typing across refresh and late save replies',()=>{
  const drafts=new RunDrafts(),one=run('one'),two={...run('two'),repository:'/other/project'};
  drafts.handoff(one,'Owner: operator');const first=drafts.read(one).handoff;
  assert.equal(drafts.read({...one,version:2}).handoff,first);
  assert.deepEqual(first.basis,{version:0,sha});
  drafts.handoff(one,'Owner: operator, after dependencies');
  assert.equal(drafts.clearHandoff(one,first.edit),false);
  assert.equal(drafts.read(two).handoff.note,'');
  drafts.review(one,'Runtime review');drafts.priority(one,{note:'Priority'});
  assert.equal(drafts.clearHandoff(one,drafts.read(one).handoff.edit),true);
  assert.equal(drafts.read(one).review.note,'Runtime review');assert.equal(drafts.read(one).priority.note,'Priority');
});
