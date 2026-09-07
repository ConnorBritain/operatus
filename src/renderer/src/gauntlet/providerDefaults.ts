import type { AgentProvider } from '@shared/agentProvider';
import { DEFAULT_CONDUCTOR_PROVIDER, DEFAULT_CONDUCTOR_MODEL } from '@shared/agentProvider';
import { DEFAULT_ROLE_PROVIDERS, type GauntletRole } from '@shared/gauntlet';

export function defaultRunProviders(config?: { godProvider?: AgentProvider; godModel?: string }) {
  const providers = Object.fromEntries(Object.entries(DEFAULT_ROLE_PROVIDERS).map(([role, provider]) =>
    [role, { provider }])) as Record<GauntletRole, { provider: AgentProvider; model?: string }>;
  const provider = config?.godProvider ?? DEFAULT_CONDUCTOR_PROVIDER;
  // Preserve explicit preferences, including unsupported ones, so admission can
  // explain the issue instead of silently selecting another model or provider.
  providers.conductor = { provider, model: config?.godModel ?? (provider === 'codex' ? DEFAULT_CONDUCTOR_MODEL : undefined) };
  return providers;
}
