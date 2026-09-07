'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), net = require('node:net');
const { join } = require('node:path'), { tmpdir } = require('node:os'), { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const load = require('./load-ts.cjs');
const { prepareSubscriptionProfile } = load('src/main/subscriptionProfile.ts');
const { CodexFreshSessionRuntime } = load('src/main/codexFreshSession.ts');
const mac = { skip: process.platform !== 'darwin', timeout: 15000 };

function leadProtocol(mode) {
  const lines = require('node:readline').createInterface({ input: process.stdin });
  const emit = message => process.stdout.write(JSON.stringify(message) + '\n');
  const threadId = 'lead-thread'; let n = 0;
  lines.on('line', line => {
    const req = JSON.parse(line);
    if (req.method === 'initialize') emit({ id: req.id, result: {} });
    if (req.method === 'thread/start') emit({ id: req.id, result: { thread: { id: threadId }, model: req.params.model,
      modelProvider: 'openai', cwd: req.params.cwd, approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false } } });
    if (req.method !== 'turn/start') return;
    const turnId = `turn-${++n}`;
    if (req.params.threadId !== threadId) process.exit(20);
    emit({ id: req.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    if (mode === 'hang') return;
    const foreign = mode === 'foreign-second' && n === 2;
    const item = { id: `answer-${n}`, type: 'agentMessage', phase: 'final_answer', text: `turn ${n}` };
    const params = { threadId: foreign ? 'wrong' : threadId, turnId, item };
    emit({ method: 'item/started', params }); emit({ method: 'item/completed', params });
    const complete = { method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } };
    emit(complete);
    if (mode === 'duplicate-terminal') emit(complete);
  });
}

test('Codex Conductor keeps one process/thread through multiple turns and closes only on finish', mac, async t => {
  const f = await fixture(t, 'conductor'), requests = [];
  const runtime = new CodexFreshSessionRuntime((command, args, options) => {
    assert.equal(command, '/usr/bin/sandbox-exec');
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    const child = spawn(process.execPath, ['-e', `(${leadProtocol.toString()})('success')`], options);
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (...args) => { requests.push(JSON.parse(args[0])); return write(...args); };
    return child;
  });
  const handle = runtime.startConductor({ ...f.input, maxMessages: 2, turnTimeoutMs: 1000 }); t.after(() => handle.stop());
  assert.throws(() => handle.finish(), /before its turn/);
  const id = randomUUID(), first = handle.send(id, 'freeze the contract');
  assert.throws(() => handle.send(randomUUID(), 'overlap'), /in-flight/);
  assert.equal((await first).text, 'turn 1'); assert.equal(f.closes(), 0);
  assert.throws(() => handle.send(id, 'duplicate'), /duplicate/);
  assert.equal((await handle.send(randomUUID(), 'acknowledge report')).text, 'turn 2');
  assert.equal(f.closes(), 0);
  assert.throws(() => handle.send(randomUUID(), 'exceeds budget'), /duplicate/);
  handle.finish(); const exit = await handle.completion;
  assert.equal(exit.reason, 'finished'); assert.equal(exit.turnsCompleted, 2);
  assert.equal(exit.processExited, true); assert.equal(exit.gatewayRevocation, 'confirmed'); assert.equal(f.closes(), 1);
  assert.equal(requests.filter(r => r.method === 'thread/start').length, 1);
  assert.ok(requests.filter(r => r.method === 'turn/start').every(r => r.params.threadId === 'lead-thread'));
  assert.deepEqual(f.identities.map(i => i.turnId), [null, 'turn-1', 'turn-2']);
  assert.throws(() => handle.send(randomUUID(), 'after close'), /closed/);
});

test('Codex Conductor rejects foreign later turns, duplicate completion and bounded timeouts', mac, async t => {
  for (const mode of ['foreign-second', 'duplicate-terminal', 'hang']) {
    const f = await fixture(t, 'conductor');
    const runtime = new CodexFreshSessionRuntime((_command, _args, options) =>
      spawn(process.execPath, ['-e', `(${leadProtocol.toString()})(${JSON.stringify(mode)})`], options));
    const handle = runtime.startConductor({ ...f.input, maxMessages: 3, turnTimeoutMs: 150 }); t.after(() => handle.stop());
    const first = await handle.send(randomUUID(), 'first');
    if (mode === 'foreign-second') { assert.ok(first.ok); assert.equal((await handle.send(randomUUID(), 'second')).ok, false); }
    const exit = await handle.completion;
    assert.equal(exit.reason, mode === 'hang' ? 'timeout' : 'invalid_stream');
    assert.equal(exit.processExited, true); assert.equal(exit.gatewayRevocation, 'confirmed');
  }
});

test('Codex Conductor cannot reuse a Critic profile or launch through the fresh Critic entrypoint', mac, async t => {
  const f = await fixture(t); const runtime = new CodexFreshSessionRuntime(() => { throw Error('must not spawn'); });
  assert.throws(() => runtime.startConductor({ ...f.input, role: 'conductor', maxMessages: 2, turnTimeoutMs: 100 }), /mismatched isolated/);
  assert.throws(() => runtime.start({ ...f.input, role: 'conductor' }), /invalid fresh/);
});
let fixturePort = 18000;
async function fixture(t, role = 'critic') {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-codex-session-')));
  const artifact = join(root, 'artifact'), evidence = join(root, 'evidence'), native = join(root, 'native');
  for (const path of [artifact, evidence, native]) fs.mkdirSync(path);
  const executable = join(native, 'codex'), codeModeHost = join(native, 'codex-code-mode-host');
  for (const path of [executable, codeModeHost]) fs.writeFileSync(path, 'inert identity fixture', { mode: 0o500 });
  const profile = await prepareSubscriptionProfile(root, 'codex', role);
  const server = net.createServer(socket => socket.destroy()), socketPath = join(root, 'control.sock');
  await new Promise(resolve => server.listen(socketPath, resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const helperPath = join(root, 'helper.cjs'), credentialPath = join(root, 'capability.json');
  fs.writeFileSync(helperPath, '// inert'); fs.writeFileSync(credentialPath, '{}');
  let closes = 0; const identities = [], activity = [], port = fixturePort++;
  return { input: { launchId: randomUUID(), sessionId: randomUUID(), role, model: role === 'conductor' ? 'gpt-6-astra' : 'gpt-5.6-sol', prompt: 'private fixture task',
    artifact, profile, executable, codeModeHost, reviewEvidenceDirectory: evidence, timeoutMs: 4000,
    controlClient: { socketPath, nodePath: fs.realpathSync(process.execPath), helperPath, credentialPath },
    gateway: { port, url: `http://127.0.0.1:${port}`, close: async () => { closes++; } },
    onIdentity: value => identities.push(value), onActivity: value => activity.push(value) }, identities, activity, closes: () => closes };
}

// Real child/pipe lifecycle, injected protocol only. Native Codex is separately
// exercised by the opt-in native tool fixture; these inert binaries never run.
function protocol({ mode, threadId, turnId }) {
  const readline = require('node:readline').createInterface({ input: process.stdin });
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const event = (method, extra) => send({ method, params: { threadId, turnId, ...extra } });
  readline.on('line', line => {
    const request = JSON.parse(line);
    if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); return; }
    if (request.id === 1) { send({ id: 1, result: { userAgent: 'fixture' } }); return; }
    if (request.id === 2) { send({ id: 2, result: { thread: { id: threadId }, model: mode === 'wrong-model' ? 'gpt-other' : request.params.model,
      modelProvider: mode === 'wrong-provider' ? 'other' : 'openai', cwd: mode === 'wrong-cwd' ? '/' : request.params.cwd,
      approvalPolicy: mode === 'wrong-approval' ? 'on-request' : 'never',
      sandbox: { type: mode === 'wrong-sandbox' ? 'dangerFullAccess' : 'readOnly', networkAccess: false },
      serviceTier: mode === 'priority-tier' ? 'priority' : null } }); return; }
    if (request.id !== 3) return;
    if (mode === 'malformed') { process.stdout.write('not-json\n'); return; }
    if (mode === 'overflow') { process.stdout.write('x'.repeat(1100000)); return; }
    if (mode === 'permission') { send({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId, turnId } }); return; }
    const reply = () => send({ id: 3, result: { turn: { id: turnId, status: 'inProgress' } } });
    const early = mode.startsWith('early-');
    if (early) {
      event('turn/started', { turn: { id: mode === 'early-foreign' ? 'foreign' : turnId, status: 'inProgress' } });
      if (mode === 'early-flood') for (let i = 0; i < 65; i++) event('turn/plan/updated', {});
      if (mode === 'early-large') event('turn/plan/updated', { explanation: 'x'.repeat(256 * 1024) });
      if (mode === 'early-no-reply') return;
    } else reply();
    if (mode === 'rerouted') event('model/rerouted', { fromModel: 'gpt-5.6-sol', toModel: 'gpt-other' });
    event('turn/plan/updated', { explanation: 'private plan' });
    const item = { id: 'command_fixture', type: 'commandExecution', command: 'private command', status: 'inProgress' };
    event('item/started', { item, ...(mode === 'wrong-thread' ? { threadId: 'foreign' } : {}) });
    if (mode !== 'unfinished-item') event('item/completed', { item: { ...item, status: 'completed', exitCode: 0, aggregatedOutput: 'private result' } });
    const final = { id: 'message_fixture', type: 'agentMessage', phase: mode === 'commentary' ? 'commentary' : 'final_answer', text: '{"verdict":"pass"}' };
    event('item/started', { item: final }); event('item/completed', { item: final });
    if (mode === 'duplicate-item') event('item/completed', { item: final });
    if (mode === 'no-terminal') { process.exit(0); return; }
    const terminal = { method: 'turn/completed', params: { threadId, turn: { id: mode === 'wrong-turn' ? 'foreign' : turnId,
      status: mode === 'provider-error' ? 'failed' : 'completed', error: null } } };
    send(terminal);
    if (early) setTimeout(reply, 30);
    if (mode === 'duplicate-terminal') send(terminal);
    if (mode === 'trailing-item') event('item/started', { item: { ...item, id: 'after-terminal' } });
    if (mode === 'nonzero') process.exitCode = 7;
  });
}
function spawner(mode = 'success', inspect = () => {}, threadId = randomUUID()) {
  const sent = [], turnId = randomUUID();
  const start = (command, args, options) => {
    inspect(command, args, options);
    const child = spawn(process.execPath, ['-e', `(${protocol.toString()})(${JSON.stringify({ mode, threadId, turnId })})`], options);
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (...args) => { sent.push(JSON.parse(args[0])); return write(...args); };
    return child;
  };
  return { start, sent, threadId, turnId };
}

test('fresh Codex binds native identity, emits redacted activity and validates a successful turn', mac, async t => {
  const f = await fixture(t), child = spawner();
  const runtime = new CodexFreshSessionRuntime(child.start), handle = runtime.start(f.input); t.after(() => handle.stop());
  const exit = await handle.completion;
  assert.equal(exit.status, 'completed'); assert.equal(exit.reason, 'result'); assert.equal(exit.processExited, true);
  assert.equal(exit.sessionId, f.input.sessionId); assert.equal(exit.threadId, child.threadId); assert.equal(exit.turnId, child.turnId);
  assert.deepEqual(f.identities, [{ threadId: child.threadId, turnId: null }, { threadId: child.threadId, turnId: child.turnId }]);
  assert.deepEqual(f.activity, [{ type: 'tool_activity', ordinal: 1, activity: 'executing', stage: 'requested' },
    { type: 'tool_activity', ordinal: 2, activity: 'executing', stage: 'result', outcome: 'ok' }]);
  assert.doesNotMatch(JSON.stringify(f.activity), /private|command_fixture/);
  assert.equal(exit.stdout, '{"verdict":"pass"}'); assert.equal(exit.gatewayRevocation, 'confirmed'); assert.equal(f.closes(), 1);
  assert.equal(exit.descendantsQuiescent, false); assert.equal(handle.receipt.launchAllowed, false);
  assert.throws(() => runtime.start(f.input), /already claimed/);
});

test('early native turn events wait for the returned identity and durable recording', mac, async t => {
  const f = await fixture(t), child = spawner('early-success');
  const activity = f.input.onActivity;
  f.input.onActivity = value => { assert.equal(f.identities.length, 2); activity(value); };
  const handle = new CodexFreshSessionRuntime(child.start).start(f.input); t.after(() => handle.stop());
  const exit = await handle.completion;
  assert.equal(exit.status, 'completed'); assert.equal(exit.turnId, child.turnId);
  assert.equal(f.identities.length, 2); assert.equal(f.activity.length, 2);
});

test('early events cannot bypass identity checks, buffer bounds, timeout or journal failure', mac, async t => {
  for (const mode of ['early-foreign', 'early-flood', 'early-large', 'early-no-reply', 'early-journal-failure']) {
    const f = await fixture(t), child = spawner(mode);
    if (mode === 'early-no-reply') f.input.timeoutMs = 150;
    if (mode === 'early-journal-failure') f.input.onIdentity = value => { if (value.turnId) throw Error('journal failed'); };
    const handle = new CodexFreshSessionRuntime(child.start).start(f.input); t.after(() => handle.stop());
    const exit = await handle.completion;
    assert.equal(exit.reason, mode === 'early-no-reply' ? 'timeout' : 'invalid_result', mode);
    assert.equal(f.activity.length, 0, mode); assert.equal(exit.gatewayRevocation, 'confirmed', mode);
  }
});

test('only app-owned configuration is launched and asynchronous inputs are snapshotted', mac, async t => {
  const f = await fixture(t); f.input.profile.env.OPENAI_API_KEY = 'forbidden'; f.input.profile.args.push('--resume', 'forbidden');
  const child = spawner('success', (command, args, options) => {
    assert.equal(command, '/usr/bin/sandbox-exec'); assert.equal(options.detached, true);
    assert.equal(options.env.CODEX_HOME, f.input.profile.providerHome); assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.env.HTTPS_PROXY, undefined); assert.equal(args.includes('--resume'), false);
    assert.equal(args.includes(f.input.prompt), false); assert.ok(args.includes('--strict-config'));
  });
  const handle = new CodexFreshSessionRuntime(child.start).start(f.input); t.after(() => handle.stop());
  f.input.model = 'gpt-other'; f.input.prompt = 'changed'; f.input.onIdentity = () => { throw Error('replaced callback'); };
  assert.equal((await handle.completion).status, 'completed');
  const start = child.sent.find(m => m.method === 'thread/start'), turn = child.sent.find(m => m.method === 'turn/start');
  assert.equal(start.params.model, 'gpt-5.6-sol'); assert.equal(start.params.allowProviderModelFallback, false);
  assert.equal(start.params.ephemeral, true); assert.equal(start.params.approvalPolicy, 'never');
  assert.deepEqual(turn.params.sandboxPolicy, { type: 'externalSandbox', networkAccess: 'restricted' });
  assert.equal(turn.params.input[0].text, 'private fixture task');
});

test('wrong identity, incomplete output, duplicate/trailing evidence and failed terminal state cannot pass', mac, async t => {
  for (const mode of ['wrong-thread', 'wrong-turn', 'unfinished-item', 'commentary', 'duplicate-item', 'no-terminal',
    'duplicate-terminal', 'trailing-item', 'provider-error', 'nonzero', 'malformed', 'permission', 'wrong-model', 'rerouted',
    'wrong-provider', 'wrong-cwd', 'wrong-approval', 'wrong-sandbox', 'priority-tier']) {
    const f = await fixture(t), child = spawner(mode), handle = new CodexFreshSessionRuntime(child.start).start(f.input);
    t.after(() => handle.stop()); const exit = await handle.completion;
    assert.equal(exit.status, 'failed', mode); assert.equal(exit.gatewayRevocation, 'confirmed', mode); assert.equal(f.closes(), 1, mode);
  }
});

test('identity recording failure stops before further authority is sent and native threads cannot be reused', mac, async t => {
  const f = await fixture(t), child = spawner(); f.input.onIdentity = () => { throw Error('private persistence error'); };
  const handle = new CodexFreshSessionRuntime(child.start).start(f.input); t.after(() => handle.stop());
  assert.equal((await handle.completion).status, 'failed'); assert.equal(child.sent.some(m => m.method === 'turn/start'), false);
  const first = await fixture(t), second = await fixture(t), fixed = spawner(), runtime = new CodexFreshSessionRuntime(fixed.start);
  assert.equal((await runtime.start(first.input).completion).status, 'completed');
  const repeated = await runtime.start(second.input).completion; assert.equal(repeated.status, 'failed'); assert.equal(repeated.reason, 'invalid_result');
});

test('cancellation, timeout, output overflow and spawn failure revoke exactly once', mac, async t => {
  for (const mode of ['cancelled', 'timeout', 'overflow', 'spawn']) {
    const f = await fixture(t); if (mode === 'timeout') f.input.timeoutMs = 100;
    const runtime = new CodexFreshSessionRuntime(mode === 'spawn' ? () => { throw Error('private spawn error'); } : spawner(mode === 'overflow' ? 'overflow' : 'hang').start);
    const handle = runtime.start(f.input); t.after(() => handle.stop());
    if (mode === 'cancelled') { handle.stop(); assert.equal(f.closes(), 1); }
    const exit = await handle.completion; assert.equal(exit.reason, mode === 'overflow' ? 'output_limit' : mode === 'spawn' ? 'spawn_error' : mode);
    assert.equal(exit.gatewayRevocation, 'confirmed'); assert.equal(f.closes(), 1); assert.throws(() => runtime.start(f.input), /already claimed/);
  }
});

test('gateway revocation failure overrides a valid native result', mac, async t => {
  const f = await fixture(t); f.input.gateway.close = async () => { throw Error('private close failure'); };
  const handle = new CodexFreshSessionRuntime(spawner().start).start(f.input); t.after(() => handle.stop());
  const exit = await handle.completion; assert.equal(exit.status, 'failed'); assert.equal(exit.reason, 'gateway_revocation_failed');
  assert.equal(exit.gatewayRevocation, 'unconfirmed'); assert.doesNotMatch(JSON.stringify(exit), /private close failure/);
});

test('invalid role, profile, evidence or callback is rejected before spawn', mac, async t => {
  const f = await fixture(t); let spawned = false;
  const runtime = new CodexFreshSessionRuntime(() => { spawned = true; throw Error('must not spawn'); });
  for (const changed of [{ role: 'conductor' }, { role: 'implementer' }, { onIdentity: undefined }, { reviewEvidenceDirectory: undefined },
    { sessionId: 'bad' }, { timeoutMs: 0 }, { prompt: '' }, { gateway: { port: 1, url: 'https://elsewhere.invalid', close: async () => {} } }]) {
    assert.throws(() => runtime.start({ ...f.input, ...changed }), /invalid fresh|mismatched isolated/);
  }
  fs.chmodSync(f.input.profile.configPath, 0o600); fs.appendFileSync(f.input.profile.configPath, ' ');
  assert.throws(() => runtime.start(f.input), /mismatched isolated/); assert.equal(spawned, false);
});

test('an asynchronous identity writer cannot be mistaken for a durable synchronous acknowledgment', mac, async t => {
  const f = await fixture(t), child = spawner(); f.input.onIdentity = async () => { throw Error('private write failure'); };
  const handle = new CodexFreshSessionRuntime(child.start).start(f.input); t.after(() => handle.stop());
  assert.equal((await handle.completion).reason, 'invalid_result');
  assert.equal(child.sent.some(message => message.method === 'turn/start'), false);
});

test('copied gateway descriptors cannot be shared by concurrent fresh launches', mac, async t => {
  const first = await fixture(t), second = await fixture(t); second.input.gateway = { ...first.input.gateway };
  let starts = 0; const runtime = new CodexFreshSessionRuntime((...args) => spawner(++starts === 1 ? 'hang' : 'success').start(...args));
  const handle = runtime.start(first.input); t.after(() => handle.stop());
  assert.throws(() => runtime.start(second.input), /already claimed/); assert.equal(starts, 1);
  handle.stop(); assert.equal((await handle.completion).gatewayRevocation, 'confirmed');
  second.input.gateway = { ...second.input.gateway, close: async () => {} };
  assert.equal((await runtime.start(second.input).completion).status, 'completed');
});

test('a missing process-close event and stuck gateway both produce bounded unconfirmed outcomes', mac, async t => {
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  const f = await fixture(t), child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const handle = new CodexFreshSessionRuntime(() => child).start(f.input); handle.stop();
  const result = await handle.completion;
  assert.equal(result.status, 'cancelled'); assert.equal(result.processExited, false); assert.equal(result.descendantsQuiescent, false);
  const next = await fixture(t); let release; next.input.gateway.close = () => new Promise(resolve => release = resolve);
  const second = new CodexFreshSessionRuntime(spawner().start).start(next.input); t.after(() => second.stop());
  const uncertain = await second.completion; assert.equal(uncertain.reason, 'gateway_revocation_failed'); assert.equal(uncertain.gatewayRevocation, 'unconfirmed');
  release(); assert.equal(uncertain.gatewayRevocation, 'unconfirmed');
});
