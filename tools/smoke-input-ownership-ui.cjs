'use strict';
// Real compiled renderer/preload, synthetic PTY boundary. No provider process,
// credential, live permission prompt or real 31-minute wait is involved.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {join,resolve,basename}=require('node:path');
const {setElectronViewport}=require('./electron-viewport.cjs');
const root=process.argv[2],playwrightPath=process.argv[3],repo=resolve(__dirname,'..');
if(!root||!basename(root).startsWith('operatus-run-control-')||!playwrightPath)throw Error('Fresh disposable fixture and Playwright path required');
if(!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError())throw Error('Production hold required');
const fixture=JSON.parse(fs.readFileSync(join(root,'receipt.json'),'utf8'));
async function main(){
 const env={...process.env,OPERATUS_RUN_INSPECT_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await require(playwrightPath)._electron.launch({executablePath:require('electron'),args:[join(repo,'test/fixtures/desktop-run-inspect.cjs')],env,timeout:30000});
 const page=await app.firstWindow(),errors=[],receipts=[],id='input-ownership-fixture';
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 try{
  await page.getByRole('button',{name:'open',exact:true}).click();
  await page.getByText('EMPTY FLOOR',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.cth.listPtys()),[]);
  await app.evaluate(({ipcMain,BrowserWindow},{id,cwd})=>{
   globalThis.__inputFixtureWrites=[];
   ipcMain.removeHandler('pty:write');ipcMain.handle('pty:write',(_event,target,data)=>{
    if(target!==id)return{ok:false,error:'Only the synthetic fixture terminal is available'};
    globalThis.__inputFixtureWrites.push(data);
    if(data==='\x15'&&globalThis.__recoveryMode==='reject')return{ok:false,error:'Synthetic rejected recovery'};
    if(data==='\x15'&&globalThis.__recoveryMode==='delay')return new Promise(resolve=>{globalThis.__resolveRecovery=resolve;});
    return{ok:true};
   });
   ipcMain.removeHandler('pty:list');ipcMain.handle('pty:list',()=>[{id,pid:999999,hasOutput:true,cwd,command:'codex'}]);
   BrowserWindow.getAllWindows()[0].webContents.send('hive:agentSpawned',{id,name:'Input ownership fixture',cwd,provider:'codex',command:'codex',role:'Synthetic input fixture; no provider running',lifecycleOwner:'gauntlet',gauntletRunId:'ui-fixture-only'});
  },{id,cwd:fixture.repositories[0]});
  await page.getByRole('button',{name:'Toggle fullscreen terminal',exact:true}).click();
  await page.locator('[data-focused-agent]').waitFor();
  const input=page.locator('.xterm-helper-textarea'),composer=page.getByPlaceholder('Message Input ownership fixture');
  const queued='QUEUED FIXTURE: must not join the user draft';
  await input.pressSequentially('UNSUBMITTED USER DRAFT');
  await composer.fill(queued);await page.getByRole('button',{name:'send',exact:true}).click();
  await page.getByRole('button',{name:'recover prompt',exact:true}).waitFor();
  await page.evaluate(()=>{globalThis.__fixtureRealNow=Date.now;Date.now=()=>globalThis.__fixtureRealNow()+31*60*1000;});
  // Cross a real queue backstop while the Electron window is hidden.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await page.waitForTimeout(3500);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  for(const [width,height,label]of[[1440,870,'mac'],[1920,1080,'1080p']]){
   const viewport=await setElectronViewport(app,page,{width,height});
   await page.getByRole('button',{name:'recover prompt',exact:true}).waitFor();
   assert.equal((await app.evaluate(()=>globalThis.__inputFixtureWrites)).some(text=>text.includes('QUEUED FIXTURE')),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const image=join(root,`input-hold-${label}.png`);await page.screenshot({path:image,scale:'css'});receipts.push({viewport,image});
  }
  // A rejected write cannot release the hold or claim to have moved the draft.
  await app.evaluate(()=>{globalThis.__recoveryMode='reject';});
  await page.getByRole('button',{name:'recover prompt',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Terminal rejected recovery'}).waitFor();
  assert.equal(await composer.inputValue(),'');
  await page.waitForTimeout(3500);
  assert.equal((await app.evaluate(()=>globalThis.__inputFixtureWrites)).includes(queued),false);
  await page.screenshot({path:join(root,'recovery-rejected-1080p.png'),scale:'css'});
  // Deferred success must not overwrite a composer edit made while waiting.
  await app.evaluate(()=>{globalThis.__recoveryMode='delay';});
  await page.getByRole('button',{name:'recover prompt',exact:true}).click();
  await page.getByText('held — waiting for terminal recovery acknowledgment',{exact:true}).waitFor();
  await composer.fill('NEW COMPOSER EDIT');
  assert.equal((await app.evaluate(()=>globalThis.__inputFixtureWrites)).includes(queued),false);
  await app.evaluate(()=>{if(!globalThis.__resolveRecovery)throw Error('No live recovery request');globalThis.__resolveRecovery({ok:true});});
  await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(t=>t.value==='NEW COMPOSER EDIT\nUNSUBMITTED USER DRAFT'));
  assert.equal(await composer.inputValue(),'NEW COMPOSER EDIT\nUNSUBMITTED USER DRAFT');
  const until=Date.now()+10000;let writes;
  do{writes=await app.evaluate(()=>globalThis.__inputFixtureWrites);if(writes.includes(queued))break;await page.waitForTimeout(100);}while(Date.now()<until);
  assert.ok(writes.includes(queued),'explicit release allows the separate queued message');
  assert.equal(writes.some(text=>text.includes('UNSUBMITTED USER DRAFT')&&text.includes('QUEUED FIXTURE')),false);
  await input.pressSequentially('/model');await input.press('Enter');
  await composer.fill('QUEUED PICKER FIXTURE');await page.getByRole('button',{name:'send',exact:true}).click();
  await page.getByRole('button',{name:'close picker',exact:true}).waitFor();
  await page.evaluate(()=>{Date.now=()=>globalThis.__fixtureRealNow()+62*60*1000;});
  await page.waitForTimeout(3500);
  await page.getByRole('button',{name:'close picker',exact:true}).waitFor();
  assert.equal((await app.evaluate(()=>globalThis.__inputFixtureWrites)).includes('QUEUED PICKER FIXTURE'),false);
  assert.deepEqual(errors,[]);
  const result={kind:'compiled-renderer-synthetic-PTY-input-ownership',receipts,errors,draftPreserved:true,heldAcrossSimulated31Minutes:true,pickerHeld:true,rejectedRecoveryHeld:true,pendingRecoveryHeld:true,newComposerEditPreserved:true,scope:'No real provider or actual permission-dialog verification'};
  fs.writeFileSync(join(root,'input-ownership-ui-receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await page.screenshot({path:join(root,'input-ownership-failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-6000));throw error;}
 finally{await page.evaluate(()=>{if(globalThis.__fixtureRealNow)Date.now=globalThis.__fixtureRealNow;}).catch(()=>{});await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
