import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Agent, request } from 'node:https';
import { userInfo } from 'node:os';

type MetadataPath = '/api/oauth/profile' | '/api/oauth/usage';
type Dependencies = {
  readCredential: () => Promise<unknown>;
  metadata: (path: MetadataPath, accessToken: string) => Promise<unknown>;
  now: () => number;
};
export type ClaudeAccountFailure = 'credential-unavailable' | 'credential-expired' | 'profile-unavailable'
  | 'unsupported-account' | 'overage-enabled-or-unknown' | 'usage-unavailable';
export type ClaudeAccountReceipt = Readonly<{
  component: 'claude-max-account-v1'; accountHash: string; organizationHash: string;
  credentialHash: string; plan: 'max'; extraUsage: 'disabled'; observedAt: number;
  validUntil: number; metadataObservedAt?: number; launchAllowed: false;
}>;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Main-process account component, NOT sufficient launch authorization.
 * Only matching, unexpired receipt OBJECTS issued by this instance can retrieve
 * its credential. JSON copies, renderer claims and old receipts cannot do so.
 * Nothing persists the credential, refreshes it, changes billing, or invokes AI.
 */
export class ClaudeAccountAdmission {
  private readonly leases = new WeakMap<ClaudeAccountReceipt, { token: string; expiresAt: number }>();
  // Billing metadata is not an inference endpoint. Polling it on every tool
  // turn exhausts its rate limit and falsely looks like a failed login. Cache
  // only successful observations, keyed to the exact OAuth credential. Never
  // extend this window after a failed refresh or reuse it for another login.
  private observation?: { credentialHash: string; accountHash: string; organizationHash: string; at: number };
  constructor(private readonly dependencies: Dependencies = {
    readCredential: readClaudeKeychainCredential, metadata: readClaudeMetadata, now: Date.now
  }) {}

  async verify(): Promise<{ ok: true; receipt: ClaudeAccountReceipt } | { ok: false; reason: ClaudeAccountFailure }> {
    const start = this.dependencies.now();
    let source: unknown;
    try { source = await this.dependencies.readCredential(); }
    catch { return { ok: false, reason: 'credential-unavailable' }; }
    const oauth = record(record(source)?.claudeAiOauth);
    const token = oauth?.accessToken;
    const expiry = oauth?.expiresAt;
    if (typeof token !== 'string' || !token || token.length > 16384 || /[\s\u0000-\u001f\u007f]/.test(token) ||
      !Array.isArray(oauth?.scopes) || !oauth.scopes.includes('user:profile') || !oauth.scopes.includes('user:inference')) {
      return { ok: false, reason: 'credential-unavailable' };
    }
    if (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= start + 30000) return { ok: false, reason: 'credential-expired' };
    const credentialHash = digest(token);
    const cached = this.observation;
    if (cached && cached.credentialHash === credentialHash && start >= cached.at && start < cached.at + 300000) {
      const receipt: ClaudeAccountReceipt = Object.freeze({
        component: 'claude-max-account-v1', accountHash: cached.accountHash, organizationHash: cached.organizationHash,
        credentialHash, plan: 'max', extraUsage: 'disabled', observedAt: start, metadataObservedAt: cached.at,
        validUntil: Math.min(start + 30000, cached.at + 300000, expiry), launchAllowed: false
      });
      this.leases.set(receipt, { token, expiresAt: expiry });
      return { ok: true, receipt };
    }
    this.observation = undefined;
    let profile: Record<string, unknown> | undefined;
    try { profile = record(await this.dependencies.metadata('/api/oauth/profile', token)); }
    catch { return { ok: false, reason: 'profile-unavailable' }; }
    const account = record(profile?.account), organization = record(profile?.organization);
    if (!uuid(account?.uuid) || !uuid(organization?.uuid) || account.has_claude_max !== true ||
      organization.organization_type !== 'claude_max' || organization.subscription_status !== 'active') {
      return { ok: false, reason: 'unsupported-account' };
    }
    if (organization.has_extra_usage_enabled !== false) return { ok: false, reason: 'overage-enabled-or-unknown' };
    let usage: Record<string, unknown> | undefined;
    try { usage = record(await this.dependencies.metadata('/api/oauth/usage', token)); }
    catch { return { ok: false, reason: 'usage-unavailable' }; }
    if (record(usage?.extra_usage)?.is_enabled !== false) return { ok: false, reason: 'overage-enabled-or-unknown' };
    const observedAt = this.dependencies.now();
    if (observedAt < start || observedAt - start > 30000 || expiry <= observedAt + 30000) return { ok: false, reason: 'credential-expired' };
    const receipt: ClaudeAccountReceipt = Object.freeze({
      component: 'claude-max-account-v1', accountHash: digest(account.uuid), organizationHash: digest(organization.uuid),
      credentialHash: digest(token), plan: 'max', extraUsage: 'disabled', observedAt, metadataObservedAt: observedAt,
      validUntil: Math.min(observedAt + 30000, expiry), launchAllowed: false
    });
    this.leases.set(receipt, { token, expiresAt: expiry });
    this.observation = { credentialHash, accountHash: receipt.accountHash, organizationHash: receipt.organizationHash, at: observedAt };
    return { ok: true, receipt };
  }

  /** For the future main-owned launch compositor only. Remains unreachable from
   * renderer/preload; account validity does not bypass the global runtime hold.
   */
  credentialFor(receipt: ClaudeAccountReceipt): string {
    const lease = this.leases.get(receipt), now = this.dependencies.now();
    if (!lease || now < receipt.observedAt || now >= receipt.validUntil || now >= lease.expiresAt) {
      this.leases.delete(receipt);
      throw new Error('account admission expired or unknown');
    }
    return lease.token;
  }

  revoke(receipt: ClaudeAccountReceipt): void { this.leases.delete(receipt); }
}

/** One known subscription entry, not a keychain dump. Capture internally and
 * never include security stderr or its secret-bearing stdout in an error/log.
 */
export function readClaudeKeychainCredential(): Promise<unknown> {
  if (process.platform !== 'darwin') return Promise.reject(new Error('unsupported credential store'));
  // Claude Code namespaces the service by the OS login account. A service-only
  // query can return a stale entry from another account (e.g. "unknown"). Never
  // let an inherited USER value select someone else's credential.
  const username = userInfo().username;
  const account = /^[a-zA-Z0-9._-]+$/.test(username) ? username : 'claude-code-user';
  return new Promise((resolve, reject) => execFile('/usr/bin/security', [
    'find-generic-password', '-a', account, '-s', 'Claude Code-credentials', '-w'
  ], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' }
  }, (error, stdout) => {
    if (error) { reject(new Error('subscription credential unavailable')); return; }
    try { resolve(JSON.parse(stdout)); } catch { reject(new Error('subscription credential unavailable')); }
  }));
}

/** Fixed first-party GETs only. No URL override, redirects, proxy, retry/refresh,
 * purchase, payment or inference endpoint. The OAuth token goes only to the
 * provider that issued it. Responses/errors never flow directly to a renderer.
 */
export function readClaudeMetadata(path: MetadataPath, accessToken: string): Promise<unknown> {
  if (path !== '/api/oauth/profile' && path !== '/api/oauth/usage') return Promise.reject(new Error('unsupported metadata operation'));
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 16384 || /[\s\u0000-\u001f\u007f]/.test(accessToken)) {
    return Promise.reject(new Error('invalid subscription credential'));
  }
  return new Promise((resolve, reject) => {
    const agent = new Agent({ keepAlive: false });
    let settled = false;
    const finish = (value?: unknown, failed = false) => {
      if (settled) return; settled = true; clearTimeout(deadline); agent.destroy();
      if (failed) reject(new Error('subscription metadata unavailable')); else resolve(value);
    };
    let req: ReturnType<typeof request> | undefined;
    const deadline = setTimeout(() => { req?.destroy(); finish(undefined, true); }, 10000);
    try { req = request({ hostname: 'api.anthropic.com', port: 443, path, method: 'GET', agent,
      rejectUnauthorized: true,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
        'Cache-Control': 'no-cache', 'anthropic-beta': 'oauth-2025-04-20' }
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
    req.on('error', () => finish(undefined, true));
    req.end();
    } catch { finish(undefined, true); }
  });
}
