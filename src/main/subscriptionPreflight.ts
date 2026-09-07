import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { subscriptionLaunchError } from '../shared/billingPolicy';
import type { SubscriptionPreflight, SubscriptionProvider } from '../shared/subscriptionPreflight';
import { discoverExecutables } from './commandResolution';
import { hashExecutable } from './executableIdentity';
import { inspectNativeProviderVersion } from './nativeProviderVersion';

/** Read-only diagnostic, never a launch credential or an admission receipt.
 * Native CLI --version runs only in an offline, empty-profile sandbox.
 * No keychain command, shell, helper, token decoding, or network.
 * Untrusted file contents are reduced to fixed enums/booleans before IPC.
 */
export async function inspectSubscriptionSetup(provider: SubscriptionProvider, options: {
  home?: string; env?: NodeJS.ProcessEnv; executableDirectories?: string[];
} = {}): Promise<SubscriptionPreflight> {
  if (provider !== 'claude' && provider !== 'codex') throw new Error('unsupported subscription provider');
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const executables: SubscriptionPreflight['executables'] = [];
  for (const path of discoverExecutables(provider, { home, env, directories: options.executableDirectories })) {
    try {
      const sha256 = await hashExecutable(path);
      const versionObservation = await inspectNativeProviderVersion(provider, path, sha256);
      executables.push({ path, sha256, versionObservation });
    } catch { /* absent, symlink changed, or inaccessible: do not execute to discover */ }
  }
  // Deliberately inspect the normal profile only; custom-home env overrides are
  // flagged below, never followed to arbitrary locations supplied by a process.
  const profile = join(home, provider === 'claude' ? '.claude' : '.codex');
  const auth = readJson(join(profile, provider === 'claude' ? '.credentials.json' : 'auth.json'));
  const storedAuthHint = classifyStoredAuth(provider, auth);
  let configState: SubscriptionPreflight['configState'] = 'missing';
  let configRiskDetected = false;
  try {
    const bytes = readBoundedRegularFile(join(profile, provider === 'claude' ? 'settings.json' : 'config.toml'), 2 * 1024 * 1024);
    if (bytes) {
      configState = 'present';
      const text = bytes.toString('utf8');
      if (provider === 'claude') {
        const config = JSON.parse(text);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid settings');
        configRiskDetected = ['apiKeyHelper', 'env', 'hooks', 'mcpServers', 'enabledPlugins', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper']
          .some(key => Object.hasOwn(config, key)) || (config.forceLoginMethod !== undefined && config.forceLoginMethod !== 'claudeai');
      } else {
        // Conservative signal, not a TOML validator or proof of safe config.
        // Comments may flag a risk too. No user TOML is ever copied into a launch.
        configRiskDetected = /api[_-]?key|env_key|base_url|model_provider|profiles|mcp_servers|hooks|notify|bearer|credential|forced_login_method\s*=\s*["']api/i.test(text);
      }
    }
  } catch { configState = 'unreadable'; configRiskDetected = true; }
  const ambientCredentialOrRoutingDetected = Object.entries(env).some(([key, value]) => value &&
    /^(ANTHROPIC|OPENAI|AZURE_OPENAI|GROQ|OPENROUTER|CLAUDE_CONFIG_DIR|CLAUDE_CODE_USE_|CODEX_HOME|CODEX_ACCESS_TOKEN|AWS_|VERTEX|GOOGLE_APPLICATION_CREDENTIALS|NODE_OPTIONS|BASH_ENV|HTTPS?_PROXY|ALL_PROXY)/i.test(key));
  return {
    provider, launchAllowed: false, reason: subscriptionLaunchError(provider), executables,
    executableAmbiguous: executables.length > 1, storedAuthHint, configState,
    configRiskDetected, ambientCredentialOrRoutingDetected,
    authenticationVerified: false, noPaidOverageVerified: false, observedAt: Date.now()
  };
}

export function classifyStoredAuth(provider: SubscriptionProvider, value: unknown): SubscriptionPreflight['storedAuthHint'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const auth = value as Record<string, unknown>;
  const api = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0 ||
    typeof auth.apiKey === 'string' && auth.apiKey.length > 0 || auth.auth_mode === 'apikey';
  const subscription = provider === 'codex'
    ? auth.auth_mode === 'chatgpt' && !!auth.tokens && typeof auth.tokens === 'object' && !Array.isArray(auth.tokens)
    : !!auth.claudeAiOauth && typeof auth.claudeAiOauth === 'object' && !Array.isArray(auth.claudeAiOauth);
  if (api && subscription) return 'conflicting';
  return api ? 'api' : subscription ? 'subscription' : 'unknown';
}

function readJson(path: string): unknown {
  try {
    const bytes = readBoundedRegularFile(path, 256 * 1024);
    return bytes ? JSON.parse(bytes.toString('utf8')) : undefined;
  } catch { return undefined; }
}

function readBoundedRegularFile(path: string, limit: number): Buffer | undefined {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('diagnostic file unavailable'); // no path/content/provider output in errors
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('unsupported diagnostic file');
    return readFileSync(fd); // bounded regular files only; never follow auth-file links
  } finally { closeSync(fd); }
}
