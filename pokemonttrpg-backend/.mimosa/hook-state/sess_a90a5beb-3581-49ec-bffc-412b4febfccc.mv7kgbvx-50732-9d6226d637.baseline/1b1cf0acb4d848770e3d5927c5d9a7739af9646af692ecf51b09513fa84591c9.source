// Test SS2 variant creation on the Pi
const ps = require('pokemon-showdown');
const { Dex } = ps;
const path = require('path');

// Load moves like sync-ps-engine does
const customMovesData = require(path.join(__dirname, '..', 'dist', 'data', 'moves.js'));
const customMoves = customMovesData.default || customMovesData;
console.log('Loaded moves:', Object.keys(customMoves).length);

function normalizeCustomMoveEntries(rawMoves) {
  return Object.fromEntries(Object.entries(rawMoves || {}).map(([moveId, moveData]) => {
    const normalized = { ...(moveData || {}) };
    if (typeof normalized.pp !== "number" || !Number.isFinite(normalized.pp) || normalized.pp <= 0) {
      normalized.pp = 10;
    }
    return [moveId, normalized];
  }));
}

const normalizedCustomMoves = normalizeCustomMoveEntries(customMoves);

// Save original base moves
const originalBaseMoves = { ...Dex.data.Moves };
console.log('Original base moves:', Object.keys(originalBaseMoves).length);

Object.assign(Dex.data.Moves, normalizedCustomMoves);

// Create SS2 variants
const toPSId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let ss2VariantCount = 0;
for (const [rawKey, rawEntry] of Object.entries(normalizedCustomMoves)) {
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
  ss2VariantCount++;
}

console.log('Created SS2 variants:', ss2VariantCount);
console.log('safeguardss2:', Dex.data.Moves['safeguardss2'] ? `pp=${Dex.data.Moves['safeguardss2'].pp} type=${Dex.data.Moves['safeguardss2'].type}` : 'MISSING');
console.log('renewal:', Dex.data.Moves['renewal'] ? `pp=${Dex.data.Moves['renewal'].pp} type=${Dex.data.Moves['renewal'].type}` : 'MISSING');