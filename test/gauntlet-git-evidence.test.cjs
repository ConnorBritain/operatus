'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs');
const { captureGitReviewEvidence } = load('src/main/gauntlet/gitEvidence.ts');
const { prepareSubscriptionProfile } = load('src/main/subscriptionProfile.ts');
const { prepareSubscriptionSandbox } = load('src/main/subscriptionSandbox.ts');
const mac = { skip:process.platform !== 'darwin' };
const git = (cwd,...args) => execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-git-review-')));
  const repository = join(root,'repo'); fs.mkdirSync(repository);
  git(repository,'init','-b','main'); git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
  fs.writeFileSync(join(repository,'value.txt'),'before\n');git(repository,'add','.');git(repository,'commit','-m','base');
  const baseSha=git(repository,'rev-parse','HEAD');
  fs.writeFileSync(join(repository,'value.txt'),'after\n');git(repository,'add','.');git(repository,'commit','-m','candidate');
  const artifactSha=git(repository,'rev-parse','HEAD');
  return {root,repository,baseSha,artifactSha,contractDigest:'a'.repeat(64),destinationRoot:join(root,'evidence')};
}
test('exact review diff ignores dirty files, injected helpers and ambient Git redirects',mac,()=>{
  const f=fixture(), marker=join(f.root,'helper-ran');
  fs.writeFileSync(join(f.repository,'value.txt'),'uncommitted distraction');
  fs.writeFileSync(join(f.repository,'.gitattributes'),'* diff=hostile\n');
  git(f.repository,'config','diff.external',`touch '${marker}'`);
  git(f.repository,'config','diff.hostile.textconv',`touch '${marker}'`);
  git(f.repository,'config','credential.helper',`!touch '${marker}'`);
  git(f.repository,'config','operatus.secret','synthetic-secret-not-for-critic');
  const old=process.env.GIT_EXTERNAL_DIFF;process.env.GIT_EXTERNAL_DIFF=`touch '${marker}'`;
  let receipt;try {receipt=captureGitReviewEvidence(f);}finally {if(old===undefined)delete process.env.GIT_EXTERNAL_DIFF;else process.env.GIT_EXTERNAL_DIFF=old;}
  const patch=fs.readFileSync(join(receipt.directory,'changes.patch'));
  assert.match(patch.toString(),/-before\n\+after/);assert.doesNotMatch(patch.toString(),/distraction|synthetic-secret/);
  assert.equal(createHash('sha256').update(patch).digest('hex'),receipt.patchSha256);
  assert.equal(fs.existsSync(marker),false);
  assert.equal(git(f.repository,'rev-parse','HEAD'),f.artifactSha);
  assert.equal(fs.readFileSync(join(f.repository,'value.txt'),'utf8'),'uncommitted distraction');
});
test('linked repositories and detached artifacts retain exact identities; invalid SHAs publish nothing',mac,()=>{
  const f=fixture(), linked=join(f.root,'linked');git(f.repository,'worktree','add','--detach',linked,f.artifactSha);
  const receipt=captureGitReviewEvidence({...f,repository:linked});
  assert.equal(receipt.artifactSha,f.artifactSha);
  assert.throws(()=>captureGitReviewEvidence({...f,artifactSha:'HEAD'}),/40|SHA|sha/);
  assert.throws(()=>captureGitReviewEvidence({...f,artifactSha:'f'.repeat(40),destinationRoot:join(f.root,'invalid')}),/review failed/);
  assert.equal(fs.existsSync(join(f.root,'invalid')),false);
  assert.throws(()=>captureGitReviewEvidence({...f,maxPatchBytes:64,destinationRoot:join(f.root,'oversized')}),/evidence limit/);
  assert.equal(fs.existsSync(join(f.root,'oversized')),false,'never publish a silently truncated diff');
});
test('real provider boundary reads the packet but cannot alter it or open original Git credentials',mac,async()=>{
  const f=fixture(), receipt=captureGitReviewEvidence(f);
  git(f.repository,'config','operatus.secret','synthetic-original-config-secret');
  const artifact=join(f.root,'detached-artifact');git(f.repository,'worktree','add','--detach',artifact,f.artifactSha);
  const profile=await prepareSubscriptionProfile(f.root,'claude');
  for(const role of ['critic','implementer']) {
    const boundary=prepareSubscriptionSandbox({artifact,profile,executable:'/bin/bash',role,reviewEvidenceDirectory:receipt.directory});
    const run=command=>new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c',command],
      {cwd:artifact,env:profile.env,timeout:3000,encoding:'utf8'},(e,stdout)=>resolve({code:e?.code??0,stdout})));
    assert.match((await run(`cat '${receipt.directory}/changes.patch'`)).stdout,/-before\n\+after/);
    assert.notEqual((await run(`printf modified > '${receipt.directory}/changes.patch'`)).code,0);
    assert.notEqual((await run(`rm '${receipt.directory}/manifest.json'`)).code,0);
    const secret=await run(`cat '${f.repository}/.git/config'`);
    assert.notEqual(secret.code,0);assert.doesNotMatch(secret.stdout,/synthetic-original-config-secret/);
  }
  assert.throws(()=>prepareSubscriptionSandbox({artifact,profile,executable:'/bin/bash',role:'critic',reviewEvidenceDirectory:profile.home}),/overlap/);
});
test('Critic preparation persists and prompts the exact review packet through SQLite reopen',mac,async()=>{
  const { LocalGauntletBackend }=load('src/main/gauntlet/localBackend.ts');
  const f=fixture();const backend=new LocalGauntletBackend({stateRoot:join(f.root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});
  backend.open();
  try {
    const run=backend.start({repository:f.repository,objective:'Exact review packet'}).run;
    backend.freeze(run.id,{objective:run.requestedObjective,criteria:['Inspect the change'],checks:[],constraints:[],exclusions:[]});
    const worker=backend.prepareImplementer(run.id);
    fs.writeFileSync(join(worker.launch.worktreePath,'value.txt'),'new candidate\n');
    git(worker.launch.worktreePath,'add','.');git(worker.launch.worktreePath,'commit','-m','candidate');
    const sha=git(worker.launch.worktreePath,'rev-parse','HEAD');
    await backend.completeArtifact({runId:run.id,launchId:worker.launch.id,token:worker.token,sha});
    const critic=backend.prepareCritic(run.id), evidence=critic.launch.reviewEvidence;
    assert.equal(evidence.baseSha,run.baseSha);assert.equal(evidence.artifactSha,sha);
    assert.ok(critic.prompt.includes(evidence.directory));assert.ok(critic.prompt.includes(evidence.patchSha256));
    assert.match(fs.readFileSync(join(evidence.directory,'changes.patch'),'utf8'),/\+new candidate/);
    backend.close();backend.open();
    assert.deepEqual(backend.status(run.id).launches.at(-1).reviewEvidence,evidence);
    fs.chmodSync(join(evidence.directory,'changes.patch'),0o600);
    fs.writeFileSync(join(evidence.directory,'changes.patch'),'tampered');
    const rejected=backend.submitCritic({runId:run.id,launchId:critic.launch.id,token:critic.token,
      artifactSha:sha,contractDigest:evidence.contractDigest,verdict:'PASS',summary:'Should not count',findings:[]});
    assert.equal(rejected.reports.length,0);
    assert.notEqual(rejected.run.status,'awaiting_lead_ack');
  } finally {backend.close();}
});
