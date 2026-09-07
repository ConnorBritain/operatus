'use strict';
// Explicit live desktop acceptance: all run creation and cancellation use UI controls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {setElectronViewport}=require('./electron-viewport.cjs');
const {analyze}=require('./live-concurrency-evidence.cjs');
const {measureRunLayout,fits}=require('./run-layout-evidence.cjs');
const workloads=require('../test/fixtures/live-concurrency-workloads.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const terminal=status=>['passed','cancelled','human_required','infrastructure_failure'].includes(status);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const [flag,playwrightPath,deadlineText]=process.argv.slice(2),deadline=Date.parse(deadlineText);
  if(flag!=='--live'||!playwrightPath||!Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+20*60000)throw Error('Require --live, installed Playwright path and an absolute deadline within 20 minutes');
  if(process.platform!=='darwin')throw Error('This acceptance is macOS-only');
  const disk=fs.statfsSync(os.tmpdir());if(disk.bavail*disk.bsize<2*1024**3)throw Error('Require 2 GiB free for this disposable smoke');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'op-live-concurrency-')));
  const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',timeout:10000,stdio:'pipe',env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
  const fixture=workloads.map(w=>{
    const repository=path.join(root,w.name);fs.mkdirSync(repository);
    fs.writeFileSync(path.join(repository,'implementation.cjs'),`'use strict';\n${w.initial}`);
    const tests=`'use strict';\nconst test=require('node:test'),assert=require('node:assert/strict');\n${w.tests}`;
    fs.writeFileSync(path.join(repository,'fixed.test.cjs'),tests);
    git(repository,'init','-b','main');git(repository,'config','user.name','Operatus live smoke');git(repository,'config','user.email','smoke@example.invalid');git(repository,'add','.');git(repository,'commit','-m','Fixed concurrency smoke workload');
    return {name:w.name,repository,baseSha:git(repository,'rev-parse','HEAD'),testsSha256:hash(tests),
      objective:`[Live desktop smoke: ${w.name}] Implement this exact small contract: ${w.specification} Change only implementation.cjs. Preserve fixed.test.cjs byte for byte, do not add files or dependencies. Freeze node --test fixed.test.cjs as a required check. No unrelated features or refactoring.`};
  });
  fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify(fixture,null,2));
  const profile=path.join(root,'profile'),home=path.join(root,'hive');fs.mkdirSync(profile);fs.mkdirSync(home);
  fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify(require('../test/fixtures/live-concurrency-profile.cjs')(home,fixture.map(f=>f.repository))));
  const env={...process.env,OPERATUS_LIVE_CONCURRENCY:'1',OPERATUS_LIVE_CONCURRENCY_ROOT:root,DO_NOT_TRACK:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await require(playwrightPath)._electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'../test/fixtures/desktop-live-concurrency.cjs')],env,timeout:30000});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  const errors=[],samples=[],ui=[],ids=[],starts=[],phases=new Map();let snapshots=[],capacity=null,monitoring=true,monitorError=null,failure=null,lastSample='';
  page.on('pageerror',e=>errors.push(e.message));
  console.log(JSON.stringify({root,deadline:new Date(deadline).toISOString(),realInference:true,entry:'desktop UI'}));
  const capture=async()=>{
    const state=await page.evaluate(async()=>{const runs=await window.cth.gauntletList();return {capacity:await window.cth.gauntletCapacity(),snapshots:await Promise.all(runs.map(r=>window.cth.gauntletGet(r.id)))};});
    snapshots=state.snapshots;capacity=state.capacity;
    const sample={at:Date.now(),capacity,launchCounts:Object.fromEntries(snapshots.map(s=>[s.run.id,s.launches.length]))};
    const key=JSON.stringify([capacity,sample.launchCounts]);if(key!==lastSample){samples.push(sample);lastSample=key;}
    for(const s of snapshots){if(phases.get(s.run.id)!==s.run.status){phases.set(s.run.id,s.run.status);console.log(JSON.stringify({runId:s.run.id,phase:s.run.status,at:new Date().toISOString(),reason:s.run.stopReason}));}}
    fs.writeFileSync(path.join(root,'progress.json'),JSON.stringify({at:Date.now(),snapshots,capacity,samples},null,2));
  };
  let monitor;
  const check=()=>{if(monitorError)throw monitorError;if(Date.now()>=deadline)throw Error('Live attempt deadline reached');const bad=snapshots.find(s=>terminal(s.run.status)&&s.run.status!=='passed');if(bad)throw Error(`${bad.run.id}: ${bad.run.status}: ${bad.run.stopReason}`);};
  const select=async id=>{await page.locator(`[data-run-id="${id}"]`).click();await page.locator(`[data-run-detail="${id}"]`).waitFor();await page.locator(`[data-run-context="${id}"]`).waitFor();};
  const inspect=async(label)=>{
    for(const [width,height,screen]of [[1440,870,'mac'],[1920,1080,'1080p']]){
      check();const viewport=await setElectronViewport(app,page,{width,height});
      await page.getByLabel('Filter runs by repository',{exact:true}).selectOption('');
      await select(ids[0]);
      await page.getByLabel('Filter runs by repository',{exact:true}).selectOption(fixture[1].repository);
      assert.equal(await page.locator('[data-run-context]').getAttribute('data-run-context'),ids[0],'filter must not steal selection');
      await page.getByText('Viewing a run outside the current list filters.',{exact:true}).waitFor();
      const visible=await page.getByLabel('Gauntlet run list',{exact:true}).locator('[data-run-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.runId));
      assert.deepEqual(visible,[ids[1]]);
      await select(ids[1]);
      assert.ok((await page.locator('[data-run-context]').innerText()).includes(fixture[1].repository));
      const layout=await measureRunLayout(page);assert.ok(fits(layout),`Inner run panel overflow: ${JSON.stringify(layout)}`);
      const image=path.join(root,`${label}-${screen}.png`);await page.screenshot({path:image});
      ui.push({label,viewport,layout,selectedId:ids[1],filteredRepository:fixture[1].repository,image,selectionPreserved:true,noOverflow:true});
      await page.getByLabel('Filter runs by repository',{exact:true}).selectOption('');
    }
  };
  try{
    await page.getByRole('button',{name:'open',exact:true}).click();
    await page.getByRole('button',{name:/^Runs(?: ·|$)/}).click();
    await page.getByText(/^Capacity:/).click();
    // Exercise the persisted UI setting even though the default is already two.
    await page.getByLabel('Concurrent Gauntlets',{exact:true}).selectOption('1');
    await page.waitForFunction(async()=> (await window.cth.gauntletCapacity()).maxConcurrentRuns===1);
    await page.getByLabel('Concurrent Gauntlets',{exact:true}).selectOption('2');
    await page.waitForFunction(async()=> (await window.cth.gauntletCapacity()).maxConcurrentRuns===2);
    await page.getByText(/^Capacity:/).click();
    monitor=(async()=>{while(monitoring){try{await capture();}catch(e){monitorError=e;return;}await delay(750);}})();
    for(const f of fixture){
      check();await page.getByRole('button',{name:'+ new run',exact:true}).click();
      await page.getByLabel('Repository path',{exact:true}).fill(f.repository);
      await page.getByLabel('Bounded objective',{exact:true}).fill(f.objective);
      const engines=page.getByText('role engines',{exact:true});
      if(!await page.getByLabel('conductor model',{exact:true}).isVisible())await engines.click();
      for(const role of ['conductor','implementer','repairer','critic'])await page.getByLabel(`${role} model`,{exact:true}).fill(role==='critic'?'gpt-5.6-sol':'claude-fable-5-1');
      const clickedAt=Date.now();await page.getByRole('button',{name:'start run',exact:true}).click();
      await page.waitForFunction(async repo=>(await window.cth.gauntletList()).some(r=>r.repository===repo),f.repository,{timeout:15000});
      const created=await page.evaluate(async repo=>(await window.cth.gauntletList()).find(r=>r.repository===repo),f.repository);
      ids.push(created.id);starts.push({runId:created.id,repository:f.repository,clickedAt,observedAt:Date.now()});
      await page.getByRole('button',{name:'+ new run',exact:true}).waitFor();
    }
    await capture();await inspect('running');
    while(true){
      check();if(snapshots.length===3&&snapshots.every(s=>s.run.status==='passed')&&capacity.dispatches.length===0)break;
      await delay(1000);
    }
    await inspect('completed');await capture();
  }catch(e){failure=e.message;console.log(JSON.stringify({stopped:failure}));try{await page.screenshot({path:path.join(root,'failure.png')});}catch{}}
  finally{
    monitoring=false;await monitor;
    // Normal desktop controls cancel only runs in this fresh test profile.
    try{
      await capture();
      if(snapshots.some(s=>!terminal(s.run.status))){
        await page.getByLabel('Filter runs by repository',{exact:true}).selectOption('');
        for(const s of snapshots.filter(s=>!terminal(s.run.status))){await select(s.run.id);await page.getByRole('button',{name:'cancel',exact:true}).click();}
      }
      const drain=Date.now()+60000;
      while(Date.now()<drain){await capture();if(capacity.dispatches.length===0)break;await delay(1000);}
    }catch(e){failure??=`Cleanup UI failed: ${e.message}`;}
    const evidence=analyze(snapshots,samples,ids);
    const gitAssertions=fixture.map(f=>{
      const s=snapshots.find(s=>s.run.repository===f.repository),a=s?.artifacts.at(-1);
      return {name:f.name,mainUnchanged:git(f.repository,'rev-parse','main')===f.baseSha,
        primaryClean:git(f.repository,'status','--porcelain')==='',noRemotes:git(f.repository,'remote')==='',
        finalTestsUnchanged:!!a&&hash(execFileSync('/usr/bin/git',['show',`${a.sha}:fixed.test.cjs`],{cwd:f.repository}))===f.testsSha256,
        onlyImplementationChanged:!!a&&git(f.repository,'diff','--name-only',f.baseSha,a.sha)==='implementation.cjs'};
    });
    const assertions={...evidence.assertions,threeUIStarts:starts.length===3,
      gitIsolation:gitAssertions.every(a=>Object.entries(a).filter(([k])=>k!=='name').every(([,v])=>v)),
      viewports:ui.length===4,noRendererErrors:errors.length===0,capacityDrained:capacity?.dispatches.length===0};
    const verdict=!failure&&Object.values(assertions).every(Boolean)?'passed':
      !failure&&Object.entries(assertions).filter(([k])=>!['realOverlap','queuedWithoutPreparation','queueReleasedSafely'].includes(k)).every(([,v])=>v)?'inconclusive':'failed';
    fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify({verdict,failure,root,deadline,realInference:true,uiTested:true,starts,fixture,assertions,gitAssertions,ui,errors,evidence,samples,snapshots,capacity},null,2));
    console.log(JSON.stringify({root,verdict,failure,assertions,receipt:path.join(root,'receipt.json')}));
    await app.close();if(verdict!=='passed')process.exitCode=1;
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
