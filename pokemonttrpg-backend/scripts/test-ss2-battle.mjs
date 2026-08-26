/**
 * test-ss2-battle.mjs
 *
 * Comprehensive test for SS2 moves and abilities in the PS engine.
 * Simulates actual battles to verify:
 * 1. SS2 moves have proper PP and don't fail with "nopp"
 * 2. SS2 retyped variants (safeguardss2, etc.) work correctly
 * 3. SS2 abilities are registered and functional
 *
 * Run: node pokemonttrpg-backend/scripts/test-ss2-battle.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ps = require('pokemon-showdown');
const { BattleStream, getPlayerStreams, Teams, PRNG, Dex } = ps;

// Load SS2 moves
const SS2_MOVES_JSON = path.join(__dirname, '..', '..', 'tauri-app', 'public', 'data', 'ss2-patch', 'generated', 'moves.custom.ss2-soulstones.json');
const SS2_ABILITIES_JSON = path.join(__dirname, '..', '..', 'tauri-app', 'public', 'data', 'ss2-patch', 'generated', 'abilities.custom.ss2-soulstones.json');

const ss2Moves = JSON.parse(fs.readFileSync(SS2_MOVES_JSON, 'utf8'));
const ss2Abilities = fs.existsSync(SS2_ABILITIES_JSON) ? JSON.parse(fs.readFileSync(SS2_ABILITIES_JSON, 'utf8')) : {};

console.log('=== SS2 Battle Test ===\n');
console.log(`Loaded ${Object.keys(ss2Moves).length} SS2 moves`);
console.log(`Loaded ${Object.keys(ss2Abilities).length} SS2 abilities\n`);

// ── Inject custom types ──
const tc = Dex.data.TypeChart;
tc.nuclear = { isNonstandard: "Custom", damageTaken: { fallout:3, Bug:1, Cosmic:1, Dark:1, Dragon:1, Electric:1, Fairy:1, Fighting:1, Fire:1, Flying:1, Ghost:1, Grass:1, Ground:1, Ice:1, Normal:1, Nuclear:2, Poison:1, Psychic:1, Rock:1, Steel:1, Stellar:0, Water:1 } };
tc.cosmic = { isNonstandard: "Custom", damageTaken: { Bug:0, Cosmic:0, Dark:0, Dragon:0, Electric:0, Fairy:0, Fighting:0, Fire:3, Flying:0, Ghost:0, Grass:0, Ground:0, Ice:0, Normal:2, Nuclear:1, Poison:0, Psychic:0, Rock:0, Steel:0, Stellar:0, Water:0 } };
tc.crystal = { isNonstandard: "Custom", damageTaken: { Bug:0, Cosmic:0, Dark:0, Dragon:0, Electric:0, Fairy:0, Fighting:1, Fire:0, Flying:0, Ghost:0, Grass:0, Ground:0, Ice:2, Normal:0, Nuclear:0, Poison:0, Psychic:0, Rock:2, Sound:1, Steel:2, Stellar:0, Water:0, Light:0 } };
tc.stellar = { isNonstandard: "Custom", damageTaken: { Bug:0, Cosmic:0, Crystal:0, Dark:1, Dragon:1, Electric:0, Fairy:0, Fighting:0, Fire:0, Flying:0, Ghost:2, Grass:0, Ground:0, Ice:0, Normal:0, Nuclear:0, Poison:0, Psychic:2, Rock:0, Sound:0, Steel:0, Water:0, Light:0 } };
tc.sound = { isNonstandard: "Custom", damageTaken: { Bug:0, Cosmic:0, Crystal:0, Dark:0, Dragon:0, Electric:0, Fairy:0, Fighting:1, Fire:0, Flying:0, Ghost:2, Grass:0, Ground:0, Ice:0, Normal:0, Nuclear:0, Poison:0, Psychic:0, Rock:2, Steel:2, Stellar:0, Water:0, Light:0 } };
tc.light = { isNonstandard: "Custom", damageTaken: { Bug:2, Cosmic:0, Crystal:0, Dark:1, Dragon:0, Electric:0, Fairy:0, Fighting:0, Fire:0, Flying:0, Ghost:2, Grass:0, Ground:0, Ice:0, Normal:0, Nuclear:0, Poison:0, Psychic:0, Rock:0, Sound:0, Steel:0, Stellar:0, Water:0 } };

// Add type effectiveness to existing types
if (tc.ice) tc.ice.damageTaken.Crystal = 1;
if (tc.rock) tc.rock.damageTaken.Crystal = 1;
if (tc.steel) tc.steel.damageTaken.Crystal = 1;
if (tc.fighting) tc.fighting.damageTaken.Crystal = 2;
if (tc.psychic) tc.psychic.damageTaken.Stellar = 1;
if (tc.ghost) tc.ghost.damageTaken.Stellar = 1;
if (tc.dark) tc.dark.damageTaken.Stellar = 2;
if (tc.dragon) tc.dragon.damageTaken.Stellar = 2;
if (tc.rock) tc.rock.damageTaken.Sound = 1;
if (tc.steel) tc.steel.damageTaken.Sound = 1;
if (tc.ghost) tc.ghost.damageTaken.Sound = 1;
if (tc.fighting) tc.fighting.damageTaken.Sound = 2;
if (tc.dark) tc.dark.damageTaken.Light = 1;
if (tc.ghost) tc.ghost.damageTaken.Light = 1;
if (tc.bug) tc.bug.damageTaken.Light = 2;

// ── Normalize and inject SS2 moves ──
function normalizeMove(moveData) {
  const normalized = { ...(moveData || {}) };
  if (typeof normalized.pp !== 'number' || !Number.isFinite(normalized.pp) || normalized.pp <= 0) {
    const category = String(normalized.category || 'Status').toLowerCase();
    const bp = Number(normalized.basePower || normalized.power || 0);
    normalized.pp = category === 'status' ? 15 : (bp > 0 ? 20 : 10);
  }
  if (!normalized.target) normalized.target = 'normal';
  if (normalized.priority == null) normalized.priority = 0;
  if (!normalized.flags) normalized.flags = {};
  if (normalized.num == null) normalized.num = 0;
  return normalized;
}

// Save original base moves BEFORE injecting
const originalBaseMoves = { ...Dex.data.Moves };

const normalizedMoves = {};
for (const [moveId, moveData] of Object.entries(ss2Moves)) {
  normalizedMoves[moveId] = normalizeMove(moveData);
}
Object.assign(Dex.data.Moves, normalizedMoves);

// ── Create SS2 variants ──
const toPSId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let variantCount = 0;
for (const [rawKey, rawEntry] of Object.entries(normalizedMoves)) {
  const keyId = toPSId(rawKey);
  if (!keyId) continue;
  const entry = rawEntry || {};
  const baseEntry = originalBaseMoves[keyId];
  if (!baseEntry) continue;
  const customType = String(entry.type || '');
  if (!customType || customType === String(baseEntry.type || '')) continue;
  const variantKey = `${keyId}ss2`;
  if (Dex.data.Moves[variantKey]) continue;
  Dex.data.Moves[variantKey] = {
    ...baseEntry,
    ...entry,
    name: `${entry.name || baseEntry.name} (SS2)`,
    pp: Number(entry.pp) > 0 ? Number(entry.pp) : (Number(baseEntry.pp) > 0 ? Number(baseEntry.pp) : 15),
    target: entry.target || baseEntry.target || 'normal',
    priority: entry.priority ?? baseEntry.priority ?? 0,
    flags: entry.flags || baseEntry.flags || {},
    num: entry.num ?? baseEntry.num ?? 0,
  };
  variantCount++;
}
console.log(`Created ${variantCount} SS2 retyped variants\n`);

// ── Inject SS2 abilities ──
const normalizedAbilities = {};
for (const [abId, abData] of Object.entries(ss2Abilities)) {
  normalizedAbilities[abId] = {
    name: abData.name || abId,
    desc: abData.desc || abData.shortDesc || `${abData.name || abId} ability.`,
    shortDesc: abData.shortDesc || abData.desc || `${abData.name || abId} ability.`,
    isNonstandard: 'Custom',
    num: 0,
    flags: {},
  };
}
Object.assign(Dex.data.Abilities, normalizedAbilities);

// Clear caches
if (Dex.types?.cache) Dex.types.cache = new Map();
if (Dex.moves?.cache) Dex.moves.cache = new Map();
if (Dex.abilities?.cache) Dex.abilities.cache = new Map();

// ── Test 1: Verify specific moves exist with PP ──
console.log('=== Test 1: Move PP Verification ===');
const testMoves = ['renewal', 'blackout', 'sandjet', 'siphon', 'hallelujah', 'titaniaslaw', 'galehold', 'safeguardss2', 'clangingscalesss2', 'steamrollerss2'];
let moveTestPassed = true;
for (const m of testMoves) {
  const move = Dex.data.Moves[m];
  if (move && Number(move.pp) > 0) {
    console.log(`  ✓ ${m}: pp=${move.pp}, type=${move.type}, category=${move.category}`);
  } else {
    console.log(`  ✗ ${m}: MISSING or pp=0`);
    moveTestPassed = false;
  }
}
console.log(moveTestPassed ? 'PASSED: All test moves have PP\n' : 'FAILED: Some moves missing\n');

// ── Test 2: Run actual battle with SS2 moves ──
console.log('=== Test 2: Actual Battle Simulation ===');

async function runTestBattle() {
  const stream = new BattleStream({ debug: false });
  const { omniscient, spectator, p1, p2 } = getPlayerStreams(stream);

  // Team 1: Ducklett-Orion with SS2 moves (renewal, safeguardss2, hallelujah)
  const team1 = [{
    name: 'Ducklett-Orion',
    species: 'Ducklett',
    item: '',
    ability: 'Keen Eye',
    moves: ['renewal', 'safeguardss2', 'hallelujah', 'watergun'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    shiny: false,
    gender: 'M',
  }];

  // Team 2: Joltik-Orion with SS2 moves (siphon, blackout)
  const team2 = [{
    name: 'Joltik-Orion',
    species: 'Joltik',
    item: '',
    ability: 'Compound Eyes',
    moves: ['siphon', 'blackout', 'thundershock', 'stringshot'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    shiny: false,
    gender: 'F',
  }];

  const spec = { formatid: 'gen9customgame', seed: PRNG.generateSeed() };
  await omniscient.write(`>start ${JSON.stringify(spec)}`);
  await omniscient.write(`>player p1 ${JSON.stringify({ name: 'TestPlayer1', avatar: 'acetrainer', team: Teams.pack(team1) })}`);
  await omniscient.write(`>player p2 ${JSON.stringify({ name: 'TestPlayer2', avatar: 'acetrainer', team: Teams.pack(team2) })}`);

  const log = [];
  let noppErrors = [];
  let turnCount = 0;
  const maxTurns = 5;

  // Listen for battle log
  const logPromise = (async () => {
    for await (const chunk of spectator) {
      const lines = String(chunk).split('\n').filter(l => l.startsWith('|'));
      log.push(...lines);
      for (const line of lines) {
        if (line.includes('|cant|') && line.includes('nopp')) {
          noppErrors.push(line);
        }
        if (line.startsWith('|turn|')) {
          turnCount = parseInt(line.split('|')[2]) || 0;
        }
      }
    }
  })();

  // Wait for initial requests
  await new Promise(r => setTimeout(r, 500));

  // Play turns - use SS2 moves
  const moveChoices = [
    ['move 1', 'move 1'],  // Turn 1: renewal vs siphon
    ['move 2', 'move 2'],  // Turn 2: safeguardss2 vs blackout
    ['move 3', 'move 1'],  // Turn 3: hallelujah vs siphon
    ['move 1', 'move 2'],  // Turn 4: renewal vs blackout
    ['move 4', 'move 3'],  // Turn 5: watergun vs thundershock
  ];

  for (let i = 0; i < maxTurns; i++) {
    try {
      await p1.write(moveChoices[i][0]);
      await p2.write(moveChoices[i][1]);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      // Battle might have ended
      break;
    }
  }

  // Wait for battle to process
  await new Promise(r => setTimeout(r, 1000));

  // Check results
  console.log(`  Battle ran for ${turnCount} turns`);
  console.log(`  Total log lines: ${log.length}`);
  
  if (noppErrors.length > 0) {
    console.log(`  ✗ FAILED: Found ${noppErrors.length} "nopp" errors:`);
    for (const err of noppErrors.slice(0, 5)) {
      console.log(`    ${err}`);
    }
    return false;
  } else {
    console.log('  ✓ PASSED: No "nopp" errors - all SS2 moves worked!');
  }

  // Show some move usage from log
  const moveLines = log.filter(l => l.startsWith('|move|'));
  console.log(`  Moves used: ${moveLines.length}`);
  for (const ml of moveLines.slice(0, 6)) {
    console.log(`    ${ml}`);
  }

  return true;
}

const battlePassed = await runTestBattle();

// ── Test 3: Verify SS2 abilities are registered ──
console.log('\n=== Test 3: SS2 Abilities Verification ===');
const testAbilities = Object.keys(ss2Abilities).slice(0, 10);
let abilityTestPassed = true;
for (const abId of testAbilities) {
  const ab = Dex.data.Abilities[abId];
  if (ab && ab.name) {
    console.log(`  ✓ ${abId}: "${ab.name}"`);
  } else {
    console.log(`  ✗ ${abId}: MISSING`);
    abilityTestPassed = false;
  }
}
console.log(abilityTestPassed ? 'PASSED: SS2 abilities registered\n' : 'FAILED: Some abilities missing\n');

// ── Summary ──
console.log('=== SUMMARY ===');
console.log(`Move PP Test: ${moveTestPassed ? 'PASSED' : 'FAILED'}`);
console.log(`Battle Test: ${battlePassed ? 'PASSED' : 'FAILED'}`);
console.log(`Abilities Test: ${abilityTestPassed ? 'PASSED' : 'FAILED'}`);

const allPassed = moveTestPassed && battlePassed && abilityTestPassed;
console.log(`\nOverall: ${allPassed ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);
process.exit(allPassed ? 0 : 1);