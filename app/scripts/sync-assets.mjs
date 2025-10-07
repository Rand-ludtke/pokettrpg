import { cp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.cwd(), '..');
const showdown = path.join(root, 'pokemon-showdown-client', 'play.pokemonshowdown.com');
// Public, served assets consumed by the app
const target = path.join(process.cwd(), 'public', 'vendor', 'showdown');
// Private, non-served sources for reference (original TS caches)
const vendorSrc = path.join(process.cwd(), 'vendor-src', 'pokemonshowdown');

async function main() {
  await mkdir(target, { recursive: true });
  await mkdir(vendorSrc, { recursive: true });
  // Copy the entire Showdown client so all JS/CSS/assets are available offline
  try {
    await cp(showdown, target, { recursive: true });
  } catch {}
  // Copy JSON data
  const dataSrc = path.join(showdown, 'data');
  const dataDest = path.join(target, 'data');
  await mkdir(dataDest, { recursive: true });
  for (const f of ['pokedex.json', 'moves.json']) {
    await cp(path.join(dataSrc, f), path.join(dataDest, f), { recursive: false });
  }

  // Build abilities.json, items.json, and learnsets.json from Showdown JS tables if JSON isn't present
  async function buildJson(jsFile, exportVar, outName) {
    const full = path.join(dataSrc, jsFile);
    const code = await readFile(full, 'utf8');
    const context = { exports: {}, module: { exports: {} } };
    vm.createContext(context);
    // abilities.js uses exports.BattleAbilities = {...}
    const wrapped = `var exports = {}; var module = { exports: exports };\n${code}\nmodule.exports`;
    const result = vm.runInContext(wrapped, context);
    const obj = result?.BattleAbilities || result?.BattleItems || result?.BattleLearnsets || result || {};
    await writeFile(path.join(dataDest, outName), JSON.stringify(obj, null, 2), 'utf8');
  }
  await buildJson('abilities.js', 'BattleAbilities', 'abilities.json');
  await buildJson('items.js', 'BattleItems', 'items.json');
  // learnsets may not exist in play site; fall back to vendor-src TS
  const learnsetsJs = path.join(dataSrc, 'learnsets.js');
  try {
    await access(learnsetsJs);
    await buildJson('learnsets.js', 'BattleLearnsets', 'learnsets.json');
  } catch {
    // fallback: parse TS from caches/vendor-src
    const tsPath = path.join(process.cwd(), 'vendor-src', 'pokemonshowdown', 'data', 'learnsets.ts');
    try {
      const tsCode = await readFile(tsPath, 'utf8');
      // crude transform TS to JS
      let js = tsCode
        .replace(/^\s*import[^\n]*\n/gm, '')
        .replace(/export\s+const\s+Learnsets\s*:[^=]+=/, 'module.exports =')
        .replace(/as\s+const/g, '');
      const context = { module: { exports: {} }, exports: {} };
      vm.createContext(context);
      const result = vm.runInContext(js, context);
      const obj = context.module.exports || result || {};
      const out = obj?.Learnsets || obj;
      await writeFile(path.join(dataDest, 'learnsets.json'), JSON.stringify(out, null, 2), 'utf8');
      console.log('Built learnsets.json from TS');
    } catch (e) {
      console.warn('Could not build learnsets.json; move legality will be disabled.', e?.message || e);
    }
  }

  // Keep a copy of original TS cache sources for future full PS integration
  const cachesTs = path.join(root, 'pokemon-showdown-client', 'caches', 'pokemon-showdown', 'data');
  try {
    await cp(cachesTs, path.join(vendorSrc, 'data'), { recursive: true });
  } catch {}

  // Copy sprite folders. Default to a minimal set to keep package size small.
  // Use CLI flags to control:
  //   --all            copy all sprite sets (LARGE)
  //   --sets=a,b,c     copy only specific subfolders (e.g., gen5,gen5-shiny,gen5icons,types)
  const spritesSrc = path.join(showdown, 'sprites');
  const spritesDest = path.join(target, 'sprites');
  // Clean previous sprite tree to avoid accumulating large sets
  try { await rm(spritesDest, { recursive: true, force: true }); } catch {}
  await mkdir(spritesDest, { recursive: true });
  const argv = process.argv.slice(2);
  const copyAll = argv.includes('--all');
  const setsArg = argv.find(a => a.startsWith('--sets='));
  const sets = copyAll ? ['__ALL__'] : (setsArg ? setsArg.replace(/^--sets=/, '').split(',') : ['gen5','gen5-shiny','gen5icons','types','home','trainers']);
  if (sets.includes('__ALL__')) {
    await cp(spritesSrc, spritesDest, { recursive: true });
  } else {
    for (const sub of sets) {
      const from = path.join(spritesSrc, sub);
      const to = path.join(spritesDest, sub);
      try {
        await mkdir(path.dirname(to), { recursive: true });
        await cp(from, to, { recursive: true });
      } catch (e) {
        // ignore missing optional sets
      }
    }
  }
  // Removed duplicate exposure under /ps to reduce app size
  console.log('Synced showdown assets to', target, 'and cached TS sources to', vendorSrc);

  // Copy Mini Battler assets into public for embedding at /mini-battle
  const miniSrc = path.join(root, 'code', 'ps-mini-battle', 'public');
  const miniDest = path.join(process.cwd(), 'public', 'mini-battle');
  try {
    await rm(miniDest, { recursive: true, force: true });
  } catch {}
  try {
    await cp(miniSrc, miniDest, { recursive: true });
    // Patch viewer.js to expose a simple streaming API via postMessage and window.MB
    const vPath = path.join(miniDest, 'viewer.js');
    let vCode = await readFile(vPath, 'utf8');
  vCode += `\n\n// --- Injected by sync-assets: streaming bridge ---\n` +
`try {\n` +
`  window.MB = {\n` +
`    setSpritesDir: (url) => { try { spritesDir = String(url||''); var el = document.getElementById('sprites'); if (el) el.value = spritesDir; } catch(e){} },\n` +
`    setMode: (mode) => { try { if (typeof setMode === 'function') setMode(mode); } catch(e){} },\n` +
`    reset: () => { try { logLines = []; i = 0; playing = false; if (logElem) logElem.textContent = ''; setHP('p1', 100); setHP('p2', 100); if (p1img) p1img.removeAttribute('src'); if (p2img) p2img.removeAttribute('src'); } catch(e){} },\n` +
`    appendLine: (line) => { try { if (typeof line === 'string' && line) { appendLog(line); processLine(line); } } catch(e){} },\n` +
`    appendLines: (lines) => { try { (Array.isArray(lines)? lines: []).forEach(l => { if (typeof l === 'string' && l) { appendLog(l); processLine(l); } }); } catch(e){} },\n` +
`    play: () => { try { play(); } catch(e){} },\n` +
`    step: () => { try { step(); } catch(e){} },\n` +
`  };\n` +
`  window.addEventListener('message', function(ev){\n` +
`    var d = ev && ev.data; if (!d || typeof d !== 'object') return;\n` +
`    try {\n` +
`      if (d.type === 'mb:setSpritesDir') { window.MB.setSpritesDir(d.url || d.dir || ''); return; }\n` +
`      if (d.type === 'mb:mode') { window.MB.setMode(d.mode||''); return; }\n` +
`      if (d.type === 'mb:reset') { window.MB.reset(); return; }\n` +
`      if (d.type === 'mb:appendLine') { window.MB.appendLine(String(d.line||'')); return; }\n` +
`      if (d.type === 'mb:appendLines') { window.MB.appendLines(Array.isArray(d.lines)? d.lines: []); return; }\n` +
`      if (d.type === 'mb:play') { window.MB.play(); return; }\n` +
`      if (d.type === 'mb:step') { window.MB.step(); return; }\n` +
`    } catch(e){}\n` +
`  });\n` +
`} catch(e) { console.warn('Mini battler bridge error', e); }\n`;
    await writeFile(vPath, vCode, 'utf8');
    console.log('Copied mini-battler to', miniDest);
  } catch (e) {
    console.warn('Mini-battler assets missing or failed to copy:', e?.message || e);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
