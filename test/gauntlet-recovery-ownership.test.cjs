'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const { createGauntletRun } = load('src/main/gauntlet/core.ts');
const { GauntletSpawnOwnership } = load('src/main/gauntlet/spawnOwnership.ts');
const { partitionRestorable } = load('src/shared/agentLifecycle.ts');

function fixture(providers) {
  const root = mkdtempSync(join(tmpdir(), 'operatus-recovery-ownership-'));
  const repository = join(root, 'repository');
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  mkdirSync(repository);
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Operatus Test']);
  git(['config', 'user.email', 'operatus@example.invalid']);
  writeFileSync(join(repository, 'value.txt'), 'base\n');
  git(['add', '.']); git(['commit', '-m', 'base']);
  const stateRoot = join(root, 'state');
  const input = { stateRoot, primitiveRoot: join(__dirname, '../vendor/agent-primitives') };
  const backend = new LocalGauntletBackend(input); backend.open();
  const run = backend.start({ repository, objective: 'Change the value', providers }).run;
  backend.freeze(run.id, { objective: 'Change the value', criteria: ['Value changes'], checks: [], constraints: [], exclusions: [] });
  const prepared = backend.prepareImplementer(run.id);
  const opts = { id: prepared.launch.id, cwd: prepared.launch.worktreePath, provider: prepared.launch.provider,
    resume: false, hive: { id: prepared.launch.id, cwd: prepared.launch.worktreePath } };
  const gate = () => new GauntletSpawnOwnership(() => backend, join(stateRoot, 'worktrees/gauntlet'));
  return { root, repository, stateRoot, input, backend, run, prepared, opts, gate };
}

test('run-owned launches cannot enter generic restore, including legacy PTY ids', () => {
  const f = fixture();
  try {
    assert.match(f.gate().check(f.opts), /cannot be restored/);
    assert.match(f.gate().check({ ...f.opts, id: `pty-${f.opts.id}`, hive: undefined, cwd: f.repository }), /cannot be restored/);
    f.backend.cancel(f.run.id, 'test cancellation');
    assert.match(f.gate().check({ ...f.opts, cwd: f.repository }), /cannot be restored/);
    assert.ok(f.gate().check(f.opts, f.prepared), 'terminal launch cannot be admitted');
    assert.equal(f.gate().check({ id: 'ordinary', cwd: f.repository }), null);
  } finally { f.backend.close(); }
});

test('fresh main-owned launch admits once; mismatched, resumed and forged token launches fail', () => {
  const f = fixture();
  try {
    for (const changed of [ { resume: true }, { requireResume: true }, { resumeSessionId: 'old' },
      { provider: 'other' }, { cwd: f.repository }, { id: 'other' }, { hive: { id: 'other', cwd: f.opts.cwd } } ]) {
      assert.ok(f.gate().check({ ...f.opts, ...changed }, f.prepared));
    }
    assert.ok(f.gate().check(f.opts, { ...f.prepared, token: 'forged' }));
    for (const patch of [{sessionId:randomUUID()},{runId:randomUUID()},{role:'critic'},
      {provider:'codex'},{model:'forged-model'},{expectedSha:'f'.repeat(40)},{candidateBranch:'other'}, {worktreePath:f.repository}]) {
      assert.ok(f.gate().check(f.opts,{...f.prepared,launch:{...f.prepared.launch,...patch}}));
    }
    const gate = f.gate();
    assert.ok(gate.beforeSpawn(f.opts, f.prepared), 'finalization requires a preparation claim');
    assert.equal(gate.check(f.opts, f.prepared), null);
    assert.match(gate.check(f.opts, f.prepared), /already claimed/);
    assert.equal(gate.beforeSpawn(f.opts, f.prepared), null);
    assert.ok(gate.beforeSpawn(f.opts, f.prepared), 'process creation is single-use even after a spawn failure');
  } finally { f.backend.close(); }
});

// Execute the actual main function body. All OS/provider/credential effects are
// replaced by inert boundaries; only the real SQLite/Git lifecycle gate runs.
// Synthetic billing admission here is a test dependency, not an application flag.
function spawnHarness(gate) {
  const source=require('node:fs').readFileSync(join(__dirname,'../src/main/index.ts'),'utf8');
  const body=source.slice(source.indexOf('async function spawnAgentCore('),source.indexOf("ipcMain.handle('pty:write'"));
  const output=require('typescript').transpileModule(body,{compilerOptions:{target:99}}).outputText;
  const provisioning=[],spawns=[],mappings=new Map();let held=false,remote=0;
  const inactive={active:()=>false,env:()=>({})};
  const bindings={allowQuit:false,isExecutableReference:()=>true,gauntletSpawnOwnership:gate,
    subscriptionLaunchError:()=>held?'test billing hold':'',expandTilde:x=>x,inferAgentProvider:(_command,p)=>p,
    isClaudeProvider:()=>false,gauntletControl:null,
    hive:{enabled:()=>true,ensureAgent:()=>new Promise(resolve=>provisioning.push(resolve)),lastSession:()=>null},
    memory:inactive,knowledge:inactive,readConfig:()=>({}),skillsResourceDir:()=>'/unused',providerPreset:()=>({}),
    ptyToAgent:mappings,nonInteractiveEnvForProvider:()=>({}),
    enableCodexRemoteForSpawn:async()=>{remote++;},
    ptyManager:{spawn:opts=>{spawns.push(structuredClone(opts));return{ok:true};}},analytics:{track(){}},
    syncKeepAwake(){},worktreePaths:new Map()};
  const core=new Function(...Object.keys(bindings),`${output}; return {spawn:spawnAgentCore,quit(){allowQuit=true;}};`)(...Object.values(bindings));
  return{...core,spawns,mappings,hold(){held=true;},get remote(){return remote;},release(){assert.equal(provisioning.length,1);provisioning.shift()({args:[],env:{}});}};
}

test('actual main spawn rejects cancel/retry/shutdown/billing changes during awaited provisioning', async()=>{
  for(const scenario of ['cancel','retry','closed-authority','shutdown','billing']){
    const f=fixture({implementer:{provider:'codex'}}),gate=f.gate(),h=spawnHarness(gate);
    try{
      const pending=h.spawn({...f.opts,command:'codex',noAutoInstall:true,isolate:false},null,f.prepared);
      let replacement;
      if(scenario==='cancel')f.backend.cancel(f.run.id,'cancel during provisioning');
      if(scenario==='retry'){
        f.backend.infrastructureFailure(f.run.id,'replace while provisioning',true);
        replacement=f.backend.prepareImplementer(f.run.id);
      }
      if(scenario==='closed-authority')f.backend.close();
      if(scenario==='shutdown')h.quit();
      if(scenario==='billing')h.hold();
      h.release();const result=await pending;
      assert.equal(result.ok,false,scenario);assert.equal(h.spawns.length,0,scenario);assert.equal(h.mappings.size,0,scenario);
      assert.equal(h.remote,0,'Gauntlet must not start an unrelated remote daemon');
      if(replacement){assert.equal(f.backend.status(f.run.id).run.currentLaunchId,replacement.launch.id);assert.equal(replacement.launch.status,'running');}
    }finally{f.backend.close();}
  }
});

test('actual main spawn admits a current claimed launch once; ordinary remote behavior is unchanged',async()=>{
  const f=fixture({implementer:{provider:'codex'}}),gate=f.gate(),h=spawnHarness(gate);
  try{
    const opts={...f.opts,command:'codex',noAutoInstall:true,isolate:false};
    const pending=h.spawn(opts,null,f.prepared);h.release();assert.equal((await pending).ok,true);
    assert.equal(h.spawns.length,1);assert.equal(h.remote,0);assert.equal(h.mappings.get(opts.id),opts.id);
    assert.equal((await h.spawn({...opts},null,f.prepared)).ok,false);assert.equal(h.spawns.length,1);
    const ordinary=h.spawn({...opts,id:'ordinary',cwd:f.repository,hive:{id:'ordinary',cwd:f.repository}},null);
    h.release();assert.equal((await ordinary).ok,true);assert.equal(h.remote,1);assert.equal(h.spawns.length,2);
  }finally{f.backend.close();}
});

test('actual advancement delegates ownership and never interprets a late lifecycle failure as another worker retry',async()=>{
  const source=require('node:fs').readFileSync(join(__dirname,'../src/main/index.ts'),'utf8');
  const body=source.slice(source.indexOf('async function advanceGauntlet('),source.indexOf('function startGauntletWatchdog('));
  const output=require('typescript').transpileModule(body,{compilerOptions:{target:99}}).outputText;
  for(const scenario of ['cancel','replace']){
    const f=fixture();let rejectSpawn,attempt;
    try{
      const run=f.backend.start({repository:f.repository,objective:'Delayed launch completion',limits:{maxInfrastructureRetries:3}}).run;
      f.backend.freeze(run.id,{objective:run.requestedObjective,criteria:['Fixture result'],checks:[],constraints:[],exclusions:[]});
      const prepared=f.backend.prepareImplementer(run.id);
      const bindings={allowQuit:false,gauntletBackend:f.backend,subscriptionLaunchError:()=>'',console:{error:()=>{}},
        isolatedGauntletRunner:{advance:id=>{attempt=id;return new Promise((_resolve,reject)=>{rejectSpawn=reject;});},},
        spawnPreparedGauntlet:()=>{throw Error('Legacy launcher must remain unreachable');}};
      const advance=new Function(...Object.keys(bindings),`${output};return advanceGauntlet;`)(...Object.values(bindings));
      const pending=advance(run.id);assert.equal(attempt,run.id);assert.equal(f.backend.status(run.id).run.currentLaunchId,prepared.launch.id);
      if(scenario==='cancel')f.backend.cancel(run.id,'cancel during launch');
      else{f.backend.infrastructureFailure(run.id,'retire old attempt',true);f.backend.prepareImplementer(run.id);}
      const before=f.backend.status(run.id);
      rejectSpawn(Error('old launch failed after it was retired'));await pending;
      assert.deepEqual(f.backend.status(run.id),before,'late failure must not affect the current run or retry count');
    }finally{f.backend.close();}
  }
});

test('managed worktrees reject new ordinary identities and symlink aliases', () => {
  const f = fixture();
  try {
    const alias = join(f.root, 'alias'); symlinkSync(f.opts.cwd, alias);
    for (const cwd of [f.opts.cwd, alias, join(f.opts.cwd, 'missing-child'), join(alias, 'missing-child')]) {
      assert.match(f.gate().check({ id: 'disguised', cwd }), /workspaces require/);
    }
    assert.equal(f.gate().check({ id: 'normal', cwd: f.repository }), null);
  } finally { f.backend.close(); }
});

test('two projects complete concurrently without sharing ownership, artifacts or cancellation', async () => {
  const f = fixture();
  try {
    const otherRepo = join(f.root, 'other-project');
    execFileSync('git', ['clone', f.repository, otherRepo], { stdio: 'ignore' });
    for (const [key, value] of [['user.name', 'Operatus Test'], ['user.email', 'operatus@example.invalid']]) {
      execFileSync('git', ['-C', otherRepo, 'config', key, value]);
    }
    const secondRun = f.backend.start({ repository: otherRepo, objective: 'Independent project' }).run;
    f.backend.freeze(secondRun.id, { objective: 'Independent project', criteria: ['Value changes'], checks: [], constraints: [], exclusions: [] });
    const second = f.backend.prepareImplementer(secondRun.id);
    assert.notEqual(second.launch.worktreePath, f.prepared.launch.worktreePath);
    const results = await Promise.all([f.prepared, second].map(async (prepared, i) => {
      const cwd = prepared.launch.worktreePath;
      writeFileSync(join(cwd, 'value.txt'), `project-${i}\n`);
      execFileSync('git', ['add', 'value.txt'], { cwd });
      execFileSync('git', ['commit', '-m', `project ${i}`], { cwd, stdio: 'ignore' });
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
      return f.backend.completeArtifact({ runId: prepared.launch.runId, launchId: prepared.launch.id, token: prepared.token, sha });
    }));
    assert.ok(results.every(s => s.run.status === 'awaiting_critic'));
    assert.notEqual(results[0].run.currentArtifactSha, results[1].run.currentArtifactSha);
    f.backend.cancel(f.run.id, 'Cancel first project only');
    assert.equal(f.backend.status(secondRun.id).run.status, 'awaiting_critic');
    assert.equal(f.backend.activeRuns().some(r => r.id === secondRun.id), true);
    assert.equal(f.backend.activeRuns().some(r => r.id === f.run.id), false);
  } finally { f.backend.close(); }
});

test('restart rejects old worker and grants only a new protocol launch identity', () => {
  const f = fixture();
  f.backend.close();
  const reopened = new LocalGauntletBackend(f.input); reopened.open();
  try {
    const recovered = reopened.reconcileAfterRestart().find(s => s.run.id === f.run.id);
    assert.equal(recovered.run.status, 'awaiting_implementation');
    assert.equal(recovered.launches[0].status, 'failed');
    const gate = new GauntletSpawnOwnership(() => reopened, join(f.stateRoot, 'worktrees/gauntlet'));
    assert.ok(gate.check(f.opts, f.prepared));
    assert.ok(gate.check(f.opts));
    const replacement = reopened.prepareImplementer(f.run.id);
    assert.notEqual(replacement.launch.id, f.prepared.launch.id);
    assert.notEqual(replacement.launch.sessionId, f.prepared.launch.sessionId);
    assert.notEqual(replacement.launch.worktreePath, f.prepared.launch.worktreePath);
    assert.equal(gate.check({ id: replacement.launch.id, provider: replacement.launch.provider,
      cwd: replacement.launch.worktreePath, hive: { id: replacement.launch.id, cwd: replacement.launch.worktreePath } }, replacement), null);
  } finally { reopened.close(); }
});

test('recovery and launch lookup are not hidden behind 500 newer terminal runs', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 501; i++) {
      const id = randomUUID();
      const run = createGauntletRun({ id, repository: f.repository, objective: 'history',
        branch: `operatus/gauntlet/${id}`, baseSha: f.run.baseSha });
      run.updatedAt = Date.now() + 1000 + i;
      run.status = 'cancelled';
      f.backend.store.createRun(run);
    }
    assert.equal(f.backend.store.listRuns(500).some(r => r.id === f.run.id), false);
    assert.ok(f.backend.store.listRecoverableRuns().some(r => r.id === f.run.id));
    const escalation = f.backend.start({ repository: f.repository, objective: 'Older escalation must remain visible' }).run;
    f.backend.escalate(escalation.id, 'Human decision required');
    const failure = f.backend.start({ repository: f.repository, objective: 'Older failure must remain visible' }).run;
    f.backend.infrastructureFailure(failure.id, 'Fixture failure', false);
    const visible = f.backend.list();
    assert.ok(visible.some(r => r.id === f.run.id), 'older active work remains in operator list');
    assert.ok(visible.some(r => r.id === escalation.id), 'escalation is not paginated away');
    assert.ok(visible.some(r => r.id === failure.id), 'failure is not paginated away');
    assert.equal(visible.filter(r => r.status === 'cancelled').length, 100, 'only closed history is capped');
    assert.match(f.gate().check(f.opts), /cannot be restored/);
    assert.equal(f.backend.reconcileAfterRestart().find(s => s.run.id === f.run.id).run.status, 'awaiting_implementation');
  } finally { f.backend.close(); }
});

test('unavailable authority fails closed; renderer hints preserve history without granting restore', () => {
  assert.match(new GauntletSpawnOwnership(() => null, '/unavailable').check({ id: 'normal', cwd: '/tmp' }), /unavailable/);
  const agents = [{ id: 'ordinary', description: 'Implementer' },
    { id: 'legacy', description: 'Gauntlet critic', note: 'keep evidence' },
    { id: 'marked', lifecycleOwner: 'gauntlet', gauntletRunId: 'run' }];
  const partition = partitionRestorable(agents);
  assert.deepEqual(partition.ordinary.map(a => a.id), ['ordinary']);
  assert.deepEqual(partition.managed.map(a => a.id), ['legacy', 'marked']);
  assert.equal(partition.managed[0].note, 'keep evidence');
  assert.equal(agents.length, 3, 'partition does not mutate or delete history');
});
