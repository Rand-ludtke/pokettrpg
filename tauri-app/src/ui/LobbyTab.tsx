import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadTeams, normalizeName } from '../data/adapter';
import { BattlePokemon } from '../types';
import { ChatMessage, ChallengeParticipant, ChallengeSummary, ClientStatus, getClient, PlayerPayload, RoomSummary } from '../net/pokettrpgClient';
import { CustomsImportExport } from './CustomsImportExport';
import { MapRoomPanel } from './MapRoomPanel';

type RoomRole = 'player' | 'spectator';

const ACTIVE_CHALLENGE_STATUS_SET = new Set<ChallengeSummary['status']>(['open', 'pending', 'launching']);

function isChallengeActionable(status: ChallengeSummary['status']): boolean {
  return ACTIVE_CHALLENGE_STATUS_SET.has(status);
}

function describeChallengeStatus(status: ChallengeSummary['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

type NamedEntity = { id?: string; username?: string; name?: string | null } | ChallengeParticipant | null | undefined;

function formatName(entity: NamedEntity, fallback = 'Trainer'): string {
  if (!entity) return fallback;
  const source = entity as { id?: string; username?: string; name?: string | null };
  return source.username || source.name || source.id || fallback;
}

function useTeams() {
  const [version, setVersion] = useState(0);
  const forceRefresh = () => setVersion(v => v + 1);
  useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    // Listen to storage events for cross-tab sync
    window.addEventListener('storage', handler);
    // Listen to custom event for same-window team updates
    window.addEventListener('teamsUpdated', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('teamsUpdated', handler);
    };
  }, []);
  const teams = useMemo(() => loadTeams(), [version]);
  return { ...teams, forceRefresh };
}

function buildPlayerPayload(username: string, playerId: string | undefined, team: BattlePokemon[], trainerSprite?: string | null): PlayerPayload {
  const sanitizedName = username.trim() || 'Trainer';
  const payloadTeam = team.map((mon, index) => {
    const moves = Array.isArray(mon.moves) ? mon.moves : [];
    const rawSpecies = typeof mon.species === 'string' && mon.species.trim() ? mon.species.trim() : mon.name;
    const speciesName = rawSpecies || mon.name || `Slot ${index + 1}`;
    const hasNickname = Boolean(mon.species && mon.name && mon.name.trim() && mon.species.trim() && mon.name.trim().toLowerCase() !== mon.species.trim().toLowerCase());
    const nickname = hasNickname ? mon.name.trim() : '';
    const idSource = nickname || speciesName;
    const normalizedId = normalizeName(idSource);
    const fallbackBase = `slot${index + 1}`;
    const baseId = normalizedId || (idSource ? idSource.replace(/\s+/g, '-').toLowerCase() : '');
    const payloadId = hasNickname
      ? (baseId || fallbackBase)
      : (baseId ? `${baseId}-${index + 1}` : fallbackBase);
    const finalId = payloadId || fallbackBase;
    return {
      id: finalId,
      name: speciesName,
      species: speciesName,
      nickname: nickname || undefined,
      originalName: mon.name,
      level: mon.level,
      types: mon.types,
      baseStats: {
        hp: mon.baseStats.hp,
        atk: mon.baseStats.atk,
        def: mon.baseStats.def,
        spa: mon.baseStats.spAtk,
        spd: mon.baseStats.spDef,
        spe: mon.baseStats.speed,
      },
      currentHP: mon.currentHp ?? mon.maxHp,
      maxHP: mon.maxHp,
      stages: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
      status: 'none',
      volatile: {},
      ability: mon.ability,
      item: mon.item,
      shiny: mon.shiny || false,
      sprite: (mon as any).sprite,
      backSprite: (mon as any).backSprite,
      spriteChoiceId: (mon as any).spriteChoiceId,
      spriteChoiceLabel: (mon as any).spriteChoiceLabel,
      cosmeticForm: (mon as any).cosmeticForm,
      fusion: (mon as any).fusion,
      hatId: (mon as any).hatId,
      moves: moves.map((move, moveIndex) => ({
        id: normalizeName(move.name || '') || `move-${moveIndex}`,
        name: move.name,
        type: move.type,
        category: move.category,
        power: move.power,
        accuracy: typeof move.accuracy === 'number' ? move.accuracy : undefined,
        priority: undefined,
      })),
    };
  });

  return {
    id: playerId || `player-${Math.random().toString(36).slice(2, 8)}`,
    name: sanitizedName,
    activeIndex: 0,
    team: payloadTeam,
      ...(trainerSprite ? { trainerSprite, avatar: trainerSprite } : {}),
  };
}

function isDataImageUrl(value: string | null | undefined): boolean {
  return !!value && /^data:image\//i.test(value.trim());
}

async function uploadTrainerSpriteIfNeeded(apiBase: string, trainerSprite?: string | null): Promise<string | null | undefined> {
  if (!trainerSprite) return trainerSprite;
  const trimmed = trainerSprite.trim();
  if (!isDataImageUrl(trimmed)) return trimmed;
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/trainer-sprites/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: trimmed, prefix: 'trainer' }),
    });
    if (!res.ok) return trimmed;
    const payload = await res.json().catch(() => ({} as any));
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    return url || trimmed;
  } catch {
    return trimmed;
  }
}

const DEFAULT_ROOM = 'global-lobby';

// Unified battle mode options (replaces old separate format + player count selectors)
const BATTLE_MODE_OPTIONS = [
  { value: 'singles',   label: 'Singles',              desc: '1v1 — each player has 1 active Pokémon',                   format: 'singles', playerFormat: '1v1', players: 2 },
  { value: 'doubles',   label: 'Doubles',              desc: '1v1 — each player has 2 active Pokémon',                   format: 'doubles', playerFormat: '1v1', players: 2 },
  { value: 'triples',   label: 'Triples',              desc: '1v1 — each player has 3 active Pokémon',                   format: 'triples', playerFormat: '1v1', players: 2 },
  { value: 'multi',     label: 'Multi Battle (2v2)',    desc: '2 players per side — each controls 1 Pokémon (doubles)',    format: 'doubles', playerFormat: '2v2-teams', players: 4 },
  { value: 'multi3',    label: 'Multi Battle (3v3)',    desc: '3 players per side — each controls 1 Pokémon (triples)',    format: 'triples', playerFormat: '3v3-teams', players: 6 },
  { value: 'ffa4',      label: 'Free-for-All (4P)',     desc: '4 players — everyone for themselves, 1 active each',        format: 'ffa',     playerFormat: '4ffa', players: 4 },
  { value: 'boss2v1',   label: 'Boss 2v1',             desc: '2 challengers vs 1 boss — doubles format',                  format: 'doubles', playerFormat: '2v1', players: 3 },
  { value: 'boss3v1',   label: 'Boss 3v1',             desc: '3 challengers vs 1 boss — triples format',                  format: 'triples', playerFormat: '3v1', players: 3 },
  { value: 'boss5v1',   label: 'Boss 5v1',             desc: '5 challengers vs 1 boss — triples format',                  format: 'triples', playerFormat: '5v1', players: 6 },
];

// Clauses/rules that can be enabled
const CLAUSE_OPTIONS = [
  { id: 'species', label: 'Species Clause', desc: 'No duplicate Pokémon species' },
  { id: 'sleep', label: 'Sleep Clause', desc: 'Only one opponent asleep at a time' },
  { id: 'ohko', label: 'OHKO Clause', desc: 'No one-hit KO moves' },
  { id: 'evasion', label: 'Evasion Clause', desc: 'No evasion-boosting moves' },
  { id: 'item', label: 'Item Clause', desc: 'No duplicate held items' },
  { id: 'endless', label: 'Endless Battle Clause', desc: 'No stalling infinitely' },
  { id: 'freeze', label: 'Freeze Clause', desc: 'Only one opponent frozen at a time' },
  { id: 'selfko', label: 'Self-KO Clause', desc: 'Self-KO causes loss if last mon' },
  { id: 'baton', label: 'Baton Pass Clause', desc: 'Restrictions on Baton Pass' },
  { id: 'unlimitedtera', label: 'Unlimited Terastallization', desc: 'Allow Terastallization every turn instead of once per battle' },
  { id: 'multimega', label: 'Multi Mega Evolution', desc: 'Allow multiple Pokémon to Mega Evolve per battle instead of just one' },
];

type StartSideSetup = {
  stealthRock: boolean;
  spikesLayers: number;
  toxicSpikesLayers: number;
  stickyWeb: boolean;
  reflectTurns: number;
  lightScreenTurns: number;
  tailwindTurns: number;
};

const DEFAULT_START_SIDE_SETUP: StartSideSetup = {
  stealthRock: false,
  spikesLayers: 0,
  toxicSpikesLayers: 0,
  stickyWeb: false,
  reflectTurns: 0,
  lightScreenTurns: 0,
  tailwindTurns: 0,
};

const START_WEATHER_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'sun', label: 'Sun' },
  { value: 'rain', label: 'Rain' },
  { value: 'sandstorm', label: 'Sandstorm' },
  { value: 'snow', label: 'Snow' },
  { value: 'hail', label: 'Hail' },
];

const START_TERRAIN_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'electric', label: 'Electric Terrain' },
  { value: 'grassy', label: 'Grassy Terrain' },
  { value: 'misty', label: 'Misty Terrain' },
  { value: 'psychic', label: 'Psychic Terrain' },
];

export function LobbyTab() {
  const client = useMemo(() => getClient(), []);
  const [status, setStatus] = useState<ClientStatus>(client.getStatus());
  const [serverUrl, setServerUrl] = useState<string>(client.getServerEndpoint());
  const [serverUrlDraft, setServerUrlDraft] = useState<string>(client.getServerEndpoint());
  const defaultServerUrl = useMemo(() => client.getDefaultServerEndpoint(), [client]);
  const [username, setUsername] = useState(() => {
    const stored = localStorage.getItem('ttrpg.username');
    if (stored) return stored;
    const generated = `Trainer-${Math.random().toString(36).slice(2, 6)}`;
    try { localStorage.setItem('ttrpg.username', generated); } catch {}
    return generated;
  });
  const [rooms, setRooms] = useState<RoomSummary[]>(client.getRooms());
  const [activeRoomId, setActiveRoomId] = useState<string>(DEFAULT_ROOM);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(client.getChat(DEFAULT_ROOM));
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomType, setNewRoomType] = useState<'battle' | 'map'>('battle');
  const [messageText, setMessageText] = useState('');
  const [lastError, setLastError] = useState<string>('');
  const [activeRole, setActiveRole] = useState<Record<string, RoomRole>>({ [DEFAULT_ROOM]: 'player' });
  const [challengeBusy, setChallengeBusy] = useState<boolean>(false);
  const [challengesByRoom, setChallengesByRoom] = useState<Record<string, ChallengeSummary[]>>({});
  const [challengeNotice, setChallengeNotice] = useState<string>('');
  const [battleMode, setBattleMode] = useState<string>('singles');
  const [challengeRules, setChallengeRules] = useState<string>('');
  const [challengeTargetId, setChallengeTargetId] = useState<string>('');
  // Enhanced custom game options - all clauses OFF by default
  const [selectedClauses, setSelectedClauses] = useState<Set<string>>(new Set());
  const [trueBoss, setTrueBoss] = useState<boolean>(false);
  const [teamSize, setTeamSize] = useState<number>(6);
  const [teamPreviewEnabled, setTeamPreviewEnabled] = useState<boolean>(true);
  const [activeCount, setActiveCount] = useState<number>(1);
  const [startWeather, setStartWeather] = useState<string>('none');
  const [startWeatherTurns, setStartWeatherTurns] = useState<number>(5);
  const [startTerrain, setStartTerrain] = useState<string>('none');
  const [startTerrainTurns, setStartTerrainTurns] = useState<number>(5);
  const [startSide1, setStartSide1] = useState<StartSideSetup>(DEFAULT_START_SIDE_SETUP);
  const [startSide2, setStartSide2] = useState<StartSideSetup>(DEFAULT_START_SIDE_SETUP);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 900;
  });
  const teamsState = useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string>(() => teamsState.activeId || teamsState.teams[0]?.id || '');
  const chatRef = useRef<HTMLDivElement>(null);
  const activeRoomRef = useRef(activeRoomId);

  useEffect(() => {
    const current = client.getServerEndpoint();
    setServerUrl(current);
    setServerUrlDraft(current);
  }, [client]);

  // Auto-sync activeCount when battleMode changes
  useEffect(() => {
    const mode = BATTLE_MODE_OPTIONS.find(m => m.value === battleMode);
    if (!mode) return;
    if (mode.format === 'doubles') setActiveCount(2);
    else if (mode.format === 'triples') setActiveCount(3);
    else if (mode.format === 'ffa') setActiveCount(1);
    else setActiveCount(1);
  }, [battleMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth <= 900);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!teamsState.teams.length) {
      if (selectedTeamId !== '') setSelectedTeamId('');
      return;
    }
    if (!teamsState.teams.some(team => team.id === selectedTeamId)) {
      const fallback = teamsState.activeId || teamsState.teams[0]?.id || '';
      setSelectedTeamId(fallback);
    }
  }, [teamsState, selectedTeamId]);

  // Persist username changes
  useEffect(() => {
    try { localStorage.setItem('ttrpg.username', username); } catch {}
  }, [username]);

  // Connect once on mount
  useEffect(() => {
    client.connect(username);
    const unsubStatus = client.on('status', setStatus);
    const unsubRoomsSnapshot = client.on('roomsSnapshot', snapshot => {
      const sorted = snapshot.slice().sort((a, b) => a.name.localeCompare(b.name));
      setRooms(sorted);
      setActiveRoomId(prev => {
        if (snapshot.some(r => r.id === prev)) return prev;
        if (!snapshot.length) return DEFAULT_ROOM;
        const lobby = snapshot.find(r => r.id === DEFAULT_ROOM) || snapshot[0];
        return lobby.id;
      });
    });
    const unsubRoomUpdate = client.on('roomUpdate', room => {
      setRooms(prev => {
        const map = new Map(prev.map(r => [r.id, r] as const));
        map.set(room.id, room);
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      });
    });
    const unsubRoomRemove = client.on('roomRemove', roomId => {
      setRooms(prev => prev.filter(r => r.id !== roomId));
      setActiveRoomId(prev => (prev === roomId ? DEFAULT_ROOM : prev));
    });
    const unsubChat = client.on('chatMessage', msg => {
      const currentRoomId = activeRoomRef.current;
      if (msg.roomId === currentRoomId) {
        setChatMessages([...client.getChat(currentRoomId)]);
      }
    });
    const unsubError = client.on('error', err => setLastError(err.message));
    const applyChallengeUpdate = (roomId: string, challenge: ChallengeSummary) => {
      setChallengesByRoom(prev => {
        const list = prev[roomId] ?? [];
        const idx = list.findIndex(c => c.id === challenge.id);
        const next = idx === -1 ? [...list, challenge] : list.map(c => (c.id === challenge.id ? challenge : c));
        next.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        return { ...prev, [roomId]: next };
      });
    };
    const updateChallengeCount = (roomId: string, count: number) => {
      setRooms(prev => {
        const map = new Map(prev.map(r => [r.id, r] as const));
        const room = map.get(roomId);
        if (room) {
          map.set(roomId, { ...room, challengeCount: count });
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      });
    };
    const unsubChallengeSync = client.on('challengeSync', ({ roomId, challenges }) => {
      setChallengesByRoom(prev => ({ ...prev, [roomId]: challenges.slice() }));
      updateChallengeCount(roomId, challenges.length);
    });
    const unsubChallengeCreated = client.on('challengeCreated', ({ roomId, challenge }) => {
      applyChallengeUpdate(roomId, challenge);
      const count = client.getChallenges(roomId).length;
      updateChallengeCount(roomId, count);
    });
    const unsubChallengeUpdated = client.on('challengeUpdated', ({ roomId, challenge }) => {
      applyChallengeUpdate(roomId, challenge);
      const count = client.getChallenges(roomId).length;
      updateChallengeCount(roomId, count);
    });
    const unsubChallengeRemoved = client.on('challengeRemoved', ({ roomId, challengeId, reason }) => {
      let removedChallenge: ChallengeSummary | undefined;
      setChallengesByRoom(prev => {
        const list = prev[roomId] ?? [];
        removedChallenge = list.find(c => c.id === challengeId);
        const next = list.filter(c => c.id !== challengeId);
        const updated = { ...prev } as Record<string, ChallengeSummary[]>;
        if (next.length) updated[roomId] = next;
        else delete updated[roomId];
        return updated;
      });
      const count = client.getChallenges(roomId).length;
      updateChallengeCount(roomId, count);
      if (removedChallenge) {
        const ownerName = removedChallenge.owner?.username || removedChallenge.owner?.id || 'Owner';
        const targetName = removedChallenge.target?.username || removedChallenge.target?.id || '';
        const label = targetName ? `${ownerName} vs ${targetName}` : `${ownerName} challenge`;
        const reasonText = reason ? reason.replace(/-/g, ' ') : 'removed';
        setChallengeNotice(`${label} ${reasonText}`);
      }
    });
    return () => {
      unsubStatus();
      unsubRoomsSnapshot();
      unsubRoomUpdate();
      unsubRoomRemove();
      unsubChat();
      unsubError();
      unsubChallengeSync();
      unsubChallengeCreated();
      unsubChallengeUpdated();
      unsubChallengeRemoved();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Re-identify when username changes
  useEffect(() => {
    client.setUsername(username);
  }, [client, username]);

  // Update chat when active room changes
  useEffect(() => {
    activeRoomRef.current = activeRoomId;
    setChatMessages([...client.getChat(activeRoomId)]);
  }, [client, activeRoomId, rooms.length]);

  // Scroll chat to bottom on updates
  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    if (!challengeNotice) return;
    const timer = window.setTimeout(() => setChallengeNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [challengeNotice]);

  const myId = client.user?.id;
  const currentRoom = rooms.find(r => r.id === activeRoomId) || null;
  const iAmPlayer = !!currentRoom?.players?.some(p => p.id === myId);
  const uniquePlayers = useMemo(() => {
    if (!currentRoom?.players) return [] as Array<{ id: string; username?: string; name?: string }>;
    const map = new Map<string, { id: string; username?: string; name?: string }>();
    for (const player of currentRoom.players) {
      if (player?.id && !map.has(player.id)) map.set(player.id, player);
    }
    return Array.from(map.values());
  }, [currentRoom?.id, currentRoom?.players]);
  const eligibleOpponents = uniquePlayers.filter(p => p.id !== myId);
  const roomChallenges = challengesByRoom[activeRoomId] ?? [];
  const actionableChallenges = useMemo(() => roomChallenges.filter(ch => isChallengeActionable(ch.status)), [roomChallenges]);
  const myActionableChallenges = useMemo(
    () => actionableChallenges.filter(ch => ch.owner?.id === myId || ch.target?.id === myId || (ch.allies || []).some(a => a?.id === myId)),
    [actionableChallenges, myId],
  );
  const myPendingChallenges = useMemo(
    () => actionableChallenges.filter(ch => ch.owner?.id === myId),
    [actionableChallenges, myId],
  );
  const hasPendingChallengeForSelection = useMemo(() => {
    if (!myPendingChallenges.length) return false;
    const normalizedSelection = challengeTargetId || '__open__';
    return myPendingChallenges.some(ch => (ch.target?.id || '__open__') === normalizedSelection);
  }, [myPendingChallenges, challengeTargetId]);
  const challengedOpponentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of myPendingChallenges) {
      if (entry.target?.id) ids.add(entry.target.id);
    }
    return ids;
  }, [myPendingChallenges]);
  const playersChallengingMeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of actionableChallenges) {
      if (entry.owner?.id && entry.target?.id === myId) ids.add(entry.owner.id);
    }
    return ids;
  }, [actionableChallenges, myId]);
  const sortedRoomChallenges = useMemo(() => {
    const list = roomChallenges.slice();
    list.sort((a, b) => {
      const timeA = a.updatedAt ?? a.createdAt ?? 0;
      const timeB = b.updatedAt ?? b.createdAt ?? 0;
      return timeA - timeB;
    });
    return list;
  }, [roomChallenges]);
  const activeChallenge = useMemo(() => {
    if (!myActionableChallenges.length) return null;
    const list = myActionableChallenges.slice();
    list.sort((a, b) => {
      const timeA = a.updatedAt ?? a.createdAt ?? 0;
      const timeB = b.updatedAt ?? b.createdAt ?? 0;
      return timeA - timeB;
    });
    return list[0] ?? null;
  }, [myActionableChallenges]);
  const challengeAwaitingMyDecision = useMemo(() => {
    for (const challenge of myActionableChallenges) {
      const isOwner = challenge.owner?.id === myId;
      if (isOwner && !challenge.owner?.accepted) return challenge;
      const targetId = challenge.target?.id;
      if (targetId && targetId === myId && !challenge.target?.accepted) return challenge;
      // Check if I'm an ally who hasn't accepted
      const myAlly = (challenge.allies || []).find(a => a?.id === myId);
      if (myAlly && !myAlly.accepted) return challenge;
      // For open challenges that need me as target
      if (!targetId && targetId !== myId) continue;
      const targetAccepted = challenge.target?.accepted ?? false;
      if (!targetAccepted && targetId === myId) return challenge;
    }
    return null;
  }, [myActionableChallenges, myId]);
  const primaryChallenge = challengeAwaitingMyDecision || activeChallenge;
  const selectedTeam = useMemo(() => {
    const list = teamsState.teams || [];
    if (!list.length) return null as (typeof teamsState.teams[number]) | null;
    if (selectedTeamId) {
      const exact = list.find(team => team.id === selectedTeamId);
      if (exact) return exact;
    }
    if (teamsState.activeId) {
      const active = list.find(team => team.id === teamsState.activeId);
      if (active) return active;
    }
    return list[0] ?? null;
  }, [teamsState, selectedTeamId]);
  const hasValidTeam = !!selectedTeam && Array.isArray((selectedTeam as any).members) && (selectedTeam as any).members.length > 0;

  useEffect(() => {
    if (!challengeTargetId) return;
    if (!eligibleOpponents.some(p => p.id === challengeTargetId)) {
      setChallengeTargetId('');
    }
  }, [challengeTargetId, eligibleOpponents]);

  function applyServerUrl(nextUrl?: string) {
    const draft = typeof nextUrl === 'string' ? nextUrl : serverUrlDraft;
    if (!draft.trim()) return;
    const applied = client.setServerEndpoint(draft);
    const changed = applied !== serverUrl;
    setServerUrl(applied);
    setServerUrlDraft(applied);
    setLastError('');
    if (changed) {
      setRooms([]);
      setActiveRoomId(DEFAULT_ROOM);
      setActiveRole({ [DEFAULT_ROOM]: 'player' });
      setChatMessages([]);
      activeRoomRef.current = DEFAULT_ROOM;
      setChallengeBusy(false);
      setMessageText('');
      setChallengesByRoom({});
      setChallengeTargetId('');
      setChallengeNotice('');
    }
  }

  function handleApplyServerUrl() {
    applyServerUrl();
  }

  function handleResetServerUrl() {
    applyServerUrl(defaultServerUrl);
  }

  function handleCreateRoom() {
    const name = newRoomName.trim();
    if (!name) return;
    let unsubscribe: (() => void) | null = null;
    const handler = (room: RoomSummary) => {
      if (room.name === name) {
        handleJoin(room.id, 'player');
        setActiveRoomId(room.id);
        if (unsubscribe) unsubscribe();
      }
    };
    unsubscribe = client.on('roomCreated', handler);
    client.createRoom(name, { roomType: newRoomType });
    window.setTimeout(() => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }, 5000);
    setNewRoomName('');
  }

  function handleJoin(roomId: string, role: RoomRole) {
    const currentRole = activeRole[roomId];
    if (currentRole === role) {
      setActiveRoomId(roomId);
      return;
    }
    if (currentRole && currentRole !== role) {
      client.leaveRoom(roomId);
    }
    client.joinRoom(roomId, role);
    setActiveRoomId(roomId);
    setActiveRole(prev => ({ ...prev, [roomId]: role }));
    setChatMessages([...client.getChat(roomId)]);
  }

  function handleLeave(roomId: string) {
    client.leaveRoom(roomId);
    if (activeRoomId === roomId) setActiveRoomId(DEFAULT_ROOM);
    setActiveRole(prev => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
    setChallengesByRoom(prev => {
      if (!(roomId in prev)) return prev;
      const next = { ...prev } as Record<string, ChallengeSummary[]>;
      delete next[roomId];
      return next;
    });
    if (challengeTargetId && activeRoomId === roomId) {
      setChallengeTargetId('');
    }
  }

  function handleSendMessage() {
    const text = messageText.trim();
    if (!text || !activeRoomId) return;
    client.sendChat(activeRoomId, text);
    setChatMessages([...client.getChat(activeRoomId)]);
    setMessageText('');
  }

  function getSelectedTeamMembers(): BattlePokemon[] | null {
    if (!selectedTeam || !Array.isArray((selectedTeam as any).members) || !(selectedTeam as any).members.length) {
      setLastError('Select a team with Pokémon before submitting a challenge.');
      return null;
    }
    return (selectedTeam as any).members as BattlePokemon[];
  }

  async function buildChallengePlayerPayload(): Promise<PlayerPayload | null> {
    if (!myId) {
      setLastError('Identify with the server before submitting a challenge.');
      return null;
    }
    const members = getSelectedTeamMembers();
    if (!members) return null;
    setLastError('');
    const trainerSprite = await uploadTrainerSpriteIfNeeded(client.getServerEndpoint(), client.getTrainerSprite());
    return buildPlayerPayload(username, myId, members, trainerSprite);
  }

  function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
  }

  function buildStartSidePayload(side: StartSideSetup) {
    const hazards: Record<string, any> = {};
    const sideConditions: Record<string, any> = {};

    if (side.stealthRock) hazards.stealthRock = true;
    if (side.stickyWeb) hazards.stickyWeb = true;
    const spikesLayers = clampInt(side.spikesLayers, 0, 3);
    if (spikesLayers > 0) hazards.spikesLayers = spikesLayers;
    const toxicSpikesLayers = clampInt(side.toxicSpikesLayers, 0, 2);
    if (toxicSpikesLayers > 0) hazards.toxicSpikesLayers = toxicSpikesLayers;

    const reflectTurns = clampInt(side.reflectTurns, 0, 99);
    if (reflectTurns > 0) sideConditions.reflectTurns = reflectTurns;
    const lightScreenTurns = clampInt(side.lightScreenTurns, 0, 99);
    if (lightScreenTurns > 0) sideConditions.lightScreenTurns = lightScreenTurns;
    const tailwindTurns = clampInt(side.tailwindTurns, 0, 99);
    if (tailwindTurns > 0) sideConditions.tailwindTurns = tailwindTurns;

    if (!Object.keys(hazards).length && !Object.keys(sideConditions).length) return undefined;
    return {
      ...(Object.keys(hazards).length ? { sideHazards: hazards } : {}),
      ...(Object.keys(sideConditions).length ? { sideConditions } : {}),
    };
  }

  function summarizeStartSide(side: StartSideSetup): string {
    const pieces: string[] = [];
    if (side.stealthRock) pieces.push('Stealth Rock');
    if (side.spikesLayers > 0) pieces.push(`Spikes x${clampInt(side.spikesLayers, 0, 3)}`);
    if (side.toxicSpikesLayers > 0) pieces.push(`Toxic Spikes x${clampInt(side.toxicSpikesLayers, 0, 2)}`);
    if (side.stickyWeb) pieces.push('Sticky Web');
    if (side.reflectTurns > 0) pieces.push(`Reflect ${clampInt(side.reflectTurns, 0, 99)}t`);
    if (side.lightScreenTurns > 0) pieces.push(`Light Screen ${clampInt(side.lightScreenTurns, 0, 99)}t`);
    if (side.tailwindTurns > 0) pieces.push(`Tailwind ${clampInt(side.tailwindTurns, 0, 99)}t`);
    return pieces.join(', ');
  }

  async function handleCreateChallenge() {
    if (!currentRoom) return;
    if (!iAmPlayer) {
      setLastError('Join the room as a player before creating a challenge.');
      return;
    }
    if (hasPendingChallengeForSelection) {
      setLastError('You already have a pending challenge for that opponent.');
      return;
    }
    const payload = await buildChallengePlayerPayload();
    if (!payload) return;
    setChallengeBusy(true);

    // Resolve the selected battle mode
    const modeConfig = BATTLE_MODE_OPTIONS.find(m => m.value === battleMode) || BATTLE_MODE_OPTIONS[0];
    const formatLabel = modeConfig.label;
    const challengeFormat = modeConfig.format;
    const playerCountFormat = modeConfig.playerFormat;
    
    // Build rules string from selected clauses + custom rules (for display)
    const clauseLabels = CLAUSE_OPTIONS
      .filter(clause => selectedClauses.has(clause.id))
      .map(clause => clause.label);
    const rulesComponents: string[] = [];
    if (teamPreviewEnabled) rulesComponents.push('Team Preview');
    rulesComponents.push(formatLabel);
    if (activeCount !== 1) rulesComponents.push(`Active: ${activeCount}`);
    if (clauseLabels.length) rulesComponents.push(`Clauses: ${clauseLabels.join(', ')}`);
    const isBossFormat = playerCountFormat === '2v1' || playerCountFormat === '3v1' || playerCountFormat === '5v1';
    if (isBossFormat && trueBoss) rulesComponents.push('True Boss Fight');
    if (teamSize !== 6) rulesComponents.push(`Team Size: ${teamSize}`);
    if (startWeather !== 'none') rulesComponents.push(`Start Weather: ${startWeather} (${clampInt(startWeatherTurns, 1, 99)}t)`);
    if (startTerrain !== 'none') rulesComponents.push(`Start Terrain: ${startTerrain} (${clampInt(startTerrainTurns, 1, 99)}t)`);
    const side1Summary = summarizeStartSide(startSide1);
    const side2Summary = summarizeStartSide(startSide2);
    if (side1Summary) rulesComponents.push(`Start Side 1: ${side1Summary}`);
    if (side2Summary) rulesComponents.push(`Start Side 2: ${side2Summary}`);
    if (challengeRules.trim()) rulesComponents.push(challengeRules.trim());
    const fullRulesDisplay = rulesComponents.join(' | ');

    const startConditionsField: Record<string, any> = {};
    if (startWeather !== 'none') {
      startConditionsField.weather = { id: startWeather, turnsLeft: clampInt(startWeatherTurns, 1, 99) };
    }
    if (startTerrain !== 'none') {
      startConditionsField.terrain = { id: startTerrain, turnsLeft: clampInt(startTerrainTurns, 1, 99) };
    }
    const side1Payload = buildStartSidePayload(startSide1);
    const side2Payload = buildStartSidePayload(startSide2);
    const startConditionsPayload =
      Object.keys(startConditionsField).length || side1Payload || side2Payload
        ? {
            ...(Object.keys(startConditionsField).length ? { field: startConditionsField } : {}),
            ...(side1Payload ? { side1: side1Payload } : {}),
            ...(side2Payload ? { side2: side2Payload } : {}),
          }
        : undefined;

    // Build rules object for the backend
    const rulesObject: Record<string, any> = {
      teamPreview: teamPreviewEnabled,
      activeCount: activeCount,
      teamSize: teamSize,
      playerFormat: playerCountFormat,
      format: challengeFormat,
      battleMode: battleMode,
      trueBoss: isBossFormat && trueBoss ? true : undefined,
      clauses: Array.from(selectedClauses),
      customRules: challengeRules.trim() || undefined,
      displayString: fullRulesDisplay || undefined,
      startConditions: startConditionsPayload,
      expectedPlayers: modeConfig.players,
    };

    try {
      client.createChallenge({
        roomId: currentRoom.id,
        player: payload,
        format: formatLabel,
        rules: rulesObject,
        toPlayerId: challengeTargetId || undefined,
      });
      setChallengeNotice('Challenge created.');
    } finally {
      setChallengeBusy(false);
    }
  }

  function handleCancelChallenge(challengeId: string) {
    if (!currentRoom) return;
    client.cancelChallenge({ roomId: currentRoom.id, challengeId });
    setChallengeNotice('Challenge cancelled.');
  }

  function handleDeclineChallenge(challengeId: string) {
    if (!currentRoom) return;
    if (!iAmPlayer) {
      setLastError('Join the room as a player before responding to challenges.');
      return;
    }
    client.respondChallenge({ roomId: currentRoom.id, challengeId, accepted: false });
    setChallengeNotice('Challenge declined.');
  }

  async function handleSubmitChallengeLoadout(challenge: ChallengeSummary, notice: string) {
    if (!currentRoom) return;
    if (!iAmPlayer) {
      setLastError('Join the room as a player before submitting a team.');
      return;
    }
    const payload = await buildChallengePlayerPayload();
    if (!payload) return;
    setChallengeBusy(true);
    try {
      client.respondChallenge({ roomId: currentRoom.id, challengeId: challenge.id, accepted: true, player: payload });
      setChallengeNotice(notice);
    } finally {
      setChallengeBusy(false);
    }
  }

  function handleAcceptChallenge(challenge: ChallengeSummary) {
    void handleSubmitChallengeLoadout(challenge, 'Challenge accepted.');
  }

  function handleUpdateChallengeLoadout(challenge: ChallengeSummary) {
    void handleSubmitChallengeLoadout(challenge, 'Loadout updated.');
  }

  function handleStartBattle() {
    if (!primaryChallenge) {
      setLastError('Create or accept a challenge before submitting a team.');
      return;
    }
    handleUpdateChallengeLoadout(primaryChallenge);
  }

  function roomStatus(room: RoomSummary): string {
    const players = Array.isArray(room.players)
      ? Array.from(new Map(room.players.map(p => [p.id, p])).values())
      : [];
    const playerNames = players.length
      ? players.map(p => p.username || (p as any).name || 'Player').join(', ')
      : '—';
    const spectators = room.spectCount ?? 0;
    const challengeCount = room.challengeCount ?? (challengesByRoom[room.id]?.length ?? 0);
    const challengeText = challengeCount > 0 ? ` • ${challengeCount} challenge${challengeCount === 1 ? '' : 's'}` : '';
    const spectatorLabel = ` ${spectators} spectator${spectators === 1 ? '' : 's'}`;
    return `${playerNames} • ${room.battleStarted ? 'Battle active' : 'Waiting'} •${spectatorLabel}${challengeText}`;
  }

  return (
    <section className="panel battle" style={{ borderRadius: 12, padding: isMobile ? 10 : 14 }}>
      <h2>Lobby</h2>
      {challengeNotice && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'rgba(0, 128, 128, 0.1)' }}>
          {challengeNotice}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center', padding: isMobile ? 8 : 10, border: '1px solid #3a3a3a', borderRadius: 10, background: 'rgba(255,255,255,0.02)' }}>
        <div className="dim">Status:</div>
        <span>{status}</span>
        {lastError && <span className="dim" style={{ color: '#f66' }}>• {lastError}</span>}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flex: isMobile ? '1 1 100%' : undefined }}>
          <span className="dim">Server URL</span>
          <input
            value={serverUrlDraft}
            onChange={e => setServerUrlDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleApplyServerUrl(); }}
            style={{ width: isMobile ? '100%' : 220 }}
            placeholder={defaultServerUrl}
            title={`Current: ${serverUrl}`}
          />
        </label>
        <button className="mini" onClick={handleApplyServerUrl} disabled={!serverUrlDraft.trim()}>Apply</button>
        <button className="mini secondary" onClick={handleResetServerUrl} disabled={serverUrl === defaultServerUrl}>Default</button>
        <label style={{ marginLeft: isMobile ? 0 : 'auto', display: 'inline-flex', gap: 8, alignItems: 'center', flex: isMobile ? '1 1 100%' : undefined }}>
          <span className="dim">Username</span>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ width: isMobile ? '100%' : 180 }}
            placeholder="Trainer name"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(260px, 320px) 1fr 300px', gap: 12 }}>
        <aside className="panel" style={{ padding: 12, display: 'grid', gap: 12, borderRadius: 10 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Rooms</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {rooms.length === 0 && <div className="dim">Fetching rooms…</div>}
              {rooms.map(room => {
                const role = activeRole[room.id];
                const isActive = activeRoomId === room.id;
                const challengeCount = room.challengeCount ?? (challengesByRoom[room.id]?.length ?? 0);
                return (
                  <div key={room.id} style={{ border: '1px solid #444', borderRadius: 6, padding: 8, background: isActive ? 'rgba(0,128,128,0.15)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{room.name}</strong>
                      <span className="dim" style={{ fontSize: '0.85em' }}>({room.id})</span>
                      {room.roomType === 'map' && (
                        <span className="chip" style={{ fontSize: '0.7em' }}>Map</span>
                      )}
                      {challengeCount > 0 && (
                        <span className="chip" style={{ marginLeft: 'auto' }}>{challengeCount} challenge{challengeCount === 1 ? '' : 's'}</span>
                      )}
                    </div>
                    <div className="dim" style={{ fontSize: '0.9em', margin: '4px 0 8px 0' }}>{roomStatus(room)}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className={role === 'player' ? 'secondary' : ''}
                        onClick={() => handleJoin(room.id, 'player')}
                        disabled={role === 'player'}
                      >
                        {role === 'player' ? 'Rejoin' : 'Join as Player'}
                      </button>
                      <button
                        className={role === 'spectator' ? 'secondary' : ''}
                        onClick={() => handleJoin(room.id, 'spectator')}
                        disabled={role === 'spectator'}
                      >
                        Spectate
                      </button>
                      <button className="mini" onClick={() => handleLeave(room.id)} disabled={!role}>Leave</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>Create Room</h4>
            <div style={{ display: 'grid', gap: 6 }}>
              <input
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                placeholder="Room name"
              />
              <select value={newRoomType} onChange={e => setNewRoomType(e.target.value as 'battle' | 'map')}>
                <option value="battle">Battle Room</option>
                <option value="map">Battle Map Room</option>
              </select>
              <button onClick={handleCreateRoom}>Create</button>
            </div>
          </div>
        </aside>

        <section className="panel" style={{ padding: 12, display: 'grid', gridTemplateRows: currentRoom?.roomType === 'map' ? 'auto 1fr auto auto' : 'auto 1fr auto', gap: 12, borderRadius: 10 }}>
          <header>
            <h3 style={{ margin: '0 0 6px 0' }}>{currentRoom?.name || 'Room'}</h3>
            <div className="dim" style={{ fontSize: '0.9em' }}>{currentRoom ? roomStatus(currentRoom) : 'Select a room to view details.'}</div>
          </header>

          <div ref={chatRef} style={{ overflowY: 'auto', border: '1px solid #444', borderRadius: 6, padding: 10, background: 'var(--section-bg)' }}>
            {chatMessages.length === 0 && <div className="dim">No messages yet. Say hi!</div>}
            {chatMessages.map((msg, idx) => (
              <div key={`${msg.time}-${idx}`} style={{ marginBottom: 4 }}>
                <strong>{msg.user}:</strong> {msg.text}
                <span className="dim" style={{ marginLeft: 6, fontSize: '0.8em' }}>{new Date(msg.time).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>

          {currentRoom?.roomType === 'map' && (
            <div style={{ border: '1px solid #444', borderRadius: 6, padding: 10, background: 'var(--section-bg)' }}>
              <MapRoomPanel
                roomId={currentRoom.id}
                client={client}
                isOwner={Boolean(currentRoom.mapOwnerId && currentRoom.mapOwnerId === client.user?.id)}
                players={currentRoom.players}
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(); }}
              placeholder="Type a message…"
            />
            <button onClick={handleSendMessage}>Send</button>
          </div>
        </section>

        <aside className="panel" style={{ padding: 12, display: 'grid', gap: 12, borderRadius: 10 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Players</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {currentRoom?.players?.length ? (
                uniquePlayers.map(player => {
                  const displayName = player.username || (player as any).name || 'Player';
                  const challengedByMe = player.id ? challengedOpponentIds.has(player.id) : false;
                  const challengingMe = player.id ? playersChallengingMeIds.has(player.id) : false;
                  return (
                    <li key={player.id}>
                      {displayName}
                      {challengedByMe && (
                        <span style={{ marginLeft: 6, fontSize: '0.75em', padding: '1px 6px', borderRadius: 12, border: '1px solid rgba(0,128,128,0.6)', background: 'rgba(0,128,128,0.12)', textTransform: 'uppercase' }}>
                          challenged
                        </span>
                      )}
                      {challengingMe && (
                        <span style={{ marginLeft: 6, fontSize: '0.75em', padding: '1px 6px', borderRadius: 12, border: '1px solid rgba(192,128,0,0.6)', background: 'rgba(192,128,0,0.15)', textTransform: 'uppercase' }}>
                          incoming
                        </span>
                      )}
                    </li>
                  );
                })
              ) : (
                <li className="dim">No players yet</li>
              )}
            </ul>
          </div>

          <div style={{ borderTop: '1px solid #333', paddingTop: 12, display: 'grid', gap: 8 }}>
            <h4 style={{ margin: '0 0 4px 0' }}>Challenges</h4>
            {primaryChallenge ? (
              <div className="dim" style={{ fontSize: '0.85em' }}>
                Active: {formatName(primaryChallenge.owner)} vs {formatName(primaryChallenge.target, 'Anyone')} • {describeChallengeStatus(primaryChallenge.status)}
              </div>
            ) : (
              <div className="dim" style={{ fontSize: '0.85em' }}>No active challenge yet.</div>
            )}

            {/* Format Selection */}
            <label className="dim" style={{ display: 'grid', gap: 6 }}>
              Battle Mode
              <select
                value={battleMode}
                onChange={e => setBattleMode(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }}
              >
                {BATTLE_MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label} — {opt.desc}</option>
                ))}
              </select>
              <span style={{ fontSize: '0.75em', color: '#888' }}>
                {BATTLE_MODE_OPTIONS.find(opt => opt.value === battleMode)?.desc}
                {' '}({(BATTLE_MODE_OPTIONS.find(opt => opt.value === battleMode)?.players || 2)} players needed)
              </span>
            </label>

            {/* Boss True Boss toggle */}
            {(() => { const m = BATTLE_MODE_OPTIONS.find(opt => opt.value === battleMode); return m && (m.playerFormat === '2v1' || m.playerFormat === '3v1' || m.playerFormat === '5v1'); })() && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em' }}>
                <input type="checkbox" checked={trueBoss} onChange={e => setTrueBoss(e.target.checked)} />
                True Boss Fight
                <span className="dim" style={{ fontSize: '0.8em' }}>(Boss only sends out 1 Pokémon — each challenger sends 1)</span>
              </label>
            )}

            {/* Advanced Options Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              style={{ 
                background: 'transparent', 
                border: '1px solid #555', 
                padding: '4px 8px', 
                borderRadius: 4, 
                cursor: 'pointer',
                fontSize: '0.85em',
                color: '#aaa'
              }}
            >
              {showAdvancedOptions ? '▼' : '▶'} Advanced Options
            </button>

            {showAdvancedOptions && (
              <div style={{ display: 'grid', gap: 10, padding: 8, border: '1px solid #444', borderRadius: 6, background: 'rgba(50,50,50,0.5)' }}>
                {/* Team Preview Toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={teamPreviewEnabled}
                    onChange={e => setTeamPreviewEnabled(e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <span className="dim">Team Preview</span>
                  <span style={{ fontSize: '0.75em', color: '#888' }}>Choose lead order before battle</span>
                </label>

                {/* Team Size */}
                <label className="dim" style={{ display: 'grid', gap: 6 }}>
                  Team Size (Pokémon per team)
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={teamSize}
                      onChange={e => setTeamSize(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={teamSize}
                      onChange={e => setTeamSize(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                      style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee', textAlign: 'center' }}
                    />
                  </div>
                </label>

                {/* Active Pokemon Count - auto-set by battle mode, shown as read-only info */}
                <label className="dim" style={{ display: 'grid', gap: 6 }}>
                  Active Pokémon (per side): <strong>{activeCount}</strong>
                  <small style={{ color: '#888' }}>Automatically set by Battle Mode above</small>
                </label>

                <div className="dim" style={{ display: 'grid', gap: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
                  <span>Start Field Effects</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Weather
                      <select
                        value={startWeather}
                        onChange={e => setStartWeather(e.target.value)}
                        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }}
                      >
                        {START_WEATHER_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Turns
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={startWeatherTurns}
                        onChange={e => setStartWeatherTurns(clampInt(Number(e.target.value) || 1, 1, 99))}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Terrain
                      <select
                        value={startTerrain}
                        onChange={e => setStartTerrain(e.target.value)}
                        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }}
                      >
                        {START_TERRAIN_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Turns
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={startTerrainTurns}
                        onChange={e => setStartTerrainTurns(clampInt(Number(e.target.value) || 1, 1, 99))}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }}
                      />
                    </label>
                  </div>
                </div>

                <div className="dim" style={{ display: 'grid', gap: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
                  <span>Start Side Hazards / Screens</span>
                  <div style={{ display: 'grid', gap: 8, border: '1px solid #444', borderRadius: 6, padding: 8 }}>
                    <strong style={{ fontSize: '0.85em' }}>Side 1 (challenge creator)</strong>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={startSide1.stealthRock} onChange={e => setStartSide1(prev => ({ ...prev, stealthRock: e.target.checked }))} />
                      Stealth Rock
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Spikes layers
                      <input type="number" min={0} max={3} value={startSide1.spikesLayers} onChange={e => setStartSide1(prev => ({ ...prev, spikesLayers: clampInt(Number(e.target.value) || 0, 0, 3) }))} style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Toxic Spikes layers
                      <input type="number" min={0} max={2} value={startSide1.toxicSpikesLayers} onChange={e => setStartSide1(prev => ({ ...prev, toxicSpikesLayers: clampInt(Number(e.target.value) || 0, 0, 2) }))} style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={startSide1.stickyWeb} onChange={e => setStartSide1(prev => ({ ...prev, stickyWeb: e.target.checked }))} />
                      Sticky Web
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Reflect turns
                      <input type="number" min={0} max={99} value={startSide1.reflectTurns} onChange={e => setStartSide1(prev => ({ ...prev, reflectTurns: clampInt(Number(e.target.value) || 0, 0, 99) }))} style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Light Screen turns
                      <input type="number" min={0} max={99} value={startSide1.lightScreenTurns} onChange={e => setStartSide1(prev => ({ ...prev, lightScreenTurns: clampInt(Number(e.target.value) || 0, 0, 99) }))} style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Tailwind turns
                      <input type="number" min={0} max={99} value={startSide1.tailwindTurns} onChange={e => setStartSide1(prev => ({ ...prev, tailwindTurns: clampInt(Number(e.target.value) || 0, 0, 99) }))} style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gap: 8, border: '1px solid #444', borderRadius: 6, padding: 8 }}>
                    <strong style={{ fontSize: '0.85em' }}>Side 2 (opponent)</strong>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={startSide2.stealthRock} onChange={e => setStartSide2(prev => ({ ...prev, stealthRock: e.target.checked }))} />
                      Stealth Rock
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Spikes layers
                      <input type="number" min={0} max={3} value={startSide2.spikesLayers} onChange={e => setStartSide2(prev => ({ ...prev, spikesLayers: clampInt(Number(e.target.value) || 0, 0, 3) }))} style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Toxic Spikes layers
                      <input type="number" min={0} max={2} value={startSide2.toxicSpikesLayers} onChange={e => setStartSide2(prev => ({ ...prev, toxicSpikesLayers: clampInt(Number(e.target.value) || 0, 0, 2) }))} style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={startSide2.stickyWeb} onChange={e => setStartSide2(prev => ({ ...prev, stickyWeb: e.target.checked }))} />
                      Sticky Web
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Reflect turns
                      <input type="number" min={0} max={99} value={startSide2.reflectTurns} onChange={e => setStartSide2(prev => ({ ...prev, reflectTurns: clampInt(Number(e.target.value) || 0, 0, 99) }))} style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Light Screen turns
                      <input type="number" min={0} max={99} value={startSide2.lightScreenTurns} onChange={e => setStartSide2(prev => ({ ...prev, lightScreenTurns: clampInt(Number(e.target.value) || 0, 0, 99) }))} style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      Tailwind turns
                      <input type="number" min={0} max={99} value={startSide2.tailwindTurns} onChange={e => setStartSide2(prev => ({ ...prev, tailwindTurns: clampInt(Number(e.target.value) || 0, 0, 99) }))} style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }} />
                    </label>
                  </div>
                </div>

                {/* Clauses Multi-Select */}
                <div className="dim" style={{ display: 'grid', gap: 6 }}>
                  <span>Battle Clauses (all off by default)</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {CLAUSE_OPTIONS.map(clause => {
                      const isActive = selectedClauses.has(clause.id);
                      return (
                        <button
                          key={clause.id}
                          type="button"
                          title={clause.desc}
                          onClick={() => {
                            const next = new Set(selectedClauses);
                            if (isActive) next.delete(clause.id);
                            else next.add(clause.id);
                            setSelectedClauses(next);
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 12,
                            border: isActive ? '1px solid #0a8' : '1px solid #555',
                            background: isActive ? 'rgba(0,170,136,0.25)' : 'rgba(50,50,50,0.6)',
                            color: isActive ? '#0fa' : '#aaa',
                            cursor: 'pointer',
                            fontSize: '0.8em',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {isActive ? '✓ ' : ''}{clause.label}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '0.7em', color: '#666' }}>
                    Click to toggle clauses
                  </span>
                </div>

                {/* Custom Rules Text */}
                <label className="dim" style={{ display: 'grid', gap: 6 }}>
                  Additional Notes
                  <textarea
                    value={challengeRules}
                    onChange={e => setChallengeRules(e.target.value)}
                    rows={2}
                    placeholder="Any extra rules or notes for the battle..."
                    style={{ resize: 'vertical', minHeight: 40, padding: '6px 8px', borderRadius: 6, border: '1px solid #555', background: '#2a2a2a', color: '#eee' }}
                  />
                </label>
              </div>
            )}

            {/* Opponent Selection */}
            <label className="dim" style={{ display: 'grid', gap: 6 }}>
              Opponent
              <select value={challengeTargetId} onChange={e => setChallengeTargetId(e.target.value)}>
                <option value="">Open challenge (any opponent)</option>
                {eligibleOpponents.map(player => (
                  <option key={player.id} value={player.id}>
                    {formatName(player)}{challengedOpponentIds.has(player.id) ? ' (pending)' : ''}{playersChallengingMeIds.has(player.id) ? ' (incoming)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {!hasValidTeam && (
              <div className="dim" style={{ fontSize: '0.8em' }}>Save a team with Pokémon to create a challenge.</div>
            )}
            {hasPendingChallengeForSelection && (
              <div className="dim" style={{ fontSize: '0.8em', color: '#f88' }}>You already have a pending challenge targeting that selection.</div>
            )}
            <button
              onClick={handleCreateChallenge}
              disabled={challengeBusy || !iAmPlayer || !currentRoom || !hasValidTeam || hasPendingChallengeForSelection}
            >
              Create Challenge
            </button>
            <div style={{ border: '1px solid #444', borderRadius: 6, padding: 8, display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {sortedRoomChallenges.length === 0 && <div className="dim">No challenges in this room.</div>}
              {sortedRoomChallenges.map(challenge => {
                const isOwner = challenge.owner?.id === myId;
                const targetId = challenge.target?.id;
                const isTarget = targetId === myId;
                const isAlly = (challenge.allies || []).some(a => a?.id === myId);
                const isMine = isOwner || isTarget || isAlly;
                const actionable = isChallengeActionable(challenge.status);
                const awaitingMyResponse = challengeAwaitingMyDecision?.id === challenge.id;
                const ownerReady = !!challenge.owner?.accepted;
                const targetReady = !!challenge.target?.accepted;
                const requiredAllies = challenge.requiredAllies || 0;
                const currentAllies = challenge.allies?.length || 0;
                const needsMoreAllies = currentAllies < requiredAllies;
                // Can accept if: not already in the challenge, and either target slot is open OR ally slots are available
                const canAccept = actionable && !isOwner && !isAlly && ((!targetId || targetId === myId) || needsMoreAllies) && iAmPlayer && hasValidTeam;
                const canDecline = actionable && (isTarget || isAlly) && iAmPlayer;
                const canCancel = actionable && isOwner;
                const canUpdate = actionable && isMine && iAmPlayer && hasValidTeam;
                const challengerNames = [formatName(challenge.owner), ...(challenge.allies || []).map(a => formatName(a))].join(' & ');
                const label = requiredAllies > 0
                  ? `${challengerNames} vs ${formatName(challenge.target, 'Anyone')}`
                  : `${formatName(challenge.owner)} vs ${formatName(challenge.target, 'Anyone')}`;
                const statusLabel = describeChallengeStatus(challenge.status);
                const ownerLabel = `${formatName(challenge.owner)} ${ownerReady ? '(ready)' : '(waiting)'}`;
                const targetLabel = challenge.target
                  ? `${formatName(challenge.target)} ${targetReady ? '(ready)' : '(waiting)'}`
                  : 'Awaiting opponent';
                const allyLabels = (challenge.allies || []).map(a =>
                  `${formatName(a)} ${a.accepted ? '(ready)' : '(waiting)'}`
                );
                const slotsLabel = requiredAllies > 0
                  ? ` • Allies: ${currentAllies}/${requiredAllies}`
                  : '';
                return (
                  <div
                    key={challenge.id}
                    style={{
                      border: '1px solid #555',
                      borderRadius: 6,
                      padding: 8,
                      background: primaryChallenge?.id === challenge.id ? 'rgba(0,128,192,0.12)' : 'rgba(0,0,0,0.1)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <strong>{label}</strong>
                      <span className="dim" style={{ fontSize: '0.8em' }}>• {statusLabel}{slotsLabel}</span>
                      {awaitingMyResponse && <span style={{ marginLeft: 'auto', fontSize: '0.75em', textTransform: 'uppercase' }}>Your response needed</span>}
                    </div>
                    <div className="dim" style={{ fontSize: '0.85em', marginBottom: 6 }}>
                      {ownerLabel} • {targetLabel}
                      {allyLabels.length > 0 && allyLabels.map((al, i) => <span key={i}> • {al}</span>)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {canAccept && (
                        <button className="mini" onClick={() => handleAcceptChallenge(challenge)} disabled={challengeBusy}>
                          Accept
                        </button>
                      )}
                      {canDecline && (
                        <button className="mini secondary" onClick={() => handleDeclineChallenge(challenge.id)} disabled={challengeBusy}>
                          Decline
                        </button>
                      )}
                      {canCancel && (
                        <button className="mini secondary" onClick={() => handleCancelChallenge(challenge.id)} disabled={challengeBusy}>
                          Cancel
                        </button>
                      )}
                      {canUpdate && (
                        <button className="mini" onClick={() => handleUpdateChallengeLoadout(challenge)} disabled={challengeBusy}>
                          Update Team
                        </button>
                      )}
                      {!canAccept && !canDecline && !canCancel && !canUpdate && (
                        <span className="dim" style={{ fontSize: '0.8em' }}>No actions available.</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>Battle Setup</h4>
            <div className="dim" style={{ fontSize: '0.85em', marginBottom: 8 }}>
              Select a team and submit it to your active challenge. All players must send their payload before the battle begins.
            </div>
            {!primaryChallenge && (
              <div className="dim" style={{ fontSize: '0.8em', marginBottom: 8 }}>
                Create or accept a challenge to enable team submission.
              </div>
            )}
            <label className="dim" style={{ display: 'grid', gap: 6 }}>
              Team
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} style={{ flex: 1 }}>
                  {teamsState.teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.members.length} Pokémon)
                    </option>
                  ))}
                  {teamsState.teams.length === 0 && <option value="">No teams saved</option>}
                </select>
                <button
                  type="button"
                  className="mini"
                  onClick={() => teamsState.forceRefresh()}
                  title="Refresh teams from storage"
                  style={{ padding: '4px 8px' }}
                >
                  🔄
                </button>
              </div>
            </label>
            <button
              onClick={handleStartBattle}
              disabled={!iAmPlayer || challengeBusy || !currentRoom || !primaryChallenge || !hasValidTeam || !isChallengeActionable(primaryChallenge.status)}
            >
              Submit Team
            </button>
          </div>
        </aside>
      </div>
      <div style={{ marginTop: 12 }}>
        <CustomsImportExport />
      </div>
    </section>
  );
}
