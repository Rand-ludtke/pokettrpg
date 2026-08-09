/**
 * generate-soulstones-part1.mjs
 *
 * Generates JSON data files for Soulstones Part 1 Pokémon.
 * These are from a different game (Soulstones Part 1) and use
 * Crystal/Cosmic/Stellar types, distinct from Orion/Temporal forms.
 *
 * Output:
 *   tauri-app/public/data/soulstones-part1/generated/pokedex.soulstones-part1.json
 *   tauri-app/public/data/soulstones-part1/generated/learnsets.soulstones-part1.json
 *   tauri-app/public/data/soulstones-part1/generated/moves.custom.soulstones-part1.json
 *   tauri-app/public/data/soulstones-part1/generated/abilities.custom.soulstones-part1.json
 *
 * Run: node tauri-app/scripts/generate-soulstones-part1.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'data', 'soulstones-part1', 'generated');

// ─── Species Data (from soulstones-part1.ts) ─────────────────────────────────

// Starting dex number (negative to avoid conflicts)
const S1_BASE_NUM = -20001;

const POKEMON = [
  // ── Solosis line – Crystal/Psychic ──────────────────────────────────────
  {
    key: 'solosiss1',
    name: 'Solosis (S1)',
    baseSpecies: 'Solosis',
    forme: 'S1',
    types: ['Crystal', 'Psychic'],
    baseStats: { hp: 45, atk: 20, def: 60, spa: 100, spd: 85, spe: 36 },
    abilities: { '0': 'Magic Bounce', 'H': 'Technician' },
    evos: ['duosions1'],
    color: 'Green',
    gen: 9,
    moves: [
      { id: 'confusion',   level: 1  },
      { id: 'watersport',  level: 1  },
      { id: 'crystalbeam', level: 5  },
      { id: 'healblock',   level: 8  },
      { id: 'reflect',     level: 12 },
      { id: 'psybeam',     level: 16 },
      { id: 'crystalpulse',level: 20 },
      { id: 'psyshock',    level: 26 },
      { id: 'calmmind',    level: 32 },
      { id: 'psychic',     level: 38 },
      { id: 'storedpower', level: 44 },
      { id: 'trickroom',   level: 52 },
    ],
    tutorMoves: ['psychic', 'calmmind', 'reflect', 'lightscreen', 'protect', 'rest', 'sleeptalk'],
    eggMoves: ['guardswap', 'powerswap', 'trick'],
  },
  {
    key: 'duosions1',
    name: 'Duosion (S1)',
    baseSpecies: 'Duosion',
    forme: 'S1',
    types: ['Crystal', 'Psychic'],
    baseStats: { hp: 65, atk: 35, def: 70, spa: 120, spd: 100, spe: 46 },
    abilities: { '0': 'Magic Bounce', 'H': 'Regenerator' },
    prevo: 'solosiss1',
    evoLevel: 32,
    evos: ['reunicluss1'],
    color: 'Green',
    gen: 9,
    moves: [
      { id: 'confusion',   level: 1  },
      { id: 'crystalbeam', level: 1  },
      { id: 'healblock',   level: 8  },
      { id: 'reflect',     level: 12 },
      { id: 'psybeam',     level: 16 },
      { id: 'magicroom',   level: 20 },
      { id: 'crystalpulse',level: 24 },
      { id: 'psyshock',    level: 28 },
      { id: 'calmmind',    level: 32 },
      { id: 'psychic',     level: 38 },
      { id: 'storedpower', level: 44 },
      { id: 'trickroom',   level: 52 },
    ],
    tutorMoves: ['psychic', 'calmmind', 'reflect', 'lightscreen', 'protect', 'rest', 'sleeptalk'],
    eggMoves: [],
  },
  {
    key: 'reunicluss1',
    name: 'Reuniclus (S1)',
    baseSpecies: 'Reuniclus',
    forme: 'S1',
    types: ['Crystal', 'Psychic'],
    baseStats: { hp: 85, atk: 40, def: 90, spa: 140, spd: 120, spe: 56 },
    abilities: { '0': 'Magic Bounce', 'H': 'Regenerator' },
    prevo: 'duosions1',
    evoLevel: 41,
    color: 'Green',
    gen: 9,
    moves: [
      { id: 'confusion',   level: 1  },
      { id: 'crystalbeam', level: 1  },
      { id: 'healblock',   level: 8  },
      { id: 'reflect',     level: 12 },
      { id: 'psybeam',     level: 16 },
      { id: 'magicroom',   level: 20 },
      { id: 'crystalpulse',level: 24 },
      { id: 'psyshock',    level: 28 },
      { id: 'calmmind',    level: 32 },
      { id: 'psychic',     level: 38 },
      { id: 'storedpower', level: 44 },
      { id: 'trickroom',   level: 52 },
      { id: 'recover',     level: 58 },
    ],
    tutorMoves: ['psychic', 'calmmind', 'reflect', 'lightscreen', 'protect', 'rest', 'sleeptalk', 'focusblast'],
    eggMoves: [],
  },

  // ── Gastly line – Cosmic/Ghost ────────────────────────────────────────────
  {
    key: 'gastlycosmics1',
    name: 'Gastly (Cosmic S1)',
    baseSpecies: 'Gastly',
    forme: 'Cosmic S1',
    types: ['Cosmic', 'Ghost'],
    baseStats: { hp: 30, atk: 35, def: 30, spa: 100, spd: 70, spe: 80 },
    abilities: { '0': 'Levitate', 'H': 'Cursed Body' },
    evos: ['hauntercosmics1'],
    color: 'Purple',
    gen: 9,
    moves: [
      { id: 'lick',        level: 1  },
      { id: 'cosmicpulse', level: 1  },
      { id: 'confuseray',  level: 5  },
      { id: 'nightshade',  level: 8  },
      { id: 'hypnosis',    level: 12 },
      { id: 'shadowball',  level: 16 },
      { id: 'cosmicblast', level: 20 },
      { id: 'willowisp',   level: 26 },
      { id: 'dreameater',  level: 32 },
      { id: 'darkpulse',   level: 38 },
      { id: 'perishsong',  level: 44 },
      { id: 'cosmicshock', level: 52 },
    ],
    tutorMoves: ['shadowball', 'darkpulse', 'willowisp', 'protect', 'rest', 'sleeptalk'],
    eggMoves: ['destinybond', 'meanlook', 'painsplit'],
  },
  {
    key: 'hauntercosmics1',
    name: 'Haunter (Cosmic S1)',
    baseSpecies: 'Haunter',
    forme: 'Cosmic S1',
    types: ['Cosmic', 'Ghost'],
    baseStats: { hp: 45, atk: 50, def: 45, spa: 115, spd: 85, spe: 95 },
    abilities: { '0': 'Levitate', 'H': 'Cursed Body' },
    prevo: 'gastlycosmics1',
    evoLevel: 25,
    evos: ['gengarcosmics1'],
    color: 'Purple',
    gen: 9,
    moves: [
      { id: 'shadowsneak', level: 1  },
      { id: 'lick',        level: 1  },
      { id: 'cosmicpulse', level: 1  },
      { id: 'confuseray',  level: 5  },
      { id: 'nightshade',  level: 8  },
      { id: 'hypnosis',    level: 12 },
      { id: 'shadowball',  level: 16 },
      { id: 'cosmicblast', level: 20 },
      { id: 'willowisp',   level: 26 },
      { id: 'dreameater',  level: 32 },
      { id: 'darkpulse',   level: 38 },
      { id: 'perishsong',  level: 44 },
      { id: 'cosmicshock', level: 52 },
    ],
    tutorMoves: ['shadowball', 'darkpulse', 'willowisp', 'protect', 'rest', 'sleeptalk', 'psychic'],
    eggMoves: [],
  },
  {
    key: 'gengarcosmics1',
    name: 'Gengar (Cosmic S1)',
    baseSpecies: 'Gengar',
    forme: 'Cosmic S1',
    types: ['Cosmic', 'Ghost'],
    baseStats: { hp: 60, atk: 65, def: 60, spa: 130, spd: 95, spe: 110 },
    abilities: { '0': 'Cursed Body', 'H': 'Shadow Tag' },
    prevo: 'hauntercosmics1',
    color: 'Purple',
    gen: 9,
    moves: [
      { id: 'shadowball',  level: 1  },
      { id: 'shadowsneak', level: 1  },
      { id: 'cosmicpulse', level: 1  },
      { id: 'confuseray',  level: 5  },
      { id: 'nightshade',  level: 8  },
      { id: 'hypnosis',    level: 12 },
      { id: 'shadowball',  level: 16 },
      { id: 'cosmicblast', level: 20 },
      { id: 'cosmicshock', level: 24 },
      { id: 'willowisp',   level: 26 },
      { id: 'dreameater',  level: 32 },
      { id: 'darkpulse',   level: 38 },
      { id: 'perishsong',  level: 44 },
      { id: 'destinybond', level: 52 },
    ],
    tutorMoves: ['shadowball', 'darkpulse', 'willowisp', 'protect', 'rest', 'sleeptalk', 'psychic', 'focusblast'],
    eggMoves: [],
  },

  // ── Doduo line – Stellar/Flying ───────────────────────────────────────────
  {
    key: 'doduostellars1',
    name: 'Doduo (Stellar S1)',
    baseSpecies: 'Doduo',
    forme: 'Stellar S1',
    types: ['Stellar', 'Flying'],
    baseStats: { hp: 35, atk: 85, def: 45, spa: 35, spd: 35, spe: 75 },
    abilities: { '0': 'Run Away', '1': 'Early Bird', 'H': 'Tangled Feet' },
    evos: ['dodriostellars1'],
    color: 'Brown',
    gen: 9,
    moves: [
      { id: 'peck',        level: 1  },
      { id: 'growl',       level: 1  },
      { id: 'quickattack', level: 5  },
      { id: 'rage',        level: 8  },
      { id: 'starfall',    level: 12 },
      { id: 'furyattack',  level: 16 },
      { id: 'swordsdance', level: 20 },
      { id: 'jumpkick',    level: 26 },
      { id: 'agility',     level: 32 },
      { id: 'drillpeck',   level: 38 },
      { id: 'starfallstrike', level: 44 },
    ],
    tutorMoves: ['fly', 'airslash', 'bravebird', 'protect', 'rest', 'sleeptalk', 'doubleteam'],
    eggMoves: ['pursuit', 'supersonic', 'haze'],
  },
  {
    key: 'dodriostellars1',
    name: 'Dodrio (Stellar S1)',
    baseSpecies: 'Dodrio',
    forme: 'Stellar S1',
    types: ['Stellar', 'Flying'],
    baseStats: { hp: 60, atk: 110, def: 70, spa: 60, spd: 60, spe: 100 },
    abilities: { '0': 'Run Away', '1': 'Early Bird', 'H': 'Tangled Feet' },
    prevo: 'doduostellars1',
    evoLevel: 31,
    color: 'Brown',
    gen: 9,
    moves: [
      { id: 'peck',        level: 1  },
      { id: 'growl',       level: 1  },
      { id: 'quickattack', level: 5  },
      { id: 'rage',        level: 8  },
      { id: 'starfall',    level: 12 },
      { id: 'furyattack',  level: 16 },
      { id: 'swordsdance', level: 20 },
      { id: 'jumpkick',    level: 26 },
      { id: 'agility',     level: 32 },
      { id: 'drillpeck',   level: 38 },
      { id: 'starfallstrike', level: 44 },
      { id: 'triattack',   level: 52 },
    ],
    tutorMoves: ['fly', 'airslash', 'bravebird', 'protect', 'rest', 'sleeptalk', 'doubleteam', 'hyperbeam'],
    eggMoves: [],
  },
];

// ─── Custom Moves for S1 types ────────────────────────────────────────────────

const CUSTOM_MOVES = {
  crystalbeam: {
    name: 'Crystal Beam',
    type: 'Crystal',
    basePower: 65,
    category: 'Special',
    accuracy: 100,
    desc: 'A beam of crystalline energy. High critical-hit ratio.',
    shortDesc: 'Crystal-type beam. High crit ratio.',
  },
  crystalpulse: {
    name: 'Crystal Pulse',
    type: 'Crystal',
    basePower: 90,
    category: 'Special',
    accuracy: 100,
    desc: 'A powerful pulse of crystalline energy. May lower target Sp. Def.',
    shortDesc: 'Crystal pulse. 30% chance to lower Sp. Def.',
  },
  cosmicpulse: {
    name: 'Cosmic Pulse',
    type: 'Cosmic',
    basePower: 60,
    category: 'Special',
    accuracy: 100,
    desc: 'A pulse of cosmic energy that may confuse the target.',
    shortDesc: 'Cosmic energy. 30% chance to confuse.',
  },
  cosmicblast: {
    name: 'Cosmic Blast',
    type: 'Cosmic',
    basePower: 75,
    category: 'Special',
    accuracy: 100,
    desc: 'A blast of cosmic energy. Hits even in the dark.',
    shortDesc: 'Cosmic blast. Never misses.',
  },
  cosmicshock: {
    name: 'Cosmic Shock',
    type: 'Cosmic',
    basePower: 90,
    category: 'Special',
    accuracy: 100,
    desc: 'A shockwave of cosmic energy that always hits.',
    shortDesc: 'Powerful cosmic wave. Never misses.',
  },
  starfall: {
    name: 'Starfall',
    type: 'Stellar',
    basePower: 60,
    category: 'Special',
    accuracy: 100,
    desc: 'Stars rain down on the target. May lower accuracy.',
    shortDesc: 'Stellar stars. 30% chance to lower accuracy.',
  },
  starfallstrike: {
    name: 'Starfall Strike',
    type: 'Stellar',
    basePower: 95,
    category: 'Physical',
    accuracy: 95,
    desc: 'The user strikes with the force of falling stars. High chance to flinch.',
    shortDesc: 'Powerful stellar strike. 30% flinch.',
  },
};

// ─── Abilities for S1 ─────────────────────────────────────────────────────────
const CUSTOM_ABILITIES = {};

// ─── Build Output ─────────────────────────────────────────────────────────────

const outPokedex = {};
const outLearnsets = {};

POKEMON.forEach((p, idx) => {
  const num = S1_BASE_NUM - idx;

  // Species entry
  const dexEntry = {
    name: p.name,
    num,
    types: p.types,
    baseStats: p.baseStats,
    abilities: p.abilities,
    isNonstandard: 'Custom',
    color: p.color,
    gen: p.gen,
    baseSpecies: p.baseSpecies,
    forme: p.forme,
  };
  if (p.prevo) dexEntry.prevo = p.prevo;
  if (p.evos) dexEntry.evos = p.evos;
  if (p.evoLevel) dexEntry.evoLevel = p.evoLevel;
  dexEntry.tags = ['Soulstones'];

  outPokedex[p.key] = dexEntry;

  // Learnset
  const learnset = {};
  for (const m of p.moves || []) {
    const id = m.id;
    if (!learnset[id]) learnset[id] = [];
    const code = `9L${m.level}`;
    if (!learnset[id].includes(code)) learnset[id].push(code);
  }
  for (const id of p.tutorMoves || []) {
    if (!learnset[id]) learnset[id] = [];
    if (!learnset[id].includes('9T')) learnset[id].push('9T');
  }
  for (const id of p.eggMoves || []) {
    if (!learnset[id]) learnset[id] = [];
    if (!learnset[id].includes('9E')) learnset[id].push('9E');
  }
  outLearnsets[p.key] = { learnset };
});

// ─── Write ────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(path.join(OUT_DIR, 'pokedex.soulstones-part1.json'), JSON.stringify(outPokedex, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'learnsets.soulstones-part1.json'), JSON.stringify(outLearnsets, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'moves.custom.soulstones-part1.json'), JSON.stringify(CUSTOM_MOVES, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'abilities.custom.soulstones-part1.json'), JSON.stringify(CUSTOM_ABILITIES, null, 2), 'utf8');

console.log('Generated Soulstones Part 1 data files:');
console.log(`  ${Object.keys(outPokedex).length} Pokémon species`);
console.log(`  ${Object.keys(outLearnsets).length} learnset entries`);
console.log(`  ${Object.keys(CUSTOM_MOVES).length} custom moves (Crystal/Cosmic/Stellar)`);
console.log('\nSpecies generated:');
for (const [key, entry] of Object.entries(outPokedex)) {
  console.log(`  ${key}: ${entry.name} [${entry.types.join('/')}] (${Object.keys(outLearnsets[key]?.learnset || {}).length} moves)`);
}
