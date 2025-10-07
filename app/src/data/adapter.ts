import { BattlePokemon, Pokemon } from '../types';
import { calculateHp } from '../rules';

export type DexSpecies = {
  name: string;
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  types: string[];
  abilities?: Record<string, string>; // e.g., {"0":"Static","H":"Lightning Rod"}
  baseSpecies?: string;
  baseForme?: string;
  prevo?: string;
  evoLevel?: number;
  evos?: string[];
  evoType?: string; // e.g., level, levelFriendship, trade, useItem
  evoCondition?: string;
  otherFormes?: string[];
  cosmeticFormes?: string[];
  formeOrder?: string[];
  requiredItem?: string; // e.g., Charizardite X
  gender?: string;
  heightm?: number;
  weightkg?: number;
  color?: string;
};

export type MoveEntry = { name: string; type: string; basePower: number; category: 'Physical'|'Special'|'Status'; accuracy?: number | true; secondary?: any; secondaries?: any[]; desc?: string; shortDesc?: string };
export type AbilityEntry = { name: string; desc?: string; shortDesc?: string };
export type ItemEntry = { name: string; desc?: string; shortDesc?: string };

export type DexIndex = Record<string, DexSpecies>;
export type MoveIndex = Record<string, MoveEntry>;
export type AbilityIndex = Record<string, AbilityEntry>;
export type ItemIndex = Record<string, ItemEntry>;
export type LearnsetsIndex = Record<string, { learnset?: Record<string, any> }>;
export type AliasesIndex = Record<string, string>;

export function normalizeName(id: string) {
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export async function loadShowdownDex(options?: { base?: string }) {
  // Prefer the stable /showdown mount; fall back to the legacy /vendor path during dev
  const bases = options?.base ? [options.base] : ['/showdown/data', '/vendor/showdown/data'];
  async function tryJson(path: string, opt?: { optional?: boolean }) {
    for (const b of bases) {
      try {
        const r = await fetch(`${b}/${path}`);
        if (!r.ok) throw new Error(String(r.status));
        return await r.json();
      } catch (e) {
        // continue to next base
      }
    }
    if (opt?.optional) return {};
    // Last resort: empty
    return {};
  }
  const [pokedex, moves, abilities, items, learnsets, aliases] = await Promise.all([
    tryJson('pokedex.json'),
    tryJson('moves.json'),
    tryJson('abilities.json', { optional: true }),
    tryJson('items.json', { optional: true }),
    tryJson('learnsets.json', { optional: true }),
    tryJson('aliases.json', { optional: true }),
  ]);
  // Merge custom overlays from local storage (local-only additions)
  const customDex = getCustomDex();
  const customLearnsets = getCustomLearnsets();
  const mergedDex = { ...(pokedex as DexIndex), ...customDex } as DexIndex;
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
  const mergedLs = { ...(learnsets as LearnsetsIndex), ...customLearnsets } as LearnsetsIndex;
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
  return { pokedex: mergedDex, moves: moves as MoveIndex, abilities: abilities as AbilityIndex, items: items as ItemIndex, learnsets: mergedLs };
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
  };
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

function getIV(ivs: Pokemon['ivs']|undefined, key: 'hp'|'atk'|'def'|'spa'|'spd'|'spe') {
  const v = ivs?.[key];
  return typeof v === 'number' ? Math.max(0, Math.min(31, Math.floor(v))) : 31;
}
function getEV(evs: Pokemon['evs']|undefined, key: 'hp'|'atk'|'def'|'spa'|'spd'|'spe') {
  const v = evs?.[key];
  return typeof v === 'number' ? Math.max(0, Math.min(252, Math.floor(v))) : 0;
}

export function computeRealStats(p: Pokemon): { hp:number; atk:number; def:number; spa:number; spd:number; spe:number } {
  const L = Math.max(1, Math.min(100, Math.floor(p.level||1)));
  const bs = p.baseStats;
  const iv = {
    hp: getIV(p.ivs, 'hp'), atk: getIV(p.ivs, 'atk'), def: getIV(p.ivs, 'def'), spa: getIV(p.ivs, 'spa'), spd: getIV(p.ivs, 'spd'), spe: getIV(p.ivs, 'spe')
  };
  const ev = {
    hp: getEV(p.evs, 'hp'), atk: getEV(p.evs, 'atk'), def: getEV(p.evs, 'def'), spa: getEV(p.evs, 'spa'), spd: getEV(p.evs, 'spd'), spe: getEV(p.evs, 'spe')
  };
  // Shedinja special case: always 1 HP
  const isShedinja = normalizeName(p.species || p.name) === 'shedinja';
  const hp = isShedinja ? 1 : (Math.floor(((2*bs.hp + iv.hp + Math.floor(ev.hp/4)) * L) / 100) + L + 10);
  const calc = (base:number, ivv:number, evv:number, stat:'atk'|'def'|'spa'|'spd'|'spe') => {
    const n = Math.floor(((2*base + ivv + Math.floor(evv/4)) * L) / 100) + 5;
    return Math.floor(n * natureMultiplier(p.nature, stat));
  };
  const atk = calc(bs.atk, iv.atk, ev.atk, 'atk');
  const def = calc(bs.def, iv.def, ev.def, 'def');
  const spa = calc(bs.spAtk, iv.spa, ev.spa, 'spa');
  const spd = calc(bs.spDef, iv.spd, ev.spd, 'spd');
  const spe = calc(bs.speed, iv.spe, ev.spe, 'spe');
  return { hp, atk, def, spa, spd, spe };
}

// Sprite helpers: prefer Gen 5 static for retro vibe
export type SpriteSet = 'gen5'|'home';
export function getSpriteSettings(): { set: SpriteSet } {
  const allowed: SpriteSet[] = ['gen5','home'];
  try {
    const raw = JSON.parse(localStorage.getItem('ttrpg.spriteSettings') || '{}');
    let set = raw?.set as string | undefined;
    // Migrate legacy values
    if (set && !allowed.includes(set as SpriteSet)) set = 'gen5';
    if (!set || !allowed.includes(set as SpriteSet)) return { set: 'gen5' };
    return { set: set as SpriteSet };
  } catch { return { set: 'gen5' }; }
}

export function setSpriteSettings(s: { set: SpriteSet }) {
  try { localStorage.setItem('ttrpg.spriteSettings', JSON.stringify(s)); } catch {}
}

// Normalize to ASCII and collapse punctuation; used for sprite IDs
function toAscii(s: string): string {
  try {
    // NFD splits accents into combining chars; remove them. Keep gender symbols for special-case checks later.
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch { return s; }
}

export function spriteUrl(speciesId: string, shiny = false, options?: { base?: string, setOverride?: SpriteSet, cosmetic?: string, back?: boolean }) {
  // Default to the stable /showdown mount; electron main and Vite dev both serve this locally
  const base = options?.base ?? '/showdown/sprites';
  const chosen = options?.setOverride ?? getSpriteSettings().set;
  // Construct folder and extension
  const folder = (() => {
    if (chosen === 'gen5') {
      if (options?.back) return shiny ? 'gen5-back-shiny' : 'gen5-back';
      return shiny ? 'gen5-shiny' : 'gen5';
    }
    // HOME has only front sprites
    return shiny ? 'home-shiny' : 'home';
  })();
  const ext = 'png';
  const ids = toSpriteIdCandidates(speciesId, options?.cosmetic);
  // Prefer locally stored custom sprite data URL if present
  const slot: SpriteSlot = options?.back ? (shiny ? 'back-shiny' : 'back') : (shiny ? 'shiny' : 'front');
  const local = ids.map(id => getCustomSprite(id, slot) || getCustomSprite(id, shiny ? 'shiny' : 'front')).find(Boolean);
  if (local) return local;
  return `${base}/${folder}/${ids[0]}.${ext}`;
}

// Generate multiple candidate sprite filenames to match on-disk Showdown names.
function toSpriteIdCandidates(speciesName: string, cosmetic?: string): string[] {
  const out: string[] = [];
  const raw = toAscii(String(speciesName || ''));
  // Nidoran gender specials
  if (/♀/.test(speciesName)) return ['nidoranf'];
  if (/♂/.test(speciesName)) return ['nidoranm'];
  const lower = raw.toLowerCase();
  const hyphenPreserved = lower.replace(/[^a-z0-9\-]+/g, ''); // keep hyphens
  const collapsed = lower.replace(/[^a-z0-9]+/g, ''); // remove all non-alnum
  const bases = Array.from(new Set([hyphenPreserved, collapsed].filter(Boolean)));
  const cos = cosmetic ? toAscii(String(cosmetic)).toLowerCase().replace(/[^a-z0-9\-]+/g, '') : '';
  for (const b of bases) {
    out.push(b);
    if (cos && !b.endsWith(cos)) {
      out.push(`${b}-${cos}`);
      out.push(`${b}${cos}`);
    }
  }
  return Array.from(new Set(out.filter(Boolean)));
}

export function speciesFormesInfo(name: string, dex: DexIndex) {
  const key = findSpeciesKey(name, dex);
  if (!key) return { base: name, otherFormes: [] as string[], cosmeticFormes: [] as string[], entry: undefined as any };
  const s = dex[key];
  return { base: s.baseSpecies || s.name, otherFormes: s.otherFormes || [], cosmeticFormes: s.cosmeticFormes || [], entry: s };
}

export function iconUrl(speciesId: string, options?: { base?: string }) {
  const base = options?.base ?? '/showdown/sprites';
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
  const base = options?.base ?? '/showdown/sprites';
  const shiny = !!options?.shiny;
  const back = !!options?.back;
  const chosen = options?.setOverride ?? getSpriteSettings().set;
  const ids = toSpriteIdCandidates(speciesId, options?.cosmetic);

  // Candidate folders by priority
  const folders: string[] = [];
  if (chosen === 'gen5') {
    folders.push(back ? (shiny ? 'gen5-back-shiny' : 'gen5-back') : (shiny ? 'gen5-shiny' : 'gen5'));
    // Fallback to HOME front sprite
    folders.push(shiny ? 'home-shiny' : 'home');
  } else {
    // HOME first (front-only), then gen5 (front/back)
    folders.push(shiny ? 'home-shiny' : 'home');
    folders.push(back ? (shiny ? 'gen5-back-shiny' : 'gen5-back') : (shiny ? 'gen5-shiny' : 'gen5'));
  }

  // Insert custom sprite data URL at the front if available
  const slot: SpriteSlot = back ? (shiny ? 'back-shiny' : 'back') : (shiny ? 'shiny' : 'front');
  const candidates: string[] = [];
  for (const id of ids) {
    const custom = getCustomSprite(id, slot) || getCustomSprite(id, shiny ? 'shiny' : 'front');
    if (custom && !candidates.includes(custom)) candidates.push(custom);
  }
  for (const f of folders) for (const id of ids) candidates.push(`${base}/${f}/${id}.png`);

  let idx = 0;
  const placeholder = placeholderSpriteDataURL((ids[0] || 'POKEMON').slice(0, 8).toUpperCase());
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

// Custom sprite storage (data URLs) — local only
const LS_CUSTOM_SPRITES = 'ttrpg.customSprites';
type SpriteSlot = 'front'|'shiny'|'back'|'back-shiny';
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

// Placeholder data URL sprite for missing images (SVG)
export function placeholderSpriteDataURL(label: string = '?', w: number = 80, h: number = 80): string {
  const bg = '#cfe9ff';
  const fg = '#003a70';
  const safeLabel = String(label ?? '?');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
              `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
              `<rect width='100%' height='100%' rx='8' ry='8' fill='${bg}' />` +
              `<text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='${Math.floor(Math.min(w, h) * 0.52)}' fill='${fg}'>${escapeXml(safeLabel)}</text>` +
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
export type TeamRecord = { id: string; name: string; members: BattlePokemon[] };
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
  } catch {}
}
export function createTeam(name: string): TeamRecord {
  return { id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`, name, members: [] };
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
