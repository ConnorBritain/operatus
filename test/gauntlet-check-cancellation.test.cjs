'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const mac = { skip: process.platform !== 'darwin', timeout: 20000 };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'condition timed out'); await sleep(10); }
}
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-cancel-check-'));
  const backend = new LocalGauntletBackend({ stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') });
  backend.open();
  function project(name) {
    const repository = join(root, name); fs.mkdirSync(repository);
    git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(join(repository, 'README.md'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
    const run = backend.start({ repository, objective: name }).run;
    backend.freeze(run.id, { objective: name, criteria: ['Real isolated check'], checks: [
      { id: 'controlled', name: 'Controlled check', command: 'node check.cjs', timeoutMs: 10000 }
    ], constraints: [], exclusions: [] });
    const worker = backend.prepareImplementer(run.id), cwd = worker.launch.worktreePath;
    fs.writeFileSync(join(cwd, 'check.cjs'), `const fs=require('fs');
fs.writeFileSync('pid.txt',String(process.pid));
const timer=setInterval(()=>{if(fs.existsSync('continue.txt')){
 clearInterval(timer); fs.unlinkSync('continue.txt'); fs.unlinkSync('pid.txt');
 console.log('verified ${name}');
}},20);`);
    git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'candidate');
    const input = { runId: run.id, launchId: worker.launch.id, token: worker.token, sha: git(cwd, 'rev-parse', 'HEAD') };
    // Immediately observe rejection so a fast cancellation cannot produce an
    // unhandled-rejection warning while this test is waiting on its peer.
    const result = backend.completeArtifact(input).then(snapshot => ({ snapshot }), error => ({ error }));
    return { run, cwd, worker, input, result };
  }
  return { root, backend, project };
}
async function started(project) {
  await until(() => fs.existsSync(join(project.cwd, 'pid.txt')));
  return Number(fs.readFileSync(join(project.cwd, 'pid.txt'), 'utf8'));
}
async function gone(pid) {
  await until(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
}
function assertPreserved(project) {
  assert.ok(fs.existsSync(project.cwd));
  assert.equal(git(project.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD');
  assert.match(git(project.cwd, 'worktree', 'list', '--porcelain'), /locked Operatus:/);
}

test('cancelling one checking project kills only its check and its peer records the exact artifact', mac, async () => {
  const f = fixture(), a = f.project('ledger'), b = f.project('website');
  try {
    const [aPid, bPid] = await Promise.all([started(a), started(b)]);
    await assert.rejects(f.backend.completeArtifact(a.input), /already in progress/);
    await assert.rejects(f.backend.completeArtifact({ ...a.input, token: 'forged' }));
    assert.equal(f.backend.isCompleting(a.run.id), true);
    const cancelled = f.backend.cancel(a.run.id, 'Stop ledger only');
    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(cancelled.preservations.at(-1).outcome, 'pending');
    assert.equal(f.backend.isCompleting(a.run.id), true, 'drain remains owned until process close');
    const stopped = await a.result;
    assert.match(stopped.error?.message, /interrupted/); await gone(aPid);
    assertPreserved(a); assert.equal(f.backend.status(a.run.id).artifacts.length, 0);
    assert.equal(f.backend.status(a.run.id).preservations.at(-1).outcome, 'preserved');
    assert.equal(f.backend.status(a.run.id).preservations.at(-1).observedSha, a.input.sha);
    assert.equal(f.backend.isCompleting(a.run.id), false);
    process.kill(bPid, 0);
    assert.equal(f.backend.status(b.run.id).run.status, 'implementer_in_flight');
    fs.writeFileSync(join(b.cwd, 'continue.txt'), 'continue');
    const completed = await b.result; assert.ifError(completed.error);
    assert.equal(completed.snapshot.run.status, 'awaiting_critic');
    assert.equal(completed.snapshot.artifacts[0].sha, b.input.sha);
    assert.equal(completed.snapshot.artifacts[0].checkReceipts[0].exitCode, 0);
    assert.match(completed.snapshot.artifacts[0].checkReceipts[0].output, /verified website/);
    assert.equal(f.backend.status(a.run.id).run.status, 'cancelled');
  } finally { f.backend.close(); await Promise.all([a.result, b.result]); }
});
for (const action of ['escalate', 'infrastructureFailure']) test(`${action} interrupts checks and preserves the old launch before any retry`, mac, async () => {
  const f = fixture(), a = f.project(action);
  try {
    const pid = await started(a);
    const next = f.backend[action](a.run.id, 'Fixture interruption');
    assert.equal(next.run.status, action === 'escalate' ? 'human_required' : 'awaiting_implementation');
    if (action === 'infrastructureFailure') assert.throws(() => f.backend.prepareImplementer(a.run.id), /still draining/);
    assert.match((await a.result).error?.message, /interrupted/); await gone(pid);
    assertPreserved(a); assert.equal(f.backend.status(a.run.id).artifacts.length, 0);
    assert.equal(f.backend.isCompleting(a.run.id), false);
    if (action === 'infrastructureFailure') {
      const retry = f.backend.prepareImplementer(a.run.id);
      assert.notEqual(retry.launch.candidateBranch, a.worker.launch.candidateBranch);
      assert.equal(git(retry.launch.worktreePath, 'rev-parse', 'HEAD'), a.run.baseSha);
      assert.equal(git(a.cwd, 'rev-parse', a.worker.launch.candidateBranch), a.input.sha);
    }
  } finally { f.backend.close(); await a.result; }
});
test('closing the backend aborts direct completions before a late SQLite write', mac, async () => {
  const f = fixture(), a = f.project('close');
  try {
    const pid = await started(a); f.backend.close();
    assert.throws(() => f.backend.open(), /still|draining/);
    assert.match((await a.result).error?.message, /closing/); await gone(pid);
    f.backend.open();
    assert.equal(f.backend.status(a.run.id).artifacts.length, 0);
    assert.equal(f.backend.status(a.run.id).run.status, 'implementer_in_flight');
  } finally { f.backend.close(); await a.result; }
});
