'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {setElectronViewport}=require('./electron-viewport.cjs');
const {measureRunLayout,fits}=require('./run-layout-evidence.cjs');
async function main(){
 const [root,playwrightPath]=process.argv.slice(2);
 if(!root||!path.basename(root).startsWith('op-live-concurrency-')||!playwrightPath)throw Error('Completed fixture and installed Playwright required');
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'receipt.json')));
 assert.ok(receipt.snapshots.length===3&&receipt.snapshots.every(s=>s.run.status==='passed'));
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'op-completed-layout-')),env={...process.env,OPERATUS_COMPLETED_RUN_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await require(playwrightPath)._electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'../test/fixtures/desktop-completed-runs.cjs')],env});
 const page=await app.firstWindow(),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.getByRole('button',{name:'open',exact:true}).click();await page.getByRole('button',{name:/^Runs(?: ·|$)/}).click();
  for(const [width,height,label]of [[1440,870,'mac'],[1920,1080,'1080p']]){
   const viewport=await setElectronViewport(app,page,{width,height});
   for(const s of receipt.snapshots){
    await page.locator(`[data-run-id="${s.run.id}"]`).click();await page.locator(`[data-run-detail="${s.run.id}"]`).waitFor();
    await page.getByLabel('Candidate handoff',{exact:true}).waitFor();
    const layout=await measureRunLayout(page),image=path.join(output,`${label}-${path.basename(s.run.repository)}.png`);
    await page.screenshot({path:image});results.push({viewport,runId:s.run.id,layout,fits:fits(layout),image});
    const current=await page.evaluate(id=>window.cth.gauntletGet(id),s.run.id);
    assert.equal(current.launches.length,s.launches.length);assert.equal(current.run.currentArtifactSha,s.run.currentArtifactSha);
   }
  }
  assert.equal(errors.length,0);assert.ok(results.every(r=>r.fits),'Inner completed-run panel overflows');
 }finally{
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({root,results,errors,passed:results.length===6&&results.every(r=>r.fits)&&errors.length===0},null,2));
  console.log(JSON.stringify({output,results:results.map(r=>({runId:r.runId,width:r.viewport.width,fits:r.fits,layout:r.layout})),errors}));await app.close();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
