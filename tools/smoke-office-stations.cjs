'use strict';
// Compiled floor rendering with synthetic arrivals, never provider execution.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {join,resolve,basename}=require('node:path');
const {setElectronViewport}=require('./electron-viewport.cjs');
const root=process.argv[2],playwrightPath=process.argv[3],repo=resolve(__dirname,'..');
if(!root||!basename(root).startsWith('operatus-run-control-')||!playwrightPath)throw Error('Fresh fixture and Playwright path required');
if(!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError())throw Error('Production hold required');
const fixture=JSON.parse(fs.readFileSync(join(root,'receipt.json'),'utf8'));
async function main(){
 const env={...process.env,OPERATUS_RUN_INSPECT_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await require(playwrightPath)._electron.launch({executablePath:require('electron'),args:[join(repo,'test/fixtures/desktop-run-inspect.cjs')],env,timeout:30000});
 const page=await app.firstWindow(),errors=[],receipts=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 try{
  await page.getByRole('button',{name:'open',exact:true}).click();await page.getByText('EMPTY FLOOR',{exact:true}).waitFor();
  await setElectronViewport(app,page,{width:1440,height:870});
  assert.deepEqual(await page.evaluate(()=>window.cth.listPtys()),[]);
  for(let i=0;i<9;i++){
   await app.evaluate(({BrowserWindow},{i,cwd})=>{
    BrowserWindow.getAllWindows()[0].webContents.send('hive:agentSpawned',{
     id:`station-fixture-${i+1}`,name:`Station fixture ${i+1}`,cwd,provider:'codex',command:'codex',
     role:'Synthetic station arrival; no provider running',lifecycleOwner:'gauntlet',gauntletRunId:'station-ui-fixture-only'
    });
   },{i,cwd:fixture.repositories[0]});
   // Burst mode removes deliberate spacing; still synthetic visual arrivals,
   // not concurrent provider admission or Gauntlet execution.
   if(!process.argv.includes('--burst'))await page.waitForTimeout(250);
  }
  await page.screenshot({path:join(root,'stations-arriving-mac.png'),scale:'css'});
  // Longest tested route is 36 tiles at 48px/s plus frame/arrival overhead.
  await page.waitForTimeout(16000);
  for(const [width,height,label]of[[1440,870,'mac'],[1920,1080,'1080p']]){
   const viewport=await setElectronViewport(app,page,{width,height});await page.waitForTimeout(500);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(await page.evaluate(()=>window.cth.listPtys()),[]);
   const image=join(root,`stations-settled-${label}.png`);await page.screenshot({path:image,scale:'css'});receipts.push({viewport,image});
  }
  assert.deepEqual(errors,[]);
  const result={kind:'compiled-office-synthetic-arrivals',burst:process.argv.includes('--burst'),receipts,errors,realPtys:0,
   scope:'Visually inspect positions against tested map routes; no live providers, exact-role assignment or concurrent Gauntlet acceptance'};
  fs.writeFileSync(join(root,'station-ui-receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await page.screenshot({path:join(root,'station-ui-failure.png')}).catch(()=>{});throw error;}
 finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
