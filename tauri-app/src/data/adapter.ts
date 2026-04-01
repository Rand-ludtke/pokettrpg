import { BattlePokemon, Pokemon } from '../types';
import { calculateHp } from '../rules';
import { withPublicBase } from '../utils/publicBase';

export type DexSpecies = {
  name: string;
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  types: string[];
  abilities?: Record<string, string>; // e.g., {"0":"Static","H":"Lightning Rod"}
  num?: number;
  baseSpecies?: string;
  baseForme?: string;
  forme?: string;
  prevo?: string;
  evoLevel?: number;
  evos?: string[];
  evoType?: string; // e.g., level, levelFriendship, trade, useItem
  evoCondition?: string;
  evoItem?: string;
  evoMove?: string;
  otherFormes?: string[];
  cosmeticFormes?: string[];
  formeOrder?: string[];
  requiredItem?: string; // e.g., Charizardite X
  gender?: string;
  genderRatio?: { M: number; F: number };
  eggGroups?: string[];
  heightm?: number;
  weightkg?: number;
  color?: string;
  tier?: string;
  isNonstandard?: string | null;
  gen?: number;
  spriteid?: string;
  changesFrom?: string;
};

export type MoveEntry = { name: string; type: string; basePower: number; category: 'Physical'|'Special'|'Status'; accuracy?: number | true; secondary?: any; secondaries?: any[]; desc?: string; shortDesc?: string };
export type AbilityEntry = { name: string; desc?: string; shortDesc?: string };
export type ItemEntry = { name: string; desc?: string; shortDesc?: string; sprite?: string; megaStone?: string };

export type DexIndex = Record<string, DexSpecies>;
export type MoveIndex = Record<string, MoveEntry>;
export type AbilityIndex = Record<string, AbilityEntry>;
export type ItemIndex = Record<string, ItemEntry>;
export type LearnsetsIndex = Record<string, { learnset?: Record<string, any> }>;
export type AliasesIndex = Record<string, string>;

let gBundledSprites: Record<string, Partial<Record<string, string>>> = {};
let gPreferBackendSpriteIds = new Set<string>();

export function normalizeName(id: string) {
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const DEFAULT_DATA_BASE = withPublicBase('vendor/showdown/data').replace(/\/+$/, '');
const DEFAULT_SPRITE_BASE = withPublicBase('vendor/showdown/sprites').replace(/\/+$/, '');
/** Custom/regional sprites shipped at public/sprites/ (Wylin, Sage, etc.) */
const CUSTOM_SPRITE_BASE = withPublicBase('sprites').replace(/\/+$/, '');

function normalizeBaseUrl(base: string | null | undefined): string {
  const value = String(base || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

/** Default backend URL for sprite index / BaseSprites (mirrored from fusion API). */
const DEFAULT_BACKEND_SPRITE_BASE = 'https://pokettrpg.duckdns.org/sprites';

/** Detect Tauri desktop environment — always allow HTTP backends from desktop apps. */
function isTauriApp(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}

/** True when running on an HTTPS web page (not a Tauri desktop app). */
function isStrictHttpsContext(): boolean {
  if (isTauriApp()) return false;
  return typeof window !== 'undefined' && window.location?.protocol === 'https:';
}

function getSpriteBaseCandidates(preferredBase?: string): string[] {
  const explicit = normalizeBaseUrl(preferredBase);

  // Static vendor path — built by Vite with the correct base URL for the deploy target
  // (e.g. '/pokettrpg/vendor/showdown/sprites' on GitHub Pages, './vendor/showdown/sprites' locally).
  const staticBase = normalizeBaseUrl(DEFAULT_SPRITE_BASE);

  // API backend sprite base (Pi server) — from user settings or hardcoded default.
  // Needed so loadSpriteFolderIndex merges the backend's numeric BaseSprites (1a, 1b, …).
  const fromApiBase = (() => {
    try {
      const apiBase = normalizeBaseUrl(localStorage.getItem('ttrpg.apiBase'));
      if (apiBase) return [ensureSpritesPath(apiBase)];
    } catch {}
    return [] as string[];
  })();

  // On HTTPS web pages we can't fetch from HTTP backends — but Tauri desktop apps can.
  const defaultBackend = isStrictHttpsContext() && DEFAULT_BACKEND_SPRITE_BASE.startsWith('http://')
    ? ''
    : DEFAULT_BACKEND_SPRITE_BASE;

  // Custom/regional sprites folder (Wylin, Sage, etc.) lives next to vendor sprites
  const customBase = normalizeBaseUrl(CUSTOM_SPRITE_BASE);

  // Static vendor first, then custom regional sprites, then API backend for
  // numeric BaseSprites that only exist on the Pi server.
  const all = [explicit, staticBase, customBase, ...fromApiBase, defaultBackend]
    .map(normalizeBaseUrl)
    .filter((v): v is string => !!v);
  return Array.from(new Set(all));
}

export function getPreferredSpriteBase(preferredBase?: string): string {
  const candidates = getSpriteBaseCandidates(preferredBase);
  return candidates[0] || getStaticSpriteBase();
}

/** Static vendor sprite base — resolves to the deployed static file host (GitHub Pages / Tauri bundle). */
function getStaticSpriteBase(): string {
  return normalizeBaseUrl(DEFAULT_SPRITE_BASE) || '/vendor/showdown/sprites';
}

function ensureSpritesPath(base: string): string {
  return /\/sprites$/i.test(base) ? base : `${base}/sprites`;
}

/** API backend sprite base (Pi server). Returns null when no backend is configured. */
function getApiSpriteBase(): string | null {
  try {
    const apiBase = normalizeBaseUrl(localStorage.getItem('ttrpg.apiBase'));
    if (apiBase) return ensureSpritesPath(apiBase);
  } catch {}

  const fallback = normalizeBaseUrl(DEFAULT_BACKEND_SPRITE_BASE);
  if (!fallback) return null;
  if (isStrictHttpsContext() && /^http:\/\//i.test(fallback)) return null;
  return fallback;
}

/**
 * Choose the best sprite base for a given sprite ID.
 * Numeric IDs (from BaseSprites packs on the backend) use the API base.
 * Named IDs (including deltas) use the static vendor path.
 */
function bestSpriteBaseForId(id: string, fallbackBase?: string): string {
  const normalized = normalizeName(id);
  if (/^\d/.test(id) || gPreferBackendSpriteIds.has(normalized)) {
    const api = getApiSpriteBase();
    if (api) return api;
  }
  return fallbackBase || getStaticSpriteBase();
}

function getShowdownDataBaseCandidates(preferredBase?: string): string[] {
  const explicit = normalizeBaseUrl(preferredBase);
  const defaults = [
    normalizeBaseUrl(DEFAULT_DATA_BASE),
    normalizeBaseUrl(withPublicBase('vendor/showdown/data')),
  ];

  const fromOrigin = (() => {
    if (typeof window === 'undefined' || !window.location?.origin) return [] as string[];
    const origin = normalizeBaseUrl(window.location.origin);
    return [`${origin}/vendor/showdown/data`];
  })();

  const all = [explicit, ...defaults, ...fromOrigin]
    .map(normalizeBaseUrl)
    .filter((v): v is string => !!v);
  return Array.from(new Set(all));
}

let gShowdownDexPromise: Promise<{
  pokedex: DexIndex;
  moves: MoveIndex;
  abilities: AbilityIndex;
  items: ItemIndex;
  learnsets: LearnsetsIndex;
  sourceTags?: Record<string, string[]>;
}> | null = null;

async function fetchJsonFromBaseCandidates<T>(relativePath: string, bases: string[]): Promise<T | null> {
  for (const base of bases) {
    const url = `${base}/${relativePath}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || !text.trim()) continue;
      try {
        return JSON.parse(text) as T;
      } catch {
        // 404 pages can return HTML; ignore and continue to next candidate.
        continue;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function loadShowdownDataJson<T = any>(
  relativePath: string,
  options?: { base?: string; required?: boolean; defaultValue?: T }
): Promise<T> {
  const bases = getShowdownDataBaseCandidates(options?.base);
  const data = await fetchJsonFromBaseCandidates<T>(relativePath, bases);
  if (data != null) return data;
  if (options?.required) {
    throw new Error(`Unable to load showdown data: ${relativePath}`);
  }
  return (options?.defaultValue ?? ({} as T));
}

export async function loadShowdownDex(options?: { base?: string }) {
  if (!options?.base && gShowdownDexPromise) return gShowdownDexPromise;

  const task = (async () => {
  const fetchOptionalJson = async (path: string) => {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
  // prefer JSON if present for faster parse
  const [pokedex, moves, abilities, items, learnsets, aliases] = await Promise.all([
    loadShowdownDataJson<DexIndex>('pokedex.json', { base: options?.base, required: true }),
    loadShowdownDataJson<MoveIndex>('moves.json', { base: options?.base, required: true }),
    loadShowdownDataJson<AbilityIndex>('abilities.json', { base: options?.base, defaultValue: {} as AbilityIndex }),
    loadShowdownDataJson<ItemIndex>('items.json', { base: options?.base, defaultValue: {} as ItemIndex }),
    loadShowdownDataJson<LearnsetsIndex>('learnsets.json', { base: options?.base, defaultValue: {} as LearnsetsIndex }),
    Promise.resolve({} as AliasesIndex),
  ]);

  const [sagePokedex, sageLearnsets, sageMoves, sageAbilities, sageItems] = await Promise.all([
    fetchOptionalJson(withPublicBase('data/sage/generated/pokedex.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/learnsets.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/moves.custom.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/abilities.custom.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/items.custom.sage.json')),
  ]);

  const [insPokedex, insLearnsets, insAbilities, insItems, wylinPack] = await Promise.all([
    fetchOptionalJson(withPublicBase('data/insurgence/generated/pokedex.insurgence.json')),
    fetchOptionalJson(withPublicBase('data/insurgence/generated/learnsets.insurgence.json')),
    fetchOptionalJson(withPublicBase('data/insurgence/generated/abilities.custom.insurgence.json')),
    fetchOptionalJson(withPublicBase('data/insurgence/generated/items.custom.insurgence.json')),
    fetchOptionalJson(withPublicBase('data/more-pokemon/generated/wylin-customs.generated.json')),
  ]);

  const wylinDex = (wylinPack && typeof wylinPack === 'object' ? (wylinPack as any).dex : null) || {};
  const wylinLearnsets = (wylinPack && typeof wylinPack === 'object' ? (wylinPack as any).learnsets : null) || {};
  const wylinMoves = (wylinPack && typeof wylinPack === 'object' ? (wylinPack as any).moves : null) || {};
  const wylinAbilities = (wylinPack && typeof wylinPack === 'object' ? (wylinPack as any).abilities : null) || {};
  const wylinItems = (wylinPack && typeof wylinPack === 'object' ? (wylinPack as any).items : null) || {};
  const wylinSprites = (wylinPack && typeof wylinPack === 'object' ? (wylinPack as any).sprites : null) || {};
  gBundledSprites = {};
  gPreferBackendSpriteIds = new Set<string>();
  for (const key of Object.keys(wylinSprites)) {
    gBundledSprites[normalizeName(key)] = (wylinSprites as Record<string, Partial<Record<string, string>>>)[key] || {};
  }
  for (const [key, entry] of Object.entries(wylinDex as Record<string, any>)) {
    const normalizedKey = normalizeName(key);
    if (normalizedKey) gPreferBackendSpriteIds.add(normalizedKey);
    const entryName = normalizeName(String(entry?.name || ''));
    if (entryName) gPreferBackendSpriteIds.add(entryName);
    const num = Number(entry?.num);
    if (Number.isFinite(num) && num > 0) {
      const numericId = String(Math.trunc(num));
      gPreferBackendSpriteIds.add(numericId);
      // Mirror bundled sprite records under numeric keys so PS lookups like "20059"
      // resolve to the same embedded data URLs as named keys.
      const source = gBundledSprites[normalizedKey] || gBundledSprites[entryName];
      if (source && !gBundledSprites[numericId]) {
        gBundledSprites[numericId] = source;
      }
    }
  }

  const mergedBaseDex = {
    ...(pokedex as DexIndex),
    ...((sagePokedex || {}) as DexIndex),
    ...((insPokedex || {}) as DexIndex),
    ...((wylinDex || {}) as DexIndex),
  } as DexIndex;
  const mergedBaseLearnsets = {
    ...(learnsets as LearnsetsIndex),
    ...((sageLearnsets || {}) as LearnsetsIndex),
    ...((insLearnsets || {}) as LearnsetsIndex),
    ...((wylinLearnsets || {}) as LearnsetsIndex),
  } as LearnsetsIndex;
  const mergedBaseMoves = {
    ...(moves as MoveIndex),
    ...((sageMoves || {}) as MoveIndex),
    ...((wylinMoves || {}) as MoveIndex),
  } as MoveIndex;
  const mergedBaseAbilities = {
    ...(abilities as AbilityIndex),
    ...((sageAbilities || {}) as AbilityIndex),
    ...((insAbilities || {}) as AbilityIndex),
    ...((wylinAbilities || {}) as AbilityIndex),
  } as AbilityIndex;
  const mergedBaseItems = {
    ...(items as ItemIndex),
    ...((sageItems || {}) as ItemIndex),
    ...((insItems || {}) as ItemIndex),
    ...((wylinItems || {}) as ItemIndex),
  } as ItemIndex;

  const sourceTags: Record<string, Set<string>> = {};
  const addSourceTags = (collection: Record<string, any>, tag: string) => {
    for (const key of Object.keys(collection || {})) {
      const id = normalizeName(key);
      sourceTags[id] = sourceTags[id] || new Set<string>();
      sourceTags[id].add(tag);
    }
  };
  addSourceTags(pokedex as Record<string, any>, 'base');
  addSourceTags((sagePokedex || {}) as Record<string, any>, 'sage');
  addSourceTags((insPokedex || {}) as Record<string, any>, 'insurgence');
  addSourceTags((wylinDex || {}) as Record<string, any>, 'wylin');

  // Merge custom overlays from local storage (local-only additions)
  const customDex = getCustomDex();
  const customLearnsets = getCustomLearnsets();
  const customItems = getCustomItems();
  const customMoves = getCustomMoves();
  const customAbilities = getCustomAbilities();
  const mergedDex = { ...mergedBaseDex, ...customDex } as DexIndex;
  addSourceTags(customDex as Record<string, any>, 'custom');
  // Built-in overlay tweaks
  try {
    // Ensure Chatot can have Prankster as an additional ability option
    const chatotKey = Object.keys(mergedDex).find(k => normalizeName(k) === 'chatot') ||
      Object.keys(mergedDex).find(k => normalizeName((mergedDex as DexIndex)[k].name) === 'chatot');
    if (chatotKey) {
      const entry = mergedDex[chatotKey];
      entry.abilities = entry.abilities || {};
      const abilityList = Object.values(entry.abilities);
      if (!abilityList.map(normalizeName).includes('prankster')) {
        // Use an extra slot key that won't clobber existing ones
        (entry.abilities as any)['S'] = 'Prankster';
      }
      mergedDex[chatotKey] = entry;
    }
  } catch {}
  const mergedLs = { ...mergedBaseLearnsets, ...customLearnsets } as LearnsetsIndex;
  const mergedItems = { ...mergedBaseItems, ...customItems } as ItemIndex;
  const mergedMoves = { ...mergedBaseMoves, ...customMoves } as MoveIndex;
  const mergedAbilities = { ...mergedBaseAbilities, ...customAbilities } as AbilityIndex;
  // Cache aliases globally for species resolution
  try {
    gAliases = {};
    const raw = aliases as Record<string, string>;
    for (const k of Object.keys(raw || {})) {
      const v = String((raw as any)[k] || '');
      if (!v) continue;
      gAliases[normalizeName(k)] = normalizeName(v);
    }
  } catch { gAliases = {}; }
  const result = {
    pokedex: mergedDex,
    moves: mergedMoves,
    abilities: mergedAbilities,
    items: mergedItems,
    learnsets: mergedLs,
    sourceTags: Object.fromEntries(Object.entries(sourceTags).map(([id, tags]) => [id, Array.from(tags)])),
  };
  // Make dex number lookups available globally for sprite fallback IDs.
  buildDexNumMaps(mergedDex);
  return result;
  })();

  if (!options?.base) {
    gShowdownDexPromise = task;
  }

  return task;
}

// Serialize a BattlePokemon into a Showdown set line (PS import/export format)
export function toShowdownSet(mon: import('../types').BattlePokemon): string {
  const species = mon.species || mon.name;
  const lines: string[] = [];
  // Title line: Nickname (Species) @ Item
  const nick = mon.name && mon.name !== species ? `${mon.name} (${species})` : species;
  const item = mon.item ? ` @ ${mon.item}` : '';
  lines.push(`${nick}${item}`);
  // Ability, Level, Shiny
  if (mon.ability) lines.push(`Ability: ${mon.ability}`);
  if (mon.level && mon.level !== 100) lines.push(`Level: ${mon.level}`);
  if (mon.shiny) lines.push('Shiny: Yes');
  if (mon.gender && mon.gender !== 'N') lines.push(`Gender: ${mon.gender}`);
  // EVs
  const evs = mon.evs || {};
  const evPairs: string[] = [];
  if (evs.hp) evPairs.push(`${evs.hp} HP`);
  if (evs.atk) evPairs.push(`${evs.atk} Atk`);
  if (evs.def) evPairs.push(`${evs.def} Def`);
  if (evs.spa) evPairs.push(`${evs.spa} SpA`);
  if (evs.spd) evPairs.push(`${evs.spd} SpD`);
  if (evs.spe) evPairs.push(`${evs.spe} Spe`);
  if (evPairs.length) lines.push(`EVs: ${evPairs.join(' / ')}`);
  // Nature
  if (mon.nature) lines.push(`${mon.nature} Nature`);
  // IVs
  const ivs = mon.ivs || {};
  const ivPairs: string[] = [];
  if (ivs.hp != null) ivPairs.push(`${ivs.hp} HP`);
  if (ivs.atk != null) ivPairs.push(`${ivs.atk} Atk`);
  if (ivs.def != null) ivPairs.push(`${ivs.def} Def`);
  if (ivs.spa != null) ivPairs.push(`${ivs.spa} SpA`);
  if (ivs.spd != null) ivPairs.push(`${ivs.spd} SpD`);
  if (ivs.spe != null) ivPairs.push(`${ivs.spe} Spe`);
  if (ivPairs.length) lines.push(`IVs: ${ivPairs.join(' / ')}`);
  // Moves
  for (const m of mon.moves || []) {
    lines.push(`- ${m.name}`);
  }
  return lines.join('\n');
}

export function teamToShowdownText(team: import('../types').BattlePokemon[]): string {
  return team.map(toShowdownSet).join('\n\n');
}

export function toPokemon(id: string, dex: DexIndex, level = 50): Pokemon | null {
  const key = findSpeciesKey(id, dex);
  if (!key) return null;
  const s = dex[key];
  const abilList = s.abilities ? Object.values(s.abilities) : [];
  // Default teraType to the Pokemon's primary type for Gen 9 Terastallization
  const defaultTeraType = s.types?.[0] || 'Normal';
  return {
    name: s.name,
    species: s.name,
    level,
    types: s.types,
    gender: 'N',
    ability: abilList[0],
    item: undefined,
    shiny: false,
    evs: {},
    ivs: {},
    baseStats: {
      hp: s.baseStats.hp,
      atk: s.baseStats.atk,
      def: s.baseStats.def,
      spAtk: s.baseStats.spa,
      spDef: s.baseStats.spd,
      speed: s.baseStats.spe,
    },
    moves: [],
    teraType: defaultTeraType,
  } as Pokemon & { teraType: string };
}

export function speciesAbilityOptions(id: string, dex: DexIndex): string[] {
  const key = findSpeciesKey(id, dex);
  if (!key) return [];
  const s = dex[key];
  return s.abilities ? Object.values(s.abilities) : [];
}

export function prepareBattle(p: Pokemon): BattlePokemon {
  const computed = computeRealStats(p);
  // Use TTRPG HP formula instead of Showdown's during battles
  const maxHp = calculateHp(p.baseStats.hp, p.level || 1);
  // Preserve existing HP if the Pokemon already has currentHp/maxHp set
  const existing = p as any;
  let currentHp = maxHp;
  if (typeof existing.currentHp === 'number' && typeof existing.maxHp === 'number' && existing.maxHp > 0 && existing.currentHp < existing.maxHp) {
    // Scale the HP ratio to the new maxHp
    const ratio = existing.currentHp / existing.maxHp;
    currentHp = Math.max(0, Math.round(ratio * maxHp));
  }
  return {
    ...p,
    maxHp,
    currentHp,
    computedStats: { hp: computed.hp, atk: computed.atk, def: computed.def, spa: computed.spa, spd: computed.spd, spe: computed.spe },
    statStages: { atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 },
  };
}

// Nature multipliers
function natureMultiplier(nature: string | undefined, stat: 'atk'|'def'|'spa'|'spd'|'spe'): number {
  if (!nature) return 1;
  const n = normalizeName(nature);
  // Neutral natures
  if (n === 'hardy' || n === 'docile' || n === 'serious' || n === 'bashful' || n === 'quirky') return 1;
  const map: Record<string, { up: 'atk'|'def'|'spa'|'spd'|'spe'; down: 'atk'|'def'|'spa'|'spd'|'spe' }> = {
    adamant: { up:'atk', down:'spa' }, brave: { up:'atk', down:'spe' }, lonely: { up:'atk', down:'def' }, naughty: { up:'atk', down:'spd' },
    modest: { up:'spa', down:'atk' }, quiet: { up:'spa', down:'spe' }, mild: { up:'spa', down:'def' }, rash: { up:'spa', down:'spd' },
    bold: { up:'def', down:'atk' }, relaxed: { up:'def', down:'spe' }, impish: { up:'def', down:'spa' }, lax: { up:'def', down:'spd' },
    calm: { up:'spd', down:'atk' }, sassy: { up:'spd', down:'spe' }, gentle: { up:'spd', down:'def' }, careful: { up:'spd', down:'spa' },
    timid: { up:'spe', down:'atk' }, jolly: { up:'spe', down:'spa' }, hasty: { up:'spe', down:'def' }, naive: { up:'spe', down:'spd' },
  };
  const entry = map[n];
  if (!entry) return 1;
  if (stat === entry.up) return 1.1;
  if (stat === entry.down) return 0.9;
  return 1;
}
function getEV(evs: Pokemon['evs']|undefined, key: 'hp'|'atk'|'def'|'spa'|'spd'|'spe') {
  const v = evs?.[key];
  return typeof v === 'number' ? Math.max(0, Math.min(252, Math.floor(v))) : 0;
}
function getIV(ivs: Pokemon['ivs']|undefined, key: 'hp'|'atk'|'def'|'spa'|'spd'|'spe') {
  const v = ivs?.[key];
  return typeof v === 'number' ? Math.max(0, Math.min(31, Math.floor(v))) : 31;
}

export function computeRealStats(p: Pokemon): { hp:number; atk:number; def:number; spa:number; spd:number; spe:number } {
  // Allow levels beyond 100 - use standard formula up to 100, then linear extrapolation
  const rawLevel = Math.max(1, Math.floor(p.level || 1));
  const cappedLevel = Math.min(100, rawLevel);
  const L = cappedLevel;
  const bs = p.baseStats;
  const iv = {
    hp: getIV(p.ivs, 'hp'), atk: getIV(p.ivs, 'atk'), def: getIV(p.ivs, 'def'), spa: getIV(p.ivs, 'spa'), spd: getIV(p.ivs, 'spd'), spe: getIV(p.ivs, 'spe')
  };
  const ev = {
    hp: getEV(p.evs, 'hp'), atk: getEV(p.evs, 'atk'), def: getEV(p.evs, 'def'), spa: getEV(p.evs, 'spa'), spd: getEV(p.evs, 'spd'), spe: getEV(p.evs, 'spe')
  };
  // Shedinja special case: always 1 HP
  const isShedinja = normalizeName(p.species || p.name) === 'shedinja';
  
  // Base stats at level 100 (or current capped level)
  const hpBase = isShedinja ? 1 : (Math.floor(((2*bs.hp + iv.hp + Math.floor(ev.hp/4)) * L) / 100) + L + 10);
  const calc = (base:number, ivv:number, evv:number, stat:'atk'|'def'|'spa'|'spd'|'spe') => {
    const n = Math.floor(((2*base + ivv + Math.floor(evv/4)) * L) / 100) + 5;
    return Math.floor(n * natureMultiplier(p.nature, stat));
  };
  const atkBase = calc(bs.atk, iv.atk, ev.atk, 'atk');
  const defBase = calc(bs.def, iv.def, ev.def, 'def');
  const spaBase = calc(bs.spAtk, iv.spa, ev.spa, 'spa');
  const spdBase = calc(bs.spDef, iv.spd, ev.spd, 'spd');
  const speBase = calc(bs.speed, iv.spe, ev.spe, 'spe');
  
  // If level > 100, apply linear scaling based on level 99 to 100 growth rate
  if (rawLevel <= 100) {
    return { hp: hpBase, atk: atkBase, def: defBase, spa: spaBase, spd: spdBase, spe: speBase };
  }
  
  // Calculate stats at level 99 for growth rate estimation
  const L99 = 99;
  const hpAt99 = isShedinja ? 1 : (Math.floor(((2*bs.hp + iv.hp + Math.floor(ev.hp/4)) * L99) / 100) + L99 + 10);
  const calcAt99 = (base:number, ivv:number, evv:number, stat:'atk'|'def'|'spa'|'spd'|'spe') => {
    const n = Math.floor(((2*base + ivv + Math.floor(evv/4)) * L99) / 100) + 5;
    return Math.floor(n * natureMultiplier(p.nature, stat));
  };
  const atkAt99 = calcAt99(bs.atk, iv.atk, ev.atk, 'atk');
  const defAt99 = calcAt99(bs.def, iv.def, ev.def, 'def');
  const spaAt99 = calcAt99(bs.spAtk, iv.spa, ev.spa, 'spa');
  const spdAt99 = calcAt99(bs.spDef, iv.spd, ev.spd, 'spd');
  const speAt99 = calcAt99(bs.speed, iv.spe, ev.spe, 'spe');
  
  // Linear extrapolation: stat = baseAt100 + (baseAt100 - baseAt99) * (level - 100)
  const extraLevels = rawLevel - 100;
  const hp = isShedinja ? 1 : Math.floor(hpBase + (hpBase - hpAt99) * extraLevels);
  const atk = Math.floor(atkBase + (atkBase - atkAt99) * extraLevels);
  const def = Math.floor(defBase + (defBase - defAt99) * extraLevels);
  const spa = Math.floor(spaBase + (spaBase - spaAt99) * extraLevels);
  const spd = Math.floor(spdBase + (spdBase - spdAt99) * extraLevels);
  const spe = Math.floor(speBase + (speBase - speAt99) * extraLevels);
  
  return { hp, atk, def, spa, spd, spe };
}

// Sprite helpers: prefer Gen 5 static for retro vibe
export type SpriteSet = 'gen1'|'gen2'|'gen3'|'gen4'|'gen5'|'gen6'|'home';
export function getSpriteSettings(): { set: SpriteSet; animated: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem('ttrpg.spriteSettings') || '{}');
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
    const animated = (raw?.animated == null) ? !isTauri : !!raw?.animated;
    // Global set is intentionally fixed to Gen 5; per-Pokemon choices are selected in SidePanel.
    return { set: 'gen5', animated };
  } catch {
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
    return { set: 'gen5', animated: !isTauri };
  }
}

function spriteFolderForSet(set: SpriteSet, shiny: boolean, back: boolean, useAni: boolean): string | null {
  if (set === 'gen5') {
    if (useAni) {
      if (back) return shiny ? 'ani-back-shiny' : 'ani-back';
      return shiny ? 'ani-shiny' : 'ani';
    }
    if (back) return shiny ? 'gen5-back-shiny' : 'gen5-back';
    return shiny ? 'gen5-shiny' : 'gen5';
  }
  if (set === 'home') {
    if (back) return null;
    return shiny ? 'home-shiny' : 'home';
  }
  if (set === 'gen1') {
    if (back) return 'gen1-back';
    return 'gen1';
  }
  if (set === 'gen2') {
    if (back) return shiny ? 'gen2-back-shiny' : 'gen2-back';
    return shiny ? 'gen2-shiny' : 'gen2';
  }
  if (set === 'gen3') {
    if (back) return shiny ? 'gen3-back-shiny' : 'gen3-back';
    return shiny ? 'gen3-shiny' : 'gen3';
  }
  if (set === 'gen4') {
    if (back) return shiny ? 'gen4-back-shiny' : 'gen4-back';
    return shiny ? 'gen4-shiny' : 'gen4';
  }
  if (set === 'gen6') {
    if (back) return 'gen6-back';
    return 'gen6';
  }
  return null;
}

export function setSpriteSettings(s: Partial<{ set: SpriteSet; animated: boolean }>) {
  try {
    const cur = getSpriteSettings();
    const next = { ...cur, animated: s.animated ?? cur.animated, set: 'gen5' as SpriteSet };
    localStorage.setItem('ttrpg.spriteSettings', JSON.stringify(next));
  } catch {}
}

// Normalize to ASCII and collapse punctuation; used for sprite IDs
function toAscii(s: string): string {
  try {
    // NFD splits accents into combining chars; remove them. Keep gender symbols for special-case checks later.
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch { return s; }
}

export function spriteUrl(speciesId: string, shiny = false, options?: { base?: string, setOverride?: SpriteSet, cosmetic?: string, back?: boolean, forceStatic?: boolean }) {
  const settings = getSpriteSettings();
  const chosen = options?.setOverride ?? settings.set;
  const useAni = !options?.forceStatic && settings.animated && chosen === 'gen5';
  // Construct folder and extension
  const folder =
    spriteFolderForSet(chosen, shiny, !!options?.back, useAni) ||
    spriteFolderForSet('gen5', shiny, !!options?.back, useAni) ||
    spriteFolderForSet('home', shiny, false, false) ||
    'gen5';
  const ext = folder.startsWith('ani') ? 'gif' : 'png';
  const ids = spriteIdCandidates(speciesId, options?.cosmetic);
  // Pick best base: static vendor for named/delta sprites, API backend for numeric BaseSprites
  const base = normalizeBaseUrl(options?.base) || bestSpriteBaseForId(ids[0] || normalizeName(speciesId));
  // Prefer locally stored custom sprite data URL if present (try each candidate id)
  const slotPriority = (() => {
    const slots: SpriteSlot[] = [];
    const back = !!options?.back;
    const frontSlot: SpriteSlot = back ? (shiny ? 'back-shiny' : 'back') : (shiny ? 'shiny' : 'front');
    const gen5Slot: SpriteSlot = back ? (shiny ? 'gen5-back-shiny' : 'gen5-back') : (shiny ? 'gen5-shiny' : 'gen5');
    const homeSlot: SpriteSlot = back ? (shiny ? 'home-back-shiny' : 'home-back') : (shiny ? 'home-shiny' : 'home');
    const aniSlot: SpriteSlot = back ? (shiny ? 'ani-back-shiny' : 'ani-back') : (shiny ? 'ani-shiny' : 'ani');
    if (chosen === 'gen5') {
      if (useAni) slots.push(aniSlot);
      slots.push(gen5Slot);
      slots.push(homeSlot);
    } else {
      slots.push(homeSlot);
      if (useAni) slots.push(aniSlot);
      slots.push(gen5Slot);
    }
    slots.push(frontSlot);
    return Array.from(new Set(slots));
  })();
  for (const id of ids) {
    for (const slot of slotPriority) {
      const local = getCustomSprite(id, slot);
      if (local) return local;
    }
  }
  // Fall back to the first candidate file path
  return `${base}/${folder}/${ids[0]}.${ext}`;
}

function toSpriteId(speciesName: string, cosmetic?: string): string {
  // Primary preferred ID pattern: lowercased base + optional '-' + lowercased forme/cosmetic
  // Convert to ASCII (strip accents) but keep original for symbol checks
  const raw = toAscii(speciesName);
  // Handle Nidoran gender symbol cases explicitly if symbol present in original
  if (/♀/.test(speciesName)) return 'nidoranf';
  if (/♂/.test(speciesName)) return 'nidoranm';
  // Split once on the first hyphen to infer base vs forme suffix; this also works for base names like 'Porygon-Z'
  const firstDash = raw.indexOf('-');
  let basePart = raw, suffixPart = '';
  if (firstDash > 0) { basePart = raw.slice(0, firstDash); suffixPart = raw.slice(firstDash + 1); }
  const baseNorm = normalizeName(basePart);
  let suffixNorm = normalizeName(suffixPart);
  // Normalize common multi-word forme suffixes that have shorter file ids
  if (suffixNorm === 'icerider') suffixNorm = 'ice';
  if (suffixNorm === 'shadowrider') suffixNorm = 'shadow';
  // Append cosmetic form if provided and not already present
  if (cosmetic) {
    const cos = normalizeName(toAscii(cosmetic));
    if (cos && (!suffixNorm || !suffixNorm.endsWith(cos))) suffixNorm = suffixNorm ? `${suffixNorm}${cos}` : cos;
  }
  return suffixNorm ? `${baseNorm}-${suffixNorm}` : baseNorm;
}

// Generate multiple plausible sprite id variants for robust fallback across naming quirks
function spriteIdCandidates(speciesName: string, cosmetic?: string): string[] {
  const ids: string[] = [];
  const pushId = (value: string | null | undefined) => {
    const v = String(value || '').trim();
    if (!v) return;
    if (!ids.includes(v)) ids.push(v);
  };
  const preferred = toSpriteId(speciesName, cosmetic);
  pushId(preferred);
  // Legacy pattern without hyphen (older code path); keep as a fallback
  const rawNorm = normalizeName(toAscii(speciesName));
  pushId(rawNorm);
  // Insurgence Delta forms are commonly named as deltaxxx (no hyphen) in sprite packs.
  if (/\bdelta\b/i.test(speciesName) || /-delta/i.test(preferred) || rawNorm.startsWith('delta')) {
    const cleaned = String(speciesName || '')
      .replace(/\bdelta\b/gi, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const baseNorm = normalizeName(toAscii(cleaned));
    const preferredNorm = normalizeName(preferred);
    if (baseNorm) {
      pushId(`delta${baseNorm}`);
      pushId(`${baseNorm}delta`);
    }
    if (preferredNorm) {
      pushId(preferredNorm.replace(/-delta/i, 'delta'));
      pushId(preferredNorm.replace(/-+/g, ''));
    }
  }
  // Delta's own high dex number (40001+) should be tried before base species fallback
  const dexNum = gNameToNum?.[normalizeName(speciesName)];
  if (Number.isFinite(dexNum) && dexNum !== 0) {
    const numericId = String(Math.trunc(dexNum));
    pushId(numericId);
  }
  // Delta forms: try base species sprite as last resort if a dedicated file is missing.
  const deltaBaseName = String(speciesName || '')
    .replace(/\bdelta\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^-+|-+$/g, '')
    .trim();
  if (deltaBaseName && normalizeName(deltaBaseName) !== normalizeName(speciesName)) {
    pushId(toSpriteId(deltaBaseName, cosmetic));
    pushId(normalizeName(toAscii(deltaBaseName)));
    const deltaDexNum = gNameToNum?.[normalizeName(deltaBaseName)];
    if (Number.isFinite(deltaDexNum) && deltaDexNum !== 0) {
      pushId(String(Math.trunc(deltaDexNum)));
    }
  }
  // Wylin regional formes: "Wylin Gardevoir" → sprite file is "gardevoir-wylin.png"
  if (/\bwylin\b/i.test(speciesName)) {
    const cleaned = String(speciesName || '')
      .replace(/\bwylin\b/gi, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const baseNorm = normalizeName(toAscii(cleaned));
    if (baseNorm) {
      pushId(`${baseNorm}-wylin`);
      pushId(`wylin-${baseNorm}`);
    }
  }
  // For Calyrex rider forms, ensure short variant is present explicitly
  if (/calyrex/i.test(speciesName)) {
    if (/ice/i.test(speciesName)) pushId('calyrex-ice');
    if (/shadow/i.test(speciesName)) pushId('calyrex-shadow');
  }
  return ids;
}

export function getSpriteIdCandidates(speciesName: string, cosmetic?: string): string[] {
  return spriteIdCandidates(speciesName, cosmetic);
}

type SpriteIndexPayload = { folders?: Record<string, string[]> };
type SpriteFolderIndex = Record<string, Set<string>>;

let gSpriteIndexPromise: Promise<SpriteFolderIndex | null> | null = null;

/** Maps "folder:spriteId" → first base URL that contributed it. Used to generate correct URLs. */
let gSpriteIdBaseMap: Map<string, string> = new Map();

/** Look up the best sprite base for a specific folder+id combination (prefers the base that indexed it). */
function spriteBaseForFolderId(folder: string, spriteId: string, fallback: string): string {
  return gSpriteIdBaseMap.get(`${folder}:${spriteId}`) || fallback;
}

async function loadSpriteFolderIndex(base?: string): Promise<SpriteFolderIndex | null> {
  if (gSpriteIndexPromise) return gSpriteIndexPromise;
  gSpriteIndexPromise = (async () => {
    const bases = getSpriteBaseCandidates(base ?? DEFAULT_SPRITE_BASE);
    const out: SpriteFolderIndex = {};
    const baseMap = new Map<string, string>();
    let foundAny = false;
    // Give mobile browsers extra time — HTTPS negotiation + 4G latency can be slow.
    const timeoutMs = /Mobi|Android|iPhone/i.test(navigator?.userAgent ?? '') ? 10_000 : 5_000;

    for (const spriteBase of bases) {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${spriteBase}/index.json`, { signal: ctrl.signal });
        if (!res.ok) continue;
        const payload = (await res.json()) as SpriteIndexPayload;
        const rawFolders = payload?.folders || {};
        for (const [folder, ids] of Object.entries(rawFolders)) {
          if (!out[folder]) out[folder] = new Set<string>();
          for (const id of (Array.isArray(ids) ? ids : [])) {
            const v = String(id || '').trim();
            if (!v) continue;
            out[folder].add(v);
            // Track first base that contributed this sprite ID so we can build correct URLs
            const key = `${folder}:${v}`;
            if (!baseMap.has(key)) baseMap.set(key, spriteBase);
          }
        }
        foundAny = true;
      } catch {
        // Try next base.
      } finally {
        clearTimeout(timeoutId);
      }
    }
    gSpriteIdBaseMap = baseMap;
    return foundAny ? out : null;
  })();
  // If no index was found, allow retry on next call (e.g. after deploy or service restart)
  gSpriteIndexPromise.then(result => { if (!result) gSpriteIndexPromise = null; });
  return gSpriteIndexPromise;
}

export type PokemonSpriteOption = {
  id: string;
  label: string;
  spriteId: string;
  set: 'gen5' | 'gen1' | 'gen2' | 'gen3' | 'gen4' | 'gen6' | 'home' | 'ani' | 'custom';
  front: string;
  back?: string;
  animated?: boolean;
};

function spriteSetFolders(
  set: PokemonSpriteOption['set'],
  shiny: boolean
): { front?: string; back?: string; ext: 'png' | 'gif'; label: string } {
  switch (set) {
    case 'ani':
      return {
        front: shiny ? 'ani-shiny' : 'ani',
        back: shiny ? 'ani-back-shiny' : 'ani-back',
        ext: 'gif',
        label: 'Animated',
      };
    case 'home':
      return { front: shiny ? 'home-shiny' : 'home', ext: 'png', label: 'HOME' };
    case 'gen1':
      return { front: 'gen1', back: 'gen1-back', ext: 'png', label: 'Gen 1' };
    case 'gen2':
      return { front: shiny ? 'gen2-shiny' : 'gen2', back: shiny ? 'gen2-back-shiny' : 'gen2-back', ext: 'png', label: 'Gen 2' };
    case 'gen3':
      return { front: shiny ? 'gen3-shiny' : 'gen3', back: shiny ? 'gen3-back-shiny' : 'gen3-back', ext: 'png', label: 'Gen 3' };
    case 'gen4':
      return { front: shiny ? 'gen4-shiny' : 'gen4', back: shiny ? 'gen4-back-shiny' : 'gen4-back', ext: 'png', label: 'Gen 4' };
    case 'gen6':
      return { front: 'gen6', back: 'gen6-back', ext: 'png', label: 'Gen 6' };
    case 'gen5':
    default:
      return { front: shiny ? 'gen5-shiny' : 'gen5', back: shiny ? 'gen5-back-shiny' : 'gen5-back', ext: 'png', label: 'Gen 5' };
  }
}

export async function listPokemonSpriteOptions(
  speciesName: string,
  options?: { shiny?: boolean; cosmetic?: string; base?: string; allowFormVariants?: boolean; strictExisting?: boolean }
): Promise<PokemonSpriteOption[]> {
  const shiny = !!options?.shiny;
  const allowFormVariants = !!options?.allowFormVariants;
  const strictExisting = !!options?.strictExisting;
  const base = normalizeBaseUrl(options?.base) || getPreferredSpriteBase();
  const candidateIds = spriteIdCandidates(speciesName, options?.cosmetic);
  const preferredId = candidateIds[0] || normalizeName(speciesName);

  const variantIds = new Set<string>(candidateIds);
  // Determine whether the species itself is a forme variant (has a dash like
  // "vulpix-alola").  When it IS a forme, we must NOT add the stripped base
  // ("vulpix") as a search root because that matches the wrong forme's sprites.
  const preferredHasForme = preferredId.includes('-');
  const roots = new Set<string>();
  for (const id of candidateIds) {
    roots.add(id);
    // Only strip to the base root when the preferred species is already the
    // base form — this lets "charizard" also find "charizard-mega" sprites
    // without letting "vulpix-alola" find "vulpix" sprites.
    if (!preferredHasForme) {
      const dash = id.indexOf('-');
      if (dash > 0) roots.add(id.slice(0, dash));
    }
  }

  const folderIndex = await loadSpriteFolderIndex(base);
  const sourceSets: Array<PokemonSpriteOption['set']> = ['gen5', 'ani', 'home', 'gen6', 'gen4', 'gen3', 'gen2', 'gen1'];
  const numericVariantCache = new Map<string, string[]>();

  if (folderIndex) {
    for (const setId of sourceSets) {
      const def = spriteSetFolders(setId, shiny);
      const entries = def.front ? folderIndex[def.front] : undefined;
      if (!entries) continue;
      for (const root of roots) {
        if (entries.has(root)) variantIds.add(root);

        // BaseSprites packs often encode Pokemon variants as numeric suffixes (1a, 1b, 1ab, ...).
        // Include those even when form variants are disabled so sprite pickers can show full packs.
        if (/^\d+$/.test(root)) {
          const cacheKey = `${def.front}:${root}`;
          let matches = numericVariantCache.get(cacheKey);
          if (!matches) {
            const prefix = root.toLowerCase();
            matches = [];
            for (const spriteId of entries) {
              const candidate = String(spriteId || '').toLowerCase();
              if (!candidate || !candidate.startsWith(prefix)) continue;
              const suffix = candidate.slice(prefix.length);
              if (!suffix) continue;
              if (!/^[a-z][a-z0-9]*$/i.test(suffix)) continue;
              matches.push(spriteId);
              // Guardrail: avoid pathological scans for very broad prefixes.
              if (matches.length >= 200) break;
            }
            numericVariantCache.set(cacheKey, matches);
          }
          for (const spriteId of matches) variantIds.add(spriteId);
        }

        if (!allowFormVariants) continue;
        for (const spriteId of entries) {
          if (spriteId.startsWith(`${root}-`)) variantIds.add(spriteId);
        }
      }
    }
  }

  const sortedVariantIds = Array.from(variantIds).sort((a, b) => {
    if (a === preferredId) return -1;
    if (b === preferredId) return 1;
    const aLocal = a.startsWith(`${preferredId}-`) ? 0 : 1;
    const bLocal = b.startsWith(`${preferredId}-`) ? 0 : 1;
    if (aLocal !== bLocal) return aLocal - bLocal;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  const out: PokemonSpriteOption[] = [];

  // Local custom sprites for this species/form come first.
  const customFrontSlots: SpriteSlot[] = shiny ? ['shiny', 'gen5-shiny', 'front', 'gen5'] : ['front', 'gen5', 'shiny', 'gen5-shiny'];
  const customBackSlots: SpriteSlot[] = shiny ? ['back-shiny', 'gen5-back-shiny', 'back', 'gen5-back'] : ['back', 'gen5-back', 'back-shiny', 'gen5-back-shiny'];
  for (const id of sortedVariantIds) {
    const customFront = customFrontSlots.map(slot => getCustomSprite(id, slot)).find(Boolean);
    if (!customFront) continue;
    const customBack = customBackSlots.map(slot => getCustomSprite(id, slot)).find(Boolean);
    out.push({
      id: `custom:${id}`,
      label: id === preferredId ? 'Custom (Local)' : `Custom • ${id}`,
      spriteId: id,
      set: 'custom',
      front: customFront,
      back: customBack,
    });
  }

  // Expose numeric BaseSprites option (from .fusion-sprites-local/Other/BaseSprites via backend /sprites cache).
  // Numeric sprites only exist on the API backend, so use that base explicitly.
  const numericId = nameToDexNum(speciesName);
  if (Number.isFinite(numericId) && numericId && numericId > 0) {
    const numericSpriteId = String(Math.trunc(numericId));
    const numBase = getApiSpriteBase() || base;
    out.push({
      id: `gen5:numeric:${numericSpriteId}`,
      label: `Gen 5 BaseSprites • #${numericSpriteId}`,
      spriteId: numericSpriteId,
      set: 'gen5',
      front: `${numBase}/gen5/${numericSpriteId}.png`,
      back: `${numBase}/gen5-back/${numericSpriteId}.png`,
      animated: false,
    });
  }

  for (const setId of sourceSets) {
    const def = spriteSetFolders(setId, shiny);
    if (!def.front) continue;
    const frontEntries = folderIndex?.[def.front];
    const backEntries = def.back ? folderIndex?.[def.back] : undefined;
    if (strictExisting && !frontEntries) continue;
    for (const spriteId of sortedVariantIds) {
      if (frontEntries && !frontEntries.has(spriteId)) continue;
      // Use the base that actually indexed this sprite ID; fall back to API for numerics, static otherwise
      const optBase = def.front
        ? spriteBaseForFolderId(def.front, spriteId, bestSpriteBaseForId(spriteId, base))
        : bestSpriteBaseForId(spriteId, base);
      const front = `${optBase}/${def.front}/${spriteId}.${def.ext}`;
      const back = def.back && (!backEntries || backEntries.has(spriteId))
        ? `${optBase}/${def.back}/${spriteId}.${def.ext}`
        : undefined;
      const suffix = spriteId === preferredId ? 'Base' : spriteId.replace(`${preferredId}-`, '');
      out.push({
        id: `${setId}:${spriteId}`,
        label: `${def.label} • ${suffix || spriteId}`,
        spriteId,
        set: setId,
        front,
        back,
        animated: setId === 'ani',
      });
    }
  }

  // Fallback guard when index.json is unavailable.
  if (!out.length && !strictExisting) {
    out.push({
      id: `fallback:${preferredId}`,
      label: 'Gen 5 • Base',
      spriteId: preferredId,
      set: 'gen5',
      front: spriteUrl(speciesName, shiny, { setOverride: 'gen5', cosmetic: options?.cosmetic, back: false, forceStatic: true }),
      back: spriteUrl(speciesName, shiny, { setOverride: 'gen5', cosmetic: options?.cosmetic, back: true, forceStatic: true }),
    });
    // When index.json can't be loaded (common on phones with slow connections),
    // probe for common alpha-suffix variants so the sprite picker isn't empty.
    const numId = nameToDexNum(speciesName);
    if (Number.isFinite(numId) && numId && numId > 0) {
      const numStr = String(Math.trunc(numId));
      const numBase = getApiSpriteBase() || base;
      const alphaChars = 'abcdefghijklmnopqrstuvwxyz';
      for (let i = 0; i < alphaChars.length; i++) {
        const sid = `${numStr}${alphaChars[i]}`;
        out.push({
          id: `gen5:numeric:${sid}`,
          label: `Gen 5 BaseSprites • #${sid}`,
          spriteId: sid,
          set: 'gen5',
          front: `${numBase}/gen5/${sid}.png`,
          back: `${numBase}/gen5-back/${sid}.png`,
          animated: false,
        });
      }
    }
  }

  // De-duplicate by front URL while preserving order.
  const seen = new Set<string>();
  return out.filter((opt) => {
    if (seen.has(opt.front)) return false;
    seen.add(opt.front);
    return true;
  });
}

export function speciesFormesInfo(name: string, dex: DexIndex) {
  const key = findSpeciesKey(name, dex);
  if (!key) return { base: name, otherFormes: [] as string[], cosmeticFormes: [] as string[], entry: undefined as any };
  const s = dex[key];
  return { base: s.baseSpecies || s.name, otherFormes: s.otherFormes || [], cosmeticFormes: s.cosmeticFormes || [], entry: s };
}

export function iconUrl(speciesId: string, options?: { base?: string }) {
  const base = normalizeBaseUrl(options?.base) || getPreferredSpriteBase();
  return `${base}/gen5icons/${normalizeName(speciesId)}.png`;
}

export function iconUrlWithFallback(speciesId: string, onError: (nextUrl: string)=>void, options?: { base?: string }) {
  const id = normalizeName(speciesId);
  const bases = getSpriteBaseCandidates(options?.base);
  const candidates: string[] = [];
  // Try gen5icons across all bases
  for (const b of bases) candidates.push(`${b}/gen5icons/${id}.png`);
  // Then try gen5 full sprites across all bases as small icon fallback
  const idList = spriteIdCandidates(speciesId);
  for (const b of bases) {
    for (const sid of idList) candidates.push(`${b}/gen5/${sid}.png`);
  }
  // External fallback
  candidates.push(`https://play.pokemonshowdown.com/sprites/gen5icons/${id}.png`);
  for (const sid of idList) candidates.push(`https://play.pokemonshowdown.com/sprites/gen5/${sid}.png`);
  let idx = 0;
  return { src: candidates[0], handleError: () => { idx++; if (idx < candidates.length) onError(candidates[idx]); } };
}

// Sprite URL with graceful fallback chain (custom -> chosen set -> alternate set -> placeholder)
export function spriteUrlWithFallback(
  speciesId: string,
  onError: (nextUrl: string) => void,
  options?: { shiny?: boolean; base?: string; setOverride?: SpriteSet; cosmetic?: string; back?: boolean }
) {
  const spriteBases = getSpriteBaseCandidates(options?.base);
  const shiny = !!options?.shiny;
  const back = !!options?.back;
  const settings = getSpriteSettings();
  const chosen = options?.setOverride ?? settings.set;
  const useAni = settings.animated && chosen === 'gen5';
  const idList = spriteIdCandidates(speciesId, options?.cosmetic);

  // Candidate folders by priority
  const folders: string[] = [];
  const addFolder = (set: SpriteSet) => {
    const f = spriteFolderForSet(set, shiny, back, settings.animated && set === 'gen5');
    if (f && !folders.includes(f)) folders.push(f);
  };
  addFolder(chosen);
  if (chosen !== 'gen5') addFolder('gen5');
  if (chosen !== 'home') addFolder('home');
  // When animated gen5 is chosen, 'gen5' folder becomes 'ani' above.
  // Always add static gen5 as a fallback so backend BaseSprites (served under gen5/) are reachable.
  const staticGen5 = spriteFolderForSet('gen5', shiny, back, false);
  if (staticGen5 && !folders.includes(staticGen5)) folders.push(staticGen5);

  // Insert custom sprite data URL at the front if available (try every candidate id)
  const candidates: string[] = [];
  const slotPriority = (() => {
    const slots: SpriteSlot[] = [];
    const frontSlot: SpriteSlot = back ? (shiny ? 'back-shiny' : 'back') : (shiny ? 'shiny' : 'front');
    const gen5Slot: SpriteSlot = back ? (shiny ? 'gen5-back-shiny' : 'gen5-back') : (shiny ? 'gen5-shiny' : 'gen5');
    const homeSlot: SpriteSlot = back ? (shiny ? 'home-back-shiny' : 'home-back') : (shiny ? 'home-shiny' : 'home');
    const aniSlot: SpriteSlot = back ? (shiny ? 'ani-back-shiny' : 'ani-back') : (shiny ? 'ani-shiny' : 'ani');
    if (chosen === 'gen5') {
      if (useAni) slots.push(aniSlot);
      slots.push(gen5Slot);
      slots.push(homeSlot);
    } else {
      slots.push(homeSlot);
      if (useAni) slots.push(aniSlot);
      slots.push(gen5Slot);
    }
    slots.push(frontSlot);
    return Array.from(new Set(slots));
  })();
  for (const id of idList) {
    for (const slot of slotPriority) {
      const custom = getCustomSprite(id, slot);
      if (custom) candidates.push(custom);
    }
  }
  // Try each ID across ALL bases before moving to the next ID.
  // This ensures 'deltavenusaur' is found on the static host before 'venusaur' is tried.
  for (const id of idList) {
    for (const base of spriteBases) {
      for (const f of folders) {
        const isAni = f.startsWith('ani');
        const ext = isAni ? 'gif' : 'png';
        candidates.push(`${base}/${f}/${id}.${ext}`);
      }
    }
  }
  // Add external fallback URLs (play.pokemonshowdown.com) for when local files are missing
  const extBase = 'https://play.pokemonshowdown.com/sprites';
  for (const id of idList) {
    for (const f of folders) {
      const isAni = f.startsWith('ani');
      const ext = isAni ? 'gif' : 'png';
      candidates.push(`${extBase}/${f}/${id}.${ext}`);
    }
  }

  let idx = 0;
  const phLabel = (idList[0] || normalizeName(speciesId)).slice(0, 8).toUpperCase();
  const placeholder = placeholderSpriteDataURL(phLabel);
  const first = candidates[0] || placeholder;
  return {
    src: first,
    handleError: () => {
      idx++;
      const next = candidates[idx] || placeholder;
      onError(next);
    },
    candidates,
    placeholder,
  };
}

// Custom species local overlay (persisted in localStorage)
const LS_CUSTOM_DEX = 'ttrpg.customDex';
const LS_CUSTOM_LS = 'ttrpg.customLearnsets';
const LS_CUSTOM_ITEMS = 'ttrpg.customItems';
const LS_CUSTOM_MOVES = 'ttrpg.customMoves';
const LS_CUSTOM_ABILITIES = 'ttrpg.customAbilities';
export function getCustomDex(): DexIndex {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_DEX) || '{}'); } catch { return {}; }
}
export function saveCustomDex(entryKey: string, entry: DexSpecies) {
  const all = getCustomDex();
  all[entryKey] = entry;
  try { localStorage.setItem(LS_CUSTOM_DEX, JSON.stringify(all)); } catch {}
}
export function getCustomLearnsets(): LearnsetsIndex {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_LS) || '{}'); } catch { return {}; }
}
export function saveCustomLearnset(entryKey: string, learnset: Record<string, any>) {
  const all = getCustomLearnsets();
  all[entryKey] = { learnset } as any;
  try { localStorage.setItem(LS_CUSTOM_LS, JSON.stringify(all)); } catch {}
}

export function getCustomItems(): ItemIndex {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_ITEMS) || '{}'); } catch { return {}; }
}
export function saveCustomItem(entryKey: string, item: ItemEntry) {
  const all = getCustomItems();
  all[entryKey] = item;
  try { localStorage.setItem(LS_CUSTOM_ITEMS, JSON.stringify(all)); } catch {}
}

export function getCustomMoves(): MoveIndex {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_MOVES) || '{}'); } catch { return {}; }
}
export function saveCustomMove(entryKey: string, move: MoveEntry) {
  const all = getCustomMoves();
  all[entryKey] = move;
  try { localStorage.setItem(LS_CUSTOM_MOVES, JSON.stringify(all)); } catch {}
}

export function getCustomAbilities(): AbilityIndex {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_ABILITIES) || '{}'); } catch { return {}; }
}
export function saveCustomAbility(entryKey: string, ability: AbilityEntry) {
  const all = getCustomAbilities();
  all[entryKey] = ability;
  try { localStorage.setItem(LS_CUSTOM_ABILITIES, JSON.stringify(all)); } catch {}
}

// Custom sprite storage (data URLs) — local only
const LS_CUSTOM_SPRITES = 'ttrpg.customSprites';
export type SpriteSlot =
  | 'front' | 'shiny' | 'back' | 'back-shiny'
  | 'gen5' | 'gen5-shiny' | 'gen5-back' | 'gen5-back-shiny'
  | 'home' | 'home-shiny' | 'home-back' | 'home-back-shiny'
  | 'ani' | 'ani-shiny' | 'ani-back' | 'ani-back-shiny';
export function getCustomSprites(): Record<string, Partial<Record<SpriteSlot, string>>> {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_SPRITES) || '{}'); } catch { return {}; }
}
export function getCustomSprite(id: string, slot: SpriteSlot, forceBundled?: boolean): string | undefined {
  const all = getCustomSprites();
  const normalizedId = normalizeName(id);
  const local = all[id]?.[slot] || all[normalizedId]?.[slot];
  if (local) return local;
  // Wylin/custom region sprites should prefer backend-hosted updates over bundled snapshots.
  // When forceBundled is true (e.g. PS engine needs a sprite immediately), skip this guard.
  if (!forceBundled && gPreferBackendSpriteIds.has(normalizedId) && getApiSpriteBase()) return undefined;
  const bundled = gBundledSprites[normalizedId] || gBundledSprites[id];
  if (!bundled) return undefined;
  const bySlot = bundled[slot];
  if (bySlot) return bySlot;
  if (slot === 'front') return bundled.front || bundled.gen5 || bundled.home || bundled.ani;
  if (slot === 'shiny') return bundled.shiny || bundled['gen5-shiny'] || bundled['home-shiny'] || bundled['ani-shiny'];
  if (slot === 'back') return bundled.back || bundled['gen5-back'] || bundled['home-back'] || bundled['ani-back'] || bundled.front || bundled.gen5 || bundled.home || bundled.ani;
  if (slot === 'back-shiny') return bundled['back-shiny'] || bundled['gen5-back-shiny'] || bundled['home-back-shiny'] || bundled['ani-back-shiny'] || bundled.shiny || bundled['gen5-shiny'] || bundled['home-shiny'] || bundled['ani-shiny'];
  return undefined;
}
/** Check if a species has a dedicated back sprite (not a front-as-back fallback). */
export function hasRealBackSprite(id: string): boolean {
  const normalizedId = normalizeName(id);
  const all = getCustomSprites();
  if (all[id]?.back || all[normalizedId]?.back) return true;
  const bundled = gBundledSprites[normalizedId] || gBundledSprites[id];
  return !!(bundled?.back || bundled?.['gen5-back'] || bundled?.['home-back'] || bundled?.['ani-back']);
}
export function saveCustomSprite(id: string, slot: SpriteSlot, dataUrl: string) {
  const all = getCustomSprites();
  all[id] = { ...(all[id] || {}), [slot]: dataUrl };
  try { localStorage.setItem(LS_CUSTOM_SPRITES, JSON.stringify(all)); } catch {}
}

async function fetchImageAsDataUrl(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('file-read-failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function cacheSpriteSelectionLocally(
  spriteId: string,
  frontUrl: string,
  backUrl?: string,
  set?: 'gen5' | 'gen1' | 'gen2' | 'gen3' | 'gen4' | 'gen6' | 'home' | 'ani' | 'custom',
): Promise<void> {
  const sid = normalizeName(spriteId || '');
  if (!sid || !frontUrl) return;

  const frontData = await fetchImageAsDataUrl(frontUrl);
  if (frontData) {
    saveCustomSprite(sid, 'front', frontData);
    if (set === 'gen5') saveCustomSprite(sid, 'gen5', frontData);
    if (set === 'home') saveCustomSprite(sid, 'home', frontData);
    if (set === 'ani') saveCustomSprite(sid, 'ani', frontData);
  }

  if (!backUrl) return;
  const backData = await fetchImageAsDataUrl(backUrl);
  if (backData) {
    saveCustomSprite(sid, 'back', backData);
    if (set === 'gen5') saveCustomSprite(sid, 'gen5-back', backData);
    if (set === 'home') saveCustomSprite(sid, 'home-back', backData);
    if (set === 'ani') saveCustomSprite(sid, 'ani-back', backData);
  }
}

// Placeholder data URL sprite for missing images (SVG) - grey silhouette with '?'
export function placeholderSpriteDataURL(label: string = '?', w: number = 80, h: number = 80): string {
  const bg = '#555';
  const fg = '#888';
  const safeLabel = String(label ?? '?');
  // Draw a simple Pokemon-like silhouette shape with a question mark
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
              `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
              `<ellipse cx='${w/2}' cy='${h*0.65}' rx='${w*0.35}' ry='${h*0.28}' fill='${bg}' />` +
              `<circle cx='${w/2}' cy='${h*0.32}' r='${w*0.22}' fill='${bg}' />` +
              `<text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='${Math.floor(Math.min(w, h) * 0.4)}' fill='${fg}'>${escapeXml(safeLabel)}</text>` +
              `</svg>`;
  // Base64 encode safely for any unicode label
  const b64 = toBase64(svg);
  return `data:image/svg+xml;base64,${b64}`;
}


function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
}

function toBase64(str: string): string {
  try {
    // Browser-safe unicode base64
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const btoaFn = (typeof btoa !== 'undefined') ? btoa : (s: string) => Buffer.from(s, 'binary').toString('base64');
    const utf8Str = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)));
    return btoaFn(utf8Str);
  } catch {
    // Fallback: plain Buffer in Node-like envs
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return (typeof Buffer !== 'undefined') ? Buffer.from(str, 'utf8').toString('base64') : '';
  }
}

// Import/export: parse and format Showdown team text blocks
export type ImportedSet = {
  name?: string;
  species: string;
  gender?: 'M' | 'F';
  item?: string;
  ability?: string;
  level?: number;
  teraType?: string;
  evs?: Partial<{ hp: number; atk: number; def: number; spa: number; spd: number; spe: number }>;
  ivs?: Partial<{ hp: number; atk: number; def: number; spa: number; spd: number; spe: number }>;
  nature?: string;
  moves: string[];
};

export function parseShowdownTeam(text: string): ImportedSet[] {
  // Normalize CRLF to LF and trim trailing spaces
  const normText = text.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').trim();
  const blocks = normText.split(/\n\s*\n+/);
  const sets: ImportedSet[] = [];
  for (const b of blocks) {
    const lines = b.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const first = lines[0];
    // Example: Sir Quacks Alot (Golduck) (M) @ Oran Berry
    let name = '', species = '', gender: 'M'|'F'|undefined, item: string|undefined;
    const atIdx = first.indexOf(' @ ');
    const left = atIdx >= 0 ? first.slice(0, atIdx) : first;
    item = atIdx >= 0 ? first.slice(atIdx + 3).trim() : undefined;
    // nickname (Species) (M/F/♂/♀)
    const m = left.match(/^(.*?)\s*\(([^)]+)\)\s*(?:\((M|F|♂|♀)\))?$/);
    if (m) {
      name = m[1].trim();
      species = m[2].trim();
      const g = (m[3] as string|undefined);
      gender = g ? ((g === '♂') ? 'M' : (g === '♀') ? 'F' : (g as 'M'|'F')) : undefined;
    } else {
      // Accept simple lines: 'Species' or 'Species (M/F)' optionally followed by @ item
      const m2 = left.match(/^([^()]+?)\s*(?:\((M|F|♂|♀)\))?$/);
      if (m2) {
        species = m2[1].trim();
        const g2 = (m2[2] as string|undefined);
        gender = g2 ? ((g2 === '♂') ? 'M' : (g2 === '♀') ? 'F' : (g2 as 'M'|'F')) : undefined;
        name = species;
      } else {
        species = left.trim();
        name = species;
      }
    }

    const set: ImportedSet = { name, species, gender, item, moves: [] };
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('Ability:')) set.ability = line.split(':')[1].trim();
      else if (line.startsWith('Level:')) set.level = Number(line.split(':')[1].trim());
      else if (line.startsWith('Tera Type:')) set.teraType = line.split(':')[1].trim();
      else if (/^EVs:/.test(line)) {
        set.evs = parseEvIvLine(line.replace(/^EVs:\s*/, ''));
      } else if (/^IVs:/.test(line)) {
        set.ivs = parseEvIvLine(line.replace(/^IVs:\s*/, ''));
      } else if (/Nature$/.test(line)) {
        set.nature = line.replace(/\s*Nature$/, '').trim();
      } else if (line.startsWith('- ')) {
        set.moves.push(line.slice(2).trim());
      }
    }
    sets.push(set);
  }
  return sets;
}

function parseEvIvLine(s: string) {
  const out: any = {};
  s.split('/').forEach(part => {
    const m = part.trim().match(/(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)/i);
    if (m) {
      const val = Number(m[1]);
      const stat = m[2].toLowerCase();
      const map: Record<string,string> = { hp:'hp', atk:'atk', def:'def', spa:'spa', spd:'spd', spe:'spe' };
      out[map[stat]] = val;
    }
  });
  return out as Partial<{ hp:number; atk:number; def:number; spa:number; spd:number; spe:number }>;
}

// Map move names to metadata from the loaded index
export function mapMoves(moveNames: string[], moves: MoveIndex) {
  return moveNames.map(name => {
    const key = Object.keys(moves).find(k => normalizeName(k) === normalizeName(name));
    const entry = key ? moves[key] : undefined;
    const sec = entry?.secondary ?? (entry?.secondaries && entry.secondaries[0]) ?? undefined;
    return {
      name,
      type: entry?.type ?? '???',
      power: entry?.basePower ?? 0,
      category: (entry?.category ?? 'Status') as 'Physical'|'Special'|'Status',
      accuracy: entry?.accuracy ?? undefined,
      secondary: sec ? sanitizeSecondary(sec) : null,
      effect: entry?.shortDesc || entry?.desc,
    };
  });
}

function sanitizeSecondary(sec: any) {
  // Keep minimal helpful info for UI
  const out: any = {};
  if (typeof sec?.chance === 'number') out.chance = sec.chance;
  if (typeof sec?.status === 'string') out.status = sec.status;
  if (sec?.boosts && typeof sec.boosts === 'object') out.boosts = sec.boosts;
  return out;
}

function findSpeciesKey(id: string, dex: DexIndex): string | undefined {
  const norm = normalizeName(id);
  if (!norm) return undefined;
  // alias map first
  const aliased = gAliases[norm];
  if (aliased) {
    let k = Object.keys(dex).find(x => normalizeName(x) === aliased) ||
            Object.keys(dex).find(x => normalizeName(dex[x].name) === aliased);
    if (k) return k;
  }
  // exact key match
  let key = Object.keys(dex).find(k => normalizeName(k) === norm);
  if (key) return key;
  // exact display name match
  key = Object.keys(dex).find(k => normalizeName(dex[k].name) === norm);
  if (key) return key;
  // try stripping common forme/region suffixes or extras
  const stripped = norm.replace(/(alola|galar|hisui|paldea|mega|gmax|totem|therian|origin|pirouette|rockstar|belle|popstar|phd|libre|original|sandy|trash|zen|school|blade|shield|average|large|super|small|ultra)$/i, '');
  if (stripped && stripped !== norm) {
    key = Object.keys(dex).find(k => normalizeName(k) === stripped) ||
          Object.keys(dex).find(k => normalizeName(dex[k].name) === stripped);
    if (key) return key;
  }
  // loose startsWith match on names (helps e.g., regional/forme names)
  key = Object.keys(dex).find(k => normalizeName(dex[k].name).startsWith(norm));
  if (key) return key;
  // final fallback: includes
  key = Object.keys(dex).find(k => normalizeName(dex[k].name).includes(norm));
  return key;
}

// Global alias cache populated by loadShowdownDex
let gAliases: Record<string, string> = {};

export function findSpeciesEntry(id: string, dex: DexIndex): DexSpecies | undefined {
  const key = findSpeciesKey(id, dex);
  return key ? dex[key] : undefined;
}

export function eligibleMegaFormForItem(currentName: string, heldItem: string | undefined, dex: DexIndex): string | null {
  if (!heldItem) return null;
  const info = speciesFormesInfo(currentName, dex);
  const base = info.base;
  // Always search otherFormes from the base species entry to find the mega form
  const baseEntry = findSpeciesEntry(base, dex);
  const forms = baseEntry?.otherFormes || [];
  const target = forms.find(f => {
    const entry = findSpeciesEntry(f, dex);
    return entry?.requiredItem && normalizeName(entry.requiredItem) === normalizeName(heldItem);
  });
  return target || null;
}

// Format Showdown team text from BattlePokemon[]
export function formatShowdownSet(p: BattlePokemon): string {
  const name = p.name;
  const species = p.species && normalizeName(p.species) !== normalizeName(p.name) ? ` (${p.species})` : '';
  const item = p.item ? ` @ ${p.item}` : '';
  const header = `${name}${species}${item}`.trim();
  const lines: string[] = [header];
  if (p.ability) lines.push(`Ability: ${p.ability}`);
  if (p.level) lines.push(`Level: ${p.level}`);
  // EVs/IVs/Nature not currently tracked
  for (const m of p.moves) {
    if (m?.name) lines.push(`- ${m.name}`);
  }
  return lines.join('\n');
}

export function formatShowdownTeam(list: BattlePokemon[]): string {
  return list.map(formatShowdownSet).join('\n\n');
}

// Compatibility helpers for UI modules that expect these functions
export function packShowdownTeam(list: BattlePokemon[]): string {
  return formatShowdownTeam(list);
}

export function addTeamToShowdownStorage(name: string, text: string, opts?: { format?: string }): { ok: true } | { ok: false; error: string } {
  try {
    const raw = localStorage.getItem('showdown_teams') || '[]';
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    arr.push({ name, text, ...(opts?.format ? { format: opts.format } : {}) });
    localStorage.setItem('showdown_teams', JSON.stringify(arr));
    return { ok: true };
  } catch (e:any) {
    return { ok: false, error: e?.message || 'storage failed' };
  }
}

// Multi-team persistence
// Regular teams: 6 max, TTRPG teams: unlimited (or custom max)
export type TeamRecord = { 
  id: string; 
  name: string; 
  members: BattlePokemon[];
  type?: 'standard' | 'ttrpg'; // default is 'standard'
  maxSize?: number; // undefined = 6 for standard, no limit for ttrpg
};
export const DEFAULT_TEAM_SIZE = 6;
const LS_TEAMS = 'ttrpg.teams';
const LS_ACTIVE_TEAM = 'ttrpg.activeTeamId';
export function loadTeams(): { teams: TeamRecord[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(LS_TEAMS) || '[]';
    const teams: TeamRecord[] = JSON.parse(raw);
    const activeId = localStorage.getItem(LS_ACTIVE_TEAM);
    return { teams, activeId };
  } catch {
    return { teams: [], activeId: null };
  }
}
export function saveTeams(teams: TeamRecord[], activeId?: string | null) {
  try {
    localStorage.setItem(LS_TEAMS, JSON.stringify(teams));
    if (typeof activeId !== 'undefined') {
      if (activeId) localStorage.setItem(LS_ACTIVE_TEAM, activeId); else localStorage.removeItem(LS_ACTIVE_TEAM);
    }
    // Dispatch custom event to notify same-window listeners (e.g. LobbyTab)
    window.dispatchEvent(new CustomEvent('teamsUpdated'));
  } catch {}
}
export function createTeam(name: string, options?: { type?: 'standard' | 'ttrpg'; maxSize?: number }): TeamRecord {
  const type = options?.type || 'standard';
  const maxSize = options?.maxSize ?? (type === 'ttrpg' ? undefined : DEFAULT_TEAM_SIZE);
  return { id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`, name, members: [], type, maxSize };
}
export function getTeamMaxSize(team: TeamRecord): number {
  if (team.type === 'ttrpg') return team.maxSize ?? Infinity;
  return team.maxSize ?? DEFAULT_TEAM_SIZE;
}
export function isTeamFull(team: TeamRecord): boolean {
  const max = getTeamMaxSize(team);
  return team.members.length >= max;
}
export function cloneForTeam(p: Pokemon): BattlePokemon {
  // Ensure mechanics fields are carried through and computed
  const bp = prepareBattle({ ...p });
  return bp;
}

// Search helpers (basic fuzzy-ish behavior like PS teambuilder search)
export function searchSpecies(query: string, dex: DexIndex, limit = 20): string[] {
  const q = normalizeName(query);
  if (!q) return [];
  const names = Object.values(dex).map(s => s.name);
  const scored = names.map(n => ({ n, score: scoreMatch(q, normalizeName(n)) }));
  return scored.filter(s => s.score > 0).sort((a,b)=>b.score-a.score).slice(0,limit).map(s=>s.n);
}

export function searchMoves(query: string, moves: MoveIndex, limit = 20): string[] {
  const q = normalizeName(query);
  if (!q) return [];
  const names = Object.values(moves).map(m => m.name);
  const scored = names.map(n => ({ n, score: scoreMatch(q, normalizeName(n)) }));
  return scored.filter(s => s.score > 0).sort((a,b)=>b.score-a.score).slice(0,limit).map(s=>s.n);
}

export function isMoveLegalForSpecies(species: string, moveName: string, learnsets: LearnsetsIndex): boolean {
  const key = normalizeName(species);
  const ls = (learnsets as any)[key];
  if (!ls || !ls.learnset) return false;
  const moveId = normalizeName(moveName);
  return !!ls.learnset[moveId];
}

function scoreMatch(q: string, s: string): number {
  if (s.startsWith(q)) return 3;
  if (s.includes(q)) return 2;
  return 0;
}

// ── Fusion Helpers ──

// Global dex-number maps, populated lazily from loadShowdownDex results
let gNumToName: Record<number, string> = {};
let gNameToNum: Record<string, number> = {};
let gDexMapsBuilt = false;

/** Ensure dex number maps are built (idempotent). Call after loadShowdownDex(). */
export function buildDexNumMaps(dex: DexIndex): void {
  if (gDexMapsBuilt) return;
  gNumToName = {};
  gNameToNum = {};
  for (const [key, entry] of Object.entries(dex)) {
    const num = (entry as any).num as number | undefined;
    if (num == null || num === 0) continue;
    const name = normalizeName(entry.name || key);
    if (!gNumToName[num]) gNumToName[num] = name;
    gNameToNum[name] = num;
  }
  gDexMapsBuilt = true;
}

/** Convert a dex number to the normalised species name (e.g. 6 → "charizard") */
export function dexNumToName(num: number): string | undefined {
  return gNumToName[num];
}

/** Convert a species name to its dex number (e.g. "charizard" → 6) */
export function nameToDexNum(name: string): number | undefined {
  return gNameToNum[normalizeName(name)];
}

function getCustomFusionSprite(headNum: number, bodyNum: number, slot: SpriteSlot): string | undefined {
  const pair = `${Math.trunc(headNum)}.${Math.trunc(bodyNum)}`;
  const keys = Array.from(new Set([`fusion:${pair}`, `fusion-${pair}`, pair]));
  for (const key of keys) {
    const custom = getCustomSprite(key, slot);
    if (custom) return custom;
  }
  return undefined;
}

/**
 * Fusion sprite URL with onerror fallback chain:
 *   custom (localStorage) → fusion-sprites/ → ai-sprites/ → variants → placeholder
 *
 * The RPi backend URL is used as base when available; otherwise default to
 * relative paths (for GitHub-Pages deployment).
 */
export function fusionSpriteUrl(headNum: number, bodyNum: number, options?: { base?: string }): string {
  const custom = getCustomFusionSprite(headNum, bodyNum, 'front');
  if (custom) return custom;
  // Try backend API bases first, then fall back to relative path
  const apiBases = getFusionApiBases();
  if (apiBases.length) return `${apiBases[0]}/fusion/sprites/${headNum}.${bodyNum}v1.png`;
  const base = options?.base ?? '';
  return `${base}/fusion-sprites/${headNum}.${bodyNum}.png`;
}

export function fusionSpriteUrlWithFallback(
  headNum: number,
  bodyNum: number,
  onError: (nextUrl: string) => void,
  options?: { base?: string },
) {
  const base = options?.base ?? '';
  const alphaVariantFilenames = Array.from({ length: 8 }, (_, i) => `${headNum}.${bodyNum}${String.fromCharCode(97 + i)}.png`);
  const variantFilenames = [
    `${headNum}.${bodyNum}v1.png`,
    `${headNum}.${bodyNum}v2.png`,
    `${headNum}.${bodyNum}v3.png`,
    `${headNum}.${bodyNum}.png`,
    ...alphaVariantFilenames,
  ];
  const candidates: string[] = [];
  const custom = getCustomFusionSprite(headNum, bodyNum, 'front');
  if (custom) candidates.push(custom);

  const apiBases = getFusionApiBases();
  for (const apiBase of apiBases) {
    for (const filename of variantFilenames) {
      candidates.push(`${apiBase}/fusion/sprites/${filename}`);
    }
  }

  // Local fallback paths
  for (const filename of variantFilenames) {
    candidates.push(`${base}/fusion-sprites/${filename}`);
  }

  const headName = gNumToName[headNum] || String(headNum);
  const bodyName = gNumToName[bodyNum] || String(bodyNum);
  const phLabel = `${headName.slice(0, 4)}/${bodyName.slice(0, 4)}`.toUpperCase();
  const placeholder = placeholderSpriteDataURL(phLabel);

  let idx = 0;
  return {
    src: candidates[0] || placeholder,
    handleError: () => { idx++; onError(candidates[idx] || placeholder); },
    candidates,
    placeholder,
  };
}

const DEFAULT_FUSION_API_BASE = 'https://pokettrpg.duckdns.org';
const EXTERNAL_HTTP_FUSION_API = 'http://pokettrpg.duckdns.org:3000';
const LOCAL_FUSION_API_BASES = ['http://127.0.0.1:3000', 'http://localhost:3000'];
const gFusionEnsurePromises = new Map<string, Promise<string | null>>();

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function normalizeBase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

export function getFusionApiBases(): string[] {
  const explicit = normalizeBase(safeGetLocalStorage('ttrpg.fusionApiBase'));
  const apiBase = normalizeBase(safeGetLocalStorage('ttrpg.apiBase'));
  const ordered = [
    explicit,
    ...LOCAL_FUSION_API_BASES,
    apiBase,
    DEFAULT_FUSION_API_BASE,
    EXTERNAL_HTTP_FUSION_API,
  ].filter((x): x is string => !!x);
  const unique = Array.from(new Set(ordered));
  if (!isStrictHttpsContext()) return unique;
  return unique.filter(base => !/^http:\/\//i.test(base));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

/** Cached result of the /fusion/gen-available check. null = not yet checked. */
let gFusionGenAvailable: boolean | null = null;
let gFusionGenAvailableTs = 0;

async function isFusionGenAvailable(): Promise<boolean> {
  // Re-check every 30 seconds if previously unavailable, cache indefinitely if true
  if (gFusionGenAvailable === true) return true;
  if (gFusionGenAvailable === false && Date.now() - gFusionGenAvailableTs < 30_000) return false;
  for (const base of getFusionApiBases()) {
    try {
      const res = await fetchWithTimeout(`${base}/fusion/gen-available`, {}, 3000);
      if (res.ok) {
        const data = await res.json() as { available?: boolean };
        gFusionGenAvailable = !!data?.available;
        gFusionGenAvailableTs = Date.now();
        return gFusionGenAvailable;
      }
    } catch {}
  }
  gFusionGenAvailable = false;
  gFusionGenAvailableTs = Date.now();
  return false;
}

async function waitForFusionWarmup(
  base: string,
  maxMs = 120000,
  onStatus?: (status: 'warming' | 'ready' | 'unavailable') => void,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetchWithTimeout(`${base}/fusion/gen-available`, {}, 4000);
      if (res.ok) {
        const data = await res.json() as {
          available?: boolean;
          warmedUp?: boolean;
          warming?: boolean;
          warmup?: { ready?: boolean; inProgress?: boolean };
        };
        const ready = !!data?.warmedUp || !!data?.warmup?.ready;
        const warming = !!data?.warming || !!data?.warmup?.inProgress;
        if (ready) { onStatus?.('ready'); return; }
        if (!warming) { onStatus?.('ready'); return; }
        onStatus?.('warming');
      } else {
        onStatus?.('unavailable');
      }
    } catch {
      onStatus?.('unavailable');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function requestFusionGenerateOnce(
  headNum: number,
  bodyNum: number,
  options?: { guidancePrompt?: string; onStatus?: (msg: string) => void; regenerate?: boolean },
): Promise<{ base: string; jobId?: string } | null> {
  // Warm capability cache, but do not hard-gate generation on this endpoint.
  // Some proxies/workers can return false here while generation still works.
  void isFusionGenAvailable();

  const guidancePrompt = options?.guidancePrompt?.trim();
  const basePayload: Record<string, unknown> = {
    headNum,
    bodyNum,
  };
  if (guidancePrompt) {
    basePayload.guidancePrompt = guidancePrompt;
    basePayload.prompt = guidancePrompt;
  }
  if (options?.regenerate) {
    basePayload.regenerate = true;
  }

  const onStatus = options?.onStatus;
  const configuredMode = normalizeName(String(safeGetLocalStorage('ttrpg.fusionGenMode') || ''));
  const modeCandidates = Array.from(new Set(
    [configuredMode, 'spliceai', 'ai', 'splice']
      .filter(Boolean)
      .map((m) => (m === 'spliceai' ? 'splice+ai' : m))
  ));
  const endpointCandidates = ['/fusion/generate', '/fusion/generate-base'];

  for (const base of getFusionApiBases()) {
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
    const timeout = isLocal ? 12_000 : 25_000;
    // If backend is actively warming diffusers, wait briefly before posting a job.
    // This avoids jobs being queued while the first model load is still in progress.
    await waitForFusionWarmup(base, isLocal ? 120_000 : 180_000, (ws) => {
      if (ws === 'warming') onStatus?.('Warming up AI model… this may take a minute.');
      else if (ws === 'ready') onStatus?.('Model ready, submitting generation request…');
    });
    for (const endpoint of endpointCandidates) {
      for (const mode of modeCandidates) {
        const payload = { ...basePayload, mode };
        try {
          const res = await fetchWithTimeout(`${base}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }, timeout);
          if (res.ok) {
            const data = await res.json().catch(() => ({} as { jobId?: unknown }));
            return { base, jobId: typeof data?.jobId === 'string' ? data.jobId : undefined };
          }
        } catch {}
      }
      // Last attempt: let backend choose its default mode.
      try {
        const res = await fetchWithTimeout(`${base}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(basePayload),
        }, timeout);
        if (res.ok) {
          const data = await res.json().catch(() => ({} as { jobId?: unknown }));
          return { base, jobId: typeof data?.jobId === 'string' ? data.jobId : undefined };
        }
      } catch {}
    }
  }
  return null;
}

async function waitForFusionReady(headNum: number, bodyNum: number, base: string, _jobId?: string, maxMs = 720000): Promise<string | null> {
  const started = Date.now();
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
  const checkTimeout = isLocal ? 4_000 : 8_000;
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetchWithTimeout(`${base}/fusion/gen-check/${headNum}/${bodyNum}`, {}, checkTimeout);
      if (res.ok) {
        const data = await res.json() as { exists?: boolean };
        if (data?.exists) {
          const variants = await fetchFusionVariants(headNum, bodyNum).catch(() => [] as string[]);
          const preferred = variants[0];
          if (preferred) {
            if (/^https?:\/\//i.test(preferred)) return `${preferred}${preferred.includes('?') ? '&' : '?'}t=${Date.now()}`;
            if (/^data:image\//i.test(preferred)) return preferred;
            return `${base}/fusion/sprites/${preferred}?t=${Date.now()}`;
          }
          return `${base}/fusion/sprites/${headNum}.${bodyNum}v1.png?t=${Date.now()}`;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

export function ensureFusionSpriteOnDemand(
  headNum: number,
  bodyNum: number,
  options?: { guidancePrompt?: string; onStatus?: (msg: string) => void; regenerate?: boolean },
): Promise<string | null> {
  const promptKey = options?.guidancePrompt?.trim() || '';
  const regenFlag = options?.regenerate ? ':regen' : '';
  const key = `${headNum}.${bodyNum}:${promptKey}${regenFlag}`;
  const existing = gFusionEnsurePromises.get(key);
  if (existing) return existing;

  const task = (async () => {
    const started = await requestFusionGenerateOnce(headNum, bodyNum, {
      guidancePrompt: options?.guidancePrompt,
      onStatus: options?.onStatus,
      regenerate: options?.regenerate,
    });
    if (!started) return null;
    options?.onStatus?.('Generating sprite\u2026');
    return waitForFusionReady(headNum, bodyNum, started.base, started.jobId);
  })().finally(() => {
    gFusionEnsurePromises.delete(key);
  });

  gFusionEnsurePromises.set(key, task);
  return task;
}

export async function fetchFusionVariants(headNum: number, bodyNum: number): Promise<string[]> {
  const stem = `${headNum}.${bodyNum}`;
  const fallback = [
    `${stem}v1.png`,
    `${stem}v2.png`,
    `${stem}v3.png`,
    `${stem}.png`,
    ...Array.from({ length: 8 }, (_, i) => `${stem}${String.fromCharCode(97 + i)}.png`),
  ];
  const normalizeVariant = (raw: unknown): string | null => {
    const value = String(raw || '').trim();
    if (!value) return null;
    if (/^data:image\//i.test(value)) return value;

    let file = value;
    if (/^https?:\/\//i.test(file)) {
      try {
        const parsed = new URL(file);
        file = parsed.pathname.split('/').pop() || '';
      } catch {
        return null;
      }
    } else {
      file = file.split(/[?#]/)[0].split('/').pop() || file;
    }
    if (!file) return null;
    if (!/\.(png|gif|webp)$/i.test(file)) return null;
    if (!file.toLowerCase().startsWith(stem.toLowerCase())) return null;
    return file;
  };

  const variantRank = (file: string): number => {
    const lower = file.toLowerCase();
    const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (lower === `${stem}v1.png`) return 0;
    if (lower === `${stem}v2.png`) return 1;
    if (lower === `${stem}v3.png`) return 2;
    if (lower === `${stem}.png`) return 3;
    if (new RegExp(`^${escapedStem}[a-z]\\.png$`, 'i').test(lower)) return 4;
    if (/(custom|battler|trainer)/i.test(lower)) return 5;
    return 6;
  };
  for (const base of getFusionApiBases().slice(0, 3)) {
    try {
      const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
      const timeout = isLocal ? 1200 : 2200;
      const res = await fetchWithTimeout(`${base}/fusion/variants/${headNum}/${bodyNum}`, {}, timeout);
      if (!res.ok) continue;
      const data = await res.json() as { variants?: unknown };
      const variantsRaw = Array.isArray(data?.variants)
        ? data.variants.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      const variants = variantsRaw
        .map(normalizeVariant)
        .filter((v): v is string => !!v);
      if (variants.length) {
        return Array.from(new Set(variants)).sort((a, b) => {
          const rankDiff = variantRank(a) - variantRank(b);
          if (rankDiff !== 0) return rankDiff;
          return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
      }
    } catch {}
  }
  return fallback;
}

/** Save a custom fusion sprite (data URL) to localStorage */
export function saveCustomFusionSprite(headNum: number, bodyNum: number, dataUrl: string) {
  const pair = `${Math.trunc(headNum)}.${Math.trunc(bodyNum)}`;
  const keys = Array.from(new Set([`fusion:${pair}`, `fusion-${pair}`, pair]));
  for (const key of keys) saveCustomSprite(key, 'front', dataUrl);
}

export const adapter = {
  spriteUrl,
  spriteUrlWithFallback,
  iconUrl,
  iconUrlWithFallback,
  normalizeName,
  loadShowdownDex,
  getCustomDex,
  getCustomMoves,
  getCustomAbilities,
  getCustomItems,
  getCustomSprite,
  saveCustomMove,
  saveCustomAbility,
  saveCustomSprite,
  saveCustomItem,
  placeholderSpriteDataURL,
  buildDexNumMaps,
  dexNumToName,
  nameToDexNum,
  fusionSpriteUrl,
  fusionSpriteUrlWithFallback,
  fetchFusionVariants,
  saveCustomFusionSprite,
  cacheSpriteSelectionLocally,
  ensureFusionSpriteOnDemand,
  listPokemonSpriteOptions,
};
