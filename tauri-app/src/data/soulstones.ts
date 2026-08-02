import { BattlePokemon } from '../types';
import { calculateHp } from '../rules';

// Soulstone types: Crystal, Cosmic, Nuclear, Stellar, Light, Sound
const SOULSTONE_TYPES = ['Crystal', 'Cosmic', 'Nuclear', 'Stellar', 'Light', 'Sound'] as const;
export type SoulstoneType = typeof SOULSTONE_TYPES[number];

interface SoulstoneEntry {
  name: string;
  species: string;
  types: [SoulstoneType, SoulstoneType];
  baseStats: { hp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number };
  moves: Array<{ name: string; type: string; power: number; category: 'Physical' | 'Special' | 'Status'; effect?: string }>;
}

export const SOULSTONE_POKEMON: SoulstoneEntry[] = [
  {
    name: 'Amethystor',
    species: 'Amethystor',
    types: ['Crystal', 'Light'],
    baseStats: { hp: 75, atk: 60, def: 70, spAtk: 120, spDef: 85, speed: 90 },
    moves: [
      { name: 'Crystal Beam', type: 'Crystal', power: 65, category: 'Special' },
      { name: 'Light Ray', type: 'Light', power: 80, category: 'Special' },
      { name: 'Prismatic Shield', type: 'Crystal', power: 0, category: 'Status', effect: 'Defense Boost' },
      { name: 'Reflect', type: 'Light', power: 0, category: 'Status', effect: 'Reflect' },
    ],
  },
  {
    name: 'Cosmivine',
    species: 'Cosmivine',
    types: ['Cosmic', 'Sound'],
    baseStats: { hp: 85, atk: 70, def: 65, spAtk: 115, spDef: 90, speed: 75 },
    moves: [
      { name: 'Cosmic Pulse', type: 'Cosmic', power: 70, category: 'Special' },
      { name: 'Sonic Boom', type: 'Sound', power: 60, category: 'Special' },
      { name: 'Resonant Wave', type: 'Sound', power: 0, category: 'Status', effect: 'Confusion' },
      { name: 'Gravity Spin', type: 'Cosmic', power: 50, category: 'Physical' },
    ],
  },
  {
    name: 'Nuclearis',
    species: 'Nuclearis',
    types: ['Nuclear', 'Cosmic'],
    baseStats: { hp: 90, atk: 115, def: 80, spAtk: 75, spDef: 65, speed: 95 },
    moves: [
      { name: 'Radiation Pulse', type: 'Nuclear', power: 85, category: 'Special' },
      { name: 'Cosmic Crush', type: 'Cosmic', power: 70, category: 'Physical' },
      { name: 'Fallout Burst', type: 'Nuclear', power: 60, category: 'Special' },
      { name: 'Gamma Wave', type: 'Nuclear', power: 0, category: 'Status', effect: 'Toxic' },
    ],
  },
  {
    name: 'Stellara',
    species: 'Stellara',
    types: ['Stellar', 'Crystal'],
    baseStats: { hp: 70, atk: 45, def: 95, spAtk: 130, spDef: 115, speed: 65 },
    moves: [
      { name: 'Starfall', type: 'Stellar', power: 90, category: 'Special' },
      { name: 'Crystal Ward', type: 'Crystal', power: 0, category: 'Status', effect: 'Protect' },
      { name: 'Luminous Surge', type: 'Light', power: 75, category: 'Special' },
      { name: 'Stellar Guard', type: 'Stellar', power: 0, category: 'Status', effect: 'Counter' },
    ],
  },
  {
    name: 'Lumineth',
    species: 'Lumineth',
    types: ['Light', 'Sound'],
    baseStats: { hp: 80, atk: 75, def: 60, spAtk: 125, spDef: 95, speed: 110 },
    moves: [
      { name: 'Radiant Chord', type: 'Light', power: 70, category: 'Special' },
      { name: 'Echo Burst', type: 'Sound', power: 80, category: 'Special' },
      { name: 'Harmonic Ray', type: 'Light', power: 60, category: 'Physical' },
      { name: 'Symphony of Light', type: 'Sound', power: 100, category: 'Special' },
    ],
  },
  {
    name: 'Sonix',
    species: 'Sonix',
    types: ['Sound', 'Nuclear'],
    baseStats: { hp: 75, atk: 100, def: 85, spAtk: 60, spDef: 90, speed: 80 },
    moves: [
      { name: 'Decibel Shock', type: 'Sound', power: 75, category: 'Physical' },
      { name: 'Isotope Quake', type: 'Nuclear', power: 65, category: 'Physical' },
      { name: 'Frequency Scan', type: 'Sound', power: 0, category: 'Status', effect: 'Reveal' },
      { name: 'Radioactive Howl', type: 'Nuclear', power: 80, category: 'Special' },
    ],
  },
];

// Convert soulstone entries to BattlePokemon for the dex
export const SOULSTONE_BATTLE_POKEMON: BattlePokemon[] = SOULSTONE_POKEMON.map((p, idx) => ({
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

// For use in path selection / generation
export const SOULSTONE_TYPE_NAMES = ['Crystal', 'Cosmic', 'Nuclear', 'Stellar', 'Light', 'Sound'] as const;
