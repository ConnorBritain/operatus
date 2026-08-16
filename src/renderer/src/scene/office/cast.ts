// Atelier floor operators — roster metadata + sprite frames.
//
// Both the static portraits (cards / picker) and the in-scene walking sprites are
// now fully custom-drawn from the same per-character recipes in portraitArt.ts:
// the scene sprite reuses the portrait's exact head/face/clothing and adds legs,
// so an agent on the operations floor looks identical to its card. No legacy
// character sheets are used. See assets/ATTRIBUTION.md.

import { Texture } from 'pixi.js';
import { paintPortrait, sceneFrameBufs, SCENE_W, SCENE_H } from './portraitArt';

export type OfficeCharacterName =
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith';

export interface CastMember {
  name: OfficeCharacterName;
  displayName: string;
  /** Signature accent color (hex) — used for the in-scene selection glow. */
  shirt: string;
  /** Blurb shown when this character is picked / has no description yet. */
  blurb: string;
}

/** Selectable roster, in display order. */
export const OFFICE_CAST: CastMember[] = [
  { name: 'michael',  displayName: 'Conductor', shirt: '#596b8f', blurb: 'Owns intent and acknowledgment' },
  { name: 'jim',      displayName: 'Builder',   shirt: '#4f8fc9', blurb: 'Implements exact scoped changes' },
  { name: 'pam',      displayName: 'Navigator', shirt: '#75a58d', blurb: 'Repository and product orientation' },
  { name: 'dwight',   displayName: 'Analyst',   shirt: '#c49b45', blurb: 'Deep technical investigation' },
  { name: 'kevin',    displayName: 'Operator',  shirt: '#456fa8', blurb: 'Runs checks and captures evidence' },
  { name: 'angela',   displayName: 'Auditor',   shirt: '#807ca0', blurb: 'Verifies constraints and receipts' },
  { name: 'oscar',    displayName: 'Critic',    shirt: '#815170', blurb: 'Fresh independent review' },
  { name: 'stanley',  displayName: 'Sentry',    shirt: '#8f5f51', blurb: 'Watches budgets and convergence' },
  { name: 'phyllis',  displayName: 'Planner',   shirt: '#a77db8', blurb: 'Shapes bounded work packets' },
  { name: 'andy',     displayName: 'Integrator',shirt: '#63a36f', blurb: 'Tracks boundaries and compatibility' },
  { name: 'kelly',    displayName: 'Reporter',  shirt: '#c75b9a', blurb: 'Turns evidence into clear status' },
  { name: 'ryan',     displayName: 'Runner',    shirt: '#414653', blurb: 'Executes focused short missions' },
  { name: 'toby',     displayName: 'Custodian', shirt: '#94885b', blurb: 'Maintains policy and provenance' },
  { name: 'creed',    displayName: 'Probe',     shirt: '#66794f', blurb: 'Falsifies assumptions and edge cases' },
  { name: 'meredith', displayName: 'Repairer',  shirt: '#b05b54', blurb: 'Applies accepted bounded repairs' },
];

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries(OFFICE_CAST.map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

export const DEFAULT_CHARACTER: OfficeCharacterName = 'jim';

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ─── scene frames ────────────────────────────────────────────────────────────
const frameCache = new Map<OfficeCharacterName, Texture[][]>();

function bufToTexture(buf: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W; canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SCENE_W, SCENE_H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/**
 * Frame grid CharacterSprite expects: 3 rows (down, up, right) × 7 frames
 * [walk1, walk2, walk3, type1, type2, read1, read2]. We provide a front view
 * (down — and reused for the side row, so left/right walkers still show a face)
 * and a back view (up — agents seated facing their desk show their back). The
 * three walk frames are stand / step-left / step-right.
 */
export async function getCastFrames(name: OfficeCharacterName): Promise<Texture[][]> {
  const cached = frameCache.get(name);
  if (cached) return cached;
  const { front, back } = sceneFrameBufs(name);
  const toRow = (bufs: Uint8ClampedArray[]): Texture[] => {
    const [stand, stepL, stepR] = bufs.map(bufToTexture);
    return [stand, stepL, stepR, stand, stand, stand, stand];
  };
  const frontRow = toRow(front);
  const frames: Texture[][] = [frontRow, toRow(back), frontRow]; // down, up, right
  frameCache.set(name, frames);
  return frames;
}

/**
 * Paint a character's static portrait for cards / the picker (delegates to the
 * custom procedural composer in portraitArt.ts).
 */
export async function paintCastPortrait(
  ctx: CanvasRenderingContext2D,
  name: OfficeCharacterName,
  scale = 2,
): Promise<void> {
  paintPortrait(ctx, name, scale);
}
