/**
 * Patch wylin-customs.generated.json to:
 * 1. Add mega stone items for all Wylin megas
 * 2. Fix missing requiredItem on Machrun-Mega and Ferrodillo-Mega
 * 3. Add Wylin Gardevoir-Mega dex entry
 * 4. Update Wylin Gardevoir otherFormes to include mega
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(__dirname, '../tauri-app/public/data/more-pokemon/generated/wylin-customs.generated.json');

console.log('Reading wylin-customs.generated.json...');
const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));

if (!data.dex) data.dex = {};
if (!data.items) data.items = {};

// ============================================================
// 1. Fix missing requiredItem on existing mega entries
// ============================================================
if (data.dex.machrunmega) {
  data.dex.machrunmega.requiredItem = 'Machite';
  console.log('Fixed machrunmega.requiredItem = "Machite"');
}

if (data.dex.ferrodillomega) {
  data.dex.ferrodillomega.requiredItem = 'Ferroite';
  console.log('Fixed ferrodillomega.requiredItem = "Ferroite"');
}

// ============================================================
// 2. Add Wylin Gardevoir-Mega dex entry
// ============================================================
const wylinGardeMegaKey = 'wylingardevoirmega';
if (!data.dex[wylinGardeMegaKey]) {
  data.dex[wylinGardeMegaKey] = {
    name: 'Wylin Gardevoir-Mega',
    baseSpecies: 'Wylin Gardevoir',
    forme: 'Mega',
    types: ['Water', 'Fairy'],
    gender: 'F',
    baseStats: { hp: 68, atk: 65, def: 85, spa: 165, spd: 135, spe: 100 },
    abilities: { '0': 'Distillation' },
    heightm: 1.8,
    weightkg: 49.9,
    requiredItem: 'Gardevoirite-W',
    isMega: true,
    num: -1,
    isNonstandard: 'Custom',
    gen: 6,
  };
  console.log('Added Wylin Gardevoir-Mega dex entry');
} else {
  // Ensure requiredItem is set even if entry exists
  data.dex[wylinGardeMegaKey].requiredItem = 'Gardevoirite-W';
  console.log('Updated Wylin Gardevoir-Mega requiredItem');
}

// ============================================================
// 3. Update Wylin Gardevoir otherFormes to include mega
// ============================================================
if (data.dex.wylingardevoir) {
  const formes = data.dex.wylingardevoir.otherFormes || [];
  if (!formes.includes('Wylin Gardevoir-Mega')) {
    formes.push('Wylin Gardevoir-Mega');
    data.dex.wylingardevoir.otherFormes = formes;
    console.log('Added "Wylin Gardevoir-Mega" to wylingardevoir.otherFormes');
  }
}

// ============================================================
// 4. Add all mega stone items
// ============================================================
const megaStones = [
  { id: 'rodite',         name: 'Rodite',          megaStone: 'Rodiole-Mega',             megaEvolves: 'Rodiole',           itemUser: ['Rodiole'] },
  { id: 'babuite',        name: 'Babuite',         megaStone: 'Babuffall-Mega',           megaEvolves: 'BaBuffall',         itemUser: ['BaBuffall'] },
  { id: 'rockrite',       name: 'Rockrite',        megaStone: 'Rockram-Mega',             megaEvolves: 'Rockram',           itemUser: ['Rockram'] },
  { id: 'machite',        name: 'Machite',         megaStone: 'Machrun-Mega',             megaEvolves: 'Machrun',           itemUser: ['Machrun'] },
  { id: 'howite',         name: 'Howite',          megaStone: 'Howound-Mega',             megaEvolves: 'Howound',           itemUser: ['Howound'] },
  { id: 'ferroite',       name: 'Ferroite',        megaStone: 'Ferrodillo-Mega',          megaEvolves: 'Ferrodillo',        itemUser: ['Ferrodillo'] },
  { id: 'wakinite',       name: 'Wakinite',        megaStone: 'Wakindor-Mega',            megaEvolves: 'Wakindor',          itemUser: ['Wakindor'] },
  { id: 'gardevoiritew',  name: 'Gardevoirite-W',  megaStone: 'Wylin Gardevoir-Mega',     megaEvolves: 'Wylin Gardevoir',   itemUser: ['Wylin Gardevoir'] },
];

for (const stone of megaStones) {
  if (!data.items[stone.id]) {
    data.items[stone.id] = {
      name: stone.name,
      shortDesc: `Enables ${stone.megaEvolves} to Mega Evolve.`,
      desc: `If held by ${stone.megaEvolves}, allows it to Mega Evolve.`,
      megaStone: stone.megaStone,
      megaEvolves: stone.megaEvolves,
      itemUser: stone.itemUser,
      gen: 6,
      isNonstandard: 'Custom',
      num: -1,
    };
    console.log(`Added mega stone item: ${stone.name} (${stone.id})`);
  } else {
    // Ensure megaStone/megaEvolves are set
    data.items[stone.id].megaStone = stone.megaStone;
    data.items[stone.id].megaEvolves = stone.megaEvolves;
    data.items[stone.id].itemUser = stone.itemUser;
    console.log(`Updated mega stone item: ${stone.name} (${stone.id})`);
  }
}

// ============================================================
// 5. Mark all existing mega dex entries with isMega: true
// ============================================================
const megaDexKeys = [
  'rodiolemega', 'babuffallmega', 'rockrammega', 'machrunmega',
  'howoundmega', 'ferrodillomega', 'wakindormega', 'wylingardevoirmega',
];
for (const key of megaDexKeys) {
  if (data.dex[key] && !data.dex[key].isMega) {
    data.dex[key].isMega = true;
    console.log(`Set isMega=true on ${key}`);
  }
}

// ============================================================
// Write back
// ============================================================
console.log('\nWriting patched JSON...');
writeFileSync(jsonPath, JSON.stringify(data), 'utf-8');
console.log('Done! Patched wylin-customs.generated.json');
