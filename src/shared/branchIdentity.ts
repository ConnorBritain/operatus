/**
 * Visual identity for one Operatus execution branch (a daemon/workspace pair).
 * Branch themes are presentation only: they never alter provider, artifact,
 * authority, or Gauntlet protocol behavior.
 */
export const BRANCH_THEME_IDS = [
  'cedar', 'harbor', 'saffron', 'juniper', 'clay', 'iris',
  'moss', 'ember', 'coast', 'orchid', 'slate', 'sol'
] as const;

export type BranchThemeId = typeof BRANCH_THEME_IDS[number];

export interface BranchProfile {
  /** Human-readable location/machine label, e.g. "Mac Studio" or "Workshop West". */
  name: string;
  themeId: BranchThemeId;
}

export interface BranchThemeDefinition {
  id: BranchThemeId;
  label: string;
  accent: string;
  wash: string;
  ink: string;
}

export const BRANCH_THEMES: readonly BranchThemeDefinition[] = [
  { id: 'cedar', label: 'Cedar', accent: '#9d6548', wash: '#ead8ca', ink: '#51372d' },
  { id: 'harbor', label: 'Harbor', accent: '#557f91', wash: '#d5e4e8', ink: '#294854' },
  { id: 'saffron', label: 'Saffron', accent: '#c48a35', wash: '#f3e2bb', ink: '#624719' },
  { id: 'juniper', label: 'Juniper', accent: '#557967', wash: '#d7e3d9', ink: '#2d493b' },
  { id: 'clay', label: 'Clay', accent: '#b76f5b', wash: '#efd9d1', ink: '#66392f' },
  { id: 'iris', label: 'Iris', accent: '#76699f', wash: '#e2ddef', ink: '#423961' },
  { id: 'moss', label: 'Moss', accent: '#758150', wash: '#e1e4ce', ink: '#41482b' },
  { id: 'ember', label: 'Ember', accent: '#b85845', wash: '#efd3cb', ink: '#652d22' },
  { id: 'coast', label: 'Coast', accent: '#3f8c92', wash: '#d0e8e6', ink: '#245155' },
  { id: 'orchid', label: 'Orchid', accent: '#a36f91', wash: '#ead9e5', ink: '#593c50' },
  { id: 'slate', label: 'Slate', accent: '#627287', wash: '#dbe0e7', ink: '#354252' },
  { id: 'sol', label: 'Sol', accent: '#d18a55', wash: '#f2ddca', ink: '#70472b' }
] as const;

export const DEFAULT_BRANCH_PROFILE: BranchProfile = { name: 'Main Branch', themeId: 'cedar' };

export function branchTheme(id: BranchThemeId): BranchThemeDefinition {
  return BRANCH_THEMES.find((theme) => theme.id === id) ?? BRANCH_THEMES[0];
}

export function isBranchThemeId(value: unknown): value is BranchThemeId {
  return typeof value === 'string' && (BRANCH_THEME_IDS as readonly string[]).includes(value);
}

export function normalizeBranchProfile(value: Partial<BranchProfile> | null | undefined): BranchProfile {
  const name = typeof value?.name === 'string' && value.name.trim()
    ? value.name.trim().slice(0, 80)
    : DEFAULT_BRANCH_PROFILE.name;
  return { name, themeId: isBranchThemeId(value?.themeId) ? value.themeId : DEFAULT_BRANCH_PROFILE.themeId };
}
