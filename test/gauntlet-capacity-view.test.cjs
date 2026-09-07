'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {capacityView}=require('./load-ts.cjs')('src/renderer/src/gauntlet/capacityView.ts');
const capacity=(states,limit=2)=>({revision:1,maxConcurrentRuns:limit,dispatches:states.map((state,i)=>({runId:String(i),state,sequence:i,enqueuedAt:1,updatedAt:1,reason:'Fixture'}))});
test('quarantined slots count as occupied even when no native run is running',()=>{
  const input=capacity(['quarantined','quarantined','queued']),before=structuredClone(input),view=capacityView(input);
  assert.deepEqual(view,{running:0,waiting:1,quarantined:2,occupied:2,available:0,
    summary:'2/2 slots occupied · 0 running · 1 queued · 2 need inspection'});
  assert.deepEqual(input,before);
});
test('running, queued and settled reservations do not imply interchangeable capacity',()=>{
  assert.equal(capacityView(capacity(['running','quarantined','queued','settled'])).occupied,2);
  assert.equal(capacityView(capacity(['queued','settled'])).available,2);
  assert.equal(capacityView(capacity([])).summary,'0/2 slots occupied · 0 running · 0 queued');
});
test('lowered capacity preserves the actual occupied count without negative availability',()=>{
  const view=capacityView(capacity(['running','running','quarantined'],1));
  assert.equal(view.occupied,3);assert.equal(view.available,0);assert.match(view.summary,/^3\/1 slots occupied/);
});
