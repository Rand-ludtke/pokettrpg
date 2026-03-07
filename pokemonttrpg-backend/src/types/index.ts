export type TypeName = string;

export type Category = "Physical" | "Special" | "Status";

export type NonVolatileStatusId = "none" | "burn" | "poison" | "toxic" | "paralysis" | "sleep" | "freeze";

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface StatStages {
  hp?: number;
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
  acc?: number;
  eva?: number;
  [key: string]: number | undefined;
}

export interface AnimationEvent {
  type: string;
  payload?: Record<string, unknown>;
}

export type LogSink = (message: string) => void;

export interface MoveUseContext {
  state: BattleState;
  user: Pokemon;
  target: Pokemon;
  move?: Move;
  log: LogSink;
  utils: EngineUtils;
}

export interface Move {
  id: string;
  name: string;
  type: TypeName;
  category: Category;
  power?: number;
  accuracy?: number | true;
  priority?: number;
  target?: string;
  effect?: string;
  secondary?: { chance?: number; status?: string; boosts?: Record<string, number> } | null;
  onUse?: (ctx: MoveUseContext) => void;
  multiHit?: number | [number, number];
  switchesUserOut?: boolean;
  [key: string]: unknown;
}

export interface SideHazards {
  stealthRock?: boolean;
  spikesLayers?: number;
  toxicSpikesLayers?: number;
  stickyWeb?: boolean;
  [key: string]: unknown;
}

export interface SideConditions {
  tailwindTurns?: number;
  reflectTurns?: number;
  lightScreenTurns?: number;
  [key: string]: unknown;
}

export interface Pokemon {
  id: string;
  name: string;
  species?: string;
  level: number;
  types: TypeName[];
  baseStats: Stats;
  currentHP: number;
  maxHP: number;
  stages: StatStages;
  status: NonVolatileStatusId;
  volatile?: Record<string, any>;
  moves: Move[];
  ability?: string;
  item?: string;
  gender?: "M" | "F" | "N";
  shiny?: boolean;
  nature?: string;
  teraType?: string;
  evs?: Partial<Stats>;
  ivs?: Partial<Stats>;
  trainerSprite?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface Player {
  id: string;
  name: string;
  team: Pokemon[];
  activeIndex: number;
  sideHazards?: SideHazards;
  sideConditions?: SideConditions;
  [key: string]: unknown;
}

export interface TimedFieldEffect {
  id: string;
  turnsLeft: number;
}

export interface BattleField {
  weather: TimedFieldEffect;
  terrain: TimedFieldEffect;
  room: TimedFieldEffect;
  magicRoom: TimedFieldEffect;
  wonderRoom: TimedFieldEffect;
}

export interface StartFieldConditions {
  weather?: Partial<TimedFieldEffect>;
  terrain?: Partial<TimedFieldEffect>;
  room?: Partial<TimedFieldEffect>;
  magicRoom?: Partial<TimedFieldEffect>;
  wonderRoom?: Partial<TimedFieldEffect>;
}

export interface StartSideConditions {
  sideHazards?: SideHazards;
  sideConditions?: SideConditions;
}

export interface BattleStartConditions {
  field?: StartFieldConditions;
  side1?: StartSideConditions;
  side2?: StartSideConditions;
  sides?: StartSideConditions[];
}

export interface BattleInitializeOptions {
  seed?: number;
  startConditions?: BattleStartConditions;
}

export interface BattleState {
  turn: number;
  rngSeed?: number;
  players: Player[];
  field: BattleField;
  log: string[];
  coinFlipWinner?: string;
  [key: string]: unknown;
}

export interface MoveAction {
  type: "move";
  actorPlayerId: string;
  pokemonId: string;
  moveId: string;
  targetPokemonId?: string;
  targetPlayerId?: string;
  playerId?: string;
  mega?: boolean;
  zmove?: boolean;
  dynamax?: boolean;
  terastallize?: boolean;
}

export interface SwitchAction {
  type: "switch";
  actorPlayerId: string;
  pokemonId: string;
  toIndex: number;
  playerId?: string;
}

export type BattleAction = MoveAction | SwitchAction;
export type Action = BattleAction;

export interface TurnResult {
  state: BattleState;
  events: string[];
  anim: AnimationEvent[];
  winner?: string;
  [key: string]: unknown;
}

export interface EngineUtils {
  rng: () => number;
  dealDamage: (pokemon: Pokemon, amount: number) => number;
  heal: (pokemon: Pokemon, amount: number) => number;
  applyStatus: (pokemon: Pokemon, status: NonVolatileStatusId) => void;
  modifyStatStages: (pokemon: Pokemon, changes: Partial<StatStages>) => void;
  getEffectiveSpeed?: (pokemon: Pokemon) => number;
  getEffectiveAttack?: (pokemon: Pokemon, category: Category) => number;
  emitAnim?: (event: AnimationEvent) => void;
}

export interface BattleRuleset {
  initializeBattle: (players: Player[], options?: BattleInitializeOptions) => BattleState | Promise<BattleState>;
  processTurn: (actions: BattleAction[]) => TurnResult | Promise<TurnResult>;
}

export interface StatusEffectSpec {
  id: string;
  name: string;
  onAttackStatMultiplier?: (pokemon: Pokemon, state: BattleState) => number;
  onEndOfTurn?: (pokemon: Pokemon, state: BattleState, log: LogSink) => void;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function stageMultiplier(stage: number, posBase = 2, negBase = 2): number {
  const s = clamp(Math.floor(stage), -6, 6);
  if (s >= 0) return (posBase + s) / posBase;
  return negBase / (negBase + Math.abs(s));
}
