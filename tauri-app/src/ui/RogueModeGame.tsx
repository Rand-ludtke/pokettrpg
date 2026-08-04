// RogueModeGame.tsx — PokeRogue-style dungeon-crawl mode built on the REAL merged Pokedex
// (base Showdown dex + Sage/Insurgence/Wylin/Uranium/Infinity/Mariomon/Pokeathlon-Soulstones,
// 4000+ species total). Single starter (chosen from a "Starter Box" grid with a candy-based
// unlock system persisted across runs), full backtracking, real level-up/TM learnset-derived
// movesets (no more random type movepools), fair level-scaling tied to the player's current
// team level, a real roster of official regional gym leaders / Elite Four / Champions, a
// persistent recurring rival, seed-based deterministic run generation, true permadeath, a
// PokeRogue/mainline-style battle arena + overworld map, and a working Poké Ball catch system.
// The entire run is persisted to localStorage so switching app tabs never resets progress.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadShowdownDex, spriteUrl, iconUrl, type DexIndex, type DexSpecies, type MoveIndex, type LearnsetsIndex } from '../data/adapter';
import { getClient } from '../net/pokettrpgClient';
import { withPublicBase } from '../utils/publicBase';

// ──────────────────────────────── SEEDED RNG ─────────────────────────────────
// Deterministic PRNG so a given seed always reproduces the same map layout,
// gym-order, rival identity, leader variants, movesets and wild encounters
// (PokeRogue-style run variation via seeds). Battle-turn randomness (miss chance,
// AI move choice) intentionally still uses Math.random so battles stay unpredictable.

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

// ──────────────────────────────── ENGINE CONTEXT ─────────────────────────────
// Bundles the loaded dex/moves/learnsets so battle-team generation can resolve
// REAL level-up movesets instead of a synthetic per-type movepool.

interface Engine { dex: DexIndex; moves: MoveIndex; learnsets: LearnsetsIndex; }

// Type-based fallback movepool — used ONLY for species with no resolvable real
// learnset data (this covers ~99% of the custom Soulstones/Pokeathlon roster,
// which ships with no learnset.json entries at all). Ensures every custom mon
// still gets a sensible, on-type 4-move kit instead of degrading to Tackle-only,
// while species with real learnset data (all base-game Pokémon) always use
// their accurate level-up/TM movesets from resolveMovesForLevel below.
const TYPE_FALLBACK_MOVES: Record<string, string[]> = {
  Normal: ['bodyslam', 'quickattack', 'hyperbeam', 'facade'],
  Fire: ['flamethrower', 'firepunch', 'ember', 'fireblast'],
  Water: ['surf', 'watergun', 'hydropump', 'icebeam'],
  Electric: ['thunderbolt', 'thundershock', 'voltswitch', 'wildcharge'],
  Grass: ['energyball', 'gigadrain', 'leafblade', 'solarbeam'],
  Ice: ['icebeam', 'icywind', 'blizzard', 'freezedry'],
  Fighting: ['closecombat', 'brickbreak', 'focusblast', 'drainpunch'],
  Poison: ['sludgebomb', 'poisonjab', 'toxic', 'acidspray'],
  Ground: ['earthquake', 'bulldoze', 'dig', 'mudshot'],
  Flying: ['airslash', 'bravebird', 'aircutter', 'gust'],
  Psychic: ['psychic', 'psyshock', 'confusion', 'zenheadbutt'],
  Bug: ['xscissor', 'bugbuzz', 'megahorn', 'bugbite'],
  Rock: ['rockslide', 'stoneedge', 'rockthrow', 'rockblast'],
  Ghost: ['shadowball', 'shadowclaw', 'lick', 'hex'],
  Dragon: ['dragonclaw', 'dragonpulse', 'dragonbreath', 'outrage'],
  Dark: ['darkpulse', 'crunch', 'bite', 'suckerpunch'],
  Steel: ['ironhead', 'irontail', 'metalclaw', 'flashcannon'],
  Fairy: ['moonblast', 'dazzlinggleam', 'playrough', 'drainingkiss'],
  // Soulstone types get real-type-flavored proxy moves since these move ids don't
  // exist in Showdown's moves.json; execMoveReal already understands custom types
  // via their base power/category being resolved from the underlying real move.
  Crystal: ['icebeam', 'rockslide', 'psychic', 'moonblast'],
  Cosmic: ['psychic', 'dragonpulse', 'darkpulse', 'flashcannon'],
  Nuclear: ['thunderbolt', 'sludgebomb', 'shadowball', 'facade'],
  Stellar: ['shadowball', 'darkpulse', 'flamethrower', 'hydropump'],
  Sound: ['bugbuzz', 'airslash', 'crunch', 'icywind'],
  Light: ['dazzlinggleam', 'flashcannon', 'psychic', 'shadowball'],
};

function typeBasedFallbackMoves(types: string[], engine: Engine, rng: () => number): string[] {
  const out: string[] = [];
  const push = (id: string) => { if (id && engine.moves[id] && !out.includes(id)) out.push(id); };
  for (const t of types) {
    const pool = shuffle(TYPE_FALLBACK_MOVES[t] || [], rng);
    for (const id of pool) { push(id); if (out.length >= 4) break; }
    if (out.length >= 4) break;
  }
  push('tackle');
  return out.slice(0, 4);
}

/**
 * Resolve up to 4 moves a species actually knows by the given level, using the
 * real Showdown learnset data (e.g. "9L6" = learned at level 6 in gen 9).
 * Picks the most-recently-learned moves first (mainline-accurate), instead of
 * the old random same-type movepool that could hand a level-5 Bulbasaur
 * Solar Beam. Species with NO resolvable learnset (all custom Soulstones/
 * Pokeathlon mons, which ship without learnset.json data) fall back to a
 * curated on-type movepool instead of degrading to Tackle-only.
 */
function resolveMovesForLevel(speciesKey: string, level: number, types: string[], engine: Engine, rng: () => number): string[] {
  const entry = engine.learnsets[speciesKey];
  const learnset = entry?.learnset || {};
  const candidates: { id: string; lvl: number }[] = [];
  for (const [moveId, tags] of Object.entries(learnset)) {
    if (!Array.isArray(tags)) continue;
    if (!engine.moves[moveId]) continue; // skip moves we don't have data for
    let bestLvl = -1;
    for (const t of tags as unknown as string[]) {
      const m = /^\d+L(\d+)$/.exec(String(t));
      if (m) {
        const lvl = parseInt(m[1], 10);
        if (lvl <= level && lvl > bestLvl) bestLvl = lvl;
      }
    }
    if (bestLvl >= 0) candidates.push({ id: moveId, lvl: bestLvl });
  }
  if (candidates.length === 0) return typeBasedFallbackMoves(types, engine, rng);
  // Group by learn-level so we can prefer the most recently learned moves first,
  // randomizing the order *within* a level so repeat runs still feel varied.
  const grouped: Record<number, string[]> = {};
  for (const c of candidates) { (grouped[c.lvl] = grouped[c.lvl] || []).push(c.id); }
  const orderedLevels = Object.keys(grouped).map(Number).sort((a, b) => b - a);
  const chosen: string[] = [];
  for (const lvl of orderedLevels) {
    const group = shuffle(grouped[lvl], rng);
    for (const id of group) {
      if (!chosen.includes(id)) chosen.push(id);
      if (chosen.length >= 4) break;
    }
    if (chosen.length >= 4) break;
  }
  if (chosen.length === 0) return typeBasedFallbackMoves(types, engine, rng);
  return chosen;
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
  /** Move IDs (Showdown-style, e.g. "vinewhip") resolved from the real learnset at this level. */
  moves: string[];
}
interface LogEntry { msg: string; type: 'action' | 'damage' | 'heal' | 'win' | 'lose' | 'system' | 'item' | 'catch'; }

type GamePhase = 'loading' | 'main_menu' | 'starter_select' | 'exploring' | 'battle' | 'victory' | 'game_over';
type NodeKind = 'route' | 'town' | 'rival' | 'gym' | 'elite4' | 'champion';

interface GymLeaderDef { name: string; type: string; badge: string; sprite: string; }

interface MapNode {
  id: string;
  kind: NodeKind;
  name: string;
  type: string; // primary theme type for this node (route encounters / gym specialty)
  bg: string; // background image key (gen6bgs)
  gymDef?: GymLeaderDef;
  rivalOccurrence?: number; // 1-based count of which rival appearance this is
  cleared?: boolean;
}

interface ShopItem { id: string; name: string; price: number; description: string; effect: 'heal' | 'boost' | 'utility'; }
interface ShopInfo { name: string; leader: string; shopName: string; items: ShopItem[]; }
interface RivalInfo { name: string; sprite: string; }

// ──────────────────── PERSISTENT RUN STORAGE (survives tab switches) ────────

const RUN_STORAGE_KEY = 'ttrpg.rogueRun.v4';
const RUN_STORAGE_VERSION = 4;

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
  championName: string;
  championSprite: string;
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

// ──────────────────── PERSISTENT META PROGRESSION (starter unlocks/candy) ────
// Separate from the run save — survives across runs permanently, PokeRogue-style.

const META_STORAGE_KEY = 'ttrpg.rogueMeta.v1';
interface RogueMeta { candy: number; unlocked: string[]; }
const DEFAULT_UNLOCKED = ['bulbasaur', 'charmander', 'squirtle'];

function loadMeta(): RogueMeta {
  try {
    const raw = window.localStorage?.getItem(META_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.unlocked)) return { candy: Number(parsed.candy) || 0, unlocked: parsed.unlocked };
    }
  } catch {}
  return { candy: 0, unlocked: [...DEFAULT_UNLOCKED] };
}
function saveMeta(meta: RogueMeta): void {
  try { window.localStorage?.setItem(META_STORAGE_KEY, JSON.stringify(meta)); } catch {}
}
/** Candy cost to unlock a starter, scaled by generation (later gens cost more). */
function unlockCost(gen: number): number {
  return 20 + (gen - 1) * 10;
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

// Status moves that restore HP — used since real move data doesn't carry "heal" semantics
// in our simplified engine; whitelisting the common recovery moves keeps them useful.
const HEAL_MOVE_IDS = new Set(['recover', 'roost', 'softboiled', 'milkdrink', 'synthesis', 'moonlight', 'morningsun', 'slackoff', 'shoreup', 'wish', 'rest', 'junglehealing', 'lifedew', 'strengthsap']);

/** Fallback move used only when a species has zero resolvable learnset data. */
const FALLBACK_MOVE_ID = 'tackle';

function execMoveReal(attacker: RogueMon, defender: RogueMon, moveId: string, moves: MoveIndex): { damage: number; label: string; miss: boolean; heal: number; displayName: string } {
  const mv = moves[moveId];
  const displayName = mv?.name || moveId;
  if (!mv) return { damage: 0, label: '', miss: false, heal: 0, displayName };

  if (HEAL_MOVE_IDS.has(moveId)) {
    const heal = Math.floor(attacker.maxHp * 0.5);
    return { damage: 0, label: '', miss: false, heal, displayName };
  }
  if (mv.category === 'Status' || !mv.basePower) {
    return { damage: 0, label: '', miss: false, heal: 0, displayName };
  }

  const eff = getEffectiveness(mv.type, defender.types);
  let label: string;
  if (eff > 1) label = `✨${Math.round(eff * 100)}%`;
  else if (eff === 0) label = '🚫 No Effect!';
  else if (eff < 1) label = '🛡️ not very effective…';
  else label = '';

  if (mv.accuracy !== true && typeof mv.accuracy === 'number') {
    if (Math.random() * 100 > mv.accuracy) return { damage: 0, label: '💨 Missed!', miss: true, heal: 0, displayName };
  }

  const atkSt = mv.category === 'Physical' ? attacker.atk : attacker.spa;
  const defSt = Math.max((mv.category === 'Physical' ? defender.def : defender.spd) * 0.8, 1);
  const baseDmg = ((2 * attacker.level / 5 + 2) * mv.basePower * atkSt / (defSt * 50)) + 2;
  return { damage: Math.max(1, Math.floor(baseDmg * eff)), label, miss: false, heal: 0, displayName };
}

// ──────────────────── REAL GYM LEADERS / ELITE FOUR / CHAMPIONS ─────────────
// Actual official mainline-series gym leaders, Elite Four members and Champions,
// grouped by their canon specialty type, drawn from across every generation —
// PokeRogue-style "mix of real leaders" rather than invented placeholder names.
// Sprites verified to exist in vendor/showdown/sprites/trainers/.

const GYM_TYPES = ['Rock', 'Fire', 'Water', 'Electric', 'Grass', 'Psychic', 'Ice', 'Dragon'];
const ELITE_FOUR_TYPES = ['Ghost', 'Dark', 'Fighting', 'Steel'];

const GYM_LEADER_POOL: Record<string, { name: string; badge: string; sprite: string }[]> = {
  Rock: [
    { name: 'Roxanne', badge: 'Stone Badge', sprite: 'roxanne' },
    { name: 'Roark', badge: 'Coal Badge', sprite: 'roark' },
    { name: 'Grant', badge: 'Cliff Badge', sprite: 'grant' },
  ],
  Fire: [
    { name: 'Blaine', badge: 'Volcano Badge', sprite: 'blaine' },
    { name: 'Flannery', badge: 'Heat Badge', sprite: 'flannery' },
    { name: 'Kabu', badge: 'Fire Badge', sprite: 'kabu' },
  ],
  Water: [
    { name: 'Misty', badge: 'Cascade Badge', sprite: 'misty' },
    { name: 'Juan', badge: 'Rain Badge', sprite: 'juan' },
    { name: 'Nessa', badge: 'Water Badge', sprite: 'nessa' },
  ],
  Electric: [
    { name: 'Lt. Surge', badge: 'Thunder Badge', sprite: 'ltsurge' },
    { name: 'Wattson', badge: 'Dynamo Badge', sprite: 'wattson' },
    { name: 'Elesa', badge: 'Bolt Badge', sprite: 'elesa' },
    { name: 'Iono', badge: 'Bolt Badge', sprite: 'iono' },
  ],
  Grass: [
    { name: 'Erika', badge: 'Rainbow Badge', sprite: 'erika' },
    { name: 'Gardenia', badge: 'Forest Badge', sprite: 'gardenia' },
    { name: 'Milo', badge: 'Grass Badge', sprite: 'milo' },
  ],
  Psychic: [
    { name: 'Sabrina', badge: 'Marsh Badge', sprite: 'sabrina' },
    { name: 'Olympia', badge: 'Psychic Badge', sprite: 'olympia' },
    { name: 'Tulip', badge: 'Psychic Badge', sprite: 'tulip' },
  ],
  Ice: [
    { name: 'Pryce', badge: 'Glacier Badge', sprite: 'pryce' },
    { name: 'Brycen', badge: 'Freeze Badge', sprite: 'brycen' },
    { name: 'Melony', badge: 'Ice Badge', sprite: 'melony' },
    { name: 'Grusha', badge: 'Ice Badge', sprite: 'grusha' },
  ],
  Dragon: [
    { name: 'Clair', badge: 'Rising Badge', sprite: 'clair' },
    { name: 'Drayden', badge: 'Legend Badge', sprite: 'drayden' },
    { name: 'Raihan', badge: 'Dragon Badge', sprite: 'raihan' },
  ],
};

const ELITE_FOUR_POOL: Record<string, { name: string; sprite: string }[]> = {
  Ghost: [{ name: 'Shauntal', sprite: 'shauntal' }],
  Dark: [{ name: 'Karen', sprite: 'karen' }, { name: 'Grimsley', sprite: 'grimsley' }],
  Fighting: [{ name: 'Bruno', sprite: 'bruno' }, { name: 'Marshal', sprite: 'marshal' }],
  Steel: [{ name: 'Wikstrom', sprite: 'wikstrom' }],
};

const CHAMPION_POOL: { name: string; sprite: string }[] = [
  { name: 'Champion Blue', sprite: 'blue' },
  { name: 'Champion Steven', sprite: 'steven' },
  { name: 'Champion Cynthia', sprite: 'cynthia' },
  { name: 'Champion Alder', sprite: 'alder' },
  { name: 'Champion Diantha', sprite: 'diantha' },
  { name: 'Champion Kukui', sprite: 'kukui' },
  { name: 'Champion Leon', sprite: 'leon' },
  { name: 'Champion Geeta', sprite: 'geeta' },
];

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

// Every town sells Poké Balls — the core resource for building your team from wild encounters.
const POKEBALL_ITEM: ShopItem = { id: 'pokeball', name: 'Poké Ball', price: 15, description: 'Throw to try to catch a weakened wild Pokémon', effect: 'utility' };

const SHOP_MAP: Record<string, ShopInfo> = {
  Rock: { name: 'Quarry Town', leader: 'Gym Leader', shopName: 'Boulder Bazaar', items: [POKEBALL_ITEM, { id: 'potion', name: 'Potion', price: 25, description: 'Restores 30% health', effect: 'heal' }, { id: 'boost', name: 'Focus Sash', price: 40, description: 'Boosts offense for one battle', effect: 'boost' }, { id: 'utility', name: 'Escape Rope', price: 30, description: 'Utility item', effect: 'utility' }] },
  Fire: { name: 'Ember City', leader: 'Gym Leader', shopName: 'Flame Market', items: [POKEBALL_ITEM, { id: 'potion', name: 'Super Potion', price: 35, description: 'Restores 40% health', effect: 'heal' }, { id: 'boost', name: 'Charcoal', price: 45, description: 'Raises Attack and SpA', effect: 'boost' }, { id: 'utility', name: 'Fire Stone', price: 60, description: 'Utility relic', effect: 'utility' }] },
  Water: { name: 'Tide Harbor', leader: 'Gym Leader', shopName: 'Wave Emporium', items: [POKEBALL_ITEM, { id: 'potion', name: 'Fresh Water', price: 30, description: 'Heals the team slightly', effect: 'heal' }, { id: 'boost', name: 'Mystic Water', price: 50, description: 'Raises Sp. Atk', effect: 'boost' }, { id: 'utility', name: 'Dive Gear', price: 55, description: 'Route utility upgrade', effect: 'utility' }] },
  Electric: { name: 'Volt Junction', leader: 'Gym Leader', shopName: 'Circuit Depot', items: [POKEBALL_ITEM, { id: 'potion', name: 'Energy Root', price: 32, description: 'Heavy healing', effect: 'heal' }, { id: 'boost', name: 'Magnet', price: 48, description: 'Boosts electric power', effect: 'boost' }, { id: 'utility', name: 'Dynamo Battery', price: 58, description: 'Utility relic', effect: 'utility' }] },
  Grass: { name: 'Bloom Village', leader: 'Gym Leader', shopName: 'Leaf Stand', items: [POKEBALL_ITEM, { id: 'potion', name: 'Herbal Tea', price: 28, description: 'Restore HP and cure status', effect: 'heal' }, { id: 'boost', name: 'Miracle Seed', price: 42, description: 'Raises Defense', effect: 'boost' }, { id: 'utility', name: 'Seed Bag', price: 50, description: 'Exploration utility', effect: 'utility' }] },
  Psychic: { name: 'Mindspire City', leader: 'Gym Leader', shopName: 'Oracle Arcade', items: [POKEBALL_ITEM, { id: 'potion', name: 'Calm Elixir', price: 38, description: 'Restores max health', effect: 'heal' }, { id: 'boost', name: 'Twisted Spoon', price: 55, description: 'Boosts all stats lightly', effect: 'boost' }, { id: 'utility', name: 'Third Eye Lens', price: 70, description: 'Rare utility relic', effect: 'utility' }] },
  Ice: { name: 'Frostpeak Town', leader: 'Gym Leader', shopName: 'Glacier Bodega', items: [POKEBALL_ITEM, { id: 'potion', name: 'Thaw Potion', price: 34, description: 'Quick recovery brew', effect: 'heal' }, { id: 'boost', name: 'Never-Melt Ice', price: 52, description: 'Increases Sp. Def', effect: 'boost' }, { id: 'utility', name: 'Ice Pick', price: 65, description: 'Utility prize', effect: 'utility' }] },
  Dragon: { name: 'Wyrmspire City', leader: 'Gym Leader', shopName: "Drake's Den", items: [POKEBALL_ITEM, { id: 'potion', name: 'Dragon Balm', price: 45, description: 'Full team refresh', effect: 'heal' }, { id: 'boost', name: 'Dragon Fang', price: 65, description: 'Boosts Attack sharply', effect: 'boost' }, { id: 'utility', name: 'Wyrmscale', price: 80, description: 'Rare utility relic', effect: 'utility' }] },
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

function buildRogueMon(key: string, entry: DexSpecies, level: number, engine: Engine, rng: () => number, isBoss = false): RogueMon {
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
    moves: resolveMovesForLevel(key, level, entry.types, engine, rng),
  };
}


/** Recompute a RogueMon's real battle stats for a new level, preserving current HP % (fixes
 *  the bug where leveling up only changed the displayed number with no real stat gain), and
 *  re-resolves its moveset from the real learnset so it learns new moves as it levels up. */
function recomputeLevel(mon: RogueMon, newLevel: number, engine: Engine, rng: () => number): RogueMon {
  const frac = mon.maxHp > 0 ? mon.currentHp / mon.maxHp : 1;
  const stats = computeMonStats(mon.base, newLevel, mon.mult);
  return {
    ...mon,
    level: newLevel,
    maxHp: stats.maxHp, atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe,
    currentHp: Math.max(1, Math.round(stats.maxHp * frac)),
    moves: resolveMovesForLevel(mon.speciesId, newLevel, mon.types, engine, rng),
  };
}


// ──────────────────────── DYNAMIC, FAIR ENCOUNTER LEVELS ─────────────────────
// Levels are derived from the player's CURRENT average team level rather than a
// fixed table tied to map position — this is the direct fix for wild Pokémon
// spawning far above the player (e.g. a level-13 wild mon vs a level-5 starter).

function playerAverageLevel(team: RogueMon[]): number {
  if (!team.length) return 5;
  return Math.round(team.reduce((s, m) => s + m.level, 0) / team.length);
}

function encounterLevelRange(kind: 'wild' | 'rival' | 'gym' | 'elite4' | 'champion', avgLevel: number): [number, number] {
  switch (kind) {
    case 'wild': return [Math.max(2, avgLevel - 2), avgLevel + 1];
    case 'rival': return [avgLevel, avgLevel + 3];
    case 'gym': return [avgLevel + 2, avgLevel + 5];
    case 'elite4': return [avgLevel + 3, avgLevel + 7];
    case 'champion': return [avgLevel + 5, avgLevel + 9];
  }
}
function rollEncounterLevel(kind: 'wild' | 'rival' | 'gym' | 'elite4' | 'champion', avgLevel: number, rng: () => number): number {
  const [lo, hi] = encounterLevelRange(kind, avgLevel);
  return lo + Math.floor(rng() * Math.max(1, hi - lo + 1));
}

// ──────────────────────── MAP GENERATION (seeded, backtrack-capable) ─────────

function buildMapNodes(rng: () => number): MapNode[] {
  const nodes: MapNode[] = [];
  const gymOrder = shuffle(GYM_TYPES, rng);
  let rivalCount = 0;
  gymOrder.forEach((type, i) => {
    nodes.push({ id: `route_${i}`, kind: 'route', name: `${type} Route`, type, bg: bgFor(type, rng) });
    if (i % 2 === 1) {
      rivalCount++;
      nodes.push({ id: `rival_${i}`, kind: 'rival', name: 'Rival Battle', type, bg: bgFor('Normal', rng), rivalOccurrence: rivalCount });
    }
    const leaderChoice = pickRandom(GYM_LEADER_POOL[type], rng) || GYM_LEADER_POOL[type][0];
    nodes.push({
      id: `gym_${i}`, kind: 'gym', name: `${type} Gym`, type, bg: bgFor(type, rng),
      gymDef: { name: leaderChoice.name, type, badge: leaderChoice.badge, sprite: leaderChoice.sprite },
    });
    nodes.push({ id: `town_${i}`, kind: 'town', name: SHOP_MAP[type]?.name || `${type} Town`, type, bg: 'bg-aquacordetown' });
  });
  const elite4TypeOrder = shuffle(ELITE_FOUR_TYPES, rng);
  elite4TypeOrder.forEach((type, i) => {
    const leader = pickRandom(ELITE_FOUR_POOL[type], rng) || ELITE_FOUR_POOL[type][0];
    nodes.push({
      id: `elite4_${i}`, kind: 'elite4', name: `Elite Four • ${leader.name}`, type, bg: 'bg-elite4drake',
      gymDef: { name: `Elite Four • ${leader.name}`, type, badge: 'Elite Emblem', sprite: leader.sprite },
    });
  });
  const champion = pickRandom(CHAMPION_POOL, rng) || CHAMPION_POOL[0];
  nodes.push({
    id: 'champion', kind: 'champion', name: champion.name, type: 'Normal', bg: 'bg-leaderwallace',
    gymDef: { name: champion.name, type: 'Normal', badge: 'Champion Crown', sprite: champion.sprite },
  });
  return nodes;
}

function generateTrainerTeam(pool: SpeciesPool, engine: Engine, type: string, level: number, size: number, rng: () => number): RogueMon[] {
  const team: RogueMon[] = [];
  for (let i = 0; i < size; i++) {
    const key = pickSpeciesOfType(pool, type, rng);
    if (!key || !engine.dex[key]) continue;
    team.push(buildRogueMon(key, engine.dex[key], level, engine, rng, true));
  }
  return team;
}

/** Type-diverse team generator used for the Champion and the recurring Rival. */
function generateDiverseTeam(pool: SpeciesPool, engine: Engine, level: number, size: number, rng: () => number): RogueMon[] {
  const usedTypes = new Set<string>();
  const team: RogueMon[] = [];
  const shuffledTypes = shuffle([...GYM_TYPES, ...ELITE_FOUR_TYPES], rng);
  for (const type of shuffledTypes) {
    if (team.length >= size) break;
    if (usedTypes.has(type)) continue;
    usedTypes.add(type);
    const key = pickSpeciesOfType(pool, type, rng);
    if (!key || !engine.dex[key]) continue;
    team.push(buildRogueMon(key, engine.dex[key], level, engine, rng, true));
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
  isWild: boolean; pokeballCount: number; teamFull: boolean; onCatch: () => void;
  moves: MoveIndex;
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

const BattleScreen: React.FC<BattleScreenProps> = ({ team, enemies, log, onUseMove, bg, opponentName, opponentSprite, playerTrainerSprite, isWild, pokeballCount, teamFull, onCatch, moves }) => {
  const finished = log.some(l => l.type === 'win' || l.type === 'lose');
  const activePlayer = team.find(m => m.currentHp > 0);
  const activeEnemy = enemies.find(m => m.currentHp > 0);
  const lastMsg = log[log.length - 1]?.msg || '';
  const caught = log.some(l => l.type === 'catch');
  const canThrowBall = isWild && !finished && !caught && pokeballCount > 0 && !teamFull;

  return (
    <div>
      <div style={{
        position: 'relative', width: '100%', height: 440, borderRadius: 18, overflow: 'hidden',
        border: '4px solid #23233a', boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        backgroundImage: `linear-gradient(rgba(10,14,26,0.12), rgba(10,14,26,0.4)), url(${battleBgUrl(bg)})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      }}>
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
        {activeEnemy && (
          <div style={{ position: 'absolute', top: 90, right: 90 }}>
            <BattleSprite speciesId={activeEnemy.speciesId} back={false} size={110} />
          </div>
        )}
        <div style={{ position: 'absolute', top: 20, left: 20, display: 'flex', gap: 4 }}>
          {enemies.map((m, i) => (
            <div key={i} title={m.displayName} style={{ width: 22, height: 22, borderRadius: '50%', background: m.currentHp > 0 ? (TYPE_COLORS[m.types[0]] || '#888') : '#333', opacity: m.currentHp > 0 ? 1 : 0.35, border: '2px solid #111' }} />
          ))}
        </div>

        {activePlayer && (
          <div style={{ position: 'absolute', bottom: 130, left: 60 }}>
            <BattleSprite speciesId={activePlayer.speciesId} back size={130} />
          </div>
        )}
        {activePlayer && (
          <div style={{ position: 'absolute', bottom: 100, right: 28, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <HpBar mon={activePlayer} showNumbers align="right" />
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 14, left: 20, display: 'flex', gap: 4 }}>
          {team.map((m, i) => (
            <div key={i} title={m.displayName} style={{ width: 22, height: 22, borderRadius: '50%', background: m.currentHp > 0 ? (TYPE_COLORS[m.types[0]] || '#888') : '#333', opacity: m.currentHp > 0 ? 1 : 0.35, border: '2px solid #111' }} />
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: 14, right: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={trainerPortraitUrl(playerTrainerSprite)} alt="You" style={{ width: 46, height: 46, imageRendering: 'pixelated' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        </div>

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

      {!finished && activePlayer && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          {activePlayer.moves.map(moveId => {
            const d = moves[moveId];
            return (
              <button key={moveId} onClick={() => onUseMove(moveId)} style={{
                padding: '14px 16px', border: 'none', borderRadius: 10, background: d ? TYPE_COLORS[d.type] || '#555' : '#555',
                color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 15, boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
              }}>{d?.name || moveId}{d ? <span style={{ opacity: 0.75, fontWeight: 500, fontSize: 12 }}> ({d.type})</span> : null}</button>
            );
          })}
        </div>
      )}
      {!finished && isWild && (
        <button
          onClick={onCatch}
          disabled={!canThrowBall}
          title={teamFull ? 'Your team is full (6/6) — cannot catch more right now' : pokeballCount <= 0 ? 'You have no Poké Balls — buy some in town' : 'Throw a Poké Ball to try to catch this Pokémon'}
          style={{
            width: '100%', marginTop: 10, padding: '12px 16px', border: 'none', borderRadius: 10,
            background: canThrowBall ? '#e0304a' : '#555', color: '#fff', cursor: canThrowBall ? 'pointer' : 'not-allowed',
            fontWeight: 800, fontSize: 15, opacity: canThrowBall ? 1 : 0.6,
          }}
        >🔴⚪ Throw Poké Ball ({pokeballCount})</button>
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

// ════════════════════ STARTER BOX (grid, unlockable, candy-gated) ═══════════

const StarterBox: React.FC<{
  dex: DexIndex; meta: RogueMeta; onPick: (key: string) => void; onUnlock: (key: string, gen: number) => void;
}> = ({ dex, meta, onPick, onUnlock }) => {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🎮 Starter Box</h2>
        <div style={{ fontWeight: 800, color: '#7a5c00', background: '#ffe082', padding: '6px 14px', borderRadius: 999 }}>🍬 {meta.candy} Candy</div>
      </div>
      <p style={{ marginTop: 0, color: '#555' }}>Pick your single starting partner. Locked starters can be unlocked permanently with candy earned from completed runs (badges, Elite Four wins, and Champion victories).</p>
      {STARTER_GENS.map(g => (
        <div key={g.gen} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Gen {g.gen} • {g.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 10 }}>
            {g.keys.map(key => {
              const entry = dex[key];
              if (!entry) return null;
              const unlocked = meta.unlocked.includes(key);
              const cost = unlockCost(g.gen);
              return (
                <div key={key} style={{
                  position: 'relative', border: '2px solid #ddd', borderRadius: 10, padding: 8, textAlign: 'center',
                  background: unlocked ? (TYPE_COLORS[entry.types[0]] || '#eee') : '#e8e8e8', cursor: unlocked ? 'pointer' : 'default',
                }} onClick={() => unlocked && onPick(key)}>
                  <img
                    src={spriteUrl(key, false, { forceStatic: true })}
                    alt={entry.name}
                    style={{ width: 56, height: 56, imageRendering: 'pixelated', filter: unlocked ? 'none' : 'grayscale(1) brightness(0.6)' }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = iconUrl(key); }}
                  />
                  <div style={{ fontSize: 11, fontWeight: 700, color: unlocked ? '#fff' : '#666', marginTop: 4 }}>{entry.name}</div>
                  {!unlocked && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onUnlock(key, g.gen); }}
                      disabled={meta.candy < cost}
                      style={{
                        marginTop: 6, width: '100%', padding: '4px 6px', fontSize: 11, borderRadius: 6, border: 'none',
                        background: meta.candy >= cost ? '#68d391' : '#bbb', color: '#0c1017', fontWeight: 800,
                        cursor: meta.candy >= cost ? 'pointer' : 'not-allowed',
                      }}
                    >🔒 Unlock {cost}🍬</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ════════════════════ ROGUEMODE MAIN COMPONENT ══════════════════════════════

export const RogueModeGame: React.FC = () => {
  const [dex, setDex] = useState<DexIndex | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
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
  const [inventory, setInventory] = useState<Record<string, number>>({ potion: 2, pokeball: 5 });
  const [shopOpen, setShopOpen] = useState(false);
  const [trainerSprite, setTrainerSprite] = useState<string>(() => getTrainerSpriteValue());
  const [mapOpen, setMapOpen] = useState(false);
  const [battleContext, setBattleContext] = useState<'wild' | 'trainer'>('wild');
  const [seed, setSeed] = useState<string>('');
  const [seedInput, setSeedInput] = useState<string>('');
  const [rival, setRival] = useState<RivalInfo | null>(null);
  const [restoredRun, setRestoredRun] = useState(false);
  const [meta, setMeta] = useState<RogueMeta>(() => loadMeta());
  const [championName, setChampionName] = useState<string>(CHAMPION_POOL[0].name);
  const [championSprite, setChampionSprite] = useState<string>(CHAMPION_POOL[0].sprite);

  const rngRef = useRef<() => number>(() => Math.random());
  const hasHydratedRef = useRef(false);

  // ── load dex+moves+learnsets, then attempt to restore a persisted run ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadShowdownDex();
        if (cancelled) return;
        setDex(result.pokedex);
        setEngine({ dex: result.pokedex, moves: result.moves, learnsets: result.learnsets });
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
          setChampionName(saved.championName || CHAMPION_POOL[0].name);
          setChampionSprite(saved.championSprite || CHAMPION_POOL[0].sprite);
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
      championName, championSprite,
    });
  }, [phase, mapNodes, currentIndex, maxReached, playerTeam, enemyTeam, badgeCount, xpTotal, playerCoins, inventory, battleLog, battleContext, rival, seed, championName, championSprite]);

  const currentNode: MapNode | undefined = mapNodes[currentIndex];
  const activeTown = currentNode && currentNode.kind === 'town' ? SHOP_MAP[currentNode.type] : undefined;

  const xpThresholdFor = (l: number): number => { let s = 0; for (let i = 5; i < l; i++) s += 15 + i * 3; return s; };

  const awardCandy = useCallback((amount: number) => {
    setMeta(prev => {
      const next = { ...prev, candy: prev.candy + amount };
      saveMeta(next);
      return next;
    });
  }, []);

  const unlockStarter = useCallback((key: string, gen: number) => {
    const cost = unlockCost(gen);
    setMeta(prev => {
      if (prev.unlocked.includes(key) || prev.candy < cost) return prev;
      const next = { candy: prev.candy - cost, unlocked: [...prev.unlocked, key] };
      saveMeta(next);
      return next;
    });
  }, []);

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
    const championNode = nodes.find(n => n.kind === 'champion');
    setSeed(nextSeed);
    setRival(chosenRival);
    setChampionName(championNode?.gymDef?.name || CHAMPION_POOL[0].name);
    setChampionSprite(championNode?.gymDef?.sprite || CHAMPION_POOL[0].sprite);
    setMapNodes(nodes);
    setCurrentIndex(0);
    setMaxReached(0);
    setPlayerTeam([]);
    setEnemyTeam([]);
    setBadgeCount(0);
    setXpTotal(0);
    setPlayerCoins(200);
    setInventory({ potion: 2, pokeball: 5 });
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
    if (!dex || !dex[key] || !engine) return;
    const mon = buildRogueMon(key, dex[key], 5, engine, rngRef.current, false);
    setPlayerTeam([mon]);
    setPhase('exploring');
    setBattleLog([{ msg: `You chose ${mon.displayName}! Let's explore. (Seed: ${seed})`, type: 'system' }]);
  }, [dex, engine, seed]);

  // ── wild encounter on a route node ──────────────────────────────────────
  const searchRoute = useCallback(() => {
    if (!pool || !dex || !engine || !currentNode || currentNode.kind !== 'route') return;
    const key = pickSpeciesOfType(pool, currentNode.type, rngRef.current);
    if (!key || !dex[key]) return;
    const avg = playerAverageLevel(playerTeam);
    const level = rollEncounterLevel('wild', avg, rngRef.current);
    const wildMon = buildRogueMon(key, dex[key], level, engine, rngRef.current, false);
    setEnemyTeam([wildMon]);
    setBattleContext('wild');
    setBattleLog(p => [...p, { msg: `A wild ${wildMon.displayName} appeared!`, type: 'system' }]);
    setPhase('battle');
  }, [pool, dex, engine, currentNode, playerTeam]);

  // ── trainer/gym/rival/elite4/champion battle trigger ────────────────────
  const startTrainerBattle = useCallback(() => {
    if (!pool || !dex || !engine || !currentNode) return;
    if (currentNode.kind === 'town' || currentNode.kind === 'route') return;
    const avg = playerAverageLevel(playerTeam);

    if (currentNode.kind === 'rival' && rival) {
      const size = Math.min(6, 1 + (currentNode.rivalOccurrence || 1));
      const level = rollEncounterLevel('rival', avg, rngRef.current);
      const team = generateDiverseTeam(pool, engine, level, size, rngRef.current);
      if (!team.length) return;
      setEnemyTeam(team);
      setBattleContext('trainer');
      setBattleLog(p => [...p, { msg: `${rival.name} challenges you!`, type: 'system' }]);
      setPhase('battle');
      return;
    }

    const kind = currentNode.kind === 'champion' ? 'champion' : currentNode.kind === 'elite4' ? 'elite4' : 'gym';
    const size = currentNode.kind === 'gym' ? 3 : currentNode.kind === 'elite4' ? 4 : currentNode.kind === 'champion' ? 6 : 2;
    const level = rollEncounterLevel(kind, avg, rngRef.current);
    const team = currentNode.kind === 'champion' || currentNode.kind === 'elite4'
      ? generateDiverseTeam(pool, engine, level, size, rngRef.current)
      : generateTrainerTeam(pool, engine, currentNode.type, level, size, rngRef.current);
    if (!team.length) return;
    setEnemyTeam(team);
    setBattleContext('trainer');
    setBattleLog(p => [...p, { msg: `${currentNode.gymDef?.name || 'A trainer'} challenges you!`, type: 'system' }]);
    setPhase('battle');
  }, [pool, dex, engine, currentNode, rival, playerTeam]);

  const processAction = useCallback((action: string) => {
    if (phase !== 'battle' || !engine) return;

    if (action === 'continue') {
      const last = battleLog[battleLog.length - 1];
      if (!last) return;
      if (last.type === 'win') {
        setMapNodes(prev => prev.map((n, i) => i === currentIndex ? { ...n, cleared: true } : n));
        if (currentNode?.kind === 'gym') { setBadgeCount(p => p + 1); awardCandy(5); }
        if (currentNode?.kind === 'elite4') awardCandy(10);

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
            return newLevel === m.level ? m : recomputeLevel(m, newLevel, engine, rngRef.current);
          }));
        }

        if (currentNode?.kind === 'champion') { awardCandy(50); setPhase('victory'); return; }

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

    const res = execMoveReal(attacker, defender, action, engine.moves);
    if (res.heal > 0) {
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + res.heal);
      logs.push({ msg: `${attacker.displayName} used ${res.displayName}! (+${res.heal} HP)`, type: 'heal' });
    } else if (res.miss) {
      logs.push({ msg: `${attacker.displayName} used ${res.displayName} but missed!`, type: 'action' });
    } else if (res.damage > 0) {
      foeOut[eIdx] = { ...foeOut[eIdx], currentHp: Math.max(0, foeOut[eIdx].currentHp - res.damage) };
      logs.push({ msg: `${attacker.displayName} used ${res.displayName}${res.label ? ' ' + res.label : ''} (-${res.damage} HP)`, type: 'damage' });
      if (foeOut[eIdx].currentHp === 0) logs.push({ msg: `${foeOut[eIdx].displayName} fainted!`, type: 'action' });
    } else {
      logs.push({ msg: `${attacker.displayName} used ${res.displayName}!`, type: 'action' });
    }

    const allDead = foeOut.every(m => m.currentHp <= 0);
    if (allDead) {
      logs.push({ msg: '✅ All opponents defeated!', type: 'win' });
    } else {
      const attackBack = (ea: RogueMon) => {
        const ti = teamOut.findIndex(m => m.currentHp > 0);
        if (ti < 0) return;
        const tgt = teamOut[ti];
        const mv = pickRandom(ea.moves) || FALLBACK_MOVE_ID;
        const r2 = execMoveReal(ea, tgt, mv, engine.moves);
        if (r2.miss) { logs.push({ msg: `${ea.displayName} used ${r2.displayName} but missed!`, type: 'action' }); return; }
        if (r2.damage > 0) {
          teamOut[ti] = { ...teamOut[ti], currentHp: Math.max(0, tgt.currentHp - r2.damage) };
          logs.push({ msg: `${ea.displayName} used ${r2.displayName} on ${tgt.displayName}${r2.label ? ' ' + r2.label : ''} (-${r2.damage} HP)`, type: 'damage' });
        } else if (r2.heal > 0) {
          ea.currentHp = Math.min(ea.maxHp, ea.currentHp + r2.heal);
          logs.push({ msg: `${ea.displayName} used ${r2.displayName}!`, type: 'action' });
        } else {
          logs.push({ msg: `${ea.displayName} used ${r2.displayName}!`, type: 'action' });
        }
      };
      foeOut.filter(e => e.currentHp > 0).forEach(attackBack);
    }

    if (!teamOut.some(m => m.currentHp > 0)) logs.push({ msg: '💀 Your team fainted!', type: 'lose' });
    setPlayerTeam(teamOut); setEnemyTeam(foeOut); setBattleLog(p => [...p, ...logs]);
  }, [phase, playerTeam, enemyTeam, battleLog, currentIndex, currentNode, mapNodes, engine, awardCandy]);

  // ── attempt to catch the active wild Pokémon with a Poké Ball ───────────
  // Catch chance scales with how low the wild mon's HP is (PokeRogue/mainline-style):
  // full HP = base 30% chance, empty HP = up to 90% chance. Failing consumes the ball
  // and costs a turn (the wild mon attacks back), matching mainline catch mechanics.
  const attemptCatch = useCallback(() => {
    if (battleContext !== 'wild' || !engine) return;
    if ((inventory.pokeball ?? 0) <= 0) {
      setBattleLog(p => [...p, { msg: 'You have no Poké Balls left!', type: 'system' }]);
      return;
    }
    if (playerTeam.length >= 6) {
      setBattleLog(p => [...p, { msg: 'Your team is full — cannot catch more Pokémon right now.', type: 'system' }]);
      return;
    }
    const target = enemyTeam.find(m => m.currentHp > 0);
    if (!target) return;

    setInventory(p => ({ ...p, pokeball: Math.max(0, (p.pokeball ?? 0) - 1) }));

    const hpFrac = target.maxHp > 0 ? target.currentHp / target.maxHp : 1;
    const catchChance = Math.min(0.9, 0.3 + (1 - hpFrac) * 0.6);
    const success = Math.random() < catchChance;

    if (success) {
      setPlayerTeam(prev => [...prev, { ...target, currentHp: target.maxHp }]);
      setEnemyTeam(prev => prev.map(m => (m === target ? { ...m, currentHp: 0 } : m)));
      setBattleLog(p => [...p, { msg: `🔴⚪ Gotcha! ${target.displayName} was caught!`, type: 'catch' }, { msg: '✅ Catch successful!', type: 'win' }]);
      return;
    }

    const logs: LogEntry[] = [{ msg: `Oh no! ${target.displayName} broke free!`, type: 'system' }];
    let teamOut = playerTeam.map(m => ({ ...m }));
    const ti = teamOut.findIndex(m => m.currentHp > 0);
    if (ti >= 0) {
      const tgt = teamOut[ti];
      const mv = pickRandom(target.moves) || FALLBACK_MOVE_ID;
      const r2 = execMoveReal(target, tgt, mv, engine.moves);
      if (r2.miss) {
        logs.push({ msg: `${target.displayName} used ${r2.displayName} but missed!`, type: 'action' });
      } else if (r2.damage > 0) {
        teamOut[ti] = { ...teamOut[ti], currentHp: Math.max(0, tgt.currentHp - r2.damage) };
        logs.push({ msg: `${target.displayName} used ${r2.displayName} on ${tgt.displayName}${r2.label ? ' ' + r2.label : ''} (-${r2.damage} HP)`, type: 'damage' });
      }
    }
    if (!teamOut.some(m => m.currentHp > 0)) logs.push({ msg: '💀 Your team fainted!', type: 'lose' });
    setPlayerTeam(teamOut);
    setBattleLog(p => [...p, ...logs]);
  }, [battleContext, inventory, playerTeam, enemyTeam, engine]);

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
            A PokeRogue-style gauntlet drawing from the FULL merged Pokédex ({pool ? pool.all.length.toLocaleString() : '...'} species) with real official gym leaders, Elite Four and Champions.
            Pick a starter from your Starter Box, explore 8 gym routes with full backtracking, face a persistent rival who grows stronger, and take on the Elite Four and Champion. One loss ends the run — choose wisely.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            {GYM_TYPES.map(t => (<span key={t} style={{ padding: '4px 10px', background: TYPE_COLORS[t], borderRadius: 4, fontSize: 12, color: '#111' }}>{t} Gym</span>))}
          </div>
          <div style={{ marginTop: 12, color: '#8fd98f', fontWeight: 700 }}>🍬 Candy: {meta.candy}</div>
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

      {phase === 'starter_select' && dex && (
        <div style={{ padding: 30, background: '#fff', borderRadius: 10 }}>
          <p style={{ textAlign: 'center', color: '#777' }}>Seed: <code>{seed}</code></p>
          <StarterBox dex={dex} meta={meta} onPick={pickStarter} onUnlock={unlockStarter} />
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
                  <div>Badges: <strong>{badgeCount}</strong> / {GYM_TYPES.length}</div>
                  <div>Coins: <strong>{playerCoins}</strong></div>
                  <div>Team: <strong>{playerTeam.length}</strong> / 6</div>
                  <div>🍬 Candy: <strong>{meta.candy}</strong></div>
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

      {phase === 'battle' && currentNode && engine && (
        <BattleScreen
          team={playerTeam} enemies={enemyTeam} log={battleLog} onUseMove={processAction}
          bg={currentNode.bg} opponentName={battleOpponentName} opponentSprite={battleOpponentSprite}
          playerTrainerSprite={trainerSprite}
          isWild={battleContext === 'wild'} pokeballCount={inventory.pokeball ?? 0} teamFull={playerTeam.length >= 6}
          onCatch={attemptCatch} moves={engine.moves}
        />
      )}

      {phase === 'victory' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#2d5a27', borderRadius: 10 }}>
          <h1 style={{ color: '#ffd700' }}>🏆 CHAMPION! 🏆</h1>
          <p>You defeated {championName} with {badgeCount} badges and {xpTotal} XP! (Seed: {seed})</p>
          <p style={{ color: '#8fd98f' }}>🍬 +50 Candy earned!</p>
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
