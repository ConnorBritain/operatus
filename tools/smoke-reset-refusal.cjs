'use strict';
// Actual IPC rejection in a disposable compiled desktop. Never use a personal profile.
const fs = require('node:fs');
const { join, resolve, basename } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { setElectronViewport } = require('./electron-viewport.cjs');
const root = process.argv[2], playwrightPath = process.argv[3];
if (!root || !basename(root).startsWith('operatus-run-control-') || !playwrightPath) throw Error('Disposable run-control fixture and installed Playwright path required');
const repo = resolve(__dirname, '..');
const compiled = fs.readFileSync(join(repo, 'out/main/index.js'), 'utf8');
if (!/ipcMain\.handle\(["']app:resetAll["'], refuseUnsafeReset\)/.test(compiled)) throw Error('Build with the refusal-only handler before this smoke');
const load = require('../test/load-ts.cjs');
if (!load('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Production launch hold required');
const reason = load('src/shared/resetPolicy.ts').RESET_UNAVAILABLE_REASON;
const fixture = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
async function main() {
  const env = { ...process.env, OPERATUS_RUN_INSPECT_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await require(playwrightPath)._electron.launch({ executablePath: require('electron'),
    args: [join(repo, 'test/fixtures/desktop-run-inspect.cjs')], env, timeout: 30000 });
  const page = await app.firstWindow(); const errors = [], images = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('button', { name: 'open', exact: true }).click();
    const before = await page.evaluate(async () => ({ config: await window.cth.getConfig(), runs: await window.cth.gauntletList(), storage: JSON.stringify({ ...localStorage }) }));
    const retainedBefore = await page.evaluate(id => window.cth.gauntletGet(id), fixture.ids.retained);
    const worktree = retainedBefore.launches.at(-1).worktreePath;
    const notes = fs.readFileSync(join(worktree, 'notes.txt'));
    const result = await page.evaluate(async () => {
      try { await window.cth.resetAll(); return 'unexpected success'; }
      catch (error) { return error.message; }
    });
    assert.ok(result.includes(reason));
    const after = await page.evaluate(async () => ({ config: await window.cth.getConfig(), runs: await window.cth.gauntletList(), storage: JSON.stringify({ ...localStorage }) }));
    assert.deepEqual(after, before, 'reset refusal must not change config, run state or renderer storage');
    assert.deepEqual(await page.evaluate(id => window.cth.gauntletGet(id), fixture.ids.retained), retainedBefore);
    assert.deepEqual(fs.readFileSync(join(worktree, 'notes.txt')), notes);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const button = page.getByRole('button', { name: 'reset unavailable', exact: true });
    for (const [width, height, label] of [[1440, 870, 'mac'], [1920, 1080, '1080p']]) {
      await setElectronViewport(app, page, { width, height });
      await button.scrollIntoViewIfNeeded();
      assert.equal(await button.isDisabled(), true);
      await page.getByText(reason, { exact: true }).waitFor();
      const image = join(root, `reset-refusal-${label}.png`); await page.screenshot({ path: image }); images.push(image);
    }
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    assert.deepEqual(errors, []);
    const receipt = { kind: 'compiled-desktop-reset-refused-no-models', unchangedRunCount: after.runs.length,
      retainedNotesSha256: createHash('sha256').update(notes).digest('hex'), images, errors };
    fs.writeFileSync(join(root, 'reset-refusal-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    await page.screenshot({ path: join(root, 'reset-refusal-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 10000)); throw error;
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
