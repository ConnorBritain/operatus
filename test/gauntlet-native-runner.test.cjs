'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { join } = require('node:path'), { tmpdir } = require('node:os'), { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const { GauntletControlServer } = load('src/main/gauntlet/controlServer.ts');
const { IsolatedGauntletRunner } = load('src/main/gauntlet/isolatedRunner.ts');
const { createIsolatedClaudeFactory } = load('src/main/gauntlet/isolatedClaudeFactory.ts');
const { createIsolatedProviderFactory } = load('src/main/gauntlet/isolatedProviderFactory.ts');
const codexCriticProvider = require('./fixtures/codex-critic-provider.cjs');
const { ClaudeAccountAdmission } = load('src/main/claudeAccountAdmission.ts');
const { openClaudeSubscriptionGateway } = load('src/main/claudeSubscriptionGateway.ts');
const { needsRuntimeReview } = load('src/shared/gauntletRuntime.ts');
const { desktopRunStarter } = load('src/main/gauntlet/desktopStart.ts');
const MODEL = 'claude-fable-5-1';
const mixed = process.env.OPERATUS_NATIVE_MIXED === '1';
function stream(tool, paddingBytes = 0) {
  const events = [{ type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: MODEL,
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: tool.id, name: tool.name, input: {} } : { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } : { type: 'text_delta', text: 'Scripted transport fixture, not real judgment.' } },
  { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
  { type: 'message_stop' }];
  if(tool && paddingBytes) events.splice(4,0,
    {type:'content_block_start',index:1,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:1,delta:{type:'text_delta',text:'v'.repeat(paddingBytes)}},
    {type:'content_block_stop',index:1});
  return Readable.from(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
}

for (const variant of ['normal','revocation','admission-write',...(mixed?['codex-admission-write']:[])]) test(`assembled native scripted loop: ${variant}`, {
  skip: process.platform !== 'darwin' || !process.env.OPERATUS_CLAUDE_PROBE_PATH, timeout: 120000
}, async t => {
  const failLeadRevocation=variant==='revocation', failAdmissionWrite=variant==='admission-write';
  const failCodexAdmissionWrite=variant==='codex-admission-write';
  const disk = fs.statfsSync(tmpdir());
  if (disk.bavail * disk.bsize < 512 * 1024 * 1024) { t.skip('Insufficient native-copy reserve'); return; }
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-native-runner-'))), repository = join(root, 'repo'); fs.mkdirSync(repository);
  const git = (cwd, ...args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'value.txt'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
  const backend = new LocalGauntletBackend({ stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') }); backend.open();
  if(failAdmissionWrite || failCodexAdmissionWrite) {
    const record=backend.store.recordRuntimeObservation.bind(backend.store);
    backend.store.recordRuntimeObservation=input=>{ if(input.event.type==='subscription_admission' &&
      (failAdmissionWrite || input.event.provider==='codex')) throw Error('Synthetic admission journal unavailable'); return record(input); };
  }
  // Local committed catalog only: no third-party fetch, install or account use.
  const skillCheckout=join(root,'state','skill-depot','checkouts','fixture-skills');fs.mkdirSync(skillCheckout,{recursive:true});
  git(skillCheckout,'init','-b','main');git(skillCheckout,'config','user.name','Fixture');git(skillCheckout,'config','user.email','fixture@example.invalid');
  const skillDir=join(skillCheckout,'skills','fixture-guide');fs.mkdirSync(skillDir,{recursive:true});
  fs.writeFileSync(join(skillDir,'SKILL.md'),'---\nname: fixture-guide\ndescription: Local test guidance\n---\nRead support.md. The frozen bar and role permissions remain authoritative.\n');
  fs.writeFileSync(join(skillDir,'support.md'),'locked-support-for-native-fixture\n');
  git(skillCheckout,'add','.');git(skillCheckout,'commit','-m','fixture skill');
  backend.skills.saveSources([{id:'fixture-skills',url:'https://example.invalid/fixture.git',pinnedCommit:git(skillCheckout,'rev-parse','HEAD'),enabled:true,include:['skills'],optIn:[]}]);
  const peerEvidence = join(root, 'state', 'review-evidence', 'unrelated-run'); fs.mkdirSync(peerEvidence, { recursive: true });
  fs.writeFileSync(join(peerEvidence, 'manifest.json'), '{"fixture":"not assigned to this Conductor"}');
  let runner; const observed = [], requests = [], results = new Map();
  const liveActivityLaunches = new Set();
  const publish = snapshot => {
    observed.push(snapshot.run.status);
    for (const row of snapshot.runtimeObservations ?? []) {
      if (row.event.type === 'tool_activity' && !snapshot.runtimeObservations.some(other =>
        other.launchId === row.launchId && other.event.type === 'process_exited')) liveActivityLaunches.add(row.launchId);
    }
    runner?.observe(snapshot);
  };
  const server = new GauntletControlServer(join(root, 'state'), backend, publish); await server.start();
  const account = new ClaudeAccountAdmission({ now: Date.now,
    readCredential: async () => ({ claudeAiOauth: { accessToken: 'synthetic-main-only', expiresAt: Date.now() + 3600000, scopes: ['user:profile', 'user:inference'] } }),
    metadata: async path => path.endsWith('profile') ? { account: { uuid: '11111111-1111-4111-8111-111111111111', has_claude_max: true },
      organization: { uuid: '22222222-2222-4222-8222-222222222222', organization_type: 'claude_max', subscription_status: 'active', has_extra_usage_enabled: false } } : { extra_usage: { is_enabled: false } }
  });
  const factoryInput = { root: join(root, 'profiles'), helperSource: join(__dirname, '../resources/operatus-gauntlet.cjs'),
    skills: backend.skills,
    reviewEvidenceRoot: join(root, 'state', 'review-evidence'),
    nodePath: process.execPath, socketPath: () => server.info().socketPath, assertAdmissionOpen: () => {} };
  const claudeDependencies = {
    account, inspect: async () => ({ executables: [{ path: process.env.OPERATUS_CLAUDE_PROBE_PATH,
      sha256: process.env.OPERATUS_CLAUDE_PROBE_SHA256, versionObservation: { status: 'reported', version: '2.1.263' } }] }),
    gateway: async (input, prepared) => {
      const launch = prepared.launch; let activeLeadTool, activeLeadRead;
      const gateway = await openClaudeSubscriptionGateway({ ...input, transport: async request => {
        assert.equal(request.token, 'synthetic-main-only');
        const body = JSON.parse(request.body.toString()), snapshot = backend.status(launch.runId);
        requests.push({ launchId: launch.id, role: launch.role, sessionId: launch.sessionId });
        if (requests.filter(request => request.provider !== 'codex').length > 40) throw Error('Claude fixture request bound exceeded');
        for (const message of body.messages) for (const item of Array.isArray(message.content) ? message.content : []) {
          if (item.type === 'tool_result') results.set(item.tool_use_id, { error: !!item.is_error, text: JSON.stringify(item.content).slice(0, 2000) });
        }
        const command = (id, action, payload) => ({ id, name: 'Bash', input: { command:
          `"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" ${action} --run ${launch.runId} --launch ${launch.id} --json '${JSON.stringify(payload)}'`, timeout: 10000 } });
        let script;
        if (launch.role === 'conductor') {
          if (snapshot.run.status === 'orienting') activeLeadTool = command('freeze', 'freeze', { objective: snapshot.run.requestedObjective,
            criteria: ['value.txt is repaired'], checks: [], constraints: ['Scripted fixture only'], exclusions: [] });
          else if (snapshot.run.status === 'awaiting_lead_ack') {
            const report = snapshot.reports.at(-1), repair = report.verdict === 'REVISE';
            const critic = snapshot.launches.find(item => item.id === report.launchId);
            activeLeadRead = { id: `lead-read-${report.id}`, name: 'Read', input: { file_path: join(critic.reviewEvidence.directory, 'manifest.json') } };
            activeLeadTool = command(`ack-${report.id}`, 'acknowledge', { reportId: report.id, decision: repair ? 'repair' : 'pass',
              acceptedFindingIds: repair ? ['wrong'] : [], rejectedFindings: [], rationale: 'Scripted decision', repairInstructions: repair ? ['Set value.txt to repaired'] : undefined });
          }
          script = [activeLeadRead, activeLeadRead ? { id: `peer-${activeLeadRead.id}`, name: 'Read',
            input: { file_path: join(peerEvidence, 'manifest.json') } } : undefined, activeLeadTool].filter(Boolean);
        } else if (launch.role === 'critic') {
          const revise = snapshot.run.repairRound === 0;
          script = [{ id: `read-${launch.id}`, name: 'Read', input: { file_path: join(launch.worktreePath, 'value.txt') } },
            { id: `evidence-${launch.id}`, name: 'Read', input: { file_path: join(launch.reviewEvidence.directory, 'manifest.json') } },
            command(`report-${launch.id}`, 'critic', { artifactSha: launch.expectedSha, contractDigest: snapshot.run.contract.digest,
              verdict: revise ? 'REVISE' : 'PASS', summary: 'Scripted review', findings: revise ? [{ id: 'wrong', severity: 'major', title: 'Wrong value', evidence: 'value.txt is changed', criterionIds: ['value'] }] : [] })];
        } else {
          script = [{ id: `write-${launch.id}`, name: 'Write', input: { file_path: join(launch.worktreePath, 'value.txt'), content: launch.role === 'repairer' ? 'repaired\n' : 'changed\n' } },
            { id: `commit-${launch.id}`, name: 'Bash', input: { command: `"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" commit --run ${launch.runId} --launch ${launch.id} --expected-sha ${launch.expectedSha} --bar-digest ${snapshot.run.contract.digest} --message "Native fixture change"`, timeout: 10000 } }];
        }
        const promptText=body.messages.flatMap(message=>typeof message.content==='string'?[message.content]:message.content.map(block=>block.text??'')).join('\n');
        const skillPath=promptText.match(/"([^"\n]+\/skills\/fixture-guide\/SKILL.md)"/)?.[1];
        assert.ok(skillPath,'actual native prompt lacks assigned skill path');
        script=[{id:`skill-read-${launch.id}`,name:'Read',input:{file_path:skillPath}},
          {id:`skill-support-${launch.id}`,name:'Read',input:{file_path:join(skillPath,'..','support.md')}},
          {id:`skill-deny-${launch.id}`,name:'Bash',input:{command:`chmod u+w ${JSON.stringify(skillPath)} && printf tampered > ${JSON.stringify(skillPath)}`}},...script];
        return { status: 200, contentType: 'text/event-stream', body: stream(script.find(tool => !results.has(tool.id)),
          process.env.OPERATUS_NATIVE_OUTPUT_STRESS === '1' && launch.role !== 'conductor' ? 240000 : 0) };
      } });
      return failLeadRevocation && launch.role === 'conductor' ? { ...gateway, close: async () => {
        await gateway.close(); // Actually close the fixture gateway, then simulate lost confirmation.
        throw Error('Synthetic gateway close reporting failure');
      } } : gateway;
    }
  };
  const factory = mixed ? createIsolatedProviderFactory(factoryInput,{claude:claudeDependencies,codex:codexCriticProvider({backend,requests,results})}) :
    createIsolatedClaudeFactory(factoryInput,claudeDependencies);
  const nativeBudgets = [], nativeOutput = [];
  const observedFactory = {supportsLockedSkills:true,supportsCodexCritic:factory.supportsCodexCritic,...Object.fromEntries(['conductor','worker'].map(method => [method, async (...args) => {
    const handle = await factory[method](...args);
    nativeBudgets.push({role:args[0].launch.role,timeoutMs:handle.receipt.timeoutMs,turnTimeoutMs:handle.receipt.turnTimeoutMs});
    void handle.completion.then(exit => nativeOutput.push({role:args[0].launch.role,launchId:args[0].launch.id,
      limits:handle.receipt.outputLimits,...exit.output,returnedStdoutBytes:Buffer.byteLength(exit.stdout ?? ''),returnedStderrBytes:Buffer.byteLength(exit.stderr ?? '')}));
    return handle;
  }]))};
  runner = new IsolatedGauntletRunner(backend, observedFactory, () => null, publish);
  const providers = Object.fromEntries(['conductor', 'implementer', 'critic', 'repairer'].map(role => [role, { provider: 'claude', model: MODEL }]));
  if(mixed) providers.critic={provider:'codex',model:'gpt-5.6-sol'};
  // Exercise the same creation/dispatch handler bound by Electron main, using
  // a synthetic trusted event and the explicitly injected no-inference factory.
  // This is not a real renderer IPC or a lifted production billing hold.
  const fixtureWindow = { mainFrame: {} }, dispatchErrors = [];
  const start = desktopRunStarter({ localWindow: () => fixtureWindow, hold: () => null,
    backend: () => backend, runner: () => runner, publish: snapshot => { publish(snapshot); return snapshot; },
    onDispatchError: error => dispatchErrors.push(String(error)) });
  const run = start({ sender: fixtureWindow, senderFrame: fixtureWindow.mainFrame },
    { repository, objective: 'Repair value.txt in the native assembled fixture', providers,
      limits:{runTimeoutMs:90000,workerTimeoutMs:45000,criticTimeoutMs:30000},
      assignments:['conductor','implementer','critic','repairer'].map(role=>({role,sourceId:'fixture-skills',skillName:'fixture-guide'})) }).run;
  const deadline = setTimeout(() => { void runner.close(); }, 45000);
  try {
    await runner.advance(run.id);
    const snapshot = backend.status(run.id);
    const capacity = runner.capacity();
    if(failCodexAdmissionWrite) {
      fs.writeFileSync(join(root,'receipt.json'),JSON.stringify({root,snapshot,capacity,requests,realInference:false,failCodexAdmissionWrite},null,2));
      // Worker preparation failures are explicit infrastructure failures; the
      // generic factory contract cannot prove whether a rejected start spawned.
      assert.equal(snapshot.run.status,'infrastructure_failure');assert.match(snapshot.run.stopReason,/preparation or shutdown is unconfirmed/);
      assert.equal(snapshot.artifacts.length,1);assert.equal(snapshot.reports.length,0);
      assert.equal(requests.filter(request=>request.provider==='codex').length,0);
      const critics=snapshot.launches.filter(launch=>launch.role==='critic');assert.equal(critics.length,1);
      assert.equal(snapshot.runtimeObservations.filter(row=>row.launchId===critics[0].id).length,0);
      assert.deepEqual(capacity.dispatches.map(d=>d.state),['quarantined']);
      console.log(JSON.stringify({root,runId:run.id,status:snapshot.run.status,codexRequests:0,realInference:false,failCodexAdmissionWrite}));return;
    }
    if(failAdmissionWrite) {
      assert.equal(snapshot.run.status,'human_required'); assert.match(snapshot.run.stopReason,/admission journal unavailable/);
      assert.equal(requests.length,0); assert.equal(nativeBudgets.length,0); assert.equal(nativeOutput.length,0);
      assert.equal(snapshot.launches.length,1); assert.equal(snapshot.runtimeObservations.length,0);
      assert.deepEqual(capacity.dispatches.map(d=>d.state),['quarantined']);
      fs.writeFileSync(join(root,'receipt.json'),JSON.stringify({root,snapshot,capacity,requests,realInference:false,failAdmissionWrite},null,2));
      console.log(JSON.stringify({root,runId:run.id,status:snapshot.run.status,requests:0,realInference:false,failAdmissionWrite:true}));
      return;
    }
    assert.deepEqual(capacity.dispatches.map(d => [d.runId, d.state]), failLeadRevocation ? [[run.id, 'quarantined']] : []);
    const materializations=fs.readdirSync(join(root,'profiles')).filter(name=>name.startsWith('subscription-')).map(name=>{
      const provider=fs.existsSync(join(root,'profiles',name,'home','.codex'))?'.codex':'.claude';
      const directory=join(root,'profiles',name,'home',provider,'skills');
      return{directory,...JSON.parse(fs.readFileSync(join(directory,'operatus-lock.json'),'utf8'))};
    });
    fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify({ root, snapshot, capacity, requests, observed, results: [...results], nativeBudgets, nativeOutput,
      outputStress:process.env.OPERATUS_NATIVE_OUTPUT_STRESS==='1',materializations, liveActivityLaunches: [...liveActivityLaunches], realInference: false, failLeadRevocation }, null, 2));
    assert.equal(snapshot.run.status, 'passed', JSON.stringify({ root, reason: snapshot.run.stopReason, requests, results: [...results] }));
    assert.deepEqual(dispatchErrors,[]);
    assert.equal(snapshot.artifacts.length, 2); assert.equal(snapshot.acknowledgments.length, 2);
    assert.equal(nativeBudgets.length,5);
    assert.equal(nativeOutput.length,5);
    if(process.env.OPERATUS_NATIVE_OUTPUT_STRESS==='1') for(const output of nativeOutput.filter(o=>o.role!=='conductor')) {
      assert.ok(output.stdoutBytes>1024*1024,JSON.stringify(output));
      assert.equal(output.stdoutPreviewTruncated,true);
      assert.ok(output.returnedStdoutBytes<65536,JSON.stringify(output));
      assert.equal(output.limits.sessionBytes,64*1024*1024);
    }
    for(const budget of nativeBudgets) {
      const limit=budget.role==='conductor'?90000:budget.role==='critic'?30000:45000;
      assert.ok(budget.timeoutMs>=10 && budget.timeoutMs<=limit);
    }
    assert.ok(nativeBudgets[0].turnTimeoutMs<=45000);
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'process_started').length, 5);
    const admissions=snapshot.runtimeObservations.filter(r=>r.event.type==='subscription_admission');
    assert.equal(admissions.length,5);
    for(const row of admissions) {
      const started=snapshot.runtimeObservations.find(r=>r.launchId===row.launchId&&r.event.type==='process_started');
      assert.ok(row.sequence<started.sequence);
      assert.equal(row.event.model,row.event.provider==='codex'?'gpt-5.6-sol':MODEL);
      assert.equal(row.event.executableSha256,row.event.provider==='codex'?process.env.OPERATUS_CODEX_PROBE_SHA256:process.env.OPERATUS_CLAUDE_PROBE_SHA256);
      if(row.event.provider==='claude')assert.equal(row.event.extraUsage,'disabled');
      else {assert.equal(row.event.credits,'none-observed');assert.equal(row.event.topUps,'not-programmatically-verified');}
      assert.equal(row.event.launchAllowed,false);
      assert.equal(row.event.source,'injected-dependencies');
      assert.equal(Object.hasOwn(row.event,'credentialHash'),false);
      assert.ok(row.at>=row.event.checkedAt&&row.at<row.event.validUntil);
    }
    assert.equal(JSON.stringify(admissions).includes('synthetic-main-only'),false);
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'process_exited').length, 5);
    for(const recorded of snapshot.runtimeObservations.filter(r=>r.event.type==='process_exited')) {
      const measured=nativeOutput.find(output=>output.launchId===recorded.launchId);
      assert.ok(measured);
      for(const key of ['receivedBytes','stdoutBytes','stderrBytes','stdoutPreviewTruncated','stderrPreviewTruncated']) {
        assert.equal(recorded.event.output[key],measured[key],key);
      }
      assert.deepEqual(Object.keys(recorded.event.output).sort(),['receivedBytes','stdoutBytes','stderrBytes','stdoutPreviewTruncated','stderrPreviewTruncated'].sort());
    }
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'delivery_queued').length, 3);
    assert.equal(snapshot.runtimeObservations.filter(r => r.event.type === 'delivery_completed' && r.event.ok).length, 3);
    assert.ok(snapshot.runtimeObservations.every(r => r.sessionId === snapshot.launches.find(l => l.id === r.launchId).sessionId));
    const activities=snapshot.runtimeObservations.filter(r=>r.event.type==='tool_activity');
    assert.ok(activities.length>0);
    for(const launch of snapshot.launches) {
      assert.ok(liveActivityLaunches.has(launch.id), launch.role+' activity was not published before process exit');
      const own=activities.filter(r=>r.launchId===launch.id);
      assert.ok(own.some(r=>r.event.stage==='requested'),launch.role+' missing native tool request');
      assert.ok(own.some(r=>r.event.stage==='result'),launch.role+' missing native tool result');
      assert.deepEqual(own.map(r=>r.event.ordinal),own.map((_,index)=>index+1));
    }
    assert.ok(activities.some(r=>r.event.activity==='editing'));
    assert.ok(activities.some(r=>r.event.activity==='reading'));
    assert.equal(needsRuntimeReview(snapshot.run), failLeadRevocation);
    if (failLeadRevocation) {
      assert.equal(snapshot.run.runtimeAttention.count, 1);
      assert.ok(backend.store.listOperatorRuns().some(r => r.id === run.id && needsRuntimeReview(r)));
      const reviewed = backend.reviewAttention(run.id, snapshot.run.version, true, 'Fixture inspection of lost close confirmation.', snapshot.run.runtimeAttention.sequence);
      assert.equal(reviewed.run.status, 'passed'); assert.equal(needsRuntimeReview(reviewed.run), false);
      assert.deepEqual(reviewed.artifacts, snapshot.artifacts); assert.deepEqual(reviewed.acknowledgments, snapshot.acknowledgments);
      // Restore attention for visual inspection; retain both human review events.
      backend.reviewAttention(run.id, reviewed.run.version, false, 'Reopened for scripted desktop smoke.', snapshot.run.runtimeAttention.sequence);
    }
    assert.deepEqual(snapshot.launches.map(l => l.role), ['conductor', 'implementer', 'critic', 'repairer', 'critic']);
    assert.equal(new Set(snapshot.launches.map(l => l.sessionId)).size, 5);
    if(mixed) {
      const identities=snapshot.runtimeObservations.filter(row=>row.event.type==='native_identity');
      assert.equal(identities.length,4);
      assert.equal(new Set(identities.map(row=>row.event.threadId)).size,2);
      assert.equal(new Set(identities.filter(row=>row.event.turnId).map(row=>row.event.turnId)).size,2);
      assert.equal(snapshot.launches.filter(launch=>launch.role==='critic'&&launch.provider==='codex').length,2);
    }
    for (const [id, result] of results) assert.equal(result.error, id.startsWith('peer-')||id.startsWith('skill-deny-'), id);
    assert.equal([...results.keys()].filter(id=>id.startsWith('skill-read-')).length,5);
    assert.equal([...results.entries()].filter(([id,result])=>id.startsWith('skill-support-')&&result.text.includes('locked-support-for-native-fixture')).length,5);
    assert.equal(snapshot.skillLock.entries.length,4);
    for(const [id,result] of results) if(id.startsWith('skill-deny-')) assert.match(result.text,/Operation not permitted|Permission denied|requested permissions to edit.*sensitive file/);
    assert.equal(materializations.length,5);
    assert.equal(new Set(materializations.map(m=>m.launchId)).size,5);
    for(const receipt of materializations){
      assert.equal(receipt.runId,run.id);assert.ok(snapshot.launches.some(l=>l.id===receipt.launchId&&l.role===receipt.role));
      assert.deepEqual(receipt.entries,snapshot.skillLock.entries.filter(e=>e.role===receipt.role));
      for(const file of ['SKILL.md','support.md']) assert.equal(fs.readFileSync(join(receipt.directory,'fixture-guide',file),'utf8'),fs.readFileSync(join(skillDir,file),'utf8'));
    }
    assert.equal([...results.keys()].filter(id => id.startsWith('lead-read-')).length, 2);
    assert.equal(git(repository, 'rev-parse', 'main'), run.baseSha);
    assert.equal(fs.readFileSync(join(repository, 'value.txt'), 'utf8'), 'base');
    console.log(JSON.stringify({ root, runId: run.id, status: snapshot.run.status, roles: snapshot.launches.map(l => l.role), requests: requests.length, realInference: false }));
  } finally {
    clearTimeout(deadline); await runner.close(); await server.stop(); backend.close();
    // Discard only this test's newly copied executable, retaining SQLite/Git,
    // packets and receipts. Repeated native smoke must not consume 200 MB/run.
    const profiles = join(root, 'profiles');
    if (fs.existsSync(profiles)) for (const entry of fs.readdirSync(profiles, { withFileTypes: true })) {
      if(entry.isDirectory() && /^native-codex-[a-z0-9]+$/i.test(entry.name)) {
        for(const name of ['codex','codex-code-mode-host']) {const file=join(profiles,entry.name,name);if(fs.existsSync(file)&&fs.lstatSync(file).isFile())fs.unlinkSync(file);}
      }
      if (entry.isDirectory() && /^native-[a-z0-9]+$/i.test(entry.name)) {
        const binary = join(profiles, entry.name, 'claude');
        if (fs.existsSync(binary) && fs.lstatSync(binary).isFile()) fs.unlinkSync(binary);
      }
    }
  }
});
