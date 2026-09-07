'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-attempt-'));
  const repository = join(root, 'repo'); fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'value.txt'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
  const options = { stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') };
  const backend = new LocalGauntletBackend(options); backend.open();
  const run = backend.start({ repository, objective: 'Attempt isolation' }).run;
  backend.freeze(run.id, { objective: run.requestedObjective, criteria: ['Exact candidate'], checks: [], constraints: [], exclusions: [] });
  return { root, repository, options, backend, run };
}
function commit(launch, text) {
  fs.writeFileSync(join(launch.worktreePath, 'value.txt'), text);
  git(launch.worktreePath, 'add', '.'); git(launch.worktreePath, 'commit', '-m', text);
  return git(launch.worktreePath, 'rev-parse', 'HEAD');
}
const complete = (f, worker, sha) => f.backend.completeArtifact({ runId: f.run.id, launchId: worker.launch.id, token: worker.token, sha });

test('restart preserves an unrecorded commit and fresh retry starts at the authoritative base', async () => {
  const f = fixture(); const first = f.backend.prepareImplementer(f.run.id);
  const abandoned = commit(first.launch, 'unrecorded');
  fs.writeFileSync(join(first.launch.worktreePath, 'unfinished.txt'), 'preserve dirty work');
  f.backend.close(); f.backend.open();
  try {
    f.backend.reconcileAfterRestart();
    const second = f.backend.prepareImplementer(f.run.id);
    assert.notEqual(second.launch.sessionId, first.launch.sessionId);
    assert.notEqual(second.launch.candidateBranch, first.launch.candidateBranch);
    assert.equal(git(second.launch.worktreePath, 'rev-parse', 'HEAD'), f.run.baseSha);
    assert.equal(git(f.repository, 'rev-parse', first.launch.candidateBranch), abandoned);
    assert.equal(fs.readFileSync(join(first.launch.worktreePath, 'unfinished.txt'), 'utf8'), 'preserve dirty work');
    const sha = commit(second.launch, 'fresh accepted candidate');
    const snapshot = await complete(f, second, sha);
    assert.equal(snapshot.artifacts.length, 1);
    assert.equal(snapshot.artifacts[0].sha, sha);
    assert.equal(snapshot.artifacts[0].branch, second.launch.candidateBranch);
    assert.equal(snapshot.launches.find(launch => launch.id === first.launch.id).candidateBranch, first.launch.candidateBranch);
    assert.equal(git(f.repository, 'rev-parse', 'main'), f.run.baseSha);
    assert.equal(fs.readFileSync(join(f.repository, 'value.txt'), 'utf8'), 'base');
  } finally { f.backend.close(); }
});
test('repair retry starts at its acknowledged artifact, never the abandoned repair commit', async () => {
  const f = fixture();
  try {
    const worker = f.backend.prepareImplementer(f.run.id), firstSha = commit(worker.launch, 'first artifact');
    await complete(f, worker, firstSha);
    const critic = f.backend.prepareCritic(f.run.id);
    let snapshot = f.backend.submitCritic({ runId: f.run.id, launchId: critic.launch.id, token: critic.token,
      artifactSha: firstSha, contractDigest: f.backend.status(f.run.id).run.contract.digest, verdict: 'REVISE', summary: 'Fixture review',
      findings: [{ id: 'fix', severity: 'major', title: 'Fixture defect', evidence: 'Fixture only', criterionIds: [] }] });
    snapshot = f.backend.acknowledge({ runId: f.run.id, reportId: snapshot.reports[0].id, conductorLaunchId: 'conductor',
      decision: 'repair', acceptedFindingIds: ['fix'], rejectedFindings: [], rationale: 'Fixture accepted', repairInstructions: ['Repair value'] });
    const packet = snapshot.repairPackets[0];
    const firstRepair = f.backend.prepareRepairer(f.run.id, packet), abandoned = commit(firstRepair.launch, 'abandoned repair');
    f.backend.infrastructureFailure(f.run.id, 'Fixture transport interruption');
    const fresh = f.backend.prepareRepairer(f.run.id, packet);
    assert.equal(git(fresh.launch.worktreePath, 'rev-parse', 'HEAD'), firstSha);
    assert.notEqual(fresh.launch.candidateBranch, firstRepair.launch.candidateBranch);
    assert.notEqual(fresh.launch.sessionId, firstRepair.launch.sessionId);
    assert.equal(git(f.repository, 'rev-parse', firstRepair.launch.candidateBranch), abandoned);
    const sha = commit(fresh.launch, 'successful repair'); snapshot = await complete(f, fresh, sha);
    assert.equal(snapshot.run.status, 'awaiting_critic');
    assert.equal(snapshot.artifacts.at(-1).parentSha, firstSha);
    assert.equal(snapshot.artifacts.at(-1).branch, fresh.launch.candidateBranch);
  } finally { f.backend.close(); }
});
test('assigned-branch validation rejects a worker switching to another ref or detached HEAD', async () => {
  const f = fixture();
  try {
    const worker = f.backend.prepareImplementer(f.run.id), sha = commit(worker.launch, 'candidate');
    git(worker.launch.worktreePath, 'switch', '-c', 'outside-assignment');
    await assert.rejects(complete(f, worker, sha), /assigned candidate branch/);
    git(worker.launch.worktreePath, 'switch', '--detach');
    await assert.rejects(complete(f, worker, sha), /symbolic-ref/);
    assert.equal(f.backend.status(f.run.id).artifacts.length, 0);
    assert.equal(git(f.repository, 'rev-parse', worker.launch.candidateBranch), sha);
  } finally { f.backend.close(); }
});
test('a fresh-attempt branch collision fails closed even at the correct SHA', () => {
  const f = fixture();
  try {
    const branch = `${f.run.branch}-collision`; git(f.repository, 'branch', branch, f.run.baseSha);
    assert.throws(() => f.backend.workspaces.createCandidate({ repository: f.repository, runId: f.run.id, launchId: 'collision',
      branch, expectedSha: f.run.baseSha, requireNewBranch: true }), /already exists/);
    assert.equal(git(f.repository, 'rev-parse', branch), f.run.baseSha);
  } finally { f.backend.close(); }
});
for (const action of ['complete', 'retry']) test(`legacy launch without candidateBranch supports ${action} without resetting its ref`, async () => {
  const f = fixture(); const worker = f.backend.prepareImplementer(f.run.id);
  git(worker.launch.worktreePath, 'branch', '-m', f.run.branch);
  const sha = commit(worker.launch, 'legacy unrecorded candidate'); f.backend.close();
  // Disposable fixture models an existing pre-field JSON row. No user DB is modified.
  const db = new Database(join(f.options.stateRoot, 'gauntlet.db'));
  const legacy = JSON.parse(db.prepare('SELECT body_json FROM gauntlet_launches WHERE id=?').get(worker.launch.id).body_json);
  delete legacy.candidateBranch;
  db.prepare('UPDATE gauntlet_launches SET body_json=? WHERE id=?').run(JSON.stringify(legacy), worker.launch.id); db.close();
  f.backend.open();
  try {
    if (action === 'complete') {
      const snapshot = await complete(f, worker, sha); assert.equal(snapshot.artifacts[0].branch, f.run.branch);
    } else {
      f.backend.reconcileAfterRestart(); const fresh = f.backend.prepareImplementer(f.run.id);
      assert.equal(git(fresh.launch.worktreePath, 'rev-parse', 'HEAD'), f.run.baseSha);
      assert.notEqual(fresh.launch.candidateBranch, f.run.branch);
    }
    assert.equal(git(f.repository, 'rev-parse', f.run.branch), sha);
  } finally { f.backend.close(); }
});
