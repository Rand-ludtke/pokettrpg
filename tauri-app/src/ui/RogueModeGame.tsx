// RogueModeGame.tsx — PokeRogue-style dungeon-crawl mode built on the REAL merged Pokedex
// (base Showdown dex + Sage/Insurgence/Wylin/Uranium/Infinity/Mariomon/Pokeathlon-Soulstones,
// 4000+ species total). Starts with a single starter, allows full backtracking through every
// previously-visited route to re-search for wild Pokemon/items, and features a full 8-gym
// bracket (2 leader variants per type for variety) plus an Elite Four and Champion gauntlet,
// all using real dex species/sprites/types instead of procedurally-generated placeholder mons.

import React, { useState, useEffect, useCallback } from 'react';
import { loadShowdownDex, spriteUrl, iconUrl, type DexIndex, type DexSpecies } from '../data/adapter';
import { getClient } from '../net/pokettrpgClient';
import { withPublicBase } from '../utils/publicBase';

// ──────────────────────────────── TYPES ─────────────────────────────────────

interface RogueMon {
  speciesId: string;
  displayName: string;
  types: string[];
  level: number;
  currentHp: number;
  maxHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpa: number;
  baseSpd: number;
  baseSpe: number;
  moves: string[];
}
interface LogEntry { msg: string; type: 'action' | 'damage' | 'heal' | 'win' | 'lose' | 'system' | 'item'; }
type GamePhase = 'loading' | 'main_menu' | 'starter_select' | 'exploring' | 'battle' | 'victory' | 'game_over';
type NodeKind = 'route' | 'town' | 'rival' | 'gym' | 'elite4' | 'champion';

interface GymLeaderDef { name: string; type: string; badge: string; }
interface RivalDef { name: string; dialogue: string; }

interface MapNode {
  id: string;
  kind: NodeKind;
  name: string;
  type: string; // primary theme type for this node (route encounters / gym specialty)
  levelLo: number;
  levelHi: number;
  gymDef?: GymLeaderDef;
  rivalDef?: RivalDef;
  cleared?: boolean;
}

interface ShopItem { id: string; name: string; price: number; description: string; effect: 'heal' | 'boost' | 'utility'; }
interface ShopInfo { name: string; leader: string; shopName: string; items: ShopItem[]; }

// ──────────────────────── TYPE COLOR PALETTE ─────────────────────────────────

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

// ──────────────────── GYM / ELITE FOUR / CHAMPION DEFINITIONS ────────────────

const GYM_TYPES = ['Rock', 'Fire', 'Water', 'Electric', 'Grass', 'Psychic', 'Ice', 'Dragon'];
const ELITE_FOUR_TYPES = ['Ghost', 'Dark', 'Fighting', 'Steel'];

// 2 leader variants per gym type for variety — one is randomly picked per new run.
const GYM_LEADER_POOL: Record<string, { name: string; badge: string }[]> = {
  Rock: [{ name: 'Boulder Baron Cole', badge: 'Boulder Badge' }, { name: 'Quarry Queen Thea', badge: 'Boulder Badge' }],
  Fire: [{ name: 'Ember Master Ryu', badge: 'Flame Badge' }, { name: 'Blaze Captain Nia', badge: 'Flame Badge' }],
  Water: [{ name: 'Tide Warden Mika', badge: 'Wave Badge' }, { name: 'Current Captain Dez', badge: 'Wave Badge' }],
  Electric: [{ name: 'Volt Ace Jax', badge: 'Bolt Badge' }, { name: 'Circuit Sage Amy', badge: 'Bolt Badge' }],
  Grass: [{ name: 'Bloom Keeper Fen', badge: 'Leaf Badge' }, { name: 'Thicket Guard Lio', badge: 'Leaf Badge' }],
  Psychic: [{ name: 'Mind Seer Yuna', badge: 'Mind Badge' }, { name: 'Oracle Wren', badge: 'Mind Badge' }],
  Ice: [{ name: 'Frost Warden Kai', badge: 'Frost Badge' }, { name: 'Glacier Queen Sol', badge: 'Frost Badge' }],
  Dragon: [{ name: 'Wyrm Lord Drex', badge: 'Dragon Badge' }, { name: 'Skyfang Rho', badge: 'Dragon Badge' }],
};

const ELITE_FOUR_LEADERS: { type: string; name: string }[] = [
  { type: 'Ghost', name: 'Elite Four • Specter Mora' },
  { type: 'Dark', name: 'Elite Four • Shade Korrin' },
  { type: 'Fighting', name: 'Elite Four • Brawn Talis' },
  { type: 'Steel', name: 'Elite Four • Forge Adair' },
];

const CHAMPION_NAME = 'Champion Astra';

const RIVAL_NAMES = ['Rival Ash', 'Rival Koa', 'Rival Vex', 'Rival Juno'];

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

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSpeciesOfType(pool: SpeciesPool, type: string): string | undefined {
  const bucket = pool.byType[type];
  if (bucket && bucket.length) return pickRandom(bucket);
  return pickRandom(pool.all);
}

function statAt(base: number, level: number): number {
  return Math.floor(((2 * base + 31) * level) / 100) + 5;
}
function hpAt(base: number, level: number): number {
  return Math.floor(((2 * base + 31) * level) / 100) + level + 10;
}

function buildRogueMon(key: string, entry: DexSpecies, level: number, isBoss = false): RogueMon {
  const bs = entry.baseStats;
  const mult = isBoss ? 1.15 : 1;
  const maxHp = Math.max(1, Math.floor(hpAt(bs.hp, level) * mult));
  return {
    speciesId: key,
    displayName: entry.name || key,
    types: entry.types,
    level,
    currentHp: maxHp,
    maxHp,
    baseAtk: Math.floor(statAt(bs.atk, level) * mult),
    baseDef: Math.floor(statAt(bs.def, level) * mult),
    baseSpa: Math.floor(statAt(bs.spa, level) * mult),
    baseSpd: Math.floor(statAt(bs.spd, level) * mult),
    baseSpe: Math.floor(statAt(bs.spe, level) * mult),
    moves: pickMovesForTypes(entry.types),
  };
}

function execMove(attacker: RogueMon, defenderTypes: string[], moveName: string): { damage: number; label: string; miss: boolean } {
  const mv = MOVES_DB[moveName];
  if (!mv) return { damage: 0, label: '', miss: false };
  const eff = getEffectiveness(mv.type, defenderTypes);
  let label: string;
  if (eff > 1) label = `✨${Math.round(eff * 100)}%`;
  else if (eff === 0) label = '🚫 No Effect!';
  else if (eff < 1) label = '🛡️ not very effective…';
  else label = '';
  if (Math.random() < 0.08) return { damage: 0, label: '💨 Missed!', miss: true };
  if (mv.category === 'status') return { damage: 0, label: '', miss: false };
  const atkSt = mv.category === 'physical' ? attacker.baseAtk : attacker.baseSpa;
  const defSt = Math.max(attacker.baseDef * 0.8, 1);
  const baseDmg = ((2 * attacker.level / 5 + 2) * mv.power * atkSt / (defSt * 50)) + 2;
  return { damage: Math.max(1, Math.floor(baseDmg * eff)), label, miss: false };
}

// ──────────────────────── MAP GENERATION (backtrack-capable) ─────────────────

function buildMapNodes(): MapNode[] {
  const nodes: MapNode[] = [];
  GYM_TYPES.forEach((type, i) => {
    const lo = 6 + i * 10;
    const hi = lo + 8;
    nodes.push({ id: `route_${i}`, kind: 'route', name: `${type} Route`, type, levelLo: lo, levelHi: hi });
    if (i % 2 === 1) {
      nodes.push({ id: `rival_${i}`, kind: 'rival', name: `${RIVAL_NAMES[Math.floor(i / 2) % RIVAL_NAMES.length]} Appears!`, type, levelLo: lo + 2, levelHi: hi + 2 });
    }
    const leaderChoice = pickRandom(GYM_LEADER_POOL[type]) || GYM_LEADER_POOL[type][0];
    nodes.push({
      id: `gym_${i}`, kind: 'gym', name: `${type} Gym`, type, levelLo: hi + 4, levelHi: hi + 8,
      gymDef: { name: leaderChoice.name, type, badge: leaderChoice.badge },
    });
    nodes.push({ id: `town_${i}`, kind: 'town', name: SHOP_MAP[type]?.name || `${type} Town`, type, levelLo: hi, levelHi: hi });
  });
  ELITE_FOUR_TYPES.forEach((type, i) => {
    nodes.push({
      id: `elite4_${i}`, kind: 'elite4', name: ELITE_FOUR_LEADERS[i].name, type,
      levelLo: 88 + i * 3, levelHi: 92 + i * 3,
      gymDef: { name: ELITE_FOUR_LEADERS[i].name, type, badge: 'Elite Emblem' },
    });
  });
  nodes.push({
    id: 'champion', kind: 'champion', name: CHAMPION_NAME, type: 'Normal', levelLo: 100, levelHi: 105,
    gymDef: { name: CHAMPION_NAME, type: 'Normal', badge: 'Champion Crown' },
  });
  return nodes;
}

function generateTrainerTeam(pool: SpeciesPool, dex: DexIndex, type: string, levelLo: number, levelHi: number, size: number): RogueMon[] {
  const team: RogueMon[] = [];
  for (let i = 0; i < size; i++) {
    const key = pickSpeciesOfType(pool, type);
    if (!key || !dex[key]) continue;
    const level = levelLo + Math.floor(Math.random() * Math.max(1, levelHi - levelLo));
    team.push(buildRogueMon(key, dex[key], level, true));
  }
  return team;
}

function generateChampionTeam(pool: SpeciesPool, dex: DexIndex, levelLo: number, levelHi: number): RogueMon[] {
  const usedTypes = new Set<string>();
  const team: RogueMon[] = [];
  const shuffledTypes = [...GYM_TYPES, ...ELITE_FOUR_TYPES].sort(() => Math.random() - 0.5);
  for (const type of shuffledTypes) {
    if (team.length >= 6) break;
    if (usedTypes.has(type)) continue;
    usedTypes.add(type);
    const key = pickSpeciesOfType(pool, type);
    if (!key || !dex[key]) continue;
    const level = levelLo + Math.floor(Math.random() * Math.max(1, levelHi - levelLo));
    team.push(buildRogueMon(key, dex[key], level, true));
  }
  return team;
}

// ──────────────────────── STARTER DATA (real dex species) ────────────────────

const STARTER_KEYS = ['charmander', 'squirtle', 'bulbasaur'];

// ════════════════════ BATTLE SCREEN SUB-COMPONENT ═════════════════════════

interface BattleScreenProps {
  team: RogueMon[]; enemies: RogueMon[]; log: LogEntry[]; onUseMove: (m: string) => void;
}
const MonCard: React.FC<{ mon: RogueMon; active: boolean; isEnemy?: boolean }> = ({ mon, active, isEnemy }) => {
  const [src, setSrc] = useState(() => spriteUrl(mon.speciesId, false, { back: !isEnemy, forceStatic: true }));
  useEffect(() => { setSrc(spriteUrl(mon.speciesId, false, { back: !isEnemy, forceStatic: true })); }, [mon.speciesId, isEnemy]);
  return (
    <div style={{
      padding: 8, background: mon.currentHp > 0 ? (isEnemy ? '#30475e' : '#16213e') : '#3d0f0f', borderRadius: 6,
      border: active ? '2px solid gold' : '1px solid #444', opacity: mon.currentHp <= 0 ? 0.5 : 1, minWidth: 200,
      display: 'flex', gap: 8, alignItems: 'center',
    }}>
      <img
        src={src}
        onError={() => setSrc(iconUrl(mon.speciesId))}
        alt={mon.displayName}
        style={{ width: 48, height: 48, imageRendering: 'pixelated', objectFit: 'contain' }}
      />
      <div>
        <div>{mon.displayName} Lv.{mon.level}</div>
        <div style={{ color: TYPE_COLORS[mon.types[0]] || '#888', fontSize: 12 }}>{mon.types.join('/')}</div>
        <div>HP:<span style={{ color: mon.currentHp > mon.maxHp * 0.2 ? '#4caf50' : '#ff4444' }}> {mon.currentHp}/{mon.maxHp}</span></div>
        <div style={{ height: 6, width: 120, background: '#333', borderRadius: 4, marginTop: 2 }}>
          <div style={{ height: '100%', width: `${(mon.currentHp / mon.maxHp) * 100}%`, background: mon.currentHp > mon.maxHp * 0.2 ? '#4caf50' : '#ff4444', borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
};

const BattleScreen: React.FC<BattleScreenProps> = ({ team, enemies, log, onUseMove }) => {
  const finished = log.some(l => l.type === 'win' || l.type === 'lose');
  const activePlayerIdx = team.findIndex(m => m.currentHp > 0);
  const activeEnemyIdx = enemies.findIndex(m => m.currentHp > 0);
  const activeMon = team[activePlayerIdx];

  return (
    <div style={{ padding: 20, background: '#1a1a2e', color: '#fff', borderRadius: 10, fontFamily: 'Arial,sans-serif' }}>
      <h3 style={{ marginBottom: 12 }}>⚔️ Battle Active</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {team.map((p, i) => <MonCard key={i} mon={p} active={i === activePlayerIdx} />)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {enemies.map((e, i) => <MonCard key={i} mon={e} active={i === activeEnemyIdx} isEnemy />)}
      </div>
      <div style={{ padding: 8, background: '#0f3460', borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
        {log.slice(-15).map((entry, i) => (
          <div key={i} style={{ padding: '2px 0', color: entry.type === 'win' ? '#4caf50' : entry.type === 'lose' ? '#ff4444' : entry.type === 'damage' ? '#ffd700' : '#ccc' }}>
            {entry.msg}
          </div>))}
      </div>
      {!finished && activeMon && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeMon.moves.map(mv => {
            const d = MOVES_DB[mv];
            return <button key={mv} onClick={() => onUseMove(mv)} style={{
              padding: '10px 16px', border: 'none', borderRadius: 6, background: d ? TYPE_COLORS[d.type] || '#555' : '#555',
              color: '#fff', cursor: 'pointer', fontWeight: 'bold',
            }}>{mv}</button>;
          })}
        </div>)}
      {finished && (<button onClick={() => onUseMove('continue')} style={{ padding: '12px 24px', border: 'none', borderRadius: 8, background: '#ffd700', color: '#333', cursor: 'pointer', fontWeight: 'bold', marginTop: 16 }}>Continue →</button>)}
    </div>);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadShowdownDex();
        if (cancelled) return;
        setDex(result.pokedex);
        setPool(buildSpeciesPool(result.pokedex));
        setPhase('main_menu');
      } catch {
        if (!cancelled) setPhase('main_menu');
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

  const startNewGame = useCallback(() => {
    const nodes = buildMapNodes();
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
    setBattleLog([{ msg: 'Welcome to RogueMode! Choose your starter.', type: 'system' }]);
    setPhase('starter_select');
  }, []);

  const pickStarter = useCallback((key: string) => {
    if (!dex || !dex[key]) return;
    const mon = buildRogueMon(key, dex[key], 5, false);
    setPlayerTeam([mon]);
    setPhase('exploring');
    setBattleLog([{ msg: `You chose ${mon.displayName}! Let's explore.`, type: 'system' }]);
  }, [dex]);

  // ── wild encounter on a route node ──────────────────────────────────────
  const searchRoute = useCallback(() => {
    if (!pool || !dex || !currentNode || currentNode.kind !== 'route') return;
    const key = pickSpeciesOfType(pool, currentNode.type);
    if (!key || !dex[key]) return;
    const level = currentNode.levelLo + Math.floor(Math.random() * Math.max(1, currentNode.levelHi - currentNode.levelLo));
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
    const size = currentNode.kind === 'gym' ? 3 : currentNode.kind === 'rival' ? 2 : currentNode.kind === 'elite4' ? 4 : 6;
    const team = currentNode.kind === 'champion'
      ? generateChampionTeam(pool, dex, currentNode.levelLo, currentNode.levelHi)
      : generateTrainerTeam(pool, dex, currentNode.type, currentNode.levelLo, currentNode.levelHi, size);
    if (!team.length) return;
    setEnemyTeam(team);
    setBattleContext('trainer');
    setBattleLog(p => [...p, { msg: `${currentNode.gymDef?.name || 'A trainer'} challenges you!`, type: 'system' }]);
    setPhase('battle');
  }, [pool, dex, currentNode]);

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
          const avgx = Math.floor(xep / playerTeam.length);
          setPlayerTeam(prev => prev.map(m => {
            const nm = { ...m };
            let t = avgx;
            while (t > 0 && nm.level < 100 && avgx >= xpThresholdFor(nm.level)) {
              nm.level++; t -= xpThresholdFor(nm.level);
            }
            const pct = (m.currentHp / m.maxHp) || 1;
            nm.maxHp = Math.floor(hpAt(m.maxHp, 1) > 0 ? nm.maxHp : nm.maxHp); // no-op guard
            nm.currentHp = Math.floor(pct * nm.maxHp);
            return nm;
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
        if (battleContext === 'wild') {
          // Losing a wild encounter just returns you to exploring (no game over on wild losses).
          setPlayerTeam(p => p.map(m => ({ ...m, currentHp: Math.max(1, Math.floor(m.maxHp * 0.1)) })));
          setPhase('exploring');
        } else {
          setPhase('game_over');
        }
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
    const defTypes = [...foeOut[eIdx].types];

    if (MOVES_DB[action]?.category === 'status') {
      const amt = Math.floor(attacker.maxHp * 0.5);
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + amt);
      logs.push({ msg: `${attacker.displayName} used ${action}! (+${amt} HP)`, type: 'heal' });
    } else {
      const res = execMove(attacker, defTypes, action);
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
        const r2 = execMove(ea, [tgt.types[0]], mv);
        if (r2.miss) { logs.push({ msg: `${ea.displayName} missed!`, type: 'action' }); return; }
        teamOut[ti] = { ...teamOut[ti], currentHp: Math.max(0, tgt.currentHp - r2.damage) };
        logs.push({ msg: `${ea.displayName} used ${mv} on ${tgt.displayName}${r2.label ? ' ' + r2.label : ''} (-${r2.damage} HP)`, type: 'damage' });
      };
      foeOut.filter(e => e.currentHp > 0).forEach(attackBack);
    }

    if (!teamOut.some(m => m.currentHp > 0)) logs.push({ msg: '💀 Your team fainted!', type: 'lose' });
    setPlayerTeam(teamOut); setEnemyTeam(foeOut); setBattleLog(p => [...p, ...logs]);
  }, [phase, playerTeam, enemyTeam, battleLog, currentIndex, currentNode, mapNodes, battleContext]);

  // ── backtracking: jump to any previously-reached node ───────────────────
  const jumpToNode = useCallback((idx: number) => {
    if (idx > maxReached) return;
    setCurrentIndex(idx);
    setMapOpen(false);
  }, [maxReached]);

  const isBattleNodeCleared = currentNode?.cleared;

  return (
    <div style={{ maxWidth: 1000, margin: 'auto', padding: 24, fontFamily: 'Arial,sans-serif', color: '#333' }}>
      {phase === 'loading' && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <h2>Loading the full Pokédex…</h2>
          <p>Fetching 4000+ species from every merged dex source.</p>
        </div>
      )}

      {phase === 'main_menu' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#1a1a2e', borderRadius: 10 }}>
          <h1 style={{ color: '#ffd700', fontSize: 36, marginBottom: 8 }}>⚡ ROGUE MODE ⚡</h1>
          <p style={{ color: '#ccc', fontSize: 18, maxWidth: 600, margin: 'auto' }}>
            A PokeRogue-style gauntlet drawing from the FULL merged Pokédex ({pool ? pool.all.length.toLocaleString() : '...'} species).
            Start with a single partner, explore 8 gym routes with full backtracking, battle rivals, and take on the Elite Four and Champion.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            {GYM_TYPES.map(t => (<span key={t} style={{ padding: '4px 10px', background: TYPE_COLORS[t], borderRadius: 4, fontSize: 12, color: '#111' }}>{t} Gym</span>))}
          </div>
          <br />
          <button onClick={startNewGame} style={{ padding: '15px 30px', fontSize: 24, border: 'none', borderRadius: 8, background: '#ffd700', color: '#333', cursor: 'pointer', fontWeight: 'bold' }}>▶ New Run</button>
        </div>)}

      {phase === 'starter_select' && (
        <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 10 }}>
          <h2>🎮 Pick Your Starter</h2>
          <p>Choose your single starting partner — build the rest of your team by capturing wild Pokémon along the way!</p>
          <div style={{ display: 'flex', gap: 15, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            {STARTER_KEYS.map(key => {
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
                <div style={{ fontSize: 12, color: '#a7bce8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{currentNode.kind}</div>
                <h3 style={{ margin: '6px 0 0', fontSize: 28, color: '#f8fbff' }}>{currentNode.name}</h3>
              </div>
              <div style={{ padding: '8px 12px', background: TYPE_COLORS[currentNode.type] || '#888', borderRadius: 999, color: '#111827', fontWeight: 800 }}>{currentNode.type}</div>
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
                <button onClick={startTrainerBattle} style={{ padding: '12px 20px', border: 'none', borderRadius: 10, background: '#d9534f', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>⚔️ Challenge {currentNode.gymDef?.name}</button>
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
              <div style={{ marginTop: 18, padding: 14, background: 'rgba(0,0,0,0.25)', borderRadius: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {mapNodes.map((n, i) => (
                  <button key={n.id} disabled={i > maxReached} onClick={() => jumpToNode(i)} style={{
                    padding: '6px 10px', borderRadius: 8, border: i === currentIndex ? '2px solid gold' : '1px solid rgba(255,255,255,0.2)',
                    background: i > maxReached ? '#333' : TYPE_COLORS[n.type] || '#555', color: i > maxReached ? '#777' : '#111', fontWeight: 700, fontSize: 12,
                    cursor: i > maxReached ? 'not-allowed' : 'pointer', opacity: n.cleared ? 0.6 : 1,
                  }}>{n.cleared ? '✓ ' : ''}{n.name}</button>
                ))}
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
                  <img src={withPublicBase(`vendor/showdown/sprites/trainers/${trainerSprite}.png`)} alt="Trainer" onError={(event) => { const image = event.currentTarget as HTMLImageElement; image.src = withPublicBase(`vendor/showdown/sprites/trainers/${DEFAULT_TRAINER_SPRITE}.png`); }} style={{ width: 72, height: 72, imageRendering: 'pixelated', objectFit: 'contain' }} />
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

      {phase === 'battle' && (<BattleScreen team={playerTeam} enemies={enemyTeam} log={battleLog} onUseMove={processAction} />)}

      {phase === 'victory' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#2d5a27', borderRadius: 10 }}>
          <h1 style={{ color: '#ffd700' }}>🏆 CHAMPION! 🏆</h1>
          <p>You defeated {CHAMPION_NAME} with {badgeCount} badges and {xpTotal} XP!</p>
          <button onClick={startNewGame} style={{ padding: '15px 30px', border: 'none', borderRadius: 8, background: '#ffd700' }}>Play Again</button>
        </div>)}

      {phase === 'game_over' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#5a1a1a', borderRadius: 10 }}>
          <h1>💀 GAME OVER 💀</h1><p>Your team fainted against {currentNode?.gymDef?.name || 'a trainer'}.</p>
          <button onClick={startNewGame} style={{ padding: '15px 30px', border: 'none', borderRadius: 8, background: '#ffd700' }}>Try Again</button>
        </div>)}
    </div>);
};
// end of RogueModeGame.tsx
