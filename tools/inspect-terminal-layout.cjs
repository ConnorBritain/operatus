'use strict';
// Diagnostic for the compiled terminal renderer. Synthetic IPC, zero providers.
const fs = require('node:fs');
const { join, resolve, basename } = require('node:path');
const root = process.argv[2], playwrightPath = process.argv[3];
const mode = process.argv[4] ?? 'native-scale';
if (!['native-scale', 'emulated-one'].includes(mode)) throw Error('Unknown viewport mode');
if (!root || !basename(root).startsWith('operatus-run-control-') || !playwrightPath) throw Error('Disposable fixture and installed Playwright required');
const repo = resolve(__dirname, '..');
if (!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Production hold required');
const fixture = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
async function main() {
  const env = { ...process.env, OPERATUS_RUN_INSPECT_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await require(playwrightPath)._electron.launch({ executablePath: require('electron'),
    args: [join(repo, 'test/fixtures/desktop-run-inspect.cjs')], env });
  const page = await app.firstWindow(), receipts = [], errors = [];
  const cdp = await page.context().newCDPSession(page);
  page.on('pageerror', e => errors.push(e.message));
  const send = (channel, payload) => app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send(p.channel, p.payload), { channel, payload });
  try {
    await page.getByRole('button', { name: 'open', exact: true }).click();
    await send('hive:agentSpawned', { id: 'terminal-layout-fixture', name: 'Layout fixture', provider: 'codex', command: 'codex',
      cwd: fixture.repositories[0], role: 'Synthetic terminal layout; no provider running', lifecycleOwner: 'gauntlet', gauntletRunId: 'layout-fixture-only' });
    await page.getByRole('button', { name: /Layout fixture/ }).first().click();
    await page.getByRole('button', { name: 'Toggle fullscreen terminal', exact: true }).click();
    const text = '\x1b[2J\x1b[HRENDER FIXTURE ONLY. No provider process.\r\nABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789\r\nProject ledger | Critic evidence | Awaiting owner decision\r\n';
    for (const [width, height, label] of [[1440, 870, 'mac'], [1920, 1080, '1080p']]) {
      if (mode === 'emulated-one') {
        await page.setViewportSize({ width, height });
      } else if (label === 'mac') {
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      } else {
        const deviceScaleFactor = await app.evaluate(({ BrowserWindow, screen }) => screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).scaleFactor);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile:false });
      }
      await page.evaluate(() => document.fonts.ready);
      // Deliberate settling interval exceeds the app's 60/240ms attach refits.
      await page.waitForTimeout(600);
      await send('pty:data:terminal-layout-fixture', text);
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => {
        const describe = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return {
          tag: e.tagName, class: e.className, bounds: { x:r.x,y:r.y,width:r.width,height:r.height },
          width:e.width,height:e.height,fontSize:s.fontSize,fontFamily:s.fontFamily,lineHeight:s.lineHeight,
          transform:s.transform,zoom:s.zoom,style:e.getAttribute('style') }; };
        return { dpr:devicePixelRatio,innerWidth,innerHeight,fonts:document.fonts.status,
          elements:[...document.querySelectorAll('[data-focused-agent] .xterm, [data-focused-agent] .xterm-screen, [data-focused-agent] canvas, [data-focused-agent] .xterm-char-measure-element')].map(describe) };
      });
      const native = await app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0]; return { content:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),display:screen.getDisplayMatching(w.getBounds()).scaleFactor };
      });
      const image = join(root, `terminal-layout-${mode}-${label}.png`); await page.screenshot({ path:image, scale:'css' });
      receipts.push({ label, metrics, native, image });
    }
    await send('hive:agentArchived', { id:'terminal-layout-fixture' });
    const result = { kind:'compiled-terminal-synthetic-output-no-models',mode,receipts,errors,ptys:await page.evaluate(() => window.cth.listPtys()) };
    fs.writeFileSync(join(root,`terminal-layout-${mode}-receipt.json`), JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
