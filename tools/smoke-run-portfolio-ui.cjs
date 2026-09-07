'use strict';
// Real compiled Electron and disposable persisted runs, not live execution.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {join,resolve,basename}=require('node:path');
const {setElectronViewport}=require('./electron-viewport.cjs');
const root=process.argv[2],playwrightPath=process.argv[3];
if(!root||!basename(root).startsWith('operatus-run-control-')||!playwrightPath)throw Error('Disposable portfolio fixture and Playwright required');
const fixture=JSON.parse(fs.readFileSync(join(root,'receipt.json'),'utf8'));
if(!fixture.ids['volume-35'])throw Error('Generate the run fixture with --volume');
if(!require('../test/load-ts.cjs')('src/shared/billingPolicy.ts').subscriptionLaunchError())throw Error('Launch hold required');
async function main(){
 const env={...process.env,OPERATUS_RUN_INSPECT_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await require(playwrightPath)._electron.launch({executablePath:require('electron'),
  args:[join(resolve(__dirname,'..'),'test/fixtures/desktop-run-inspect.cjs')],env,timeout:30000});
 const page=await app.firstWindow(),errors=[],receipts=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.getByRole('button',{name:'open',exact:true}).click();
  await page.getByRole('button',{name:/^Runs(?: ·|$)/}).click();
  await page.locator('[data-run-detail]').waitFor();
  const runs=await page.evaluate(()=>window.cth.gauntletList());
  assert.equal(runs.length,Object.keys(fixture.ids).length);
  const attention=runs.filter(r=>['human_required','infrastructure_failure'].includes(r.status));
  const list=page.getByLabel('Gauntlet run list',{exact:true});
  const visibleIds=()=>list.locator('[data-run-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.runId).sort());
  for(const [width,height,label] of [[1440,870,'mac'],[1920,1080,'1080p']]){
   const viewport=await setElectronViewport(app,page,{width,height});
   await page.getByLabel('Filter runs by repository',{exact:true}).selectOption('');
   await page.getByLabel('Search runs',{exact:true}).fill('');
   await page.getByRole('button',{name:`Needs you · ${attention.length}`,exact:true}).click();
   assert.deepEqual(await visibleIds(),attention.map(r=>r.id).sort());
   assert.ok(!(await visibleIds()).includes(fixture.ids.ack),'routine Conductor acknowledgment is not a human escalation');
   await page.locator(`[data-run-id="${fixture.ids['volume-0']}"]`).click();
   await page.locator(`[data-run-detail="${fixture.ids['volume-0']}"]`).waitFor();
   const context=page.getByLabel('Selected run context',{exact:true});
   assert.match(await context.innerText(),/You/);
   const bounds=await list.boundingBox();
   const overflow=await list.evaluate(el=>({scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
   assert.ok(overflow.scrollHeight>overflow.clientHeight,'volume actually exercises list overflow');
   assert.ok(bounds.height>200,'queue keeps useful visible area');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const attentionImage=join(root,`portfolio-attention-${label}.png`);await page.screenshot({path:attentionImage});
   await page.getByLabel('Filter runs by repository',{exact:true}).selectOption(fixture.repositories[1]);
   const repoAttention=attention.filter(r=>r.repository===fixture.repositories[1]);
   assert.deepEqual(await visibleIds(),repoAttention.map(r=>r.id).sort());
   await context.getByText('Viewing a run outside the current list filters.',{exact:true}).waitFor();
   assert.equal(await context.getAttribute('data-run-context'),fixture.ids['volume-0']);
   await page.getByLabel('Search runs',{exact:true}).fill('Portfolio load 02');
   assert.deepEqual(await visibleIds(),[fixture.ids['volume-1']]);
   await page.locator(`[data-run-id="${fixture.ids['volume-1']}"]`).click();
   await page.locator(`[data-run-detail="${fixture.ids['volume-1']}"]`).waitFor();
   assert.ok((await context.innerText()).includes(fixture.repositories[1]));
   const scopedImage=join(root,`portfolio-scoped-${label}.png`);await page.screenshot({path:scopedImage});
   receipts.push({viewport,totalRuns:runs.length,attentionRuns:attention.length,repositoryAttention:repoAttention.length,
    listBounds:bounds,overflow,attentionImage,scopedImage});
   await page.getByLabel('Filter runs by repository',{exact:true}).selectOption('');
   await page.getByLabel('Search runs',{exact:true}).fill('');
   await page.locator(`[data-run-id="${fixture.ids['volume-0']}"]`).click();
   await page.locator(`[data-run-detail="${fixture.ids['volume-0']}"]`).waitFor();
   const before=await page.evaluate(id=>window.cth.gauntletGet(id),fixture.ids['volume-0']);
   const reviewPanel=page.getByLabel('Operator review',{exact:true});
   await page.getByLabel('Operator review note',{exact:true}).fill(`Reviewed at ${label}: retain this outcome; follow up in a separately scoped run.`);
   await reviewPanel.getByRole('button',{name:'mark reviewed',exact:true}).click();
   await reviewPanel.getByText('REVIEWED BY YOU',{exact:true}).waitFor();
   assert.equal((await visibleIds()).includes(before.run.id),false);
   assert.equal(await context.getAttribute('data-run-context'),before.run.id,'review cannot steal selection');
   const marked=await page.evaluate(id=>window.cth.gauntletGet(id),before.run.id);
   assert.equal(marked.run.status,before.run.status);assert.equal(marked.run.currentArtifactSha,before.run.currentArtifactSha);
   assert.equal(marked.run.contract?.digest,before.run.contract?.digest);
   assert.equal(marked.run.operatorReview.reviewed,true);assert.equal(marked.run.version,before.run.version+1);
   const stale=await page.evaluate(async({id,version})=>{
    try{await window.cth.gauntletReviewAttention(id,version,true,'Stale review must not overwrite');return 'unexpected-success';}
    catch(e){return String(e);}
   },{id:before.run.id,version:before.run.version});
   assert.match(stale,/stale run version/);
   await page.getByRole('button',{name:'Recent closed · 3',exact:true}).click();
   assert.ok((await visibleIds()).includes(before.run.id));
   const reviewedImage=join(root,`portfolio-reviewed-${label}.png`);await page.screenshot({path:reviewedImage});
   await page.getByLabel('Operator review note',{exact:true}).fill(`Reopened at ${label}: new context requires a decision.`);
   await reviewPanel.getByRole('button',{name:'return to Needs you',exact:true}).click();
   await reviewPanel.getByText('RECORD YOUR DECISION',{exact:true}).waitFor();
   const restored=await page.evaluate(id=>window.cth.gauntletGet(id),before.run.id);
   assert.equal(restored.run.operatorReview.reviewed,false);assert.equal(restored.run.status,before.run.status);
   assert.equal(restored.events.length,before.events.length+2);
   await page.getByRole('button',{name:`Needs you · ${attention.length}`,exact:true}).click();
   assert.ok((await visibleIds()).includes(before.run.id));
   receipts.at(-1).operatorReview={runId:before.run.id,beforeVersion:before.run.version,reviewedVersion:marked.run.version,
    restoredVersion:restored.run.version,status:restored.run.status,reviewedImage,staleWriteRejected:true};
  }
  const rejected=await app.evaluate(async({ipcMain},id)=>{
   try{await ipcMain._invokeHandlers.get('gauntlet:review-attention')({},id,0,true,'Untrusted sender');return false;}catch{return true;}
  },fixture.ids['volume-0']);assert.equal(rejected,true,'IPC requires the actual desktop sender');
  assert.deepEqual(await page.evaluate(()=>window.cth.listPtys()),[]);assert.deepEqual(errors,[]);
  const result={kind:'compiled-electron-persisted-synthetic-portfolio-no-live-workers',receipts,errors};
  fs.writeFileSync(join(root,'portfolio-ui-receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await page.screenshot({path:join(root,'portfolio-failure.png')}).catch(()=>{});throw e;}
 finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
