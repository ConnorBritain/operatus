'use strict';
// Compiled app and real preload/store; explicitly synthetic roster/terminal IPC.
// This tests view transitions, NOT actual worker execution or PTY liveness.
const fs = require('node:fs');
const { join, resolve, basename } = require('node:path');
const assert = require('node:assert/strict');
const { setElectronViewport, assertTerminalCanvasScale } = require('./electron-viewport.cjs');
const root = process.argv[2], playwrightPath = process.argv[3];
if (!root || !basename(root).startsWith('operatus-run-control-') || !playwrightPath) {
  throw Error('Usage: node tools/smoke-agent-view-ui.cjs <fresh-disposable-fixture-root> <installed-playwright-path>');
}
const repo = resolve(__dirname, '..');
if (!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Production launch hold required');
const fixture = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
async function main() {
  const env = { ...process.env, OPERATUS_RUN_INSPECT_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const { _electron } = require(playwrightPath);
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [join(repo, 'test/fixtures/desktop-run-inspect.cjs')], env, timeout: 30000 });
  const page = await app.firstWindow(), errors = [], receipts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const send = (channel, payload) => app.evaluate(({ BrowserWindow }, packet) => {
    BrowserWindow.getAllWindows()[0].webContents.send(packet.channel, packet.payload);
  }, { channel, payload });
  const arrive = (id, index) => send('hive:agentSpawned', { id, name: id,
    cwd: fixture.repositories[index % fixture.repositories.length], provider: 'codex', command: 'codex',
    role: 'Synthetic view fixture; no provider running', lifecycleOwner: 'gauntlet', gauntletRunId: 'ui-fixture-only' });
  const selected = () => page.evaluate(() => {
    const {home}=window.cth.rosterBootSync();
    const cache=home?localStorage.getItem(`operatus.roster.v1:${encodeURIComponent(home)}`):null;
    return cache?JSON.parse(cache).roster.selectedId:null;
  });
  const focused = () => page.locator('[data-focused-agent]');
  try {
    await page.getByRole('button', { name: 'open', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    for (const [width, height, label] of [[1440, 870, 'mac'], [1920, 1080, '1080p']]) {
      const viewport = await setElectronViewport(app, page, { width, height });
      const first = `Fixture lead ${label}`, second = `Fixture reviewer ${label}`, third = `Fixture repair ${label}`;
      await arrive(first, 0);
      await page.getByRole('button', { name: new RegExp(first) }).first().waitFor();
      assert.equal(await selected(), first);
      await page.getByRole('button', { name: 'Toggle fullscreen terminal', exact: true }).click();
      await focused().waitFor();
      assert.equal(await focused().getAttribute('data-focused-agent'), first);
      await send(`pty:data:${first}`, 'SYNTHETIC VIEW FIXTURE: no provider process is running.\r\nInspecting ledger evidence.\r\n');
      await arrive(second, 1);
      await page.getByRole('button', { name: new RegExp(second) }).first().waitFor();
      assert.equal(await selected(), first, 'background arrival preserves selection');
      assert.equal(await focused().getAttribute('data-focused-agent'), first);
      await focused().getByRole('button', { name: `${second} · website`, exact: true }).click();
      assert.equal(await selected(), second, 'explicit roster click selects');
      assert.equal(await focused().getAttribute('data-focused-agent'), second);
      await arrive(third, 2);
      await page.getByRole('button', { name: new RegExp(third) }).first().waitFor();
      assert.equal(await selected(), second);
      await send('hive:agentArchived', { id: first });
      assert.equal(await focused().getAttribute('data-focused-agent'), second, 'unrelated removal preserves focus');
      await send('hive:agentArchived', { id: second });
      await page.locator(`[data-focused-agent="${third}"]`).waitFor();
      assert.equal(await selected(), third);
      await send(`pty:data:${third}`, 'SYNTHETIC VIEW FIXTURE: no provider process is running.\r\nFocus moved to the surviving card. No worker was restored.\r\n');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const canvasMetrics = await assertTerminalCanvasScale(page);
      const image = join(root, `agent-view-${label}.png`); await page.screenshot({ path: image, scale:'css' });
      const bounds = await focused().boundingBox();
      assert.equal(bounds.width, width); assert.equal(bounds.height, height);
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      assert.equal(await focused().count(), 0);
      await arrive(`${third} later`, 0);
      await page.getByRole('button', { name: new RegExp(`${third} later`) }).first().waitFor();
      assert.equal(await selected(), third);
      assert.equal(await focused().count(), 0, 'explicit exit remains sticky on arrival');
      await send('hive:agentArchived', { id: `${third} later` });
      await page.getByRole('button', { name: 'Toggle fullscreen terminal', exact: true }).click();
      await focused().waitFor();
      await send('hive:agentArchived', { id: third });
      await focused().waitFor({ state: 'detached' });
      assert.equal(await selected(), null);
      receipts.push({ width, height, image, bounds, viewport, canvasMetrics, backgroundSelectionPreserved: true,
        explicitSelectionWorked: true, removalRehomedView: true, exitStayedSticky: true });
    }
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    assert.deepEqual(errors, []);
    const result = { kind: 'compiled-desktop-synthetic-roster-events-no-models', receipts, errors };
    fs.writeFileSync(join(root, 'agent-view-ui-receipt.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await page.screenshot({ path: join(root, 'agent-view-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 8000));
    throw error;
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
