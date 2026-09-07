'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { legacyCleanupError } = load('src/main/gauntlet/cleanupOwnership.ts');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const { removeWorktree } = load('src/main/git.ts');
const emptyAuthority = { findLaunch: () => null, hasLaunchAtWorktree: () => false };
function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-cleanup-')));
  const repo = join(root, 'repo'); fs.mkdirSync(repo);
  const git = args => execFileSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Cleanup Test']); git(['config', 'user.email', 'cleanup@example.invalid']);
  fs.writeFileSync(join(repo, 'base.txt'), 'base'); git(['add', '.']); git(['commit', '-m', 'base']);
  return { root, repo, git };
}

test('generic cleanup veto covers managed roots, ancestors, aliases, missing children and unknown authority', () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-cleanup-path-')));
  const managedRoot = join(root, 'state', 'worktrees', 'gauntlet'); fs.mkdirSync(managedRoot, { recursive: true });
  const alias = join(root, 'alias'); fs.symlinkSync(managedRoot, alias);
  for (const path of [root, managedRoot, alias, join(alias, 'absent', 'child'), join(managedRoot, 'absent')]) {
    assert.match(legacyCleanupError({ id: 'ordinary', path, managedRoot }, emptyAuthority), /overlaps/);
  }
  const ordinary = join(root, 'ordinary'); fs.mkdirSync(ordinary);
  const input = { id: 'ordinary', path: ordinary, managedRoot };
  assert.equal(legacyCleanupError(input, emptyAuthority), null);
  assert.match(legacyCleanupError(input, null), /unavailable/);
  assert.match(legacyCleanupError(input, { ...emptyAuthority, findLaunch() { throw Error('database closed'); } }), /could not be verified/);
  const loop = join(root, 'loop'); fs.symlinkSync(loop, loop);
  assert.match(legacyCleanupError({ ...input, path: loop }, emptyAuthority), /could not be verified/);
});

test('real SQLite ownership protects terminal launches and historical worktree locations independently of renderer labels', () => {
  const { root, repo } = repository();
  const backend = new LocalGauntletBackend({ stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') });
  backend.open();
  try {
    const run = backend.start({ repository: repo, objective: 'Keep this experiment' }).run;
    backend.freeze(run.id, { objective: run.requestedObjective, criteria: ['Preserve changes'], checks: [], constraints: [], exclusions: [] });
    const { launch } = backend.prepareImplementer(run.id);
    fs.writeFileSync(join(launch.worktreePath, 'notes.txt'), 'not disposable');
    backend.cancel(run.id, 'test retained history');
    const managedRoot = join(root, 'different-profile', 'gauntlet');
    // The old location is outside today's managed root. SQLite still owns it.
    assert.match(legacyCleanupError({ id: 'disguised-ordinary', path: launch.worktreePath, managedRoot }, backend.store), /recorded/);
    assert.match(legacyCleanupError({ id: `pty-${launch.id}`, path: repo, managedRoot }, backend.store), /launch belongs/);
    const alias = join(root, 'retained-alias'); fs.symlinkSync(launch.worktreePath, alias);
    assert.match(legacyCleanupError({ id: 'other', path: alias, managedRoot }, backend.store), /recorded/);
    assert.equal(fs.readFileSync(join(launch.worktreePath, 'notes.txt'), 'utf8'), 'not disposable');
    backend.close();
    assert.match(legacyCleanupError({ id: 'other', path: repo, managedRoot }, backend.store), /could not be verified/);
  } finally { backend.close(); }
});

test('ordinary Git cleanup removes a clean worktree but refuses dirty and locked worktrees', async () => {
  const { root, repo, git } = repository();
  const clean = join(root, 'clean'), dirty = join(root, 'dirty'), locked = join(root, 'locked');
  for (const [name, path] of [['clean', clean], ['dirty', dirty], ['locked', locked]]) git(['worktree', 'add', '-b', name, path]);
  fs.writeFileSync(join(dirty, 'notes.txt'), 'unfinished ordinary work');
  git(['worktree', 'lock', '--reason', 'retain', locked]);
  assert.equal((await removeWorktree(repo, dirty)).ok, false);
  assert.equal(fs.readFileSync(join(dirty, 'notes.txt'), 'utf8'), 'unfinished ordinary work');
  assert.equal((await removeWorktree(repo, locked)).ok, false);
  assert.equal(fs.existsSync(locked), true);
  assert.equal((await removeWorktree(repo, clean)).ok, true);
  assert.equal(fs.existsSync(clean), false);
  assert.equal(git(['rev-parse', 'clean']), git(['rev-parse', 'main']), 'branch remains recoverable');
});

test('desktop removal and scratch GC route through the ownership veto', () => {
  const source = fs.readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8');
  const wrapper = source.slice(source.indexOf('async function removeWorktree('), source.indexOf('function teardownPty('));
  assert.ok(wrapper.indexOf('ordinaryCleanupError(id, path)') < wrapper.indexOf('removeOrdinaryWorktree(cwd, path)'));
  assert.equal((source.match(/removeOrdinaryWorktree\(/g) || []).length, 1);
  for (const call of ['removeWorktree(origCwd, wtPath, id)', 'removeWorktree(origCwd, wtPath, worker.workerId)', 'removeWorktree(e.origCwd, e.wtPath, e.workerId)']) assert.ok(source.includes(call));
  const scratch = source.slice(source.indexOf('function removeWorkerScratch('), source.indexOf('// A natural PTY exit'));
  assert.ok(scratch.indexOf('ordinaryCleanupError(workerId, dir)') < scratch.indexOf('rmSync(dir,'));
});
