'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{execFileSync,execFile}=require('node:child_process');
const load=require('./load-ts.cjs');
const {SkillDepot}=load('src/main/gauntlet/skillDepot.ts');
const {prepareIsolatedSkills}=load('src/main/gauntlet/isolatedSkills.ts');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {prepareSubscriptionSandbox}=load('src/main/subscriptionSandbox.ts');
async function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-isolated-skills-'))),cache=join(root,'depot','checkouts','fixture');
 fs.mkdirSync(cache,{recursive:true});
 const git=(...args)=>execFileSync('git',args,{cwd:cache,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 for(const name of ['worker-guide','critic-guide']){const dir=join(cache,'skills',name);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(join(dir,'SKILL.md'),`---\nname: ${name}\n---\nRead support.md.\n`);fs.writeFileSync(join(dir,'support.md'),'locked support');}
 git('add','.');git('commit','-m','skills');
 const depot=new SkillDepot(join(root,'depot'));depot.saveSources([{id:'fixture',url:'https://example.invalid/fixture.git',pinnedCommit:git('rev-parse','HEAD'),enabled:true,include:['skills'],optIn:[]}]);
 const lock=depot.lock('run',[{role:'implementer',sourceId:'fixture',skillName:'worker-guide'},{role:'critic',sourceId:'fixture',skillName:'critic-guide'}]);
 const profile=await prepareSubscriptionProfile(root,'claude','implementer');
 const input={lock,runId:'run',launchId:'launch',role:'implementer',providerHome:profile.providerHome,depot};
 return{root,cache,git,depot,lock,profile,input};
}
test('only assigned role files enter the private home and receive a provenance manifest',async()=>{
 const f=await fixture(),prompt=prepareIsolatedSkills(f.input),dir=join(f.profile.providerHome,'skills');
 assert.match(prompt,/frozen bar/);assert.match(prompt,/worker-guide\/SKILL.md/);assert.doesNotMatch(prompt,/critic-guide/);
 assert.equal(fs.readFileSync(join(dir,'worker-guide','support.md'),'utf8'),'locked support');
 assert.equal(fs.existsSync(join(dir,'critic-guide')),false);
 const manifest=JSON.parse(fs.readFileSync(join(dir,'operatus-lock.json')));
 assert.equal(manifest.launchId,'launch');assert.deepEqual(manifest.entries,f.lock.entries.filter(e=>e.role==='implementer'));
 assert.equal(prepareIsolatedSkills({...f.input,role:'conductor'}),'');
 assert.throws(()=>prepareIsolatedSkills({...f.input,runId:'peer'}),/another run/);
 assert.throws(()=>prepareIsolatedSkills({...f.input,depot:undefined}),/unavailable/);
});
test('unsafe identities, path traversal, drift and duplicate locked names fail before launch',async()=>{
 const f=await fixture();let index=0;
 const materialize=entries=>f.depot.materialize({...f.lock,entries},'implementer',join(f.root,`attempt-${++index}`));
 const entry=f.lock.entries[0];
 for(const change of [{skillName:'../escape'},{sourceId:'../escape'},{relativePath:'../escape'},{sourceCommit:'a'.repeat(40)},{digest:'0'.repeat(64)}])assert.throws(()=>materialize([{...entry,...change}]));
 assert.throws(()=>materialize([entry,entry]),/duplicate/);
 fs.renameSync(join(f.cache,'skills','worker-guide'),join(f.root,'external'));
 fs.symlinkSync(join(f.root,'external'),join(f.cache,'skills','worker-guide'));
 assert.throws(()=>materialize([entry]),/symlink/);
});
test('disabled sources cannot be newly assigned and ambiguous catalog names are rejected',async()=>{
 const f=await fixture(),source=f.depot.listSources()[0];
 f.depot.saveSources([{...source,enabled:false}]);
 assert.throws(()=>f.depot.lock('new',[{role:'implementer',sourceId:'fixture',skillName:'worker-guide'}]),/unresolved/);
 f.depot.saveSources([source]);
  fs.writeFileSync(join(f.cache,'skills','critic-guide','SKILL.md'),'---\nname: worker-guide\n---\nDuplicate');
 assert.throws(()=>f.depot.lock('new',[{role:'implementer',sourceId:'fixture',skillName:'worker-guide'}]),/uncommitted/);
 f.git('add','.');f.git('commit','-m','ambiguous catalog');f.depot.saveSources([{...source,pinnedCommit:f.git('rev-parse','HEAD')}]);
 assert.throws(()=>f.depot.lock('new',[{role:'implementer',sourceId:'fixture',skillName:'worker-guide'}]),/ambiguous/);
});
test('all selected skills are validated before the first target is created',async()=>{
 const f=await fixture(),lock=f.depot.lock('run',[
  {role:'implementer',sourceId:'fixture',skillName:'worker-guide'},
  {role:'implementer',sourceId:'fixture',skillName:'critic-guide'}]);
 lock.entries[1].digest='0'.repeat(64);const destination=join(f.root,'preflight-target');
 assert.throws(()=>f.depot.materialize(lock,'implementer',destination),/skill changed after lock/);
 assert.equal(fs.existsSync(destination),false,'A later invalid skill must not leave the first copied skill');
});
test('insufficient or unknown destination space refuses copying without consuming the diagnostic reserve',async()=>{
 const f=await fixture(),destination=join(f.root,'low-disk-target'),statfs=fs.statfsSync;
 try {
  fs.statfsSync=()=>({bavail:512n*1024n*1024n,bsize:1n});
  assert.throws(()=>f.depot.materialize(f.lock,'implementer',destination),/diagnostic reserve/);
  assert.equal(fs.existsSync(destination),false);
  fs.statfsSync=()=>{throw Error('Fixture filesystem statistics unavailable');};
  assert.throws(()=>f.depot.materialize(f.lock,'implementer',destination),/statistics unavailable/);
  assert.equal(fs.existsSync(destination),false);
 }finally{fs.statfsSync=statfs;}
});
test('five individually valid large skills exceed the real aggregate cap before any profile copy',async()=>{
 const f=await fixture(),assignments=[];
 for(let i=0;i<5;i++) {
  const name=`large-guide-${i}`,dir=join(f.cache,'skills',name);fs.mkdirSync(dir);
  fs.writeFileSync(join(dir,'SKILL.md'),`---\nname: ${name}\n---\nRead support.bin.\n`);
  const fd=fs.openSync(join(dir,'support.bin'),'wx');try{fs.ftruncateSync(fd,16*1024*1024-2048);}finally{fs.closeSync(fd);}
  assignments.push({role:'implementer',sourceId:'fixture',skillName:name});
 }
 f.git('add','.');f.git('commit','-m','aggregate sparse-skill fixture');
 f.depot.saveSources([{...f.depot.listSources()[0],pinnedCommit:f.git('rev-parse','HEAD')}]);
 const catalog=f.depot.discover(f.depot.listSources()[0]).filter(s=>s.name.startsWith('large-guide-'));
 assert.equal(catalog.length,5,'Each source tree is within its individual limit');
 assert.throws(()=>f.depot.lock('run',assignments),/aggregate profile byte/,'New runs reject this selection before persistence');
 // A lock recorded by an earlier version must still fail before copying.
 const lock={runId:'run',createdAt:Date.now(),entries:catalog.map(s=>({sourceId:s.sourceId,sourceCommit:s.sourceCommit,
  skillName:s.name,relativePath:s.relativePath,digest:s.digest,role:'implementer'}))},destination=join(f.root,'oversized-profile');
 assert.throws(()=>f.depot.materialize(lock,'implementer',destination),/aggregate profile byte/);
 assert.equal(fs.existsSync(destination),false);
});
test('actual worker can read locked skills but cannot chmod, rewrite, rename or hard-link them', {skip:process.platform!=='darwin'},async()=>{
 const f=await fixture();prepareIsolatedSkills(f.input);
 const artifact=join(f.root,'artifact');fs.mkdirSync(artifact);
 const boundary=prepareSubscriptionSandbox({artifact,profile:f.profile,executable:'/bin/bash',role:'implementer'});
 const run=command=>new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c',command],
  {env:f.profile.env,cwd:artifact,encoding:'utf8',timeout:3000},(error,stdout)=>resolve({code:error?.code??0,stdout})));
 const dir=join(f.profile.providerHome,'skills'),file=join(dir,'worker-guide','support.md');
 assert.equal((await run(`cat '${file}'`)).stdout,'locked support');
 for(const command of [`chmod u+w '${file}'`,`printf changed > '${file}'`,`mv '${dir}' '${dir}-moved'`,`rm '${file}'`,`ln '${file}' alias && printf changed > alias`])
  assert.notEqual((await run(command)).code,0,command);
 assert.equal(fs.readFileSync(file,'utf8'),'locked support');
});
