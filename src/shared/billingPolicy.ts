/** Product invariant, not a user preference or an environment toggle.
 * Do not accept a renderer-supplied "subscription verified" boolean here.
 */
export const BILLING_POLICY = 'subscriptions-only' as const;
export const API_INFERENCE_ERROR = 'Operatus is subscription-only. API-backed inference, voice, and metered fallbacks are disabled.';
export const SUBSCRIPTION_LAUNCH_HOLD = 'Legacy agent startup is disabled because it inherits personal configuration. Use Runs for isolated subscription-only Gauntlets. No API fallback is permitted.';
export const SUBSCRIPTION_RUN_NOTICE = 'Gauntlets use isolated Claude and Codex subscription sessions. Login is checked before launch. Keep paid extras and automatic top-ups disabled in both accounts. API inference and legacy agent launches remain disabled.';

/** Enables only the isolated native runner, NOT the legacy PTY/hidden workers.
 * Account verification, pinned binaries and process confinement still execute
 * in the main-owned provider factories before each actual process starts.
 */
export function isolatedGauntletLaunchError(platform: string): string | null {
  return platform === 'darwin' ? null : 'Isolated subscription Gauntlets currently require macOS.';
}

export function apiInferenceError(): string {
  return API_INFERENCE_ERROR;
}

/** Legacy-only fail-closed interlock. These paths still inherit user
 * settings, keys and shell access; an OAuth login alone cannot prove no charges.
 * configuration. The isolated Gauntlet runner has its own admission boundary.
 */
export function subscriptionLaunchError(provider?: string): string {
  if (provider && provider !== 'claude' && provider !== 'codex') {
    return 'Operatus permits only verified Claude and Codex subscription sessions. This provider is disabled.';
  }
  return SUBSCRIPTION_LAUNCH_HOLD;
}

/** Ambient OS compatibility only. Unknown variables are omitted, even if their
 * names don't look like credentials. Explicit per-agent capabilities are merged
 * separately and must still be scrubbed. Personal HOME/config paths are retained
 * for legacy compatibility, so this is NOT a subscription isolation boundary.
 */
export function minimalHostEnvironment(input: Record<string, string | undefined>): Record<string, string> {
  const allowed = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM',
    'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'
  ]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  }
  return env;
}

/** Defense in depth for future admitted launches. Scrub AFTER every env merge.
 * This does not protect config files, rc scripts, credential helpers, or keys
 * a child can read from disk; it is not sufficient to lift the launch hold.
 */
export function withoutInferenceCredentials(input: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const key = name.toUpperCase();
    if (/^(ANTHROPIC|OPENAI|AZURE_OPENAI|GROQ|OPENROUTER|GEMINI|GOOGLE_API|CLAUDE|CODEX|AWS|BEDROCK|VERTEX)/.test(key)) continue;
    if (/(API_?KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|CREDENTIAL)/.test(key)) continue;
    if (/^(NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|ZDOTDIR|LD_PRELOAD|DYLD_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)$/.test(key)) continue;
    if (value !== undefined) result[name] = value;
  }
  return result;
}
