import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { SubscriptionProvider } from '../shared/subscriptionPreflight';
import type { GauntletRole } from '../shared/gauntlet';

/** App-authored configuration only. No user config, hooks, helper, MCP server,
 * API credential, provider URL, remote daemon or shell environment is copied.
 * These are preparation primitives, NOT launch admission. Authentication and
 * role-specific filesystem/network confinement still need separate validation.
 */
export const CLAUDE_SUBSCRIPTION_SETTINGS = Object.freeze({
  forceLoginMethod: 'claudeai',
  disableAllHooks: true,
  disableClaudeAiConnectors: true,
  permissions: Object.freeze({ defaultMode: 'plan' })
});

export const CODEX_SUBSCRIPTION_SETTINGS = `# Operatus-owned subscription profile. No imported user configuration.
forced_login_method = "chatgpt"
cli_auth_credentials_store = "file"
model_provider = "openai"
allow_login_shell = false
check_for_update_on_startup = false
approval_policy = "never"
sandbox_mode = "read-only"

[features]
hooks = false
apps = false
shell_snapshot = false
remote_plugin = false
plugins = false
enable_request_compression = false

[analytics]
enabled = false

[agents]
enabled = false
`;

/** Allocate only NEW private directories below an existing app-owned root.
 * No API for accepting a user's existing HOME, settings or auth.json. Secrets
 * must eventually arrive via a validated subscription credential broker, not
 * a symlink back to a mutable personal profile. No real credential writes yet.
 */
export async function prepareSubscriptionProfile(root: string, provider: SubscriptionProvider, role?: GauntletRole) {
  if (provider !== 'claude' && provider !== 'codex') throw new Error('unsupported subscription provider');
  if (role !== undefined && (!['conductor','implementer','critic','repairer'].includes(role) || (provider === 'codex' && role !== 'critic' && role !== 'conductor'))) {
    throw new Error('unsupported provider role profile');
  }
  if (!isAbsolute(root) || /[\u0000-\u001f\u007f]/.test(root)) throw new Error('absolute profile root required');
  const canonicalRoot = await realpath(root);
  const directory = await mkdtemp(join(canonicalRoot, 'subscription-'));
  const home = join(directory, 'home');
  const scratch = join(directory, 'tmp');
  const providerHome = join(home, provider === 'claude' ? '.claude' : '.codex');
  await mkdir(home, { mode: 0o700 });
  await mkdir(scratch, { mode: 0o700 });
  await mkdir(providerHome, { mode: 0o700 });
  const writes = role === 'implementer' || role === 'repairer';
  // Explicit Claude role profiles are for the outer-confined launcher only.
  // The inspection/default profile stays in plan mode. Bash permission is not
  // filesystem/network authority: the mandatory outer boundary supplies that.
  const claudeSettings = role ? { ...CLAUDE_SUBSCRIPTION_SETTINGS, permissions: {
    defaultMode:'dontAsk', disableBypassPermissionsMode:'disable', disableAutoMode:'disable',
    allow:['Read','Glob','Grep','Bash',...(writes?['Write','Edit']:[])],
    deny:['Agent','WebFetch','WebSearch','EnterPlanMode','ExitPlanMode','Bash(run_in_background:true)',...(writes?[]:['Write','Edit'])]
  } } : CLAUDE_SUBSCRIPTION_SETTINGS;
  const content = provider === 'claude' ? JSON.stringify(claudeSettings, null, 2) : CODEX_SUBSCRIPTION_SETTINGS;
  const configPath = join(providerHome, provider === 'claude' ? 'settings.json' : 'config.toml');
  await writeFile(configPath, content, { flag: 'wx', mode: 0o400 });
  const env: Record<string, string> = {
    HOME: home, TMPDIR: `${scratch}/`, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0'
  };
  const args: string[] = [];
  if (provider === 'claude') {
    Object.assign(env, {
      CLAUDE_CONFIG_DIR: providerHome,
      CLAUDE_CODE_TMPDIR: scratch,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_UPDATES: '1'
    });
    // Do not use --bare or CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: both suppress
    // the stored subscription OAuth path in the tested native CLI. Restricted mode skips
    // user/project/local settings; only our explicit file and managed policy apply.
    // No --mcp-config argument means strict mode admits no configured servers.
    args.push('--restricted', '--setting-sources', '', '--settings', configPath, '--strict-mcp-config');
    // Restricted mode removes command tools unless named individually here.
    // Do not opt back into the broad "default" tool set or remove restricted mode.
    if (role) args.push('--tools', ['Read','Glob','Grep','Bash',...(writes?['Write','Edit']:[])].join(','));
  } else {
    env.CODEX_HOME = providerHome;
    args.push('--strict-config');
  }
  return {
    directory, home, providerHome, scratch, configPath, env, args,
    receipt: {
      provider, profile: 'operatus-subscription-profile-v1' as const,
      configSha256: createHash('sha256').update(content).digest('hex'),
      role: role ?? 'inspection',
      credentialState: 'absent' as const, launchAllowed: false as const
    }
  };
}

/** Claude's auth status can return exit 0 for a completely invalid API key.
 * Reduce its output to a hint; never treat loggedIn, exit 0, or the forced-login
 * label as authentication proof. No returned field contains provider output.
 */
export function classifyClaudeAuthStatus(value: unknown): 'subscription-hint' | 'forbidden-auth' | 'not-logged-in' | 'unknown' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const report = value as Record<string, unknown>;
  if (report.apiProvider !== 'firstParty' || report.apiKeySource || report.authMethod === 'api_key') return 'forbidden-auth';
  if (report.loggedIn === false && report.authMethod === 'none') return 'not-logged-in';
  if (report.loggedIn === true && (report.authMethod === 'oauth_token' || report.authMethod === 'claude.ai')) return 'subscription-hint';
  return 'unknown';
}
