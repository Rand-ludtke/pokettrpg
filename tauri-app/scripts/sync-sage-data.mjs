import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tauriAppDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(tauriAppDir, '..');

const sourceDir = path.join(repoRoot, 'data', 'sage', 'generated');
const targetDir = path.join(tauriAppDir, 'public', 'data', 'sage', 'generated');

const files = [
  'pokedex.sage.json',
  'learnsets.sage.json',
  'moves.custom.sage.json',
  'abilities.custom.sage.json',
  'items.custom.sage.json',
];

function main() {
  if (!fs.existsSync(sourceDir)) {
    console.log(`[sync-sage-data] source missing, skipped: ${sourceDir}`);
    process.exit(0);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  for (const name of files) {
    const src = path.join(sourceDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(targetDir, name);
    fs.copyFileSync(src, dst);
    copied += 1;
  }

  console.log(`[sync-sage-data] copied ${copied}/${files.length} files to ${targetDir}`);
}

main();
