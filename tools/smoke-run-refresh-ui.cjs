'use strict';
// Compiled Electron + actual disposable SQLite/Git state. IPC timing faults
// are injected only into this owned test process. No model/PTY launches.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {join,resolve,basename}=require('node:path');
const {setElectronViewport}=require('./electron-viewport.cjs');
const root=process.argv[2],playwrightPath=process.argv[3];
if(!root||!basename(root).startsWith('operatus-run-control-')||!playwrightPath)throw Error('Disposable run fixture and installed Playwright path required');
const fixture=JSON.parse(fs.readFileSync(join(root,'receipt.json'),'utf8'));
if(!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError())throw Error('Launch hold required');
async function main(){
 const env={...process.env,OPERATUS_RUN_INSPECT_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await require(playwrightPath)._electron.launch({executablePath:require('electron'),
  args:[join(resolve(__dirname,'..'),'test/fixtures/desktop-run-inspect.cjs')],env,timeout:30000});
 const page=await app.firstWindow(),errors=[],receipts=[];page.on('pageerror',e=>errors.push(e.message));
 const context=page.getByLabel('Selected run context',{exact:true});
 try{
  await page.getByRole('button',{name:'open',exact:true}).click();
  await page.getByRole('button',{name:/^Runs(?: ·|$)/}).click();
  await page.locator('[data-run-detail]').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow})=>{
   const originalGet=ipcMain._invokeHandlers.get('gauntlet:get');
   if(typeof originalGet!=='function')throw Error('Cannot instrument existing get handler');
   const state=globalThis.operatusRefreshTest={heldId:null,pending:[],suppressId:null,completed:0,wrongIdOnce:null};
   ipcMain.removeHandler('gauntlet:get');
   ipcMain.handle('gauntlet:get',async(event,id)=>{
    const responseId=state.wrongIdOnce??id;state.wrongIdOnce=null;
    const snapshot=await originalGet(event,responseId);
    if(state.heldId===id)await new Promise((resolve,reject)=>state.pending.push({resolve,reject}));
    state.completed++;return snapshot;
   });
   for(const win of BrowserWindow.getAllWindows()){
    const send=win.webContents.send.bind(win.webContents);
    win.webContents.send=(channel,...args)=>{
     if(channel==='gauntlet:changed'&&args[0]?.run.id===state.suppressId)return;
     return send(channel,...args);
    };
   }
  });
  const hold=async id=>app.evaluate((_e,id)=>{globalThis.operatusRefreshTest.heldId=id;},id);
  const waitHeld=async()=>{
   for(let i=0;i<50;i++){
    if(await app.evaluate(()=>globalThis.operatusRefreshTest.pending.length>0))return;
    await page.waitForTimeout(50);
   }throw Error('Expected held IPC evidence request');
  };
  const release=async failure=>app.evaluate((_e,failure)=>{
   const state=globalThis.operatusRefreshTest;state.heldId=null;
   for(const pending of state.pending.splice(0))failure?pending.reject(Error('Injected evidence transport failure')):pending.resolve();
  },failure);
  for(const [width,height,label,key] of [[1440,870,'mac','queued'],[1920,1080,'1080p','orienting']]){
   const viewport=await setElectronViewport(app,page,{width,height});
   await hold(fixture.ids.ack);
   await page.locator(`[data-run-id="${fixture.ids.ack}"]`).click();await waitHeld();
   assert.equal(await context.getAttribute('data-run-context'),fixture.ids.ack);
   assert.equal(await page.locator('[data-run-detail]').count(),0,'old evidence cleared on selection');
   await page.locator(`[data-run-id="${fixture.ids.retained}"]`).click();
   await page.locator(`[data-run-detail="${fixture.ids.retained}"]`).waitFor();
   await release(false);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal(await page.locator('[data-run-detail]').getAttribute('data-run-detail'),fixture.ids.retained,'late cross-project response ignored');
   const id=fixture.ids[key];
   await page.locator(`[data-run-id="${id}"]`).click();await page.locator(`[data-run-detail="${id}"]`).waitFor();
   const before=await page.evaluate(id=>window.cth.gauntletGet(id),id);
   await hold(id);
   const after=await app.evaluate(async({ipcMain},id)=>{
    globalThis.operatusRefreshTest.suppressId=id;
    return ipcMain._invokeHandlers.get('gauntlet:cancel')({},id,'UI refresh fixture cancellation; no provider ran');
   },id);
   assert.ok(after.run.version>before.run.version);assert.equal(after.run.status,'cancelled');
   await page.getByRole('button',{name:'refresh',exact:true}).click();await waitHeld();
   await context.getByText('cancelled',{exact:true}).waitFor();
   await context.getByText('Loading current evidence…',{exact:true}).waitFor();
   assert.ok((await context.innerText()).includes(after.run.requestedObjective));
   assert.ok((await context.innerText()).includes(after.run.repository));
   assert.ok((await context.innerText()).includes('cancelled'));
   assert.equal(await page.locator('[data-run-detail]').count(),0,'newer list must not leave stale evidence visible');
   const bounds=await context.boundingBox();
   assert.ok(bounds.y>=0&&bounds.y+bounds.height<height);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const loadingImage=join(root,`run-refresh-loading-${label}.png`);await page.screenshot({path:loadingImage});
   await release(false);await page.locator(`[data-run-detail="${id}"]`).waitFor();
   assert.equal(await context.getByText('Loading current evidence…',{exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'cancel',exact:true}).count(),0);
   const finalImage=join(root,`run-refresh-current-${label}.png`);await page.screenshot({path:finalImage});
   receipts.push({viewport,runId:id,repository:after.run.repository,oldVersion:before.run.version,newVersion:after.run.version,
    persistedStatus:after.run.status,contextBounds:bounds,loadingImage,finalImage});
  }
  await hold(fixture.ids.ack);await page.locator(`[data-run-id="${fixture.ids.ack}"]`).click();await waitHeld();await release(true);
  await page.getByRole('button',{name:'reload evidence',exact:true}).waitFor();
  assert.equal(await context.getAttribute('data-run-context'),fixture.ids.ack);
  await page.getByRole('button',{name:'reload evidence',exact:true}).click();
  await page.locator(`[data-run-detail="${fixture.ids.ack}"]`).waitFor();
  await app.evaluate((_e,id)=>{globalThis.operatusRefreshTest.wrongIdOnce=id;},fixture.ids.retained);
  await page.locator(`[data-run-id="${fixture.ids.ack}"]`).click();
  await page.getByText('Received evidence for a different run. Reload the selected run.',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-run-detail]').count(),0);
  assert.equal(await context.getAttribute('data-run-context'),fixture.ids.ack);
  await page.getByRole('button',{name:'reload evidence',exact:true}).click();
  await page.locator(`[data-run-detail="${fixture.ids.ack}"]`).waitFor();
  // Explicit refresh must read evidence even when no run version changed.
  await hold(fixture.ids.ack);
  await page.getByRole('button',{name:'refresh',exact:true}).click();await waitHeld();
  assert.equal(await page.locator('[data-run-detail]').count(),0);
  await release(false);await page.locator(`[data-run-detail="${fixture.ids.ack}"]`).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.cth.listPtys()),[]);assert.deepEqual(errors,[]);
  const result={kind:'compiled-desktop-real-fixture-state-injected-ipc-timing-no-models',receipts,errors};
  fs.writeFileSync(join(root,'run-refresh-ui-receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await page.screenshot({path:join(root,'run-refresh-failure.png')}).catch(()=>{});throw error;}
 finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
