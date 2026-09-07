'use strict';
module.exports = [
  { name: 'capacity', specification: 'exports.capacity(requested) takes a finite number. Round down, then clamp to the inclusive integer range 1 through 8.',
    initial: 'exports.capacity = requested => requested;\n', tests: `
const {capacity}=require('./implementation.cjs');
test('lower bound',()=>{assert.equal(capacity(-10),1);assert.equal(capacity(0),1);assert.equal(capacity(0.9),1);});
test('upper bound',()=>{assert.equal(capacity(8),8);assert.equal(capacity(8.9),8);assert.equal(capacity(100),8);});
test('floor inside range',()=>{assert.equal(capacity(1),1);assert.equal(capacity(3.9),3);assert.equal(capacity(7.99),7);});
test('finite extremes',()=>{assert.equal(capacity(Number.MAX_VALUE),8);assert.equal(capacity(-Number.MAX_VALUE),1);});
` },
  { name: 'attention', specification: 'exports.attention(runs) takes an array of objects with unique string id and boolean needsAttention. Return a new array of IDs, attention-needed first, preserving input order within both groups. Do not mutate the input.',
    initial: 'exports.attention = runs => runs.map(run => run.id);\n', tests: `
const {attention}=require('./implementation.cjs');
test('empty',()=>assert.deepEqual(attention([]),[]));
test('stable groups',()=>assert.deepEqual(attention([{id:'a',needsAttention:false},{id:'b',needsAttention:true},{id:'c',needsAttention:false},{id:'d',needsAttention:true}]),['b','d','a','c']));
test('one group',()=>{for(const value of [true,false])assert.deepEqual(attention([{id:'z',needsAttention:value},{id:'a',needsAttention:value}]),['z','a']);});
test('no mutation',()=>{const input=Object.freeze([Object.freeze({id:'a',needsAttention:false}),Object.freeze({id:'b',needsAttention:true})]);assert.deepEqual(attention(input),['b','a']);assert.equal(input[0].id,'a');});
` },
  { name: 'slots', specification: 'exports.slots(limit, occupied) takes nonnegative integer inputs. Return max(0, limit minus occupied).',
    initial: 'exports.slots = (limit, occupied) => limit - occupied;\n', tests: `
const {slots}=require('./implementation.cjs');
test('empty',()=>{assert.equal(slots(0,0),0);assert.equal(slots(8,0),8);});
test('partial',()=>{assert.equal(slots(8,3),5);assert.equal(slots(2,1),1);});
test('full',()=>assert.equal(slots(2,2),0));
test('over capacity',()=>{assert.equal(slots(2,3),0);assert.equal(slots(0,8),0);});
` }
];
