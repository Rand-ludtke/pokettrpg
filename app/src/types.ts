export type Category = 'Physical' | 'Special' | 'Status';

export interface Move {
  name: string;
  type: string;
  power: number; // base move power
  category: Category;
  effect?: string;
  accuracy?: number | true; // true = always hits (per Showdown semantics)
  secondary?: { chance?: number; status?: string; boosts?: Record<string, number> } | null;
}

export interface Pokemon {
  name: string;
  // canonical species name (distinct from nickname 'name')
  species?: string;
  // cosmetic sprite-only override (does not change stats/species)
  cosmeticForm?: string;
  level: number;
  types: string[];
  gender?: 'M' | 'F' | 'N';
  ability?: string; // ability name
  item?: string; // held item name
  shiny?: boolean; // shiny flag
  nature?: string; // e.g., Adamant; placeholder for future
  evs?: Partial<{ hp: number; atk: number; def: number; spa: number; spd: number; spe: number }>;
  ivs?: Partial<{ hp: number; atk: number; def: number; spa: number; spd: number; spe: number }>;
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    spAtk: number;
    spDef: number;
    speed: number;
  };
  moves: Move[];
}

export interface BattlePokemon extends Pokemon {
  maxHp: number;
  currentHp: number;
  computedStats?: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  statStages: {
    atk: number;
    def: number;
    spAtk: number;
    spDef: number;
    speed: number;
  };
}
