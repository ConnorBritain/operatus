import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import type { prepareSubscriptionProfile } from './subscriptionProfile';
import { prepareSubscriptionSandbox } from './subscriptionSandbox';
import type { PreparedControlClient } from './gauntlet/controlClient';
import { controlNodeEnvironment } from './gauntlet/controlClient';
import type { ToolActivity } from '../shared/gauntlet';
import { NativeOutput, NATIVE_OUTPUT_LIMITS, type NativeOutputStats } from './nativeOutput';
import type { ConductorSessionExit, ConductorTurnReceipt } from './claudeConductorSession';

export interface CodexFreshSessionInput {
  launchId: string; sessionId: string; role: 'critic'; model: string; prompt: string; artifact: string;
  profile: Awaited<ReturnType<typeof prepareSubscriptionProfile>>;
  /** Main copies and digest-verifies both executables before calling start. */
  executable: string; codeModeHost: string; controlClient: PreparedControlClient;
  gateway: { port: number; url: string; close: () => Promise<void> };
  reviewEvidenceDirectory: string; timeoutMs: number;
  /** Synchronous durable recording. Failure aborts rather than losing identity. */
  onIdentity: (identity: { threadId: string; turnId: string | null }) => void;
  onActivity?: (event: ToolActivity) => void;
}
export interface CodexSessionExit {
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  reason: 'result' | 'provider_error' | 'invalid_result' | 'spawn_error' | 'output_limit' | 'cancelled' | 'timeout' | 'gateway_revocation_failed';
  sessionId: string; threadId: string | null; turnId: string | null;
  exitCode: number | null; signal: NodeJS.Signals | null; processExited: boolean;
  descendantsQuiescent: false; gatewayRevocation: 'confirmed' | 'unconfirmed';
  stdout: string; stderr: string; output: NativeOutputStats;
  turnsCompleted: number;
}
export type CodexConductorSessionInput = Omit<CodexFreshSessionInput, 'role' | 'prompt'> & {
  role: 'conductor'; turnTimeoutMs: number; maxMessages: number;
};
type SessionInput = Omit<CodexFreshSessionInput, 'role' | 'prompt'> & {
  role: 'critic' | 'conductor'; prompt?: string; turnTimeoutMs?: number; maxMessages?: number;
};
type Spawn = (command: string, args: string[], options: {
  cwd: string; env: Record<string, string>; detached: true; stdio: 'pipe';
}) => ChildProcessWithoutNullStreams;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const nativeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** A fresh app-server process/thread per launch: one turn for Critics, bounded
 * sequential turns for Conductors. No imported history, fork, fallback, role
 * switching or self-grading authority. The mandatory
 * outer sandbox remains the filesystem/network boundary even though Codex uses
 * externalSandbox for native tools (nested Seatbelt application is unsupported).
 * Completion is transport evidence only; the scoped helper/backend owns reports.
 */
export class CodexFreshSessionRuntime {
  private readonly launches = new Set<string>();
  private readonly sessions = new Set<string>();
  private readonly profiles = new Set<string>();
  private readonly gateways = new Set<string>();
  private readonly threads = new Set<string>();
  private readonly turns = new Set<string>();
  constructor(private readonly spawnProcess: Spawn = spawn) {}

  start(input: CodexFreshSessionInput) {
    if (input.role !== 'critic' || typeof input.prompt !== 'string' || !input.prompt.trim() ||
      Buffer.byteLength(input.prompt) > 256 * 1024) throw Error('invalid fresh Codex launch');
    return this.startSession(input);
  }

  /** Same transport and confinement as a Critic, but one thread owns sequential
   * lead turns. No fresh-worker resume, external history import, or role switch. */
  startConductor(input: CodexConductorSessionInput) {
    if (input.role !== 'conductor' || !Number.isSafeInteger(input.turnTimeoutMs) ||
      input.turnTimeoutMs < 10 || input.turnTimeoutMs > input.timeoutMs ||
      !Number.isSafeInteger(input.maxMessages) || input.maxMessages < 1 || input.maxMessages > 1000) throw Error('invalid Codex Conductor launch');
    const handle = this.startSession(input);
    return { ...handle, pid: handle.receipt.pid,
      completion: handle.completion.then((exit): ConductorSessionExit => ({
        reason: exit.reason === 'result' ? 'finished' : exit.reason === 'invalid_result' ? 'invalid_stream' : exit.reason,
        sessionId: exit.sessionId, processExited: exit.processExited, descendantsQuiescent: false,
        gatewayRevocation: exit.gatewayRevocation, exitCode: exit.exitCode, turnsCompleted: exit.turnsCompleted,
        stderr: exit.stderr, output: exit.output,
      })) };
  }

  private startSession(input: SessionInput) {
    if (!uuid.test(input.launchId) || !uuid.test(input.sessionId) ||
      !/^gpt-[a-z0-9.-]{1,100}$/.test(input.model) || typeof input.onIdentity !== 'function' ||
      !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 10 ||
      input.timeoutMs > (input.role === 'conductor' ? 7 : 1) * 24 * 60 * 60 * 1000) throw Error('invalid fresh Codex launch');
    const persistent = input.role === 'conductor';
    const maxMessages = input.maxMessages, turnTimeoutMs = input.turnTimeoutMs;
    const { profile, gateway, controlClient } = input;
    const model = input.model, prompt = input.prompt, onIdentity = input.onIdentity, onActivity = input.onActivity;
    const recordIdentity = (value: { threadId: string; turnId: string | null }) => {
      const result: unknown = onIdentity(value);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('native identity recording must complete synchronously');
      }
    };
    if (profile.receipt.provider !== 'codex' || profile.receipt.role !== input.role || !input.reviewEvidenceDirectory ||
      createHash('sha256').update(readFileSync(profile.configPath)).digest('hex') !== profile.receipt.configSha256 ||
      !Number.isInteger(gateway.port) || gateway.port < 1 || gateway.port > 65535 ||
      gateway.url !== `http://127.0.0.1:${gateway.port}` || typeof gateway.close !== 'function') throw Error('mismatched isolated Codex profile');
    const boundary = prepareSubscriptionSandbox({ artifact: input.artifact, profile, executable: input.executable,
      codexCodeModeHost: input.codeModeHost, role: input.role, controlClient, providerBrokerPort: gateway.port,
      reviewEvidenceDirectory: input.reviewEvidenceDirectory });
    const args = [...boundary.args, '--strict-config', '-c', `chatgpt_base_url="${gateway.url}"`,
      '-c', `openai_base_url="${gateway.url}/codex"`, 'app-server'];
    const env: Record<string, string> = { HOME: profile.home, TMPDIR: `${profile.scratch}/`,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', CODEX_HOME: profile.providerHome,
      ...controlNodeEnvironment(controlClient), OPERATUS_GAUNTLET_HELPER: controlClient.helperPath };
    const launch = input.launchId.toLowerCase(), sessionId = input.sessionId, session = sessionId.toLowerCase();
    const directory = realpathSync(profile.directory), gatewayKey = gateway.url;
    if (this.launches.has(launch) || this.sessions.has(session) || this.profiles.has(directory) || this.gateways.has(gatewayKey)) {
      throw Error('fresh Codex launch, session, profile or gateway already claimed');
    }
    this.launches.add(launch); this.sessions.add(session); this.profiles.add(directory); this.gateways.add(gatewayKey);
    const closeGateway = gateway.close.bind(gateway);
    let revocation: Promise<CodexSessionExit['gatewayRevocation']> | undefined;
    const revoke = () => revocation ??= new Promise<CodexSessionExit['gatewayRevocation']>(resolve => {
      let settled = false;
      const done = (value: CodexSessionExit['gatewayRevocation']) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (value === 'confirmed') this.gateways.delete(gatewayKey);
        resolve(value);
      };
      const timer = setTimeout(() => done('unconfirmed'), 2000);
      try { Promise.resolve(closeGateway()).then(() => done('confirmed'), () => done('unconfirmed')); }
      catch { done('unconfirmed'); }
    });
    const receipt = (pid: number | null) => Object.freeze({ launchId: input.launchId, sessionId, role: input.role,
      model: input.model, pid, timeoutMs: input.timeoutMs, profileSha256: profile.receipt.configSha256,
      boundarySha256: boundary.receipt.profileSha256, outputLimits: NATIVE_OUTPUT_LIMITS, launchAllowed: false as const });
    let child: ChildProcessWithoutNullStreams;
    try { child = this.spawnProcess(boundary.command, args, { cwd: boundary.cwd, env, detached: true, stdio: 'pipe' }); }
    catch {
      const completion = revoke().then((gatewayRevocation): CodexSessionExit => ({ status: 'failed',
        reason: gatewayRevocation === 'confirmed' ? 'spawn_error' : 'gateway_revocation_failed', sessionId, threadId: null, turnId: null,
        exitCode: null, signal: null, processExited: false, descendantsQuiescent: false, gatewayRevocation, stdout: '', stderr: '', turnsCompleted: 0,
        output: { receivedBytes: 0, stdoutBytes: 0, stderrBytes: 0, stdoutPreviewTruncated: false, stderrPreviewTruncated: false } }));
      return { receipt: receipt(null), completion, stop: () => {}, finish: () => {},
        send: (_id: string, _text: string): Promise<ConductorTurnReceipt> => { throw Error('Conductor session is closed'); } };
    }
    let phase: 'initialize' | 'thread' | 'idle' | 'turn' | 'stream' | 'done' = 'initialize';
    let threadId: string | null = null, turnId: string | null = null, finalText: string | undefined;
    let reason: CodexSessionExit['reason'] | undefined, settled = false, exited = false;
    let exitCode: number | null = null, signal: NodeJS.Signals | null = null;
    let termination: NodeJS.Timeout | undefined, escalation: NodeJS.Timeout | undefined, drain: NodeJS.Timeout | undefined, ordinal = 0;
    const items = new Map<string, { type: string; completed: boolean }>();
    const pendingTurnEvents: Buffer[] = [];
    let requestId = 3, turnsCompleted = 0;
    let turnTimer: NodeJS.Timeout | undefined;
    const messages = new Set<string>();
    let pending: { id: string; text: string; resolve: (receipt: ConductorTurnReceipt) => void } | undefined;
    let pendingTurnBytes = 0;
    let resolveExit!: (value: CodexSessionExit) => void;
    const completion = new Promise<CodexSessionExit>(resolve => resolveExit = resolve);
    const killGroup = (value: NodeJS.Signals) => { if (child.pid && child.pid > 1) { try { process.kill(-child.pid, value); } catch { /* exited */ } } };
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
    const finish = () => {
      if (settled) return;
      if (!reason) output.flush();
      settled = true; clearTimeout(timeout); clearTimeout(turnTimer); clearTimeout(termination); clearTimeout(escalation); clearTimeout(drain); killGroup('SIGKILL');
      reason ??= phase !== 'done' || finalText === undefined ? 'invalid_result' : exitCode !== 0 ? 'provider_error' : 'result';
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      const stoppedBecause = reason;
      void revoke().then(gatewayRevocation => {
        const finalReason = gatewayRevocation === 'confirmed' ? stoppedBecause : 'gateway_revocation_failed';
        pending?.resolve({ messageId: pending.id, sessionId, ok: false, text: '',
          failure: finalReason === 'invalid_result' ? 'invalid_stream' : finalReason === 'result' ? 'unexpected_exit' : finalReason });
        pending = undefined;
        resolveExit({ status: finalReason === 'result' ? 'completed' : finalReason === 'cancelled' ? 'cancelled' : finalReason === 'timeout' ? 'timed_out' : 'failed',
          reason: finalReason, sessionId, threadId, turnId, exitCode, signal, processExited: exited, descendantsQuiescent: false,
          gatewayRevocation, stdout: finalText ?? output.stdoutPreview, stderr: output.stderrPreview, output: output.stats, turnsCompleted });
      });
    };
    const stop = (why: NonNullable<typeof reason> = 'cancelled') => {
      if (settled || reason) return; reason = why; void revoke();
      let interrupted = false;
      if (threadId && turnId && child.stdin.writable) {
        try { send({ id: -1, method: 'turn/interrupt', params: { threadId, turnId } }); interrupted = true; } catch { /* termination remains authoritative */ }
      }
      // Native command tools may own separate process groups. Killing the CLI
      // immediately can orphan them before it processes turn/interrupt. Revoke
      // network authority now, but allow bounded native tool cleanup first.
      if (interrupted) termination = setTimeout(() => killGroup('SIGTERM'), 500); else killGroup('SIGTERM');
      escalation = setTimeout(() => killGroup('SIGKILL'), interrupted ? 1250 : 750);
      clearTimeout(drain); drain = setTimeout(finish, interrupted ? 2250 : 1750);
    };
    const timeout = setTimeout(() => stop('timeout'), input.timeoutMs);
    const beginTurn = (text: string) => {
      phase = 'turn'; finalText = undefined; turnId = null; items.clear();
      send({ id: requestId, method: 'turn/start', params: { threadId,
        // Codex's inner mode cannot widen the mandatory outer read-only sandbox.
        sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' },
        input: [{ type: 'text', text }] } });
    };
    const consume = (line: Buffer) => {
      if (!line.length) return;
      if (reason) {
        // Only use the matching terminal notification to close stdin while
        // stopping. It cannot replace the existing cancellation/failure reason.
        try {
          const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (event.method === 'turn/completed' && event.params?.threadId === threadId && event.params?.turn?.id === turnId) child.stdin.end();
        } catch { /* bounded termination still applies */ }
        return;
      }
      try {
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('invalid native message');
        if (message.method && message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: 'No additional authority is available to this role' } });
          stop('provider_error'); return;
        }
        if (message.id !== undefined) {
          if (message.error) { stop('provider_error'); return; }
          if (message.id === 1 && phase === 'initialize' && message.result) {
            phase = 'thread'; send({ method: 'initialized', params: {} });
            send({ id: 2, method: 'thread/start', params: { cwd: boundary.cwd, model, modelProvider: 'openai',
              allowProviderModelFallback: false, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true } });
          } else if (message.id === 2 && phase === 'thread' && nativeId(message.result?.thread?.id)) {
            const effective = message.result;
            if (effective.model !== model || effective.modelProvider !== 'openai' || effective.cwd !== boundary.cwd ||
              effective.approvalPolicy !== 'never' || effective.sandbox?.type !== 'readOnly' || effective.sandbox.networkAccess !== false ||
              (effective.serviceTier != null && effective.serviceTier !== 'default')) throw Error('effective native configuration changed');
            const id = message.result.thread.id;
            if (this.threads.has(id)) throw Error('native thread reused'); this.threads.add(id); threadId = id;
            recordIdentity({ threadId: id, turnId: null });
            phase = 'idle';
            if (!persistent) beginTurn(prompt!);
            else if (pending) beginTurn(pending.text);
          } else if (message.id === requestId && phase === 'turn' && nativeId(message.result?.turn?.id) && message.result.turn.status === 'inProgress') {
            const id = message.result.turn.id;
            if (this.turns.has(id)) throw Error('native turn reused'); this.turns.add(id); turnId = id;
            recordIdentity({ threadId: threadId!, turnId: id }); phase = 'stream';
            // Native app-server can emit turn/started before this response.
            // Only the response establishes identity; replay through the same
            // strict validator after its synchronous durable acknowledgment.
            const pending = pendingTurnEvents.splice(0); pendingTurnBytes = 0;
            for (const event of pending) { if (reason) break; consume(event); }
          } else throw Error('unexpected native response');
          return;
        }
        if (typeof message.method !== 'string') throw Error('missing native method');
        const p = message.params;
        if (message.method === 'model/rerouted' || message.method === 'model/verification') { stop('provider_error'); return; }
        if (phase === 'turn' && (message.method.startsWith('turn/') || message.method.startsWith('item/') || p?.turnId !== undefined)) {
          if ((p?.threadId !== undefined && p.threadId !== threadId) || pendingTurnEvents.length >= 64 ||
            pendingTurnBytes + line.length > 256 * 1024) throw Error('invalid pending native event');
          pendingTurnBytes += line.length; pendingTurnEvents.push(Buffer.from(line));
          return; // Neither activity nor completion is accepted provisionally.
        }
        if ((p?.threadId !== undefined && p.threadId !== threadId) || (p?.turnId !== undefined && p.turnId !== turnId)) throw Error('foreign native identity');
        if (message.method === 'turn/plan/updated' || message.method === 'turn/diff/updated') {
          if (phase !== 'stream' || p?.turnId !== turnId) throw Error('unowned plan or diff');
          return; // Advisory native progress is not the frozen contract or artifact.
        }
        if (message.method.startsWith('item/') || message.method.startsWith('turn/')) {
          if (phase !== 'stream' || p?.threadId !== threadId) throw Error('native event outside owned turn');
          if (message.method.startsWith('item/')) {
            if (p.turnId !== turnId) throw Error('foreign item turn');
            if (message.method === 'item/started') {
              const item = p.item;
              if (!nativeId(item?.id) || typeof item.type !== 'string' || items.has(item.id) || items.size >= 1024) throw Error('invalid native item');
              items.set(item.id, { type: item.type, completed: false });
              if (item.type === 'commandExecution') onActivity?.({ type: 'tool_activity', ordinal: ++ordinal, activity: 'executing', stage: 'requested' });
            } else if (message.method === 'item/completed') {
              const item = p.item, started = items.get(item?.id);
              if (!started || started.completed || started.type !== item.type) throw Error('unowned or duplicate native item');
              started.completed = true;
              if (item.type === 'commandExecution') onActivity?.({ type: 'tool_activity', ordinal: ++ordinal, activity: 'executing', stage: 'result',
                outcome: item.status === 'completed' && item.exitCode === 0 ? 'ok' : 'error' });
              if (item.type === 'agentMessage' && item.phase === 'final_answer') {
                if (finalText !== undefined || typeof item.text !== 'string' || !item.text.trim() || Buffer.byteLength(item.text) > 256 * 1024) throw Error('invalid final answer');
                finalText = item.text;
              }
            }
          } else {
            if (p.turn?.id !== turnId) throw Error('foreign terminal turn');
            if (message.method === 'turn/completed') {
              if (p.turn.status !== 'completed' || p.turn.error != null) { stop('provider_error'); return; }
              if (finalText === undefined || [...items.values()].some(item => !item.completed)) throw Error('incomplete native result');
              turnsCompleted++;
              if (persistent) {
                if (!pending) throw Error('unassigned Conductor result');
                clearTimeout(turnTimer); phase = 'idle'; requestId++;
                const delivered = pending; pending = undefined;
                delivered.resolve({ messageId: delivered.id, sessionId, ok: true, text: finalText });
              } else {
                phase = 'done'; void revoke(); child.stdin.end();
                drain ??= setTimeout(() => stop('provider_error'), 1750);
              }
            } else if (message.method !== 'turn/started') throw Error('unexpected turn notification');
          }
        }
      } catch { stop('invalid_result'); }
    };
    const output = new NativeOutput(line => { consume(line); return !settled; }, () => stop('output_limit'));
    child.stdout.on('data', bytes => { if (!settled) output.accept('stdout', bytes); });
    child.stderr.on('data', bytes => { if (!settled) output.accept('stderr', bytes); });
    child.stdout.on('error', () => stop('spawn_error')); child.stderr.on('error', () => stop('spawn_error'));
    child.stdin.on('error', () => stop('spawn_error')); child.once('error', () => stop('spawn_error'));
    child.once('exit', (code, value) => {
      exited = true; exitCode = code; signal = value;
      if (settled) return;
      clearTimeout(timeout); void revoke(); killGroup('SIGKILL'); drain ??= setTimeout(finish, 1750);
    });
    child.once('close', finish);
    try { send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'operatus', version: '0.1.0' } } }); }
    catch { stop('spawn_error'); }
    return { completion, stop: () => stop(), receipt: receipt(child.pid ?? null),
      send: (messageId: string, text: string): Promise<ConductorTurnReceipt> => {
        if (!persistent || settled || reason || phase === 'done') throw Error('Conductor session is closed');
        if (pending) throw Error('Conductor already has an in-flight turn');
        if (!uuid.test(messageId) || messages.has(messageId.toLowerCase()) || messages.size >= maxMessages! ||
          typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 256 * 1024) throw Error('invalid or duplicate Conductor message');
        messages.add(messageId.toLowerCase());
        const result = new Promise<ConductorTurnReceipt>(resolve => { pending = { id: messageId, text, resolve }; });
        turnTimer = setTimeout(() => stop('timeout'), turnTimeoutMs!);
        if (phase === 'idle') { try { beginTurn(text); } catch { stop('spawn_error'); } }
        return result;
      },
      finish: () => {
        if (!persistent || settled || reason || phase === 'done') return;
        if (pending || !turnsCompleted || phase !== 'idle') throw Error('Conductor cannot finish before its turn completes');
        phase = 'done'; void revoke(); child.stdin.end();
        drain ??= setTimeout(() => stop('timeout'), 3000);
      },
    };
  }
}
