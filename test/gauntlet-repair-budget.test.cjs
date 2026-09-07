'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const { join } = require('node:path'); const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process'); const Database = require('better-sqlite3');
const load = require('./load-ts.cjs');
const { createGauntletRun, freezeContract, applyGauntletEvent: apply } = load('src/main/gauntlet/core.ts');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const base = '1'.repeat(40), first = '2'.repeat(40), repaired = '3'.repeat(40);
function repairing(limits = {}) {
  const contract = freezeContract({ objective: 'Budget fixture', criteria: ['observable'], checks: [], constraints: [], exclusions: [] }, 'lead', 2);
  let run = createGauntletRun({ id: 'r', repository: '/fixture', branch: 'operatus/gauntlet/r', objective: contract.objective,
    baseSha: base, now: 1, limits: { maxRepairRounds: 1, maxInfrastructureRetries: 1, ...limits } });
  const events = [
    { type: 'BAR_FROZEN', contract },
    { type: 'IMPLEMENTER_LAUNCHED', launchId: 'impl', expectedSha: base },
    { type: 'ARTIFACT_RECORDED', launchId: 'impl', role: 'implementer', artifactSha: first, parentSha: base },
    { type: 'CRITIC_LAUNCHED', launchId: 'critic', artifactSha: first },
    { type: 'CRITIC_REPORTED', launchId: 'critic', reportId: 'report', verdict: 'REVISE', artifactSha: first, contractDigest: contract.digest },
    { type: 'LEAD_ACKNOWLEDGED', acknowledgmentId: 'ack', reportId: 'report', artifactSha: first, contractDigest: contract.digest, decision: 'repair' },
    { type: 'REPAIR_LAUNCHED', launchId: 'repair', expectedSha: first }
  ];
  for (const [index, event] of events.entries()) run = apply(run, { ...event, at: index + 2 });
  return run;
}
const step = (run, event) => apply(run, { ...event, at: run.updatedAt + 1 });
const fail = run => step(run, { type: 'INFRASTRUCTURE_FAILED', reason: 'transport', retryable: true });
const retry = run => step(run, { type: 'REPAIR_LAUNCHED', launchId: 'fresh-repair', expectedSha: first });
function reviewAgain(run, decision) {
  run = step(run, { type: 'ARTIFACT_RECORDED', launchId: 'fresh-repair', role: 'repairer', artifactSha: repaired, parentSha: first });
  run = step(run, { type: 'CRITIC_LAUNCHED', launchId: 'fresh-critic', artifactSha: repaired });
  run = step(run, { type: 'CRITIC_REPORTED', launchId: 'fresh-critic', reportId: 'new-report', artifactSha: repaired, contractDigest: run.contract.digest, verdict: 'REVISE' });
  return step(run, { type: 'LEAD_ACKNOWLEDGED', acknowledgmentId: 'new-ack', reportId: 'new-report', artifactSha: repaired,
    contractDigest: run.contract.digest, decision });
}
test('the last allowed repair round may relaunch once without buying another round', () => {
  const initial = repairing(); const waiting = fail(initial);
  assert.equal(initial.repairRound, 1); assert.equal(waiting.repairRound, 1);
  assert.deepEqual(waiting.pendingRepairRetry, { launchId: 'repair', artifactSha: first, round: 1 });
  const resumed = retry(waiting);
  assert.equal(resumed.repairRound, 1); assert.equal(resumed.infrastructureRetries, 1); assert.equal(resumed.pendingRepairRetry, null);
  assert.equal(reviewAgain(resumed, 'repair').status, 'human_required');
});
test('a genuinely new acknowledged repair still consumes a new round', () => {
  let run = reviewAgain(retry(fail(repairing({ maxRepairRounds: 2 }))), 'repair');
  assert.equal(run.status, 'needs_repair'); assert.equal(run.pendingRepairRetry, null);
  run = step(run, { type: 'REPAIR_LAUNCHED', launchId: 'round-two', expectedSha: repaired });
  assert.equal(run.repairRound, 2);
});
test('retry never resets or bypasses the independently bounded infrastructure counter', () => {
  const terminal = fail(retry(fail(repairing())));
  assert.equal(terminal.status, 'infrastructure_failure'); assert.equal(terminal.repairRound, 1);
  assert.equal(terminal.infrastructureRetries, 1); assert.equal(terminal.pendingRepairRetry, null);
  assert.throws(() => retry(terminal), /terminal/);
  assert.equal(fail(repairing({ maxInfrastructureRetries: 0 })).status, 'infrastructure_failure');
});
test('retry requires fresh identity, exact artifact and matching round accounting', () => {
  const waiting = fail(repairing());
  assert.throws(() => step(waiting, { type: 'REPAIR_LAUNCHED', launchId: 'repair', expectedSha: first }), /fresh launch/);
  assert.throws(() => step(waiting, { type: 'REPAIR_LAUNCHED', launchId: 'new', expectedSha: repaired }), /identity mismatch/);
  assert.throws(() => retry({ ...waiting, pendingRepairRetry: { ...waiting.pendingRepairRetry, round: 0 } }), /accounting/);
  assert.throws(() => retry({ ...waiting, pendingRepairRetry: { ...waiting.pendingRepairRetry, artifactSha: repaired } }), /identity mismatch/);
  assert.equal(step(waiting, { type: 'CANCELLED', reason: 'stop' }).pendingRepairRetry, null);
  assert.equal(step(waiting, { type: 'HUMAN_ESCALATED', reason: 'decide' }).pendingRepairRetry, null);
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-budget-')); const repository = join(root, 'repo'); fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'value.txt'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
  const stateRoot = join(root, 'state'); const backend = new LocalGauntletBackend({ stateRoot, primitiveRoot: join(__dirname, '../vendor/agent-primitives') }); backend.open();
  const run = backend.start({ repository, objective: 'Budget fixture', limits: { maxRepairRounds: 1, maxInfrastructureRetries: 1 } }).run;
  const frozen = backend.freeze(run.id, { objective: run.requestedObjective, criteria: ['exact artifact'], checks: [], constraints: [], exclusions: [] });
  const commit = (launch, text) => { fs.writeFileSync(join(launch.worktreePath, 'value.txt'), text); git(launch.worktreePath, 'add', '.'); git(launch.worktreePath, 'commit', '-m', text); return git(launch.worktreePath, 'rev-parse', 'HEAD'); };
  const worker = backend.prepareImplementer(run.id), sha = commit(worker.launch, 'candidate');
  await backend.completeArtifact({ runId: run.id, launchId: worker.launch.id, token: worker.token, sha });
  const critic = backend.prepareCritic(run.id);
  let snapshot = backend.submitCritic({ runId: run.id, launchId: critic.launch.id, token: critic.token, artifactSha: sha,
    contractDigest: frozen.run.contract.digest, verdict: 'REVISE', summary: 'Fixture', findings: [{ id: 'f', severity: 'major', title: 'Fixture', evidence: 'Fixture', criterionIds: [] }] });
  snapshot = backend.acknowledge({ runId: run.id, reportId: snapshot.reports[0].id, conductorLaunchId: 'conductor', decision: 'repair',
    acceptedFindingIds: ['f'], rejectedFindings: [], rationale: 'Fixture', repairInstructions: ['Repair fixture'] });
  const packet = snapshot.repairPackets[0], repair = backend.prepareRepairer(run.id, packet);
  commit(repair.launch, 'abandoned repair'); backend.infrastructureFailure(run.id, 'transport');
  return { backend, stateRoot, run, packet, repair, commit, sha };
}
for (const legacy of [false, true]) test(`last-round retry survives SQLite reopen and passes fresh critique/ack (${legacy ? 'legacy' : 'current'} snapshot)`, async () => {
  const f = await fixture(); f.backend.close();
  if (legacy) {
    const db = new Database(join(f.stateRoot, 'gauntlet.db'));
    const row = JSON.parse(db.prepare('SELECT snapshot_json FROM gauntlet_runs WHERE id=?').get(f.run.id).snapshot_json);
    delete row.pendingRepairRetry;
    db.prepare('UPDATE gauntlet_runs SET snapshot_json=? WHERE id=?').run(JSON.stringify(row), f.run.id); db.close();
  }
  f.backend.open();
  try {
    const waiting = f.backend.status(f.run.id); assert.equal(waiting.run.pendingRepairRetry.launchId, f.repair.launch.id);
    const fresh = f.backend.prepareRepairer(f.run.id, f.packet);
    assert.notEqual(fresh.launch.id, f.repair.launch.id); assert.notEqual(fresh.launch.sessionId, f.repair.launch.sessionId);
    assert.notEqual(fresh.launch.candidateBranch, f.repair.launch.candidateBranch);
    assert.equal(git(fresh.launch.worktreePath, 'rev-parse', 'HEAD'), f.sha);
    const sha = f.commit(fresh.launch, 'repaired'); await f.backend.completeArtifact({ runId: f.run.id, launchId: fresh.launch.id, token: fresh.token, sha });
    const critic = f.backend.prepareCritic(f.run.id);
    let snapshot = f.backend.submitCritic({ runId: f.run.id, launchId: critic.launch.id, token: critic.token, artifactSha: sha,
      contractDigest: waiting.run.contract.digest, verdict: 'PASS', summary: 'Fixture pass', findings: [] });
    assert.equal(snapshot.run.status, 'awaiting_lead_ack');
    snapshot = f.backend.acknowledge({ runId: f.run.id, reportId: snapshot.reports.at(-1).id, conductorLaunchId: 'conductor', decision: 'pass',
      acceptedFindingIds: [], rejectedFindings: [], rationale: 'Fixture accepted' });
    assert.equal(snapshot.run.status, 'passed'); assert.equal(snapshot.run.repairRound, 1); assert.equal(snapshot.run.infrastructureRetries, 1);
    assert.equal(snapshot.run.pendingRepairRetry, null);
  } finally { f.backend.close(); }
});
test('legacy snapshots without matching failure history do not gain a free retry', async () => {
  const f = await fixture(); f.backend.close();
  const db = new Database(join(f.stateRoot, 'gauntlet.db'));
  const row = JSON.parse(db.prepare('SELECT snapshot_json FROM gauntlet_runs WHERE id=?').get(f.run.id).snapshot_json); delete row.pendingRepairRetry;
  db.prepare('UPDATE gauntlet_runs SET snapshot_json=? WHERE id=?').run(JSON.stringify(row), f.run.id);
  db.prepare('DELETE FROM gauntlet_events WHERE run_id=? AND sequence=?').run(f.run.id, row.version); db.close();
  f.backend.open();
  try {
    const before = git(f.repair.launch.worktreePath, 'for-each-ref', '--format=%(refname)', 'refs/heads/operatus');
    assert.equal(f.backend.status(f.run.id).run.pendingRepairRetry, undefined);
    assert.throws(() => f.backend.prepareRepairer(f.run.id, f.packet), /repair limit/);
    assert.equal(git(f.repair.launch.worktreePath, 'for-each-ref', '--format=%(refname)', 'refs/heads/operatus'), before);
  }
  finally { f.backend.close(); }
});
