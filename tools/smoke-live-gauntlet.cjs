'use strict';
// Explicit live acceptance smoke. No synthetic accounts, reports or model output.
// The sole injected fault is recorded before the first main-owned commit.
const fs=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const load=require('../test/load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {GauntletControlServer}=load('src/main/gauntlet/controlServer.ts');
const {IsolatedGauntletRunner}=load('src/main/gauntlet/isolatedRunner.ts');
const {createIsolatedProviderFactory}=load('src/main/gauntlet/isolatedProviderFactory.ts');
const {isolatedGauntletLaunchError}=load('src/shared/billingPolicy.ts');
const hash=x=>createHash('sha256').update(x).digest('hex');
const terminal=s=>['passed','human_required','cancelled','infrastructure_failure'].includes(s);

async function main(){
  if(process.argv[2]!=='--live')throw Error('Explicit --live is required; this uses subscription allowance.');
  const deadline=Date.parse(process.argv[3]);
  if(!Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+15*60*1000)throw Error('Supply a deadline within 15 minutes.');
  const held=isolatedGauntletLaunchError(process.platform);if(held)throw Error(held);
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-live-gauntlet-'))),repository=join(root,'repo'),stateRoot=join(root,'state');
  fs.mkdirSync(repository);
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repository,encoding:'utf8',stdio:'pipe',timeout:10000,
    env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
  git('init','-b','main');git('config','user.name','Operatus smoke');git('config','user.email','smoke@example.invalid');
  fs.writeFileSync(join(repository,'clamp.cjs'),'"use strict";\nexports.clamp = function clamp(value, min, max) { return value; };\n');
  fs.writeFileSync(join(repository,'clamp.test.cjs'),`'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clamp}=require('./clamp.cjs');
test('below minimum',()=>assert.equal(clamp(-2,0,10),0));
test('inside bounds',()=>assert.equal(clamp(4,0,10),4));
test('above maximum',()=>assert.equal(clamp(15,0,10),10));
test('inclusive boundaries',()=>{assert.equal(clamp(0,0,10),0);assert.equal(clamp(10,0,10),10);});
test('negative and fractional bounds',()=>{assert.equal(clamp(-8,-5,-1),-5);assert.equal(clamp(0.75,0.1,0.5),0.5);});
`);
  git('add','.');git('commit','-m','Disposable clamp regression fixture');const baseSha=git('rev-parse','HEAD');
  const baselineTests=hash(fs.readFileSync(join(repository,'clamp.test.cjs')));
  let runner,runId,lastPhase,injection;
  const backend=new LocalGauntletBackend({stateRoot,primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();
  const publish=snapshot=>{runner?.observe(snapshot);const phase=snapshot.run.status;
    if(phase!==lastPhase){lastPhase=phase;console.log(JSON.stringify({runId:snapshot.run.id,phase,round:snapshot.run.repairRound,at:new Date().toISOString()}));}
  };
  const commit=backend.commitWorkingArtifact.bind(backend);
  backend.commitWorkingArtifact=async(input,signal)=>{
    const snapshot=backend.status(input.runId),launch=snapshot.launches.find(l=>l.id===input.launchId);
    if(!injection && input.runId===runId && launch?.role==='implementer' && launch.tokenHash===hash(input.token) &&
      snapshot.run.currentLaunchId===launch.id && launch.expectedSha===input.expectedSha && snapshot.run.contract.digest===input.contractDigest){
      const path=join(launch.worktreePath,'clamp.cjs'),before=fs.readFileSync(path);
      const suffix='\nconst smokeOriginalClamp = exports.clamp;\nexports.clamp = (value, min, max) => value > max ? max + 1 : smokeOriginalClamp(value, min, max);\n';
      fs.appendFileSync(path,suffix);
      injection={kind:'authorized-test-only-fault',at:new Date().toISOString(),launchId:launch.id,
        file:'clamp.cjs',description:'Above-maximum values return max + 1. Injected after worker edits, before first commit.',
        beforeSha256:hash(before),afterSha256:hash(fs.readFileSync(path)),expectedParent:input.expectedSha};
      fs.writeFileSync(join(root,'fault-injection.json'),JSON.stringify(injection,null,2));
      console.log(JSON.stringify({event:'fault-injected',launchId:launch.id}));
    }
    return commit(input,signal);
  };
  const server=new GauntletControlServer(stateRoot,backend,publish);await server.start();
  const factory=createIsolatedProviderFactory({root:join(root,'profiles'),helperSource:join(__dirname,'../resources/operatus-gauntlet.cjs'),
    nodePath:process.execPath,socketPath:()=>server.info().socketPath,reviewEvidenceRoot:join(stateRoot,'review-evidence'),
    skills:backend.skills,assertAdmissionOpen:()=>{const error=isolatedGauntletLaunchError(process.platform);if(error)throw Error(error);}});
  runner=new IsolatedGauntletRunner(backend,factory,()=>isolatedGauntletLaunchError(process.platform),publish);
  const providers={conductor:{provider:'claude',model:'claude-fable-5-1'},implementer:{provider:'claude',model:'claude-fable-5-1'},
    repairer:{provider:'claude',model:'claude-fable-5-1'},critic:{provider:'codex',model:'gpt-5.6-sol'}};
  const snapshot=backend.start({repository,providers,objective:'Fix exports.clamp(value, min, max) in clamp.cjs for finite numeric inputs where min <= max. Return min below the minimum, max above the maximum, and value inside the inclusive bounds, including negative and fractional bounds. Preserve the exports.clamp interface. Change only clamp.cjs. Do not modify clamp.test.cjs or add dependencies. Freeze node --test clamp.test.cjs as a required check. Keep this task small; no refactors or extra functionality.',
    limits:{maxRepairRounds:1,runTimeoutMs:deadline-Date.now(),workerTimeoutMs:180000,criticTimeoutMs:180000}});
  runId=snapshot.run.id;console.log(JSON.stringify({root,runId,baseSha,realInference:true}));
  const timeout=setTimeout(()=>{const s=backend.status(runId);if(!terminal(s.run.status))publish(backend.cancel(runId,'Supervised smoke time limit reached'));},deadline-Date.now());
  const sweep=setInterval(()=>{for(const s of backend.sweepTimeouts())publish(s);},5000);
  try{
    await runner.advance(runId);
    const final=backend.status(runId);
    const artifact=final.artifacts.at(-1);
    const assertions={passed:final.run.status==='passed',faultInjected:!!injection,repairRound:final.run.repairRound===1,
      twoArtifacts:final.artifacts.length===2,twoReports:final.reports.length===2,
      realReviseThenPass:final.reports[0]?.verdict==='REVISE'&&final.reports[1]?.verdict==='PASS',
      twoAcknowledgments:final.acknowledgments.length===2,
      distinctSessions:new Set(final.launches.map(l=>l.sessionId)).size===final.launches.length,
      fiveLaunches:final.launches.length===5,
      checksPassed:!!artifact&&artifact.checkReceipts.length>0&&artifact.checkReceipts.every(c=>c.exitCode===0&&!c.timedOut),
      mainUnchanged:git('rev-parse','main')===baseSha,
      testsUnchanged:!!artifact&&hash(Buffer.from(git('show',artifact.sha+':clamp.test.cjs')+'\n'))===baselineTests,
      liveAdmissions:final.runtimeObservations.filter(o=>o.event.type==='subscription_admission').length===5&&
        final.runtimeObservations.filter(o=>o.event.type==='subscription_admission').every(o=>o.event.source==='provider-metadata')};
    let cancellation=null;
    if(final.run.status==='passed'){
      const unused=backend.start({repository,providers,objective:'Cancellation-only check; do not launch agents.'});
      const cancelled=backend.cancel(unused.run.id,'Supervised cancellation of an unstarted run');
      cancellation={runId:unused.run.id,status:cancelled.run.status,launchCount:cancelled.launches.length};
    }
    const result={root,runId,realInference:true,uiTested:false,baseSha,assertions,cancellation,injection,snapshot:final,capacity:runner.capacity()};
    fs.writeFileSync(join(root,'receipt.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({root,runId,status:final.run.status,stopReason:final.run.stopReason,assertions,cancellation,
      artifacts:final.artifacts.map(a=>({sha:a.sha,branch:a.branch,checks:a.checkReceipts.map(c=>({command:c.command,exitCode:c.exitCode}))})),
      reports:final.reports.map(r=>({id:r.id,verdict:r.verdict,summary:r.summary})),receipt:join(root,'receipt.json')}));
    if(!Object.values(assertions).every(Boolean))process.exitCode=1;
  }finally{clearTimeout(timeout);clearInterval(sweep);await runner.close();await server.stop();backend.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
