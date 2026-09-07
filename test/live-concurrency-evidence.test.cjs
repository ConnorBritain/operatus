'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {analyze}=require('../tools/live-concurrency-evidence.cjs');
const workloads=require('./fixtures/live-concurrency-workloads.cjs');
function fixture(){
 const ids=['a','b','c'];
 const snapshots=ids.map((id,index)=>{
  const start=[10,20,110][index],end=[100,150,200][index],sha=(index+1).toString().repeat(40);
  const launches=['conductor','implementer','critic'].map(role=>({id:id+role,sessionId:id+role,role,provider:role==='critic'?'codex':'claude',worktreePath:'/fixture/'+id+role,expectedSha:sha}));
  return {run:{id,status:'passed',currentArtifactSha:sha,contract:{digest:'bar'+id}},launches,
   runtimeObservations:launches.flatMap(l=>[{launchId:l.id,at:start,event:{type:'process_started',pid:index+10}},
    {launchId:l.id,at:start,event:{type:'subscription_admission',source:'provider-metadata'}},
    {launchId:l.id,at:end,event:{type:'process_exited',processExited:true,gatewayRevocation:'confirmed'}}]),
   artifacts:[{sha,checkReceipts:[{exitCode:0,timedOut:false}]}],
   reports:[{id:'report'+id,launchId:id+'critic',artifactSha:sha,contractDigest:'bar'+id,verdict:'PASS'}],
   acknowledgments:[{launchId:id+'conductor',reportId:'report'+id,artifactSha:sha,contractDigest:'bar'+id,decision:'pass'}]};
 });
 const samples=[{at:25,capacity:{maxConcurrentRuns:2,dispatches:ids.map((runId,i)=>({runId,state:i<2?'running':'queued'}))},launchCounts:{a:1,b:1,c:0}}];
 return {ids,snapshots,samples};
}
test('synthetic evidence analysis accepts complete identities, overlap and queue ordering',()=>{
 const f=fixture();assert.ok(Object.values(analyze(f.snapshots,f.samples,f.ids).assertions).every(Boolean));
});
test('does not confuse green outcomes with concurrency, real admission or clean shutdown',()=>{
 const f=fixture();f.snapshots[0].runtimeObservations.find(o=>o.event.type==='process_exited').event.gatewayRevocation='unknown';
 f.snapshots[1].runtimeObservations.find(o=>o.event.type==='subscription_admission').event.source='injected-dependencies';
 f.snapshots[2].reports[0].artifactSha='0'.repeat(40);
 const a=analyze(f.snapshots,[],f.ids).assertions;
 for(const k of ['queuedWithoutPreparation','queueReleasedSafely','confirmedExits','liveAdmissions','finalJudgments'])assert.equal(a[k],false,k);
});
test('non-overlapping processes cannot establish real overlap',()=>{
 const f=fixture();for(const o of f.snapshots[1].runtimeObservations)o.at+=250;
 assert.equal(analyze(f.snapshots,f.samples,f.ids).assertions.realOverlap,false);
});
test('disposable profile opens an existing workspace without seeding run or admission state',()=>{
 const config=require('./fixtures/live-concurrency-profile.cjs')('/disposable/hive',['/disposable/repo']);
 assert.equal(config.onboardingComplete,true);assert.equal(config.harnessHome,'/disposable/hive');
 assert.deepEqual(config.recentHives,['/disposable/hive']);assert.equal(config.realtimeVoiceEnabled,false);
 assert.ok(!Object.keys(config).some(k=>/gauntlet|provider|admission|capacity|auth|token|key/i.test(k)));
 assert.equal(analyze([],[],[]).assertions.bothProgressed,false);
});
test('workload fixed tests reject stubs and accept the specified minimal behavior',()=>{
 const correct={capacity:x=>Math.max(1,Math.min(8,Math.floor(x))),attention:r=>r.filter(x=>x.needsAttention).concat(r.filter(x=>!x.needsAttention)).map(x=>x.id),slots:(a,b)=>Math.max(0,a-b)};
 for(const w of workloads){
  const stub={};vm.runInNewContext(w.initial,{exports:stub});
  const failures=impl=>{let failed=0;vm.runInNewContext(w.tests,{assert,require:p=>{assert.equal(p,'./implementation.cjs');return impl;},test:(name,fn)=>{try{fn();}catch{failed++;}}});return failed;};
  assert.ok(failures(stub)>0,w.name+' stub must fail');
  // Node's strict comparison distinguishes cross-realm arrays. Execute all
  // fixture callbacks in this realm for this non-live validation.
  const run=new Function('require','test','assert',w.tests);let failed=0;
  run(()=>({[w.name]:correct[w.name]}),(name,fn)=>{try{fn();}catch(e){failed++;}},assert);
  assert.equal(failed,0,w.name+' correct implementation');
 }
});
