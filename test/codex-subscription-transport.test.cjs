'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), https = require('node:https');
const WebSocket = require('ws');
const { codexSubscriptionTransport: transport } = require('./load-ts.cjs')('src/main/codexSubscriptionTransport.ts');
const complete = Buffer.from(JSON.stringify({ type: 'response.completed', response: { id: 'synthetic-response', status: 'completed' } }));
const delta = Buffer.from(JSON.stringify({ type: 'response.output_text.delta', delta: 'synthetic evidence' }));
const input = signal => ({ signal: signal ?? new AbortController().signal, accessToken: 'e30.e30.synthetic',
  accountId: 'synthetic-account', headers: {}, body: Buffer.from('{}') });
async function collect(source) { const chunks = []; for await (const chunk of source) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) { assert.ok(Date.now() < deadline, 'fixture observation deadline exceeded'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

// Production request options are asserted BEFORE the test-only substitution.
// This adapter cannot contact a public host: every https.request is intercepted
// and sent as plain HTTP to one disposable local fixture. TLS acceptance itself
// is not being tested; secure production options and real WS framing are.
async function fixture(t) {
  const state = { options: [], received: [], frames: [], connections: 0, closes: 0, status: 200, encoding: undefined,
    httpBody: Buffer.from(`event: response.completed\ndata: ${complete}\n\n`), httpHang: false, httpStream: false, handshake: 101,
    replies: [delta, complete], binary: false, hang: false };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    state.received.push({ headers: req.headers, path: req.url, body: Buffer.concat(chunks) });
    res.on('close', () => state.closes++);
    if (state.httpHang) return;
    res.writeHead(state.status, { 'Content-Type': 'text/event-stream', ...(state.encoding ? { 'Content-Encoding': state.encoding } : {}),
      ...(state.status === 302 ? { Location: 'https://must-not-follow.invalid/secret' } : {}) });
    if (state.httpStream) res.write(state.httpBody); else res.end(state.httpBody);
  });
  const connections = new Set();
  server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
  const sockets = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    state.received.push({ headers: req.headers, path: req.url });
    if (state.handshake === 0) return;
    if (state.handshake !== 101) { socket.end(`HTTP/1.1 ${state.handshake} Refused\r\nLocation: https://must-not-follow.invalid\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      state.connections++; ws.on('close', () => state.closes++); ws.on('error', () => {});
      ws.on('message', data => {
        state.frames.push(data.toString());
        if (state.hang) return;
        for (const reply of state.replies) ws.send(reply, { binary: state.binary });
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, original = https.request;
  https.request = (options, callback) => {
    assert.equal(options.hostname ?? options.host, 'chatgpt.com');
    assert.equal(options.path, '/backend-api/codex/responses');
    assert.equal(Number(options.port || 443), 443);
    assert.equal(options.servername, 'chatgpt.com'); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.minVersion, 'TLSv1.2'); assert.ok(options.agent instanceof https.Agent);
    assert.equal(options.agent.options.keepAlive, false);
    state.options.push(options);
    return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port,
      agent: false, createConnection: undefined, headers: { ...options.headers, Host: 'chatgpt.com' } }, callback);
  };
  t.after(async () => { https.request = original; for (const ws of sockets.clients) ws.terminate(); sockets.close();
    for (const socket of connections) socket.destroy();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return state;
}

test('fixed HTTPS options, narrow metadata and credential replacement ignore all caller routing/proxy hints', async t => {
  const s = await fixture(t);
  const request = input(); request.headers = { host: 'attacker.invalid', authorization: 'wrong', 'x-api-key': 'synthetic-api',
    'proxy-authorization': 'synthetic-proxy', 'x-forwarded-host': 'other', version: '0.153.4' };
  const response = await transport.http(request); assert.equal(response.status, 200);
  assert.equal((await collect(response.body)).toString(), s.httpBody.toString());
  assert.equal(s.options.length, 1); const h = s.received[0].headers;
  assert.equal(h.authorization, 'Bearer e30.e30.synthetic'); assert.equal(h['chatgpt-account-id'], 'synthetic-account');
  assert.equal(h.version, '0.153.4'); assert.equal(h['accept-encoding'], 'identity');
  assert.equal(h['x-api-key'], undefined); assert.equal(h['proxy-authorization'], undefined); assert.equal(h['x-forwarded-host'], undefined);
});

test('redirects, encoded responses and upstream refusal fail without retry or raw response disclosure', async t => {
  const s = await fixture(t);
  for (const [status, encoding] of [[302, undefined], [401, undefined], [200, 'gzip']]) {
    s.status = status; s.encoding = encoding; s.httpBody = Buffer.from('synthetic-secret');
    const before = s.options.length;
    await assert.rejects(transport.http(input()), /^Error: Codex subscription transport unavailable$/);
    assert.equal(s.options.length, before + 1);
  }
});

test('HTTP rejects aborted/oversized requests and unsafe credentials before opening a connection', async t => {
  const s = await fixture(t), controller = new AbortController(); controller.abort();
  for (const request of [input(controller.signal), { ...input(), body: Buffer.alloc(4 * 1024 * 1024 + 1) },
    { ...input(), accessToken: 'sk-synthetic' }, { ...input(), accountId: 'bad\r\nheader' },
    { ...input(), headers: { version: 'bad\r\nheader' } }]) {
    await assert.rejects(transport.http(request), /^Error: Codex subscription transport unavailable$/);
  }
  assert.equal(s.options.length, 0);
});

test('HTTP cancellation tears down a pending provider request', async t => {
  const s = await fixture(t); s.httpHang = true;
  const controller = new AbortController(), pending = transport.http(input(controller.signal));
  const rejection = assert.rejects(pending, /^Error: Codex subscription transport unavailable$/);
  await until(() => s.received.length);
  controller.abort(); await rejection;
  assert.equal(s.options.length, 1);
});

test('WebSocket preserves one connection over two bounded exchanges with fixed secure options', async t => {
  const s = await fixture(t); const connection = await transport.websocket(input());
  try {
    for (let i = 0; i < 2; i++) assert.equal((await collect(connection.exchange(Buffer.from('{}'), new AbortController().signal))).toString(), delta.toString() + complete.toString());
    assert.equal(s.connections, 1); assert.equal(s.options.length, 1); assert.equal(s.frames.length, 2);
    const o = s.options[0]; assert.equal(o.followRedirects, false); assert.equal(o.maxRedirects, 0);
    assert.equal(o.maxPayload, 1024 * 1024); assert.equal(o.perMessageDeflate, false);
    assert.equal(o.handshakeTimeout, 10000); assert.equal(s.received[0].headers.authorization, 'Bearer e30.e30.synthetic');
  } finally { connection.close(); }
});

test('WebSocket handshake refusal is redacted and never redirected/retried', async t => {
  const s = await fixture(t); s.handshake = 302;
  await assert.rejects(transport.websocket(input()), /^Error: Codex subscription transport unavailable$/);
  assert.equal(s.options.length, 1); assert.equal(s.frames.length, 0);
});

test('WebSocket exchange cancellation permanently revokes the connection', async t => {
  const s = await fixture(t); s.hang = true;
  const connection = await transport.websocket(input()), controller = new AbortController();
  try {
    const pending = collect(connection.exchange(Buffer.from('{}'), controller.signal));
    const rejection = assert.rejects(pending, /^Error: Codex subscription transport unavailable$/);
    await until(() => s.frames.length);
    controller.abort(); await rejection;
    await assert.rejects(collect(connection.exchange(Buffer.from('{}'), new AbortController().signal)), /unavailable/);
    assert.equal(s.frames.length, 1);
  } finally { connection.close(); }
});

test('WebSocket rejects malformed, binary, oversized and post-completion frames', async t => {
  const s = await fixture(t);
  for (const [replies, binary] of [[[Buffer.from('not-json')], false], [[delta], true],
    [[Buffer.alloc(1024 * 1024 + 1)], false], [[complete, delta], false],
    [[Buffer.from(JSON.stringify({ type: 'error', error: { message: 'synthetic-secret' } }))], false]]) {
    s.replies = replies; s.binary = binary;
    const connection = await transport.websocket(input());
    try { await assert.rejects(collect(connection.exchange(Buffer.from('{}'), new AbortController().signal)), /^Error: Codex subscription transport unavailable$/); }
    finally { connection.close(); }
  }
});

test('an overlapping WebSocket exchange revokes both operations instead of mixing response ownership', async t => {
  const s = await fixture(t); s.hang = true;
  const connection = await transport.websocket(input());
  try {
    const first = collect(connection.exchange(Buffer.from('{}'), new AbortController().signal));
    const rejected = assert.rejects(first, /unavailable/);
    await until(() => s.frames.length);
    await assert.rejects(collect(connection.exchange(Buffer.from('{}'), new AbortController().signal)), /unavailable/);
    await rejected; assert.equal(s.frames.length, 1);
  } finally { connection.close(); }
});

test('HTTP abort after headers interrupts streamed output; total response bytes remain bounded', async t => {
  const s = await fixture(t); s.httpStream = true; s.httpBody = Buffer.from('synthetic-delta');
  const controller = new AbortController(), response = await transport.http(input(controller.signal));
  const iterator = response.body[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.toString(), 'synthetic-delta'); controller.abort();
  await assert.rejects(iterator.next(), /^Error: Codex subscription transport unavailable$/);
  s.httpStream = false; s.httpBody = Buffer.alloc(16 * 1024 * 1024 + 1);
  const oversized = await transport.http(input()); await assert.rejects(collect(oversized.body), /unavailable/);
});

test('WebSocket lifetime abort cancels a pending handshake with no frame transmission', async t => {
  const s = await fixture(t); s.handshake = 0;
  const controller = new AbortController();
  const rejected = assert.rejects(transport.websocket(input(controller.signal)), /^Error: Codex subscription transport unavailable$/);
  await until(() => s.received.length); controller.abort(); await rejected;
  assert.equal(s.frames.length, 0); assert.equal(s.options.length, 1);
});

test('returning early from a WebSocket response revokes that socket', async t => {
  const s = await fixture(t); s.replies = [delta];
  const connection = await transport.websocket(input());
  try {
    const iterator = connection.exchange(Buffer.from('{}'), new AbortController().signal)[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value.toString(), delta.toString());
    await iterator.return();
    await assert.rejects(collect(connection.exchange(Buffer.from('{}'), new AbortController().signal)), /unavailable/);
    assert.equal(s.frames.length, 1);
  } finally { connection.close(); }
});

test('WebSocket burst responses stay inside the aggregate exchange limit', async t => {
  const s = await fixture(t);
  const large = Buffer.from(JSON.stringify({ type: 'response.output_text.delta', delta: 'x'.repeat(500000) }));
  s.replies = Array(40).fill(large);
  const connection = await transport.websocket(input());
  try {
    // Even with an active consumer, the total exchange cannot exceed its cap.
    await assert.rejects(collect(connection.exchange(Buffer.from('{}'), new AbortController().signal)), /unavailable/);
  } finally { connection.close(); }
});
