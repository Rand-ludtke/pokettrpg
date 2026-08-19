/**
 * analyze-ss2-unmatched.mjs
 * Categorizes the 279 unmatched SS2 PBS entries to understand what strategy to use.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PBS_DIR = 'C:\\Users\\Rand L\\Downloads\\SS2 Latest Patch - v2.05\\PBS';
const POKEATHLON_JSON = path.join(__dirname, '..', 'public', 'data', 'pokeathlon', 'generated', 'pokedex.pokeathlon.json');

function normId(s) {
  return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function pbsTypeToDisplay(t) {
  const s = String(t || '').trim().toUpperCase();
  const specialMap = { 'COSMIC': 'Cosmic', 'SOUND': 'Sound', 'LIGHT': 'Light', 'NUCLEAR': 'Nuclear', 'STELLAR': 'Stellar', 'CRYSTAL': 'Crystal', 'SHADOW': 'Shadow' };
  if (specialMap[s]) return specialMap[s];
  return titleCase(s);
}

function parsePBSBlocks(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      if (current) blocks.push(current);
      const inner = line.slice(1, -1);
      const parts = inner.split(',');
      current = { _key: parts[0].trim(), _formId: parts[1] != null ? parseInt(parts[1].trim(), 10) : undefined, _raw: {} };
      continue;
    }
    if (!current) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    current._raw[key] = val;
  }
  if (current) blocks.push(current);
  return blocks;
}

// Load data
const pokeathlon = JSON.parse(fs.readFileSync(POKEATHLON_JSON, 'utf8'));
const pokeathlonKeys = Object.keys(pokeathlon);

// Build lookups
const pokeathlonByNormId = new Map();
for (const key of pokeathlonKeys) {
  pokeathlonByNormId.set(normId(key), key);
}

const orionByNameAndTypes = new Map();
for (const [key, entry] of Object.entries(pokeathlon)) {
  if (!key.endsWith('orion') && !key.endsWith('temporal')) continue;
  if (!entry || !entry.types) continue;
  const baseKey = key.replace(/(?:orion|temporal)$/, '');
  const typeKey = (entry.types || []).map(t => normId(t)).sort().join('');
  const lookupKey = `${baseKey}_${typeKey}`;
  if (!orionByNameAndTypes.has(lookupKey)) {
    orionByNameAndTypes.set(lookupKey, [key, entry]);
  }
}

// Parse PBS
const pbsBlocks = parsePBSBlocks(path.join(PBS_DIR, 'pokemon.txt'));

const categories = {
  orionTemporal: [],    // Already matched in main script
  directPokeathlon: [], // In pokeathlon but NOT with orion/temporal suffix (galaxeon, etc.)
  suffix2WithMatch: [], // '2' suffix variants where base has orion/temporal match
  suffix2Direct: [],    // '2' suffix variants where base is in pokeathlon directly
  trulyNew: [],         // Not in pokeathlon at all - need to add from PBS data
};

for (const block of pbsBlocks) {
  const r = block._raw;
  if (!r.Types || !r.BaseStats) continue;
  
  const pbsTypes = r.Types.split(',').map(t => pbsTypeToDisplay(t.trim()));
  const typeKey = pbsTypes.map(t => normId(t)).sort().join('');
  const baseKey = normId(block._key);
  
  // 1. Check orion/temporal (already handled in main script)
  const orionLk = `${baseKey}_${typeKey}`;
  if (orionByNameAndTypes.has(orionLk)) {
    categories.orionTemporal.push({ pbsName: block._key, types: pbsTypes.join('/') });
    continue;
  }
  
  // 2. Direct pokeathlon match (not orion/temporal)
  const directKey = pokeathlonByNormId.get(baseKey);
  if (directKey && !directKey.endsWith('orion') && !directKey.endsWith('temporal')) {
    categories.directPokeathlon.push({ pbsName: block._key, pokeathlonKey: directKey, types: pbsTypes.join('/'), pokeathlonTypes: (pokeathlon[directKey]?.types || []).join('/') });
    continue;
  }
  
  // 3. Check '2' suffix variants
  if (block._key.endsWith('2')) {
    const baseWithout2 = normId(block._key.slice(0, -1));
    const orionLk2 = `${baseWithout2}_${typeKey}`;
    if (orionByNameAndTypes.has(orionLk2)) {
      categories.suffix2WithMatch.push({ pbsName: block._key, types: pbsTypes.join('/'), matchKey: orionByNameAndTypes.get(orionLk2)[0] });
      continue;
    }
    const directKey2 = pokeathlonByNormId.get(baseWithout2);
    if (directKey2) {
      categories.suffix2Direct.push({ pbsName: block._key, types: pbsTypes.join('/'), matchKey: directKey2, pokeathlonTypes: (pokeathlon[directKey2]?.types || []).join('/') });
      continue;
    }
  }
  
  // 4. Truly new
  categories.trulyNew.push({ pbsName: block._key, types: pbsTypes.join('/'), baseStats: r.BaseStats, name: r.Name });
}

console.log('=== SS2 Unmatched Analysis ===');
console.log('Orion/Temporal (already handled):', categories.orionTemporal.length);
console.log('Direct pokeathlon match (new standalone mons):', categories.directPokeathlon.length);
console.log('Suffix-2 with orion/temporal match:', categories.suffix2WithMatch.length);
console.log('Suffix-2 with direct match:', categories.suffix2Direct.length);
console.log('Truly new (not in pokeathlon at all):', categories.trulyNew.length);
console.log('');
console.log('=== Direct pokeathlon (standalone) - first 20 ===');
categories.directPokeathlon.slice(0, 20).forEach(e => console.log(` ${e.pbsName} → ${e.pokeathlonKey} [PBS:${e.types}] [Pokeathlon:${e.pokeathlonTypes}]`));
console.log('');
console.log('=== Truly new (sample 30) ===');
categories.trulyNew.slice(0, 30).forEach(e => console.log(` ${e.pbsName} [${e.types}] - ${e.name || e.pbsName}`));
console.log('');
console.log('Total truly new:', categories.trulyNew.length);
