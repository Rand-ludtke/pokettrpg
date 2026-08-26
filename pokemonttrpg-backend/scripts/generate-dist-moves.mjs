/**
 * generate-dist-moves.mjs
 *
 * Generates pokemonttrpg-backend/dist/data/moves.js from the client-side SS2 moves JSON.
 * Also bakes SS2 retyped variants (<move>ss2) directly into the output so battles
 * resolve them regardless of module load order.
 *
 * Run: node pokemonttrpg-backend/scripts/generate-dist-moves.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SS2_MOVES_JSON = path.join(__dirname, '..', '..', 'tauri-app', 'public', 'data', 'ss2-patch', 'generated', 'moves.custom.ss2-soulstones.json');
const OUT_DIR = path.join(__dirname, '..', 'dist', 'data');
const OUT_FILE = path.join(OUT_DIR, 'moves.js');

const ss2Moves = JSON.parse(fs.readFileSync(SS2_MOVES_JSON, 'utf8'));
console.log(`Loaded ${Object.keys(ss2Moves).length} SS2 moves`);

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

const allMoves = {};
for (const [moveId, moveData] of Object.entries(ss2Moves)) {
  allMoves[moveId] = normalizeMove(moveData);
}

// Bake SS2 retyped variants (<move>ss2) using PRISTINE base Showdown movedex.
// This avoids runtime load-order issues where other modules mutate Dex.data.Moves
// before the variant creation loop runs.
let variantCount = 0;
try {
  const ps = require('pokemon-showdown');
  const { Dex } = ps;
  const pristineBaseMoves = { ...Dex.data.Moves };
  for (const [moveId, entry] of Object.entries(allMoves)) {
    const base = pristineBaseMoves[moveId];
    if (!base) continue; // brand-new SS2 move, no variant needed
    const customType = String(entry.type || '');
    if (!customType || customType === String(base.type || '')) continue;
    const variantKey = `${moveId}ss2`;
    if (allMoves[variantKey]) continue;
    allMoves[variantKey] = {
      ...base,
      ...entry,
      name: `${entry.name || base.name} (SS2)`,
      pp: Number(entry.pp) > 0 ? Number(entry.pp) : (Number(base.pp) > 0 ? Number(base.pp) : 15),
      target: entry.target || base.target || 'normal',
      priority: entry.priority ?? base.priority ?? 0,
      flags: entry.flags || base.flags || {},
      num: entry.num ?? base.num ?? 0,
    };
    variantCount++;
  }
  // Preserve vanilla engine mechanics (multihit, secondary, drain, self, etc.)
  // when a generated entry overrides a Showdown move but omits or EMPTIES those
  // fields. Deep-merged: normalizeMove() stamps flags:{} onto every entry, and a
  // shallow spread would let that empty object wipe base flags such as
  // `protect:1` (breaking protect-style custom moves).
  if (typeof pristineBaseMoves === 'object') {
    const deepMergeKeepBase = (baseObj, customObj) => {
      const out = { ...baseObj };
      for (const key of Object.keys(customObj)) {
        const value = customObj[key];
        const baseValue = baseObj ? baseObj[key] : undefined;
        if (
          value && typeof value === 'object' && !Array.isArray(value) &&
          baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
        ) {
          out[key] = deepMergeKeepBase(baseValue, value);
        } else {
          out[key] = value;
        }
      }
      return out;
    };
    let mergedCount = 0;
    for (const moveId of Object.keys(allMoves)) {
      const base = pristineBaseMoves[moveId];
      if (base && typeof base === 'object') {
        allMoves[moveId] = deepMergeKeepBase(base, allMoves[moveId]);
        mergedCount++;
      }
    }
    console.log(`Merged pristine base mechanics into ${mergedCount} overridden vanilla moves`);
  }
} catch (e) {
  console.warn('Could not load pokemon-showdown for variant baking:', e.message);
}
console.log(`Baked ${variantCount} SS2 retyped variants`);

const jsContent = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const customMoves = ${JSON.stringify(allMoves, null, 2)};
exports.default = customMoves;
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, jsContent, 'utf8');
console.log(`Wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);
console.log(`Total moves (incl. variants): ${Object.keys(allMoves).length}`);