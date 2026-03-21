/**
 * Protocol Adapter
 * 
 * Converts between the pokettrpg server protocol and Pokemon Showdown's
 * battle protocol format. PS uses a line-based text protocol like:
 * 
 * |player|p1|PlayerName|avatar
 * |switch|p1a: Pikachu|Pikachu, L50, M|100/100
 * |move|p1a: Pikachu|Thunderbolt|p2a: Charizard
 * |-damage|p2a: Charizard|65/100
 * 
 * Our server uses JSON state objects. This adapter bridges the gap.
 */

export interface ServerPokemon {
  id: string;
  species: string;
  name?: string;
  level: number;
  gender?: 'M' | 'F' | 'N';
  shiny?: boolean;
  currentHP: number;
  stats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  moves: string[];
  ability: string;
  item?: string;
  status?: string;
  boosts?: Record<string, number>;
  terastallized?: string;
}

export interface ServerPlayer {
  id: string;
  name?: string;
  team: ServerPokemon[];
  activeIndex: number;
}

export interface ServerBattleState {
  id: string;
  turn: number;
  phase: string;
  players: ServerPlayer[];
  weather?: string;
  terrain?: string;
  log?: string[];
}

export interface BattleLog {
  type: string;
  message: string;
  details?: any;
}

/**
 * Convert a Pokemon's details to PS format
 * Example: "Pikachu, L50, M, shiny" or "Charizard, L100, F"
 */
function pokemonDetails(poke: ServerPokemon): string {
  const parts = [poke.species];
  if (poke.level !== 100) parts.push(`L${poke.level}`);
  if (poke.gender && poke.gender !== 'N') parts.push(poke.gender);
  if (poke.shiny) parts.push('shiny');
  return parts.join(', ');
}

/**
 * Convert HP to PS format: "current/max" or "current/max status"
 */
function pokemonCondition(poke: ServerPokemon): string {
  const hp = `${poke.currentHP}/${poke.stats.hp}`;
  if (poke.status && poke.status !== 'healthy') {
    return `${hp} ${poke.status}`;
  }
  return hp;
}

/**
 * Create Pokemon ident (side + nickname)
 * Example: "p1a: Pikachu"
 */
function pokemonIdent(side: string, poke: ServerPokemon, slot = 'a'): string {
  return `${side}${slot}: ${poke.name || poke.species}`;
}

/**
 * Convert full battle state to PS protocol lines
 */
export function stateToProtocol(state: ServerBattleState): string[] {
  const lines: string[] = [];
  
  // Game type - use state.gameType if available (doubles/triples for boss battles)
  const gameType = (state as any).gameType || 'singles';
  lines.push(`|gametype|${gameType}`);
  
  // Gen (assume Gen 9)
  lines.push('|gen|9');
  
  // Tier
  lines.push('|tier|[Gen 9] Custom Game');
  
  // Rated (not rated)
  lines.push('|rated|');
  
  // Rule (no rules for custom)
  lines.push('|rule|Custom Game: Custom rules');
  
  // Players
  state.players.forEach((player, idx) => {
    const side = `p${idx + 1}`;
    const avatar = (player as any).trainerSprite || (player as any).avatar || 'acetrainer';
    lines.push(`|player|${side}|${player.name || player.id}|${avatar}|`);
  });
  
  // Team sizes
  state.players.forEach((player, idx) => {
    const side = `p${idx + 1}`;
    lines.push(`|teamsize|${side}|${player.team.length}`);
  });
  
  return lines;
}

/**
 * Convert team preview state to PS protocol
 */
export function teamPreviewToProtocol(state: ServerBattleState): string[] {
  const lines: string[] = [];
  
  // Start team preview
  lines.push('|teampreview');
  
  return lines;
}

/**
 * Convert a switch action to PS protocol
 */
export function switchToProtocol(
  side: string,
  poke: ServerPokemon,
  slot = 'a'
): string[] {
  const ident = pokemonIdent(side, poke, slot);
  const details = pokemonDetails(poke);
  const condition = pokemonCondition(poke);
  
  return [
    `|switch|${ident}|${details}|${condition}`,
  ];
}

/**
 * Convert a move action to PS protocol
 */
export function moveToProtocol(
  attackerSide: string,
  attacker: ServerPokemon,
  moveName: string,
  targetSide: string,
  target: ServerPokemon,
  slot = 'a'
): string[] {
  const attackerIdent = pokemonIdent(attackerSide, attacker, slot);
  const targetIdent = pokemonIdent(targetSide, target, slot);
  
  return [
    `|move|${attackerIdent}|${moveName}|${targetIdent}`,
  ];
}

/**
 * Convert damage to PS protocol
 */
export function damageToProtocol(
  side: string,
  poke: ServerPokemon,
  slot = 'a'
): string[] {
  const ident = pokemonIdent(side, poke, slot);
  const condition = pokemonCondition(poke);
  
  return [
    `|-damage|${ident}|${condition}`,
  ];
}

/**
 * Convert healing to PS protocol
 */
export function healToProtocol(
  side: string,
  poke: ServerPokemon,
  slot = 'a'
): string[] {
  const ident = pokemonIdent(side, poke, slot);
  const condition = pokemonCondition(poke);
  
  return [
    `|-heal|${ident}|${condition}`,
  ];
}

/**
 * Convert faint to PS protocol
 */
export function faintToProtocol(
  side: string,
  poke: ServerPokemon,
  slot = 'a'
): string[] {
  const ident = pokemonIdent(side, poke, slot);
  
  return [
    `|faint|${ident}`,
  ];
}

/**
 * Convert status to PS protocol
 */
export function statusToProtocol(
  side: string,
  poke: ServerPokemon,
  status: string,
  slot = 'a'
): string[] {
  const ident = pokemonIdent(side, poke, slot);
  
  return [
    `|-status|${ident}|${status}`,
  ];
}

/**
 * Convert stat boost to PS protocol
 */
export function boostToProtocol(
  side: string,
  poke: ServerPokemon,
  stat: string,
  stages: number,
  slot = 'a'
): string[] {
  const ident = pokemonIdent(side, poke, slot);
  const cmd = stages > 0 ? '-boost' : '-unboost';
  
  return [
    `|${cmd}|${ident}|${stat}|${Math.abs(stages)}`,
  ];
}

/**
 * Convert weather to PS protocol
 */
export function weatherToProtocol(weather: string, source?: string): string[] {
  if (!weather) return ['|-weather|none'];
  
  const weatherMap: Record<string, string> = {
    'rain': 'RainDance',
    'sun': 'SunnyDay',
    'sand': 'Sandstorm',
    'hail': 'Hail',
    'snow': 'Snow',
  };
  
  const psWeather = weatherMap[weather.toLowerCase()] || weather;
  return [`|-weather|${psWeather}${source ? `|[from] ${source}` : ''}`];
}

/**
 * Convert terrain to PS protocol
 */
export function terrainToProtocol(terrain: string): string[] {
  if (!terrain) return ['|-fieldend|terrain'];
  
  const terrainMap: Record<string, string> = {
    'electric': 'Electric Terrain',
    'grassy': 'Grassy Terrain',
    'misty': 'Misty Terrain',
    'psychic': 'Psychic Terrain',
  };
  
  const psTerrain = terrainMap[terrain.toLowerCase()] || terrain;
  return [`|-fieldstart|move: ${psTerrain}`];
}

/**
 * Convert turn start to PS protocol
 */
export function turnToProtocol(turnNumber: number): string[] {
  return [
    `|turn|${turnNumber}`,
  ];
}

/**
 * Convert win to PS protocol
 */
export function winToProtocol(winner: string): string[] {
  return [
    `|win|${winner}`,
  ];
}

/**
 * Convert tie to PS protocol
 */
export function tieToProtocol(): string[] {
  return [
    `|tie`,
  ];
}

/**
 * Convert our log entries to PS protocol
 */
export function logToProtocol(log: BattleLog): string[] {
  switch (log.type) {
    case 'move':
      return [`|move|${log.details.attacker}|${log.details.move}|${log.details.target}`];
    case 'damage':
      return [`|-damage|${log.details.target}|${log.details.hp}`];
    case 'heal':
      return [`|-heal|${log.details.target}|${log.details.hp}`];
    case 'faint':
      return [`|faint|${log.details.pokemon}`];
    case 'switch':
      return [`|switch|${log.details.pokemon}|${log.details.details}|${log.details.hp}`];
    case 'status':
      return [`|-status|${log.details.pokemon}|${log.details.status}`];
    case 'boost':
      return [`|-boost|${log.details.pokemon}|${log.details.stat}|${log.details.stages}`];
    case 'unboost':
      return [`|-unboost|${log.details.pokemon}|${log.details.stat}|${log.details.stages}`];
    case 'weather':
      return [`|-weather|${log.details.weather}`];
    case 'message':
    case 'info':
      return [`|-message|${log.message}`];
    default:
      return [`|-message|${log.message || log.type}`];
  }
}

/**
 * Convert a request to PS format for the choice UI
 */
export function requestToPS(
  side: 'p1' | 'p2',
  player: ServerPlayer,
  forceSwitch?: boolean
): any {
  const pokemon = player.team.map((poke, idx) => {
    const isActive = idx === player.activeIndex;
    const maxHP = poke.stats?.hp ?? 100;
    
    return {
      ident: pokemonIdent(side, poke),
      details: pokemonDetails(poke),
      condition: pokemonCondition(poke),
      active: isActive,
      stats: poke.stats,
      moves: poke.moves.map(move => ({
        move: move,
        id: move.toLowerCase().replace(/[^a-z0-9]/g, ''),
        pp: 16, // Default PP, would need actual tracking
        maxpp: 16,
        target: 'normal',
        disabled: false,
      })),
      baseAbility: poke.ability,
      item: poke.item || '',
      pokeball: 'pokeball',
      ability: poke.ability,
      commanding: false,
      reviving: false,
      teraType: poke.terastallized || '',
      terastallized: poke.terastallized || '',
      // Additional fields for tooltips
      speciesForme: poke.species,
      species: poke.species,
      name: poke.name || poke.species,
      level: poke.level || 100,
      gender: poke.gender || '',
      shiny: poke.shiny || false,
      hp: poke.currentHP ?? maxHP,
      maxhp: maxHP,
      fainted: (poke.currentHP ?? maxHP) <= 0,
      status: poke.status || '',
    };
  });
  
  const active = player.team[player.activeIndex];
  
  const request: any = {
    side: {
      id: side,
      name: player.name || player.id,
      pokemon,
    },
  };
  
  if (forceSwitch) {
    request.requestType = 'switch';
    request.forceSwitch = [true];
  } else {
    request.requestType = 'move';
    request.active = [{
      moves: active.moves.map((move, idx) => ({
        move: move,
        id: move.toLowerCase().replace(/[^a-z0-9]/g, ''),
        pp: 16,
        maxpp: 16,
        target: 'normal',
        disabled: false,
      })),
      canMegaEvo: false,
      canZMove: false,
      canDynamax: false,
      canTerastallize: false,
      maxMoves: null,
      zMoves: null,
    }];
  }
  
  return request;
}

/**
 * Full state converter - takes our server state and produces full PS protocol
 */
export class ProtocolConverter {
  private lastState: ServerBattleState | null = null;
  private initialized = false;
  
  /**
   * Convert a full state update to PS protocol lines
   */
  convertStateUpdate(state: ServerBattleState): string[] {
    const lines: string[] = [];
    
    // First update - send initialization
    if (!this.initialized) {
      lines.push(...stateToProtocol(state));
      
      // Send initial switches for each player's active
      state.players.forEach((player, idx) => {
        const side = `p${idx + 1}`;
        const active = player.team[player.activeIndex];
        if (active) {
          lines.push(...switchToProtocol(side, active));
        }
      });
      
      this.initialized = true;
      this.lastState = state;
      return lines;
    }
    
    // Check what changed since last state
    if (this.lastState) {
      // Turn changed
      if (state.turn !== this.lastState.turn) {
        lines.push(...turnToProtocol(state.turn));
      }
      
      // Weather changed
      if (state.weather !== this.lastState.weather) {
        lines.push(...weatherToProtocol(state.weather || ''));
      }
      
      // Terrain changed
      if (state.terrain !== this.lastState.terrain) {
        lines.push(...terrainToProtocol(state.terrain || ''));
      }
      
      // Check each player
      state.players.forEach((player, pIdx) => {
        const side = `p${pIdx + 1}`;
        const lastPlayer = this.lastState!.players[pIdx];
        
        if (!lastPlayer) return;
        
        // Active Pokemon changed (switch)
        if (player.activeIndex !== lastPlayer.activeIndex) {
          const newActive = player.team[player.activeIndex];
          if (newActive) {
            lines.push(...switchToProtocol(side, newActive));
          }
        }
        
        // Check each Pokemon for changes
        player.team.forEach((poke, pokeIdx) => {
          const lastPoke = lastPlayer.team[pokeIdx];
          if (!lastPoke) return;
          
          // HP changed
          if (poke.currentHP !== lastPoke.currentHP) {
            if (poke.currentHP < lastPoke.currentHP) {
              lines.push(...damageToProtocol(side, poke));
            } else {
              lines.push(...healToProtocol(side, poke));
            }
            
            // Fainted
            if (poke.currentHP <= 0 && lastPoke.currentHP > 0) {
              lines.push(...faintToProtocol(side, poke));
            }
          }
          
          // Status changed
          if (poke.status !== lastPoke.status && poke.status) {
            lines.push(...statusToProtocol(side, poke, poke.status));
          }
          
          // Boosts changed
          if (poke.boosts && lastPoke.boosts) {
            for (const stat of ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion']) {
              const current = poke.boosts[stat] || 0;
              const last = lastPoke.boosts[stat] || 0;
              if (current !== last) {
                lines.push(...boostToProtocol(side, poke, stat, current - last));
              }
            }
          }
        });
      });
    }
    
    this.lastState = state;
    return lines;
  }
  
  /**
   * Convert log entries
   */
  convertLogs(logs: BattleLog[]): string[] {
    const lines: string[] = [];
    for (const log of logs) {
      lines.push(...logToProtocol(log));
    }
    return lines;
  }
  
  /**
   * Reset converter state
   */
  reset() {
    this.lastState = null;
    this.initialized = false;
  }
}
