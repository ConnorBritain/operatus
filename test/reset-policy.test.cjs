'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const load = require('./load-ts.cjs');
const { refuseUnsafeReset } = load('src/main/reset.ts');
const { RESET_UNAVAILABLE_REASON } = load('src/shared/resetPolicy.ts');

test('reset always rejects, including forged confirmation or bypass payloads', () => {
  for (const value of [undefined, true, { force: true }, { confirmed: true, safe: true }, { dryRun: false }]) {
    assert.throws(() => refuseUnsafeReset(value), { message: RESET_UNAVAILABLE_REASON });
  }
});

test('main retains only the refusal handler and Settings cannot clear state through reset', () => {
  const main = fs.readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8');
  assert.ok(main.includes("ipcMain.handle('app:resetAll', refuseUnsafeReset)"));
  assert.equal((main.match(/app:resetAll/g) || []).length, 1);
  const reset = fs.readFileSync(join(__dirname, '../src/main/reset.ts'), 'utf8');
  assert.doesNotMatch(reset, /node:fs|node:child_process|relaunch\(|exit\(|resetConfig\(/);
  const renderer = fs.readFileSync(join(__dirname, '../src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  assert.doesNotMatch(renderer, /window\.cth\.resetAll\(|erase everything & restart|setConfirming\(/);
  assert.match(renderer, /disabled title=\{RESET_UNAVAILABLE_REASON\}/);
});
