'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const load=require('./load-ts.cjs');
const {inspectPreparation,preparationInspector}=load('src/main/gauntlet/preparationInspection.ts');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-prep-inspect-'))),repository=join(root,'repo');fs.mkdirSync(repository);
  git(repository,'init','-b','main');git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
  fs.writeFileSync(join(repository,'value.txt'),'base');git(repository,'add','.');git(repository,'commit','-m','base');
  const backend=new LocalGauntletBackend({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();t.after(()=>backend.close());
  const run=backend.start({repository,objective:'Read-only recovery inspection'}).run;
  backend.freeze(run.id,{objective:run.requestedObjective,criteria:['observable'],checks:[],constraints:[],exclusions:[]});
  const launchId=randomUUID(),preparation={launchId,runId:run.id,role:'implementer',repository,expectedSha:run.baseSha,
    contractDigest:backend.status(run.id).run.contract.digest,worktreePath:backend.workspaces.target(run.id,launchId),
    candidateBranch:`${run.branch}-attempt-${launchId}`,reviewEvidencePath:null,createdAt:Date.now()};
  backend.store.recordPreparation(preparation,backend.status(run.id).run.version);
  const create=()=>backend.workspaces.createCandidate({repository,runId:run.id,launchId,branch:preparation.candidateBranch,expectedSha:run.baseSha,requireNewBranch:true});
  return {root,repository,backend,preparation,create};
}
test('missing and dangling/ancestor-symlink paths are distinguished without following them',async t=>{
  const f=fixture(t),p=f.preparation;
  assert.equal((await inspectPreparation(p)).state,'missing');
  fs.mkdirSync(join(p.worktreePath,'..'),{recursive:true});
  fs.symlinkSync(join(f.root,'never-created'),p.worktreePath);
  assert.equal((await inspectPreparation(p)).state,'redirected');
  const alias=join(f.root,'alias');fs.symlinkSync(f.repository,alias);
  assert.equal((await inspectPreparation({...p,worktreePath:join(alias,'missing')})).state,'redirected');
  assert.equal(fs.existsSync(join(f.root,'never-created')),false);
});
test('real clean worktree, dirty work, changed commit and branch are diagnostics only', {skip:process.platform!=='darwin'}, async t=>{
  const f=fixture(t),p=f.preparation;f.create();const before=f.backend.status(p.runId);
  let observed=await inspectPreparation(p);assert.equal(observed.state,'matching');assert.equal(observed.observedSha,p.expectedSha);assert.equal(observed.dirty,false);
  fs.writeFileSync(join(p.worktreePath,'unfinished.txt'),'retain');
  observed=await inspectPreparation(p);assert.equal(observed.state,'changed');assert.equal(observed.dirty,true);
  git(p.worktreePath,'add','.');git(p.worktreePath,'commit','-m','retained unrecorded work');
  observed=await inspectPreparation(p);assert.equal(observed.state,'changed');assert.notEqual(observed.observedSha,p.expectedSha);assert.equal(observed.dirty,false);
  git(p.worktreePath,'switch','--detach');assert.equal((await inspectPreparation(p)).observedBranch,null);
  assert.equal(git(f.repository,'rev-parse','HEAD'),p.expectedSha);
  assert.deepEqual(f.backend.status(p.runId),before,'Inspection never writes authority or creates launches');
});
test('foreign repository pointer is rejected before Git inspection', {skip:process.platform!=='darwin'},async t=>{
  const f=fixture(t),p=f.preparation;f.create();
  fs.writeFileSync(join(p.worktreePath,'.git'),`gitdir: ${join(f.root,'other','.git','worktrees','foreign')}\n`);
  const result=await inspectPreparation(p);assert.equal(result.state,'foreign_repository');assert.equal(result.observedSha,null);
});
test('filesystem monitor config cannot execute, and inspection does not refresh the index', {skip:process.platform!=='darwin'},async t=>{
  const f=fixture(t),p=f.preparation;f.create();
  const marker=join(f.root,'helper-ran');git(f.repository,'config','core.fsmonitor',`touch ${marker}`);
  const index=git(p.worktreePath,'rev-parse','--git-path','index');const before=fs.statSync(index);
  assert.equal((await inspectPreparation(p)).state,'matching');
  assert.equal(fs.existsSync(marker),false);const after=fs.statSync(index);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.size,before.size);
});
test('critic detached worktree and evidence parent are inspected separately', {skip:process.platform!=='darwin'},async t=>{
  const f=fixture(t),p={...f.preparation,role:'critic',candidateBranch:null,reviewEvidencePath:join(f.root,'evidence')};
  f.backend.workspaces.createCritic({repository:p.repository,runId:p.runId,launchId:p.launchId,artifactSha:p.expectedSha});
  let result=await inspectPreparation(p);assert.equal(result.state,'matching');assert.equal(result.observedBranch,null);assert.equal(result.evidenceDirectory,'missing');
  fs.mkdirSync(p.reviewEvidencePath);result=await inspectPreparation(p);assert.equal(result.evidenceDirectory,'present');
});
test('only local main-frame requests for actual pending identities can inspect paths',async t=>{
  const f=fixture(t),frame={},window={mainFrame:frame};let reads=0;
  const inspect=preparationInspector({localWindow:()=>window,pending:()=>{reads++;return [f.preparation];}});
  await assert.rejects(inspect({sender:{},senderFrame:frame},f.preparation.runId,f.preparation.launchId),/local desktop/);
  await assert.rejects(inspect({sender:window,senderFrame:{}},f.preparation.runId,f.preparation.launchId),/local desktop/);
  assert.equal(reads,0);
  await assert.rejects(inspect({sender:window,senderFrame:frame},f.preparation.runId,'foreign'),/No pending/);
  assert.equal((await inspect({sender:window,senderFrame:frame},f.preparation.runId,f.preparation.launchId)).state,'missing');
});
