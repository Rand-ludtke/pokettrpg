#!/usr/bin/env node
// Extract Uranium, Infinity, and Mariomon fangame data from Pokeathlon server
// Generates synthetic learnsets for fangame Pokemon that lack them.
// Usage: node scripts/extract-fangame-data.mjs

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const POKEATHLON_BASE = 'https://play.pokeathlon.com/data';

const FANGAMES = [
  { key: 'uranium', tag: 'Uranium' },
  { key: 'infinity', tag: 'Infinity' },
  { key: 'mariomon', tag: 'Mariomon' },
];

// Common utility moves every Pokemon can learn (TM-like universal pool)
const UNIVERSAL_MOVES = [
  'protect', 'rest', 'substitute', 'toxic', 'sleeptalk',
  'facade', 'return', 'frustration', 'hiddenpower', 'swagger',
  'confide', 'doubleteam', 'attract', 'round',
];

function parseShowdownExport(text, exportName) {
  const exports = {};
  new Function('exports', text)(exports);
  return exports[exportName];
}

function toId(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchText(url) {
  console.log(`  Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

/**
 * Build an index of moves by type for synthetic learnset generation.
 */
function buildMovesByType(moves) {
  const byType = {};
  for (const [id, move] of Object.entries(moves)) {
    if (!move.type || move.isMax || move.isZ) continue;
    // Skip moves that are too niche (exclusively other-fangame, etc.)
    if (move.isNonstandard === 'Gigantamax' || move.isNonstandard === 'LGPE') continue;
    const type = move.type;
    if (!byType[type]) byType[type] = [];
    byType[type].push(id);
  }
  return byType;
}

/**
 * Generate a synthetic learnset for a Pokemon based on its types and stats.
 * Includes type-matching moves + universal utility moves.
 */
function generateSyntheticLearnset(species, movesByType, allMoves) {
  const learnset = {};
  const types = species.types || ['Normal'];
  const stats = species.baseStats || {};
  const isPhysical = (stats.atk || 0) >= (stats.spa || 0);

  // Add moves matching the Pokemon's types
  for (const type of types) {
    const typeMoves = movesByType[type] || [];
    for (const moveId of typeMoves) {
      const move = allMoves[moveId];
      if (!move) continue;
      // Skip extremely high-power signature moves and broken moves
      if ((move.basePower || 0) > 180) continue;
      // Prefer moves matching the Pokemon's offensive profile
      const cat = move.category;
      if (cat === 'Physical' && !isPhysical && (move.basePower || 0) > 80) continue;
      if (cat === 'Special' && isPhysical && (move.basePower || 0) > 80) continue;
      learnset[moveId] = ['9M']; // Mark as TM/tutor learnable in gen 9
    }
  }

  // Add Normal-type coverage moves (every Pokemon gets some Normal moves)
  const normalMoves = movesByType['Normal'] || [];
  for (const moveId of normalMoves) {
    const move = allMoves[moveId];
    if (!move || (move.basePower || 0) > 120) continue;
    if (move.category === 'Status') {
      learnset[moveId] = ['9M'];
    }
  }

  // Add universal utility TM moves
  for (const moveId of UNIVERSAL_MOVES) {
    if (allMoves[moveId]) {
      learnset[moveId] = ['9M'];
    }
  }

  return { learnset };
}

async function main() {
  console.log('Fetching Pokeathlon data files...');

  const [pokedexJS, learnsetsJS, movesJS, abilitiesJS] = await Promise.all([
    fetchText(`${POKEATHLON_BASE}/pokedex.js`),
    fetchText(`${POKEATHLON_BASE}/learnsets.js`),
    fetchText(`${POKEATHLON_BASE}/moves.js`),
    fetchText(`${POKEATHLON_BASE}/abilities.js`),
  ]);

  console.log('Parsing data...');
  const pokedex = parseShowdownExport(pokedexJS, 'BattlePokedex');
  const learnsets = parseShowdownExport(learnsetsJS, 'BattleLearnsets');
  const moves = parseShowdownExport(movesJS, 'BattleMovedex');
  const abilities = parseShowdownExport(abilitiesJS, 'BattleAbilities');

  console.log(`Loaded: ${Object.keys(pokedex).length} species, ${Object.keys(learnsets).length} learnsets, ${Object.keys(moves).length} moves, ${Object.keys(abilities).length} abilities`);

  const movesByType = buildMovesByType(moves);

  for (const { key, tag } of FANGAMES) {
    console.log(`\n=== Processing ${tag} ===`);

    // 1. Extract Pokemon with this tag
    const dex = {};
    for (const [id, data] of Object.entries(pokedex)) {
      if (data.tags && data.tags.includes(tag)) {
        dex[id] = data;
      }
    }
    console.log(`  Pokemon: ${Object.keys(dex).length}`);

    // 2. Extract learnsets — use server data if available, else generate
    const ls = {};
    const moveRefs = new Set();
    let realCount = 0;
    let synthCount = 0;

    for (const [id, species] of Object.entries(dex)) {
      if (learnsets[id]) {
        // Use real learnset data from Pokeathlon
        ls[id] = learnsets[id];
        realCount++;
        if (learnsets[id].learnset) {
          for (const m of Object.keys(learnsets[id].learnset)) {
            moveRefs.add(m);
          }
        }
      } else if (!species.forme) {
        // Generate synthetic learnset for original species (not formes,
        // formes inherit from base which is in the standard dex)
        ls[id] = generateSyntheticLearnset(species, movesByType, moves);
        synthCount++;
        for (const m of Object.keys(ls[id].learnset)) {
          moveRefs.add(m);
        }
      }
    }
    console.log(`  Learnsets: ${Object.keys(ls).length} (${realCount} real, ${synthCount} synthetic)`);

    // 3. Collect ability references
    const abilityRefs = new Set();
    for (const species of Object.values(dex)) {
      if (species.abilities) {
        for (const ab of Object.values(species.abilities)) {
          if (typeof ab === 'string') abilityRefs.add(toId(ab));
        }
      }
    }

    // 4. Extract custom moves (non-standard moves used by this fangame)
    const customMoves = {};
    for (const moveId of moveRefs) {
      const move = moves[moveId];
      if (move && (move.isNonstandard === 'Custom' || move.isNonstandard === 'Future')) {
        customMoves[moveId] = move;
      }
    }
    console.log(`  Custom moves: ${Object.keys(customMoves).length}`);

    // 5. Extract custom abilities
    const customAbilities = {};
    for (const abId of abilityRefs) {
      const ab = abilities[abId];
      if (ab && ab.isNonstandard === 'Custom') {
        customAbilities[abId] = ab;
      }
    }
    console.log(`  Custom abilities: ${Object.keys(customAbilities).length}`);

    // 6. Write output files
    const outDir = join('public', 'data', key, 'generated');
    mkdirSync(outDir, { recursive: true });

    const writeJson = (file, data) => {
      const json = JSON.stringify(data, (k, v) => typeof v === 'function' ? undefined : v, 2);
      writeFileSync(join(outDir, file), json);
      console.log(`  Wrote ${file} (${Math.round(json.length / 1024)}KB)`);
    };

    writeJson(`pokedex.${key}.json`, dex);
    writeJson(`learnsets.${key}.json`, ls);
    if (Object.keys(customMoves).length > 0) {
      writeJson(`moves.custom.${key}.json`, customMoves);
    }
    if (Object.keys(customAbilities).length > 0) {
      writeJson(`abilities.custom.${key}.json`, customAbilities);
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
