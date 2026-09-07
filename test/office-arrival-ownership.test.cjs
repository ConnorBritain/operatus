'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function fixture(){
 const source=ts.createSourceFile('OfficeFloor.tsx',fs.readFileSync(path.join(__dirname,'../src/renderer/src/scene/office/OfficeFloor.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const arrows={};function visit(n){if(ts.isVariableDeclaration(n)&&['addCharacter','syncAgents'].includes(n.name.getText(source)))arrows[n.name.getText(source)]=n.initializer;ts.forEachChild(n,visit);}visit(source);assert.equal(Object.keys(arrows).length,2);
 const output=ts.transpileModule(Object.entries(arrows).map(([name,arrow])=>`const ${name}=${arrow.getText(source)};exports.${name}=${name};`).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const state={agents:[],select(){throw Error('Arrival must not select');}},runtimes=new Map(),seatClaims=new Set(),pendingCharacters=new Map(),frames=[],characters=[],applied=[],warnings=[];
 const mountIdRef={current:1},controls={failApply:false};
 class Character{constructor(opts){this.opts=opts;this.destroyed=false;characters.push(this);}show(){this.shown=true;}destroy(){this.destroyed=true;}setCupSpot(){}}
 const scope={theme:{cast:{byName:{fixture:{shirt:'#ffffff'},other:{shirt:'#ffffff'}},defaultCharacter:'fixture',getFrames:()=>new Promise((resolve,reject)=>frames.push({resolve,reject}))},monitor:{offTopLeftGid:-1}},
  runtimes,pendingCharacters,seatClaims,claimSeat:()=>{for(let i=0;i<20;i++)if(!seatClaims.has(i)){seatClaims.add(i);return i;}return null;},
  seatTiles:Array.from({length:20},(_,x)=>({x,y:2})),waitTiles:[{x:1,y:1}],mapRenderer:{getSpawnPoint:()=>({x:1,y:1}),gidAt:()=>0,tileSize:16},mountIdRef,mountId:1,
  useStore:{getState:()=>state},Character,DeskScreen:class{},facingForSeat:()=> 'up',entrance:{x:1,y:1},hexNum:()=>0,hexToNumber:()=>0,colors:{accent:{}},charLayer:{},
  removeCharacter:()=>{throw Error('Unexpected mounted removal in loading fixture');},
  applyState:(agent)=>{if(controls.failApply)throw Error('Synthetic paint failure');applied.push({...agent});},console:{warn:(...args)=>warnings.push(args),error:(...args)=>warnings.push(args)}};
 const exports={};new Function(...Object.keys(scope),'exports',output)(...Object.values(scope),exports);
 const agent=(id='a')=>({id,character:'fixture',accent:'coral',status:'working',action:'old activity'});
 return{...exports,state,runtimes,seatClaims,pendingCharacters,frames,characters,applied,mountIdRef,warnings,agent,controls};
}

test('overlapping scene sync requests create one sprite and consume one seat',async()=>{
 const f=fixture(),a=f.agent();f.state.agents=[a];
 const calls=[f.addCharacter(a),f.addCharacter(a),f.addCharacter(a)];
 assert.equal(f.frames.length,1);assert.equal(f.seatClaims.size,1);
 f.frames[0].resolve([]);await Promise.all(calls);
 assert.equal(f.characters.length,1);assert.equal(f.runtimes.size,1);assert.equal(f.pendingCharacters.size,0);
 await f.addCharacter(a);assert.equal(f.frames.length,1);
});

test('arrival paints the latest roster state rather than the status captured before asset loading',async()=>{
 const f=fixture(),a=f.agent();f.state.agents=[a];const pending=f.addCharacter(a);
 f.state.agents=[{...a,status:'blocked',action:'needs operator'}];f.frames[0].resolve([]);await pending;
 assert.equal(f.applied[0].status,'blocked');assert.equal(f.applied[0].action,'needs operator');
});

test('removed agent or replaced scene leaves no sprite or seat claim after the load resolves',async()=>{
 for(const reason of ['removed','scene']){
  const f=fixture(),a=f.agent();f.state.agents=[a];const pending=f.addCharacter(a);
  if(reason==='removed')f.state.agents=[];else f.mountIdRef.current++;
  f.frames[0].resolve([]);await pending;
  assert.equal(f.characters.length,0);assert.equal(f.seatClaims.size,0);assert.equal(f.pendingCharacters.size,0);
 }
});

test('failed loading releases ownership and a later request can retry without an unhandled rejection',async()=>{
 const f=fixture(),a=f.agent();f.state.agents=[a];const pending=f.addCharacter(a);
 f.frames[0].reject(Error('synthetic asset failure'));await pending;
 assert.equal(f.runtimes.size,0);assert.equal(f.seatClaims.size,0);assert.equal(f.pendingCharacters.size,0);assert.equal(f.warnings.length,1);
 const retry=f.addCharacter(a);f.frames[1].resolve([]);await retry;
 assert.equal(f.characters.length,1);assert.equal(f.seatClaims.size,1);
});

test('a burst of nine agents with repeated roster syncs produces nine unique occupants',async()=>{
 const f=fixture(),calls=[];
 for(let i=0;i<9;i++){f.state.agents.push(f.agent(String(i)));for(const a of f.state.agents)calls.push(f.addCharacter(a));}
 assert.equal(f.frames.length,9);assert.equal(f.seatClaims.size,9);
 for(const frame of f.frames.reverse())frame.resolve([]);await Promise.all(calls);
 assert.equal(f.characters.length,9);assert.equal(f.runtimes.size,9);
 assert.equal(new Set(f.characters.map(c=>c.opts.seatTile.x)).size,9);
});

test('removed then re-added identity has a fresh claim that late old loading cannot erase',async()=>{
 const f=fixture(),a=f.agent();f.state.agents=[a];const old=f.addCharacter(a);
 f.state.agents=[];f.syncAgents();assert.equal(f.pendingCharacters.size,0);
 f.state.agents=[{...a,status:'waiting',action:'replacement'}];const replacement=f.addCharacter(f.state.agents[0]);
 const claim=f.pendingCharacters.get(a.id);
 f.frames[0].resolve([]);await old;
 assert.equal(f.characters.length,0);assert.equal(f.pendingCharacters.get(a.id),claim);assert.equal(f.seatClaims.size,1);
 f.frames[1].resolve([]);await replacement;
 assert.equal(f.characters.length,1);assert.equal(f.applied[0].action,'replacement');assert.equal(f.seatClaims.size,1);
});

test('partially created sprite is torn down if initial state painting fails',async()=>{
 const f=fixture(),a=f.agent();f.state.agents=[a];f.controls.failApply=true;
 const pending=f.addCharacter(a);f.frames[0].resolve([]);await pending;
 assert.equal(f.characters[0].destroyed,true);assert.equal(f.runtimes.size,0);assert.equal(f.seatClaims.size,0);assert.equal(f.pendingCharacters.size,0);
});
