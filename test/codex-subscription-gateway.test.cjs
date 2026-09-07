'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), { Readable } = require('node:stream');
const WebSocket = require('ws');
const load = require('./load-ts.cjs');
const { CodexAccountAdmission } = load('src/main/codexAccountAdmission.ts');
const { openCodexSubscriptionGateway } = load('src/main/codexSubscriptionGateway.ts');
const MODEL = 'gpt-5.6-sol';
const event = JSON.stringify({ type: 'response.completed', response: { id: 'synthetic-response', status: 'completed', output: [] } });
const sse = `event: response.completed\ndata: ${event}\n\n`;
const body = (ws = false) => ({ ...(ws ? { type: 'response.create' } : {}), model: MODEL, stream: true, store: false, input: [] });
async function fixture(options = {}) {
  const state = { accountId: 'synthetic-main-account', credits: false, exhausted: false, calls: 0, forwarded: [], opens: [], closes: 0, wait: null, entered: null, salt: 0 };
  const credential = () => ({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { account_id: state.accountId,
    access_token: `e30.${Buffer.from(JSON.stringify({ exp: 1000, salt: state.salt,
      'https://api.openai.com/auth': { chatgpt_account_id: state.accountId } })).toString('base64url')}.c3ludGhldGlj` } });
  const account = new CodexAccountAdmission({ now: () => 100000, readCredential: async () => credential(),
    metadata: async () => { state.calls++; state.entered?.(); if (state.wait) await state.wait;
      return { account_id: state.accountId, plan_type: 'pro', credits: { has_credits: state.credits, unlimited: false, balance: state.credits ? '1' : '0' },
        rate_limit: { allowed: !state.exhausted, limit_reached: state.exhausted } }; } });
  const identity = (await account.verify()).receipt;
  const transport = { http: async input => { state.forwarded.push(input); return { status: 200, contentType: 'text/event-stream', body: Readable.from([Buffer.from(sse)]) }; },
    websocket: async input => { state.opens.push(input); return { async *exchange(bytes, signal) { state.forwarded.push({ ...input, body: bytes, signal }); yield Buffer.from(event); },
      close() { state.closes++; } }; } };
  const input = { account, identity, model: MODEL, transport, ...options };
  return { state, account, identity, input, credential, gateway: await openCodexSubscriptionGateway(input) };
}
function send(gateway, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(gateway.url, { path: options.path ?? '/codex/responses', method: options.method ?? 'POST',
      headers: { Authorization: `Bearer ${gateway.localToken}`, 'ChatGPT-Account-ID': gateway.localAccountId,
        'Content-Type': 'application/json', ...options.headers } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text })); res.on('error', reject);
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(Error('fixture client timeout')));
    req.end(options.raw ?? JSON.stringify(options.body ?? body()));
  });
}
async function connect(gateway) {
  const ws = new WebSocket(gateway.url.replace('http:', 'ws:') + '/codex/responses', {
    headers: { Authorization: `Bearer ${gateway.localToken}`, 'ChatGPT-Account-ID': gateway.localAccountId } });
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
function exchange(ws, value = body(true)) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error('fixture exchange timeout')), 3000);
    ws.once('message', data => { clearTimeout(deadline); resolve(JSON.parse(data.toString())); });
    ws.send(JSON.stringify(value));
  });
}
test('HTTP swaps local capability for fresh main credential, with fixed model and redacted receipt', async () => {
  const f = await fixture(); try {
    const response = await send(f.gateway, { headers: { 'x-untrusted-routing': 'ignored', 'version': '0.153.4' } });
    assert.equal(response.status, 200); assert.equal(response.text, sse); assert.equal(f.state.calls, 2);
    const forwarded = f.state.forwarded[0]; assert.equal(forwarded.accessToken, f.credential().tokens.access_token);
    assert.equal(forwarded.accountId, f.state.accountId); assert.notEqual(forwarded.accessToken, f.gateway.localToken);
    assert.deepEqual(forwarded.headers, { version: '0.153.4' });
    assert.doesNotMatch(JSON.stringify(f.gateway.receipt), /synthetic-main-account|accessToken|credentialHash/);
    assert.equal(f.gateway.receipt.launchAllowed, false);
    f.input.model = 'gpt-other'; assert.equal((await send(f.gateway, { body: { ...body(), model: 'gpt-other' } })).status, 403);
  } finally { await f.gateway.close(); }
});
test('alternate authority, routes, compression, models and expensive tiers cannot reach admission or forwarding', async () => {
  const f = await fixture(); try {
    for (const options of [{ headers: { Authorization: 'Bearer wrong' } }, { headers: { 'ChatGPT-Account-ID': 'wrong' } },
      { headers: { Origin: 'https://attacker.invalid' } }, { headers: { Host: 'attacker.invalid' } }, { headers: { 'x-api-key': 'synthetic-api' } },
      { headers: { 'Proxy-Authorization': 'bad' } }, { headers: { 'Content-Encoding': 'zstd' } },
      { path: 'https://attacker.invalid/codex/responses' }, { path: '/codex/responses?redirect=bad' },
      { path: '/oauth/token' }, { method: 'GET' }, { headers: { 'Content-Type': 'text/plain' } }, { raw: 'null' }, { raw: 'invalid' },
      { body: { ...body(), model: 'gpt-other' } }, { body: { ...body(), service_tier: 'priority' } },
      { body: { ...body(), stream: false } }, { body: { ...body(), store: true } }, { body: { ...body(), api_key: 'bad' } }]) {
      assert.ok((await send(f.gateway, options)).status >= 400, JSON.stringify(options));
    }
    assert.equal(f.state.calls, 1); assert.equal(f.state.forwarded.length, 0);
    assert.equal((await send(f.gateway, { raw: 'x'.repeat(4 * 1024 * 1024 + 1) })).status, 413);
  } finally { await f.gateway.close(); }
});
test('changed account, exhausted subscription and copied receipts fail closed', async () => {
  for (const change of [state => state.accountId = 'other-account', state => {state.credits=true;state.exhausted=true;}]) {
    const f = await fixture(); try {
      change(f.state); assert.equal((await send(f.gateway)).status, 403); assert.equal(f.state.forwarded.length, 0);
      await assert.rejects(openCodexSubscriptionGateway({ ...f.input, identity: { ...f.identity } }), /expired or unknown/);
    } finally { await f.gateway.close(); }
  }
});
test('available credits do not block authenticated subscription HTTP or WebSocket requests', async () => {
  const f=await fixture();let ws;
  try {
    f.state.credits=true;
    assert.equal((await send(f.gateway)).status,200);
    ws=await connect(f.gateway);assert.equal((await exchange(ws)).type,'response.completed');
    assert.equal(f.state.forwarded.length,2);
    assert.equal(f.state.forwarded[0].accessToken,f.credential().tokens.access_token);
  } finally {ws?.terminate();await f.gateway.close();}
});
test('WebSocket reuses its session but rechecks admission for each frame and closes on credential change', async () => {
  const f = await fixture(); let ws; try {
    ws = await connect(f.gateway);
    assert.equal((await exchange(ws)).type, 'response.completed');
    assert.equal((await exchange(ws)).type, 'response.completed');
    assert.equal(f.state.opens.length, 1); assert.equal(f.state.calls, 3); assert.equal(f.state.forwarded.length, 2);
    assert.equal(f.state.opens[0].accessToken, f.credential().tokens.access_token);
    f.state.salt++; assert.equal((await exchange(ws)).type, 'error');
    assert.equal(f.state.forwarded.length, 2); assert.ok(f.state.closes >= 1);
  } finally { ws?.terminate(); await f.gateway.close(); }
});
test('WebSocket other-model frames and exhausted subscription never forward', async () => {
  for (const mode of ['model', 'exhausted']) {
    const f = await fixture(); let ws; try {
      ws = await connect(f.gateway); if (mode === 'exhausted') {f.state.credits=true;f.state.exhausted=true;}
      const response = await exchange(ws, mode === 'model' ? { ...body(true), model: 'gpt-other' } : body(true));
      assert.equal(response.type, 'error'); assert.equal(f.state.forwarded.length, 0); assert.equal(f.state.opens.length, 0);
    } finally { ws?.terminate(); await f.gateway.close(); }
  }
});
test('close while admission is pending prevents later HTTP forwarding', async () => {
  const f = await fixture(); let release; try {
    const entered = new Promise(resolve => f.state.entered = resolve); f.state.wait = new Promise(resolve => release = resolve);
    const pending = send(f.gateway).catch(() => null); await entered;
    const closing = f.gateway.close(); assert.equal(f.gateway.close(), closing);
    release(); await closing; await pending; await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.forwarded.length, 0);
  } finally { release?.(); await f.gateway.close(); }
});
test('shared request budget covers HTTP and WebSocket and shutdown revokes an open session', async () => {
  const f = await fixture({ maxRequests: 2 }); let ws; try {
    assert.equal((await send(f.gateway)).status, 200); ws = await connect(f.gateway);
    assert.equal((await exchange(ws)).type, 'response.completed');
    assert.equal((await send(f.gateway)).status, 429); assert.equal(f.state.forwarded.length, 2);
    await f.gateway.close(); assert.ok(f.state.closes >= 1); assert.equal(f.state.opens[0].signal.aborted, true);
  } finally { ws?.terminate(); await f.gateway.close(); }
});
test('provider redirects and secret-bearing errors are not relayed', async () => {
  const f = await fixture(); try {
    f.input.transport.http = async () => ({ status: 302, contentType: 'text/event-stream', body: Readable.from(['synthetic-secret']) });
    const response = await send(f.gateway); assert.equal(response.status, 502); assert.doesNotMatch(response.text, /synthetic-secret/);
  } finally { await f.gateway.close(); }
});
test('deadline aborts active HTTP transport and rejects overlapping requests', async () => {
  let began, aborted = false; const started = new Promise(resolve => began = resolve);
  const f = await fixture({ requestTimeoutMs: 100 });
  f.input.transport.http = async request => { began(); await new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => {
    aborted = true; reject(Error('synthetic-secret')); }, { once: true })); };
  try {
    const pending = send(f.gateway).catch(() => null); await started;
    assert.equal((await send(f.gateway)).status, 429);
    const result = await pending; if (result) assert.equal(result.status, 504);
    assert.equal(aborted, true);
  } finally { await f.gateway.close(); }
});
test('closing during WebSocket transport creation drains the late connection without sending a frame', async () => {
  const f = await fixture(); let ws, release, entered; let closed = 0, exchanged = 0;
  const started = new Promise(resolve => entered = resolve);
  f.input.transport.websocket = async () => { entered(); await new Promise(resolve => release = resolve);
    return { async *exchange() { exchanged++; yield Buffer.from(event); }, close() { closed++; } }; };
  try {
    ws = await connect(f.gateway); ws.send(JSON.stringify(body(true))); await started;
    const closing = f.gateway.close(); release(); await closing;
    assert.equal(exchanged, 0); assert.equal(closed, 1);
  } finally { release?.(); ws?.terminate(); await f.gateway.close(); }
});
test('upstream close failure is reported as unconfirmed revocation, not an uncaught socket exception', async () => {
  const f = await fixture(); let ws;
  f.input.transport.websocket = async () => ({ async *exchange() { yield Buffer.from(event); }, close() { throw Error('synthetic-secret'); } });
  try {
    ws = await connect(f.gateway); assert.equal((await exchange(ws)).type, 'response.completed');
    await assert.rejects(f.gateway.close(), /^Error: Codex gateway revocation unconfirmed$/);
  } finally { ws?.terminate(); await f.gateway.close().catch(() => {}); }
});
test('WebSocket provider failures and oversized frames are replaced with a bounded generic error', async () => {
  for (const payload of [JSON.stringify({ type: 'error', error: { message: 'synthetic-secret' } }), 'x'.repeat(1024 * 1024 + 1)]) {
    const f = await fixture(); let ws;
    f.input.transport.websocket = async () => ({ async *exchange() { yield Buffer.from(payload); }, close() {} });
    try { ws = await connect(f.gateway); const result = await exchange(ws); assert.equal(result.type, 'error'); assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/); }
    finally { ws?.terminate(); await f.gateway.close(); }
  }
});
test('HTTP validates event records and never relays raw provider failures or a premature completion', async () => {
  const secretError = 'event: error\ndata: ' + JSON.stringify({ type: 'error', error: { message: 'synthetic-secret' } }) + '\n\n';
  for (const payload of [secretError, sse + secretError, sse.slice(0, -1),
    'data: ' + 'x'.repeat(1024 * 1024 + 1), 'data: [DONE]\n\n']) {
    const f = await fixture();
    f.input.transport.http = async () => ({ status: 200, contentType: 'text/event-stream', body: Readable.from([Buffer.from(payload)]) });
    try {
      const response = await send(f.gateway);
      assert.match(response.text, /operatus_gateway_error/);
      assert.doesNotMatch(response.text, /synthetic-secret|response.completed/);
    } finally { await f.gateway.close(); }
  }
});
test('WebSocket does not expose completion when its exchange has trailing invalid data', async () => {
  const f = await fixture(); let ws;
  f.input.transport.websocket = async () => ({ async *exchange() {
    yield Buffer.from(event); yield Buffer.from(JSON.stringify({ type: 'error', error: { message: 'synthetic-secret' } }));
  }, close() {} });
  try { ws = await connect(f.gateway); const result = await exchange(ws); assert.equal(result.type, 'error'); assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/); }
  finally { ws?.terminate(); await f.gateway.close(); }
});
