/**
 * Update sprite base64 data in wylin-customs.generated.json
 * from PNG files in .fusion-sprites-local/Other/BaseSprites/
 *
 * Usage: node scripts/update-wylin-sprites.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const BASESPRITES_DIR = join(ROOT, '.fusion-sprites-local', 'Other', 'BaseSprites');
const JSON_PATH = join(ROOT, 'tauri-app', 'public', 'data', 'more-pokemon', 'generated', 'wylin-customs.generated.json');

// ── File-name → JSON sprite key mapping ──
// Most map directly; regionals reverse the prefix; some have spelling diffs.
const FILE_TO_KEY = {
  // Direct mappings
  'ameroc':           'ameroc',
  'armydillo':        'armydillo',
  'arweet':           'arweet',
  'babuffall':        'babuffall',
  'babuffall-mega':   'babuffallmega',
  'bleepoat':        'bleepoat',
  'bufflow':          'bufflow',
  'bullwart':         'bullwart',
  'farmine':          'farmine',
  'felandit':         'felandit',
  'felindillo':       'felindillo',
  'feraldillo':       'feraldillo',
  'ferrodillo':       'ferrodillo',
  'ferrodillo-mega':  'ferrodillomega',
  'gardam':           'gardam',
  'goldica':          'goldica',
  'gortez':           'gortez',
  'hoggore':          'hoggore',
  'howound':          'howound',
  'howound-mega':     'howoundmega',
  'hydruffo':         'hydruffo',
  'monquisitor':      'monquisitor',
  'rockram':          'rockram',
  'rockram-mega':     'rockrammega',
  'rodiole':          'rodiole',
  'rodiole-mega':     'rodiolemega',
  'sheeruf':          'sheeruf',

  // Reversed regional prefix
  'chatot-wylin':     'wylinchatot',
  'gallade-wylin':    'wylingallade',
  'gardevoir-wylin':  'wylingardevoir',
  'kirlia-wylin':     'wylinkirlia',
  'lechonk-wylian':   'wylianlechonk',
  'ralts-wylin':      'wylinralts',

  // Spelling differences (file → JSON)
  'cattastophie':     'cattastrophie',
  'dogrun':           'dugrun',
  'monkiestidor':     'monkiestitdor',

  // New variants (may need sprite entries created)
  'bullwart-stienmark':     'bullwartstienmark',
  'cattastophie-stienmark': 'cattastrophiestienmark',
  'rodiole-stienmark':      'rodiolestienmark',
  'gardevoir-wylin-mega':   'wylingardevoirmega',
};

function pngToDataUrl(filePath) {
  const buf = readFileSync(filePath);
  return 'data:image/png;base64,' + buf.toString('base64');
}

// ── Main ──
const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const sprites = json.sprites;

// Collect all named (non-numbered) PNG files
const allFiles = readdirSync(BASESPRITES_DIR)
  .filter(f => f.endsWith('.png') && !/^\d/.test(f));

// Group files: baseName → { normal?: path, shiny?: path }
const groups = new Map();
for (const file of allFiles) {
  const stem = file.replace('.png', '');
  // Detect shiny variants — handle both "X-shiny" and "X-shiny-mega" / "X-mega-shiny"
  // The shiny flag is removed to get the base name
  let isShiny = false;
  let baseName = stem;

  // Handle "-shiny-mega" (e.g. rockram-shiny-mega → rockram-mega, shiny)
  if (stem.endsWith('-shiny-mega')) {
    baseName = stem.replace('-shiny-mega', '-mega');
    isShiny = true;
  }
  // Handle "-mega-shiny" (e.g. ferrodillo-mega-shiny → ferrodillo-mega, shiny)
  else if (stem.endsWith('-mega-shiny')) {
    baseName = stem.replace('-mega-shiny', '-mega');
    isShiny = true;
  }
  // Handle "-stienmark-shiny"
  else if (stem.endsWith('-stienmark-shiny')) {
    baseName = stem.replace('-stienmark-shiny', '-stienmark');
    isShiny = true;
  }
  // Handle regular "-shiny" suffix
  else if (stem.endsWith('-shiny')) {
    baseName = stem.replace(/-shiny$/, '');
    isShiny = true;
  }

  if (!groups.has(baseName)) groups.set(baseName, {});
  const entry = groups.get(baseName);
  const fullPath = join(BASESPRITES_DIR, file);
  if (isShiny) {
    entry.shiny = fullPath;
  } else {
    entry.normal = fullPath;
  }
}

let updated = 0;
let created = 0;
let skipped = 0;

for (const [baseName, files] of groups) {
  const key = FILE_TO_KEY[baseName];
  if (!key) {
    console.warn(`⚠ No mapping for file base: "${baseName}" — skipping`);
    skipped++;
    continue;
  }

  // Create sprite entry if it doesn't exist
  if (!sprites[key]) {
    sprites[key] = {};
    console.log(`+ Created new sprite entry: ${key}`);
    created++;
  }

  // Update normal sprite → front + gen5
  if (files.normal) {
    const dataUrl = pngToDataUrl(files.normal);
    sprites[key].front = dataUrl;
    sprites[key].gen5 = dataUrl;
    console.log(`  ✓ ${key}.front/gen5 ← ${baseName}.png`);
    updated++;
  }

  // Update shiny sprite → shiny + gen5-shiny
  if (files.shiny) {
    const dataUrl = pngToDataUrl(files.shiny);
    sprites[key].shiny = dataUrl;
    sprites[key]['gen5-shiny'] = dataUrl;
    console.log(`  ✓ ${key}.shiny/gen5-shiny ← ${baseName}-shiny.png`);
    updated++;
  }
}

// Write back
writeFileSync(JSON_PATH, JSON.stringify(json));
console.log(`\nDone! Updated ${updated} slots, created ${created} entries, skipped ${skipped} unmapped.`);
