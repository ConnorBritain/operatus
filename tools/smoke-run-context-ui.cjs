'use strict';
// Real compiled desktop, real disposable Git/SQLite snapshots, no providers.
const fs = require('node:fs');
const { join, resolve, basename } = require('node:path');
const assert = require('node:assert/strict');
const { setElectronViewport } = require('./electron-viewport.cjs');
const root = process.argv[2], playwrightPath = process.argv[3];
if (!root || !basename(root).startsWith('operatus-run-control-') || !playwrightPath) {
  throw Error('Usage: node tools/smoke-run-context-ui.cjs <disposable-fixture-root> <installed-playwright-path>');
}
const repo = resolve(__dirname, '..');
if (!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Production launch hold required');
const fixture = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
async function main() {
  const env = { ...process.env, OPERATUS_RUN_INSPECT_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const { _electron } = require(playwrightPath);
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [join(repo, 'test/fixtures/desktop-run-inspect.cjs')], env, timeout: 30000 });
  const page = await app.firstWindow(); const errors = [], receipts = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('button', { name: 'open', exact: true }).click();
    await page.getByRole('button', { name: /^Runs(?: ·|$)/ }).click();
    const area = page.getByLabel('Run evidence scroll area', { exact: true });
    for (const [width, height, label] of [[1440, 870, 'mac'], [1920, 1080, '1080p']]) {
      await setElectronViewport(app, page, { width, height });
      await page.getByLabel('Search runs', { exact: true }).fill('');
      await page.locator(`[data-run-id="${fixture.ids.ack}"]`).click();
      const ack = await page.evaluate(id => window.cth.gauntletGet(id), fixture.ids.ack);
      const context = page.getByLabel('Selected run context', { exact: true });
      await page.locator(`[data-run-context="${ack.run.id}"]`).waitFor();
      assert.ok((await context.innerText()).includes(ack.run.requestedObjective));
      assert.ok((await context.innerText()).includes(ack.run.repository));
      assert.ok((await context.innerText()).includes('Conductor'));
      assert.equal(await area.evaluate(el => el.scrollTop), 0, 'selection starts at overview');
      const initial = await context.boundingBox();
      await area.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await area.evaluate(el => el.scrollTop > 100), 'actually scrolled into evidence');
      assert.deepEqual(await context.boundingBox(), initial, 'context stays fixed while evidence scrolls');
      const contentBounds = await area.boundingBox();
      assert.ok(initial.y >= 0 && initial.y + initial.height <= contentBounds.y + 1);
      assert.ok(contentBounds.height > height / 2, 'context leaves most space for evidence');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByLabel('Search runs', { exact: true }).fill('no-matching-objective');
      await context.getByText('Viewing a run outside the current list filters.', { exact: true }).waitFor();
      assert.equal(await context.getAttribute('data-run-context'), ack.run.id, 'filter does not silently switch run');
      await context.getByRole('button', { name: 'overview', exact: true }).click();
      assert.equal(await area.evaluate(el => el.scrollTop), 0);
      await page.getByLabel('Search runs', { exact: true }).fill('');
      await area.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.locator(`[data-run-id="${fixture.ids.retained}"]`).click();
      const retained = await page.evaluate(id => window.cth.gauntletGet(id), fixture.ids.retained);
      await page.locator(`[data-run-context="${retained.run.id}"]`).waitFor();
      assert.equal(await area.evaluate(el => el.scrollTop), 0, 'cross-project switch resets evidence position');
      assert.notEqual(retained.run.repository, ack.run.repository);
      assert.ok((await context.innerText()).includes(retained.run.repository));
      assert.ok(!(await context.innerText()).includes(ack.run.requestedObjective));
      assert.equal(await page.locator('[data-run-detail]').getAttribute('data-run-detail'), retained.run.id);
      const card = page.locator(`[data-preservation-receipt="${retained.preservations.at(-1).id}"]`);
      await card.scrollIntoViewIfNeeded();
      const image = join(root, `run-context-${label}.png`); await page.screenshot({ path: image });
      receipts.push({ width, height, selectedRun: retained.run.id, repository: retained.run.repository,
        initialContextBounds: initial, evidenceBounds: contentBounds, image });
    }
    await page.getByRole('button', { name: 'skill depot', exact: true }).click();
    assert.equal(await page.locator('[data-run-context]').count(), 0, 'depot does not inherit a run heading');
    await page.getByRole('button', { name: 'close skill depot', exact: true }).click();
    await page.locator(`[data-run-context="${fixture.ids.retained}"]`).waitFor();
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    assert.deepEqual(errors, []);
    const result = { kind: 'compiled-desktop-synthetic-runs-no-models', receipts, errors };
    fs.writeFileSync(join(root, 'run-context-ui-receipt.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await page.screenshot({ path: join(root, 'run-context-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 12000));
    throw error;
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
