import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeAccountAdmission } from '../claudeAccountAdmission';
import { ClaudeConductorSessionRuntime } from '../claudeConductorSession';
import { ClaudeFreshSessionRuntime } from '../claudeFreshSession';
import { copyPinnedNativeExecutable, hashExecutable } from '../executableIdentity';
import { inspectSubscriptionSetup } from '../subscriptionPreflight';
import { prepareSubscriptionProfile } from '../subscriptionProfile';
import { openClaudeSubscriptionGateway } from '../claudeSubscriptionGateway';
import { prepareControlClient } from './controlClient';
import type { PreparedLaunch } from './localBackend';
import type { IsolatedSessionFactory } from './isolatedRunner';
import type { SkillDepot } from './skillDepot';
import { prepareIsolatedSkills } from './isolatedSkills';
import { subscriptionEvidence } from './subscriptionEvidence';

// Narrow pilot pin already exercised by the native fixture. A provider update
// requires a new inspected pin, not automatic trust in a newer PATH executable.
const NATIVE_SHA = 'ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9';
const MODEL = 'claude-fable-5-1';

/** Main-only compositor. Constructing it performs no account or network work.
 * The caller's release hold is checked before preparation and immediately
 * before spawning. No user settings or real OAuth secret enter an agent home.
 * Codex is explicitly unsupported here, never silently replaced. */
export function createIsolatedClaudeFactory(input: {
  root: string; helperSource: string; nodePath: string; socketPath: () => string;
  reviewEvidenceRoot: string;
  skills?: SkillDepot;
  assertAdmissionOpen: () => void;
}, dependencies: {
  account?: ClaudeAccountAdmission;
  inspect?: typeof inspectSubscriptionSetup;
  gateway?: (input: Parameters<typeof openClaudeSubscriptionGateway>[0], prepared: PreparedLaunch) => ReturnType<typeof openClaudeSubscriptionGateway>;
} = {}): IsolatedSessionFactory {
  // Main/test composition only. No renderer or environment-supplied transport.
  const account = dependencies.account ?? new ClaudeAccountAdmission();
  const conductors = new ClaudeConductorSessionRuntime(), workers = new ClaudeFreshSessionRuntime();
  let pinned: Promise<string> | undefined;
  const executable = () => pinned ??= (async () => {
    const inspected = await (dependencies.inspect ?? inspectSubscriptionSetup)('claude');
    const match = inspected.executables.find(item => item.sha256 === NATIVE_SHA &&
      item.versionObservation.status === 'reported' && item.versionObservation.version === '2.1.263');
    if (!match) throw Error('The verified native Claude pilot executable is unavailable; no fallback was launched');
    await mkdir(input.root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(input.root, 'native-'));
    const destination = join(directory, 'claude');
    await copyPinnedNativeExecutable(match.path, destination, NATIVE_SHA);
    return destination;
  })();

  async function prepare(prepared: PreparedLaunch, signal: AbortSignal, beforeSpawn: () => void) {
    input.assertAdmissionOpen(); beforeSpawn(); signal.throwIfAborted();
    const launch = prepared.launch;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(launch.runId)) throw Error('Invalid run identity');
    if (process.platform !== 'darwin' || launch.provider !== 'claude' || (launch.model && launch.model !== MODEL)) {
      throw Error('This isolated pilot requires the inspected macOS Claude/Fable model; no provider or model fallback is allowed');
    }
    const binary = await executable(); signal.throwIfAborted();
    const profile = await prepareSubscriptionProfile(input.root, 'claude', launch.role);
    const skillGuidance = prepareIsolatedSkills({lock:prepared.skillLock,runId:launch.runId,launchId:launch.id,
      role:launch.role,providerHome:profile.providerHome,depot:input.skills});
    // A persistent lead needs read-only access to evidence produced later in
    // its own run. Never grant the parent containing other runs' evidence.
    const reviewEvidenceDirectory = launch.role === 'conductor' ? join(input.reviewEvidenceRoot, launch.runId) : launch.reviewEvidence?.directory;
    if (launch.role === 'conductor') await mkdir(reviewEvidenceDirectory!, { recursive: true, mode: 0o700 });
    signal.throwIfAborted();
    const client = prepareControlClient({ profile, helperSource: input.helperSource,
      expectedHelperSha256: createHash('sha256').update(await readFile(input.helperSource)).digest('hex'),
      nodePath: input.nodePath, socketPath: input.socketPath(), token: prepared.token });
    signal.throwIfAborted();
    const admitted = await account.verify();
    if (!admitted.ok) throw Error(`Claude subscription admission failed: ${admitted.reason}${
      admitted.reason === 'credential-expired' || admitted.reason === 'credential-unavailable'
        ? '. Open Claude Code and reconnect your Claude Max login, then start a new run.' : ''}`);
    let gateway: Awaited<ReturnType<typeof openClaudeSubscriptionGateway>> | undefined;
    try {
      signal.throwIfAborted(); input.assertAdmissionOpen(); beforeSpawn();
      const gatewayInput = { account, identity: admitted.receipt, model: MODEL, maxRequests: 512 };
      gateway = await (dependencies.gateway ? dependencies.gateway(gatewayInput, prepared) : openClaudeSubscriptionGateway(gatewayInput));
      // This is a revocable local routing capability, not an Anthropic secret.
      // There is no refresh token, API key, imported config, or external URL.
      await writeFile(join(profile.providerHome, '.credentials.json'), JSON.stringify({ claudeAiOauth: {
        accessToken: gateway.localToken, expiresAt: Date.now() + 3 * 60 * 60 * 1000,
        scopes: ['user:inference', 'user:profile'], subscriptionType: 'max'
      } }), { flag: 'wx', mode: 0o400 });
      if (await hashExecutable(binary) !== NATIVE_SHA) throw Error('Private native executable identity changed');
      signal.throwIfAborted(); input.assertAdmissionOpen(); beforeSpawn();
      return { profile, executable: binary, controlClient: client.capability, gateway,
        admission: subscriptionEvidence(admitted.receipt, { version: '2.1.263', sha256: NATIVE_SHA, model: MODEL,
          source: Object.keys(dependencies).length ? 'injected-dependencies' : 'provider-metadata' }),
        model: MODEL, launchId: launch.id, sessionId: launch.sessionId, artifact: launch.worktreePath,
        reviewEvidenceDirectory, maxTurns: 100, skillGuidance };
    } catch (error) { await gateway?.close(); throw error; }
    finally { account.revoke(admitted.receipt); }
  }

  return {
    supportsLockedSkills: true,
    async conductor(prepared, signal, beforeSpawn, budget, onActivity, onAdmission) {
      input.assertAdmissionOpen();
      if (typeof onAdmission !== 'function') throw Error('Durable subscription evidence writer is required before preparation');
      if (prepared.launch.role !== 'conductor') throw Error('Expected Conductor launch');
      const common = await prepare(prepared, signal, beforeSpawn);
      try {
        signal.throwIfAborted(); input.assertAdmissionOpen(); beforeSpawn();
        onAdmission(common.admission);
        signal.throwIfAborted(); input.assertAdmissionOpen(); beforeSpawn();
        const handle = conductors.start({ ...common, role: 'conductor', ...budget(), maxMessages: 64, onActivity });
        return {...handle,orientationPrompt:prepared.prompt+common.skillGuidance};
      } catch (error) { await common.gateway.close(); throw error; }
    },
    async worker(prepared, signal, beforeSpawn, budget, onActivity, onAdmission) {
      input.assertAdmissionOpen();
      if (typeof onAdmission !== 'function') throw Error('Durable subscription evidence writer is required before preparation');
      if (prepared.launch.role === 'conductor') throw Error('Expected fresh worker launch');
      const common = await prepare(prepared, signal, beforeSpawn);
      try {
        signal.throwIfAborted(); input.assertAdmissionOpen(); beforeSpawn();
        onAdmission(common.admission);
        signal.throwIfAborted(); input.assertAdmissionOpen(); beforeSpawn();
        return workers.start({ ...common, role: prepared.launch.role, prompt: prepared.prompt+common.skillGuidance,
          timeoutMs: budget().timeoutMs, onActivity });
      } catch (error) { await common.gateway.close(); throw error; }
    }
  };
}
