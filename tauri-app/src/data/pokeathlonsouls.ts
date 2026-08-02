/**
 * loadSoulstones — fetch Pokeathlon's pokedex.js at runtime, extract all
 * species that carry Soulstone types (Crystal / Cosmic / Nuclear / Stellar / Light / Sound)
 * plus custom Pokeathlon-only species, and normalise them into DexSpecies
 * format for the PokédexTab / battle system.
 */

import type { DexSpecies } from './adapter';

const SOULSTONE_TYPES = ['Crystal', 'Cosmic', 'Nuclear', 'Stellar', 'Light', 'Sound'] as const;
const STANDARD_TYPES = new Set([
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
  'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark',
  'Steel','Fairy',
]);

// Whether a types array contains at least one soulstone type.
function hasSoulstoneType(types: string[]): boolean {
  return types.some(t => SOULSTONE_TYPES.includes(t as typeof SOULSTONE_TYPES[number]));
}

// Whether a species is *custom-only* (high dex + non-standard primary type).
function isCustomSpecies(e: unknown): e is Record<string, unknown> {
  if (!e || typeof e !== 'object') return false;
  const obj = e as Record<string, unknown>;
  const num = Number(obj.num);
  // Species with num >= 2500 that don't have a standard primary type are custom/brand-new.
  return Number.isFinite(num) && num >= 2500 && !STANDARD_TYPES.has(String(obj.types?.[0] || ''));
}

type PokedexEntry = Record<string, unknown> & {
  name: string;
  baseSpecies: string;
  types: string[];
  baseStats: Record<string, number>;
  abilities?: Record<string, string>;
  num?: number;
  heightm?: number;
  weightkg?: number;
  color?: string;
  tier?: string;
  isNonstandard?: string | null;
  gen?: number;
  evos?: string[];
  prevo?: string;
  evoLevel?: number;
  evoType?: string;
  evoItem?: string;
  eggGroups?: string[];
  genderRatio?: { M: number; F: number };
};

const SOULSTONE_DEX_URL = 'https://play.pokeathlon.com/data/pokedex.js';

/**
 * Fetch pokeathlon pokedex.js (a UMD/module script exporting BattlePokedex),
 * extract soulstone + custom entries, and return them in DexSpecies format.
 */
export async function loadSoulstones(): Promise<DexIndex> {
  const response = await fetch(SOULSTONE_DEX_URL);
  if (!response.ok) { throw new Error(`Failed to load Soulstone dex: ${response.status} ${response.statusText}`); }
  const text = await response.text();

  // BattlePokedex is the global exported name inside pokeathlon's module.
  // Pattern: exports.BattlePokedex = {bulbasaur:{...}, ...};
  const match = text.match(/exports\s*\.\s*BattlePokedex\s*=\s*(\{[\s\S]*?\})\s*[;,]/);
  if (!match) { throw new Error('pokeathlon pokedex.js: unexpected format (no exports.BattlePokedex found)'); }

  // Evaluate the raw JS object literal to get the actual data.
  const pokeathlonDex = eval('(' + match[1] + ')');
  if (typeof pokeathlonDex !== 'object' || pokeathlonDex === null) { throw new Error('pokeathlon pokedex.js: exports.BattlePokedex is not an object'); }

  const output: DexIndex = {};
  // Track unique species by lowercase normalised name to avoid duplicating forme variants.
  // For forms, keep the first (base) entry and also separate forme entries if they have distinct names/dex numbers.
  const seenNames = new Set<string>();

  for (const key of Object.keys(pokeathlonDex).sort((a: string, b: string) => {
    const na = Number((pokeathlonDex as Record<string, PokedexEntry>)[a]?.num);
    const nb = Number((pokeathlonDex as Record<string, PokedexEntry>)[b]?.num);
    return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
  })) {
    const entry = pokeathlonDex[key] as PokedexEntry;
    if (!entry || !Array.isArray(entry.types)) continue;

    // Decide if this entry qualifies:
    //   A) Has at least one Soulstone type, OR
    //   B) Is a custom Pokeathlon-only species (high dex + non-standard primary)
    const isSoulstone = hasSoulstoneType(entry.types);
    const isCustom = isCustomSpecies(entry);
    if (!isSoulstone && !isCustom) continue;

    // Normalise keys for uniqueness: prefer baseSpecies if present, else name.
    const canonicalName = String(entry.baseSpecies || entry.name || key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenNames.has(canonicalName)) {
      // Could be a forme variant — skip the duplicate for now. We'll include forms separately below.
      continue;
    }
    seenNames.add(canonicalName);

    const dexKey = normalizeName(key) || key.toLowerCase();

    output[dexKey] = normalisePokeathlonEntry(entry, dexKey, key);
  }

  // Second pass: add forme variants that weren't caught above.
  for (const key of Object.keys(pokeathlonDek).sort((a: string, b: string) => {
    const na = Number((pokeathlonDek as Record<string, PokedexEntry>)[a]?.num);
    const nb = Number((pokeathlonDek as Record<string, PokedexEntry>)[b]?.num);
    return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
  })) {
    const entry = pokeathlonDek[key] as PokedexEntry;
    if (!entry || !Array.isArray(entry.types)) continue;

    const isSoulstone = hasSoulstoneType(entry.types);
    const isCustom = isCustomSpecies(entry);
    if (!isSoulstone && !isCustom) continue;

    const canonicalName = String(entry.baseSpecies || entry.name || key).toLowerCase().replace(/[^a-z0-9]/g, '');
    // Skip entries whose *unique* name (name field after stripping base species) differs from the first — these are forme variants.
    if (output[canonicalName] && output[canonicalName].nombre !== entry.name) {
      // Forma variant: add with forme key instead.
      const formeKey = normalizeName(key + '-' + String(String(entry.name).replace(/\s+/g, '-')));
      if (!Object.keys(output).includes(formeKey)) {
        output[formeKey] = normalisePokearthEntry(entry, formeKey, key + '-forme');
      }
    }
  }

  return output;
}

function normalizeName(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Convert a pokeathlon pokedex.js entry → DexSpecies-compatible object.
 * The shapes are already very similar; we just rename a few fields and add
 * metadata so the PokédexTab can display them.
*/
function normalisePokearthEntry(
  entry: PokedexEntry,
  dexKey: string,
  rawKey: string,
): DexSpecies {
  const s = entry as any; // Pokeathlon uses the same field names as showdown except some small renames.

  return {
    name: String(s.name || rawKey),
    baseSpecies: String(s.baseSpecies || s.name || rawKey),
    types: Array.isArray(s.types) ? [...s.types] : ['Normal'],
    baseStats: s.baseStats && typeof s.baseStats === 'object'
      ? {
          hp: Number(s.baseStats.hp) || 0,
          atk: Number(s.baseStats.atk) || 0,
          def: Number(s.baseStats.def) || 0,
          spa: Number(s.baseStats.spa) || 0,
          spd: Number(s.baseStats.spd) || 0,
          spe: Number(s.baseStats.spe) || 0,
        }
      : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: s.abilities && typeof s.abilities === 'object' ? s.abilities : undefined,
    num: Number(s.num) || undefined,
    forme: (s.forme || (rawKey !== dexKey ? rawKey.replace(/[^a-z0-9]/gi, '') : undefined)),
    evoLevel: Number.isFinite(Number(s.evoLevel)) ? s.evoLevel : undefined,
    evoType: s.evoType ? String(s.evoType) : undefined,
    evoItem: s.evoItem ? String(s.evoItem) : undefined,
    prevo: s.prevo ? String(s.prevo) : undefined,
    evos: Array.isArray(s.evos) ? [...s.evos] : undefined,
    heightm: Number.isFinite(Number(s.heightm)) ? s.heightm : undefined,
    weightkg: Number.isFinite(Number(s.weightkg)) ? s.weightkg : undefined,
    color: s.color ? String(s.color) : undefined,
    tier: s.tier ? String(s.tier) : 'Custom',
    isNonstandard: s.isNonstandard || (hasSoulstoneType(s.types) ? 'Custom' : null),
    gen: Number.isFinite(Number(s.gen)) ? s.gen : 9,
    genderRatio: s.genderRatio && typeof s.genderRatio === 'object' ? s.genderRatio as { M: number; F: number } : undefined,
    eggGroups: Array.isArray(s.eggGroups) ? [...s.eggGroups] : undefined,
    spriteid: normalizeName(rawKey), // for pokeathlon CDN lookup

    // Pokeathlon source tags (exposed internally).
    _pokeathlonSource: 'pokedex.js',
    _pokeathlonRawKey: rawKey,
    _soulstoneTypes: hasSoulstoneType(s.types) ? s.types.filter(t => SOULSTONE_TYPES.includes(t)) : [],
    _customSpecies: isCustomSpecies(entry),
  };
}

export type DexIndex = Record<string, DexSpecies>;
