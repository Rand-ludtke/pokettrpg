/**
 * pokeathlon-dex-loader.ts
 *
 * Dynamically loads ALL Pokémon data from pokeathlon CDN's pokedex.js at runtime.
 * Provides utilities for parsing, filtering soulstone/pokemon types, and registering sprite sources.
 */

const SOULSTONE_TYPES = ['Crystal','Cosmic','Nuclear','Stellar','Light','Sound'];

/** Entry type matching pokeathlon's BattlePokedex shape */
export interface PokeathlonsoulEntry {
  name: string;
  num?: number;
  types: string[];
  baseStats: Record<string, number>;
  abilities?: Record<string, string|[]>;
  isNonstandard?: string|null;
  tier?: string;
  evoLevel?: number;
  heightm?: number;
  weightkg?: number;
}

/** Raw pokeathlon pokedex.js content shape */
export interface PokeathlonRawEntry {
  name: string;
  num?: number;
  types: string[];
  baseStats: Record<string, number>;
  evoType?: string;
  evoItem?: string;
  evoMove?: string;
  evoLevel?: number;
  prevo?: string;
  evos?: string[];
  otherFormes?: string[];
  formeOrder?: string[];
  baseSpecies?: string;
  forme?: string;
  tier?: string;
  isNonstandard?: string|null;
  natDexTier?: string;
  doublesTier?: string;
  tags?: string[];
  eggGroups?: string[];
  genderRatio?: {M:number;F:number};
}

/** Normalised DexSpecies-ready output */
export interface PokeathlonResult {
  dex: Record<string, any>;
  soulstoneEntries: ReadonlyArray<{id: string; types: string[]}>;
  capKeys: ReadonlyArray<string>;
  regionalKeys: ReadonlyArray<string>;
}

const POKEATHLON_URL = 'https://play.pokeathlon.com/data/pokedex.js';

/** Fetch and parse the pokeathlon pokedex.js, returning categorized data */
export function parsePokeathlonDex(url?: string): Promise<PokeathlonResult> {
  const targetUrl = url || POKEATHLON_URL;
  return fetch(targetUrl).then(r => r.text()).then(text => {
    const match = text.match(/exports\.BattlePokedex\s*=\s*(\{[\s\S]*?\})\s*[;,]/);
    if (!match) throw new Error('pokeathlon pokedex.js: unexpected format (no exports.BattlePokedex found)');

    // biome-ignore lint/security/noGlobalEval: untrusted data source but controlled CDN payload
    const raw = eval('(' + match[1] + ')') as Record<string, PokeathomEntry>;
    if (typeof raw !== 'object' || raw === null) throw new Error('pokeathlon dex: not an object');

    const result: PokeathlonResult = {
      dex: {},
      soulstoneEntries: [],
      capKeys: [],
      regionalKeys: [],
    };

    for (const [key, entry] of Object.entries(raw)) {
      if (!entry || typeof entry.name !== 'string') continue;
      const id = key.replace(/[^a-z0-9]/gi, '').toLowerCase();

      // Check soulstone types
      if (hasSoulstoneType(entry.types)) {
        result.soulstoneEntries.push({id, types: entry.types});
      }

      if (entry.isNonstandard === 'Custom' && !result.capKeys.includes(id)) {
        result.capKeys.push(id);
      }

      result.dex[id] = normaliseEntry(entry, id);
    }

    return result;
  });
}

function hasSoulstoneType(types: string[]): boolean {
  return types.some(t => SOULSTONE_TYPES.includes(t));
}

function normaliseEntry(raw: PokeathlonsoulEntry, id: string): any {
  const b = raw.baseStats || {};
  const ab = (raw.abilities ?? {});
  const af: Record<string,string> = {};
  for (const [k,v] of Object.entries(ab)) {
    af[k] = typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : '';
  }

  return {
    name: raw.name,
    num: raw.num || undefined,
    types: [...raw.types],
    baseStats: { hp:b.hp||0, atk:b.atk||0, def:b.def||0, spa:b.spa||0, spd:b.spd||0, spe:b.spe||0 },
    abilities: Object.keys(af).length ? af : undefined,
    tier: raw.tier || undefined,
    isNonstandard: raw.isNonstandard || 'Custom',
    evoLevel: Number.isFinite(Number(raw.evoLevel)) ? raw.evoLevel : undefined,
    heightm: Number.isFinite(Number(raw.heightm)) ? raw.heightm : undefined,
    weightkg: Number.isFinite(Number(raw.weightkg)) ? raw.weightkg : undefined,
  };
}
