'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cpSync, mkdtempSync, rmSync } = require('node:fs');
const net = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  applyGauntletEvent,
  createGauntletRun,
  freezeContract,
  GauntletInvariantError
} = loadTs('src/main/gauntlet/core.ts');
const { GauntletStore } = loadTs('src/main/gauntlet/store.ts');
const { PrimitiveRegistry } = loadTs('src/main/gauntlet/primitiveRegistry.ts');
const { GauntletControlServer } = loadTs('src/main/gauntlet/controlServer.ts');
const { projectRemoteSnapshot } = loadTs('src/main/gauntlet/remoteProjection.ts');
const { BRANCH_THEMES, normalizeBranchProfile } = loadTs('src/shared/branchIdentity.ts');

const BASE = '1'.repeat(40);
const ARTIFACT_1 = '2'.repeat(40);
const ARTIFACT_2 = '3'.repeat(40);

test('twelve accessible branch identities remain distinct and safely normalized', () => {
  assert.equal(BRANCH_THEMES.length, 12);
  assert.equal(new Set(BRANCH_THEMES.map((theme) => theme.id)).size, 12);
  assert.equal(new Set(BRANCH_THEMES.map((theme) => theme.label)).size, 12);
  assert.deepEqual(normalizeBranchProfile({ name: '  Workshop West  ', themeId: 'harbor' }), {
    name: 'Workshop West', themeId: 'harbor'
  });
  assert.deepEqual(normalizeBranchProfile({ name: '', themeId: 'not-a-theme' }), {
    name: 'Main Studio', themeId: 'cedar'
  });
});

function run(now = 100) {
  return createGauntletRun({
    id: 'run-1',
    repository: '/tmp/repo',
    objective: 'test objective',
    branch: 'atelier/gauntlet/run-1',
    baseSha: BASE,
    now,
    limits: { maxRepairRounds: 1 }
  });
}

function contract(at = 101) {
  return freezeContract({
    objective: 'Return the requested observable behavior',
    criteria: ['criterion-1: public behavior passes'],
    checks: [{ id: 'test', name: 'tests', command: 'npm test', timeoutMs: 10_000 }],
    constraints: ['do not broaden scope'],
    exclusions: []
  }, 'conductor-1', at);
}

test('run creation rejects empty objectives and unsafe runtime limits', () => {
  const base = {
    id: 'invalid-run', repository: '/tmp/repo', objective: 'bounded work',
    branch: 'atelier/gauntlet/invalid-run', baseSha: BASE, now: 100
  };
  assert.throws(() => createGauntletRun({ ...base, objective: '   ' }), /objective is required/);
  assert.throws(() => createGauntletRun({ ...base, limits: { maxRepairRounds: -1 } }), /within 0\.\.20/);
  assert.throws(() => createGauntletRun({ ...base, limits: { maxInfrastructureRetries: 6 } }), /within 0\.\.5/);
  assert.throws(() => createGauntletRun({ ...base, limits: { workerTimeoutMs: 0 } }), /within 1\.\./);
  assert.throws(() => createGauntletRun({ ...base, limits: { runTimeoutMs: Number.NaN } }), /within 1\.\./);
  assert.throws(() => createGauntletRun({ ...base, providers: { critic: { provider: 'grok' } } }), /must be claude or codex/);
  assert.throws(() => createGauntletRun({ ...base, providers: { critic: { provider: 'codex', model: 'x'.repeat(257) } } }), /model exceeds 256/);
});

test('frozen contract digest is deterministic and input order remains meaningful', () => {
  const a = contract();
  const b = contract(999);
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.frozenAt, b.frozenAt);
  const reordered = freezeContract({
    objective: a.objective,
    criteria: [...a.criteria].reverse(),
    checks: a.checks,
    constraints: a.constraints,
    exclusions: a.exclusions
  }, 'conductor-1');
  assert.equal(a.digest, reordered.digest, 'a single criterion is unchanged by reversal');
  assert.throws(() => freezeContract({ objective: 'x', criteria: [], checks: [], constraints: [], exclusions: [] }, 'c'));
  assert.throws(() => freezeContract({
    objective: 'x', criteria: ['observable'], constraints: [], exclusions: [],
    checks: [
      { id: 'same', name: 'one', command: 'true', timeoutMs: 1_000 },
      { id: 'same', name: 'two', command: 'true', timeoutMs: 1_000 }
    ]
  }, 'c'), /duplicate check id/);
});

test('a PASS report cannot pass until the Conductor acknowledges the exact artifact and bar', () => {
  let state = run();
  const frozen = contract();
  state = applyGauntletEvent(state, { type: 'BAR_FROZEN', at: 101, contract: frozen });
  state = applyGauntletEvent(state, { type: 'IMPLEMENTER_LAUNCHED', at: 102, launchId: 'impl-1', expectedSha: BASE });
  state = applyGauntletEvent(state, { type: 'ARTIFACT_RECORDED', at: 103, launchId: 'impl-1', role: 'implementer', artifactSha: ARTIFACT_1, parentSha: BASE });
  state = applyGauntletEvent(state, { type: 'CRITIC_LAUNCHED', at: 104, launchId: 'critic-1', artifactSha: ARTIFACT_1 });
  state = applyGauntletEvent(state, {
    type: 'CRITIC_REPORTED', at: 105, reportId: 'report-1', launchId: 'critic-1',
    artifactSha: ARTIFACT_1, contractDigest: frozen.digest, verdict: 'PASS'
  });
  assert.equal(state.status, 'awaiting_lead_ack');
  assert.throws(() => applyGauntletEvent(state, {
    type: 'LEAD_ACKNOWLEDGED', at: 106, acknowledgmentId: 'ack-1', reportId: 'report-1',
    artifactSha: ARTIFACT_2, contractDigest: frozen.digest, decision: 'pass'
  }), GauntletInvariantError);
  state = applyGauntletEvent(state, {
    type: 'LEAD_ACKNOWLEDGED', at: 106, acknowledgmentId: 'ack-1', reportId: 'report-1',
    artifactSha: ARTIFACT_1, contractDigest: frozen.digest, decision: 'pass'
  });
  assert.equal(state.status, 'passed');
});

test('stale critic report is discarded and requires a fresh critic', () => {
  let state = applyGauntletEvent(run(), { type: 'BAR_FROZEN', at: 101, contract: contract() });
  state = applyGauntletEvent(state, { type: 'IMPLEMENTER_LAUNCHED', at: 102, launchId: 'impl-1', expectedSha: BASE });
  state = applyGauntletEvent(state, { type: 'ARTIFACT_RECORDED', at: 103, launchId: 'impl-1', role: 'implementer', artifactSha: ARTIFACT_1, parentSha: BASE });
  state = applyGauntletEvent(state, { type: 'CRITIC_LAUNCHED', at: 104, launchId: 'critic-1', artifactSha: ARTIFACT_1 });
  state = applyGauntletEvent(state, {
    type: 'CRITIC_REPORTED', at: 105, reportId: 'stale', launchId: 'critic-1', artifactSha: ARTIFACT_2,
    contractDigest: state.contract.digest, verdict: 'PASS'
  });
  assert.equal(state.status, 'awaiting_critic');
  assert.equal(state.currentCriticReportId, null);
});

test('bounded repair creates a new artifact and escalates after the configured limit', () => {
  let state = applyGauntletEvent(run(), { type: 'BAR_FROZEN', at: 101, contract: contract() });
  state = applyGauntletEvent(state, { type: 'IMPLEMENTER_LAUNCHED', at: 102, launchId: 'impl-1', expectedSha: BASE });
  state = applyGauntletEvent(state, { type: 'ARTIFACT_RECORDED', at: 103, launchId: 'impl-1', role: 'implementer', artifactSha: ARTIFACT_1, parentSha: BASE });
  state = applyGauntletEvent(state, { type: 'CRITIC_LAUNCHED', at: 104, launchId: 'critic-1', artifactSha: ARTIFACT_1 });
  state = applyGauntletEvent(state, { type: 'CRITIC_REPORTED', at: 105, reportId: 'r1', launchId: 'critic-1', artifactSha: ARTIFACT_1, contractDigest: state.contract.digest, verdict: 'REVISE' });
  state = applyGauntletEvent(state, { type: 'LEAD_ACKNOWLEDGED', at: 106, acknowledgmentId: 'a1', reportId: 'r1', artifactSha: ARTIFACT_1, contractDigest: state.contract.digest, decision: 'repair' });
  state = applyGauntletEvent(state, { type: 'REPAIR_LAUNCHED', at: 107, launchId: 'repair-1', expectedSha: ARTIFACT_1 });
  state = applyGauntletEvent(state, { type: 'ARTIFACT_RECORDED', at: 108, launchId: 'repair-1', role: 'repairer', artifactSha: ARTIFACT_2, parentSha: ARTIFACT_1 });
  state = applyGauntletEvent(state, { type: 'CRITIC_LAUNCHED', at: 109, launchId: 'critic-2', artifactSha: ARTIFACT_2 });
  state = applyGauntletEvent(state, { type: 'CRITIC_REPORTED', at: 110, reportId: 'r2', launchId: 'critic-2', artifactSha: ARTIFACT_2, contractDigest: state.contract.digest, verdict: 'REVISE' });
  state = applyGauntletEvent(state, { type: 'LEAD_ACKNOWLEDGED', at: 111, acknowledgmentId: 'a2', reportId: 'r2', artifactSha: ARTIFACT_2, contractDigest: state.contract.digest, decision: 'repair' });
  assert.equal(state.status, 'human_required');
  assert.match(state.stopReason, /repair limit/);
});

test('SQLite store rejects stale writers and reconstructs a complete snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-gauntlet-store-'));
  const store = new GauntletStore(join(dir, 'gauntlet.db'));
  store.open();
  const initial = run();
  store.createRun(initial);
  const frozen = contract();
  const snapshot = store.transition(initial.id, 0, { type: 'BAR_FROZEN', at: 101, contract: frozen }, { contract: frozen });
  assert.equal(snapshot.run.status, 'awaiting_implementation');
  assert.equal(snapshot.events.length, 1);
  assert.throws(() => store.transition(initial.id, 0, { type: 'CANCELLED', at: 102, reason: 'stale' }), /stale run version/);
  store.close();
});

test('primitive registry resolves exact source commit and composes both engineering critics', () => {
  const registry = new PrimitiveRegistry(join(__dirname, '..', 'vendor', 'agent-primitives'));
  const resolved = registry.resolveGeneralEngineeringCritic('codex');
  assert.deepEqual(resolved.receipts.map((receipt) => receipt.primitiveId), ['verification-critic', 'architecture-reviewer']);
  assert.ok(resolved.receipts.every((receipt) => receipt.sourceCommit.length === 40));
  assert.ok(resolved.receipts.every((receipt) => receipt.enforcement === 'enforced'));
  assert.match(resolved.prompt, /Atelier General Engineering Critic/);
});

test('packaged primitive tree resolves against the committed pin without Git metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-primitives-packaged-'));
  const source = join(__dirname, '..', 'vendor', 'agent-primitives');
  const packaged = join(dir, 'agent-primitives');
  cpSync(source, packaged, { recursive: true, filter: (path) => !path.endsWith('/.git') });
  const resolved = new PrimitiveRegistry(packaged).resolve('verification-critic');
  assert.equal(resolved.sourceCommit, '7c0ceb64d0ffb8c7b4c8548b6fdd09e4ee9a17c0');
  rmSync(dir, { recursive: true, force: true });
});

test('explicit local primitive override receipts its own exact Git commit without changing the published pin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-primitives-override-'));
  const source = join(__dirname, '..', 'vendor', 'agent-primitives');
  const checkout = join(dir, 'override');
  cpSync(source, checkout, { recursive: true, filter: (path) => !path.endsWith('/.git') });
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init', '-b', 'main', checkout]);
  execFileSync('git', ['-C', checkout, 'config', 'user.name', 'Atelier Test']);
  execFileSync('git', ['-C', checkout, 'config', 'user.email', 'atelier@example.invalid']);
  execFileSync('git', ['-C', checkout, 'add', '.']);
  execFileSync('git', ['-C', checkout, 'commit', '-m', 'local override']);
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const resolved = new PrimitiveRegistry(checkout, null).resolve('verification-critic');
  assert.equal(resolved.sourceCommit, head);
  assert.notEqual(resolved.sourceCommit, '7c0ceb64d0ffb8c7b4c8548b6fdd09e4ee9a17c0');
  rmSync(dir, { recursive: true, force: true });
});

test('local control socket rejects wrong authority and accepts a bounded Conductor command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-control-'));
  const snapshot = { run: { id: 'run-1', status: 'awaiting_implementation' } };
  const backend = {
    freeze(runId, payload) {
      assert.equal(runId, 'run-1');
      assert.equal(payload.objective, 'frozen');
      return snapshot;
    }
  };
  let transitioned = null;
  const server = new GauntletControlServer(dir, backend, (value) => { transitioned = value; });
  const endpoint = await server.start();
  const wrong = await socketRequest(endpoint.socketPath, { action: 'freeze', runId: 'run-1', token: 'wrong', payload: { objective: 'frozen' } });
  assert.equal(wrong.ok, false);
  const malformed = await socketRawRequest(endpoint.socketPath, '{not-json}\n');
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /JSON/);
  const good = await socketRequest(endpoint.socketPath, { action: 'freeze', runId: 'run-1', token: endpoint.conductorToken, payload: { objective: 'frozen' } });
  assert.equal(good.ok, true);
  assert.equal(transitioned, snapshot);
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

test('remote projection is redacted by default and never exposes authority material or local paths', () => {
  const projected = projectRemoteSnapshot({
    run: { ...run(), repository: '/Users/private/secret-project', requestedObjective: 'secret objective', contract: contract() },
    launches: [{
      id: 'launch-1', runId: 'run-1', role: 'critic', provider: 'codex', sessionId: 'session-1',
      worktreePath: '/Users/private/worktree', expectedSha: ARTIFACT_1, tokenHash: 'authority-secret',
      capability: { filesystem: 'enforced', cleanContext: 'enforced', toolRestrictions: 'partial', notes: ['private capability path'] },
      status: 'created', createdAt: 101
    }],
    artifacts: [{
      id: 'artifact-1', runId: 'run-1', sha: ARTIFACT_1, parentSha: BASE, branch: 'atelier/gauntlet/run-1',
      producedByLaunchId: 'launch-1', diffSummary: 'private diff',
      checkReceipts: [{ checkId: 'test', command: 'private command', exitCode: 0, timedOut: false, durationMs: 1, output: 'private output' }], createdAt: 102
    }],
    reports: [{
      id: 'report-1', runId: 'run-1', launchId: 'launch-1', artifactSha: ARTIFACT_1,
      contractDigest: contract().digest, verdict: 'REVISE', summary: 'private summary',
      findings: [{ id: 'finding-1', severity: 'major', title: 'A finding', evidence: 'private evidence', criterionIds: ['test'] }],
      primitiveReceipts: [], createdAt: 103
    }],
    acknowledgments: [{
      id: 'ack-1', runId: 'run-1', reportId: 'report-1', launchId: 'conductor',
      artifactSha: ARTIFACT_1, contractDigest: contract().digest,
      acceptedFindingIds: [], rejectedFindings: [{ findingId: 'finding-1', reason: 'private rejection reason' }],
      decision: 'human_required', rationale: 'private rationale', createdAt: 104
    }],
    repairPackets: [],
    events: [
      { sequence: 1, event: { type: 'BAR_FROZEN', at: 101, contract: contract() } },
      { sequence: 2, event: { type: 'INFRASTRUCTURE_FAILED', at: 105, reason: 'private failure reason', retryable: false } }
    ]
  });
  const encoded = JSON.stringify(projected);
  assert.equal(projected.run.repositoryLabel, 'secret-project');
  assert.equal(projected.run.objective, '[not shared]');
  for (const secret of [
    '/Users/private', 'authority-secret', 'private diff', 'private command', 'private output',
    'secret objective', 'private capability path', 'private summary', 'private evidence',
    'private rejection reason', 'private rationale', 'private failure reason'
  ]) {
    assert.equal(encoded.includes(secret), false, `remote projection leaked ${secret}`);
  }
  assert.deepEqual(projected.events[0].event, { type: 'BAR_FROZEN', at: 101 });
});

function socketRequest(path, body) {
  return socketRawRequest(path, `${JSON.stringify(body)}\n`);
}

function socketRawRequest(path, body) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let text = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(body));
    socket.on('data', (chunk) => { text += chunk; });
    socket.on('end', () => resolve(JSON.parse(text)));
    socket.on('error', reject);
  });
}
