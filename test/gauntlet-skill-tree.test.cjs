'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join,relative,sep}=require('node:path'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const load=require('./load-ts.cjs');
const {inspectSkillTree,newSkillTreeBudget,readSkillInstructions,SKILL_MATERIALIZATION_LIMITS:L}=load('src/main/gauntlet/skillTree.ts');
function fixture(){
  const root=fs.mkdtempSync(join(tmpdir(),'op-skill-tree-')),source=join(root,'source');fs.mkdirSync(source);
  fs.writeFileSync(join(source,'SKILL.md'),'Read support.');fs.mkdirSync(join(source,'nested'));fs.writeFileSync(join(source,'nested','support.md'),'Support content.');
  return{root,source};
}
function legacyDigest(root){
  const hash=createHash('sha256');
  const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const p=join(dir,e.name),rel=relative(root,p).split(sep).join('/');hash.update(e.isDirectory()?`d:${rel}\0`:`f:${rel}\0`);
    if(e.isDirectory())visit(p);else hash.update(fs.readFileSync(p));
  }};visit(root);return hash.digest('hex');
}
test('bounded streaming copy preserves the original tree digest and full nested support content',()=>{
  const f=fixture(),expected=legacyDigest(f.source),budget=newSkillTreeBudget(),target=join(f.root,'target');
  assert.equal(inspectSkillTree(f.source,budget,target),expected);assert.equal(inspectSkillTree(target),expected);
  assert.equal(budget.bytes,Buffer.byteLength('Read support.Support content.'));assert.equal(budget.entries,3);
  assert.throws(()=>inspectSkillTree(f.source,newSkillTreeBudget(),target),/EEXIST/);
});
test('a shared budget rejects aggregate bytes and entries across individually valid skill trees',()=>{
  const f=fixture(),budget={bytes:L.profileBytes-20,entries:0};
  assert.throws(()=>inspectSkillTree(f.source,budget),/aggregate profile byte/);
  assert.throws(()=>inspectSkillTree(f.source,{bytes:0,entries:L.profileEntries-1}),/aggregate profile entry/);
  assert.doesNotThrow(()=>inspectSkillTree(f.source));
});
test('a source growing after descriptor inspection cannot write past the remaining aggregate budget',()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'op-skill-growth-')),source=join(root,'source'),target=join(root,'target');fs.mkdirSync(source);
  const file=join(source,'SKILL.md');fs.writeFileSync(file,'small');const inode=fs.statSync(file).ino;
  const read=fs.readSync;let grew=false;
  fs.readSync=(fd,...args)=>{
    if(!grew&&fs.fstatSync(fd).ino===inode){grew=true;const writer=fs.openSync(file,'r+');try{fs.ftruncateSync(writer,1024);}finally{fs.closeSync(writer);}}
    return read(fd,...args);
  };
  try {assert.throws(()=>inspectSkillTree(source,{bytes:L.profileBytes-128,entries:0},target),/grew beyond aggregate/);}
  finally{fs.readSync=read;}
  assert.equal(grew,true);assert.ok(fs.statSync(join(target,'SKILL.md')).size<=128);
});
test('symlinks, special files and excessive nesting are rejected without following them',()=>{
  const f=fixture();fs.symlinkSync('/etc/passwd',join(f.source,'link'));
  assert.throws(()=>inspectSkillTree(f.source),/symlink/);
  if(process.platform!=='win32') {const special=fixture();execFileSync('mkfifo',[join(special.source,'pipe')]);assert.throws(()=>inspectSkillTree(special.source),/special file/);}
  const nested=fixture();let dir=nested.source;for(let n=0;n<L.depth+1;n++){dir=join(dir,'d');fs.mkdirSync(dir);}
  assert.throws(()=>inspectSkillTree(nested.source),/nesting/);
});
test('instruction parsing independently rejects oversized files after discovery',()=>{
  const f=fixture(),path=join(f.source,'SKILL.md');assert.equal(readSkillInstructions(path),'Read support.');
  inspectSkillTree(f.source);
  const fd=fs.openSync(path,'r+');try{fs.ftruncateSync(fd,L.treeBytes+1);}finally{fs.closeSync(fd);}
  assert.throws(()=>readSkillInstructions(path),/instructions exceed/);
});
