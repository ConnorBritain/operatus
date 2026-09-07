'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=require('./load-ts.cjs');
const {TiledMapRenderer}=load('src/renderer/src/scene/office/TiledMapRenderer.ts');
const {findPath}=load('src/renderer/src/scene/office/pathfinding.ts');
const data=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/renderer/src/assets/maps/operatus-operations.tmj'),'utf8'));
const mapOf=(m=data())=>new TiledMapRenderer(m,[]);

test('the previous collision rectangles seal the evidence room despite its painted door',()=>{
  const m=data(),objects=m.layers.find(l=>l.name==='collision').objects;
  m.layers.find(l=>l.name==='collision').objects=objects.filter(o=>!['critic-south-right','repair-divider-right'].includes(o.name));
  for(const o of objects)if(['critic-south','repair-divider'].includes(o.name))o.width=240;
  const map=mapOf(m),start=map.getSpawnPoint('entrance');
  for(const name of ['desk-chief-architect','desk-product-manager','desk-team-lead','warroom-seat']){
    assert.equal(findPath(map,start,map.getSpawnPoint(name)),null,name);
  }
});

test('every shipped desk and evidence seat has a contiguous collision-safe route from and to the entrance',()=>{
  const map=mapOf(),entrance=map.getSpawnPoint('entrance');
  const stations=[...map.getAllSpawnPoints()].filter(([n])=>/^(pc-|desk-|warroom)/.test(n));
  assert.equal(stations.length,17);
  for(const [name,seat]of stations)for(const [start,end]of[[entrance,seat],[seat,entrance]]){
    const route=findPath(map,start,end);assert.ok(route?.length,name);
    let previous=start;
    for(const tile of route){assert.equal(map.isWalkable(tile.x,tile.y),true,name);assert.equal(Math.abs(tile.x-previous.x)+Math.abs(tile.y-previous.y),1,name);previous=tile;}
    assert.deepEqual(previous,end);
  }
  // Keep both wall sections; only the authored central doorway is opened.
  for(const y of [17,18,19,20]){
    assert.equal(map.isWalkable(38,y),true);assert.equal(map.isWalkable(39,y),true);
    assert.equal(map.isWalkable(37,y),false);assert.equal(map.isWalkable(40,y),false);
  }
  for(const [x,y]of[[0,20],[47,20],[20,0],[20,35],[33,12]])assert.equal(map.isWalkable(x,y),false);
});

function characterAt(map,tile){
  const ts=require('typescript'),source=ts.createSourceFile('Character.ts',fs.readFileSync(path.join(__dirname,'../src/renderer/src/scene/office/Character.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Character');
  const names=new Set(['getTilePosition','moveTo','walkToAndThen','setIdle','updateWalk']);
  const methods=cls.members.filter(n=>names.has(n.name?.getText(source)));assert.equal(methods.length,names.size);
  const output=ts.transpileModule(`class FixtureCharacter { ${methods.map(n=>n.getText(source)).join('\n')} }; exports.Character=FixtureCharacter;`,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function('exports','findPath','SPEED',output)(exports,findPath,48);
  const c=new exports.Character();Object.assign(c,{mapRenderer:map,px:tile.x*16+8,py:tile.y*16+16,
    path:[],state:'idle',direction:'up',pendingWork:null,pendingSit:false,arrivalCallback:null,glowOn:false,
    sprite:{setAnimation(){},setSeatedCrop(){},setPosition(){}}});return c;
}

test('actual Character movement reaches the evidence station once through the door',()=>{
  const map=mapOf(),goal=map.getSpawnPoint('desk-chief-architect'),c=characterAt(map,map.getSpawnPoint('entrance'));
  let arrivals=0;c.walkToAndThen(goal,()=>{arrivals++;assert.deepEqual(c.getTilePosition(),goal);});
  for(let tick=0;tick<1000&&c.state==='walk';tick++)c.updateWalk(0.1);
  assert.equal(c.state,'idle');assert.equal(arrivals,1);assert.deepEqual(c.getTilePosition(),goal);
  c.updateWalk(0.1);assert.equal(arrivals,1);
});

test('an unreachable replacement destination cancels the old walk and cannot fake arrival',()=>{
  const map=mapOf(),start=map.getSpawnPoint('entrance'),c=characterAt(map,start);let arrivals=0;
  c.walkToAndThen(map.getSpawnPoint('pc-1'),()=>{arrivals++;});assert.equal(c.state,'walk');
  c.glowOn=true;c.pendingSit=true;
  c.walkToAndThen({x:0,y:0},()=>{arrivals++;});
  assert.equal(c.state,'idle');assert.deepEqual(c.path,[]);assert.equal(c.glowOn,false);
  assert.equal(c.pendingSit,false);assert.equal(c.arrivalCallback,null);
  c.updateWalk(0.1);assert.equal(arrivals,0);assert.deepEqual(c.getTilePosition(),start);
});
