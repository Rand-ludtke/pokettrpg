/**
 * Fusion Types - TypeScript interfaces for Infinite Fusion mechanics
 * 
 * These types match the Rust backend state for seamless sync
 */

/** Connection status for the Rust sync layer */
export type ConnectionStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/** Fusion sprite information */
export interface FusionSprite {
  /** Head Pokemon ID (national dex number) */
  headId: number;
  /** Body Pokemon ID (national dex number) */
  bodyId: number;
  /** Currently selected sprite filename */
  spriteFile: string;
  /** Available variant filenames for this fusion */
  variants: string[];
  /** Optional custom sprite URL (AI-generated or uploaded) */
  customUrl?: string;
}

/** Response from get_fusion_variants command */
export interface FusionVariantsResponse {
  headId: number;
  bodyId: number;
  variants: string[];
  currentSelection?: string;
}

/** Calculated fusion stats */
export interface FusionStats {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

/** Pokemon base stats for fusion calculation */
export interface PokemonStats {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

/** Result of sprite index build */
export interface IndexBuildResult {
  spriteCount: number;
  fusionCount: number;
}

/** Fusion sprite parsed info */
export interface FusionSpriteInfo {
  filename: string;
  headId: number;
  bodyId: number;
  variant?: string;
  isCustom: boolean;
}

/** Complete fusion result with calculated stats */
export interface FusionResult {
  /** Resulting fusion name */
  name: string;
  /** Head Pokemon info */
  head: {
    id: number;
    name: string;
  };
  /** Body Pokemon info */
  body: {
    id: number;
    name: string;
  };
  /** Calculated base stats */
  stats: FusionStats;
  /** Primary type */
  type1: string;
  /** Secondary type */
  type2?: string;
  /** Available abilities */
  abilities: string[];
}

/**
 * Sync events emitted from Rust to JS
 * Listen with: listen('sync-event', handler)
 */
export type SyncEvent = 
  | { type: 'ConnectionChanged'; payload: { status: ConnectionStatus } }
  | { type: 'FusionVariantsLoaded'; payload: { headId: number; bodyId: number; variants: string[] } }
  | { type: 'FusionSpriteSelected'; payload: { headId: number; bodyId: number; spriteFile: string; playerId?: string } }
  | { type: 'BattleUpdated'; payload: { roomId: string; state: any } }
  | { type: 'FullSyncCompleted'; payload: { timestamp: number } }
  | { type: 'Error'; payload: { message: string } };

/** Player info with fusion data */
export interface FusionPlayerInfo {
  id: string;
  username?: string;
  trainerSprite?: string;
  avatar?: string;
  /** Active fusion pokemon for this player */
  fusions: Record<string, FusionSprite>;
}

/**
 * Fusion naming conventions (following Infinite Fusion Calculator)
 * 
 * The fusion name is created by combining parts of the head and body names:
 * - First 3-4 characters from head Pokemon name
 * - Last 3-4 characters from body Pokemon name
 * 
 * Examples:
 * - Pikachu + Bulbasaur = Pikasaur
 * - Charizard + Blastoise = Chartoise
 */
export function generateFusionName(headName: string, bodyName: string): string {
  const headPart = headName.slice(0, Math.ceil(headName.length / 2));
  const bodyPart = bodyName.slice(Math.floor(bodyName.length / 2));
  return headPart + bodyPart;
}

/**
 * Calculate fusion stats following Infinite Fusion formula
 */
export function calculateFusionStats(head: PokemonStats, body: PokemonStats): FusionStats {
  return {
    // HP: head 1/3, body 2/3
    hp: Math.floor(head.hp / 3) + Math.floor((2 * body.hp) / 3),
    // Attack: head 2/3, body 1/3
    attack: Math.floor((2 * head.attack) / 3) + Math.floor(body.attack / 3),
    // Defense: head 1/3, body 2/3
    defense: Math.floor(head.defense / 3) + Math.floor((2 * body.defense) / 3),
    // Sp. Attack: head 2/3, body 1/3
    spAttack: Math.floor((2 * head.spAttack) / 3) + Math.floor(body.spAttack / 3),
    // Sp. Defense: head 1/3, body 2/3
    spDefense: Math.floor(head.spDefense / 3) + Math.floor((2 * body.spDefense) / 3),
    // Speed: average
    speed: Math.floor((head.speed + body.speed) / 2),
  };
}

/**
 * Generate fusion sprite filename
 */
export function getFusionSpriteFilename(headId: number, bodyId: number, variant?: string): string {
  if (variant) {
    const isAlphaSuffix = /^[A-Za-z]+$/.test(variant);
    return isAlphaSuffix
      ? `${headId}.${bodyId}${variant}.png`
      : `${headId}.${bodyId}_${variant}.png`;
  }
  return `${headId}.${bodyId}.png`;
}

/**
 * Parse fusion sprite filename
 */
export function parseFusionSpriteFilename(filename: string): { headId: number; bodyId: number; variant?: string } | null {
  const match = filename.match(/^(\d+)\.(\d+)(?:_([A-Za-z0-9]+)|([A-Za-z]+))?\.png$/);
  if (!match) return null;

  return {
    headId: parseInt(match[1], 10),
    bodyId: parseInt(match[2], 10),
    variant: match[3] || match[4],
  };
}
