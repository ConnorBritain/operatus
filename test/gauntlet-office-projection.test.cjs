'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { createGauntletRun } = load('src/main/gauntlet/core.ts');
const { projectOfficeRun, officeRuns, connectOfficeRuns } = load('src/renderer/src/gauntlet/officeProjection.ts');
const { nativeFloorLayer } = load('src/renderer/src/scene/office/nativeFloorLayer.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function snapshot(id = 'run-one', role = 'implementer') {
  const run = createGauntletRun({ id, repository: '/project/one', objective: 'A scoped objective', branch: `run/${id}`, baseSha: 'a'.repeat(40), now: 100 });
  run.status = 'implementer_in_flight';
  return { run, launches: [{ id: `launch-${id}`, runId: id, sessionId: `session-${id}`, role, provider: 'claude', status: 'running' }], runtimeObservations: [] };
}
function event(s, data, overrides = {}) {
  s.runtimeObservations.push({ runId: s.run.id, launchId: s.launches[0].id, sessionId: s.launches[0].sessionId,
    sequence: s.runtimeObservations.length + 1, at: 1000, event: data, ...overrides });
  s.run.runtimeRevision = s.runtimeObservations.length;
}
const started = { type: 'process_started', pid: 123, model: 'fixture' };
test('preparation and foreign identities cannot create a floor actor; exact starts can', () => {
  const s = snapshot(); assert.equal(projectOfficeRun(s).actors.length, 0);
  event(s, started, { sessionId: 'foreign' }); event(s, started, { runId: 'other' });
  assert.equal(projectOfficeRun(s).actors.length, 0);
  event(s, started); const actor = projectOfficeRun(s).actors[0];
  assert.equal(actor.id, s.launches[0].id); assert.equal(actor.label, 'Start recorded');
  assert.equal(actor.mode, 'observed');
  assert.equal('pid' in actor, false);
});
test('tool result is not a verdict; terminal transitions drain, unknown exits warn, confirmed exits remove', () => {
  const s = snapshot(); event(s, started);
  event(s, { type: 'tool_activity', activity: 'executing', ordinal: 1, stage: 'result', outcome: 'ok' });
  assert.equal(projectOfficeRun(s).actors[0].label, 'executing result');
  s.run.status = 'passed'; assert.equal(projectOfficeRun(s).actors[0].mode, 'draining');
  event(s, { type: 'recovery_interrupted' }); assert.equal(projectOfficeRun(s).actors[0].mode, 'unknown');
  event(s, { type: 'process_exited', processExited: false }); assert.equal(projectOfficeRun(s).actors[0].mode, 'unknown');
  s.runtimeObservations.pop(); event(s, { type: 'process_exited', processExited: true });
  assert.equal(projectOfficeRun(s).actors.length, 0);
});
test('lead waits between turns, and multiple projects remain separate despite identical paths or roles', () => {
  const a = snapshot('a', 'conductor'), b = snapshot('b', 'conductor');
  event(a, started); event(b, started);
  assert.equal(projectOfficeRun(a).actors[0].mode, 'waiting');
  event(a, { type: 'delivery_queued', messageId: 'turn-a' });
  assert.equal(projectOfficeRun(a).actors[0].mode, 'observed');
  event(a, { type: 'delivery_completed', messageId: 'wrong', ok: true });
  assert.equal(projectOfficeRun(a).actors[0].mode, 'observed');
  event(a, { type: 'delivery_completed', messageId: 'turn-a', ok: true });
  assert.equal(projectOfficeRun(a).actors[0].mode, 'waiting');
  assert.equal(officeRuns(new Map([['a', a], ['b', b]])).flatMap(row => row.actors).length, 2);
});
test('reviewed unknown exits cannot keep a closed run occupying the office view forever', () => {
  const s = snapshot(); event(s, started); event(s, { type: 'recovery_interrupted' });
  s.run.status = 'human_required';
  assert.equal(officeRuns(new Map([[s.run.id, s]])).length, 1);
  s.run.operatorReview = { reviewed: true, note: 'Reviewed unknown exit', at: 2000 };
  assert.equal(officeRuns(new Map([[s.run.id, s]])).length, 0);
});
test('read feed rejects late reads and stale pushes after a closed snapshot is discarded', async () => {
  const s = snapshot(); event(s, started);
  let callback, resolveGet, last, disposed = false;
  const stop = connectOfficeRuns({ gauntletList: async () => [s.run], gauntletGet: () => new Promise(r => { resolveGet = r; }),
    onGauntletChanged(fn) { callback = fn; return () => { disposed = true; }; } }, state => { last = state; });
  await tick();
  const closed = structuredClone(s); closed.run.version = 1; closed.run.status = 'passed';
  closed.run.currentArtifactSha='b'.repeat(40);closed.run.candidateHandoff={artifactSha:'b'.repeat(40),reviewed:true,note:'Handed off',at:2000};
  event(closed, { type: 'process_exited', processExited: true }); callback(closed);
  resolveGet(s); await tick(); assert.equal(last.rows.length, 0);
  callback(s); assert.equal(last.rows.length, 0);
  stop(); callback(s); assert.equal(disposed, true); assert.equal(last.rows.length, 0);
});
test('partial read failures retain pushed activity and expose incomplete loading', async () => {
  const s = snapshot(); event(s, started); let callback, last;
  const stop = connectOfficeRuns({ gauntletList: async () => [s.run], gauntletGet: async () => { throw Error('offline'); },
    onGauntletChanged(fn) { callback = fn; return () => {}; } }, state => { last = state; });
  await tick(); assert.equal(last.loading, false); assert.match(last.error, /could not be loaded/);
  callback(s); assert.equal(last.rows.length, 1); assert.ok(last.error); stop();
});

test('Office rejects stale priority even when a late snapshot has a newer protocol version', async () => {
  const s=snapshot('priority-run'),peer=snapshot('peer-run');
  let callback,last;
  const stop=connectOfficeRuns({gauntletList:async()=>[s.run,peer.run],gauntletGet:async id=>id===s.run.id?s:peer,
    onGauntletChanged(fn){callback=fn;return()=>{};}},state=>{last=state;});
  await tick();
  const current=structuredClone(s);
  current.run.operatorPriority={revision:2,level:'high',note:'New focus',at:1001};callback(current);
  assert.equal(last.rows[0].run.id,s.run.id);
  const stale=structuredClone(current);stale.run.version++;
  stale.run.operatorPriority={revision:1,level:'low',note:'Old focus',at:1000};callback(stale);
  assert.equal(last.rows[0].run.operatorPriority.revision,2);
  assert.equal(last.rows[0].run.version,current.run.version,'reject the whole inconsistent snapshot');
  const latest=structuredClone(current);latest.run.version++;callback(latest);
  assert.equal(last.rows[0].run.version,latest.run.version);
  stop();
});

test('Office preparation warning cannot disappear under a stale independent revision', async () => {
  const s=snapshot();let callback,last;
  const stop=connectOfficeRuns({gauntletList:async()=>[s.run],gauntletGet:async()=>s,
    onGauntletChanged(fn){callback=fn;return()=>{};}},state=>{last=state;});
  await tick();
  const pending=structuredClone(s);pending.run.preparationRevision=8;pending.run.preparationPending=1;callback(pending);
  const stale=structuredClone(s);stale.run.version=2;stale.run.runtimeRevision=5;stale.run.preparationRevision=7;callback(stale);
  assert.equal(last.rows[0].run.preparationPending,1);
  assert.equal(last.rows[0].run.preparationRevision,8);
  stop();
});

test('discarded closed Office snapshots retain all independent revision watermarks', async () => {
  const s=snapshot();let callback,last;
  const stop=connectOfficeRuns({gauntletList:async()=>[s.run],gauntletGet:async()=>s,
    onGauntletChanged(fn){callback=fn;return()=>{};}},state=>{last=state;});
  await tick();
  const closed=structuredClone(s);closed.run.status='cancelled';closed.run.version=2;
  closed.run.preparationRevision=8;closed.run.preparationPending=0;
  closed.run.operatorPriority={revision:2,level:'high',note:'Recorded',at:1001};callback(closed);
  assert.equal(last.rows.length,0);
  for(const patch of [{preparationRevision:7,preparationPending:1},{operatorPriority:{revision:1,level:'low',note:'Stale',at:1000}}]) {
    const late=structuredClone(closed);late.run={...late.run,status:'orienting',version:3,...patch};callback(late);
    assert.equal(last.rows.length,0,'old journal counters cannot revive discarded evidence');
  }
  stop();
});
function character() {
  return { destroyed: 0, poses: [], labels: [], glyphs: [], sitAtDesk(v) { this.poses.push(v); },
    showThought(v) { this.labels.push(v); }, setStatusGlyph(v) { this.glyphs.push(v); },
    setBubbleZoom() {}, update() {}, destroy() { this.destroyed++; }, getThoughtLayout() { return null; }, setThoughtLift() {} };
}
test('native seat leases survive late loads and cannot remove a replacement actor or ordinary seat', async () => {
  const claimed = new Set([0, 1]), pending = [], released = []; let count;
  const layer = nativeFloorLayer({ claimSeat() { if (claimed.has(2)) return null; claimed.add(2); return 2; },
    releaseSeat(seat) { released.push(seat); claimed.delete(seat); },
    create: () => new Promise(resolve => pending.push(resolve)), count: c => { count = c; } });
  const s = snapshot(); event(s, started); const actor = projectOfficeRun(s).actors[0];
  layer.sync([actor, { ...actor, id: 'overflow' }]); assert.equal(count.unseated, 1);
  layer.sync([]); layer.sync([actor]);
  const old = character(), current = character(); pending[0](old); await tick();
  assert.equal(old.destroyed, 1); assert.ok(claimed.has(2));
  pending[1](current); await tick(); assert.equal(count.seated, 1);
  layer.sync([{ ...actor, label: 'editing requested' }]);
  assert.deepEqual(current.poses, [false]); assert.match(current.labels.at(-1), /editing requested/);
  layer.dispose(); assert.equal(current.destroyed, 1); assert.deepEqual([...claimed], [0, 1]); assert.deepEqual(released, [2, 2]);
});
test('disposed pending textures are destroyed; creation failure releases capacity and is counted off-floor', async () => {
  let release = 0, resolveCreate, count;
  const s = snapshot(); event(s, started); const actors = projectOfficeRun(s).actors;
  const layer = nativeFloorLayer({ claimSeat: () => 2, releaseSeat: () => release++,
    create: () => new Promise(r => { resolveCreate = r; }), count: c => { count = c; } });
  layer.sync(actors); layer.dispose(); const c = character(); resolveCreate(c); await tick();
  assert.equal(release, 1); assert.equal(c.destroyed, 1);
  const failed = nativeFloorLayer({ claimSeat: () => 2, releaseSeat: () => release++,
    create: async () => { throw Error('texture failed'); }, count: c => { count = c; } });
  failed.sync(actors); await tick(); assert.equal(count.unseated, 1); assert.equal(count.pending, 0); failed.dispose();
  assert.equal(release, 2);
});
test('an initial paint failure destroys the partially attached character and releases its seat', async () => {
  const s = snapshot(); event(s, started); const c = character(); let released = 0, count;
  c.showThought = () => { throw Error('paint failure'); };
  const layer = nativeFloorLayer({ claimSeat: () => 2, releaseSeat: () => released++, create: async () => c, count: v => { count = v; } });
  layer.sync(projectOfficeRun(s).actors); await tick();
  assert.equal(c.destroyed, 1); assert.equal(released, 1); assert.equal(count.unseated, 1); layer.dispose();
});
