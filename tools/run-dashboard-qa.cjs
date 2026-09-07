'use strict';
// Real QA Gauntlet over an immutable, explicitly limited evidence bundle.
// UI scenarios are synthetic; the reviewing provider sessions are real.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const load=require('../test/load-ts.cjs');
async function main(){
  const [flag,uiRoot,liveReceipt,deadlineText]=process.argv.slice(2),deadline=Date.parse(deadlineText);
  if(flag!=='--live'||!path.basename(uiRoot??'').startsWith('operatus-run-control-')||!Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+45*60000)throw Error('Explicit --live, fixture, live receipt and bounded deadline required');
  const evidence=JSON.parse(fs.readFileSync(liveReceipt,'utf8'));
  if(evidence.snapshot?.run.status!=='passed'||!Object.values(evidence.assertions).every(Boolean))throw Error('Passing live prerequisite required');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'op-dashboard-qa-'))),repository=path.join(root,'repo'),stateRoot=path.join(root,'state');
  fs.mkdirSync(repository);fs.mkdirSync(path.join(repository,'evidence'));fs.mkdirSync(path.join(repository,'source'));
  const repo=path.resolve(__dirname,'..'),manifest={kind:'limited-source-and-captured-evidence',files:{}};
  const copy=(source,target)=>{const to=path.join(repository,target);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(source,to);manifest.files[target]=crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex');};
  for(const name of ['portfolio-ui-receipt.json','run-context-ui-receipt.json','portfolio-attention-mac.png','portfolio-attention-1080p.png','portfolio-scoped-mac.png','portfolio-scoped-1080p.png'])copy(path.join(uiRoot,name),'evidence/'+name);
  copy(liveReceipt,'evidence/live-gauntlet.json');
  for(const relative of ['src/renderer/src/App.tsx','src/renderer/src/components/GauntletRunsTab.tsx','src/renderer/src/components/GauntletCapacityPanel.tsx','src/renderer/src/components/OfficeRunsPanel.tsx','src/renderer/src/gauntlet/runViewState.ts','src/renderer/src/gauntlet/capacityView.ts','src/renderer/src/gauntlet/runtimeView.ts','src/shared/gauntlet.ts','tools/smoke-run-portfolio-ui.cjs','tools/smoke-run-context-ui.cjs'])copy(path.join(repo,relative),'source/'+relative);
  copy(path.join(repo,'test/fixtures/dashboard-qa-verify.cjs'),'verify-report.cjs');
  fs.writeFileSync(path.join(repository,'manifest.json'),JSON.stringify(manifest,null,2));
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repository,encoding:'utf8',stdio:'pipe',env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
  git('init','-b','main');git('config','user.name','Operatus QA');git('config','user.email','qa@example.invalid');git('add','.');git('commit','-m','Snapshot actual dashboard source and observed UI evidence');
  const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts'),{GauntletControlServer}=load('src/main/gauntlet/controlServer.ts');
  const {IsolatedGauntletRunner}=load('src/main/gauntlet/isolatedRunner.ts'),{createIsolatedProviderFactory}=load('src/main/gauntlet/isolatedProviderFactory.ts');
  const {isolatedGauntletLaunchError}=load('src/shared/billingPolicy.ts');
  const backend=new LocalGauntletBackend({stateRoot,primitiveRoot:path.join(repo,'vendor/agent-primitives')});backend.open();let runner,last;
  const publish=s=>{runner?.observe(s);if(s.run.status!==last){last=s.run.status;console.log(JSON.stringify({phase:last,round:s.run.repairRound,at:new Date().toISOString()}));}};
  const server=new GauntletControlServer(stateRoot,backend,publish);await server.start();
  const factory=createIsolatedProviderFactory({root:path.join(root,'profiles'),helperSource:path.join(repo,'resources/operatus-gauntlet.cjs'),nodePath:process.execPath,socketPath:()=>server.info().socketPath,reviewEvidenceRoot:path.join(stateRoot,'review-evidence'),skills:backend.skills,assertAdmissionOpen:()=>{const e=isolatedGauntletLaunchError(process.platform);if(e)throw Error(e);}});
  runner=new IsolatedGauntletRunner(backend,factory,()=>isolatedGauntletLaunchError(process.platform),publish);
  const objective='Produce QA.md: an evidence-backed operator dashboard readiness brief for Operatus. This repository is a LIMITED snapshot of actual app source and captured evidence, not the runnable full app. Inspect the screenshots, the actual source, and machine-readable receipts. Assess visual hierarchy at 1440x870 and 1920x1080, selection/context preservation, decision ownership and Needs you routing, repository separation, and readiness to oversee three simultaneous Gauntlets. Distinguish the one real successful subscription Gauntlet from synthetic UI states; do not claim real concurrency, full-suite QA, mobile, Windows, or physical 1080p display acceptance. Inspect images if your tool supports them; otherwise explicitly disclose that limitation and do not claim visual inspection. Produce sections Verdict, Verified behavior, Findings, Not proven, Next acceptance run. Cite concrete evidence paths and source lines for each material finding, label inference, prioritize fixes by operator impact, and propose one bounded real concurrent acceptance test. Do not invent defects or claim proposed fixes are implemented. Only add QA.md; all snapshot files and manifest.json must remain unchanged. Freeze node verify-report.cjs as a required check. No dependencies, network, app implementation, or unrelated research.';
  const run=backend.start({repository,objective,providers:{conductor:{provider:'claude',model:'claude-fable-5-1'},implementer:{provider:'claude',model:'claude-fable-5-1'},repairer:{provider:'claude',model:'claude-fable-5-1'},critic:{provider:'codex',model:'gpt-5.6-sol'}},limits:{maxRepairRounds:2,workerTimeoutMs:8*60000,criticTimeoutMs:6*60000,runTimeoutMs:deadline-Date.now()}}).run;
  console.log(JSON.stringify({root,runId:run.id,baseSha:run.baseSha,realInference:true}));
  const timer=setInterval(()=>{for(const s of backend.sweepTimeouts())publish(s);},5000);
  try{await runner.advance(run.id);const snapshot=backend.status(run.id);fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify({kind:'real-qa-gauntlet-over-limited-evidence',snapshot},null,2));console.log(JSON.stringify({root,status:snapshot.run.status,reason:snapshot.run.stopReason,artifacts:snapshot.artifacts.map(a=>a.sha),reports:snapshot.reports.map(r=>({verdict:r.verdict,summary:r.summary}))}));if(snapshot.run.status!=='passed')process.exitCode=1;}
  finally{clearInterval(timer);await runner.close();await server.stop();backend.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
