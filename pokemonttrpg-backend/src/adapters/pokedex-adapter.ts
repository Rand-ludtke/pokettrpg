import { Move, Player, Pokemon, Stats, TypeName } from "../types";

// Define a minimal external dex format contract that we can map from.
// You can refine these to exactly match your pokedex.ts structure.
export interface ExternalMove {
  id: string;
  name: string;
  type: TypeName;
  category: "Physical" | "Special" | "Status";
  basePower?: number;
  accuracy?: number;
  priority?: number;
}

export interface ExternalAbility {
  id: string;
  name: string;
  desc?: string;
  shortDesc?: string;
}

export interface ExternalSpecies {
  id: string;
  name: string;
  types: TypeName[];
  // Support either spa/spd or spA/spD keys; we'll normalize below.
  baseStats: any; // hp/atk/def/(spa|spA)/(spd|spD)/spe
  moves: string[]; // list of move ids
}

export interface ExternalDexData {
  species: Record<string, ExternalSpecies>;
  moves: Record<string, ExternalMove>;
  abilities?: Record<string, ExternalAbility>;
  items?: Record<string, any>;
}

export interface ExternalTeamPokemon {
  speciesId: string;
  level?: number;
  nickname?: string;
  moves: string[]; // move ids
}

export interface ExternalTeam {
  playerId: string;
  name: string;
  party: ExternalTeamPokemon[];
}

export function mapMove(ext: ExternalMove): Move {
  return {
    id: ext.id,
    name: ext.name,
    type: ext.type,
    category: (ext.category as any)?.toString?.().toLowerCase?.() === "status"
      ? "Status"
      : (ext.category as any)?.toString?.().toLowerCase?.() === "special"
      ? "Special"
      : "Physical",
    power: typeof ext.basePower === "number" ? ext.basePower : undefined,
    accuracy: typeof ext.accuracy === "number" ? ext.accuracy : undefined,
    priority: ext.priority ?? 0,
  };
}

function normalizeStats(raw: any): Stats {
  const spa = raw.spa ?? raw.spA ?? raw.SpA ?? raw.specialAttack ?? 50;
  const spd = raw.spd ?? raw.spD ?? raw.SpD ?? raw.specialDefense ?? 50;
  return {
    hp: raw.hp ?? raw.HP ?? raw.Hp ?? 50,
    atk: raw.atk ?? raw.atk ?? raw.ATK ?? raw.attack ?? 50,
    def: raw.def ?? raw.DEF ?? raw.defense ?? 50,
    spa,
    spd,
    spe: raw.spe ?? raw.SPE ?? raw.speed ?? 50,
  } as Stats;
}

export function mapPokemon(idPrefix: string, idx: number, sp: ExternalSpecies, tp: ExternalTeamPokemon, moveMap: (id: string) => Move): Pokemon {
  const name = tp.nickname || sp.name;
  const level = tp.level ?? 50;
  const moves = tp.moves.map(moveMap).filter(Boolean);
  const baseStats = normalizeStats(sp.baseStats);
  const maxHP = baseStats.hp;
  return {
    id: `${idPrefix}-${idx}`,
    name,
    level,
    types: sp.types,
    baseStats,
    currentHP: maxHP,
    maxHP,
    stages: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    status: "none",
    volatile: {},
    moves,
  };
}

export function mapTeamToPlayer(team: ExternalTeam, dex: ExternalDexData): Player {
  const moveMap = (id: string) => mapMove(dex.moves[id]);
  const speciesMap = (id: string) => dex.species[id];
  const mons = team.party.map((tp, i) => mapPokemon(team.playerId, i + 1, speciesMap(tp.speciesId), tp, moveMap));
  return {
    id: team.playerId,
    name: team.name,
    team: mons,
    activeIndex: 0,
  };
}

export function mapMatchToPlayers(teams: [ExternalTeam, ExternalTeam], dex: ExternalDexData): Player[] {
  return [mapTeamToPlayer(teams[0], dex), mapTeamToPlayer(teams[1], dex)];
}
