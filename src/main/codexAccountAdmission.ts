import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';

type Dependencies = {
  readCredential: () => Promise<unknown>;
  metadata: (accessToken: string, accountId: string) => Promise<unknown>;
  now: () => number;
};
type Failure = 'credential-unavailable' | 'credential-expired' | 'metadata-unavailable'
  | 'account-mismatch' | 'unsupported-account' | 'subscription-limit-unavailable';
export type CodexAccountReceipt = Readonly<{
  component: 'codex-subscription-account-v1'; accountHash: string; credentialHash: string;
  plan: 'plus' | 'pro'; credits: 'none-observed' | 'available' | 'unknown'; topUps: 'not-programmatically-verified';
  observedAt: number; validUntil: number; launchAllowed: false;
}>;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const validToken = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 16384 && !/[\s\u0000-\u001f\u007f]/.test(value);
const validAccount = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Account evidence only, never launch permission. Credit balance is not an
 * authentication method or evidence of enabled API billing. Require ChatGPT
 * OAuth and available subscription capacity; record credits without claiming
 * their provenance or that top-ups have been verified. No inference or refresh.
 */
export class CodexAccountAdmission {
  private readonly leases = new WeakMap<CodexAccountReceipt, { accessToken: string; accountId: string }>();
  constructor(private readonly dependencies: Dependencies = {
    readCredential: () => readPrivateCodexCredential(join(userInfo().homedir, '.codex', 'auth.json')),
    metadata: readCodexMetadata, now: Date.now
  }) {}

  async verify(): Promise<{ ok: true; receipt: CodexAccountReceipt } | { ok: false; reason: Failure }> {
    const start = this.dependencies.now();
    let source: Record<string, unknown> | undefined;
    try { source = record(await this.dependencies.readCredential()); }
    catch { return { ok: false, reason: 'credential-unavailable' }; }
    const tokens = record(source?.tokens), accessToken = tokens?.access_token, accountId = tokens?.account_id;
    if (source?.auth_mode !== 'chatgpt' || source.OPENAI_API_KEY != null || !validToken(accessToken) || !validAccount(accountId)) {
      return { ok: false, reason: 'credential-unavailable' };
    }
    // JWT payload is only a local consistency/expiry hint. Successful fixed-host
    // server authentication and matching returned account identity are mandatory.
    let payload: Record<string, unknown> | undefined;
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) throw new Error();
      payload = record(JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')));
    } catch { return { ok: false, reason: 'credential-unavailable' }; }
    if (record(payload?.['https://api.openai.com/auth'])?.chatgpt_account_id !== accountId) {
      return { ok: false, reason: 'account-mismatch' };
    }
    const expiry = typeof payload?.exp === 'number' ? payload.exp * 1000 : NaN;
    if (!Number.isFinite(expiry) || expiry <= start + 30000) return { ok: false, reason: 'credential-expired' };
    let usage: Record<string, unknown> | undefined;
    try { usage = record(await this.dependencies.metadata(accessToken, accountId)); }
    catch { return { ok: false, reason: 'metadata-unavailable' }; }
    if (usage?.account_id !== accountId) return { ok: false, reason: 'account-mismatch' };
    if (usage.plan_type !== 'plus' && usage.plan_type !== 'pro') return { ok: false, reason: 'unsupported-account' };
    const credits = record(usage.credits);
    const creditState: CodexAccountReceipt['credits'] = credits?.has_credits === true || credits?.unlimited === true
      ? 'available' : credits?.has_credits === false && credits.unlimited === false &&
        (credits.balance === 0 || (typeof credits.balance === 'string' && /^0(?:\.0+)?$/.test(credits.balance)))
        ? 'none-observed' : 'unknown';
    const rate = record(usage.rate_limit);
    const exhaustedWindow = ['primary_window', 'secondary_window'].some(key => {
      const used = record(rate?.[key])?.used_percent;
      return typeof used === 'number' && used >= 100;
    });
    if (rate?.allowed !== true || rate.limit_reached !== false || usage.rate_limit_reached_type != null || exhaustedWindow) {
      return { ok: false, reason: 'subscription-limit-unavailable' };
    }
    const observedAt = this.dependencies.now();
    if (observedAt < start || observedAt - start > 30000 || expiry <= observedAt + 30000) return { ok: false, reason: 'credential-expired' };
    const receipt: CodexAccountReceipt = Object.freeze({
      component: 'codex-subscription-account-v1', accountHash: hash(accountId), credentialHash: hash(accessToken),
      plan: usage.plan_type, credits: creditState, topUps: 'not-programmatically-verified',
      observedAt, validUntil: observedAt + 30000, launchAllowed: false
    });
    this.leases.set(receipt, { accessToken, accountId });
    return { ok: true, receipt };
  }

  credentialFor(receipt: CodexAccountReceipt): Readonly<{ accessToken: string; accountId: string }> {
    const lease = this.leases.get(receipt), now = this.dependencies.now();
    if (!lease || now < receipt.observedAt || now >= receipt.validUntil) {
      this.leases.delete(receipt);
      throw new Error('account admission expired or unknown');
    }
    return Object.freeze({ ...lease });
  }
  revoke(receipt: CodexAccountReceipt): void { this.leases.delete(receipt); }
}

/** Main-only file reader; rejects aliases, special files, unsafe permissions and
 * concurrent changes. Bounded reads use one FD, never copy or refresh the file.
 * The default caller uses the OS account's home, not ambient HOME/CODEX_HOME.
 */
export async function readPrivateCodexCredential(path: string): Promise<unknown> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (process.platform === 'win32' || !isAbsolute(path) || await realpath(path) !== path) throw new Error();
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile() || before.size > 128 * 1024 || before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0) throw new Error();
    const buffer = Buffer.alloc(128 * 1024 + 1); let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat();
    if (size > 128 * 1024 || size !== before.size || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error();
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } catch { throw new Error('subscription credential unavailable'); }
  finally { await file?.close(); }
}

/** Same read-only usage endpoint used by the native Codex backend client.
 * Fixed TLS host/path/method, no redirects, environment proxy, retries, refresh,
 * credit redemption, purchases or inference. Raw provider errors stay private.
 */
export function readCodexMetadata(accessToken: string, accountId: string): Promise<unknown> {
  if (!validToken(accessToken) || !validAccount(accountId)) return Promise.reject(new Error('invalid subscription credential'));
  return new Promise((resolve, reject) => {
    const agent = new Agent({ keepAlive: false });
    let settled = false, req: ReturnType<typeof request> | undefined;
    const finish = (value?: unknown, failed = false) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); agent.destroy();
      if (failed) reject(new Error('subscription metadata unavailable')); else resolve(value);
    };
    const deadline = setTimeout(() => { req?.destroy(); finish(undefined, true); }, 10000);
    try {
      req = request({ hostname: 'chatgpt.com', port: 443, path: '/backend-api/wham/usage', method: 'GET', agent,
        rejectUnauthorized: true, headers: { Authorization: `Bearer ${accessToken}`, 'ChatGPT-Account-ID': accountId,
          Accept: 'application/json', 'Cache-Control': 'no-cache' }
      }, response => {
        if (response.statusCode !== 200) { response.destroy(); finish(undefined, true); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 128 * 1024) { response.destroy(); finish(undefined, true); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(undefined, true); }
        });
        response.on('error', () => finish(undefined, true));
        response.on('aborted', () => finish(undefined, true));
      });
      req.on('error', () => finish(undefined, true)); req.end();
    } catch { finish(undefined, true); }
  });
}
