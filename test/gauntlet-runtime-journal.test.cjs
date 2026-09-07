'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), { join } = require('node:path'), { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const { GauntletStore } = load('src/main/gauntlet/store.ts');
const { createGauntletRun } = load('src/main/gauntlet/core.ts');
const { runtimeView, protocolLaunchLabel } = load('src/renderer/src/gauntlet/runtimeView.ts');
test('registered Conductor authority is not labeled as a newly created or running process', () => {
  assert.equal(protocolLaunchLabel({role:'conductor',status:'created'}), 'Authority registered');
  assert.equal(protocolLaunchLabel({role:'implementer',status:'created'}), 'created');
  assert.equal(protocolLaunchLabel({role:'conductor',status:'cancelled'}), 'cancelled');
  assert.equal(runtimeView('no-observations').label, 'Not observed starting');
});
function fixture(t) {
  const store = new GauntletStore(join(fs.mkdtempSync(join(tmpdir(), 'op-runtime-journal-')), 'gauntlet.db')); store.open(); t.after(() => store.close());
  const run = createGauntletRun({ repository: '/fixture', objective: 'Runtime evidence', branch: 'fixture', baseSha: 'a'.repeat(40) }); store.createRun(run);
  const launch = { id: randomUUID(), runId: run.id, role: 'conductor', provider: 'claude', sessionId: randomUUID(), worktreePath: '/fixture',
    expectedSha: run.baseSha, tokenHash: 'a'.repeat(64), status: 'created', createdAt: Date.now(),
    capability: { filesystem: 'advisory', cleanContext: 'advisory', toolRestrictions: 'advisory', notes: [] } };
  store.transition(run.id, 0, { type: 'CONDUCTOR_PREPARED', at: Date.now(), launchId: launch.id }, { launch });
  const observation = event => ({ runId: run.id, launchId: launch.id, sessionId: launch.sessionId, at: Date.now(), event });
  const start = observation({ type: 'process_started', pid: 1234, model: 'claude-fable-5-1', profileSha256: 'a'.repeat(64), boundarySha256: 'b'.repeat(64) });
  return { store, run, launch, observation, start };
}
test('runtime evidence is immutable, idempotent, session-bound and survives reopening without changing the bar or phase', t => {
  const f = fixture(t), before = f.store.snapshot(f.run.id);
  f.store.recordRuntimeObservation(f.start); f.store.recordRuntimeObservation(f.start);
  assert.throws(() => f.store.recordRuntimeObservation({ ...f.start, at: f.start.at + 1 }), /immutable/);
  for (const changed of [{ runId: randomUUID() }, { sessionId: randomUUID() }, { launchId: randomUUID() }]) {
    assert.throws(() => f.store.recordRuntimeObservation({ ...f.start, ...changed }), /identity mismatch/);
  }
  f.store.close(); f.store.open(); const after = f.store.snapshot(f.run.id);
  const {runtimeRevision,...protocolAfter} = after.run;
  assert.deepEqual(protocolAfter, before.run); assert.equal(runtimeRevision, 1); assert.deepEqual(after.events, before.events);
  assert.equal(after.runtimeObservations.length, 1);
  assert.match(runtimeView(f.launch.id, after.runtimeObservations).label, /exit not yet observed/);
});
test('journal rejects secrets, raw output, invented successful quiescence and invalid observations', t => {
  const f = fixture(t);
  for (const event of [ { ...f.start.event, stdout: 'secret' }, { ...f.start.event, pid: 0 }, { ...f.start.event, model: 'anything' },
    { type: 'process_exited', reason: 'result', exitCode: 0, processExited: true, gatewayRevocation: 'confirmed', descendantsQuiescent: true },
    { type: 'process_exited', reason: 'secret-from-provider', exitCode: 0, processExited: true, gatewayRevocation: 'confirmed', descendantsQuiescent: false },
    { type: 'recovery_interrupted' }, { type: 'unknown' } ]) assert.throws(() => f.store.recordRuntimeObservation(f.observation(event)));
  assert.equal(f.store.snapshot(f.run.id).runtimeObservations.length, 0);
});
test('delivery results require the exact queued message; completion is not acknowledgment authority', t => {
  const f = fixture(t), messageId = randomUUID();
  const queued = f.observation({ type: 'delivery_queued', messageId, purpose: 'orientation', promptSha256: 'c'.repeat(64), reportId: null });
  const completed = f.observation({ type: 'delivery_completed', messageId, ok: true, resultSha256: 'd'.repeat(64) });
  assert.throws(() => f.store.recordRuntimeObservation(completed), /matching queued/);
  f.store.recordRuntimeObservation(queued);
  assert.equal(runtimeView(f.launch.id, f.store.snapshot(f.run.id).runtimeObservations).deliveries[0].status, 'No result observed');
  f.store.recordRuntimeObservation(completed);
  assert.equal(f.store.snapshot(f.run.id).run.status, 'orienting');
  assert.equal(f.store.snapshot(f.run.id).acknowledgments.length, 0);
  assert.equal(runtimeView(f.launch.id, f.store.snapshot(f.run.id).runtimeObservations).deliveries[0].status, 'Turn completed');
});
test('recovery marks missing exit observations as unknown, never as a dead process', t => {
  const f = fixture(t); f.store.recordRuntimeObservation(f.start);
  assert.equal(f.store.unclosedProcessObservations().length, 1);
  f.store.recordRuntimeObservation(f.observation({ type: 'recovery_interrupted' }));
  assert.equal(f.store.unclosedProcessObservations().length, 0);
  const view = runtimeView(f.launch.id, f.store.snapshot(f.run.id).runtimeObservations);
  assert.equal(view.label, 'Exit unknown after restart'); assert.equal(view.warning, true); assert.match(view.detail, /must not be used/);
});
test('post-terminal exit diagnostics survive without changing the protocol verdict', t => {
  const f = fixture(t); f.store.recordRuntimeObservation(f.start);
  f.store.transition(f.run.id, 1, { type: 'CANCELLED', at: Date.now(), reason: 'Human action' });
  f.store.recordRuntimeObservation(f.observation({ type: 'process_exited', reason: 'gateway_revocation_failed', exitCode: 0,
    processExited: true, gatewayRevocation: 'unconfirmed', descendantsQuiescent: false }));
  const snapshot = f.store.snapshot(f.run.id), view = runtimeView(f.launch.id, snapshot.runtimeObservations);
  assert.equal(snapshot.run.status, 'cancelled'); assert.equal(snapshot.run.version, 2);
  assert.equal(view.label, 'Exited · code 0'); assert.equal(view.warning, true); assert.match(view.detail, /revocation unconfirmed/);
  assert.throws(() => f.store.recordRuntimeObservation(f.observation({ type: 'recovery_interrupted' })));
});

test('bounded tool activity persists as a view revision without becoming task evidence',t=>{
  const f=fixture(t),before=f.store.snapshot(f.run.id);
  const event={type:'tool_activity',ordinal:1,activity:'reading',stage:'requested'};
  const observation=f.observation(event);f.store.recordRuntimeObservation(observation);f.store.recordRuntimeObservation(observation);
  for(const override of [{command:'secret'},{activity:'secret'},{ordinal:0},{ordinal:2049},{stage:'result',outcome:undefined}]) {
    assert.throws(()=>f.store.recordRuntimeObservation(f.observation({...event,...override})));
  }
  const after=f.store.snapshot(f.run.id); assert.equal(after.runtimeObservations.length,1);
  assert.equal(after.run.version,before.run.version);assert.deepEqual(after.events,before.events);assert.deepEqual(after.artifacts,before.artifacts);
  assert.equal(after.run.runtimeAttention,undefined);
  assert.equal(runtimeView(f.launch.id,after.runtimeObservations).activities[0].activity,'reading');
});

test('exit counters survive reopen with no raw output, no protocol change and no inferred zero for old records',t=>{
  const f=fixture(t),before=f.store.snapshot(f.run.id);
  const output={receivedBytes:90000,stdoutBytes:80000,stderrBytes:10000,stdoutPreviewTruncated:true,stderrPreviewTruncated:false};
  const exit=f.observation({type:'process_exited',reason:'result',exitCode:0,processExited:true,gatewayRevocation:'confirmed',descendantsQuiescent:false,output});
  f.store.recordRuntimeObservation(exit);f.store.recordRuntimeObservation(exit);
  f.store.close();f.store.open();const snapshot=f.store.snapshot(f.run.id),view=runtimeView(f.launch.id,snapshot.runtimeObservations);
  assert.deepEqual(view.output,output);assert.equal(view.warning,false);assert.equal(view.guidance,null);
  assert.equal(snapshot.run.version,before.run.version);assert.deepEqual(snapshot.events,before.events);assert.deepEqual(snapshot.artifacts,before.artifacts);
  assert.equal(snapshot.runtimeObservations.length,1);
  assert.throws(()=>f.store.recordRuntimeObservation({...exit,event:{...exit.event,output:{...output,receivedBytes:90001,stderrBytes:10001}}}),/immutable/);
  assert.equal(runtimeView(f.launch.id).output,null);
  const {output:ignored,...oldEvent}=exit.event;
  assert.equal(runtimeView(f.launch.id,[{...exit,event:oldEvent,sequence:1}]).output,null);
});

test('invalid counters and nested secret-bearing fields are rejected atomically',t=>{
  const f=fixture(t),output={receivedBytes:3,stdoutBytes:2,stderrBytes:1,stdoutPreviewTruncated:false,stderrPreviewTruncated:false};
  for(const invalid of [null,[],{}, {...output,stderr:'secret'}, {...output,token:'secret'},
    {...output,receivedBytes:4},{...output,stdoutBytes:-1},{...output,stdoutBytes:0.5},
    {...output,receivedBytes:Number.MAX_SAFE_INTEGER+1},{...output,stdoutPreviewTruncated:'yes'},
    {...output,stderrPreviewTruncated:undefined}]) {
    assert.throws(()=>f.store.recordRuntimeObservation(f.observation({type:'process_exited',reason:'output_limit',exitCode:null,
      processExited:true,gatewayRevocation:'confirmed',descendantsQuiescent:false,output:invalid})),/invalid native output/);
  }
  assert.equal(f.store.snapshot(f.run.id).runtimeObservations.length,0);
});

test('failure guidance prioritizes unconfirmed shutdown and does not invent a provider-error cause',()=>{
  const event={type:'process_exited',reason:'provider_error',exitCode:1,processExited:true,gatewayRevocation:'confirmed',descendantsQuiescent:false};
  const view=changes=>runtimeView('launch',[{launchId:'launch',event:{...event,...changes},sequence:1,at:0}]);
  assert.match(view({}).guidance,/does not establish whether authentication, allowance/);
  assert.match(view({reason:'output_limit'}).guidance,/output counters/);
  assert.match(view({reason:'timeout'}).guidance,/current artifact/);
  assert.match(view({reason:'spawn_error'}).guidance,/pinned executable/);
  assert.match(view({reason:'invalid_result'}).guidance,/not accepted/);
  assert.match(view({reason:'unexpected_exit'}).guidance,/preserved work/);
  assert.match(view({reason:'output_limit',gatewayRevocation:'unconfirmed'}).guidance,/unconfirmed shutdown/);
});
