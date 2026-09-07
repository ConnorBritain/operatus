'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireLock, isAppRunning, swapBundle, shellQuote } = require('../tools/refresh-local-app.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operatus-refresh-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = path.join(root, 'Operatus.app'), next = path.join(root, 'next.app'), backup = path.join(root, 'previous.app');
  fs.mkdirSync(old); fs.mkdirSync(next);
  fs.writeFileSync(path.join(old, 'version'), 'old'); fs.writeFileSync(path.join(next, 'version'), 'new');
  return { root, old, next, backup };
}

test('running app or helper prevents installation; similarly named app does not', () => {
  assert.equal(isAppRunning('/Applications/Operatus.app', '/Applications/Operatus.app/Contents/MacOS/Operatus\n'), true);
  assert.equal(isAppRunning('/Applications/Operatus.app', '/Applications/Operatus.app/Contents/Frameworks/helper'), true);
  assert.equal(isAppRunning('/Applications/Operatus.app', '/Applications/Operatus.app-other/Contents/test'), false);
});
test('busy app leaves old and staged bundles untouched', t => {
  const f = fixture(t);
  assert.throws(() => swapBundle(f.next, f.old, f.backup, () => true), /Quit Operatus/);
  assert.equal(fs.readFileSync(path.join(f.old, 'version'), 'utf8'), 'old');
  assert.ok(fs.existsSync(f.next)); assert.ok(!fs.existsSync(f.backup));
});
test('closed app swaps with previous version preserved and profile untouched', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'profile'), 'saved runs');
  swapBundle(f.next, f.old, f.backup, () => false);
  assert.equal(fs.readFileSync(path.join(f.old, 'version'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(f.backup, 'version'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(f.root, 'profile'), 'utf8'), 'saved runs');
});
test('failed replacement restores old application', t => {
  const f = fixture(t);
  assert.throws(() => swapBundle(f.next, f.old, f.backup, () => false, (from, to) => {
    if (from === f.next) throw new Error('simulated filesystem failure');
    fs.renameSync(from, to);
  }), /simulated filesystem/);
  assert.equal(fs.readFileSync(path.join(f.old, 'version'), 'utf8'), 'old');
  assert.ok(fs.existsSync(f.next));
});
test('existing backup and symlink targets are refused', t => {
  const f = fixture(t); fs.mkdirSync(f.backup);
  assert.throws(() => swapBundle(f.next, f.old, f.backup, () => false), /Backup already/);
  const link = path.join(f.root, 'link.app'); fs.symlinkSync(f.old, link);
  assert.throws(() => swapBundle(f.next, link, path.join(f.root, 'unused'), () => false), /real directory/);
});
test('refresh lock prevents concurrent builds and is released explicitly', t => {
  const f = fixture(t); const release = acquireLock(path.join(f.root, 'updates'));
  assert.throws(() => acquireLock(path.join(f.root, 'updates')), /Another refresh/);
  release(); acquireLock(path.join(f.root, 'updates'))();
});
test('launcher quotes spaces and apostrophes literally', () => {
  assert.equal(shellQuote("/A B/it's/node"), "'/A B/it'\\''s/node'");
});
test('first installation works without inventing a previous version', t => {
  const f = fixture(t); const destination = path.join(f.root, 'fresh.app');
  swapBundle(f.next, destination, f.backup, () => false);
  assert.equal(fs.readFileSync(path.join(destination, 'version'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(f.backup));
});
test('running-process inspection failure stops before moving anything', t => {
  const f = fixture(t);
  assert.throws(() => swapBundle(f.next, f.old, f.backup, () => { throw Error('ps unavailable'); }), /ps unavailable/);
  assert.ok(fs.existsSync(f.next)); assert.ok(fs.existsSync(f.old)); assert.ok(!fs.existsSync(f.backup));
});
test('same swap primitive supports restoring the previous app without losing the newer app', t => {
  const f = fixture(t);
  swapBundle(f.next, f.old, f.backup, () => false);
  const displaced = path.join(f.root, 'displaced.app');
  swapBundle(f.backup, f.old, displaced, () => false);
  assert.equal(fs.readFileSync(path.join(f.old, 'version'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(displaced, 'version'), 'utf8'), 'new');
});
