/**
 * Pokemon Showdown Battle Panel (React Wrapper)
 * 
 * This component wraps the Pokemon Showdown battle engine UI,
 * providing full PS battle experience with tooltips, animations,
 * and all PS features.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { withPublicBase } from '../utils/publicBase';
import { loadPokemonShowdown, createPSBattle, getDex, toID } from './ps-loader';
import { ProtocolConverter, requestToPS } from './protocol-adapter';
import type { PoketTRPGClient } from '../net/pokettrpgClient';
import { getCustomSprite, getSpriteIdCandidates, hasRealBackSprite, normalizeName } from '../data/adapter';
import './ps-battle.css';

/** Set to true to enable verbose console logging during battles. */
const PS_DEBUG = false;

// Types for PS Battle
interface PSBattleRequest {
  requestType?: 'move' | 'switch' | 'team' | 'wait';
  active?: any[];
  side?: {
    id: string;
    name: string;
    pokemon: any[];
  };
  forceSwitch?: boolean[];
  teamPreview?: boolean;
  previewActiveCount?: number;
  teamPreviewParticipants?: Record<string, Array<{ playerId: string; name: string; trainerSprite?: string; team: any[]; previewActiveCount?: number }>>;
  maxTeamSize?: number;
  activeCount?: number;
  gameType?: string;
  rqid?: number;
}

interface PSBattlePanelProps {
  roomId: string;
  client?: PoketTRPGClient;
  myPlayerId?: string;
  onBattleEnd?: (winner: string) => void;
  onClose?: () => void;
  // Replay mode props
  isReplay?: boolean;
  replayProtocol?: string[];
}

// Track whether we've already fed the initial protocol to prevent duplicates
let initialProtocolFed = false;

function calculateStatFromBase(base: number | undefined, level: number | undefined, isHP: boolean): number | undefined {
  if (typeof base !== 'number') return undefined;
  const lvl = typeof level === 'number' ? level : 100;
  const iv = 31;
  const ev = 0;
  if (isHP) {
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * lvl) / 100) + lvl + 10;
  }
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * lvl) / 100) + 5;
}

function buildStatsFromBase(baseStats: any, level: number | undefined): any {
  if (!baseStats) return undefined;
  return {
    hp: calculateStatFromBase(baseStats.hp, level, true),
    atk: calculateStatFromBase(baseStats.atk, level, false),
    def: calculateStatFromBase(baseStats.def, level, false),
    spa: calculateStatFromBase(baseStats.spa, level, false),
    spd: calculateStatFromBase(baseStats.spd, level, false),
    spe: calculateStatFromBase(baseStats.spe, level, false),
  };
}

function resolveSpeciesName(poke: any): string | undefined {
  return poke?.speciesForme || poke?.species || poke?.name || poke?.details?.split(',')[0];
}

function resolveLevel(poke: any, fallback?: number): number | undefined {
  if (typeof poke?.level === 'number') return poke.level;
  const details = poke?.details as string | undefined;
  const match = details?.match(/, L(\d+)/);
  if (match) return parseInt(match[1], 10);
  return fallback;
}

function normalizeTrainerSpriteId(raw?: string): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = typeof raw === 'number' && Number.isFinite(raw)
    ? String(Math.trunc(raw))
    : typeof raw === 'string'
      ? raw
      : '';
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withoutFragment = trimmed.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  const segments = withoutQuery.replace(/\\/g, '/').split('/').filter(Boolean);
  let candidate = (segments.length ? segments[segments.length - 1] : withoutQuery).replace(/\.png$/i, '').trim();
  if (!candidate) return undefined;
  candidate = candidate
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  if (!candidate) return undefined;
  if (candidate.includes('ace-trainer')) {
    candidate = candidate.replace(/ace-trainer/g, 'acetrainer');
  }
  if (candidate === 'pending' || candidate === 'random' || candidate === 'default' || candidate === 'unknown' || candidate === 'none') return undefined;
  if (/^trainer-?\d+$/i.test(candidate)) return undefined;
  return candidate;
}

function isDirectTrainerSprite(raw?: string): boolean {
  if (!raw) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed) || /^asset:/i.test(trimmed) || /^tauri:/i.test(trimmed) || trimmed.startsWith('/');
}

function resolveTrainerSprite(avatar?: string, fallback?: string): string {
  if (isDirectTrainerSprite(avatar)) return String(avatar).trim();
  if (isDirectTrainerSprite(fallback)) return String(fallback).trim();
  const normalized = normalizeTrainerSpriteId(avatar);
  if (normalized) return normalized;
  const fallbackNormalized = normalizeTrainerSpriteId(fallback);
  if (fallbackNormalized) return fallbackNormalized;
  return 'acetrainer';
}

function getLocalTrainerSpriteId(client?: { getTrainerSprite?: () => string | null }): string | undefined {
  const fromClient = client?.getTrainerSprite?.();
  const normalizedClient = normalizeTrainerSpriteId(fromClient || undefined);
  if (normalizedClient) return normalizedClient;
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage?.getItem('ttrpg.trainerSprite') || undefined;
    return normalizeTrainerSpriteId(raw);
  } catch {
    return undefined;
  }
}

function parseActiveSwitchLine(line: string): { side: 'p1' | 'p2'; name: string } | null {
  if (!line.startsWith('|switch|') && !line.startsWith('|drag|') && !line.startsWith('|replace|')) {
    return null;
  }
  const parts = line.split('|');
  const ident = parts[2] || '';
  const match = ident.match(/^(p1|p2)[a-z]?:\s*(.+)$/);
  if (!match) return null;
  return { side: match[1] as 'p1' | 'p2', name: match[2].trim() };
}

/**
 * SlotMatrix — scalable data structure for N-slot battles (singles/doubles/triples).
 * Partitions a side's Pokemon into active, benched, and fainted arrays.
 * Each entry preserves the original sideIndex (position in side.pokemon[]).
 * Active entries also track their slotIndex (0=a, 1=b, 2=c) for move/choice mapping.
 */
interface SlotMatrixEntry {
  pokemon: any;
  sideIndex: number;      // Index in request.side.pokemon[]
  name: string;           // Resolved display name
}

interface SlotMatrix {
  active: Array<SlotMatrixEntry & { slotIndex: number }>;  // On-field Pokemon with slot position
  benched: SlotMatrixEntry[];                                // Available to switch in
  fainted: SlotMatrixEntry[];                                // KO'd
  /** Get the active Pokemon for a given choice slot (0-indexed) */
  activeAt(choiceIndex: number): (SlotMatrixEntry & { slotIndex: number }) | undefined;
  /** Get display name for a given choice slot */
  nameAt(choiceIndex: number): string;
}

function buildSlotMatrix(pokemon: any[] | undefined): SlotMatrix {
  const active: SlotMatrix['active'] = [];
  const benched: SlotMatrix['benched'] = [];
  const fainted: SlotMatrix['fainted'] = [];

  if (pokemon) {
    // First pass: count how many Pokemon have `active: true` to determine slot ordering
    // The slotIndex tracks position among ALL active-flagged Pokemon (including fainted)
    let slotIndex = 0;
    for (let i = 0; i < pokemon.length; i++) {
      const p = pokemon[i];
      const condition = p?.condition || '';
      const isFainted = p?.fainted || condition.includes('fnt') || /^0\b/.test(condition);
      const name = p?.ident?.split(': ')[1] || p?.details?.split(',')[0] || p?.name || p?.species || 'Pokemon';

      if (p?.active) {
        if (isFainted) {
          // Fainted but was in an active slot — track the slot index but put in fainted
          fainted.push({ pokemon: p, sideIndex: i, name });
        } else {
          active.push({ pokemon: p, sideIndex: i, slotIndex, name });
        }
        slotIndex++; // increment for all active-flagged, even fainted ones
      } else if (isFainted) {
        fainted.push({ pokemon: p, sideIndex: i, name });
      } else {
        benched.push({ pokemon: p, sideIndex: i, name });
      }
    }
  }

  return {
    active,
    benched,
    fainted,
    activeAt(choiceIndex: number) { return active.find(a => a.slotIndex === choiceIndex) || active[choiceIndex]; },
    nameAt(choiceIndex: number) { const a = active.find(e => e.slotIndex === choiceIndex) || active[choiceIndex]; return a?.name || 'your Pokemon'; },
  };
}

// Derive a stable ID from prompt pokemon data
// Server prompt uses ident like "p1: Charizard" but no id field
function derivePokemonId(poke: any): string | undefined {
  if (poke?.id) return poke.id;
  if (poke?.pokemonId) return poke.pokemonId;
  // Derive from ident: "p1: Charizard" -> "charizard"
  const identName = poke?.ident?.split(': ')[1];
  if (identName) return toID(identName);
  // Derive from details: "Charizard, L50, F" -> "charizard"
  const detailsName = poke?.details?.split(',')[0];
  if (detailsName) return toID(detailsName);
  // Fallback to name/species
  if (poke?.name) return toID(poke.name);
  if (poke?.species) return toID(poke.species);
  return undefined;
}

// Find matching Pokemon in state team by name/species/id
function findMatchingStatePoke(poke: any, stateTeam: any[]): any | undefined {
  if (!stateTeam?.length) return undefined;
  const pokeId = derivePokemonId(poke);
  const pokeName = poke?.ident?.split(': ')[1] || poke?.details?.split(',')[0] || poke?.name;
  const pokeSpecies = poke?.species || poke?.speciesForme;
  
  return stateTeam.find((sp: any) => {
    // Match by id first (most reliable)
    if (pokeId && sp.id && toID(sp.id) === pokeId) return true;
    if (pokeId && sp.pokemonId && toID(sp.pokemonId) === pokeId) return true;
    // Match by name
    if (pokeName && sp.name && toID(sp.name) === toID(pokeName)) return true;
    if (pokeName && sp.nickname && toID(sp.nickname) === toID(pokeName)) return true;
    // Match by species
    if (pokeSpecies && sp.species && toID(sp.species) === toID(pokeSpecies)) return true;
    return false;
  });
}

function findPokemonIndexByName(pokemonList: any[], name: string): number {
  if (!name || !pokemonList?.length) return -1;
  const needle = toID(name);
  return pokemonList.findIndex((p: any) => {
    const candidates = [
      p?.id,
      p?.pokemonId,
      p?.name,
      p?.species,
      p?.speciesForme,
      p?.nickname,
      p?.ident?.split(': ')[1],
      p?.details?.split(',')[0],
    ].filter(Boolean);
    return candidates.some((c: any) => toID(c) === needle);
  });
}

// Generate team preview protocol from state
function generateTeamPreviewProtocol(
  state: any,
  maxTeamSize: number = 6,
  localPlayerId?: string,
  localTrainerSprite?: string,
  previewCountOverride?: number,
): string[] {
  if (!state || !state.players) {
    PS_DEBUG && console.log('[PSBattlePanel] generateTeamPreviewProtocol - no state or players');
    return [];
  }
  
  const lines: string[] = [];
  const previewCount = previewCountOverride ?? state?.previewActiveCount ?? state?.rules?.activeCount ?? state?.rules?.active?.count ?? 1;
  
  PS_DEBUG && console.log('[PSBattlePanel] Generating team preview protocol for', state.players.length, 'players');
  PS_DEBUG && console.log('[DIAG-PROTOCOL] [generateTeamPreviewProtocol] CALLED - will generate local team preview lines');
  
  // Game setup - use gen 9 for better sprite support
  const gameType = state?.gameType || 'singles';
  lines.push(`|gametype|${gameType}`);
  
  // Players
  state.players.forEach((player: any, idx: number) => {
    const side = `p${idx + 1}`;
    const name = player.name || player.id;
    const isLocal = !!localPlayerId && player.id === localPlayerId;
    const avatar = resolveTrainerSprite(player.avatar || player.trainerSprite, isLocal ? localTrainerSprite : undefined);
    lines.push(`|player|${side}|${name}|${avatar}|`);
  });
  
  // Team sizes (PS protocol includes teamsize before team preview)
  state.players.forEach((player: any, idx: number) => {
    const side = `p${idx + 1}`;
    const teamSize = player.team?.length || 0;
    lines.push(`|teamsize|${side}|${teamSize}`);
  });
  
  lines.push('|gen|9');
  lines.push('|tier|[Gen 9] Custom Game');
  
  // Clear any previous team preview data
  lines.push('|clearpoke');
  
  // Pokemon for each player (team preview format)
  state.players.forEach((player: any, idx: number) => {
    const side = `p${idx + 1}`;
    const team = player.team || [];
    PS_DEBUG && console.log('[PSBattlePanel] Player', side, 'team:', team.map((p: any) => p.species || p.name));
    team.forEach((poke: any) => {
      const species = poke.species || poke.name;
      const level = poke.level || 100;
      const gender = poke.gender === 'M' ? ', M' : (poke.gender === 'F' ? ', F' : '');
      const shiny = poke.shiny ? ', shiny' : '';
      const hasItem = poke.item ? 'item' : '';
      // Format: |poke|p1|Species, L50, M|item
      lines.push(`|poke|${side}|${species}, L${level}${gender}${shiny}|${hasItem}`);
    });
  });
  
  // Team preview command (PS uses |teampreview|<count> and a blank line after)
  lines.push(`|teampreview|${previewCount}`);
  lines.push('|');
  
  PS_DEBUG && console.log('[PSBattlePanel] Generated', lines.length, 'protocol lines');
  PS_DEBUG && console.log('[DIAG-PROTOCOL] [generateTeamPreviewProtocol] FINISHED - generated lines:', lines.filter(l => l.startsWith('|teampreview') || l.startsWith('|start') || l.startsWith('|turn')));
  
  return lines;
}

// Generate PS protocol lines from battle state
function generateBattleProtocol(
  state: any,
  isStart: boolean = false,
  localPlayerId?: string,
  localTrainerSprite?: string
): string[] {
  if (!state || !state.players) return [];
  
  const lines: string[] = [];
  
  // Game setup - use gen 9 for better sprite support
  const gameType = state?.gameType || 'singles';
  lines.push(`|gametype|${gameType}`);
  lines.push('|gen|9');
  lines.push('|tier|[Gen 9] Custom Game');
  
  // Players
  state.players.forEach((player: any, idx: number) => {
    const side = `p${idx + 1}`;
    const name = player.name || player.id;
    const isLocal = !!localPlayerId && player.id === localPlayerId;
    const avatar = resolveTrainerSprite(player.avatar || player.trainerSprite, isLocal ? localTrainerSprite : undefined);
    lines.push(`|player|${side}|${name}|${avatar}|`);
  });
  
  // Team sizes
  state.players.forEach((player: any, idx: number) => {
    const side = `p${idx + 1}`;
    const teamSize = player.team?.length || 0;
    lines.push(`|teamsize|${side}|${teamSize}`);
  });
  
  if (isStart) {
    PS_DEBUG && console.log('[DIAG-PROTOCOL] [generateBattleProtocol] isStart=true - WILL GENERATE |start| and |turn|');
    lines.push('|start');
    // Switch in the active Pokemon for each side (handles doubles/triples via activeIndices)
    const slotLetters = ['a', 'b', 'c', 'd', 'e', 'f'];
    state.players.forEach((player: any, idx: number) => {
      const side = `p${idx + 1}`;
      const activeIndices: number[] = player.activeIndices || [player.activeIndex || 0];
      for (let slotIdx = 0; slotIdx < activeIndices.length; slotIdx++) {
        const ai = activeIndices[slotIdx];
        if (ai < 0) continue;
        const activePoke = player.team?.[ai];
        if (!activePoke) continue;
        const nickname = activePoke.nickname || activePoke.name;
        const species = activePoke.species || activePoke.name;
        const level = activePoke.level || 100;
        const gender = activePoke.gender === 'M' ? ', M' : (activePoke.gender === 'F' ? ', F' : '');
        const shiny = (activePoke as any).shiny ? ', shiny' : '';
        const hp = activePoke.currentHP ?? activePoke.maxHP ?? 100;
        const maxHP = activePoke.maxHP ?? 100;
        
        // Format: |switch|p1a: Nickname|Species, L50, M|HP/MaxHP
        const details = `${species}, L${level}${gender}${shiny}`;
        const slot = slotLetters[slotIdx] || 'a';
        lines.push(`|switch|${side}${slot}: ${nickname}|${details}|${hp}/${maxHP}`);
      }
    });
    
    // Turn announcement
    const turn = state.turn || 1;
    lines.push(`|turn|${turn}`);
    PS_DEBUG && console.log('[DIAG-PROTOCOL] [generateBattleProtocol] Generated |start| + |turn|' + turn + ' (state.turn=' + state.turn + ')');
  }
  
  return lines;
}

// Generate PS request JSON for the prompt
function generatePSRequest(prompt: any, state: any, side: 'p1' | 'p2'): any {
  if (!prompt) return null;
  
  const playerIndex = side === 'p1' ? 0 : 1;
  const player = state?.players?.[playerIndex];
  
  if (!player) return null;
  
  // Build the request object in PS format
  const requestType = prompt.teamPreview
    ? 'team'
    : (prompt.requestType || (prompt.forceSwitch ? 'switch' : 'move'));
  const request: any = {
    requestType,
    rqid: Date.now(),
    side: {
      id: side,
      name: player.name || player.id,
      pokemon: (player.team || []).map((poke: any, i: number) => {
        const hp = poke.currentHP ?? poke.maxHP ?? 100;
        const maxHP = poke.maxHP ?? 100;
        return {
          ident: `${side}: ${poke.nickname || poke.name}`,
          details: `${poke.species || poke.name}, L${poke.level || 100}${poke.gender === 'M' ? ', M' : poke.gender === 'F' ? ', F' : ''}`,
          condition: `${hp}/${maxHP}`,
          active: i === (player.activeIndex || 0),
          stats: poke.baseStats,
          moves: (poke.moves || []).map((m: any) => m.id || m.name?.toLowerCase().replace(/\s/g, '')),
          baseAbility: poke.ability,
          item: poke.item || '',
          pokeball: 'pokeball',
        };
      }),
    },
  };
  
  // Add active Pokemon moves
  if (requestType === 'move' && prompt.active) {
    request.active = prompt.active.map((active: any) => ({
      moves: (active.moves || []).map((m: any) => ({
        move: m.name,
        id: m.id,
        pp: m.pp ?? 10,
        maxpp: m.maxpp ?? 10,
        target: m.target || 'normal',
        disabled: m.disabled || false,
      })),
      canMegaEvo: active.canMegaEvo || false,
      canDynamax: active.canDynamax || false,
      canZMove: active.canZMove || null,
    }));
  }
  
  if (prompt.forceSwitch) {
    request.forceSwitch = prompt.forceSwitch;
  }
  
  if (prompt.teamPreview) {
    request.teamPreview = true;
    request.maxTeamSize = prompt.maxTeamSize || 6;
  }
  
  return request;
}

// Helper to fast-forward the battle queue (used only for initial/cached sync)
function fastForwardToEnd(battle: any): void {
  if (!battle) return;
  
  try {
    if (typeof battle.seekTurn === 'function') {
      battle.seekTurn(Infinity);
    } else {
      let maxSteps = 1000;
      while (battle.currentStep < battle.stepQueue?.length && maxSteps-- > 0) {
        if (typeof battle.nextStep === 'function') {
          battle.nextStep();
        } else {
          break;
        }
      }
    }

    if (battle.scene && typeof battle.scene.updateGen === 'function') {
      battle.scene.updateGen();
    }
  } catch (e) {
    console.warn('[PSBattlePanel] Error fast-forwarding battle:', e);
  }
}

function isInitProtocolLine(line: string): boolean {
  return line === '|' ||
    line.startsWith('|t:|') ||
    line.startsWith('|gametype|') ||
    line.startsWith('|player|') ||
    line.startsWith('|teamsize|') ||
    line.startsWith('|gen|') ||
    line.startsWith('|tier|') ||
    line.startsWith('|clearpoke') ||
    line.startsWith('|poke|') ||
    line.startsWith('|teampreview');
}

function hashStringToInt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Safe wrapper for getting Pokemon icon style
// Dex.getPokemonIcon returns a CSS style attribute string
// We need to convert this to a React style object
function getPokemonIconStyle(species: string | undefined): React.CSSProperties {
  // Base styles for icon display
  const baseStyles: React.CSSProperties = {
    display: 'inline-block',
    width: '40px',
    height: '30px',
  };

  const iconSheet = `var(--ps-pokemonicons-sheet, url('${withPublicBase('vendor/showdown/sprites/pokemonicons-sheet.png?v20')}'))`;
  const pokeballSheet = `var(--ps-pokemonicons-pokeball-sheet, url('${withPublicBase('vendor/showdown/sprites/pokemonicons-pokeball-sheet.png?v20')}'))`;
  
  if (!species) {
    // Return pokeball icon for missing species
    return {
      ...baseStyles,
      background: `transparent ${pokeballSheet} no-repeat scroll -0px 4px`,
    };
  }
  
  try {
    const dex = getDex();
    const speciesId = toID(species);
    
    // Method 1: Use Dex.getPokemonIcon if available
    if (dex?.getPokemonIcon) {
      const styleStr = dex.getPokemonIcon(speciesId);
      
      if (styleStr && typeof styleStr === 'string' && styleStr.includes('url(')) {
        // Parse the CSS string into a style object
        const styles: React.CSSProperties = { ...baseStyles };
        
        const bgMatch = styleStr.match(/background:\s*([^;]+)/);
        if (bgMatch) {
          const bgValue = bgMatch[1].trim();
          if (bgValue.includes('pokemonicons-sheet')) {
            styles.background = bgValue.replace(/url\([^)]*pokemonicons-sheet[^)]*\)/, iconSheet);
          } else if (bgValue.includes('pokemonicons-pokeball-sheet')) {
            styles.background = bgValue.replace(/url\([^)]*pokemonicons-pokeball-sheet[^)]*\)/, pokeballSheet);
          } else {
            styles.background = bgValue;
          }
        }
        const opacityMatch = styleStr.match(/opacity:\s*([\d.]+)/);
        if (opacityMatch) {
          styles.opacity = parseFloat(opacityMatch[1]);
        }
        const filterMatch = styleStr.match(/filter:\s*([^;]+)/);
        if (filterMatch) {
          styles.filter = filterMatch[1].trim();
        }
        return styles;
      }
    }
    
    // Method 2: Use the same lookup chain as Dex.getPokemonIconNum
    const sprites = (window as any).BattlePokemonSprites;
    const pokedex = (window as any).BattlePokedex;
    const iconIndexes = (window as any).BattlePokemonIconIndexes;
    
    // Follow the same lookup order as PS: BattlePokemonIconIndexes > BattlePokemonSprites > BattlePokedex
    let num = 0;
    
    // First try BattlePokemonSprites (from pokedex-mini.js)
    if (sprites?.[speciesId]?.num) {
      num = sprites[speciesId].num;
    } else if (pokedex?.[speciesId]?.num) {
      num = pokedex[speciesId].num;
    }
    
    // Then override with BattlePokemonIconIndexes if present (has actual icon positions)
    if (iconIndexes?.[speciesId]) {
      num = iconIndexes[speciesId];
    }
    
    // Clamp to valid range
    if (num < 0 || num > 1500) num = 0;
    
    // Calculate position in sprite sheet (12 icons per row, each 40x30)
    const top = Math.floor(num / 12) * 30;
    const left = (num % 12) * 40;
    
    return {
      ...baseStyles,
      background: `transparent ${iconSheet} no-repeat scroll -${left}px -${top}px`,
    };
  } catch (e) {
    console.warn('[PSBattlePanel] Error getting Pokemon icon for', species, ':', e);
  }
  
  // Fallback: return pokeball icon
  return {
    ...baseStyles,
    background: `transparent ${pokeballSheet} no-repeat scroll -0px 4px`,
  };
}

export const PSBattlePanel: React.FC<PSBattlePanelProps> = ({
  roomId,
  client,
  myPlayerId,
  onBattleEnd,
  onClose,
  isReplay = false,
  replayProtocol,
}) => {
  void onClose;
  const battleFrameRef = useRef<HTMLDivElement>(null);
  const logFrameRef = useRef<HTMLDivElement>(null);
  const controlsContainerRef = useRef<HTMLDivElement>(null); // Ref for battle controls to bind tooltips
  const battleRef = useRef<any>(null);
  const tooltipsRef = useRef<any>(null);
  const pendingEventsRef = useRef<any[]>([]); // Queue events that arrive before battle is ready
  const pendingProtocolRef = useRef<string[]>([]); // Queue protocol lines before battle is ready
  const battleReadyRef = useRef(false);
  const lastLogLengthRef = useRef(0); // Track how many log lines we've already fed
  const initialProtocolFedRef = useRef(false); // Prevent feeding protocol twice
  const teamPreviewFedRef = useRef(false); // Track if team preview protocol has been fed
  const battleStartedRef = useRef(false); // Track if battle has started (past team preview)
  const startEventReceivedRef = useRef(false); // Track if |start| event has been received from server
  const pendingAutoFirstTurnRef = useRef(false); // Track if we have a pending turn 1 move to auto-send
  const tooltipsListenedRef = useRef(false); // Track if we've bound tooltips
  const lastActionTurnRef = useRef<number>(-1); // Track the last turn we sent an action for
  const lastRqidRef = useRef<number | null>(null); // Track the last request ID we responded to
  const autoFirstTurnRef = useRef(false); // Auto-select first turn move
  const pendingMovePromptRef = useRef<PSBattleRequest | null>(null); // Hold move prompt until |start|
  const pendingTeamPreviewLinesRef = useRef<string[]>([]); // Hold team preview protocol until battle is ready
  const deferredPostStartLinesRef = useRef<string[]>([]); // Hold post-|start| lines until team order is submitted
  const latestPromptTurnRef = useRef<number>(0);
  const latestPromptRqidRef = useRef<number | null>(null);
  const teamSubmittedRef = useRef(false);
  const lastActiveBySideRef = useRef<{ p1?: string; p2?: string }>({});
  const lastActiveUpdateRef = useRef<number>(0);
  const hasReceivedProtocolRef = useRef(false);
  const mySideRef = useRef<'p1' | 'p2' | null>(null); // Ref for mySide to use in callbacks
  const lastBattleStateRef = useRef<any | null>(null); // Track latest battle state for UI rendering
  const bossParticipantsRef = useRef<Record<string, { playerId: string; name: string; trainerSprite?: string; pokemonIds: string[] }[]> | null>(null);
  const lastSentChoiceRef = useRef<{ turn: number; choice: string; rqid: number | null } | null>(null);
  // Track when we've just sent an action - don't drop server responses immediately after
  const actionSentTimestampRef = useRef<number>(0);
  // Multi-slot: accumulate sub-actions for each active slot (doubles/triples)
  const pendingSlotChoicesRef = useRef<any[]>([]);
  
  // DIAGNOSTIC: Track protocol events for debugging turn 1 / team preview issues
  const protocolEventLogRef = useRef<Array<{ time: number; source: string; event: string; battleTurn?: number }>>([]);
  const diagLogProtocol = PS_DEBUG ? (source: string, event: string) => {
    const battle = battleRef.current;
    const entry = { time: Date.now(), source, event, battleTurn: battle?.turn };
    protocolEventLogRef.current.push(entry);
    PS_DEBUG && console.log(`[DIAG-PROTOCOL] [${source}] ${event} | battle.turn=${battle?.turn ?? 'N/A'} | startEventReceived=${startEventReceivedRef.current} | teamPreviewFed=${teamPreviewFedRef.current} | teamSubmitted=${teamSubmittedRef.current}`);
    // Keep log bounded
    if (protocolEventLogRef.current.length > 200) protocolEventLogRef.current.shift();
  } : (_source: string, _event: string) => {};
  
  // DIAGNOSTIC: Expose dump function for debugging
  useEffect(() => {
    if (!PS_DEBUG) return;
    (window as any).dumpProtocolLog = () => {
      PS_DEBUG && console.log('=== PROTOCOL EVENT LOG ===');
      const log = protocolEventLogRef.current;
      const startTime = log[0]?.time || 0;
      log.forEach((entry, i) => {
        const relTime = entry.time - startTime;
        PS_DEBUG && console.log(`[${i}] +${relTime}ms [${entry.source}] turn=${entry.battleTurn} | ${entry.event}`);
      });
      PS_DEBUG && console.log('=== END LOG ===');
      return log;
    };
    PS_DEBUG && console.log('[DIAG-PROTOCOL] To dump protocol log, run: dumpProtocolLog()');
  }, []);
  
  const [localTrainerSprite, setLocalTrainerSprite] = useState<string | undefined>(() => getLocalTrainerSpriteId(client));
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<PSBattleRequest | null>(null);
  const [choices, setChoices] = useState<any>(null);
  const [choicesVersion, setChoicesVersion] = useState(0);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const cancelledTurnsRef = useRef<Set<number>>(new Set());
  const [waitingForAnimations, setWaitingForAnimations] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [spectatorView, setSpectatorView] = useState<'p1' | 'p2'>('p1');
  const [spectatorTurn, setSpectatorTurn] = useState<number | null>(null); // null = live
  const [mySide, setMySide] = useState<'p1' | 'p2' | null>(null);
  const [currentTurn, setCurrentTurn] = useState<number>(0); // Track current turn for duplicate prevention
  const [currentRqid, setCurrentRqid] = useState<number | null>(null); // Track request ID
  const [moveBoosts, setMoveBoosts] = useState({ mega: false, z: false, max: false, tera: false });
  const [pendingMoveForTarget, setPendingMoveForTarget] = useState<{ moveIndex: number; moveName: string } | null>(null);
  const [teamPreviewLeads, setTeamPreviewLeads] = useState<number[]>([]); // Multi-lead selection for doubles/triples
  const protocolConverterRef = useRef(new ProtocolConverter());
  const requestRef = useRef<PSBattleRequest | null>(null);
  const waitingForOpponentRef = useRef(false);
  // Store the last valid move request so we can restore it on cancel
  const lastMoveRequestRef = useRef<PSBattleRequest | null>(null);
  const lastMoveChoicesRef = useRef<any>(null);
  const currentTurnRef = useRef<number>(0);
  const opponentStateRefreshRequestedRef = useRef<number>(0); // Track when we last requested opponent state
  const waitStartTimeRef = useRef<number>(0); // Track when we started waiting for opponent
  const animationCheckRef = useRef<number | null>(null);
  const iconSheetReadyRef = useRef(false);
  const backdropObserverRef = useRef<MutationObserver | null>(null);
  const backdropCheckCacheRef = useRef<Map<string, boolean>>(new Map());
  const lastBackdropUrlRef = useRef<string | null>(null);

  const ensureBackdropFallback = useCallback(() => {
    // Background images are now synced locally from gen6bgs folder
    // No fallback needed - just ensure the backdrop element exists
    const backdropEl = battleFrameRef.current?.querySelector('.backdrop') as HTMLElement | null;
    if (!backdropEl) return;
    const bgImage = backdropEl.style.backgroundImage || '';
    const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/i);
    if (!match) {
      if (lastBackdropUrlRef.current) {
        backdropEl.style.backgroundImage = `url('${lastBackdropUrlRef.current}')`;
      }
      return;
    }
    const url = match[1];
    if (!url || !url.includes('/sprites/gen6bgs/')) return;
    lastBackdropUrlRef.current = url;
  }, []);
  
  // Keep mySideRef in sync with mySide state
  useEffect(() => {
    mySideRef.current = mySide;
  }, [mySide]);

  useEffect(() => {
    if (!isSpectator && mySide) {
      setSpectatorView(mySide);
    }
  }, [isSpectator, mySide]);

  // REPLAY MODE: Feed protocol to battle when replayProtocol changes
  const lastReplayProtocolLengthRef = useRef(0);
  useEffect(() => {
    if (!isReplay || !replayProtocol || !battleReadyRef.current) return;
    const battle = battleRef.current;
    if (!battle) return;
    
    // Only add new lines (incremental updates)
    const newLines = replayProtocol.slice(lastReplayProtocolLengthRef.current);
    if (newLines.length === 0) return;
    
    PS_DEBUG && console.log(`[PSBattlePanel] Replay mode: feeding ${newLines.length} protocol lines`);
    for (const line of newLines) {
      if (line && typeof line === 'string') {
        battle.add(line);
      }
    }
    lastReplayProtocolLengthRef.current = replayProtocol.length;
    
    // Fast forward to show current state
    if (typeof battle.seekTurn === 'function') {
      battle.seekTurn(Infinity, true);
    }
  }, [isReplay, replayProtocol]);

  // Keep requestRef in sync with request state
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    waitingForOpponentRef.current = waitingForOpponent;
  }, [waitingForOpponent]);

  useEffect(() => {
    currentTurnRef.current = currentTurn;
  }, [currentTurn]);

  useEffect(() => {
    if (!client?.on) return;
    const off = client.on('trainerSpriteChanged', (payload: { trainerSprite: string | null }) => {
      const next = normalizeTrainerSpriteId(payload?.trainerSprite || undefined);
      setLocalTrainerSprite(next || undefined);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [client]);

  useEffect(() => {
    if (iconSheetReadyRef.current) return;
    iconSheetReadyRef.current = true;

    const localSheet = withPublicBase('vendor/showdown/sprites/pokemonicons-sheet.png?v20');
    const localPokeballSheet = withPublicBase('vendor/showdown/sprites/pokemonicons-pokeball-sheet.png?v20');
    const remoteSheet = 'https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?v20';
    const remotePokeballSheet = 'https://play.pokemonshowdown.com/sprites/pokemonicons-pokeball-sheet.png?v20';

    const setSheetVars = (sheetUrl: string, pokeballUrl: string) => {
      const root = document.documentElement;
      root.style.setProperty('--ps-pokemonicons-sheet', `url('${sheetUrl}')`);
      root.style.setProperty('--ps-pokemonicons-pokeball-sheet', `url('${pokeballUrl}')`);
      root.style.setProperty('--ps-category-physical', `url('${withPublicBase('vendor/showdown/sprites/categories/Physical.png')}')`);
      root.style.setProperty('--ps-category-special', `url('${withPublicBase('vendor/showdown/sprites/categories/Special.png')}')`);
      root.style.setProperty('--ps-category-status', `url('${withPublicBase('vendor/showdown/sprites/categories/Status.png')}')`);
      root.style.setProperty('--ps-fx-bg', `url('${withPublicBase('fx/bg.png')}')`);
    };

    const checkLocal = async () => {
      try {
        const res = await fetch(localSheet, { method: 'HEAD' });
        if (res.ok) {
          setSheetVars(localSheet, localPokeballSheet);
          return;
        }
      } catch {}

      try {
        const res = await fetch(localSheet, { method: 'GET' });
        if (res.ok) {
          setSheetVars(localSheet, localPokeballSheet);
          return;
        }
      } catch {}

      setSheetVars(remoteSheet, remotePokeballSheet);
    };

    void checkLocal();
  }, []);

  const forceAdvanceQueue = useCallback((battle: any, forceNextStep: boolean = false) => {
    if (!battle) return;
    try {
      PS_DEBUG && console.log('[PSBattlePanel] forceAdvanceQueue called', {
        currentStep: battle.currentStep,
        queueLen: battle.stepQueue?.length,
        atQueueEnd: battle.atQueueEnd,
        battleTurn: battle.turn,
        forceNextStep,
      });
      
      // Stop any pending animations - this should cause the animation promise to resolve
      const interruptionBefore = battle.scene?.interruptionCount ?? 0;
      if (battle.scene?.stopAnimation) {
        battle.scene.stopAnimation();
      }
      const interruptionAfter = battle.scene?.interruptionCount ?? interruptionBefore;
      
      // Clear animation wait flag
      battle.waitForAnimations = false;
      
      // If queue thinks it's at end but has more items, reset
      if (battle.atQueueEnd && battle.currentStep < (battle.stepQueue?.length || 0)) {
        PS_DEBUG && console.log('[PSBattlePanel] Resetting atQueueEnd to continue processing');
        battle.atQueueEnd = false;
      }
      
      // DO NOT bump interruptionCount or call nextStep() here!
      // The pending animation callback will still fire and call nextStep().
      // If we call nextStep() here too, we get double-processing of steps.
      // The stopAnimation() call above should cause pending animations to complete quickly.
      
      // Only call nextStep directly if explicitly requested (e.g., queue is truly stuck with no pending animation)
      if (forceNextStep && typeof battle.nextStep === 'function') {
        PS_DEBUG && console.log('[PSBattlePanel] Force calling nextStep (forceNextStep=true)');
        // Bump interruption count only when we're truly forcing
        if (battle.scene) {
          battle.scene.interruptionCount = (battle.scene.interruptionCount || 0) + 1;
        }
        battle.nextStep();
        return;
      }

      // If stopAnimation bumped interruptionCount, the animation callback will refuse to advance.
      // In that case, manually advance without bumping again to avoid a deadlock.
      if (interruptionAfter !== interruptionBefore && typeof battle.nextStep === 'function') {
        PS_DEBUG && console.log('[PSBattlePanel] stopAnimation changed interruptionCount; advancing nextStep manually');
        battle.nextStep();
      }
    } catch (e) {
      console.warn('[PSBattlePanel] Failed to force-advance queue:', e);
    }
  }, []);

  const handleSkipAnimations = useCallback(() => {
    const battle = battleRef.current;
    if (!battle) return;
    forceAdvanceQueue(battle, true);
    setWaitingForAnimations(false);
  }, [forceAdvanceQueue]);

  const applySpectatorView = useCallback((side: 'p1' | 'p2') => {
    const battle = battleRef.current;
    if (!battle) return;
    if (typeof battle.setViewpoint === 'function') {
      battle.setViewpoint(side);
    }
    setSpectatorView(side);
    if (battle.scene?.updateSidebars) {
      battle.scene.updateSidebars();
    }
  }, []);

  const seekSpectatorTurn = useCallback((target: number | 'live') => {
    const battle = battleRef.current;
    if (!battle || typeof battle.seekTurn !== 'function') return;
    if (target === 'live') {
      battle.seekTurn(Infinity, true);
      setSpectatorTurn(null);
      return;
    }
    battle.seekTurn(target, true);
    setSpectatorTurn(target);
  }, []);

  const startAnimationWait = useCallback((battle: any) => {
    if (!battle || !battle.scene) {
      setWaitingForAnimations(false);
      return;
    }

    // If we already have an actionable request pending and aren't waiting for opponent,
    // don't block the UI with animation wait — let the user interact immediately.
    const currentReq = requestRef.current;
    if (currentReq && !waitingForOpponentRef.current &&
        (currentReq.requestType === 'move' || currentReq.requestType === 'switch' ||
         currentReq.requestType === 'team' || currentReq.forceSwitch)) {
      PS_DEBUG && console.log('[PSBattlePanel] Skipping animation wait - actionable request already pending:', currentReq.requestType);
      setWaitingForAnimations(false);
      return;
    }

    const startedAt = Date.now();
    setWaitingForAnimations(true);

    if (animationCheckRef.current) {
      window.clearTimeout(animationCheckRef.current);
      animationCheckRef.current = null;
    }

    let timeoutHandled = false;
    let postTimeoutChecks = 0;
    const MAX_POST_TIMEOUT_CHECKS = 10; // Give up after 10 checks (~2 seconds) post-timeout
    
    const check = () => {
      const animating = !!battle.scene?.animating;
      const queueLen = battle.stepQueue?.length || 0;
      const currentStep = battle.currentStep || 0;
      const hasUnprocessedQueue = currentStep < queueLen;
      const atQueueEnd = !!battle.atQueueEnd;
      const waitingForAnims = !!battle.waitForAnimations;
      const elapsed = Date.now() - startedAt;

      // Check if queue is stuck: we have unprocessed items but queue processing stopped
      const isStuck = hasUnprocessedQueue && atQueueEnd && !waitingForAnims;
      
      /* PS_DEBUG && console.log('[PSBattlePanel] Animation check:', {
        elapsed,
        animating,
        queueLen,
        currentStep,
        hasUnprocessedQueue,
        atQueueEnd,
        waitingForAnims,
        isStuck,
        battleTurn: battle.turn,
        timeoutHandled,
        postTimeoutChecks,
      }); */

      // Done if: no animations and queue fully processed
      if (!animating && !hasUnprocessedQueue && !waitingForAnims) {
        PS_DEBUG && console.log('[PSBattlePanel] Animation wait complete - queue processed');
        setWaitingForAnimations(false);
        animationCheckRef.current = null;
        return;
      }
      
      // If stuck (atQueueEnd=true but has items and not waiting for animations), force advance
      if (isStuck) {
        console.warn('[PSBattlePanel] Queue stuck - force advancing', {
          elapsed,
          isStuck,
          animating,
          hasUnprocessedQueue,
        });
        // Reset atQueueEnd so nextStep will process remaining items
        battle.atQueueEnd = false;
        // Force call nextStep since no animation callback is pending
        forceAdvanceQueue(battle, true);
        // Continue checking
        animationCheckRef.current = window.setTimeout(check, 100);
        return;
      }
      
      // Timeout after 4 seconds
      if (elapsed > 4000) {
        // Only handle timeout once per wait cycle to avoid repeated interruptionCount bumps
        if (!timeoutHandled) {
          console.warn('[PSBattlePanel] Animation timeout - stopping animations', {
            elapsed,
            animating,
            waitingForAnims,
            hasUnprocessedQueue,
          });
          timeoutHandled = true;
          // Stop animations; forceAdvanceQueue will advance if stopAnimation bumps interruptionCount
          forceAdvanceQueue(battle, false);
        }
        
        // After timeout, limit how many more checks we do
        postTimeoutChecks++;
        if (postTimeoutChecks >= MAX_POST_TIMEOUT_CHECKS) {
          console.warn('[PSBattlePanel] Animation wait giving up after max post-timeout checks');
          setWaitingForAnimations(false);
          animationCheckRef.current = null;
          return;
        }
        
        // Give it a bit more time for callbacks to fire, then check again
        animationCheckRef.current = window.setTimeout(check, 200);
        return;
      }
      
      animationCheckRef.current = window.setTimeout(check, 100);
    };

    animationCheckRef.current = window.setTimeout(check, 100);
  }, [forceAdvanceQueue]);

  useEffect(() => {
    return () => {
      if (animationCheckRef.current) {
        window.clearTimeout(animationCheckRef.current);
        animationCheckRef.current = null;
      }
      if (backdropObserverRef.current) {
        backdropObserverRef.current.disconnect();
        backdropObserverRef.current = null;
      }
    };
  }, []);
  
  // Initialize PS and create battle
  useEffect(() => {
    let mounted = true;
    let battle: any = null;
    
    const init = async () => {
      try {
        PS_DEBUG && console.log('[PSBattlePanel] Starting initialization...');
        setLoading(true);
        setError(null);
        
        // Load PS client
        PS_DEBUG && console.log('[PSBattlePanel] Loading PS client...');
        await loadPokemonShowdown();
        PS_DEBUG && console.log('[PSBattlePanel] PS client loaded!');

        // Mute PS audio to avoid promise rejections from missing audio assets (can stall animations)
        if (window.PS?.prefs) {
          window.PS.prefs.mute = true;
          window.PS.prefs.musicvolume = 0;
          window.PS.prefs.effectvolume = 0;
          PS_DEBUG && console.log('[PSBattlePanel] PS audio muted');
        }
        
        if (!mounted) {
          PS_DEBUG && console.log('[PSBattlePanel] Component unmounted during load');
          return;
        }
        
        // Wait for refs to be available (they should be since we render hidden elements)
        let retries = 0;
        while ((!battleFrameRef.current || !logFrameRef.current) && retries < 20) {
          PS_DEBUG && console.log('[PSBattlePanel] Waiting for refs... attempt', retries + 1);
          await new Promise(resolve => setTimeout(resolve, 50));
          retries++;
        }
        
        if (!battleFrameRef.current || !logFrameRef.current) {
          console.error('[PSBattlePanel] Refs not available after waiting!', {
            battleFrame: battleFrameRef.current,
            logFrame: logFrameRef.current,
          });
          throw new Error('Battle frame elements not available');
        }
        
        PS_DEBUG && console.log('[PSBattlePanel] Creating battle instance with refs:', {
          battleFrame: battleFrameRef.current,
          logFrame: logFrameRef.current,
        });
        
        // Create battle instance - BOTH frame and logFrame are required
        battle = createPSBattle({
          $frame: battleFrameRef.current,
          $logFrame: logFrameRef.current,
          id: roomId,
        });
        
        battleRef.current = battle;
        battle.gen = 9;
        if (battle.scene) {
          battle.scene.gen = 9;
        }
        // Ensure consistent background selection across machines by seeding numericId from roomId
        if (battle.scene && roomId) {
          battle.scene.numericId = hashStringToInt(roomId);
          if (typeof battle.scene.updateGen === 'function') {
            battle.scene.updateGen();
          }
        }
        PS_DEBUG && console.log('[PSBattlePanel] Battle instance created:', battle);
        PS_DEBUG && console.log('[PSBattlePanel] Battle waitForAnimations:', battle.waitForAnimations);
        PS_DEBUG && console.log('[PSBattlePanel] Battle scene details:', {
          sceneType: battle.scene?.constructor?.name,
          $frame: battle.scene?.$frame ? 'exists' : 'missing',
          $battle: battle.scene?.$battle ? 'exists' : 'missing',
          $bg: battle.scene?.$bg ? 'exists' : 'missing',
          $sprites: battle.scene?.$sprites ? 'exists' : 'missing',
          log: battle.scene?.log ? 'exists' : 'missing',
          frameHTML: battleFrameRef.current?.innerHTML?.substring(0, 200),
        });
        
        // After Battle constructor, scene.reset() should have been called which creates the DOM
        // If $battle is missing, we need to manually trigger reset
        if (battle.scene && !battle.scene.$battle) {
          PS_DEBUG && console.log('[PSBattlePanel] Scene $battle missing - calling scene.reset()');
          battle.scene.reset();
        }
        
        // Initialize myPokemon to empty array to prevent null errors from tooltips
        if (!battle.myPokemon) {
          battle.myPokemon = [];
        }
        
        // Set up tooltips
        if (window.BattleTooltips) {
          tooltipsRef.current = new window.BattleTooltips(battle);
          PS_DEBUG && console.log('[PSBattlePanel] Tooltips initialized');
          
          // Bind tooltips to battle scene log element
          if (battle.scene?.log?.elem && tooltipsRef.current.listen) {
            tooltipsRef.current.listen(battle.scene.log.elem);
            PS_DEBUG && console.log('[PSBattlePanel] Tooltips bound to battle log');
          }
        }
        
        // Mark battle as ready
        battleReadyRef.current = true;

        // Monkey-patch Dex.getSpriteData to use PC-chosen custom sprites
        const dex = getDex();
        if (dex && dex.getSpriteData && !(dex as any).__spritePatched) {
          const origGetSpriteData = dex.getSpriteData.bind(dex);
          dex.getSpriteData = function(pokemon: any, isFront: boolean, options?: any) {
            const result = origGetSpriteData(pokemon, isFront, options);
            try {
              // Resolve species ID the same way the original does
              let speciesName: string;
              if (pokemon && typeof pokemon === 'object' && typeof pokemon.getSpeciesForme === 'function') {
                speciesName = pokemon.getSpeciesForme();
              } else if (typeof pokemon === 'string') {
                speciesName = pokemon;
              } else {
                return result;
              }
              const speciesId = normalizeName(speciesName);
              const spriteIds = getSpriteIdCandidates(speciesName);
              const spriteLookupIds = Array.from(new Set([speciesId, ...spriteIds]));

              // 1) Check battle state for per-Pokemon custom sprite URLs (e.g. 5a, 5b choices from PC)
              const battleState = lastBattleStateRef.current;
              if (battleState?.players) {
                for (const player of battleState.players) {
                  const team = player.team || player.pokemon || [];
                  for (const mon of team) {
                    const monId = normalizeName(mon.species || mon.name || '');
                    if (monId === speciesId) {
                      const directUrl = isFront
                        ? (mon.sprite || mon.spriteUrl || mon.image)
                        : (mon.backSprite || mon.backSpriteUrl);
                      if (directUrl) {
                        result.url = directUrl;
                        result.w = 96;
                        result.h = 96;
                        result.pixelated = true;
                        return result;
                      }
                      // For back sprites: fall back to front sprite URL with flip flag
                      if (!isFront) {
                        const frontUrl = mon.sprite || mon.spriteUrl || mon.image;
                        if (frontUrl) {
                          result.url = frontUrl;
                          result.w = 96;
                          result.h = 96;
                          result.pixelated = true;
                          result.isCustomFront = true;
                          return result;
                        }
                      }
                      break;
                    }
                  }
                }
              }

              // 2) Check for a locally-cached or bundled custom sprite matching this species
              //    forceBundled=true ensures bundled data URLs are returned even when
              //    backend is preferred (PS engine can't async-load backend URLs).
              const slot = isFront ? 'front' as const : 'back' as const;
              const custom = spriteLookupIds.map((id) => getCustomSprite(id, slot, true)).find(Boolean);
              if (custom) {
                result.url = custom;
                // Custom sprites are 96×96 pixel art
                result.w = 96;
                result.h = 96;
                result.pixelated = true;
                // If we used a front sprite as the back sprite fallback (no real back exists),
                // flag it so PS flips it horizontally
                if (!isFront && !spriteLookupIds.some((id) => hasRealBackSprite(id))) result.isCustomFront = true;
              }
            } catch { /* ignore lookup errors */ }
            return result;
          };
          (dex as any).__spritePatched = true;
        }

        // Ensure backdrop background resolves (fallback to remote if local asset missing)
        // IMPORTANT: PS calls scene.reset() which replaces .backdrop elements, so we need
        // a persistent observer that re-attaches when new .backdrop elements are created
        const attachBackdropObserver = () => {
          if (!battleFrameRef.current) return;

          // Disconnect any existing observer
          if (backdropObserverRef.current) {
            backdropObserverRef.current.disconnect();
            backdropObserverRef.current = null;
          }

          // Style attribute observer for the current backdrop
          let styleObserver: MutationObserver | null = null;
          
          const observeBackdrop = (backdropEl: HTMLElement) => {
            // Clean up previous style observer if any
            if (styleObserver) {
              styleObserver.disconnect();
              styleObserver = null;
            }
            
            ensureBackdropFallback();
            styleObserver = new MutationObserver((mutations) => {
              for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'style') {
                  ensureBackdropFallback();
                }
              }
            });
            styleObserver.observe(backdropEl, { attributes: true, attributeFilter: ['style'] });
          };

          // Observer that watches for NEW .backdrop elements (created during scene.reset())
          const rootObserver = new MutationObserver(() => {
            const found = battleFrameRef.current?.querySelector('.backdrop') as HTMLElement | null;
            if (found) {
              observeBackdrop(found);
            }
          });
          rootObserver.observe(battleFrameRef.current, { childList: true, subtree: true });
          backdropObserverRef.current = rootObserver;
          
          // Also observe the current backdrop if it exists
          const existingBackdrop = battleFrameRef.current.querySelector('.backdrop') as HTMLElement | null;
          if (existingBackdrop) {
            observeBackdrop(existingBackdrop);
          }
        };

        attachBackdropObserver();

        // Pre-set local trainer sprite for team preview if available
        if (localTrainerSprite) {
          try {
            if (battle.p1 && typeof battle.p1.setAvatar === 'function') {
              battle.p1.setAvatar(localTrainerSprite);
            }
          } catch {}
        }

        // If we received team preview before the battle was ready, inject it now
        // Only inject if we haven't received any server protocol yet to avoid duplicate init/turn 1
        if (pendingTeamPreviewLinesRef.current.length > 0) {
          if (!hasReceivedProtocolRef.current) {
            PS_DEBUG && console.log('[PSBattlePanel] Injecting pending team preview protocol:', pendingTeamPreviewLinesRef.current.length, {
              sample: pendingTeamPreviewLinesRef.current.slice(0, 5),
            });
            diagLogProtocol('init-pendingTeamPreview', `Injecting ${pendingTeamPreviewLinesRef.current.length} pending team preview lines`);
            for (const line of pendingTeamPreviewLinesRef.current) {
              if (line && typeof line === 'string') {
                if (line.startsWith('|start') || line.startsWith('|turn') || line.startsWith('|teampreview')) {
                  diagLogProtocol('init-pendingTeamPreview', `KEY LINE: ${line}`);
                }
                battle.add(line);
              }
            }
            diagLogProtocol('init-pendingTeamPreview', `After injection: battle.turn=${battle.turn}`);
            teamPreviewFedRef.current = true;
            if (battle.scene && typeof battle.scene.updateGen === 'function') {
              battle.scene.updateGen();
            }
            if (battle.scene?.updateSidebars) {
              battle.scene.updateSidebars();
            }
          } else {
            PS_DEBUG && console.log('[PSBattlePanel] Skipping pending team preview injection (server protocol already received)');
          }
          pendingTeamPreviewLinesRef.current = [];
        }
        
        // Process any pending battleStarted events that arrived before battle was ready
        if (pendingEventsRef.current.length > 0) {
          PS_DEBUG && console.log('[PSBattlePanel] Processing', pendingEventsRef.current.length, 'pending events', pendingEventsRef.current.map(e => e.type));
          for (const event of pendingEventsRef.current) {
            if (event.type === 'battleStarted' && event.state && !initialProtocolFedRef.current) {
              PS_DEBUG && console.log('[PSBattlePanel] Processing queued battleStarted event');
              
              // Switch viewpoint if we're p2
              if (event.ourSide === 'p2') {
                battle.setViewpoint?.('p2');
                setMySide('p2');
              }
              
              // SKIP generating initial protocol from battleStarted event
              // The server sends the real protocol via battleUpdate (including |start|), 
              // so generating it here creates duplicate Turn 1 and sync issues.
              /*
              console.warn('[PSBattlePanel] Generating initial protocol from queued battleStarted (debug only)');
              const protocolLines = generateBattleProtocol(event.state, true, myPlayerId, localTrainerSprite);
              PS_DEBUG && console.log('[PSBattlePanel] Queued battleStarted protocol lines:', protocolLines.length, protocolLines.slice(0, 8));
              for (const line of protocolLines) {
                battle.add(line);
              }
              initialProtocolFedRef.current = true;
              */
              // Just mark started so we don't block
              battleStartedRef.current = true;
              fastForwardToEnd(battle);
              
              // Set trainer sprites
              if (event.state.players) {
                for (let i = 0; i < event.state.players.length; i++) {
                  const player = event.state.players[i];
                  const isLocal = myPlayerId
                    ? player?.id === myPlayerId
                    : (mySideRef.current ? (mySideRef.current === 'p1' ? i === 0 : i === 1) : i === 0);
                  const avatar = resolveTrainerSprite(
                    player.trainerSprite || player.avatar,
                    isLocal ? localTrainerSprite : undefined
                  );
                  const side = i === 0 ? battle.p1 : battle.p2;
                  if (side && typeof side.setAvatar === 'function') {
                    side.setAvatar(avatar);
                  }
                }
              }
            }
          }
          pendingEventsRef.current = [];
        }
        
        // Update the battle scene AFTER protocol is processed so gen/background is correct
        if (battle.scene) {
          battle.scene.updateGen();
          PS_DEBUG && console.log('[PSBattlePanel] Scene updated with gen:', battle.gen);
        }
        
        // Check for cached state/prompt that arrived before component mounted
        // DON'T generate protocol here - the server will send it in battleUpdate
        const cachedState = client?.getBattleState(roomId);
        const cachedPrompt = client?.getPrompt(roomId);
        PS_DEBUG && console.log('[PSBattlePanel] Checking cached data:', { 
          hasState: !!cachedState, 
          hasPrompt: !!cachedPrompt,
          cachedPrompt,
          alreadyFed: initialProtocolFedRef.current
        });
        PS_DEBUG && console.log('[PSBattlePanel] Cached state summary:', {
          players: cachedState?.players?.length,
          logLength: cachedState?.log?.length,
          turn: cachedState?.turn,
        });
        
        // If we have a cached prompt, set up the request for UI (but don't generate protocol)
        if (cachedState?.players && myPlayerId) {
          const isPlayer = cachedState.players.some((p: any) => p?.id === myPlayerId || p?.name === myPlayerId);
          // Don't mark as spectator yet — in boss/team modes the ally isn't in state.players
          // The promptAction handler will set isSpectator=false when a real prompt arrives
          if (isPlayer) setIsSpectator(false);
        } else if (!myPlayerId) {
          setIsSpectator(true);
        }

        if (cachedPrompt && cachedPrompt.prompt) {
          const prompt = cachedPrompt.prompt as any;
          const playerIdFromPrompt = cachedPrompt.playerId || prompt?.playerId;
          const playerIdx = cachedState?.players?.findIndex((p: any) => p.id === playerIdFromPrompt) ?? -1;
          const playerFromState = playerIdx >= 0 ? cachedState?.players?.[playerIdx] : null;
          
          // Build side object from prompt data with enriched stats
          const rawPokemonData = prompt?.side?.pokemon || prompt?.pokemon || [];
          const pokemonData = rawPokemonData.map((poke: any, idx: number) => {
            const stateTeam = playerFromState?.team || [];
            const statePoke = findMatchingStatePoke(poke, stateTeam);
            const derivedId = derivePokemonId(poke) || statePoke?.id || statePoke?.pokemonId || `poke-${idx}`;

            const speciesName = resolveSpeciesName(poke) || statePoke?.species || statePoke?.name;
            const dexSpecies = speciesName ? getDex()?.species?.get?.(speciesName) : null;
            const level = resolveLevel(poke, statePoke?.level) || 100;
            const baseStats = poke.baseStats || statePoke?.baseStats || dexSpecies?.baseStats;
            const derivedStats = buildStatsFromBase(baseStats, level);
            
            const identName = poke?.ident?.split(': ')[1];
            const detailsName = poke?.details?.split(',')[0];
            const resolvedName = poke.name || identName || statePoke?.name || statePoke?.nickname || detailsName || dexSpecies?.name;

            return {
              ...poke,
              id: derivedId,
              pokemonId: derivedId,
              baseStats,
              stats: poke.stats || statePoke?.stats || derivedStats || baseStats || {
                hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1
              },
              speciesForme: poke.speciesForme || poke.species || statePoke?.species || dexSpecies?.name,
              species: poke.species || statePoke?.species || dexSpecies?.name,
              name: resolvedName,
              level,
              hp: poke.hp ?? statePoke?.currentHP ?? 100,
              maxhp: poke.maxhp ?? statePoke?.maxHP ?? baseStats?.hp ?? 100,
            };
          });
          
          const sideData = {
            id: playerIdx >= 0 ? `p${playerIdx + 1}` : prompt?.side?.id || cachedPrompt.playerId,
            name: playerFromState?.name || prompt?.side?.name || '',
            pokemon: pokemonData,
          };
          
          PS_DEBUG && console.log('[PSBattlePanel] Processing cached prompt with enriched data:', { sideData, prompt });
          
          const requestType = (!teamSubmittedRef.current && !!prompt?.teamPreview)
            ? 'team'
            : (prompt?.requestType || (prompt?.wait ? 'wait' : (prompt?.forceSwitch ? 'switch' : 'move')));
          const effectiveTeamPreview = !!prompt?.teamPreview && requestType === 'team' && !teamSubmittedRef.current;
          const psRequest: PSBattleRequest = {
            requestType,
            side: sideData,
            active: prompt?.active,
            forceSwitch: prompt?.forceSwitch,
            teamPreview: effectiveTeamPreview,
            previewActiveCount: prompt?.previewActiveCount ?? prompt?.state?.previewActiveCount,
            teamPreviewParticipants: prompt?.teamPreviewParticipants ?? prompt?.state?.teamPreviewParticipants,
            maxTeamSize: prompt?.maxTeamSize,
            activeCount: prompt?.previewActiveCount ?? prompt?.state?.previewActiveCount ?? prompt?.state?.rules?.activeCount,
            gameType: prompt?.state?.gameType,
          };
          PS_DEBUG && console.log('[PSBattlePanel] Setting request from cached prompt:', {
            requestType: psRequest.requestType,
            teamPreview: psRequest.teamPreview,
            activeCount: psRequest.active?.length,
            sidePokemon: psRequest.side?.pokemon?.length,
          });
          setRequest(psRequest);
          setWaitingForOpponent(false);

          if (window.BattleChoiceBuilder) {
            const newChoices = new window.BattleChoiceBuilder(psRequest as any);
            setChoices(newChoices);
            setChoicesVersion(v => v + 1);
          }
          
          // Set my side from prompt
          if (playerIdx >= 0) {
            setMySide(playerIdx === 0 ? 'p1' : 'p2');
          } else if (sideData?.id === 'p1' || sideData?.id === 'p2') {
            setMySide(sideData.id);
          }
          
          // Do not generate team preview protocol here; let server events drive the scene
        }

        // If battle already started before mount, feed cached protocol/log to render the scene
        if (!initialProtocolFedRef.current) {
          const cachedLog = client?.getBattleLog(roomId) || [];
          const protocolSource = (cachedState?.log && cachedState.log.length > 0)
            ? cachedState.log
            : (pendingProtocolRef.current.length > 0 ? pendingProtocolRef.current : cachedLog);

          if (protocolSource.length > 0) {
            PS_DEBUG && console.log('[PSBattlePanel] Feeding cached protocol/log:', protocolSource.length, {
              source: cachedState?.log?.length ? 'state.log' : (pendingProtocolRef.current.length > 0 ? 'pendingProtocol' : 'cachedLog'),
              sample: protocolSource.slice(0, 6),
            });
            for (const line of protocolSource) {
              if (line && typeof line === 'string') {
                battle.add(line);
              }
            }
            initialProtocolFedRef.current = true;
            lastLogLengthRef.current = Math.max(lastLogLengthRef.current, protocolSource.length);
            pendingProtocolRef.current = [];
            fastForwardToEnd(battle);

            if (battle.scene && typeof battle.scene.updateGen === 'function') {
              battle.scene.updateGen();
            }

            if (cachedState?.players) {
              for (let i = 0; i < cachedState.players.length; i++) {
                const player = cachedState.players[i];
                const isLocal = myPlayerId
                  ? player?.id === myPlayerId
                  : (mySideRef.current ? (mySideRef.current === 'p1' ? i === 0 : i === 1) : i === 0);
                const avatar = resolveTrainerSprite(
                  player.trainerSprite || player.avatar,
                  isLocal ? localTrainerSprite : undefined
                );
                const side = i === 0 ? battle.p1 : battle.p2;
                if (side && typeof side.setAvatar === 'function') {
                  side.setAvatar(avatar);
                }
              }
              if (battle.scene?.updateSidebar) {
                if (battle.scene?.updateSidebars) {
                  battle.scene.updateSidebars();
                } else {
                  battle.scene.updateSidebar(battle.p1);
                  battle.scene.updateSidebar(battle.p2);
                }
              }
            }
          }
        }
        
        PS_DEBUG && console.log('[PSBattlePanel] Setting loading to false');
        setLoading(false);
        PS_DEBUG && console.log('[PSBattlePanel] Battle initialized:', roomId);
        
      } catch (err) {
        console.error('[PSBattlePanel] Failed to initialize:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load battle');
          setLoading(false);
        }
      }
    };
    
    init();
    
    return () => {
      mounted = false;
      // Reset refs when unmounting
      initialProtocolFedRef.current = false;
      teamPreviewFedRef.current = false;
      battleStartedRef.current = false;
      startEventReceivedRef.current = false;
      deferredPostStartLinesRef.current = [];
      if (teamSubmittedRef.current) {
        teamSubmittedRef.current = false;
      }
      lastLogLengthRef.current = 0;
      if (battle) {
        try {
          battle.destroy?.();
        } catch (e) {
          console.warn('[PSBattlePanel] Error destroying battle:', e);
        }
      }
    };
  }, [roomId]);
  
  // Handle battle protocol messages
  const handleBattleMessage = useCallback((protocol: string | string[]) => {
    const battle = battleRef.current;
    if (!battle) return;
    
    try {
      const lines = Array.isArray(protocol) ? protocol : protocol.split('\n');
      
      for (const line of lines) {
        if (!line || line.startsWith('>')) continue;
        
        // Parse the line
        const parts = line.split('|');
        if (parts.length < 2) continue;
        
        const cmd = parts[1];
        const args = parts.slice(2);
        
        // Add to battle queue
        battle.add(line);
        
        // Handle specific commands
        switch (cmd) {
          case 'player':
            // |player|p1|PlayerName|avatar
            if (args[0] && args[1]) {
              const side = args[0] as 'p1' | 'p2';
              const name = args[1];
              if (name === myPlayerId || toID(name) === toID(myPlayerId)) {
                setMySide(side);
              }
            }
            break;
            
          case 'request':
            // |request|{json}
            if (args[0]) {
              try {
                const req = JSON.parse(args[0]);
                
                // Save original active moves before fixRequest can corrupt them
                const savedActive = req.active ? JSON.parse(JSON.stringify(req.active)) : undefined;
                
                // Fix up request using PS's BattleChoiceBuilder
                if (window.BattleChoiceBuilder?.fixRequest && battle) {
                  try {
                    window.BattleChoiceBuilder.fixRequest(req, battle);
                  } catch (fixErr) {
                    console.warn('[PSBattlePanel] fixRequest failed, restoring original:', fixErr);
                  }
                }
                
                // Restore moves if fixRequest removed them
                if (savedActive && req.active) {
                  for (let si = 0; si < req.active.length; si++) {
                    if (savedActive[si]?.moves?.length && (!req.active[si]?.moves || req.active[si].moves.length === 0)) {
                      req.active[si] = savedActive[si];
                    }
                  }
                } else if (savedActive && !req.active) {
                  req.active = savedActive;
                }
                
                setRequest(req);
                
                // Update PS choices
                if (window.BattleChoiceBuilder) {
                  const newChoices = new window.BattleChoiceBuilder(req);
                  setChoices(newChoices);
                }
              } catch (e) {
                console.warn('[PSBattlePanel] Failed to parse request:', e);
              }
            }
            break;
            
          case 'win':
          case 'tie':
            if (onBattleEnd) {
              onBattleEnd(args[0] || 'tie');
            }
            break;
        }
      }
      
      // Let battle process the queue naturally (keeps animations)
      
    } catch (err) {
      console.error('[PSBattlePanel] Error processing message:', err);
    }
  }, [myPlayerId, onBattleEnd]);
  
  // Subscribe to battle events from client (skip in replay mode)
  useEffect(() => {
    if (!client || !roomId || isReplay) return;
    
    // Listen for battle updates (contains state changes AND protocol events)
    const offUpdate = client.on('battleUpdate', (rawData) => {
      const data = rawData as any;
      if (data.roomId !== roomId) return;
      PS_DEBUG && console.log('[PSBattlePanel] Battle update:', data);
      
      const battle = battleRef.current;
      if (!battle || !battleReadyRef.current) {
        const result = data.result || data.update?.result;
        const protocolLines: string[] = result?.events || [];
        if (protocolLines.length > 0) {
          pendingProtocolRef.current.push(...protocolLines);
          PS_DEBUG && console.log('[PSBattlePanel] Queued protocol events (battle not ready):', protocolLines.length, {
            pendingTotal: pendingProtocolRef.current.length,
            sample: protocolLines.slice(0, 4),
          });
        } else if (result?.state?.log && result.state.log.length > lastLogLengthRef.current) {
          const newLines = result.state.log.slice(lastLogLengthRef.current);
          pendingProtocolRef.current.push(...newLines);
          lastLogLengthRef.current = result.state.log.length;
          PS_DEBUG && console.log('[PSBattlePanel] Queued log lines (battle not ready):', newLines.length, {
            pendingTotal: pendingProtocolRef.current.length,
            logLength: result.state.log.length,
          });
        }
        return;
      }
      
      // The server sends protocol in data.result.events or data.result.state.log
      // Note: Socket.io emits battleUpdate with { result: {...} } directly
      const result = data.result || data.update?.result;
      
      // Use the events array if available (preferred - contains only new events)
      // but merge in any missing lines from state.log deltas to avoid gaps.
      const rawLines: string[] = result?.events || [];
      const stateLog: string[] = result?.state?.log || [];
      const hasLogDelta = stateLog.length > lastLogLengthRef.current;
      let logDelta = hasLogDelta ? stateLog.slice(lastLogLengthRef.current) : [];

      // Filter out individual |start| lines from log delta if we've already received start.
      // Don't drop the entire delta - just filter the duplicate start line itself.
      if (startEventReceivedRef.current && logDelta.length > 0) {
        const beforeLen = logDelta.length;
        logDelta = logDelta.filter((line) => line !== '|start' && !line.startsWith('|start|'));
        if (logDelta.length < beforeLen) {
          diagLogProtocol('battleUpdate', `Filtered ${beforeLen - logDelta.length} duplicate |start| lines from log delta`);
        }
      }

      if (result?.state) {
        lastBattleStateRef.current = result.state;
        if (result.state.players && myPlayerId) {
          const isPlayer = result.state.players.some((p: any) => p?.id === myPlayerId || p?.name === myPlayerId);
          // Don't mark as spectator — in boss/team modes the ally isn't in state.players
          if (isPlayer) setIsSpectator(false);
        } else if (!myPlayerId) {
          setIsSpectator(true);
        }
      }

      // Capture whether we've already received protocol BEFORE marking this batch
      const hadPreviousProtocol = hasReceivedProtocolRef.current;
      
      if (rawLines.length > 0 || logDelta.length > 0) {
        hasReceivedProtocolRef.current = true;
      }

      const hadIncomingLines = rawLines.length > 0 || logDelta.length > 0;
      // Filter out init protocol lines only after we've received at least one server protocol batch
      // This allows the first server batch to carry full setup lines even if we locally injected team preview.
      const battleAlreadySetup = initialProtocolFedRef.current || hadPreviousProtocol;
      const filterInitLines = (lines: string[]) => battleAlreadySetup
        ? lines.filter((line) => !isInitProtocolLine(line))
        : lines;
      const rawFiltered = filterInitLines(rawLines);
      const logFiltered = filterInitLines(logDelta);
      // Use log delta as source of truth for ordering since it maintains correct protocol order.
      // Events array may have action lines (|start|, |switch|, |turn|) without setup lines.
      // The log delta always has the full sequence in correct order.
      // Only use events if log delta is empty or if events have lines not in log delta.
      let mergedLines: string[];
      if (logFiltered.length > 0) {
        // Log delta is the authoritative source - it has correct order
        // Append any event lines that might not be in log yet (rare edge case)
        const extraFromEvents = rawFiltered.filter((line) => !logFiltered.includes(line));
        mergedLines = logFiltered.concat(extraFromEvents);
      } else {
        // No log delta, use events directly
        mergedLines = rawFiltered;
      }

      let protocolLines: string[] = mergedLines;
      const filteredCount = (rawLines.length + logDelta.length) - protocolLines.length;

      // Drop exact duplicate switch lines within a batch (PS can emit public+private copies)
      if (protocolLines.length > 1) {
        const seenSwitchLines = new Set<string>();
        const dedupedLines: string[] = [];
        for (const line of protocolLines) {
          if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|replace|')) {
            if (seenSwitchLines.has(line)) {
              diagLogProtocol('battleUpdate', `Dropping duplicate switch line (exact match): ${line}`);
              continue;
            }
            seenSwitchLines.add(line);
          }
          dedupedLines.push(line);
        }
        protocolLines = dedupedLines;
      }

      // Allow split/switch batches during early turns to avoid client desync freezes.
      if (protocolLines.length > 0) {
        const isSplitOrSwitch = (line: string) =>
          line.startsWith('|split|') ||
          line.startsWith('|switch|') ||
          line.startsWith('|drag|') ||
          line.startsWith('|replace|');
        const hasOnlySplitSwitch = protocolLines.every(isSplitOrSwitch);
        if (hasOnlySplitSwitch) {
          const switchLines = protocolLines.filter((line) =>
            line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|replace|')
          );
          const redundantSwitches = switchLines.length === 0 || switchLines.every((line) => {
            const parsed = parseActiveSwitchLine(line);
            if (!parsed) return false;
            const lastActive = lastActiveBySideRef.current[parsed.side];
            return lastActive && toID(parsed.name) === toID(lastActive);
          });
          if (redundantSwitches) {
            diagLogProtocol('battleUpdate', 'Dropping redundant split/switch batch (no real active change)');
            protocolLines = [];
          }
        }
      }
      
      // Drop truly redundant init-only batches (no turn/switch/action lines), but never drop turn/switch batches.
      const timeSinceAction = Date.now() - actionSentTimestampRef.current;
      const recentlySentAction = timeSinceAction < 2000; // 2 second window
      const isEarlyGame = currentTurnRef.current === 0; // team preview phase only

      if (protocolLines.length > 0 && startEventReceivedRef.current && !recentlySentAction && !isEarlyGame) {
        const isInitOnlyLine = (line: string) =>
          line === '|' ||
          line.startsWith('|t:|') ||
          line.startsWith('|gametype|') ||
          line.startsWith('|player|') ||
          line.startsWith('|teamsize|') ||
          line.startsWith('|gen|') ||
          line.startsWith('|tier|') ||
          line.startsWith('|clearpoke') ||
          line.startsWith('|poke|') ||
          line.startsWith('|teampreview') ||
          line.startsWith('|start');
        const hasTurnLine = protocolLines.some((line) => line.startsWith('|turn|'));
        const hasSwitchLine = protocolLines.some((line) =>
          line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|replace|')
        );
        const hasActionLine = protocolLines.some((line) =>
          line.startsWith('|move|') ||
          line.startsWith('|-damage') ||
          line.startsWith('|-status') ||
          line.startsWith('|-crit') ||
          line.startsWith('|-supereffective') ||
          line.startsWith('|-resisted') ||
          line.startsWith('|-immune')
        );

        const isInitOnlyBatch = !hasTurnLine && !hasSwitchLine && !hasActionLine && protocolLines.every(isInitOnlyLine);
        if (isInitOnlyBatch) {
          diagLogProtocol('battleUpdate', 'Dropping redundant init-only batch (no turn/switch/action lines)');
          protocolLines = [];
        }
      } else if (protocolLines.length > 0 && (recentlySentAction || isEarlyGame)) {
        diagLogProtocol('battleUpdate', `NOT dropping batch: recentlySentAction=${recentlySentAction} isEarlyGame=${isEarlyGame} timeSinceAction=${timeSinceAction}ms`);
      }

      // Deduplicate repeated switch lines for the same side+pokemon within a single batch
      // AND filter switches for Pokemon that are already on the field
      if (protocolLines.length > 0) {
        const seenSwitches = new Set<string>();
        const dedupedSwitches: string[] = [];
        for (const line of protocolLines) {
          if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|replace|')) {
            const parsed = parseActiveSwitchLine(line);
            if (parsed) {
              const key = `${parsed.side}:${toID(parsed.name)}`;
              // Drop if we've already seen this switch in this batch
              if (seenSwitches.has(key)) {
                diagLogProtocol('battleUpdate', `Dropping duplicate switch line for ${key}`);
                continue;
              }
              // Drop if this Pokemon is ALREADY the active Pokemon on this side
              const side = parsed.side === 'p1' ? battle.p1 : battle.p2;
              const alreadyActive = side?.active?.some((a: any) => a && toID(a.name) === toID(parsed.name));
              if (alreadyActive) {
                diagLogProtocol('battleUpdate', `Dropping redundant switch for ${key} (already active)`);
                continue;
              }
              seenSwitches.add(key);
            }
          }
          dedupedSwitches.push(line);
        }
        protocolLines = dedupedSwitches;
      }

      // Deduplicate repeated |turn| lines within a single batch AND filter turns we've already processed
      if (protocolLines.length > 0) {
        const seenTurns = new Set<number>();
        const dedupedTurns: string[] = [];
        for (const line of protocolLines) {
          if (line.startsWith('|turn|')) {
            const turnNum = parseInt(line.split('|')[2] || '0', 10);
            if (!Number.isNaN(turnNum)) {
              // Drop if we've already seen this turn in this batch
              if (seenTurns.has(turnNum)) {
                diagLogProtocol('battleUpdate', `Dropping duplicate |turn|${turnNum} line in batch`);
                continue;
              }
              // Drop if battle.turn is already at or past this turn (already processed)
              if (battle.turn >= turnNum) {
                diagLogProtocol('battleUpdate', `Dropping |turn|${turnNum} (battle.turn already ${battle.turn})`);
                continue;
              }
              seenTurns.add(turnNum);
            }
          }
          dedupedTurns.push(line);
        }
        protocolLines = dedupedTurns;
      }

      // Deduplicate consecutive identical lines that can appear after |split| protocol
      // The server sends |split|pX followed by public and private views of the same event,
      // which can result in duplicate |-damage|, |-heal|, etc. lines being animated twice
      if (protocolLines.length > 1) {
        const deduped: string[] = [];
        let prevLine = '';
        for (const line of protocolLines) {
          // Skip |split| marker lines entirely - they're just delimiters
          if (line.startsWith('|split|')) {
            continue;
          }
          // Skip consecutive identical action lines (common after |split|)
          if (line === prevLine && (
            line.startsWith('|-damage') ||
            line.startsWith('|-heal') ||
            line.startsWith('|-sethp') ||
            line.startsWith('|-status') ||
            line.startsWith('|-curestatus') ||
            line.startsWith('|-boost') ||
            line.startsWith('|-unboost') ||
            line.startsWith('|-setboost') ||
            line.startsWith('|-item') ||
            line.startsWith('|-enditem')
          )) {
            PS_DEBUG && console.log('[PSBattlePanel] Skipping duplicate split line:', line);
            continue;
          }
          deduped.push(line);
          prevLine = line;
        }
        if (deduped.length !== protocolLines.length) {
          PS_DEBUG && console.log('[PSBattlePanel] Deduped protocol lines:', {
            before: protocolLines.length,
            after: deduped.length,
            removed: protocolLines.length - deduped.length,
          });
          protocolLines = deduped;
        }
      }

      PS_DEBUG && console.log('[PSBattlePanel] Received', protocolLines.length, 'protocol events:', protocolLines);
      PS_DEBUG && console.log('[PSBattlePanel] Protocol filtering:', { 
        raw: rawLines.length, 
        logDelta: logDelta.length,
        rawFiltered: rawFiltered.length,
        logFiltered: logFiltered.length,
        merged: mergedLines.length,
        final: protocolLines.length,
        hadPreviousProtocol,
        battleAlreadySetup,
        initialFed: initialProtocolFedRef.current,
        teamPreviewFed: teamPreviewFedRef.current,
      });
      if (protocolLines.length > 0) {
        PS_DEBUG && console.log('[PSBattlePanel] Protocol sample:', protocolLines.slice(0, 6));
      }

      // Track active Pokemon from protocol (switch/drag/replace)
      if (protocolLines.length > 0) {
        const activeUpdates = protocolLines
          .map(parseActiveSwitchLine)
          .filter((v): v is { side: 'p1' | 'p2'; name: string } => !!v);
        if (activeUpdates.length > 0) {
          for (const update of activeUpdates) {
            lastActiveBySideRef.current[update.side] = update.name;
          }
          lastActiveUpdateRef.current = Date.now();
          PS_DEBUG && console.log('[PSBattlePanel] Updated last active from protocol:', {
            activeUpdates,
            lastActiveBySide: lastActiveBySideRef.current,
          });
        }
      }
      
      // Check if this batch contains |start| event (marks battle has actually begun)
      // Use startsWith to handle any potential trailing content
      const hasStartEvent = protocolLines.some(line => line === '|start' || line.startsWith('|start|'));
      const hasTurnEvent = protocolLines.find(line => line.startsWith('|turn|'));
      const hasTeamPreviewEvent = protocolLines.some(line => line.startsWith('|teampreview'));
      
      // DIAGNOSTIC: Log key events in this batch
      diagLogProtocol('battleUpdate', `Received batch: ${protocolLines.length} lines | hasStart=${hasStartEvent} | hasTurn=${!!hasTurnEvent} | hasTeamPreview=${hasTeamPreviewEvent}`);
      if (hasStartEvent || hasTurnEvent || hasTeamPreviewEvent) {
        const keyLines = protocolLines.filter(l => l.startsWith('|start') || l.startsWith('|turn') || l.startsWith('|teampreview'));
        diagLogProtocol('battleUpdate', `KEY LINES: ${JSON.stringify(keyLines)}`);
      }
      
      PS_DEBUG && console.log('[PSBattlePanel] Start event check:', {
        hasStartEvent,
        startLines: protocolLines.filter(line => line.includes('start')),
        startEventReceivedBefore: startEventReceivedRef.current,
      });
      if (hasStartEvent) {
        // Check if we'll be deferring the |start| line (team preview active, team not submitted)
        const willDeferStart = ((hasTeamPreviewEvent || teamPreviewFedRef.current) && !teamSubmittedRef.current);
        if (willDeferStart) {
          PS_DEBUG && console.log('[PSBattlePanel] |start| detected but deferring (team preview active)');
          diagLogProtocol('battleUpdate', `|start| DETECTED but DEFERRED (team preview active)`);
        } else {
          diagLogProtocol('battleUpdate', `|start| DETECTED - was startEventReceived=${startEventReceivedRef.current}, setting to true`);
          startEventReceivedRef.current = true;
          PS_DEBUG && console.log('[PSBattlePanel] Received |start| event - battle has begun, setting startEventReceivedRef=true');
        }
        if (pendingMovePromptRef.current && !willDeferStart) {
          PS_DEBUG && console.log('[PSBattlePanel] Applying deferred move prompt after |start| event');
          diagLogProtocol('battleUpdate', 'Applying deferred move prompt after |start|');
          const pending = pendingMovePromptRef.current;
          pendingMovePromptRef.current = null;
          setRequest(pending);
          if (window.BattleChoiceBuilder) {
            const newChoices = new window.BattleChoiceBuilder(pending as any);
            setChoices(newChoices);
            setChoicesVersion(v => v + 1);
          }
          setWaitingForOpponent(false);
        }
      }

      // Track turn updates from protocol
      const turnLine = protocolLines.find(line => line.startsWith('|turn|'));
      if (turnLine) {
        const turnNum = parseInt(turnLine.split('|')[2] || '0', 10);
        if (!Number.isNaN(turnNum) && turnNum !== currentTurnRef.current) {
          PS_DEBUG && console.log('[PSBattlePanel] Turn update from protocol:', { turnNum, previous: currentTurnRef.current });
          diagLogProtocol('battleUpdate', `|turn|${turnNum} - was currentTurn=${currentTurnRef.current}, battle.turn=${battle.turn}`);
          setCurrentTurn(turnNum);
          // Clear cancelled turns from previous turn since we're now on a new turn
          cancelledTurnsRef.current.clear();
          // Also clear the saved move request since we're on a new turn
          lastMoveRequestRef.current = null;
          lastMoveChoicesRef.current = null;
        }
      }
      
      // If we have new events, feed them
      const shouldFeed = protocolLines.length > 0;
      
      if (shouldFeed) {
        PS_DEBUG && console.log('[PSBattlePanel] Feeding new protocol events:', protocolLines.length);
        diagLogProtocol('battleUpdate', `FEEDING ${protocolLines.length} lines to battle (battle.turn before=${battle.turn})`);
        try {
          // If we see teampreview protocol but don't have a team request, build one from state
          // Allow this even if |start| is in the same batch, as long as team was not submitted yet
          const hasTeamPreviewEvent = protocolLines.some(line => line.startsWith('|teampreview'));
          const currentRequest = requestRef.current;
          const shouldBuildTeamPreview = !!(
            hasTeamPreviewEvent &&
            result?.state?.players &&
            (!currentRequest || currentRequest.requestType !== 'team') &&
            !teamSubmittedRef.current
          );
          PS_DEBUG && console.log('[PSBattlePanel] Team preview check:', {
            hasTeamPreviewEvent,
            hasStartEvent,
            startEventReceivedRef: startEventReceivedRef.current,
            currentRequestType: currentRequest?.requestType,
            teamSubmitted: teamSubmittedRef.current,
            shouldBuildTeamPreview,
          });
          if (shouldBuildTeamPreview) {
            if (!currentRequest || currentRequest.requestType !== 'team') {
              PS_DEBUG && console.log('[PSBattlePanel] Building team preview request (|teampreview| seen, team not submitted)');
              const statePlayers = result.state.players as any[];
              const myIndex = myPlayerId
                ? statePlayers.findIndex(p => p.id === myPlayerId || p.name === myPlayerId)
                : -1;
              if (myIndex >= 0) {
                const mySideId = `p${myIndex + 1}`;
                const myPlayer = statePlayers[myIndex];
                const sideData = {
                  id: mySideId,
                  name: myPlayer?.name || myPlayer?.id || '',
                  pokemon: (myPlayer?.team || []).map((poke: any, idx: number) => ({
                    ident: `${mySideId}: ${poke.nickname || poke.name}`,
                    details: `${poke.species || poke.name}, L${poke.level || 100}`,
                    condition: `${poke.currentHP ?? poke.maxHP ?? 100}/${poke.maxHP ?? 100}`,
                    active: idx === (myPlayer?.activeIndex ?? 0),
                    moves: (poke.moves || []).map((m: any) => m.id || m.name),
                    baseAbility: poke.ability,
                    item: poke.item || '',
                    pokeball: 'pokeball',
                  })),
                };
                const teamRequest: PSBattleRequest = {
                  requestType: 'team',
                  teamPreview: true,
                  maxTeamSize: result?.state?.rules?.teamSize || 6,
                  activeCount: result?.state?.rules?.activeCount,
                  gameType: result?.state?.gameType,
                  side: sideData,
                };
                PS_DEBUG && console.log('[PSBattlePanel] Built team preview request from battleUpdate state', {
                  hasStartEvent,
                  startEventReceived: startEventReceivedRef.current,
                  hasTeamPreviewEvent,
                  teamSubmitted: teamSubmittedRef.current,
                });
                setRequest(teamRequest);
                setWaitingForOpponent(false);
                if (window.BattleChoiceBuilder) {
                  const newChoices = new window.BattleChoiceBuilder(teamRequest as any);
                  setChoices(newChoices);
                  setChoicesVersion(v => v + 1);
                }
                setMySide(mySideId === 'p1' ? 'p1' : 'p2');
              }
            }
          } else if (hasTeamPreviewEvent && startEventReceivedRef.current) {
            PS_DEBUG && console.log('[PSBattlePanel] Skipping team preview request (|start| already received or team submitted)');
          }

          // When team preview is active and team not yet submitted, defer lines from |start| onward
          // so the PS engine stays in team-preview phase until the player chooses their lead.
          // This handles both: (a) |teampreview| + |start| in same batch, and
          // (b) |start| arriving in a later batch while team preview UI is still shown.
          // (c) subsequent batches arriving after we already started deferring.
          const teamPreviewActive = (hasTeamPreviewEvent || teamPreviewFedRef.current) && !teamSubmittedRef.current;
          const deferAfterTeamPreview = teamPreviewActive && (hasStartEvent || deferredPostStartLinesRef.current.length > 0);
          let deferring = deferredPostStartLinesRef.current.length > 0; // Continue deferring if already started

          for (const line of protocolLines) {
            if (line && typeof line === 'string') {
              // DIAGNOSTIC: Log key protocol lines as they're added
              if (line.startsWith('|start') || line.startsWith('|turn') || line.startsWith('|teampreview')) {
                diagLogProtocol('battleUpdate-feed', `Adding KEY LINE: ${line}`);
              }
              // Once we hit |start|, defer remaining lines for after team order submission
              if (deferAfterTeamPreview && line.startsWith('|start')) {
                deferring = true;
                PS_DEBUG && console.log('[PSBattlePanel] Deferring post-|start| lines for team preview');
                diagLogProtocol('battleUpdate-feed', 'DEFERRING lines from |start| onward');
              }
              if (deferring) {
                deferredPostStartLinesRef.current.push(line);
              } else {
                battle.add(line);
              }
            }
          }
          diagLogProtocol('battleUpdate-feed', `After feeding: battle.turn=${battle.turn} (deferred=${deferredPostStartLinesRef.current.length} lines)`);
          // NOTE: Do NOT call fastForwardToEnd here - it races with pending animations
          // and causes interruptionCount mismatch which freezes the queue.
          // The queue will process naturally via battle.add() -> nextStep() chain.
          // If stuck, the startAnimationWait timeout (below) will handle it.
        } catch (e) {
             console.error('[PSBattlePanel] Error feeding protocol:', e);
        }
      }

      // Update our log length tracker if we processed logs (filtered or not)
      // This is crucial to avoid "fake turns" where filtered lines appear as new entries in log delta
      if (mergedLines.length > 0 && result?.state?.log) {
         lastLogLengthRef.current = result.state.log.length;
      }
      
      if (shouldFeed) {
          // Mark that we've now fed battle protocol (in case we only had team preview before)
          initialProtocolFedRef.current = true;
          
          // Explicitly update scene after feeding protocol
          if (battle.scene && typeof battle.scene.updateGen === 'function') {
            battle.scene.updateGen();
          }
          ensureBackdropFallback();

          startAnimationWait(battle);
          
          // Set trainer sprites from state if available
          if (result?.state?.players) {
            for (let i = 0; i < result.state.players.length; i++) {
              const player = result.state.players[i];
              const isLocal = myPlayerId
                ? player?.id === myPlayerId
                : (mySideRef.current ? (mySideRef.current === 'p1' ? i === 0 : i === 1) : i === 0);
              const avatar = resolveTrainerSprite(
                player.trainerSprite || player.avatar,
                isLocal ? localTrainerSprite : undefined
              );
              const side = i === 0 ? battle.p1 : battle.p2;
              if (side && typeof side.setAvatar === 'function') {
                side.setAvatar(avatar);
                PS_DEBUG && console.log(`[PSBattlePanel] Set avatar for p${i + 1}:`, avatar);
              }
            }
            // Update sidebars to show new avatars
            if (battle.scene?.updateSidebar) {
              if (battle.scene?.updateSidebars) {
                battle.scene.updateSidebars();
              } else {
                battle.scene.updateSidebar(battle.p1);
                battle.scene.updateSidebar(battle.p2);
              }
            }
          }

          // Reactive request fix: if protocol indicates a different active Pokemon, rebuild request.active
          const mySideLocal = mySideRef.current;
          const currentRequest = requestRef.current;
          if (currentRequest?.requestType === 'move' && currentRequest.side?.pokemon && mySideLocal) {
            const activeName = lastActiveBySideRef.current[mySideLocal];
            if (activeName) {
              const activeIndex = findPokemonIndexByName(currentRequest.side.pokemon, activeName);
              const activePokemon = activeIndex >= 0 ? currentRequest.side.pokemon[activeIndex] : null;
              
              // In doubles, don't rebuild active for protocol switches — the prompt already has correct multi-slot active.
              // Only rebuild in singles (1 active slot) when the active ID doesn't match.
              const isDoublesActive = (currentRequest.active?.length || 0) > 1;
              const currentActiveId = currentRequest.active?.[0]?.id || currentRequest.active?.[0]?.pokemonId;
              const desiredActiveId = activePokemon?.id || activePokemon?.pokemonId;

              if (!isDoublesActive && activePokemon && desiredActiveId && currentActiveId !== desiredActiveId) {
                console.warn('[PSBattlePanel] Rebuilding request.active from protocol switch:', {
                  currentActiveId,
                  desiredActiveId,
                  activeName,
                  activeIndex,
                });
                // Preserve trapped status from original active request
                const originalActive = currentRequest.active?.[0] || {};
                const rebuiltActive = [{
                  id: desiredActiveId,
                  pokemonId: desiredActiveId,
                  moves: (activePokemon.moves || []).map((m: any) => ({
                    id: m.id || m.name?.toLowerCase().replace(/\s+/g, ''),
                    name: m.name,
                    pp: m.pp ?? 32,
                    maxpp: m.maxpp ?? 32,
                    target: m.target || 'normal',
                    disabled: m.disabled || false,
                  })),
                  canSwitch: !originalActive.trapped,
                  trapped: originalActive.trapped || false,
                  maybeTrapped: originalActive.maybeTrapped || false,
                }];
                const updatedSidePokemon = currentRequest.side.pokemon.map((p: any, idx: number) => ({
                  ...p,
                  active: idx === activeIndex,
                }));
                const updatedRequest = {
                  ...currentRequest,
                  active: rebuiltActive,
                  side: {
                    ...currentRequest.side,
                    pokemon: updatedSidePokemon,
                  },
                } as PSBattleRequest;
                setRequest(updatedRequest);
                if (window.BattleChoiceBuilder) {
                  const newChoices = new window.BattleChoiceBuilder(updatedRequest as any);
                  setChoices(newChoices);
                  setChoicesVersion(v => v + 1);
                }
              }
            }
          }
      }
      // If we received lines but filtered all of them (e.g., duplicate start switches),
      // advance the log cursor so we don't feed them via the log-only branch.
      else if (hadIncomingLines && result?.state?.log) {
        lastLogLengthRef.current = result.state.log.length;
      }
      // If no events but we have log, only feed lines we haven't seen
      else if (result?.state?.log && result.state.log.length > lastLogLengthRef.current) {
        const newLines = result.state.log.slice(lastLogLengthRef.current);
        let filteredLines = newLines;
        if (startEventReceivedRef.current) {
          // Filter out |start| and init lines individually, don't drop the whole batch
          filteredLines = newLines.filter((line: string) => {
            if (line === '|start' || line.startsWith('|start|')) return false;
            if (isInitProtocolLine(line)) return false;
            return true;
          });
          const droppedCount = newLines.length - filteredLines.length;
          if (droppedCount > 0) {
            PS_DEBUG && console.log('[PSBattlePanel] Filtered init/start lines from log-only batch', {
              original: newLines.length,
              filtered: filteredLines.length,
              dropped: droppedCount,
            });
          }
        }

        if (startEventReceivedRef.current && filteredLines.length > 0 && !recentlySentAction && !isEarlyGame) {
          const isNonActionLine = (line: string) =>
            line === '|' ||
            line.startsWith('|t:|') ||
            line.startsWith('|gametype|') ||
            line.startsWith('|player|') ||
            line.startsWith('|teamsize|') ||
            line.startsWith('|gen|') ||
            line.startsWith('|tier|') ||
            line.startsWith('|clearpoke') ||
            line.startsWith('|poke|') ||
            line.startsWith('|teampreview') ||
            line.startsWith('|start') ||
            line.startsWith('|split|') ||
            line.startsWith('|switch|') ||
            line.startsWith('|drag|') ||
            line.startsWith('|replace|') ||
            line.startsWith('|turn|');
          const hasActionLine = filteredLines.some((line: string) =>
            line.startsWith('|move|') ||
            line.startsWith('|cant|') ||
            line.startsWith('|-damage|') ||
            line.startsWith('|damage|') ||
            line.startsWith('|-heal|') ||
            line.startsWith('|heal|') ||
            line.startsWith('|faint|')
          );
          if (!hasActionLine && filteredLines.every(isNonActionLine)) {
            const switchLines = filteredLines.filter((line: string) =>
              line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|replace|')
            );
            const redundantSwitches = switchLines.length === 0 || switchLines.every((line: string) => {
              const parsed = parseActiveSwitchLine(line);
              if (!parsed) return false;
              const lastActive = lastActiveBySideRef.current[parsed.side];
              return lastActive && toID(parsed.name) === toID(lastActive);
            });
            const turnLines = filteredLines.filter((line: string) => line.startsWith('|turn|'));
            const maxTurn = turnLines.reduce((acc: number, line: string) => {
              const num = parseInt(line.split('|')[2] || '0', 10);
              return Number.isNaN(num) ? acc : Math.max(acc, num);
            }, 0);
            const turnIsNotNew = turnLines.length === 0 || maxTurn <= currentTurnRef.current;
            if (redundantSwitches && turnIsNotNew) {
              lastLogLengthRef.current = result.state.log.length;
              return;
            }
          }
        }

        if (filteredLines.length === 0) {
          lastLogLengthRef.current = result.state.log.length;
          return;
        }

        PS_DEBUG && console.log('[PSBattlePanel] Feeding new log lines:', filteredLines.length, 'of', result.state.log.length);
        try {
          if (filteredLines.length > 0) {
            hasReceivedProtocolRef.current = true;
          }
          for (const line of filteredLines) {
            if (line && typeof line === 'string') {
              battle.add(line);
            }
          }
          lastLogLengthRef.current = result.state.log.length;
          
          // Explicitly update scene after feeding log
          if (battle.scene && typeof battle.scene.updateGen === 'function') {
            battle.scene.updateGen();
          }
          ensureBackdropFallback();

          startAnimationWait(battle);
        } catch (e) {
          console.warn('[PSBattlePanel] Error feeding log:', e);
        }
      }
    });
    
    // Listen for battle start (skip in replay mode)
    if (isReplay) return () => { offUpdate(); };
    
    const offStart = client.on('battleStarted', (rawData) => {
      const data = rawData as any;
      if (data.roomId !== roomId) return;
      PS_DEBUG && console.log('[PSBattlePanel] Battle started:', data);
      diagLogProtocol('battleStarted', `EVENT RECEIVED - state.turn=${data.state?.turn}`);
      
      const state = data.state;
      
      // Store boss participant info for split trainer display
      if (state?.bossParticipants) {
        bossParticipantsRef.current = state.bossParticipants;
      }
      
      // Determine which side we are first
      let ourSide: 'p1' | 'p2' = 'p1';
      if (myPlayerId && state?.players) {
        const playerIndex = state.players.findIndex((p: any) => 
          p.id === myPlayerId || p.name === myPlayerId
        );
        if (playerIndex >= 0) {
          ourSide = playerIndex === 0 ? 'p1' : 'p2';
          setMySide(ourSide);
        }
      }
      
      const battle = battleRef.current;
      
      // If battle not ready yet, queue the event for later
      if (!battle || !battleReadyRef.current) {
        PS_DEBUG && console.log('[PSBattlePanel] Battle not ready, queueing battleStarted event');
        diagLogProtocol('battleStarted', 'Battle not ready - QUEUEING');
        pendingEventsRef.current.push({ type: 'battleStarted', state, isStart: true, ourSide });
        return;
      }
      
      // Switch viewpoint if we're p2
      if (ourSide === 'p2' && battle) {
        PS_DEBUG && console.log('[PSBattlePanel] Switching viewpoint for p2');
        battle.setViewpoint?.('p2');
      }
      
      // Mark that battle has started
      battleStartedRef.current = true;
      diagLogProtocol('battleStarted', `Marked battleStartedRef=true, battle.turn=${battle.turn}`);
      
      // Do not generate fallback start protocol; rely on battleUpdate events/log to avoid duplicate Turn 1.
    });
    
    // Listen for prompts
    const offPrompt = client.on('promptAction', (rawData) => {
      // Cast to any to access all fields (the type definition is incomplete)
      const data = rawData as any;
      
      // Handle "waiting for N players" notification - NOT a real prompt
      // Server sends { waitingFor: N } when waiting for other players
      if (data.waitingFor !== undefined && !data.prompt && !data.roomId) {
        PS_DEBUG && console.log('[PSBattlePanel] Waiting notification, ignoring:', data.waitingFor, 'players remaining');
        setWaitingForOpponent(true);
        return;
      }
      
      if (data.roomId !== roomId) return;
      // Ignore prompts meant for other players
      if (data.playerId && myPlayerId && data.playerId !== myPlayerId) {
        PS_DEBUG && console.log('[PSBattlePanel] Ignoring prompt for other player:', data.playerId);
        return;
      }
      PS_DEBUG && console.log('[PSBattlePanel] Prompt received:', data);
      
      // DIAGNOSTIC: Log prompt arrival
      const promptType = (!teamSubmittedRef.current && !!data.prompt?.teamPreview)
        ? 'team'
        : (data.prompt?.requestType || (data.prompt?.forceSwitch ? 'switch' : 'unknown'));
      diagLogProtocol('promptAction', `Received prompt: type=${promptType} turn=${data.state?.turn} rqid=${data.prompt?.rqid}`);

      // New prompt means we should exit animation wait state
      setWaitingForAnimations(false);
      // Cancel any pending animation check timer to prevent it from re-enabling
      // waitingForAnimations after this prompt cleared it (race condition fix)
      if (animationCheckRef.current) {
        window.clearTimeout(animationCheckRef.current);
        animationCheckRef.current = null;
      }
      
      // If this is just a waiting notification with a roomId, don't process it
      if (data.waitingFor !== undefined && !data.prompt) {
        PS_DEBUG && console.log('[PSBattlePanel] Waiting notification for room, not a prompt');
        // Ensure UI stays in waiting state while the server is collecting other players' actions
        setWaitingForOpponent(true);
        return;
      }
      
      // Convert prompt to PS request format
      const prompt = data.prompt as any;
      const isWaitOnlyPrompt = !!prompt?.wait && !prompt?.requestType && !prompt?.forceSwitch && !prompt?.teamPreview;
      if (isWaitOnlyPrompt) {
        PS_DEBUG && console.log('[PSBattlePanel] Wait-only prompt received - keeping last request and waiting');
        diagLogProtocol('promptAction', 'WAIT-ONLY prompt - preserving last request');
        setWaitingForOpponent(true);
        return;
      }
      // Save battle state from prompt - critical for team preview to show opponent
      if (data.state) {
        PS_DEBUG && console.log('[PSBattlePanel] Saving battle state from prompt:', {
          playersCount: data.state.players?.length,
          playerNames: data.state.players?.map((p: any) => p.name || p.id),
        });
        lastBattleStateRef.current = data.state;
      } else {
        // Try to get state from client cache if not in prompt
        const cachedState = client?.getBattleState(roomId);
        if (cachedState) {
          PS_DEBUG && console.log('[PSBattlePanel] Using cached state for team preview');
          lastBattleStateRef.current = cachedState;
        }
      }
      
      // Build side object from prompt data
      // Server may send pokemon at prompt.side.pokemon OR prompt.pokemon
      const rawPokemonData = prompt?.side?.pokemon || prompt?.pokemon || [];
      const sideId = prompt?.side?.id || data.side || prompt?.playerId;
      const playerId = data.playerId || prompt?.playerId;
      const playerIndex = data.state?.players?.findIndex((p: any) => p.id === playerId) ?? -1;
      const playerFromState = playerIndex >= 0 ? data.state?.players?.[playerIndex] : null;
      const sideName = prompt?.side?.name || playerFromState?.name || '';
      // Use server-provided ourSide (boss/team modes) when player isn't in state.players
      const ourSide = playerIndex >= 0 ? (playerIndex === 0 ? 'p1' : 'p2') : (data.ourSide as 'p1' | 'p2' | null) || null;
      // Receiving a real prompt for our playerId means we are NOT a spectator
      if (playerId && myPlayerId && playerId === myPlayerId && !prompt?.wait) {
        setIsSpectator(false);
      }
      const lastKnownActiveName = ourSide ? lastActiveBySideRef.current[ourSide] : undefined;
      if (lastKnownActiveName) {
        PS_DEBUG && console.log('[PSBattlePanel] Using last known active from protocol:', {
          ourSide,
          lastKnownActiveName,
        });
      }
      
      // Enrich Pokemon data with stats from state (tooltips need serverPokemon.stats)
      const activeIndexFromState = playerFromState?.activeIndex ?? 0;
      // In doubles, multiple Pokemon can be active - collect ALL active indices
      const activeIndicesFromPrompt: number[] = [];
      rawPokemonData.forEach((p: any, idx: number) => { if (p?.active) activeIndicesFromPrompt.push(idx); });
      const activeIndexFromPrompt = activeIndicesFromPrompt.length > 0 ? activeIndicesFromPrompt[0] : -1;
      const activeIndexFromProtocol = lastKnownActiveName
        ? findPokemonIndexByName(rawPokemonData, lastKnownActiveName)
        : -1;
      const activeIndexToUse = activeIndexFromPrompt >= 0
        ? activeIndexFromPrompt
        : (activeIndexFromProtocol >= 0 ? activeIndexFromProtocol : activeIndexFromState);
      // Build set of all active indices for doubles support
      const activeIndicesSet = new Set<number>(
        activeIndicesFromPrompt.length > 0
          ? activeIndicesFromPrompt
          : [activeIndexToUse]
      );
      PS_DEBUG && console.log('[PSBattlePanel] Building pokemonData with activeIndexFromState:', activeIndexFromState, {
        activeIndexFromProtocol,
        activeIndexToUse,
        activeIndicesSet: [...activeIndicesSet],
        lastKnownActiveName,
        rawPokemonCount: rawPokemonData?.length,
        stateTeamCount: playerFromState?.team?.length,
      });
      const pokemonData = rawPokemonData.map((poke: any, idx: number) => {
        const battle = battleRef.current;
        // Find matching Pokemon in state to get full stats (name-based, not index-based)
        const stateTeam = playerFromState?.team || [];
        const statePoke = findMatchingStatePoke(poke, stateTeam);
        // Derive a stable ID for this pokemon
        const derivedId = derivePokemonId(poke) || statePoke?.id || statePoke?.pokemonId || `poke-${idx}`;

        // Try to find matching Pokemon in Client Battle state (most accurate for HP/Status)
        // battle.myPokemon is the array of user's pokemon in the PS client
        let clientPoke: any = null;
        if (battle && battle.myPokemon) {
           clientPoke = battle.myPokemon.find((p: any) => 
             p && (p.name === poke.name || p.species === poke.species || p.originalName === poke.name)
           );
           // Fallback to index if reliable
           if (!clientPoke && battle.myPokemon[idx]) {
             // Only use index if name/species at least loosely matches
             const byIdx = battle.myPokemon[idx];
             if (byIdx.name === poke.name || byIdx.species === poke.species) {
               clientPoke = byIdx;
             }
           }
        }

        const speciesName = resolveSpeciesName(poke) || statePoke?.species || statePoke?.name;
        const dexSpecies = speciesName ? getDex()?.species?.get?.(speciesName) : null;
        const level = resolveLevel(poke, statePoke?.level) || 100;
        const baseStats = poke.baseStats || statePoke?.baseStats || dexSpecies?.baseStats;
        const derivedStats = buildStatsFromBase(baseStats, level);

        // Build complete Pokemon data with stats
        const isActive = activeIndicesSet.has(idx);
        if (isActive) {
          PS_DEBUG && console.log('[PSBattlePanel] Marking pokemon as active:', poke.name || poke.id, 'at index', idx);
        }
        
        // Prioritize Client Battle state for volatile data (HP, Status)
        // This fixes the "switch button not updating" and "tooltip ranges" issues
        const currentHP = clientPoke ? clientPoke.hp : (poke.hp ?? statePoke?.currentHP ?? 100);
        const maxHP = clientPoke ? clientPoke.maxhp : (poke.maxhp ?? statePoke?.maxHP ?? baseStats?.hp ?? 100);
        const status = clientPoke ? clientPoke.status : (poke.status || statePoke?.status || '');
        
        // Extract name from ident if not directly available
        const identName = poke?.ident?.split(': ')[1];
        const detailsName = poke?.details?.split(',')[0];
        const resolvedName = poke.name || identName || statePoke?.name || statePoke?.nickname || detailsName || dexSpecies?.name;
        
        return {
          ...poke,
          id: derivedId,
          pokemonId: derivedId,
          active: isActive,
          baseStats,
          // Add stats from state if not present
          stats: poke.stats || statePoke?.stats || derivedStats || baseStats || {
            hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1
          },
          // Add other fields tooltips need
          speciesForme: poke.speciesForme || poke.species || statePoke?.species || dexSpecies?.name,
          species: poke.species || statePoke?.species || dexSpecies?.name,
          name: resolvedName,
          level,
          hp: currentHP,
          maxhp: maxHP,
          fainted: (poke.fainted && !clientPoke) || currentHP <= 0, // Trust client HP
          status: status,
        };
      });
      
      const sideData = {
        id: playerIndex >= 0 ? `p${playerIndex + 1}` : sideId,
        name: sideName,
        pokemon: pokemonData,
      };
      
      PS_DEBUG && console.log('[PSBattlePanel] Built sideData with enriched stats:', sideData);
      
      // Determine requestType early for active rebuild check
      const requestType = (!teamSubmittedRef.current && !!prompt?.teamPreview)
        ? 'team'
        : (prompt?.requestType || (prompt?.wait ? 'wait' : (prompt?.forceSwitch ? 'switch' : 'move')));
      const effectiveTeamPreview = !!prompt?.teamPreview && requestType === 'team' && !teamSubmittedRef.current;
      
      // FIX: Rebuild active array using correct Pokemon from protocol/state (server sometimes sends wrong or missing active)
      // Prefer protocol-derived active, fall back to state.activeIndex
      let fixedActive = prompt?.active;
      
      const hasPromptActiveMoves = Array.isArray(fixedActive) && fixedActive.length > 0 && Array.isArray(fixedActive[0]?.moves);
      // If active is missing or lacks moves, rebuild it (keep prompt.active when it is complete to preserve mega/tera flags)
      const shouldRebuildActive = (requestType !== 'team' && requestType !== 'wait') && (
        !fixedActive ||
        fixedActive.length === 0 ||
        (requestType === 'move' && (!hasPromptActiveMoves || fixedActive[0].moves.length === 0))
      );
      
      // Even if we don't need to rebuild, ensure the active has the correct id/pokemonId
      // The server's prompt.active doesn't include id, so we derive it from the active Pokemon in side data
      // In doubles, derive per-slot IDs from the active Pokemon at each slot index
      const activeIndicesArray = [...activeIndicesSet];
      const activePokemonFromSide = pokemonData[activeIndexToUse];
      const correctActiveId = activePokemonFromSide?.id || activePokemonFromSide?.pokemonId;
      
      if (!shouldRebuildActive && hasPromptActiveMoves && correctActiveId) {
        // Enrich existing active with id but keep moves and flags from prompt
        // In doubles, each active slot gets the ID of the corresponding active Pokemon
        fixedActive = fixedActive.map((active: any, slotIdx: number) => {
          const pokeIdx = activeIndicesArray[slotIdx] ?? activeIndexToUse;
          const slotPoke = pokemonData[pokeIdx];
          const slotId = slotPoke?.id || slotPoke?.pokemonId || correctActiveId;
          return {
            ...active,
            id: slotId,
            pokemonId: slotId,
          };
        });
        PS_DEBUG && console.log('[PSBattlePanel] Enriched active with correct id:', {
          correctActiveId,
          activeIndicesArray,
          activePokemonName: activePokemonFromSide?.name,
          moves: fixedActive[0]?.moves?.length,
          canMegaEvo: fixedActive[0]?.canMegaEvo,
        });
      }

      if (shouldRebuildActive) {
        const promptActiveId = fixedActive?.[0]?.id || fixedActive?.[0]?.pokemonId;

        PS_DEBUG && console.log('[PSBattlePanel] Checking active mismatch:', {
          promptActiveId,
          correctActiveId,
          activeIndexFromState,
          activeIndexFromProtocol,
          activeIndexToUse,
          activeIndicesArray,
          lastKnownActiveName,
          activePokemonName: activePokemonFromSide?.name,
          mismatch: promptActiveId !== correctActiveId,
          missingActive: !fixedActive,
        });

        // If prompt has wrong active Pokemon OR NO active pokemon, rebuild active array from side data
        // In doubles, rebuild ALL active slots (not just the first)
        if (activePokemonFromSide && (promptActiveId !== correctActiveId || !fixedActive || fixedActive.length === 0)) {
          console.warn('[PSBattlePanel] Active Pokemon mismatch or missing! Rebuilding active array from side data');
          
          const rebuiltSlots: any[] = [];
          const slotsToRebuild = activeIndicesArray.length > 0 ? activeIndicesArray : [activeIndexToUse];
          for (let slotIdx = 0; slotIdx < slotsToRebuild.length; slotIdx++) {
            const pokeIdx = slotsToRebuild[slotIdx];
            const slotPokemon = pokemonData[pokeIdx];
            if (!slotPokemon) continue;
            
            const slotId = slotPokemon.id || slotPokemon.pokemonId;
            // Find the original state pokemon to get move PP (use name-based matching)
            const statePokeForSlot = findMatchingStatePoke(slotPokemon, playerFromState?.team || []);
            
            // Use state moves (objects with PP) if available, otherwise fall back to side moves (strings)
            const promptPoke = rawPokemonData[pokeIdx];
            const promptMoves = promptPoke?.moves || [];
            const movesSource = statePokeForSlot?.moves || (promptMoves.length > 0 ? promptMoves : slotPokemon.moves) || [];
            
            const slotMoves = movesSource.map((m: any) => {
              const isString = typeof m === 'string';
              const moveId = isString ? m : (m.id || m.name?.toLowerCase().replace(/\s+/g, ''));
              const moveName = isString ? m : m.name;
              return {
                id: moveId,
                name: moveName,
                pp: isString ? 32 : (m.pp ?? 32),
                maxpp: isString ? 32 : (m.maxpp ?? 32),
                target: isString ? 'normal' : (m.target || 'normal'),
                disabled: isString ? false : (m.disabled || false),
              };
            });
            
            const promptActiveFlags = fixedActive?.[slotIdx] || prompt?.active?.[slotIdx] || {};
            const isTrapped = promptActiveFlags.trapped || false;
            const isMaybeTrapped = promptActiveFlags.maybeTrapped || false;
            const canMegaEvo = promptActiveFlags.canMegaEvo ?? slotPokemon?.canMegaEvo ?? statePokeForSlot?.canMegaEvo;
            const canZMove = promptActiveFlags.canZMove ?? slotPokemon?.canZMove ?? statePokeForSlot?.canZMove;
            const canDynamax = promptActiveFlags.canDynamax ?? slotPokemon?.canDynamax ?? statePokeForSlot?.canDynamax;
            const canTerastallize = promptActiveFlags.canTerastallize ?? promptActiveFlags.canTera ?? slotPokemon?.canTerastallize ?? slotPokemon?.canTera ?? statePokeForSlot?.canTerastallize ?? statePokeForSlot?.canTera;
            
            rebuiltSlots.push({
              id: slotId,
              pokemonId: slotId,
              moves: slotMoves,
              canSwitch: !isTrapped,
              trapped: isTrapped,
              maybeTrapped: isMaybeTrapped,
              canMegaEvo,
              canZMove,
              canDynamax,
              canTerastallize,
            });
          }
          
          fixedActive = rebuiltSlots.length > 0 ? rebuiltSlots : fixedActive;
          PS_DEBUG && console.log('[PSBattlePanel] Rebuilt active with PP data:', fixedActive);
        }
      }
      
      const psRequest: PSBattleRequest = {
        requestType,
        side: sideData,
        active: fixedActive,
        forceSwitch: prompt?.forceSwitch,
        teamPreview: effectiveTeamPreview,
        previewActiveCount: prompt?.previewActiveCount ?? prompt?.state?.previewActiveCount,
        teamPreviewParticipants: prompt?.teamPreviewParticipants ?? prompt?.state?.teamPreviewParticipants,
        maxTeamSize: prompt?.maxTeamSize,
        activeCount: prompt?.previewActiveCount ?? prompt?.state?.previewActiveCount ?? prompt?.state?.rules?.activeCount,
        gameType: prompt?.state?.gameType,
        rqid: prompt?.rqid,
      };
      // In doubles, nullify active entries for fainted/empty slots so BattleChoiceBuilder auto-passes them
      if (psRequest.requestType === 'move' && Array.isArray(psRequest.active) && psRequest.active.length > 1) {
        const sidePokemon = psRequest.side?.pokemon || [];
        const activePokes: any[] = [];
        for (const p of sidePokemon) {
          if (p?.active) activePokes.push(p);
        }
        for (let si = 0; si < psRequest.active.length; si++) {
          const slotPoke = activePokes[si];
          // If no active Pokemon for this slot, or it's fainted (condition starts with '0'), nullify
          if (!slotPoke || /^0\b/.test(slotPoke.condition || '')) {
            psRequest.active[si] = null as any;
          }
        }
      }
      if (psRequest.requestType === 'switch' && (!psRequest.forceSwitch || psRequest.forceSwitch.length === 0)) {
        const activeCount = psRequest.side?.pokemon?.filter((p: any) => p.active).length || 1;
        psRequest.forceSwitch = Array.from({ length: activeCount }, () => true);
      }
      if (psRequest.requestType === 'move' && Array.isArray(psRequest.active) && psRequest.active[0]) {
        const active = psRequest.active[0] as any;
        if (typeof active.canSwitch !== 'boolean') {
          const trapped = !!active.trapped || !!active.maybeTrapped;
          active.canSwitch = !trapped;
        }
      }
      // Debug: log active Pokemon discrepancy
      const activeFromPrompt = psRequest.active?.[0]?.id || psRequest.active?.[0]?.pokemonId;
      const activePokemonForDebug = psRequest.side?.pokemon?.find((p: any) => p.active);
      const activeFromState = playerFromState?.team?.[playerFromState?.activeIndex];
      PS_DEBUG && console.log('[PSBattlePanel] PS request summary:', {
        requestType: psRequest.requestType,
        teamPreview: psRequest.teamPreview,
        forceSwitch: psRequest.forceSwitch,
        maxTeamSize: psRequest.maxTeamSize,
        sidePokemon: psRequest.side?.pokemon?.length,
        activeMoves: psRequest.active?.[0]?.moves?.length,
        rqid: psRequest.rqid,
        promptTurn: data.state?.turn,
      });
      PS_DEBUG && console.log('[PSBattlePanel] Active Pokemon debug:', {
        activeIdFromPrompt: activeFromPrompt,
        activeFromSideData: activePokemonForDebug?.name || activePokemonForDebug?.id,
        activeIndexFromState: playerFromState?.activeIndex,
        activeFromState: activeFromState?.name || activeFromState?.id,
        promptActiveHasMoves: psRequest.active?.[0]?.moves?.length,
      });
      
      // Fix up request using PS's BattleChoiceBuilder for proper formatting
      // Save original active data before fixRequest can corrupt it
      const savedActiveBeforeFix = psRequest.active ? JSON.parse(JSON.stringify(psRequest.active)) : undefined;
      const currentBattle = battleRef.current;
      if (window.BattleChoiceBuilder?.fixRequest && currentBattle) {
        try {
          window.BattleChoiceBuilder.fixRequest(psRequest, currentBattle);
          PS_DEBUG && console.log('[PSBattlePanel] Fixed request with BattleChoiceBuilder');
        } catch (e) {
          console.warn('[PSBattlePanel] Error fixing request:', e);
        }
      }

      // Guard: if fixRequest removed active moves from ANY slot, restore them
      if (requestType === 'move' && savedActiveBeforeFix) {
        if (!psRequest.active) {
          psRequest.active = savedActiveBeforeFix;
          console.warn('[PSBattlePanel] Restored entire active array after fixRequest');
        } else {
          for (let si = 0; si < savedActiveBeforeFix.length; si++) {
            // If fixRequest deliberately nullified a slot (fainted Pokemon), leave it null
            // so that BattleChoiceBuilder.fillPasses() can auto-pass it
            if (psRequest.active[si] === null || psRequest.active[si] === undefined) continue;
            if (savedActiveBeforeFix[si]?.moves?.length && (!psRequest.active[si]?.moves || psRequest.active[si].moves.length === 0)) {
              psRequest.active[si] = savedActiveBeforeFix[si];
              console.warn(`[PSBattlePanel] Restored active slot ${si} moves after fixRequest`);
            }
          }
        }
      } else if (
        requestType === 'move' &&
        (!psRequest.active?.[0]?.moves || psRequest.active[0].moves.length === 0) &&
        fixedActive?.[0]?.moves?.length
      ) {
        psRequest.active = fixedActive;
        console.warn('[PSBattlePanel] Restored active moves from fixedActive fallback');
      }
      
      // Get the turn number from state
      const promptTurn = data.state?.turn ?? 0;
      const promptRqid = prompt?.rqid ?? Date.now();
      const isForceSwitchPrompt = !!prompt?.forceSwitch;

      const lastSentChoice = lastSentChoiceRef.current;
      const alreadyActedThisPrompt = !!(
        lastSentChoice &&
        lastSentChoice.turn === promptTurn &&
        lastSentChoice.rqid &&
        promptRqid &&
        lastSentChoice.rqid === promptRqid
      );

      if (psRequest.requestType === 'move' && alreadyActedThisPrompt && !isForceSwitchPrompt && waitingForOpponent) {
        PS_DEBUG && console.log('[PSBattlePanel] Ignoring move prompt for already-answered prompt while waiting:', {
          promptTurn,
          promptRqid,
          lastSentRqid: lastSentChoice?.rqid,
        });
        diagLogProtocol('promptAction', `IGNORING MOVE PROMPT (already answered) turn=${promptTurn} rqid=${promptRqid}`);
        return;
      }
      
      // Check if this is a duplicate/old prompt
      // Only set new request if turn is new or rqid changed
      // Allow force-switch prompts through even if we're waiting
      const isDuplicatePrompt =
        requestType === 'wait' &&
        waitingForOpponent &&
        promptRqid === lastRqidRef.current &&
        !isForceSwitchPrompt;
      if (isDuplicatePrompt) {
        PS_DEBUG && console.log('[PSBattlePanel] Ignoring duplicate prompt with same rqid while waiting:', promptRqid);
        return;
      }
      
      // Force-switch prompts should reset action tracking so player can switch
      // This is needed because force-switch happens after a Pokemon faints mid-turn
      if (isForceSwitchPrompt) {
        console.log('[PSBattlePanel] Force-switch prompt received - resetting action tracking', {
          forceSwitch: psRequest.forceSwitch,
          sidePokemon: psRequest.side?.pokemon?.length,
          requestType: psRequest.requestType,
        });
        lastActionTurnRef.current = -1;
        lastSentChoiceRef.current = null;
        setWaitingForOpponent(false);
      }


      // Determine our side (p1 or p2) - we already computed playerIndex above
      // In boss/team modes, playerIndex may be -1 but ourSide set via data.ourSide
      if (ourSide) {
        PS_DEBUG && console.log('[PSBattlePanel] Determined side from prompt:', ourSide, 'for player', playerId);
        setMySide(ourSide);
        
        // Switch viewpoint if we're p2
        if (ourSide === 'p2' && currentBattle && !currentBattle.viewpointSwitched) {
          PS_DEBUG && console.log('[PSBattlePanel] Switching viewpoint for p2 from prompt');
          currentBattle.setViewpoint?.('p2');
        }
      }

      // Move prompts that arrive before |start| are the initial "lead choice" prompts
      // The server waits for BOTH players to submit before sending |start| + |switch| + |turn|1
      // So we MUST accept these prompts (not defer) otherwise the battle will be stuck
      if (psRequest.requestType === 'move' && !startEventReceivedRef.current) {
        PS_DEBUG && console.log('[PSBattlePanel] Accepting pre-start move prompt (server waits for both players before |start|)', {
          rqid: psRequest.rqid,
          promptTurn,
          activeMoves: psRequest.active?.[0]?.moves?.length,
        });
        diagLogProtocol('promptAction', `Accepting pre-start MOVE prompt (both players must choose before |start|) turn=${promptTurn}`);
        // Don't defer - let the user make their choice
      }

      if (psRequest.requestType === 'team' && teamSubmittedRef.current) {
        PS_DEBUG && console.log('[PSBattlePanel] Ignoring team preview prompt (already submitted)');
        diagLogProtocol('promptAction', 'Ignoring TEAM prompt (already submitted)');
        return;
      }

      // If we still need team preview, defer move prompts until team is submitted
      const currentRequest = requestRef.current;
      if (
        psRequest.requestType === 'move' &&
        !teamSubmittedRef.current &&
        (currentRequest?.requestType === 'team' || effectiveTeamPreview)
      ) {
        PS_DEBUG && console.log('[PSBattlePanel] Deferring move prompt until team preview is completed');
        diagLogProtocol('promptAction', `DEFERRING move prompt (teamSubmitted=false, currentRequest=${currentRequest?.requestType})`);
        pendingMovePromptRef.current = psRequest;
        return;
      }

      const isWaitRequest = (psRequest.requestType === 'wait' || !!prompt?.wait) && !isForceSwitchPrompt;

      // Check if user has cancelled this turn - if so, don't override with wait request
      const turnWasCancelled = promptTurn && cancelledTurnsRef.current.has(promptTurn);
      if (isWaitRequest && turnWasCancelled) {
        PS_DEBUG && console.log('[PSBattlePanel] Ignoring wait request for cancelled turn:', promptTurn);
        diagLogProtocol('promptAction', `IGNORING WAIT REQUEST (turn was cancelled) turn=${promptTurn}`);
        return;
      }

      // If this is a wait prompt, keep the last actionable request and just show waiting state.
      // Overwriting the request with a wait payload forces users to cancel and re-select on turn 1.
      if (isWaitRequest) {
        PS_DEBUG && console.log('[PSBattlePanel] Wait request received - keeping last request and waiting');
        diagLogProtocol('promptAction', 'WAIT REQUEST - preserving last request');
        setWaitingForOpponent(true);
        return;
      }

      // Update turn/rqid tracking (actionable prompts only)
      latestPromptTurnRef.current = promptTurn;
      latestPromptRqidRef.current = promptRqid;
      if (promptTurn && promptTurn >= currentTurnRef.current) {
        setCurrentTurn(promptTurn);
      }
      setCurrentRqid(promptRqid);
      if (promptTurn) {
        cancelledTurnsRef.current.delete(promptTurn);
      }

      PS_DEBUG && console.log('[PSBattlePanel] Setting request:', {
        requestType: psRequest.requestType,
        teamPreview: psRequest.teamPreview,
        activeMoves: psRequest.active?.[0]?.moves?.length,
        sidePokemon: psRequest.side?.pokemon?.length,
      });
      diagLogProtocol('promptAction', `SETTING REQUEST: type=${psRequest.requestType} teamPreview=${psRequest.teamPreview}`);
      setRequest(psRequest);
      // Only explicitly set waitingForOpponent to true for wait requests
      // For any actionable prompt, reset to false so user can act
      if (isWaitRequest) {
        setWaitingForOpponent(true);
      } else {
        setWaitingForOpponent(false);
      }

      if (window.BattleChoiceBuilder) {
        const newChoices = new window.BattleChoiceBuilder(psRequest as any);
        setChoices(newChoices);
        setChoicesVersion(v => v + 1);
        pendingSlotChoicesRef.current = []; // Clear pending multi-slot choices on new request
        PS_DEBUG && console.log('[PSBattlePanel] Built BattleChoiceBuilder choices');

        // Auto-send pass when no choices are needed (e.g. forceSwitch with no bench)
        // PS's BattleChoiceBuilder.fillPasses() auto-fills 'pass' for all slots when
        // noMoreSwitchChoices() is true, making isDone() immediately true.
        if (isForceSwitchPrompt && newChoices.isDone?.() && newChoices.isEmpty?.()) {
          // Double-check: are there ACTUALLY no switchable bench Pokemon?
          // BattleChoiceBuilder can misclassify Pokemon when the request format
          // doesn't exactly match what PS expects, so verify ourselves.
          const sidePokemon = psRequest.side?.pokemon || [];
          const hasHealthyBench = sidePokemon.some((p: any) => {
            const condition = p?.condition || '';
            const isFainted = p?.fainted || condition.includes('fnt') || /^0\b/.test(condition);
            const isActive = !!p?.active;
            return !isFainted && !isActive;
          });

          if (hasHealthyBench) {
            // BattleChoiceBuilder incorrectly thinks no bench available.
            // Override: rebuild without relying on BattleChoiceBuilder's auto-pass.
            console.warn('[PSBattlePanel] ForceSwitch: BattleChoiceBuilder auto-passed but healthy bench exists - overriding');
            diagLogProtocol('promptAction', 'ForceSwitch auto-pass OVERRIDDEN (healthy bench exists)');
            // Don't auto-pass — let the user choose from the switch buttons
          } else {
            PS_DEBUG && console.log('[PSBattlePanel] ForceSwitch with no bench — auto-sending pass');
            diagLogProtocol('promptAction', 'ForceSwitch auto-pass (no bench pokemon available)');
            // Small delay to let state settle before sending
            setTimeout(() => {
              client.sendAction(roomId, { type: 'switch', choices: [] }, myPlayerId);
              setWaitingForOpponent(true);
            }, 100);
            return;
          }
        }
      }
      
      // If battle not ready yet, queue the event for later (but DON'T generate protocol)
      if (!currentBattle || !battleReadyRef.current) {
        PS_DEBUG && console.log('[PSBattlePanel] Battle not ready, waiting for battleUpdate protocol');
        diagLogProtocol('promptAction', 'Battle not ready - queueing for later');
        // Don't queue events anymore - let battleUpdate handle protocol
        if (effectiveTeamPreview && !teamPreviewFedRef.current && !startEventReceivedRef.current) {
          const previewState = data.state || client.getBattleState(roomId);
          const previewLines = generateTeamPreviewProtocol(previewState, prompt?.maxTeamSize || 6, myPlayerId, localTrainerSprite, prompt?.previewActiveCount ?? prompt?.state?.previewActiveCount);
          PS_DEBUG && console.log('[PSBattlePanel] Stashing team preview protocol (battle not ready):', previewLines.length);
          diagLogProtocol('promptAction', `Stashing ${previewLines.length} team preview lines`);
          pendingTeamPreviewLinesRef.current = previewLines;
        }
        return;
      }

      // Inject team preview protocol when prompt indicates team preview and we haven't fed it yet
      // This restores the PS team preview scene (works even if server doesn't send events yet)
      // BUT don't inject if |start| has already been received (battle has begun)
      if (effectiveTeamPreview && currentBattle && battleReadyRef.current && !teamPreviewFedRef.current && !startEventReceivedRef.current) {
        const previewState = data.state || client.getBattleState(roomId);
        const previewLines = generateTeamPreviewProtocol(previewState, prompt?.maxTeamSize || 6, myPlayerId, localTrainerSprite, prompt?.previewActiveCount ?? prompt?.state?.previewActiveCount);
        PS_DEBUG && console.log('[PSBattlePanel] Injecting team preview protocol lines:', previewLines.length, { previewState });
        diagLogProtocol('promptAction-teamPreview', `Injecting ${previewLines.length} team preview lines (battle IS ready)`);
        for (const line of previewLines) {
          if (line && typeof line === 'string') {
            if (line.startsWith('|start') || line.startsWith('|turn') || line.startsWith('|teampreview')) {
              diagLogProtocol('promptAction-teamPreview', `KEY LINE: ${line}`);
            }
            currentBattle.add(line);
          }
        }
        diagLogProtocol('promptAction-teamPreview', `After injection: battle.turn=${currentBattle.turn}`);
        teamPreviewFedRef.current = true;
        if (currentBattle.scene && typeof currentBattle.scene.updateGen === 'function') {
          currentBattle.scene.updateGen();
        }
        PS_DEBUG && console.log('[PSBattlePanel] Team preview protocol injected and scene updated');
      }
      
      // Track that battle has started (moved past team preview)
      if (!prompt?.teamPreview && !battleStartedRef.current) {
        battleStartedRef.current = true;
        PS_DEBUG && console.log('[PSBattlePanel] Battle has started (past team preview)');
      }
      
      // IMPORTANT: Do NOT feed log from promptAction!
      // The battleUpdate event handles feeding protocol lines to the battle.
      // Feeding from prompt.state.log causes duplicates because:
      // 1. battleUpdate arrives with events (incremental, fed to battle)
      // 2. promptAction arrives with state.log (cumulative, would re-feed same events)
      // Just update lastLogLengthRef to track what the server has
      const stateLog = data.state?.log;
      if (stateLog && Array.isArray(stateLog)) {
        // Only update the tracker, don't feed events (battleUpdate does that)
        lastLogLengthRef.current = Math.max(lastLogLengthRef.current, stateLog.length);
      }
    });
    
    // Listen for battle end
    const offEnd = client.on('battleEnd', (data) => {
      if (data.roomId !== roomId) return;
      const winner = data.payload?.result?.winner || data.payload?.winner || 'Unknown';
      if (onBattleEnd) {
        onBattleEnd(winner);
      }
    });
    
    return () => {
      offUpdate();
      offStart();
      offPrompt();
      offEnd();
    };
  }, [client, roomId, myPlayerId, onBattleEnd, isReplay]);
  
  // Bind tooltips to controls container when it becomes available
  useEffect(() => {
    if (!tooltipsRef.current || !controlsContainerRef.current || tooltipsListenedRef.current) return;
    
    // Use jQuery if available (PS uses jQuery for listen)
    const $ = window.$ || window.jQuery;
    if ($ && tooltipsRef.current.listen) {
      try {
        tooltipsRef.current.listen($(controlsContainerRef.current));
        tooltipsListenedRef.current = true;
        PS_DEBUG && console.log('[PSBattlePanel] Tooltips bound to controls container');
      } catch (e) {
        console.warn('[PSBattlePanel] Error binding tooltips to controls:', e);
      }
    }
  }, [loading, request]); // Re-run when loading finishes or request changes
  
  // Update battle.request when our request state changes (needed for tooltips)
  useEffect(() => {
    const battle = battleRef.current;
    if (!battle || !request) return;
    
    // PS tooltips read from battle.request to get Pokemon data
    battle.request = request;
    
    // Also set myPokemon for tooltips to work with switch buttons
    if (request.side?.pokemon) {
      battle.myPokemon = request.side.pokemon;
    }

    if (battle.scene?.updateSidebars) {
      battle.scene.updateSidebars();
    } else if (battle.scene?.updateSidebar) {
      battle.scene.updateSidebar(battle.p1);
      battle.scene.updateSidebar(battle.p2);
    }

    // Ensure team icons are fully revealed on both trainer panels
    const sidePokemon = request.side?.pokemon ?? [];
    const battleStatePlayers = lastBattleStateRef.current?.players ?? [];
    const mySideId = mySideRef.current || mySide || request.side?.id;
    let opponentTeam: any[] = [];
    if (battleStatePlayers.length > 1) {
      let localIndex = mySideId === 'p2' ? 1 : (mySideId === 'p1' ? 0 : -1);
      if (localIndex < 0 && myPlayerId) {
        localIndex = battleStatePlayers.findIndex((p: any) => p?.id === myPlayerId || p?.name === myPlayerId);
      }
      if (localIndex >= 0) {
        const opponentIndex = localIndex === 0 ? 1 : 0;
        opponentTeam = battleStatePlayers[opponentIndex]?.team || [];
      }
    }

    if ((sidePokemon.length > 0 || opponentTeam.length > 0) && battleFrameRef.current) {
      const applyTeamIcons = () => {
        const applyToTrainer = (trainerSelector: '.trainer-near' | '.trainer-far', pokemonList: any[], tooltipSideIndex: number) => {
          const trainerEl = battleFrameRef.current?.querySelector(trainerSelector) as HTMLElement | null;
          if (!trainerEl || !pokemonList.length) return;
          const iconContainers = Array.from(trainerEl.querySelectorAll('.teamicons')) as HTMLElement[];
          const existingIcons = Array.from(trainerEl.querySelectorAll('.teamicons .picon')) as HTMLElement[];
          const totalNeeded = pokemonList.length;

          if (iconContainers.length > 0 && existingIcons.length < totalNeeded) {
            const targetContainer = iconContainers[iconContainers.length - 1];
            for (let i = existingIcons.length; i < totalNeeded; i++) {
              const span = document.createElement('span');
              span.className = 'picon has-tooltip';
              targetContainer.appendChild(span);
              existingIcons.push(span);
            }
          }

          pokemonList.forEach((poke: any, index: number) => {
            const iconEl = existingIcons[index];
            if (!iconEl) return;
            const speciesForIcon = poke.speciesForme || poke.species || poke.name || poke.details?.split(',')[0];
            const style = getPokemonIconStyle(speciesForIcon);
            Object.assign(iconEl.style, style);
            iconEl.classList.add('has-tooltip');
            iconEl.setAttribute('data-tooltip', `pokemon|${tooltipSideIndex}|${index}`);
            const label = poke.name || poke.nickname || poke.ident?.split(': ')[1] || poke.details?.split(',')[0] || poke.species || 'Pokemon';
            iconEl.setAttribute('aria-label', label);
            const condition = typeof poke.condition === 'string' ? poke.condition : '';
            const hp = typeof poke.hp === 'number' ? poke.hp : poke.currentHP;
            const isFainted = !!poke.fainted || (typeof hp === 'number' && hp <= 0) || condition.includes('fnt');
            iconEl.classList.toggle('fainted', isFainted);
            iconEl.style.opacity = isFainted ? '0.3' : (style.opacity ? String(style.opacity) : '1');
            iconEl.style.filter = isFainted ? 'grayscale(1)' : (style.filter || '');
          });
        };

        const localTooltipSideIndex = mySideId === 'p2' ? 1 : 0;
        const opponentTooltipSideIndex = localTooltipSideIndex === 0 ? 1 : 0;
        applyToTrainer('.trainer-near', sidePokemon, localTooltipSideIndex);
        applyToTrainer('.trainer-far', opponentTeam, opponentTooltipSideIndex);

        // Split merged-side trainer bar into per-ally blocks for boss battles
        const participants = bossParticipantsRef.current;
        if (participants && battleFrameRef.current) {
          // Figure out which side is the merged side and which trainer bar it maps to
          const mergedSide = Object.keys(participants)[0] as 'p1' | 'p2' | undefined;
          if (mergedSide) {
            const isMergedNear = mySideId === mergedSide;
            const trainerSelector = isMergedNear ? '.trainer-near' : '.trainer-far';
            const trainerEl = battleFrameRef.current.querySelector(trainerSelector) as HTMLElement | null;
            const allies = participants[mergedSide];
            if (trainerEl && allies && allies.length > 1) {
              const tooltipSideIdx = isMergedNear ? localTooltipSideIndex : opponentTooltipSideIndex;
              const allTeam = isMergedNear ? sidePokemon : opponentTeam;
              // Build compact split layout — name + pokemon icons only, no trainer sprites
              trainerEl.innerHTML = '';
              trainerEl.style.cssText += 'overflow-y:auto;max-height:100%;';
              let pokemonOffset = 0;
              for (const ally of allies) {
                const block = document.createElement('div');
                block.style.cssText = 'margin-bottom:2px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.15);';
                const nameEl = document.createElement('strong');
                nameEl.textContent = ally.name;
                nameEl.style.cssText = 'display:block;font-size:0.75em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                block.appendChild(nameEl);
                // Add this ally's pokemon icons
                const iconsDiv = document.createElement('div');
                iconsDiv.className = 'teamicons';
                iconsDiv.style.cssText = 'line-height:1;';
                const allyTeamCount = ally.pokemonIds.length;
                for (let pi = 0; pi < allyTeamCount; pi++) {
                  const poke = allTeam[pokemonOffset + pi];
                  if (!poke) continue;
                  const span = document.createElement('span');
                  span.className = 'picon has-tooltip';
                  span.setAttribute('data-tooltip', `pokemon|${tooltipSideIdx}|${pokemonOffset + pi}`);
                  const speciesForIcon = poke.speciesForme || poke.species || poke.name || poke.details?.split(',')[0];
                  const style = getPokemonIconStyle(speciesForIcon);
                  Object.assign(span.style, style);
                  const label = poke.name || poke.nickname || poke.species || 'Pokemon';
                  span.setAttribute('aria-label', label);
                  const condition = typeof poke.condition === 'string' ? poke.condition : '';
                  const hp = typeof poke.hp === 'number' ? poke.hp : (poke as any).currentHP;
                  const isFainted = !!poke.fainted || (typeof hp === 'number' && hp <= 0) || condition.includes('fnt');
                  if (isFainted) {
                    span.classList.add('fainted');
                    span.style.opacity = '0.3';
                    span.style.filter = 'grayscale(1)';
                  }
                  iconsDiv.appendChild(span);
                }
                block.appendChild(iconsDiv);
                trainerEl.appendChild(block);
                pokemonOffset += allyTeamCount;
              }
            }
          }
        }
      };

      window.setTimeout(applyTeamIcons, 0);
    }
  }, [request, mySide, myPlayerId]);

  useEffect(() => {
    const battle = battleRef.current;
    if (!battle || !localTrainerSprite) return;
    const localSide = mySide === 'p2' ? battle.p2 : battle.p1;
    if (localSide && typeof localSide.setAvatar === 'function') {
      localSide.setAvatar(localTrainerSprite);
    }
  }, [localTrainerSprite, mySide]);

  useEffect(() => {
    if (request?.requestType === 'move') {
      setMoveBoosts({ mega: false, z: false, max: false, tera: false });
      setPendingMoveForTarget(null);
    }
  }, [request?.rqid]);
  
  // Send action to server
  const sendChoice = useCallback((choiceString: string) => {
    if (!client || !roomId || !mySide) return;
    
    // Check if this is a force-switch scenario (fainted Pokemon)
    const currentRequest = requestRef.current;
    const isForceSwitchScenario = !!currentRequest?.forceSwitch?.some((f: boolean) => f);
    
    // Prevent sending if already waiting for opponent (but allow force-switch scenarios)
    if (waitingForOpponent && !isForceSwitchScenario) {
      PS_DEBUG && console.log('[PSBattlePanel] Already waiting for opponent, ignoring choice:', choiceString);
      return;
    }

    // Prevent duplicate submissions for the same turn (but allow force-switch scenarios)
    const lastSentChoice = lastSentChoiceRef.current;
    const alreadySentForPrompt = !!(
      latestPromptTurnRef.current &&
      lastSentChoice &&
      lastSentChoice.turn === latestPromptTurnRef.current &&
      lastSentChoice.rqid &&
      latestPromptRqidRef.current &&
      lastSentChoice.rqid === latestPromptRqidRef.current
    );

    if (!isForceSwitchScenario && alreadySentForPrompt && !cancelledTurnsRef.current.has(latestPromptTurnRef.current)) {
      PS_DEBUG && console.log('[PSBattlePanel] Duplicate action blocked for prompt:', {
        turn: latestPromptTurnRef.current,
        rqid: latestPromptRqidRef.current,
        choiceString,
      });
      return;
    }
    
    let resolvedChoice = choiceString;
    const parts = choiceString.split(' ');
    const actionType = parts[0];

    const isStruggleChoice = actionType === 'move' && parts[1] === 'struggle';
    if (actionType === 'move' && !isStruggleChoice) {
      if (moveBoosts.mega) resolvedChoice += ' mega';
      if (moveBoosts.z) resolvedChoice += ' zmove';
      if (moveBoosts.max) resolvedChoice += ' dynamax';
      if (moveBoosts.tera) resolvedChoice += ' terastallize';
    }

    PS_DEBUG && console.log('[PSBattlePanel] Sending choice:', resolvedChoice, {
      currentTurn,
      currentRqid,
      latestPromptTurn: latestPromptTurnRef.current,
      latestPromptRqid: latestPromptRqidRef.current,
      waitingForOpponent,
    });
    
    // Multi-slot handling (doubles/triples boss battles)
    const activeSlotCount = currentRequest?.active?.length || 1;
    const forceSwitchSlotCount = currentRequest?.forceSwitch?.length || 0;
    const isMultiSlot = (activeSlotCount > 1 && !isForceSwitchScenario) || forceSwitchSlotCount > 1;
    
    if (isMultiSlot) {
      const choiceIndex = choices?.index?.() ?? 0;
      const mcParts = resolvedChoice.split(' ');
      const mcActionType = mcParts[0];
      
      // Build sub-action for this slot
      let subAction: any;
      if (mcActionType === 'move') {
        const isStruggle = mcParts[1] === 'struggle';
        const moveIndex = isStruggle ? 0 : (parseInt(mcParts[1], 10) - 1);
        const parsedTargetLoc = parseInt(mcParts[2], 10);
        const targetLoc = Number.isFinite(parsedTargetLoc) ? parsedTargetLoc : undefined;
        const activeMoves = currentRequest?.active?.[choiceIndex]?.moves || [];
        const selectedMove = activeMoves[moveIndex];
        subAction = {
          type: 'move',
          moveIndex,
          moveId: isStruggle ? 'struggle' : (selectedMove?.id || toID(selectedMove?.name || selectedMove?.move || '')),
          targetLoc,
          mega: resolvedChoice.includes('mega'),
          zmove: resolvedChoice.includes('zmove'),
          dynamax: resolvedChoice.includes('dynamax'),
          terastallize: resolvedChoice.includes('terastallize'),
        };
      } else if (mcActionType === 'switch') {
        subAction = {
          type: 'switch',
          toIndex: parseInt(mcParts[1], 10) - 1,
          slotIndex: choiceIndex,
        };
      }
      
      if (subAction) {
        // Advance BattleChoiceBuilder first to validate the choice
        if (choices) {
          const addError = choices.addChoice(resolvedChoice);
          if (typeof addError === 'string') {
            PS_DEBUG && console.log('[PSBattlePanel] Multi-slot addChoice rejected:', addError);
            return;
          }
        }
        pendingSlotChoicesRef.current = [...pendingSlotChoicesRef.current, subAction];
        setChoicesVersion(v => v + 1);
      }
      
      // Check if all slots are done
      const allDone = choices?.isDone?.() || false;
      if (allDone) {
        const multiAction: any = isForceSwitchScenario
          ? { type: 'switch', choices: [...pendingSlotChoicesRef.current] }
          : { type: 'multi-choice', choices: [...pendingSlotChoicesRef.current] };
        pendingSlotChoicesRef.current = [];
        
        actionSentTimestampRef.current = Date.now();
        lastActionTurnRef.current = latestPromptTurnRef.current;
        lastRqidRef.current = latestPromptRqidRef.current;
        lastSentChoiceRef.current = {
          turn: latestPromptTurnRef.current,
          choice: resolvedChoice,
          rqid: latestPromptRqidRef.current ?? null,
        };
        
        diagLogProtocol('handleChoice', `Sending multi-choice action with ${multiAction.choices.length} slot choices`);
        client.sendAction(roomId, multiAction, myPlayerId);
        
        lastMoveRequestRef.current = currentRequest;
        lastMoveChoicesRef.current = choices;
        waitStartTimeRef.current = Date.now();
        setWaitingForOpponent(true);
      } else {
        PS_DEBUG && console.log(`[PSBattlePanel] Multi-slot: chose for slot ${choiceIndex}, waiting for more (${pendingSlotChoicesRef.current.length}/${activeSlotCount})`);
      }
      
      setMoveBoosts({ mega: false, z: false, max: false, tera: false });
      return;
    }
    
    // Track when we sent this action - prevents dropping server's response as "duplicate"
    actionSentTimestampRef.current = Date.now();
    
    lastSentChoiceRef.current = {
      turn: latestPromptTurnRef.current,
      choice: resolvedChoice,
      rqid: latestPromptRqidRef.current ?? null,
    };
    
    // Parse PS choice format and convert to our action format
    // PS format: "move 1", "switch 2", "team 123456"
    const actionTypeResolved = parts[0];
    
      let action: any;
      let shouldWait = true;
      switch (actionTypeResolved) {
      case 'move': {
        const isStruggle = parts[1] === 'struggle';
        const parsedMoveIndex = parseInt(parts[1], 10);
        const parsedTargetLoc = parseInt(parts[2], 10);
        const targetLoc = Number.isFinite(parsedTargetLoc) ? parsedTargetLoc : undefined;
        const moveIndex = isStruggle ? 0 : (parsedMoveIndex - 1);
        if (!isStruggle && (!Number.isFinite(parsedMoveIndex) || moveIndex < 0)) {
          console.warn('[PSBattlePanel] Invalid move choice:', choiceString);
          return;
        }
        const activeMoves = requestRef.current?.active?.[0]?.moves || [];
        const selectedMove = activeMoves[moveIndex];
        const moveId = isStruggle ? 'struggle' : (selectedMove?.id || toID(selectedMove?.name || selectedMove?.move || ''));

        action = {
          type: 'move',
          moveIndex,
          moveId: moveId || undefined,
          targetLoc,
          mega: resolvedChoice.includes('mega'),
          zmove: resolvedChoice.includes('zmove'),
          dynamax: resolvedChoice.includes('dynamax'),
          terastallize: resolvedChoice.includes('terastallize'),
        };
        break;
      }
        
      case 'switch':
        action = {
          type: 'switch',
          switchTo: parseInt(parts[1], 10) - 1,
          toIndex: parseInt(parts[1], 10) - 1, // Server expects toIndex
        };
        break;
        
      case 'team':
        action = {
          type: 'team',
          order: parts[1].includes(',') ? parts[1].split(',').map(Number) : parts[1].split('').map(Number),
        };
        teamSubmittedRef.current = true;
        setTeamPreviewLeads([]); // Reset multi-lead selection
        diagLogProtocol('handleChoice', `TEAM SUBMITTED: order=${parts[1]} - now waiting for |start|`);
        break;
        
      default:
        console.warn('[PSBattlePanel] Unknown action type:', actionType);
        return;
    }
    
    // DIAGNOSTIC: Log action sent
    diagLogProtocol('handleChoice', `Sending action: type=${actionType} actionResolved=${actionTypeResolved}`);
    
    // Track that we've acted on the latest prompt
    lastActionTurnRef.current = latestPromptTurnRef.current;
    lastRqidRef.current = latestPromptRqidRef.current;
    
    // Send through client
    PS_DEBUG && console.log('[PSBattlePanel] Action payload:', action);
    client.sendAction(roomId, action, myPlayerId);

    // Reset move boosts after sending
    if (actionTypeResolved === 'move') {
      setMoveBoosts({ mega: false, z: false, max: false, tera: false });
    }

    if (actionTypeResolved === 'team') {
      // Flush deferred post-|start| lines that were held back during team preview
      if (deferredPostStartLinesRef.current.length > 0) {
        const battle = battleRef.current;
        if (battle) {
          PS_DEBUG && console.log('[PSBattlePanel] Flushing', deferredPostStartLinesRef.current.length, 'deferred post-start lines');
          diagLogProtocol('handleChoice-team', `Flushing ${deferredPostStartLinesRef.current.length} deferred post-start lines`);
          for (const line of deferredPostStartLinesRef.current) {
            if (line && typeof line === 'string') {
              if (line.startsWith('|start')) {
                startEventReceivedRef.current = true;
              }
              battle.add(line);
            }
          }
          deferredPostStartLinesRef.current = [];
          startAnimationWait(battle);
        }
      }

      const pending = pendingMovePromptRef.current;
      if (pending) {
        pendingMovePromptRef.current = null;
        PS_DEBUG && console.log('[PSBattlePanel] Applying deferred move prompt after team selection');
        setRequest(pending);
        if (window.BattleChoiceBuilder) {
          const newChoices = new window.BattleChoiceBuilder(pending as any);
          setChoices(newChoices);
          setChoicesVersion(v => v + 1);
        }
        shouldWait = false;
      } else {
        setRequest(null);
        setChoices(null);
      }
    }
    
    // Save the current request before entering waiting state so we can restore on cancel
    // Save for both move and switch actions so cancel always shows the move selection UI
    if (shouldWait && (actionTypeResolved === 'move' || actionTypeResolved === 'switch') && requestRef.current) {
      lastMoveRequestRef.current = requestRef.current;
    }
    
    // Track when we started waiting
    if (shouldWait) {
      waitStartTimeRef.current = Date.now();
    }
    
    // Show waiting state but keep request/choices for tooltips and cancel UI
    setWaitingForOpponent(shouldWait);
  }, [client, roomId, mySide, myPlayerId, waitingForOpponent, currentTurn, currentRqid, moveBoosts, choices]);

  const cancelWaiting = useCallback(() => {
    const turn = latestPromptTurnRef.current;
    if (turn) {
      cancelledTurnsRef.current.add(turn);
    }
    lastSentChoiceRef.current = null;
    lastActionTurnRef.current = 0;
    pendingSlotChoicesRef.current = []; // Clear multi-slot pending choices
    
    // Notify server to clear our buffered action so the turn doesn't process
    if (client && roomId && myPlayerId) {
      PS_DEBUG && console.log('[PSBattlePanel] Sending cancel to server');
      client.sendAction(roomId, { type: 'cancel' } as any, myPlayerId);
    }
    
    // Restore the last valid move request and rebuild fresh choices so the move selection UI is shown
    if (lastMoveRequestRef.current) {
      PS_DEBUG && console.log('[PSBattlePanel] Restoring last move request on cancel');
      setRequest(lastMoveRequestRef.current);
      // Always rebuild a fresh BattleChoiceBuilder — the old one has already been used
      if (window.BattleChoiceBuilder) {
        const newChoices = new window.BattleChoiceBuilder(lastMoveRequestRef.current as any);
        setChoices(newChoices);
        setChoicesVersion(v => v + 1);
      }
    }
    
    setWaitingForOpponent(false);
    waitStartTimeRef.current = 0;
  }, [client, roomId, myPlayerId]);
  
  // Auto-retry mechanism: If we've been waiting too long (5 seconds) for move/switch,
  // automatically re-send the action. This helps when server might have "lost" the first action.
  useEffect(() => {
    if (!waitingForOpponent || !lastSentChoiceRef.current) return;
    
    const checkRetry = () => {
      const waitTime = Date.now() - waitStartTimeRef.current;
      // Only auto-retry on Turn 1 after 5 seconds of waiting
      if (waitStartTimeRef.current > 0 && waitTime > 5000 && currentTurnRef.current <= 1) {
        const lastChoice = lastSentChoiceRef.current;
        if (lastChoice && client && roomId && mySide) {
          PS_DEBUG && console.log('[PSBattlePanel] Auto-retrying action after', Math.round(waitTime / 1000), 'seconds wait:', lastChoice.choice);
          diagLogProtocol('autoRetry', `Retrying action after ${Math.round(waitTime / 1000)}s wait: ${lastChoice.choice}`);
          
          // Parse and re-send the choice
          const parts = lastChoice.choice.split(' ');
          const actionType = parts[0];
          let action: any;
          
          if (actionType === 'move') {
            const isStruggle = parts[1] === 'struggle';
            const moveIndex = isStruggle ? 0 : (parseInt(parts[1], 10) - 1);
            const activeMoves = requestRef.current?.active?.[0]?.moves || [];
            const selectedMove = activeMoves[moveIndex];
            action = {
              type: 'move',
              moveIndex,
              moveId: isStruggle ? 'struggle' : (selectedMove?.id || ''),
              mega: lastChoice.choice.includes('mega'),
              zmove: lastChoice.choice.includes('zmove'),
              dynamax: lastChoice.choice.includes('dynamax'),
              terastallize: lastChoice.choice.includes('terastallize'),
            };
          } else if (actionType === 'switch') {
            action = {
              type: 'switch',
              switchTo: parseInt(parts[1], 10) - 1,
              toIndex: parseInt(parts[1], 10) - 1,
            };
          }
          
          if (action) {
            // Update timestamp to prevent immediate re-retry
            actionSentTimestampRef.current = Date.now();
            waitStartTimeRef.current = Date.now();
            client.sendAction(roomId, action, myPlayerId);
          }
        }
      }
    };
    
    // Check every 2 seconds while waiting
    const intervalId = setInterval(checkRetry, 2000);
    return () => clearInterval(intervalId);
  }, [waitingForOpponent, client, roomId, mySide, myPlayerId]);
  
  // Render move buttons
  const renderMoveButtons = useMemo(() => {
    // For multi-slot (doubles/triples), show moves for the current choice index
    const choiceIndex = choices?.index?.() ?? 0;
    if (!request?.active?.[choiceIndex]) return null;
    
    const moves = Array.isArray(request.active[choiceIndex].moves) ? request.active[choiceIndex].moves : [];
    // Use SlotMatrix to find the correct active Pokemon for this choice slot
    const matrix = buildSlotMatrix(request.side?.pokemon);
    const slotEntry = matrix.activeAt(choiceIndex);
    const activePokemonIndex = slotEntry?.sideIndex ?? 0;
    const activePokemon = request.side?.pokemon?.[activePokemonIndex];

    const activeSpeciesLabel = activePokemon?.speciesForme || activePokemon?.species || activePokemon?.name || '';
    const alreadyMega = /\bmega\b/i.test(activeSpeciesLabel);
    const megaAvailability = request.active[choiceIndex].canMegaEvo ?? request.active[choiceIndex].canMega ?? activePokemon?.canMegaEvo;
    const canMega = !alreadyMega && (
      (Array.isArray(megaAvailability) ? megaAvailability.length > 0 : !!megaAvailability) ||
      (!!activePokemon?.item && /(ite|redorb|blueorb)/i.test(activePokemon.item))
    );
    const zMoveAvailability = request.active[choiceIndex].canZMove;
    const canZMove = Array.isArray(zMoveAvailability) ? zMoveAvailability.length > 0 : !!zMoveAvailability;
    const canDynamax = !!request.active[choiceIndex].canDynamax;
    const canTera = !!(request.active[choiceIndex].canTerastallize ?? request.active[choiceIndex].canTera ?? activePokemon?.canTerastallize ?? activePokemon?.canTera);
    
    // Doubles/triples targeting: need target selector even if ally only controls 1 slot
    const totalSlots = request.active?.length || 1;
    const isMultiSlot = totalSlots > 1;
    const battleGameType = battleRef.current?.gameType || lastBattleStateRef.current?.gameType || 'singles';
    const isDoublesPlus = battleGameType === 'doubles' || battleGameType === 'triples' || battleGameType === 'multi' || battleGameType === 'freeforall';
    const needsTargeting = isMultiSlot || isDoublesPlus;
    
    // Get the active Pokemon's index for tooltips
    const fullMoveData = activePokemon?.moves || [];
    
    // Access BattleMovedex for move data (PP, type, etc)
    const moveDex = (window as any).BattleMovedex || {};
    
    const paddedMoves = Array.from({ length: 4 }, (_, i) =>
      moves[i] || { id: `empty-${i}`, name: '—', disabled: true, isPlaceholder: true }
    );
    const hasUsableMove = moves.some((move: any) => {
      if (!move || move.disabled) return false;
      const pp = move.pp;
      if (typeof pp === 'number') return pp > 0;
      return true;
    });
    const needsStruggle = moves.length === 0 || !hasUsableMove;
    
    // Disable all moves during animations (but still show them as preview)
    const animationsBlocking = waitingForAnimations;

    return (
      <div className="movemenu">
        {isMultiSlot && (
          <div style={{ textAlign: 'center', padding: '2px 0', fontSize: '11px', color: '#ffa', fontWeight: 'bold' }}>
            Slot {choiceIndex + 1} of {totalSlots}
            {activePokemon ? ` — ${activePokemon.speciesForme || activePokemon.species || activePokemon.name || ''}` : ''}
          </div>
        )}
        {needsStruggle ? (
          <button
            className={`movebutton has-tooltip type-Normal${animationsBlocking ? ' disabled' : ''}`}
            disabled={animationsBlocking}
            onClick={() => sendChoice('move struggle')}
            data-tooltip={`move|Struggle|${activePokemonIndex}`}
            title={'Struggle\nType: Normal\nCategory: Physical\nPower: 50\nAccuracy: 100%\nPP: -/-'}
            aria-disabled={animationsBlocking}
          >
            <span className="movename">Struggle</span>
            <small className="pp">-/-</small>
            <small className="moveinfo">
              <span className="type">Normal</span>
              <span className="category-icon physical" aria-hidden="true" />
              <span className="power"> 50</span>
              <span className="accuracy"> 100%</span>
            </small>
          </button>
        ) : paddedMoves.map((move: any, i: number) => {
          const moveId = move.id || toID(move.name || move.move);
          const moveName = move.name || move.move || moveId;
          
          // Get full move data from multiple sources
          const fullMove = fullMoveData.find((m: any) => toID(m.id) === moveId || toID(m.name) === moveId);
          // Get move from BattleMovedex (has type, power, accuracy, description)
          const dexMove = moveDex[moveId] || getDex()?.moves?.get?.(moveId);
          
          // PP: Server sends pp/maxpp - use server value if it looks real, else fallback to dex
          let pp = move.pp ?? 10;
          let maxpp = move.maxpp ?? move.pp ?? 10;
          if (move.isPlaceholder) {
            pp = 0;
            maxpp = 0;
          }
          
          // Use dex PP if server appears to be sending defaults (both 10)
          // and dex has a different (likely correct) value
          if (dexMove?.pp && maxpp === 10 && dexMove.pp !== 10) {
            maxpp = dexMove.pp;
            // Keep current pp ratio if we're changing maxpp
            pp = Math.min(pp, maxpp);
          }
          
          const disabled = move.disabled || move.isPlaceholder || pp === 0 || animationsBlocking;
          
          // Get type, power, accuracy from dex for accurate display
          const typeName = dexMove?.type || move.type || fullMove?.type || 'Normal';
          const power = dexMove?.basePower || move.basePower || fullMove?.power || move.power;
          const accuracy = dexMove?.accuracy || move.accuracy || fullMove?.accuracy;
          const category = dexMove?.category || move.category || fullMove?.category || 'Physical';
          const description = dexMove?.shortDesc || dexMove?.desc || '';
          
          // PS tooltip format: "move|moveName|pokemonIndex"
          const tooltipName = move.name || move.move || moveName;
          const tooltipData = `move|${tooltipName}|${activePokemonIndex}`;
          
          // Build tooltip text for native browser tooltip (backup if PS tooltips don't work)
          const tooltipText = [
            moveName,
            `Type: ${typeName}`,
            `Category: ${category}`,
            power ? `Power: ${power}` : null,
            accuracy !== true ? `Accuracy: ${accuracy === true ? '-' : accuracy}%` : null,
            `PP: ${pp}/${maxpp}`,
            description,
          ].filter(Boolean).join('\n');
          
          return (
            <button
              key={i}
              className={`movebutton has-tooltip type-${typeName}${disabled ? ' disabled' : ''}`}
              disabled={disabled}
              onClick={() => {
                // In doubles+, single-target moves need target selection
                const moveTarget = move.target || dexMove?.target || 'normal';
                const needsTarget = needsTargeting && ['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf'].includes(moveTarget);
                if (needsTarget) {
                  setPendingMoveForTarget({ moveIndex: i + 1, moveName });
                } else {
                  setPendingMoveForTarget(null);
                  sendChoice(`move ${i + 1}`);
                }
              }}
              data-tooltip={tooltipData}
              title={tooltipText}
              aria-disabled={disabled}
            >
              <span className="movename">{moveName}</span>
              <small className="pp">{pp}/{maxpp}</small>
              <small className="moveinfo">
                <span className="type">{typeName}</span>
                <span className={`category-icon ${category.toLowerCase()}`} aria-hidden="true" />
                {power ? <span className="power"> {power}</span> : null}
                {accuracy !== true && accuracy ? <span className="accuracy"> {accuracy}%</span> : null}
              </small>
            </button>
          );
        })}
        
        {/* Mega/Z-Move/Dynamax toggles */}
        <div className="movecontrols-extra">
          {!needsStruggle && canMega && (
            <label className="checkbox">
              <input
                type="checkbox"
                name="mega"
                checked={moveBoosts.mega}
                onChange={(e) => setMoveBoosts((prev) => ({ ...prev, mega: e.target.checked }))}
              /> Mega Evolution
            </label>
          )}
          {!needsStruggle && canZMove && (
            <label className="checkbox">
              <input
                type="checkbox"
                name="zmove"
                checked={moveBoosts.z}
                onChange={(e) => setMoveBoosts((prev) => ({ ...prev, z: e.target.checked }))}
              /> Z-Move
            </label>
          )}
          {!needsStruggle && canDynamax && (
            <label className="checkbox">
              <input
                type="checkbox"
                name="dynamax"
                checked={moveBoosts.max}
                onChange={(e) => setMoveBoosts((prev) => ({ ...prev, max: e.target.checked }))}
              /> Dynamax
            </label>
          )}
          {!needsStruggle && canTera && (
            <label className="checkbox">
              <input
                type="checkbox"
                name="tera"
                checked={moveBoosts.tera}
                onChange={(e) => setMoveBoosts((prev) => ({ ...prev, tera: e.target.checked }))}
              /> Terastallize
            </label>
          )}
        </div>
      </div>
    );
  }, [request, sendChoice, moveBoosts, waitingForAnimations, choices, choicesVersion]);
  
  // Render target selector for doubles/triples
  const renderTargetSelector = useMemo(() => {
    if (!pendingMoveForTarget) return null;
    const battle = battleRef.current;
    if (!battle) return null;
    
    // Determine my side and active pokemon
    const mySideObj = battle.sides?.find((s: any) => s.sideid === mySide);
    const oppSideObj = battle.sides?.find((s: any) => s.sideid !== mySide);
    
    // Build target list with PS target locations
    // PS doubles convention: positive = opponent side, negative = own side
    //   1 = opponent slot a, 2 = opponent slot b
    //   -1 = own slot a, -2 = own slot b
    const choiceIndex = choices?.index?.() ?? 0;
    
    const targets: { label: string; loc: number; isFoe: boolean; fainted: boolean }[] = [];
    
    // Add opponent targets (positive locations)
    if (oppSideObj?.active) {
      for (let i = 0; i < oppSideObj.active.length; i++) {
        const mon = oppSideObj.active[i];
        const name = mon?.speciesForme || mon?.species || mon?.name || `Foe slot ${i + 1}`;
        const fainted = !mon || mon.fainted || (mon.hp !== undefined && mon.hp <= 0);
        targets.push({ label: name, loc: i + 1, isFoe: true, fainted });
      }
    } else {
      // Fallback if battle sides not available
      targets.push({ label: 'Foe 1', loc: 1, isFoe: true, fainted: false });
      targets.push({ label: 'Foe 2', loc: 2, isFoe: true, fainted: false });
    }
    
    // Add ally targets (negative locations, for moves that can target allies)
    if (mySideObj?.active) {
      for (let i = 0; i < mySideObj.active.length; i++) {
        const mon = mySideObj.active[i];
        if (!mon) continue;
        const name = mon.speciesForme || mon.species || mon.name || `Ally slot ${i + 1}`;
        const fainted = mon.fainted || (mon.hp !== undefined && mon.hp <= 0);
        // Only show ally targets if it's a different slot
        if (i !== choiceIndex) {
          targets.push({ label: name, loc: -(i + 1), isFoe: false, fainted });
        }
      }
    }
    
    return (
      <div style={{
        padding: '6px 8px',
        background: 'rgba(0,0,0,0.6)',
        borderRadius: '6px',
        margin: '4px 0',
      }}>
        <div style={{ fontSize: '12px', color: '#ffa', marginBottom: '4px', fontWeight: 'bold', textAlign: 'center' }}>
          Target for {pendingMoveForTarget.moveName}?
        </div>
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {targets.filter(t => t.isFoe).map((t) => (
            <button
              key={`target-${t.loc}`}
              disabled={t.fainted}
              onClick={() => {
                setPendingMoveForTarget(null);
                sendChoice(`move ${pendingMoveForTarget.moveIndex} ${t.loc}`);
              }}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid #c44',
                background: t.fainted ? '#333' : '#a22',
                color: t.fainted ? '#666' : '#fff',
                cursor: t.fainted ? 'not-allowed' : 'pointer',
                opacity: t.fainted ? 0.5 : 1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {targets.some(t => !t.isFoe) && (
          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
            {targets.filter(t => !t.isFoe).map((t) => (
              <button
                key={`target-${t.loc}`}
                disabled={t.fainted}
                onClick={() => {
                  setPendingMoveForTarget(null);
                  sendChoice(`move ${pendingMoveForTarget.moveIndex} ${t.loc}`);
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #4a4',
                  background: t.fainted ? '#333' : '#2a6',
                  color: t.fainted ? '#666' : '#fff',
                  cursor: t.fainted ? 'not-allowed' : 'pointer',
                  opacity: t.fainted ? 0.5 : 1,
                }}
              >
                {t.label} (ally)
              </button>
            ))}
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: '4px' }}>
          <button
            onClick={() => setPendingMoveForTarget(null)}
            style={{
              padding: '3px 10px',
              fontSize: '11px',
              borderRadius: '3px',
              border: '1px solid #666',
              background: '#444',
              color: '#ccc',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }, [pendingMoveForTarget, mySide, choices, choicesVersion, sendChoice]);
  
  // Render switch buttons
  const renderSwitchButtons = useMemo(() => {
    if (!request?.side?.pokemon) return null;
    
    // Check if trapped - in doubles, check the CURRENT slot being selected
    const currentSlot = choices?.index?.() ?? 0;
    const isTrapped = request.active?.[currentSlot]?.trapped;
    const isMaybeTrapped = request.active?.[currentSlot]?.maybeTrapped;
    
    if (isTrapped && !request.forceSwitch) {
      return (
        <div className="switchmenu">
          <p className="trapped-message" style={{ 
            color: '#e74c3c', 
            fontWeight: 'bold', 
            textAlign: 'center',
            padding: '10px' 
          }}>
            You are trapped and cannot switch out!
          </p>
        </div>
      );
    }
    
    const pokemon = request.side.pokemon;
    const isForceSwitch = !!request?.forceSwitch;
    const waitingBlocksSwitch = (waitingForOpponent && !isForceSwitch) || (waitingForAnimations && !isForceSwitch);
    // Use SlotMatrix for scalable active/benched/fainted partitioning
    const matrix = buildSlotMatrix(pokemon);
    // In multi-slot forceSwitch, exclude Pokemon already chosen for a prior slot
    // BattleChoiceBuilder tracks this in alreadySwitchingIn (1-based indices)
    const alreadySwitchingIn: number[] = choices?.alreadySwitchingIn || [];
    const switchable = matrix.benched.filter(entry => {
      const alreadyChosen = alreadySwitchingIn.includes(entry.sideIndex + 1); // 1-based
      return !alreadyChosen;
    });
    
    return (
      <div className="switchmenu">
        {isMaybeTrapped && !isTrapped && (
          <p className="maybe-trapped-warning" style={{ 
            color: '#f39c12', 
            fontSize: '0.9em',
            textAlign: 'center',
            padding: '5px' 
          }}>
            Warning: You may be trapped!
          </p>
        )}
        {switchable.map((entry) => {
          const poke = entry.pokemon;
          const index = entry.sideIndex;
          
          // Parse HP - condition can be "120/120", "0/100", or "0 fnt"
          const condition = poke.condition || '100/100';
          let current = 0;
          let max = 100;
          
          if (condition.includes('fnt')) {
            current = 0;
            const parts = condition.split('/');
            if (parts.length > 1) {
              max = parseInt(parts[1].split(' ')[0], 10) || 100;
            }
          } else {
            const parts = condition.split('/');
            current = parseInt(parts[0], 10) || 0;
            max = parseInt(parts[1]?.split(' ')[0], 10) || 100;
          }
          
          const hpPercent = max > 0 ? Math.round((current / max) * 100) : 0;
          const disabled = waitingBlocksSwitch;
          
          // Get Pokemon name from various sources
          const pokeName = poke.name || 
                          poke.ident?.split(': ')[1] || 
                          poke.details?.split(',')[0] ||
                          poke.species ||
                          'Pokemon';
          
          return (
            <button
              key={index}
              className={`switchbutton has-tooltip${disabled ? ' disabled' : ''}`}
              disabled={disabled}
              onClick={() => sendChoice(`switch ${index + 1}`)}
              data-tooltip={`switchpokemon|${index}`}
              aria-disabled={disabled}
            >
              <span
                className="picon"
                style={getPokemonIconStyle(poke.speciesForme || poke.species || poke.details?.split(',')[0])}
              />
              <span className="pokemonname">{pokeName}</span>
              <span className="hpbar">
                <span 
                  className={`hpbar-fill${hpPercent > 50 ? '' : hpPercent > 20 ? ' hpbar-yellow' : ' hpbar-red'}`}
                  style={{ width: `${hpPercent}%` }}
                />
              </span>
              <span className="pokemon-hp-text" style={{ fontSize: '0.8em', opacity: 0.85, marginLeft: 4, whiteSpace: 'nowrap' }}>{current}/{max}</span>
              {poke.status && <span className={`status status-${poke.status}`}>{poke.status.toUpperCase()}</span>}
            </button>
          );
        })}
      </div>
    );
  }, [request, sendChoice, waitingForOpponent, waitingForAnimations, choices, choicesVersion]);
  
  // Render team preview
  const renderTeamPreview = useMemo(() => {
    if (
      !request?.teamPreview ||
      !request?.side?.pokemon ||
      request.side.pokemon.length === 0
    ) {
      return null;
    }
    
    PS_DEBUG && console.log('[PSBattlePanel] Rendering team preview with', request.side.pokemon.length, 'pokemon');
    
    const pokemon = request.side.pokemon;
    const maxTeamSize = request.maxTeamSize || 6;
    const battleState = lastBattleStateRef.current;
    const mySide = mySideRef.current || request.side?.id;
    const previewParticipants = request.teamPreviewParticipants || battleState?.teamPreviewParticipants || {};
    const myParticipantGroups = mySide ? (previewParticipants[mySide] || []) : [];
    const opponentParticipantGroups = Object.entries(previewParticipants)
      .filter(([sideId]) => sideId !== mySide)
      .flatMap(([, participants]) => Array.isArray(participants) ? participants : []);
    let opponentTeam: any[] = [];
    let opponentMissing = false;

    if (opponentParticipantGroups.length > 0) {
      opponentTeam = opponentParticipantGroups.flatMap((participant: any) => participant.team || []);
    } else if (battleState?.players?.length) {
      let opponentIndex = -1;
      if (mySide === 'p1') opponentIndex = 1;
      if (mySide === 'p2') opponentIndex = 0;
      if (opponentIndex < 0 && myPlayerId) {
        const myIndex = battleState.players.findIndex((p: any) => p.id === myPlayerId || p.name === myPlayerId);
        opponentIndex = myIndex === 0 ? 1 : myIndex === 1 ? 0 : -1;
      }
      if (opponentIndex >= 0) {
        opponentTeam = battleState.players[opponentIndex]?.team || [];
        // Detect if opponent data is missing (player exists but no team)
        if (battleState.players[opponentIndex] && (!opponentTeam || opponentTeam.length === 0)) {
          opponentMissing = true;
          PS_DEBUG && console.log('[PSBattlePanel] Team preview: opponent player exists but team is empty, requesting refresh');
        }
      } else {
        // Opponent player not found at all
        opponentMissing = true;
        PS_DEBUG && console.log('[PSBattlePanel] Team preview: opponent player not found in state');
      }
    } else {
      // No players in state at all
      opponentMissing = true;
      PS_DEBUG && console.log('[PSBattlePanel] Team preview: no players in battle state');
    }
    
    // Request state refresh if opponent is missing and we haven't recently requested
    const now = Date.now();
    if (opponentMissing && now - opponentStateRefreshRequestedRef.current > 2000) {
      opponentStateRefreshRequestedRef.current = now;
      // Try to get fresh state from client cache
      const freshState = client?.getBattleState(roomId);
      if (freshState && freshState !== battleState) {
        PS_DEBUG && console.log('[PSBattlePanel] Team preview: found fresh state in client cache');
        lastBattleStateRef.current = freshState;
        // Re-extract opponent team from fresh state
        const freshPlayers = (freshState as any)?.players || [];
        if (freshPlayers.length >= 2) {
          let opponentIndex = mySide === 'p1' ? 1 : mySide === 'p2' ? 0 : -1;
          if (opponentIndex < 0 && myPlayerId) {
            const myIndex = freshPlayers.findIndex((p: any) => p.id === myPlayerId || p.name === myPlayerId);
            opponentIndex = myIndex === 0 ? 1 : myIndex === 1 ? 0 : -1;
          }
          if (opponentIndex >= 0) {
            opponentTeam = freshPlayers[opponentIndex]?.team || [];
            opponentMissing = opponentTeam.length === 0;
          }
        }
      }
    }
    
    // Determine how many leads need to be selected (1 for singles, 2 for doubles, 3 for triples)
    // Check both the battle state ref AND the request's maxTeamSize/gameType info
    const stateRules = lastBattleStateRef.current?.rules;
    const stateGameType = lastBattleStateRef.current?.gameType;
    // Also check request-level hints for game type (prompt may carry state with gameType)
    const requestGameType = (request as any)?.state?.gameType || (request as any)?.gameType;
    const requestActiveCount = (request as any)?.state?.rules?.activeCount;
    const effectiveGameType = request.gameType || stateGameType || requestGameType;
    const effectiveActiveCount = request.previewActiveCount ?? request.activeCount ?? stateRules?.activeCount ?? requestActiveCount;
    const activeCount = effectiveActiveCount ?? (effectiveGameType === 'doubles' ? 2 : effectiveGameType === 'triples' ? 3 : 1);
    const leadsNeeded = typeof activeCount === 'number' && activeCount > 1 ? activeCount : 1;
    const isMultiLead = leadsNeeded > 1;
    PS_DEBUG && console.log('[PSBattlePanel] Team preview lead calc:', { stateGameType, requestGameType, effectiveActiveCount, leadsNeeded, isMultiLead });

    const renderParticipantGroups = (groups: any[]) => {
      if (!groups.length) return null;
      return (
        <div style={{ display: 'grid', gap: '10px', marginBottom: '10px' }}>
          {groups.map((participant: any) => (
            <div key={participant.playerId} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <div style={{ fontWeight: 600 }}>{participant.name}</div>
                {participant.previewActiveCount > 1 && <div style={{ fontSize: '11px', opacity: 0.7 }}>controls {participant.previewActiveCount}</div>}
              </div>
              <div className="switchmenu">
                {(participant.team || []).map((poke: any, i: number) => {
                  const speciesForIcon = poke.species || poke.name || poke.originalName;
                  const pokeName = poke.name || poke.nickname || poke.species || poke.originalName || 'Pokemon';
                  return (
                    <div key={`${participant.playerId}-${i}`} className="switchbutton" style={{ cursor: 'default' }}>
                      <span className="picon" style={getPokemonIconStyle(speciesForIcon)} />
                      <span className="pokemonname">{pokeName}</span>
                    </div>
                  );
                })}
                <div style={{ clear: 'left' }} />
              </div>
            </div>
          ))}
        </div>
      );
    };
    
    // For single lead, pick immediately. For multi-lead, accumulate selections.
    const handlePick = (index: number) => {
      if (!isMultiLead) {
        // Singles: Build team order with chosen lead first, then rest in order
        const order = [index + 1];
        for (let j = 1; j <= pokemon.length; j++) {
          if (j !== index + 1) order.push(j);
        }
        sendChoice(`team ${order.slice(0, maxTeamSize).join(',')}`);
        return;
      }
      
      // Multi-lead: toggle selection
      setTeamPreviewLeads(prev => {
        const alreadySelected = prev.includes(index);
        if (alreadySelected) {
          // Deselect
          return prev.filter(i => i !== index);
        }
        if (prev.length >= leadsNeeded) {
          // Already at max - replace the last selection
          return [...prev.slice(0, -1), index];
        }
        const next = [...prev, index];
        // If we've selected enough leads, auto-submit
        if (next.length >= leadsNeeded) {
          // Build order: selected leads first (in selection order), then rest
          const order = next.map(i => i + 1);
          for (let j = 1; j <= pokemon.length; j++) {
            if (!order.includes(j)) order.push(j);
          }
          // Delay send slightly so React can render the final selection state
          setTimeout(() => sendChoice(`team ${order.slice(0, maxTeamSize).join(',')}`), 150);
        }
        return next;
      });
    };
    
    const leadLabel = leadsNeeded > 1
      ? `Choose ${leadsNeeded} lead Pokémon (${teamPreviewLeads.length}/${leadsNeeded} selected)`
      : 'Choose your lead Pokémon';
    
    return (
      <div className="controls">
        <div className="whatdo">
          How will you start the battle?
        </div>
        <div className="switchcontrols">
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '280px', flex: '1 1 280px' }}>
              <h3 className="switchselect">{leadLabel}</h3>
              {myParticipantGroups.length > 1 && renderParticipantGroups(myParticipantGroups)}
              <div className="switchmenu">
                {pokemon.map((poke: any, i: number) => {
                  const pokeName = poke.name || 
                                  poke.ident?.split(': ')[1] || 
                                  poke.details?.split(',')[0] ||
                                  poke.species ||
                                  'Pokemon';
                  // Get species for icon - try multiple sources
                  const speciesForIcon = poke.speciesForme || poke.species || poke.name || poke.details?.split(',')[0];
                  const tooltipData = `switchpokemon|${i}`;
                  const selectionIndex = teamPreviewLeads.indexOf(i);
                  const isSelected = selectionIndex >= 0;
                  return (
                    <button
                      key={i}
                      className={`switchbutton has-tooltip${isSelected ? ' active' : ''}`}
                      data-tooltip={tooltipData}
                      onClick={() => handlePick(i)}
                      style={isSelected ? { outline: '2px solid #4af', background: 'rgba(68,170,255,0.15)' } : undefined}
                    >
                      {isMultiLead && isSelected && (
                        <span style={{ position: 'absolute', top: 2, right: 6, fontSize: '11px', fontWeight: 'bold', color: '#4af' }}>
                          #{selectionIndex + 1}
                        </span>
                      )}
                      <span className="picon" style={getPokemonIconStyle(speciesForIcon)} />
                      <span className="pokemonname">{pokeName}</span>
                    </button>
                  );
                })}
                <div style={{ clear: 'left' }} />
              </div>
            </div>
            {opponentTeam.length > 0 ? (
              <div style={{ minWidth: '240px', flex: '1 1 240px' }}>
                <h3 className="switchselect">Opponent&apos;s team</h3>
                {opponentParticipantGroups.length > 0 && renderParticipantGroups(opponentParticipantGroups)}
                <div className="switchmenu">
                  {opponentTeam.map((poke: any, i: number) => {
                    const pokeName = poke.name || poke.nickname || poke.species || poke.originalName || 'Pokemon';
                    const speciesForIcon = poke.species || poke.name || poke.originalName;
                    return (
                      <div key={i} className="switchbutton" style={{ cursor: 'default' }}>
                        <span className="picon" style={getPokemonIconStyle(speciesForIcon)} />
                        <span className="pokemonname">{pokeName}</span>
                      </div>
                    );
                  })}
                  <div style={{ clear: 'left' }} />
                </div>
              </div>
            ) : opponentMissing && (
              <div style={{ minWidth: '240px', flex: '1 1 240px' }}>
                <h3 className="switchselect">Opponent&apos;s team</h3>
                <div className="switchmenu" style={{ padding: '10px', color: '#888', fontStyle: 'italic' }}>
                  <span>Loading opponent team...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [request, sendChoice, myPlayerId, teamPreviewLeads]);
  
  // IMPORTANT: Always render the same DOM structure to preserve refs!
  // The PS Battle instance is bound to the DOM elements via refs.
  // If we return different structures based on loading/error, the refs become invalid.
  
  return (
    <div className="ps-battle-panel">
      {/* Error overlay */}
      {error && (
        <div className="ps-battle-error-overlay">
          <h3>Failed to load battle</h3>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      
      {/* Loading overlay - shown over the battle area */}
      {loading && (
        <div className="ps-battle-loading-overlay">
          <div className="loading-spinner" />
          <p>Loading Pokemon Showdown battle engine...</p>
        </div>
      )}

      {/* Main battle room - PS layout */}
      <div
        className="ps-room ps-room-opaque ps-room-light"
        id={`room-${roomId}`}
        role="tabpanel"
        aria-labelledby={`roomtab-${roomId}`}
        style={{ width: '100%', right: 'auto', overflow: 'visible', visibility: loading || error ? 'hidden' : 'visible' }}
      >
        {/* Battle animation frame - PS will create innerbattle content via scene.reset() */}
        <div className="battle" ref={battleFrameRef} />



        <div className="foehint" />

        {/* Battle log - PS will create inner content via BattleLog constructor */}
        <div className="battle-log hasuserlist" ref={logFrameRef} role="log" aria-label="Chat log" />

        <div className="battle-log-add">Connecting...</div>

        {/* Controls - only shown when not loading, no error, and not in replay mode */}
        {!loading && !error && !isReplay && (
          <div className="battle-controls" role="complementary" aria-label="Battle Controls" ref={controlsContainerRef}>
            {isSpectator && (
              <div className="controls">
                <div className="whatdo">Spectator Controls</div>
                <div className="switchcontrols" style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span className="dim" style={{ fontSize: '0.9em' }}>View:</span>
                    <button
                      className={`button${spectatorView === 'p1' ? ' active' : ''}`}
                      onClick={() => applySpectatorView('p1')}
                    >P1</button>
                    <button
                      className={`button${spectatorView === 'p2' ? ' active' : ''}`}
                      onClick={() => applySpectatorView('p2')}
                    >P2</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <button
                      className="button"
                      onClick={() => seekSpectatorTurn(Math.max(1, (battleRef.current?.turn || currentTurnRef.current || 1) - 1))}
                      disabled={(battleRef.current?.turn || currentTurnRef.current || 1) <= 1}
                    >⟲ Prev Turn</button>
                    <button
                      className="button"
                      onClick={() => {
                        const next = (battleRef.current?.turn || currentTurnRef.current || 1) + 1;
                        const latest = currentTurnRef.current || next;
                        if (next >= latest) {
                          seekSpectatorTurn('live');
                        } else {
                          seekSpectatorTurn(next);
                        }
                      }}
                      disabled={spectatorTurn === null && (battleRef.current?.turn || 0) >= (currentTurnRef.current || 0)}
                    >Next Turn ⟳</button>
                    <button className="button" onClick={() => seekSpectatorTurn('live')}>
                      Catch up
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* Show appropriate controls based on request type */}
            {request?.teamPreview && !waitingForOpponent && !waitingForAnimations && renderTeamPreview}

            {/* Force-switch takes priority over animations - player needs to act immediately */}
            {(request?.forceSwitch || request?.requestType === 'switch') && !request?.teamPreview && (
              <>
                <div className="whatdo">
                  {(request?.forceSwitch?.filter(Boolean)?.length ?? 0) > 1
                    ? `Choose replacement ${(choices?.index?.() ?? 0) + 1} of ${request?.forceSwitch?.filter(Boolean)?.length}:`
                    : 'Choose a Pokemon to send out:'}
                </div>
                {renderSwitchButtons}
              </>
            )}

            {waitingForOpponent && !request?.forceSwitch && request?.requestType !== 'switch' && (
              <div className="controls">
                <div className="whatdo">
                  <em>Waiting for opponent...{waitingForAnimations ? ' (animations playing)' : ''}</em>
                </div>
                <div className="switchcontrols">
                  <button className="button" onClick={cancelWaiting}>
                    <i className="fa fa-chevron-left" aria-hidden="true" /> Cancel / Change Move
                  </button>
                  {waitingForAnimations && !isSpectator && (
                    <button className="button" onClick={handleSkipAnimations}>
                      Skip animations
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {request?.requestType === 'move' && !request?.teamPreview && !request?.forceSwitch && !waitingForOpponent && (
              <>
                <div className="whatdo">
                  {waitingForAnimations ? (
                    <em>Waiting for animations... (preview below)</em>
                  ) : (
                    <>What will {
                      buildSlotMatrix(request.side?.pokemon).nameAt(choices?.index?.() ?? 0)
                    } do?</>
                  )}
                </div>
                {/* Ability display */}
                {(() => {
                  const ci = choices?.index?.() ?? 0;
                  const mat = buildSlotMatrix(request.side?.pokemon);
                  const se = mat.activeAt(ci);
                  const ap = request.side?.pokemon?.[se?.sideIndex ?? 0];
                  const abilityName = ap?.baseAbility || ap?.ability || '';
                  if (!abilityName) return null;
                  const abilDex = (window as any).BattleAbilities || {};
                  const abilId = abilityName.toLowerCase().replace(/[^a-z0-9]/g, '');
                  const abilData = abilDex[abilId];
                  const desc = abilData?.shortDesc || abilData?.desc || '';
                  return (
                    <div style={{ textAlign:'center', padding:'2px 6px', fontSize:'11px', color:'#cda', background:'rgba(60,60,40,0.4)', borderRadius:4, marginBottom:2 }} title={desc}>
                      <strong>Ability:</strong> {abilityName}{desc ? ` — ${desc}` : ''}
                    </div>
                  );
                })()}
                {renderMoveButtons}
                {/* Back button for multi-slot: go back to previous slot's choices */}
                {(choices?.index?.() ?? 0) > 0 && (request?.active?.length ?? 1) > 1 && (
                  <div style={{ textAlign: 'center', padding: '4px 0' }}>
                    <button
                      className="button"
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={() => {
                        // Rebuild fresh BattleChoiceBuilder to restart from slot 1
                        if (window.BattleChoiceBuilder && request) {
                          const newChoices = new window.BattleChoiceBuilder(request as any);
                          setChoices(newChoices);
                          setChoicesVersion(v => v + 1);
                          pendingSlotChoicesRef.current = [];
                          setMoveBoosts({ mega: false, z: false, max: false, tera: false });
                          setPendingMoveForTarget(null);
                        }
                      }}
                    >
                      <i className="fa fa-chevron-left" aria-hidden="true" /> Back to {buildSlotMatrix(request.side?.pokemon).nameAt(0)}
                    </button>
                  </div>
                )}
                {renderTargetSelector}
                {renderSwitchButtons}
              </>
            )}
            
            {waitingForAnimations && !request?.forceSwitch && request?.requestType !== 'switch' && request?.requestType !== 'move' && (
              <div className="controls">
                <div className="whatdo">
                  <em>Waiting for animations...</em>
                </div>
                {!isSpectator && (
                  <div className="switchcontrols">
                    <button className="button" onClick={handleSkipAnimations}>Skip animations</button>
                  </div>
                )}
              </div>
            )}
            
            {!request && !waitingForOpponent && (
              <div className="waiting">Waiting for battle to start...</div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default PSBattlePanel;
