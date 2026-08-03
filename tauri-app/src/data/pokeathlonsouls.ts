//pokeathlonsouls.ts — loadSoulstones() fetches the Pokeathlon pokedex.js at boot, categorises species by soulstone / custom flags, normalises into DexShape.
import { SOULSTONE_TYPE_NAMES } from './soulstones';

const SOULSTONE_TYPES: Set<string> = new Set(SOULSTONE_TYPE_NAMES);
const STANDARD_TYPES = new Set([
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
  'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark',
  'Steel','Fairy',
]);

function hasSoulstoneType(types: string[]): boolean {
  return types.some(t => SOULSTONE_TYPES.has(t));
}

function isCustomSpecies(num: number, primaryType:string): boolean {
  return Number.isFinite(num) && num >= 2500 && !STANDARD_TYPES.has(primaryType);
}

export interface PokedexRawEntry {
  name: string;
  baseSpecies?: string;
  types: string[];
  baseStats: Record<string, number>;
  abilities?: Record<string, string|[]>;
  num?: number;
  heightm?: number;
  weightkg?: number;
  color?: string;
  tier?: string;
  isNonstandard?: string|null;
  evoLevel?: number;
  evoItem?: string;
  evoMove?: string;
  prevo?: string;
  evos?: string[];
  otherFormes?: string[];
  formeOrder?: string[];
  eggGroups?: string[];
  forme?: string;
  genderRatio?: {M:number;F:number};
}

const POKEATHLON_URL = 'https://play.pokeathlon.com/data/pokedex.js';

export async function loadSoulstones(): Promise<Record<string, any>> {
  const resp = await fetch(POKEATHLON_URL);
  if (!resp.ok) throw new Error(`Pokéathlon dex: ${resp.status} ${resp.statusText}`);
  const text = await resp.text();
  const match = text.match(/exports\.BattlePokedex\s*=\s*(\{[\s\S]*?\})\s*[;,]/);
  if (!match) throw new Error('pokeathlon pokedex.js: no exports.BattlePokedex found');
  // biome-ignore lint/security/noGlobalEval: pokeathlon payload — never attacker-controlled.
  const data = eval('(' + match[1] + ')') as Record<string, PokedexRawEntry>;
  if (typeof data !== 'object' || data === null) throw new Error('pokeathlon dex: not an object');

  const out: Record<string, any> = {};
  const seen = new Set<string>();

  for (const [key, entry] of Object.entries(data).sort((a,b)=>(a[1].num||0)-(b[1].num||0))) {
    if (!entry || !Array.isArray(entry.types)) continue;
    if (!hasSoulstoneType(entry.types) && !isCustomSpecies(entry.num ?? 0, entry.types[0])) continue;
    const canon = String(entry.baseSpecies || entry.name || key).toLowerCase().replace(/[^a-z0-9]/g,'');
    if (seen.has(canon)) continue;
    seen.add(canon);
    out[normalise(key)] = normaliseEntry(entry, canon);
  }
  return out;
}

function normalise(id: string): string {
  return id.replace(/[^a-z0-9]/gi,'').toLowerCase();
}

function normaliseEntry(raw: PokedexRawEntry, dexKey: string): any {
  const b = raw.baseStats || {};
  const ab = (raw.abilities ?? {});
  const af: Record<string,string> = {};
  for (const [k,v] of Object.entries(ab)) {
    af[k] = typeof v === 'string' ? v : Array.isArray(v) && (v as unknown[]).length > 0 ? String((v as unknown[])[0]) : '';
  }

  return {
    name: raw.name, baseSpecies: raw.baseSpecies || raw.name,
    types: [...raw.types],
    baseStats: { hp:b.hp||0, atk:b.atk||0, def:b.def||0, spa:b.spa||0, spd:b.spd||0, spe:b.spe||0 },
    abilities: Object.keys(af).length ? af : undefined,
    num: raw.num || undefined,
    forme: raw.forme || (dexKey !== normalise(String(raw.baseSpecies||raw.name)) ? normalise(dexKey) : undefined),
    evoLevel: Number.isFinite(Number(raw.evoLevel)) ? raw.evoLevel : undefined,
    evoItem: raw.evoItem ? String(raw.evoItem) : undefined,
    prevo: raw.prevo ? String(raw.prevo) : undefined,
    evos: Array.isArray(raw.evos) ? [...raw.evos] : undefined,
    heightm: Number.isFinite(Number(raw.heightm)) ? raw.heightm : undefined,
    weightkg: Number.isFinite(Number(raw.weightkg)) ? raw.weightkg : undefined,
    color: raw.color ? String(raw.color) : undefined,
    tier: raw.tier || 'Custom',
    isNonstandard: raw.isNonstandard || (hasSoulstoneType(raw.types)?'Custom':null),
    _pokeathlonSource: 'pokedex.js',
  };
}
