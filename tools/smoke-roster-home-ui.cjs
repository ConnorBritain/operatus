'use strict';
// Disposable compiled Electron/preload/store test. Home switches are controlled
// profile edits BETWEEN app processes, not acceptance of the live move workflow.
const fs = require('node:fs');
const { join, resolve, basename } = require('node:path');
const assert = require('node:assert/strict');
const { setElectronViewport } = require('./electron-viewport.cjs');
const root = process.argv[2], playwrightPath = process.argv[3];
if (!root || !basename(root).startsWith('operatus-run-control-') || !playwrightPath) throw Error('Disposable fixture root and installed Playwright path required');
const repo = resolve(__dirname, '..');
if (!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Production launch hold required');
const fixture = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
const a = join(root, 'roster-home-A'), b = join(root, 'roster-home-B');
fs.mkdirSync(a); fs.mkdirSync(b); // Refuse accidental reuse of a previous smoke.
const key = home => `operatus.roster.v1:${encodeURIComponent(home)}`;
const roster = { version:1, savedAt:'fixture', agents:[], restorable:[], selectedId:null,
  archived:[{ id:'archive-A', name:'Archive A only', cwd:fixture.repositories[0], description:'Synthetic ownership fixture',
    character:'operator', accent:'coral', project:'ledger', status:'idle', note:'Private A note', archived:true }],
  queues:{ 'archive-A':[{ id:'queue-A', text:'A only queued instruction' }] } };
const legacy = JSON.stringify([{ ...roster.archived[0], id:'legacy-unassigned', name:'Legacy unassigned' }]);
const errors = [], receipts = [];
let ownedCache;
async function visit(home, label, check) {
  const configPath = join(fixture.profile, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...config, harnessHome:home, recentHives:[home] }));
  const env = { ...process.env, OPERATUS_RUN_INSPECT_ROOT:root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await require(playwrightPath)._electron.launch({ executablePath:require('electron'),
    args:[join(repo, 'test/fixtures/desktop-run-inspect.cjs')], env, timeout:30000 });
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  try {
    await page.getByRole('button', { name:'open', exact:true }).click();
    assert.equal((await page.evaluate(() => window.cth.rosterBootSync())).home, home);
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    await check(page, app);
    assert.deepEqual(await page.evaluate(() => window.cth.listPtys()), []);
    receipts.push({ label, home, noProviderProcesses:true });
  } catch (error) {
    await page.screenshot({ path:join(root, `roster-${label}-failure.png`) }).catch(() => {});
    throw error;
  } finally { await app.close(); }
}
async function main() {
  await visit(fixture.home, 'seed', async page => {
    await page.evaluate(({ a, roster, legacy }) => {
      localStorage.setItem(`operatus.roster.v1:${encodeURIComponent(a)}`, JSON.stringify({ version:1, home:a, roster }));
      localStorage.setItem('cth.archivedAgents', legacy);
    }, { a, roster, legacy });
  });
  await visit(a, 'A-cache-restore', async page => {
    await page.waitForFunction(() => window.cth.rosterBootSync().roster?.archived?.some(x => x.id === 'archive-A'));
    const boot = await page.evaluate(() => window.cth.rosterBootSync());
    assert.equal(boot.roster.archived[0].note, 'Private A note');
    assert.equal(boot.roster.queues['archive-A'][0].text, 'A only queued instruction');
    ownedCache = await page.evaluate(k => localStorage.getItem(k), key(a));
  });
  await visit(b, 'B-missing-file', async (page, app) => {
    await page.getByRole('status').filter({ hasText:'preserved but unassigned' }).waitFor();
    await page.getByText('EMPTY FLOOR', { exact:true }).waitFor();
    assert.equal(await page.getByText('Archive A only', { exact:true }).count(), 0);
    const before = await page.evaluate(() => window.cth.rosterBootSync());
    const stale = await page.evaluate(({ roster, a }) => window.cth.rosterWrite(roster, a), { roster, a });
    assert.equal(stale.ok, false); assert.match(stale.error, /home changed/);
    assert.deepEqual(await page.evaluate(() => window.cth.rosterBootSync()), before);
    for (const [width, height, label] of [[1440,870,'mac'], [1920,1080,'1080p']]) {
      const viewport = await setElectronViewport(app, page, { width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const image = join(root, `roster-recovery-${label}.png`);
      await page.screenshot({ path:image, scale:'css' });
      receipts.push({ label:`recovery-${label}`, viewport, image });
    }
    const cacheBefore = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
    for (const mode of ['fresh', 'move']) {
      const rejected = await page.evaluate(({ b, mode }) => window.cth.changeHome(b, mode), { b, mode });
      assert.equal(rejected.ok, false);
    }
    assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), cacheBefore);
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key(a)), ownedCache);
    await page.reload();
    await page.getByRole('button', { name:'open', exact:true }).click();
    assert.equal(await page.getByText('Archive A only', { exact:true }).count(), 0);
  });
  await visit(b, 'B-restart', async page => {
    await page.getByRole('status').filter({ hasText:'preserved but unassigned' }).waitFor();
    const boot = await page.evaluate(() => window.cth.rosterBootSync());
    assert.deepEqual(boot.roster.archived, []); assert.deepEqual(boot.roster.queues, {});
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key(a)), ownedCache);
  });
  await visit(a, 'A-return', async page => {
    const boot = await page.evaluate(() => window.cth.rosterBootSync());
    assert.equal(boot.roster.archived[0].note, 'Private A note');
    assert.equal(boot.roster.queues['archive-A'][0].text, 'A only queued instruction');
    assert.equal(await page.evaluate(() => localStorage.getItem('cth.archivedAgents')), legacy);
  });
  assert.deepEqual(errors, []);
  const result = { kind:'compiled-desktop-home-cache-isolation-no-models', receipts, errors,
    scope:'Controlled between-process home changes, reload, stale-write rejection, same-home move/fresh refusal. Not live migration acceptance.' };
  fs.writeFileSync(join(root, 'roster-home-ui-receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode=1; });
