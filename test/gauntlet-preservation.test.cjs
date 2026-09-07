'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const { join } = require('node:path'); const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto'); const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3'); const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-preserve-')));
  const repository = join(root, 'repo'); fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'value.txt'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
  const stateRoot = join(root, 'state'), updates = [];
  const backend = new LocalGauntletBackend({ stateRoot, primitiveRoot: join(__dirname, '../vendor/agent-primitives'), onEvidence: snapshot => updates.push(snapshot) });
  backend.open(); const run = backend.start({ repository, objective: 'Preserve abandoned work' }).run;
  backend.freeze(run.id, { objective: run.requestedObjective, criteria: ['observable'], checks: [], constraints: [], exclusions: [] });
  const worker = backend.prepareImplementer(run.id), cwd = worker.launch.worktreePath;
  fs.writeFileSync(join(cwd, 'value.txt'), 'abandoned'); git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'abandoned');
  const sha = git(cwd, 'rev-parse', 'HEAD');
  return { root, repository, stateRoot, backend, run, worker, cwd, sha, updates };
}
function request(f) {
  const id = randomUUID(); return { id, requestId: id, runId: f.run.id, launchId: f.worker.launch.id,
    worktreePath: f.cwd, candidateBranch: f.worker.launch.candidateBranch, expectedSha: f.worker.launch.expectedSha,
    observedSha: null, dirty: null, outcome: 'pending', reason: 'Fixture retention', error: null, createdAt: Date.now() };
}
test('cancel stores an exact observation, not an artifact; receipts survive reopen and push after the transition', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(join(f.cwd, 'unfinished.txt'), 'dirty');
    const snapshot = f.backend.cancel(f.run.id, 'Keep this experiment');
    assert.deepEqual(snapshot.preservations.map(r => r.outcome), ['pending', 'preserved']);
    const receipt = snapshot.preservations[1];
    assert.equal(receipt.observedSha, f.sha); assert.equal(receipt.expectedSha, f.run.baseSha); assert.equal(receipt.dirty, true);
    assert.equal(receipt.launchId, f.worker.launch.id); assert.equal(receipt.worktreePath, f.cwd);
    assert.equal(snapshot.artifacts.length, 0); assert.equal(snapshot.run.currentArtifactSha, null);
    await Promise.resolve(); assert.equal(f.updates.at(-1).run.status, 'cancelled');
    assert.equal(f.updates.at(-1).preservations.at(-1).id, receipt.id);
    f.backend.close(); f.backend.open();
    assert.deepEqual(f.backend.status(f.run.id).preservations, snapshot.preservations);
    assert.equal(fs.readFileSync(join(f.cwd, 'unfinished.txt'), 'utf8'), 'dirty');
  } finally { f.backend.close(); }
});
test('missing worktree is recorded as missing, never successfully preserved', () => {
  const f = fixture();
  try {
    fs.renameSync(f.cwd, join(f.root, 'retained-moved-worktree'));
    const snapshot = f.backend.cancel(f.run.id, 'Moved fixture'); const receipt = snapshot.preservations.at(-1);
    assert.equal(receipt.outcome, 'missing'); assert.equal(receipt.observedSha, null);
    assert.match(snapshot.run.stopReason, /missing/); assert.equal(snapshot.artifacts.length, 0);
  } finally { f.backend.close(); }
});
test('switched branches yield a failed receipt without detaching that unrelated branch', () => {
  const f = fixture();
  try {
    git(f.cwd, 'switch', '-c', 'outside-assignment');
    const snapshot = f.backend.infrastructureFailure(f.run.id, 'Wrong branch'); const receipt = snapshot.preservations.at(-1);
    assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.observedSha, f.sha);
    assert.match(receipt.error, /another branch/); assert.equal(snapshot.run.status, 'infrastructure_failure');
    assert.equal(git(f.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'outside-assignment');
  } finally { f.backend.close(); }
});
test('pending preservation on a terminal run is reconciled after restart without rewriting its run events', () => {
  const f = fixture();
  try {
    const pending = request(f); f.backend.store.recordPreservation(pending);
    const before = f.backend.status(f.run.id);
    f.backend.store.transition(f.run.id, before.run.version, { type: 'CANCELLED', at: Date.now(), reason: 'Interrupted cleanup fixture' });
    const stopped = f.backend.status(f.run.id); f.backend.close(); f.backend.open();
    f.backend.reconcileAfterRestart();
    const after = f.backend.status(f.run.id);
    assert.equal(after.run.status, 'cancelled'); assert.deepEqual(after.events, stopped.events);
    assert.equal(after.preservations.at(-1).requestId, pending.id); assert.equal(after.preservations.at(-1).observedSha, f.sha);
    assert.equal(after.preservations.at(-1).outcome, 'preserved'); assert.equal(f.backend.store.unfinishedPreservations().length, 0);
    f.backend.reconcileAfterRestart(); assert.equal(f.backend.status(f.run.id).preservations.length, 2);
  } finally { f.backend.close(); }
});
test('receipts are idempotent, immutable, launch-bound and cannot invent successful observations', () => {
  const f = fixture();
  try {
    const snapshot = f.backend.cancel(f.run.id, 'Keep'); const [pending, finished] = snapshot.preservations;
    f.backend.store.recordPreservation(pending); f.backend.store.recordPreservation(finished);
    assert.equal(f.backend.status(f.run.id).preservations.length, 2);
    assert.throws(() => f.backend.store.recordPreservation({ ...finished, observedSha: 'f'.repeat(40) }), /immutable/);
    assert.throws(() => f.backend.store.recordPreservation({ ...finished, observedSha: null }), /observation/);
    assert.throws(() => f.backend.store.recordPreservation({ ...finished, worktreePath: f.repository }), /match its launch/);
    assert.throws(() => f.backend.store.recordPreservation({ ...finished, requestId: 'missing' }), /matching request/);
    assert.throws(() => f.backend.store.recordPreservation({ ...pending, observedSha: f.sha }), /pending preservation/);
    assert.equal(f.backend.status(f.run.id).preservations.length, 2);
  } finally { f.backend.close(); }
});
test('version-one migration retains runs and rejects a future schema without downgrading it', () => {
  const f = fixture(); f.backend.close();
  let db = new Database(join(f.stateRoot, 'gauntlet.db'));
  db.exec('DROP TABLE gauntlet_preservations'); db.prepare('DELETE FROM gauntlet_schema_migrations WHERE version=2').run(); db.pragma('user_version=1'); db.close();
  f.backend.open(); assert.equal(f.backend.status(f.run.id).run.currentLaunchId, f.worker.launch.id); assert.deepEqual(f.backend.status(f.run.id).preservations, []); f.backend.close();
  db = new Database(join(f.stateRoot, 'gauntlet.db')); assert.equal(db.pragma('user_version', { simple: true }), 10); db.pragma('user_version=11'); db.close();
  assert.throws(() => f.backend.open(), /newer application/);
  db = new Database(join(f.stateRoot, 'gauntlet.db')); assert.equal(db.pragma('user_version', { simple: true }), 11); db.close();
});
