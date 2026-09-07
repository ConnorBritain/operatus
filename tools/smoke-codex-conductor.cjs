'use strict';
// Opt-in runtime acceptance, not a desktop/UI smoke. Real subscription sessions;
// disposable repository, fixed tests, no injected failures or synthesized reports.
const fs=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const load=require('../test/load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {GauntletControlServer}=load('src/main/gauntlet/controlServer.ts');
const {IsolatedGauntletRunner}=load('src/main/gauntlet/isolatedRunner.ts');
const {createIsolatedProviderFactory}=load('src/main/gauntlet/isolatedProviderFactory.ts');
const {isolatedGauntletLaunchError}=load('src/shared/billingPolicy.ts');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  if(process.argv[2]!=='--live')throw Error('Explicit --live required: this consumes subscription allowance.');
  const held=isolatedGauntletLaunchError(process.platform);if(held)throw Error(held);
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-astra-conductor-'))),repository=join(root,'repo'),stateRoot=join(root,'state');
  fs.mkdirSync(repository);
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repository,encoding:'utf8',stdio:'pipe',timeout:10000,
    env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
  git('init','-b','main');git('config','user.name','Operatus smoke');git('config','user.email','smoke@example.invalid');
  fs.writeFileSync(join(repository,'capacity.cjs'),'exports.capacity = requested => requested;\n');
  fs.writeFileSync(join(repository,'capacity.test.cjs'),`const test=require('node:test'),assert=require('node:assert/strict');
const {capacity}=require('./capacity.cjs');
test('finite capacity floors then clamps to 1..8',()=>{for(const [input,expected] of [[-5,1],[0,1],[1,1],[2.9,2],[7.9,7],[8,8],[25,8]])assert.equal(capacity(input),expected);});\n`);
  git('add','.');git('commit','-m','Fixed capacity smoke tests');const base=git('rev-parse','HEAD');
  const baseline=hash(fs.readFileSync(join(repository,'capacity.test.cjs')));
  const backend=new LocalGauntletBackend({stateRoot,primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();
  let runner,last;
  const publish=snapshot=>{runner?.observe(snapshot);if(last!==snapshot.run.status){last=snapshot.run.status;console.log(JSON.stringify({status:last,at:new Date().toISOString()}));}};
  const server=new GauntletControlServer(stateRoot,backend,publish);await server.start();
  const factory=createIsolatedProviderFactory({root:join(root,'profiles'),helperSource:join(__dirname,'../resources/operatus-gauntlet.cjs'),
    nodePath:process.execPath,socketPath:()=>server.info().socketPath,reviewEvidenceRoot:join(stateRoot,'review-evidence'),
    skills:backend.skills,assertAdmissionOpen:()=>{const error=isolatedGauntletLaunchError(process.platform);if(error)throw Error(error);}});
  runner=new IsolatedGauntletRunner(backend,factory,()=>isolatedGauntletLaunchError(process.platform),publish);
  const providers={conductor:{provider:'codex',model:'gpt-6-astra'},implementer:{provider:'claude',model:'claude-fable-5-1'},
    repairer:{provider:'claude',model:'claude-fable-5-1'},critic:{provider:'codex',model:'gpt-5.6-sol'}};
  const snapshot=backend.start({repository,providers,objective:'Implement exports.capacity(requested) in capacity.cjs. For finite numbers, round down then clamp to the inclusive integer range 1 through 8. Change only capacity.cjs. Never modify capacity.test.cjs or add dependencies. Freeze node --test capacity.test.cjs as a required check. This is a small isolated acceptance smoke, not an invitation to refactor.',
    limits:{maxRepairRounds:1,runTimeoutMs:8*60*1000,workerTimeoutMs:150000,criticTimeoutMs:150000}});
  const runId=snapshot.run.id;console.log(JSON.stringify({root,runId,model:'gpt-6-astra',realInference:true,uiTested:false}));
  const sweep=setInterval(()=>{for(const s of backend.sweepTimeouts())publish(s);},1000);
  const deadline=setTimeout(()=>{if(!['passed','cancelled','human_required','infrastructure_failure'].includes(backend.status(runId).run.status))publish(backend.cancel(runId,'Eight-minute runtime smoke limit'));},8*60*1000);
  try{
    await runner.advance(runId);const s=backend.status(runId),lead=s.launches.find(l=>l.role==='conductor'),artifact=s.artifacts.at(-1);
    const observations=s.runtimeObservations,identities=observations.filter(o=>o.launchId===lead?.id&&o.event.type==='native_identity').map(o=>o.event);
    const assertions={passed:s.run.status==='passed',astraLead:lead?.provider==='codex'&&lead?.model==='gpt-6-astra',
      oneLead:s.launches.filter(l=>l.role==='conductor').length===1,sameThread:new Set(identities.map(i=>i.threadId)).size===1,
      multipleTurns:identities.filter(i=>i.turnId).length>=2,acknowledged:s.acknowledgments.length>=1,
      exactCritic:!!artifact&&s.reports.at(-1)?.artifactSha===artifact.sha&&s.reports.at(-1)?.verdict==='PASS',
      checksPassed:!!artifact&&artifact.checkReceipts.length>0&&artifact.checkReceipts.every(c=>c.exitCode===0&&!c.timedOut),
      mainUntouched:git('rev-parse','main')===base,testsUntouched:!!artifact&&hash(Buffer.from(git('show',`${artifact.sha}:capacity.test.cjs`)+'\n'))===baseline,
      onlyAssignedFile:!!artifact&&git('diff','--name-only',base,artifact.sha)==='capacity.cjs',
      liveAdmissions:observations.filter(o=>o.event.type==='subscription_admission').length===s.launches.length&&observations.filter(o=>o.event.type==='subscription_admission').every(o=>o.event.source==='provider-metadata'),
      cleanup:observations.filter(o=>o.event.type==='process_exited').length===s.launches.length&&observations.filter(o=>o.event.type==='process_exited').every(o=>o.event.processExited&&o.event.gatewayRevocation==='confirmed'),
      released:runner.capacity().dispatches.length===0};
    fs.writeFileSync(join(root,'receipt.json'),JSON.stringify({root,runId,realInference:true,uiTested:false,assertions,snapshot:s,capacity:runner.capacity()},null,2));
    console.log(JSON.stringify({root,runId,status:s.run.status,stopReason:s.run.stopReason,assertions,receipt:join(root,'receipt.json')}));
    if(!Object.values(assertions).every(Boolean))process.exitCode=1;
  }finally{clearInterval(sweep);clearTimeout(deadline);await runner.close();await server.stop();backend.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
