'use strict';
// Real owner SIGKILL between Git worktree creation and launch recording.
// No inference: tests durable preparation inventory and fail-closed restart.
const fs=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
const options=root=>({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});
if(process.env.OPERATUS_ORPHAN_CHILD){
  const root=process.env.OPERATUS_ORPHAN_ROOT,role=process.env.OPERATUS_ORPHAN_CHILD;
  const saved=JSON.parse(fs.readFileSync(join(root,'before.json'),'utf8'));
  const backend=new LocalGauntletBackend(options(root));backend.open();
  const method=role==='critic'?'createCritic':'createCandidate';
  const create=backend.workspaces[method].bind(backend.workspaces);
  backend.workspaces[method]=input=>{
    const workspace=create(input);
    fs.writeFileSync(join(root,'created-workspace.json'),JSON.stringify({input,workspace},null,2),{mode:0o600});
    process.kill(process.pid,'SIGKILL'); // No backend.close or launch transition.
    throw Error('Owner unexpectedly survived SIGKILL');
  };
  if(role==='critic')backend.prepareCritic(saved.run.id);else backend.prepareImplementer(saved.run.id);
}else{
  const test=require('node:test'),assert=require('node:assert/strict');
  for(const role of ['implementer','critic'])test(`${role} pre-recording crash retains work and durable preparation inventory`,{skip:process.platform!=='darwin',timeout:20000},async()=>{
    const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-prelaunch-orphan-'))),repository=join(root,'repo');fs.mkdirSync(repository);
    git(repository,'init','-b','main');git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
    fs.writeFileSync(join(repository,'value.txt'),'base');git(repository,'add','.');git(repository,'commit','-m','base');
    let backend=new LocalGauntletBackend(options(root));backend.open();
    const run=backend.start({repository,objective:'Pre-launch crash diagnostic; no provider'}).run;
    backend.freeze(run.id,{objective:run.requestedObjective,criteria:['Retain exact worktree identity'],checks:[],constraints:[],exclusions:[]});
    if(role==='critic'){
      const prepared=backend.prepareImplementer(run.id),path=prepared.launch.worktreePath;
      fs.writeFileSync(join(path,'value.txt'),'candidate');git(path,'add','.');git(path,'commit','-m','fixture candidate');
      await backend.completeArtifact({runId:run.id,launchId:prepared.launch.id,token:prepared.token,sha:git(path,'rev-parse','HEAD')});
    }
    const before=backend.status(run.id);fs.writeFileSync(join(root,'before.json'),JSON.stringify(before,null,2),{mode:0o600});backend.close();
    const child=spawn(process.execPath,[__filename],{cwd:join(__dirname,'..'),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',OPERATUS_ORPHAN_CHILD:role,OPERATUS_ORPHAN_ROOT:root},stdio:['ignore','pipe','pipe']});
    let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes).slice(-8000);});
    const exit=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owner crash timed out'));},10000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
    });
    assert.equal(exit.signal,'SIGKILL',output);
    const created=JSON.parse(fs.readFileSync(join(root,'created-workspace.json'),'utf8'));
    backend=new LocalGauntletBackend(options(root));backend.open();
    try{
      backend.reconcileAfterRestart();const after=backend.status(run.id);
      assert.equal(after.run.status,'human_required');
      assert.equal(after.run.preparationPending,1);
      assert.equal(after.pendingPreparations[0].launchId,created.input.launchId);
      assert.equal(after.pendingPreparations[0].worktreePath,created.workspace.path);
      backend.reconcileAfterRestart();
      assert.deepEqual(backend.status(run.id),after,'Repeated reconciliation is idempotent');
      assert.equal(after.launches.some(l=>l.id===created.input.launchId),false);
      assert.equal(after.preservations.some(p=>p.launchId===created.input.launchId),false);
      assert.equal(after.runtimeObservations.some(r=>r.launchId===created.input.launchId),false);
      assert.equal(git(created.workspace.path,'rev-parse','HEAD'),created.workspace.expectedSha);
      assert.equal(git(repository,'rev-parse','main'),run.baseSha);assert.equal(git(repository,'status','--porcelain'),'');
      assert.ok(git(repository,'worktree','list','--porcelain').includes(created.workspace.path));
      assert.throws(()=>role==='critic'?backend.prepareCritic(run.id):backend.prepareImplementer(run.id));
      assert.ok(fs.existsSync(created.workspace.path),'Retain interrupted work without adopting it');
      fs.writeFileSync(join(root,'recovery.json'),JSON.stringify({root,role,exit,before,created,after,
        demonstrated:'Durable preparation inventory, no fabricated launch, automatic retry blocked',realInference:false},null,2),{mode:0o600});
      console.log(JSON.stringify({root,role,status:after.run.status,orphanInventoried:true,retained:true,realInference:false}));
    }finally{backend.close();}
  });
}
