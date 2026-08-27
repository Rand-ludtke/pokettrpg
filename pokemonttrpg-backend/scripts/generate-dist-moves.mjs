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

// Build the FULL table: pristine canonical Showdown moves first, then apply
// the SS2 pack using the exact rules proven in tauri-app/src/data/adapter.ts
// (mergeCustomMovePacks). Raw PBS/fangame entries that collide with canonical
// Showdown moves carry bogus battle-critical defaults (target:'normal',
// priority:0, flags:{}) which previously wiped real mechanics once injected
// into Dex.data.Moves (Protect blocked nothing, Dragon Dance gave no boosts,
// Stealth Rock / Sticky Web / Leech Seed did nothing, priority moves lost
// their priority, healing moves healed nothing). Therefore:
//   Rule A: same-type collision -> DO NOT EMIT the custom entry; the pristine
//           canonical move stays in the table (100% intact mechanics).
//   Rule B: different-type collision -> emit ONLY a <key>ss2 variant built on
//           top of the pristine base entry so target/priority/flags/multihit/
//           drain/handlers all survive; display + typed fields come from the
//           fan-game entry.
// Emitting the full canonical table as well preserves this file's historical
// superset shape (~1400+ entries) for direct-lookup consumers and deployments.
let droppedCollisions = 0;
let variantCount = 0;
let addedNew = 0;
const ps = require('pokemon-showdown');
const { Dex } = ps;
const pristineBaseMoves = { ...Dex.data.Moves };
const allMoves = {};
for (const [moveId, moveData] of Object.entries(pristineBaseMoves)) {
    allMoves[moveId] = moveData;
}
const idOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Display-only / typed fields a fan-game PBS entry is allowed to override.
const VARIANT_OVERRIDABLE = new Set(['type', 'name', 'desc', 'shortDesc', 'basePower', 'category', 'accuracy', 'pp']);
const buildRetypeVariant = (baseEntry, entry) => {
    const out = { ...baseEntry };
    for (const k of Object.keys(entry)) {
        if (!VARIANT_OVERRIDABLE.has(k)) continue;
        const v = entry[k];
        if (v == null) continue;
        out[k] = v;
    }
    // Explicitly canonical battle-critical fields: never inherit PBS defaults.
    out.target = baseEntry.target || 'normal';
    out.priority = typeof baseEntry.priority === 'number' ? baseEntry.priority : 0;
    out.flags = { ...(baseEntry.flags || {}) };
    out.pp = Number(out.pp) > 0 ? Number(out.pp) : Number(baseEntry.pp) > 0 ? Number(baseEntry.pp) : 15;
    out.num = 0;
    out.isNonstandard = 'Custom';
    out.name = `${entry.name || baseEntry.name} (SS2)`;
        return out;
};

// Detect fangame healing moves that were stamped with PBS defaults (no heal
// condition, attacking-style target) and need the canonical 50% self-heal
// archetype so the engine emits |-heal| instead of |-damage|.
const SELF_HEAL_MOVE_IDS = new Set(['nagaskin', 'nectartap', 'odetojoy']);
function isSelfHealMove(entry, moveId) {
    if (SELF_HEAL_MOVE_IDS.has(moveId)) return true;
    if (entry && entry.heal) return true;
    const desc = String(entry && (entry.desc || entry.shortDesc || '')).toLowerCase();
    if (/\bheals? (user|theirself|them)s? for\b/.test(desc)) return true;
    if (/restores? its own hp/.test(desc)) return true;
    if (/restores their own hp/.test(desc)) return true;
    return false;
}

for (const [moveId, rawEntry] of Object.entries(ss2Moves)) {
    const entry = normalizeMove(rawEntry);
        const base = pristineBaseMoves[moveId];
    if (!base) {
        // Brand-new fangame move: add with sane PP/target defaults.
        if (isSelfHealMove(entry, moveId)) {
            // Healing moves exported from PBS JSON carry no heal condition and an
            // attacking-style target, so the engine would treat them as attacks.
            // Stamp the canonical 50% self-heal archetype (mirrors PS's Recover).
            entry.target = 'self';
            entry.category = 'Status';
            entry.basePower = 0;
            entry.flags = { ...(entry.flags || {}), heal: 1, snatch: 1, metronome: 1 };
            entry.heal = [1, 2];
            entry.secondary = null;
        }
        if (!allMoves[moveId]) addedNew++;
        allMoves[moveId] = entry;
        continue;
    }
    const customType = idOf(entry.type || '');
    if (!customType || customType === idOf(String(base.type || ''))) {
        // Rule A: same-type collision -> pristine canonical entry stays.
        droppedCollisions++;
        continue;
    }
    // Rule B: different typing -> retyped variant alongside the canonical move.
    const variantKey = `${moveId}ss2`;
    if (!allMoves[variantKey]) {
        allMoves[variantKey] = buildRetypeVariant(base, entry);
        variantCount++;
    }
}
console.log(`Canonical collisions kept vanilla: ${droppedCollisions}; new SS2 moves: ${addedNew}; SS2 retyped variants baked: ${variantCount}`);


const jsContent = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const customMoves = ${JSON.stringify(allMoves, null, 2)};
exports.default = customMoves;
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, jsContent, 'utf8');
console.log(`Wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);
console.log(`Total moves (incl. variants): ${Object.keys(allMoves).length}`);