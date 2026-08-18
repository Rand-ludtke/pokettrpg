/**
 * fix-type-colors.mjs
 * 
 * Adds missing fangame type colors (Crystal, Cosmic, Sound, Light, Stellar, Nuclear, Shadow)
 * to all TYPE_COLORS maps in React TSX files that are missing them.
 * 
 * Run: node tauri-app/scripts/fix-type-colors.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Canonical colors for fangame types (lowercase keys for files that use lowercase)
const FANGAME_COLORS_LOWER = {
  crystal: '#a0d2eb',
  cosmic: '#c491e9',
  nuclear: '#92D050',
  stellar: '#fbc531',
  sound: '#ff66aa',
  light: '#fffacd',
  shadow: '#4a3a66',
};

// Same but Title case for files that use Title case keys
const FANGAME_COLORS_TITLE = {
  Crystal: '#a0d2eb',
  Cosmic: '#c491e9',
  Nuclear: '#4caf50',
  Stellar: '#fbc531',
  Sound: '#ff66aa',
  Light: '#fffacd',
  Shadow: '#4a3a66',
};

const files = [
  path.join(__dirname, '..', 'src', 'ui', 'FusionCreator.tsx'),
  path.join(__dirname, '..', 'src', 'ui', 'FusionTab.tsx'),
  path.join(__dirname, '..', 'src', 'ui', 'SidePanel.tsx'),
  path.join(__dirname, '..', 'src', 'ui', 'SimpleBattleTab.tsx'),
  path.join(__dirname, '..', 'src', 'ui', 'PokedexTab.tsx'),
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`${path.basename(file)}: FILE NOT FOUND - skipping`);
    continue;
  }
  
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;
  
  // Determine if file uses lowercase or Title case for type keys
  const usesLower = content.includes("fairy: '#") || content.includes("normal: '#") || content.includes("fire: '#");
  const usesTitle = content.includes("Fairy: '#") || content.includes("Normal: '#") || content.includes("Fire: '#");
  
  const colors = usesLower ? FANGAME_COLORS_LOWER : FANGAME_COLORS_TITLE;
  
  // Find which are missing
  const missing = Object.entries(colors).filter(([type]) => {
    const lowerKey = type.toLowerCase();
    return !content.toLowerCase().includes(`${lowerKey}: '#`) &&
           !content.toLowerCase().includes(`${lowerKey}:'#`) &&
           !content.toLowerCase().includes(`${lowerKey}: "#`) &&
           !content.toLowerCase().includes(`${lowerKey}:"#`);
  });
  
  if (missing.length === 0) {
    console.log(`${path.basename(file)}: all fangame types present - skip`);
    continue;
  }
  
  console.log(`${path.basename(file)}: adding [${missing.map(([t]) => t).join(', ')}]`);
  
  // Build the additions string
  const additions = missing.map(([type, color]) => `  ${type}: '${color}',`).join('\n');
  
  // Find the last type entry in the TYPE_COLORS object and insert after it
  // Look for pattern: Steel or Fairy (usually last standard type)
  // Strategy: find the closing }; of the TYPE_COLORS/colors object and insert before it
  
  // Try to find the TYPE_COLORS = { ... }; block and append before }
  const patterns = [
    // Record<string, string> = { ... }
    /const\s+TYPE_COLORS\s*:\s*Record<string,\s*string>\s*=\s*\{([^;]+)\};/,
    // const TYPE_COLORS = { ... }
    /const\s+TYPE_COLORS\s*=\s*\{([^;]+)\};/,
    // const colors: Record<string, string> = { ... }
    /const\s+colors\s*:\s*Record<string,\s*string>\s*=\s*\{([^;]+)\};/,
    // getTypeColor function with colors object
    /const\s+colors\s*=\s*\{([^;]+)\};[\s\S]*?return\s+colors\[type\]/,
  ];
  
  let matched = false;
  for (const pattern of patterns) {
    const m = content.match(pattern);
    if (m) {
      // Find the end of this colors object and insert before the }
      const fullMatch = m[0];
      const lastBrace = fullMatch.lastIndexOf('}');
      const insertPoint = m.index + lastBrace;
      
      const toInsert = '\n' + additions;
      content = content.slice(0, insertPoint) + toInsert + '\n' + content.slice(insertPoint);
      modified = true;
      matched = true;
      break;
    }
  }
  
  if (!matched) {
    // Fallback: find "Steel: '#" or "fairy: '#" and add after the line
    const fallbackPatterns = [
      /Fairy:\s*'#[0-9a-fA-F]+',?/,
      /fairy:\s*'#[0-9a-fA-F]+',?/,
      /Steel:\s*'#[0-9a-fA-F]+',?/,
      /steel:\s*'#[0-9a-fA-F]+',?/,
    ];
    
    for (const fp of fallbackPatterns) {
      const fm = content.match(fp);
      if (fm) {
        const insertAfter = fm.index + fm[0].length;
        const toInsert = '\n' + additions;
        content = content.slice(0, insertAfter) + toInsert + content.slice(insertAfter);
        modified = true;
        matched = true;
        break;
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`  ✓ Updated ${path.basename(file)}`);
  } else {
    console.log(`  ⚠ Could not find TYPE_COLORS location in ${path.basename(file)}`);
  }
}

console.log('\nDone! Run npm run build to verify changes compile correctly.');
