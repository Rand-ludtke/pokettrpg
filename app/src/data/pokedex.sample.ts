import { BattlePokemon, Pokemon } from '../types';
import { calculateHp } from '../rules';

const base: Pokemon[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    level: 5,
    types: ['Grass', 'Poison'],
    baseStats: { hp: 45, atk: 49, def: 49, spAtk: 65, spDef: 65, speed: 45 },
    moves: [
      { name: 'Tackle', type: 'Normal', power: 40, category: 'Physical' },
      { name: 'Vine Whip', type: 'Grass', power: 45, category: 'Physical' },
      { name: 'Leech Seed', type: 'Grass', power: 0, category: 'Status', effect: 'Leech Seed' },
    ],
  },
  {
    name: 'Charmander',
    species: 'Charmander',
    level: 5,
    types: ['Fire'],
    baseStats: { hp: 39, atk: 52, def: 43, spAtk: 60, spDef: 50, speed: 65 },
    moves: [
      { name: 'Scratch', type: 'Normal', power: 40, category: 'Physical' },
      { name: 'Ember', type: 'Fire', power: 40, category: 'Special' },
      { name: 'Smokescreen', type: 'Normal', power: 0, category: 'Status' },
    ],
  },
  {
    name: 'Squirtle',
    species: 'Squirtle',
    level: 5,
    types: ['Water'],
    baseStats: { hp: 44, atk: 48, def: 65, spAtk: 50, spDef: 64, speed: 43 },
    moves: [
      { name: 'Tackle', type: 'Normal', power: 40, category: 'Physical' },
      { name: 'Water Gun', type: 'Water', power: 40, category: 'Special' },
      { name: 'Tail Whip', type: 'Normal', power: 0, category: 'Status' },
    ],
  },
];

export const samplePokedex: BattlePokemon[] = base.map(p => ({
  ...p,
  maxHp: calculateHp(p.baseStats.hp, p.level),
  currentHp: calculateHp(p.baseStats.hp, p.level),
  statStages: { atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 },
}));
