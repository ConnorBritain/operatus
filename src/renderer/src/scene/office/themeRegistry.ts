// Ventura floor theme contract. The scene engine remains the proven Munder
// Pixi/pathfinding implementation; the distributable map and art are clean-room
// Original Ventura assets, loaded independently from historical theme packs.

import type { Texture } from 'pixi.js';
import { colors } from '@/design/tokens';
import { CAST_BY_NAME, getCastFrames, DEFAULT_CHARACTER, type CastMember, type OfficeCharacterName } from './cast';
import venturaFloorUrl from '@/assets/ventura/ventura-operations-floor.png?url';
import venturaMapRaw from '@/assets/maps/ventura-operations.tmj?raw';

/** Legacy ids remain accepted as config aliases so an upstream profile import
 * cannot strand the renderer; every id resolves to the Ventura floor. */
export type ThemeId = 'office' | 'friends' | 'brooklyn99' | 'siliconvalley' | 'got' | 'hogwarts';
export interface Tile { x: number; y: number }
export type Facing = 'up' | 'down' | 'left' | 'right';
export type ErrandKind = 'water' | 'window' | 'dispenser' | 'fridge' | 'shelf' | 'bin' | 'smoke';
export interface ErrandSpot { kind: ErrandKind; stand: Tile; facing: Facing; fx: Tile; duration: number; godOnly?: boolean }
export interface TilesetEntry { url: string; embedded?: boolean; firstgid?: number; image?: string; imagewidth?: number; imageheight?: number; tilewidth?: number; tileheight?: number; columns?: number; tilecount?: number }
export interface MonitorConfig { offTopLeftGid: number; onGids: ReadonlyArray<readonly [number, number, number]> }
export interface CoffeeConfig { trayTile: Tile; trayStand: Tile; machineStand: Tile; sinkTile: Tile; sinkStand: Tile; maxCups: number }
export interface AnchorConfig { calendar: Tile; boards: Tile; clock: Tile }
export interface PaletteConfig { background: number; noteColors: Record<string, number> }
export interface ThemeCast { byName: Record<string, CastMember>; getFrames: (name: string) => Promise<Texture[][]>; defaultCharacter: string }

export interface ThemeConfig {
  id: ThemeId;
  mapRaw: string;
  backgroundUrl?: string;
  tilesets: TilesetEntry[];
  primarySeatNames: string[];
  cafeSeatNames: string[];
  cafeStands: ReadonlyArray<readonly [string, 'coffee' | 'vending']>;
  coffee: CoffeeConfig;
  anchors: AnchorConfig;
  errandSpots: ErrandSpot[];
  monitor: MonitorConfig;
  palette: PaletteConfig;
  cast: ThemeCast;
}

export const VENTURA_THEME: ThemeConfig = {
  // `office` is retained only as the persisted config key. Visually this is the
  // clean-room Ventura operations floor.
  id: 'office',
  mapRaw: venturaMapRaw,
  backgroundUrl: venturaFloorUrl,
  tilesets: [],
  primarySeatNames: [
    'desk-ceo',
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6',
    'desk-chief-architect', 'desk-product-manager', 'desk-team-lead',
    'desk-backend-engineer', 'desk-ui-ux-expert', 'desk-data-engineer',
    'desk-project-manager', 'desk-market-researcher', 'desk-agent-organizer'
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [['cafe-stand-coffee', 'coffee'], ['cafe-stand-vending', 'vending']],
  coffee: {
    trayTile: { x: 6, y: 27 }, trayStand: { x: 6, y: 28 },
    machineStand: { x: 8, y: 28 }, sinkTile: { x: 4, y: 27 }, sinkStand: { x: 4, y: 28 }, maxCups: 4
  },
  anchors: { calendar: { x: 23, y: 3 }, boards: { x: 30, y: 4 }, clock: { x: 22, y: 3 } },
  errandSpots: [
    { kind: 'water', stand: { x: 21, y: 11 }, facing: 'up', fx: { x: 21, y: 10 }, duration: 4.5 },
    { kind: 'water', stand: { x: 31, y: 30 }, facing: 'right', fx: { x: 32, y: 30 }, duration: 4.5 },
    { kind: 'window', stand: { x: 24, y: 2 }, facing: 'up', fx: { x: 24, y: 1 }, duration: 5 },
    { kind: 'dispenser', stand: { x: 23, y: 6 }, facing: 'up', fx: { x: 23, y: 5 }, duration: 3.5 },
    { kind: 'fridge', stand: { x: 3, y: 28 }, facing: 'up', fx: { x: 3, y: 27 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 42, y: 30 }, facing: 'up', fx: { x: 42, y: 29 }, duration: 4 },
    { kind: 'bin', stand: { x: 26, y: 33 }, facing: 'right', fx: { x: 27, y: 33 }, duration: 2.6 }
  ],
  // No tile atlas means monitor light is already painted into the background.
  monitor: { offTopLeftGid: -1, onGids: [] },
  palette: {
    background: colors.ink[900],
    noteColors: { todo: 0xd5bf70, doing: 0x789fd4, blocked: 0xd47b79, done: 0x78b69a }
  },
  cast: {
    byName: CAST_BY_NAME as Record<string, CastMember>,
    getFrames: (name: string) => getCastFrames(name as OfficeCharacterName),
    defaultCharacter: DEFAULT_CHARACTER
  }
};

export const OFFICE_THEME = VENTURA_THEME;
export function getTheme(_id: ThemeId): ThemeConfig { return VENTURA_THEME; }
export function allThemes(): ThemeConfig[] { return [VENTURA_THEME]; }
