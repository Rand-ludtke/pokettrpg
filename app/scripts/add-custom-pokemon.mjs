#!/usr/bin/env node
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';

// Simple CLI to append custom species and optional learnset JSON to vendor-src and copy sprite into public/ps/sprites
// Usage: node scripts/add-custom-pokemon.mjs --name "Alcremie" --json species.json [--learnset learnset.json] [--sprite path/to/file.png]

function parseArgs(argv) {
  const out = {}; let k = null;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) { k = a.replace(/^--/, ''); out[k] = true; }
    else if (k) { out[k] = a; k = null; }
  }
  return out;
}

function normalizeName(id) { return id.replace(/[^a-z0-9]/gi, '').toLowerCase(); }

const args = parseArgs(process.argv);
const name = args.name || args.species;
if (!name || !args.json) {
  console.error('Usage: node scripts/add-custom-pokemon.mjs --name "Name" --json species.json [--learnset learnset.json] [--sprite file.png]');
  process.exit(1);
}

const root = process.cwd();
const vendorData = path.join(root, 'vendor-src', 'pokemonshowdown', 'data');
const publicPsData = path.join(root, 'public', 'ps', 'data');
const publicPsSprites = path.join(root, 'public', 'ps', 'sprites');

const key = normalizeName(name);

const speciesJsonPath = path.resolve(args.json);
const learnsetJsonPath = args.learnset ? path.resolve(args.learnset) : null;
const spritePath = args.sprite ? path.resolve(args.sprite) : null;

async function main() {
  await mkdir(vendorData, { recursive: true });
  await mkdir(publicPsData, { recursive: true });
  await mkdir(publicPsSprites, { recursive: true });

  // Merge species into a local custom dex overlay file
  const customDexFile = path.join(vendorData, 'custom.dex.json');
  let customDex = {};
  try { customDex = JSON.parse(await readFile(customDexFile, 'utf8')); } catch {}
  const entry = JSON.parse(await readFile(speciesJsonPath, 'utf8'));
  customDex[key] = entry;
  await writeFile(customDexFile, JSON.stringify(customDex, null, 2));

  // Learnset optional
  if (learnsetJsonPath) {
    const customLsFile = path.join(vendorData, 'custom.learnsets.json');
    let customLs = {};
    try { customLs = JSON.parse(await readFile(customLsFile, 'utf8')); } catch {}
    const ls = JSON.parse(await readFile(learnsetJsonPath, 'utf8'));
    customLs[key] = { learnset: ls };
    await writeFile(customLsFile, JSON.stringify(customLs, null, 2));
  }

  // Sprite copy (optional) to ps/sprites/gen5 as base
  if (spritePath) {
    const dest = path.join(publicPsSprites, 'gen5', `${key}.png`);
    await cp(spritePath, dest);
  }

  console.log('Custom Pokémon added:', name);
}

main().catch(e => { console.error(e); process.exit(1); });
