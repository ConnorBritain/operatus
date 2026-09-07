import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import type { prepareSubscriptionProfile } from './subscriptionProfile';
import { prepareSubscriptionSandbox } from './subscriptionSandbox';
import type { PreparedControlClient } from './gauntlet/controlClient';
import { controlNodeEnvironment } from './gauntlet/controlClient';
import { claudeActivity } from './claudeActivity';
import type { ToolActivity } from '../shared/gauntlet';
import { NativeOutput, NATIVE_OUTPUT_LIMITS, type NativeOutputStats } from './nativeOutput';

type Profile = Awaited<ReturnType<typeof prepareSubscriptionProfile>>;
type WorkerRole = 'implementer' | 'critic' | 'repairer';
export interface ClaudeFreshSessionInput {
  launchId: string;
  sessionId: string;
  role: WorkerRole;
  model: string;
  prompt: string;
  artifact: string;
  profile: Profile;
  /** Already copied and digest-verified by main. Never a PATH lookup. */
  executable: string;
  controlClient: PreparedControlClient;
  /** One gateway per launch. Ownership transfers after validation/claim. */
  gateway: { port: number; url: string; close: () => Promise<void> };
  reviewEvidenceDirectory?: string;
  timeoutMs: number;
  maxTurns: number;
  onActivity?: (event: ToolActivity) => void;
}

export interface ClaudeSessionExit {
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  reason: 'result' | 'provider_error' | 'invalid_result' | 'spawn_error' | 'output_limit' | 'cancelled' | 'timeout' | 'gateway_revocation_failed';
  sessionId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  processExited: boolean;
  /** A CLI receipt/exit is not proof that every possible descendant is gone. */
  descendantsQuiescent: false;
  gatewayRevocation: 'confirmed' | 'unconfirmed';
  stdout: string;
  stderr: string;
  output: NativeOutputStats;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Spawn = (command: string, args: string[], options: {
  cwd: string; env: Record<string, string>; detached: true; stdio: 'pipe';
}) => ChildProcessWithoutNullStreams;

/** Dedicated fresh-worker transport. NOT account admission or run authority.
 * Main must own the prepared profile, scoped control token, pinned executable,
 * account-checked gateway and current persisted launch. The legacy PTY launcher
 * is deliberately not involved. Main's isolated runner owns composition.
 *
 * Conductor is intentionally unsupported: repeatedly spawning this one-shot
 * adapter would destroy its required long-lived conversation. No resume/fallback.
 */
export class ClaudeFreshSessionRuntime {
  private readonly launches = new Set<string>();
  private readonly sessions = new Set<string>();
  private readonly profiles = new Set<string>();
  private readonly gateways = new Set<string>();

  constructor(private readonly spawnProcess: Spawn = spawn) {}

  start(input: ClaudeFreshSessionInput) {
    if (!uuid.test(input.launchId) || !uuid.test(input.sessionId) ||
      !['implementer', 'critic', 'repairer'].includes(input.role) ||
      !/^claude-[a-z0-9-]{1,100}$/.test(input.model) ||
      typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 256 * 1024 ||
      !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 10 || input.timeoutMs > 24 * 60 * 60 * 1000 ||
      !Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 1000) {
      throw Error('invalid fresh Claude launch');
    }
    const { profile, controlClient, gateway } = input;
    if (profile.receipt.provider !== 'claude' || profile.receipt.role !== input.role ||
      createHash('sha256').update(readFileSync(profile.configPath)).digest('hex') !== profile.receipt.configSha256 ||
      !Number.isInteger(gateway.port) || gateway.port < 1 || gateway.port > 65535 ||
      gateway.url !== `http://127.0.0.1:${gateway.port}` || typeof gateway.close !== 'function' ||
      (input.role === 'critic' && !input.reviewEvidenceDirectory)) throw Error('mismatched isolated Claude profile');
    // Only reconstruct app-owned flags/environment. Do not spread inherited
    // process.env, client.env or mutable profile.args into a provider process.
    const tools = ['Read', 'Glob', 'Grep', 'Bash', ...(input.role === 'critic' ? [] : ['Write', 'Edit'])].join(',');
    const boundary = prepareSubscriptionSandbox({ artifact: input.artifact, profile, executable: input.executable,
      role: input.role, controlClient, providerBrokerPort: gateway.port, reviewEvidenceDirectory: input.reviewEvidenceDirectory });
    const args = [...boundary.args, '--restricted', '--setting-sources', '', '--settings', profile.configPath,
      '--strict-mcp-config', '--tools', tools, '--session-id', input.sessionId,
      ...(input.reviewEvidenceDirectory ? ['--add-dir', input.reviewEvidenceDirectory] : []),
      ...(existsSync(`${profile.providerHome}/skills`) ? ['--add-dir', `${profile.providerHome}/skills`] : []),
      '--print', '--model', input.model, '--output-format', 'stream-json', '--verbose', '--max-turns', String(input.maxTurns)];
    const env: Record<string, string> = {
      HOME: profile.home, TMPDIR: `${profile.scratch}/`,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', CLAUDE_CONFIG_DIR: profile.providerHome,
      CLAUDE_CODE_TMPDIR: profile.scratch, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_UPDATES: '1',
      ...controlNodeEnvironment(controlClient), OPERATUS_GAUNTLET_HELPER: controlClient.helperPath,
      ANTHROPIC_BASE_URL: gateway.url, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1'
    };
    const launchKey = input.launchId.toLowerCase(), sessionKey = input.sessionId.toLowerCase(), profileKey = realpathSync(profile.directory);
    const gatewayKey = gateway.url;
    if (this.launches.has(launchKey) || this.sessions.has(sessionKey) || this.profiles.has(profileKey) || this.gateways.has(gatewayKey)) {
      throw Error('fresh Claude launch, session, profile or gateway already claimed');
    }
    // Claims survive spawn/result failure. A retry needs a NEW persisted launch,
    // session and profile, not a second process carrying the old capability.
    this.launches.add(launchKey); this.sessions.add(sessionKey); this.profiles.add(profileKey);
    this.gateways.add(gatewayKey);
    const sessionId = input.sessionId;
    const closeGateway = gateway.close.bind(gateway);
    let revocation: Promise<ClaudeSessionExit['gatewayRevocation']> | undefined;
    const revoke = () => revocation ??= new Promise<ClaudeSessionExit['gatewayRevocation']>(resolve => {
      let resolved = false;
      const done = (outcome: ClaudeSessionExit['gatewayRevocation']) => {
        if (resolved) return;
        resolved = true; clearTimeout(deadline);
        // A newly opened gateway may later reuse this OS port. Failed/unknown
        // revocation retains the claim so another launch cannot inherit it.
        if (outcome === 'confirmed') this.gateways.delete(gatewayKey);
        resolve(outcome);
      };
      // A broken transport must not hang the controller or look successfully
      // revoked. Main must escalate an unconfirmed revocation, never pass a run.
      const deadline = setTimeout(() => done('unconfirmed'), 2000);
      try { Promise.resolve(closeGateway()).then(() => done('confirmed'), () => done('unconfirmed')); }
      catch { done('unconfirmed'); }
    });
    const receipt = (pid: number | null) => Object.freeze({ launchId: input.launchId, sessionId,
      role: input.role, model: input.model, pid, timeoutMs: input.timeoutMs, profileSha256: profile.receipt.configSha256,
      boundarySha256: boundary.receipt.profileSha256, outputLimits: NATIVE_OUTPUT_LIMITS, launchAllowed: false as const });
    let child: ChildProcessWithoutNullStreams;
    try { child = this.spawnProcess(boundary.command, args, { cwd: boundary.cwd, env, detached: true, stdio: 'pipe' }); }
    catch {
      const completion = revoke().then((gatewayRevocation): ClaudeSessionExit => ({ status: 'failed',
        reason: gatewayRevocation === 'confirmed' ? 'spawn_error' : 'gateway_revocation_failed',
        sessionId, exitCode: null, signal: null, processExited: false, descendantsQuiescent: false,
        gatewayRevocation, stdout: '', stderr: '', output: { receivedBytes: 0, stdoutBytes: 0, stderrBytes: 0,
          stdoutPreviewTruncated: false, stderrPreviewTruncated: false } }));
      return { completion, stop: () => {}, receipt: receipt(null) };
    }
    let resultText: string | undefined;
    const activity = claudeActivity(sessionId, input.onActivity ?? (() => {}));
    let reason: ClaudeSessionExit['reason'] | undefined, settled = false, exited = false;
    let exitCode: number | null = null, signal: NodeJS.Signals | null = null;
    let escalation: NodeJS.Timeout | undefined, drain: NodeJS.Timeout | undefined;
    let resolveExit!: (value: ClaudeSessionExit) => void;
    const completion = new Promise<ClaudeSessionExit>(resolve => { resolveExit = resolve; });
    const killGroup = (value: NodeJS.Signals) => {
      // Detached POSIX child owns this group. Never use a negative absent PID.
      if (child.pid && child.pid > 1) { try { process.kill(-child.pid, value); } catch { /* already exited */ } }
    };
    const finish = () => {
      if (settled) return;
      if (!reason) output.flush();
      settled = true; clearTimeout(timeout); clearTimeout(escalation); clearTimeout(drain);
      killGroup('SIGKILL');
      if (!reason) {
        try {
          const result = JSON.parse(resultText ?? 'null');
          if (result?.type !== 'result' || result.session_id !== sessionId || typeof result.is_error !== 'boolean') reason = 'invalid_result';
          else reason = exitCode === 0 && !result.is_error ? 'result' : 'provider_error';
        } catch { reason = 'invalid_result'; }
      }
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      const stoppedBecause = reason;
      void revoke().then(gatewayRevocation => {
        const finalReason = gatewayRevocation === 'confirmed' ? stoppedBecause : 'gateway_revocation_failed';
        resolveExit({ status: finalReason === 'result' ? 'completed' : finalReason === 'cancelled' ? 'cancelled' : finalReason === 'timeout' ? 'timed_out' : 'failed',
          reason: finalReason, sessionId, exitCode, signal, processExited: exited, descendantsQuiescent: false,
          gatewayRevocation, stdout: resultText ?? output.stdoutPreview, stderr: output.stderrPreview, output: output.stats });
      });
    };
    const stop = (why: NonNullable<typeof reason> = 'cancelled') => {
      if (settled || reason) return;
      reason = why;
      // Revoke network authority immediately, not after a stubborn child exits
      // or the caller eventually awaits completion. This also aborts in-flight
      // gateway requests. Process-group termination is a separate operation.
      void revoke();
      killGroup('SIGTERM');
      escalation = setTimeout(() => killGroup('SIGKILL'), 750);
      // Escaped descendants holding pipes must not keep the run controller hung.
      // Bounded return does not claim quiescence or authorize workspace removal.
      drain = setTimeout(finish, 1750);
    };
    const timeout = setTimeout(() => stop('timeout'), input.timeoutMs);
    const consume = (line: Buffer) => {
      if (reason || !line.length) return;
      try {
        const event = JSON.parse(line.toString('utf8'));
        if (!event || Array.isArray(event) || typeof event.type !== 'string' || resultText !== undefined ||
          (event.session_id !== undefined && event.session_id !== sessionId)) throw Error('Invalid native stream');
        if (event.type === 'result') {
          if (event.session_id !== sessionId || typeof event.is_error !== 'boolean') throw Error('Invalid result');
          resultText = line.toString('utf8');
        } else activity(event);
      } catch { stop('invalid_result'); }
    };
    const output = new NativeOutput(line => { consume(line); return !reason && !settled; }, () => stop('output_limit'));
    child.stdout.on('data', data => { if (!reason && !settled) output.accept('stdout', data); });
    child.stderr.on('data', data => { if (!reason && !settled) output.accept('stderr', data); });
    child.stdout.on('error', () => stop('spawn_error')); child.stderr.on('error', () => stop('spawn_error'));
    child.once('error', () => { stop('spawn_error'); });
    child.stdin.on('error', () => stop('spawn_error'));
    child.once('exit', (code, value) => {
      exited = true; exitCode = code; signal = value;
      if (settled) return;
      // `close` waits for inherited stdout/stderr descriptors. A tool child may
      // keep those open after the CLI root exits, so do not wait for `close` to
      // revoke its gateway and terminate the owned group. Preserve buffered
      // result parsing while bounding any remaining pipe drain independently.
      clearTimeout(timeout); void revoke(); killGroup('SIGKILL');
      drain ??= setTimeout(finish, 1750);
    });
    child.once('close', finish);
    // stdin avoids OS argv limits and exposing the task in process listings.
    child.stdin.end(input.prompt);
    return { completion, stop: () => stop(), receipt: receipt(child.pid ?? null) };
  }
}
