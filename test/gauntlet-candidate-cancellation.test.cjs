'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {join}=require('node:path'),{tmpdir}=require('node:os'),load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const mac={skip:process.platform!=='darwin',timeout:20000};
const git=(cwd,...args)=>cp.execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-async-git-'))),backend=new LocalGauntletBackend({
  stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();t.after(()=>backend.close());
 function project(name){
  const repository=join(root,name);fs.mkdirSync(repository);git(repository,'init','-b','main');
  git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
  fs.writeFileSync(join(repository,'value.txt'),'base');git(repository,'add','.');git(repository,'commit','-m','base');
  const run=backend.start({repository,objective:name}).run;
  backend.freeze(run.id,{objective:name,criteria:['Exact isolated change'],checks:[],constraints:[],exclusions:[]});
  const worker=backend.prepareImplementer(run.id),cwd=worker.launch.worktreePath;
  fs.writeFileSync(join(cwd,'value.txt'),`changed ${name}`);
  const input={runId:run.id,launchId:worker.launch.id,token:worker.token,expectedSha:run.baseSha,
   contractDigest:backend.status(run.id).run.contract.digest,message:`Change ${name}`};
  return{repository,run,worker,cwd,input};
 }
 return{root,backend,project};
}
// Stop ONE real Git child at a deterministic boundary. We do not replace Git's
// output or weaken its sandbox. This makes responsiveness/cancellation observable
// without filling a nearly-full disk or relying on a race in a huge repository.
function pauseGit(t,cwd,verb){
 const original=cp.spawn;let resolvePaused,held=null,used=false;
 const paused=new Promise(r=>resolvePaused=r);
 cp.spawn=function(command,args,options){
  const child=original.apply(this,arguments);
  if(!used&&command==='/usr/bin/sandbox-exec'&&args.includes(`--work-tree=${cwd}`)&&args.includes(verb)){
   used=true;held=child;process.kill(child.pid,'SIGSTOP');resolvePaused(child);
  }
  return child;
 };
 t.after(()=>{cp.spawn=original;if(held&&held.exitCode===null&&held.signalCode===null){try{process.kill(held.pid,'SIGKILL');}catch{}}});
 return paused;
}
const observed=p=>p.then(snapshot=>({snapshot}),error=>({error}));
function unchanged(project){assert.equal(git(project.repository,'rev-parse','main'),project.run.baseSha);
 assert.equal(fs.readFileSync(join(project.repository,'value.txt'),'utf8'),'base');}

test('paused candidate Git leaves the event loop and peer run responsive; cancellation preserves only that attempt',mac,async t=>{
 const f=fixture(t),a=f.project('ledger'),b=f.project('site'),paused=pauseGit(t,a.cwd,'add');
 const result=observed(f.backend.commitWorkingArtifact(a.input));t.after(async()=>{f.backend.close();await result;});
 const child=await paused;
 assert.equal(f.backend.isCompleting(a.run.id),true);
 await assert.rejects(f.backend.commitWorkingArtifact(a.input),/already in progress/);
 let ticks=0;const timer=setInterval(()=>ticks++,1);t.after(()=>clearInterval(timer));
 const peer=await f.backend.commitWorkingArtifact(b.input);
 assert.equal(peer.run.status,'awaiting_critic');assert.ok(ticks>0,'main event loop kept processing timers while Git was stopped');
 assert.equal(f.backend.status(a.run.id).run.status,'implementer_in_flight');
 const cancelled=f.backend.cancel(a.run.id,'Cancel stalled Git only');
 assert.equal(cancelled.run.status,'cancelled');assert.equal(cancelled.preservations.at(-1).outcome,'pending');
 assert.equal(f.backend.isCompleting(a.run.id),true,'ownership retained until process close');
 assert.match((await result).error?.message,/interrupted/);
 assert.ok(child.exitCode!==null||child.signalCode!==null,'actual child exit observed');
 assert.equal(f.backend.isCompleting(a.run.id),false);
 const stopped=f.backend.status(a.run.id);assert.equal(stopped.artifacts.length,0);
 assert.equal(stopped.preservations.at(-1).outcome,'preserved');assert.equal(stopped.preservations.at(-1).dirty,true);
 assert.equal(fs.readFileSync(join(a.cwd,'value.txt'),'utf8'),'changed ledger');
 assert.equal(git(a.cwd,'rev-parse','--abbrev-ref','HEAD'),'HEAD');
 assert.equal(f.backend.status(b.run.id).artifacts.length,1);unchanged(a);unchanged(b);
});

test('cancellation after the attempt ref advances retains the exact unaccepted commit',mac,async t=>{
 const f=fixture(t),a=f.project('after-cas'),paused=pauseGit(t,a.cwd,'status');
 const result=observed(f.backend.commitWorkingArtifact(a.input));t.after(async()=>{f.backend.close();await result;});
 await paused;
 const sha=git(a.cwd,'rev-parse','HEAD');assert.notEqual(sha,a.run.baseSha);
 assert.equal(git(a.cwd,'rev-parse',`${sha}^`),a.run.baseSha);
 f.backend.cancel(a.run.id,'Cancel after Git commit, before acceptance');
 assert.match((await result).error?.message,/interrupted/);
 const stopped=f.backend.status(a.run.id);assert.equal(stopped.run.status,'cancelled');assert.equal(stopped.artifacts.length,0);
 assert.equal(stopped.preservations.at(-1).observedSha,sha);assert.equal(stopped.preservations.at(-1).outcome,'preserved');
 assert.equal(git(a.repository,'rev-parse',a.worker.launch.candidateBranch),sha);
 assert.equal(git(a.repository,'show',`${sha}:value.txt`),'changed after-cas');unchanged(a);
});

test('backend close aborts in-flight candidate Git before any late artifact write',mac,async t=>{
 const f=fixture(t),a=f.project('shutdown'),paused=pauseGit(t,a.cwd,'add');
 const result=observed(f.backend.commitWorkingArtifact(a.input));t.after(async()=>{f.backend.close();await result;});
 const child=await paused;f.backend.close();assert.throws(()=>f.backend.open(),/draining/);
 assert.match((await result).error?.message,/closing/);assert.ok(child.exitCode!==null||child.signalCode!==null);
 f.backend.open();assert.equal(f.backend.status(a.run.id).artifacts.length,0);unchanged(a);
 assert.equal(fs.readFileSync(join(a.cwd,'value.txt'),'utf8'),'changed shutdown');
});

test('the actual Git deadline kills a stopped child and leaves an attempt available for recovery', {...mac,timeout:25000}, async t=>{
 const f=fixture(t),a=f.project('deadline'),paused=pauseGit(t,a.cwd,'add');
 const result=observed(f.backend.commitWorkingArtifact(a.input));t.after(async()=>{f.backend.close();await result;});
 const child=await paused;
 assert.match((await result).error?.message,/timed out/);
 assert.ok(child.exitCode!==null||child.signalCode!==null);
 assert.equal(f.backend.isCompleting(a.run.id),false);assert.equal(f.backend.status(a.run.id).artifacts.length,0);
 assert.equal(fs.readFileSync(join(a.cwd,'value.txt'),'utf8'),'changed deadline');unchanged(a);
 const failed=f.backend.infrastructureFailure(a.run.id,'Candidate Git timed out',true);
 assert.equal(failed.run.status,'awaiting_implementation');assert.equal(failed.preservations.at(-1).outcome,'preserved');
 const retry=f.backend.prepareImplementer(a.run.id);
 assert.notEqual(retry.launch.id,a.worker.launch.id);assert.notEqual(retry.launch.candidateBranch,a.worker.launch.candidateBranch);
 assert.equal(git(retry.launch.worktreePath,'rev-parse','HEAD'),a.run.baseSha);
 assert.equal(fs.readFileSync(join(a.cwd,'value.txt'),'utf8'),'changed deadline');
});
