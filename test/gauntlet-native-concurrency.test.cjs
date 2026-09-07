'use strict';
// Opt-in actual native CLI exercise. Account metadata and every model response
// are synthetic; this does not admit subscriptions or establish real judgment.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), { join } = require('node:path'), { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process'), { Readable } = require('node:stream');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const { GauntletControlServer } = load('src/main/gauntlet/controlServer.ts');
const { IsolatedGauntletRunner } = load('src/main/gauntlet/isolatedRunner.ts');
const { createIsolatedClaudeFactory } = load('src/main/gauntlet/isolatedClaudeFactory.ts');
const { createIsolatedProviderFactory } = load('src/main/gauntlet/isolatedProviderFactory.ts');
const codexCriticProvider = require('./fixtures/codex-critic-provider.cjs');
const { ClaudeAccountAdmission } = load('src/main/claudeAccountAdmission.ts');
const { openClaudeSubscriptionGateway } = load('src/main/claudeSubscriptionGateway.ts');
const { desktopRunStarter } = load('src/main/gauntlet/desktopStart.ts');
const { orderRuns, needsOperator, isClosedRun } = load('src/renderer/src/gauntlet/runViewState.ts');
const MODEL = 'claude-fable-5-1';
const mixed = process.env.OPERATUS_NATIVE_MIXED === '1';
const restart = process.env.OPERATUS_NATIVE_RESTART === '1';
const crashAt = process.env.OPERATUS_NATIVE_CRASH_CHILD;
function response(tool) {
  const events = [
    { type:'message_start', message:{ id:'fixture', type:'message', role:'assistant', model:MODEL, content:[], stop_reason:null,
      stop_sequence:null, usage:{ input_tokens:10, output_tokens:0 } } },
    { type:'content_block_start', index:0, content_block:tool ? { type:'tool_use', id:tool.id, name:tool.name, input:{} } : { type:'text', text:'' } },
    { type:'content_block_delta', index:0, delta:tool ? { type:'input_json_delta', partial_json:JSON.stringify(tool.input) } : { type:'text_delta', text:'Synthetic concurrency fixture only.' } },
    { type:'content_block_stop', index:0 },
    { type:'message_delta', delta:{ stop_reason:tool ? 'tool_use' : 'end_turn', stop_sequence:null }, usage:{ output_tokens:10 } },
    { type:'message_stop' }
  ];
  return { status:200, contentType:'text/event-stream', body:Readable.from(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)) };
}
async function until(predicate, label, timeout = 30000) {
  const end = Date.now()+timeout;
  while (!predicate()) {
    if (Date.now() >= end) throw Error(`Timed out: ${label}`);
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
for(const cancelAt of (crashAt?[crashAt]:restart?['worker','critic']:['lead','worker'])) test(`native cross-project capacity, ${cancelAt} ${restart?'shutdown/reopen':'cancellation and queued repair loops'}`, {
  skip:process.platform!=='darwin' || !process.env.OPERATUS_CLAUDE_PROBE_PATH, timeout:150000
}, async t=>{
  assert.ok(load('src/shared/billingPolicy.ts').subscriptionLaunchError(), 'Production hold must remain enabled');
  if(restart)assert.ok(mixed,'Restart fixture requires the mixed provider factory');
  if(crashAt)assert.ok(restart&&['worker','critic'].includes(crashAt)&&process.send,'Crash fixture requires an IPC-owning parent');
  const disk=fs.statfsSync(tmpdir());
  if (disk.bavail*disk.bsize<1024*1024*1024) { t.skip('Insufficient concurrent native-copy reserve'); return; }
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-native-concurrent-')));
  if(crashAt)process.send({type:'fixture-root',root,nonce:process.env.OPERATUS_CRASH_NONCE});
  const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
  const repositories=['cancelled-project','continuing-project','queued-project'].map(name=>{
    const path=join(root,name);fs.mkdirSync(path);git(path,'init','-b','main');git(path,'config','user.name','Fixture');
    git(path,'config','user.email','fixture@example.invalid');fs.writeFileSync(join(path,'value.txt'),name);
    git(path,'add','.');git(path,'commit','-m','fixture base');return path;
  });
  // The worker case also exercises two independent runs of the SAME checkout.
  if(cancelAt==='worker') repositories[1]=repositories[0];
  const backendInput={stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')};
  let backend=new LocalGauntletBackend(backendInput);backend.open();
  let runner;
  const timeline=[], requests=[], gates=new Map(), handles=[], dispatchErrors=[], results=new Map();
  const publish=snapshot=>{
    timeline.push({at:Date.now(),runId:snapshot.run.id,status:snapshot.run.status,
      capacity:runner?.capacity(), observations:snapshot.runtimeObservations.map(r=>({sequence:r.sequence,launchId:r.launchId,kind:r.event.type}))});
    runner?.observe(snapshot);
  };
  const server=new GauntletControlServer(join(root,'state'),backend,publish);await server.start();
  const account=new ClaudeAccountAdmission({now:Date.now,
    readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
    metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},
      organization:{uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}:{extra_usage:{is_enabled:false}}
  });
  const factoryInput={root:join(root,'profiles'),helperSource:join(__dirname,'../resources/operatus-gauntlet.cjs'),
    reviewEvidenceRoot:join(root,'state','review-evidence'),nodePath:process.execPath,socketPath:()=>server.info().socketPath,assertAdmissionOpen:()=>{}};
  const claudeDependencies={
    account,inspect:async()=>({executables:[{path:process.env.OPERATUS_CLAUDE_PROBE_PATH,sha256:process.env.OPERATUS_CLAUDE_PROBE_SHA256,
      versionObservation:{status:'reported',version:'2.1.263'}}]}),
    gateway:async(input,prepared)=>{
      const launch=prepared.launch, seen=new Set(); results.set(launch.id,seen);
      let leadTool;
      return openClaudeSubscriptionGateway({...input,transport:async request=>{
        assert.equal(request.token,'synthetic-main-only');
        requests.push({at:Date.now(),runId:launch.runId,launchId:launch.id,sessionId:launch.sessionId,role:launch.role});
        if (requests.length>100) throw Error('Synthetic request budget exceeded');
        const body=JSON.parse(request.body.toString()), snapshot=backend.status(launch.runId);
        for(const message of body.messages) for(const item of Array.isArray(message.content)?message.content:[]) {
          if(item.type==='tool_result') { assert.equal(!!item.is_error,false,JSON.stringify(item));seen.add(item.tool_use_id); }
        }
        // Hold a native request, not a fabricated lifecycle callback. In the
        // worker case, wait until the actual Write tool has changed its files.
        const first=launch.runId===runs[0].id;
        const barrier=first?(cancelAt==='worker'?launch.role==='implementer'&&seen.has('write'):
          cancelAt==='lead'&&launch.role==='conductor'):launch.role==='conductor';
        if(barrier&&!gates.has(launch.runId)) {
          await new Promise((resolve,reject)=>{
            const abort=()=>{request.signal.removeEventListener('abort',abort);reject(Error('Synthetic request cancelled'));};
            gates.set(launch.runId,()=>{request.signal.removeEventListener('abort',abort);resolve();});
            if(request.signal.aborted) abort(); else request.signal.addEventListener('abort',abort,{once:true});
          });
        }
        const command=(id,action,payload)=>({id,name:'Bash',input:{command:
          `"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" ${action} --run ${launch.runId} --launch ${launch.id} --json '${JSON.stringify(payload)}'`,timeout:10000}});
        let script;
        if(launch.role==='conductor') {
          if(snapshot.run.status==='orienting') leadTool=command('freeze','freeze',{objective:snapshot.run.requestedObjective,
            criteria:['value.txt contains the assigned run ID and repaired'],checks:[],constraints:['Synthetic fixture only'],exclusions:['Live judgment']});
          else if(snapshot.run.status==='awaiting_lead_ack') {
            const report=snapshot.reports.at(-1),repair=report.verdict==='REVISE';
            leadTool=command(`ack-${report.id}`,'acknowledge',{reportId:report.id,decision:repair?'repair':'pass',
              acceptedFindingIds:repair?['wrong']:[],rejectedFindings:[],rationale:'Synthetic decision',repairInstructions:repair?['Replace changed with repaired']:undefined});
          }
          script=[leadTool];
        } else if(launch.role==='critic') {
          const revise=snapshot.run.repairRound===0;
          script=[{id:'read',name:'Read',input:{file_path:join(launch.worktreePath,'value.txt')}},
            command('report','critic',{artifactSha:launch.expectedSha,contractDigest:snapshot.run.contract.digest,verdict:revise?'REVISE':'PASS',
              summary:'Synthetic review',findings:revise?[{id:'wrong',severity:'major',title:'Wrong value',evidence:'changed instead of repaired',criterionIds:[]}]:[]})];
        } else script=[{id:'write',name:'Write',input:{file_path:join(launch.worktreePath,'value.txt'),
          content:`${launch.runId}: ${launch.role==='repairer'?'repaired':'changed'}\n`}},
          {id:'commit',name:'Bash',input:{command:`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" commit --run ${launch.runId} --launch ${launch.id} --expected-sha ${launch.expectedSha} --bar-digest ${snapshot.run.contract.digest} --message "Concurrent fixture change"`,timeout:10000}}];
        return response(script.find(tool=>tool&&!seen.has(tool.id)));
      }});
    }
  };
  const codexResults=new Map();
  const factory=mixed?createIsolatedProviderFactory(factoryInput,{claude:claudeDependencies,
    codex:codexCriticProvider({backend,requests,results:codexResults,requireSkills:false,
      beforeRequest:async(launch,signal)=>{
        if(cancelAt!=='critic'||launch.runId!==runs[0].id||gates.has(launch.runId))return;
        await new Promise((resolve,reject)=>{
          const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Synthetic Critic request cancelled'));};
          gates.set(launch.runId,()=>{signal.removeEventListener('abort',abort);resolve();});
          if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
        });
      }})}):createIsolatedClaudeFactory(factoryInput,claudeDependencies);
  const observedFactory={supportsCodexCritic:factory.supportsCodexCritic,...Object.fromEntries(['conductor','worker'].map(method=>[method,async(...args)=>{
    const handle=await factory[method](...args);const owned={runId:args[0].launch.runId,launchId:args[0].launch.id,handle};handles.push(owned);
    void handle.completion.then(exit=>{owned.exit=exit;});return handle;
  }]))};
  runner=new IsolatedGauntletRunner(backend,observedFactory,()=>null,publish);
  const window={mainFrame:{}},providers=Object.fromEntries(['conductor','implementer','critic','repairer'].map(role=>[role,{provider:'claude',model:MODEL}]));
  if(mixed)providers.critic={provider:'codex',model:'gpt-5.6-sol'};
  const start=desktopRunStarter({localWindow:()=>window,hold:()=>null,backend:()=>backend,runner:()=>runner,
    publish:s=>{publish(s);return s;},onDispatchError:e=>dispatchErrors.push(String(e))});
  const runs=repositories.map((repository,i)=>start({sender:window,senderFrame:window.mainFrame},{repository,providers,
    objective:`[Native synthetic concurrency] Project ${i+1}: repair value.txt`,limits:{runTimeoutMs:120000,workerTimeoutMs:45000,criticTimeoutMs:30000}}).run);
  const completions=runs.map(run=>runner.advance(run.id));
  const deadline=setTimeout(()=>{for(const release of gates.values())release();void runner.close();},110000);
  let initialCapacity, afterCancellation, restartEvidence;
  try {
    await until(()=>gates.has(runs[0].id)&&gates.has(runs[1].id),'two actual native requests');
    initialCapacity=runner.capacity();
    assert.deepEqual(initialCapacity.dispatches.map(d=>[d.runId,d.state]),runs.map((r,i)=>[r.id,i<2?'running':'queued']));
    const priorityBaseline=runs.map(run=>backend.status(run.id));
    backend.store.priorities.set(runs[0].id,0,'low','Synthetic attention annotation; preserve active execution');
    backend.store.priorities.set(runs[2].id,0,'high','Synthetic attention annotation; do not jump the capacity queue');
    assert.equal(orderRuns(runs.map(run=>backend.status(run.id).run))[0].id,runs[2].id);
    assert.deepEqual(runner.capacity(),initialCapacity,'Attention annotations never preempt native capacity');
    for(let i=0;i<runs.length;i++){
      const current=backend.status(runs[i].id);
      assert.equal(current.run.version,priorityBaseline[i].run.version);
      assert.deepEqual(current.run.contract,priorityBaseline[i].run.contract);
      assert.deepEqual(current.events,priorityBaseline[i].events);
    }
    assert.equal(backend.status(runs[2].id).launches.length,0);
    assert.equal(handles.length,cancelAt==='critic'?4:cancelAt==='worker'?3:2);assert.equal(gates.has(runs[2].id),false);
    const livePid=run=>backend.status(run.id).runtimeObservations.find(r=>r.event.type==='process_started').event.pid;
    process.kill(livePid(runs[0]),0); process.kill(livePid(runs[1]),0);
    const cancelledWorker=backend.status(runs[0].id).launches.find(l=>l.role==='implementer');
    if(cancelAt==='worker') {
      assert.equal(fs.readFileSync(join(cancelledWorker.worktreePath,'value.txt'),'utf8'),`${runs[0].id}: changed\n`);
      assert.notEqual(git(cancelledWorker.worktreePath,'status','--porcelain'),'');
    }
    if(restart) {
      if(cancelAt==='critic')await until(()=>backend.status(runs[0].id).runtimeObservations.some(row=>row.event.type==='native_identity'&&row.event.turnId),'durable native Critic turn');
      const before=runs.map(run=>backend.status(run.id)), launches=handles.length;
      if(crashAt) {
        fs.writeFileSync(join(root,'before-crash.json'),JSON.stringify({root,before,capacity:runner.capacity(),realInference:false},null,2),{mode:0o600});
        process.send({type:'crash-ready',root,nonce:process.env.OPERATUS_CRASH_NONCE});
        await new Promise(()=>{}); // Parent kills this owner; no graceful drain.
      }
      await runner.close();await Promise.all(completions);await server.stop();
      const drained=runs.map(run=>backend.status(run.id));
      assert.equal(handles.length,launches,'Shutdown cannot admit the queued run');
      for(const snapshot of drained.slice(0,2)) {
        assert.ok(['human_required','infrastructure_failure'].includes(snapshot.run.status));
        assert.match(snapshot.run.stopReason,/Operatus shutdown/);
        assert.equal(snapshot.reports.length,0);assert.equal(snapshot.acknowledgments.length,0);
        for(const launch of snapshot.launches) {
          const exit=snapshot.runtimeObservations.find(row=>row.launchId===launch.id&&row.event.type==='process_exited');
          assert.equal(exit?.event.processExited,true);assert.equal(exit.event.gatewayRevocation,'confirmed');
        }
      }
      assert.equal(drained[2].run.status,'orienting');assert.equal(drained[2].launches.length,0);
      backend.close();backend=new LocalGauntletBackend(backendInput);backend.open();
      let attempts=0;
      const noLaunch={conductor:async()=>{attempts++;throw Error('Restart must not launch');},worker:async()=>{attempts++;throw Error('Restart must not launch');}};
      const recoveredRunner=new IsolatedGauntletRunner(backend,noLaunch,()=> 'Subscription launch hold',()=>{});
      runner=recoveredRunner;
      try {
        backend.reconcileAfterRestart();
        const recovered=runs.map(run=>backend.status(run.id));
        for(const run of runs)await recoveredRunner.advance(run.id);
        assert.equal(attempts,0);assert.deepEqual(recovered.map(s=>s.launches),drained.map(s=>s.launches));
        assert.deepEqual(recovered.map(s=>s.artifacts),drained.map(s=>s.artifacts));
        assert.deepEqual(recovered.map(s=>s.runtimeObservations),drained.map(s=>s.runtimeObservations));
        assert.deepEqual(recoveredRunner.capacity().dispatches.map(d=>[d.runId,d.state]),[[runs[2].id,'queued']]);
        for(const snapshot of recovered) {
          assert.equal(git(snapshot.run.repository,'rev-parse','main'),snapshot.run.baseSha);
          assert.equal(git(snapshot.run.repository,'status','--porcelain'),'');
        }
        if(cancelAt==='worker') {
          assert.equal(fs.readFileSync(join(cancelledWorker.worktreePath,'value.txt'),'utf8'),`${runs[0].id}: changed\n`);
          assert.ok(recovered[0].preservations.some(p=>p.launchId===cancelledWorker.id&&p.outcome==='preserved'));
        } else {
          assert.equal(recovered[0].artifacts.length,1);
          assert.equal(recovered[0].runtimeObservations.filter(row=>row.event.type==='native_identity').length,2);
        }
        restartEvidence={before,drained,recovered,capacity:recoveredRunner.capacity(),attempts};
        console.log(JSON.stringify({root,cancelAt,restart:true,statuses:recovered.map(s=>s.run.status),nativeLaunches:launches,realInference:false}));
      } finally {await recoveredRunner.close();}
      return;
    }
    publish(backend.cancel(runs[0].id,'Cancel only the first native project; preserve both peers.'));
    await completions[0];
    await until(()=>gates.has(runs[2].id),'queued native Conductor starts after cancellation drains');
    afterCancellation=runner.capacity();
    assert.deepEqual(afterCancellation.dispatches.map(d=>[d.runId,d.state]),runs.slice(1).map(r=>[r.id,'running']));
    process.kill(livePid(runs[1]),0);process.kill(livePid(runs[2]),0);
    assert.equal(backend.status(runs[0].id).launches.length,cancelAt==='worker'?2:1);
    assert.equal(backend.status(runs[0].id).artifacts.length,0);
    if(cancelledWorker) assert.equal(fs.readFileSync(join(cancelledWorker.worktreePath,'value.txt'),'utf8'),`${runs[0].id}: changed\n`);
    gates.get(runs[1].id)();gates.get(runs[2].id)();
    await Promise.all(completions);
    const snapshots=runs.map(run=>backend.status(run.id));
    assert.deepEqual(snapshots.map(s=>s.run.status),['cancelled','passed','passed']);
    assert.deepEqual(runner.capacity().dispatches,[]);assert.deepEqual(dispatchErrors,[]);
    const launches=snapshots.flatMap(s=>s.launches);
    if(mixed) {
      const critics=launches.filter(launch=>launch.role==='critic');assert.equal(critics.length,4);
      assert.ok(critics.every(launch=>launch.provider==='codex'));
      const identities=snapshots.flatMap(snapshot=>snapshot.runtimeObservations).filter(row=>row.event.type==='native_identity');
      assert.equal(identities.length,8);assert.equal(new Set(identities.map(row=>row.event.threadId)).size,4);
      assert.equal(new Set(identities.filter(row=>row.event.turnId).map(row=>row.event.turnId)).size,4);
      for(const [id,result] of codexResults)assert.equal(result.error,false,id);
      assert.equal([...codexResults.keys()].filter(id=>id.startsWith('report-')).length,4);
    }
    const expectedLaunches=cancelAt==='worker'?12:11;
    assert.equal(launches.length,expectedLaunches);assert.equal(new Set(launches.map(l=>l.sessionId)).size,expectedLaunches);
    // Conductors inspect their assigned repository read-only, so two leads may
    // share that context path. Fresh worker/Critic worktrees must never overlap.
    const fresh=launches.filter(l=>l.role!=='conductor');
    assert.equal(new Set(fresh.map(l=>l.worktreePath)).size,fresh.length);
    assert.ok(fresh.every(l=>!repositories.includes(l.worktreePath)));
    if(cancelledWorker) {
      assert.equal(fs.readFileSync(join(cancelledWorker.worktreePath,'value.txt'),'utf8'),`${runs[0].id}: changed\n`);
      assert.notEqual(git(cancelledWorker.worktreePath,'status','--porcelain'),'');
      assert.ok(snapshots[0].preservations.some(p=>p.launchId===cancelledWorker.id&&p.outcome==='preserved'));
    }
    for(const snapshot of snapshots) {
      const rows=snapshot.runtimeObservations;
      for(const launch of snapshot.launches) {
        const exit=rows.find(r=>r.launchId===launch.id&&r.event.type==='process_exited');
        assert.equal(exit.event.processExited,true);assert.equal(exit.event.gatewayRevocation,'confirmed');
        assert.equal(rows.filter(r=>r.launchId===launch.id&&r.event.type==='process_started').length,1);
        assert.equal(rows.find(r=>r.launchId===launch.id&&r.event.type==='subscription_admission').event.source,'injected-dependencies');
      }
      assert.equal(git(snapshot.run.repository,'rev-parse','main'),snapshot.run.baseSha);
      assert.equal(git(snapshot.run.repository,'status','--porcelain'),'');
      if(snapshot.run.status==='passed') {
        assert.equal(snapshot.artifacts.length,2);assert.equal(snapshot.acknowledgments.length,2);
        assert.deepEqual(snapshot.launches.map(l=>l.role),['conductor','implementer','critic','repairer','critic']);
        assert.equal(git(snapshot.run.repository,'show',`${snapshot.run.currentArtifactSha}:value.txt`),`${snapshot.run.id}: repaired`);
      }
    }
    assert.ok(timeline.every(row=>!row.capacity||row.capacity.dispatches.filter(d=>d.state==='running'||d.state==='quarantined').length<=2));
    assert.ok(snapshots.slice(1).every(snapshot=>needsOperator(snapshot.run)),'both verified candidates still need their own handoff');
    const capacityBeforeHandoff=runner.capacity();
    const handled=backend.recordCandidateHandoff(runs[1].id,snapshots[1].run.version,snapshots[1].run.currentArtifactSha,true,'Fixture operator: set aside for a separate integration review.');
    assert.equal(isClosedRun(handled.run),true);
    assert.equal(needsOperator(backend.status(runs[2].id).run),true,'one disposition cannot close the other project');
    assert.deepEqual(handled.launches,snapshots[1].launches);assert.deepEqual(handled.reports,snapshots[1].reports);
    assert.deepEqual(runner.capacity(),capacityBeforeHandoff,'disposition does not dispatch or release work');
    console.log(JSON.stringify({root,cancelAt,statuses:snapshots.map(s=>s.run.status),nativeLaunches:launches.length,requests:requests.length,realInference:false}));
  } finally {
    clearTimeout(deadline);for(const release of gates.values())release();await runner.close();await server.stop();
    fs.writeFileSync(join(root,'receipt.json'),JSON.stringify({root,cancelAt,mixed,restart,restartEvidence,realInference:false,initialCapacity,afterCancellation,codexResults:[...codexResults],
      finalCapacity:runner.capacity(),snapshots:runs.map(r=>backend.status(r.id)),requests,timeline,dispatchErrors},null,2));
    fs.writeFileSync(join(root,'failed-native-diagnostics.json'),JSON.stringify(handles.filter(item=>item.exit?.status==='failed')
      .map(item=>({runId:item.runId,launchId:item.launchId,exit:item.exit})),null,2),{mode:0o600});
    backend.close();
    // Only discard test-created executable copies; keep all Git/SQLite evidence.
    const profiles=join(root,'profiles');
    if(fs.existsSync(profiles))for(const entry of fs.readdirSync(profiles,{withFileTypes:true})) {
      if(entry.isDirectory()&&/^native-codex-[a-z0-9]+$/i.test(entry.name)) {
        for(const name of ['codex','codex-code-mode-host']) {const file=join(profiles,entry.name,name);if(fs.existsSync(file)&&fs.lstatSync(file).isFile())fs.unlinkSync(file);}
      }
      if(entry.isDirectory()&&/^native-[a-z0-9]+$/i.test(entry.name)) {
        const binary=join(profiles,entry.name,'claude');if(fs.existsSync(binary)&&fs.lstatSync(binary).isFile())fs.unlinkSync(binary);
      }
    }
  }
});
