'use strict';
// Visual-test infrastructure only. Do not emulate 1x on a native 2x display:
// xterm's device-pixel ResizeObserver still sees the physical display scale.
const sessions = new WeakMap();
function viewportPlan(size, display) {
  for (const value of [size.width, size.height]) {
    if (!Number.isInteger(value) || value < 1 || value > 8192) throw Error('Invalid test viewport');
  }
  if (!Number.isFinite(display.scaleFactor) || display.scaleFactor <= 0) throw Error('Invalid native display scale');
  return { ...size, deviceScaleFactor:display.scaleFactor,
    mode:size.width <= display.workAreaSize.width && size.height <= display.workAreaSize.height
      ? 'native-window' : 'emulated-layout-native-scale' };
}
async function setElectronViewport(app, page, size) {
  const display = await app.evaluate(({ BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1) throw Error('Viewport helper requires one owned fixture window');
    const d = screen.getDisplayMatching(windows[0].getBounds());
    return { scaleFactor:d.scaleFactor, workAreaSize:d.workAreaSize };
  });
  const plan = viewportPlan(size, display);
  let cdp = sessions.get(page);
  if (!cdp) { cdp = await page.context().newCDPSession(page); sessions.set(page, cdp); }
  if (plan.mode === 'native-window') {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height), size);
  } else {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width:plan.width, height:plan.height, deviceScaleFactor:plan.deviceScaleFactor, mobile:false
    });
  }
  await page.waitForFunction(p => innerWidth === p.width && innerHeight === p.height && devicePixelRatio === p.deviceScaleFactor,
    plan, { timeout:5000 });
  return plan;
}
async function assertTerminalCanvasScale(page) {
  await page.evaluate(() => document.fonts.ready);
  // Exceed attach refits and permit device-pixel observers to run before a
  // screenshot. A single correct animation frame can precede a bad late resize.
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('.xterm-screen canvas')].filter(c => c.getBoundingClientRect().width > 0);
    if (!canvases.length) throw Error('Expected a visible terminal canvas');
    return canvases.map(c => {
      const r = c.getBoundingClientRect();
      if (Math.abs(c.width - r.width * devicePixelRatio) > 2 || Math.abs(c.height - r.height * devicePixelRatio) > 2) {
        throw Error(`Terminal canvas scale mismatch: ${c.width}x${c.height}, CSS ${r.width}x${r.height}, DPR ${devicePixelRatio}`);
      }
      return { width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height,dpr:devicePixelRatio };
    });
  });
}
module.exports = { viewportPlan, setElectronViewport, assertTerminalCanvasScale };
