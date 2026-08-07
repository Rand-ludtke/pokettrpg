import { BattlePokemon, Pokemon } from '../types';
import { calculateHp } from '../rules';

// Soulstones Part 1 - Numeric naming system (000.png, 001.png, etc.)
// These are the original soulstone Pokémon from Part 1

interface SoulstonePart1Entry {
  name: string;
  species: string;
  types: [string, string];
  baseStats: { hp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number };
  moves: Array<{ name: string; type: string; power: number; category: 'Physical' | 'Special' | 'Status'; effect?: string }>;
}

// Soulstone Part 1 Pokémon (starting from dex number 801)
export const SOULSTONE_PART1_POKEMON: SoulstonePart1Entry[] = [
  // Solosis line - Crystal types
  {
    name: 'Solosis',
    species: 'Solosis',
    types: ['Crystal', 'Psychic'],
    baseStats: { hp: 45, atk: 20, def: 60, spAtk: 100, spDef: 85, speed: 36 },
    moves: [
      { name: 'Confusion', type: 'Psychic', power: 50, category: 'Special' },
      { name: 'Crystal Beam', type: 'Crystal', power: 65, category: 'Special' },
      { name: 'Heal Block', type: 'Psychic', power: 0, category: 'Status', effect: 'Prevents healing' },
      { name: 'Reflect', type: 'Psychic', power: 0, category: 'Status', effect: 'Reduces physical damage' },
    ],
  },
  {
    name: 'Duosion',
    species: 'Duosion',
    types: ['Crystal', 'Psychic'],
    baseStats: { hp: 65, atk: 35, def: 70, spAtk: 120, spDef: 100, speed: 46 },
    moves: [
      { name: 'Psybeam', type: 'Psychic', power: 65, category: 'Special' },
      { name: 'Crystal Beam', type: 'Crystal', power: 75, category: 'Special' },
      { name: 'Magic Room', type: 'Psychic', power: 0, category: 'Status', effect: 'Negates held items' },
      { name: 'Stored Power', type: 'Psychic', power: 20, category: 'Special', effect: 'Power increases with stat boosts' },
    ],
  },
  {
    name: 'Reuniclus',
    species: 'Reuniclus',
    types: ['Crystal', 'Psychic'],
    baseStats: { hp: 85, atk: 40, def: 90, spAtk: 140, spDef: 120, speed: 56 },
    moves: [
      { name: 'Psyshock', type: 'Psychic', power: 80, category: 'Special' },
      { name: 'Crystal Pulse', type: 'Crystal', power: 90, category: 'Special' },
      { name: 'Trick Room', type: 'Psychic', power: 0, category: 'Status', effect: 'Slower Pokémon move first' },
      { name: 'Recover', type: 'Normal', power: 0, category: 'Status', effect: 'Restores 50% HP' },
    ],
  },
  // Gastly line - Cosmic types
  {
    name: 'Gastly',
    species: 'Gastly',
    types: ['Cosmic', 'Ghost'],
    baseStats: { hp: 30, atk: 35, def: 30, spAtk: 100, spDef: 70, speed: 80 },
    moves: [
      { name: 'Lick', type: 'Ghost', power: 30, category: 'Physical' },
      { name: 'Cosmic Pulse', type: 'Cosmic', power: 60, category: 'Special' },
      { name: 'Confuse Ray', type: 'Ghost', power: 0, category: 'Status', effect: 'Confuses target' },
      { name: 'Night Shade', type: 'Ghost', power: 50, category: 'Special', effect: 'Deals damage equal to level' },
    ],
  },
  {
    name: 'Haunter',
    species: 'Haunter',
    types: ['Cosmic', 'Ghost'],
    baseStats: { hp: 45, atk: 50, def: 45, spAtk: 115, spDef: 85, speed: 95 },
    moves: [
      { name: 'Shadow Ball', type: 'Ghost', power: 80, category: 'Special' },
      { name: 'Cosmic Blast', type: 'Cosmic', power: 75, category: 'Special' },
      { name: 'Dream Eater', type: 'Psychic', power: 100, category: 'Special', effect: 'Drains sleeping target\'s HP' },
      { name: 'Dark Pulse', type: 'Dark', power: 80, category: 'Special', effect: 'May cause flinch' },
    ],
  },
  {
    name: 'Gengar',
    species: 'Gengar',
    types: ['Cosmic', 'Ghost'],
    baseStats: { hp: 60, atk: 65, def: 60, spAtk: 130, spDef: 95, speed: 110 },
    moves: [
      { name: 'Shadow Ball', type: 'Ghost', power: 80, category: 'Special' },
      { name: 'Cosmic Shock', type: 'Cosmic', power: 90, category: 'Special' },
      { name: 'Dark Pulse', type: 'Dark', power: 80, category: 'Special', effect: 'May cause flinch' },
      { name: 'Perish Song', type: 'Ghost', power: 0, category: 'Status', effect: 'Faints all Pokémon in 3 turns' },
    ],
  },
  // Doduo line - Stellar types
  {
    name: 'Doduo',
    species: 'Doduo',
    types: ['Stellar', 'Flying'],
    baseStats: { hp: 35, atk: 85, def: 45, spAtk: 35, spDef: 35, speed: 75 },
    moves: [
      { name: 'Peck', type: 'Flying', power: 35, category: 'Physical' },
      { name: 'Starfall', type: 'Stellar', power: 60, category: 'Special' },
      { name: 'Rage', type: 'Normal', power: 20, category: 'Physical', effect: 'Increases attack on hit' },
      { name: 'Quick Attack', type: 'Normal', power: 40, category: 'Physical', effect: 'Priority move' },
    ],
  },
  {
    name: 'Dodrio',
    species: 'Dodrio',
    types: ['Stellar', 'Flying'],
    baseStats: { hp: 60, atk: 110, def: 70, spAtk: 60, spDef: 60, speed: 100 },
    moves: [
      { name: 'Tri Attack', type: 'Normal', power: 80, category: 'Special' },
      { name: 'Starfall Strike', type: 'Stellar', power: 95, category: 'Physical' },
      { name: 'Drill Peck', type: 'Flying', power: 80, category: 'Physical' },
      { name: 'Agility', type: 'Psychic', power: 0, category: 'Status', effect: 'Sharply increases speed' },
    ],
  },
];

// Convert soulstone part1 entries to BattlePokemon for the dex
export const SOULSTONE_PART1_BATTLE_POKEMON: BattlePokemon[] = SOULSTONE_PART1_POKEMON.map((p, idx) => ({
  name: p.name,
  species: p.species,
  level: 50,
  types: p.types,
  baseStats: p.baseStats,
  moves: p.moves.map(m => ({ ...m })),
  maxHp: calculateHp(p.baseStats.hp, 50),
  currentHp: calculateHp(p.baseStats.hp, 50),
  statStages: { atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 },
  dexId: 801 + idx, // Start at 801 to avoid conflicts
}));

// Sprite mapping for Part 1 (numeric naming: 000.png, 001.png, etc.)
export const SOULSTONE_PART1_SPRITE_MAP: Record<string, string> = {
  'Solosis': '000',
  'Duosion': '001',
  'Reuniclus': '002',
  'Gastly': '003',
  'Haunter': '004',
  'Gengar': '005',
  'Doduo': '006',
  'Dodrio': '007',
};

// Helper function to get sprite ID for Part 1 soulstones
export function getPart1SpriteId(speciesName: string): string | null {
  const normalized = speciesName.toLowerCase();
  for (const [species, spriteId] of Object.entries(SOULSTONE_PART1_SPRITE_MAP)) {
    if (normalized === species.toLowerCase()) {
      return spriteId;
    }
  }
  return null;
}
