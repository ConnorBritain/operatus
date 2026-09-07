'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const Database=require('better-sqlite3'),load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-preparation-'))),repository=join(root,'repo');fs.mkdirSync(repository);
  git(repository,'init','-b','main');git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
  fs.writeFileSync(join(repository,'value.txt'),'base');git(repository,'add','.');git(repository,'commit','-m','base');
  const backend=new LocalGauntletBackend({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();t.after(()=>backend.close());
  const run=backend.start({repository,objective:'Preparation durability'}).run;
  backend.freeze(run.id,{objective:run.requestedObjective,criteria:['observable'],checks:[],constraints:[],exclusions:[]});
  return {root,backend,run:backend.status(run.id).run};
}
function intent(f){const launchId=randomUUID();return {launchId,runId:f.run.id,role:'implementer',repository:f.run.repository,
  expectedSha:f.run.baseSha,contractDigest:f.run.contract.digest,worktreePath:f.backend.workspaces.target(f.run.id,launchId),
  candidateBranch:`${f.run.branch}-attempt-${launchId}`,reviewEvidencePath:null,createdAt:Date.now()};}
test('durable intent precedes every worktree effect and launch completion resolves it atomically',t=>{
  const f=fixture(t),create=f.backend.workspaces.createCandidate.bind(f.backend.workspaces);
  f.backend.workspaces.createCandidate=input=>{
    const pending=f.backend.store.pendingPreparations(f.run.id);assert.equal(pending.length,1);
    assert.equal(pending[0].launchId,input.launchId);assert.equal(fs.existsSync(pending[0].worktreePath),false);
    const db=new Database(join(f.root,'state','gauntlet.db'),{readonly:true});
    assert.equal(db.prepare('SELECT count(*) count FROM gauntlet_preparations').get().count,1);db.close();
    return create(input);
  };
  f.backend.prepareImplementer(f.run.id);
  assert.deepEqual(f.backend.store.pendingPreparations(),[]);
  assert.equal(f.backend.status(f.run.id).run.preparationPending,0);
});
test('failed journal and nested transactions never reach Git creation',t=>{
  const f=fixture(t);let creates=0;f.backend.workspaces.createCandidate=()=>{creates++;throw Error('unexpected Git');};
  const db=f.backend.store.db;
  assert.throws(()=>db.transaction(()=>f.backend.prepareImplementer(f.run.id))(),/enclosing transaction/);
  db.exec("CREATE TRIGGER fail_preparation BEFORE INSERT ON gauntlet_preparations BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");
  assert.throws(()=>f.backend.prepareImplementer(f.run.id),/fixture disk failure/);
  assert.equal(creates,0);assert.deepEqual(f.backend.store.pendingPreparations(),[]);
});
test('intent without any created files survives restart and cannot be retried or dismissed',t=>{
  const f=fixture(t),prepared=intent(f);f.backend.store.recordPreparation(prepared,f.run.version);
  assert.equal(fs.existsSync(prepared.worktreePath),false);
  assert.throws(()=>f.backend.prepareImplementer(f.run.id),/requires inspection/);
  f.backend.close();f.backend.open();f.backend.reconcileAfterRestart();
  let snapshot=f.backend.status(f.run.id);assert.equal(snapshot.run.status,'human_required');
  assert.equal(snapshot.launches.length,0);assert.equal(snapshot.pendingPreparations.length,1);
  assert.throws(()=>f.backend.reviewAttention(f.run.id,snapshot.run.version,true,'inspected'),/cannot be dismissed/);
  assert.equal(fs.existsSync(prepared.worktreePath),false);
  assert.ok(f.backend.store.listOperatorRuns().some(run=>run.id===f.run.id&&run.preparationPending===1));
});
test('cancelled preparation stays in operator attention beyond the closed-history cap',t=>{
  const f=fixture(t),prepared=intent(f);f.backend.store.recordPreparation(prepared,f.run.version);
  f.backend.cancel(f.run.id,'Stop before creation');
  for(let i=0;i<105;i++){
    const run=f.backend.start({repository:f.run.repository,objective:`Closed ${i}`}).run;
    f.backend.cancel(run.id,'Fixture closed history');
  }
  f.backend.close();f.backend.open();f.backend.reconcileAfterRestart();
  const run=f.backend.store.listOperatorRuns().find(run=>run.id===f.run.id);
  assert.ok(run);assert.equal(run.status,'cancelled');assert.equal(run.preparationPending,1);
  assert.throws(()=>f.backend.reviewAttention(run.id,run.version,true,'inspected'),/cannot be dismissed/);
});
test('preparation identities are immutable and mismatched launch insertion rolls back',t=>{
  const f=fixture(t),prepared=intent(f);f.backend.store.recordPreparation(prepared,f.run.version);
  f.backend.store.recordPreparation(prepared,f.run.version);
  assert.throws(()=>f.backend.store.recordPreparation({...prepared,createdAt:prepared.createdAt+1},f.run.version),/immutable/);
  assert.throws(()=>f.backend.store.db.prepare('DELETE FROM gauntlet_preparations').run(),/immutable/);
  assert.throws(()=>f.backend.store.recordPreparation({...prepared,launchId:randomUUID(),expectedSha:'f'.repeat(40)},f.run.version),/identity/);
  const launch={id:prepared.launchId,runId:f.run.id,role:'implementer',provider:'claude',sessionId:randomUUID(),
    worktreePath:join(f.root,'wrong'),candidateBranch:prepared.candidateBranch,expectedSha:f.run.baseSha,
    tokenHash:'0'.repeat(64),capability:{},status:'running',createdAt:Date.now()};
  assert.throws(()=>f.backend.store.transition(f.run.id,f.run.version,{type:'IMPLEMENTER_LAUNCHED',launchId:launch.id,expectedSha:f.run.baseSha,at:Date.now()},{launch}),/durable workspace preparation/);
  assert.equal(f.backend.status(f.run.id).run.version,f.run.version);assert.equal(f.backend.status(f.run.id).launches.length,0);
});
test('version eight migrates forward without inventing preparation records for legacy launches',t=>{
  const f=fixture(t);f.backend.prepareImplementer(f.run.id);f.backend.close();
  const db=new Database(join(f.root,'state','gauntlet.db'));db.exec('DROP TABLE gauntlet_preparations');db.pragma('user_version=8');db.close();
  f.backend.open();assert.equal(f.backend.status(f.run.id).launches.length,1);assert.deepEqual(f.backend.store.pendingPreparations(),[]);
  assert.equal(f.backend.store.db.pragma('user_version',{simple:true}),10);
});
