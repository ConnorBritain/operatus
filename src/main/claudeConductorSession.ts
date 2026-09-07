import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import type { ClaudeFreshSessionInput } from './claudeFreshSession';
import { prepareSubscriptionSandbox } from './subscriptionSandbox';
import { controlNodeEnvironment } from './gauntlet/controlClient';
import { claudeActivity } from './claudeActivity';
import { NativeOutput, NATIVE_OUTPUT_LIMITS, type NativeOutputStats } from './nativeOutput';

type Input = Omit<ClaudeFreshSessionInput, 'role' | 'prompt'> & {
  role: 'conductor'; turnTimeoutMs: number; maxMessages: number;
};
type Reason = 'finished' | 'cancelled' | 'timeout' | 'spawn_error' | 'invalid_stream' |
  'provider_error' | 'unexpected_exit' | 'output_limit' | 'gateway_revocation_failed';
export interface ConductorTurnReceipt {
  messageId: string; sessionId: string; ok: boolean; text: string;
  failure?: Reason;
}
export interface ConductorSessionExit {
  reason: Reason; sessionId: string; processExited: boolean;
  descendantsQuiescent: false; gatewayRevocation: 'confirmed' | 'unconfirmed';
  exitCode: number | null; turnsCompleted: number; stderr: string;
  output: NativeOutputStats;
}
type Spawn = (command: string, args: string[], options: {
  cwd: string; env: Record<string, string>; detached: true; stdio: 'pipe';
}) => ChildProcessWithoutNullStreams;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** One persistent native CLI, not repeated fresh workers or a run authority.
 * Main supplies already-owned profile/executable/control/gateway capabilities.
 * A result completes one conversation turn, never acknowledges a Critic report.
 * The socket remains the sole decision route. No production admission/resume yet.
 */
export class ClaudeConductorSessionRuntime {
  private readonly claims = new Set<string>();
  private readonly gateways = new Set<string>();
  constructor(private readonly spawnProcess: Spawn = spawn) {}

  start(input: Input) {
    const { profile, gateway, controlClient, sessionId } = input;
    if (!uuid.test(input.launchId) || !uuid.test(sessionId) || input.role !== 'conductor' ||
      !/^claude-[a-z0-9-]{1,100}$/.test(input.model) ||
      !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 10 || input.timeoutMs > 7 * 24 * 60 * 60 * 1000 ||
      !Number.isSafeInteger(input.turnTimeoutMs) || input.turnTimeoutMs < 10 || input.turnTimeoutMs > input.timeoutMs ||
      !Number.isSafeInteger(input.maxMessages) || input.maxMessages < 1 || input.maxMessages > 1000 ||
      !Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 1000 ||
      profile.receipt.provider !== 'claude' || profile.receipt.role !== 'conductor' ||
      createHash('sha256').update(readFileSync(profile.configPath)).digest('hex') !== profile.receipt.configSha256 ||
      !Number.isInteger(gateway.port) || gateway.port < 1 || gateway.port > 65535 ||
      gateway.url !== `http://127.0.0.1:${gateway.port}` || typeof gateway.close !== 'function') {
      throw Error('invalid isolated Conductor launch');
    }
    const boundary = prepareSubscriptionSandbox({ ...input, role: 'conductor', providerBrokerPort: gateway.port });
    const keys = [`launch:${input.launchId.toLowerCase()}`, `session:${sessionId.toLowerCase()}`, `profile:${realpathSync(profile.directory)}`];
    if (keys.some(key => this.claims.has(key)) || this.gateways.has(gateway.url)) throw Error('Conductor identity or gateway already claimed');
    keys.forEach(key => this.claims.add(key)); this.gateways.add(gateway.url);
    const args = [...boundary.args, '--restricted', '--setting-sources', '', '--settings', profile.configPath,
      '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Bash', '--session-id', sessionId,
      ...(input.reviewEvidenceDirectory ? ['--add-dir', input.reviewEvidenceDirectory] : []),
      ...(existsSync(`${profile.providerHome}/skills`) ? ['--add-dir', `${profile.providerHome}/skills`] : []),
      '--print', '--model', input.model, '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--max-turns', String(input.maxTurns)];
    const env: Record<string, string> = {
      HOME: profile.home, TMPDIR: `${profile.scratch}/`,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
      CLAUDE_CONFIG_DIR: profile.providerHome, CLAUDE_CODE_TMPDIR: profile.scratch,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_UPDATES: '1', CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      ...controlNodeEnvironment(controlClient), OPERATUS_GAUNTLET_HELPER: controlClient.helperPath,
      ANTHROPIC_BASE_URL: gateway.url
    };
    const gatewayKey = gateway.url, closeGateway = gateway.close.bind(gateway);
    const turnTimeoutMs = input.turnTimeoutMs, maxMessages = input.maxMessages;
    let revocation: Promise<'confirmed' | 'unconfirmed'> | undefined;
    const revoke = () => revocation ??= new Promise<'confirmed' | 'unconfirmed'>(resolve => {
      let done = false;
      const finish = (value: 'confirmed' | 'unconfirmed') => {
        if (done) return; done = true; clearTimeout(timer);
        if (value === 'confirmed') this.gateways.delete(gatewayKey);
        resolve(value);
      };
      const timer = setTimeout(() => finish('unconfirmed'), 2000);
      try { Promise.resolve(closeGateway()).then(() => finish('confirmed'), () => finish('unconfirmed')); }
      catch { finish('unconfirmed'); }
    });
    let child: ChildProcessWithoutNullStreams | undefined;
    let reason: Reason | undefined, exited = false, exitCode: number | null = null, settled = false, finishing = false;
    let turnsCompleted = 0;
    let pending: { id: string; resolve: (value: ConductorTurnReceipt) => void } | undefined;
    let turnTimer: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined, drainTimer: NodeJS.Timeout | undefined;
    const messages = new Set<string>();
    let resolveExit!: (value: ConductorSessionExit) => void;
    const completion = new Promise<ConductorSessionExit>(resolve => { resolveExit = resolve; });
    const kill = (signal: NodeJS.Signals) => { if (child?.pid && child.pid > 1) { try { process.kill(-child.pid, signal); } catch { /* already gone */ } } };
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(overallTimer); clearTimeout(turnTimer); clearTimeout(killTimer); clearTimeout(drainTimer);
      kill('SIGKILL');
      reason ??= finishing && exited && exitCode === 0 && !pending && !output.pendingBytes ? 'finished' : 'unexpected_exit';
      child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy();
      const stoppedBecause = reason;
      void revoke().then(gatewayRevocation => {
        const finalReason = gatewayRevocation === 'confirmed' ? stoppedBecause : 'gateway_revocation_failed';
        pending?.resolve({ messageId: pending.id, sessionId, ok: false, text: '', failure: finalReason }); pending = undefined;
        resolveExit({ reason: finalReason, sessionId, processExited: exited, descendantsQuiescent: false,
          gatewayRevocation, exitCode, turnsCompleted, stderr: output.stderrPreview, output: output.stats });
      });
    };
    const stop = (why: Reason = 'cancelled') => {
      if (settled || reason) return; reason = why; void revoke(); kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 750); drainTimer = setTimeout(finish, 1750);
    };
    const overallTimer = setTimeout(() => stop('timeout'), input.timeoutMs);
    const activity = claudeActivity(sessionId, input.onActivity ?? (() => {}));
    const consume = (line: Buffer) => {
      if (reason || settled || !line.length) return;
      try {
        const event = JSON.parse(line.toString('utf8'));
        if (!event || Array.isArray(event) || typeof event.type !== 'string' ||
          (event.session_id !== undefined && event.session_id !== sessionId)) throw Error('mismatched stream');
        if (event.type !== 'result') activity(event);
        if (event.type === 'result') {
          if (!pending || event.session_id !== sessionId || typeof event.is_error !== 'boolean') throw Error('unassigned result');
          if (event.is_error) { stop('provider_error'); return; }
          if (typeof event.result !== 'string') throw Error('missing result text');
          clearTimeout(turnTimer); const turn = pending; pending = undefined; turnsCompleted++;
          turn.resolve({ messageId: turn.id, sessionId, ok: true, text: event.result });
        }
      } catch { stop('invalid_stream'); }
    };
    const output = new NativeOutput(line => { consume(line); return !reason && !settled; }, () => stop('output_limit'));
    const receipt = Object.freeze({ launchId: input.launchId, sessionId, role: 'conductor' as const, model: input.model,
      timeoutMs: input.timeoutMs, turnTimeoutMs: input.turnTimeoutMs,
      profileSha256: profile.receipt.configSha256, boundarySha256: boundary.receipt.profileSha256,
      outputLimits: NATIVE_OUTPUT_LIMITS, launchAllowed: false as const });
    try {
      child = this.spawnProcess(boundary.command, args, { cwd: boundary.cwd, env, detached: true, stdio: 'pipe' });
      child.stdout.on('data', data => { if (!reason && !settled) output.accept('stdout', data); });
      child.stderr.on('data', data => { if (!reason && !settled) output.accept('stderr', data); });
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => stop('spawn_error'));
      child.once('error', () => stop('spawn_error'));
      child.once('exit', code => {
        exited = true; exitCode = code;
        if (settled) return;
        // Root exit ends this lead's authority even when a tool child retains
        // inherited pipes. Do not turn a clean finish into a turn/role timeout
        // while waiting for those descriptors to close.
        clearTimeout(overallTimer); clearTimeout(turnTimer);
        void revoke(); kill('SIGKILL');
        clearTimeout(drainTimer); drainTimer = setTimeout(finish, 1750);
      });
      child.once('close', finish);
    } catch { reason = 'spawn_error'; finish(); }
    return {
      receipt, completion, pid: child?.pid ?? null,
      send: (messageId: string, text: string): Promise<ConductorTurnReceipt> => {
        if (settled || reason || finishing || !child) throw Error('Conductor session is closed');
        if (pending) throw Error('Conductor already has an in-flight turn');
        if (!uuid.test(messageId) || messages.has(messageId.toLowerCase()) || messages.size >= maxMessages ||
          typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 256 * 1024) throw Error('invalid or duplicate Conductor message');
        messages.add(messageId.toLowerCase());
        const turn = new Promise<ConductorTurnReceipt>(resolve => { pending = { id: messageId, resolve }; });
        turnTimer = setTimeout(() => stop('timeout'), turnTimeoutMs);
        child.stdin.write(JSON.stringify({ type: 'user', session_id: sessionId, uuid: messageId,
          message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n');
        return turn;
      },
      finish: () => {
        if (settled || reason || finishing) return;
        if (pending || !turnsCompleted) throw Error('Conductor cannot finish before its turn completes');
        finishing = true; child?.stdin.end();
        drainTimer = setTimeout(() => stop('timeout'), 3000);
      },
      stop: () => stop()
    };
  }
}
