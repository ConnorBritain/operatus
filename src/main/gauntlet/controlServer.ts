import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { FrozenRunContractInput, GauntletRunSnapshot, LeadDecision } from '../../shared/gauntlet';
import type { LocalGauntletBackend } from './localBackend';

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface GauntletControlEndpoint {
  socketPath: string;
  conductorToken: string;
}

interface ControlRequest {
  action?: unknown;
  runId?: unknown;
  launchId?: unknown;
  token?: unknown;
  payload?: unknown;
}

/**
 * Authenticated, line-delimited local control plane used by Ventura-launched
 * agents. It deliberately binds only to an OS socket — never TCP — and accepts
 * one bounded JSON command per connection. The backend remains the sole source
 * of validation and the SQLite store remains the sole run authority.
 */
export class GauntletControlServer {
  private server: Server | null = null;
  private readonly endpoint: GauntletControlEndpoint;

  constructor(
    stateRoot: string,
    private readonly backend: LocalGauntletBackend,
    private readonly onTransition: (snapshot: GauntletRunSnapshot) => void
  ) {
    const controlRoot = join(stateRoot, 'control');
    mkdirSync(controlRoot, { recursive: true, mode: 0o700 });
    this.endpoint = {
      // Node's path-based local transport maps to Unix domain sockets on macOS/
      // Linux and named pipes on Windows. Windows requires the canonical pipe
      // namespace; a drive-letter filesystem path is not a valid endpoint.
      socketPath: process.platform === 'win32'
        ? `\\\\.\\pipe\\ventura-gauntlet-${createHash('sha256').update(stateRoot).digest('hex').slice(0, 24)}`
        : join(controlRoot, 'gauntlet.sock'),
      conductorToken: loadOrCreateToken(join(controlRoot, 'conductor-token'))
    };
  }

  info(): GauntletControlEndpoint {
    return { ...this.endpoint };
  }

  async start(): Promise<GauntletControlEndpoint> {
    if (this.server) return this.info();
    if (process.platform !== 'win32') rmSync(this.endpoint.socketPath, { force: true });
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
      try { chmodSync(this.endpoint.socketPath, 0o600); } catch { /* best effort on exotic filesystems */ }
    }
    return this.info();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== 'win32') rmSync(this.endpoint.socketPath, { force: true });
  }

  private handleSocket(socket: Socket): void {
    socket.setEncoding('utf8');
    let body = '';
    let settled = false;
    const reply = (value: unknown): void => {
      if (settled) return;
      settled = true;
      socket.end(`${JSON.stringify(value)}\n`);
    };
    socket.on('data', (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
        reply({ ok: false, error: 'request exceeds 1 MiB limit' });
        return;
      }
      const newline = body.indexOf('\n');
      if (newline < 0) return;
      const line = body.slice(0, newline);
      void this.dispatch(line).then(
        (snapshot) => {
          this.onTransition(snapshot);
          reply({ ok: true, snapshot });
        },
        (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    });
    socket.on('error', () => { settled = true; });
  }

  private async dispatch(line: string): Promise<GauntletRunSnapshot> {
    const request = JSON.parse(line) as ControlRequest;
    const action = requiredString(request.action, 'action');
    const runId = requiredString(request.runId, 'runId');
    if (action === 'freeze') {
      this.authorizeConductor(request.token);
      return this.backend.freeze(runId, request.payload as FrozenRunContractInput);
    }
    if (action === 'complete') {
      const payload = request.payload as { sha?: unknown };
      return this.backend.completeArtifact({
        runId,
        launchId: requiredString(request.launchId, 'launchId'),
        token: requiredString(request.token, 'token'),
        sha: requiredString(payload?.sha, 'payload.sha')
      });
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
      this.authorizeConductor(request.token);
      const payload = request.payload as {
        reportId: string; decision: LeadDecision; acceptedFindingIds: string[];
        rejectedFindings: Array<{ findingId: string; reason: string }>;
        rationale: string; repairInstructions?: string[];
      };
      return this.backend.acknowledge({ ...payload, runId, conductorLaunchId: 'conductor' });
    }
    if (action === 'cancel') {
      this.authorizeConductor(request.token);
      const payload = request.payload as { reason?: unknown };
      return this.backend.cancel(runId, typeof payload?.reason === 'string' ? payload.reason : 'Cancelled by Conductor');
    }
    if (action === 'escalate') {
      this.authorizeConductor(request.token);
      const payload = request.payload as { reason?: unknown };
      return this.backend.escalate(
        runId,
        typeof payload?.reason === 'string' ? payload.reason : 'Conductor requested human judgment'
      );
    }
    throw new Error(`unsupported control action: ${action}`);
  }

  private authorizeConductor(value: unknown): void {
    const actual = Buffer.from(requiredString(value, 'token'));
    const expected = Buffer.from(this.endpoint.conductorToken);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('invalid Conductor token');
  }
}

function loadOrCreateToken(path: string): string {
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* first run */ }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('base64url');
  writeFileSync(path, `${token}\n`, { mode: 0o600, flag: 'wx' });
  return token;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}
