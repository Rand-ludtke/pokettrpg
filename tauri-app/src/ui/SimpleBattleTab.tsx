import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withPublicBase } from '../utils/publicBase';
import { spriteUrlWithFallback, normalizeName, loadShowdownDataJson } from '../data/adapter';
import { getClient, PromptActionPayload, RoomSummary, ChatMessage } from '../net/pokettrpgClient';

// Move descriptions data loaded from moves.json at runtime
let cachedMovesData: Record<string, { desc?: string; shortDesc?: string }> | null = null;
async function loadMovesData() {
  if (cachedMovesData) return cachedMovesData;
  try {
    cachedMovesData = await loadShowdownDataJson<Record<string, { desc?: string; shortDesc?: string }>>('moves.json', {
      defaultValue: {},
    });
  } catch {
    cachedMovesData = {};
  }
  return cachedMovesData;
}
// Pre-load moves data on module init
loadMovesData();

type SideId = 'p1' | 'p2';
type RequestMap = Record<SideId, any | undefined>;
type PlayerSummary = { id: string; username?: string; name?: string; avatar?: string; trainerSprite?: string; sprite?: string };
type RosterEntry = { pokemon: any; slot: number; isActive: boolean };

const TYPE_COLORS: Record<string, string> = {
  normal: '#a8a77a',
  fire: '#ee8130',
  water: '#6390f0',
  electric: '#f7d02c',
  grass: '#7ac74c',
  ice: '#96d9d6',
  fighting: '#c22e28',
  poison: '#a33ea1',
  ground: '#e2bf65',
  flying: '#a98ff3',
  psychic: '#f95587',
  bug: '#a6b91a',
  rock: '#b6a136',
  ghost: '#735797',
  dragon: '#6f35fc',
  dark: '#705746',
  steel: '#b7b7ce',
  fairy: '#d685ad',
  stellar: '#44698f',
  shadow: '#5a4975',
  nuclear: '#92D050',
  cosmic: '#6B2FA0',
};

const FX_ASSET_BASE = '/fx';

const BATTLE_BACKGROUNDS = [
  'bg-forest.png',
  'bg-meadow.png',
  'bg-mountain.png',
  'bg-route.png',
  'bg-river.png',
  'bg-desert.png',
  'bg-beach.png',
  'bg-beachshore.png',
  'bg-city.png',
  'bg-volcanocave.png',
  'bg-earthycave.png',
  'bg-icecave.png',
  'bg-thunderplains.png',
  'bg-gen3-forest.png',
  'bg-gen3-ocean.png',
  'bg-gen4-water.png',
  'bg-space.jpg',
] as const;

type WeatherFxConfig = {
  key: string;
  webm?: string;
  mp4?: string;
  poster?: string;
  blendMode?: React.CSSProperties['mixBlendMode'];
  opacity?: number;
};

const WEATHER_FX_LIBRARY: Record<string, WeatherFxConfig> = {
  sunny: {
    key: 'sunny',
    webm: `${FX_ASSET_BASE}/weather-gen6-sunnyday.webm`,
    mp4: `${FX_ASSET_BASE}/weather-gen6-sunnyday.mp4`,
    poster: `${FX_ASSET_BASE}/weather-sunnyday.jpg`,
    blendMode: 'screen',
    opacity: 0.55,
  },
  rain: {
    key: 'rain',
    webm: `${FX_ASSET_BASE}/weather-gen6-raindance.webm`,
    mp4: `${FX_ASSET_BASE}/weather-gen6-raindance.mp4`,
    poster: `${FX_ASSET_BASE}/weather-raindance.jpg`,
    blendMode: 'screen',
    opacity: 0.6,
  },
  sandstorm: {
    key: 'sandstorm',
    webm: `${FX_ASSET_BASE}/weather-gen6-sandstorm.webm`,
    mp4: `${FX_ASSET_BASE}/weather-gen6-sandstorm.mp4`,
    poster: `${FX_ASSET_BASE}/weather-sandstorm.png`,
    blendMode: 'screen',
    opacity: 0.7,
  },
  hail: {
    key: 'hail',
    webm: `${FX_ASSET_BASE}/weather-gen6-hail.webm`,
    mp4: `${FX_ASSET_BASE}/weather-gen6-hail.mp4`,
    poster: `${FX_ASSET_BASE}/weather-hail.png`,
    blendMode: 'screen',
    opacity: 0.65,
  },
};

const TERRAIN_OVERLAYS: Record<string, string> = {
  electricterrain: `${FX_ASSET_BASE}/weather-electricterrain.png`,
  electric: `${FX_ASSET_BASE}/weather-electricterrain.png`,
  grassyterrain: `${FX_ASSET_BASE}/weather-grassyterrain.png`,
  grassy: `${FX_ASSET_BASE}/weather-grassyterrain.png`,
  mistyterrain: `${FX_ASSET_BASE}/weather-mistyterrain.png`,
  misty: `${FX_ASSET_BASE}/weather-mistyterrain.png`,
  psychicterrain: `${FX_ASSET_BASE}/weather-psychicterrain.png`,
  psychic: `${FX_ASSET_BASE}/weather-psychicterrain.png`,
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function pickBackground(seed: string): string {
  if (!BATTLE_BACKGROUNDS.length) return 'bg.jpg';
  const idx = Math.abs(hashString(seed)) % BATTLE_BACKGROUNDS.length;
  return BATTLE_BACKGROUNDS[idx];
}

function resolveWeatherFx(weatherId?: string | null): WeatherFxConfig | null {
  if (!weatherId) return null;
  const key = weatherId.toLowerCase();
  if (['sunnyday', 'sun', 'desolateland'].includes(key)) return WEATHER_FX_LIBRARY.sunny;
  if (['raindance', 'rain', 'primordialsea'].includes(key)) return WEATHER_FX_LIBRARY.rain;
  if (['sandstorm', 'sand'].includes(key)) return WEATHER_FX_LIBRARY.sandstorm;
  if (['hail', 'snow', 'snowstorm'].includes(key)) return WEATHER_FX_LIBRARY.hail;
  return null;
}

function resolveTerrainOverlay(terrainId?: string | null): string | null {
  if (!terrainId) return null;
  const key = terrainId.toLowerCase();
  return TERRAIN_OVERLAYS[key] || null;
}

function mixWithWhite(hex: string, ratio: number): string {
  const cleaned = (hex || '').replace('#', '');
  if (cleaned.length !== 6) return hex;
  const num = parseInt(cleaned, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const tint = (channel: number) => Math.round(channel + (255 - channel) * ratio);
  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
  return `#${toHex(tint(r))}${toHex(tint(g))}${toHex(tint(b))}`;
}

function typeColors(type?: string): { base: string; tint: string } {
  if (!type) return { base: '#7b8b8f', tint: '#eef5f9' };
  const base = TYPE_COLORS[type.toLowerCase()] || '#7b8b8f';
  return { base, tint: mixWithWhite(base, 0.7) };
}

function hpColor(pct: number): string {
  if (pct > 50) return '#4caf50';
  if (pct > 20) return '#ff9800';
  return '#f44336';
}

function normalizeStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const trimmed = status.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return null;
  return trimmed;
}

function statusCode(pkm: any): string | null {
  const fromStatus = normalizeStatus(pkm?.status);
  const fromCondition = normalizeStatus(typeof pkm?.condition === 'string' ? pkm.condition.split(' ')[1] : undefined);
  const raw = fromStatus || fromCondition;
  if (!raw) return null;
  if (raw.startsWith('tox')) return 'tox';
  if (raw.startsWith('psn')) return 'psn';
  if (raw.startsWith('par')) return 'par';
  if (raw.startsWith('slp')) return 'slp';
  if (raw.startsWith('brn')) return 'brn';
  if (raw.startsWith('frz')) return 'frz';
  return raw.slice(0, 3);
}

function looksLikePokemon(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(looksLikePokemon);
  const stringProps = ['species', 'name', 'details', 'baseSpecies'];
  if (stringProps.some(prop => typeof value[prop] === 'string' && value[prop])) return true;
  if (typeof value?.id === 'string' && value.id.includes(':')) return true;
  if (typeof value?.condition === 'string' && value.condition) return true;
  if (Number.isFinite(value?.hp) || Number.isFinite(value?.maxhp)) return true;
  if (Array.isArray(value.moves) && value.moves.length) return true;
  if (Array.isArray(value.types) && value.types.length) return true;
  return false;
}

function coercePokemonList(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (looksLikePokemon(value)) return [value];
  if (typeof value === 'object') {
    const values = Object.values(value).filter(Boolean);
    if (!values.length) return [];
    if (values.some(looksLikePokemon)) return values;
  }
  return [];
}

function coerceSideId(raw: any): SideId | null {
  if (raw === 'p1' || raw === 'p2') return raw;
  if (raw === 0) return 'p1';
  if (raw === 1) return 'p2';
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower.startsWith('p1')) return 'p1';
    if (lower.startsWith('p2')) return 'p2';
  }
  return null;
}

function resolveRequestSide(state: any, request: any): SideId | null {
  if (!request) return null;
  const direct = coerceSideId(
    request?.side?.id ??
    request?.side?.side ??
    request?.side ??
    request?.sideId ??
    request?.sideID ??
    request?.playerSide ??
    request?.slotSide ??
    request?.id ??
    request?.teamPreview?.side ??
    request?.teamPreviewSide
  );
  if (direct) return direct;

  const players = Array.isArray(state?.players) ? state.players : [];
  const playerIdCandidates: Array<any> = [
    request?.playerId,
    request?.userid,
    request?.userId,
    request?.user?.id,
    request?.player?.id,
    request?.target,
  ];
  const assignByPlayerId = (candidate: any): SideId | null => {
    if (!candidate || !players.length) return null;
    const lower = String(candidate).toLowerCase();
    const matchesPlayer = (player: any): boolean => {
      if (!player) return false;
      const values = [player.id, player.userid, player.userId, player.name, player.username, player.user?.id, player.user?.name].filter(Boolean);
      return values.some(val => typeof val === 'string' && val.toLowerCase() === lower);
    };
    if (matchesPlayer(players[0])) return 'p1';
    if (matchesPlayer(players[1])) return 'p2';
    return null;
  };
  for (const candidate of playerIdCandidates) {
    const side = assignByPlayerId(candidate);
    if (side) return side;
  }

  const numericCandidates: Array<any> = [
    request?.playerIndex,
    request?.index,
    request?.slot,
    request?.sideIndex,
    request?.teamPosition,
  ];
  for (const candidate of numericCandidates) {
    if (candidate === undefined || candidate === null) continue;
    const directSide = coerceSideId(candidate);
    if (directSide) return directSide;
    const asNumber = Number(candidate);
    if (Number.isFinite(asNumber)) {
      if (Math.trunc(asNumber) === 0) return 'p1';
      if (Math.trunc(asNumber) === 1) return 'p2';
    }
  }

  return null;
}

function deriveRequestsFromState(state: any): RequestMap {
  const result: RequestMap = { p1: undefined, p2: undefined };
  if (!state) return result;
  const sources: any[] = [
    state?.requests,
    state?.request,
    state?.pendingRequests,
    state?.pendingRequest,
    state?.prompts,
    state?.prompt,
    state?.lastRequests,
  ];
  const assign = (request: any) => {
    if (!request) return;
    const side = resolveRequestSide(state, request);
    if (!side) return;
    if (!result[side]) result[side] = request;
  };
  for (const source of sources) {
    if (!source) continue;
    if (Array.isArray(source)) {
      source.forEach(assign);
      continue;
    }
    if (typeof source === 'object') {
      if (!result.p1 && source.p1) result.p1 = source.p1;
      if (!result.p2 && source.p2) result.p2 = source.p2;
      assign(source);
      if (Array.isArray(source.list)) source.list.forEach(assign);
      if (Array.isArray(source.sides)) source.sides.forEach(assign);
    }
  }
  return result;
}

function looksLikeRequestObject(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value?.active)) return true;
  if (Array.isArray(value?.forceSwitch)) return true;
  if (Array.isArray(value?.switches)) return true;
  if (Array.isArray(value?.side?.pokemon)) return true;
  if (Array.isArray(value?.side?.team)) return true;
  // Also check top-level pokemon array (prompt format)
  if (Array.isArray(value?.pokemon)) return true;
  if (value?.teamPreview) return true;
  if (Array.isArray(value?.teamPreview?.pokemon)) return true;
  return false;
}

function coerceRequestObject(value: any): any {
  if (!value || typeof value !== 'object') return value;
  const visited = new Set<any>();
  let current: any = value;
  while (current && typeof current === 'object') {
    if (visited.has(current)) break;
    visited.add(current);
    if (looksLikeRequestObject(current)) return current;
    if (current.request && typeof current.request === 'object') {
      current = current.request;
      continue;
    }
    if (current.prompt && typeof current.prompt === 'object') {
      current = current.prompt;
      continue;
    }
    if (current.payload && typeof current.payload === 'object') {
      current = current.payload;
      continue;
    }
    if (current.data && typeof current.data === 'object') {
      current = current.data;
      continue;
    }
    if (Array.isArray(current.requests) && current.requests.length === 1 && typeof current.requests[0] === 'object') {
      current = current.requests[0];
      continue;
    }
    break;
  }
  return current;
}

function pickRoomPlayers(rooms: RoomSummary[], roomId: string): PlayerSummary[] {
  const room = rooms.find(r => r.id === roomId);
  return room && Array.isArray(room.players) ? room.players : [];
}

function normalizeRoomPlayers(list: PlayerSummary[]): PlayerSummary[] {
  const output: PlayerSummary[] = [];
  const seen = new Set<string>();
  for (const entry of list ?? []) {
    if (!entry) continue;
    const key = (entry.id || entry.username || entry.name || '').toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    output.push(entry);
  }
  return output;
}

function derivePlayerIdsFromState(state: any): Record<SideId, string | undefined> {
  const next: Record<SideId, string | undefined> = { p1: undefined, p2: undefined };
  if (!state) return next;
  const players = Array.isArray(state.players) ? state.players : [];
  if (players[0]?.id) next.p1 = players[0].id;
  if (players[1]?.id) next.p2 = players[1].id;
  const sides = Array.isArray(state.sides)
    ? state.sides
    : Array.isArray(state.field?.sides)
      ? state.field.sides
      : [];
  if (!next.p1) {
    next.p1 = sides[0]?.id || sides[0]?.trainer?.id || next.p1;
  }
  if (!next.p2) {
    next.p2 = sides[1]?.id || sides[1]?.trainer?.id || next.p2;
  }
  return next;
}

function inferSideFromState(state: any, userId?: string | null): SideId | null {
  if (!state || !userId) return null;
  const players = Array.isArray(state.players) ? state.players : [];
  if (players[0]?.id === userId) return 'p1';
  if (players[1]?.id === userId) return 'p2';
  const sides = Array.isArray(state.sides)
    ? state.sides
    : Array.isArray(state.field?.sides)
      ? state.field.sides
      : [];
  if (sides[0]?.id === userId || sides[0]?.trainer?.id === userId) return 'p1';
  if (sides[1]?.id === userId || sides[1]?.trainer?.id === userId) return 'p2';
  return null;
}

function speciesFromPokemon(pkm: any): string {
  if (!pkm) return '';

  const clean = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed
      .replace(/\u2605|★/g, '')
      .replace(/\u25c6|◆/g, '')
      .replace(/\s+\((?:M|F)\)$/i, '')
      .trim();
  };

  const seen = new Set<string>();
  const claim = (value: unknown): string => {
    const cleaned = clean(value);
    if (!cleaned) return '';
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return '';
    seen.add(key);
    return cleaned;
  };

  const claimWithForms = (value: unknown): string => {
    const claimed = claim(value);
    if (claimed) return claimed;
    if (typeof value === 'string') {
      const match = value.match(/\(([^)]+)\)/);
      if (match) {
        const inner = claim(match[1]);
        if (inner) return inner;
      }
    }
    return '';
  };

  const fromDetails = typeof pkm.details === 'string' ? claim(pkm.details.split(',')[0]) : '';
  if (fromDetails) return fromDetails;

  const templateSpecies = claim(pkm?.template?.species);
  if (templateSpecies) return templateSpecies;

  const fields = [
    'speciesFormeName',
    'speciesForme',
    'speciesForm',
    'speciesid',
    'speciesId',
    'species',
    'baseSpeciesName',
    'baseSpecies',
    'originalSpecies',
    'baseForme',
    'baseForm',
    'speciesName',
    'searchid',
    'searchId',
    'speciesRaw',
    'formeName',
    'forme',
    'form',
    'formName',
    'formeId',
    'formeID',
    'formId',
  ] as const;

  for (const key of fields) {
    const candidate = claim((pkm as any)?.[key]);
    if (candidate) return candidate;
  }

  const nestedSources = [pkm?.species, pkm?.speciesData, pkm?.baseSpeciesData, pkm?.template, pkm?.original];
  for (const source of nestedSources) {
    if (!source || typeof source !== 'object') continue;
    const candidate =
      claim((source as any).name) ||
      claim((source as any).species) ||
      claim((source as any).speciesName) ||
      claim((source as any).baseSpecies) ||
      claim((source as any).id);
    if (candidate) return candidate;
  }

  const baseSpecies = claim(pkm?.baseSpecies);
  if (baseSpecies) return baseSpecies;

  const setSpecies = claim(pkm?.set?.species);
  if (setSpecies) return setSpecies;

  const identCandidate = (() => {
    if (typeof pkm?.ident !== 'string') return '';
    const parts = pkm.ident.split(':');
    if (!parts.length) return '';
    const tail = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
    const claimedTail = claimWithForms(tail);
    if (claimedTail) return claimedTail;
    if (parts.length > 1) {
      return claimWithForms(parts[parts.length - 1]);
    }
    return '';
  })();
  if (identCandidate) return identCandidate;

  const nameCandidate = claimWithForms(pkm?.name);
  if (nameCandidate) return nameCandidate;

  const pokemonName = claimWithForms(pkm?.pokemon?.name ?? pkm?.originalName);
  if (pokemonName) return pokemonName;

  const pokemonSpecies = claimWithForms(pkm?.pokemon?.species);
  if (pokemonSpecies) return pokemonSpecies;

  const fallbackDetails = claimWithForms(pkm?.details);
  if (fallbackDetails) return fallbackDetails;

  return '';
}

function coerceId(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return '';
}

function collectIdCandidates(...values: unknown[]): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === 'object') {
      const obj = value as any;
      push(obj.pokemonId);
      push(obj.id);
      push(obj.ident);
      push(obj.sid);
      push(obj.slotId);
      push(obj.slug);
      push(obj.uuid);
      push(obj.nickname);
      push(obj.originalName);
      push(obj.name);
      push(obj.species);
      return;
    }
    const str = coerceId(value);
    if (str && !out.includes(str)) out.push(str);
  };
  values.forEach(push);
  return out;
}

function fallbackPokemonId(entry: RosterEntry | null | undefined, slotIndex?: number): string | undefined {
  if (entry?.pokemon) {
    const candidates = collectIdCandidates(entry.pokemon);
    if (candidates.length) return candidates[0];
    const species = speciesFromPokemon(entry.pokemon);
    if (species) {
      const normalized = normalizeName(species);
      if (normalized) return normalized;
    }
  }
  if (typeof slotIndex === 'number' && slotIndex >= 0) {
    return `slot-${slotIndex + 1}`;
  }
  return undefined;
}

function parseHpInfo(pkm: any): { hpPct: number; text: string } {
  if (!pkm) return { hpPct: 100, text: '' };
  if (typeof pkm.condition === 'string' && pkm.condition) {
    const [hpPart, status = ''] = pkm.condition.split(' ');
    if (hpPart.includes('/')) {
      const [numStr, denStr] = hpPart.split('/');
      const num = Number(numStr);
      const den = Number(denStr);
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((num / den) * 100)));
        return { hpPct: pct, text: status };
      }
    }
    const pct = Number(hpPart);
    if (Number.isFinite(pct)) {
      return { hpPct: Math.max(0, Math.min(100, pct)), text: status };
    }
    return { hpPct: 100, text: status };
  }
  const numberPairs: Array<[number | undefined, number | undefined]> = [
    [pkm.hp, pkm.maxhp],
    [pkm.currentHp, pkm.maxHp],
    [pkm.currentHP, pkm.maxHP],  // Server sends uppercase HP
    [pkm.health, pkm.maxHealth],
  ];
  for (const [cur, max] of numberPairs) {
    if (Number.isFinite(cur) && Number.isFinite(max) && max! > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((cur! / max!) * 100)));
      const status = typeof pkm.status === 'string' ? pkm.status : '';
      return { hpPct: pct, text: status };
    }
  }
  return { hpPct: 100, text: typeof pkm.status === 'string' ? pkm.status : '' };
}

function buildSpriteChain(pkm: any, side: SideId, showBack: boolean) {
  const buildFusionCandidates = () => {
    const fusion = pkm?.fusion;
    if (!fusion || !Number.isFinite(fusion?.headId) || !Number.isFinite(fusion?.bodyId)) {
      return { front: [] as string[], back: [] as string[] };
    }

    const headId = Number(fusion.headId);
    const bodyId = Number(fusion.bodyId);
    const spriteFile = typeof fusion?.spriteFile === 'string' && fusion.spriteFile.trim()
      ? fusion.spriteFile.trim()
      : `${headId}.${bodyId}.png`;
    const defaultFile = `${headId}.${bodyId}.png`;
    const mode = pkm?.spriteMode || fusion?.mode || 'auto';
    const baseByMode: Record<string, string[]> = {
      'ai-generated': ['/ai-sprites', '/spliced-sprites', '/fusion-sprites'],
      'two-step': ['/spliced-sprites', '/ai-sprites', '/fusion-sprites'],
      'auto': ['/fusion-sprites', '/ai-sprites', '/spliced-sprites'],
    };
    const bases = baseByMode[mode] || baseByMode.auto;
    const explicitUrl = /^https?:\/\//i.test(spriteFile) || /^data:image\//i.test(spriteFile) || spriteFile.startsWith('/');

    const front: string[] = [];
    const back: string[] = [];

    if (explicitUrl) {
      front.push(spriteFile);
      if (showBack) {
        const slashIndex = spriteFile.lastIndexOf('/');
        if (slashIndex >= 0) {
          const prefix = spriteFile.slice(0, slashIndex);
          const filename = spriteFile.slice(slashIndex + 1);
          back.push(`${prefix}/back/${filename}`);
        }
      }
    }

    for (const base of bases) {
      const normalizedBase = withPublicBase(base.replace(/^\//, ''));
      if (showBack) {
        back.push(`${normalizedBase}/back/${spriteFile}`);
        if (spriteFile !== defaultFile) {
          back.push(`${normalizedBase}/back/${defaultFile}`);
        }
      }
      front.push(`${normalizedBase}/${spriteFile}`);
      if (spriteFile !== defaultFile) {
        front.push(`${normalizedBase}/${defaultFile}`);
      }
    }

    return {
      front: Array.from(new Set(front.filter(Boolean))),
      back: Array.from(new Set(back.filter(Boolean))),
    };
  };

  const fusionCandidates = buildFusionCandidates();
  const species = speciesFromPokemon(pkm) || 'Missingno';
  const shiny = !!pkm?.shiny;
  const directFront = [
    ...fusionCandidates.front,
    pkm?.sprite,
    pkm?.spriteUrl,
    pkm?.image,
    pkm?.art,
  ].find((value: unknown) => typeof value === 'string' && String(value).trim()) as string | undefined;
  const directBack = [
    ...fusionCandidates.back,
    pkm?.backSprite,
    pkm?.backSpriteUrl,
  ].find((value: unknown) => typeof value === 'string' && String(value).trim()) as string | undefined;

  // Debug: log sprite chain resolution for custom sprites
  if (pkm?.sprite || pkm?.backSprite || directFront || directBack) {
    console.warn('[buildSpriteChain]', species, side, showBack ? 'BACK' : 'FRONT', {
      'pkm.sprite': pkm?.sprite, 'pkm.backSprite': pkm?.backSprite,
      directFront, directBack,
    });
  }

  const frontChain = spriteUrlWithFallback(species, () => {}, { back: false, shiny });

  if (showBack) {
    const backChain = spriteUrlWithFallback(species, () => {}, { back: true, shiny });
    const preferredBack = directBack ? [directBack, ...fusionCandidates.back] : [...fusionCandidates.back];
    const preferredFront = directFront ? [directFront, ...fusionCandidates.front] : [...fusionCandidates.front];
    // When a custom front sprite is chosen but no back sprite exists,
    // use the front sprite as the first back candidate — it will be mirrored via scaleX(-1).
    if (directFront && !directBack && !fusionCandidates.back.length) {
      preferredBack.unshift(directFront);
    }
    const backCandidates = [...preferredBack, backChain.src, ...(backChain.candidates || [])].filter(Boolean) as string[];
    const frontCandidates = [...preferredFront, frontChain.src, ...(frontChain.candidates || [])].filter(Boolean) as string[];
    const candidates = Array.from(new Set([...backCandidates, ...frontCandidates]));
    const placeholder = backChain.placeholder || frontChain.placeholder;
    // If the first candidate is really a front sprite used as back fallback, mark it for mirroring
    const needsImmediateMirror = directFront && !directBack && !fusionCandidates.back.length && candidates[0] === directFront;
    return {
      initial: candidates[0] || placeholder,
      candidates,
      placeholder,
      backFallbackStart: needsImmediateMirror ? 0 : backCandidates.length,
      mirrorBackFallback: true,
    };
  }

  const candidates = Array.from(new Set([
    ...(directFront ? [directFront] : []),
    frontChain.src,
    ...(frontChain.candidates || []),
  ].filter(Boolean) as string[]));
  return {
    initial: candidates[0] || frontChain.placeholder,
    candidates,
    placeholder: frontChain.placeholder,
    backFallbackStart: Number.MAX_SAFE_INTEGER,
    mirrorBackFallback: false,
  };
}

function sanitizeTrainerSpriteId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const value = typeof raw === 'number' && Number.isFinite(raw)
    ? String(Math.trunc(raw))
    : typeof raw === 'string'
      ? raw
      : '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutFragment = trimmed.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  const segments = withoutQuery.replace(/\\/g, '/').split('/').filter(Boolean);
  let candidate = (segments.length ? segments[segments.length - 1] : withoutQuery).replace(/\.png$/i, '').trim();
  if (!candidate) return '';
  candidate = candidate
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  if (!candidate) return '';
  if (candidate.includes('ace-trainer')) {
    candidate = candidate.replace(/ace-trainer/g, 'acetrainer');
  }
  if (candidate === 'pending' || candidate === 'random' || candidate === 'default' || candidate === 'unknown') return '';
  return candidate;
}

function resolveTrainerSpriteUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(asset|tauri):/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return undefined;
}

function trainerSpriteFromEntity(entity: any): string | undefined {
  if (!entity || typeof entity !== 'object') return undefined;
  const directKeys: Array<string> = ['trainerSprite', 'avatar', 'sprite', 'spriteId', 'spriteName'];
  for (const key of directKeys) {
    const value = (entity as any)[key];
    const directUrl = resolveTrainerSpriteUrl(value);
    if (directUrl) return directUrl;
    const sanitized = sanitizeTrainerSpriteId(value);
    if (sanitized) return sanitized;
    if (value && typeof value === 'object') {
      const nestedUrl = resolveTrainerSpriteUrl((value as any).url ?? (value as any).src ?? (value as any).sprite);
      if (nestedUrl) return nestedUrl;
      const nested = sanitizeTrainerSpriteId((value as any).id ?? (value as any).name ?? (value as any).sprite);
      if (nested) return nested;
    }
  }
  if (entity?.user) {
    const fromUser = trainerSpriteFromEntity(entity.user);
    if (fromUser) return fromUser;
  }
  return undefined;
}

function trainerSpriteSources(spriteId: string | undefined, side: SideId): string[] {
  const directUrl = resolveTrainerSpriteUrl(spriteId);
  if (directUrl) return [directUrl];
  const chosen = sanitizeTrainerSpriteId(spriteId);
  const fallback = side === 'p1' ? 'heroine' : 'acefemale';
  const variantSet = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    variantSet.add(value);
    const withoutHyphen = value.includes('-') ? value.replace(/-/g, '') : value;
    if (withoutHyphen && withoutHyphen !== value) variantSet.add(withoutHyphen);
  };
  add(chosen);
  add(fallback);
  const ids = Array.from(variantSet);
  const bases = [
    withPublicBase('vendor/showdown/sprites/trainers').replace(/\/$/, ''),
    'https://play.pokemonshowdown.com/sprites/trainers',
  ];
  const sources: string[] = [];
  for (const id of ids) {
    for (const base of bases) {
      const url = base.endsWith('/') ? `${base}${id}.png` : `${base}/${id}.png`;
      if (!sources.includes(url)) sources.push(url);
    }
  }
  return sources;
}

function hasPendingSwitch(value: any): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasPendingSwitch);
  if (typeof value === 'object') return Object.values(value).some(hasPendingSwitch);
  if (typeof value === 'boolean') return value;
  return false;
}

function sanitizeLogLine(line: string): string {
  return line.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function isFainted(pkm: any): boolean {
  if (!pkm) return false;
  if (typeof pkm.fainted === 'boolean') return pkm.fainted;
  if (typeof pkm.condition === 'string') return pkm.condition.startsWith('0/');
  if (Number.isFinite(pkm.hp) && Number.isFinite(pkm.maxhp)) return pkm.hp <= 0;
  if (Number.isFinite(pkm.currentHp)) return pkm.currentHp <= 0;
  if (Number.isFinite(pkm.currentHP)) return pkm.currentHP <= 0;
  return false;
}

function getPromptSide(payload: PromptActionPayload | null, playerIds?: Record<SideId, string | undefined>): SideId | null {
  if (!payload?.prompt) return null;
  // First try direct side ID
  const directSide = coerceSideId(payload.prompt.side?.id ?? payload.prompt.sideID ?? payload.prompt.sideId ?? payload.prompt.side);
  if (directSide) return directSide;
  // Try matching playerId to known player IDs
  const promptPlayerId = payload.playerId?.toLowerCase?.();
  if (promptPlayerId && playerIds) {
    if (playerIds.p1?.toLowerCase?.() === promptPlayerId) return 'p1';
    if (playerIds.p2?.toLowerCase?.() === promptPlayerId) return 'p2';
  }
  // Try matching side field as playerId
  const sideAsPlayerId = (typeof payload.prompt.side === 'string' ? payload.prompt.side : '')?.toLowerCase?.();
  if (sideAsPlayerId && playerIds) {
    if (playerIds.p1?.toLowerCase?.() === sideAsPlayerId) return 'p1';
    if (playerIds.p2?.toLowerCase?.() === sideAsPlayerId) return 'p2';
  }
  // Try to detect side from pokemon idents (e.g. "p2: Bulbasaur")
  const pokemon = payload.prompt?.pokemon;
  if (Array.isArray(pokemon) && pokemon.length > 0) {
    const firstIdent = pokemon[0]?.ident || '';
    if (firstIdent.startsWith('p1:')) return 'p1';
    if (firstIdent.startsWith('p2:')) return 'p2';
  }
  return null;
}

function pickPromptRequestForSide(payload: PromptActionPayload | null, side: SideId, playerIds: Record<SideId, string | undefined>): any {
  if (!payload) return undefined;
  const queue: any[] = [];
  const seen = new Set<any>();
  const push = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    queue.push(value);
  };
  const normalizePlayer = (value: any): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : '');
  const sidePlayerId = playerIds[side]?.toLowerCase?.() || '';
  
  // Helper to detect side from pokemon idents
  const detectSideFromPokemonIdents = (obj: any): SideId | null => {
    const pokemon = obj?.pokemon;
    if (Array.isArray(pokemon) && pokemon.length > 0) {
      const firstIdent = pokemon[0]?.ident || '';
      if (firstIdent.startsWith('p1:')) return 'p1';
      if (firstIdent.startsWith('p2:')) return 'p2';
    }
    return null;
  };
  
  const root = payload.prompt ?? payload;
  if (Array.isArray(root)) root.forEach(push);
  else push(root);
  if (root && typeof root === 'object') {
    if (root[side]) push(root[side]);
    if (root.requests && typeof root.requests === 'object') {
      if (Array.isArray(root.requests)) root.requests.forEach(push);
      else {
        if (root.requests[side]) push(root.requests[side]);
        if (root.requests.p1) push(root.requests.p1);
        if (root.requests.p2) push(root.requests.p2);
      }
    }
  }
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    const currentSide = coerceSideId(current?.side?.id ?? current?.sideID ?? current?.sideId ?? current?.side ?? current?.playerSide ?? current?.slotSide ?? current?.choiceSide);
    if (currentSide === side) return coerceRequestObject(current);
    
    // Check Pokemon idents to detect side
    const identSide = detectSideFromPokemonIdents(current);
    if (identSide === side) return coerceRequestObject(current);
    
    const identifiers = [
      current?.playerId,
      current?.userid,
      current?.userId,
      current?.user?.id,
      current?.player?.id,
      current?.player,
      current?.actorPlayerId,
      current?.targetPlayerId,
      current?.side?.playerId,
    ]
      .map(normalizePlayer)
      .filter(Boolean);
    if (sidePlayerId && identifiers.some(id => id.toLowerCase() === sidePlayerId)) return coerceRequestObject(current);
    if (Array.isArray(current?.list)) current.list.forEach(push);
    if (Array.isArray(current?.choices)) current.choices.forEach(push);
    if (Array.isArray(current?.requests)) current.requests.forEach(push);
    if (current?.requests && typeof current.requests === 'object') {
      if (current.requests[side]) push(current.requests[side]);
      if (current.requests.p1) push(current.requests.p1);
      if (current.requests.p2) push(current.requests.p2);
    }
    if (Array.isArray(current?.sides)) current.sides.forEach(push);
    if (current?.pending) {
      if (Array.isArray(current.pending)) current.pending.forEach(push);
      else if (current.pending[side]) push(current.pending[side]);
    }
    if (current?.prompt) push(current.prompt);
    if (current?.p1) push(current.p1);
    if (current?.p2) push(current.p2);
  }
  return undefined;
}

function formatDeadline(deadline?: number | null): string | null {
  if (!deadline) return null;
  const remaining = Math.max(0, deadline - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  return `${seconds}s`;
}

function getSideRoster(state: any, request: any, side: SideId, sidePlayerId?: string): any[] {
  const requestObj = coerceRequestObject(request);
  const idx = side === 'p1' ? 0 : 1;
  const players = Array.isArray(state?.players) ? state.players : [];
  // Find player by ID if provided, otherwise try by index  
  const player = sidePlayerId 
    ? (players.find((p: any) => p?.id === sidePlayerId) || players[idx])
    : players[idx];

  // Diagnostic: warn if player lookup resolved to the wrong index
  if (sidePlayerId && players.length >= 2 && player === players[1 - idx]) {
    console.warn(`[getSideRoster] Side ${side} resolved to wrong player index!`, {
      sidePlayerId, expectedIdx: idx, actualPlayer: player?.id,
      players: players.map((p: any) => p?.id),
    });
  }

  // PRIORITY: When battle state has player.team AND activeIndex, use that as authoritative source
  // This ensures roster indices match activeIndex from battle state
  if (player?.team?.length && typeof player.activeIndex === 'number') {
    return coercePokemonList(player.team);
  }

  // Check side.pokemon first (standard format)
  const directRequest = coercePokemonList(requestObj?.side?.pokemon);
  if (directRequest.length) return directRequest;
  // Also check top-level pokemon (prompt format)
  const topLevelPokemon = coercePokemonList(requestObj?.pokemon);
  if (topLevelPokemon.length) return topLevelPokemon;

  const statePriority: any[][] = [
    coercePokemonList(state?.sides?.[idx]?.pokemon),
    coercePokemonList(state?.sides?.[idx]?.team),
    coercePokemonList(state?.sides?.[side]?.pokemon),
    coercePokemonList(state?.sides?.[side]?.team),
    coercePokemonList(state?.field?.sides?.[idx]?.pokemon),
    coercePokemonList(state?.field?.sides?.[side]?.pokemon),
    coercePokemonList(state?.field?.teams?.[idx]),
    coercePokemonList(state?.field?.teams?.[side]),
    coercePokemonList(state?.teams?.[idx]),
    coercePokemonList(state?.teams?.[side]),
    coercePokemonList(state?.team?.[idx]),
    coercePokemonList(state?.team?.[side]),
    coercePokemonList(state?.[side]?.pokemon),
    coercePokemonList(state?.[side]?.team),
    coercePokemonList(state?.rosters?.[idx]),
    coercePokemonList(state?.rosters?.[side]),
    coercePokemonList(state?.parties?.[idx]),
    coercePokemonList(state?.parties?.[side]),
  ];

  const playerPriority: any[][] = [
    coercePokemonList(player?.team),
    coercePokemonList(player?.pokemon),
    coercePokemonList(player?.party),
    coercePokemonList(player?.roster),
    coercePokemonList(player?.side?.team),
    coercePokemonList(player?.side?.pokemon),
    coercePokemonList(player?.data?.team),
    coercePokemonList(player?.data?.pokemon),
  ];

  const candidateLists: any[][] = [...statePriority, ...playerPriority];

  for (const list of candidateLists) {
    if (list.length) return list;
  }

  return [];
}

function buildRosterEntries(state: any, request: any, side: SideId, sidePlayerId?: string): RosterEntry[] {
  const rosterRaw = getSideRoster(state, coerceRequestObject(request), side, sidePlayerId);
  const roster = Array.isArray(rosterRaw) ? rosterRaw : [];
  const activeIndices = new Set<number>();
  const normalizeIndex = (value: number) => {
    if (!Number.isFinite(value)) return null;
    if (value < 0) return null;
    if (value === 0) return roster.length ? 0 : null;
    const candidate = value - 1;
    if (candidate >= 0 && candidate < roster.length) return candidate;
    if (value < roster.length) return value;
    return null;
  };
  const matchById = (identifier: string | undefined | null) => {
    if (!identifier) return null;
    const lower = identifier.toLowerCase();
    return roster.findIndex((pkm: any) => {
      const candidates = [pkm?.id, pkm?.ident, pkm?.pokemonId, pkm?.uuid]
        .filter(Boolean)
        .map((value: any) => String(value).toLowerCase());
      if (candidates.includes(lower)) return true;
      const species = speciesFromPokemon(pkm).toLowerCase();
      return species && species === lower;
    });
  };
  const registerActiveHint = (hint: any) => {
    if (hint === undefined || hint === null) return;
    if (Array.isArray(hint)) {
      hint.forEach(registerActiveHint);
      return;
    }
    if (typeof hint === 'number') {
      const normalized = normalizeIndex(Math.trunc(hint));
      if (normalized !== null) activeIndices.add(normalized);
      return;
    }
    if (typeof hint === 'string') {
      const directNumber = Number(hint);
      if (Number.isFinite(directNumber)) {
        registerActiveHint(directNumber);
        return;
      }
      const digitMatch = hint.match(/(\d+)/);
      if (digitMatch) {
        const parsed = Number(digitMatch[1]);
        if (Number.isFinite(parsed)) {
          registerActiveHint(parsed - 1);
          return;
        }
      }
      const idxById = matchById(hint);
      if (idxById !== -1 && idxById !== null) {
        activeIndices.add(idxById);
      }
      return;
    }
    if (typeof hint === 'object') {
      registerActiveHint((hint as any).index);
      registerActiveHint((hint as any).slot);
      registerActiveHint((hint as any).position);
      registerActiveHint((hint as any).pokemonIndex);
      registerActiveHint((hint as any).teamIndex);
      registerActiveHint((hint as any).slotIndex);
      registerActiveHint((hint as any).activeIndex);
      registerActiveHint((hint as any).primaryIndex);
      registerActiveHint((hint as any).secondaryIndex);
      const idMatch = matchById((hint as any).id || (hint as any).pokemonId || (hint as any).ident || (hint as any).slotId);
      if (idMatch !== null && idMatch !== -1) {
        activeIndices.add(idMatch);
        return;
      }
      if (Array.isArray((hint as any).pokemon)) registerActiveHint((hint as any).pokemon);
      if (typeof (hint as any).name === 'string') {
        const idxFromName = roster.findIndex((pkm: any) => (pkm?.name || speciesFromPokemon(pkm)).toLowerCase() === (hint as any).name.toLowerCase());
        if (idxFromName >= 0) activeIndices.add(idxFromName);
      }
      return;
    }
  };
  const markActiveFlags = (list: any[]) => {
    list.forEach((pokemon: any, idx: number) => {
      if (pokemon?.active || pokemon?.isActive) activeIndices.add(idx);
      if (Number.isInteger(pokemon?.activeIndex)) registerActiveHint(pokemon.activeIndex);
      if (Number.isInteger(pokemon?.slot)) registerActiveHint(pokemon.slot - 1);
    });
  };

  markActiveFlags(coercePokemonList(request?.side?.pokemon));
  registerActiveHint(request?.active);
  registerActiveHint(request?.side?.active);

  const playerCandidates = Array.isArray(state?.players) ? state.players : [];
  const playerIdx = side === 'p1' ? 0 : 1;
  const player = playerCandidates[playerIdx];
  registerActiveHint(player?.activeIndex);
  registerActiveHint(player?.activeIndices); // doubles/triples: array of active indices
  registerActiveHint(player?.active);

  registerActiveHint(state?.sides?.[playerIdx]?.active);
  registerActiveHint(state?.sides?.[side]?.active);
  registerActiveHint(state?.field?.sides?.[playerIdx]?.active);
  registerActiveHint(state?.field?.sides?.[side]?.active);
  registerActiveHint(state?.field?.active?.[playerIdx]);
  registerActiveHint(state?.field?.active?.[side]);
  registerActiveHint(state?.active?.[playerIdx]);
  registerActiveHint(state?.active?.[side]);
  registerActiveHint(state?.[side]?.active);

  if (!activeIndices.size && roster.length) {
    activeIndices.add(0);
  }
  return roster.map((pokemon: any, index: number) => ({ pokemon, slot: index + 1, isActive: activeIndices.has(index) }));
}

function shortName(entity: PlayerSummary | null | undefined, fallback = 'Trainer'): string {
  if (!entity) return fallback;
  return entity.username || entity.name || entity.id || fallback;
}

export function SimpleBattleTab({ roomId, title }: { roomId: string; title?: string }) {
  const client = useMemo(() => getClient(), []);
  const [battleState, setBattleState] = useState<any>(() => client.getBattleState(roomId));
  const [phase, setPhase] = useState(() => client.getBattlePhase(roomId));
  const [phaseTick, setPhaseTick] = useState(0);
  const [log, setLog] = useState<string[]>(() => client.getBattleLog(roomId));
  const initialPrompt = client.getPrompt(roomId);
  const [prompt, setPrompt] = useState<PromptActionPayload | null>(initialPrompt);
  const makeEmptyRequests = (): RequestMap => ({ p1: undefined, p2: undefined });
  const initialPlayerIds = derivePlayerIdsFromState(client.getBattleState(roomId));
  const [requestBySide, setRequestBySide] = useState<RequestMap>(() => {
    const base = makeEmptyRequests();
    const side = getPromptSide(initialPrompt, initialPlayerIds);
    if (side) base[side] = initialPrompt?.prompt;
    return base;
  });
  const [teamPreviewOrder, setTeamPreviewOrder] = useState<number[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<PlayerSummary[]>(() => normalizeRoomPlayers(pickRoomPlayers(client.getRooms(), roomId)));
  const [playerIds, setPlayerIds] = useState<Record<SideId, string | undefined>>(() => derivePlayerIdsFromState(client.getBattleState(roomId)));
  const playerIdsRef = useRef(playerIds);
  const [mySide, setMySide] = useState<SideId | null>(() => inferSideFromState(client.getBattleState(roomId), client.user?.id));
  const [needsSwitch, setNeedsSwitch] = useState<any>(() => client.getBattleNeedsSwitch(roomId));
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => client.getChat(roomId));
  const [chatInput, setChatInput] = useState('');
  const [battleEnded, setBattleEnded] = useState(false);
  const [battleResult, setBattleResult] = useState<{ winner?: string; replayId?: string } | null>(null);
  
  // Pending action state - tracks when waiting for server response
  type PendingAction = { type: 'move' | 'switch' | 'lead'; label: string; timestamp: number } | null;
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // Auto-clear pending action after 30s timeout (server may have missed it)
  useEffect(() => {
    if (!pendingAction) return;
    const timer = window.setTimeout(() => {
      console.warn('[SimpleBattleTab] Pending action timed out after 30s, clearing');
      setPendingAction(null);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [pendingAction]);

  // Stat boost tracking for hover tooltips - tracks per-pokemon boost stages
  type BoostStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';
  type BoostMap = Record<string, Partial<Record<BoostStat, number>>>;
  const [statBoosts, setStatBoosts] = useState<BoostMap>({});

  // Side conditions tracking (hazards, screens, etc.)
  type SideCondition = 'stealthrock' | 'spikes' | 'toxicspikes' | 'stickyweb' | 'reflect' | 'lightscreen' | 'auroraveil' | 'tailwind' | 'safeguard' | 'mist';
  type SideConditionMap = Record<SideId, Partial<Record<SideCondition, number>>>;
  const [sideConditions, setSideConditions] = useState<SideConditionMap>({ p1: {}, p2: {} });

  // Volatile status tracking per pokemon (confusion, taunt, etc.)
  type VolatileStatus = 'confusion' | 'leechseed' | 'taunt' | 'encore' | 'disable' | 'torment' | 'attract' | 'substitute' | 'curse' | 'yawn' | 'perishsong' | 'focusenergy' | 'magnetrise';
  type VolatileMap = Record<string, Set<VolatileStatus>>;
  const [volatileStatuses, setVolatileStatuses] = useState<VolatileMap>({});

  // Effectiveness flash text
  const [effectivenessText, setEffectivenessText] = useState<{ side: SideId; text: string; type: 'super' | 'resisted' | 'immune' | 'crit' } | null>(null);
  const [hoveredPokemon, setHoveredPokemon] = useState<string | null>(null);

  // Move boost toggles (Mega/Z-Move/Dynamax/Terastallize)
  const [moveBoosts, setMoveBoosts] = useState<{ mega: boolean; z: boolean; max: boolean; tera: boolean }>({ mega: false, z: false, max: false, tera: false });
  
  // Animation state - tracks which pokemon should have animation classes applied
  type AnimType = 'attack' | 'contact' | 'breath' | 'special' | 'projectile' | 'slash' | 'punch' | 'kick' | 'bite' | 'spin' | 'sound' | 'damage' | 'super-effective' | 'faint' | 'switch-in' | 'switch-out' | 'heal' | 'critical' | 'boost' | 'drop' | 'status' | 'protect' | 'miss' | 'recoil' | 'confusion' | 'weather' | 'charge';
  const [activeAnims, setActiveAnims] = useState<Record<string, AnimType>>({});
  const animTimeoutsRef = useRef<Map<string, number>>(new Map());

  // Move classification for animation types
  const classifyMoveForAnimation = (moveName: string): AnimType => {
    const move = moveName.toLowerCase();
    
    // Breath/Beam attacks
    if (/breath|beam|ray|blast|flamethrower|ice beam|thunderbolt|hyper beam|solar beam|dragon breath|fire blast|hydro pump|blizzard|thunder|psychic|dark pulse|flash cannon|energy ball|shadow ball|aura sphere|focus blast|sludge bomb|moonblast|dazzling gleam/i.test(move)) {
      return 'breath';
    }
    // Contact/physical moves that make contact
    if (/tackle|slam|body|take down|double.?edge|giga impact|wild charge|flare blitz|brave bird|head smash|wood hammer/i.test(move)) {
      return 'contact';
    }
    // Slash/Claw attacks
    if (/slash|claw|cut|fury|x-scissor|leaf blade|psycho cut|night slash|cross chop|sacred sword|secret sword|aerial ace/i.test(move)) {
      return 'slash';
    }
    // Punch attacks
    if (/punch|mach|mega punch|comet punch|fire punch|ice punch|thunder punch|sky uppercut|focus punch|drain punch|hammer arm|power-up punch|meteor mash/i.test(move)) {
      return 'punch';
    }
    // Kick attacks
    if (/kick|stomp|jump kick|high jump kick|low kick|blaze kick|mega kick|triple kick/i.test(move)) {
      return 'kick';
    }
    // Bite attacks
    if (/bite|fang|crunch|jaw|chomp/i.test(move)) {
      return 'bite';
    }
    // Spin attacks
    if (/spin|roll|gyro|rapid spin/i.test(move)) {
      return 'spin';
    }
    // Sound attacks
    if (/sound|sing|screech|growl|roar|hyper voice|uproar|echoed voice|boomburst|clanging|disarming voice|bug buzz|chatter|snarl|round|relic song|perish song/i.test(move)) {
      return 'sound';
    }
    // Projectile attacks
    if (/ball|shot|barrage|bullet|seed|rock|stone|spike|pin|needle|icicle|spike|mud|water gun|ember|powder snow|psybeam|signal beam|charge beam/i.test(move)) {
      return 'projectile';
    }
    // Special category moves (glow effect)
    if (/psychic|telekinesis|confusion|extrasensory|psyshock|dream eater|hypnosis|calm mind|nasty plot|quiver dance/i.test(move)) {
      return 'special';
    }
    // Default to basic attack
    return 'attack';
  };

  const triggerAnim = useCallback((key: string, anim: AnimType, durationMs = 400) => {
    // Clear any existing timeout for this key
    const existingTimeout = animTimeoutsRef.current.get(key);
    if (existingTimeout) window.clearTimeout(existingTimeout);
    
    setActiveAnims(prev => ({ ...prev, [key]: anim }));
    const timeout = window.setTimeout(() => {
      setActiveAnims(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      animTimeoutsRef.current.delete(key);
    }, durationMs);
    animTimeoutsRef.current.set(key, timeout);
  }, []);

  // Parse stat boost/unboost from battle log and track them
  const processStatChanges = useCallback((line: string) => {
    if (!line) return;
    
    // Match Showdown protocol: |-boost|p1a: Charizard|atk|2
    const boostMatch = line.match(/\|-boost\|p([12])a?:\s*([^|]+)\|([^|]+)\|(\d+)/i);
    if (boostMatch) {
      const side = `p${boostMatch[1]}`;
      const pokemonName = boostMatch[2].trim();
      const stat = boostMatch[3].toLowerCase() as BoostStat;
      const stages = parseInt(boostMatch[4], 10);
      const key = `${side}-${pokemonName}`;
      setStatBoosts(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [stat]: Math.min(6, (prev[key]?.[stat] || 0) + stages)
        }
      }));
      return;
    }
    
    // Match Showdown protocol: |-unboost|p1a: Charizard|def|1
    const unboostMatch = line.match(/\|-unboost\|p([12])a?:\s*([^|]+)\|([^|]+)\|(\d+)/i);
    if (unboostMatch) {
      const side = `p${unboostMatch[1]}`;
      const pokemonName = unboostMatch[2].trim();
      const stat = unboostMatch[3].toLowerCase() as BoostStat;
      const stages = parseInt(unboostMatch[4], 10);
      const key = `${side}-${pokemonName}`;
      setStatBoosts(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [stat]: Math.max(-6, (prev[key]?.[stat] || 0) - stages)
        }
      }));
      return;
    }
    
    // Match English text: "Charizard's Attack rose!" or "Charizard's Defense harshly fell!"
    const textBoostMatch = line.match(/([^']+)'s\s+(Attack|Defense|Special Attack|Special Defense|Speed|Sp\. Atk|Sp\. Def|accuracy|evasion)\s+(rose|sharply rose|drastically rose|fell|harshly fell|severely fell)/i);
    if (textBoostMatch) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}`;
        const pokemonName = textBoostMatch[1].trim();
        const statText = textBoostMatch[2].toLowerCase();
        const change = textBoostMatch[3].toLowerCase();
        
        // Map stat names
        const statMap: Record<string, BoostStat> = {
          'attack': 'atk', 'defense': 'def', 'special attack': 'spa', 'special defense': 'spd',
          'sp. atk': 'spa', 'sp. def': 'spd', 'speed': 'spe', 'accuracy': 'accuracy', 'evasion': 'evasion'
        };
        const stat = statMap[statText] || 'atk';
        
        // Determine stages based on text
        let stages = 1;
        if (change.includes('sharply') || change.includes('harshly')) stages = 2;
        if (change.includes('drastically') || change.includes('severely')) stages = 3;
        if (change.includes('fell')) stages = -stages;
        
        const key = `${side}-${pokemonName}`;
        setStatBoosts(prev => ({
          ...prev,
          [key]: {
            ...(prev[key] || {}),
            [stat]: Math.max(-6, Math.min(6, (prev[key]?.[stat] || 0) + stages))
          }
        }));
      }
      return;
    }
    
    // Clear boosts on switch: |-clearboost|p1a: Charizard or switch|p1a: Pikachu
    const clearMatch = line.match(/\|-clearboost\|p([12])a?:\s*([^|]+)/i);
    const switchMatch = line.match(/\|switch\|p([12])a?:\s*([^|,]+)/i);
    if (clearMatch || switchMatch) {
      const match = clearMatch || switchMatch;
      if (match) {
        const side = `p${match[1]}`;
        // Clear all boosts for any pokemon on this side
        setStatBoosts(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(key => {
            if (key.startsWith(`${side}-`)) {
              delete next[key];
            }
          });
          return next;
        });
        // Clear volatiles on switch
        setVolatileStatuses(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(key => {
            if (key.startsWith(`${side}-`)) {
              delete next[key];
            }
          });
          return next;
        });
      }
    }

    // Side conditions: |-sidestart|p1|Stealth Rock
    const sideStartMatch = line.match(/\|-sidestart\|p([12])\|([^|]+)/i);
    if (sideStartMatch) {
      const side = `p${sideStartMatch[1]}` as SideId;
      const conditionRaw = sideStartMatch[2].toLowerCase().replace(/\s+/g, '');
      const conditionMap: Record<string, SideCondition> = {
        stealthrock: 'stealthrock', spikes: 'spikes', toxicspikes: 'toxicspikes',
        stickyweb: 'stickyweb', reflect: 'reflect', lightscreen: 'lightscreen',
        auroraveil: 'auroraveil', tailwind: 'tailwind', safeguard: 'safeguard', mist: 'mist'
      };
      const condition = conditionMap[conditionRaw];
      if (condition) {
        setSideConditions(prev => ({
          ...prev,
          [side]: { ...prev[side], [condition]: (prev[side][condition] || 0) + 1 }
        }));
      }
    }

    // Side condition end: |-sideend|p1|Reflect
    const sideEndMatch = line.match(/\|-sideend\|p([12])\|([^|]+)/i);
    if (sideEndMatch) {
      const side = `p${sideEndMatch[1]}` as SideId;
      const conditionRaw = sideEndMatch[2].toLowerCase().replace(/\s+/g, '');
      setSideConditions(prev => {
        const copy = { ...prev[side] };
        delete copy[conditionRaw as SideCondition];
        return { ...prev, [side]: copy };
      });
    }

    // Volatile status start: |-start|p1a: Charizard|confusion
    const volatileStartMatch = line.match(/\|-start\|p([12])a?:\s*([^|]+)\|([^|]+)/i);
    if (volatileStartMatch) {
      const side = `p${volatileStartMatch[1]}`;
      const pokemonName = volatileStartMatch[2].trim();
      const volatileRaw = volatileStartMatch[3].toLowerCase().replace(/\s+/g, '');
      const volatileMap: Record<string, VolatileStatus> = {
        confusion: 'confusion', leechseed: 'leechseed', taunt: 'taunt', encore: 'encore',
        disable: 'disable', torment: 'torment', attract: 'attract', substitute: 'substitute',
        curse: 'curse', yawn: 'yawn', perishsong: 'perishsong', focusenergy: 'focusenergy',
        magnetrise: 'magnetrise'
      };
      const volatile = volatileMap[volatileRaw];
      if (volatile) {
        const key = `${side}-${pokemonName}`;
        setVolatileStatuses(prev => {
          const existing = prev[key] || new Set();
          const next = new Set(existing);
          next.add(volatile);
          return { ...prev, [key]: next };
        });
      }
    }

    // Volatile status end: |-end|p1a: Charizard|confusion
    const volatileEndMatch = line.match(/\|-end\|p([12])a?:\s*([^|]+)\|([^|]+)/i);
    if (volatileEndMatch) {
      const side = `p${volatileEndMatch[1]}`;
      const pokemonName = volatileEndMatch[2].trim();
      const volatileRaw = volatileEndMatch[3].toLowerCase().replace(/\s+/g, '');
      const key = `${side}-${pokemonName}`;
      setVolatileStatuses(prev => {
        const existing = prev[key];
        if (!existing) return prev;
        const next = new Set(existing);
        next.delete(volatileRaw as VolatileStatus);
        return { ...prev, [key]: next };
      });
    }
  }, []);

  // Parse log lines and trigger animations
  const processLogForAnimations = useCallback((line: string) => {
    if (!line) return;
    const lower = line.toLowerCase();
    
    // Also process stat changes
    processStatChanges(line);
    
    // Extract move name from log line for classification
    const moveMatch = line.match(/used\s+([^!]+)!/i) || line.match(/\|move\|[^|]+\|([^|]+)/i);
    const moveName = moveMatch?.[1]?.trim() || '';
    
    // Attack/move use patterns - classify the move type
    if (lower.includes('used') || lower.match(/\|move\|/)) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        const animType = moveName ? classifyMoveForAnimation(moveName) : 'attack';
        triggerAnim(`${side}-active`, animType, animType === 'breath' ? 500 : animType === 'contact' ? 500 : 400);
      }
    }
    
    // Super effective damage
    if (lower.includes('super effective') || lower.includes('supereffective') || lower.includes('|-supereffective|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const attackerSide = `p${sideMatch[1]}` as SideId;
        const defenderSide = attackerSide === 'p1' ? 'p2' : 'p1';
        triggerAnim(`${defenderSide}-active`, 'super-effective', 500);
        setEffectivenessText({ side: defenderSide, text: "It's super effective!", type: 'super' });
        setTimeout(() => setEffectivenessText(null), 1500);
        return; // Don't also trigger normal damage
      }
    }

    // Resisted damage
    if (lower.includes('resisted') || lower.includes('not very effective') || lower.includes('|-resisted|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const defenderSide = `p${sideMatch[1]}` as SideId;
        setEffectivenessText({ side: defenderSide, text: "It's not very effective...", type: 'resisted' });
        setTimeout(() => setEffectivenessText(null), 1500);
      }
    }

    // Immune
    if (lower.includes('immune') || lower.includes('doesn\'t affect') || lower.includes('|-immune|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const defenderSide = `p${sideMatch[1]}` as SideId;
        setEffectivenessText({ side: defenderSide, text: "It doesn't affect...", type: 'immune' });
        setTimeout(() => setEffectivenessText(null), 1500);
      }
    }
    
    // Damage patterns
    if ((lower.includes('lost') && lower.includes('%')) || lower.includes('|-damage|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'damage', 350);
      }
    }
    
    // Recoil damage
    if (lower.includes('recoil') || lower.includes('is hurt by recoil')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'recoil', 400);
      }
    }
    
    // Miss patterns
    if (lower.includes('avoided') || lower.includes('missed') || lower.includes('|-miss|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const attackerSide = `p${sideMatch[1]}` as SideId;
        const defenderSide = attackerSide === 'p1' ? 'p2' : 'p1';
        triggerAnim(`${defenderSide}-active`, 'miss', 400);
      }
    }
    
    // Protect/Detect patterns
    if (lower.includes('protected') || lower.includes('protect') || lower.includes('detect') || lower.includes('|-fail|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'protect', 400);
      }
    }
    
    // Confusion self-hit
    if (lower.includes('hurt itself') || lower.includes('confused')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'confusion', 400);
      }
    }
    
    // Weather damage (sandstorm, hail)
    if (lower.includes('buffeted') || lower.includes('hail') || lower.includes('sandstorm')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'weather', 350);
      }
    }
    
    // Charging moves (Solar Beam, Skull Bash, etc)
    if (lower.includes('is charging') || lower.includes('took in sunlight') || lower.includes('tucked in its head') || lower.includes('began focusing')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'charge', 600);
      }
    }
    
    // Faint patterns
    if (lower.includes('fainted') || lower.includes('|faint|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'faint', 700);
      }
    }
    
    // Switch patterns
    if (lower.includes('sent out') || lower.includes('|switch|') || lower.includes('|drag|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'switch-in', 450);
      }
    }
    
    // Heal patterns
    if (lower.includes('restored') || lower.includes('healed') || lower.includes('|heal|') || lower.includes('|-heal|') || lower.includes('regained health')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'heal', 550);
      }
    }
    
    // Critical hit
    if (lower.includes('critical hit') || lower.includes('|-crit|')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const attackerSide = `p${sideMatch[1]}` as SideId;
        const defenderSide = attackerSide === 'p1' ? 'p2' : 'p1';
        triggerAnim(`${defenderSide}-active`, 'critical', 450);
        setEffectivenessText({ side: defenderSide, text: 'A critical hit!', type: 'crit' });
        setTimeout(() => setEffectivenessText(null), 1500);
      }
    }
    
    // Stat boost patterns
    if (lower.includes('rose') || lower.includes('|-boost|') || lower.includes('sharply') || lower.includes('drastically')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'boost', 450);
      }
    }
    
    // Stat drop patterns
    if (lower.includes('fell') || lower.includes('|-unboost|') || lower.includes('harshly') || lower.includes('severely')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'drop', 450);
      }
    }
    
    // Status inflict patterns
    if (lower.includes('paralyzed') || lower.includes('burned') || lower.includes('poisoned') || 
        lower.includes('fell asleep') || lower.includes('frozen') || lower.includes('|-status|') ||
        lower.includes('badly poisoned')) {
      const sideMatch = line.match(/p([12])a?:/i);
      if (sideMatch) {
        const side = `p${sideMatch[1]}` as SideId;
        triggerAnim(`${side}-active`, 'status', 450);
      }
    }
  }, [triggerAnim]);

  // Helper to get animation class for a side
  const getAnimClass = (side: SideId): string => {
    const anim = activeAnims[`${side}-active`];
    if (!anim) return '';
    const isAttacker = mySide === side;
    const classMap: Record<AnimType, string> = {
      'attack': isAttacker ? 'ps-anim-attack-forward' : 'ps-anim-attack-backward',
      'contact': isAttacker ? 'ps-anim-contact-forward' : 'ps-anim-contact-backward',
      'breath': 'ps-anim-breath',
      'special': 'ps-anim-special',
      'projectile': 'ps-anim-projectile',
      'slash': 'ps-anim-slash',
      'punch': 'ps-anim-punch',
      'kick': 'ps-anim-kick',
      'bite': 'ps-anim-bite',
      'spin': 'ps-anim-spin',
      'sound': 'ps-anim-sound',
      'damage': 'ps-anim-damage',
      'super-effective': 'ps-anim-super-effective',
      'faint': 'ps-anim-faint',
      'switch-in': 'ps-anim-switch-in',
      'switch-out': 'ps-anim-switch-out',
      'heal': 'ps-anim-heal',
      'critical': 'ps-anim-critical',
      'boost': 'ps-anim-boost',
      'drop': 'ps-anim-drop',
      'status': 'ps-anim-status',
      'protect': 'ps-anim-protect',
      'miss': 'ps-anim-miss',
      'recoil': 'ps-anim-recoil',
      'confusion': 'ps-anim-confusion',
      'weather': 'ps-anim-weather',
      'charge': 'ps-anim-charge',
    };
    return classMap[anim] || '';
  };

  useEffect(() => {
    const room = client.getRooms().find(r => r.id === roomId);
    const participant = room?.players?.some(p => p.id === client.user?.id);
    if (!participant) {
      client.joinRoom(roomId, 'spectator');
    }
    
    // On mount, check if there's a cached prompt with state and apply it
    // This handles the race condition where promptAction arrives before component mounts
    const cachedPrompt = client.getPrompt(roomId);
    if (cachedPrompt) {
      console.log('[SimpleBattleTab] Applying cached prompt on mount:', { roomId, hasState: !!(cachedPrompt as any).state });
      setPrompt(cachedPrompt);
      if ((cachedPrompt as any).state) {
        const state = (cachedPrompt as any).state;
        setBattleState(state);
        const derived = derivePlayerIdsFromState(state);
        setPlayerIds(derived);
        const inferred = inferSideFromState(state, client.user?.id);
        if (inferred) setMySide(inferred);
      }
      // Also set the request for the side
      const freshIds = derivePlayerIdsFromState((cachedPrompt as any).state);
      const side = getPromptSide(cachedPrompt, freshIds);
      if (side && cachedPrompt.prompt) {
        setRequestBySide(prev => ({ ...prev, [side]: cachedPrompt.prompt }));
      }
    }
  }, [client, roomId]);

  useEffect(() => {
    setPhaseTick(0);
    if (!phase?.deadline) return;
    const timer = window.setInterval(() => setPhaseTick(t => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase?.deadline]);

  const prevLogLengthRef = useRef(0);
  
  const refreshLog = useCallback(() => {
    const newLog = client.getBattleLog(roomId);
    // Process new lines for animations
    const prevLength = prevLogLengthRef.current;
    if (newLog.length > prevLength) {
      const newLines = newLog.slice(prevLength);
      newLines.forEach(line => processLogForAnimations(line));
    }
    prevLogLengthRef.current = newLog.length;
    setLog(newLog);
  }, [client, roomId, processLogForAnimations]);

  const handleLineupRefresh = () => {
    const freshState = client.getBattleState(roomId);
    applyBattleState(freshState);
    if (freshState) {
      const derived = deriveRequestsFromState(freshState);
      setRequestBySide(prev => {
        let changed = false;
        const next = { ...prev } as RequestMap;
        (['p1', 'p2'] as SideId[]).forEach(side => {
          const incomingRaw = derived[side];
          if (incomingRaw === undefined) return;
          const incoming = coerceRequestObject(incomingRaw);
          if (incoming !== prev[side]) {
            next[side] = incoming;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
    const freshPrompt = client.getPrompt(roomId);
    if (freshPrompt) setPrompt(freshPrompt);
    setNeedsSwitch(client.getBattleNeedsSwitch(roomId));
    refreshLog();
  };

  const applyBattleState = (state: any) => {
    console.log('[applyBattleState] Called with state:', state ? { 
      turn: state.turn, 
      players: state.players?.map((p: any) => ({ id: p.id, activeIndex: p.activeIndex, teamCount: p.team?.length })) 
    } : null);
    if (state) {
      setBattleState(state);
      setPlayerIds(prev => {
        const derived = derivePlayerIdsFromState(state);
        console.log('[applyBattleState] Derived player IDs:', derived);
        if (prev.p1 === derived.p1 && prev.p2 === derived.p2) return prev;
        return { p1: derived.p1, p2: derived.p2 };
      });
      const inferred = inferSideFromState(state, client.user?.id);
      console.log('[applyBattleState] Inferred side:', inferred, 'from userId:', client.user?.id);
      if (inferred && inferred !== mySide) setMySide(inferred);
    }
  };

  useEffect(() => {
    const offRoomsSnapshot = client.on('roomsSnapshot', snapshot => {
      const room = snapshot.find(r => r.id === roomId);
      if (room) setRoomPlayers(normalizeRoomPlayers(room.players || []));
    });
    const offRoomUpdate = client.on('roomUpdate', room => {
      if (room.id === roomId) setRoomPlayers(normalizeRoomPlayers(room.players || []));
    });
    const offRoomRemove = client.on('roomRemove', removedRoomId => {
      if (removedRoomId === roomId) {
        setRoomPlayers([]);
        setBattleState(null);
        setLog([]);
        setPrompt(null);
        setRequestBySide(makeEmptyRequests());
        setPhase(null);
        setNeedsSwitch(null);
        setMySide(null);
        setChatMessages([]);
        setChatInput('');
      }
    });
    const offIdentified = client.on('identified', () => {
      const freshRoom = client.getRooms().find(r => r.id === roomId);
      if (freshRoom) setRoomPlayers(normalizeRoomPlayers(freshRoom.players || []));
      setChatMessages(client.getChat(roomId));
    });
    const offBattleStart = client.on('battleStarted', ({ roomId: startedId, state }) => {
      console.log('[battleStarted] Event received:', { startedId, componentRoomId: roomId, hasState: !!state });
      if (startedId !== roomId) {
        console.log('[battleStarted] Ignoring - roomId mismatch');
        return;
      }
      console.log('[battleStarted] Processing, clearing team preview state');
      setTeamPreviewOrder([]); // Clear team preview selection when battle starts
      setRequestBySide(makeEmptyRequests());
      if (state) {
        applyBattleState(state);
      } else {
        console.warn('[battleStarted] No state in payload!');
      }
      refreshLog();
      setPrompt(null);
      setNeedsSwitch(client.getBattleNeedsSwitch(startedId));
      setChatMessages(client.getChat(roomId));
    });
    const offSpectate = client.on('spectateStart', payload => {
      if (payload.roomId !== roomId) return;
      setRequestBySide(makeEmptyRequests());
      applyBattleState(payload.state);
      refreshLog();
      if (payload.phase) setPhase({ phase: payload.phase, deadline: payload.deadline });
      setNeedsSwitch(client.getBattleNeedsSwitch(payload.roomId));
      setChatMessages(client.getChat(roomId));
    });
    const offBattleUpdate = client.on('battleUpdate', ({ roomId: targetRoomId }) => {
      if (targetRoomId !== roomId) return;
      const freshState = client.getBattleState(targetRoomId);
      applyBattleState(freshState);
      if (freshState) {
        const derived = deriveRequestsFromState(freshState);
        setRequestBySide(prev => {
          let changed = false;
          const next = { ...prev } as RequestMap;
          (['p1', 'p2'] as SideId[]).forEach(side => {
            const incomingRaw = derived[side];
            if (incomingRaw === undefined) return;
            const incoming = coerceRequestObject(incomingRaw);
            if (incoming !== prev[side]) {
              next[side] = incoming;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
      refreshLog();
      setNeedsSwitch(client.getBattleNeedsSwitch(targetRoomId));
      setChatMessages(client.getChat(roomId));
    });
    const offPhase = client.on('phase', ({ roomId: phaseRoomId, payload }) => {
      if (phaseRoomId !== roomId) return;
      setPhase(payload);
    });
    const offPrompt = client.on('promptAction', payload => {
      if (payload.roomId !== roomId) return;
      console.log('[promptAction] Received:', { roomId: payload.roomId, playerId: payload.playerId, hasState: !!(payload as any).state });
      // If the payload includes state, apply it immediately
      if ((payload as any).state) {
        console.log('[promptAction] Applying state from payload');
        applyBattleState((payload as any).state);
      }
      setPrompt(payload);
      // Clear pending action when new prompt arrives (action was processed)
      setPendingAction(null);
      // Get fresh player IDs from battle state in case ref isn't updated yet
      const freshState = (payload as any).state || client.getBattleState(roomId);
      const freshIds = freshState ? derivePlayerIdsFromState(freshState) : playerIdsRef.current;
      const latestIds = (freshIds.p1 || freshIds.p2) ? freshIds : playerIdsRef.current;
      const side = getPromptSide(payload, latestIds);
      const planned: Partial<RequestMap> = {};
      (['p1', 'p2'] as SideId[]).forEach(candidate => {
        const request = pickPromptRequestForSide(payload, candidate, latestIds);
        if (request) planned[candidate] = request;
      });
      if (side && !planned[side] && payload.prompt) planned[side] = coerceRequestObject(payload.prompt);
      if (Object.keys(planned).length) {
        setRequestBySide(prev => {
          let changed = false;
          const next = { ...prev } as RequestMap;
          (['p1', 'p2'] as SideId[]).forEach(candidate => {
            const req = planned[candidate];
            if (req) {
              const normalized = coerceRequestObject(req);
              if (normalized && normalized !== prev[candidate]) {
                next[candidate] = normalized;
                changed = true;
              }
            }
          });
          return changed ? next : prev;
        });
      }
      if (side) {
        setPlayerIds(prev => (prev[side] === payload.playerId ? prev : { ...prev, [side]: payload.playerId }));
        if (payload.playerId === client.user?.id) setMySide(side);
      }
      if ((payload as any).needsSwitch !== undefined) {
        setNeedsSwitch((payload as any).needsSwitch);
      }
    });
    const offBattleEnd = client.on('battleEnd', ({ roomId: endedRoomId, payload }) => {
      if (endedRoomId !== roomId) return;
      if (payload?.state) applyBattleState(payload.state);
      refreshLog();
      setPhase(null);
      setPrompt(null);
      setNeedsSwitch(null);
      setPendingAction(null);
      setBattleEnded(true);
      setBattleResult({ winner: payload?.winner, replayId: payload?.replayId });
      setChatMessages(client.getChat(roomId));
    });
    const offChat = client.on('chatMessage', payload => {
      if (payload.roomId !== roomId) return;
      setChatMessages(client.getChat(roomId));
    });
    // Listen for action cancelled confirmation - clear pending state
    const offActionCancelled = client.on('actionCancelled', ({ playerId: cancelledPlayerId, roomId: cancelledRoomId }) => {
      if (cancelledRoomId !== roomId) return;
      // Only clear if it's our action that was cancelled
      if (cancelledPlayerId === client.user?.id) {
        console.log('[SimpleBattleTab] Action cancelled confirmed, clearing pending action');
        setPendingAction(null);
      }
    });
    const offBattleStartError = client.on('battleStartError', ({ roomId: errorRoomId, message }) => {
      if (errorRoomId !== roomId) return;
      console.error('[SimpleBattleTab] Battle failed to start:', message);
      setLog(prev => [...prev, `|error|Battle failed to start: ${message || 'Unknown error'}`]);
    });
    return () => {
      offRoomsSnapshot();
      offRoomUpdate();
      offRoomRemove();
      offIdentified();
      offBattleStart();
      offSpectate();
      offBattleUpdate();
      offPhase();
      offPrompt();
      offBattleEnd();
      offChat();
      offActionCancelled();
      offBattleStartError();
    };
  }, [client, roomId, mySide]);

  // Retry poll: if battleState is still null after mounting, poll a few times
  // This handles the race condition where battleStarted event is missed
  useEffect(() => {
    if (battleState) return;
    let cancelled = false;
    const delays = [500, 1500, 3000, 6000];
    const timers: ReturnType<typeof setTimeout>[] = [];
    delays.forEach(delay => {
      timers.push(setTimeout(() => {
        if (cancelled) return;
        const fresh = client.getBattleState(roomId);
        if (fresh) {
          console.log('[SimpleBattleTab] Retry poll found battle state after', delay, 'ms');
          applyBattleState(fresh);
          refreshLog();
          setNeedsSwitch(client.getBattleNeedsSwitch(roomId));
          const cachedPrompt = client.getPrompt(roomId);
          if (cachedPrompt) setPrompt(cachedPrompt);
        }
      }, delay));
    });
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, roomId, battleState]);


  useEffect(() => {
    if (!battleState) return;
    const inferred = inferSideFromState(battleState, client.user?.id);
    if (inferred && inferred !== mySide) setMySide(inferred);
  }, [battleState, client.user?.id, mySide]);

  useEffect(() => {
    if (mySide || !client.user?.id) return;
    const idx = roomPlayers.findIndex(p => p.id === client.user?.id);
    if (idx === 0) setMySide('p1');
    if (idx === 1) setMySide('p2');
  }, [roomPlayers, client.user?.id, mySide]);

  useEffect(() => {
    setPlayerIds(prev => {
      const next = { ...prev } as Record<SideId, string | undefined>;
      let changed = false;
      if (!next.p1 && roomPlayers[0]?.id) { next.p1 = roomPlayers[0].id; changed = true; }
      if (!next.p2 && roomPlayers[1]?.id) { next.p2 = roomPlayers[1].id; changed = true; }
      return changed ? next : prev;
    });
  }, [roomPlayers]);

  useEffect(() => {
    playerIdsRef.current = playerIds;
  }, [playerIds]);

  useEffect(() => {
    const needs = client.getBattleNeedsSwitch(roomId);
    if (needs !== undefined) setNeedsSwitch(needs);
  }, [client, roomId]);

  useEffect(() => {
    if (prompt?.prompt?.teamPreview) {
      setTeamPreviewOrder([]);
    }
  }, [prompt?.prompt?.teamPreview, prompt?.playerId]);

  const deadlineLabel = useMemo(() => formatDeadline(phase?.deadline), [phase?.deadline, phaseTick]);
  const promptPayload = useMemo(() => prompt ?? client.getPrompt(roomId), [client, roomId, prompt]);
  const promptRequests = useMemo(() => ({
    p1: pickPromptRequestForSide(promptPayload, 'p1', playerIds),
    p2: pickPromptRequestForSide(promptPayload, 'p2', playerIds),
  }), [promptPayload, playerIds]);
  const derivedRequests = useMemo(() => {
    const raw = deriveRequestsFromState(battleState);
    return {
      p1: raw.p1 === undefined ? undefined : coerceRequestObject(raw.p1),
      p2: raw.p2 === undefined ? undefined : coerceRequestObject(raw.p2),
    } as RequestMap;
  }, [battleState]);
  const rosterEntries = useMemo<Record<SideId, RosterEntry[]>>(() => {
    const entries = {
      p1: buildRosterEntries(battleState, requestBySide.p1 ?? promptRequests.p1 ?? derivedRequests.p1, 'p1', playerIds.p1),
      p2: buildRosterEntries(battleState, requestBySide.p2 ?? promptRequests.p2 ?? derivedRequests.p2, 'p2', playerIds.p2),
    };
    // Diagnostic: log side mapping for tooltip swap investigation
    if (entries.p1.length || entries.p2.length) {
      const p1Names = entries.p1.map(e => speciesFromPokemon(e.pokemon)).join(',');
      const p2Names = entries.p2.map(e => speciesFromPokemon(e.pokemon)).join(',');
      console.warn('[LAYOUT DEBUG]', {
        mySide,
        bottomSideWillBe: mySide ?? 'p1',
        topSideWillBe: (mySide ?? 'p1') === 'p1' ? 'p2' : 'p1',
        p1Roster: p1Names,
        p2Roster: p2Names,
        playerIds,
        userId: client.user?.id,
        statePlayerIds: battleState?.players?.map((p: any) => p?.id),
      });
    }
    return entries;
  }, [battleState, requestBySide, promptRequests, derivedRequests, playerIds]);
  // Only show one active Pokemon per side (in singles format)
  const p1FirstActive = rosterEntries.p1.find(entry => entry.isActive)?.pokemon;
  const p2FirstActive = rosterEntries.p2.find(entry => entry.isActive)?.pokemon;
  const p1Actives = p1FirstActive ? [p1FirstActive] : [];
  const p2Actives = p2FirstActive ? [p2FirstActive] : [];
  const activesBySide: Record<SideId, any[]> = { p1: p1Actives, p2: p2Actives };
  const needsSwitchPending = hasPendingSwitch(needsSwitch);

  // Check if we're in team preview mode
  const isTeamPreview = useMemo(() => {
    if (!mySide) return false;
    const rawRequest = requestBySide[mySide] ?? promptRequests[mySide] ?? derivedRequests[mySide];
    const request = coerceRequestObject(rawRequest);
    return !!request?.teamPreview;
  }, [mySide, requestBySide, promptRequests, derivedRequests]);

  const sideNames = useMemo(() => {
    const base: Record<SideId, string> = { p1: 'Player 1', p2: 'Player 2' };
    const players = Array.isArray(battleState?.players) ? battleState.players : [];
    if (players[0]) base.p1 = players[0].name || players[0].username || players[0].id || base.p1;
    if (players[1]) base.p2 = players[1].name || players[1].username || players[1].id || base.p2;
    const fallbackByIndex: Record<SideId, PlayerSummary | undefined> = {
      p1: roomPlayers[0],
      p2: roomPlayers[1],
    };
    const applyRoomFallback = (side: SideId) => {
      const pid = playerIds[side];
      if (pid) {
        const match = roomPlayers.find(p => p.id === pid || p.username === pid);
        if (match) {
          base[side] = shortName(match, base[side]);
          return;
        }
      }
      const fallback = fallbackByIndex[side];
      if (fallback) base[side] = shortName(fallback, base[side]);
    };
    applyRoomFallback('p1');
    applyRoomFallback('p2');
    return base;
  }, [battleState, roomPlayers, playerIds]);

  // Weather and terrain indicator data
  const weatherTerrainInfo = useMemo(() => {
    const weatherNameTable: Record<string, string> = {
      sunnyday: 'Sun', sun: 'Sun', desolateland: 'Harsh Sun',
      raindance: 'Rain', rain: 'Rain', primordialsea: 'Heavy Rain',
      sandstorm: 'Sandstorm', sand: 'Sandstorm',
      hail: 'Hail', snow: 'Snow', deltastream: 'Strong Winds',
    };
    const terrainNameTable: Record<string, string> = {
      electricterrain: 'Electric Terrain', electric: 'Electric Terrain',
      grassyterrain: 'Grassy Terrain', grassy: 'Grassy Terrain',
      mistyterrain: 'Misty Terrain', misty: 'Misty Terrain',
      psychicterrain: 'Psychic Terrain', psychic: 'Psychic Terrain',
    };
    const weatherIcons: Record<string, string> = {
      sunnyday: '☀️', sun: '☀️', desolateland: '🔥',
      raindance: '🌧️', rain: '🌧️', primordialsea: '🌊',
      sandstorm: '🏜️', sand: '🏜️',
      hail: '❄️', snow: '🌨️', deltastream: '🌀',
    };
    const terrainIcons: Record<string, string> = {
      electricterrain: '⚡', electric: '⚡',
      grassyterrain: '🌿', grassy: '🌿',
      mistyterrain: '🌫️', misty: '🌫️',
      psychicterrain: '🔮', psychic: '🔮',
    };
    const field = battleState?.field;
    const weatherId = field?.weather?.id || 'none';
    const weatherTurns = field?.weather?.turnsLeft || 0;
    const terrainId = field?.terrain?.id || 'none';
    const terrainTurns = field?.terrain?.turnsLeft || 0;
    const weather = weatherId !== 'none' ? {
      id: weatherId,
      name: weatherNameTable[weatherId] || weatherId.replace(/([A-Z])/g, ' $1').trim(),
      icon: weatherIcons[weatherId] || '🌤️',
      turnsLeft: weatherTurns,
    } : null;
    const terrain = terrainId !== 'none' ? {
      id: terrainId,
      name: terrainNameTable[terrainId] || terrainId.replace(/([A-Z])/g, ' $1').trim(),
      icon: terrainIcons[terrainId] || '🌍',
      turnsLeft: terrainTurns,
    } : null;
    return { weather, terrain, hasConditions: !!(weather || terrain) };
  }, [battleState?.field?.weather?.id, battleState?.field?.weather?.turnsLeft, battleState?.field?.terrain?.id, battleState?.field?.terrain?.turnsLeft]);

  // Pick background once based on roomId - do NOT include rngSeed as it changes each turn
  const fieldBackgroundUrl = useMemo(() => {
    const file = pickBackground(roomId || 'default');
    return `${FX_ASSET_BASE}/${file}`;
  }, [roomId]);

  const weatherFx = useMemo(() => resolveWeatherFx(weatherTerrainInfo.weather?.id), [weatherTerrainInfo.weather?.id]);
  const terrainOverlayUrl = useMemo(() => resolveTerrainOverlay(weatherTerrainInfo.terrain?.id), [weatherTerrainInfo.terrain?.id]);

  const getLocalTrainerSprite = useCallback((): string | undefined => {
    const stored = client.getTrainerSprite();
    if (stored) return stored;
    if (typeof window === 'undefined') return undefined;
    try {
      const raw = window.localStorage?.getItem('ttrpg.trainerSprite');
      const directUrl = resolveTrainerSpriteUrl(raw);
      if (directUrl) return directUrl;
      const sanitized = sanitizeTrainerSpriteId(raw);
      return sanitized || undefined;
    } catch {
      return undefined;
    }
  }, [client]);

  const resolveTrainerSprite = useCallback((side: SideId): string | undefined => {
    const idx = side === 'p1' ? 0 : 1;
    const candidateSources: any[] = [];
    const players = Array.isArray(battleState?.players) ? battleState.players : [];
    if (players[idx]) candidateSources.push(players[idx]);
    const sides = Array.isArray(battleState?.sides) ? battleState.sides : undefined;
    if (Array.isArray(sides)) {
      candidateSources.push(sides[idx]);
    } else if (sides) {
      candidateSources.push((sides as any)[side]);
    }
    candidateSources.push(battleState?.sides?.[side]);
    const fieldSides = Array.isArray(battleState?.field?.sides) ? battleState?.field?.sides : undefined;
    if (Array.isArray(fieldSides)) {
      candidateSources.push(fieldSides[idx]);
    } else if (battleState?.field?.sides) {
      candidateSources.push(battleState.field.sides?.[side]);
    }
    candidateSources.push(battleState?.field?.teams?.[idx], battleState?.field?.teams?.[side]);
    candidateSources.push(battleState?.teams?.[idx], battleState?.teams?.[side]);
    candidateSources.push(battleState?.team?.[idx], battleState?.team?.[side]);
    candidateSources.push(battleState?.[side]);

    for (const source of candidateSources) {
      const sprite = trainerSpriteFromEntity(source);
      if (sprite) return sprite;
    }

    const identifierCandidates: string[] = [];
    if (playerIds[side]) identifierCandidates.push(playerIds[side]!);
    if (players[idx]) {
      const pl = players[idx];
      identifierCandidates.push(pl.id, pl.userid, pl.userId, pl.username, pl.name);
    }
    const normalizedIds = Array.from(new Set(identifierCandidates.filter(Boolean).map(val => String(val).toLowerCase())));
    if (normalizedIds.length) {
      const roomMatch = roomPlayers.find(entry => {
        const values = [entry.id, entry.username, entry.name].filter(Boolean) as string[];
        return values.some(val => normalizedIds.includes(val.toLowerCase()));
      });
      if (roomMatch) {
        const sprite = trainerSpriteFromEntity(roomMatch);
        if (sprite) return sprite;
      }
    }

    if (side === mySide) {
      const local = getLocalTrainerSprite();
      if (local) return local;
    }
    return undefined;
  }, [battleState, roomPlayers, playerIds, mySide, getLocalTrainerSprite]);

  const trainerSpriteBySide = useMemo(() => {
    return {
      p1: resolveTrainerSprite('p1'),
      p2: resolveTrainerSprite('p2'),
    } as Record<SideId, string | undefined>;
  }, [resolveTrainerSprite]);

  const watchers = useMemo(() => {
    const ids = new Set<string>([playerIds.p1 || '', playerIds.p2 || ''].map(id => id.toLowerCase()));
    const output: PlayerSummary[] = [];
    const seen = new Set<string>();
    for (const entry of roomPlayers) {
      const key = (entry.id || entry.username || entry.name || '').toLowerCase();
      if (key && ids.has(key)) continue;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      output.push(entry);
    }
    return output;
  }, [roomPlayers, playerIds]);

  const roleForSide = useCallback((side: SideId): 'player' | 'opponent' => {
    if (mySide) return side === mySide ? 'player' : 'opponent';
    return side === 'p1' ? 'player' : 'opponent';
  }, [mySide]);

  const bottomSide: SideId = mySide ?? 'p1';
  const topSide: SideId = bottomSide === 'p1' ? 'p2' : 'p1';
  const bottomRole = roleForSide(bottomSide);
  const topRole = roleForSide(topSide);

  const secondaryLabelForSide = useCallback((side: SideId): string => {
    if (mySide) return side === mySide ? 'You' : 'Opponent';
    return side === 'p1' ? 'Player 1' : 'Player 2';
  }, [mySide]);

  const heading = title || `Battle ${roomId}`;

  const sidePlayerId = (side: SideId): string | undefined => {
    const idx = side === 'p1' ? 0 : 1;
    return playerIds[side] || battleState?.players?.[idx]?.id;
  };

  const activeEntriesForSide = (side: SideId): RosterEntry[] => rosterEntries[side].filter(entry => entry.isActive);

  const sendAuto = (playerId: string, side?: SideId) => {
    const actorId = side ? sidePlayerId(side) ?? playerId : playerId;
    client.sendAction(roomId, { type: 'auto', actorPlayerId: actorId }, actorId);
  };

  const sendMove = (playerId: string, side: SideId, slotIndex: number, move: any, slotRequest: any) => {
    // Prevent double-click while waiting for server acknowledgment
    if (pendingAction) return;
    const actorPlayerId = sidePlayerId(side) || playerId;
    const ownActives = activeEntriesForSide(side);
    const actorEntry = (Array.isArray(ownActives) ? ownActives[slotIndex] : null) || ownActives[0];
    const opponentSide: SideId = side === 'p1' ? 'p2' : 'p1';
    const opponentActives = activeEntriesForSide(opponentSide);
    const opponentEntry = opponentActives[0];
    const opponentPlayerId = sidePlayerId(opponentSide);
    const moveName = move?.id || move?.move || move?.name;
    const moveId = moveName ? normalizeName(moveName) : slotRequest?.moveId;
    
    // Get OUR active Pokemon from battle state (most reliable source after force-switch)
    const myPlayer = battleState?.players?.find((p: any) => p.id === actorPlayerId);
    const myActiveMon = myPlayer?.team?.[myPlayer?.activeIndex ?? 0];
    
    // DEBUG: Log all relevant state for move sending
    console.log('[sendMove] DEBUG:', {
      side,
      actorPlayerId,
      opponentSide,
      opponentPlayerId,
      myActiveIndex: myPlayer?.activeIndex,
      myActiveMon: myActiveMon ? { id: myActiveMon.id, pokemonId: myActiveMon.pokemonId, species: myActiveMon.species } : null,
      battleStatePlayers: battleState?.players?.map((p: any) => ({ id: p.id, activeIndex: p.activeIndex, team: p.team?.slice(0, 2)?.map((m: any) => m.id) })),
      opponentEntryPokemon: opponentEntry?.pokemon ? { id: opponentEntry.pokemon.id, pokemonId: opponentEntry.pokemon.pokemonId, species: opponentEntry.pokemon.species } : null,
    });
    
    const pokemonCandidates = collectIdCandidates(
      slotRequest?.pokemonId,
      slotRequest?.id,
      slotRequest?.ident,
      slotRequest?.sid,
      slotRequest?.activeId,
      slotRequest?.pokemon,
      slotRequest?.actorPokemon,
      slotRequest?.side?.pokemon?.[slotIndex],
      slotRequest?.side?.active?.[slotIndex],
      actorEntry?.pokemon,
      actorEntry,
    );
    // PRIORITY: Use battleState's active Pokemon first (most reliable after force-switch)
    // Then fall back to request/entry data
    const rawPokemonId = myActiveMon?.id || myActiveMon?.pokemonId ||
      slotRequest?.pokemonId || slotRequest?.id ||
      slotRequest?.active?.[slotIndex]?.pokemonId || slotRequest?.active?.[slotIndex]?.id ||
      actorEntry?.pokemon?.pokemonId || actorEntry?.pokemon?.id;
    const pokemonId = rawPokemonId ||
      pokemonCandidates.find(Boolean) ||
      fallbackPokemonId(actorEntry, slotIndex);
    if (!actorPlayerId || !pokemonId || !moveId) {
      sendAuto(playerId, side);
      return;
    }
    const explicitTargetPlayerId = slotRequest?.targetPlayerId || slotRequest?.target?.playerId || slotRequest?.target?.actorPlayerId || slotRequest?.target?.id;
    const explicitTargetPokemonId = slotRequest?.target?.pokemonId || slotRequest?.targetPokemonId;
    const payload: any = {
      type: 'move',
      actorPlayerId,
      pokemonId,
      moveId,
    };
    if (moveName) payload.moveName = moveName;
    if (typeof move?.target === 'string') payload.target = move.target;
    const targetPlayerId = explicitTargetPlayerId || opponentPlayerId;
    if (targetPlayerId) payload.targetPlayerId = targetPlayerId;
    const targetPokemonCandidates = collectIdCandidates(
      explicitTargetPokemonId,
      move?.targetPokemonId,
      move?.target?.pokemonId,
      move?.target?.id,
      opponentEntry?.pokemon,
      opponentEntry,
    );
    // Get opponent's active pokemon ID from battle state (preserves hyphens)
    const opponentPlayer = battleState?.players?.find((p: any) => p.id !== actorPlayerId);
    const opponentActiveMon = opponentPlayer?.team?.[opponentPlayer.activeIndex ?? 0];
    const rawTargetPokemonId = explicitTargetPokemonId ||
      opponentActiveMon?.id || opponentActiveMon?.pokemonId ||
      opponentEntry?.pokemon?.id || opponentEntry?.pokemon?.pokemonId;
    const targetPokemonId = rawTargetPokemonId ||
      targetPokemonCandidates.find(Boolean) ||
      fallbackPokemonId(opponentEntry, 0);
    
    // DEBUG: Log target resolution
    console.log('[sendMove] TARGET DEBUG:', {
      opponentPlayer: opponentPlayer ? { id: opponentPlayer.id, activeIndex: opponentPlayer.activeIndex } : null,
      opponentActiveMon: opponentActiveMon ? { id: opponentActiveMon.id, pokemonId: opponentActiveMon.pokemonId, species: opponentActiveMon.species } : null,
      rawTargetPokemonId,
      targetPokemonCandidates,
      finalTargetPokemonId: targetPokemonId,
    });
    
    if (targetPokemonId) payload.targetPokemonId = targetPokemonId;
    if (move?.mega || moveBoosts.mega) payload.mega = true;
    if (move?.z || moveBoosts.z) payload.z = true;
    if (moveBoosts.tera) payload.terastallize = true;
    if (moveBoosts.max) payload.dynamax = true;
    if (typeof move?.priority === 'number') payload.priority = move.priority;
    // DEBUG: Log final payload
    console.log('[sendMove] FINAL PAYLOAD:', JSON.stringify(payload));
    // Set pending action state before sending
    setPendingAction({ type: 'move', label: moveName || 'Move', timestamp: Date.now() });
    setMoveBoosts({ mega: false, z: false, max: false, tera: false });
    client.sendAction(roomId, payload, actorPlayerId);
  };

  const sendSwitch = (playerId: string, side: SideId, switchSlot: number) => {
    // Prevent double-click while waiting for server acknowledgment
    if (pendingAction) return;
    const actorPlayerId = sidePlayerId(side) || playerId;
    const ownActives = activeEntriesForSide(side);
    const actorEntry = ownActives[0];
    const pokemonCandidates = collectIdCandidates(actorEntry?.pokemon, actorEntry);
    const pokemonId = pokemonCandidates[0] || fallbackPokemonId(actorEntry, 0);
    if (!actorPlayerId || !pokemonId) {
      sendAuto(playerId, side);
      return;
    }
    const payload: any = {
      type: 'switch',
      actorPlayerId,
      pokemonId,
      toIndex: Math.max(0, switchSlot - 1),
    };
    // Set pending action state before sending
    const switchEntry = rosterEntries[side]?.find(e => e.slot === switchSlot);
    const switchLabel = switchEntry ? speciesFromPokemon(switchEntry.pokemon) : `Slot ${switchSlot}`;
    setPendingAction({ type: 'switch', label: switchLabel, timestamp: Date.now() });
    client.sendAction(roomId, payload, actorPlayerId);
  };

  const submitTeamPreview = (playerId: string, side: SideId, order: number[]) => {
    // Prevent double-click while waiting for server acknowledgment
    if (pendingAction) return;
    console.log('[submitTeamPreview] Called with:', { playerId, side, order });
    if (!order.length) {
      sendAuto(playerId, side);
      return;
    }
    const actorPlayerId = sidePlayerId(side) || playerId;
    // Get the lead Pokemon name for the pending action display
    const rawRequest = requestBySide[side] ?? promptRequests[side] ?? derivedRequests[side];
    const request = coerceRequestObject(rawRequest);
    const myPokes: any[] = Array.isArray(request?.side?.pokemon) ? request.side.pokemon :
                           Array.isArray(request?.pokemon) ? request.pokemon : [];
    const leadSlot = order[0];
    const leadPokemon = myPokes[leadSlot - 1];
    const leadLabel = leadPokemon ? speciesFromPokemon(leadPokemon) || `Slot ${leadSlot}` : `Slot ${leadSlot}`;
    setPendingAction({ type: 'lead', label: leadLabel, timestamp: Date.now() });
    console.log('[submitTeamPreview] Sending action:', { type: 'team', order, actorPlayerId });
    client.sendAction(roomId, { type: 'team', order, actorPlayerId }, actorPlayerId);
    // NOTE: Don't clear teamPreviewOrder here - let the server response / phase change clear it
  };

  const renderSwitchButtons = (entries: RosterEntry[], playerId: string, side: SideId, highlightForced = false) => {
    if (!entries.length) return <div className="ps-empty">No reserves available.</div>;
    return (
      <div className="ps-switch-grid">
        {entries.map(({ pokemon, slot, isActive }) => {
          const { hpPct, text } = parseHpInfo(pokemon);
          const status = statusCode(pokemon);
          const disabled = isActive || isFainted(pokemon);
          const species = speciesFromPokemon(pokemon);
          const { initial: spriteUrl, placeholder } = buildSpriteChain(pokemon, side, false);
          const cardKey = `${side}-bench-${slot}`;
          const isHovered = hoveredPokemon === cardKey;
          return (
            <div 
              key={`${slot}-${species}`}
              className="ps-switch-btn-wrapper"
              onMouseEnter={() => setHoveredPokemon(cardKey)}
              onMouseLeave={() => setHoveredPokemon(null)}
              style={{ position: 'relative' }}
            >
              <button
                className={`ps-switch-btn${disabled ? ' disabled' : ''}${highlightForced ? ' forced' : ''}`}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  sendSwitch(playerId, side, slot);
                }}
              >
                <div className="ps-switch-sprite">
                  <img
                    src={spriteUrl}
                    alt={species}
                    onError={(e) => { (e.target as HTMLImageElement).src = placeholder; }}
                    style={{ imageRendering: 'pixelated', width: 48, height: 48 }}
                  />
                </div>
                <div className="ps-switch-info">
                  <div className="ps-switch-name">{species || `Slot ${slot}`}</div>
                  <div className="ps-switch-hpbar"><span style={{ width: `${hpPct}%`, background: hpColor(hpPct) }} /></div>
                  <div className="ps-switch-meta">
                    <span>{hpPct}%</span>
                    {status ? <span className="ps-switch-status">{status.toUpperCase()}</span> : null}
                    {text && !status ? <span>{text}</span> : null}
                  </div>
                </div>
              </button>
              {isHovered && renderStatTooltip(pokemon, side)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTeamPreview = (rawRequest: any, playerId: string, side: SideId) => {
    const request = coerceRequestObject(rawRequest);
    // Check both side.pokemon (standard format) and top-level pokemon (prompt format)
    const myPokes: any[] = Array.isArray(request?.side?.pokemon) ? request.side.pokemon : 
                           Array.isArray(request?.pokemon) ? request.pokemon : [];
    const opponentSide: SideId = side === 'p1' ? 'p2' : 'p1';
    // Find opponent's player by excluding our own player ID (not by index - array order isn't guaranteed)
    // Check battleState first, then fall back to prompt's state (for timing issues when state hasn't propagated yet)
    const promptState = (prompt as any)?.state;
    const players = Array.isArray(battleState?.players) ? battleState.players : 
                    Array.isArray(promptState?.players) ? promptState.players : [];
    const opponentPlayer = players.find((p: any) => p?.id !== playerId) || players.find((p: any) => p?.id === playerIds[opponentSide]) || players[1];
    const opponentPokes: any[] = Array.isArray(opponentPlayer?.team) ? opponentPlayer.team : [];
    const selectedLead = teamPreviewOrder[0] || null;

    // Build lead order: selected lead first, then rest in original order
    const buildLeadOrder = (leadSlot: number): number[] => {
      const order: number[] = [leadSlot];
      for (let i = 1; i <= myPokes.length; i++) {
        if (i !== leadSlot) order.push(i);
      }
      return order;
    };

    const handleSelectLead = (slotNumber: number) => {
      setTeamPreviewOrder([slotNumber]);
    };

    const handleSubmit = () => {
      const order = selectedLead ? buildLeadOrder(selectedLead) : myPokes.map((_: any, i: number) => i + 1);
      submitTeamPreview(playerId, side, order);
    };

    return (
      <div className="ps-command-grid ps-team-preview">
        <div className="ps-command-section">
          <h4>Team Preview — Select Your Lead</h4>
          
          {/* Opponent's Team (top) */}
          <div className="ps-preview-side ps-preview-side--opponent">
            <div className="ps-preview-label">{sideNames[opponentSide]}'s Team</div>
            <div className="ps-preview-sprites">
              {opponentPokes.length ? opponentPokes.map((pkm, idx) => {
                const species = speciesFromPokemon(pkm) || 'Unknown';
                const chain = buildSpriteChain(pkm, opponentSide, false);
                return (
                  <div key={idx} className="ps-preview-mon ps-preview-mon--opponent" title={species}>
                    <img 
                      src={chain.initial} 
                      alt={species}
                      style={{ height: 64, imageRendering: 'pixelated' }}
                      onError={(e) => {
                        const el = e.currentTarget as HTMLImageElement;
                        const idxCurrent = Number(el.dataset.fbIdx || '0') + 1;
                        el.dataset.fbIdx = String(idxCurrent);
                        el.src = chain.candidates[idxCurrent] || chain.placeholder;
                        if (chain.mirrorBackFallback && idxCurrent >= chain.backFallbackStart) {
                          el.style.transform = 'scaleX(-1)';
                        }
                      }}
                    />
                    <div className="ps-preview-mon__name">{species}</div>
                  </div>
                );
              }) : <div className="ps-empty">Waiting for opponent…</div>}
            </div>
          </div>

          {/* Divider */}
          <div className="ps-preview-divider">VS</div>

          {/* My Team (bottom) - clickable to select lead */}
          <div className="ps-preview-side ps-preview-side--player">
            <div className="ps-preview-label">Your Team — Click to Select Lead</div>
            <div className="ps-preview-sprites">
              {myPokes.map((pkm, idx) => {
                const slotNumber = idx + 1;
                const species = speciesFromPokemon(pkm) || `Slot ${slotNumber}`;
                const chain = buildSpriteChain(pkm, side, true);
                const isSelected = selectedLead === slotNumber;
                return (
                  <button
                    key={slotNumber}
                    className={`ps-preview-mon ps-preview-mon--player${isSelected ? ' ps-preview-mon--selected' : ''}`}
                    onClick={() => handleSelectLead(slotNumber)}
                    title={`Select ${species} as your lead`}
                  >
                    {isSelected && <div className="ps-preview-mon__badge">LEAD</div>}
                    <img 
                      src={chain.initial} 
                      alt={species}
                      style={{ height: 64, imageRendering: 'pixelated' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).src = chain.placeholder; }}
                    />
                    <div className="ps-preview-mon__name">{species}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ps-command-footer">
            <button onClick={handleSubmit} disabled={!myPokes.length}>
              {selectedLead ? `Start with ${speciesFromPokemon(myPokes[selectedLead - 1]) || 'Selection'}` : 'Start Battle (Default Order)'}
            </button>
            <button className="secondary" onClick={() => setTeamPreviewOrder([])}>Clear</button>
          </div>
        </div>
      </div>
    );
  };

  // Renders team preview content inside the battle field area (ps-active-zone)
  const renderTeamPreviewField = () => {
    if (!mySide) return null;
    const playerId = playerIds[mySide] || prompt?.playerId || client.user?.id;
    if (!playerId) return null;
    const rawRequest = requestBySide[mySide] ?? promptRequests[mySide] ?? derivedRequests[mySide];
    const request = coerceRequestObject(rawRequest);
    // Check both side.pokemon and top-level pokemon
    const myPokes: any[] = Array.isArray(request?.side?.pokemon) ? request.side.pokemon :
                           Array.isArray(request?.pokemon) ? request.pokemon : [];
    const opponentSide: SideId = mySide === 'p1' ? 'p2' : 'p1';
    // Find opponent by excluding our player ID (not by index - array order isn't guaranteed)
    // Check battleState first, then fall back to prompt's state (for timing issues when state hasn't propagated yet)
    const promptState = (prompt as any)?.state;
    const players = Array.isArray(battleState?.players) ? battleState.players : 
                    Array.isArray(promptState?.players) ? promptState.players : [];
    const opponentPlayer = players.find((p: any) => p?.id !== playerId) || players.find((p: any) => p?.id === playerIds[opponentSide]) || players[1];
    const opponentPokes: any[] = Array.isArray(opponentPlayer?.team) ? opponentPlayer.team : [];
    const selectedLead = teamPreviewOrder[0] || null;

    const buildLeadOrder = (leadSlot: number): number[] => {
      const order: number[] = [leadSlot];
      for (let i = 1; i <= myPokes.length; i++) {
        if (i !== leadSlot) order.push(i);
      }
      return order;
    };

    const handleSelectLead = (slotNumber: number) => {
      setTeamPreviewOrder([slotNumber]);
    };

    const handleSubmit = () => {
      const order = selectedLead ? buildLeadOrder(selectedLead) : myPokes.map((_: any, i: number) => i + 1);
      submitTeamPreview(playerId, mySide, order);
    };

    return (
      <>
        {/* Top slot - Opponent's team */}
        <div className="ps-active-slot ps-active-slot--opponent ps-preview-slot">
          <div className="ps-actor__header">
            <span>{sideNames[opponentSide]}'s Team</span>
          </div>
          <div className="ps-preview-sprites ps-preview-sprites--field">
            {opponentPokes.length ? opponentPokes.map((pkm, idx) => {
              const species = speciesFromPokemon(pkm) || 'Unknown';
              const chain = buildSpriteChain(pkm, opponentSide, false);
              return (
                <div key={idx} className="ps-preview-mon ps-preview-mon--opponent" title={species}>
                  <img 
                    src={chain.initial} 
                    alt={species}
                    style={{ height: 80, imageRendering: 'pixelated' }}
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement;
                      const idxCurrent = Number(el.dataset.fbIdx || '0') + 1;
                      el.dataset.fbIdx = String(idxCurrent);
                      el.src = chain.candidates[idxCurrent] || chain.placeholder;
                      if (chain.mirrorBackFallback && idxCurrent >= chain.backFallbackStart) {
                        el.style.transform = 'scaleX(-1)';
                      }
                    }}
                  />
                  <div className="ps-preview-mon__name">{species}</div>
                </div>
              );
            }) : <div className="ps-empty">Waiting for opponent…</div>}
          </div>
        </div>

        {/* Center VS divider */}
        <div className="ps-preview-divider ps-preview-divider--field">
          <span>TEAM PREVIEW</span>
          <span className="ps-preview-divider__vs">VS</span>
          <span className="dim">Select your lead Pokémon</span>
        </div>

        {/* Bottom slot - Player's team (clickable) */}
        <div className="ps-active-slot ps-active-slot--player ps-preview-slot">
          <div className="ps-actor__header">
            <span>Your Team — Click to Select Lead</span>
          </div>
          <div className="ps-preview-sprites ps-preview-sprites--field">
            {myPokes.map((pkm, idx) => {
              const slotNumber = idx + 1;
              const species = speciesFromPokemon(pkm) || `Slot ${slotNumber}`;
              const chain = buildSpriteChain(pkm, mySide, true);
              const isSelected = selectedLead === slotNumber;
              return (
                <button
                  key={slotNumber}
                  className={`ps-preview-mon ps-preview-mon--player${isSelected ? ' ps-preview-mon--selected' : ''}`}
                  onClick={() => handleSelectLead(slotNumber)}
                  title={`Select ${species} as your lead`}
                >
                  {isSelected && <div className="ps-preview-mon__badge">LEAD</div>}
                  <img 
                    src={chain.initial} 
                    alt={species}
                    style={{ height: 80, imageRendering: 'pixelated' }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = chain.placeholder; }}
                  />
                  <div className="ps-preview-mon__name">{species}</div>
                </button>
              );
            })}
          </div>
          <div className="ps-preview-actions">
            <button onClick={handleSubmit} disabled={!myPokes.length} className="ps-preview-start-btn">
              {selectedLead ? `Start with ${speciesFromPokemon(myPokes[selectedLead - 1]) || 'Selection'}` : 'Start Battle (Default Order)'}
            </button>
            {selectedLead && <button className="secondary" onClick={() => setTeamPreviewOrder([])}>Clear Selection</button>}
          </div>
        </div>
      </>
    );
  };

  const renderForceSwitch = (playerId: string, side: SideId, entries: RosterEntry[]) => (
    <div className="ps-command-grid">
      <div className="ps-command-section">
        <h4>Forced Switch</h4>
        <div className="ps-command-status">Select a replacement Pokémon.</div>
        {renderSwitchButtons(entries, playerId, side, true)}
        <div className="ps-command-footer">
          <button className="secondary" onClick={() => sendAuto(playerId, side)}>Auto</button>
        </div>
      </div>
    </div>
  );

  const renderMoveControls = (playerId: string, rawRequest: any, side: SideId, entries: RosterEntry[]) => {
    const request = coerceRequestObject(rawRequest);
    const activeSlots: any[] = Array.isArray(request?.active) ? request.active : [];
    // Get full move data from the pokemon in request for additional details
    const pokemonList: any[] = Array.isArray(request?.pokemon) ? request.pokemon : [];
    const activePokemon = pokemonList.find((p: any) => p?.active) || pokemonList[0];
    const fullMoves: any[] = Array.isArray(activePokemon?.moves) ? activePokemon.moves : [];

    // Detect available mechanic toggles from request
    const slot0 = activeSlots[0];
    const activeSpeciesLabel = activePokemon?.speciesForme || activePokemon?.species || activePokemon?.name || '';
    const alreadyMega = /\bmega\b/i.test(activeSpeciesLabel);
    const canMega = !alreadyMega && (slot0?.canMegaEvo || (!!activePokemon?.item && /ite$/i.test(activePokemon.item)));
    const canZMove = !!slot0?.canZMove;
    const canDynamax = !!slot0?.canDynamax;
    const canTera = !!(slot0?.canTerastallize || slot0?.canTera);
    const teraTypeName = slot0?.canTerastallize || slot0?.canTera || activePokemon?.teraType || '';
    
    // Helper to get full move data by id
    const getFullMoveData = (moveId: string) => {
      const normalized = normalizeName(moveId);
      return fullMoves.find((m: any) => normalizeName(m?.id || m?.name || '') === normalized);
    };

    // Helper to get move description from cachedMovesData
    const getMoveDescription = (moveId: string): { short: string; full: string } => {
      const normalized = normalizeName(moveId);
      const moveData = cachedMovesData?.[normalized];
      if (moveData) {
        return {
          short: moveData.shortDesc || '',
          full: moveData.desc || moveData.shortDesc || '',
        };
      }
      return { short: '', full: '' };
    };

    return (
      <div className="ps-command-grid">
        <div className="ps-command-section">
          <h4>Moves</h4>
          {!activeSlots.length ? (
            <div className="ps-empty">Waiting for battle update…</div>
          ) : (
            activeSlots.map((slotRequest, slotIdx) => {
              const rawMoves: any[] = Array.isArray(slotRequest?.moves) ? slotRequest.moves : [];
              // Check if Pokemon is trapped/locked into a move (e.g., Outrage, Petal Dance)
              const isTrapped = slotRequest?.trapped;
              // Check if there's exactly one non-disabled move (locked move scenario)
              const enabledMoves = rawMoves.filter((m: any) => !m?.disabled);
              const isLockedMove = enabledMoves.length === 1 && rawMoves.length >= 1;
              // Always render 4 move slots - pad with empty entries
              const moves: any[] = [...rawMoves];
              while (moves.length < 4) {
                moves.push({ empty: true });
              }
              const hasAnyMoves = rawMoves.length > 0;
              // If no moves but trapped, show auto-continue button
              if (!hasAnyMoves) {
                return (
                  <div key={slotIdx} className="ps-locked-move-notice">
                    <div className="ps-command-status">Locked into move - click to continue</div>
                    <button onClick={() => sendAuto(playerId, side)} className="ps-move ps-move--locked">
                      <div className="ps-move__name">Continue Attack</div>
                      <div className="ps-move__desc">Your Pokémon is locked into its move</div>
                    </button>
                  </div>
                );
              }
              return (
                <div key={slotIdx}>
                  {isTrapped && <div className="ps-command-status ps-trapped-notice">⚠️ Pokémon is trapped!</div>}
                  {isLockedMove && <div className="ps-command-status ps-locked-notice">🔒 Locked into move</div>}
                  {activeSlots.length > 1 ? <div className="ps-command-status">Active {String.fromCharCode(65 + slotIdx)}</div> : null}
                  <div className="ps-move-grid">
                    {moves.map((move, moveIdx) => {
                      // Handle empty move slots
                      if (move?.empty) {
                        return (
                          <button
                            key={moveIdx}
                            className="ps-move disabled ps-move--empty"
                            disabled
                            title="Empty move slot"
                          >
                            <div className="ps-move__name">-</div>
                          </button>
                        );
                      }
                      const moveName = move?.move || move?.name || `Move ${moveIdx + 1}`;
                      const moveId = move?.id || normalizeName(moveName);
                      const fullData = getFullMoveData(moveId);
                      const { base, tint } = typeColors(move?.type || fullData?.type);
                      const disabled = !!move?.disabled;
                      const power = move?.power ?? fullData?.power ?? 0;
                      const accuracy = move?.accuracy ?? fullData?.accuracy;
                      const category = move?.category ?? fullData?.category;
                      const categoryIcon = category === 'Physical' ? '💥' : category === 'Special' ? '✨' : category === 'Status' ? '📊' : '';
                      const { short: shortDesc, full: fullDesc } = getMoveDescription(moveId);
                      // Truncate description for display in button (max ~60 chars)
                      const displayDesc = shortDesc.length > 60 ? shortDesc.slice(0, 57) + '…' : shortDesc;
                      const tooltipText = fullDesc || `${moveName}${category ? ` (${category})` : ''}`;
                      return (
                        <button
                          key={moveIdx}
                          className={`ps-move${disabled ? ' disabled' : ''}`}
                          style={{ borderColor: base, background: `linear-gradient(180deg, ${tint}, rgba(255,255,255,0.95))` }}
                          disabled={disabled}
                          title={tooltipText}
                          onClick={() => {
                            if (disabled) return;
                            sendMove(playerId, side, slotIdx, move, slotRequest);
                          }}
                        >
                          <div className="ps-move__name">{moveName}</div>
                          <div className="ps-move__meta">
                            <span>{move?.type || fullData?.type || '—'}</span>
                            {category && <span title={category}>{categoryIcon} {category}</span>}
                          </div>
                          <div className="ps-move__stats">
                            {power > 0 && <span className="ps-move__power" title="Base Power">⚔️ {power}</span>}
                            {typeof accuracy === 'number' && <span className="ps-move__accuracy" title="Accuracy">🎯 {accuracy}%</span>}
                            {accuracy === true && <span className="ps-move__accuracy" title="Always hits">🎯 ∞</span>}
                            {typeof move?.pp === 'number' && <span className="ps-move__pp" title="Power Points">PP {move.pp}/{move.maxpp ?? move.pp}</span>}
                          </div>
                          {displayDesc && <div className="ps-move__desc">{displayDesc}</div>}
                          {move?.z && <div className="ps-move__badge">Z-Move</div>}
                          {move?.mega && <div className="ps-move__badge">Mega</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Mechanic toggles: Mega / Z-Move / Dynamax / Terastallize */}
        {(canMega || canZMove || canDynamax || canTera) && (
          <div className="ps-command-section ps-mechanic-toggles">
            {canMega && (
              <label className="ps-mechanic-toggle">
                <input type="checkbox" checked={moveBoosts.mega} onChange={e => setMoveBoosts(prev => ({ ...prev, mega: e.target.checked }))} />
                <span className="ps-mechanic-toggle__icon">🧬</span> Mega Evolution
              </label>
            )}
            {canZMove && (
              <label className="ps-mechanic-toggle">
                <input type="checkbox" checked={moveBoosts.z} onChange={e => setMoveBoosts(prev => ({ ...prev, z: e.target.checked }))} />
                <span className="ps-mechanic-toggle__icon">⚡</span> Z-Move
              </label>
            )}
            {canDynamax && (
              <label className="ps-mechanic-toggle">
                <input type="checkbox" checked={moveBoosts.max} onChange={e => setMoveBoosts(prev => ({ ...prev, max: e.target.checked }))} />
                <span className="ps-mechanic-toggle__icon">🔴</span> Dynamax
              </label>
            )}
            {canTera && (
              <label className="ps-mechanic-toggle">
                <input type="checkbox" checked={moveBoosts.tera} onChange={e => setMoveBoosts(prev => ({ ...prev, tera: e.target.checked }))} />
                <span className="ps-mechanic-toggle__icon">⭐</span> Terastallize{teraTypeName ? ` (${teraTypeName})` : ''}
              </label>
            )}
          </div>
        )}

        {/* Switch Pokemon Section - Clearly separated below moves */}
        <div className="ps-command-section ps-switch-section">
          <h4>🔄 Switch Pokémon</h4>
          <div className="ps-command-status">Select a Pokémon to switch in</div>
          {entries.length ? renderSwitchButtons(entries, playerId, side) : <div className="ps-empty">No reserves available.</div>}
        </div>

        <div className="ps-command-footer">
          <button className="secondary" onClick={() => sendAuto(playerId, side)}>Auto</button>
        </div>
      </div>
    );
  };

  const handleRematch = () => {
    // Navigate back to lobby for rematch - clear end state
    setBattleEnded(false);
    setBattleResult(null);
    // The user will need to go back to lobby and create a new challenge
    // In the future, we could auto-create a challenge with same opponent
    window.dispatchEvent(new CustomEvent('navigateToLobby'));
  };

  const handleDownloadReplay = async () => {
    // First try server-side replay if available
    if (battleResult?.replayId) {
      const base = client.getServerEndpoint();
      try {
        const res = await fetch(`${base}/api/replay/${battleResult.replayId}`);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `replay-${battleResult.replayId}.json`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
      } catch (err) {
        console.warn('Server replay not available, falling back to local log:', err);
      }
    }
    
    // Fall back to generating replay from local battle log
    const replayData = {
      id: roomId,
      format: 'gen9ou',
      players: {
        p1: { name: sideNames.p1, id: playerIds.p1 },
        p2: { name: sideNames.p2, id: playerIds.p2 },
      },
      winner: battleResult?.winner,
      log: log,
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(replayData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replay-${roomId || 'battle'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderBattleEndPanel = () => {
    const winnerName = battleResult?.winner
      ? playerIds.p1 === battleResult.winner
        ? sideNames.p1
        : playerIds.p2 === battleResult.winner
          ? sideNames.p2
          : battleResult.winner
      : null;
    const iWon = mySide && playerIds[mySide] === battleResult?.winner;
    return (
      <div className="ps-battle-end">
        <div className="ps-battle-end__result">
          {winnerName ? (
            <>
              <h3 className="ps-battle-end__winner">{winnerName} wins!</h3>
              {mySide && (
                <div className={`ps-battle-end__verdict ${iWon ? 'victory' : 'defeat'}`}>
                  {iWon ? '🏆 Victory!' : '💔 Defeat'}
                </div>
              )}
            </>
          ) : (
            <h3 className="ps-battle-end__winner">Battle Complete</h3>
          )}
        </div>
        <div className="ps-battle-end__actions">
          <button onClick={handleRematch}>Rematch</button>
          <button className="secondary" onClick={handleDownloadReplay}>
            📥 Download Replay
          </button>
          <button className="secondary" onClick={() => window.dispatchEvent(new CustomEvent('navigateToLobby'))}>
            Return to Lobby
          </button>
        </div>
      </div>
    );
  };

  const renderCommandPanel = () => {
    // Show battle end panel if battle has ended
    if (battleEnded) return renderBattleEndPanel();
    if (!mySide) return <div className="ps-command-status">Spectating – no actions required.</div>;
    const playerId = playerIds[mySide] || prompt?.playerId || client.user?.id;
    if (!playerId) return <div className="ps-command-status">Awaiting identification…</div>;
    
    // Show waiting UI if an action is pending (but NOT if battle ended)
    if (pendingAction && !battleEnded) {
      const actionIcon = pendingAction.type === 'move' ? '⚔️' : pendingAction.type === 'lead' ? '🎯' : '🔄';
      const actionVerb = pendingAction.type === 'move' ? 'Using' : pendingAction.type === 'lead' ? 'Leading with' : 'Switching to';
      
      const handleCancelAction = () => {
        // Send cancel to server to clear the buffered action
        client.sendAction(roomId, { type: 'cancel' } as any, playerId);
        setPendingAction(null);
      };
      
      return (
        <div className="ps-command-grid ps-command-waiting">
          <div className="ps-command-section">
            <h4>⏳ Waiting for Opponent…</h4>
            <div className="ps-waiting-action">
              <span className="ps-waiting-action__icon">{actionIcon}</span>
              <span className="ps-waiting-action__text">{actionVerb} <strong>{pendingAction.label}</strong></span>
            </div>
            <div className="ps-waiting-hint">Waiting for the other player to make their choice.</div>
            <div className="ps-command-footer">
              <button className="secondary" onClick={handleCancelAction}>
                ✕ Cancel &amp; Choose Again
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    const rawRequest = requestBySide[mySide] ?? promptRequests[mySide] ?? derivedRequests[mySide];
    const request = coerceRequestObject(rawRequest);
    if (!request) return <div className="ps-command-status">No decision needed right now.</div>;
    // Team preview is now shown in the battle field area
    if (request.teamPreview) return <div className="ps-command-status ps-command-status--preview">Select your lead Pokémon in the battle field above.</div>;
    const benchEntries = rosterEntries[mySide].filter(entry => !entry.isActive);
    if (Array.isArray(request.forceSwitch) && request.forceSwitch.some(Boolean)) {
      return renderForceSwitch(playerId, mySide, benchEntries);
    }
    return renderMoveControls(playerId, request, mySide, benchEntries);
  };

  const renderTrainerAvatar = (side: SideId) => {
    const name = sideNames[side] || 'Trainer';
    const spriteId = trainerSpriteBySide[side];
    const sources = trainerSpriteSources(spriteId, side);
    const initial = name.charAt(0).toUpperCase();
    const hasSource = sources.length > 0;
    const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget as HTMLImageElement;
      const nextIndex = Number(img.dataset.fbIdx || '0') + 1;
      if (nextIndex < sources.length) {
        img.dataset.fbIdx = String(nextIndex);
        img.src = sources[nextIndex];
        return;
      }
      img.style.display = 'none';
      (img.parentElement as HTMLElement | null)?.classList.add('ps-trainer--fallback');
    };
    return (
      <div className={`ps-trainer ps-trainer--${side}${hasSource ? '' : ' ps-trainer--fallback'}`} title={name}>
        {hasSource ? (
          <img
            src={sources[0]}
            alt={name}
            data-fb-idx="0"
            style={{ imageRendering: 'pixelated', transition: 'opacity .2s ease', opacity: 0 }}
            onLoad={event => { (event.currentTarget as HTMLImageElement).style.opacity = '1'; }}
            onError={handleError}
          />
        ) : null}
        <span className="ps-trainer__initial">{initial}</span>
      </div>
    );
  };

  const renderLineup = (side: SideId) => {
    const entries = rosterEntries[side];
    if (!entries.length) return null;
    const role = roleForSide(side);
    return (
      <div className={`ps-lineup__mons ps-lineup__mons--${role}`}>
        {entries.map(entry => {
          const { pokemon, slot, isActive } = entry;
          const chain = buildSpriteChain(pokemon, side, role === 'player');
          const fainted = isFainted(pokemon);
          const speciesName = speciesFromPokemon(pokemon);
          const nickname = typeof pokemon?.nickname === 'string' && pokemon.nickname
            ? pokemon.nickname
            : typeof pokemon?.originalName === 'string' && pokemon.originalName
              ? pokemon.originalName
              : (typeof pokemon?.name === 'string' && pokemon.name && speciesName && pokemon.name !== speciesName ? pokemon.name : undefined);
          const displayName = nickname || speciesName || `Slot ${slot}`;
          const tooltip = speciesName && nickname && nickname.trim() !== speciesName.trim()
            ? `${nickname} (${speciesName})`
            : displayName;
          return (
            <div
              key={`${side}-lineup-${slot}`}
              className={`ps-lineup__mon${isActive ? ' active' : ''}${fainted ? ' fainted' : ''}`}
              title={`${tooltip} • ${isActive ? 'Active' : 'Benched'}`}
            >
              <img
                src={chain.initial}
                alt={displayName}
                data-fb-idx="0"
                style={{ imageRendering: 'pixelated' as const }}
                onLoad={event => { event.currentTarget.style.opacity = '1'; }}
                onError={event => {
                  const img = event.currentTarget as HTMLImageElement;
                  const idx = Number(img.dataset.fbIdx || '0') + 1;
                  img.dataset.fbIdx = String(idx);
                  img.src = chain.candidates[idx] || chain.placeholder;
                  if (chain.mirrorBackFallback && idx >= chain.backFallbackStart) {
                    img.style.transform = 'scaleX(-1)';
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const handleChatSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    client.sendChat(roomId, text);
    setChatInput('');
  };

  // Helper to render stat tooltip popup with boost/debuff colors
  const renderStatTooltip = (pkm: any, side: SideId) => {
    const speciesName = speciesFromPokemon(pkm);
    const nickname = pkm?.nickname || pkm?.originalName || (pkm?.name !== speciesName ? pkm?.name : undefined);
    const pokemonName = nickname || speciesName || 'Pokemon';
    const showSpecies = speciesName && nickname && nickname.toLowerCase() !== speciesName.toLowerCase();
    const key = `${side}-${pokemonName}`;
    const boosts = statBoosts[key] || {};
    const isMyPokemon = side === mySide;
    
    // Get base stats and computed stats if available
    const baseStats = pkm?.baseStats || {};
    const computedStats = pkm?.computedStats || pkm?.stats || {};
    const level = pkm?.level || 50;
    
    const statLabels: Record<string, string> = {
      hp: 'HP',
      atk: 'Attack',
      def: 'Defense', 
      spa: 'Sp. Atk',
      spd: 'Sp. Def',
      spe: 'Speed',
      accuracy: 'Accuracy',
      evasion: 'Evasion'
    };
    
    const getStatColor = (boost: number | undefined): string => {
      if (!boost || boost === 0) return 'var(--fg-dim)'; // Grey/neutral
      if (boost > 0) return '#4caf50'; // Green for boost
      return '#f44336'; // Red for debuff
    };
    
    const formatBoost = (boost: number | undefined): string => {
      if (!boost || boost === 0) return '';
      if (boost > 0) return ` (+${boost})`;
      return ` (${boost})`;
    };

    // Calculate stat range for opponent Pokemon (0 IV/0 EV to 31 IV/252 EV)
    const calcStatRange = (baseStat: number, statName: string): { min: number; max: number } => {
      if (!baseStat) return { min: 0, max: 0 };
      // HP formula is different from other stats
      if (statName === 'hp') {
        const minHp = Math.floor(((2 * baseStat + 0 + Math.floor(0 / 4)) * level) / 100) + level + 10;
        const maxHp = Math.floor(((2 * baseStat + 31 + Math.floor(252 / 4)) * level) / 100) + level + 10;
        return { min: minHp, max: maxHp };
      }
      // Other stats formula (neutral nature)
      const minStat = Math.floor((Math.floor(((2 * baseStat + 0 + Math.floor(0 / 4)) * level) / 100) + 5) * 1.0);
      const maxStatNeutral = Math.floor((Math.floor(((2 * baseStat + 31 + Math.floor(252 / 4)) * level) / 100) + 5) * 1.0);
      // Max with beneficial nature (+10%)
      const maxStatBoosted = Math.floor((Math.floor(((2 * baseStat + 31 + Math.floor(252 / 4)) * level) / 100) + 5) * 1.1);
      return { min: minStat, max: maxStatBoosted };
    };
    
    const hasAnyBoosts = Object.values(boosts).some(v => v !== 0);
    
    return (
      <div className="ps-stat-tooltip" style={{ minWidth: isMyPokemon ? 180 : 220 }}>
        <div className="ps-stat-tooltip__header">
          {pokemonName} {showSpecies && <span style={{ fontWeight: 400, fontSize: '0.85em', opacity: 0.8 }}>({speciesName})</span>}
          {level > 0 && <span style={{ fontWeight: 400, fontSize: '0.85em', marginLeft: 6 }}>Lv.{level}</span>}
        </div>
        <div className="ps-stat-tooltip__stats">
          {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as string[]).map(stat => {
            const boost = stat !== 'hp' ? (boosts as any)[stat] : undefined;
            const mapKey = stat === 'spa' ? 'spAtk' : stat === 'spd' ? 'spDef' : stat === 'spe' ? 'speed' : stat;
            const baseStat = baseStats[mapKey] || baseStats[stat];
            const currentStat = computedStats[stat] || computedStats[mapKey];
            
            if (isMyPokemon) {
              // Own Pokemon: calculate actual stat from base stats if computed not available
              let displayStat = currentStat;
              if (!displayStat && baseStat && level) {
                // Calculate stat using Pokemon formula (assuming neutral nature, 31 IVs, 0 EVs)
                if (stat === 'hp') {
                  displayStat = Math.floor(((2 * baseStat + 31 + 0) * level) / 100) + level + 10;
                } else {
                  displayStat = Math.floor((Math.floor(((2 * baseStat + 31 + 0) * level) / 100) + 5) * 1.0);
                }
              }
              return (
                <div 
                  key={stat} 
                  className="ps-stat-tooltip__row"
                  style={{ color: getStatColor(boost) }}
                >
                  <span className="ps-stat-tooltip__label">{statLabels[stat]}:</span>
                  <span className="ps-stat-tooltip__value">
                    {displayStat || baseStat || '?'}{formatBoost(boost)}
                  </span>
                </div>
              );
            } else {
              // Opponent Pokemon: show possible range
              const range = calcStatRange(baseStat, stat);
              return (
                <div 
                  key={stat} 
                  className="ps-stat-tooltip__row"
                  style={{ color: getStatColor(boost) }}
                >
                  <span className="ps-stat-tooltip__label">{statLabels[stat]}:</span>
                  <span className="ps-stat-tooltip__value">
                    {range.min > 0 ? `${range.min}–${range.max}` : '?'}{formatBoost(boost)}
                  </span>
                </div>
              );
            }
          })}
          {(boosts.accuracy || boosts.evasion) && (
            <>
              {boosts.accuracy && (
                <div 
                  className="ps-stat-tooltip__row"
                  style={{ color: getStatColor(boosts.accuracy) }}
                >
                  <span className="ps-stat-tooltip__label">Accuracy:</span>
                  <span className="ps-stat-tooltip__value">{formatBoost(boosts.accuracy)}</span>
                </div>
              )}
              {boosts.evasion && (
                <div 
                  className="ps-stat-tooltip__row"
                  style={{ color: getStatColor(boosts.evasion) }}
                >
                  <span className="ps-stat-tooltip__label">Evasion:</span>
                  <span className="ps-stat-tooltip__value">{formatBoost(boosts.evasion)}</span>
                </div>
              )}
            </>
          )}
        </div>
        {/* Additional info for own Pokemon */}
        {isMyPokemon && pkm?.ability && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: '0.8rem', color: '#aaa' }}>
            <div><strong>Ability:</strong> {pkm.ability}</div>
            {pkm?.item && <div><strong>Item:</strong> {pkm.item}</div>}
          </div>
        )}
        {/* Summary line */}
        {!isMyPokemon && (
          <div className="ps-stat-tooltip__summary">Range based on 0–31 IVs, 0–252 EVs</div>
        )}
        {hasAnyBoosts && (
          <div className="ps-stat-tooltip__summary">Stat stages modified</div>
        )}
      </div>
    );
  };

  const renderActiveCard = (pkm: any, side: SideId, idx: number) => {
    const { hpPct, text } = parseHpInfo(pkm);
    const role = roleForSide(side);
    const chain = buildSpriteChain(pkm, side, role === 'player');
    const status = statusCode(pkm);
    const speciesName = speciesFromPokemon(pkm);
    const nickname = typeof pkm?.nickname === 'string' && pkm.nickname
      ? pkm.nickname
      : typeof pkm?.originalName === 'string' && pkm.originalName
        ? pkm.originalName
        : (typeof pkm?.name === 'string' && pkm.name && speciesName && pkm.name !== speciesName ? pkm.name : undefined);
    const name = nickname || pkm?.name || speciesName || 'Pokémon';
    const cardKey = `${side}-active-${idx}`;
    const isHovered = hoveredPokemon === cardKey;
    const volatileKey = `${side}-${name}`;
    const volatiles = volatileStatuses[volatileKey] || new Set<VolatileStatus>();
    const teraType = pkm?.terastallized || pkm?.teraType;
    const spriteProps = {
      style: { height: 96, imageRendering: 'pixelated' as const, opacity: 0, transition: 'opacity .2s ease' },
      onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => {
        (e.currentTarget as HTMLImageElement).style.opacity = '1';
      },
      onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
        const el = e.currentTarget as HTMLImageElement;
        const idxCurrent = Number(el.dataset.fbIdx || '0') + 1;
        el.dataset.fbIdx = String(idxCurrent);
        el.src = chain.candidates[idxCurrent] || chain.placeholder;
        if (chain.mirrorBackFallback && idxCurrent >= chain.backFallbackStart) {
          el.style.transform = 'scaleX(-1)';
        }
      }
    };

    // Volatile status icons
    const volatileIcons: Record<VolatileStatus, { icon: string; label: string }> = {
      confusion: { icon: '💫', label: 'Confused' },
      leechseed: { icon: '🌱', label: 'Seeded' },
      taunt: { icon: '😤', label: 'Taunted' },
      encore: { icon: '🔁', label: 'Encored' },
      disable: { icon: '🚫', label: 'Disabled' },
      torment: { icon: '😖', label: 'Tormented' },
      attract: { icon: '💕', label: 'Infatuated' },
      substitute: { icon: '🎭', label: 'Substitute' },
      curse: { icon: '👻', label: 'Cursed' },
      yawn: { icon: '😴', label: 'Drowsy' },
      perishsong: { icon: '💀', label: 'Perish Song' },
      focusenergy: { icon: '🎯', label: 'Focus Energy' },
      magnetrise: { icon: '🧲', label: 'Magnet Rise' },
    };

    return (
      <div 
        key={cardKey} 
        className={`ps-pokemon-card${hpPct <= 0 ? ' fainted' : ''}${teraType ? ' terastallized' : ''} ${getAnimClass(side)}`.trim()}
        onMouseEnter={() => setHoveredPokemon(cardKey)}
        onMouseLeave={() => setHoveredPokemon(null)}
      >
        <div className="ps-pokemon-card__header">
          <div className="ps-pokemon-card__name">{name}</div>
          {typeof pkm?.level === 'number' ? <div className="ps-pokemon-card__level">Lv {pkm.level}</div> : null}
          {teraType && <div className={`ps-tera-badge ps-tera-badge--${teraType.toLowerCase()}`} title={`Terastallized: ${teraType}`}>⭐{teraType}</div>}
          {status ? <div className={`ps-status ps-status--${status}`}>{status.toUpperCase()}</div> : null}
        </div>
        {/* Volatile status badges */}
        {volatiles.size > 0 && (
          <div className="ps-volatile-badges">
            {Array.from(volatiles).map(v => (
              <span key={v} className={`ps-volatile-badge ps-volatile-badge--${v}`} title={volatileIcons[v]?.label || v}>
                {volatileIcons[v]?.icon || '❓'}
              </span>
            ))}
          </div>
        )}
        <div className="ps-pokemon-card__sprite">
          <img alt={name} src={chain.initial} data-fb-idx="0" {...spriteProps} />
        </div>
        <div className="ps-pokemon-card__hp">
          <div className="ps-pokemon-card__hpbar"><span style={{ width: `${hpPct}%`, background: hpColor(hpPct) }} /></div>
          <div className="ps-pokemon-card__hptext">{hpPct}%{text && !status ? ` • ${text}` : ''}</div>
        </div>
        {isHovered && (
          <div className="ps-stat-tooltip-anchor">
            {renderStatTooltip(pkm, side)}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="panel battle battle-ps">
      <header className="ps-battle__header">
        <div>
          <h2>{heading}</h2>
          <div className="ps-battle__subtitle">{sideNames.p1} vs {sideNames.p2}</div>
        </div>
        <div className="ps-battle__header-actions">
          <div className="ps-battle__info">
            <span>Turn: <strong>{battleState?.turn ?? 0}</strong></span>
            {deadlineLabel ? <span>Timer: {deadlineLabel}</span> : null}
            {needsSwitchPending ? <span className="ps-battle__warning">Switch required</span> : null}
            {watchers.length ? <span className="ps-battle__watchers">Watching: {watchers.map(w => shortName(w)).join(', ')}</span> : null}
          </div>
          <button className="ps-battle__refresh" type="button" onClick={handleLineupRefresh} title="Reload team preview">
            ↻ Reload preview
          </button>
        </div>
      </header>
      <div className="ps-battle__layout">
        <div className="ps-battle__field">
          <div className="ps-battle__fx">
            {fieldBackgroundUrl && (
              <div className="ps-battle__bg" style={{ backgroundImage: `url(${fieldBackgroundUrl})` }} />
            )}
            <div className="ps-battle__fx-shade" />
            {weatherFx && (
              <div className={`ps-battle__weather ps-battle__weather--${weatherFx.key}`}>
                <video
                  key={weatherFx.key}
                  className="ps-battle__weather-video"
                  poster={weatherFx.poster}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  style={{ mixBlendMode: weatherFx.blendMode || 'screen', opacity: weatherFx.opacity ?? 0.55 }}
                >
                  {weatherFx.webm ? <source src={weatherFx.webm} type="video/webm" /> : null}
                  {weatherFx.mp4 ? <source src={weatherFx.mp4} type="video/mp4" /> : null}
                </video>
              </div>
            )}
            {terrainOverlayUrl && (
              <img className="ps-battle__terrain" src={terrainOverlayUrl} alt="" aria-hidden="true" />
            )}
          </div>
          <div className="ps-battle__field-inner">
            {/* Weather and Terrain Indicator Bar */}
            {weatherTerrainInfo.hasConditions && (
              <div className="ps-field-conditions">
                {weatherTerrainInfo.weather && (
                  <div className={`ps-field-condition ps-field-condition--weather ps-field-condition--${weatherTerrainInfo.weather.id}`}>
                    <span className="ps-field-condition__icon">{weatherTerrainInfo.weather.icon}</span>
                    <span className="ps-field-condition__name">{weatherTerrainInfo.weather.name}</span>
                    {weatherTerrainInfo.weather.turnsLeft > 0 && (
                      <span className="ps-field-condition__turns">({weatherTerrainInfo.weather.turnsLeft} turns)</span>
                    )}
                  </div>
                )}
                {weatherTerrainInfo.terrain && (
                  <div className={`ps-field-condition ps-field-condition--terrain ps-field-condition--${weatherTerrainInfo.terrain.id}`}>
                    <span className="ps-field-condition__icon">{weatherTerrainInfo.terrain.icon}</span>
                    <span className="ps-field-condition__name">{weatherTerrainInfo.terrain.name}</span>
                    {weatherTerrainInfo.terrain.turnsLeft > 0 && (
                      <span className="ps-field-condition__turns">({weatherTerrainInfo.terrain.turnsLeft} turns)</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className={`ps-lineup ps-lineup--${topRole}`}>
              {topRole === 'player' ? renderTrainerAvatar(topSide) : renderLineup(topSide)}
              {topRole === 'player' ? renderLineup(topSide) : renderTrainerAvatar(topSide)}
            </div>
            <div className={`ps-active-zone${isTeamPreview ? ' ps-active-zone--preview' : ''}`}>
              {isTeamPreview ? (
                /* Team Preview Mode - render team preview in field */
                renderTeamPreviewField()
              ) : (
                /* Normal Battle Mode - render active Pokemon */
                <>
                  {/* Effectiveness text overlay */}
                  {effectivenessText && (
                    <div className={`ps-effectiveness-text ps-effectiveness-text--${effectivenessText.type} ps-effectiveness-text--${effectivenessText.side}`}>
                      {effectivenessText.text}
                    </div>
                  )}
                  <div className={`ps-active-slot ps-active-slot--${topRole}`}>
                    {/* Side conditions for top side */}
                    {Object.keys(sideConditions[topSide] || {}).length > 0 && (
                      <div className="ps-side-conditions">
                        {sideConditions[topSide].stealthrock && <span className="ps-side-condition ps-side-condition--hazard" title="Stealth Rock">🪨</span>}
                        {sideConditions[topSide].spikes && <span className="ps-side-condition ps-side-condition--hazard" title={`Spikes x${sideConditions[topSide].spikes}`}>⚔️{sideConditions[topSide].spikes! > 1 ? `×${sideConditions[topSide].spikes}` : ''}</span>}
                        {sideConditions[topSide].toxicspikes && <span className="ps-side-condition ps-side-condition--hazard" title={`Toxic Spikes x${sideConditions[topSide].toxicspikes}`}>☠️{sideConditions[topSide].toxicspikes! > 1 ? `×${sideConditions[topSide].toxicspikes}` : ''}</span>}
                        {sideConditions[topSide].stickyweb && <span className="ps-side-condition ps-side-condition--hazard" title="Sticky Web">🕸️</span>}
                        {sideConditions[topSide].reflect && <span className="ps-side-condition ps-side-condition--screen" title="Reflect">🛡️</span>}
                        {sideConditions[topSide].lightscreen && <span className="ps-side-condition ps-side-condition--screen" title="Light Screen">💡</span>}
                        {sideConditions[topSide].auroraveil && <span className="ps-side-condition ps-side-condition--screen" title="Aurora Veil">❄️🛡️</span>}
                        {sideConditions[topSide].tailwind && <span className="ps-side-condition ps-side-condition--buff" title="Tailwind">💨</span>}
                        {sideConditions[topSide].safeguard && <span className="ps-side-condition ps-side-condition--buff" title="Safeguard">🔒</span>}
                        {sideConditions[topSide].mist && <span className="ps-side-condition ps-side-condition--buff" title="Mist">🌫️</span>}
                      </div>
                    )}
                    <div className="ps-actor__active">
                      {activesBySide[topSide].length ? activesBySide[topSide].map((pkm, idx) => renderActiveCard(pkm, topSide, idx)) : <div className="ps-empty">No active Pokémon</div>}
                    </div>
                  </div>
                  <div className={`ps-active-slot ps-active-slot--${bottomRole}`}>
                    {/* Side conditions for bottom side */}
                    {Object.keys(sideConditions[bottomSide] || {}).length > 0 && (
                      <div className="ps-side-conditions">
                        {sideConditions[bottomSide].stealthrock && <span className="ps-side-condition ps-side-condition--hazard" title="Stealth Rock">🪨</span>}
                        {sideConditions[bottomSide].spikes && <span className="ps-side-condition ps-side-condition--hazard" title={`Spikes x${sideConditions[bottomSide].spikes}`}>⚔️{sideConditions[bottomSide].spikes! > 1 ? `×${sideConditions[bottomSide].spikes}` : ''}</span>}
                        {sideConditions[bottomSide].toxicspikes && <span className="ps-side-condition ps-side-condition--hazard" title={`Toxic Spikes x${sideConditions[bottomSide].toxicspikes}`}>☠️{sideConditions[bottomSide].toxicspikes! > 1 ? `×${sideConditions[bottomSide].toxicspikes}` : ''}</span>}
                        {sideConditions[bottomSide].stickyweb && <span className="ps-side-condition ps-side-condition--hazard" title="Sticky Web">🕸️</span>}
                        {sideConditions[bottomSide].reflect && <span className="ps-side-condition ps-side-condition--screen" title="Reflect">🛡️</span>}
                        {sideConditions[bottomSide].lightscreen && <span className="ps-side-condition ps-side-condition--screen" title="Light Screen">💡</span>}
                        {sideConditions[bottomSide].auroraveil && <span className="ps-side-condition ps-side-condition--screen" title="Aurora Veil">❄️🛡️</span>}
                        {sideConditions[bottomSide].tailwind && <span className="ps-side-condition ps-side-condition--buff" title="Tailwind">💨</span>}
                        {sideConditions[bottomSide].safeguard && <span className="ps-side-condition ps-side-condition--buff" title="Safeguard">🔒</span>}
                        {sideConditions[bottomSide].mist && <span className="ps-side-condition ps-side-condition--buff" title="Mist">🌫️</span>}
                      </div>
                    )}
                    <div className="ps-actor__active">
                      {activesBySide[bottomSide].length ? activesBySide[bottomSide].map((pkm, idx) => renderActiveCard(pkm, bottomSide, idx)) : <div className="ps-empty">No active Pokémon</div>}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className={`ps-lineup ps-lineup--${bottomRole}`}>
              {bottomRole === 'player' ? renderTrainerAvatar(bottomSide) : renderLineup(bottomSide)}
              {bottomRole === 'player' ? renderLineup(bottomSide) : renderTrainerAvatar(bottomSide)}
            </div>
          </div>
        </div>
        <aside className="ps-battle__log">
          <div className="ps-battle__log-section">
            <h3>Battle Log & Chat</h3>
            <div className="ps-battle__log-list ps-battle__combined-log">
              {(() => {
                // Combine log and chat into a unified timeline
                type CombinedEntry = { type: 'log' | 'chat' | 'turn'; content: string; time?: number; user?: string; turn?: number };
                const combined: CombinedEntry[] = [];
                let currentTurn = 0;
                
                // Parse log lines and extract turn markers
                log.forEach((line, idx) => {
                  const turnMatch = line.match(/\|turn\|(\d+)/i);
                  if (turnMatch) {
                    currentTurn = parseInt(turnMatch[1], 10);
                    combined.push({ type: 'turn', content: `Turn ${currentTurn}`, turn: currentTurn });
                  } else {
                    combined.push({ type: 'log', content: sanitizeLogLine(line), time: idx });
                  }
                });
                
                // Insert chat messages
                chatMessages.forEach(msg => {
                  combined.push({ type: 'chat', content: msg.text, user: msg.user, time: msg.time });
                });
                
                // Sort by time (chat messages have timestamps, log entries use index)
                // For simplicity, we'll show log first, then chat at the end
                
                if (combined.length === 0) {
                  return <div className="ps-empty">No battle messages yet.</div>;
                }
                
                return combined.map((entry, idx) => {
                  if (entry.type === 'turn') {
                    return (
                      <div key={`turn-${entry.turn}-${idx}`} className="ps-battle__turn-marker">
                        ═══ {entry.content} ═══
                      </div>
                    );
                  }
                  if (entry.type === 'chat') {
                    return (
                      <div key={`chat-${entry.time}-${idx}`} className="ps-chat-line">
                        <span className="ps-chat-user">{entry.user}</span>
                        <span className="ps-chat-text">{entry.content}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={`log-${entry.time}-${idx}`} className="ps-battle__log-line">{entry.content}</div>
                  );
                });
              })()}
            </div>
          </div>
          <form className="ps-chat-form" onSubmit={handleChatSubmit}>
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Type a message…"
            />
            <button type="submit" disabled={!chatInput.trim()}>Send</button>
          </form>
        </aside>
      </div>
      <div className="ps-battle__commands">
        <header>
          <div>{mySide ? `Commanding ${sideNames[mySide]}` : 'Spectating'}</div>
          {prompt?.prompt?.choice ? <div className="dim">Choice: {prompt.prompt.choice}</div> : null}
        </header>
        {renderCommandPanel()}
      </div>
    </section>
  );
}
