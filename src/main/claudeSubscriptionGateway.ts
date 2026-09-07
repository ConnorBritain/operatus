import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { Agent, request } from 'node:https';
import { once } from 'node:events';
import type { ClaudeAccountAdmission, ClaudeAccountReceipt } from './claudeAccountAdmission';

type ForwardRequest = {
  body: Buffer; headers: Record<string, string>; token: string; signal: AbortSignal;
};
type ForwardResponse = { status: number; contentType: string; body: AsyncIterable<Uint8Array> };
type Transport = (input: ForwardRequest) => Promise<ForwardResponse>;
const acceptedPath = (path?: string): boolean => path === '/v1/messages' || path === '/v1/messages?beta=true';
const oneHeader = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name]; return typeof value === 'string' ? value : undefined;
};

/** Main-owned, per-launch HTTP capability. Not an HTTP CONNECT proxy and not
 * launch admission. The worker receives only a random local bearer, never the
 * real OAuth credential. A caller must still compose process confinement,
 * approved model/executable identity and lifecycle before lifting any hold.
 * Tests inject synthetic account metadata and a non-networking transport.
 */
export async function openClaudeSubscriptionGateway(input: {
  account: ClaudeAccountAdmission; identity: ClaudeAccountReceipt; model: string;
  maxRequests?: number; requestTimeoutMs?: number; transport?: Transport;
}) {
  const { account, identity, model } = input;
  if (!/^claude-[a-z0-9-]{1,100}$/.test(model)) throw Error('invalid assigned Claude model');
  const maxRequests = input.maxRequests ?? 128, timeoutMs = input.requestTimeoutMs ?? 120000;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000 ||
    !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30*60*1000) throw Error('invalid gateway limits');
  account.credentialFor(identity); // Genuine instance-owned receipt, not JSON identity claims.
  const localToken = randomBytes(32).toString('base64url');
  const expectedAuth = Buffer.from(`Bearer ${localToken}`);
  const transport = input.transport ?? forwardClaudeSubscriptionRequest;
  const inFlight = new Set<AbortController>();
  let closed = false, requests = 0, port = 0;
  const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    const fail = (status: number, reason: string) => {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', Connection:'close' });
      res.end(JSON.stringify({ type:'error', error:{ type:'operatus_gateway_error', message:reason } }));
      req.resume();
    };
    if (closed) { fail(503,'Gateway closed'); return; }
    // No browser-origin access, forwarded authorities, alternate credentials or compression.
    const forbidden = ['origin','x-api-key','api-key','proxy-authorization','x-forwarded-host','forwarded','content-encoding'];
    const names = req.rawHeaders.filter((_value,index) => index%2===0).map(name=>name.toLowerCase());
    if (new Set(names).size !== names.length || forbidden.some(name=>req.headers[name] !== undefined) ||
      req.headers.host !== `127.0.0.1:${port}`) { fail(403,'Request authority rejected'); return; }
    // Native CLI startup reachability probe; never forwarded and never authorizes a model call.
    if (req.method === 'HEAD' && req.url === '/api/hello') { res.writeHead(204, {'Cache-Control':'no-store'}); res.end(); return; }
    const actualAuth = Buffer.from(oneHeader(req.headers,'authorization') ?? '');
    if (actualAuth.length !== expectedAuth.length || !timingSafeEqual(actualAuth,expectedAuth)) { fail(401,'Launch credential rejected'); return; }
    if (req.method !== 'POST' || !acceptedPath(req.url)) { fail(403,'Model route rejected'); return; }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(oneHeader(req.headers,'content-type') ?? '')) { fail(415,'JSON body required'); return; }
    if (requests >= maxRequests) { fail(429,'Launch request limit reached'); return; }
    if (inFlight.size) { fail(429,'A request is already in flight'); return; }
    requests++;
    const controller = new AbortController(); inFlight.add(controller);
    const deadline = setTimeout(()=>{controller.abort();fail(504,'Model request deadline exceeded');req.destroy();},timeoutMs);
    req.on('aborted',()=>controller.abort());
    res.on('close',()=>controller.abort());
    let lease: ClaudeAccountReceipt | undefined;
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4*1024*1024) { fail(413,'Model request too large'); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      let data: Record<string, unknown>;
      try { data = JSON.parse(body.toString('utf8')); }
      catch { fail(400,'Invalid JSON body'); return; }
      if (!data || Array.isArray(data) || data.model !== model || !Array.isArray(data.messages) || data.stream !== true) {
        fail(403,'Assigned streaming model required'); return;
      }
      // Recheck the OAuth credential each request. Successful Max/billing
      // metadata observations are bounded to five minutes by account.verify.
      const admission = await account.verify();
      if (!admission.ok) { fail(403,`Subscription account could not be admitted: ${admission.reason}`); return; }
      lease = admission.receipt;
      if (lease.accountHash !== identity.accountHash || lease.organizationHash !== identity.organizationHash) {
        fail(403,'Subscription identity changed'); return;
      }
      if (closed || controller.signal.aborted) return;
      const headers: Record<string,string> = {};
      // Only observed native protocol metadata is retained; never trust client routing/auth headers.
      for (const name of ['anthropic-version','anthropic-beta','user-agent','x-app','x-claude-code-session-id']) {
        const value = oneHeader(req.headers,name); if (value) headers[name] = value;
      }
      const response = await transport({body,headers,token:account.credentialFor(lease),signal:controller.signal});
      if (closed || controller.signal.aborted) return;
      if (response.status < 200 || response.status >= 300) {
        // No redirects, retry, API fallback, or secret-bearing upstream error bodies.
        fail(response.status>=400&&response.status<500?response.status:502,'Subscription provider rejected the request');return;
      }
      if (!/^text\/event-stream(?:\s*;.*)?$/i.test(response.contentType)) { fail(502,'Unexpected provider response'); return; }
      res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store'});
      let received = 0;
      for await (const chunk of response.body) {
        if (closed || controller.signal.aborted) return;
        received += chunk.length;
        if (received > 16*1024*1024) { res.destroy();return; }
        if (!res.write(chunk)) await once(res,'drain',{signal:controller.signal});
      }
      res.end();
    } catch { if (!controller.signal.aborted) fail(502,'Subscription request failed'); }
    finally {
      clearTimeout(deadline);controller.abort();inFlight.delete(controller);
      if (lease) account.revoke(lease);
    }
  });
  server.requestTimeout = timeoutMs;server.headersTimeout = Math.min(timeoutMs,10000);
  server.on('connect',(_req,socket)=>socket.destroy());
  server.on('upgrade',(_req,socket)=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  port = (server.address() as {port:number}).port;
  let closing: Promise<void> | undefined;
  return {
    url:`http://127.0.0.1:${port}`, port, localToken,
    receipt:Object.freeze({component:'claude-subscription-gateway-v1' as const,model,
      accountHash:identity.accountHash,organizationHash:identity.organizationHash,maxRequests,requestTimeoutMs:timeoutMs,
      maxRequestBytes:4*1024*1024,maxResponseBytes:16*1024*1024,launchAllowed:false as const}),
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;for (const request of inFlight) request.abort();
      closing = new Promise(resolve=>{server.close(()=>resolve());server.closeAllConnections();});return closing;
    }
  };
}

/** Fixed HTTPS destination, normal certificate validation, no redirects/proxy
 * configuration/retries. This function is not connected to production launch.
 */
function forwardClaudeSubscriptionRequest(input: ForwardRequest): Promise<ForwardResponse> {
  return new Promise((resolve,reject)=>{
    const agent = new Agent({keepAlive:false});
    const req = request({hostname:'api.anthropic.com',port:443,path:'/v1/messages?beta=true',method:'POST',
      agent,rejectUnauthorized:true,signal:input.signal,
      headers:{...input.headers,Authorization:`Bearer ${input.token}`,'Content-Type':'application/json',
        'Content-Length':input.body.length,Accept:'text/event-stream'}},response=>{
      response.once('close',()=>agent.destroy());
      resolve({status:response.statusCode??502,contentType:oneHeader(response.headers,'content-type')??'',body:response});
    });
    req.once('error',()=>{agent.destroy();reject(Error('Subscription transport unavailable'));});
    req.end(input.body);
  });
}
