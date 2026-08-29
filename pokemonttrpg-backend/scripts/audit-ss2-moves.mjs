/**
 * audit-ss2-moves.mjs — classify + infer intent for every SS2 move.
 *
 * Outputs:
 *   pokemonttrpg-backend/scripts/move-audit-results.json  (machine-readable)
 *   console: summary counts + list of "unmatched" moves needing explicit overrides
 *
 * Run: node pokemonttrpg-backend/scripts/audit-ss2-moves.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ps = require(path.resolve(__dirname, '../node_modules/pokemon-showdown'));
const pristineMoves = ps.Dex.data.Moves;

const { loadSS2Moves, inferAllMoves } = await import('./move-intent.mjs');

const ss2 = loadSS2Moves();
const inferred = inferAllMoves(ss2, pristineMoves);

const counts = { 'canonical-kept': 0, 'retyped-variant': 0, new: 0 };
const byRule = {};
const unmatched = [];
const overridden = [];

for (const [id, info] of Object.entries(inferred)) {
    counts[info.class]++;
    if (info.class !== 'new') continue;
    byRule[info.rule] = (byRule[info.rule] || 0) + 1;
    if (info.rule === 'unmatched') unmatched.push({ id, desc: ss2[id].desc, category: ss2[id].category, type: ss2[id].type, basePower: ss2[id].basePower });
    if (info.patch && info.patch._override) overridden.push(id);
}

console.log('=== SS2 Move Audit ===');
console.log(`Total SS2 moves: ${Object.keys(ss2).length}`);
console.log(`  canonical-kept:   ${counts['canonical-kept']}`);
console.log(`  retyped-variant:  ${counts['retyped-variant']}`);
console.log(`  new (inferred):   ${counts.new}`);
console.log('');
console.log('New-move inference breakdown:');
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule}: ${n}`);
}
console.log('');
console.log(`Unmatched (need explicit override): ${unmatched.length}`);
for (const m of unmatched) {
    console.log(`  - ${m.id} [${m.category}/${m.basePower}/${m.type}] ${m.desc}`);
}

const outPath = path.join(__dirname, 'move-audit-results.json');
fs.writeFileSync(outPath, JSON.stringify({ counts, byRule, unmatched, inferred }, null, 2));
console.log(`\nWrote ${outPath}`);


