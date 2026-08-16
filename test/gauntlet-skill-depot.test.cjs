'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { SkillDepot } = loadTs('src/main/gauntlet/skillDepot.ts');

function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }

test('Skill Depot pins manually, locks receipts, materializes support files read-only, and rejects symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'ventura-skill-depot-'));
  const source = join(root, 'source.git');
  execFileSync('git', ['init', '-b', 'main', source]);
  git(source, ['config', 'user.name', 'Ventura Test']);
  git(source, ['config', 'user.email', 'ventura@example.invalid']);
  const skill = join(source, 'skills', 'engineering', 'review-well');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: review-well\ndescription: Review carefully\n---\nRead support.md.\n');
  writeFileSync(join(skill, 'support.md'), 'version one\n');
  const experimental = join(source, 'skills', 'in-progress', 'experimental-helper');
  mkdirSync(experimental, { recursive: true });
  writeFileSync(join(experimental, 'SKILL.md'), '---\nname: experimental-helper\ndescription: Explicit opt-in only\n---\nExperiment carefully.\n');
  const installMarker = join(root, 'repository-install-script-ran');
  writeFileSync(join(source, 'package.json'), `${JSON.stringify({ scripts: { postinstall: `touch ${installMarker}` } }, null, 2)}\n`);
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'skill v1']);
  const pinned = git(source, ['rev-parse', 'HEAD']);

  writeFileSync(join(skill, 'support.md'), 'version two must not appear until repinned\n');
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'skill v2']);

  const depot = new SkillDepot(join(root, 'depot'), { allowFileSources: true });
  depot.initialize();
  depot.saveSources([{
    id: 'local-skills', url: `file://${source}`, pinnedCommit: pinned, enabled: true,
    include: ['skills/engineering'], optIn: ['skills/in-progress']
  }]);
  const catalog = depot.sync('local-skills');
  assert.deepEqual(catalog.map((entry) => entry.name), ['experimental-helper', 'review-well']);
  assert.equal(catalog.find((entry) => entry.name === 'experimental-helper').optIn, true);
  assert.equal(existsSync(installMarker), false, 'synchronization must never execute repository install scripts');
  const lock = depot.lock('run-1', [{ role: 'critic', sourceId: 'local-skills', skillName: 'review-well' }]);
  assert.equal(lock.entries[0].sourceCommit, pinned);
  const destination = join(root, 'agent-home', 'skills');
  depot.materialize(lock, 'critic', destination);
  assert.equal(readFileSync(join(destination, 'review-well', 'support.md'), 'utf8'), 'version one\n');
  assert.equal(lstatSync(join(destination, 'review-well', 'support.md')).mode & 0o222, 0);

  const cachedSupport = join(root, 'depot', 'checkouts', 'local-skills', 'skills', 'engineering', 'review-well', 'support.md');
  unlinkSync(cachedSupport);
  assert.throws(
    () => depot.materialize(lock, 'critic', join(root, 'changed-agent-home', 'skills')),
    /skill changed after lock/,
    'a missing support file invalidates the locked tree digest'
  );

  depot.saveSources([{
    id: 'local-skills', url: `file://${source}`, pinnedCommit: pinned, enabled: false,
    include: ['skills/engineering'], optIn: ['skills/in-progress']
  }]);
  assert.throws(() => depot.sync('local-skills'), /source is disabled/);
  depot.saveSources([{
    id: 'local-skills', url: `file://${source}`, pinnedCommit: pinned, enabled: true,
    include: ['skills/engineering'], optIn: ['skills/in-progress']
  }]);
  depot.sync('local-skills');

  assert.throws(() => depot.lock('run-2', [
    { role: 'critic', sourceId: 'local-skills', skillName: 'review-well' },
    { role: 'critic', sourceId: 'local-skills', skillName: 'review-well' }
  ]), /collision/);
  assert.throws(() => depot.saveSources([{
    id: 'unsafe', url: `file://${source}`, pinnedCommit: pinned, enabled: true,
    include: ['../escape'], optIn: []
  }]), /unsafe Skill Depot path/);

  // A repository can add hostile content after the safe pin. Repinning to that
  // commit still fails discovery before anything is materialized.
  chmodSync(skill, 0o755);
  chmodSync(join(skill, 'SKILL.md'), 0o644);
  chmodSync(join(skill, 'support.md'), 0o644);
  symlinkSync('../shared.md', join(skill, 'escape-link'));
  writeFileSync(join(source, 'skills', 'engineering', 'shared.md'), 'not allowed through a link\n');
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'hostile symlink']);
  const hostile = git(source, ['rev-parse', 'HEAD']);
  depot.saveSources([{
    id: 'local-skills', url: `file://${source}`, pinnedCommit: hostile, enabled: true,
    include: ['skills/engineering'], optIn: ['skills/in-progress']
  }]);
  assert.throws(() => depot.sync('local-skills'), /symlink rejected/);
});
