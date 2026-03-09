import { io, Socket } from 'socket.io-client';

export type RoomSummary = {
  id: string;
  name: string;
  roomType?: 'battle' | 'map';
  mapOwnerId?: string;
  players: Array<{ id: string; username?: string; name?: string; avatar?: string; trainerSprite?: string }>;
  spectCount: number;
  battleStarted: boolean;
  challengeCount?: number;
};

export type MapToken = {
  id: string;
  name: string;
  x: number;
  y: number;
  size?: number;
  color?: string;
  sprite?: string;
  ownerId?: string;
};

export type MapState = {
  width: number;
  height: number;
  gridSize: number;
  gridColor: string;
  gridOpacity: number;
  showGrid: boolean;
  showLabels: boolean;
  lockTokens: boolean;
  background?: string;
  tokens: MapToken[];
};

export type ChatMessage = {
  roomId: string;
  user: string;
  text: string;
  time: number;
};

export type PhasePayload = { phase: string; deadline?: number };
export type PromptActionPayload = { roomId: string; playerId: string; prompt: any };

export type BattleStatePayload = {
  state?: any;
  result?: any;
  log?: any;
  needsSwitch?: any;
  rooms?: any;
  replay?: any;
  phase?: string;
  deadline?: number;
};

export type SpectateStartPayload = {
  roomId: string;
  state: any;
  replay?: any;
  log?: any;
  phase?: string;
  needsSwitch?: any;
  deadline?: number;
  rooms?: any;
};

export type ClientStatus = 'idle' | 'connecting' | 'connected' | 'identified' | 'error';

export type ChallengeParticipant = {
  id: string;
  username?: string;
  ready?: boolean;
  accepted?: boolean;
};

export type ChallengeStatus = 'open' | 'pending' | 'launching' | 'closed';

export type ChallengeSummary = {
  id: string;
  roomId: string;
  status: ChallengeStatus;
  createdAt?: number;
  updatedAt?: number;
  open?: boolean;
  format?: string;
  rules?: any;
  owner: ChallengeParticipant;
  target?: ChallengeParticipant | null;
  battleRoomId?: string;
  battleRoomName?: string;
  battleSeed?: number;
};

export type ChallengeSyncPayload = {
  roomId: string;
  challenges: ChallengeSummary[];
};

export type ChallengeRemovedReason =
  | 'cancelled'
  | 'declined'
  | 'creator-left'
  | 'launched'
  | 'no-opponent'
  | 'missing-team'
  | 'socket-disconnected'
  | 'expired';

export type PlayerPayload = {
  id: string;
  name: string;
  activeIndex: number;
  team: any[];
  trainerSprite?: string;
  avatar?: string;
};

export type BattleAction =
  | {
    type: 'move';
    actorPlayerId: string;
    pokemonId: string;
    moveId: string;
    moveName?: string;
    targetPlayerId?: string;
    targetPokemonId?: string;
    target?: string;
  }
  | {
    type: 'switch';
    actorPlayerId: string;
    pokemonId: string;
    toIndex: number;
  }
  | {
    type: 'auto';
    actorPlayerId?: string;
  }
  | {
    type: 'team';
    order: number[];
    actorPlayerId?: string;
  }
  | { type: string; [key: string]: any };

export type ClientEvents = {
  status: ClientStatus;
  error: { message: string };
  identified: { id: string; username: string };
  roomCreated: RoomSummary;
  roomsSnapshot: RoomSummary[];
  roomUpdate: RoomSummary;
  roomRemove: string;
  chatMessage: ChatMessage;
  battleStarted: { roomId: string; state: any };
  teamPreviewStarted: { roomId: string };
  battleUpdate: { roomId: string; update: BattleStatePayload };
  phase: { roomId: string; payload: PhasePayload };
  promptAction: PromptActionPayload;
  battleEnd: { roomId: string; payload: any };
  spectateStart: SpectateStartPayload;
  challengeSync: ChallengeSyncPayload;
  challengeCreated: { roomId: string; challenge: ChallengeSummary };
  challengeUpdated: { roomId: string; challenge: ChallengeSummary };
  challengeRemoved: { roomId: string; challengeId: string; reason?: ChallengeRemovedReason };
  trainerSpriteChanged: { trainerSprite: string | null };
  actionCancelled: { playerId: string; roomId: string };
  mapState: { roomId: string; state: MapState };
};

type EventKey = keyof ClientEvents;
type Handler<K extends EventKey> = (payload: ClientEvents[K]) => void;

function sanitizeTrainerSpriteId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const value = typeof raw === 'number' && Number.isFinite(raw)
    ? String(Math.trunc(raw))
    : typeof raw === 'string'
      ? raw
      : '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const noFragment = trimmed.split('#')[0];
  const noQuery = noFragment.split('?')[0];
  const normalizedSeparators = noQuery.replace(/\\/g, '/');
  const segments = normalizedSeparators.split('/').filter(Boolean);
  let candidate = (segments.length ? segments[segments.length - 1] : normalizedSeparators).replace(/\.png$/i, '').trim();
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
  if (candidate === 'pending' || candidate === 'random' || candidate === 'default' || candidate === 'unknown' || candidate === 'none') return '';
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

function normalizePlayerList(players: any, fallback: RoomSummary['players'] = []): RoomSummary['players'] {
  const arr = Array.isArray(players) ? players : [];
  const mapped = arr.map((pl: any) => {
    const avatar = (() => {
      if (typeof pl?.avatar === 'string' && pl.avatar) return pl.avatar;
      if (typeof pl?.avatar === 'number' && Number.isFinite(pl.avatar)) return String(Math.trunc(pl.avatar));
      if (typeof pl?.trainerSprite === 'string' && pl.trainerSprite) return pl.trainerSprite;
      if (typeof pl?.sprite === 'string' && pl.sprite) return pl.sprite;
      if (typeof pl?.sprite?.id === 'string' && pl.sprite.id) return pl.sprite.id;
      return undefined;
    })();
    const trainerSpriteUrl = resolveTrainerSpriteUrl(pl?.trainerSprite ?? avatar);
    const trainerSprite = sanitizeTrainerSpriteId(pl?.trainerSprite);
    const effectiveTrainerSprite = trainerSpriteUrl || trainerSprite || sanitizeTrainerSpriteId(avatar);
    return {
      id: pl?.id ?? pl?.userid ?? pl?.userId ?? pl?.name ?? pl?.username ?? '',
      username: pl?.username ?? pl?.name ?? pl?.id ?? undefined,
      name: pl?.name ?? pl?.username ?? pl?.id ?? undefined,
      avatar,
      trainerSprite: effectiveTrainerSprite || undefined,
    };
  }).filter(p => p.id);
  return mapped.length ? mapped : fallback;
}

function normalizeApiBase(raw: string | null | undefined): string {
  let value = (raw || '').trim();
  if (!value) return DEFAULT_API_BASE;
  if (!/^[a-z]+:\/\//i.test(value)) {
    const looksLocal = /^([\d.]+|localhost)(?::\d+)?(\/.*)?$/i.test(value);
    value = `${looksLocal ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    let pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '';
    const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
    const normalized = `${protocol}//${url.host}${pathname}`;
    return normalized || DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}

function computeSocketConfig(base: string): { endpoint: string; path: string } {
  try {
    const url = new URL(base);
    const endpoint = `${url.protocol}//${url.host}`;
    let pathname = url.pathname.replace(/\/+$/, '');
    const path = `${pathname || ''}/socket.io`.replace(/\/{2,}/g, '/');
    return { endpoint, path: path.startsWith('/') ? path : `/${path}` };
  } catch {
    return { endpoint: DEFAULT_API_BASE, path: '/socket.io' };
  }
}

class Emitter {
  private handlers = new Map<EventKey, Set<Handler<any>>>();

  on<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler<any>);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(event: K, handler: Handler<K>) {
    this.handlers.get(event)?.delete(handler as Handler<any>);
  }

  emit<K extends EventKey>(event: K, payload: ClientEvents[K]) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try { handler(payload); } catch (err) { console.error('PoketTRPGClient handler error', err); }
    }
  }
}

const DEFAULT_API_BASE = 'https://pokettrpg.duckdns.org';
const LOBBY_ROOM_ID = 'global-lobby';

export class PoketTRPGClient {
  private socket: Socket | null = null;
  private emitter = new Emitter();
  private status: ClientStatus = 'idle';
  private username: string = '';
  private apiBase: string;
  private socketEndpoint: string;
  private socketPath: string;
  private trainerSprite: string | null = null;
  private trainerSpriteLocked = false;
  private hasAutoConnected = false;
  private lobbyJoinAttempted = false;
  private lobbyFallbackTimer: number | null = null;
  private autoJoinedBattleRooms = new Set<string>();
  private chatRoomHints = new Map<string, string>();
  private battleRoomHints = new Map<string, { playerIds: string[] }>();
  private battleRoomByPlayerKey = new Map<string, string>();
  private pendingBattlesByPlayerKey = new Map<string, { state: any; payload: any }>();
  user: { id: string; username: string } | null = null;
  rooms = new Map<string, RoomSummary>();
  chats = new Map<string, ChatMessage[]>();
  battleStates = new Map<string, any>();
  battleLogs = new Map<string, string[]>();
  battlePhases = new Map<string, PhasePayload>();
  battlePrompts = new Map<string, PromptActionPayload>();
  battleNeedsSwitch = new Map<string, any>();
  roomChallenges = new Map<string, ChallengeSummary[]>();
  mapStates = new Map<string, MapState>();

  on = this.emitter.on.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);

  constructor() {
    let storedBase: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        storedBase = window.localStorage?.getItem('ttrpg.apiBase') ?? null;
      } catch {
        storedBase = null;
      }
    }
    this.apiBase = normalizeApiBase(storedBase);
    const { endpoint, path } = computeSocketConfig(this.apiBase);
    this.socketEndpoint = endpoint;
    this.socketPath = path;
    this.trainerSprite = this.readTrainerSpriteFromStorage();
    if (this.trainerSprite) this.trainerSpriteLocked = true;
    if (typeof window !== 'undefined') {
      (window as any).pokettrpgClient = this;
    }
  }

  getStatus(): ClientStatus {
    return this.status;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  getServerEndpoint(): string {
    return this.apiBase;
  }

  getMapState(roomId: string): MapState | null {
    return this.mapStates.get(roomId) || null;
  }

  getDefaultServerEndpoint(): string {
    return DEFAULT_API_BASE;
  }

  setServerEndpoint(base: string): string {
    const normalized = normalizeApiBase(base);
    if (normalized === this.apiBase) return this.apiBase;

    this.apiBase = normalized;
    const { endpoint, path } = computeSocketConfig(this.apiBase);
    this.socketEndpoint = endpoint;
    this.socketPath = path;

    if (typeof window !== 'undefined') {
      try { window.localStorage?.setItem('ttrpg.apiBase', this.apiBase); } catch {}
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.updateStatus('idle');
    const previousRooms = Array.from(this.rooms.keys());
    this.rooms.clear();
    this.chats.clear();
    this.battleStates.clear();
    this.battleLogs.clear();
    this.battlePhases.clear();
    this.battlePrompts.clear();
    this.battleNeedsSwitch.clear();
    this.roomChallenges.clear();
    this.autoJoinedBattleRooms.clear();
    this.battleRoomHints.clear();
    this.battleRoomByPlayerKey.clear();
    this.pendingBattlesByPlayerKey.clear();
    for (const roomId of previousRooms) {
      this.emitter.emit('roomRemove', roomId);
    }
    this.emitter.emit('roomsSnapshot', []);

    if (this.hasAutoConnected) {
      this.connect(this.username);
    }

    return this.apiBase;
  }

  resetServerEndpoint(): string {
    return this.setServerEndpoint(DEFAULT_API_BASE);
  }

  private readTrainerSpriteFromStorage(): string | null {
    if (typeof window === 'undefined') return this.trainerSprite;
    try {
      const raw = window.localStorage?.getItem('ttrpg.trainerSprite');
      const directUrl = resolveTrainerSpriteUrl(raw);
      if (directUrl) {
        this.trainerSpriteLocked = true;
        return directUrl;
      }
      const sanitized = sanitizeTrainerSpriteId(raw);
      if (sanitized) this.trainerSpriteLocked = true;
      return sanitized || null;
    } catch {
      return null;
    }
  }

  getTrainerSprite(): string | null {
    if (!this.trainerSprite) {
      this.trainerSprite = this.readTrainerSpriteFromStorage();
    }
    return this.trainerSprite;
  }

  setTrainerSprite(spriteId: string | null | undefined) {
    const directUrl = resolveTrainerSpriteUrl(spriteId);
    const sanitized = directUrl || sanitizeTrainerSpriteId(spriteId);
    this.trainerSpriteLocked = !!sanitized;
    this.applyTrainerSprite(sanitized || null, { persist: true, notify: true, triggerIdentify: true, force: true });
  }

  private applyTrainerSprite(next: string | null, options: { persist?: boolean; notify?: boolean; triggerIdentify?: boolean; force?: boolean } = {}) {
    const { persist = true, notify = true, triggerIdentify = false, force = false } = options;
    const normalized = next && next.trim() ? next : null;
    // Only block server updates if we have a locked sprite from character sheet
    if (!force && this.trainerSpriteLocked && this.trainerSprite && normalized && normalized !== this.trainerSprite) return;
    if (normalized === (this.trainerSprite || null)) return;
    this.trainerSprite = normalized;
    if (persist && typeof window !== 'undefined') {
      try {
        if (normalized) window.localStorage?.setItem('ttrpg.trainerSprite', normalized);
        else window.localStorage?.removeItem('ttrpg.trainerSprite');
      } catch {}
    }
    if (notify) this.emitter.emit('trainerSpriteChanged', { trainerSprite: this.trainerSprite });
    if (triggerIdentify && this.socket?.connected) {
      this.identifyIfNeeded();
    }
  }

  private syncTrainerSpriteFromServer(value: unknown) {
    const directUrl = resolveTrainerSpriteUrl(value);
    const sanitized = directUrl || sanitizeTrainerSpriteId(value);
    // Don't sync from server if user has set their own sprite in character sheet
    if (this.trainerSpriteLocked && this.trainerSprite) return;
    if (!sanitized) return;
    this.applyTrainerSprite(sanitized, { persist: false, notify: false, triggerIdentify: false });
  }

  getRooms(): RoomSummary[] {
    return Array.from(this.rooms.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getChat(roomId: string): ChatMessage[] {
    const list = this.chats.get(roomId);
    return list ? list.slice() : [];
  }

  getBattleState<T = any>(roomId: string): T | null {
    return (this.battleStates.get(roomId) as T | undefined) ?? null;
  }

  getBattleLog(roomId: string): string[] {
    return this.battleLogs.get(roomId)?.slice() || [];
  }

  getBattlePhase(roomId: string): PhasePayload | null {
    return this.battlePhases.get(roomId) ?? null;
  }

  getPrompt(roomId: string): PromptActionPayload | null {
    return this.battlePrompts.get(roomId) ?? null;
  }

  getBattleNeedsSwitch(roomId: string): any {
    return this.battleNeedsSwitch.get(roomId) ?? null;
  }

  getChallenges(roomId: string): ChallengeSummary[] {
    return this.roomChallenges.get(roomId)?.slice() ?? [];
  }

  createChallenge(payload: { roomId: string; player: PlayerPayload; format?: string; rules?: any; toPlayerId?: string; challengeId?: string }) {
    this.socket?.emit('createChallenge', payload);
  }

  cancelChallenge(payload: { roomId: string; challengeId: string }) {
    this.socket?.emit('cancelChallenge', payload);
  }

  respondChallenge(payload: { roomId: string; challengeId: string; accepted: boolean; player?: PlayerPayload }) {
    this.socket?.emit('respondChallenge', payload);
  }

  connect(username: string) {
    this.username = username.trim() || 'Trainer';
    this.hasAutoConnected = true;
    if (this.socket?.connected) {
      this.identifyIfNeeded();
      return;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.updateStatus('connecting');
    let endpoint = this.socketEndpoint;
    let path = this.socketPath;
    if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && endpoint.startsWith('http://')) {
      const upgraded = endpoint.replace(/^http:/i, 'https:');
      this.emitter.emit('error', {
        message: `HTTPS page cannot connect to HTTP server. Trying ${upgraded}. If it fails, use an HTTPS/WSS backend or a tunnel.`,
      });
      endpoint = upgraded;
    }
    const socket = io(endpoint, {
      transports: ['websocket'],
      path,
      forceNew: true,
      withCredentials: false,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.updateStatus('connected');
      this.identifyIfNeeded();
    });

    socket.on('disconnect', () => {
      this.updateStatus('idle');
    });

    socket.on('connect_error', err => {
      const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
      const isHttpServer = this.socketEndpoint.startsWith('http://');
      const fallbackMessage = err?.message || 'Connection error';
      const message = (isHttpsPage && isHttpServer)
        ? 'HTTPS page cannot connect to an HTTP server. Use an HTTPS/WSS backend or a tunnel.'
        : fallbackMessage;
      this.emitter.emit('error', { message });
      this.updateStatus('error');
    });

    socket.on('error', (err: any) => {
      const message = typeof err === 'string' ? err : err?.message || 'Unknown error';
      this.emitter.emit('error', { message });
    });

    socket.on('identified', (user) => {
      const id = user?.id ?? user?.userid ?? user?.userId ?? user?.username ?? this.user?.id ?? this.username;
      const username = user?.username ?? user?.name ?? user?.userid ?? this.user?.username ?? this.username;
      this.user = { id, username };
      this.syncTrainerSpriteFromServer(user?.trainerSprite ?? user?.avatar);
      this.updateStatus('identified');
      this.emitter.emit('identified', user);
      this.ensureRoomsSnapshot();
      this.ensureLobby();
      for (const list of this.roomChallenges.values()) {
        for (const challenge of list) {
          this.observeChallenge(challenge);
        }
      }
    });

    socket.on('roomCreated', (room: any) => {
      const summary: RoomSummary = {
        id: room.id,
        name: room.name || 'Room',
        roomType: room.roomType || room.type || 'battle',
        mapOwnerId: room.mapOwnerId || room.ownerId,
        players: normalizePlayerList(room.players),
        spectCount: room.spectCount ?? 0,
        battleStarted: !!(room.battleStarted ?? room.started),
        challengeCount: typeof (room as any).challengeCount === 'number' ? (room as any).challengeCount : 0,
      };
      this.rooms.set(summary.id, summary);
      this.observeLobbyPresence(summary.id, summary.name);
      this.ensureAutoJoinForBattle(summary.id, room);
      this.emitter.emit('roomUpdate', summary);
      this.emitter.emit('roomCreated', summary);
    });

    socket.on('roomUpdate', (room: any) => {
      const prev = this.rooms.get(room.id);
      const summary: RoomSummary = {
        id: room.id,
        name: room.name || prev?.name || 'Room',
        roomType: room.roomType || room.type || prev?.roomType || 'battle',
        mapOwnerId: room.mapOwnerId || room.ownerId || prev?.mapOwnerId,
        players: normalizePlayerList(room.players, prev?.players),
        spectCount: room.spectCount ?? prev?.spectCount ?? 0,
        battleStarted: (room.battleStarted ?? room.started ?? prev?.battleStarted ?? false) as boolean,
        challengeCount: typeof (room as any).challengeCount === 'number'
          ? (room as any).challengeCount
          : prev?.challengeCount,
      };
      this.rooms.set(room.id, summary);
      if (summary.battleStarted) this.rememberBattleRoom(summary.id, room.players || summary.players);
      this.observeLobbyPresence(summary.id, summary.name);
      this.ensureAutoJoinForBattle(summary.id, room);
      this.emitter.emit('roomUpdate', summary);
    });

    socket.on('roomRemoved', (roomId: string) => {
      this.rooms.delete(roomId);
      this.clearBattle(roomId);
      this.autoJoinedBattleRooms.delete(roomId);
      this.forgetChatRoom(roomId);
      this.emitter.emit('roomRemove', roomId);
    });

    socket.on('chatMessage', (msg: any) => {
      const user = msg.user || 'system';
      const baseRoomId = typeof msg.roomId === 'string' && msg.roomId ? msg.roomId : null;
      let roomId = baseRoomId || this.lookupChatRoomHint(user) || this.resolveChatRoomByParticipants(user) || LOBBY_ROOM_ID;
      if (!roomId) roomId = LOBBY_ROOM_ID;
      this.rememberChatRoom(user, roomId);
      const payload: ChatMessage = {
        roomId,
        user,
        text: msg.text || '',
        time: msg.time || Date.now(),
      };
      this.appendChat(roomId, payload);
      this.emitter.emit('chatMessage', payload);
    });

    socket.on('battleStarted', (data: any) => {
      const state = this.extractBattleState(data);
      this.applyRoomsPatch(data?.rooms);
      const roomId = this.resolveBattleRoomId(data, state);
      if (!roomId) {
        this.queuePendingBattle(state, data);
        return;
      }
      this.finalizeBattleStart(roomId, state, data);
    });

    socket.on('teamPreviewStarted', ({ roomId }: { roomId: string }) => {
      if (!roomId) return;
      this.emitter.emit('teamPreviewStarted', { roomId });
    });

    socket.on('battleUpdate', (update: any) => {
      const state = this.extractBattleState(update);
      this.applyRoomsPatch(update?.rooms);
      const roomId = this.resolveBattleRoomId(update, state);
      if (!roomId) return;
      const mergedState = this.mergeBattleState(roomId, state, update);
      if (mergedState) {
        this.recordBattleState(roomId, mergedState);
        this.rememberBattleRoom(roomId, Array.isArray(mergedState?.players) ? mergedState.players : []);
      }
      this.ensureBattleRoomPresence(roomId, mergedState ?? state, update);
      if (update?.phase) this.battlePhases.set(roomId, { phase: update.phase, deadline: update?.deadline });
      if (update?.needsSwitch !== undefined) this.updateNeedsSwitch(roomId, update.needsSwitch);
      this.appendBattleLog(roomId, this.pullLogEntries(update?.log, update?.messages, update?.result?.log, update?.result?.state?.log, update?.result));
      this.ensureAutoJoinForBattle(roomId, state || update, true);
      this.emitter.emit('battleUpdate', { roomId, update });
    });

    socket.on('phase', ({ roomId, ...payload }: any) => {
      if (!roomId) return;
      this.battlePhases.set(roomId, payload as PhasePayload);
      this.emitter.emit('phase', { roomId, payload });
    });

    socket.on('promptAction', (payload: PromptActionPayload) => {
      if (payload?.roomId) {
        this.battlePrompts.set(payload.roomId, payload);
        if ((payload as any).needsSwitch !== undefined) this.updateNeedsSwitch(payload.roomId, (payload as any).needsSwitch);
        // Extract and record battle state from prompt payload (contains players, teams, etc.)
        const state = this.extractBattleState(payload);
        if (state) {
          const mergedState = this.mergeBattleState(payload.roomId, state, payload);
          this.recordBattleState(payload.roomId, mergedState);
        }
      }
      this.emitter.emit('promptAction', payload);
    });

    socket.on('battleEnd', (payload: any) => {
      const roomId = payload?.roomId || payload?.state?.id || '';
      if (!roomId) return;
      if (payload?.state) {
        const mergedState = this.mergeBattleState(roomId, payload.state, payload);
        this.recordBattleState(roomId, mergedState);
      }
      this.appendBattleLog(roomId, this.pullLogEntries(payload?.log, payload?.result, 'Battle ended.'));
      this.battlePrompts.delete(roomId);
      this.battlePhases.delete(roomId);
      this.updateNeedsSwitch(roomId, null);
      this.autoJoinedBattleRooms.delete(roomId);
      this.emitter.emit('battleEnd', { roomId, payload });
    });

    socket.on('spectate_start', (payload: SpectateStartPayload) => {
      const state = this.extractBattleState(payload);
      this.applyRoomsPatch(payload?.rooms);
      const roomId = this.resolveBattleRoomId(payload, state);
      if (!roomId) return;
      const mergedState = this.mergeBattleState(roomId, state, payload);
      if (mergedState) {
        this.recordBattleState(roomId, mergedState);
        this.rememberBattleRoom(roomId, Array.isArray(mergedState?.players) ? mergedState.players : []);
      }
      this.ensureBattleRoomPresence(roomId, mergedState ?? state, payload);
      this.appendBattleLog(roomId, this.pullLogEntries(payload?.log, state?.log));
      if (payload?.phase) this.battlePhases.set(roomId, { phase: payload.phase, deadline: payload.deadline });
      this.updateNeedsSwitch(roomId, payload?.needsSwitch);
      this.emitter.emit('spectateStart', { ...payload, roomId });
    });

    socket.on('challengeSync', (payload: ChallengeSyncPayload) => {
      if (!payload?.roomId) return;
      const challenges = Array.isArray(payload.challenges) ? payload.challenges.slice() : [];
      this.roomChallenges.set(payload.roomId, challenges);
      for (const challenge of challenges) {
        this.observeChallenge(challenge);
      }
      this.emitter.emit('challengeSync', { roomId: payload.roomId, challenges: this.getChallenges(payload.roomId) });
    });

    socket.on('challengeCreated', ({ roomId, challenge }: { roomId: string; challenge: ChallengeSummary }) => {
      if (!roomId || !challenge) return;
      this.upsertChallenge(roomId, challenge);
      this.observeChallenge(challenge);
      this.emitter.emit('challengeCreated', { roomId, challenge });
    });

    socket.on('challengeUpdated', ({ roomId, challenge }: { roomId: string; challenge: ChallengeSummary }) => {
      if (!roomId || !challenge) return;
      this.upsertChallenge(roomId, challenge);
      this.observeChallenge(challenge);
      this.emitter.emit('challengeUpdated', { roomId, challenge });
    });

    socket.on('challengeRemoved', ({ roomId, challengeId, reason }: { roomId: string; challengeId: string; reason?: ChallengeRemovedReason }) => {
      if (!roomId || !challengeId) return;
      this.removeChallenge(roomId, challengeId);
      this.emitter.emit('challengeRemoved', { roomId, challengeId, reason });
    });

    // Handle action cancelled confirmation from server
    socket.on('actionCancelled', ({ playerId, roomId }: { playerId: string; roomId: string }) => {
      console.log('[Client] Action cancelled confirmed by server:', { playerId, roomId });
      this.emitter.emit('actionCancelled', { playerId, roomId });
    });

    socket.on('mapState', (payload: { roomId: string; state: MapState }) => {
      if (!payload?.roomId || !payload?.state) return;
      this.mapStates.set(payload.roomId, payload.state);
      this.emitter.emit('mapState', payload);
    });
  }

  private appendChat(roomId: string, msg: ChatMessage) {
    if (!this.chats.has(roomId)) this.chats.set(roomId, []);
    const list = this.chats.get(roomId)!;
    const last = list[list.length - 1];
    if (last && last.user === msg.user && last.text === msg.text && Math.abs(last.time - msg.time) < 2000) {
      return;
    }
    list.push(msg);
    if (list.length > 200) list.splice(0, list.length - 200);
  }

  private updateStatus(next: ClientStatus) {
    this.status = next;
    this.emitter.emit('status', next);
  }

  private identifyIfNeeded() {
    if (!this.socket) return;
    const trainerSprite = this.getTrainerSprite();
    const payload: any = { username: this.username };
    if (trainerSprite) {
      payload.trainerSprite = trainerSprite;
      payload.avatar = trainerSprite;
    }
    this.socket.emit('identify', payload);
  }

  private async ensureRoomsSnapshot() {
    try {
      if (typeof window !== 'undefined') {
        try {
          const target = new URL(this.apiBase);
          const origin = window.location.origin;
          if (origin && origin !== 'null' && target.origin !== origin) {
            return;
          }
        } catch {}
      }
      const res = await fetch(`${this.apiBase}/api/rooms`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rooms: RoomSummary[] = await res.json();
      this.rooms.clear();
      for (const room of rooms) {
        const summary: RoomSummary = {
          id: room.id,
          name: room.name || 'Room',
          players: normalizePlayerList(room.players),
          spectCount: room.spectCount ?? 0,
          battleStarted: !!(room as any).battleStarted || !!(room as any).started,
          challengeCount: typeof (room as any).challengeCount === 'number' ? (room as any).challengeCount : 0,
        };
        this.rooms.set(summary.id, summary);
        this.observeLobbyPresence(summary.id, summary.name);
      }
      this.emitter.emit('roomsSnapshot', this.getRooms());
    } catch (err) {
      console.warn('Failed to load rooms snapshot', err);
    }
  }

  private ensureLobby() {
    if (this.lobbyJoinAttempted) return;
    this.lobbyJoinAttempted = true;
    this.joinRoom(LOBBY_ROOM_ID, 'player');
    if (typeof window !== 'undefined') {
      if (this.lobbyFallbackTimer !== null) {
        window.clearTimeout(this.lobbyFallbackTimer);
        this.lobbyFallbackTimer = null;
      }
      this.lobbyFallbackTimer = window.setTimeout(() => {
        if (!this.rooms.has(LOBBY_ROOM_ID)) {
          this.createRoom('Global Lobby');
        }
      }, 4000);
    }
  }

  setUsername(name: string) {
    this.username = name.trim() || 'Trainer';
    if (this.socket?.connected) {
      this.identifyIfNeeded();
    }
  }

  createRoom(name: string, options?: { roomType?: 'battle' | 'map' }) {
    this.socket?.emit('createRoom', { name, roomType: options?.roomType });
  }

  joinRoom(roomId: string, role: 'player' | 'spectator' = 'player') {
    const trainerSprite = this.getTrainerSprite();
    const payload: any = { roomId, role };
    if (trainerSprite) {
      payload.trainerSprite = trainerSprite;
      payload.avatar = trainerSprite;
    }
    this.socket?.emit('joinRoom', payload);
  }

  leaveRoom(roomId: string) {
    this.socket?.emit('leaveRoom', { roomId });
  }

  updateMapState(roomId: string, state: Partial<MapState>) {
    this.socket?.emit('mapUpdate', { roomId, state });
  }

  moveMapToken(roomId: string, tokenId: string, x: number, y: number) {
    this.socket?.emit('mapTokenMove', { roomId, tokenId, x, y });
  }

  sendChat(roomId: string, text: string) {
    this.socket?.emit('sendChat', { roomId, text });
    const username = this.user?.username || this.username;
    if (username) this.rememberChatRoom(username, roomId);
  }

  startBattle(roomId: string, players: PlayerPayload[], seed?: number) {
    this.socket?.emit('startBattle', { roomId, players, seed });
  }

  sendAction(roomId: string, action: BattleAction, playerId?: string) {
    const pid = playerId || this.user?.id;
    if (!pid) return;
    const enriched: any = { ...action };
    if (!enriched.actorPlayerId) {
      enriched.actorPlayerId = pid;
    }
    this.socket?.emit('sendAction', { roomId, playerId: pid, action: enriched });
  }

  clearBattle(roomId: string) {
    this.battleStates.delete(roomId);
    this.battleLogs.delete(roomId);
    this.battlePhases.delete(roomId);
    this.battlePrompts.delete(roomId);
    this.battleNeedsSwitch.delete(roomId);
    this.autoJoinedBattleRooms.delete(roomId);
    this.battleRoomHints.delete(roomId);
    for (const [key, value] of Array.from(this.battleRoomByPlayerKey.entries())) {
      if (value === roomId) this.battleRoomByPlayerKey.delete(key);
    }
  }

  spectate(roomId: string) {
    this.joinRoom(roomId, 'spectator');
  }

  private recordBattleState(roomId: string, state: any) {
    if (!state) return;
    this.battleStates.set(roomId, state);
  }

  private mergeBattleState(roomId: string, state: any, patch?: any): any {
    const previous = this.battleStates.get(roomId);
    let target: any;
    if (previous && typeof previous === 'object') {
      target = { ...previous };
    } else {
      target = {};
    }
    if (state && typeof state === 'object') {
      target = { ...target, ...state };
    } else if (state !== undefined) {
      target = state;
    }
    this.applyBattleExtras(target, patch);
    return target;
  }

  private applyBattleExtras(target: any, source: any) {
    if (!target || typeof target !== 'object') return;
    const assignKeys = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      const keys = [
        'request',
        'requests',
        'pendingRequest',
        'pendingRequests',
        'prompt',
        'prompts',
        'teamPreview',
        'teamPreviews',
        'needsSwitch',
        'lastRequest',
        'lastRequests',
        'activeRequest',
        'activeRequests',
        'choiceRequest',
        'choiceRequests',
        'choices',
        'commands',
      ];
      for (const key of keys) {
        if (payload[key] !== undefined) {
          target[key] = payload[key];
        }
      }
    };
    assignKeys(source);
    assignKeys(source?.state);
    assignKeys(source?.battle);
    assignKeys(source?.snapshot);
    assignKeys(source?.result);
  }

  private appendBattleLog(roomId: string, entries: any) {
    const lines = this.normalizeLogLines(entries);
    if (!lines.length) return;
    const current = this.battleLogs.get(roomId) || [];
    const merged = current.concat(lines);
    const trimmed = merged.length > 500 ? merged.slice(merged.length - 500) : merged;
    this.battleLogs.set(roomId, trimmed);
  }

  private upsertChallenge(roomId: string, challenge: ChallengeSummary) {
    const list = this.roomChallenges.get(roomId) ?? [];
    const idx = list.findIndex(c => c.id === challenge.id);
    if (idx === -1) {
      list.push(challenge);
    } else {
      list[idx] = challenge;
    }
    this.roomChallenges.set(roomId, list);
  }

  private removeChallenge(roomId: string, challengeId: string) {
    const list = this.roomChallenges.get(roomId);
    if (!list) return;
    const next = list.filter(c => c.id !== challengeId);
    if (next.length) this.roomChallenges.set(roomId, next);
    else this.roomChallenges.delete(roomId);
  }

  private observeChallenge(challenge: ChallengeSummary) {
    if (!challenge) return;
    const battleRoomId = challenge.battleRoomId || challenge.battleRoomName;
    if (!battleRoomId || !this.user) return;
    const participants: any[] = [];
    if (challenge.owner) participants.push(challenge.owner);
    if (challenge.target) participants.push(challenge.target);
    if (participants.length) this.rememberBattleRoom(battleRoomId, participants);
    const myId = this.user.id;
    const participates = challenge.owner?.id === myId || challenge.target?.id === myId;
    if (!participates) return;
    if (this.autoJoinedBattleRooms.has(battleRoomId)) return;
    this.autoJoinedBattleRooms.add(battleRoomId);
    this.joinRoom(battleRoomId, 'player');
  }

  private ensureAutoJoinForBattle(roomId: string, snapshot: any, force = false) {
    if (!roomId || !snapshot || !this.user) return;
    if (this.autoJoinedBattleRooms.has(roomId)) return;
    const looksLikeBattle = force || Boolean(
      snapshot.state ||
      snapshot.log ||
      snapshot.battle ||
      snapshot.battleStarted === true ||
      snapshot.started === true ||
      (typeof snapshot.name === 'string' && snapshot.name.toLowerCase().includes('battle'))
    );
    if (!looksLikeBattle) return;
    const myId = (this.user.id || '').toLowerCase();
    const myName = (this.user.username || this.username || '').toLowerCase();
    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const participates = players.some((player: any) => {
      if (!player) return false;
      const candidateIds = [
        player.id,
        player.userid,
        player.userId,
        player.user?.id,
      ].map(val => (typeof val === 'string' ? val.toLowerCase() : ''));
      const candidateNames = [
        player.name,
        player.username,
        player.user?.name,
        player.user?.username,
      ].map(val => (typeof val === 'string' ? val.toLowerCase() : ''));
      return candidateIds.includes(myId) || (myName && (candidateIds.includes(myName) || candidateNames.includes(myName)));
    });
    if (!participates) return;
    this.autoJoinedBattleRooms.add(roomId);
    this.joinRoom(roomId, 'player');
  }

  private observeLobbyPresence(roomId: string, roomName?: string) {
    const matchesId = roomId === LOBBY_ROOM_ID;
    const matchesName = typeof roomName === 'string' && roomName.trim().toLowerCase() === 'global lobby';
    if (!matchesId && !matchesName) return;
    if (this.lobbyFallbackTimer !== null) {
      window.clearTimeout(this.lobbyFallbackTimer);
      this.lobbyFallbackTimer = null;
    }
  }

  private extractBattleState(payload: any): any {
    if (!payload) return null;
    const candidates = [
      payload.state,
      payload.battle,
      payload.snapshot,
      payload.result?.state,
      payload?.data?.state,
    ];
    for (const candidate of candidates) {
      if (candidate) return candidate;
    }
    if (payload?.battleState) return payload.battleState;
    if (payload?.stateId && this.battleStates.has(payload.stateId)) {
      return this.battleStates.get(payload.stateId);
    }
    if (payload?.id && typeof payload.id === 'string' && this.battleStates.has(payload.id)) {
      return this.battleStates.get(payload.id);
    }
    return null;
  }

  private resolveBattleRoomId(payload: any, state: any): string | null {
    const directCandidates: Array<any> = [
      payload?.roomId,
      payload?.id,
      payload?.room?.id,
      payload?.room?.roomId,
      payload?.stateId,
      payload?.battleId,
      state?.id,
      state?.roomId,
    ];
    for (const candidate of directCandidates) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    if (state && Array.isArray(state.players)) {
      const key = this.buildPlayerKey(this.primaryPlayerIds(state.players));
      if (key && this.battleRoomByPlayerKey.has(key)) {
        return this.battleRoomByPlayerKey.get(key)!;
      }
    }
    const fromPatch = this.extractRoomIdFromPatch(payload?.rooms, state);
    if (fromPatch) return fromPatch;
    if (state && Array.isArray(state.players)) {
      const fromPlayers = this.findRoomIdByPlayers(state.players);
      if (fromPlayers) return fromPlayers;
    }
    return null;
  }

  private extractRoomIdFromPatch(patch: any, state: any): string | null {
    if (!patch) return null;
    const list = Array.isArray(patch) ? patch : [patch];
    if (!list.length) return null;
    const identifiers = this.collectPlayerIdentifiers(Array.isArray(state?.players) ? state.players : []);
    let fallback: string | null = null;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || !entry.id) continue;
      if (!fallback) fallback = typeof entry.id === 'string' ? entry.id : fallback;
      if (!identifiers.length) continue;
      const summaryPlayers = normalizePlayerList(entry.players);
      if (this.summaryMatchesIdentifiers(summaryPlayers, identifiers)) return entry.id;
    }
    return fallback;
  }

  private findRoomIdByPlayers(players: any[]): string | null {
    const identifiers = this.collectPlayerIdentifiers(players);
    if (!identifiers.length) return null;
    for (const summary of this.rooms.values()) {
      if (!summary?.id) continue;
      if (!summary?.battleStarted) continue;
      if (this.summaryMatchesIdentifiers(summary.players, identifiers)) return summary.id;
    }
    return null;
  }

  private collectPlayerIdentifiers(players: any[]): string[] {
    const out = new Set<string>();
    for (const player of players || []) {
      if (!player) continue;
      const candidates = [
        player.id,
        player.userid,
        player.userId,
        player.name,
        player.username,
        player?.user?.id,
        player?.user?.name,
        player?.user?.username,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate) {
          out.add(candidate.toLowerCase());
        }
      }
    }
    return Array.from(out);
  }

  private primaryPlayerIds(players: any[]): string[] {
    const ids: string[] = [];
    for (const player of players || []) {
      if (!player) continue;
      const candidate =
        (typeof player.id === 'string' && player.id) ? player.id :
        (typeof player.userid === 'string' && player.userid) ? player.userid :
        (typeof player.userId === 'string' && player.userId) ? player.userId :
        (typeof player.name === 'string' && player.name) ? player.name :
        (typeof player.username === 'string' && player.username) ? player.username :
        (typeof player?.user?.id === 'string' && player.user.id) ? player.user.id :
        (typeof player?.user?.name === 'string' && player.user.name) ? player.user.name :
        null;
      if (!candidate) continue;
      ids.push(candidate.toLowerCase());
    }
    return ids;
  }

  private buildPlayerKey(ids: string[]): string | null {
    if (!ids || !ids.length) return null;
    const unique = Array.from(new Set(ids.map(id => id.toLowerCase()).filter(Boolean)));
    if (!unique.length) return null;
    unique.sort();
    return unique.join('|');
  }

  private rememberBattleRoom(roomId: string, players: any[]) {
    if (!roomId || !players || !players.length) return;
    const ids = this.primaryPlayerIds(players);
    if (!ids.length) return;
    const key = this.buildPlayerKey(ids);
    if (!key) return;
    this.battleRoomHints.set(roomId, { playerIds: ids });
    this.battleRoomByPlayerKey.set(key, roomId);
    const pending = this.pendingBattlesByPlayerKey.get(key);
    if (pending) {
      this.pendingBattlesByPlayerKey.delete(key);
      this.finalizeBattleStart(roomId, pending.state, pending.payload, true);
    }
  }

  private ensureBattleRoomPresence(roomId: string, state: any, source: any) {
    if (!roomId) return;
    const existing = this.rooms.get(roomId);
    const playersFromState = Array.isArray(state?.players) ? state.players : [];
    const playersFromSource = Array.isArray(source?.players) ? source.players : [];
    const players = normalizePlayerList(playersFromState.length ? playersFromState : playersFromSource, existing?.players);
    const nameCandidate =
      source?.room?.name ??
      source?.name ??
      state?.name ??
      existing?.name ??
      `Battle ${roomId}`;
    const summary: RoomSummary = {
      id: roomId,
      name: nameCandidate,
      players,
      spectCount: typeof source?.spectCount === 'number' ? source.spectCount : existing?.spectCount ?? 0,
      battleStarted: true,
      challengeCount: typeof source?.challengeCount === 'number' ? source.challengeCount : existing?.challengeCount,
    };
    this.rooms.set(roomId, summary);
    this.emitter.emit(existing ? 'roomUpdate' : 'roomCreated', summary);
  }

  private queuePendingBattle(state: any, payload: any) {
    if (!state || !Array.isArray(state.players)) return;
    const key = this.buildPlayerKey(this.primaryPlayerIds(state.players));
    if (!key) return;
    this.pendingBattlesByPlayerKey.set(key, { state, payload });
  }

  private finalizeBattleStart(roomId: string, state: any, payload: any, fromPending = false) {
    const mergedState = this.mergeBattleState(roomId, state, payload);
    if (mergedState) {
      this.recordBattleState(roomId, mergedState);
      if (!fromPending && Array.isArray(mergedState?.players)) {
        this.rememberBattleRoom(roomId, mergedState.players);
      }
    }
    if (!fromPending || !this.rooms.has(roomId)) {
      this.ensureBattleRoomPresence(roomId, mergedState ?? state, payload);
    }
    const defaultLine = fromPending ? 'Battle started.' : 'Battle started.';
    this.appendBattleLog(roomId, this.pullLogEntries(payload?.log, payload?.messages, payload?.result?.log, mergedState?.log ?? state?.log, defaultLine));
    this.battlePrompts.delete(roomId);
    if (payload?.phase) {
      this.battlePhases.set(roomId, { phase: payload.phase, deadline: payload?.deadline });
    } else {
      this.battlePhases.delete(roomId);
    }
    this.updateNeedsSwitch(roomId, payload?.needsSwitch);
    this.ensureAutoJoinForBattle(roomId, mergedState || state || payload, true);
    this.emitter.emit('battleStarted', { roomId, state: mergedState });
  }

  private summaryMatchesIdentifiers(players: RoomSummary['players'], identifiers: string[]): boolean {
    if (!players || !players.length || !identifiers.length) return false;
    const summaryIds = players
      .map(p => p?.id || p?.username || p?.name || '')
      .filter(Boolean)
      .map(value => value.toLowerCase());
    if (!summaryIds.length) return false;
    return identifiers.every(id => summaryIds.includes(id));
  }

  private lookupChatRoomHint(user: string): string | null {
    if (!user) return null;
    return this.chatRoomHints.get(user.toLowerCase()) ?? null;
  }

  private rememberChatRoom(user: string, roomId: string) {
    if (!user || !roomId) return;
    this.chatRoomHints.set(user.toLowerCase(), roomId);
  }

  private forgetChatRoom(roomId: string) {
    if (!roomId) return;
    for (const [key, value] of Array.from(this.chatRoomHints.entries())) {
      if (value === roomId) this.chatRoomHints.delete(key);
    }
  }

  private resolveChatRoomByParticipants(user: string): string | null {
    if (!user) return null;
    const lower = user.toLowerCase();
    let fallback: string | null = null;
    for (const summary of this.rooms.values()) {
      if (!summary?.players?.length) continue;
      const matches = summary.players.some(player => {
        const values = [player.id, player.username, player.name];
        return values.some(val => typeof val === 'string' && val.toLowerCase() === lower);
      });
      if (!matches) continue;
      if (summary.battleStarted) return summary.id;
      if (!fallback) fallback = summary.id;
    }
    return fallback;
  }

  private pullLogEntries(...candidates: any[]): any[] {
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (Array.isArray(candidate) && candidate.length) return candidate;
      if (typeof candidate === 'string') return [candidate];
      if (typeof candidate === 'object') {
        if (Array.isArray((candidate as any).log) && (candidate as any).log.length) return (candidate as any).log;
        if (Array.isArray((candidate as any).messages) && (candidate as any).messages.length) return (candidate as any).messages;
        if (Array.isArray((candidate as any).lines) && (candidate as any).lines.length) return (candidate as any).lines;
        if (typeof (candidate as any).message === 'string') return [(candidate as any).message];
        if (typeof (candidate as any).result === 'string') return [(candidate as any).result];
        if (typeof (candidate as any).text === 'string') return [(candidate as any).text];
      }
    }
    return [];
  }

  private normalizeLogLines(entries: any): string[] {
    if (!entries) return [];
    const list: any[] = Array.isArray(entries) ? entries : [entries];
    return list
      .flatMap(item => {
        if (!item) return [];
        if (Array.isArray(item)) return this.normalizeLogLines(item);
        if (typeof item === 'string') return [item.replace(/\n/g, '')];
        if (typeof item === 'object') {
          if (Array.isArray((item as any).log)) return this.normalizeLogLines((item as any).log);
          if (Array.isArray((item as any).messages)) return this.normalizeLogLines((item as any).messages);
          if (Array.isArray((item as any).lines)) return this.normalizeLogLines((item as any).lines);
          if (typeof (item as any).message === 'string') return [(item as any).message];
          if (typeof (item as any).text === 'string') return [(item as any).text];
          if (typeof (item as any).event === 'string' && typeof (item as any).detail === 'string') {
            return [`${(item as any).event}: ${(item as any).detail}`];
          }
          if ((item as any).result && typeof (item as any).result === 'string') return [(item as any).result];
        }
        return [JSON.stringify(item)];
      })
      .filter(Boolean);
  }

  private updateNeedsSwitch(roomId: string, payload: any) {
    if (!payload) {
      this.battleNeedsSwitch.delete(roomId);
      return;
    }
    this.battleNeedsSwitch.set(roomId, payload);
  }

  private applyRoomsPatch(patch: any) {
    if (!patch) return;
    const list = Array.isArray(patch) ? patch : [patch];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || !entry.id) continue;
      const prev = this.rooms.get(entry.id);
      const players = normalizePlayerList(entry.players, prev?.players);
      const summary: RoomSummary = {
        id: entry.id,
        name: entry.name ?? prev?.name ?? 'Room',
        players,
        spectCount: typeof entry.spectCount === 'number' ? entry.spectCount : prev?.spectCount ?? 0,
        battleStarted: (entry.battleStarted ?? entry.started ?? prev?.battleStarted ?? false) as boolean,
        challengeCount: typeof (entry as any).challengeCount === 'number'
          ? (entry as any).challengeCount
          : prev?.challengeCount,
      };
      if (summary.battleStarted) this.rememberBattleRoom(summary.id, entry.players || summary.players);
      this.rooms.set(entry.id, summary);
      this.observeLobbyPresence(summary.id, summary.name);
      this.ensureAutoJoinForBattle(summary.id, summary);
      this.emitter.emit(prev ? 'roomUpdate' : 'roomCreated', summary);
    }
  }
}

let clientSingleton: PoketTRPGClient | null = null;

export function getClient(): PoketTRPGClient {
  if (!clientSingleton) clientSingleton = new PoketTRPGClient();
  return clientSingleton;
}
