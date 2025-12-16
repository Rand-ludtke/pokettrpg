import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spriteUrlWithFallback, normalizeName } from '../data/adapter';
import { getClient, PromptActionPayload, RoomSummary, ChatMessage } from '../net/pokettrpgClient';

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
};

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
  const species = speciesFromPokemon(pkm) || 'Missingno';
  const shiny = !!pkm?.shiny;
  const { src, candidates, placeholder } = spriteUrlWithFallback(species, () => {}, { back: showBack, shiny });
  return { initial: src, candidates, placeholder };
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

function trainerSpriteFromEntity(entity: any): string | undefined {
  if (!entity || typeof entity !== 'object') return undefined;
  const directKeys: Array<string> = ['trainerSprite', 'avatar', 'sprite', 'spriteId', 'spriteName'];
  for (const key of directKeys) {
    const value = (entity as any)[key];
    const sanitized = sanitizeTrainerSpriteId(value);
    if (sanitized) return sanitized;
    if (value && typeof value === 'object') {
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
    'vendor/showdown/sprites/trainers',
    './vendor/showdown/sprites/trainers',
    '../vendor/showdown/sprites/trainers',
    '/vendor/showdown/sprites/trainers',
    '/showdown/sprites/trainers',
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
  return false;
}

function getPromptSide(payload: PromptActionPayload | null): SideId | null {
  if (!payload?.prompt) return null;
  return coerceSideId(payload.prompt.side?.id ?? payload.prompt.sideID ?? payload.prompt.sideId ?? payload.prompt.side);
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

function getSideRoster(state: any, request: any, side: SideId): any[] {
  const requestObj = coerceRequestObject(request);
  const directRequest = coercePokemonList(requestObj?.side?.pokemon);
  if (directRequest.length) return directRequest;

  const idx = side === 'p1' ? 0 : 1;
  const players = Array.isArray(state?.players) ? state.players : [];
  const player = players[idx];

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

function buildRosterEntries(state: any, request: any, side: SideId): RosterEntry[] {
  const rosterRaw = getSideRoster(state, coerceRequestObject(request), side);
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
  const [requestBySide, setRequestBySide] = useState<RequestMap>(() => {
    const base = makeEmptyRequests();
    const side = getPromptSide(initialPrompt);
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

  useEffect(() => {
    const room = client.getRooms().find(r => r.id === roomId);
    const participant = room?.players?.some(p => p.id === client.user?.id);
    if (!participant) {
      client.joinRoom(roomId, 'spectator');
    }
  }, [client, roomId]);

  useEffect(() => {
    setPhaseTick(0);
    if (!phase?.deadline) return;
    const timer = window.setInterval(() => setPhaseTick(t => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase?.deadline]);

  const refreshLog = () => {
    setLog(client.getBattleLog(roomId));
  };

  const applyBattleState = (state: any) => {
    if (state) {
      setBattleState(state);
      setPlayerIds(prev => {
        const derived = derivePlayerIdsFromState(state);
        if (prev.p1 === derived.p1 && prev.p2 === derived.p2) return prev;
        return { p1: derived.p1, p2: derived.p2 };
      });
      const inferred = inferSideFromState(state, client.user?.id);
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
      if (startedId !== roomId) return;
      setRequestBySide(makeEmptyRequests());
      applyBattleState(state);
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
      setPrompt(payload);
      const side = getPromptSide(payload);
      const latestIds = playerIdsRef.current;
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
      setChatMessages(client.getChat(roomId));
    });
    const offChat = client.on('chatMessage', payload => {
      if (payload.roomId !== roomId) return;
      setChatMessages(client.getChat(roomId));
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
    };
  }, [client, roomId, mySide]);


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
  const rosterEntries = useMemo<Record<SideId, RosterEntry[]>>(() => ({
    p1: buildRosterEntries(battleState, requestBySide.p1 ?? promptRequests.p1 ?? derivedRequests.p1, 'p1'),
    p2: buildRosterEntries(battleState, requestBySide.p2 ?? promptRequests.p2 ?? derivedRequests.p2, 'p2'),
  }), [battleState, requestBySide, promptRequests, derivedRequests]);
  const p1Actives = rosterEntries.p1.filter(entry => entry.isActive).map(entry => entry.pokemon);
  const p2Actives = rosterEntries.p2.filter(entry => entry.isActive).map(entry => entry.pokemon);
  const activesBySide: Record<SideId, any[]> = { p1: p1Actives, p2: p2Actives };
  const needsSwitchPending = hasPendingSwitch(needsSwitch);

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

  const getLocalTrainerSprite = useCallback((): string | undefined => {
    const stored = client.getTrainerSprite();
    if (stored) return stored;
    if (typeof window === 'undefined') return undefined;
    try {
      const raw = window.localStorage?.getItem('ttrpg.trainerSprite');
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
    const actorPlayerId = sidePlayerId(side) || playerId;
    const ownActives = activeEntriesForSide(side);
    const actorEntry = (Array.isArray(ownActives) ? ownActives[slotIndex] : null) || ownActives[0];
    const opponentSide: SideId = side === 'p1' ? 'p2' : 'p1';
    const opponentActives = activeEntriesForSide(opponentSide);
    const opponentEntry = opponentActives[0];
    const opponentPlayerId = sidePlayerId(opponentSide);
    const moveName = move?.id || move?.move || move?.name;
    const moveId = moveName ? normalizeName(moveName) : slotRequest?.moveId;
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
    const pokemonId = pokemonCandidates
      .map(candidate => normalizeName(candidate) || candidate)
      .find(Boolean) || fallbackPokemonId(actorEntry, slotIndex);
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
    const targetPokemonId = targetPokemonCandidates
      .map(candidate => normalizeName(candidate) || candidate)
      .find(Boolean) || fallbackPokemonId(opponentEntry, 0);
    if (targetPokemonId) payload.targetPokemonId = targetPokemonId;
    if (move?.mega) payload.mega = true;
    if (move?.z) payload.z = true;
    if (typeof move?.priority === 'number') payload.priority = move.priority;
    client.sendAction(roomId, payload, actorPlayerId);
  };

  const sendSwitch = (playerId: string, side: SideId, switchSlot: number) => {
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
    client.sendAction(roomId, payload, actorPlayerId);
  };

  const submitTeamPreview = (playerId: string, side: SideId, order: number[]) => {
    if (!order.length) {
      sendAuto(playerId, side);
      return;
    }
    const actorPlayerId = sidePlayerId(side) || playerId;
    client.sendAction(roomId, { type: 'team', order, actorPlayerId }, actorPlayerId);
    setTeamPreviewOrder([]);
  };

  const renderSwitchButtons = (entries: RosterEntry[], playerId: string, side: SideId, highlightForced = false) => {
    if (!entries.length) return <div className="ps-empty">No reserves available.</div>;
    return (
      <div className="ps-switch-grid">
        {entries.map(({ pokemon, slot, isActive }) => {
          const { hpPct, text } = parseHpInfo(pokemon);
          const status = statusCode(pokemon);
          const disabled = isActive || isFainted(pokemon);
          return (
            <button
              key={`${slot}-${speciesFromPokemon(pokemon)}`}
              className={`ps-switch-btn${disabled ? ' disabled' : ''}${highlightForced ? ' forced' : ''}`}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                sendSwitch(playerId, side, slot);
              }}
            >
              <div className="ps-switch-name">{speciesFromPokemon(pokemon) || `Slot ${slot}`}</div>
              <div className="ps-switch-hpbar"><span style={{ width: `${hpPct}%`, background: hpColor(hpPct) }} /></div>
              <div className="ps-switch-meta">
                <span>{hpPct}%</span>
                {status ? <span>{status.toUpperCase()}</span> : null}
                {text && !status ? <span>{text}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const renderTeamPreview = (rawRequest: any, playerId: string, side: SideId) => {
    const request = coerceRequestObject(rawRequest);
    const pokes: any[] = Array.isArray(request?.side?.pokemon) ? request.side.pokemon : [];
    const maxTeamSize = Math.min(request?.maxTeamSize || pokes.length || 6, pokes.length || 0);
    return (
      <div className="ps-command-grid">
        <div className="ps-command-section">
          <h4>Team Preview</h4>
          <div className="ps-preview-grid">
            {pokes.map((pkm, idx) => {
              const slotNumber = idx + 1;
              const label = speciesFromPokemon(pkm) || `Slot ${slotNumber}`;
              const pickedIndex = teamPreviewOrder.indexOf(slotNumber);
              const picked = pickedIndex !== -1;
              return (
                <button
                  key={slotNumber}
                  className={`ps-preview-btn${picked ? ' chosen' : ''}`}
                  disabled={picked || teamPreviewOrder.length >= maxTeamSize}
                  onClick={() => setTeamPreviewOrder(prev => (prev.length >= maxTeamSize ? prev : [...prev, slotNumber]))}
                >
                  {picked ? `${pickedIndex + 1}. ` : ''}{label}
                </button>
              );
            })}
          </div>
          <div className="ps-command-footer">
            <button onClick={() => submitTeamPreview(playerId, side, teamPreviewOrder.length ? teamPreviewOrder : pokes.map((_: any, i: number) => i + 1))} disabled={!pokes.length}>Submit</button>
            <button className="secondary" onClick={() => setTeamPreviewOrder([])}>Clear</button>
            <button className="secondary" onClick={() => sendAuto(playerId, side)}>Auto</button>
          </div>
        </div>
      </div>
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
    return (
      <div className="ps-command-grid">
        <div className="ps-command-section">
          <h4>Moves</h4>
          {!activeSlots.length ? (
            <div className="ps-empty">Waiting for battle update…</div>
          ) : (
            activeSlots.map((slotRequest, slotIdx) => {
              const moves: any[] = Array.isArray(slotRequest?.moves) ? slotRequest.moves : [];
              if (!moves.length) return <div key={slotIdx} className="ps-empty">No moves available.</div>;
              return (
                <div key={slotIdx}>
                  {activeSlots.length > 1 ? <div className="ps-command-status">Active {String.fromCharCode(65 + slotIdx)}</div> : null}
                  <div className="ps-move-grid">
                    {moves.map((move, moveIdx) => {
                      const moveName = move?.move || move?.name || `Move ${moveIdx + 1}`;
                      const { base, tint } = typeColors(move?.type);
                      const disabled = !!move?.disabled;
                      return (
                        <button
                          key={moveIdx}
                          className={`ps-move${disabled ? ' disabled' : ''}`}
                          style={{ borderColor: base, background: `linear-gradient(180deg, ${tint}, rgba(255,255,255,0.95))` }}
                          disabled={disabled}
                          onClick={() => {
                            if (disabled) return;
                            sendMove(playerId, side, slotIdx, move, slotRequest);
                          }}
                        >
                          <div className="ps-move__name">{moveName}</div>
                          <div className="ps-move__meta">
                            <span>{move?.type || '—'}</span>
                            {typeof move?.pp === 'number' ? <span>PP {move.pp}/{move.maxpp ?? move.pp}</span> : null}
                            {typeof move?.power === 'number' && move.power > 0 ? <span>BP {move.power}</span> : null}
                            {move?.z ? <span>Z</span> : null}
                            {move?.mega ? <span>Mega</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="ps-command-section">
          <h4>Switch</h4>
          {entries.length ? renderSwitchButtons(entries, playerId, side) : <div className="ps-empty">No reserves available.</div>}
        </div>
        <div className="ps-command-footer">
          <button className="secondary" onClick={() => sendAuto(playerId, side)}>Auto</button>
        </div>
      </div>
    );
  };

  const renderCommandPanel = () => {
    if (!mySide) return <div className="ps-command-status">Spectating – no actions required.</div>;
    const playerId = playerIds[mySide] || prompt?.playerId || client.user?.id;
    if (!playerId) return <div className="ps-command-status">Awaiting identification…</div>;
    const rawRequest = requestBySide[mySide] ?? promptRequests[mySide] ?? derivedRequests[mySide];
    const request = coerceRequestObject(rawRequest);
    if (!request) return <div className="ps-command-status">No decision needed right now.</div>;
    if (request.teamPreview) return renderTeamPreview(request, playerId, mySide);
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
      }
    };
    return (
      <div key={`${side}-active-${idx}`} className={`ps-pokemon-card${hpPct <= 0 ? ' fainted' : ''}`}>
        <div className="ps-pokemon-card__header">
          <div className="ps-pokemon-card__name">{name}</div>
          {typeof pkm?.level === 'number' ? <div className="ps-pokemon-card__level">Lv {pkm.level}</div> : null}
          {status ? <div className={`ps-status ps-status--${status}`}>{status.toUpperCase()}</div> : null}
        </div>
        <div className="ps-pokemon-card__sprite">
          <img alt={name} src={chain.initial} data-fb-idx="0" {...spriteProps} />
        </div>
        <div className="ps-pokemon-card__hp">
          <div className="ps-pokemon-card__hpbar"><span style={{ width: `${hpPct}%`, background: hpColor(hpPct) }} /></div>
          <div className="ps-pokemon-card__hptext">{hpPct}%{text && !status ? ` • ${text}` : ''}</div>
        </div>
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
        <div className="ps-battle__info">
          <span>Phase: <strong>{phase?.phase || '—'}</strong></span>
          {deadlineLabel ? <span>Timer: {deadlineLabel}</span> : null}
          {needsSwitchPending ? <span className="ps-battle__warning">Switch required</span> : null}
          {watchers.length ? <span className="ps-battle__watchers">Watching: {watchers.map(w => shortName(w)).join(', ')}</span> : null}
        </div>
      </header>
      <div className="ps-battle__layout">
        <div className="ps-battle__field">
          <div className={`ps-lineup ps-lineup--${topRole}`}>
            {topRole === 'player' ? renderTrainerAvatar(topSide) : renderLineup(topSide)}
            {topRole === 'player' ? renderLineup(topSide) : renderTrainerAvatar(topSide)}
          </div>
          <div className="ps-active-zone">
            <div className={`ps-active-slot ps-active-slot--${topRole}`}>
              <div className="ps-actor__header">
                <span>{sideNames[topSide]}</span>
                <span className="dim">{secondaryLabelForSide(topSide)}</span>
              </div>
              <div className="ps-actor__active">
                {activesBySide[topSide].length ? activesBySide[topSide].map((pkm, idx) => renderActiveCard(pkm, topSide, idx)) : <div className="ps-empty">No active Pokémon</div>}
              </div>
            </div>
            <div className={`ps-active-slot ps-active-slot--${bottomRole}`}>
              <div className="ps-actor__header">
                <span>{sideNames[bottomSide]}</span>
                <span className="dim">{secondaryLabelForSide(bottomSide)}</span>
              </div>
              <div className="ps-actor__active">
                {activesBySide[bottomSide].length ? activesBySide[bottomSide].map((pkm, idx) => renderActiveCard(pkm, bottomSide, idx)) : <div className="ps-empty">No active Pokémon</div>}
              </div>
            </div>
          </div>
          <div className={`ps-lineup ps-lineup--${bottomRole}`}>
            {bottomRole === 'player' ? renderTrainerAvatar(bottomSide) : renderLineup(bottomSide)}
            {bottomRole === 'player' ? renderLineup(bottomSide) : renderTrainerAvatar(bottomSide)}
          </div>
        </div>
        <aside className="ps-battle__log">
          <div className="ps-battle__log-section">
            <h3>Battle Log</h3>
            {log.length === 0
              ? <div className="ps-empty">No battle messages yet.</div>
              : (
                <div className="ps-battle__log-list">
                  {log.map((line, idx) => <div key={`${idx}-${line}`} className="ps-battle__log-line">{sanitizeLogLine(line)}</div>)}
                </div>
              )}
          </div>
          <div className="ps-battle__log-section">
            <h3>Chat</h3>
            <div className="ps-battle__chat-list">
              {chatMessages.length === 0
                ? <div className="ps-empty">No messages yet. Say hi!</div>
                : chatMessages.map(msg => (
                  <div key={`${msg.time}-${msg.user}-${msg.text}`} className="ps-chat-line">
                    <span className="ps-chat-user">{msg.user}</span>
                    <span className="ps-chat-text">{msg.text}</span>
                  </div>
                ))}
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
          </div>
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
