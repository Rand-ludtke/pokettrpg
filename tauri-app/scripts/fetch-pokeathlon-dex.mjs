// fetch-pokeathlon-dex.mjs
//
// Pre-fetches the Pokeathlon fangame Pokedex (https://play.pokeathlon.com/data/pokedex.js)
// and bundles the "Custom" (fangame) entries as a static JSON file at:
//   tauri-app/public/data/pokeathlon/generated/pokedex.pokeathlon.json
//
// WHY THIS EXISTS: play.pokeathlon.com does not send an Access-Control-Allow-Origin
// header on its JS data endpoints, so a live `fetch()` call to it from a browser is
// ALWAYS blocked by CORS (this was verified directly against the live site). The app
// was previously trying to fetch it live in adapter.ts, which silently failed on every
// real deployment (GitHub Pages, production web) even though the same fetch worked fine
// from Node.js test scripts (Node's fetch doesn't enforce CORS). Sprites are unaffected
// (cross-origin <img> tags don't require CORS), only the JSON *data* fetch was broken.
//
// Run this script periodically (e.g. via `npm run fetch:pokeathlon`) to refresh the
// bundled dex snapshot. adapter.ts loads this local file instead of hitting the live
// pokeathlon.com endpoint directly.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'data', 'pokeathlon', 'generated');
const OUT_FILE = path.join(OUT_DIR, 'pokedex.pokeathlon.json');
const SOURCE_URL = 'https://play.pokeathlon.com/data/pokedex.js';

function extractBattlePokedex(rawText) {
  const m = rawText.match(/exports\.BattlePokedex\s*=\s*(\{)/);
  if (!m) return null;
  const startIdx = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = '';
  let i = startIdx;
  while (i < rawText.length) {
    const ch = rawText[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; i++; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { if (depth === 1) { i++; break; } depth--; }
    i++;
  }
  const body = rawText.slice(startIdx, i);
  return new Function(`return (${body})`)();
}

function normId(id) {
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

async function main() {
  console.log(`Fetching Pokeathlon pokedex from ${SOURCE_URL} ...`);
  const resp = await fetch(SOURCE_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch pokeathlon pokedex: ${resp.status} ${resp.statusText}`);
  }
  const rawText = await resp.text();
  const fullDex = extractBattlePokedex(rawText);
  if (!fullDex) {
    throw new Error('Unable to locate exports.BattlePokedex in the fetched pokeathlon source.');
  }

  // Mirror adapter.ts's existing injection filter exactly: only keep entries flagged
  // isNonstandard === 'Custom' (the fangame-original species), normalizing keys the
  // same way adapter.ts does (normalizeName = strip non-alphanumerics, lowercase).
  const injected = {};
  let total = 0;
  let kept = 0;
  for (const [id, entry] of Object.entries(fullDex)) {
    total++;
    if (!entry || typeof entry !== 'object') continue;
    if (entry.isNonstandard === 'Custom' && typeof entry.name === 'string') {
      injected[normId(id)] = entry;
      kept++;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(injected), 'utf8');

  const stats = fs.statSync(OUT_FILE);
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  Total pokeathlon dex entries fetched: ${total}`);
  console.log(`  Custom fangame entries bundled: ${kept}`);
  console.log(`  File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error('fetch-pokeathlon-dex failed:', err);
  process.exitCode = 1;
});
