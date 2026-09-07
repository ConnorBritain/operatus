'use strict';
// Real native Codex and Seatbelt; every model response and account is synthetic.
// No real credentials, external forwarding, production launch or billing claim.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), https = require('node:https'), net = require('node:net');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path'), { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { zstdDecompressSync } = require('node:zlib');
const { Server: WebSocketServer } = require('ws');
const load = require('./load-ts.cjs');
const { prepareSubscriptionProfile } = load('src/main/subscriptionProfile.ts');
const { prepareSubscriptionSandbox } = load('src/main/subscriptionSandbox.ts');
const { copyPinnedNativeExecutable } = load('src/main/executableIdentity.ts');
const { CodexAccountAdmission } = load('src/main/codexAccountAdmission.ts');
const { openCodexSubscriptionGateway } = load('src/main/codexSubscriptionGateway.ts');
const { codexSubscriptionTransport } = load('src/main/codexSubscriptionTransport.ts');
const { CodexFreshSessionRuntime } = load('src/main/codexFreshSession.ts');
const { GauntletStore } = load('src/main/gauntlet/store.ts');
const codexJournal = require('./fixtures/codex-journal.cjs');
const MODEL = 'gpt-5.6-sol';

const sessions = new Set();
for (const transport of ['websocket', 'http-fallback', 'gateway', 'gateway-http', 'gateway-fixed', 'gateway-fixed-http', 'gateway-session', 'gateway-session-http', 'gateway-session-cancel']) test(`native Codex read-only tools over ${transport}`, {
  skip: process.platform !== 'darwin' || !process.env.OPERATUS_CODEX_PROBE_PATH, timeout: 90000
}, async t => {
  const source = process.env.OPERATUS_CODEX_PROBE_PATH, digest = process.env.OPERATUS_CODEX_PROBE_SHA256;
  const hostSource = process.env.OPERATUS_CODEX_HOST_PROBE_PATH, hostDigest = process.env.OPERATUS_CODEX_HOST_PROBE_SHA256;
  assert.match(digest ?? '', /^[a-f0-9]{64}$/);
  assert.ok(hostSource, 'explicit Code Mode host path required'); assert.match(hostDigest ?? '', /^[a-f0-9]{64}$/);
  const disk = fs.statfsSync(tmpdir());
  if (disk.bavail * disk.bsize < fs.statSync(source).size + fs.statSync(hostSource).size + 256 * 1024 * 1024) { t.skip('Native-copy reserve unavailable'); return; }
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-codex-tools-')));
  const binary = join(root, 'codex'), artifact = join(root, 'artifact');
  const codeModeHost = join(root, 'codex-code-mode-host');
  fs.mkdirSync(artifact); fs.writeFileSync(join(artifact, 'evidence.txt'), 'synthetic exact evidence\n');
  const secretPath = join(root, 'ambient-secret'); fs.writeFileSync(secretPath, 'synthetic-secret-must-not-leak');
  const account = 'synthetic-native-critic';
  const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth': { chatgpt_account_id: account, chatgpt_plan_type: 'pro' },
    'https://api.openai.com/profile': { email: 'fixture@example.invalid' } })).toString('base64url')}.c3ludGhldGlj`;
  const finalText = JSON.stringify({ verdict: 'pass', source: 'scripted-offline-fixture' });
  const requests = [], frames = [], messages = [], upstreamRoutes = [];
  const useSession = transport.includes('session'), fixed = transport.includes('fixed') || useSession, originalHttpsRequest = https.request;
  const cancelSession = transport === 'gateway-session-cancel';
  let cancellationProbe, toolPid;
  const identityReceipts = [], activityReceipts = [];
  const reviewEvidenceDirectory = join(root, 'review-evidence');
  if (useSession) { fs.mkdirSync(reviewEvidenceDirectory); fs.writeFileSync(join(reviewEvidenceDirectory, 'bar.txt'), 'synthetic exact review bar\n'); }
  const providerRoute = '/backend-api/codex/responses';
  const toolResults = new Map();
  const script = [{ id: 'read-evidence', input: `text(await tools.exec_command(${JSON.stringify({ cmd: '/bin/cat evidence.txt' + (useSession ? ` '${reviewEvidenceDirectory}/bar.txt'` : ''), shell: '/bin/sh', login: false, yield_time_ms: 1000 })}));` },
    { id: 'deny-write', input: `text(await tools.exec_command(${JSON.stringify({ cmd: '/usr/bin/touch forbidden.txt', shell: '/bin/sh', login: false, yield_time_ms: 1000 })}));` },
    { id: 'deny-secret', input: `text(await tools.exec_command(${JSON.stringify({ cmd: `/bin/cat '${secretPath}'`, shell: '/bin/sh', login: false, yield_time_ms: 1000 })}));` }];
  let fixtureError, child, timer, callCount = 0, gateway, accountChecks = 0, credentialChecks = 0, controlServer, sessionHandle, sessionExit, journal;
  const authorized = req => {
    const provider = req.url === providerRoute;
    return req.headers.authorization === `Bearer ${provider ? token : gateway?.localToken ?? token}` &&
      req.headers['chatgpt-account-id'] === (provider ? account : gateway?.localAccountId ?? account) && !req.headers['x-api-key'];
  };
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, authorized: authorized(req), encoding: req.headers['content-encoding'] });
    if (req.method === 'POST' && ['/codex/responses', providerRoute].includes(req.url) && authorized(req)) {
      if (transport.endsWith('-http') && req.url !== providerRoute) {
        // Test-only front listener rejects upgrades and forwards the native
        // HTTP fallback to the real main-owned gateway. No external transport.
        const upstream = http.request(gateway.url + '/codex/responses', { method: 'POST',
          headers: { ...req.headers, host: `127.0.0.1:${gateway.port}` } }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on('error', error => { fixtureError = String(error); res.destroy(); });
        req.pipe(upstream); return;
      }
      let bytes = 0; const chunks = [];
      req.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) req.destroy(); else chunks.push(chunk); });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks);
          assert.ok([undefined, 'zstd'].includes(req.headers['content-encoding']));
          const data = req.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(raw, { maxOutputLength: 4 * 1024 * 1024 }) : raw;
          const events = respond(JSON.parse(data.toString()));
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          res.end();
        } catch (error) { fixtureError = String(error); res.writeHead(400); res.end(); }
      });
      return;
    }
    // Catalog/settings are deliberately unavailable; this does not establish
    // account-specific model availability or permit any external fallback.
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); req.resume();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    requests.push({ method: 'WS', path: req.url, authorized: authorized(req) });
    if (!['/codex/responses', providerRoute].includes(req.url) || !authorized(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return; }
    if (req.url !== providerRoute && (transport === 'http-fallback' || transport.endsWith('-http'))) { socket.end('HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  function respond(body) {
        frames.push(body);
        assert.ok(++callCount <= 12, 'bounded fixture requests');
        assert.equal(body.model, MODEL);
        for (const input of body.input ?? []) if (input.type === 'custom_tool_call_output') toolResults.set(input.call_id, input.output);
        const next = body.generate === false ? null : script.find(tool => !toolResults.has(tool.id));
        const item = next ? { id: `ct_${next.id}`, type: 'custom_tool_call', call_id: next.id,
          namespace: 'functions', name: 'exec', input: next.input, status: 'completed' } :
          { id: `msg_fixture_${callCount}`, type: 'message', role: 'assistant', phase: 'final_answer',
          status: 'completed', content: [{ type: 'output_text', text: finalText, annotations: [] }] };
        const response = { id: `resp_fixture_${callCount}`, object: 'response', created_at: Math.floor(Date.now() / 1000),
          model: MODEL, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
        return [
          { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
          { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
          ...(next ? [] : [{ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: finalText }]),
          { type: 'response.output_item.done', output_index: 0, item },
          { type: 'response.completed', response }
        ];
  }
  sockets.on('connection', ws => {
    ws.on('error', error => { fixtureError = String(error); });
    ws.on('message', bytes => {
      try {
        for (const event of respond(JSON.parse(bytes.toString()))) ws.send(JSON.stringify(event));
      } catch (error) { fixtureError = String(error); ws.close(1008, 'Fixture rejected request'); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let exit, completed, threadId, timedOut = false, stderr = '', failure;
  try {
    if (fixed) https.request = (options, callback) => {
      // Test-only lowest-level interception. The adapter supplies its real
      // fixed TLS options; no external socket is ever opened by this fixture.
      assert.equal(options.hostname ?? options.host, 'chatgpt.com'); assert.equal(options.path, providerRoute);
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.servername, 'chatgpt.com');
      assert.ok(options.agent instanceof https.Agent);
      upstreamRoutes.push({ hostname: options.hostname ?? options.host, path: options.path,
        method: options.method, rejectUnauthorized: options.rejectUnauthorized });
      return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1',
        port: server.address().port, agent: false, createConnection: undefined,
        headers: { ...options.headers, Host: 'chatgpt.com' } }, callback);
    };
    await copyPinnedNativeExecutable(source, binary, digest);
    await copyPinnedNativeExecutable(hostSource, codeModeHost, hostDigest);
    const profile = await prepareSubscriptionProfile(root, 'codex', useSession ? 'critic' : undefined);
    const toolPidPath = join(profile.scratch, 'owned-sleep.pid');
    if (cancelSession) script[0].input = `text(await tools.exec_command(${JSON.stringify({
      cmd: `echo $$ > '${toolPidPath}'; exec /bin/sleep 30`, shell: '/bin/sh', login: false, yield_time_ms: 1000
    })}));`;
    if (transport.startsWith('gateway')) {
      const admission = new CodexAccountAdmission({ now: Date.now,
        readCredential: async () => ({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { account_id: account, access_token: token } }),
        metadata: async () => { accountChecks++; return { account_id: account, plan_type: 'pro',
          credits: { has_credits: false, unlimited: false, balance: '0' }, rate_limit: { allowed: true, limit_reached: false } }; } });
      const inspectCredential = request => {
        credentialChecks++; assert.equal(request.accessToken, token); assert.equal(request.accountId, account);
        assert.ok(!JSON.stringify(request.headers).includes(gateway.localToken));
      };
      gateway = await openCodexSubscriptionGateway({ account: admission, identity: (await admission.verify()).receipt, model: MODEL,
        transport: fixed ? {
          http: request => { inspectCredential(request); return codexSubscriptionTransport.http(request); },
          websocket: request => { inspectCredential(request); return codexSubscriptionTransport.websocket(request); }
        } : { http: async request => { inspectCredential(request);
          return { status: 200, contentType: 'text/event-stream', body: Readable.from(respond(JSON.parse(request.body)).map(event =>
            Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))) }; },
          websocket: async request => { inspectCredential(request); return {
            async *exchange(bytes) { for (const event of respond(JSON.parse(bytes))) yield Buffer.from(JSON.stringify(event)); }, close() {} }; } } });
    }
    const workerToken = gateway?.localToken ?? token, workerAccount = gateway?.localAccountId ?? account;
    fs.writeFileSync(join(profile.providerHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null,
      tokens: { id_token: workerToken, access_token: workerToken, refresh_token: 'invalid-synthetic-refresh', account_id: workerAccount },
      last_refresh: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    if (gateway) assert.ok(!fs.readFileSync(join(profile.providerHome, 'auth.json'), 'utf8').includes(token), 'main credential never enters the native profile');
    const port = transport.endsWith('-http') ? server.address().port : gateway?.port ?? server.address().port;
    let controlClient;
    if (useSession) {
      const socketPath = join(root, 'control.sock'), helperPath = join(root, 'inert-helper.cjs'), credentialPath = join(root, 'control-capability.json');
      controlServer = net.createServer(socket => socket.destroy()); await new Promise(resolve => controlServer.listen(socketPath, resolve));
      fs.writeFileSync(helperPath, '// inert fixture helper'); fs.writeFileSync(credentialPath, '{}');
      controlClient = { socketPath, helperPath, credentialPath, nodePath: fs.realpathSync(process.execPath) };
    }
    const boundary = prepareSubscriptionSandbox({ artifact, profile, executable: binary, role: 'critic', providerBrokerPort: port,
      codexCodeModeHost: codeModeHost, controlClient, reviewEvidenceDirectory: useSession ? reviewEvidenceDirectory : undefined });
    const args = [...boundary.args, ...profile.args, '-c', `chatgpt_base_url="http://127.0.0.1:${port}"`,
      '-c', `openai_base_url="http://127.0.0.1:${port}/codex"`,
      // Compatibility probe only: production deliberately disables compression
      // so its Electron/Node 20 gateway can validate every plain JSON body.
      ...(transport === 'http-fallback' ? ['-c', 'features.enable_request_compression=true'] : []), 'app-server'];
    if (useSession) {
      const store = new GauntletStore(join(root, 'native-journal.db')); store.open();
      journal = codexJournal(store, artifact);
      const runtime = new CodexFreshSessionRuntime((command, args, options) => {
        child = spawn(command, args, options);
        let pending = '', received = 0;
        child.stdout.on('data', bytes => {
          received += bytes.length; if (received > 4 * 1024 * 1024) { sessionHandle?.stop(); return; }
          pending += bytes; let end;
          while ((end = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            try { messages.push(JSON.parse(line)); } catch { fixtureError = 'Invalid observed native record'; }
          }
        });
        return child; // actual command, args and environment, no substitution
      });
      sessionHandle = runtime.start({ launchId: journal.launch.id, sessionId: journal.launch.sessionId, role: 'critic', model: MODEL,
        prompt: 'Inspect evidence.txt and the exact review bar. Return the offline fixture report.', artifact, profile,
        executable: binary, codeModeHost, controlClient, reviewEvidenceDirectory,
        gateway: { port, url: `http://127.0.0.1:${port}`, close: () => gateway.close() }, timeoutMs: 45000,
        onIdentity: value => {
          journal.record({type:'native_identity',provider:'codex',...value});
          fs.appendFileSync(join(root, 'native-identity.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 }); identityReceipts.push(value);
        },
        onActivity: value => {
          activityReceipts.push(value);
          if (cancelSession && value.stage === 'requested' && !cancellationProbe) cancellationProbe = (async () => {
            const deadline = Date.now() + 2000;
            while (!fs.existsSync(toolPidPath)) {
              assert.ok(Date.now() < deadline, 'native tool did not write its owned PID marker');
              await new Promise(resolve => setTimeout(resolve, 10));
            }
            toolPid = Number(fs.readFileSync(toolPidPath, 'utf8').trim()); assert.ok(Number.isInteger(toolPid) && toolPid > 1);
            process.kill(toolPid, 0); sessionHandle.stop();
          })().catch(error => { fixtureError = String(error); sessionHandle.stop(); });
        } });
      journal.record({type:'process_started',pid:sessionHandle.receipt.pid,model:MODEL,
        profileSha256:sessionHandle.receipt.profileSha256,boundarySha256:sessionHandle.receipt.boundarySha256});
      sessionExit = await sessionHandle.completion;
      journal.record({type:'process_exited',reason:sessionExit.reason,exitCode:sessionExit.exitCode,processExited:sessionExit.processExited,
        gatewayRevocation:sessionExit.gatewayRevocation,descendantsQuiescent:false,output:sessionExit.output});
      journal.store.close(); journal.store.open();
      const saved = journal.store.snapshot(journal.run.id);
      assert.deepEqual(saved.runtimeObservations.filter(row=>row.event.type==='native_identity').map(row=>({threadId:row.event.threadId,turnId:row.event.turnId})),identityReceipts);
      assert.equal(saved.launches.find(item=>item.id===journal.launch.id).sessionId,journal.launch.sessionId);
      assert.equal(saved.run.status,'critic_in_flight'); assert.equal(saved.reports.length,0); assert.equal(saved.acknowledgments.length,0);
      await cancellationProbe;
      threadId = sessionExit.threadId; completed = messages.find(m => m.method === 'turn/completed')?.params;
      exit = { code: sessionExit.exitCode, signal: sessionExit.signal }; stderr = sessionExit.stderr;
      if (sessionExit.status !== (cancelSession ? 'cancelled' : 'completed')) failure = sessionExit.reason;
    } else {
    child = spawn(boundary.command, args, { cwd: artifact, env: profile.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = () => { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* no process group */ } } };
    const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
    let pending = '', outputBytes = 0;
    child.stdin.on('error', () => {});
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16384); });
    child.stdout.on('data', bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 4 * 1024 * 1024) { failure = 'output exceeded'; kill(); return; }
      pending += bytes;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const message = JSON.parse(line); messages.push(message);
          if (message.error) { failure = message.error; child.stdin.end(); return; }
          if (message.id === 1) {
            send({ method: 'initialized', params: {} });
            send({ id: 2, method: 'thread/start', params: { cwd: artifact, model: MODEL, modelProvider: 'openai',
              allowProviderModelFallback: false, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true } });
          } else if (message.id === 2) {
            threadId = message.result.thread.id;
            // Codex cannot apply a second Seatbelt profile within our mandatory
            // outer process sandbox. Explicit externalSandbox leaves the outer
            // read-only/network confinement in force for every native child.
            send({ id: 3, method: 'turn/start', params: { threadId,
              sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' },
              input: [{ type: 'text', text: 'Inspect evidence.txt and return the offline fixture report.' }] } });
          } else if (message.method === 'turn/completed') {
            completed = message.params; child.stdin.end();
          } else if (message.id !== undefined && message.method) {
            send({ id: message.id, error: { code: -32601, message: 'No external authority in this fixture' } });
          }
        } catch (error) { failure = String(error); kill(); }
      }
    });
    timer = setTimeout(() => { timedOut = true; kill(); }, 45000);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'operatus-native-tools-fixture', version: '0.1.0' } } });
    exit = await new Promise((resolve, reject) => {
      child.on('error', reject); child.on('exit', kill);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    }
    clearTimeout(timer);
    const receipt = { root, transport, executableSha256: digest, codeModeHostSha256: hostDigest, boundary: boundary.receipt, threadId, completed, exit,
      requests, upstreamRoutes, callCount, messages, frames, accountChecks, credentialChecks, gatewayReceipt: gateway?.receipt,
      sessionExit, identityReceipts, activityReceipts, toolPid, journalRunId:journal?.run.id, journalLaunchId:journal?.launch.id,
      toolResults: [...toolResults], stderr, fixtureError, failure, timedOut, launchAllowed: false };
    fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ root, transport, threadId, status: completed?.turn?.status, exit, callCount, fixtureError, failure,
      toolResults: [...toolResults] }));
    assert.equal(fixtureError, undefined); assert.equal(failure, undefined); assert.equal(timedOut, false);
    if (cancelSession) {
      assert.equal(sessionExit.reason, 'cancelled'); assert.equal(sessionExit.gatewayRevocation, 'confirmed');
      assert.equal(sessionExit.processExited, true); assert.equal(completed?.turn?.status === 'completed', false);
      assert.ok(toolPid, 'a real native tool was running before cancellation');
      let alive = true; const until = Date.now() + 2000;
      while (alive && Date.now() < until) { try { process.kill(toolPid, 0); await new Promise(resolve => setTimeout(resolve, 10)); } catch { alive = false; } }
      fs.writeFileSync(join(root, 'cancellation-verification.json'), JSON.stringify({ toolPid, absentAfterGrace: !alive,
        threadId, turnId: sessionExit.turnId, gatewayRevocation: sessionExit.gatewayRevocation, observedAt: Date.now() }), { mode: 0o600, flag: 'wx' });
      assert.equal(alive, false, 'native tool survived session cancellation');
      toolPid = undefined; // Do not signal an already-reaped PID during cleanup.
      return;
    }
    assert.equal(exit.code, 0, stderr); assert.equal(completed?.threadId, threadId);
    assert.equal(completed?.turn?.status, 'completed');
    const final = messages.filter(message => message.method === 'item/completed' && message.params.item.type === 'agentMessage').at(-1);
    assert.equal(final?.params.item.text, finalText);
    const commandResult = id => toolResults.get(id)?.flatMap(part => {
      try { const value = JSON.parse(part.text); return Object.hasOwn(value, 'exit_code') ? [value] : []; } catch { return []; }
    })?.at(-1);
    assert.equal(commandResult('read-evidence')?.exit_code, 0, 'native shell read completed, not just a transport reply');
    assert.equal(commandResult('deny-write')?.exit_code, 1);
    assert.equal(commandResult('deny-secret')?.exit_code, 1);
    assert.match(JSON.stringify(toolResults.get('read-evidence')), /synthetic exact evidence/);
    assert.match(JSON.stringify(toolResults.get('deny-write')), /[Oo]peration not permitted|[Pp]ermission denied/);
    assert.match(JSON.stringify(toolResults.get('deny-secret')), /[Oo]peration not permitted|[Pp]ermission denied/);
    assert.doesNotMatch(JSON.stringify([...toolResults]), /synthetic-secret-must-not-leak/);
    assert.equal(fs.existsSync(join(artifact, 'forbidden.txt')), false);
    assert.equal(fs.readFileSync(join(artifact, 'evidence.txt'), 'utf8'), 'synthetic exact evidence\n');
    assert.ok(requests.every(request => request.authorized));
    if (gateway) {
      assert.ok(accountChecks >= callCount + 1); assert.ok(credentialChecks > 0);
      if (transport === 'gateway') assert.equal(requests.length, 0);
    }
    if (transport === 'http-fallback') assert.ok(requests.some(request => request.method === 'POST' && request.encoding === 'zstd'));
    else if (transport.endsWith('-http')) assert.ok(requests.some(request => request.method === 'POST' && request.encoding === undefined));
    else assert.ok(!requests.some(request => request.method === 'POST'));
    assert.equal(sessions.has(threadId), false, 'each native process gets a fresh actual thread'); sessions.add(threadId);
    const commands = messages.filter(message => message.method === 'item/completed' && message.params.item.type === 'commandExecution');
    assert.equal(commands.length, 3, 'native tool lifecycle provides three completed command items');
    assert.ok(commands.every(message => message.params.threadId === threadId && message.params.turnId === completed.turn.id));
    assert.equal(boundary.receipt.launchAllowed, false);
    if (fixed) {
      assert.ok(upstreamRoutes.length > 0);
      assert.ok(requests.some(request => request.path === providerRoute && request.authorized));
    }
    if (useSession) {
      assert.equal(sessionExit.gatewayRevocation, 'confirmed'); assert.equal(sessionExit.processExited, true);
      assert.equal(sessionExit.stdout, finalText); assert.equal(sessionExit.turnId, completed.turn.id);
      assert.deepEqual(identityReceipts, [{ threadId, turnId: null }, { threadId, turnId: completed.turn.id }]);
      assert.equal(activityReceipts.length, 6); assert.deepEqual(activityReceipts.filter(e => e.stage === 'result').map(e => e.outcome), ['ok', 'error', 'error']);
      assert.match(JSON.stringify(toolResults.get('read-evidence')), /synthetic exact review bar/);
      assert.doesNotMatch(JSON.stringify(activityReceipts), /ambient-secret|evidence.txt|bar.txt/);
    }
  } finally {
    https.request = originalHttpsRequest;
    clearTimeout(timer);
    sessionHandle?.stop(); if (sessionHandle) await sessionHandle.completion;
    journal?.store.close();
    // Only the PID recorded by this fixture's own sleep command, never a scan
    // of unrelated provider processes. Needed if the cancellation assertion fails.
    if (toolPid) { try { process.kill(toolPid, 'SIGKILL'); } catch { /* exited */ } }
    if (child?.pid && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    await gateway?.close();
    for (const ws of sockets.clients) ws.terminate();
    await new Promise(resolve => sockets.close(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (controlServer) await new Promise(resolve => controlServer.close(resolve));
    await fs.promises.unlink(binary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.promises.unlink(codeModeHost).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});
