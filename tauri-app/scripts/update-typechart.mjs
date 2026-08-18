/**
 * update-typechart.mjs
 * 
 * Adds missing fangame types (Sound, Light, Crystal, Shadow) to the PS typechart.
 * Uses neutral (0) interactions by default to avoid breaking battles.
 * 
 * Format: 0 = 1x (neutral), 1 = 2x (super effective), 2 = 0.5x (not very effective), 3 = 0x (immune)
 * 
 * Run: node tauri-app/scripts/update-typechart.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TYPECHART_FILE = path.join(__dirname, '..', 'public', 'vendor', 'showdown', 'data', 'typechart.js');

let content = fs.readFileSync(TYPECHART_FILE, 'utf8');

// ── New type definitions ──────────────────────────────────────────────────────
// Based on SS2 game design principles (fangame type chart)
// All interactions start at 0 (neutral 1x) unless we have specific knowledge

const ALL_TYPES = [
  'Bug','Cosmic','Crystal','Dark','Dragon','Electric','Fairy','Fighting',
  'Fire','Flying','Ghost','Grass','Ground','Ice','Light','Normal','Nuclear',
  'Poison','Psychic','Rock','Shadow','Sound','Steel','Stellar','Water'
];

// Build a neutral damageTaken object for a type
function neutralDamageTaken(overrides = {}) {
  const dt = {};
  for (const t of ALL_TYPES) {
    dt[t] = overrides[t] ?? 0;
  }
  return dt;
}

// Type definitions for new types
const newTypes = {
  // Sound type: thematic interactions for audio/vibration attacks
  Sound: {
    isNonstandard: 'Custom',
    damageTaken: neutralDamageTaken({
      Ground: 1,    // Ground absorbs vibrations (2x vs Sound)
      Rock: 2,      // Rock is hard to penetrate with sound (0.5x vs Sound)
      Electric: 1,  // Electricity disrupts sound equipment (2x vs Sound)
      Ghost: 2,     // Ghosts phase through sound (0.5x vs Sound)
      Normal: 0,    // Normal is neutral
    }),
  },
  // Light type: thematic interactions for radiant/photonic attacks
  Light: {
    isNonstandard: 'Custom',
    damageTaken: neutralDamageTaken({
      Dark: 1,      // Darkness is super effective vs Light (2x)
      Ghost: 1,     // Ghostly shadow vs Light (2x)
      Psychic: 2,   // Psychic can bend light (0.5x vs Light)
      Ice: 2,       // Light reflects off ice (0.5x vs Light)
      Normal: 0,    // Neutral
    }),
  },
  // Crystal type: thematic - crystalline structure, hard but brittle
  Crystal: {
    isNonstandard: 'Custom',
    damageTaken: neutralDamageTaken({
      Fighting: 1,  // Physical force shatters crystal (2x)
      Ground: 1,    // Ground pressure (2x)
      Fire: 2,      // Fire melts/deforms crystal (0.5x... crystals resist heat)
      Normal: 2,    // Crystal is hard - Normal resisted (0.5x)
      Psychic: 0,   // Crystal doesn't conduct psychic energy
      Rock: 2,      // Rock vs crystal - similar hardness (0.5x)
    }),
  },
  // Shadow type: dark energy attacks
  Shadow: {
    isNonstandard: 'Custom',
    damageTaken: neutralDamageTaken({
      Light: 1,     // Light dispels Shadow (2x)
      Psychic: 1,   // Psychic can purify Shadow (2x)
      Normal: 3,    // Shadow is immune to Normal (0x)
      Fighting: 3,  // Physical attacks pass through Shadow (0x)
      Ghost: 2,     // Ghost is already shadowy (0.5x)
      Dark: 2,      // Shadow and Dark coexist (0.5x)
    }),
  },
};

// ── Update damageTaken in existing types to include new types ────────────────

// For each new type, we need to add them to existing types' damageTaken
// The interactions are: how effective IS the existing type against the new type
// (i.e., damageTaken[ExistingType] in the new type's entry)
// But we also need to add new types to existing types' damageTaken lists

// Map: existingType -> what to add to its damageTaken for new type attacks
// existingDamageTaken['Light'] = how effective Light moves are vs that existing type
// This is the INVERSE of the new type's damageTaken
const existingTypeAdditions = {
  // How effective Sound moves are against existing types
  Bug:      { Sound: 1 },    // Sound extra-effective vs Bug (insect sounds)
  Ghost:    { Sound: 1 },    // Sound disrupts ghostly frequencies (2x)
  Psychic:  { Sound: 1 },    // Sonic interference disrupts psychic (2x)
  Rock:     { Sound: 2 },    // Rock blocks sound (0.5x)
  Steel:    { Sound: 2 },    // Steel conducts but dampens sound (0.5x)
  Ground:   { Sound: 0 },    // Ground neutral vs sound attacks

  // How effective Light moves are against existing types
  Dark:     { Light: 1 },    // Light super-effective vs Dark (2x)
  Ice:      { Light: 1 },    // Light melts ice (2x)
  Poison:   { Light: 1 },    // Light purifies Poison (2x)
  Ghost:    { Light: 1 },    // Light dispels Ghost (2x)
  Fire:     { Light: 2 },    // Fire resists light (0.5x)
  Electric: { Light: 2 },    // Electric similar energy (0.5x)
  
  // How effective Crystal moves are against existing types
  Fighting: { Crystal: 2 },  // Fighting can break crystal (0.5x vs Crystal attacks)
  Ground:   { Crystal: 0 },  // Ground neutral vs Crystal
  Ice:      { Crystal: 0 },  // Ice and Crystal similar (neutral)
  
  // How effective Shadow moves are against existing types
  Normal:   { Shadow: 0 },   // Normal neutral vs Shadow
  Psychic:  { Shadow: 2 },   // Shadow hides from psychic (0.5x)
  Ghost:    { Shadow: 0 },   // Ghost vs Shadow neutral
  Dark:     { Shadow: 2 },   // Shadow is part of Dark spectrum (0.5x)
};

// ── Apply changes to the typechart content ───────────────────────────────────

let modified = content;

// 1. Add new types to existing types' damageTaken tables
// Each existing type has: typename:{damageTaken:{...}}
// We need to add Sound:X, Light:X, Crystal:X, Shadow:X to each

function addTypeToDamageTaken(content, targetTypeName, additions) {
  let modified = content;
  const lowTypeName = targetTypeName.toLowerCase();
  
  // Find the damageTaken block for this type
  // Pattern: "typename:{...damageTaken:{TYPE:0,TYPE:1,...}}"
  const dtPattern = new RegExp(`(${lowTypeName}:\\{[^}]*damageTaken:\\{)([^}]+)(\\})`, 'i');
  const match = modified.match(dtPattern);
  if (!match) {
    console.warn(`  Could not find damageTaken for type: ${targetTypeName}`);
    return modified;
  }
  
  // Build the additions string
  const additionEntries = Object.entries(additions)
    .map(([type, val]) => `${type}:${val}`)
    .join(',');
  
  if (!additionEntries) return modified;
  
  // Insert additions before the closing }
  modified = modified.replace(dtPattern, `$1$2,${additionEntries}$3`);
  return modified;
}

// Add new type references to all existing types
const existingTypes = [
  'bug','cosmic','dark','dragon','electric','fairy','fighting',
  'fire','flying','ghost','grass','ground','ice','normal','nuclear',
  'poison','psychic','rock','steel','stellar','water'
];

for (const existingType of existingTypes) {
  const capitalizedType = existingType.charAt(0).toUpperCase() + existingType.slice(1);
  const typeAdditions = existingTypeAdditions[capitalizedType] || {};
  // Add all new types (default 0 if not specified)
  const fullAdditions = {};
  for (const newType of Object.keys(newTypes)) {
    fullAdditions[newType] = typeAdditions[newType] ?? 0;
  }
  modified = addTypeToDamageTaken(modified, existingType, fullAdditions);
}

// 2. Add the new type entries to the typechart
// They should be inserted after the existing types but before the closing }};

const buildTypeEntry = (typeName, def) => {
  const dtEntries = Object.entries(def.damageTaken).map(([k, v]) => `${k}:${v}`).join(',');
  const isNonstandard = def.isNonstandard ? `isNonstandard:"${def.isNonstandard}",` : '';
  return `${typeName.toLowerCase()}:{${isNonstandard}damageTaken:{${dtEntries}}}`;
};

// Find the last existing type entry and insert new ones after it
// The file ends with: ...}};  We need to insert before the final }};
const newTypeEntries = Object.entries(newTypes)
  .map(([name, def]) => buildTypeEntry(name, def))
  .join(',');

// Insert before the final closing }};
modified = modified.replace(/\}\};(\s*)$/, `},${newTypeEntries}};$1`);

// Write back
fs.writeFileSync(TYPECHART_FILE, modified, 'utf8');

// ── Verify ────────────────────────────────────────────────────────────────────
const verification = fs.readFileSync(TYPECHART_FILE, 'utf8');
const soundIdx = verification.indexOf('sound:');
const lightIdx = verification.indexOf('light:');
const crystalIdx = verification.indexOf('crystal:');
const shadowIdx = verification.indexOf('shadow:');
console.log('Typechart updated successfully!');
console.log('Sound type added:', soundIdx > -1);
console.log('Light type added:', lightIdx > -1);
console.log('Crystal type added:', crystalIdx > -1);
console.log('Shadow type added:', shadowIdx > -1);
console.log('File size:', (fs.statSync(TYPECHART_FILE).size / 1024).toFixed(1), 'KB');

// Sample verification
const soundMatch = verification.match(/sound:\{[^}]+\}/i);
if (soundMatch) console.log('\nSound entry preview:', soundMatch[0].slice(0, 200));
