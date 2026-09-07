'use strict';
// Explicitly invoked UI fixture, never routine CI or a real-provider smoke.
// Uses real disposable Git/SQLite state and synthetic Critic evidence. No CLI AI.
const fs=require('node:fs');const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');const {execFileSync}=require('node:child_process');
const load=require('../test/load-ts.cjs');
if(!load('src/shared/billingPolicy.ts').subscriptionLaunchError())throw Error('Requires the production launch hold');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
async function main() {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'operatus-run-control-')));
  const profile=join(root,'profile'),home=join(root,'harness');
  fs.mkdirSync(profile);fs.mkdirSync(home);
  const repositories=['ledger','website','side-project'].map(name=>{
    const path=join(root,name);fs.mkdirSync(path);
    const git=args=>execFileSync('/usr/bin/git',args,{cwd:path,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git(['init','-b','main']);git(['config','user.name','Operatus UI Fixture']);git(['config','user.email','fixture@example.invalid']);
    fs.writeFileSync(join(path,'README.md'),'UI verification fixture. No model execution.\n');git(['add','.']);git(['commit','-m','fixture base']);
    return path;
  });
  const backend=new LocalGauntletBackend({stateRoot:profile,primitiveRoot:resolve(__dirname,'../vendor/agent-primitives')});
  backend.open();
  const ids={};
  const start=(key,repository,objective)=>{
    const run=backend.start({repository,objective:`[UI fixture] ${objective}`,limits:{runTimeoutMs:24*60*60*1000}}).run;ids[key]=run.id;return run;
  };
  const freeze=(run,leadId)=>backend.freeze(run.id,{objective:run.requestedObjective,criteria:['Fixture criterion: preserve the selected run identity'],checks:[],constraints:['No model execution'],exclusions:['Live provider acceptance']},leadId);
  try {
    const human=start('human',repositories[0],'Decide the invoice rounding rule before release');
    backend.escalate(human.id,'Fixture escalation: choose per-line or invoice-total rounding. Conflicting acceptance criteria need operator judgment.');
    const failure=start('failure',repositories[1],'Recover the documentation build');
    backend.infrastructureFailure(failure.id,'Fixture failure: the build prerequisite is unavailable. No provider process was started.',false);
    const queued=start('queued',repositories[0],'Add duplicate-invoice protection');freeze(queued);
    start('orienting',repositories[2],'Define the personal archive import contract');
    const ack=start('ack',repositories[1],'Review accessible keyboard navigation');freeze(ack);
    const worker=backend.prepareImplementer(ack.id);
    const git=args=>execFileSync('/usr/bin/git',args,{cwd:worker.launch.worktreePath,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    fs.writeFileSync(join(worker.launch.worktreePath,'keyboard.txt'),'Synthetic UI evidence; not a tested application behavior.\n');
    git(['add','keyboard.txt']);git(['commit','-m','UI fixture candidate']);
    const artifact=await backend.completeArtifact({runId:ack.id,launchId:worker.launch.id,token:worker.token,sha:git(['rev-parse','HEAD'])});
    const critic=backend.prepareCritic(ack.id);
    backend.submitCritic({runId:ack.id,launchId:critic.launch.id,token:critic.token,
      artifactSha:artifact.run.currentArtifactSha,contractDigest:artifact.run.contract.digest,
      verdict:'REVISE',summary:'Synthetic Critic report for UI inspection only. No independent model ran.',
      findings:[{id:'fixture-keyboard',severity:'major',title:'Fixture: focus restoration needs review',
        evidence:'Synthetic finding used to verify report identity and Conductor responsibility in the UI.',criterionIds:[]}]});
    const cancelled=start('cancelled',repositories[2],'Archive the abandoned import experiment');
    backend.cancel(cancelled.id,'Fixture cancellation: preserve evidence and do not resume workers.');
    const retained=start('retained',repositories[2],'Inspect an interrupted experiment without accepting its commit');freeze(retained);
    const interrupted=backend.prepareImplementer(retained.id);
    const retainedGit=args=>execFileSync('/usr/bin/git',args,{cwd:interrupted.launch.worktreePath,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    fs.writeFileSync(join(interrupted.launch.worktreePath,'experiment.txt'),'Unrecorded fixture commit. No provider ran.\n');
    retainedGit(['add','.']);retainedGit(['commit','-m','interrupted UI fixture']);
    fs.writeFileSync(join(interrupted.launch.worktreePath,'notes.txt'),'Untracked fixture notes retained for diagnosis.\n');
    backend.cancel(retained.id,'Fixture interruption: keep the commit and unfinished notes, but do not accept an artifact.');
    if(process.argv.includes('--office')) {
      // Synthetic lifecycle rows, deliberately recovered as UNKNOWN on desktop
      // startup. These are not real PIDs, model output, or live run acceptance.
      for(let i=0;i<3;i++) {
        const run=start(`office-${i}`,repositories[i],`Office observation ${i+1}: inspect separate lead and worker ownership`);
        const lead=backend.prepareConductor(run.id); freeze(run,lead.launch.id);
        const worker=backend.prepareImplementer(run.id);
        for(const prepared of [lead,worker]) backend.store.recordRuntimeObservation({
          runId:run.id,launchId:prepared.launch.id,sessionId:prepared.launch.sessionId,at:Date.now(),
          event:{type:'process_started',pid:2000000000+i,model:prepared.launch.model ?? 'claude-fixture',
            profileSha256:'a'.repeat(64),boundarySha256:'b'.repeat(64)}
        });
      }
    }
    if(process.argv.includes('--volume')){
      for(let i=0;i<36;i++){
        const run=start(`volume-${i}`,repositories[i%3],`Portfolio load ${String(i+1).padStart(2,'0')}: ${['reconcile payment imports','ship accessible account settings','index personal reference notes'][i%3]}`);
        if(i%6===0)backend.escalate(run.id,'Synthetic portfolio decision: confirm the compatibility boundary before continuing.');
        else if(i%6===1)backend.infrastructureFailure(run.id,'Synthetic portfolio failure: required local test dependency unavailable.',false);
        else if(i%2===0)freeze(run);
      }
    }
    if(process.argv.includes('--capacity')) {
      // Simulate a previous scheduler owner, not active native work. Desktop
      // recovery must quarantine these two slots; the remaining runs wait.
      for(let i=0;i<4;i++) {
        const run=start(`capacity-${i}`,repositories[i%3],`Capacity ${i+1}: ${i<2?'inspect interrupted reservation':'wait for a free run slot'}`);
        backend.store.scheduler.enqueue(run.id);
        if(i<2) backend.store.scheduler.claimNext('synthetic-prior-owner');
      }
    }
  } finally {backend.close();}
  fs.writeFileSync(join(profile,'config.json'),JSON.stringify({onboardingComplete:true,harnessHome:home,recentHives:[home],registeredRepos:repositories,
    missions:[],opsStandupSeeded:true,heartbeatSeeded:true,semanticMemory:false,reflectEnabled:false,notifications:false,
    telemetryEnabled:false,autoUpdate:false,freeflowEnabled:false,realtimeVoiceEnabled:false}));
  const receipt={root,profile,home,repositories,ids,kind:'synthetic-ui-fixture-no-models',syntheticOffice:process.argv.includes('--office')};
  fs.writeFileSync(join(root,'receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
