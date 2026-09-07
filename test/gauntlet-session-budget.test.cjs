'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const {nativeSessionBudget}=load('src/main/gauntlet/sessionBudget.ts');
const run={id:'run',createdAt:1000,limits:{runTimeoutMs:100000,workerTimeoutMs:30000,criticTimeoutMs:20000}};
const launch=role=>({runId:'run',role,createdAt:2000});
test('roles consume admission time and stay within the absolute run deadline',()=>{
  assert.deepEqual(nativeSessionBudget(run,launch('conductor'),5000),{timeoutMs:96000,turnTimeoutMs:30000});
  for(const role of ['implementer','repairer']) assert.deepEqual(nativeSessionBudget(run,launch(role),5000),{timeoutMs:27000,turnTimeoutMs:27000});
  assert.deepEqual(nativeSessionBudget(run,launch('critic'),5000),{timeoutMs:17000,turnTimeoutMs:17000});
  assert.deepEqual(nativeSessionBudget(run,{...launch('critic'),createdAt:99000},100000),{timeoutMs:1000,turnTimeoutMs:1000});
});
test('exhausted and invalid budgets never round up or fall back to pilot defaults',()=>{
  for(const now of [32000,32001]) assert.throws(()=>nativeSessionBudget(run,launch('implementer'),now),/exhausted/);
  assert.throws(()=>nativeSessionBudget(run,launch('conductor'),101000),/exhausted/);
  assert.throws(()=>nativeSessionBudget(run,{...launch('critic'),runId:'peer'},5000),/identity/);
  for(const now of [0,NaN,Infinity,1.5]) assert.throws(()=>nativeSessionBudget(run,launch('critic'),now));
  assert.throws(()=>nativeSessionBudget({...run,limits:{...run.limits,criticTimeoutMs:5}},launch('critic'),2000),/exhausted/);
});
test('supported long configurations are not silently reduced to the old twenty/thirty minute pilot caps',()=>{
  const large={...run,limits:{runTimeoutMs:7*86400000,workerTimeoutMs:86400000,criticTimeoutMs:4*3600000}};
  assert.equal(nativeSessionBudget(large,launch('conductor'),2000).timeoutMs,7*86400000-1000);
  assert.equal(nativeSessionBudget(large,launch('implementer'),2000).timeoutMs,86400000);
  assert.equal(nativeSessionBudget(large,launch('critic'),2000).timeoutMs,4*3600000);
  assert.throws(()=>nativeSessionBudget({...large,limits:{...large.limits,runTimeoutMs:8*86400000}},launch('conductor'),2000),/supported/);
});
