#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const morePokemonDir = path.join(root, 'more pokemon');
const regionFile = path.join(morePokemonDir, 'The Wylin Region.txt');
const outputFile = path.join(morePokemonDir, 'wylin-customs.generated.json');
const missingSpritesFile = path.join(morePokemonDir, 'wylin-missing-sprites.txt');

function normalizeName(input) {
  return String(input || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function toTitleCaseWord(word) {
  if (!word) return '';
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function parseTypes(raw) {
  if (!raw) return ['Normal'];
  return raw
    .split('/')
    .map((t) => toTitleCaseWord(t.trim()))
    .filter(Boolean);
}

function feetInchesToMeters(raw) {
  const match = String(raw || '').match(/(\d+)\s*'\s*(\d+)/);
  if (!match) return undefined;
  const feet = Number(match[1]);
  const inches = Number(match[2]);
  const totalInches = feet * 12 + inches;
  return Math.round((totalInches * 0.0254) * 100) / 100;
}

function poundsToKg(raw) {
  const match = String(raw || '').match(/([\d.]+)/);
  if (!match) return undefined;
  const lbs = Number(match[1]);
  return Math.round((lbs * 0.45359237) * 100) / 100;
}

function parseMoveLine(line) {
  const match = String(line || '').match(/^\*\s*(\d+)\s*:\s*(.+?)\s*$/);
  if (!match) return null;
  const level = Number(match[1]);
  const moveText = match[2].trim();
  const detailMatch = moveText.match(/^(.+?)\s*\((.+)\)$/);
  if (!detailMatch) {
    return {
      moveName: moveText,
      learnsetCode: `9L${level}`,
      customMove: null,
    };
  }

  const moveName = detailMatch[1].trim();
  const details = detailMatch[2].trim();
  const parts = details.split('.').map((p) => p.trim()).filter(Boolean);
  const basePowerPart = parts.find((p) => /power/i.test(p));
  const typePart = parts.find((p) => /^(Normal|Fire|Water|Grass|Electric|Ice|Fighting|Poison|Ground|Flying|Psychic|Bug|Rock|Ghost|Dragon|Dark|Steel|Fairy)$/i.test(p));
  const categoryPart = parts.find((p) => /^(Physical|Special|Status)$/i.test(p));
  const basePowerMatch = basePowerPart?.match(/(\d+)/);

  return {
    moveName,
    learnsetCode: `9L${level}`,
    customMove: {
      name: moveName,
      type: toTitleCaseWord(typePart || 'Normal'),
      basePower: basePowerMatch ? Number(basePowerMatch[1]) : 0,
      category: toTitleCaseWord(categoryPart || 'Status'),
      shortDesc: details,
      desc: details,
    },
  };
}

function parseAbility(raw) {
  const text = String(raw || '').trim().replace(/[.]$/, '');
  const withDesc = text.match(/^(.+?)\s*\((.+)\)$/);
  if (!withDesc) return { abilityName: text, customAbility: null };
  const abilityName = withDesc[1].trim();
  const desc = withDesc[2].trim();
  return {
    abilityName,
    customAbility: {
      name: abilityName,
      shortDesc: desc,
      desc,
    },
  };
}

function parseSpeciesBlocks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let current = null;
  let inRealDexSection = false;

  function finalizeCurrent() {
    if (current?.name) blocks.push(current);
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inRealDexSection) {
      if (/^Hot\.\s*Very hot\./i.test(line)) {
        inRealDexSection = true;
      }
      continue;
    }

    const numberedHeader = line.match(/^\d+\.\s+([^:]+):?$/);
    const megaHeader = line.match(/^Mega\s+(.+?)\s*:?$/i);

    if (numberedHeader) {
      const cleanedName = numberedHeader[1].replace(/\s+\d+\s*$/g, '').trim();
      finalizeCurrent();
      current = {
        name: cleanedName,
        types: ['Normal'],
        baseStats: { hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe: 70 },
        abilities: { '0': 'None' },
        moves: [],
        customMoves: [],
        customAbilities: [],
      };
      continue;
    }

    if (megaHeader && !line.startsWith('Mega Evolution')) {
      finalizeCurrent();
      const base = megaHeader[1].replace(/\s+\d+\s*$/g, '').trim();
      current = {
        name: `${base}-Mega`,
        baseSpecies: base,
        forme: 'Mega',
        changesFrom: base,
        types: ['Normal'],
        baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
        abilities: { '0': 'None' },
        moves: [],
        customMoves: [],
        customAbilities: [],
      };
      continue;
    }

    if (!current || !line) continue;

    const typeMatch = line.match(/^Type:\s*(.+)$/i);
    if (typeMatch) {
      current.types = parseTypes(typeMatch[1]);
      continue;
    }

    const sizeMatch = line.match(/^Size:\s*(.+)$/i);
    if (sizeMatch) {
      const meters = feetInchesToMeters(sizeMatch[1]);
      if (meters != null) current.heightm = meters;
      continue;
    }

    const weightMatch = line.match(/^Weight:\s*(.+)$/i);
    if (weightMatch) {
      const kg = poundsToKg(weightMatch[1]);
      if (kg != null) current.weightkg = kg;
      continue;
    }

    const abilityMatch = line.match(/^Ability:\s*(.+)$/i);
    if (abilityMatch) {
      const parsed = parseAbility(abilityMatch[1]);
      current.abilities = { '0': parsed.abilityName || 'None' };
      if (parsed.customAbility) current.customAbilities.push(parsed.customAbility);
      continue;
    }

    const statMatch = line.match(/^\*\s*(HP|Attack|Defense|Special Attack|Special Defense|Speed):\s*(\d+)$/i);
    if (statMatch) {
      const statMap = {
        hp: 'hp',
        attack: 'atk',
        defense: 'def',
        'special attack': 'spa',
        'special defense': 'spd',
        speed: 'spe',
      };
      const key = statMap[statMatch[1].toLowerCase()];
      if (key) current.baseStats[key] = Number(statMatch[2]);
      continue;
    }

    if (line.startsWith('*') && /^\*\s*\d+\s*:/.test(line)) {
      const parsedMove = parseMoveLine(line);
      if (parsedMove) {
        current.moves.push(parsedMove);
        if (parsedMove.customMove) current.customMoves.push(parsedMove.customMove);
      }
      continue;
    }

    const megaItemMatch = line.match(/^\*\s*Mega Evolution:\s*([^\.]+)\.?$/i);
    if (megaItemMatch) {
      current.megaItem = megaItemMatch[1].trim();
    }
  }

  finalizeCurrent();
  return blocks;
}

function parseImageFileName(fileName) {
  const ext = path.extname(fileName);
  const bare = fileName.slice(0, -ext.length);
  const isShiny = /-shiny$/i.test(bare);
  const withoutShiny = bare.replace(/-shiny$/i, '');
  const parts = withoutShiny.split('-').filter(Boolean);
  if (!parts.length) return null;
  const baseSpecies = parts[0];
  const formeRaw = parts.length > 1 ? parts.slice(1).join('-') : null;
  const forme = formeRaw ? formeRaw.split('-').map(toTitleCaseWord).join('-') : null;
  return {
    baseSpecies,
    forme,
    isShiny,
    fullName: forme ? `${baseSpecies}-${forme}` : baseSpecies,
  };
}

function fileToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : null;
  if (!mime) return null;
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (!s) return t.length;
  if (!t) return s.length;
  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[s.length][t.length];
}

function findParsedBlockByName(nameNorm, parsedMap) {
  if (parsedMap.has(nameNorm)) return parsedMap.get(nameNorm);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [k, block] of parsedMap.entries()) {
    const d = levenshtein(nameNorm, k);
    if (d < bestDistance) {
      bestDistance = d;
      best = block;
    }
  }
  if (best && bestDistance <= 2) return best;
  return null;
}

function main() {
  if (!fs.existsSync(regionFile)) {
    throw new Error(`Missing file: ${regionFile}`);
  }

  const regionText = fs.readFileSync(regionFile, 'utf8');
  const parsedBlocks = parseSpeciesBlocks(regionText);

  const dex = {};
  const learnsets = {};
  const moves = {};
  const abilities = {};
  const sprites = {};

  let nextCustomNum = 20001;
  const baseToMegaItem = new Map();
  const parsedByNormalizedName = new Map();

  for (const block of parsedBlocks) {
    const key = normalizeName(block.name);
    parsedByNormalizedName.set(key, block);
    if (block.baseSpecies && block.forme === 'Mega') {
      const baseNorm = normalizeName(block.baseSpecies);
      const baseBlock = parsedByNormalizedName.get(baseNorm);
      if (baseBlock?.megaItem) {
        block.requiredItem = baseBlock.megaItem;
      }
    }
    if (block.megaItem) {
      baseToMegaItem.set(normalizeName(block.name), block.megaItem);
    }
  }

  const pngFiles = fs
    .readdirSync(morePokemonDir)
    .filter((name) => /\.(png|gif|webp)$/i.test(name));

  const baseToForms = new Map();

  for (const fileName of pngFiles) {
    const parsedName = parseImageFileName(fileName);
    if (!parsedName) continue;

    const baseNorm = normalizeName(parsedName.baseSpecies);
    const formNorm = parsedName.forme ? normalizeName(parsedName.fullName) : null;
    const filePath = path.join(morePokemonDir, fileName);
    const dataUrl = fileToDataUrl(filePath);
    if (!dataUrl) continue;

    const spriteId = formNorm || baseNorm;
    sprites[spriteId] = sprites[spriteId] || {};
    if (parsedName.isShiny) {
      sprites[spriteId].shiny = dataUrl;
      sprites[spriteId]['gen5-shiny'] = dataUrl;
    } else {
      sprites[spriteId].front = dataUrl;
      sprites[spriteId].gen5 = dataUrl;
    }

    if (!baseToForms.has(baseNorm)) {
      baseToForms.set(baseNorm, {
        displayName: parsedName.baseSpecies,
        forms: new Map(),
      });
    }
    if (parsedName.forme) {
      baseToForms.get(baseNorm).forms.set(formNorm, {
        displayName: parsedName.fullName,
        forme: parsedName.forme,
      });
    }
  }

  for (const [baseNorm, formInfo] of baseToForms.entries()) {
    const parsedBase = findParsedBlockByName(baseNorm, parsedByNormalizedName);
    const baseName = parsedBase?.name || formInfo.displayName;
    const baseEntry = {
      name: baseName,
      num: nextCustomNum++,
      types: parsedBase?.types || ['Normal'],
      baseStats: parsedBase?.baseStats || { hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe: 70 },
      abilities: parsedBase?.abilities || { '0': 'None' },
      heightm: parsedBase?.heightm,
      weightkg: parsedBase?.weightkg,
      color: 'Brown',
      gen: 9,
      isNonstandard: 'Custom',
      spriteid: baseName,
      otherFormes: [],
      formeOrder: [baseName],
    };
    dex[baseNorm] = baseEntry;

    const baseLearnset = {};
    for (const move of parsedBase?.moves || []) {
      const moveId = normalizeName(move.moveName);
      if (!moveId) continue;
      if (!baseLearnset[moveId]) baseLearnset[moveId] = [];
      baseLearnset[moveId].push(move.learnsetCode);
      if (move.customMove) moves[moveId] = move.customMove;
    }
    learnsets[baseNorm] = { learnset: baseLearnset };

    for (const customAbility of parsedBase?.customAbilities || []) {
      const abilityId = normalizeName(customAbility.name);
      if (abilityId) abilities[abilityId] = customAbility;
    }

    for (const [formNorm, formMeta] of formInfo.forms.entries()) {
      const parsedForm =
        findParsedBlockByName(formNorm, parsedByNormalizedName) ||
        findParsedBlockByName(normalizeName(`mega ${formInfo.displayName}`), parsedByNormalizedName);
      const formName = parsedForm?.name || formMeta.displayName;
      const formeLabel = parsedForm?.forme || formMeta.forme;

      const formEntry = {
        name: formName,
        num: nextCustomNum++,
        baseSpecies: baseName,
        forme: formeLabel,
        baseForme: 'Base',
        changesFrom: baseName,
        types: parsedForm?.types || baseEntry.types,
        baseStats: parsedForm?.baseStats || baseEntry.baseStats,
        abilities: parsedForm?.abilities || baseEntry.abilities,
        heightm: parsedForm?.heightm ?? baseEntry.heightm,
        weightkg: parsedForm?.weightkg ?? baseEntry.weightkg,
        color: 'Brown',
        gen: 9,
        isNonstandard: 'Custom',
        spriteid: formName,
      };

      if (/^mega$/i.test(formeLabel)) {
        formEntry.requiredItem = parsedForm?.requiredItem || baseToMegaItem.get(baseNorm);
      }

      dex[formNorm] = formEntry;
      baseEntry.otherFormes.push(formName);
      baseEntry.formeOrder.push(formName);

      const formLearnset = {};
      for (const move of parsedForm?.moves || parsedBase?.moves || []) {
        const moveId = normalizeName(move.moveName);
        if (!moveId) continue;
        if (!formLearnset[moveId]) formLearnset[moveId] = [];
        formLearnset[moveId].push(move.learnsetCode);
        if (move.customMove) moves[moveId] = move.customMove;
      }
      learnsets[formNorm] = { learnset: formLearnset };

      for (const customAbility of parsedForm?.customAbilities || []) {
        const abilityId = normalizeName(customAbility.name);
        if (abilityId) abilities[abilityId] = customAbility;
      }
    }
  }

  const payload = {
    dex,
    learnsets,
    moves,
    abilities,
    sprites,
    metadata: {
      sourceText: path.relative(root, regionFile).replace(/\\/g, '/'),
      sourceImagesDir: path.relative(root, morePokemonDir).replace(/\\/g, '/'),
      generatedAt: new Date().toISOString(),
      note: 'Import with Customs Import/Export → Import Customs.',
    },
  };

  const missingSpriteEntries = [];
  const spriteIds = new Set(Object.keys(sprites));
  for (const block of parsedBlocks) {
    const blockKey = normalizeName(block.name);
    const hasExact = spriteIds.has(blockKey);
    const hasClose = !hasExact && Array.from(spriteIds).some((id) => levenshtein(id, blockKey) <= 2);
    if (!hasExact && !hasClose) {
      missingSpriteEntries.push(block.name);
    }
  }
  payload.metadata.missingSprites = missingSpriteEntries;

  fs.writeFileSync(missingSpritesFile, missingSpriteEntries.join('\n'), 'utf8');

  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Generated: ${outputFile}`);
  console.log(`Missing sprite list: ${missingSpritesFile}`);
  console.log(`Species: ${Object.keys(dex).length}, Learnsets: ${Object.keys(learnsets).length}, Moves: ${Object.keys(moves).length}, Abilities: ${Object.keys(abilities).length}, Sprites: ${Object.keys(sprites).length}`);
  console.log(`Missing sprites from text blocks: ${missingSpriteEntries.length}`);
}

main();