import { createHmac } from 'node:crypto';
import { arch, hostname, platform } from 'node:os';
import { basename } from 'node:path';
import type { GauntletRunSnapshot } from '../shared/gauntlet';
import type {
  RemoteNodeConfig,
  RemoteNodeConfigureInput,
  RemoteNodePairInput,
  RemoteNodeStatus
} from '../shared/remoteNode';
import { projectRemoteSnapshot } from './gauntlet/remoteProjection';

const DEFAULT_PORTAL_URL = 'https://england-ventura.vercel.app';
const DEFAULT_SYNC_INTERVAL_MS = 15_000;
export const REMOTE_NODE_SECRET_REF = 'ventura.remote.node-token.v1';

interface RemoteCommand {
  id: string;
  operation: 'message_conductor' | 'pause_run' | 'cancel_run' | 'answer_human_required' | 'approve_human_gate';
  payload: Record<string, unknown>;
  expected_run_version: number | null;
  expires_at: string;
  localRunId: string | null;
}

interface RemoteNodeDependencies {
  appVersion: () => string;
  readConfig: () => RemoteNodeConfig | undefined;
  writeConfig: (config: RemoteNodeConfig) => void;
  getToken: () => string | undefined;
  setToken: (token: string) => { ok: boolean; error?: string };
  deleteToken: () => void;
  snapshots: () => GauntletRunSnapshot[];
  cancelRun: (runId: string, reason: string) => GauntletRunSnapshot;
  messageConductor: (message: string, runId: string | null) => void;
  onStatus?: (status: RemoteNodeStatus) => void;
  fetch?: typeof globalThis.fetch;
  syncIntervalMs?: number;
}

export class VenturaRemoteNode {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly syncIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastSyncAt: number | null = null;
  private error: string | null = null;

  constructor(private readonly deps: RemoteNodeDependencies) {
    this.fetcher = deps.fetch ?? globalThis.fetch;
    this.syncIntervalMs = deps.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  }

  status(): RemoteNodeStatus {
    const config = this.config();
    const paired = Boolean(config.nodeId && this.deps.getToken());
    const state = !config.enabled ? 'disabled'
      : !paired ? 'unpaired'
        : this.inFlight ? 'connecting'
          : this.error ? 'degraded' : this.lastSyncAt ? 'online' : 'connecting';
    return {
      state,
      enabled: config.enabled,
      paired,
      portalUrl: config.portalUrl,
      nodeId: config.nodeId ?? null,
      nodeName: config.nodeName ?? hostname(),
      lastSyncAt: this.lastSyncAt,
      error: this.error
    };
  }

  configure(input: RemoteNodeConfigureInput): RemoteNodeStatus {
    const current = this.config();
    const next: RemoteNodeConfig = {
      ...current,
      enabled: input.enabled ?? current.enabled,
      portalUrl: input.portalUrl === undefined ? current.portalUrl : validatePortalUrl(input.portalUrl),
      nodeName: input.nodeName === undefined ? current.nodeName : boundedName(input.nodeName)
    };
    this.deps.writeConfig(next);
    this.error = null;
    if (next.enabled) this.start(); else this.stop();
    this.publishStatus();
    return this.status();
  }

  async pair(input: RemoteNodePairInput): Promise<RemoteNodeStatus> {
    const code = normalizePairingCode(input.code);
    if (code.length < 8 || code.length > 12) throw new Error('Enter the complete one-time pairing code.');
    const current = this.config();
    const nodeName = boundedName(input.nodeName ?? current.nodeName ?? hostname());
    this.inFlight = true;
    this.error = null;
    this.publishStatus();
    try {
      const response = await this.request(current.portalUrl, '/api/node/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name: nodeName,
          hostname: hostname(),
          platform: platform(),
          architecture: arch(),
          appVersion: this.deps.appVersion(),
          capabilities: {
            transport: 'outbound_https',
            snapshotPolicy: 'redacted_v1',
            commands: ['message_conductor', 'cancel_run']
          },
          publicKey: null
        })
      });
      const body = await response.json() as { nodeId?: string; nodeToken?: string; error?: string };
      if (!response.ok || !body.nodeId || !body.nodeToken) {
        throw new Error(body.error === 'PAIRING_INVALID_OR_EXPIRED'
          ? 'That pairing code is invalid or expired.'
          : 'The portal could not pair this machine.');
      }
      const stored = this.deps.setToken(body.nodeToken);
      if (!stored.ok) throw new Error(stored.error ?? 'The operating system could not protect the machine token.');
      this.deps.writeConfig({ ...current, enabled: true, nodeId: body.nodeId, nodeName });
      this.start();
      return this.status();
    } catch (error) {
      this.error = errorMessage(error);
      throw error;
    } finally {
      this.inFlight = false;
      this.publishStatus();
    }
  }

  disconnect(): RemoteNodeStatus {
    const current = this.config();
    this.stop();
    this.deps.deleteToken();
    this.deps.writeConfig({ ...current, enabled: false, nodeId: undefined });
    this.lastSyncAt = null;
    this.error = null;
    this.publishStatus();
    return this.status();
  }

  start(): void {
    const status = this.status();
    if (!status.enabled || !status.paired || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.syncIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  scheduleSync(): void {
    if (this.status().enabled && this.status().paired) void this.tick();
  }

  async syncNow(): Promise<RemoteNodeStatus> {
    await this.tick();
    return this.status();
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    const config = this.config();
    const token = this.deps.getToken();
    if (!config.enabled || !config.nodeId || !token) return;
    this.inFlight = true;
    this.publishStatus();
    try {
      const snapshots = this.deps.snapshots();
      const repositories = new Map<string, { localRepositoryId: string; displayName: string }>();
      const runs = snapshots.map((snapshot) => {
        const localRepositoryId = repositoryId(token, snapshot.run.repository);
        repositories.set(localRepositoryId, { localRepositoryId, displayName: basename(snapshot.run.repository) });
        const projected = projectRemoteSnapshot(snapshot);
        const terminal = ['passed', 'human_required', 'infrastructure_failure', 'cancelled'].includes(snapshot.run.status);
        return {
          localRunId: snapshot.run.id,
          localRepositoryId,
          title: `${basename(snapshot.run.repository)} · ${snapshot.run.id.slice(0, 8)}`,
          phase: snapshot.run.status,
          terminalStatus: terminal ? snapshot.run.status : null,
          artifactSha: snapshot.run.currentArtifactSha,
          runVersion: snapshot.run.version,
          snapshot: projected,
          startedAt: new Date(snapshot.run.createdAt).toISOString(),
          completedAt: terminal ? new Date(snapshot.run.updatedAt).toISOString() : null
        };
      });
      const sync = await this.request(config.portalUrl, '/api/node/sync', {
        method: 'POST',
        headers: this.nodeHeaders(token),
        body: JSON.stringify({
          status: 'online',
          appVersion: this.deps.appVersion(),
          capabilities: { transport: 'outbound_https', snapshotPolicy: 'redacted_v1', commands: ['message_conductor', 'cancel_run'] },
          repositories: [...repositories.values()].map((repository) => ({ ...repository, remoteHost: null, remoteOwner: null, remoteName: null })),
          runs
        })
      });
      if (!sync.ok) throw new Error(await responseError(sync, 'Machine sync failed'));
      await this.pollCommands(config.portalUrl, token);
      this.lastSyncAt = Date.now();
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.inFlight = false;
      this.publishStatus();
    }
  }

  private async pollCommands(portalUrl: string, token: string): Promise<void> {
    const response = await this.request(portalUrl, '/api/node/commands', { headers: this.nodeHeaders(token) });
    if (!response.ok) throw new Error(await responseError(response, 'Command polling failed'));
    const body = await response.json() as { commands?: RemoteCommand[] };
    for (const command of body.commands ?? []) {
      const result = await this.executeCommand(command);
      const acknowledgment = await this.request(portalUrl, '/api/node/commands/ack', {
        method: 'POST', headers: this.nodeHeaders(token),
        body: JSON.stringify({ commandId: command.id, ...result })
      });
      if (!acknowledgment.ok) throw new Error(await responseError(acknowledgment, 'Command acknowledgment failed'));
    }
  }

  private async executeCommand(command: RemoteCommand): Promise<{
    status: 'accepted' | 'rejected' | 'failed'; acknowledgment: Record<string, unknown>;
  }> {
    try {
      if (new Date(command.expires_at).getTime() <= Date.now()) {
        return { status: 'rejected', acknowledgment: { reason: 'expired_at_node' } };
      }
      const snapshot = command.localRunId
        ? this.deps.snapshots().find((candidate) => candidate.run.id === command.localRunId)
        : undefined;
      if (command.expected_run_version !== null) {
        if (!snapshot || snapshot.run.version !== command.expected_run_version) {
          return { status: 'rejected', acknowledgment: { reason: 'stale_run_version' } };
        }
      }
      if (command.operation === 'message_conductor') {
        const message = typeof command.payload.message === 'string' ? command.payload.message.trim() : '';
        if (!message || message.length > 4_000) return { status: 'rejected', acknowledgment: { reason: 'invalid_message' } };
        this.deps.messageConductor(message, command.localRunId);
        return { status: 'accepted', acknowledgment: { delivered: true } };
      }
      if (command.operation === 'cancel_run') {
        if (!snapshot || !command.localRunId) return { status: 'rejected', acknowledgment: { reason: 'run_not_found' } };
        const terminal = ['passed', 'human_required', 'infrastructure_failure', 'cancelled'].includes(snapshot.run.status);
        if (terminal) return { status: 'rejected', acknowledgment: { reason: 'run_already_terminal' } };
        const cancelled = this.deps.cancelRun(command.localRunId, 'Cancelled by an authenticated Ventura portal operator');
        return { status: 'accepted', acknowledgment: { runVersion: cancelled.run.version, status: cancelled.run.status } };
      }
      return { status: 'rejected', acknowledgment: { reason: 'operation_not_supported_by_this_build' } };
    } catch (error) {
      return { status: 'failed', acknowledgment: { reason: errorMessage(error).slice(0, 1_000) } };
    }
  }

  private config(): RemoteNodeConfig {
    const config = this.deps.readConfig();
    return {
      enabled: config?.enabled === true,
      portalUrl: validatePortalUrl(config?.portalUrl ?? DEFAULT_PORTAL_URL),
      nodeId: config?.nodeId,
      nodeName: config?.nodeName ?? hostname()
    };
  }

  private nodeHeaders(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  }

  private request(portalUrl: string, path: string, init: RequestInit): Promise<Response> {
    return this.fetcher(new URL(path, validatePortalUrl(portalUrl)), { ...init, signal: AbortSignal.timeout(10_000) });
  }

  private publishStatus(): void {
    this.deps.onStatus?.(this.status());
  }
}

export function validatePortalUrl(value: string): string {
  const url = new URL(value.trim());
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) {
    throw new Error('The portal address must use HTTPS (localhost may use HTTP).');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter only the portal origin.');
  url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

function boundedName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new Error('Machine name must be between 1 and 120 characters.');
  return name;
}

function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function repositoryId(token: string, repository: string): string {
  return createHmac('sha256', token).update(repository).digest('hex');
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ? `${fallback}: ${body.error}` : `${fallback} (${response.status})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
