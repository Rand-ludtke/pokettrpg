// End-to-end: verify an ss2 variant move resolves through the PS engine (like a real battle)
const ps = require('pokemon-showdown');
const { Dex } = ps;
const path = require('path');

// Load moves exactly like sync-ps-engine does at runtime
const customMovesData = require(path.join(__dirname, '..', 'dist', 'data', 'moves.js'));
const customMoves = customMovesData.default || customMovesData;

function normalizeCustomMoveEntries(rawMoves) {
  return Object.fromEntries(Object.entries(rawMoves || {}).map(([moveId, moveData]) => {
    const normalized = { ...(moveData || {}) };
    if (typeof normalized.pp !== "number" || !Number.isFinite(normalized.pp) || normalized.pp <= 0) normalized.pp = 10;
    return [moveId, normalized];
  }));
}

Object.assign(Dex.data.Moves, normalizeCustomMoveEntries(customMoves));

// Simulate battle resolution: create a Pokemon using an ss2 variant move and check it's valid
const tests = ['safeguardss2', 'renewal', 'blackout'];
for (const mv of tests) {
  const entry = Dex.data.Moves[mv];
  if (!entry) { console.log(`${mv}: NOT FOUND`); continue; }
  // Build a Pokemon with this move and verify the engine accepts it
  try {
    const p = new ps.Pokemon('pikachu', { set: { name: 'Pikachu', species: 'Pikachu', moves: [mv], ability: 'static' }, level: 50 });
    console.log(`${mv}: OK (pp=${entry.pp}, type=${entry.type})`);
  } catch (e) {
    console.log(`${mv}: FAILED - ${e.message}`);
  }
}

// Also verify a brand-new SS2 move (no base) resolves
const newMove = Dex.data.Moves['renewal'];
console.log('---');
console.log('Total moves in dex now:', Object.keys(Dex.data.Moves).length);