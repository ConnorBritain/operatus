'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { ArtifactWorkspace, runFrozenChecks } = loadTs('src/main/gauntlet/worktree.ts');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('candidate and critic worktrees preserve exact immutable artifact identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'operatus-gauntlet-git-'));
  const repo = join(root, 'repo');
  const worktrees = join(root, 'worktrees');
  execFileSync('git', ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.name', 'Operatus Test']);
  git(repo, ['config', 'user.email', 'operatus@example.invalid']);
  writeFileSync(join(repo, 'value.txt'), 'one\n');
  git(repo, ['add', 'value.txt']);
  git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);

  const service = new ArtifactWorkspace(worktrees);
  const candidate = service.createCandidate({
    repository: repo,
    runId: 'run-1',
    launchId: 'impl-1',
    branch: 'operatus/gauntlet/run-1',
    expectedSha: base
  });
  writeFileSync(join(candidate.path, 'value.txt'), 'two\n');
  git(candidate.path, ['add', 'value.txt']);
  git(candidate.path, ['commit', '-m', 'artifact']);
  const result = service.validateArtifact(candidate, base);
  assert.equal(result.sha.length, 40);
  assert.match(result.diffSummary, /value\.txt/);
  service.release(candidate);

  const critic = service.createCritic({ repository: repo, runId: 'run-1', launchId: 'critic-1', artifactSha: result.sha });
  service.validateCriticUnchanged(critic);
  writeFileSync(join(critic.path, 'mutation.txt'), 'not allowed\n');
  assert.throws(() => service.validateCriticUnchanged(critic), /modified/);
  assert.throws(() => service.release(critic), /modified/, 'dirty critic worktree must be preserved');
});

test('frozen checks capture bounded timeout evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'operatus-gauntlet-check-'));
  const [receipt] = await runFrozenChecks(root, [{
    id: 'bounded-timeout',
    name: 'bounded timeout',
    command: 'sleep 2',
    timeoutMs: 50
  }]);
  assert.equal(receipt.checkId, 'bounded-timeout');
  assert.equal(receipt.timedOut, true);
  assert.notEqual(receipt.exitCode, 0);
  assert.ok(receipt.durationMs < 1_500);
});
