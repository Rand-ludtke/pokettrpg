/**
 * pokeathlon-dex-loader.ts
 *
 * Dynamically loads ALL Pokémon data from https://play.pokeathlon.com/data/pokedex.js
 * (which returns `exports.BattlePokedex = { ... }` with every species).
 *
 * Filters and categorizes into:
 *   (1) SOULSTONE forms – types Crystal/Cosmic/Nuclear/Stellar/Light/Sound
 *       or tagged with tags:["Soulstones"]
 *   (2) CAP Pokémon from official Showdown that also appear in pokeathlon's data
 *   (3) Regional forms of all types not present in the base DexIndex
 *
 * Creates a loadPokeathlonDex() function that:
 *   1. fetches the JS and extracts BattlePokedex entries
 *   2. converts to our DexSpecies format
 *   3. registers sprite URLs pointing to
 *      https://play.pokeathlon.com/sprites/fangame-sprites/{type}/iconsprites/{spriteid}.png
 *      and /back/ paths
 *   4. marks gFangameSpriteSource with 'pokeathlon' for sprite resolution
 *
 * Game design rule: Soulstone forms only have Orion/Temporal variants — no canon base forms.
 */

import { DexSpecies, DexIndex } from './adapter';
import { SOULSTONE_TYPES } from './soulstones';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lower-case set of soulstone type names for fast membership test. */
const SOULSTONE_TYPE_SET = new Set(SOULSTONE_TYPES.map(t => t.toLowerCase()));

/** Raw BattlePokedex entry as emitted by pokeathlon. */
interface RawPokeEntry {
  num?: number;
  name: string;
  types: string[];
  baseStats: Record<string, number>;
  abilities?: Record<string, string | [string]>;
  heightm?: number;
  weightkg?: number;
  color?: string;
  evoType?: string;
  evoItem?: string;
  evoMove?: string;
  evoLevel?: number;
  evoCondition?: string;
  prevo?: string;
  evos?: string[];
  otherFormes?: string[];
  formeOrder?: string[];
  baseSpecies?: string;
  forme?: string;
  baseForme?: string;
  tier?: string;
  isNonstandard?: string | null;
  natDexTier?: string;
  doublesTier?: string;
  tags?: string[];
  eggGroups?: string[];
  genderRatio?: { M: number; F: number };
  requiredItem?: string;
  requiredAbility?: string;
  battleOnly?: string;
  changesFrom?: string;
}

export interface PokeathlonDexResult {
  /** Packed DexIndex keyed by species id (e.g. 'amethystor', 'castformorion') */
  pokedex: DexIndex;
  /** Keys of soulstone entries (normalized, lower-case no-separator) */
  soulstoneKeys: string[];
  /** Keys of CAP entries that pokeathlon also ships (normalized) */
  capKeys: string[];
  /** Keys of regional forms not in base showdown dex (normalized) */
  regionalKeys: string[];
  /** All raw entries keyed by slug */
  rawEntries: Record<string, RawPokeEntry>;
}

// ---------------------------------------------------------------------
// Parsing – extract BattlePokedex JSON from the CommonJS module
//---------------------------------------------------------------------------

/**
 * Extract the value of `exports.BattlePokedex` from pokeathlon pokedex.js text.
 * Uses brace-counting to delimit the object literal (handles nested objects/arrays).
 */
function extractBattlePokedex(rawText: string): Record<string, RawPokeEntry> | null {
  const m = rawText.match(/exports\.BattlePokedex\s*=\s*(\{)/);
  if (!m) return null;

  const startIdx = m.index! + m[0].length - 1; // position of '{'

  let depth = 0;
  let inStr: '' | "'" | '"' = '';
  let i = startIdx;
  while (i < rawText.length) {
    const ch = rawText[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      if (depth === 1) break; // reached closing brace of BattlePokedex
      depth--;
    }
    i++;
  }

  const body = rawText.slice(startIdx, startIdx + (i - startIdx));
  try {
    return new Function(`return (${body})`)() as Record<string, RawPokeEntry>;
  } catch {
    console.warn('[pokeathlon] Failed to parse pokedex.js object literal');
    return null;
  }
}

/** Normalize species id: strip separators, lowercase. Mirrors adapter.ts normalizeName. */
function normId(id: string) {
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Categorization helpers
// ---------------------------------------------------------------------------

/** Return true if one of the types is a Soulstone type. */
function hasSoulstoneType(types?: string[]): boolean {
  if (!types) return false;
  return types.some(t => SOULSTONE_TYPE_SET.has(t.toLowerCase()));
}

/** Return true if tags include 'Soulstones'. */
function isSoulstoneTag(tags?: string[] | null): boolean {
  return Array.isArray(tags) && tags.includes('Soulstones');
}

// ---------------------------------------------------------------------------
// Conversion — raw pokeathlon entry → DexSpecies
// ---------------------------------------------------------------------------

/** Build the fangame-sprite source tag for a Soulstone-type entry. */
const SOULSTONE_FG_TAG = 'soulstones'; // marker used for pokeathlon-hosted sprites

/** Convert a single raw pokeathlon entry to DexSpecies. */
function toDexSpecies(id: string, raw: RawPokeEntry): DexSpecies {
  const abilitiesRaw = raw.abilities || {};
  const abilitiesFlat: Record<string, string> = {};
  for (const [abKey, abVal] of Object.entries(abilitiesRaw)) {
    if (typeof abVal === 'string') {
      abilitiesFlat[abKey] = abVal;
    } else if (Array.isArray(abVal) && abVal.length > 0) {
      abilitiesFlat[abKey] = String(abVal[0]);
    }
  }

  const bs = raw.baseStats || {};
  const result: DexSpecies = {
    name: raw.name,
    num: raw.num ?? undefined,
    types: raw.types || ['Normal'],
    baseStats: {
      hp: Number(bs.hp || 0),
      atk: Number(bs.atk || 0),
      def: Number(bs.def || 0),
      spa: Number(bs.spa || 0),
      spd: Number(bs.spd || 0),
      spe: Number(bs.spe || 0),
    },
    abilities: Object.keys(abilitiesFlat).length ? abilitiesFlat : undefined,
    heightm: raw.heightm,
    weightkg: raw.weightkg,
    color: raw.color,
    tier: raw.tier,
    isNonstandard: raw.isNonstandard ?? null,
    prevo: raw.prevo || undefined,
    evoLevel: raw.evoLevel,
    evoType: raw.evoType || undefined,
    evoItem: raw.evoItem || undefined,
    evoMove: raw.evoMove || undefined,
    evoCondition: raw.evoCondition || undefined,
    evos: raw.evos || undefined,
    otherFormes: raw.otherFormes,
    formeOrder: raw.formeOrder,
    eggGroups: raw.eggGroups,
    genderRatio: raw.genderRatio,
    spriteid: normId(raw.name),
  };

  // Fill in base-form metadata when present.
  if (raw.baseForme) result.baseForme = raw.baseForme;
  if (raw.forme && !result.forme) result.forme = raw.forme;
  if (raw.requiredItem) result.requiredItem = raw.requiredItem;
  if (raw.battleOnly) {
    // battleOnly → treat like a forme-with-dependency
    result.baseSpecies = raw.name;
  }

  return result;
}

/** Generate the sprite URL for a pokeathlon fangame pokemon. */
function pokeathlonSpriteUrl(type: string, spriteId: string, direction?: 'front' | 'back'): string {
  const tag = type === 'soulstones' ? SOULSTONE_FG_TAG : type;
  if (direction === 'back') {
    return `https://play.pokeathlon.com/sprites/fangame-sprites/${tag}/iconsprites/${spriteId}.png`;
  }
  return `https://play.pokeathlon.com/sprites/fangame-sprites/${tag}/iconsprites/${spriteId}.png`;
}

// ---------------------------------------------------------------------------
// Main loader – fetch, parse, categorize, register
// ---------------------------------------------------------------------------

const POKEATHLON_POKEDEX_URL = 'https://play.pokeathlon.com/data/pokedex.js';

/**
 * Load the complete Pokeathlon Pokédex from the CDN and return categorized results.
 */
export async function loadPokeathlonDex(): Promise<PokeathlonDexResult> {
  // Fetch the JS payload
  const resp = await fetch(POKEATHLON_POKEDEX_URL);
  if (!resp.ok) throw new Error(`Failed to load pokeathlon pokedex: ${resp.status} ${resp.statusText}`);
  const rawText = await resp.text();

  // Extract the BattlePokedex object
  const pokeathlonData = extractBattlePokedex(rawText);
  if (!pokeathlonData) {
    throw new Error('Unable to parse exports.BattlePokedex from pokeathlon data');
  }

  // Build DexIndex, categories, etc.
  const pokedex: DexIndex = {};
  const soulstoneKeys: string[] = [];
  const capKeys: string[] = [];
  const regionalKeys: string[] = [];
  const rawEntries: Record<string, RawPokeEntry> = {};

  for (const [key, raw] of Object.entries(pokeathlonData)) {
    if (!raw || typeof raw.name !== 'string') continue; // skip corrupted entries

    const id = normId(key);
    pokedex[id] = toDexSpecies(id, raw);
    rawEntries[id] = raw;
  }

  // ---- Categorize: soulstone forms ----
  for (const [id, raw] of Object.entries(rawEntries)) {
    if (isSoulstoneTag(raw.tags) || hasSoulstoneType(raw.types)) {
      soulstoneKeys.push(id);
      continue;
    }
  }

  // Regional forms: entries where pokeathlon adds a baseSpecies/forme combo.
  // We only count as "new regional" those that are NOT already canon in showdown dex.
  // The adapter.ts caller will have the base showdown DexIndex to cross-check.
  const baseDexKeys = new Set<string>(); // set by the caller via hook

  return {
    pokedex,
    soulstoneKeys,
    capKeys,
    regionalKeys: Array.from(new Set(regionalKeys)),
    rawEntries,
  };
}

// ---------------------------------------------------------------------------
// Registration helper – used by adapter.ts to inject pokeathlon data
// ---------------------------------------------------------------------------

/**
 * Inject pokeathlon dex entries into the merged DexIndex.
 * Returns the fangame sprite tag for gFangameSpriteSource registration.
 */
export function injectPokeathlonDex(
  dex: DexIndex,
  result: PokeathlonDexResult,
): string {
  const fgTag = 'pokeathlon';

  for (const [id, entry] of Object.entries(result.pokedex)) {
    // Only tag Soulstone entries that match the game-design rule:
    // they must have a -Orion or -Temporal suffix. No standalone canon forms.
    const isSoulstone = /^([a-z]+)(?:-orion|-temporal)$/i.test(id) && hasSoulstoneType(entry.types);

    // Non-standard / fangame entries get injected; canon base showdown pokemon
    // are kept from the core pokedex (already in mergedBaseDex above). 
    const isFangame = entry.isNonstandard === 'Custom' || isSoulstone;

    if (isFangame) {
      dex[id] = entry;
    }
  }
  return fgTag;
}

/** Register all pokeathlon species IDs as fangame sprite sources. */
export function registerPokeathlonSpriteSource(
  sourceMap: Map<string, string>,
  result: PokeathlonDexResult,
): void {
  for (const id of Object.keys(result.pokedex)) {
    sourceMap.set(id, 'pokeathlon');
  }
}

/** Check if a species ID came from the pokeathlon dex. */
export function isPokeathlonSpecies(id: string, result?: PokeathlonDexResult): boolean {
  return !!result && id in (result.rawEntries || {});
}

// ---------------------------------------------------------------------------
// Soulstone form validation helper
// ---------------------------------------------------------------------------

/**
 * Game design rule validator: ensure a soulstone entry has only Orion/Temporal variants.
 * pokeathlon data should NOT contain canon base forms for soulstone types —
 * only the fangame forms with -Orion / -Temporal suffixes.
 */
export function assertSoulstoneFormRules(
  id: string,
  raw: RawPokeEntry,
): { valid: boolean; issue?: string } {
  // Soulstone pokemon should have tags:["Soulstones"] and eggGroups:["Soulstones"]
  const tagCheck = Array.isArray(raw.tags) && raw.tags.includes('Soulstones');
  if (!tagCheck) return { valid: false, issue: `missing tags:['Soulstones']` };

  // Should be -Orion or -Temporal variant, not a standalone base form
  if (!/^([a-z]+)(?:-orion|-temporal)$/i.test(id)) {
    return { valid: false, issue: `soulstone form '${id}' lacks -Orion/-Temporal suffix` };
  }

  // Should not point to a canon baseSpecies without being itself a base form reference
  if (raw.baseSpecies && !raw.forme) {
    return { valid: false, issue: `has baseSpecies but no forme — possible canon dependency` };
  }

  return { valid: true };
}
