import fs from 'fs';

const PBS_MOVES = 'C:\\Users\\Rand L\\Downloads\\SS2 Latest Patch - v2.05\\PBS\\moves.txt';
const GEN_MOVES = 'd:/GitHub/pokettrpg/tauri-app/public/data/ss2-patch/generated/moves.custom.ss2-soulstones.json';

function normId(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }

// Parse PBS moves
const content = fs.readFileSync(PBS_MOVES, 'utf8');
const lines = content.split(/\r?\n/);
const blocks = [];
let cur = null;
for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('[') && line.endsWith(']')) {
    if (cur) blocks.push(cur);
    cur = { key: line.slice(1, -1).trim(), fields: {} };
    continue;
  }
  if (!cur) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  cur.fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
if (cur) blocks.push(cur);

const specialTypes = new Set(['sound', 'cosmic', 'light']);
const pbsSpecial = [];
for (const b of blocks) {
  const t = normId(b.fields.Type || '');
  if (specialTypes.has(t)) {
    pbsSpecial.push({ key: b.key, type: b.fields.Type, cat: b.fields.Category, pow: b.fields.Power, acc: b.fields.Accuracy });
  }
}
console.log('Total PBS moves:', blocks.length);
console.log('PBS special-type (Sound/Cosmic/Light) moves:', pbsSpecial.length);
for (const m of pbsSpecial.slice(0, 60)) console.log(`  ${m.key} | ${m.type}/${m.cat}/${m.pow}/${m.acc}`);

// Compare with generated JSON
const gen = JSON.parse(fs.readFileSync(GEN_MOVES, 'utf8'));
console.log('\nGenerated moves total:', Object.keys(gen).length);
const genSpecial = Object.entries(gen).filter(([k, v]) => specialTypes.has(normId(v.type)));
console.log('Generated special-type moves:', genSpecial.length);
for (const [k, v] of genSpecial.slice(0, 60)) console.log(`  ${k} | ${v.name} | ${v.type}/${v.category}/${v.basePower}`);

// Check which PBS special moves are missing from generated
const genKeys = new Set(Object.keys(gen).map(normId));
const missing = pbsSpecial.filter(m => !genKeys.has(normId(m.key)));
console.log('\nPBS special moves MISSING from generated JSON:', missing.length);
for (const m of missing) console.log(`  ${m.key} (${m.type})`);