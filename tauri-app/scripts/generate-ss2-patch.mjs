/**
 * generate-ss2-patch.mjs
 *
 * Parses Soulstones 2 PBS files and generates JSON data files for:
 *   - tauri-app/public/data/ss2-patch/generated/pokedex.ss2-soulstones.json
 *   - tauri-app/public/data/ss2-patch/generated/learnsets.ss2-soulstones.json
 *   - tauri-app/public/data/ss2-patch/generated/moves.custom.ss2-soulstones.json
 *   - tauri-app/public/data/ss2-patch/generated/abilities.custom.ss2-soulstones.json
 *
 * Mapping strategy:
 *   PS2 PBS species → Orion/Temporal entries in pokeathlon dex
 *   Matched by: base species name (case-insensitive) AND exact types match.
 *   E.g. PBS SOLOSIS (WATER,PSYCHIC) → pokeathlon solosisorion (Water,Psychic)
 *
 * Run: node tauri-app/scripts/generate-ss2-patch.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PBS_DIR = 'C:\\Users\\Rand L\\Downloads\\SS2 Latest Patch - v2.05\\PBS';
const POKEATHLON_JSON = path.join(__dirname, '..', 'public', 'data', 'pokeathlon', 'generated', 'pokedex.pokeathlon.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'data', 'ss2-patch', 'generated');

// Normalize to alphanumeric lowercase (matches adapter.ts normalizeName)
function normId(s) {
  return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Title-case a type name: "WATER" → "Water", "COSMIC" → "Cosmic"
function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// PBS type → display type (handle special types)
function pbsTypeToDisplay(t) {
  const s = String(t || '').trim().toUpperCase();
  // Special fangame types
  const specialMap = {
    'COSMIC': 'Cosmic',
    'SOUND': 'Sound',
    'LIGHT': 'Light',
    'NUCLEAR': 'Nuclear',
    'STELLAR': 'Stellar',
    'CRYSTAL': 'Crystal',
    'SHADOW': 'Shadow',
  };
  if (specialMap[s]) return specialMap[s];
  return titleCase(s);
}

// Parse a PBS file (pokemon.txt or pokemon_forms.txt style)
function parsePBSBlocks(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Block header: [SPECIES_NAME] or [SPECIES_NAME,FORM_ID]
    if (line.startsWith('[') && line.endsWith(']')) {
      if (current) blocks.push(current);
      const inner = line.slice(1, -1);
      const parts = inner.split(',');
      current = {
        _key: parts[0].trim(),
        _formId: parts[1] != null ? parseInt(parts[1].trim(), 10) : undefined,
        _raw: {},
      };
      continue;
    }

    if (!current) continue;

    // Key = Value
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    current._raw[key] = val;
  }
  if (current) blocks.push(current);
  return blocks;
}

// Parse a PBS moves file
function parsePBSMoves(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Moves file not found: ${filePath}`);
    return {};
  }
  const blocks = parsePBSBlocks(filePath);
  const moves = {};
  for (const b of blocks) {
    const r = b._raw;
    const id = normId(b._key);
    if (!id) continue;
    const name = r.Name || b._key;
    const type = pbsTypeToDisplay(r.Type || 'Normal');
    const power = parseInt(r.Power || '0', 10) || 0;
    const accuracy = r.Accuracy === 'Bypass' ? true : (parseInt(r.Accuracy || '100', 10) || 100);
    const cat = r.Category || 'Status';
    const category = cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase();
    const desc = r.Description || `${type}-type ${category.toLowerCase()} move.`;
    moves[id] = {
      name,
      type,
      basePower: power,
      category,
      accuracy,
      desc,
      shortDesc: desc,
    };
  }
  return moves;
}

// Parse PBS abilities.txt into a map: normId -> { name, desc, shortDesc }
function parsePBSAbilities(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Abilities file not found: ${filePath}`);
    return {};
  }
  const blocks = parsePBSBlocks(filePath);
  const out = {};
  for (const b of blocks) {
    const r = b._raw;
    const id = normId(b._key);
    if (!id) continue;
    const name = r.Name || b._key;
    const fullDesc = (r.FullDesc || '').trim();
    const shortDesc = (r.Description || '').trim();
    out[id] = { name, desc: fullDesc || shortDesc, shortDesc: shortDesc || fullDesc };
  }
  return out;
}

// Parse Moves = level,MOVE,level,MOVE,... field into learnset entries
function parseLevelMoves(movesStr) {
  const learnset = {};
  if (!movesStr) return learnset;
  const parts = movesStr.split(',').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 2) {
    const level = parseInt(parts[i], 10);
    const moveName = parts[i + 1];
    if (!moveName || isNaN(level)) continue;
    const moveId = normId(moveName);
    if (!moveId) continue;
    const learnCode = `9L${level}`;
    if (!learnset[moveId]) learnset[moveId] = [];
    if (!learnset[moveId].includes(learnCode)) {
      learnset[moveId].push(learnCode);
    }
  }
  return learnset;
}

// Parse TutorMoves = MOVE1, MOVE2, ... field
function parseTutorMoves(tutorStr) {
  const learnset = {};
  if (!tutorStr) return learnset;
  const parts = tutorStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const moveName of parts) {
    const moveId = normId(moveName);
    if (!moveId) continue;
    if (!learnset[moveId]) learnset[moveId] = [];
    if (!learnset[moveId].includes('9T')) {
      learnset[moveId].push('9T');
    }
  }
  return learnset;
}

// Parse EggMoves = MOVE1,MOVE2,...
function parseEggMoves(eggStr) {
  const learnset = {};
  if (!eggStr) return learnset;
  const parts = eggStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const moveName of parts) {
    const moveId = normId(moveName);
    if (!moveId) continue;
    if (!learnset[moveId]) learnset[moveId] = [];
    if (!learnset[moveId].includes('9E')) {
      learnset[moveId].push('9E');
    }
  }
  return learnset;
}

// Merge learnset objects
function mergeLearnsets(a, b) {
  const out = { ...a };
  for (const [moveId, codes] of Object.entries(b)) {
    if (!out[moveId]) out[moveId] = [];
    for (const c of codes) {
      if (!out[moveId].includes(c)) out[moveId].push(c);
    }
  }
  return out;
}

// Parse abilities string: "ABILITY1,ABILITY2" → {0: "Ability1", 1: "Ability2"}
function parseAbilities(abStr, hiddenStr) {
  const abilities = {};
  if (abStr) {
    const parts = abStr.split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach((a, i) => {
      abilities[String(i)] = titleCase(a.replace(/([A-Z])/g, ' $1').trim()) || a;
    });
  }
  if (hiddenStr) {
    // Parse hidden ability - just use first one
    const hidden = hiddenStr.split(',')[0].trim();
    if (hidden) abilities['H'] = titleCase(hidden.replace(/([A-Z])/g, ' $1').trim()) || hidden;
  }
  return abilities;
}

function parseAbilitiesProper(abStr, hiddenStr) {
  // Actually just keep the ability names as-is from PBS (they're already camelCase-ish)
  // Map PBS internal names to proper display names where we know them
  const abilityDisplayName = (s) => {
    // Known mappings
    const known = {
      'SWIFTSWIM': 'Swift Swim', 'MAGICBOUNCE': 'Magic Bounce', 'TECHNICIAN': 'Technician',
      'LEVITATE': 'Levitate', 'WHITESMOKE': 'White Smoke', 'MAGMAARMOR': 'Magma Armor',
      'CURSEDBODY': 'Cursed Body', 'SHADOWTAG': 'Shadow Tag', 'ROUGHSKIN': 'Rough Skin',
      'CLOUDNINE': 'Cloud Nine', 'DRIZZLE': 'Drizzle', 'DROUGHT': 'Drought',
      'ROCKHEAD': 'Rock Head', 'STURDY': 'Sturdy', 'SNOWWARNING': 'Snow Warning',
      'PRESSURE': 'Pressure', 'UNAWARE': 'Unaware', 'SERENEGRACE': 'Serene Grace',
      'HUSTLE': 'Hustle', 'NATURALCURE': 'Natural Cure', 'CHLOROPHYLL': 'Chlorophyll',
      'SANDSTREAM': 'Sand Stream', 'TOUGHCLAWS': 'Tough Claws', 'SPEEDBOOST': 'Speed Boost',
      'INTIMIDATE': 'Intimidate', 'ANTICIPATION': 'Anticipation', 'SOUNDPROOF': 'Soundproof',
      'STATIC': 'Static', 'LIGHTNINGROD': 'Lightning Rod', 'MAGNETPULL': 'Magnet Pull',
      'PRANKSTER': 'Prankster', 'PROTEAN': 'Protean', 'ADAPTABILITY': 'Adaptability',
      'POISONPOINT': 'Poison Point', 'SYNCHRONIZE': 'Synchronize', 'TRACE': 'Trace',
      'FRISK': 'Frisk', 'NOGUARD': 'No Guard', 'SNIPER': 'Sniper',
      'RUNAWAY': 'Run Away', 'KLUTZ': 'Klutz', 'COMPOUNDEYES': 'Compound Eyes',
      'TINTEDLENS': 'Tinted Lens', 'FOREWARN': 'Forewarn', 'WONDERGUARD': 'Wonder Guard',
      'SHEDSKIN': 'Shed Skin', 'GUTS': 'Guts', 'OVERGROW': 'Overgrow',
      'BLAZE': 'Blaze', 'TORRENT': 'Torrent', 'SWARM': 'Swarm',
      'REGENERATOR': 'Regenerator', 'SHEERFORCE': 'Sheer Force', 'HARVEST': 'Harvest',
      'PICKUP': 'Pickup', 'HUSTLE': 'Hustle', 'LIGHTMETAL': 'Light Metal',
      'HEAVYMETAL': 'Heavy Metal', 'FILTER': 'Filter', 'SOLIDROCK': 'Solid Rock',
      'CLEARSMOG': 'Clear Smog', 'TRACE': 'Trace',
    };
    const key = s.toUpperCase().replace(/\s/g, '');
    if (known[key]) return known[key];
    // Convert CAMELCASE to Title Case
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  };
  const abilities = {};
  if (abStr) {
    const parts = abStr.split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach((a, i) => {
      abilities[String(i)] = abilityDisplayName(a);
    });
  }
  if (hiddenStr) {
    const hidden = hiddenStr.split(',')[0].trim();
    if (hidden) abilities['H'] = abilityDisplayName(hidden);
  }
  return abilities;
}

// Parse BaseStats = hp,atk,def,spa,spd,spe (PBS order: hp,atk,def,spatk,spdef,spe)
function parseBaseStats(statsStr) {
  const parts = statsStr.split(',').map(s => parseInt(s.trim(), 10));
  return {
    hp: parts[0] || 50,
    atk: parts[1] || 50,
    def: parts[2] || 50,
    spa: parts[3] || 50,  // PBS order: spatk at index 3
    spd: parts[4] || 50,  // PBS order: spdef at index 4
    spe: parts[5] || 50,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Loading Pokeathlon snapshot...');
const pokeathlonDex = JSON.parse(fs.readFileSync(POKEATHLON_JSON, 'utf8'));

// Build lookup: normalized key → entry, for Orion/Temporal entries
const orionTemporalEntries = new Map();
for (const [key, entry] of Object.entries(pokeathlonDex)) {
  if (key.endsWith('orion') || key.endsWith('temporal')) {
    orionTemporalEntries.set(key, entry);
  }
}
console.log(`Found ${orionTemporalEntries.size} Orion/Temporal entries in pokeathlon dex`);

// Build comprehensive lookup: all pokeathlon entries by normId
const pokeathlonByNormId = new Map();
for (const [key, entry] of Object.entries(pokeathlonDex)) {
  pokeathlonByNormId.set(normId(key), [key, entry]);
}

// Build type-lookup map: normBaseName_typekey → [orionKey, entry]
// e.g. "solosis_waterpsychic" → ["solosisorion", {...}]
const orionByNameAndTypes = new Map();
for (const [key, entry] of orionTemporalEntries) {
  if (!entry || !entry.name || !entry.types) continue;
  // Extract base species name: strip "orion"/"temporal" suffix
  const baseKey = key.replace(/(?:orion|temporal)$/, '');
  const typeKey = (entry.types || []).map(t => normId(t)).sort().join('');
  const lookupKey = `${baseKey}_${typeKey}`;
  if (!orionByNameAndTypes.has(lookupKey)) {
    orionByNameAndTypes.set(lookupKey, [key, entry]);
  }
}
console.log(`Built ${orionByNameAndTypes.size} name+type lookup entries`);

console.log('Parsing PBS pokemon.txt...');
const pokemonBlocks = parsePBSBlocks(path.join(PBS_DIR, 'pokemon.txt'));
console.log(`Parsed ${pokemonBlocks.length} pokemon blocks`);

console.log('Parsing PBS pokemon_forms.txt...');
const formBlocks = parsePBSBlocks(path.join(PBS_DIR, 'pokemon_forms.txt'));
console.log(`Parsed ${formBlocks.length} form blocks`);

console.log('Parsing PBS moves.txt...');
const customMoves = parsePBSMoves(path.join(PBS_DIR, 'moves.txt'));
console.log(`Parsed ${Object.keys(customMoves).length} custom moves`);

console.log('Parsing PBS abilities.txt...');
const pbsAbilities = parsePBSAbilities(path.join(PBS_DIR, 'abilities.txt'));
console.log(`Parsed ${Object.keys(pbsAbilities).length} PBS abilities`);

// ─── Process Pokemon Blocks ────────────────────────────────────────────────

const outPokedex = {};
const outLearnsets = {};
const outAbilities = {};

let matchedCount = 0;
let unmatchedCount = 0;

function processBlock(block) {
  const r = block._raw;
  const pbsName = block._key;

  if (!r.Types || !r.BaseStats) return;

  const pbsTypes = r.Types.split(',').map(t => pbsTypeToDisplay(t.trim()));
  const typeKey = pbsTypes.map(t => normId(t)).sort().join('');
  const baseNameKey = normId(pbsName);
  const lookupKey = `${baseNameKey}_${typeKey}`;

  const match = orionByNameAndTypes.get(lookupKey);
  if (!match) {
    unmatchedCount++;
    return;
  }

  const [orionKey, orionEntry] = match;
  matchedCount++;

  // Build learnset
  const levelLearnset = parseLevelMoves(r.Moves || '');
  const tutorLearnset = parseTutorMoves(r.TutorMoves || '');
  const eggLearnset = parseEggMoves(r.EggMoves || '');
  const fullLearnset = mergeLearnsets(mergeLearnsets(levelLearnset, tutorLearnset), eggLearnset);

  // Build species entry (using orionEntry as base, augmented with PBS data)
  const baseStats = parseBaseStats(r.BaseStats);
  const abilities = parseAbilitiesProper(r.Abilities || '', r.HiddenAbilities || '');

  outPokedex[orionKey] = {
    ...orionEntry,
    baseStats,
    abilities: Object.keys(abilities).length > 0 ? abilities : orionEntry.abilities,
    types: pbsTypes,
    // Preserve identification fields
    name: orionEntry.name || r.Name || pbsName,
    isNonstandard: 'Custom',
  };

  if (Object.keys(fullLearnset).length > 0) {
    outLearnsets[orionKey] = { learnset: fullLearnset };
  }

  // Register any new abilities not in abilities.json
  if (r.Abilities) {
    for (const ab of r.Abilities.split(',').map(s => s.trim())) {
      const abId = normId(ab);
      if (abId && !outAbilities[abId]) {
        const abName = abilities[Object.keys(abilities).find(k => normId(abilities[k]) === abId) || '0'] || ab;
        // Use the real PBS description when available instead of a placeholder.
        const pbs = pbsAbilities[abId];
        const desc = pbs?.desc || pbs?.shortDesc || `${abName} ability.`;
        const shortD = pbs?.shortDesc || pbs?.desc || `${abName} ability.`;
        outAbilities[abId] = { name: pbs?.name || abName, shortDesc: shortD, desc };
      }
    }
  }
}

// Process base pokemon
for (const block of pokemonBlocks) {
  processBlock(block);
}

// ─── Counters for new entries (shared across form processing + second pass) ──
let directMatchCount = 0;
let suffix2MatchCount = 0;
let newEntryCount = 0;
// Negative num starting point for truly new SS2-exclusive Pokémon
let newEntryNum = -60001;
// Track which dex keys are already used (prevents duplicates across strategies)
const usedDexKeys = new Set(Object.keys(outPokedex));

// Process forms (variant forms of orion/temporal species)
let formMatchCount = 0;
let formUnmatchCount = 0;
for (const block of formBlocks) {
  const r = block._raw;
  if (!r.Types && !r.BaseStats) continue;
  if (block._formId == null) continue;

  // Form name comes from FormName or the block key + form suffix
  const formName = r.FormName || `Form${block._formId}`;
  const pbsName = block._key;

  // Try to find a matching orion/temporal entry for this form
  if (r.Types && r.BaseStats) {
    const pbsTypes = r.Types.split(',').map(t => pbsTypeToDisplay(t.trim()));
    const typeKey = pbsTypes.map(t => normId(t)).sort().join('');
    const baseNameKey = normId(pbsName);
    
    // Try name_types lookup
    const lookupKey = `${baseNameKey}_${typeKey}`;
    const match = orionByNameAndTypes.get(lookupKey);
    
    if (match) {
      const [orionKey, orionEntry] = match;
      const baseStats = parseBaseStats(r.BaseStats);
      const abilities = parseAbilitiesProper(r.Abilities || '', r.HiddenAbilities || '');
      
      // Only update if we have better data
      if (!outPokedex[orionKey] || !outPokedex[orionKey]._formProcessed) {
        outPokedex[orionKey] = {
          ...orionEntry,
          ...(outPokedex[orionKey] || {}),
          baseStats,
          types: pbsTypes,
          abilities: Object.keys(abilities).length > 0 ? abilities : (orionEntry.abilities || {}),
          name: orionEntry.name,
          isNonstandard: 'Custom',
          _formProcessed: true,
        };
        formMatchCount++;
      }
      
      // Add learnset for form
      if (r.Moves) {
        const levelLearnset = parseLevelMoves(r.Moves);
        const tutorLearnset = parseTutorMoves(r.TutorMoves || '');
        const eggLearnset = parseEggMoves(r.EggMoves || '');
        const fullLearnset = mergeLearnsets(mergeLearnsets(levelLearnset, tutorLearnset), eggLearnset);
        if (Object.keys(fullLearnset).length > 0) {
          const existing = outLearnsets[orionKey]?.learnset || {};
          outLearnsets[orionKey] = { learnset: mergeLearnsets(existing, fullLearnset) };
        }
      }
    } else {
      formUnmatchCount++;

      // Strategy 4: Unmatched forms that have a unique FormName are distinct species
      // (e.g. SHELLOS form 1 FormName=Shellsea types=DRAGON,WATER → add as 'shellsea')
      if (r.FormName && r.Types && r.BaseStats) {
        const pbsTypes = r.Types.split(',').map(t => pbsTypeToDisplay(t.trim()));
        const formDisplayName = r.FormName.trim();
        const formKey = normId(formDisplayName);
        if (formKey && !outPokedex[formKey]) {
          const baseStats = parseBaseStats(r.BaseStats);
          const abilities = parseAbilitiesProper(r.Abilities || '', r.HiddenAbilities || '');
          const levelLearnset = parseLevelMoves(r.Moves || '');
          const tutorLearnset = parseTutorMoves(r.TutorMoves || '');
          const eggLearnset = parseEggMoves(r.EggMoves || '');
          const fullLearnset = mergeLearnsets(mergeLearnsets(levelLearnset, tutorLearnset), eggLearnset);

          outPokedex[formKey] = {
            name: formDisplayName,
            num: newEntryNum--,
            types: pbsTypes,
            baseStats,
            abilities: Object.keys(abilities).length > 0 ? abilities : {},
            isNonstandard: 'Custom',
            gen: 9,
            color: r.Color || 'White',
            tags: ['Soulstones'],
          };
          if (Object.keys(fullLearnset).length > 0) {
            outLearnsets[formKey] = { learnset: fullLearnset };
          }
          newEntryCount++;
        }
      }
    }
  }
}

// Clean up internal markers
for (const entry of Object.values(outPokedex)) {
  delete entry._formProcessed;
}

// ─── Second Pass: Handle unmatched blocks with extended strategies ──────────
// Strategy 1: Direct pokeathlon match (galaxeon, prismeon, octaveon etc. without orion/temporal suffix)
// Strategy 2: '2'-suffix variants → strip '2', look for orion/temporal match by base+types
// Strategy 3: Truly new Pokémon → build from PBS data directly
// (Counters and usedDexKeys/newEntryNum were declared before form processing above)

// Sync usedDexKeys with any entries added during form processing
for (const k of Object.keys(outPokedex)) usedDexKeys.add(k);

for (const block of pokemonBlocks) {
  const r = block._raw;
  const pbsName = block._key;
  if (!r.Types || !r.BaseStats) continue;

  const pbsTypes = r.Types.split(',').map(t => pbsTypeToDisplay(t.trim()));
  const typeKey = pbsTypes.map(t => normId(t)).sort().join('');
  const baseNameKey = normId(pbsName);

  // Skip already-matched from first pass
  const firstPassKey = `${baseNameKey}_${typeKey}`;
  if (orionByNameAndTypes.has(firstPassKey)) continue;

  // Build learnsets from PBS
  const buildLearnset = (rr) => {
    const lv = parseLevelMoves(rr.Moves || '');
    const tu = parseTutorMoves(rr.TutorMoves || '');
    const eg = parseEggMoves(rr.EggMoves || '');
    return mergeLearnsets(mergeLearnsets(lv, tu), eg);
  };
  const fullLearnset = buildLearnset(r);
  const baseStats = parseBaseStats(r.BaseStats);
  const abilities = parseAbilitiesProper(r.Abilities || '', r.HiddenAbilities || '');

  // Strategy 1: Direct pokeathlon match (no orion/temporal suffix)
  const directMatch = pokeathlonByNormId.get(baseNameKey);
  if (directMatch && !directMatch[0].endsWith('orion') && !directMatch[0].endsWith('temporal')) {
    const [pokKey, pokEntry] = directMatch;
    // Don't overwrite if already present
    if (!outPokedex[pokKey]) {
      outPokedex[pokKey] = {
        ...pokEntry,
        baseStats,
        abilities: Object.keys(abilities).length > 0 ? abilities : (pokEntry.abilities || {}),
        types: pbsTypes,
        name: pokEntry.name || r.Name || pbsName,
        isNonstandard: 'Custom',
      };
    }
    if (Object.keys(fullLearnset).length > 0) {
      const existing = outLearnsets[pokKey]?.learnset || {};
      outLearnsets[pokKey] = { learnset: mergeLearnsets(existing, fullLearnset) };
    }
    directMatchCount++;
    continue;
  }

  // Strategy 2: '2' suffix variants
  if (pbsName.endsWith('2')) {
    const baseWithout2 = normId(pbsName.slice(0, -1));
    const orionLk2 = `${baseWithout2}_${typeKey}`;
    const orionMatch2 = orionByNameAndTypes.get(orionLk2);
    if (orionMatch2) {
      const [orionKey2, orionEntry2] = orionMatch2;
      // Add/update species entry if not already set from first pass
      if (!outPokedex[orionKey2]) {
        outPokedex[orionKey2] = {
          ...orionEntry2,
          baseStats,
          abilities: Object.keys(abilities).length > 0 ? abilities : (orionEntry2.abilities || {}),
          types: pbsTypes,
          name: orionEntry2.name || r.Name || pbsName,
          isNonstandard: 'Custom',
        };
      }
      // Always merge learnsets for alternate forms
      if (Object.keys(fullLearnset).length > 0) {
        const existing = outLearnsets[orionKey2]?.learnset || {};
        outLearnsets[orionKey2] = { learnset: mergeLearnsets(existing, fullLearnset) };
      }
      suffix2MatchCount++;
      continue;
    }
  }

  // Strategy 3: Truly new Pokémon (not in pokeathlon at all)
  // Create a new entry with an 'ss2' suffix to avoid clobbering canonical PS dex entries.
  // E.g. PBS DARKRAI [Light] → key 'darkraiss2', name 'Darkrai (SS2)'
  // This prevents the SS2-specific typing from overriding the canonical species in the merged dex.
  const newKey = `${baseNameKey}ss2`;
  if (!usedDexKeys.has(newKey)) {
    usedDexKeys.add(newKey);
    const rawName = r.Name || pbsName;
    // Append "(SS2)" if the name doesn't already hint at a variant
    const displayName = rawName.endsWith(')') ? rawName : `${rawName} (SS2)`;
    outPokedex[newKey] = {
      name: displayName,
      num: newEntryNum--,
      types: pbsTypes,
      baseStats,
      abilities: Object.keys(abilities).length > 0 ? abilities : {},
      isNonstandard: 'Custom',
      gen: 9,
      color: r.Color || 'White',
      tags: ['Soulstones'],
    };
    if (Object.keys(fullLearnset).length > 0) {
      outLearnsets[newKey] = { learnset: fullLearnset };
    }
    newEntryCount++;
  }
}

// ─── Final sweep: register every ability referenced by any dex entry ─────────
for (const entry of Object.values(outPokedex)) {
  for (const abName of Object.values(entry.abilities || {})) {
    const abId = normId(abName);
    if (!abId || outAbilities[abId]) continue;
    const pbs = pbsAbilities[abId];
    outAbilities[abId] = {
      name: pbs?.name || abName,
      shortDesc: pbs?.shortDesc || pbs?.desc || `${abName} ability.`,
      desc: pbs?.desc || pbs?.shortDesc || `${abName} ability.`,
    };
  }
}

console.log(`\n=== Extended Matching Results ===`);
console.log(`Strategy 1 - Direct pokeathlon match: ${directMatchCount}`);
console.log(`Strategy 2 - Suffix-2 orion/temporal match: ${suffix2MatchCount}`);
console.log(`Strategy 3 - Truly new entries: ${newEntryCount}`);

console.log(`\n=== Total Results ===`);
console.log(`Base pokemon matched (orion/temporal): ${matchedCount}`);
console.log(`Base pokemon unmatched: ${unmatchedCount}`);
console.log(`Form variants matched: ${formMatchCount}`);
console.log(`Form variants unmatched: ${formUnmatchCount}`);
console.log(`Total pokedex entries: ${Object.keys(outPokedex).length}`);
console.log(`Total learnset entries: ${Object.keys(outLearnsets).length}`);
console.log(`Total custom abilities: ${Object.keys(outAbilities).length}`);

// ─── Write Output ─────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

const pokedexFile = path.join(OUT_DIR, 'pokedex.ss2-soulstones.json');
const learnsetsFile = path.join(OUT_DIR, 'learnsets.ss2-soulstones.json');
const movesFile = path.join(OUT_DIR, 'moves.custom.ss2-soulstones.json');
const abilitiesFile = path.join(OUT_DIR, 'abilities.custom.ss2-soulstones.json');

fs.writeFileSync(pokedexFile, JSON.stringify(outPokedex, null, 2), 'utf8');
fs.writeFileSync(learnsetsFile, JSON.stringify(outLearnsets, null, 2), 'utf8');
fs.writeFileSync(movesFile, JSON.stringify(customMoves, null, 2), 'utf8');
fs.writeFileSync(abilitiesFile, JSON.stringify(outAbilities, null, 2), 'utf8');

console.log(`\nWrote:`);
console.log(`  ${pokedexFile} (${(fs.statSync(pokedexFile).size / 1024).toFixed(1)} KB)`);
console.log(`  ${learnsetsFile} (${(fs.statSync(learnsetsFile).size / 1024).toFixed(1)} KB)`);
console.log(`  ${movesFile} (${(fs.statSync(movesFile).size / 1024).toFixed(1)} KB)`);
console.log(`  ${abilitiesFile} (${(fs.statSync(abilitiesFile).size / 1024).toFixed(1)} KB)`);

// ─── Sample Verification ──────────────────────────────────────────────────────
console.log('\n=== Sample Verification ===');
for (const key of ['solosisorion', 'gastlyorion', 'gengarorion']) {
  const entry = outPokedex[key];
  const ls = outLearnsets[key];
  if (entry) {
    console.log(`${key}: types=${entry.types?.join('/')}, moves=${Object.keys(ls?.learnset || {}).length}`);
  } else {
    console.log(`${key}: NOT FOUND`);
  }
}
