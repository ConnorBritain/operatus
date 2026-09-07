'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), { join } = require('node:path'), { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const { IsolatedGauntletRunner } = load('src/main/gauntlet/isolatedRunner.ts');
const { createIsolatedClaudeFactory } = load('src/main/gauntlet/isolatedClaudeFactory.ts');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const git = (cwd, ...args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const providers = Object.fromEntries(['conductor', 'implementer', 'critic', 'repairer'].map(role => [role, { provider: 'claude' }]));

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-isolated-runner-')), repository = join(root, 'repo'); fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'value.txt'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
  const backend = new LocalGauntletBackend({ stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') }); backend.open();
  let runner, held = options.held ?? null;
  const calls = [], handles = new Map(), observed = [];
  const publish = snapshot => { observed.push(snapshot); runner?.observe(snapshot); };
  const sessions = {
    async conductor(prepared, signal, beforeSpawn, budget) {
      await options.beforeLead?.(prepared); beforeSpawn(); signal.throwIfAborted();
      const limits = budget(); options.onBudget?.(prepared.launch, limits);
      calls.push(prepared.launch); const end = deferred(); let turns = 0;
      const exit = reason => ({ reason, exitCode: reason === 'finished' ? 0 : null, processExited: true, gatewayRevocation: 'confirmed' });
      const handle = { pid: 1234, receipt: { model: prepared.launch.model ?? 'claude-fable-5-1', profileSha256: 'a'.repeat(64), boundarySha256: 'b'.repeat(64) },
        completion: end.promise, stop: () => end.resolve(exit('cancelled')), finish: () => end.resolve(exit('finished')),
        send: async (messageId, text) => {
          turns++; assert.ok(text.includes(prepared.launch.id));
          if (!options.noDecision) {
            const snapshot = backend.status(prepared.launch.runId);
            const decided = backend.withConductorAuthority(snapshot.run.id, prepared.launch.id, prepared.token, () => {
              if (turns === 1) return backend.freeze(snapshot.run.id, { objective: snapshot.run.requestedObjective,
                criteria: ['value.txt is repaired'], checks: [], constraints: [], exclusions: [] }, prepared.launch.id);
              const report = snapshot.reports.at(-1), repair = report.verdict === 'REVISE';
              return backend.acknowledge({ runId: snapshot.run.id, reportId: report.id, conductorLaunchId: prepared.launch.id,
                decision: repair ? 'repair' : 'pass', acceptedFindingIds: repair ? ['wrong'] : [], rejectedFindings: [],
                rationale: 'Scripted decision, not model judgment', repairInstructions: repair ? ['Set value.txt to repaired'] : undefined });
            }); publish(decided);
          }
          return { messageId, sessionId: prepared.launch.sessionId, ok: true, text: 'Scripted fixture' };
        } };
      handles.set(prepared.launch.id, handle); return handle;
    },
    async worker(prepared, signal, beforeSpawn, budget) {
      await options.beforeWorker?.(prepared); beforeSpawn(); signal.throwIfAborted();
      const limits = budget(); options.onBudget?.(prepared.launch, limits);
      calls.push(prepared.launch); const end = deferred(); let stopped = false;
      const result = status => ({ status, reason: status === 'completed' ? 'result' : status === 'cancelled' ? 'cancelled' : 'provider_error',
        exitCode: status === 'completed' ? 0 : null, sessionId: prepared.launch.sessionId, processExited: true, gatewayRevocation: options.workerRevocation ?? 'confirmed' });
      const handle = { receipt: { pid: 5678, model: 'claude-fable-5-1', profileSha256: 'a'.repeat(64), boundarySha256: 'b'.repeat(64) },
        completion: end.promise, stop: () => { stopped = true; end.resolve(result('cancelled')); } };
      handles.set(prepared.launch.id, handle);
      void (async () => {
        await options.workerGate?.promise;
        if (stopped) return;
        if (!options.noReceipt) {
          const launch = prepared.launch, snapshot = backend.status(launch.runId); let next;
          if (launch.role === 'critic') {
            const revise = options.alwaysRevise || snapshot.run.repairRound === 0;
            next = backend.submitCritic({ runId: launch.runId, launchId: launch.id, token: prepared.token,
              artifactSha: launch.expectedSha, contractDigest: snapshot.run.contract.digest, verdict: revise ? 'REVISE' : 'PASS',
              summary: 'Scripted fixture review', findings: revise ? [{ id: 'wrong', severity: 'major', title: 'Wrong value', evidence: 'Fixture comparison', criterionIds: ['value'] }] : [] });
          } else {
            fs.writeFileSync(join(launch.worktreePath, 'value.txt'), launch.role === 'repairer' ? `repaired ${snapshot.run.repairRound}` : 'changed');
            git(launch.worktreePath, 'add', '.'); git(launch.worktreePath, 'commit', '-m', 'Scripted fixture artifact');
            next = await backend.completeArtifact({ runId: launch.runId, launchId: launch.id, token: prepared.token, sha: git(launch.worktreePath, 'rev-parse', 'HEAD') });
          }
          publish(next);
        }
        end.resolve(result('completed'));
      })().catch(error => { end.resolve(result('failed')); });
      return handle;
    }
  };
  runner = new IsolatedGauntletRunner(backend, sessions, () => held, publish);
  t.after(async () => { await runner.close(); backend.close(); });
  const start = overrides => backend.start({ repository, objective: 'Repair the value', providers, ...overrides }).run;
  return { root, backend, runner, sessions, calls, handles, observed, start, publish, setHold: value => { held = value; } };
}

test('Codex Conductor capability conducts the same bounded repair protocol without provider substitution', async t => {
  const f=fixture(t);f.sessions.supportsCodexConductor=true;
  const run=f.start({providers:{...providers,conductor:{provider:'codex',model:'gpt-6-astra'}}});
  await f.runner.advance(run.id);
  const snapshot=f.backend.status(run.id);
  assert.equal(snapshot.run.status,'passed');assert.equal(snapshot.acknowledgments.length,2);
  assert.equal(f.calls[0].provider,'codex');assert.equal(f.calls[0].model,'gpt-6-astra');
  assert.equal(f.calls.filter(l=>l.role==='conductor').length,1);
  assert.equal(f.runner.capacity().dispatches.length,0);
});

test('third run waits without native preparation, then receives its own full repair loop',async t=>{
  const gate=deferred(), peer=fixture(t), f=fixture(t,{workerGate:gate});
  const ids=[f.start().id,f.start({repository:join(peer.root,'repo'),objective:'Separate project fixture'}).id,f.start().id];
  const work=ids.map(id=>f.runner.advance(id)); assert.equal(f.runner.advance(ids[2]),work[2]);
  while(f.calls.length<4) await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(f.runner.capacity().dispatches.map(d=>d.state),['running','running','queued']);
  assert.equal(f.backend.status(ids[2]).launches.length,0,'No Conductor, worker or worktree prepared while waiting');
  gate.resolve(); await Promise.all(work);
  for(const id of ids) { assert.equal(f.backend.status(id).run.status,'passed'); assert.equal(f.calls.filter(l=>l.runId===id).length,5); }
  assert.notEqual(f.backend.status(ids[0]).run.repository,f.backend.status(ids[1]).run.repository);
  assert.equal(f.runner.capacity().dispatches.length,0);
});

test('queued cancel resolves its waiter without affecting occupied runs',async t=>{
  const gate=deferred(), f=fixture(t,{workerGate:gate}); f.runner.configureCapacity(0,1);
  const a=f.start(), b=f.start(); const first=f.runner.advance(a.id), queued=f.runner.advance(b.id);
  f.publish(f.backend.cancel(b.id,'Cancel waiting work')); await queued;
  assert.equal(f.backend.status(b.id).launches.length,0); assert.equal(f.runner.owns(b.id),false);
  gate.resolve(); await first; assert.equal(f.backend.status(a.id).run.status,'passed');
});

test('shutdown leaves unprepared queue durable; a new owner starts it with a new native identity',async t=>{
  const gate=deferred(), f=fixture(t,{workerGate:gate}); f.runner.configureCapacity(0,1);
  const a=f.start(), b=f.start(); const first=f.runner.advance(a.id), queued=f.runner.advance(b.id);
  while(f.calls.length<2) await new Promise(r=>setTimeout(r,5));
  await f.runner.close(); await Promise.all([first,queued]);
  assert.equal(f.backend.status(b.id).run.status,'orienting'); assert.equal(f.backend.status(b.id).launches.length,0);
  assert.equal(f.runner.capacity().dispatches.find(d=>d.runId===b.id).state,'queued');
  gate.resolve(); const next=new IsolatedGauntletRunner(f.backend,f.sessions,()=>null,()=>{});
  t.after(()=>next.close()); await next.advance(b.id);
  assert.equal(f.backend.status(b.id).run.status,'passed');
  assert.equal(new Set(f.calls.map(l=>l.sessionId)).size,f.calls.length);
});

test('unconfirmed revocation blocks capacity reuse; human release does not erase the warning',async t=>{
  const f=fixture(t,{workerRevocation:'unconfirmed'}); f.runner.configureCapacity(0,1);
  const a=f.start(), b=f.start(); await f.runner.advance(a.id); const queued=f.runner.advance(b.id);
  assert.equal(f.runner.capacity().dispatches.find(d=>d.runId===a.id).state,'quarantined');
  assert.equal(f.backend.status(b.id).launches.length,0);
  const before=f.backend.status(a.id); f.runner.releaseCapacity(a.id,f.runner.capacity().revision,'Inspected fixture gateway and process exit');
  assert.ok(before.runtimeObservations.some(o=>o.event.type==='process_exited'&&o.event.gatewayRevocation==='unconfirmed'));
  await queued; assert.deepEqual(f.backend.status(a.id),before); assert.ok(f.backend.status(b.id).launches.length>0);
});

test('missing completion receipt plus unknown shutdown cannot trigger a fresh overlapping retry',async t=>{
  const f=fixture(t,{workerRevocation:'unconfirmed',noReceipt:true}), run=f.start(); await f.runner.advance(run.id);
  assert.equal(f.backend.status(run.id).run.status,'infrastructure_failure');
  assert.equal(f.calls.filter(l=>l.role==='implementer').length,1);
  assert.equal(f.runner.capacity().dispatches[0].state,'quarantined');
});

test('a lost Conductor exit journal write quarantines the reservation instead of inventing durable shutdown',async t=>{
  const f=fixture(t,{noDecision:true}), run=f.start(), record=f.backend.store.recordRuntimeObservation.bind(f.backend.store);
  f.backend.store.recordRuntimeObservation=input=>{ if(input.event.type==='process_exited') throw Error('Fixture journal failure'); return record(input); };
  await f.runner.advance(run.id);
  assert.equal(f.backend.status(run.id).run.status,'human_required');
  assert.equal(f.backend.status(run.id).runtimeObservations.some(o=>o.event.type==='process_exited'),false);
  assert.equal(f.runner.capacity().dispatches[0].state,'quarantined');
});

test('pending artifact operations keep a cancelled reservation occupied and block human release',async t=>{
  const gate=deferred(), f=fixture(t,{workerGate:gate}), run=f.start(), done=f.runner.advance(run.id);
  while(f.calls.length<2) await new Promise(r=>setTimeout(r,5));
  const original=f.backend.isCompleting.bind(f.backend); let draining=true;
  f.backend.isCompleting=id=>id===run.id?draining:original(id);
  f.publish(f.backend.cancel(run.id,'Fixture cancellation during artifact drain')); await done; gate.resolve();
  assert.equal(f.runner.capacity().dispatches[0].state,'quarantined');
  assert.throws(()=>f.runner.releaseCapacity(run.id,f.runner.capacity().revision,'Inspected'),/still draining/);
  draining=false; f.runner.releaseCapacity(run.id,f.runner.capacity().revision,'Drain completed and inspected');
  assert.equal(f.runner.capacity().dispatches.length,0);
});

test('a held queue does not prepare profiles and waiting consumes the original run budget',async t=>{
  const gate=deferred(), f=fixture(t,{workerGate:gate}); f.runner.configureCapacity(0,1);
  const a=f.start(), b=f.start({limits:{runTimeoutMs:1}}); const first=f.runner.advance(a.id), waiting=f.runner.advance(b.id);
  while(f.calls.length<2) await new Promise(r=>setTimeout(r,5));
  f.setHold('Subscription hold'); gate.resolve(); await first;
  assert.equal(f.backend.status(b.id).launches.length,0);
  f.setHold(null); assert.equal(f.runner.advance(b.id),waiting); await waiting;
  assert.equal(f.backend.status(b.id).run.status,'infrastructure_failure'); assert.equal(f.backend.status(b.id).launches.length,0);
});

test('one lifecycle owner conducts two concurrent repair loops without crossing run identities', async t => {
  const f = fixture(t), a = f.start(), b = f.start();
  const first = f.runner.advance(a.id);
  assert.equal(f.runner.advance(a.id), first, 'duplicate callback shares existing owner');
  await Promise.all([first, f.runner.advance(b.id)]);
  for (const run of [a, b]) {
    const snapshot = f.backend.status(run.id);
    assert.equal(snapshot.run.status, 'passed', snapshot.run.stopReason);
    assert.equal(snapshot.artifacts.length, 2); assert.equal(snapshot.acknowledgments.length, 2);
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'process_started').length, 5);
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'process_exited').length, 5);
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'delivery_completed').length, 3);
    const launches = f.calls.filter(l => l.runId === run.id);
    assert.deepEqual(launches.map(l => l.role), ['conductor', 'implementer', 'critic', 'repairer', 'critic']);
    assert.equal(new Set(launches.map(l => l.sessionId)).size, 5);
    assert.ok(snapshot.acknowledgments.every(ack => ack.launchId === launches[0].id));
  }
  assert.equal(new Set(f.calls.map(l => l.sessionId)).size, 10);
});

test('startup hold creates no identities or sessions; factory hold runs before credentials or file preparation', async t => {
  const f = fixture(t, { held: 'Release gate' }), run = f.start(); await f.runner.advance(run.id);
  assert.equal(f.calls.length, 0); assert.equal(f.backend.status(run.id).launches.length, 0);
  const root = join(f.root, 'must-not-exist');
  const factory = createIsolatedClaudeFactory({ root, helperSource: '/missing', nodePath: '/missing', socketPath: () => '/missing',
    assertAdmissionOpen: () => { throw Error('Release gate'); } });
  await assert.rejects(factory.conductor({ launch: { role: 'conductor' } }, new AbortController().signal, () => {}), /Release gate/);
  assert.equal(fs.existsSync(root), false);
});

test('cancellation during asynchronous admission cannot spawn a late worker', async t => {
  const started = deferred(), release = deferred();
  const f = fixture(t, { beforeWorker: async () => { started.resolve(); await release.promise; } }), run = f.start();
  const done = f.runner.advance(run.id); await started.promise;
  f.publish(f.backend.cancel(run.id, 'Human cancellation')); release.resolve(); await done;
  assert.equal(f.backend.status(run.id).run.status, 'cancelled');
  assert.deepEqual(f.calls.map(l => l.role), ['conductor']);
});

test('loss of the lead stops its worker but does not stop a peer run', async t => {
  const gate = deferred(), f = fixture(t, { workerGate: gate }), run = f.start();
  const done = f.runner.advance(run.id);
  while (f.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  f.handles.get(f.calls[0].id).stop(); await done; gate.resolve();
  assert.equal(f.backend.status(run.id).run.status, 'human_required');
  assert.match(f.backend.status(run.id).run.stopReason, /Conductor process exited/);
  const peer = f.start(); await f.runner.advance(peer.id);
  assert.equal(f.backend.status(peer.id).run.status, 'passed');
});

test('a conversation without a scoped decision cannot freeze or pass a run', async t => {
  const f = fixture(t, { noDecision: true }), run = f.start(); await f.runner.advance(run.id);
  assert.equal(f.backend.status(run.id).run.status, 'human_required');
  assert.equal(f.backend.status(run.id).run.contract, null);
  assert.equal(f.calls.length, 1);
});

test('missing worker receipts use bounded retries, never self-declared success', async t => {
  const f = fixture(t, { noReceipt: true }), run = f.start(); await f.runner.advance(run.id);
  assert.equal(f.backend.status(run.id).run.status, 'infrastructure_failure');
  assert.equal(f.calls.filter(l => l.role === 'implementer').length, 2);
  assert.equal(f.backend.status(run.id).artifacts.length, 0);
});

test('non-convergence ends at the configured repair bound', async t => {
  const f = fixture(t, { alwaysRevise: true }), run = f.start({ limits: { maxRepairRounds: 1 } }); await f.runner.advance(run.id);
  assert.equal(f.backend.status(run.id).run.status, 'human_required');
  assert.equal(f.calls.filter(l => l.role === 'repairer').length, 1);
});

test('the default Codex Critic is not silently replaced by a Claude pilot', async t => {
  const f = fixture(t), run = f.start({ providers: undefined }); await f.runner.advance(run.id);
  assert.equal(f.backend.status(run.id).run.status, 'human_required');
  assert.match(f.backend.status(run.id).run.stopReason, /Codex.*not.*substituted/);
  assert.equal(f.calls.length, 0);
});

test('watchdog retirement stops the old worker before a fresh retry is admitted', async t => {
  const gate = deferred(), f = fixture(t, { workerGate: gate }), run = f.start();
  const done = f.runner.advance(run.id);
  while (f.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  const old = f.calls[1];
  f.publish(f.backend.infrastructureFailure(run.id, 'Worker timed out', true));
  gate.resolve(); await done;
  assert.equal(f.backend.status(run.id).run.status, 'passed', f.backend.status(run.id).run.stopReason);
  const builders = f.calls.filter(l => l.role === 'implementer');
  assert.equal(builders.length, 2); assert.notEqual(builders[1].sessionId, old.sessionId);
  assert.equal(f.backend.status(run.id).artifacts.some(a => a.producedByLaunchId === old.id), false);
});

test('close stops active sessions and waits before backend shutdown', async t => {
  const gate = deferred(), f = fixture(t, { workerGate: gate }), run = f.start();
  const done = f.runner.advance(run.id);
  while (f.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  await f.runner.close(); await done; gate.resolve();
  assert.equal(f.backend.status(run.id).run.status, 'human_required');
  assert.match(f.backend.status(run.id).run.stopReason, /Operatus shutdown.*Inspect retained work.*automatic resume is unavailable/);
  assert.equal(f.runner.owns(run.id), false);
  const another = f.start(); await f.runner.advance(another.id);
  assert.equal(f.backend.status(another.id).launches.length, 0);
});

test('different run limits reach each role without leaking peer budgets', async t => {
  const budgets = [], f = fixture(t, {onBudget:(launch,budget)=>budgets.push({launch,budget})});
  const a=f.start({limits:{runTimeoutMs:60000,workerTimeoutMs:15000,criticTimeoutMs:12000}});
  const b=f.start({limits:{runTimeoutMs:120000,workerTimeoutMs:40000,criticTimeoutMs:30000}});
  await Promise.all([f.runner.advance(a.id),f.runner.advance(b.id)]);
  for(const run of [a,b]) {
    assert.equal(f.backend.status(run.id).run.status,'passed');
    for(const {launch,budget} of budgets.filter(b=>b.launch.runId===run.id)) {
      const limit=launch.role==='conductor'?run.limits.runTimeoutMs:launch.role==='critic'?run.limits.criticTimeoutMs:run.limits.workerTimeoutMs;
      assert.ok(budget.timeoutMs<=limit && budget.timeoutMs>limit-10000);
      assert.ok(budget.turnTimeoutMs<=run.limits.workerTimeoutMs);
    }
  }
});

test('expired run cannot begin admission and an expired worker preparation cannot spawn',async t=>{
  const f=fixture(t), expired=f.start({limits:{runTimeoutMs:1}});
  await new Promise(r=>setTimeout(r,10)); await f.runner.advance(expired.id);
  assert.equal(f.calls.length,0); assert.equal(f.backend.status(expired.id).run.status,'infrastructure_failure');
  const slow=fixture(t,{beforeWorker:async()=>new Promise(r=>setTimeout(r,30))});
  const run=slow.start({limits:{workerTimeoutMs:20,maxInfrastructureRetries:0}}); await slow.runner.advance(run.id);
  assert.deepEqual(slow.calls.map(l=>l.role),['conductor']);
  assert.equal(slow.backend.status(run.id).run.status,'infrastructure_failure');
  assert.equal(slow.backend.status(run.id).artifacts.length,0);
});
