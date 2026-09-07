/** Explicit subscription-backed Codex Conductor choices. No silent fallback. */
export const CODEX_CONDUCTOR_MODELS = [
  'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
] as const;
export function codexConductorModel(model?: string): string {
  const selected = model ?? 'gpt-6-astra';
  if (!(CODEX_CONDUCTOR_MODELS as readonly string[]).includes(selected)) throw Error('Unsupported Codex Conductor model; no fallback is allowed');
  return selected;
}
