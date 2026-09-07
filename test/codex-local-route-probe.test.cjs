'use strict';
// Genuine pinned native Codex, synthetic ChatGPT credentials, rejecting local
// server, and mandatory outer Seatbelt confinement. Never forwards a request.
// This is transport evidence, not account, billing, model or Critic acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const load = require('./load-ts.cjs');
const { prepareSubscriptionProfile } = load('src/main/subscriptionProfile.ts');
const { prepareSubscriptionSandbox } = load('src/main/subscriptionSandbox.ts');
const { copyPinnedNativeExecutable } = load('src/main/executableIdentity.ts');

test('native Codex ChatGPT route reaches only a rejecting local observer', {
  skip: process.platform !== 'darwin' || !process.env.OPERATUS_CODEX_PROBE_PATH,
  timeout: 60000
}, async t => {
  const source = process.env.OPERATUS_CODEX_PROBE_PATH;
  const digest = process.env.OPERATUS_CODEX_PROBE_SHA256;
  assert.match(digest ?? '', /^[a-f0-9]{64}$/);
  const disk = fs.statfsSync(tmpdir());
  if (disk.bavail * disk.bsize < fs.statSync(source).size + 256 * 1024 * 1024) {
    t.skip('Insufficient space for a native copy and 256 MiB reserve'); return;
  }
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-codex-route-')));
  const binary = join(root, 'codex'), artifact = join(root, 'artifact');
  fs.mkdirSync(artifact);
  const jwt = value => `e30.${Buffer.from(JSON.stringify(value)).toString('base64url')}.c3ludGhldGlj`;
  const account = 'operatus-synthetic-account';
  const token = jwt({ exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth': { chatgpt_account_id: account, chatgpt_plan_type: 'pro' },
    'https://api.openai.com/profile': { email: 'synthetic@example.invalid' } });
  const records = [];
  const observe = request => ({ path: request.url, method: request.method,
    syntheticBearer: request.headers.authorization === `Bearer ${token}`,
    accountMatches: request.headers['chatgpt-account-id'] === account,
    apiKeyPresent: !!request.headers['x-api-key'], headerNames: Object.keys(request.headers).sort() });
  const server = http.createServer((request, response) => {
    let bytes = 0, body = '';
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { request.destroy(); return; }
      body += chunk;
    });
    request.on('end', () => {
      let data; try { data = JSON.parse(body); } catch { /* GET has no JSON body */ }
      records.push({ ...observe(request), model: data?.model, bodyKeys: data ? Object.keys(data).sort() : [] });
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Synthetic local probe refuses every request', type: 'authentication_error' } }));
    });
  });
  server.on('upgrade', (request, socket) => {
    records.push({ ...observe(request), websocket: true });
    socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let child, timer;
  try {
    await copyPinnedNativeExecutable(source, binary, digest);
    const profile = await prepareSubscriptionProfile(root, 'codex');
    fs.writeFileSync(join(profile.providerHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null,
      tokens: { id_token: token, access_token: token, refresh_token: 'synthetic-invalid-refresh-token', account_id: account },
      last_refresh: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    const boundary = prepareSubscriptionSandbox({ artifact, profile, executable: binary, role: 'critic', providerBrokerPort: server.address().port });
    assert.equal(boundary.receipt.network, 'scoped-local-gateways-only');
    const args = [...boundary.args, ...profile.args,
      '-c', `chatgpt_base_url="http://127.0.0.1:${server.address().port}"`,
      '-c', `openai_base_url="http://127.0.0.1:${server.address().port}/codex"`, 'app-server'];
    let pending = '', stderr = '', received = 0, threadId, completed, failure, timedOut = false;
    const events = [];
    child = spawn(boundary.command, args, { cwd: artifact, env: profile.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } } };
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.on('error', () => {});
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16384); });
    child.stdout.on('data', chunk => {
      received += chunk.length;
      if (received > 1024 * 1024) { failure = 'bounded output exceeded'; kill(); return; }
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        let message; try { message = JSON.parse(line); } catch { failure = 'malformed JSON'; kill(); return; }
        if (message.error) { failure = message.error; child.stdin.end(); return; }
        if (message.method) events.push(message.method);
        if (message.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'thread/start', params: { cwd: artifact, model: 'gpt-5.6-sol',
            modelProvider: 'openai', allowProviderModelFallback: false, approvalPolicy: 'never',
            sandbox: 'read-only', ephemeral: true } });
        } else if (message.id === 2) {
          threadId = message.result?.thread?.id;
          send({ id: 3, method: 'turn/start', params: { threadId,
            input: [{ type: 'text', text: 'Reply only with probe. Do not use any tools.' }] } });
        } else if (message.method === 'turn/completed') {
          completed = message.params; child.stdin.end();
        } else if (message.id !== undefined && message.method) {
          // No approval, token refresh, external tool, or other server request
          // is granted. Only the three explicitly sent requests are in scope.
          send({ id: message.id, error: { code: -32601, message: 'Not supported in offline probe' } });
        }
      }
    });
    timer = setTimeout(() => { timedOut = true; kill(); }, 25000);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'operatus-offline-route-probe', version: '0.1.0' } } });
    const exit = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', () => { kill(); });
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
    const receipt = { root, executableSha256: digest, boundary: boundary.receipt, records, events,
      threadId, completed, failure, timedOut, exit, stderr, launchAllowed: false };
    fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ root, executableSha256: digest, threadId,
      requestPaths: [...new Set(records.map(record => record.path))], requests: records.length,
      status: completed?.turn?.status, timedOut, exit, launchAllowed: false }));
    assert.ok(records.some(record => /\/responses(?:\?|$)/.test(record.path) && record.syntheticBearer && record.accountMatches && !record.apiKeyPresent),
      'a subscription-shaped response request must reach the local rejecting observer');
    assert.ok(records.every(record => !record.apiKeyPresent));
    assert.ok(records.every(record => record.syntheticBearer && record.accountMatches));
    assert.ok(!records.some(record => /plugins|analytics/.test(record.path)), 'app profile disables plugin discovery and analytics');
    assert.ok(records.some(record => record.websocket), 'observe the native WebSocket attempt');
    assert.ok(records.some(record => record.method === 'POST' && record.path === '/codex/responses'), 'observe the native HTTP fallback');
    assert.equal(completed?.threadId, threadId, 'terminal event belongs to the created thread');
    assert.equal(exit.code, 0, 'process exit is distinct from failed model turn');
    assert.equal(timedOut, false, 'native process must finish after rejection');
    assert.equal(failure, undefined);
    assert.equal(completed?.turn?.status, 'failed');
    assert.equal(boundary.receipt.launchAllowed, false);
  } finally {
    clearTimeout(timer);
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.promises.unlink(binary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});
