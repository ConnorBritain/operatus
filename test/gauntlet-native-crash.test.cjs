'use strict';
// Actual owner-process SIGKILL, not a fabricated missing-exit database row.
// All native provider responses/accounts remain synthetic and locally confined.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{randomUUID}=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const load=require('./load-ts.cjs');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {IsolatedGauntletRunner}=load('src/main/gauntlet/isolatedRunner.ts');
const {needsOperator}=load('src/renderer/src/gauntlet/runViewState.ts');
const {capacityView}=load('src/renderer/src/gauntlet/capacityView.ts');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
async function until(predicate,timeout=5000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw Error('Timed out waiting for owned process');await new Promise(r=>setTimeout(r,25));}}

for(const at of ['worker','critic'])test(`native owner crash during ${at} quarantines before recovery`,{
  skip:process.platform!=='darwin'||!process.env.OPERATUS_CLAUDE_PROBE_PATH||!process.env.OPERATUS_CODEX_PROBE_PATH,timeout:90000
},async t=>{
  assert.ok(load('src/shared/billingPolicy.ts').subscriptionLaunchError());
  const disk=fs.statfsSync(tmpdir());if(disk.bavail*disk.bsize<1024*1024*1024){t.skip('Insufficient native-copy reserve');return;}
  const nonce=randomUUID();let root,backend,runner,exit,output='',cleanup=[];
  const child=spawn(process.execPath,[join(__dirname,'gauntlet-native-concurrency.test.cjs')],{
    cwd:join(__dirname,'..'),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',OPERATUS_NATIVE_MIXED:'1',OPERATUS_NATIVE_RESTART:'1',
      OPERATUS_NATIVE_CRASH_CHILD:at,OPERATUS_CRASH_NONCE:nonce},stdio:['ignore','pipe','pipe','ipc']});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>{exit={code,signal};resolve();}));
  for(const pipe of [child.stdout,child.stderr])pipe.on('data',bytes=>{output=(output+bytes.toString()).slice(-16000);});
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Native crash barrier timed out')),45000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error(`Owner exited before crash barrier: ${output}`));});
    child.on('message',message=>{
      if(message.nonce!==nonce)return;
      const parent=fs.realpathSync(tmpdir());
      if(typeof message.root!=='string'||!message.root.startsWith(parent+'/op-native-concurrent-')||
        fs.realpathSync(message.root)!==message.root){clearTimeout(timer);reject(Error('Invalid owned fixture root'));return;}
      root=message.root;
      if(message.type==='crash-ready'){clearTimeout(timer);resolve();}
    });
  });
  t.after(async()=>{
    if(!exit){child.kill('SIGKILL');await closed;}
    if(runner)await runner.close();
    // Discover only PIDs journaled by this test's killed owner. Never signal by
    // name or broad process matching; recheck the private root in argv or cwd.
    if(root){
      if(!backend){backend=new LocalGauntletBackend({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();}
      for(const run of backend.list())for(const row of backend.status(run.id).runtimeObservations.filter(r=>r.event.type==='process_started')){
        const pid=row.event.pid;if(!Number.isSafeInteger(pid)||pid<=1)throw Error('Invalid recorded native PID');
        if(!alive(pid)){cleanup.push({pid,outcome:'already-exited'});continue;}
        let command;try{command=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});}catch{if(!alive(pid))continue;throw Error('Cannot verify owned PID');}
        if(!command.includes(root+'/')){
          let cwd='';try{cwd=execFileSync('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'});}catch{if(!alive(pid))continue;}
          if(!cwd.split('\n').some(line=>line.startsWith('n'+root+'/'))){cleanup.push({pid,outcome:'not-signalled-ownership-unconfirmed'});continue;}
        }
        try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
        await until(()=>!alive(pid));cleanup.push({pid,outcome:'test-owned-group-killed'});
      }
      fs.writeFileSync(join(root,'crash-cleanup.json'),JSON.stringify({exit,cleanup,output},null,2),{mode:0o600});
      backend.close();
      assert.ok(!cleanup.some(item=>item.outcome==='not-signalled-ownership-unconfirmed'),'Inspect retained test-owned process evidence before cleanup');
      const profiles=join(root,'profiles');
      for(const entry of fs.existsSync(profiles)?fs.readdirSync(profiles,{withFileTypes:true}):[])if(entry.isDirectory()&&/^native-(?:codex-)?[a-z0-9]+$/i.test(entry.name)){
        for(const name of ['claude','codex','codex-code-mode-host']){const path=join(profiles,entry.name,name);if(fs.existsSync(path)&&fs.lstatSync(path).isFile())fs.unlinkSync(path);}
      }
    }
  });
  await ready;
  const before=JSON.parse(fs.readFileSync(join(root,'before-crash.json'),'utf8'));
  assert.deepEqual(before.capacity.dispatches.map(d=>d.state),['running','running','queued']);
  const live=before.before.flatMap(s=>s.runtimeObservations).filter(row=>row.event.type==='process_started'&&
    !before.before.flatMap(s=>s.runtimeObservations).some(other=>other.launchId===row.launchId&&other.event.type==='process_exited'));
  assert.equal(live.length,3);for(const row of live)assert.ok(alive(row.event.pid));
  assert.equal(child.kill('SIGKILL'),true);await closed;assert.equal(exit.signal,'SIGKILL');
  backend=new LocalGauntletBackend({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();
  const ids=before.before.map(s=>s.run.id),afterDeath=ids.map(id=>backend.status(id));
  // Compare the same serialized snapshot shape: optional undefined fields are
  // absent in the pre-crash JSON, not evidence of a database transition.
  assert.deepEqual(JSON.parse(JSON.stringify(afterDeath)),before.before,'Abrupt death must not fabricate graceful shutdown receipts');
  let attempts=0;
  const fail=async()=>{attempts++;throw Error('Quarantine must block native preparation');};
  // Synthetic gate admits scheduling only, proving quarantine itself holds the
  // third run. Neither factory can launch a process, and product hold stays on.
  runner=new IsolatedGauntletRunner(backend,{conductor:fail,worker:fail},()=>null,()=>{});
  assert.deepEqual(runner.capacity().dispatches.map(d=>d.state),['quarantined','quarantined','queued']);
  backend.reconcileAfterRestart();const recovered=ids.map(id=>backend.status(id));
  assert.deepEqual(recovered.map(s=>s.run.status),['human_required','human_required','orienting']);
  assert.ok(recovered.slice(0,2).every(s=>needsOperator(s.run)));
  assert.deepEqual(recovered.map(s=>s.artifacts),before.before.map(s=>s.artifacts));
  assert.ok(recovered.every(s=>s.reports.length===0&&s.acknowledgments.length===0));
  for(const row of live){
    const snapshot=recovered.find(s=>s.run.id===row.runId);
    assert.equal(snapshot.runtimeObservations.filter(r=>r.launchId===row.launchId&&r.event.type==='recovery_interrupted').length,1);
    assert.equal(snapshot.runtimeObservations.filter(r=>r.launchId===row.launchId&&r.event.type==='process_exited').length,0);
  }
  const pending=runner.advance(ids[2]);await runner.advance(ids[0]);await runner.advance(ids[1]);
  assert.equal(attempts,0);assert.equal(backend.status(ids[2]).launches.length,0);
  const capacity=runner.capacity();backend.reconcileAfterRestart();assert.deepEqual(ids.map(id=>backend.status(id)),recovered);
  assert.equal(capacityView(capacity).summary,'2/2 slots occupied · 0 running · 1 queued · 2 need inspection');
  const worker=recovered[0].launches.find(l=>l.role==='implementer');
  if(at==='worker'){
    assert.equal(fs.readFileSync(join(worker.worktreePath,'value.txt'),'utf8'),`${ids[0]}: changed\n`);
    assert.ok(recovered[0].preservations.some(p=>p.launchId===worker.id&&p.outcome==='preserved'));
  }else assert.equal(recovered[0].runtimeObservations.filter(r=>r.event.type==='native_identity').length,2);
  for(const snapshot of recovered){
    const git=(...args)=>execFileSync('/usr/bin/git',['-C',snapshot.run.repository,...args],{encoding:'utf8'}).trim();
    assert.equal(git('rev-parse','main'),snapshot.run.baseSha);assert.equal(git('status','--porcelain'),'');
  }
  await runner.close();await pending;
  fs.writeFileSync(join(root,'crash-recovery.json'),JSON.stringify({at,ownerExit:exit,before,afterDeath,recovered,capacity,attempts,realInference:false},null,2),{mode:0o600});
  console.log(JSON.stringify({root,at,ownerExit:exit,statuses:recovered.map(s=>s.run.status),capacity:capacity.dispatches.map(d=>d.state),realInference:false}));
});
