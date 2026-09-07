'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { viewportPlan, setElectronViewport, assertTerminalCanvasScale } = require('../tools/electron-viewport.cjs');
const display = { scaleFactor:2, workAreaSize:{ width:1440,height:870 } };
test('viewport plan preserves physical scale and distinguishes native size from emulated layout', () => {
  assert.equal(viewportPlan({width:1440,height:870},display).mode,'native-window');
  assert.deepEqual(viewportPlan({width:1920,height:1080},display),{width:1920,height:1080,deviceScaleFactor:2,mode:'emulated-layout-native-scale'});
  assert.equal(viewportPlan({width:1920,height:1080},{scaleFactor:1,workAreaSize:{width:1920,height:1080}}).deviceScaleFactor,1);
  for (const width of [NaN,0,-1,1.5,9000]) assert.throws(() => viewportPlan({width,height:870},display));
  assert.throws(() => viewportPlan({width:1440,height:870},{...display,scaleFactor:0}));
});
test('viewport helper clears emulation for native sizing and sends the actual display scale for larger layouts', async () => {
  const messages=[],sizes=[],waits=[];
  const window = {getBounds:()=>({}),setContentSize:(w,h)=>sizes.push([w,h])};
  const app = { evaluate:async (fn,arg)=>fn({BrowserWindow:{getAllWindows:()=>[window]},screen:{getDisplayMatching:()=>display}},arg) };
  const page = { context:()=>({newCDPSession:async ()=>({send:async (...args)=>messages.push(args)})}),
    waitForFunction:async (fn,p)=>{ waits.push(p); assert.ok(vm.runInNewContext(`(${fn.toString()})(p)`,{p,innerWidth:p.width,innerHeight:p.height,devicePixelRatio:2})); } };
  await setElectronViewport(app,page,{width:1440,height:870});
  await setElectronViewport(app,page,{width:1920,height:1080});
  assert.deepEqual(sizes,[[1440,870]]);
  assert.deepEqual(messages,[['Emulation.clearDeviceMetricsOverride'],['Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:2,mobile:false}]]);
  assert.equal(waits.length,2);
});
test('canvas scale guard rejects the observed 1x/2x mismatch rather than accepting a screenshot', async () => {
  let width=200;
  const page={waitForTimeout:async ()=>{},evaluate:async fn=>vm.runInNewContext(`(${fn.toString()})()`,{
    devicePixelRatio:2,document:{fonts:{ready:Promise.resolve()},querySelectorAll:()=>[{width,height:100,getBoundingClientRect:()=>({width:100,height:50})}]}
  })};
  assert.equal((await assertTerminalCanvasScale(page))[0].dpr,2);
  width=100;
  await assert.rejects(assertTerminalCanvasScale(page),/canvas scale mismatch/);
});
