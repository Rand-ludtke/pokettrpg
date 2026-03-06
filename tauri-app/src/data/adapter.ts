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

export function normalizeName(id: string) {
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const ENV_ASSET_BASE = (import.meta as any)?.env?.VITE_ASSET_BASE || '';
const DEFAULT_DATA_BASE = ENV_ASSET_BASE ? `${ENV_ASSET_BASE}/vendor/showdown/data` : withPublicBase('vendor/showdown/data').replace(/\/+$/, '');
const DEFAULT_SPRITE_BASE = ENV_ASSET_BASE ? `${ENV_ASSET_BASE}/vendor/showdown/sprites` : withPublicBase('vendor/showdown/sprites').replace(/\/+$/, '');

function normalizeBaseUrl(base: string | null | undefined): string {
  const value = String(base || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

function getSpriteBaseCandidates(preferredBase?: string): string[] {
  const explicit = normalizeBaseUrl(preferredBase);
  const defaults = [
    normalizeBaseUrl(DEFAULT_SPRITE_BASE),
    '/sprites',
    normalizeBaseUrl(withPublicBase('vendor/showdown/sprites')),
  ];

  const fromApiBase = (() => {
    try {
      const apiBase = normalizeBaseUrl(localStorage.getItem('ttrpg.apiBase'));
      if (!apiBase) return [] as string[];
      return [`${apiBase}/sprites`, `${apiBase}/vendor/showdown/sprites`];
    } catch {
      return [] as string[];
    }
  })();

  const fromOrigin = (() => {
    if (typeof window === 'undefined' || !window.location?.origin) return [] as string[];
    const origin = normalizeBaseUrl(window.location.origin);
    return [`${origin}/sprites`, `${origin}/vendor/showdown/sprites`];
  })();

  const all = [explicit, ...defaults, ...fromApiBase, ...fromOrigin]
    .map(normalizeBaseUrl)
    .filter((v): v is string => !!v);
  return Array.from(new Set(all));
}

export async function loadShowdownDex(options?: { base?: string }) {
  const base = options?.base ?? DEFAULT_DATA_BASE;
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
    fetch(`${base}/pokedex.json`).then(r => r.json()),
    fetch(`${base}/moves.json`).then(r => r.json()),
    fetch(`${base}/abilities.json`).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/items.json`).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/learnsets.json`).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/aliases.json`).then(r => r.json()).catch(() => ({})),
  ]);

  const [sagePokedex, sageLearnsets, sageMoves, sageAbilities, sageItems] = await Promise.all([
    fetchOptionalJson(withPublicBase('data/sage/generated/pokedex.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/learnsets.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/moves.custom.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/abilities.custom.sage.json')),
    fetchOptionalJson(withPublicBase('data/sage/generated/items.custom.sage.json')),
  ]);

  const mergedBaseDex = {
    ...(pokedex as DexIndex),
    ...((sagePokedex || {}) as DexIndex),
  } as DexIndex;
  const mergedBaseLearnsets = {
    ...(learnsets as LearnsetsIndex),
    ...((sageLearnsets || {}) as LearnsetsIndex),
  } as LearnsetsIndex;
  const mergedBaseMoves = {
    ...(moves as MoveIndex),
    ...((sageMoves || {}) as MoveIndex),
  } as MoveIndex;
  const mergedBaseAbilities = {
    ...(abilities as AbilityIndex),
    ...((sageAbilities || {}) as AbilityIndex),
  } as AbilityIndex;
  const mergedBaseItems = {
    ...(items as ItemIndex),
    ...((sageItems || {}) as ItemIndex),
  } as ItemIndex;

  // Merge custom overlays from local storage (local-only additions)
  const customDex = getCustomDex();
  const customLearnsets = getCustomLearnsets();
  const customItems = getCustomItems();
  const customMoves = getCustomMoves();
  const customAbilities = getCustomAbilities();
  const mergedDex = { ...mergedBaseDex, ...customDex } as DexIndex;
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
  return {
    pokedex: mergedDex,
    moves: mergedMoves,
    abilities: mergedAbilities,
    items: mergedItems,
    learnsets: mergedLs,
  };
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
  return {
    ...p,
    maxHp,
    currentHp: maxHp,
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
  // Default to the vendor showdown sprites path (both Electron and Tauri serve from public/vendor/showdown)
  const base = options?.base ?? DEFAULT_SPRITE_BASE;
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
  const preferred = toSpriteId(speciesName, cosmetic);
  ids.push(preferred);
  // Legacy pattern without hyphen (older code path); keep as a fallback
  const rawNorm = normalizeName(toAscii(speciesName));
  if (!ids.includes(rawNorm)) ids.push(rawNorm);
  // For Calyrex rider forms, ensure short variant is present explicitly
  if (/calyrex/i.test(speciesName)) {
    if (/ice/i.test(speciesName) && !ids.includes('calyrex-ice')) ids.push('calyrex-ice');
    if (/shadow/i.test(speciesName) && !ids.includes('calyrex-shadow')) ids.push('calyrex-shadow');
  }
  const dexNum = gNameToNum?.[normalizeName(speciesName)];
  if (Number.isFinite(dexNum) && dexNum !== 0) {
    const numericId = String(Math.trunc(dexNum));
    if (!ids.includes(numericId)) ids.push(numericId);
  }
  return ids;
}

type SpriteIndexPayload = { folders?: Record<string, string[]> };
type SpriteFolderIndex = Record<string, Set<string>>;

let gSpriteIndexPromise: Promise<SpriteFolderIndex | null> | null = null;

async function loadSpriteFolderIndex(base?: string): Promise<SpriteFolderIndex | null> {
  if (gSpriteIndexPromise) return gSpriteIndexPromise;
  gSpriteIndexPromise = (async () => {
    const bases = getSpriteBaseCandidates(base ?? DEFAULT_SPRITE_BASE);
    for (const spriteBase of bases) {
      try {
        const res = await fetch(`${spriteBase}/index.json`);
        if (!res.ok) continue;
        const payload = (await res.json()) as SpriteIndexPayload;
        const rawFolders = payload?.folders || {};
        const out: SpriteFolderIndex = {};
        for (const [folder, ids] of Object.entries(rawFolders)) {
          out[folder] = new Set(Array.isArray(ids) ? ids : []);
        }
        return out;
      } catch {
        // Try next base.
      }
    }
    return null;
  })();
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
  const base = normalizeBaseUrl(options?.base ?? DEFAULT_SPRITE_BASE) || '/vendor/showdown/sprites';
  const candidateIds = spriteIdCandidates(speciesName, options?.cosmetic);
  const preferredId = candidateIds[0] || normalizeName(speciesName);

  const variantIds = new Set<string>(candidateIds);
  const roots = new Set<string>();
  for (const id of candidateIds) {
    roots.add(id);
    const dash = id.indexOf('-');
    if (dash > 0) roots.add(id.slice(0, dash));
  }

  const folderIndex = await loadSpriteFolderIndex(base);
  const sourceSets: Array<PokemonSpriteOption['set']> = ['gen5', 'ani', 'home', 'gen6', 'gen4', 'gen3', 'gen2', 'gen1'];

  if (folderIndex) {
    for (const setId of sourceSets) {
      const def = spriteSetFolders(setId, shiny);
      const entries = def.front ? folderIndex[def.front] : undefined;
      if (!entries) continue;
      for (const root of roots) {
        if (entries.has(root)) variantIds.add(root);
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

  for (const setId of sourceSets) {
    const def = spriteSetFolders(setId, shiny);
    if (!def.front) continue;
    const frontEntries = folderIndex?.[def.front];
    const backEntries = def.back ? folderIndex?.[def.back] : undefined;
    if (strictExisting && !frontEntries) continue;
    for (const spriteId of sortedVariantIds) {
      if (frontEntries && !frontEntries.has(spriteId)) continue;
      const front = `${base}/${def.front}/${spriteId}.${def.ext}`;
      const back = def.back && (!backEntries || backEntries.has(spriteId))
        ? `${base}/${def.back}/${spriteId}.${def.ext}`
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
  const base = options?.base ?? DEFAULT_SPRITE_BASE;
  return `${base}/gen5icons/${normalizeName(speciesId)}.png`;
}

export function iconUrlWithFallback(speciesId: string, onError: (nextUrl: string)=>void, options?: { base?: string }) {
  const primary = iconUrl(speciesId, options);
  // Currently only a single icon set. If it fails, try fallback to gen5 sprite as small icon.
  const fallback = spriteUrl(speciesId, false, { setOverride: 'gen5' });
  return { src: primary, handleError: () => onError(fallback) };
}

// Sprite URL with graceful fallback chain (custom -> chosen set -> alternate set -> placeholder)
export function spriteUrlWithFallback(
  speciesId: string,
  onError: (nextUrl: string) => void,
  options?: { shiny?: boolean; base?: string; setOverride?: SpriteSet; cosmetic?: string; back?: boolean }
) {
  const spriteBases = getSpriteBaseCandidates(options?.base ?? DEFAULT_SPRITE_BASE);
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
  // Then add file paths for each folder × id combination (local paths first)
  for (const base of spriteBases) {
    for (const f of folders) {
      const isAni = f.startsWith('ani');
      const ext = isAni ? 'gif' : 'png';
      for (const id of idList) candidates.push(`${base}/${f}/${id}.${ext}`);
    }
  }
  // Add external fallback URLs (play.pokemonshowdown.com) for when local files are missing
  const extBase = 'https://play.pokemonshowdown.com/sprites';
  for (const f of folders) {
    const isAni = f.startsWith('ani');
    const ext = isAni ? 'gif' : 'png';
    for (const id of idList) candidates.push(`${extBase}/${f}/${id}.${ext}`);
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
export function getCustomSprite(id: string, slot: SpriteSlot): string | undefined {
  const all = getCustomSprites();
  return all[id]?.[slot];
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

/**
 * Fusion sprite URL with onerror fallback chain:
 *   custom (localStorage) → fusion-sprites/ → ai-sprites/ → variants → placeholder
 *
 * The RPi backend URL is used as base when available; otherwise default to
 * relative paths (for GitHub-Pages deployment).
 */
export function fusionSpriteUrl(headNum: number, bodyNum: number, options?: { base?: string }): string {
  const customKey = `fusion:${headNum}.${bodyNum}`;
  const custom = getCustomSprite(customKey, 'front');
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
  const filename = `${headNum}.${bodyNum}.png`;
  const customKey = `fusion:${headNum}.${bodyNum}`;

  const candidates: string[] = [];
  const custom = getCustomSprite(customKey, 'front');
  if (custom) candidates.push(custom);

  const apiBases = getFusionApiBases();
  for (const apiBase of apiBases) {
    // v1/v2 naming (new format)
    candidates.push(`${apiBase}/fusion/sprites/${headNum}.${bodyNum}v1.png`);
    candidates.push(`${apiBase}/fusion/sprites/${headNum}.${bodyNum}v2.png`);
    // Legacy naming (old format)
    candidates.push(`${apiBase}/fusion/sprites/${filename}`);
  }

  // Local fallback paths
  candidates.push(`${base}/fusion-sprites/${filename}`);

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
  return Array.from(new Set(ordered));
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

async function requestFusionGenerateOnce(headNum: number, bodyNum: number): Promise<{ base: string } | null> {
  const payload = { headNum, bodyNum, mode: 'splice' };
  for (const base of getFusionApiBases()) {
    try {
      const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
      const timeout = isLocal ? 2500 : 6000;
      const res = await fetchWithTimeout(`${base}/fusion/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, timeout);
      if (res.ok) return { base };
    } catch {}
  }
  return null;
}

async function waitForFusionReady(headNum: number, bodyNum: number, base: string, maxMs = 30000): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetchWithTimeout(`${base}/fusion/gen-check/${headNum}/${bodyNum}`, {}, 3000);
      if (res.ok) {
        const data = await res.json() as { exists?: boolean };
        if (data?.exists) {
          return `${base}/fusion/sprites/${headNum}.${bodyNum}v1.png?t=${Date.now()}`;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

export function ensureFusionSpriteOnDemand(headNum: number, bodyNum: number): Promise<string | null> {
  const key = `${headNum}.${bodyNum}`;
  const existing = gFusionEnsurePromises.get(key);
  if (existing) return existing;

  const task = (async () => {
    const started = await requestFusionGenerateOnce(headNum, bodyNum);
    if (!started) return null;
    return waitForFusionReady(headNum, bodyNum, started.base);
  })().finally(() => {
    gFusionEnsurePromises.delete(key);
  });

  gFusionEnsurePromises.set(key, task);
  return task;
}

export async function fetchFusionVariants(headNum: number, bodyNum: number): Promise<string[]> {
  const fallback = [`${headNum}.${bodyNum}.png`];
  for (const base of getFusionApiBases().slice(0, 3)) {
    try {
      const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
      const timeout = isLocal ? 1200 : 2200;
      const res = await fetchWithTimeout(`${base}/fusion/variants/${headNum}/${bodyNum}`, {}, timeout);
      if (!res.ok) continue;
      const data = await res.json() as { variants?: unknown };
      const variants = Array.isArray(data?.variants)
        ? data.variants.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      if (variants.length) return Array.from(new Set(variants));
    } catch {}
  }
  return fallback;
}

/** Save a custom fusion sprite (data URL) to localStorage */
export function saveCustomFusionSprite(headNum: number, bodyNum: number, dataUrl: string) {
  const customKey = `fusion:${headNum}.${bodyNum}`;
  saveCustomSprite(customKey, 'front', dataUrl);
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
