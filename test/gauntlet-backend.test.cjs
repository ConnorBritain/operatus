'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { LocalGauntletBackend } = loadTs('src/main/gauntlet/localBackend.ts');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ventura-backend-'));
  const repository = join(root, 'repository');
  execFileSync('git', ['init', '-b', 'main', repository]);
  git(repository, ['config', 'user.name', 'Ventura Test']);
  git(repository, ['config', 'user.email', 'ventura@example.invalid']);
  writeFileSync(join(repository, 'value.txt'), 'base\n');
  git(repository, ['add', 'value.txt']);
  git(repository, ['commit', '-m', 'base']);
  const backend = new LocalGauntletBackend({
    stateRoot: join(root, 'state'),
    primitiveRoot: join(__dirname, '..', 'vendor', 'agent-primitives')
  });
  backend.open();
  return { root, repository, backend };
}

function commitValue(launch, value, message) {
  writeFileSync(join(launch.worktreePath, 'value.txt'), `${value}\n`);
  git(launch.worktreePath, ['add', 'value.txt']);
  git(launch.worktreePath, ['commit', '-m', message]);
  return git(launch.worktreePath, ['rev-parse', 'HEAD']);
}

test('local backend conducts implementation, repair, fresh re-critique, and explicit pass', async () => {
  const { backend, repository } = fixture();
  const started = backend.start({ repository, objective: 'Make value.txt contain repaired' });
  const runId = started.run.id;
  const frozen = backend.freeze(runId, {
    objective: 'Make value.txt contain exactly repaired',
    criteria: ['value-file: value.txt contains exactly repaired followed by a newline'],
    checks: [{ id: 'value-file', name: 'exact value', command: 'test "$(cat value.txt)" = repaired', timeoutMs: 5_000 }],
    constraints: ['change only value.txt'],
    exclusions: ['do not merge or push']
  });
  assert.equal(frozen.run.status, 'awaiting_implementation');

  const implementer = backend.prepareImplementer(runId);
  assert.match(implementer.prompt, /Original requested objective\nMake value\.txt contain repaired/);
  const firstSha = commitValue(implementer.launch, 'needs-repair', 'implement initial value');
  let snapshot = await backend.completeArtifact({
    runId, launchId: implementer.launch.id, token: implementer.token, sha: firstSha
  });
  assert.equal(snapshot.run.status, 'awaiting_critic');
  assert.equal(snapshot.artifacts[0].checkReceipts[0].exitCode, 1);

  const criticOne = backend.prepareCritic(runId);
  assert.match(criticOne.prompt, /Original requested objective\nMake value\.txt contain repaired/);
  snapshot = backend.submitCritic({
    runId, launchId: criticOne.launch.id, token: criticOne.token,
    artifactSha: firstSha, contractDigest: frozen.run.contract.digest,
    verdict: 'REVISE', summary: 'The exact frozen check fails.',
    findings: [{ id: 'value-wrong', severity: 'major', title: 'Wrong value', evidence: 'value.txt contains needs-repair', criterionIds: ['value-file'] }]
  });
  const report = snapshot.reports.at(-1);
  snapshot = backend.acknowledge({
    runId, reportId: report.id, conductorLaunchId: 'conductor', decision: 'repair',
    acceptedFindingIds: ['value-wrong'], rejectedFindings: [], rationale: 'The evidence is reproducible.',
    repairInstructions: ['Replace value.txt with exactly repaired followed by a newline.']
  });
  assert.equal(snapshot.run.status, 'needs_repair');

  const repairer = backend.prepareRepairer(runId, snapshot.repairPackets.at(-1));
  const repairedSha = commitValue(repairer.launch, 'repaired', 'repair exact value');
  snapshot = await backend.completeArtifact({
    runId, launchId: repairer.launch.id, token: repairer.token, sha: repairedSha
  });
  assert.equal(snapshot.artifacts.at(-1).checkReceipts[0].exitCode, 0);

  const criticTwo = backend.prepareCritic(runId);
  assert.notEqual(criticTwo.launch.id, criticOne.launch.id);
  assert.notEqual(criticTwo.launch.sessionId, criticOne.launch.sessionId);
  snapshot = backend.submitCritic({
    runId, launchId: criticTwo.launch.id, token: criticTwo.token,
    artifactSha: repairedSha, contractDigest: frozen.run.contract.digest,
    verdict: 'PASS', summary: 'The exact artifact satisfies the frozen criterion.', findings: []
  });
  snapshot = backend.acknowledge({
    runId, reportId: snapshot.reports.at(-1).id, conductorLaunchId: 'conductor', decision: 'pass',
    acceptedFindingIds: [], rejectedFindings: [], rationale: 'Independent evidence demonstrates the bar.'
  });
  assert.equal(snapshot.run.status, 'passed');
  assert.equal(snapshot.artifacts.length, 2);
  assert.equal(snapshot.reports.length, 2);
  assert.equal(snapshot.acknowledgments.length, 2);
  assert.ok(snapshot.launches.every((launch) => launch.status === 'completed' && launch.finishedAt));
  assert.equal(readFileSync(join(repository, 'value.txt'), 'utf8'), 'base\n', 'shared checkout remains untouched');
  backend.close();
});

test('restart retry preserves dirty work, detaches the old branch, and uses a fresh launch identity', () => {
  const { root, repository, backend } = fixture();
  const started = backend.start({
    repository, objective: 'Exercise restart recovery',
    limits: { maxInfrastructureRetries: 1 }
  });
  backend.freeze(started.run.id, {
    objective: 'Create one clean artifact', criteria: ['artifact: a commit exists'], checks: [],
    constraints: [], exclusions: []
  });
  const first = backend.prepareImplementer(started.run.id);
  writeFileSync(join(first.launch.worktreePath, 'unfinished.txt'), 'preserve me\n');
  backend.close();

  const recovered = new LocalGauntletBackend({
    stateRoot: join(root, 'state'),
    primitiveRoot: join(__dirname, '..', 'vendor', 'agent-primitives')
  });
  recovered.open();
  const [snapshot] = recovered.reconcileAfterRestart();
  assert.equal(snapshot.run.status, 'awaiting_implementation');
  assert.equal(snapshot.run.infrastructureRetries, 1);
  assert.equal(readFileSync(join(first.launch.worktreePath, 'unfinished.txt'), 'utf8'), 'preserve me\n');
  assert.equal(git(first.launch.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');
  const second = recovered.prepareImplementer(started.run.id);
  assert.notEqual(second.launch.id, first.launch.id);
  assert.notEqual(second.launch.sessionId, first.launch.sessionId);
  assert.ok(existsSync(first.launch.worktreePath));
  recovered.cancel(started.run.id, 'test finished');
  recovered.close();
});

test('timeouts relaunch once with a fresh identity, then fail explicitly', () => {
  const { repository, backend } = fixture();
  const started = backend.start({
    repository,
    objective: 'Exercise bounded timeout handling',
    limits: { workerTimeoutMs: 1, maxInfrastructureRetries: 1 }
  });
  backend.freeze(started.run.id, {
    objective: 'Create one clean artifact', criteria: ['artifact: a commit exists'], checks: [],
    constraints: [], exclusions: []
  });

  const first = backend.prepareImplementer(started.run.id);
  assert.throws(() => backend.prepareImplementer(started.run.id), /expected awaiting_implementation/);
  let [snapshot] = backend.sweepTimeouts(first.launch.createdAt + 2);
  assert.equal(snapshot.run.status, 'awaiting_implementation');
  assert.equal(snapshot.run.infrastructureRetries, 1);
  assert.equal(snapshot.launches.find((launch) => launch.id === first.launch.id).status, 'timed_out');

  const second = backend.prepareImplementer(started.run.id);
  assert.notEqual(second.launch.id, first.launch.id);
  assert.notEqual(second.launch.sessionId, first.launch.sessionId);
  [snapshot] = backend.sweepTimeouts(second.launch.createdAt + 2);
  assert.equal(snapshot.run.status, 'infrastructure_failure');
  assert.match(snapshot.run.stopReason, /implementer timed out/);
  assert.equal(snapshot.launches.find((launch) => launch.id === second.launch.id).status, 'timed_out');
  backend.close();
});

test('cancellation is terminal and duplicate completion cannot mutate the run', async () => {
  const { repository, backend } = fixture();
  const started = backend.start({ repository, objective: 'Exercise cancellation' });
  backend.freeze(started.run.id, {
    objective: 'Create one clean artifact', criteria: ['artifact: a commit exists'], checks: [],
    constraints: [], exclusions: []
  });
  const launch = backend.prepareImplementer(started.run.id);
  const snapshot = backend.cancel(started.run.id, 'human stopped the run');
  assert.equal(snapshot.run.status, 'cancelled');
  assert.equal(snapshot.launches.at(-1).status, 'cancelled');
  assert.throws(() => backend.cancel(started.run.id, 'duplicate'), /terminal/);
  await assert.rejects(() => backend.completeArtifact({
    runId: started.run.id, launchId: launch.launch.id, token: launch.token, sha: launch.launch.expectedSha
  }), /no longer current/);
  backend.close();
});

test('completion rejects a wrong SHA and a dirty candidate worktree', async () => {
  const { repository, backend } = fixture();
  const started = backend.start({ repository, objective: 'Exercise artifact rejection' });
  backend.freeze(started.run.id, {
    objective: 'Create one clean artifact', criteria: ['artifact: a clean commit exists'], checks: [],
    constraints: [], exclusions: []
  });
  const launch = backend.prepareImplementer(started.run.id);

  writeFileSync(join(launch.launch.worktreePath, 'unfinished.txt'), 'not committed\n');
  await assert.rejects(() => backend.completeArtifact({
    runId: started.run.id,
    launchId: launch.launch.id,
    token: launch.token,
    sha: launch.launch.expectedSha
  }), /worktree is not clean/);

  const unrelatedSha = git(repository, ['rev-parse', 'HEAD']);
  assert.equal(unrelatedSha, launch.launch.expectedSha);
  await assert.rejects(() => backend.completeArtifact({
    runId: started.run.id,
    launchId: launch.launch.id,
    token: launch.token,
    sha: '0'.repeat(40)
  }), /does not match worktree HEAD/);
  backend.cancel(started.run.id, 'test finished');
  backend.close();
});

test('a frozen check that mutates files cannot advance the artifact', async () => {
  const { repository, backend } = fixture();
  const started = backend.start({ repository, objective: 'Exercise mutating check rejection' });
  backend.freeze(started.run.id, {
    objective: 'Create a clean artifact', criteria: ['artifact: checks leave the checkout clean'],
    checks: [{ id: 'mutator', name: 'mutating check', command: 'printf dirty > generated.txt', timeoutMs: 5_000 }],
    constraints: [], exclusions: []
  });
  const launch = backend.prepareImplementer(started.run.id);
  const sha = commitValue(launch.launch, 'candidate', 'create candidate');
  await assert.rejects(() => backend.completeArtifact({
    runId: started.run.id, launchId: launch.launch.id, token: launch.token, sha
  }), /worktree is not clean/);
  const snapshot = backend.status(started.run.id);
  assert.equal(snapshot.run.status, 'implementer_in_flight');
  assert.equal(snapshot.artifacts.length, 0);
  backend.cancel(started.run.id, 'test finished');
  backend.close();
});

test('the overall run budget terminates even while no role is in flight', () => {
  const { repository, backend } = fixture();
  const started = backend.start({
    repository,
    objective: 'Exercise overall run budget',
    limits: { runTimeoutMs: 1 }
  });
  const [snapshot] = backend.sweepTimeouts(started.run.createdAt + 2);
  assert.equal(snapshot.run.status, 'infrastructure_failure');
  assert.match(snapshot.run.stopReason, /overall run budget exceeded/);
  backend.close();
});

test('critic mutation invalidates the report immediately and relaunches fresh', async () => {
  const { repository, backend } = fixture();
  const started = backend.start({
    repository,
    objective: 'Exercise critic mutation handling',
    limits: { maxInfrastructureRetries: 1 }
  });
  const frozen = backend.freeze(started.run.id, {
    objective: 'Create one reviewable artifact', criteria: ['artifact: a commit exists'], checks: [],
    constraints: [], exclusions: []
  });
  const implementer = backend.prepareImplementer(started.run.id);
  const sha = commitValue(implementer.launch, 'review-me', 'create review artifact');
  await backend.completeArtifact({
    runId: started.run.id, launchId: implementer.launch.id, token: implementer.token, sha
  });

  const first = backend.prepareCritic(started.run.id);
  writeFileSync(join(first.launch.worktreePath, 'critic-mutation.txt'), 'critics are read-only\n');
  const invalidated = backend.submitCritic({
    runId: started.run.id, launchId: first.launch.id, token: first.token,
    artifactSha: sha, contractDigest: frozen.run.contract.digest,
    verdict: 'PASS', summary: 'This report must be invalidated.', findings: []
  });
  assert.equal(invalidated.run.status, 'awaiting_critic');
  assert.equal(invalidated.reports.length, 0);
  assert.match(invalidated.events.at(-1).event.reason, /critic worktree mutation/);
  assert.equal(invalidated.launches.find((launch) => launch.id === first.launch.id).status, 'failed');

  const second = backend.prepareCritic(started.run.id);
  assert.notEqual(second.launch.id, first.launch.id);
  assert.notEqual(second.launch.sessionId, first.launch.sessionId);
  backend.cancel(started.run.id, 'test finished');
  backend.close();
});

test('a critic can surface genuine ambiguity for explicit human escalation', async () => {
  const { repository, backend } = fixture();
  const started = backend.start({ repository, objective: 'Exercise human escalation' });
  const frozen = backend.freeze(started.run.id, {
    objective: 'Create one reviewable artifact', criteria: ['artifact: a commit exists'], checks: [],
    constraints: [], exclusions: []
  });
  const implementer = backend.prepareImplementer(started.run.id);
  const sha = commitValue(implementer.launch, 'ambiguous', 'create ambiguous artifact');
  await backend.completeArtifact({
    runId: started.run.id, launchId: implementer.launch.id, token: implementer.token, sha
  });
  const critic = backend.prepareCritic(started.run.id);
  let snapshot = backend.submitCritic({
    runId: started.run.id, launchId: critic.launch.id, token: critic.token,
    artifactSha: sha, contractDigest: frozen.run.contract.digest,
    verdict: 'HUMAN_REQUIRED', summary: 'The observable criterion requires a human product choice.', findings: []
  });
  snapshot = backend.acknowledge({
    runId: started.run.id, reportId: snapshot.reports.at(-1).id,
    conductorLaunchId: 'conductor', decision: 'human_required',
    acceptedFindingIds: [], rejectedFindings: [], rationale: 'The ambiguity is genuine and cannot be inferred safely.'
  });
  assert.equal(snapshot.run.status, 'human_required');
  backend.close();
});
