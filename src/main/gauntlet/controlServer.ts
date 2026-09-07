import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, rmdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FrozenRunContractInput, GauntletRunSnapshot, LeadDecision } from '../../shared/gauntlet';
import type { LocalGauntletBackend } from './localBackend';

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface GauntletControlEndpoint {
  socketPath: string;
}

interface ControlRequest {
  action?: unknown;
  runId?: unknown;
  launchId?: unknown;
  token?: unknown;
  payload?: unknown;
}

/**
 * Authenticated, line-delimited local control plane used by Operatus-launched
 * agents. It deliberately binds only to an OS socket — never TCP — and accepts
 * one bounded JSON command per connection. The backend remains the sole source
 * of validation and the SQLite store remains the sole run authority.
 */
export class GauntletControlServer {
  private server: Server | null = null;
  private readonly endpoint: GauntletControlEndpoint;
  private readonly socketDirectory: string | null;
  private readonly sockets = new Set<Socket>();
  private readonly pending = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private stopping: Promise<{ drained: boolean; pending: number }> | null = null;

  constructor(
    stateRoot: string,
    private readonly backend: LocalGauntletBackend,
    private readonly onTransition: (snapshot: GauntletRunSnapshot) => void
  ) {
    const controlRoot = join(stateRoot, 'control');
    mkdirSync(controlRoot, { recursive: true, mode: 0o700 });
    // sun_path is only 104 bytes on macOS. Node can silently truncate long
    // profile paths, leaving a different socket behind after close. Allocate
    // a short private directory per server lifetime instead. Never unlink a
    // shared name that might belong to a live predecessor or another profile.
    const prefix = join(tmpdir(), 'op-g-');
    this.socketDirectory = process.platform === 'win32' ? null :
      mkdtempSync(Buffer.byteLength(prefix) + 6 + 2 <= 100 ? prefix : '/tmp/op-g-');
    this.endpoint = {
      // Node's path-based local transport maps to Unix domain sockets on macOS/
      // Linux and named pipes on Windows. Windows requires the canonical pipe
      // namespace; a drive-letter filesystem path is not a valid endpoint.
      socketPath: process.platform === 'win32'
        ? `\\\\.\\pipe\\operatus-gauntlet-${createHash('sha256').update(stateRoot).digest('hex').slice(0, 24)}`
        : join(this.socketDirectory!, 's')
    };
  }

  info(): GauntletControlEndpoint {
    return { ...this.endpoint };
  }

  async start(): Promise<GauntletControlEndpoint> {
    if (this.shutdown.signal.aborted) throw new Error('control server is stopping; create a new instance to restart');
    if (this.server) return this.info();
    const server = createServer((socket) => this.handleSocket(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.endpoint.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') {
      // The socket path is itself an authority boundary; only the current user
      // should be able to connect even before scoped-token validation.
      chmodSync(this.endpoint.socketPath, 0o600);
    }
    return this.info();
  }

  stop(timeoutMs = 3000): Promise<{ drained: boolean; pending: number }> {
    if (this.stopping) return this.stopping;
    this.shutdown.abort(new Error('Gauntlet control is shutting down'));
    const server = this.server;
    this.server = null;
    // Stop listening and close even half-written/idle client connections.
    const closed = new Promise<void>((resolve) => {
      const finish = (): void => {
        // Remove only this server's empty directory, never a recursive cleanup
        // and never a successor's endpoint, even after the drain timeout.
        if (this.socketDirectory) {
          try { rmdirSync(this.socketDirectory); } catch { /* retain unexpected contents for diagnosis */ }
        }
        resolve();
      };
      if (server) server.close(finish);
      else finish();
    });
    for (const socket of this.sockets) socket.destroy();
    this.stopping = (async () => {
      let deadline: NodeJS.Timeout | undefined;
      const drained = await Promise.race([
        Promise.all([closed, ...this.pending]).then(() => true),
        new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), timeoutMs); })
      ]);
      clearTimeout(deadline);
      // Node removes its Unix socket when closing the listener. Do not unlink
      // a path here after a timeout: a successor may own that path by then.
      return { drained, pending: this.pending.size };
    })();
    return this.stopping;
  }

  private handleSocket(socket: Socket): void {
    if (this.shutdown.signal.aborted) { socket.destroy(); return; }
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    socket.setTimeout(10000, () => socket.destroy());
    socket.setEncoding('utf8');
    let body = '';
    let settled = false;
    let claimed = false;
    const reply = (value: unknown): void => {
      if (settled) return;
      settled = true;
      if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
    };
    socket.on('data', (chunk: string) => {
      if (claimed || settled || this.shutdown.signal.aborted) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
        reply({ ok: false, error: 'request exceeds 1 MiB limit' });
        return;
      }
      const newline = body.indexOf('\n');
      if (newline < 0) return;
      const line = body.slice(0, newline);
      claimed = true;
      body = '';
      socket.setTimeout(0); // A frozen check may legitimately outlast read timeout.
      const operation = this.dispatch(line).then(
        (snapshot) => {
          if (!this.shutdown.signal.aborted) {
            try { this.onTransition(snapshot); } catch (error) { console.error('[gauntlet] transition observer failed:', error); }
          }
          reply({ ok: true, snapshot });
        },
        (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
      this.pending.add(operation);
      void operation.finally(() => this.pending.delete(operation));
    });
    socket.on('error', () => { settled = true; });
  }

  private async dispatch(line: string): Promise<GauntletRunSnapshot> {
    const request = JSON.parse(line) as ControlRequest;
    const action = requiredString(request.action, 'action');
    const runId = requiredString(request.runId, 'runId');
    if (action === 'freeze') {
      return this.asConductor(request, runId, (launchId) =>
        this.backend.freeze(runId, request.payload as FrozenRunContractInput, launchId));
    }
    if (action === 'complete') {
      const payload = request.payload as { sha?: unknown };
      return this.backend.completeArtifact({
        runId,
        launchId: requiredString(request.launchId, 'launchId'),
        token: requiredString(request.token, 'token'),
        sha: requiredString(payload?.sha, 'payload.sha')
      }, this.shutdown.signal);
    }
    if (action === 'commit') {
      const payload = request.payload as { expectedSha?: unknown; contractDigest?: unknown; message?: unknown };
      return this.backend.commitWorkingArtifact({
        runId, launchId:requiredString(request.launchId,'launchId'), token:requiredString(request.token,'token'),
        expectedSha:requiredString(payload?.expectedSha,'payload.expectedSha'),
        contractDigest:requiredString(payload?.contractDigest,'payload.contractDigest'),
        message:requiredString(payload?.message,'payload.message')
      }, this.shutdown.signal);
    }
    if (action === 'critic') {
      const payload = request.payload as Parameters<LocalGauntletBackend['submitCritic']>[0];
      return this.backend.submitCritic({
        ...payload,
        runId,
        launchId: requiredString(request.launchId, 'launchId'),
        token: requiredString(request.token, 'token')
      });
    }
    if (action === 'acknowledge') {
      const payload = request.payload as {
        reportId: string; decision: LeadDecision; acceptedFindingIds: string[];
        rejectedFindings: Array<{ findingId: string; reason: string }>;
        rationale: string; repairInstructions?: string[];
      };
      return this.asConductor(request, runId, (launchId) =>
        this.backend.acknowledge({ ...payload, runId, conductorLaunchId: launchId }));
    }
    if (action === 'cancel') {
      const payload = request.payload as { reason?: unknown };
      return this.asConductor(request, runId, (launchId) =>
        this.backend.cancel(runId, typeof payload?.reason === 'string' ? payload.reason : 'Cancelled by Conductor', launchId));
    }
    if (action === 'escalate') {
      const payload = request.payload as { reason?: unknown };
      return this.asConductor(request, runId, (launchId) => this.backend.escalate(
        runId,
        typeof payload?.reason === 'string' ? payload.reason : 'Conductor requested human judgment',
        launchId
      ));
    }
    throw new Error(`unsupported control action: ${action}`);
  }

  private asConductor(request: ControlRequest, runId: string, command: (launchId: string) => GauntletRunSnapshot): GauntletRunSnapshot {
    if (typeof request.launchId !== 'string' || typeof request.token !== 'string') throw new Error('invalid Conductor authority');
    return this.backend.withConductorAuthority(runId, request.launchId, request.token, () => command(request.launchId as string));
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}
