import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import type { CodexAccountAdmission, CodexAccountReceipt } from './codexAccountAdmission';
import { codexResponseEvent, codexResponseSse } from './codexResponseStream';

export type CodexGatewayRequest = {
  body: Buffer; headers: Record<string, string>; accessToken: string; accountId: string; signal: AbortSignal;
};
export type CodexGatewayResponse = { status: number; contentType: string; body: AsyncIterable<Uint8Array> };
export type CodexGatewaySocket = {
  exchange(body: Buffer, signal: AbortSignal): AsyncIterable<Uint8Array>;
  close(): void;
};
export type CodexGatewayTransport = {
  http(input: CodexGatewayRequest): Promise<CodexGatewayResponse>;
  websocket(input: Omit<CodexGatewayRequest, 'body'>): Promise<CodexGatewaySocket>;
};
const MAX_REQUEST = 4 * 1024 * 1024, MAX_RESPONSE = 16 * 1024 * 1024, MAX_FRAME = 1024 * 1024;
const header = (request: IncomingMessage, key: string): string | undefined =>
  typeof request.headers[key] === 'string' ? request.headers[key] as string : undefined;
const modelRoute = '/codex/responses';
const requestFields = new Set(['type', 'model', 'input', 'tool_choice', 'parallel_tool_calls', 'reasoning',
  'store', 'stream', 'include', 'prompt_cache_key', 'text', 'generate', 'client_metadata', 'previous_response_id', 'service_tier']);
const errorEvent = () => JSON.stringify({ type: 'error', error: { type: 'operatus_gateway_error', message: 'Subscription request rejected' } });

/** Per-launch authority boundary. Transport is deliberately REQUIRED while
 * full native lifecycle integration and live subscription admission remain
 * unaccepted. Tests inject synthetic provider sessions; this module never
 * discovers credentials, refreshes tokens, purchases credits or changes a hold.
 * A scoped local bearer is the only credential provided to the child process.
 */
export async function openCodexSubscriptionGateway(input: {
  account: CodexAccountAdmission; identity: CodexAccountReceipt; model: string;
  transport: CodexGatewayTransport; maxRequests?: number; requestTimeoutMs?: number;
}) {
  const { account, identity, model, transport } = input;
  if (!/^gpt-[a-z0-9.-]{1,100}$/.test(model) || !transport || typeof transport.http !== 'function' || typeof transport.websocket !== 'function') {
    throw Error('invalid Codex gateway configuration');
  }
  const maxRequests = input.maxRequests ?? 128, timeoutMs = input.requestTimeoutMs ?? 120000;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000 ||
    !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30 * 60 * 1000) throw Error('invalid gateway limits');
  account.credentialFor(identity);
  const localAccountId = `operatus-${randomBytes(16).toString('hex')}`;
  // Native file-based ChatGPT auth requires a token-shaped local credential.
  // Its claims are local routing hints only, not the real account identity.
  const localToken = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400,
    'https://api.openai.com/auth': { chatgpt_account_id: localAccountId, chatgpt_plan_type: identity.plan },
    'https://api.openai.com/profile': { email: 'local-capability@operatus.invalid' }
  })).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
  const expectedAuth = Buffer.from(`Bearer ${localToken}`);
  const inFlight = new Set<AbortController>(), socketControllers = new Set<AbortController>();
  const socketStops = new Set<() => void>();
  let closed = false, port = 0, requests = 0, revocationFailed = false;

  function authorized(req: IncomingMessage): boolean {
    const names = req.rawHeaders.filter((_value, i) => i % 2 === 0).map(name => name.toLowerCase());
    const actual = Buffer.from(header(req, 'authorization') ?? '');
    return !closed && req.headers.host === `127.0.0.1:${port}` && new Set(names).size === names.length &&
      ['origin', 'x-api-key', 'api-key', 'proxy-authorization', 'forwarded', 'x-forwarded-host', 'content-encoding'].every(name => req.headers[name] === undefined) &&
      header(req, 'chatgpt-account-id') === localAccountId && actual.length === expectedAuth.length && timingSafeEqual(actual, expectedAuth);
  }
  function validatedBody(bytes: Buffer, websocket: boolean): Buffer {
    if (bytes.length > MAX_REQUEST) throw Error('request too large');
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.model !== model ||
      value.stream !== true || value.store !== false || !Array.isArray(value.input) ||
      Object.keys(value).some(key => !requestFields.has(key)) ||
      (websocket ? value.type !== 'response.create' : value.type !== undefined) ||
      (value.service_tier !== undefined && value.service_tier !== 'default')) throw Error('assigned streaming model required');
    return bytes;
  }
  function metadata(req: IncomingMessage): Record<string, string> {
    const result: Record<string, string> = {};
    for (const name of ['user-agent', 'originator', 'version', 'openai-beta', 'session-id', 'thread-id',
      'x-client-request-id', 'x-codex-turn-metadata', 'x-codex-window-id', 'x-codex-beta-features', 'x-openai-internal-codex-responses-lite']) {
      const value = header(req, name); if (value) result[name] = value;
    }
    return result;
  }
  async function admitted() {
    const value = await account.verify();
    if (!value.ok) throw Error('account not admitted');
    const lease = value.receipt;
    if (lease.accountHash !== identity.accountHash || lease.plan !== identity.plan) { account.revoke(lease); throw Error('account changed'); }
    return lease;
  }
  const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    const fail = (status: number) => {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(errorEvent()); req.resume();
    };
    if (!authorized(req)) { fail(403); return; }
    // Native startup account/catalog probes receive a local refusal, not a
    // general-purpose proxy or invented account/model availability response.
    if (req.method !== 'POST' || req.url !== modelRoute) { fail(404); return; }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(req, 'content-type') ?? '')) { fail(415); return; }
    if (inFlight.size || requests >= maxRequests) { fail(429); return; }
    requests++;
    const controller = new AbortController(); inFlight.add(controller);
    const deadline = setTimeout(() => { controller.abort(); fail(504); req.destroy(); }, timeoutMs);
    req.on('aborted', () => controller.abort()); res.on('close', () => controller.abort());
    let lease: CodexAccountReceipt | undefined;
    try {
      let received = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { received += chunk.length; if (received > MAX_REQUEST) { fail(413); return; } chunks.push(chunk); }
      let body: Buffer;
      try { body = validatedBody(Buffer.concat(chunks), false); } catch { fail(403); return; }
      lease = await admitted();
      if (closed || controller.signal.aborted) return;
      const response = await transport.http({ body, headers: metadata(req), ...account.credentialFor(lease), signal: controller.signal });
      if (closed || controller.signal.aborted) return;
      if (response.status !== 200 || !/^text\/event-stream(?:\s*;.*)?$/i.test(response.contentType)) { fail(502); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      for await (const bytes of codexResponseSse(response.body)) {
        if (closed || controller.signal.aborted) return;
        if (!res.write(bytes)) await once(res, 'drain', { signal: controller.signal });
      }
      res.end();
    } catch {
      if (!controller.signal.aborted) {
        if (res.headersSent && !res.destroyed) res.end(`event: error\ndata: ${errorEvent()}\n\n`);
        else fail(403);
      }
    }
    finally { clearTimeout(deadline); controller.abort(); inFlight.delete(controller); if (lease) account.revoke(lease); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (!authorized(req) || req.url !== modelRoute || sockets.clients.size >= 2) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      const lifetime = new AbortController(); socketControllers.add(lifetime);
      let upstream: CodexGatewaySocket | undefined, credentialHash: string | undefined;
      let active: AbortController | undefined;
      const closeUpstream = () => {
        const connection = upstream; upstream = undefined;
        try { connection?.close(); } catch { revocationFailed = true; }
      };
      const stop = () => { lifetime.abort(); active?.abort(); closeUpstream(); socketControllers.delete(lifetime); socketStops.delete(stop); };
      socketStops.add(stop);
      ws.on('close', stop); ws.on('error', stop);
      ws.on('message', async (data, binary) => {
        const fail = () => { if (ws.readyState === WebSocket.OPEN) ws.send(errorEvent()); ws.close(1008, 'Request rejected'); stop(); };
        if (binary || closed || lifetime.signal.aborted || active || inFlight.size || requests >= maxRequests) { fail(); return; }
        let body: Buffer;
        try { body = validatedBody(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), true); } catch { fail(); return; }
        requests++;
        const controller = new AbortController(); active = controller; inFlight.add(controller);
        const deadline = setTimeout(() => { controller.abort(); fail(); }, timeoutMs);
        let lease: CodexAccountReceipt | undefined;
        try {
          lease = await admitted();
          if (closed || lifetime.signal.aborted || controller.signal.aborted) return;
          // Never keep using a socket authenticated with an older credential.
          // Changing credentials closes this conversation instead of silently
          // reconnecting with uncertain server-side context ownership.
          if (credentialHash && credentialHash !== lease.credentialHash) throw Error('socket credential changed');
          if (!upstream) {
            upstream = await transport.websocket({ headers: metadata(req), ...account.credentialFor(lease), signal: lifetime.signal });
            credentialHash = lease.credentialHash;
          }
          if (closed || lifetime.signal.aborted || controller.signal.aborted) { closeUpstream(); return; }
          let size = 0, completion: Buffer | undefined;
          for await (const bytes of upstream.exchange(body, controller.signal)) {
            if (closed || controller.signal.aborted) return;
            size += bytes.length;
            if (size > MAX_RESPONSE || bytes.length > MAX_FRAME || completion) throw Error('invalid provider stream');
            const event = codexResponseEvent(bytes);
            if (event.terminal) { completion = Buffer.from(bytes); continue; }
            await new Promise<void>((resolve, reject) => ws.send(bytes, { binary: false }, error => error ? reject(error) : resolve()));
          }
          if (!completion) throw Error('incomplete provider stream');
          if (closed || controller.signal.aborted) return;
          await new Promise<void>((resolve, reject) => ws.send(completion!, { binary: false }, error => error ? reject(error) : resolve()));
        } catch { if (!closed) fail(); }
        finally {
          clearTimeout(deadline); controller.abort(); inFlight.delete(controller);
          if (active === controller) active = undefined;
          if (lease) account.revoke(lease);
        }
      });
    });
  });
  server.on('connect', (_req, socket) => socket.destroy());
  server.requestTimeout = timeoutMs; server.headersTimeout = Math.min(timeoutMs, 10000);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = (server.address() as { port: number }).port;
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}`, port, localToken, localAccountId,
    receipt: Object.freeze({ component: 'codex-subscription-gateway-v1' as const, model, accountHash: identity.accountHash,
      maxRequests, requestTimeoutMs: timeoutMs, maxRequestBytes: MAX_REQUEST, maxResponseBytes: MAX_RESPONSE, launchAllowed: false as const }),
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      for (const request of inFlight) request.abort();
      for (const lifetime of socketControllers) lifetime.abort();
      for (const stop of socketStops) stop();
      for (const ws of sockets.clients) ws.terminate();
      closing = new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }).then(async () => {
        // Closing the listener is not proof that a pending admission/transport
        // has drained. Unknown completion must be reported to the lifecycle
        // owner, not recorded as confirmed revocation.
        const until = Date.now() + 2000;
        while (inFlight.size && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
        if (inFlight.size || revocationFailed) throw Error('Codex gateway revocation unconfirmed');
      });
      sockets.close(); return closing;
    }
  };
}
