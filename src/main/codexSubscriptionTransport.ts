import { Agent, request } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { ConnectionOptions } from 'node:tls';
import WebSocket from 'ws';
import type { CodexGatewayRequest, CodexGatewayResponse, CodexGatewaySocket, CodexGatewayTransport } from './codexSubscriptionGateway';
import { codexResponseEvent } from './codexResponseStream';

const HOST = 'chatgpt.com', PATH = '/backend-api/codex/responses';
const MAX_REQUEST = 4 * 1024 * 1024, MAX_FRAME = 1024 * 1024, MAX_RESPONSE = 16 * 1024 * 1024;
// Gateway deadlines (normally two minutes) govern requests. This independent
// ceiling matches its maximum configuration without shortening a longer run.
const MAX_EXCHANGE_MS = 30 * 60 * 1000;
const unavailable = () => Error('Codex subscription transport unavailable');
const protocolHeaders = new Set(['user-agent', 'originator', 'version', 'openai-beta', 'session-id', 'thread-id',
  'x-client-request-id', 'x-codex-turn-metadata', 'x-codex-window-id', 'x-codex-beta-features', 'x-openai-internal-codex-responses-lite']);

function headers(input: Omit<CodexGatewayRequest, 'body'>): Record<string, string> {
  if (input.signal.aborted || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.accessToken) ||
    input.accessToken.length > 16384 || !/^[A-Za-z0-9_-]{1,256}$/.test(input.accountId)) throw unavailable();
  const result: Record<string, string> = {};
  let size = 0;
  for (const [key, value] of Object.entries(input.headers)) {
    if (!protocolHeaders.has(key)) continue;
    if (typeof value !== 'string' || !/^[\x20-\x7e]{1,4096}$/.test(value)) throw unavailable();
    size += key.length + value.length;
    if (size > 16384) throw unavailable();
    result[key] = value;
  }
  return { ...result, Authorization: `Bearer ${input.accessToken}`, 'ChatGPT-Account-ID': input.accountId };
}
const newAgent = () => new Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0 });

/** Fixed subscription route only. No URL, proxy, CA, redirect, retry, API key or
 * token refresh configuration is accepted. Main-owned admission and model/body
 * validation MUST precede this adapter; this transport is not launch permission.
 * Production composition remains held. Tests intercept the low-level request,
 * never substitute a configurable destination in this exported adapter.
 */
export const codexSubscriptionTransport: CodexGatewayTransport = {
  http: forwardHttp,
  websocket: openSocket
};

async function forwardHttp(input: CodexGatewayRequest): Promise<CodexGatewayResponse> {
  const metadata = headers(input);
  if (!Buffer.isBuffer(input.body) || input.body.length > MAX_REQUEST) throw unavailable();
  return new Promise((resolve, reject) => {
    const agent = newAgent();
    let req: ClientRequest | undefined, response: IncomingMessage | undefined, disposed = false;
    const dispose = () => {
      if (disposed) return; disposed = true;
      clearTimeout(deadline); clearTimeout(headerDeadline); input.signal.removeEventListener('abort', fail);
      response?.destroy(); req?.destroy(); agent.destroy();
    };
    const fail = () => { dispose(); reject(unavailable()); };
    const deadline = setTimeout(fail, MAX_EXCHANGE_MS);
    const headerDeadline = setTimeout(fail, 10000);
    input.signal.addEventListener('abort', fail, { once: true });
    try {
      req = request({ hostname: HOST, servername: HOST, port: 443, path: PATH, method: 'POST',
        agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', signal: input.signal,
        headers: { ...metadata, 'Content-Type': 'application/json', 'Content-Length': input.body.length,
          Accept: 'text/event-stream', 'Accept-Encoding': 'identity' } }, res => {
        response = res;
        clearTimeout(headerDeadline);
        const contentType = res.headers['content-type'], encoding = res.headers['content-encoding'];
        if (disposed || input.signal.aborted || res.statusCode !== 200 || typeof contentType !== 'string' ||
          !/^text\/event-stream(?:\s*;.*)?$/i.test(contentType) || (encoding !== undefined && encoding !== 'identity')) {
          fail(); return;
        }
        resolve({ status: 200, contentType, body: (async function* () {
          let received = 0;
          try {
            for await (const chunk of res) {
              if (disposed || input.signal.aborted) throw unavailable();
              received += chunk.length;
              if (received > MAX_RESPONSE) throw unavailable();
              yield chunk;
            }
            if (disposed || input.signal.aborted || !res.complete) throw unavailable();
          } catch { throw unavailable(); }
          finally { dispose(); }
        })() });
      });
      req.once('error', fail);
      req.end(input.body);
    } catch { fail(); }
  });
}

type Exchange = { queue: Buffer[]; queuedBytes: number; received: number; frames: number;
  terminal: boolean; notify?: () => void };

async function openSocket(input: Omit<CodexGatewayRequest, 'body'>): Promise<CodexGatewaySocket> {
  const metadata = headers(input), agent = newAgent();
  let ws: WebSocket | undefined, closed = false, active: Exchange | undefined;
  let rejectOpen: (error: Error) => void = () => {};
  function dispose() {
    if (closed) return; closed = true;
    input.signal.removeEventListener('abort', dispose);
    ws?.terminate(); agent.destroy();
    active?.notify?.(); rejectOpen(unavailable());
  }
  input.signal.addEventListener('abort', dispose, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      rejectOpen = reject;
      const options: WebSocket.ClientOptions & Pick<ConnectionOptions, 'servername'> = {
        agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: HOST,
        followRedirects: false, maxRedirects: 0, perMessageDeflate: false,
        handshakeTimeout: 10000, maxPayload: MAX_FRAME, headers: metadata
      };
      ws = new WebSocket(`wss://${HOST}${PATH}`, options);
      ws.on('error', dispose); ws.on('close', dispose);
      ws.on('unexpected-response', (req, res) => { res.destroy(); req.destroy(); dispose(); });
      ws.once('open', () => { if (closed || input.signal.aborted) dispose(); else resolve(); });
      ws.on('message', (bytes, binary) => {
        const state = active;
        if (closed || !state || binary || state.terminal) { dispose(); return; }
        try {
          const frame = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes as ArrayBuffer);
          const event = codexResponseEvent(frame);
          state.received += frame.length; state.queuedBytes += frame.length; state.frames++;
          if (state.received > MAX_RESPONSE || state.queuedBytes > 2 * MAX_FRAME || state.frames > 16384 || state.queue.length >= 4096) {
            throw unavailable();
          }
          state.terminal = event.terminal; state.queue.push(frame);
          if (state.queuedBytes >= 512 * 1024 || state.queue.length >= 128) ws!.pause();
          state.notify?.();
        } catch { dispose(); }
      });
    });
  } catch { dispose(); throw unavailable(); }

  return {
    close: dispose,
    async *exchange(body, signal) {
      if (closed || active || signal.aborted || !Buffer.isBuffer(body) || body.length > MAX_REQUEST) {
        dispose(); throw unavailable();
      }
      const state: Exchange = { queue: [], queuedBytes: 0, received: 0, frames: 0, terminal: false };
      active = state; let completed = false;
      signal.addEventListener('abort', dispose, { once: true });
      const deadline = setTimeout(dispose, MAX_EXCHANGE_MS);
      try {
        ws!.send(body, { binary: false, compress: false }, error => { if (error) dispose(); });
        while (true) {
          if (closed || signal.aborted) throw unavailable();
          const frame = state.queue.shift();
          if (!frame) { await new Promise<void>(resolve => state.notify = resolve); state.notify = undefined; continue; }
          state.queuedBytes -= frame.length;
          if (state.queuedBytes < 256 * 1024 && state.queue.length < 64) ws!.resume();
          yield frame;
          if (closed || signal.aborted) throw unavailable();
          if (codexResponseEvent(frame).terminal) { completed = true; return; }
        }
      } catch { throw unavailable(); }
      finally {
        clearTimeout(deadline); signal.removeEventListener('abort', dispose);
        if (active === state) active = undefined;
        if (!completed) dispose();
      }
    }
  };
}
