/**
 * copy-ss2-sprites.mjs
 *
 * Copies SS2 (Soulstones 2) sprites from the local PBS download to the
 * tauri-app/public/sprites/ directory with the correct naming convention.
 *
 * SS2 naming convention:
 *   POKEMON.png        = vanilla form (skip — PS already covers these)
 *   POKEMON2.png       = Orion form   → pokemon-orion.png
 *   POKEMON2_1.png     = Orion form variant 1 → skip (use primary)
 *   SHELLOS_1.png      = Shellos form 1 (Shellsea) → shellsea.png
 *   SHELLOS_2.png      = Shellos form 2 (Shew)     → shew.png
 *   GASTRODON_1.png    = Gastrodon form 1 (Gastrodra) → gastrodra.png
 *   000.png            = placeholder  → skip
 *
 * Run: node tauri-app/scripts/copy-ss2-sprites.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SS2_BASE = 'C:\\Users\\Rand L\\Downloads\\SS2 Latest Patch - v2.05\\Graphics\\Pokemon';
const OUT_BASE = path.join(__dirname, '..', 'public', 'sprites');

// normId: strip non-alphanumerics to lowercase (matches adapter.ts normalizeName)
function normId(s) {
  return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// --- Shellos / Gastrodon dragon form name mappings (form index → name) ---
// Based on SS2 PBS pokemon_forms.txt FormName field.
// Order: forms are numbered _1 through _N in the sprite files.
const SHELLOS_FORMS = {
  1: 'shellsea',    // Dragon/Water
  2: 'shew',        // Dragon/Steel
  3: 'sheino',      // Dragon/Dark
  4: 'shommoo',     // Dragon/Fighting (Shommo-o → shommoo)
  5: 'swallos',     // Dragon/Fairy
  6: 'shapinch',    // Dragon/Bug
  7: 'shible',      // Dragon/Ground
  8: 'shapplin',    // Dragon/Grass
  9: 'sheepy',      // Dragon/Ghost
  10: 'shrelp',     // Dragon/Poison
  11: 'shyrunt',    // Dragon/Rock
  12: 'shagon',     // Dragon/Flying
  13: 'shibax',     // Dragon/Ice
};

const GASTRODON_FORMS = {
  1: 'gastrodra',   // Dragon/Water
  2: 'gaxorus',     // Dragon/Steel
  3: 'gastreigon',  // Dragon/Dark
  4: 'gastroo',     // Dragon/Fighting (Gastro-o → gastroo)
  5: 'gastaria',    // Dragon/Fairy
  6: 'gastrogon',   // Dragon/Bug
  7: 'gastrochomp', // Dragon/Ground
  8: 'gastrapple',  // Dragon/Grass
  9: 'gastrapult',  // Dragon/Ghost
  10: 'gastralge',  // Dragon/Poison
  11: 'gastrantrum',// Dragon/Rock
  12: 'gastramence',// Dragon/Flying
  13: 'gascalibur', // Dragon/Ice
};

// --- Folder mappings: source subfolder → output subfolder ---
const FOLDER_MAP = [
  { src: 'Front',        dst: 'gen5',           ext: 'png' },
  { src: 'Back',         dst: 'gen5-back',       ext: 'png' },
  { src: 'Front shiny',  dst: 'gen5-shiny',      ext: 'png' },
  { src: 'Back shiny',   dst: 'gen5-back-shiny', ext: 'png' },
];

// The 21 "truly new" SS2 Pokémon that get the 'ss2' suffix in our dex
// (canonical species given different types in SS2 → stored as pokemonss2)
const TRULY_NEW_SS2 = new Set([
  'WURMPLE', 'REGIROCK', 'REGICE', 'REGISTEEL', 'MANAPHY', 'DARKRAI',
  'CRESSELIA', 'TAPUKOKO', 'TAPULELE', 'TAPUBULU', 'TAPUFINI',
  'MELTAN', 'MELMETAL', 'NIDORANfE', 'NIDORANmA', 'DIALGA', 'PALKIA',
  'GIRATINA', 'ARCEUS',
]);

// normId for "truly new" key — matches generate-ss2-patch.mjs Strategy 3
function trueNewKey(base) {
  return normId(base) + 'ss2';
}

function mapSS2Filename(filename) {
  // Returns { destFilename } or null to skip
  const base = path.basename(filename, '.png').toUpperCase();

  // Skip placeholder
  if (base === '000') return null;

  // Shellos dragon forms: SHELLOS_N.png → {formName}.png
  const shellosMatch = base.match(/^SHELLOS_(\d+)$/);
  if (shellosMatch) {
    const idx = parseInt(shellosMatch[1], 10);
    const name = SHELLOS_FORMS[idx];
    if (!name) return null;
    return { destFilename: `${name}.png` };
  }

  // Gastrodon dragon forms: GASTRODON_N.png → {formName}.png
  const gastroMatch = base.match(/^GASTRODON_(\d+)$/);
  if (gastroMatch) {
    const idx = parseInt(gastroMatch[1], 10);
    const name = GASTRODON_FORMS[idx];
    if (!name) return null;
    return { destFilename: `${name}.png` };
  }

  // Skip all other _N suffixed forms (visual variants, mega variants, etc.)
  // We only want the primary form sprite for each species.
  if (base.includes('_')) return null;

  // Skip secondary variant suffixes: POKEMON2_... (already excluded above by _ check)
  // POKEMON2.png files: Skip — see explanation below.
  // In SS2, POKEMON.png IS the Orion form. POKEMON2.png appears to be a
  // duplicate/second art variant for some species; we use POKEMON.png as primary.
  if (/\d$/.test(base)) return null;

  // Primary SS2 sprite: POKEMON.png
  // For "truly new" SS2 entries (canonical species with different types):
  // Copy as pokemon-ss2.png to match dex key (e.g. 'darkraiss2')
  if (TRULY_NEW_SS2.has(base)) {
    return { destFilename: `${normId(base)}-ss2.png` };
  }

  // For all other Pokémon: copy as pokemon-orion.png (the Orion form sprite)
  const pokemonName = normId(base);
  if (!pokemonName) return null;
  return { destFilename: `${pokemonName}-orion.png` };
}

let copied = 0;
let skipped = 0;
let errors = 0;

for (const { src, dst } of FOLDER_MAP) {
  const srcDir = path.join(SS2_BASE, src);
  const dstDir = path.join(OUT_BASE, dst);

  if (!fs.existsSync(srcDir)) {
    console.log(`Skipping missing folder: ${srcDir}`);
    continue;
  }

  fs.mkdirSync(dstDir, { recursive: true });

  const files = fs.readdirSync(srcDir).filter(f => f.toLowerCase().endsWith('.png'));

  for (const file of files) {
    const mapped = mapSS2Filename(file, { src, dst });
    if (!mapped) {
      skipped++;
      continue;
    }
    const srcPath = path.join(srcDir, file);
    const dstPath = path.join(dstDir, mapped.destFilename);
    try {
      fs.copyFileSync(srcPath, dstPath);
      copied++;
      if (copied <= 20) {
        console.log(`  ${dst}/${file} → ${dst}/${mapped.destFilename}`);
      }
    } catch (e) {
      console.error(`  ERROR copying ${file}: ${e.message}`);
      errors++;
    }
  }
}

console.log(`\n=== Results ===`);
console.log(`Copied: ${copied}`);
console.log(`Skipped (vanilla/placeholder): ${skipped}`);
console.log(`Errors: ${errors}`);

// Sample verification
const checkFiles = ['gen5/abra-orion.png', 'gen5/shellos-orion.png', 'gen5/shellsea.png', 'gen5/gastrodra.png', 'gen5/shommoo.png'];
console.log('\n=== Sample Verification ===');
for (const f of checkFiles) {
  const full = path.join(OUT_BASE, f);
  console.log(`${f}: ${fs.existsSync(full) ? '✓ EXISTS' : '✗ MISSING'}`);
}
