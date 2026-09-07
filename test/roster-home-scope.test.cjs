'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {join}=require('node:path'),{tmpdir}=require('node:os');
const load=require('./load-ts.cjs'),{RosterStore}=load('src/main/roster.ts');
const {readRosterCache,writeRosterCache,rosterCacheKey,hasUnassignedRoster}=load('src/renderer/src/store/rosterCache.ts');
const agent=id=>({id,name:id,cwd:`/fixture/${id}`,description:'fixture',character:'operator',accent:'coral',project:id,status:'idle'});
const snap=id=>({version:1,savedAt:'fixture',agents:id?[agent(id)]:[],archived:[],restorable:[],queues:id?{[id]:[{id:`${id}-q`,text:`${id} only`}]}:{},selectedId:id??null});
const storage=values=>({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});
function boot(home,file,values=new Map()){
 const previous=global.window,listeners=new Map(),writes=[];
 global.window={localStorage:storage(values),addEventListener:(key,listener)=>listeners.set(key,listener),cth:{
  rosterBootSync:()=>({home,roster:file}),rosterWrite:(snapshot,expectedHome)=>{writes.push({snapshot:structuredClone(snapshot),home:expectedHome});return Promise.resolve({ok:true});}}};
 delete require.cache[require.resolve('./load-ts.cjs')];
 const module=require('./load-ts.cjs')('src/renderer/src/store/store.ts');
 return{...module,writes,close(){listeners.get('beforeunload')?.();global.window=previous;}};
}
test('cache envelopes bind every slice to one home and preserve legacy or malformed values',()=>{
 const values=new Map([['cth.agents','legacy bytes']]),s=storage(values),a=snap('A'),b=snap('B');
 assert.equal(writeRosterCache(s,'/A',a),true);assert.equal(writeRosterCache(s,'/B',b),true);
 assert.deepEqual(readRosterCache(s,'/A'),a);assert.deepEqual(readRosterCache(s,'/B'),b);
 assert.equal(readRosterCache(s,null),null);assert.equal(writeRosterCache(s,null,b),false);
 assert.equal(values.get('cth.agents'),'legacy bytes');
 values.set(rosterCacheKey('/C'),values.get(rosterCacheKey('/A')));
 const old=values.get(rosterCacheKey('/C'));assert.equal(readRosterCache(s,'/C'),null);assert.equal(writeRosterCache(s,'/C',b),false);
 assert.equal(values.get(rosterCacheKey('/C')),old);
 values.set(rosterCacheKey('/D'),'{broken');assert.equal(readRosterCache(s,'/D'),null);assert.equal(writeRosterCache(s,'/D',b),false);
 assert.equal(values.get(rosterCacheKey('/D')),'{broken');
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 assert.equal(readRosterCache(blocked,'/A'),null);assert.equal(writeRosterCache(blocked,'/A',a),false);assert.equal(hasUnassignedRoster(blocked),'unreadable');
});
test('actual renderer A → B → B reload → A never reassigns old agents, archives or queues',()=>{
 const a=snap('A');a.archived=[{...agent('archived-A'),note:'A private note'}];a.restorable=[agent('restore-A')];
 const values=new Map([['cth.agents',JSON.stringify([agent('legacy')])],['cth.messageQueues',JSON.stringify({legacy:[{id:'old-q',text:'unassigned'}]})]]);
 let current=boot('/A',a,values);
 try{current.useStore.getState().select('A');}finally{current.close();}
 const savedA=values.get(rosterCacheKey('/A'));
 current=boot('/B',null,values);
 let emptyB;
 try{
  const state=current.useStore.getState();assert.deepEqual(state.agents,[]);assert.deepEqual(state.archivedAgents,[]);assert.deepEqual(state.restorableAgents,[]);assert.deepEqual(state.messageQueues,{});
  assert.match(current.rosterRecoveryNotice,/preserved but unassigned/);
 }finally{current.close();emptyB=current.writes.at(-1).snapshot;}
 current=boot('/B',emptyB,values);
 try{assert.deepEqual(current.useStore.getState().agents,[]);assert.match(current.rosterRecoveryNotice,/preserved but unassigned/);current.useStore.getState().addAgent(agent('B'));}
 finally{current.close();}
 assert.equal(values.get(rosterCacheKey('/A')),savedA);
 current=boot('/A',null,values);
 try{
  const state=current.useStore.getState();assert.deepEqual(state.agents.map(x=>x.id),['A']);assert.equal(state.archivedAgents[0].note,'A private note');
  assert.deepEqual(state.restorableAgents.map(x=>x.id),['restore-A']);assert.deepEqual(Object.keys(state.messageQueues),['A']);assert.equal(state.selectedId,'A');
 }finally{current.close();}
 assert.equal(JSON.parse(values.get('cth.agents'))[0].id,'legacy');assert.match(values.get('cth.messageQueues'),/unassigned/);
});
test('empty file defeats stale cache; unknown home cannot restore or mirror; cache write failure keeps file mirroring',()=>{
 const values=new Map();writeRosterCache(storage(values),'/A',snap('old'));
 let current=boot('/A',snap(null),values);
 try{assert.deepEqual(current.useStore.getState().agents,[]);}finally{current.close();}
 current=boot(null,snap('wrong'),values);
 try{assert.deepEqual(current.useStore.getState().agents,[]);current.useStore.getState().addAgent(agent('not-persisted'));}
 finally{current.close();}assert.equal(current.writes.length,0);
 current=boot('/A',snap('A'),values);
 const original=values.get(rosterCacheKey('/A'));
 try{global.window.localStorage.setItem=()=>{throw Error('quota');};current.useStore.getState().updateAgent('A',{note:'new note'});}
 finally{current.close();}
 assert.equal(values.get(rosterCacheKey('/A')),original);assert.equal(current.writes.at(-1).home,'/A');assert.equal(current.writes.at(-1).snapshot.agents[0].note,'new note');
});
test('invalid owned cache is visibly preserved, and a corrupt file can use only its own valid cache',()=>{
 const values=new Map([[rosterCacheKey('/A'),'{broken']]);let current=boot('/A',snap('A'),values);
 try{assert.match(current.rosterRecoveryNotice,/could not be validated/);current.useStore.getState().updateAgent('A',{note:'saved to file'});}
 finally{current.close();}
 assert.equal(values.get(rosterCacheKey('/A')),'{broken');assert.equal(current.writes.at(-1).snapshot.agents[0].note,'saved to file');
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-roster-corrupt-')));
 fs.writeFileSync(join(root,'roster.json'),'{corrupt');const file=new RosterStore(()=>root).readBoot();assert.equal(file.roster,null);
 writeRosterCache(storage(values),root,snap('own'));current=boot(file.home,file.roster,values);
 try{assert.deepEqual(current.useStore.getState().agents.map(a=>a.id),['own']);}finally{current.close();}
});
test('main reads home and roster together and rejects stale-window writes without changing either file',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-roster-scope-'))),a=join(root,'A'),b=join(root,'B');
 fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(join(a,'roster.json'),JSON.stringify(snap('A')));fs.writeFileSync(join(b,'roster.json'),JSON.stringify(snap('B')));
 let home=a,reads=0;const store=new RosterStore(()=>{reads++;return home;});
 const boot=store.readBoot();assert.equal(reads,1);assert.equal(boot.home,a);assert.equal(boot.roster.agents[0].id,'A');
 assert.equal(store.writeForHome(snap('A-updated'),a).ok,true);home=b;
 const before=fs.readFileSync(join(b,'roster.json'),'utf8');
 for(const owner of [undefined,null,a,'/forged'])assert.equal(store.writeForHome(snap('wrong'),owner).ok,false);
 assert.equal(fs.readFileSync(join(b,'roster.json'),'utf8'),before);
 assert.equal(store.writeForHome(snap(null),b).skipped,'empty-first-write','new home retains its own first-write guard');
 assert.equal(JSON.parse(fs.readFileSync(join(a,'roster.json'),'utf8')).agents[0].id,'A-updated');
});
test('actual Settings handler retains all cached data when a fresh or moved home is rejected',async()=>{
 const source=fs.readFileSync(join(__dirname,'../src/renderer/src/components/SettingsModal.tsx'),'utf8');
 const body=source.slice(source.indexOf('  const applyChangeHome = async () => {'),source.indexOf('  const modalTitle = changeHome'));
 assert.ok(body.includes('window.cth.changeHome'));assert.doesNotMatch(source,/clearLocalState|localStorage\.removeItem/);
 const output=ts.transpileModule(`${body}\nreturn applyChangeHome();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const mode of ['fresh','move'])for(const fails of ['rejected','throws']){
  const values=new Map([['cth.agents','legacy'],[rosterCacheKey('/A'),'owned'],['cth.sidebarWidth','420']]),before=[...values];let error='';
  const window={localStorage:{...storage(values),removeItem(){throw Error('must not delete');}},cth:{changeHome:async()=>{
   if(fails==='throws')throw Error('interrupted');return{ok:false,error:'same home'};}}};
  await new Function('window','changeHome','changeMode','setChangeBusy','setChangeErr',output)(window,'/A',mode,()=>{},value=>error=value);
  assert.deepEqual([...values],before);assert.equal(error,fails==='throws'?'interrupted':'same home');
 }
});
