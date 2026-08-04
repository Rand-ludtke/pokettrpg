// RogueModeGame.tsx — PokeRogue-style dungeon-crawl mode built on the REAL merged Pokedex
// (base Showdown dex + Sage/Insurgence/Wylin/Uranium/Infinity/Mariomon/Pokeathlon-Soulstones,
// 4000+ species total). Starts with a chosen starter from ANY generation, allows full
// backtracking through every previously-visited route, features a persistent recurring
// rival, seed-based deterministic run generation, true permadeath, and a PokeRogue/mainline
// -style battle arena + overworld route visual. The entire run is persisted to localStorage
// so switching app tabs never resets progress — it resumes exactly where you left off.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadShowdownDex, spriteUrl, iconUrl, type DexIndex, type DexSpecies } from '../data/adapter';
import { getClient } from '../net/pokettrpgClient';
import { withPublicBase } from '../utils/publicBase';

// ──────────────────────────────── SEEDED RNG ─────────────────────────────────
// Deterministic PRNG so a given seed always reproduces the same map layout,
// gym-order, rival identity, leader variants and wild encounters (PokeRogue-style
// run variation via seeds). Battle-turn randomness (miss chance, AI move choice)
// intentionally still uses Math.random so battles themselves stay unpredictable.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h = (h ^= h >>> 16) >>> 0;
    return h;
  };
}
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function createRng(seed: string): () => number {
  const seedFn = xmur3(seed || 'pokerogue');
  return mulberry32(seedFn());
}
function randomSeedString(): string {
  return Math.random().toString(36).slice(2, 10);
}
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickRandom<T>(arr: T[], rng: () => number = Math.random): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

// ──────────────────────────────── TYPES ─────────────────────────────────────

interface RogueMon {
  speciesId: string;
  displayName: string;
  types: string[];
  level: number;
  /** Raw base stats from the dex — preserved so level-ups can recompute real stats. */
  base: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  /** Difficulty multiplier applied on top of base stats (trainer/boss mons hit harder). */
  mult: number;
  currentHp: number;
  maxHp: number;
  atk: number; def: number; spa: number; spd: number; spe: number;
  moves: string[];
}
interface LogEntry { msg: string; type: 'action' | 'damage' | 'heal' | 'win' | 'lose' | 'system' | 'item'; }
type GamePhase = 'loading' | 'main_menu' | 'starter_select' | 'exploring' | 'battle' | 'victory' | 'game_over';
type NodeKind = 'route' | 'town' | 'rival' | 'gym' | 'elite4' | 'champion';

interface GymLeaderDef { name: string; type: string; badge: string; sprite: string; }

interface MapNode {
  id: string;
  kind: NodeKind;
  name: string;
  type: string; // primary theme type for this node (route encounters / gym specialty)
  levelLo: number;
  levelHi: number;
  bg: string; // background image key (gen6bgs)
  gymDef?: GymLeaderDef;
  rivalOccurrence?: number; // 1-based count of which rival appearance this is
  cleared?: boolean;
}

interface ShopItem { id: string; name: string; price: number; description: string; effect: 'heal' | 'boost' | 'utility'; }
interface ShopInfo { name: string; leader: string; shopName: string; items: ShopItem[]; }
interface RivalInfo { name: string; sprite: string; }

// ──────────────────── PERSISTENT RUN STORAGE (survives tab switches) ────────

const RUN_STORAGE_KEY = 'ttrpg.rogueRun.v3';
const RUN_STORAGE_VERSION = 3;

interface PersistedRun {
  version: number;
  seed: string;
  phase: GamePhase;
  mapNodes: MapNode[];
  currentIndex: number;
  maxReached: number;
  playerTeam: RogueMon[];
  enemyTeam: RogueMon[];
  badgeCount: number;
  xpTotal: number;
  playerCoins: number;
  inventory: Record<string, number>;
  battleLog: LogEntry[];
  battleContext: 'wild' | 'trainer';
  rival: RivalInfo | null;
}

function loadPersistedRun(): PersistedRun | null {
  try {
    const raw = window.localStorage?.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRun;
    if (!parsed || parsed.version !== RUN_STORAGE_VERSION) return null;
    return parsed;
  } catch { return null; }
}
function savePersistedRun(run: PersistedRun): void {
  try { window.localStorage?.setItem(RUN_STORAGE_KEY, JSON.stringify(run)); } catch {}
}
function clearPersistedRun(): void {
  try { window.localStorage?.removeItem(RUN_STORAGE_KEY); } catch {}
}

// ──────────────────── TYPE COLOR PALETTE ─────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6',
  Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf51', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad',
  Crystal: '#a0d2eb', Cosmic: '#c491e9', Nuclear: '#4caf50', Stellar: '#fbc531', Sound: '#ff66aa', Light: '#fffacd',
};

const DEFAULT_TRAINER_SPRITE = 'acetrainer';

function sanitizeTrainerSpriteId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const value = typeof raw === 'string' ? raw : String(raw);
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutFragment = trimmed.split('#')[0].split('?')[0];
  const candidate = withoutFragment.replace(/\\/g, '/').split('/').pop() || withoutFragment;
  const cleaned = candidate.replace(/\.png$/i, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/gi, '').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  if (!cleaned || ['pending', 'random', 'default', 'unknown'].includes(cleaned)) return '';
  return cleaned.includes('ace-trainer') ? cleaned.replace(/ace-trainer/g, 'acetrainer') : cleaned;
}

function getTrainerSpriteValue(): string {
  const client = getClient();
  const fromClient = sanitizeTrainerSpriteId(client.getTrainerSprite());
  if (fromClient) return fromClient;
  if (typeof window !== 'undefined') {
    const stored = sanitizeTrainerSpriteId(window.localStorage?.getItem('ttrpg.trainerSprite'));
    if (stored) return stored;
  }
  return DEFAULT_TRAINER_SPRITE;
}

function trainerPortraitUrl(spriteId: string): string {
  return withPublicBase(`vendor/showdown/sprites/trainers/${spriteId}.png`);
}
function battleBgUrl(bg: string): string {
  return withPublicBase(`vendor/showdown/sprites/gen6bgs/${bg}.jpg`);
}

// ──────────── FULL TYPE EFFECTIVENESS CHART (18 standard + 6 soulstone) ─────

const TYPE_CHART: Record<string, Partial<Record<string, number>>> = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Rock: 2, Dark: 2, Steel: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Ghost: 0, Fairy: 0.5 },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
  // Soulstone types
  Crystal: { Fire: 0.5, Water: 2, Ice: 0.5, Psychic: 1.5, Rock: 1.2 },
  Cosmic: { Psychic: 2, Dragon: 2, Dark: 0.5, Steel: 1.5 },
  Nuclear: { Electric: 2, Poison: 2, Steel: 1, Ghost: 1.5, Normal: 1.5 },
  Stellar: { Ghost: 2, Dark: 2, Fire: 0.5, Water: 0.5 },
  Sound: { Psychic: 2, Flying: 2, Dark: 1.5, Ice: 0.5 },
  Light: { Dark: 3, Steel: 0.5, Psychic: 1.5, Ghost: 1.5 },
};

function getEffectiveness(attackerType: string, defenderTypes: string[]): number {
  let mult = 1;
  const c = TYPE_CHART[attackerType];
  for (const dt of defenderTypes) mult *= (c && c[dt]) ?? 1;
  return mult;
}

// ──────────────────── MOVE LIBRARY + PER-TYPE MOVE POOLS ────────────────────

interface MoveDef { power: number; type: string; pp: number; category: 'physical' | 'special' | 'status'; }
const MOVES_DB: Record<string, MoveDef> = {
  Tackle: { power: 40, type: 'Normal', pp: 35, category: 'physical' }, Scratch: { power: 40, type: 'Normal', pp: 35, category: 'physical' },
  Headbutt: { power: 70, type: 'Normal', pp: 15, category: 'physical' }, QuickAttack: { power: 40, type: 'Normal', pp: 30, category: 'physical' },
  BodySlam: { power: 85, type: 'Normal', pp: 15, category: 'physical' },
  ThunderPunch: { power: 75, type: 'Electric', pp: 15, category: 'physical' }, IcePunch: { power: 75, type: 'Ice', pp: 15, category: 'physical' },
  FirePunch: { power: 75, type: 'Fire', pp: 15, category: 'physical' }, DragonClaw: { power: 80, type: 'Dragon', pp: 15, category: 'physical' },
  DarkPulse: { power: 80, type: 'Dark', pp: 15, category: 'special' }, IronTail: { power: 100, type: 'Steel', pp: 15, category: 'physical' },
  Ember: { power: 40, type: 'Fire', pp: 25, category: 'special' }, WaterGun: { power: 40, type: 'Water', pp: 25, category: 'special' },
  VineWhip: { power: 45, type: 'Grass', pp: 25, category: 'physical' }, ThunderShock: { power: 40, type: 'Electric', pp: 30, category: 'special' },
  Thunderbolt: { power: 90, type: 'Electric', pp: 15, category: 'special' }, Flamethrower: { power: 90, type: 'Fire', pp: 15, category: 'special' },
  HydroPump: { power: 110, type: 'Water', pp: 5, category: 'special' }, SolarBeam: { power: 120, type: 'Grass', pp: 5, category: 'special' },
  Psychic: { power: 90, type: 'Psychic', pp: 10, category: 'special' }, ShadowBall: { power: 80, type: 'Ghost', pp: 15, category: 'special' },
  AuraSphere: { power: 80, type: 'Fighting', pp: 20, category: 'special' }, Moonblast: { power: 95, type: 'Fairy', pp: 15, category: 'special' },
  FreezeDry: { power: 70, type: 'Ice', pp: 20, category: 'special' },
  Earthquake: { power: 100, type: 'Ground', pp: 10, category: 'physical' }, Dig: { power: 60, type: 'Ground', pp: 10, category: 'physical' },
  RockSlide: { power: 75, type: 'Rock', pp: 10, category: 'physical' }, RockThrow: { power: 50, type: 'Rock', pp: 15, category: 'physical' },
  Lick: { power: 30, type: 'Ghost', pp: 30, category: 'physical' }, DragonBreath: { power: 60, type: 'Dragon', pp: 20, category: 'special' },
  Bite: { power: 60, type: 'Dark', pp: 25, category: 'physical' }, MetalClaw: { power: 50, type: 'Steel', pp: 35, category: 'physical' },
  DazzlingGleam: { power: 80, type: 'Fairy', pp: 10, category: 'special' }, XScissor: { power: 80, type: 'Bug', pp: 15, category: 'physical' },
  BugBite: { power: 60, type: 'Bug', pp: 20, category: 'physical' }, AirSlash: { power: 75, type: 'Flying', pp: 15, category: 'special' },
  Gust: { power: 40, type: 'Flying', pp: 35, category: 'special' }, Confusion: { power: 50, type: 'Psychic', pp: 25, category: 'special' },
  SludgeBomb: { power: 90, type: 'Poison', pp: 10, category: 'special' }, PoisonSting: { power: 15, type: 'Poison', pp: 35, category: 'physical' },
  CloseCombat: { power: 100, type: 'Fighting', pp: 5, category: 'physical' },
  // SoulStone special moves
  CrystalRay: { power: 85, type: 'Crystal', pp: 10, category: 'special' }, PrismShot: { power: 95, type: 'Crystal', pp: 5, category: 'special' },
  CosmicBeam: { power: 90, type: 'Cosmic', pp: 10, category: 'special' }, Stardust: { power: 75, type: 'Cosmic', pp: 15, category: 'special' },
  NuclearBlast: { power: 95, type: 'Nuclear', pp: 8, category: 'special' }, RadiationWave: { power: 80, type: 'Nuclear', pp: 12, category: 'special' },
  StellarBeam: { power: 90, type: 'Stellar', pp: 10, category: 'special' }, CometPunch: { power: 65, type: 'Stellar', pp: 18, category: 'physical' },
  LightBeam: { power: 90, type: 'Light', pp: 10, category: 'special' }, RadiantPulse: { power: 75, type: 'Light', pp: 14, category: 'special' },
  SoundWave: { power: 80, type: 'Sound', pp: 12, category: 'special' }, EchoBlade: { power: 70, type: 'Sound', pp: 16, category: 'physical' },
  Recover: { power: 0, type: 'Normal', pp: 10, category: 'status' },
};

const TYPE_MOVE_POOL: Record<string, string[]> = {
  Normal: ['Tackle', 'QuickAttack', 'BodySlam', 'Headbutt'],
  Fire: ['Ember', 'Flamethrower', 'FirePunch'],
  Water: ['WaterGun', 'HydroPump'],
  Electric: ['ThunderShock', 'Thunderbolt', 'ThunderPunch'],
  Grass: ['VineWhip', 'SolarBeam'],
  Ice: ['IcePunch', 'FreezeDry'],
  Fighting: ['AuraSphere', 'CloseCombat'],
  Poison: ['SludgeBomb', 'PoisonSting'],
  Ground: ['Earthquake', 'Dig'],
  Flying: ['AirSlash', 'Gust'],
  Psychic: ['Psychic', 'Confusion'],
  Bug: ['XScissor', 'BugBite'],
  Rock: ['RockSlide', 'RockThrow'],
  Ghost: ['ShadowBall', 'Lick'],
  Dragon: ['DragonClaw', 'DragonBreath'],
  Dark: ['DarkPulse', 'Bite'],
  Steel: ['IronTail', 'MetalClaw'],
  Fairy: ['Moonblast', 'DazzlingGleam'],
  Crystal: ['CrystalRay', 'PrismShot'],
  Cosmic: ['CosmicBeam', 'Stardust'],
  Nuclear: ['NuclearBlast', 'RadiationWave'],
  Stellar: ['StellarBeam', 'CometPunch'],
  Light: ['LightBeam', 'RadiantPulse'],
  Sound: ['SoundWave', 'EchoBlade'],
};

function pickMovesForTypes(types: string[]): string[] {
  const out: string[] = [];
  const push = (m: string) => { if (m && !out.includes(m)) out.push(m); };
  for (const t of types) {
    const pool = TYPE_MOVE_POOL[t] || [];
    for (const m of pool) { push(m); if (out.length >= 3) break; }
    if (out.length >= 3) break;
  }
  push('Tackle');
  push('QuickAttack');
  return out.slice(0, 4);
}

// ──────────────────── GYM / ELITE FOUR / CHAMPION / RIVAL DEFINITIONS ────────

const GYM_TYPES = ['Rock', 'Fire', 'Water', 'Electric', 'Grass', 'Psychic', 'Ice', 'Dragon'];
const ELITE_FOUR_TYPES = ['Ghost', 'Dark', 'Fighting', 'Steel'];

// 2 leader variants per gym type for variety — one is randomly picked per new run (seeded).
// Sprites are verified-existing files in vendor/showdown/sprites/trainers/.
const GYM_LEADER_POOL: Record<string, { name: string; badge: string; sprite: string }[]> = {
  Rock: [{ name: 'Roxanne', badge: 'Boulder Badge', sprite: 'roxanne' }, { name: 'Roark', badge: 'Boulder Badge', sprite: 'roark' }],
  Fire: [{ name: 'Blaine', badge: 'Flame Badge', sprite: 'blaine' }, { name: 'Flannery', badge: 'Flame Badge', sprite: 'flannery' }],
  Water: [{ name: 'Misty', badge: 'Wave Badge', sprite: 'misty' }, { name: 'Juan', badge: 'Wave Badge', sprite: 'juan' }],
  Electric: [{ name: 'Lt. Surge', badge: 'Bolt Badge', sprite: 'ltsurge' }, { name: 'Wattson', badge: 'Bolt Badge', sprite: 'wattson' }],
  Grass: [{ name: 'Erika', badge: 'Leaf Badge', sprite: 'erika' }, { name: 'Gardenia', badge: 'Leaf Badge', sprite: 'gardenia' }],
  Psychic: [{ name: 'Sabrina', badge: 'Mind Badge', sprite: 'sabrina' }, { name: 'Olympia', badge: 'Mind Badge', sprite: 'olympia' }],
  Ice: [{ name: 'Pryce', badge: 'Frost Badge', sprite: 'pryce' }, { name: 'Brycen', badge: 'Frost Badge', sprite: 'brycen' }],
  Dragon: [{ name: 'Clair', badge: 'Dragon Badge', sprite: 'clair' }, { name: 'Drayden', badge: 'Dragon Badge', sprite: 'drayden' }],
};

const ELITE_FOUR_LEADERS: { type: string; name: string; sprite: string }[] = [
  { type: 'Ghost', name: 'Elite Four • Koga', sprite: 'koga' },
  { type: 'Dark', name: 'Elite Four • Karen', sprite: 'karen' },
  { type: 'Fighting', name: 'Elite Four • Bruno', sprite: 'bruno' },
  { type: 'Steel', name: 'Elite Four • Will', sprite: 'will' },
];

const CHAMPION_NAME = 'Champion Cynthia';
const CHAMPION_SPRITE = 'cynthia';

// Persistent recurring rival — one is chosen (seeded) per run and grows stronger every time
// they reappear, instead of being a random one-off encounter type.
const RIVAL_POOL: RivalInfo[] = [
  { name: 'Rival Hilbert', sprite: 'hilbert' },
  { name: 'Rival Hilda', sprite: 'hilda' },
  { name: 'Rival Calem', sprite: 'calem' },
  { name: 'Rival Serena', sprite: 'serena' },
  { name: 'Rival Elio', sprite: 'elio' },
  { name: 'Rival Selene', sprite: 'selene' },
  { name: 'Rival Brendan', sprite: 'brendan' },
  { name: 'Rival May', sprite: 'may' },
  { name: 'Rival Silver', sprite: 'silver' },
  { name: 'Rival Gloria', sprite: 'gloria' },
];

const SHOP_MAP: Record<string, ShopInfo> = {
  Rock: { name: 'Quarry Town', leader: 'Gym Leader', shopName: 'Boulder Bazaar', items: [{ id: 'potion', name: 'Potion', price: 25, description: 'Restores 30% health', effect: 'heal' }, { id: 'boost', name: 'Focus Sash', price: 40, description: 'Boosts offense for one battle', effect: 'boost' }, { id: 'utility', name: 'Escape Rope', price: 30, description: 'Utility item', effect: 'utility' }] },
  Fire: { name: 'Ember City', leader: 'Gym Leader', shopName: 'Flame Market', items: [{ id: 'potion', name: 'Super Potion', price: 35, description: 'Restores 40% health', effect: 'heal' }, { id: 'boost', name: 'Charcoal', price: 45, description: 'Raises Attack and SpA', effect: 'boost' }, { id: 'utility', name: 'Fire Stone', price: 60, description: 'Utility relic', effect: 'utility' }] },
  Water: { name: 'Tide Harbor', leader: 'Gym Leader', shopName: 'Wave Emporium', items: [{ id: 'potion', name: 'Fresh Water', price: 30, description: 'Heals the team slightly', effect: 'heal' }, { id: 'boost', name: 'Mystic Water', price: 50, description: 'Raises Sp. Atk', effect: 'boost' }, { id: 'utility', name: 'Dive Gear', price: 55, description: 'Route utility upgrade', effect: 'utility' }] },
  Electric: { name: 'Volt Junction', leader: 'Gym Leader', shopName: 'Circuit Depot', items: [{ id: 'potion', name: 'Energy Root', price: 32, description: 'Heavy healing', effect: 'heal' }, { id: 'boost', name: 'Magnet', price: 48, description: 'Boosts electric power', effect: 'boost' }, { id: 'utility', name: 'Dynamo Battery', price: 58, description: 'Utility relic', effect: 'utility' }] },
  Grass: { name: 'Bloom Village', leader: 'Gym Leader', shopName: 'Leaf Stand', items: [{ id: 'potion', name: 'Herbal Tea', price: 28, description: 'Restore HP and cure status', effect: 'heal' }, { id: 'boost', name: 'Miracle Seed', price: 42, description: 'Raises Defense', effect: 'boost' }, { id: 'utility', name: 'Seed Bag', price: 50, description: 'Exploration utility', effect: 'utility' }] },
  Psychic: { name: 'Mindspire City', leader: 'Gym Leader', shopName: 'Oracle Arcade', items: [{ id: 'potion', name: 'Calm Elixir', price: 38, description: 'Restores max health', effect: 'heal' }, { id: 'boost', name: 'Twisted Spoon', price: 55, description: 'Boosts all stats lightly', effect: 'boost' }, { id: 'utility', name: 'Third Eye Lens', price: 70, description: 'Rare utility relic', effect: 'utility' }] },
  Ice: { name: 'Frostpeak Town', leader: 'Gym Leader', shopName: 'Glacier Bodega', items: [{ id: 'potion', name: 'Thaw Potion', price: 34, description: 'Quick recovery brew', effect: 'heal' }, { id: 'boost', name: 'Never-Melt Ice', price: 52, description: 'Increases Sp. Def', effect: 'boost' }, { id: 'utility', name: 'Ice Pick', price: 65, description: 'Utility prize', effect: 'utility' }] },
  Dragon: { name: 'Wyrmspire City', leader: 'Gym Leader', shopName: "Drake's Den", items: [{ id: 'potion', name: 'Dragon Balm', price: 45, description: 'Full team refresh', effect: 'heal' }, { id: 'boost', name: 'Dragon Fang', price: 65, description: 'Boosts Attack sharply', effect: 'boost' }, { id: 'utility', name: 'Wyrmscale', price: 80, description: 'Rare utility relic', effect: 'utility' }] },
};

// ──────────────────────── DEX / SPECIES POOL HELPERS ─────────────────────────

interface SpeciesPool { byType: Record<string, string[]>; all: string[]; }

function buildSpeciesPool(dex: DexIndex): SpeciesPool {
  const byType: Record<string, string[]> = {};
  const all: string[] = [];
  for (const [key, entry] of Object.entries(dex)) {
    if (!entry || !Array.isArray(entry.types) || entry.types.length === 0) continue;
    if (!entry.baseStats || !entry.baseStats.hp || entry.baseStats.hp <= 0) continue;
    const lname = String(entry.name || key).toLowerCase();
    if (lname.startsWith('pokestar') || lname === 'missingno.') continue;
    all.push(key);
    for (const t of entry.types) {
      if (!TYPE_COLORS[t]) continue; // skip unknown/garbage type strings
      (byType[t] = byType[t] || []).push(key);
    }
  }
  return { byType, all };
}

function pickSpeciesOfType(pool: SpeciesPool, type: string, rng: () => number): string | undefined {
  const bucket = pool.byType[type];
  if (bucket && bucket.length) return pickRandom(bucket, rng);
  return pickRandom(pool.all, rng);
}

// Background image chosen per node type — mimics a mainline battle backdrop that fits the theme.
const TYPE_BG: Record<string, string[]> = {
  Rock: ['bg-earthycave', 'bg-dampcave'],
  Fire: ['bg-desert', 'bg-orasdesert'],
  Water: ['bg-orassea', 'bg-deepsea', 'bg-beach'],
  Electric: ['bg-city', 'bg-darkcity'],
  Grass: ['bg-forest', 'bg-meadow', 'bg-darkmeadow'],
  Psychic: ['bg-library'],
  Ice: ['bg-icecave'],
  Dragon: ['bg-skypillar'],
  Ghost: ['bg-elite4drake'],
  Dark: ['bg-elite4drake'],
  Fighting: ['bg-elite4drake'],
  Steel: ['bg-elite4drake'],
  Normal: ['bg-meadow', 'bg-darkbeach'],
};
function bgFor(type: string, rng: () => number): string {
  const arr = TYPE_BG[type] || TYPE_BG.Normal;
  return arr[Math.floor(rng() * arr.length)] || 'bg-meadow';
}

function statAt(base: number, level: number): number {
  return Math.floor(((2 * base + 31) * level) / 100) + 5;
}
function hpAt(base: number, level: number): number {
  return Math.floor(((2 * base + 31) * level) / 100) + level + 10;
}

/** Compute all level-adjusted battle stats from raw base stats + difficulty multiplier. */
function computeMonStats(base: RogueMon['base'], level: number, mult: number) {
  return {
    maxHp: Math.max(1, Math.floor(hpAt(base.hp, level) * mult)),
    atk: Math.max(1, Math.floor(statAt(base.atk, level) * mult)),
    def: Math.max(1, Math.floor(statAt(base.def, level) * mult)),
    spa: Math.max(1, Math.floor(statAt(base.spa, level) * mult)),
    spd: Math.max(1, Math.floor(statAt(base.spd, level) * mult)),
    spe: Math.max(1, Math.floor(statAt(base.spe, level) * mult)),
  };
}

function buildRogueMon(key: string, entry: DexSpecies, level: number, isBoss = false): RogueMon {
  const bs = entry.baseStats;
  const base = { hp: bs.hp || 1, atk: bs.atk || 1, def: bs.def || 1, spa: bs.spa || 1, spd: bs.spd || 1, spe: bs.spe || 1 };
  const mult = isBoss ? 1.15 : 1;
  const stats = computeMonStats(base, level, mult);
  return {
    speciesId: key,
    displayName: entry.name || key,
    types: entry.types,
    level,
    base,
    mult,
    currentHp: stats.maxHp,
    maxHp: stats.maxHp,
    atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe,
    moves: pickMovesForTypes(entry.types),
  };
}

/** Recompute a RogueMon's real battle stats for a new level, preserving current HP % (fixes
 *  the bug where leveling up only changed the displayed number with no real stat gain). */
function recomputeLevel(mon: RogueMon, newLevel: number): RogueMon {
  const frac = mon.maxHp > 0 ? mon.currentHp / mon.maxHp : 1;
  const stats = computeMonStats(mon.base, newLevel, mon.mult);
  return {
    ...mon,
    level: newLevel,
    maxHp: stats.maxHp, atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe,
    currentHp: Math.max(1, Math.round(stats.maxHp * frac)),
  };
}

function execMove(attacker: RogueMon, defender: RogueMon, moveName: string): { damage: number; label: string; miss: boolean } {
  const mv = MOVES_DB[moveName];
  if (!mv) return { damage: 0, label: '', miss: false };
  const eff = getEffectiveness(mv.type, defender.types);
  let label: string;
  if (eff > 1) label = `✨${Math.round(eff * 100)}%`;
  else if (eff === 0) label = '🚫 No Effect!';
  else if (eff < 1) label = '🛡️ not very effective…';
  else label = '';
  if (Math.random() < 0.08) return { damage: 0, label: '💨 Missed!', miss: true };
  if (mv.category === 'status') return { damage: 0, label: '', miss: false };
  const atkSt = mv.category === 'physical' ? attacker.atk : attacker.spa;
  const defSt = Math.max((mv.category === 'physical' ? defender.def : defender.spd) * 0.8, 1);
  const baseDmg = ((2 * attacker.level / 5 + 2) * mv.power * atkSt / (defSt * 50)) + 2;
  return { damage: Math.max(1, Math.floor(baseDmg * eff)), label, miss: false };
}

// ──────────────────────── MAP GENERATION (seeded, backtrack-capable) ─────────

function buildMapNodes(rng: () => number): MapNode[] {
  const nodes: MapNode[] = [];
  const gymOrder = shuffle(GYM_TYPES, rng);
  let rivalCount = 0;
  gymOrder.forEach((type, i) => {
    const lo = 6 + i * 10;
    const hi = lo + 8;
    nodes.push({ id: `route_${i}`, kind: 'route', name: `${type} Route`, type, levelLo: lo, levelHi: hi, bg: bgFor(type, rng) });
    if (i % 2 === 1) {
      rivalCount++;
      nodes.push({ id: `rival_${i}`, kind: 'rival', name: 'Rival Battle', type, levelLo: lo + 2, levelHi: hi + 2, bg: bgFor('Normal', rng), rivalOccurrence: rivalCount });
    }
    const leaderChoice = pickRandom(GYM_LEADER_POOL[type], rng) || GYM_LEADER_POOL[type][0];
    nodes.push({
      id: `gym_${i}`, kind: 'gym', name: `${type} Gym`, type, levelLo: hi + 4, levelHi: hi + 8, bg: bgFor(type, rng),
      gymDef: { name: leaderChoice.name, type, badge: leaderChoice.badge, sprite: leaderChoice.sprite },
    });
    nodes.push({ id: `town_${i}`, kind: 'town', name: SHOP_MAP[type]?.name || `${type} Town`, type, levelLo: hi, levelHi: hi, bg: 'bg-aquacordetown' });
  });
  const elite4Order = shuffle(ELITE_FOUR_LEADERS, rng);
  elite4Order.forEach((leader, i) => {
    nodes.push({
      id: `elite4_${i}`, kind: 'elite4', name: leader.name, type: leader.type,
      levelLo: 88 + i * 3, levelHi: 92 + i * 3, bg: 'bg-elite4drake',
      gymDef: { name: leader.name, type: leader.type, badge: 'Elite Emblem', sprite: leader.sprite },
    });
  });
  nodes.push({
    id: 'champion', kind: 'champion', name: CHAMPION_NAME, type: 'Normal', levelLo: 100, levelHi: 105, bg: 'bg-leaderwallace',
    gymDef: { name: CHAMPION_NAME, type: 'Normal', badge: 'Champion Crown', sprite: CHAMPION_SPRITE },
  });
  return nodes;
}

function generateTrainerTeam(pool: SpeciesPool, dex: DexIndex, type: string, levelLo: number, levelHi: number, size: number, rng: () => number): RogueMon[] {
  const team: RogueMon[] = [];
  for (let i = 0; i < size; i++) {
    const key = pickSpeciesOfType(pool, type, rng);
    if (!key || !dex[key]) continue;
    const level = levelLo + Math.floor(rng() * Math.max(1, levelHi - levelLo));
    team.push(buildRogueMon(key, dex[key], level, true));
  }
  return team;
}

/** Type-diverse team generator used for the Champion and the recurring Rival. */
function generateDiverseTeam(pool: SpeciesPool, dex: DexIndex, levelLo: number, levelHi: number, size: number, rng: () => number): RogueMon[] {
  const usedTypes = new Set<string>();
  const team: RogueMon[] = [];
  const shuffledTypes = shuffle([...GYM_TYPES, ...ELITE_FOUR_TYPES], rng);
  for (const type of shuffledTypes) {
    if (team.length >= size) break;
    if (usedTypes.has(type)) continue;
    usedTypes.add(type);
    const key = pickSpeciesOfType(pool, type, rng);
    if (!key || !dex[key]) continue;
    const level = levelLo + Math.floor(rng() * Math.max(1, levelHi - levelLo));
    team.push(buildRogueMon(key, dex[key], level, true));
  }
  return team;
}

// ──────────────────────── STARTER DATA (full generational roster) ────────────

const STARTER_GENS: { gen: number; label: string; keys: string[] }[] = [
  { gen: 1, label: 'Kanto', keys: ['bulbasaur', 'charmander', 'squirtle'] },
  { gen: 2, label: 'Johto', keys: ['chikorita', 'cyndaquil', 'totodile'] },
  { gen: 3, label: 'Hoenn', keys: ['treecko', 'torchic', 'mudkip'] },
  { gen: 4, label: 'Sinnoh', keys: ['turtwig', 'chimchar', 'piplup'] },
  { gen: 5, label: 'Unova', keys: ['snivy', 'tepig', 'oshawott'] },
  { gen: 6, label: 'Kalos', keys: ['chespin', 'fennekin', 'froakie'] },
  { gen: 7, label: 'Alola', keys: ['rowlet', 'litten', 'popplio'] },
  { gen: 8, label: 'Galar', keys: ['grookey', 'scorbunny', 'sobble'] },
  { gen: 9, label: 'Paldea', keys: ['sprigatito', 'fuecoco', 'quaxly'] },
];

// ════════════════════ HP BAR / STATUS BOX (mainline-style HUD) ══════════════

const HpBar: React.FC<{ mon: RogueMon; showNumbers?: boolean; align?: 'left' | 'right' }> = ({ mon, showNumbers, align = 'left' }) => {
  const pct = mon.maxHp > 0 ? Math.max(0, Math.min(100, (mon.currentHp / mon.maxHp) * 100)) : 0;
  const color = pct > 50 ? '#4caf50' : pct > 20 ? '#ffca28' : '#ff4444';
  return (
    <div style={{
      background: 'rgba(248,250,255,0.96)', borderRadius: 10, padding: '8px 12px', minWidth: 190,
      boxShadow: '0 6px 14px rgba(0,0,0,0.35)', border: '2px solid #2b2b40', textAlign: align,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 13, color: '#222' }}>
        <span>{mon.displayName}</span><span>Lv{mon.level}</span>
      </div>
      <div style={{ height: 8, background: '#333', borderRadius: 5, marginTop: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 400ms ease, background 400ms ease' }} />
      </div>
      {showNumbers && (
        <div style={{ fontSize: 11, color: '#444', marginTop: 2, textAlign: 'right' }}>{mon.currentHp}/{mon.maxHp}</div>
      )}
    </div>
  );
};

// ════════════════════ BATTLE SCENE (arena background, positioned sprites) ═══

interface BattleScreenProps {
  team: RogueMon[]; enemies: RogueMon[]; log: LogEntry[]; onUseMove: (m: string) => void;
  bg: string; opponentName: string; opponentSprite: string | null; playerTrainerSprite: string;
}

const BattleSprite: React.FC<{ speciesId: string; back: boolean; size: number }> = ({ speciesId, back, size }) => {
  const [src, setSrc] = useState(() => spriteUrl(speciesId, false, { back, forceStatic: true }));
  useEffect(() => { setSrc(spriteUrl(speciesId, false, { back, forceStatic: true })); }, [speciesId, back]);
  return (
    <img
      src={src}
      onError={() => setSrc(iconUrl(speciesId))}
      alt={speciesId}
      style={{ width: size, height: size, imageRendering: 'pixelated', objectFit: 'contain', filter: 'drop-shadow(0 8px 10px rgba(0,0,0,0.45))' }}
    />
  );
};

const BattleScreen: React.FC<BattleScreenProps> = ({ team, enemies, log, onUseMove, bg, opponentName, opponentSprite, playerTrainerSprite }) => {
  const finished = log.some(l => l.type === 'win' || l.type === 'lose');
  const activePlayer = team.find(m => m.currentHp > 0);
  const activeEnemy = enemies.find(m => m.currentHp > 0);
  const lastMsg = log[log.length - 1]?.msg || '';

  return (
    <div>
      <div style={{
        position: 'relative', width: '100%', height: 440, borderRadius: 18, overflow: 'hidden',
        border: '4px solid #23233a', boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        backgroundImage: `linear-gradient(rgba(10,14,26,0.12), rgba(10,14,26,0.4)), url(${battleBgUrl(bg)})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      }}>
        {/* Opponent corner: portrait (if trainer) + name + HP box */}
        {activeEnemy && (
          <div style={{ position: 'absolute', top: 18, right: 28, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {opponentSprite && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#fff', fontWeight: 800, textShadow: '0 2px 4px #000', fontSize: 14 }}>{opponentName}</span>
                <img src={trainerPortraitUrl(opponentSprite)} alt={opponentName} style={{ width: 44, height: 44, imageRendering: 'pixelated' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
            <HpBar mon={activeEnemy} showNumbers={false} align="right" />
          </div>
        )}
        {/* Opponent active sprite, front-facing, upper-mid-right */}
        {activeEnemy && (
          <div style={{ position: 'absolute', top: 90, right: 90 }}>
            <BattleSprite speciesId={activeEnemy.speciesId} back={false} size={110} />
          </div>
        )}
        {/* Enemy bench row */}
        <div style={{ position: 'absolute', top: 20, left: 20, display: 'flex', gap: 4 }}>
          {enemies.map((m, i) => (
            <div key={i} title={m.displayName} style={{ width: 22, height: 22, borderRadius: '50%', background: m.currentHp > 0 ? (TYPE_COLORS[m.types[0]] || '#888') : '#333', opacity: m.currentHp > 0 ? 1 : 0.35, border: '2px solid #111' }} />
          ))}
        </div>

        {/* Player active sprite, back-facing, lower-left */}
        {activePlayer && (
          <div style={{ position: 'absolute', bottom: 130, left: 60 }}>
            <BattleSprite speciesId={activePlayer.speciesId} back size={130} />
          </div>
        )}
        {/* Player HP box + trainer portrait, bottom-left-ish */}
        {activePlayer && (
          <div style={{ position: 'absolute', bottom: 100, right: 28, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <HpBar mon={activePlayer} showNumbers align="right" />
          </div>
        )}
        {/* Player bench row */}
        <div style={{ position: 'absolute', bottom: 14, left: 20, display: 'flex', gap: 4 }}>
          {team.map((m, i) => (
            <div key={i} title={m.displayName} style={{ width: 22, height: 22, borderRadius: '50%', background: m.currentHp > 0 ? (TYPE_COLORS[m.types[0]] || '#888') : '#333', opacity: m.currentHp > 0 ? 1 : 0.35, border: '2px solid #111' }} />
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: 14, right: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={trainerPortraitUrl(playerTrainerSprite)} alt="You" style={{ width: 46, height: 46, imageRendering: 'pixelated' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        </div>

        {/* Message / dialogue box */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 76,
          background: 'rgba(8,12,22,0.94)', borderTop: '3px solid #4a5578', padding: '10px 16px',
        }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, minHeight: 22 }}>{lastMsg}</div>
          <div style={{ marginTop: 4, maxHeight: 40, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse' }}>
            {log.slice(-6, -1).reverse().map((entry, i) => (
              <div key={i} style={{ color: '#9fb0d9', fontSize: 12 }}>{entry.msg}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Move grid (docked, mainline-style 2x2) or Continue button */}
      {!finished && activePlayer && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          {activePlayer.moves.map(mv => {
            const d = MOVES_DB[mv];
            return (
              <button key={mv} onClick={() => onUseMove(mv)} style={{
                padding: '14px 16px', border: 'none', borderRadius: 10, background: d ? TYPE_COLORS[d.type] || '#555' : '#555',
                color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 15, boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
              }}>{mv}{d ? <span style={{ opacity: 0.75, fontWeight: 500, fontSize: 12 }}> ({d.type})</span> : null}</button>
            );
          })}
        </div>
      )}
      {finished && (
        <button onClick={() => onUseMove('continue')} style={{ padding: '14px 28px', border: 'none', borderRadius: 10, background: '#ffd700', color: '#222', cursor: 'pointer', fontWeight: 800, marginTop: 14, fontSize: 16 }}>Continue →</button>
      )}
    </div>
  );
};

// ════════════════════ OVERWORLD MAP / ROUTE PATH VISUAL ═════════════════════

const NODE_ICON: Record<NodeKind, string> = { route: '🥾', town: '🏘️', rival: '⚔️', gym: '🥊', elite4: '🎖️', champion: '👑' };

const MapPath: React.FC<{ nodes: MapNode[]; currentIndex: number; maxReached: number; onJump: (i: number) => void; playerTrainerSprite: string }> = ({ nodes, currentIndex, maxReached, onJump, playerTrainerSprite }) => {
  return (
    <div style={{ position: 'relative', overflowX: 'auto', padding: '28px 12px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12 }}>
      <div style={{ position: 'absolute', top: 46, left: 30, right: 30, height: 3, background: 'linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.25), rgba(255,255,255,0.05))', zIndex: 0 }} />
      <div style={{ display: 'flex', gap: 22, position: 'relative', zIndex: 1, minWidth: 'max-content' }}>
        {nodes.map((n, i) => {
          const locked = i > maxReached;
          const isCurrent = i === currentIndex;
          return (
            <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }}>
              {isCurrent && (
                <img src={trainerPortraitUrl(playerTrainerSprite)} alt="you" style={{ position: 'absolute', top: -30, width: 28, height: 28, imageRendering: 'pixelated' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              )}
              <button
                disabled={locked}
                onClick={() => onJump(i)}
                title={n.name}
                style={{
                  width: 44, height: 44, borderRadius: '50%', cursor: locked ? 'not-allowed' : 'pointer',
                  background: locked ? '#2a2a38' : (TYPE_COLORS[n.type] || '#555'),
                  border: isCurrent ? '3px solid gold' : '2px solid rgba(255,255,255,0.25)',
                  fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isCurrent ? '0 0 0 4px rgba(255,215,0,0.25)' : '0 4px 8px rgba(0,0,0,0.3)',
                  opacity: locked ? 0.45 : 1, position: 'relative',
                }}
              >
                {NODE_ICON[n.kind]}
                {n.cleared && <span style={{ position: 'absolute', bottom: -4, right: -4, fontSize: 13 }}>✅</span>}
              </button>
              <span style={{ fontSize: 10, color: locked ? '#666' : '#dfe7ff', maxWidth: 70, textAlign: 'center', lineHeight: 1.2 }}>{n.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ════════════════════ ROGUEMODE MAIN COMPONENT ══════════════════════════════

export const RogueModeGame: React.FC = () => {
  const [dex, setDex] = useState<DexIndex | null>(null);
  const [pool, setPool] = useState<SpeciesPool | null>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [mapNodes, setMapNodes] = useState<MapNode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(0);

  const [playerTeam, setPlayerTeam] = useState<RogueMon[]>([]);
  const [enemyTeam, setEnemyTeam] = useState<RogueMon[]>([]);
  const [badgeCount, setBadgeCount] = useState(0);
  const [xpTotal, setXpTotal] = useState(0);
  const [battleLog, setBattleLog] = useState<LogEntry[]>([]);
  const [playerCoins, setPlayerCoins] = useState(200);
  const [inventory, setInventory] = useState<Record<string, number>>({ potion: 2 });
  const [shopOpen, setShopOpen] = useState(false);
  const [trainerSprite, setTrainerSprite] = useState<string>(() => getTrainerSpriteValue());
  const [mapOpen, setMapOpen] = useState(false);
  const [battleContext, setBattleContext] = useState<'wild' | 'trainer'>('wild');
  const [seed, setSeed] = useState<string>('');
  const [seedInput, setSeedInput] = useState<string>('');
  const [rival, setRival] = useState<RivalInfo | null>(null);
  const [selectedGen, setSelectedGen] = useState<number>(1);
  const [restoredRun, setRestoredRun] = useState(false);

  const rngRef = useRef<() => number>(() => Math.random());
  const hasHydratedRef = useRef(false);

  // ── load dex, then attempt to restore a persisted run ───────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadShowdownDex();
        if (cancelled) return;
        setDex(result.pokedex);
        setPool(buildSpeciesPool(result.pokedex));

        const saved = loadPersistedRun();
        if (saved) {
          rngRef.current = createRng(saved.seed);
          setSeed(saved.seed);
          setMapNodes(saved.mapNodes);
          setCurrentIndex(saved.currentIndex);
          setMaxReached(saved.maxReached);
          setPlayerTeam(saved.playerTeam);
          setEnemyTeam(saved.enemyTeam);
          setBadgeCount(saved.badgeCount);
          setXpTotal(saved.xpTotal);
          setPlayerCoins(saved.playerCoins);
          setInventory(saved.inventory);
          setBattleLog(saved.battleLog);
          setBattleContext(saved.battleContext);
          setRival(saved.rival);
          setPhase(saved.phase);
          setRestoredRun(true);
        } else {
          setPhase('main_menu');
        }
        hasHydratedRef.current = true;
      } catch {
        if (!cancelled) { setPhase('main_menu'); hasHydratedRef.current = true; }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const client = getClient();
    const syncTrainerSprite = () => setTrainerSprite(getTrainerSpriteValue());
    syncTrainerSprite();
    client.on('trainerSpriteChanged', syncTrainerSprite);
    return () => client.off('trainerSpriteChanged', syncTrainerSprite);
  }, []);

  // ── persist the run any time meaningful state changes (survives tab switches) ──
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (phase === 'loading' || phase === 'main_menu') return;
    savePersistedRun({
      version: RUN_STORAGE_VERSION,
      seed, phase, mapNodes, currentIndex, maxReached, playerTeam, enemyTeam,
      badgeCount, xpTotal, playerCoins, inventory, battleLog, battleContext, rival,
    });
  }, [phase, mapNodes, currentIndex, maxReached, playerTeam, enemyTeam, badgeCount, xpTotal, playerCoins, inventory, battleLog, battleContext, rival, seed]);

  const currentNode: MapNode | undefined = mapNodes[currentIndex];
  const activeTown = currentNode && currentNode.kind === 'town' ? SHOP_MAP[currentNode.type] : undefined;

  const xpThresholdFor = (l: number): number => { let s = 0; for (let i = 5; i < l; i++) s += 15 + i * 3; return s; };

  const buyItem = useCallback((item: ShopItem) => {
    if (playerCoins < item.price) {
      setBattleLog(p => [...p, { msg: `Not enough coins for ${item.name}.`, type: 'system' }]);
      return;
    }
    setPlayerCoins(p => p - item.price);
    setInventory(p => ({ ...p, [item.id]: (p[item.id] ?? 0) + 1 }));
    setBattleLog(p => [...p, { msg: `Bought ${item.name}.`, type: 'item' }]);
  }, [playerCoins]);

  const startNewGame = useCallback((seedOverride?: string) => {
    clearPersistedRun();
    const nextSeed = (seedOverride && seedOverride.trim()) || randomSeedString();
    rngRef.current = createRng(nextSeed);
    const nodes = buildMapNodes(rngRef.current);
    const chosenRival = pickRandom(RIVAL_POOL, rngRef.current) || RIVAL_POOL[0];
    setSeed(nextSeed);
    setRival(chosenRival);
    setMapNodes(nodes);
    setCurrentIndex(0);
    setMaxReached(0);
    setPlayerTeam([]);
    setEnemyTeam([]);
    setBadgeCount(0);
    setXpTotal(0);
    setPlayerCoins(200);
    setInventory({ potion: 2 });
    setShopOpen(false);
    setMapOpen(false);
    setRestoredRun(false);
    setBattleLog([{ msg: `Welcome to RogueMode! Seed: ${nextSeed}. Choose your starter.`, type: 'system' }]);
    setPhase('starter_select');
  }, []);

  const abandonRun = useCallback(() => {
    clearPersistedRun();
    setPhase('main_menu');
  }, []);

  const pickStarter = useCallback((key: string) => {
    if (!dex || !dex[key]) return;
    const mon = buildRogueMon(key, dex[key], 5, false);
    setPlayerTeam([mon]);
    setPhase('exploring');
    setBattleLog([{ msg: `You chose ${mon.displayName}! Let's explore. (Seed: ${seed})`, type: 'system' }]);
  }, [dex, seed]);

  // ── wild encounter on a route node ──────────────────────────────────────
  const searchRoute = useCallback(() => {
    if (!pool || !dex || !currentNode || currentNode.kind !== 'route') return;
    const key = pickSpeciesOfType(pool, currentNode.type, rngRef.current);
    if (!key || !dex[key]) return;
    const level = currentNode.levelLo + Math.floor(rngRef.current() * Math.max(1, currentNode.levelHi - currentNode.levelLo));
    const wildMon = buildRogueMon(key, dex[key], level, false);
    setEnemyTeam([wildMon]);
    setBattleContext('wild');
    setBattleLog(p => [...p, { msg: `A wild ${wildMon.displayName} appeared!`, type: 'system' }]);
    setPhase('battle');
  }, [pool, dex, currentNode]);

  // ── trainer/gym/rival/elite4/champion battle trigger ────────────────────
  const startTrainerBattle = useCallback(() => {
    if (!pool || !dex || !currentNode) return;
    if (currentNode.kind === 'town' || currentNode.kind === 'route') return;

    if (currentNode.kind === 'rival' && rival) {
      const size = Math.min(6, 1 + (currentNode.rivalOccurrence || 1));
      const team = generateDiverseTeam(pool, dex, currentNode.levelLo, currentNode.levelHi, size, rngRef.current);
      if (!team.length) return;
      setEnemyTeam(team);
      setBattleContext('trainer');
      setBattleLog(p => [...p, { msg: `${rival.name} challenges you!`, type: 'system' }]);
      setPhase('battle');
      return;
    }

    const size = currentNode.kind === 'gym' ? 3 : currentNode.kind === 'elite4' ? 4 : currentNode.kind === 'champion' ? 6 : 2;
    const team = currentNode.kind === 'champion'
      ? generateDiverseTeam(pool, dex, currentNode.levelLo, currentNode.levelHi, size, rngRef.current)
      : generateTrainerTeam(pool, dex, currentNode.type, currentNode.levelLo, currentNode.levelHi, size, rngRef.current);
    if (!team.length) return;
    setEnemyTeam(team);
    setBattleContext('trainer');
    setBattleLog(p => [...p, { msg: `${currentNode.gymDef?.name || 'A trainer'} challenges you!`, type: 'system' }]);
    setPhase('battle');
  }, [pool, dex, currentNode, rival]);

  const processAction = useCallback((action: string) => {
    if (phase !== 'battle') return;

    if (action === 'continue') {
      const last = battleLog[battleLog.length - 1];
      if (!last) return;
      if (last.type === 'win') {
        setMapNodes(prev => prev.map((n, i) => i === currentIndex ? { ...n, cleared: true } : n));
        if (currentNode?.kind === 'gym' || currentNode?.kind === 'elite4') setBadgeCount(p => p + 1);

        const xep = enemyTeam.reduce((s, m) => s + Math.floor(15 + m.level * 3), 0);
        setXpTotal(p => p + xep);
        if (playerTeam.length > 0) {
          const avgXp = Math.floor(xep / playerTeam.length);
          setPlayerTeam(prev => prev.map(m => {
            let newLevel = m.level;
            let remaining = avgXp;
            while (remaining > 0 && newLevel < 100 && remaining >= xpThresholdFor(newLevel)) {
              newLevel++;
              remaining -= xpThresholdFor(newLevel);
            }
            return newLevel === m.level ? m : recomputeLevel(m, newLevel);
          }));
        }

        if (currentNode?.kind === 'champion') { setPhase('victory'); return; }

        // Heal 25% between advances, then move forward.
        setPlayerTeam(p => p.map(m => ({ ...m, currentHp: Math.min(m.maxHp, m.currentHp + Math.floor(m.maxHp * 0.25)) })));
        const nextIdx = Math.min(mapNodes.length - 1, currentIndex + 1);
        setCurrentIndex(nextIdx);
        setMaxReached(p => Math.max(p, nextIdx));
        setPhase('exploring');
      } else if (last.type === 'lose') {
        // True permadeath — ANY full team faint (wild or trainer) ends the run immediately.
        setPhase('game_over');
      }
      return;
    }

    let teamOut = playerTeam.map(m => ({ ...m }));
    let foeOut = enemyTeam.map(m => ({ ...m }));
    const logs: LogEntry[] = [];

    const pIdx = teamOut.findIndex(m => m.currentHp > 0);
    if (pIdx < 0) { setPhase('game_over'); return; }
    const eIdx = foeOut.findIndex(m => m.currentHp > 0);
    if (eIdx < 0) return;

    const attacker = teamOut[pIdx];
    const defender = foeOut[eIdx];

    if (MOVES_DB[action]?.category === 'status') {
      const amt = Math.floor(attacker.maxHp * 0.5);
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + amt);
      logs.push({ msg: `${attacker.displayName} used ${action}! (+${amt} HP)`, type: 'heal' });
    } else {
      const res = execMove(attacker, defender, action);
      if (res.miss) { logs.push({ msg: `${attacker.displayName} used ${action} but missed!`, type: 'action' }); }
      else if (res.damage > 0) {
        foeOut[eIdx] = { ...foeOut[eIdx], currentHp: Math.max(0, foeOut[eIdx].currentHp - res.damage) };
        logs.push({ msg: `${attacker.displayName} used ${action}${res.label ? ' ' + res.label : ''} (-${res.damage} HP)`, type: 'damage' });
        if (foeOut[eIdx].currentHp === 0) logs.push({ msg: `${foeOut[eIdx].displayName} fainted!`, type: 'action' });
      }
    }

    const allDead = foeOut.every(m => m.currentHp <= 0);
    if (allDead) {
      logs.push({ msg: '✅ All opponents defeated!', type: 'win' });
    } else {
      const attackBack = (ea: RogueMon) => {
        const ti = teamOut.findIndex(m => m.currentHp > 0);
        if (ti < 0) return;
        const tgt = teamOut[ti];
        const mv = pickRandom(ea.moves) || 'Tackle';
        const r2 = execMove(ea, tgt, mv);
        if (r2.miss) { logs.push({ msg: `${ea.displayName} missed!`, type: 'action' }); return; }
        teamOut[ti] = { ...teamOut[ti], currentHp: Math.max(0, tgt.currentHp - r2.damage) };
        logs.push({ msg: `${ea.displayName} used ${mv} on ${tgt.displayName}${r2.label ? ' ' + r2.label : ''} (-${r2.damage} HP)`, type: 'damage' });
      };
      foeOut.filter(e => e.currentHp > 0).forEach(attackBack);
    }

    if (!teamOut.some(m => m.currentHp > 0)) logs.push({ msg: '💀 Your team fainted!', type: 'lose' });
    setPlayerTeam(teamOut); setEnemyTeam(foeOut); setBattleLog(p => [...p, ...logs]);
  }, [phase, playerTeam, enemyTeam, battleLog, currentIndex, currentNode, mapNodes]);

  // ── backtracking: jump to any previously-reached node ───────────────────
  const jumpToNode = useCallback((idx: number) => {
    if (idx > maxReached) return;
    setCurrentIndex(idx);
    setMapOpen(false);
  }, [maxReached]);

  const isBattleNodeCleared = currentNode?.cleared;

  // Opponent portrait/name for the battle scene (trainer battles show a portrait; wild does not).
  const battleOpponentName = currentNode?.kind === 'rival' && rival ? rival.name : (currentNode?.gymDef?.name || 'Wild Pokémon');
  const battleOpponentSprite = battleContext === 'trainer'
    ? (currentNode?.kind === 'rival' && rival ? rival.sprite : currentNode?.gymDef?.sprite || null)
    : null;

  return (
    <div style={{ maxWidth: 1000, margin: 'auto', padding: 24, fontFamily: 'Arial,sans-serif', color: '#333' }}>
      {phase === 'loading' && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <h2>Loading the full Pokédex…</h2>
          <p>Fetching 4000+ species from every merged dex source.</p>
        </div>
      )}

      {phase === 'main_menu' && (
        <div style={{ textAlign: 'center', padding: 60, background: 'linear-gradient(180deg,#1a1a2e 0%, #0f1420 100%)', borderRadius: 16, boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
          <h1 style={{ color: '#ffd700', fontSize: 40, marginBottom: 8, textShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>⚡ ROGUE MODE ⚡</h1>
          <p style={{ color: '#ccc', fontSize: 18, maxWidth: 620, margin: 'auto' }}>
            A PokeRogue-style gauntlet drawing from the FULL merged Pokédex ({pool ? pool.all.length.toLocaleString() : '...'} species).
            Pick a starter from any generation, explore 8 gym routes with full backtracking, face a persistent rival who grows stronger, and take on the Elite Four and Champion. One loss ends the run — choose wisely.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            {GYM_TYPES.map(t => (<span key={t} style={{ padding: '4px 10px', background: TYPE_COLORS[t], borderRadius: 4, fontSize: 12, color: '#111' }}>{t} Gym</span>))}
          </div>
          <div style={{ marginTop: 26, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              placeholder="Seed (optional — leave blank for random)"
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #444', background: '#0f1420', color: '#eee', minWidth: 260 }}
            />
            <button onClick={() => setSeedInput(randomSeedString())} style={{ padding: '10px 14px', border: 'none', borderRadius: 8, background: '#4b5d8a', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>🎲 Randomize</button>
          </div>
          <br />
          <button onClick={() => startNewGame(seedInput)} style={{ padding: '15px 30px', fontSize: 24, border: 'none', borderRadius: 8, background: '#ffd700', color: '#333', cursor: 'pointer', fontWeight: 'bold', marginTop: 10 }}>▶ New Run</button>
        </div>)}

      {phase === 'starter_select' && (
        <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 10 }}>
          <h2>🎮 Pick Your Starter</h2>
          <p>Choose your single starting partner from any region — build the rest of your team by capturing wild Pokémon along the way! Seed: <code>{seed}</code></p>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            {STARTER_GENS.map(g => (
              <button key={g.gen} onClick={() => setSelectedGen(g.gen)} style={{
                padding: '6px 12px', borderRadius: 8, border: selectedGen === g.gen ? '2px solid #ffd700' : '1px solid #ccc',
                background: selectedGen === g.gen ? '#333' : '#eee', color: selectedGen === g.gen ? '#ffd700' : '#333', cursor: 'pointer', fontWeight: 700, fontSize: 12,
              }}>Gen {g.gen} • {g.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 15, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            {(STARTER_GENS.find(g => g.gen === selectedGen)?.keys || []).map(key => {
              const entry = dex?.[key];
              if (!entry) return null;
              return (
                <button key={key} onClick={() => pickStarter(key)} style={{ padding: '15px 20px', fontSize: 16, border: 'none', borderRadius: 8, background: TYPE_COLORS[entry.types[0]] || '#888', cursor: 'pointer', color: '#fff', fontWeight: 'bold', minWidth: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <img src={spriteUrl(key, false, { forceStatic: true })} alt={entry.name} style={{ width: 64, height: 64, imageRendering: 'pixelated' }} onError={(e) => { (e.currentTarget as HTMLImageElement).src = iconUrl(key); }} />
                  {entry.name} ({entry.types.join('/')})
                </button>
              );
            })}
          </div>
        </div>)}

      {phase === 'exploring' && currentNode && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, background: 'linear-gradient(180deg,#18243d 0%,#111a2b 100%)', borderRadius: 18, padding: 20, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 30px rgba(0,0,0,0.28)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, color: '#a7bce8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{currentNode.kind} • Seed {seed}</div>
                <h3 style={{ margin: '6px 0 0', fontSize: 28, color: '#f8fbff' }}>{currentNode.name}</h3>
                {restoredRun && (
                  <div onAnimationEnd={() => setRestoredRun(false)} style={{ marginTop: 4, fontSize: 11, color: '#8fd98f' }}>▶ Run resumed — your progress was saved.</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ padding: '8px 12px', background: TYPE_COLORS[currentNode.type] || '#888', borderRadius: 999, color: '#111827', fontWeight: 800 }}>{currentNode.type}</div>
                <button onClick={abandonRun} title="End this run and return to the main menu" style={{ padding: '8px 12px', border: '1px solid #a33', borderRadius: 999, background: 'transparent', color: '#ff8a8a', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Abandon Run</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              {playerTeam.map((monster, index) => (<span key={index} style={{ padding: '6px 10px', borderRadius: 8, background: TYPE_COLORS[monster.types[0]] || '#666', color: '#fff', fontWeight: 700, fontSize: 13 }}>{monster.displayName} Lv.{monster.level} ({monster.currentHp}/{monster.maxHp})</span>))}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
              <button onClick={() => setMapOpen(v => !v)} style={{ padding: '10px 16px', border: 'none', borderRadius: 10, background: '#4b5d8a', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>🗺️ {mapOpen ? 'Hide Map' : 'Show Map (backtrack)'}</button>

              {currentNode.kind === 'route' && (
                <button onClick={searchRoute} style={{ padding: '12px 20px', border: 'none', borderRadius: 10, background: '#3792ff', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>🔍 Search for Wild Pokémon</button>
              )}
              {(currentNode.kind === 'gym' || currentNode.kind === 'rival' || currentNode.kind === 'elite4' || currentNode.kind === 'champion') && !isBattleNodeCleared && (
                <button onClick={startTrainerBattle} style={{ padding: '12px 20px', border: 'none', borderRadius: 10, background: '#d9534f', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>⚔️ Challenge {currentNode.kind === 'rival' && rival ? rival.name : currentNode.gymDef?.name}</button>
              )}
              {(currentNode.kind === 'gym' || currentNode.kind === 'rival' || currentNode.kind === 'elite4' || currentNode.kind === 'champion') && isBattleNodeCleared && (
                <span style={{ padding: '12px 20px', borderRadius: 10, background: '#2dc36d', color: '#fff', fontWeight: 800 }}>✅ Already Defeated</span>
              )}
              {currentIndex < mapNodes.length - 1 && (isBattleNodeCleared || currentNode.kind === 'route' || currentNode.kind === 'town') && (
                <button onClick={() => { const n = currentIndex + 1; setCurrentIndex(n); setMaxReached(p => Math.max(p, n)); }} style={{ padding: '10px 16px', border: 'none', borderRadius: 10, background: '#2dc36d', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>→ Forward</button>
              )}
              {currentIndex > 0 && (
                <button onClick={() => setCurrentIndex(p => Math.max(0, p - 1))} style={{ padding: '10px 16px', border: 'none', borderRadius: 10, background: '#6b7280', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>← Back</button>
              )}
            </div>

            {mapOpen && (
              <div style={{ marginTop: 18 }}>
                <MapPath nodes={mapNodes} currentIndex={currentIndex} maxReached={maxReached} onJump={jumpToNode} playerTrainerSprite={trainerSprite} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginTop: 20 }}>
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#99b4e6', textTransform: 'uppercase' }}>Run Status</div>
                <div style={{ marginTop: 8, color: '#f3f7ff', fontSize: 14, lineHeight: 1.7 }}>
                  <div>XP: <strong>{xpTotal}</strong></div>
                  <div>Badges: <strong>{badgeCount}</strong> / {GYM_TYPES.length + ELITE_FOUR_TYPES.length}</div>
                  <div>Coins: <strong>{playerCoins}</strong></div>
                  <div>Team: <strong>{playerTeam.length}</strong> / 6</div>
                  {rival && <div>Rival: <strong>{rival.name}</strong></div>}
                </div>
              </div>
              {activeTown && (
                <div style={{ padding: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#99b4e6', textTransform: 'uppercase' }}>{activeTown.shopName}</div>
                    <button onClick={() => setShopOpen(v => !v)} style={{ padding: '6px 10px', border: 'none', borderRadius: 8, background: '#ffd76a', color: '#121212', fontWeight: 800, cursor: 'pointer' }}>{shopOpen ? 'Hide' : 'Open'}</button>
                  </div>
                  {shopOpen && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {activeTown.items.map(item => (
                        <div key={item.id} style={{ padding: 10, borderRadius: 10, background: 'rgba(14,22,36,0.9)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700, color: '#fff' }}>{item.name}</div>
                            <div style={{ fontSize: 12, color: '#b8c3eb' }}>{item.description}</div>
                          </div>
                          <button onClick={() => buyItem(item)} disabled={playerCoins < item.price} style={{ padding: '8px 10px', border: 'none', borderRadius: 8, background: playerCoins >= item.price ? '#68d391' : '#6b7280', color: '#0c1017', fontWeight: 800, cursor: playerCoins >= item.price ? 'pointer' : 'not-allowed' }}>{item.price}¢</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {battleLog.length > 0 && (
              <div style={{ marginTop: 20, padding: 12, background: 'rgba(0,0,0,0.18)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                {battleLog.slice(-8).map((logEntry, index) => (<div key={index} style={{ color: logEntry.type === 'system' ? '#b8c3eb' : logEntry.type === 'item' ? '#ffd76a' : '#eaf2ff', fontSize: 13, padding: '2px 0' }}>{logEntry.msg}</div>))}
              </div>
            )}
          </div>

          <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'linear-gradient(180deg,#161c2a 0%,#101827 100%)', borderRadius: 18, padding: 18, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 30px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 80, height: 80, borderRadius: 16, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <img src={trainerPortraitUrl(trainerSprite)} alt="Trainer" onError={(event) => { const image = event.currentTarget as HTMLImageElement; image.src = trainerPortraitUrl(DEFAULT_TRAINER_SPRITE); }} style={{ width: 72, height: 72, imageRendering: 'pixelated', objectFit: 'contain' }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#9fb4d9', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Trainer</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 2 }}>You</div>
                </div>
              </div>
            </div>

            <div style={{ background: 'linear-gradient(180deg,#111827 0%,#182c34 100%)', borderRadius: 18, padding: 18, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 30px rgba(0,0,0,0.18)' }}>
              <div style={{ fontSize: 11, color: '#9fb4d9', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Team</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {playerTeam.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
                    <img src={iconUrl(m.speciesId)} alt={m.displayName} style={{ width: 32, height: 32, imageRendering: 'pixelated' }} />
                    <div style={{ fontSize: 12, color: '#eef4ff' }}>{m.displayName} Lv.{m.level}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'linear-gradient(180deg,#111827 0%,#1b273d 100%)', borderRadius: 18, padding: 18, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 30px rgba(0,0,0,0.18)' }}>
              <div style={{ fontSize: 11, color: '#9fb4d9', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Inventory</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(inventory).map(([key, count]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, color: '#eef4ff' }}>
                    <span>{key}</span><strong>x{count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>)}

      {phase === 'battle' && currentNode && (
        <BattleScreen
          team={playerTeam} enemies={enemyTeam} log={battleLog} onUseMove={processAction}
          bg={currentNode.bg} opponentName={battleOpponentName} opponentSprite={battleOpponentSprite}
          playerTrainerSprite={trainerSprite}
        />
      )}

      {phase === 'victory' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#2d5a27', borderRadius: 10 }}>
          <h1 style={{ color: '#ffd700' }}>🏆 CHAMPION! 🏆</h1>
          <p>You defeated {CHAMPION_NAME} with {badgeCount} badges and {xpTotal} XP! (Seed: {seed})</p>
          <button onClick={() => startNewGame()} style={{ padding: '15px 30px', border: 'none', borderRadius: 8, background: '#ffd700' }}>Play Again</button>
        </div>)}

      {phase === 'game_over' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#5a1a1a', borderRadius: 10 }}>
          <h1>💀 GAME OVER 💀</h1><p>Your team fainted against {currentNode?.kind === 'rival' && rival ? rival.name : (currentNode?.gymDef?.name || 'a trainer')}. (Seed: {seed})</p>
          <button onClick={() => startNewGame()} style={{ padding: '15px 30px', border: 'none', borderRadius: 8, background: '#ffd700' }}>Try Again</button>
        </div>)}
    </div>);
};
// end of RogueModeGame.tsx
