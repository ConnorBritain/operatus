'use strict';
// Manual compiled-Electron UI verification using disposable Git/SQLite data.
const fs = require('node:fs');
const { join, resolve, basename } = require('node:path');
const assert = require('node:assert/strict');
const { setElectronViewport } = require('./electron-viewport.cjs');
const root = process.argv[2], playwrightPath = process.argv[3];
if (!root || !basename(root).startsWith('operatus-run-control-') || !playwrightPath) {
  throw Error('Usage: node tools/smoke-attempt-branch-ui.cjs <disposable-fixture-root> <installed-playwright-path>');
}
const load = require('../test/load-ts.cjs');
if (!load('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Production launch hold required');
const fixture = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
const repo = resolve(__dirname, '..');
async function main() {
  const env = { ...process.env, OPERATUS_RUN_INSPECT_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const electron = await require(playwrightPath)._electron.launch({
    executablePath: require('electron'), args: [join(repo, 'test/fixtures/desktop-run-inspect.cjs')], env, timeout: 30000
  });
  const page = await electron.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('button', { name: 'open', exact: true }).click();
    await page.getByRole('button', { name: 'Runs', exact: true }).click();
    await page.locator(`[data-run-id="${fixture.ids.ack}"]`).click();
    await page.locator('[data-run-detail]').waitFor();
    const snapshot = await page.evaluate(id => window.cth.gauntletGet(id), fixture.ids.ack);
    const branch = snapshot.artifacts.at(-1).branch;
    assert.match(branch, /-attempt-/);
    const receipts = [];
    for (const [width, height, label] of [[1440, 870, 'mac'], [1920, 1080, '1080p']]) {
      await setElectronViewport(electron, page, { width, height });
      const branchText = page.locator('[data-run-detail]').getByText(branch, { exact: true }).last();
      await branchText.scrollIntoViewIfNeeded();
      const bounds = await branchText.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height);
      const image = join(root, `attempt-branch-${label}.png`); await page.screenshot({ path: image });
      receipts.push({ width, height, branch, bounds, image });
    }
    if (fixture.ids.retained) {
      await page.locator(`[data-run-id="${fixture.ids.retained}"]`).click();
      const retained = await page.evaluate(id => window.cth.gauntletGet(id), fixture.ids.retained);
      assert.equal(retained.artifacts.length, 0);
      const observation = retained.preservations.at(-1); assert.equal(observation.outcome, 'preserved');
      for (const [width, height, label] of [[1440, 870, 'mac'], [1920, 1080, '1080p']]) {
        await setElectronViewport(electron, page, { width, height });
        const card = page.locator(`[data-preservation-receipt="${observation.id}"]`);
        await card.scrollIntoViewIfNeeded();
        await card.getByText('Location and receipt', { exact: true }).click();
        const observed = card.getByText(observation.observedSha, { exact: true });
        await observed.scrollIntoViewIfNeeded();
        const bounds = await observed.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height);
        const image = join(root, `preservation-${label}.png`); await page.screenshot({ path: image });
        receipts.push({ width, height, observedSha: observation.observedSha, bounds, image });
        await card.getByText('Location and receipt', { exact: true }).click();
      }
    }
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    assert.deepEqual(errors, []);
    fs.writeFileSync(join(root, 'branch-ui-receipt.json'), JSON.stringify({ kind: 'synthetic-ui-no-models', receipts, errors }, null, 2));
    console.log(JSON.stringify({ root, receipts, errors }));
  } finally { await electron.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
