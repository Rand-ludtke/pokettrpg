#!/usr/bin/env node
/**
 * patch-mariomon-evos.mjs
 * One-time script to fill in missing evoLevel / evoType / evoItem / evoCondition
 * for all 59 evolved Mariomon entries.
 *
 * Data sourced from the official Mariomon Tattledex spreadsheet
 * (Google Sheets htmlview, "Evolution Method" column).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dexPath = resolve(__dirname, '../public/data/mariomon/generated/pokedex.mariomon.json');

const dex = JSON.parse(readFileSync(dexPath, 'utf-8'));

// ── Simple level-based evolutions (evoLevel only) ──────────────────────────
const levelEvos = {
  peeweepiranha:    18,
  peteypiranha:     32,
  bubbleblooper:    16,
  gooperblooper:    34,
  chuckya:          14,
  kingbobomb:       36,
  goombastack:      18,
  hornedanttrooper: 14,
  cheepchomp:       20,
  porcupuffer:      30,
  blargg:           34,
  parabiddy:        18,
  sniffit:          26,
  megamole:         22,
  majorburrows:     34,
  thwomp:           24,
  balloonboo:       22,
  kingboo:          38,
  dinorhino:        26,
  yoshi:            20,
  yoob:             50,
  swoop:            22,
  ironcleft:        24,
  banzaibill:       32,
  spiketop:         22,
  lakitu:           26,
  clubba:           24,
  poisonpokey:      36,
  paratroopa:       24,
  plungelo:         42,
  chillbully:       40,
  tyfoo:            34,
  superfly:         30,
  parabeanie:       26,
  shroob:           16,
  shrooboid:        36,
  huffnpuff:        36,
  hisstocrat:       30,
  spark:            30,
  tarantox:         22,
  muncher:          20,
  mechachomp:       42,
  magikoopa:        32,
  scuttlebug:       18,
  elitexnaut:       40,
  jabbi:            18,
  twirler:          25,
  bossbrolder:      38,
  yux:              44,
};

// ── Item-based evolutions (evoType: "useItem") ─────────────────────────────
const itemEvos = {
  redyoshi:          'Red Shell',
  blueyoshi:         'Blue Shell',
  yellowyoshi:       'Yellow Shell',
  amazydayzee:       'Green Shell',
  mollusquelanceur:  'Red Shell',
  lubba:             'Starbits',
  mrblizzard:        'Blue Shell',
  spindrift:         'Yellow Shell',
};

// ── Special evolutions ─────────────────────────────────────────────────────
// Penguin: "Lvl. 30 (Female)" – gender-gated
// Dry Bones: "Shedinja Method" – appears like Shedinja when Koopa Troopa → Paratroopa
const specialEvos = {
  penguin:  { evoLevel: 30, evoType: 'levelExtra', evoCondition: 'Female' },
  drybones: { evoLevel: 24, evoType: 'levelExtra', evoCondition: 'Shedinja Method' },
};

let patched = 0;
let missing = [];

// Apply simple level evos
for (const [key, level] of Object.entries(levelEvos)) {
  if (!dex[key]) { missing.push(key); continue; }
  dex[key].evoLevel = level;
  patched++;
}

// Apply item evos
for (const [key, item] of Object.entries(itemEvos)) {
  if (!dex[key]) { missing.push(key); continue; }
  dex[key].evoType = 'useItem';
  dex[key].evoItem = item;
  patched++;
}

// Apply special evos
for (const [key, fields] of Object.entries(specialEvos)) {
  if (!dex[key]) { missing.push(key); continue; }
  Object.assign(dex[key], fields);
  patched++;
}

writeFileSync(dexPath, JSON.stringify(dex, null, 2) + '\n', 'utf-8');

console.log(`✅ Patched ${patched} entries`);
if (missing.length) console.log(`⚠️  Missing keys: ${missing.join(', ')}`);

// Verify: every entry with prevo should now have evo method data
const stillMissing = Object.entries(dex)
  .filter(([, v]) => v.prevo && !v.evoLevel && !v.evoType)
  .map(([k]) => k);

if (stillMissing.length) {
  console.log(`❌ Still missing evo data: ${stillMissing.join(', ')}`);
  process.exit(1);
} else {
  console.log('✅ All prevo entries now have evo method data');
}
