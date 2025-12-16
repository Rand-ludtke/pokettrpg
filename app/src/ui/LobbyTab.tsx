import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadTeams, normalizeName } from '../data/adapter';
import { BattlePokemon } from '../types';
import { ChatMessage, ChallengeParticipant, ChallengeSummary, ClientStatus, getClient, PlayerPayload, RoomSummary } from '../net/pokettrpgClient';
import { CustomsImportExport } from './CustomsImportExport';

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
  useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  return useMemo(() => loadTeams(), [version]);
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

const DEFAULT_ROOM = 'global-lobby';

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
  const [messageText, setMessageText] = useState('');
  const [lastError, setLastError] = useState<string>('');
  const [activeRole, setActiveRole] = useState<Record<string, RoomRole>>({ [DEFAULT_ROOM]: 'player' });
  const [challengeBusy, setChallengeBusy] = useState<boolean>(false);
  const [challengesByRoom, setChallengesByRoom] = useState<Record<string, ChallengeSummary[]>>({});
  const [challengeNotice, setChallengeNotice] = useState<string>('');
  const [challengeFormat, setChallengeFormat] = useState<string>('Singles');
  const [challengeRules, setChallengeRules] = useState<string>('');
  const [challengeTargetId, setChallengeTargetId] = useState<string>('');
  const teamsState = useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string>(() => teamsState.activeId || teamsState.teams[0]?.id || '');
  const chatRef = useRef<HTMLDivElement>(null);
  const activeRoomRef = useRef(activeRoomId);

  useEffect(() => {
    const current = client.getServerEndpoint();
    setServerUrl(current);
    setServerUrlDraft(current);
  }, [client]);

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
    () => actionableChallenges.filter(ch => ch.owner?.id === myId || ch.target?.id === myId),
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
      if (targetId && targetId !== myId) continue;
      const targetAccepted = challenge.target?.accepted ?? false;
      if (!targetAccepted) return challenge;
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
    client.createRoom(name);
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

  function buildChallengePlayerPayload(): PlayerPayload | null {
    if (!myId) {
      setLastError('Identify with the server before submitting a challenge.');
      return null;
    }
    const members = getSelectedTeamMembers();
    if (!members) return null;
    setLastError('');
    const trainerSprite = client.getTrainerSprite();
    return buildPlayerPayload(username, myId, members, trainerSprite);
  }

  function handleCreateChallenge() {
    if (!currentRoom) return;
    if (!iAmPlayer) {
      setLastError('Join the room as a player before creating a challenge.');
      return;
    }
    if (hasPendingChallengeForSelection) {
      setLastError('You already have a pending challenge for that opponent.');
      return;
    }
    const payload = buildChallengePlayerPayload();
    if (!payload) return;
    setChallengeBusy(true);
    try {
      client.createChallenge({
        roomId: currentRoom.id,
        player: payload,
        format: challengeFormat.trim() || undefined,
        rules: challengeRules.trim() || undefined,
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

  function handleSubmitChallengeLoadout(challenge: ChallengeSummary, notice: string) {
    if (!currentRoom) return;
    if (!iAmPlayer) {
      setLastError('Join the room as a player before submitting a team.');
      return;
    }
    const payload = buildChallengePlayerPayload();
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
    handleSubmitChallengeLoadout(challenge, 'Challenge accepted.');
  }

  function handleUpdateChallengeLoadout(challenge: ChallengeSummary) {
    handleSubmitChallengeLoadout(challenge, 'Loadout updated.');
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
    <section className="panel battle">
      <h2>Lobby</h2>
      {challengeNotice && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'rgba(0, 128, 128, 0.1)' }}>
          {challengeNotice}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <div className="dim">Status:</div>
        <span>{status}</span>
        {lastError && <span className="dim" style={{ color: '#f66' }}>• {lastError}</span>}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span className="dim">Server URL</span>
          <input
            value={serverUrlDraft}
            onChange={e => setServerUrlDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleApplyServerUrl(); }}
            style={{ width: 220 }}
            placeholder={defaultServerUrl}
            title={`Current: ${serverUrl}`}
          />
        </label>
        <button className="mini" onClick={handleApplyServerUrl} disabled={!serverUrlDraft.trim()}>Apply</button>
        <button className="mini secondary" onClick={handleResetServerUrl} disabled={serverUrl === defaultServerUrl}>Default</button>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span className="dim">Username</span>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ width: 180 }}
            placeholder="Trainer name"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr 280px', gap: 12 }}>
        <aside className="panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
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
              <button onClick={handleCreateRoom}>Create</button>
            </div>
          </div>
        </aside>

        <section className="panel" style={{ padding: 12, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 12 }}>
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

        <aside className="panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
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
            <label className="dim" style={{ display: 'grid', gap: 6 }}>
              Format
              <input
                value={challengeFormat}
                onChange={e => setChallengeFormat(e.target.value)}
                placeholder="Singles, Doubles, etc."
              />
            </label>
            <label className="dim" style={{ display: 'grid', gap: 6 }}>
              Rules
              <textarea
                value={challengeRules}
                onChange={e => setChallengeRules(e.target.value)}
                rows={3}
                placeholder="Optional notes or clauses"
                style={{ resize: 'vertical', minHeight: 60 }}
              />
            </label>
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
                const isMine = isOwner || isTarget;
                const actionable = isChallengeActionable(challenge.status);
                const awaitingMyResponse = challengeAwaitingMyDecision?.id === challenge.id;
                const ownerReady = !!challenge.owner?.accepted;
                const targetReady = !!challenge.target?.accepted;
                const canAccept = actionable && !isOwner && (!targetId || targetId === myId) && iAmPlayer && hasValidTeam;
                const canDecline = actionable && isTarget && targetId === myId && iAmPlayer;
                const canCancel = actionable && isOwner;
                const canUpdate = actionable && isMine && iAmPlayer && hasValidTeam;
                const label = `${formatName(challenge.owner)} vs ${formatName(challenge.target, 'Anyone')}`;
                const statusLabel = describeChallengeStatus(challenge.status);
                const ownerLabel = `${formatName(challenge.owner)} ${ownerReady ? '(ready)' : '(waiting)'}`;
                const targetLabel = challenge.target
                  ? `${formatName(challenge.target)} ${targetReady ? '(ready)' : '(waiting)'}`
                  : 'Awaiting opponent';
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
                      <span className="dim" style={{ fontSize: '0.8em' }}>• {statusLabel}</span>
                      {awaitingMyResponse && <span style={{ marginLeft: 'auto', fontSize: '0.75em', textTransform: 'uppercase' }}>Your response needed</span>}
                    </div>
                    <div className="dim" style={{ fontSize: '0.85em', marginBottom: 6 }}>
                      {ownerLabel} • {targetLabel}
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
              Select a team and submit it to your active challenge. Both players must send their payload before the battle begins.
            </div>
            {!primaryChallenge && (
              <div className="dim" style={{ fontSize: '0.8em', marginBottom: 8 }}>
                Create or accept a challenge to enable team submission.
              </div>
            )}
            <label className="dim" style={{ display: 'grid', gap: 6 }}>
              Team
              <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                {teamsState.teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.members.length}/6)
                  </option>
                ))}
                {teamsState.teams.length === 0 && <option value="">No teams saved</option>}
              </select>
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
