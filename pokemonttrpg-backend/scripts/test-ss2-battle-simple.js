/**
 * test-ss2-battle-simple.js
 * Simple CommonJS test for SS2 moves in actual PS battles.
 * Run: node pokemonttrpg-backend/scripts/test-ss2-battle-simple.js
 */

const ps = require('pokemon-showdown');
const { BattleStream, Teams, Dex } = ps;
const fs = require('fs');
const path = require('path');

// Load and inject SS2 moves
const SS2_MOVES_JSON = path.join(__dirname, '..', '..', 'tauri-app', 'public', 'data', 'ss2-patch', 'generated', 'moves.custom.ss2-soulstones.json');
const ss2Moves = JSON.parse(fs.readFileSync(SS2_MOVES_JSON, 'utf8'));

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

const originalBaseMoves = { ...Dex.data.Moves };
const normalizedMoves = {};
for (const [moveId, moveData] of Object.entries(ss2Moves)) {
  normalizedMoves[moveId] = normalizeMove(moveData);
}
Object.assign(Dex.data.Moves, normalizedMoves);

// Create SS2 variants
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
  const variantKey = keyId + 'ss2';
  if (Dex.data.Moves[variantKey]) continue;
  Dex.data.Moves[variantKey] = {
    ...baseEntry,
    ...entry,
    name: (entry.name || baseEntry.name) + ' (SS2)',
    pp: Number(entry.pp) > 0 ? Number(entry.pp) : (Number(baseEntry.pp) > 0 ? Number(baseEntry.pp) : 15),
    target: entry.target || baseEntry.target || 'normal',
    priority: entry.priority ?? baseEntry.priority ?? 0,
    flags: entry.flags || baseEntry.flags || {},
    num: entry.num ?? baseEntry.num ?? 0,
  };
  variantCount++;
}

// Add custom types
const tc = Dex.data.TypeChart;
tc.light = { isNonstandard: 'Custom', damageTaken: { Bug: 2, Dark: 1, Ghost: 2 } };
tc.sound = { isNonstandard: 'Custom', damageTaken: { Fighting: 1, Ghost: 2, Rock: 2, Steel: 2 } };

if (Dex.moves?.cache) Dex.moves.cache = new Map();
if (Dex.types?.cache) Dex.types.cache = new Map();

console.log('=== SS2 Battle Test (Simple) ===');
console.log('Loaded', Object.keys(ss2Moves).length, 'SS2 moves');
console.log('Created', variantCount, 'SS2 variants\n');

async function test() {
  const stream = new BattleStream();

  const team1 = Teams.pack([{
    name: 'TestMon1', species: 'Pikachu', item: '', ability: 'Static',
    moves: ['renewal', 'safeguardss2', 'thunderbolt', 'quickattack'],
    nature: 'Hardy', evs: {}, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50
  }]);
  const team2 = Teams.pack([{
    name: 'TestMon2', species: 'Charmander', item: '', ability: 'Blaze',
    moves: ['siphon', 'blackout', 'ember', 'scratch'],
    nature: 'Hardy', evs: {}, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50
  }]);

  stream.write('>start {"formatid":"gen9customgame"}');
  stream.write('>player p1 {"name":"P1","team":"' + team1 + '"}');
  stream.write('>player p2 {"name":"P2","team":"' + team2 + '"}');

  let noppCount = 0;
  let moveCount = 0;
  let turnCount = 0;
  let pendingP1 = false;
  let pendingP2 = false;

  for await (const chunk of stream) {
    const lines = String(chunk).split('\n');
    for (const line of lines) {
      if (line.includes('nopp')) {
        noppCount++;
        console.log('NOPP ERROR:', line);
      }
      if (line.startsWith('|move|')) {
        moveCount++;
        console.log('MOVE:', line);
      }
      if (line.startsWith('|turn|')) {
        turnCount = parseInt(line.split('|')[2]) || 0;
      }
      if (line.startsWith('|request|')) {
        const json = line.slice(9);
        if (json && json !== 'null') {
          try {
            const req = JSON.parse(json);
            if (req.active && req.active[0] && req.active[0].moves) {
              if (!pendingP1) {
                pendingP1 = true;
                stream.write('>p1 move 1');
              } else if (!pendingP2) {
                pendingP2 = true;
                stream.write('>p2 move 1');
              }
            }
          } catch (e) { }
        }
      }
    }
    if (turnCount >= 3 || moveCount >= 6) break;
  }

  console.log('\n=== RESULTS ===');
  console.log('Turns:', turnCount);
  console.log('Moves executed:', moveCount);
  console.log('nopp errors:', noppCount);

  if (noppCount > 0) {
    console.log('\nFAILED: nopp errors found - SS2 moves still have PP issues');
    process.exit(1);
  } else if (moveCount > 0) {
    console.log('\nSUCCESS: SS2 moves work in battle!');
    process.exit(0);
  } else {
    console.log('\nWARNING: Battle did not progress (no moves executed)');
    process.exit(1);
  }
}

test().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});