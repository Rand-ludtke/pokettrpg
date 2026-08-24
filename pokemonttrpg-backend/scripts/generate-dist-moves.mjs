/**
 * generate-dist-moves.mjs
 *
 * Generates pokemonttrpg-backend/dist/data/moves.js from the client-side SS2 moves JSON.
 * This is the compiled JS version that the running backend requires.
 *
 * Run: node pokemonttrpg-backend/scripts/generate-dist-moves.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SS2_MOVES_JSON = path.join(__dirname, '..', '..', 'tauri-app', 'public', 'data', 'ss2-patch', 'generated', 'moves.custom.ss2-soulstones.json');
const OUT_DIR = path.join(__dirname, '..', 'dist', 'data');
const OUT_FILE = path.join(OUT_DIR, 'moves.js');

const ss2Moves = JSON.parse(fs.readFileSync(SS2_MOVES_JSON, 'utf8'));
console.log(`Loaded ${Object.keys(ss2Moves).length} SS2 moves`);

function normalizeMove(moveId, moveData) {
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
  allMoves[moveId] = normalizeMove(moveId, moveData);
}

const jsContent = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const customMoves = ${JSON.stringify(allMoves, null, 2)};
exports.default = customMoves;
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, jsContent, 'utf8');
console.log(`Wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);
console.log(`Total moves: ${Object.keys(allMoves).length}`);