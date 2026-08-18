#!/usr/bin/env node
/**
 * Audit collisions between canonical Showdown data and the custom fangame
 * data packs, replicating the exact merge order used by
 * tauri-app/src/data/adapter.ts loadShowdownDex().
 *
 * Run: node tauri-app/scripts/audit-data-collisions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');

const normalizeName = (id) => String(id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

function loadJson(rel) {
  const p = path.join(PUB, rel);
  if (!fs.existsSync(p)) return { __missing: rel };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    return { __error: `${rel}: ${err.message}` };
  }
}

function ok(obj, label) {
  if (!obj || obj.__missing) {
    console.log(`  [missing] ${label} -> ${obj?.__missing}`);
    return null;
  }
  if (obj.__error) {
    console.log(`  [parse-error] ${obj.__error}`);
    return null;
  }
  return obj;
}

// Merge order for MOVES, taken verbatim from adapter.ts loadShowdownDex().
const MOVE_SOURCES = [
  ['base',              'vendor/showdown/data/moves.json'],
  ['sage',              'data/sage/generated/moves.custom.sage.json'],
  ['wylin',             null], // embedded in wylin-customs.generated.json
  ['uranium',           'data/uranium/generated/moves.custom.uranium.json'],
  ['infinity',          'data/infinity/generated/moves.custom.infinity.json'],
  ['mariomon',          'data/mariomon/generated/moves.custom.mariomon.json'],
  ['soulstones-part1',  'data/soulstones-part1/generated/moves.custom.soulstones-part1.json'],
  ['ss2',               'data/ss2-patch/generated/moves.custom.ss2-soulstones.json'],
  ['extra-pokemon',     'data/custom-overrides/generated/moves.extra-pokemon.json'],
];

const DEX_SOURCES = [
  ['base',              'vendor/showdown/data/pokedex.json'],
  ['sage',              'data/sage/generated/pokedex.sage.json'],
  ['insurgence',        'data/insurgence/generated/pokedex.insurgence.json'],
  ['uranium',           'data/uranium/generated/pokedex.uranium.json'],
  ['infinity',          'data/infinity/generated/pokedex.infinity.json'],
  ['mariomon',          'data/mariomon/generated/pokedex.mariomon.json'],
  ['soulstones-part1',  'data/soulstones-part1/generated/pokedex.soulstones-part1.json'],
  ['ss2',              'data/ss2-patch/generated/pokedex.ss2-soulstones.json'],
  ['extra-pokemon',     'data/custom-overrides/generated/extra-pokemon.json'],
];

function auditCategory(title, sources, typeOf) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${title}`);
  console.log('='.repeat(72));

  const base = ok(loadJson(sources[0][1]), sources[0][0]);
  if (!base) { console.log('  base data unavailable — aborting this section'); return; }
  const baseKeys = new Map();
  for (const [k, v] of Object.entries(base)) baseKeys.set(normalizeName(k), v);
  console.log(`  base entries: ${baseKeys.size}`);

  let totalCollisions = 0;
  for (const [label, rel] of sources.slice(1)) {
    if (!rel) continue;
    const data = loadJson(rel);
    if (!data || data.__missing) { console.log(`\n  -- ${label}: file absent (${rel})`); continue; }
    if (data.__error) { console.log(`\n  -- ${label}: ${data.__error}`); continue; }

    const entries = Object.entries(data);
    const collisions = [];
    for (const [k, v] of entries) {
      const nk = normalizeName(k);
      if (baseKeys.has(nk)) collisions.push([nk, baseKeys.get(nk), v]);
    }
    totalCollisions += collisions.length;
    console.log(`\n  -- ${label}: ${entries.length} entries, ${collisions.length} COLLIDE with base`);

    // Of the collisions, how many actually CHANGE the type?
    const typeChanged = collisions.filter(([, b, c]) => {
      const bt = typeOf(b), ct = typeOf(c);
      return bt && ct && bt !== ct;
    });
    if (collisions.length) {
      console.log(`     of those, ${typeChanged.length} CHANGE the type`);
      const sample = typeChanged.length ? typeChanged : collisions;
      for (const [k, b, c] of sample.slice(0, 25)) {
        console.log(`       ${k.padEnd(24)} base=${String(typeOf(b)).padEnd(10)} custom=${typeOf(c)}`);
      }
      if (sample.length > 25) console.log(`       ... +${sample.length - 25} more`);
    }
  }
  console.log(`\n  TOTAL collisions against base in ${title}: ${totalCollisions}`);
}

auditCategory('MOVES', MOVE_SOURCES, (m) => m?.type);
auditCategory('POKEDEX', DEX_SOURCES, (s) => Array.isArray(s?.types) ? s.types.join('/') : undefined);

// Field-completeness check: custom moves missing battle-critical fields.
console.log(`\n${'='.repeat(72)}`);
console.log('CUSTOM MOVE FIELD COMPLETENESS (battle-critical fields)');
console.log('='.repeat(72));
const REQUIRED = ['num', 'pp', 'target', 'flags', 'priority'];
for (const [label, rel] of MOVE_SOURCES.slice(1)) {
  if (!rel) continue;
  const data = loadJson(rel);
  if (!data || data.__missing || data.__error) continue;
  const entries = Object.entries(data);
  if (!entries.length) continue;
  const missingCounts = {};
  for (const f of REQUIRED) {
    missingCounts[f] = entries.filter(([, v]) => v == null || v[f] === undefined).length;
  }
  const summary = REQUIRED.map((f) => `${f}:${missingCounts[f]}/${entries.length}`).join('  ');
  console.log(`  ${label.padEnd(20)} ${summary}`);
}
console.log('');
