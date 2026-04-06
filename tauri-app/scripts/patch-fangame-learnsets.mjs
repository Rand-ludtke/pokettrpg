#!/usr/bin/env node
/**
 * Patch fangame learnsets with real data from wiki sources.
 *
 * - Uranium: Scrapes the Pokemon Uranium Fandom wiki via API
 * - Infinity: Enhances "egho" (echo/ghost) variants by inheriting gen-9
 *   learnset entries from their base species in the standard Showdown dex
 *
 * Usage:  node scripts/patch-fangame-learnsets.mjs [--uranium] [--infinity] [--all]
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'public', 'data');
const POKEATHLON_BASE = 'https://play.pokeathlon.com/data';

// ═══════════════════════════════════════════════════════════════════════════
//  Utility helpers
// ═══════════════════════════════════════════════════════════════════════════

function toId(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Uranium TM / HM → move-id mapping  (from the wiki's TM_and_HM_list page)
// ═══════════════════════════════════════════════════════════════════════════

const URANIUM_TM_MAP = {
  TM01: 'focuspunch',    TM02: 'dragonclaw',     TM03: 'waterpulse',
  TM04: 'calmmind',      TM05: 'roar',           TM06: 'toxic',
  TM07: 'hail',          TM08: 'bulkup',         TM09: 'bulletseed',
  TM10: 'hiddenpower',   TM11: 'sunnyday',       TM12: 'taunt',
  TM13: 'icebeam',       TM14: 'blizzard',       TM15: 'hyperbeam',
  TM16: 'lightscreen',   TM17: 'protect',        TM18: 'raindance',
  TM19: 'gigadrain',     TM20: 'safeguard',      TM21: 'frustration',
  TM22: 'solarbeam',     TM23: 'irontail',       TM24: 'thunderbolt',
  TM25: 'thunder',       TM26: 'earthquake',     TM27: 'return',
  TM28: 'dig',           TM29: 'psychic',        TM30: 'shadowball',
  TM31: 'brickbreak',    TM32: 'doubleteam',     TM33: 'reflect',
  TM34: 'shockwave',     TM35: 'flamethrower',   TM36: 'sludgebomb',
  TM37: 'sandstorm',     TM38: 'fireblast',      TM39: 'rocktomb',
  TM40: 'aerialace',     TM41: 'torment',        TM42: 'facade',
  TM43: 'secretpower',   TM44: 'rest',           TM45: 'attract',
  TM46: 'thief',         TM47: 'steelwing',      TM48: 'skillswap',
  TM49: 'snatch',        TM50: 'overheat',       TM51: 'roost',
  TM52: 'focusblast',    TM53: 'energyball',     TM54: 'falseswipe',
  TM55: 'brine',         TM56: 'fling',          TM57: 'chargebeam',
  TM58: 'endure',        TM59: 'dragonpulse',    TM60: 'drainpunch',
  TM61: 'willowisp',     TM62: 'silverwind',     TM63: 'embargo',
  TM64: 'explosion',     TM65: 'shadowclaw',     TM66: 'payback',
  TM67: 'recycle',       TM68: 'gigaimpact',     TM69: 'rockpolish',
  TM70: 'flash',         TM71: 'stoneedge',      TM72: 'avalanche',
  TM73: 'thunderwave',   TM74: 'gyroball',       TM75: 'swordsdance',
  TM76: 'stealthrock',   TM77: 'psychup',        TM78: 'captivate',
  TM79: 'darkpulse',     TM80: 'rockslide',      TM81: 'xscissor',
  TM82: 'sleeptalk',     TM83: 'naturalgift',    TM84: 'poisonjab',
  TM85: 'dreameater',    TM86: 'grassknot',      TM87: 'swagger',
  TM88: 'pluck',         TM89: 'uturn',          TM90: 'substitute',
  TM91: 'flashcannon',   TM92: 'trickroom',      TM93: 'infestation',
  TM94: 'dazzlinggleam', TM95: 'causticbreath',  TM96: 'coralbreak',
  TM97: 'superfang',     TM98: 'lastresort',     TM99: 'endeavor',
  TM100: 'zenheadbutt',
  HM02: 'fly',           HM03: 'surf',           HM04: 'strength',
  HM06: 'rocksmash',     HM07: 'waterfall',      HM08: 'dive',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Species-ID → Wiki-page-name mapping for Uranium
// ═══════════════════════════════════════════════════════════════════════════

const URANIUM_NAME_OVERRIDES = {
  s51:              'S51',
  s51a:             'S51-A',
  maskingnuclear:   null,       // Nuclear forme – lives on the Masking page
};

function uraniumWikiName(speciesId) {
  if (speciesId in URANIUM_NAME_OVERRIDES) {
    return URANIUM_NAME_OVERRIDES[speciesId];
  }
  // Default: capitalize first letter
  return speciesId.charAt(0).toUpperCase() + speciesId.slice(1);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Wiki-text parsers
// ═══════════════════════════════════════════════════════════════════════════

function parseLevelUpMoves(wikitext) {
  const moves = [];
  // Match {{MoveLevel+|LEVEL|MOVE NAME|...}}
  const re = /\{\{MoveLevel\+\|(\d+)\|([^|{}]+)/g;
  let m;
  while ((m = re.exec(wikitext)) !== null) {
    moves.push({ level: parseInt(m[1], 10), move: m[2].trim() });
  }
  return moves;
}

function parseTMMoves(wikitext) {
  const ids = [];
  // Match {{MoveTM+|TMxx|...}} or {{MoveTM+|HMxx|...}}
  const re = /\{\{MoveTM\+\|((?:TM|HM)\d+)/g;
  let m;
  while ((m = re.exec(wikitext)) !== null) {
    const tmKey = m[1].trim().toUpperCase();
    const moveId = URANIUM_TM_MAP[tmKey];
    if (moveId) ids.push(moveId);
    else console.warn(`    Unknown TM/HM key: ${tmKey}`);
  }
  return ids;
}

function parseEggMoves(wikitext) {
  const moves = [];
  // Manual parser because the parents column can contain nested {{MS|…}} templates
  // which confuse simple regex-based pipe splitting.
  const marker = '{{MoveBreed+|';
  let pos = 0;
  while ((pos = wikitext.indexOf(marker, pos)) !== -1) {
    // Find the matching closing }} by counting brace depth
    let depth = 0;
    let end = -1;
    for (let i = pos; i < wikitext.length - 1; i++) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i++; }
      else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
        depth--;
        if (depth === 0) { end = i + 2; break; }
        i++;
      }
    }
    if (end === -1) break;
    // Split the template content by top-level pipes (not inside nested {{}})
    const inner = wikitext.slice(pos + 2, end - 2); // between {{ and }}
    const parts = splitTopLevelPipes(inner);
    // parts[0] = "MoveBreed+", parts[1] = parents, parts[2] = move name, ...
    if (parts.length >= 3) {
      const name = parts[2].replace(/'''/g, '').replace(/<\/?u>/g, '').trim();
      if (name && /^[A-Z]/i.test(name)) moves.push(name);
    }
    pos = end;
  }
  return moves;
}

/** Split a string by `|` only at the top level (not inside nested {{ }}) */
function splitTopLevelPipes(str) {
  const parts = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{' && i + 1 < str.length && str[i + 1] === '{') {
      depth++; current += '{{'; i++;
    } else if (str[i] === '}' && i + 1 < str.length && str[i + 1] === '}') {
      depth--; current += '}}'; i++;
    } else if (str[i] === '|' && depth === 0) {
      parts.push(current); current = '';
    } else {
      current += str[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseTutorMoves(wikitext) {
  const moves = [];
  // Match {{MoveTutor+|MOVE NAME|...}}
  const re = /\{\{MoveTutor\+\|([^|{}]+)/g;
  let m;
  while ((m = re.exec(wikitext)) !== null) {
    moves.push(m[1].trim());
  }
  return moves;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fandom wiki API fetcher
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWikiPage(wikiDomain, pageName) {
  const url = `https://${wikiDomain}/api.php?action=parse` +
    `&page=${encodeURIComponent(pageName)}&format=json&prop=wikitext`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
  return json.parse?.wikitext?.['*'] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Uranium patching
// ═══════════════════════════════════════════════════════════════════════════

async function patchUranium() {
  console.log('\n══════════════════════════════════════');
  console.log('  Patching Uranium learnsets from wiki');
  console.log('══════════════════════════════════════\n');

  const lsPath = join(DATA_DIR, 'uranium', 'generated', 'learnsets.uranium.json');
  const learnsets = JSON.parse(readFileSync(lsPath, 'utf8'));
  const speciesIds = Object.keys(learnsets);
  console.log(`Species to process: ${speciesIds.length}`);

  let patched = 0, skipped = 0, failed = 0;
  const failures = [];

  // Process Masking page once (it has both regular and nuclear forms)
  let maskingWikitext = null;

  for (const id of speciesIds) {
    const wikiName = uraniumWikiName(id);

    // maskingnuclear shares the Masking page
    if (id === 'maskingnuclear') {
      if (!maskingWikitext) {
        maskingWikitext = await fetchWikiPage('pokemon-uranium.fandom.com', 'Masking');
        await sleep(300);
      }
      // Nuclear Masking likely shares the same moveset
      // Use the Masking page data but keep existing learnset if parsing fails
      if (maskingWikitext) {
        const result = buildLearnsetFromWiki(maskingWikitext, id, learnsets[id]);
        if (result) {
          learnsets[id] = result;
          patched++;
          console.log(`  ✓ ${id} (from Masking page)`);
        } else {
          skipped++;
          console.log(`  ~ ${id} (no move data in Masking page)`);
        }
      } else {
        skipped++;
        console.log(`  ~ ${id} (Masking page not found)`);
      }
      continue;
    }

    if (!wikiName) {
      skipped++;
      continue;
    }

    console.log(`  Fetching ${wikiName}...`);
    const wikitext = await fetchWikiPage('pokemon-uranium.fandom.com', wikiName);
    await sleep(300);

    if (!wikitext) {
      // Try alternative page names
      const altName = wikiName + '_(Pokémon)';
      console.log(`    Retrying as ${altName}...`);
      const alt = await fetchWikiPage('pokemon-uranium.fandom.com', altName);
      await sleep(300);
      if (!alt) {
        failed++;
        failures.push(id);
        console.log(`    ✗ ${id} — page not found`);
        continue;
      }
      const result = buildLearnsetFromWiki(alt, id, learnsets[id]);
      if (result) {
        learnsets[id] = result;
        patched++;
        console.log(`    ✓ ${id}`);
      } else {
        skipped++;
        console.log(`    ~ ${id} — no move sections found`);
      }
      continue;
    }

    const result = buildLearnsetFromWiki(wikitext, id, learnsets[id]);
    if (result) {
      learnsets[id] = result;
      patched++;
      console.log(`  ✓ ${id}`);
    } else {
      skipped++;
      console.log(`  ~ ${id} — no move sections found`);
    }
  }

  console.log(`\nResults: ${patched} patched, ${skipped} skipped, ${failed} failed`);
  if (failures.length) console.log(`Failed species: ${failures.join(', ')}`);

  writeFileSync(lsPath, JSON.stringify(learnsets, null, 2));
  console.log(`Wrote ${lsPath}`);
}

function buildLearnsetFromWiki(wikitext, speciesId, existingEntry) {
  const levelUp = parseLevelUpMoves(wikitext);
  const tms     = parseTMMoves(wikitext);
  const eggs    = parseEggMoves(wikitext);
  const tutors  = parseTutorMoves(wikitext);

  // If wiki page has no move sections at all, skip
  if (levelUp.length === 0 && tms.length === 0 && eggs.length === 0 && tutors.length === 0) {
    return null;
  }

  const learnset = {};

  // Level-up moves → 9L##
  for (const { level, move } of levelUp) {
    const moveId = toId(move);
    if (!learnset[moveId]) learnset[moveId] = [];
    const entry = `9L${level}`;
    if (!learnset[moveId].includes(entry)) learnset[moveId].push(entry);
  }

  // TM/HM moves → 9M
  for (const moveId of tms) {
    if (!learnset[moveId]) learnset[moveId] = [];
    if (!learnset[moveId].includes('9M')) learnset[moveId].push('9M');
  }

  // Egg moves → 9E
  for (const move of eggs) {
    const moveId = toId(move);
    if (!learnset[moveId]) learnset[moveId] = [];
    if (!learnset[moveId].includes('9E')) learnset[moveId].push('9E');
  }

  // Tutor moves → 9T
  for (const move of tutors) {
    const moveId = toId(move);
    if (!learnset[moveId]) learnset[moveId] = [];
    if (!learnset[moveId].includes('9T')) learnset[moveId].push('9T');
  }

  // Preserve any existing moves that weren't found on the wiki
  // (e.g., universal utility moves from the synthetic generator)
  const oldLearnset = existingEntry?.learnset || {};
  for (const [moveId, methods] of Object.entries(oldLearnset)) {
    if (!learnset[moveId]) {
      // Skip spurious numeric-only IDs (from template parsing bugs)
      if (/^\d+$/.test(moveId)) continue;
      // Move exists in current data but not on wiki — keep it with existing methods
      learnset[moveId] = methods;
    }
  }

  return { learnset };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Infinity patching — inherit gen-9 learnset from base species for "egho"
// ═══════════════════════════════════════════════════════════════════════════

async function patchInfinity() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Patching Infinity "egho" learnsets');
  console.log('══════════════════════════════════════════\n');

  // Fetch standard Showdown learnsets
  console.log('  Fetching Showdown learnsets...');
  const res = await fetch(`${POKEATHLON_BASE}/learnsets.js`);
  const text = await res.text();
  const sdLearnsets = {};
  new Function('exports', text)(sdLearnsets);
  const baseLearnsets = sdLearnsets.BattleLearnsets;
  console.log(`  Loaded ${Object.keys(baseLearnsets).length} base learnsets`);

  const lsPath = join(DATA_DIR, 'infinity', 'generated', 'learnsets.infinity.json');
  const learnsets = JSON.parse(readFileSync(lsPath, 'utf8'));

  let enhanced = 0, skipped = 0;

  // Also handle special variant mappings
  const INFINITY_BASE_OVERRIDES = {
    gorochu:       'raichu',       // Gorochu is a Raichu evolution
    nidorook:      'nidoking',     // Nidorook is a Nidoking evolution
    quezsparce:    'dunsparce',    // Quezsparce from Dunsparce
    faeralynx:     null,           // Original
    oozma:         'muk',          // Oozma evolves from Muk
    // Eeveelutions — original, no base to inherit from
    omeon: null, champeon: null, lepideon: null, guardeon: null,
    obsideon: null, scorpeon: null, sphynxeon: null, nimbeon: null,
    draconeon: null, eeveeon: null, vareon: null,
    // Original species
    lukpup: null, lukagon: null, kokiseed: null, kokipound: null,
    kokismash: null, chargo: null, burnaram: null, psysteed: null,
    darpole: null, brutoad: null, godfrogger: null, terathwack: null,
    grimfowl: null, sunflorid: null, sorcerice: null, kecleodon: null,
    wereyena: null, reaptide: null, kidfoot: null, snosquatch: null,
    grasquatch: null, arctusk: null, gigantusk: null, iceros: null,
    glacieros: null, mockroach: null, jollibird: null, kablowfish: null,
    scalarva: null, dragalis: null, ceregal: null, gargon: null,
    wardern: null, dragoyle: null, porygonx: null, oculeus: null,
    arkhaos: null, skulkraken: null,
    mushling: null, psycholyte: null, shroomage: null,
    calfpint: null, arbird: null, girafaraf: null, giragira: null,
    whave: null, orcabyss: null, zapalope: null, joltalope: null,
    mewthree: null,
    // Digimon — original, no base
    botamon: null, koromon: null, agumon: null, greymon: null,
    metalgreymon: null, wargreymon: null, tyrannomon: null,
    skullgreymon: null, betamon: null, seadramon: null, numemon: null,
    palmon: null, togemon: null, shellmon: null, tsunomon: null,
    motimon: null, gabumon: null, elecmon: null, gomamon: null,
    crabmon: null, kunemon: null, tentomon: null, biyomon: null,
    patamon: null, monochromon: null, birdramon: null, drimogemon: null,
    garurumon: null, unimon: null, leomon: null, ogremon: null,
    ikkakumon: null, mojyamon: null, frigimon: null, kuwagamon: null,
    kabuterimon: null, flymon: null, vegiemon: null, redvegiemon: null,
    coelamon: null, airdramon: null, angemon: null, weregarurumon: null,
    megakabuterimon: null, garudamon: null, zudomon: null,
    megaseadramon: null, okuwamon: null, piximon: null, lillymon: null,
    whamon: null, monzaemon: null, magnaangemon: null, saberleomon: null,
    metalgarurumon: null, machinedramon: null, omnimon: null,
    pagumon: null, gazimon: null, etemon: null, metaletemon: null,
    demidevimon: null, devimon: null, bakemon: null, keramon: null,
    infermon: null, diaboromon: null, wizardmon: null, woodmon: null,
    cherrymon: null, puppetmon: null, metalseadramon: null,
    myotismon: null, phantomon: null, piedmon: null,
    // Character variants — map to their base
    onixbrock: 'onix', onixcrystal: 'onix',
    psyduckmisty: 'psyduck', pikachuash: 'pikachu',
    raticateblue: 'raticate', zoroarkn: 'zoroark',
    arbokjessie: 'arbok', weezingjames: 'weezing',
    // Planets — original
    venus: null, mars: null, mercury: null, jupiter: null,
  };

  for (const [id, entry] of Object.entries(learnsets)) {
    let baseId = null;

    // Check overrides first
    if (id in INFINITY_BASE_OVERRIDES) {
      baseId = INFINITY_BASE_OVERRIDES[id];
    }
    // Auto-detect "egho" variants
    else if (id.endsWith('egho')) {
      baseId = id.replace(/egho$/, '');
    }

    if (!baseId) {
      skipped++;
      continue;
    }

    // Look up the base species in Showdown learnsets
    const baseEntry = baseLearnsets[baseId];
    if (!baseEntry || !baseEntry.learnset) {
      console.log(`  ~ ${id} — base species '${baseId}' has no learnset`);
      skipped++;
      continue;
    }

    // Extract gen-9 entries from the base learnset
    const newLearnset = {};
    for (const [moveId, methods] of Object.entries(baseEntry.learnset)) {
      const gen9Methods = methods.filter(m => m.startsWith('9'));
      if (gen9Methods.length > 0) {
        newLearnset[moveId] = gen9Methods;
      }
    }

    if (Object.keys(newLearnset).length === 0) {
      // No gen-9 data, try gen-8
      for (const [moveId, methods] of Object.entries(baseEntry.learnset)) {
        const gen8Methods = methods.filter(m => m.startsWith('8'));
        if (gen8Methods.length > 0) {
          // Remap 8→9
          newLearnset[moveId] = gen8Methods.map(m => '9' + m.slice(1));
        }
      }
    }

    if (Object.keys(newLearnset).length === 0) {
      console.log(`  ~ ${id} — base '${baseId}' has no gen 8/9 learnset entries`);
      skipped++;
      continue;
    }

    // Also preserve any existing moves not in base (fangame-specific moves)
    const oldLearnset = entry?.learnset || {};
    for (const [moveId, methods] of Object.entries(oldLearnset)) {
      if (!newLearnset[moveId]) {
        newLearnset[moveId] = methods;
      }
    }

    learnsets[id] = { learnset: newLearnset };
    enhanced++;
    console.log(`  ✓ ${id} ← ${baseId} (${Object.keys(newLearnset).length} moves)`);
  }

  console.log(`\nResults: ${enhanced} enhanced, ${skipped} skipped`);
  writeFileSync(lsPath, JSON.stringify(learnsets, null, 2));
  console.log(`Wrote ${lsPath}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const doAll     = args.includes('--all') || args.length === 0;
const doUranium = doAll || args.includes('--uranium');
const doInfinity= doAll || args.includes('--infinity');

(async () => {
  try {
    if (doUranium)  await patchUranium();
    if (doInfinity) await patchInfinity();
    console.log('\nDone!');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
