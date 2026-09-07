'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), { join } = require('node:path'), { tmpdir } = require('node:os');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const { GauntletStore } = load('src/main/gauntlet/store.ts');
const { createGauntletRun } = load('src/main/gauntlet/core.ts');
function fixture(t) {
  const path = join(fs.mkdtempSync(join(tmpdir(), 'op-schedule-')), 'gauntlet.db');
  const store = new GauntletStore(path); store.open(); t.after(() => store.close());
  const add = () => { const r = createGauntletRun({repository:'/fixture',objective:'Queue evidence',branch:'fixture',baseSha:'a'.repeat(40)}); store.createRun(r); return r.id; };
  const cancel = id => store.transition(id,store.snapshot(id).run.version,{type:'CANCELLED',at:Date.now(),reason:'Fixture cancellation'});
  return {store,q:store.scheduler,path,add,cancel};
}
test('FIFO capacity is persisted, idempotent and never silently preempts reservations when reduced', t => {
  const f=fixture(t), ids=[f.add(),f.add(),f.add()]; ids.forEach(id=>f.q.enqueue(id)); f.q.enqueue(ids[0]);
  assert.equal(f.q.snapshot().dispatches.length,3);
  assert.equal(f.q.claimNext('owner'),ids[0]); assert.equal(f.q.claimNext('owner'),ids[1]); assert.equal(f.q.claimNext('owner'),null);
  const revision=f.q.snapshot().revision; f.q.configure(revision,1);
  assert.throws(()=>f.q.configure(revision,8),/changed/);
  assert.equal(f.q.claimNext('owner'),null);
  f.cancel(ids[0]); assert.throws(()=>f.q.finishOwned(ids[0],'wrong',false),/Stale/); f.q.finishOwned(ids[0],'owner',false);
  assert.equal(f.q.claimNext('owner'),null);
  f.cancel(ids[1]); f.q.finishOwned(ids[1],'owner',false); assert.equal(f.q.claimNext('owner'),ids[2]);
  f.store.close(); f.store.open(); assert.equal(f.q.snapshot().maxConcurrentRuns,1);
});
test('queued cancellation never claims a session and duplicate enqueue never revives terminal work', t => {
  const f=fixture(t), id=f.add(); f.q.enqueue(id); f.cancel(id); f.q.settleCancelled();
  f.q.enqueue(id); assert.equal(f.q.claimNext('owner'),null); assert.equal(f.q.snapshot().dispatches.length,0);
  f.store.close(); f.store.open(); assert.equal(f.q.snapshot().dispatches.length,0);
});
test('restart keeps interrupted ownership quarantined and queued work durable', t => {
  const f=fixture(t), ids=[f.add(),f.add(),f.add()]; ids.forEach(id=>f.q.enqueue(id));
  f.q.claimNext('old'); f.q.claimNext('old'); f.store.close(); f.store.open(); f.q.recover();
  assert.deepEqual(f.q.snapshot().dispatches.map(d=>d.state),['quarantined','quarantined','queued']);
  assert.equal(f.q.claimNext('new'),null); assert.throws(()=>f.q.finishOwned(ids[0],'old',false),/Stale/);
  assert.throws(()=>f.q.releaseQuarantine(ids[0],f.q.snapshot().revision,'Inspected'),/End or escalate/);
  f.cancel(ids[0]); assert.throws(()=>f.q.releaseQuarantine(ids[0],f.q.snapshot().revision,''),/reason/);
  const before=f.store.snapshot(ids[0]); f.q.releaseQuarantine(ids[0],f.q.snapshot().revision,'Inspected previous process and gateway; accepting scheduling risk');
  assert.deepEqual(f.store.snapshot(ids[0]),before,'Scheduling release is not process or protocol evidence');
  assert.equal(f.q.claimNext('new'),ids[2]);
});
test('uncertain drain retains capacity even for a terminal run; settings reject invalid input', t=>{
  const f=fixture(t), id=f.add(); f.q.configure(0,1); f.q.enqueue(id); f.q.claimNext('owner'); f.cancel(id); f.q.finishOwned(id,'owner',true);
  const other=f.add(); f.q.enqueue(other); assert.equal(f.q.claimNext('owner'),null);
  for(const n of [0,9,NaN,1.5,'2']) assert.throws(()=>f.q.configure(f.q.snapshot().revision,n),/integer/);
  const db=new Database(f.path); t.after(()=>db.close());
  assert.throws(()=>db.prepare('DELETE FROM gauntlet_schedule_events').run(),/append-only/);
  assert.throws(()=>db.prepare("UPDATE gauntlet_schedule_events SET reason='rewritten'").run(),/append-only/);
  assert.equal(JSON.stringify(f.q.snapshot()).includes('owner'),false,'No scheduler owner secret is returned');
});

test('version-four upgrade quarantines a lost launch but not one with durable exit and revocation evidence', t=>{
  const f=fixture(t), lost=f.add(), finished=f.add();
  for(const id of [lost,finished]) {
    const launch={id:randomUUID(),runId:id,role:'conductor',provider:'claude',sessionId:randomUUID(),worktreePath:'/fixture',
      expectedSha:'a'.repeat(40),tokenHash:'a'.repeat(64),status:'created',createdAt:Date.now(),
      capability:{filesystem:'advisory',cleanContext:'advisory',toolRestrictions:'advisory',notes:[]}};
    f.store.transition(id,0,{type:'CONDUCTOR_PREPARED',at:Date.now(),launchId:launch.id},{launch});
    if(id===finished) f.store.recordRuntimeObservation({runId:id,launchId:launch.id,sessionId:launch.sessionId,at:Date.now(),
      event:{type:'process_exited',reason:'finished',exitCode:0,processExited:true,gatewayRevocation:'confirmed',descendantsQuiescent:false}});
    f.cancel(id);
  }
  f.store.close(); const db=new Database(f.path);
  db.exec('DROP TABLE gauntlet_schedule_events; DROP TABLE gauntlet_dispatches; DROP TABLE gauntlet_capacity'); db.pragma('user_version=4'); db.close();
  f.store.open(); assert.deepEqual(f.q.snapshot().dispatches.map(d=>[d.runId,d.state]),[[lost,'quarantined']]);
  const before=f.q.snapshot(); f.store.close(); f.store.open(); assert.deepEqual(f.q.snapshot(),before);
});

test('desktop capacity commands reject foreign senders and malformed requests before invoking the runner',()=>{
  const {desktopCapacity}=load('src/main/gauntlet/desktopCapacity.ts');
  const local={mainFrame:{}}, event={sender:local,senderFrame:local.mainFrame}, calls=[];
  const api=desktopCapacity({localWindow:()=>local,runner:()=>({capacity:()=>calls.push('get'),configureCapacity:(...v)=>calls.push(v),releaseCapacity:(...v)=>calls.push(v)})});
  for(const bad of [{sender:{},senderFrame:local.mainFrame},{sender:local,senderFrame:{}}]) {
    assert.throws(()=>api.get(bad),/local desktop/); assert.throws(()=>api.configure(bad,0,2),/local desktop/); assert.throws(()=>api.release(bad,'id',0,'reason'),/local desktop/);
  }
  assert.throws(()=>api.configure(event,'0',2),/Invalid/); assert.throws(()=>api.release(event,{},0,'reason'),/Invalid/); assert.equal(calls.length,0);
  api.get(event); api.configure(event,0,2); api.release(event,'id',1,'Inspected'); assert.deepEqual(calls,['get',[0,2],['id',1,'Inspected']]);
});
