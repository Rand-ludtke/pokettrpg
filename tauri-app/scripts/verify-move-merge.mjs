#!/usr/bin/env node
/**
 * Offline verification that fangame move packs no longer clobber canonical
 * Showdown moves. Mirrors mergeCustomMovePacks() from adapter.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const normalizeName = (id) => String(id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

function load(rel) {
  const p = path.join(PUB, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function mergeCustomMovePacks(baseMoves, packs) {
  const merged = { ...baseMoves };
  const variantKeysBySuffix = new Map();
  const stats = { added: 0, variants: 0, skippedSameType: 0 };
  const baseKeyByNorm = new Map();
  for (const key of Object.keys(baseMoves || {})) {
    const norm = normalizeName(key);
    if (norm && !baseKeyByNorm.has(norm)) baseKeyByNorm.set(norm, key);
  }
  for (const pack of packs) {
    if (!pack?.moves) continue;
    const variantMap = variantKeysBySuffix.get(pack.suffix) ?? new Map();
    variantKeysBySuffix.set(pack.suffix, variantMap);
    for (const [rawKey, entry] of Object.entries(pack.moves)) {
      if (!entry || typeof entry !== 'object') continue;
      const norm = normalizeName(rawKey);
      if (!norm) continue;
      const baseKey = baseKeyByNorm.get(norm);
      if (!baseKey) {
        if (!merged[norm]) { merged[norm] = entry; stats.added++; }
        continue;
      }
      const baseEntry = baseMoves[baseKey];
      const baseType = normalizeName(String(baseEntry?.type || ''));
      const customType = normalizeName(String(entry.type || ''));
      if (!customType || customType === baseType) { stats.skippedSameType++; continue; }
      const variantKey = `${norm}${pack.suffix}`;
      variantMap.set(norm, variantKey);
      if (merged[variantKey]) continue;
      merged[variantKey] = {
        ...baseEntry,
        ...entry,
        name: `${entry.name || baseEntry?.name || rawKey} (${pack.label})`,
      };
      stats.variants++;
    }
  }
  return { moves: merged, variantKeysBySuffix, stats };
}

const base = load('vendor/showdown/data/moves.json');
const ss2 = load('data/ss2-patch/generated/moves.custom.ss2-soulstones.json');
const ss1 = load('data/soulstones-part1/generated/moves.custom.soulstones-part1.json');
if (!base || !ss2) {
  console.error('Missing base or ss2 moves');
  process.exit(1);
}

const { moves, stats, variantKeysBySuffix } = mergeCustomMovePacks(base, [
  { label: 'Soulstones', suffix: 'ss1', moves: ss1 },
  { label: 'Soulstones 2', suffix: 'ss2', moves: ss2 },
]);

const checks = [
  ['swift', 'Normal'],
  ['moonblast', 'Fairy'],
  ['wish', 'Normal'],
  ['fakeout', 'Normal'],
  ['meteormash', 'Steel'],
  ['cosmicpower', 'Psychic'],
];

let failed = 0;
console.log('Canonical moves still intact:');
for (const [key, expectType] of checks) {
  const m = moves[key];
  const ok = m && m.type === expectType && m.pp != null;
  console.log(`  ${ok ? 'OK' : 'FAIL'} ${key}: type=${m?.type} pp=${m?.pp}`);
  if (!ok) failed++;
}

console.log('\nRetyped SS2 variants present:');
const ss2Map = variantKeysBySuffix.get('ss2') || new Map();
const sampleVariants = ['swift', 'moonblast', 'wish', 'fakeout', 'meteormash', 'cosmicpower', 'clangingscales', 'howl'];
for (const key of sampleVariants) {
  const vk = ss2Map.get(key);
  const m = vk ? moves[vk] : null;
  const ok = !!m && m.type && m.pp != null && m.name?.includes('Soulstones');
  console.log(`  ${ok ? 'OK' : 'SKIP'} ${key} -> ${vk || '(no type change)'}: type=${m?.type} pp=${m?.pp} name=${m?.name}`);
  if (ss2Map.has(key) && !ok) failed++;
}

// Chromera must remain Dark/Normal in base pokedex (extra-pokemon no longer overrides it)
const dex = load('vendor/showdown/data/pokedex.json');
const extra = load('data/custom-overrides/generated/extra-pokemon.json') || {};
const chromeraBase = dex?.chromera;
const chromeraExtra = extra?.chromera;
console.log('\nChromera:');
console.log(`  base types: ${JSON.stringify(chromeraBase?.types)}`);
console.log(`  extra override present: ${!!chromeraExtra}`);
if (chromeraExtra) {
  console.log('  FAIL: extra-pokemon still overrides chromera');
  failed++;
} else if (!chromeraBase?.types?.includes('Dark')) {
  console.log('  FAIL: base chromera missing Dark type');
  failed++;
} else {
  console.log('  OK: canonical Chromera preserved (no override)');
}

// Typechart has custom type entries
const tc = fs.readFileSync(path.join(PUB, 'vendor/showdown/data/typechart.js'), 'utf-8');
console.log('\nTypechart custom type entries:');
for (const t of ['sound', 'light', 'crystal', 'shadow', 'cosmic', 'nuclear', 'stellar']) {
  const ok = tc.includes(`${t}:{`);
  console.log(`  ${ok ? 'OK' : 'FAIL'} ${t}`);
  if (!ok) failed++;
}

console.log(`\nMerge stats: +${stats.added} new, +${stats.variants} variants, ${stats.skippedSameType} same-type skipped`);
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
