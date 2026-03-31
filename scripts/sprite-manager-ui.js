#!/usr/bin/env node
/**
 * Browser-based Sprite Manager UI — Base Sprite Reviewer.
 *
 * Walk through every numbered base sprite one-by-one,
 * see the sprite image alongside the expected Pokémon name,
 * and rename / trash any that are wrong.
 *
 * Skips: out-of-range sprites (>572), letter-only custom names.
 * Those are intentional and left alone.
 *
 * Usage:
 *   node scripts/sprite-manager-ui.js
 *   # Then open http://localhost:4400 in your browser
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");
const BASE_SPRITES = path.join(ROOT, ".fusion-sprites-local", "Other", "BaseSprites");
const IFDEX_JSON = path.join(ROOT, "scripts", "ifdex_names.json");
const DEX_JSON = path.join(ROOT, "scripts", "pokemon_names.json");
const PORT = Number(process.env.PORT) || 4400;

// ── Load dex data ────────────────────────────────────────────────────────────
let ifDex = {};
let natDex = {};
if (fs.existsSync(IFDEX_JSON)) ifDex = JSON.parse(fs.readFileSync(IFDEX_JSON, "utf-8"));
if (fs.existsSync(DEX_JSON)) natDex = JSON.parse(fs.readFileSync(DEX_JSON, "utf-8"));
const MAX_IFDEX = Math.max(...Object.keys(ifDex).map(Number), 0);

function pokeName(num) {
  return ifDex[String(num)] || natDex[String(num)] || null;
}

// ── File parsing ─────────────────────────────────────────────────────────────
function parseBaseSprite(name) {
  const m = name.match(/^(\d+)([a-z]*)\.png$/i);
  if (!m) return null;
  return { dexNum: parseInt(m[1], 10), form: m[2] || "", ext: ".png" };
}

// ── Build in-range sprite list ───────────────────────────────────────────────
// Returns all base sprites with dex numbers 1..MAX_IFDEX grouped by dex number
function buildSpriteList() {
  if (!fs.existsSync(BASE_SPRITES)) return { byDex: {}, allFiles: [] };

  const files = fs.readdirSync(BASE_SPRITES);
  const byDex = {}; // dexNum -> [{ file, form }]
  const skipped = { outOfRange: 0, nonStandard: 0 };

  for (const f of files) {
    if (f === ".DS_Store" || f.startsWith("96x96") || f.startsWith("_")) continue;
    const p = parseBaseSprite(f);
    if (!p) { skipped.nonStandard++; continue; } // letter-named custom sprites — skip
    if (p.dexNum < 1 || p.dexNum > MAX_IFDEX) { skipped.outOfRange++; continue; } // out of range — skip
    if (!byDex[p.dexNum]) byDex[p.dexNum] = [];
    byDex[p.dexNum].push({ file: f, form: p.form });
  }

  // Sort forms within each dex entry
  for (const num of Object.keys(byDex)) {
    byDex[num].sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
  }

  return { byDex, skipped };
}

// ── Safe rename ──────────────────────────────────────────────────────────────
function safeRename(oldName, newName) {
  if (!/^[\d]+[a-z]*\.png$/.test(newName)) {
    return { ok: false, error: `Invalid filename pattern: ${newName}. Must be DEXNUM[form].png` };
  }
  const oldPath = path.join(BASE_SPRITES, oldName);
  const newPath = path.join(BASE_SPRITES, newName);
  if (!oldPath.startsWith(BASE_SPRITES) || !newPath.startsWith(BASE_SPRITES)) {
    return { ok: false, error: "Invalid path" };
  }
  if (!fs.existsSync(oldPath)) return { ok: false, error: `File not found: ${oldName}` };
  if (oldName !== newName && fs.existsSync(newPath)) return { ok: false, error: `Target already exists: ${newName}` };
  if (oldName === newName) return { ok: true };
  fs.renameSync(oldPath, newPath);
  return { ok: true };
}

// ── Trash sprite ─────────────────────────────────────────────────────────────
function safeDelete(fileName) {
  const filePath = path.join(BASE_SPRITES, fileName);
  if (!filePath.startsWith(BASE_SPRITES)) return { ok: false, error: "Invalid path" };
  if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${fileName}` };
  const trashDir = path.join(BASE_SPRITES, "_trash");
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
  fs.renameSync(filePath, path.join(trashDir, `${Date.now()}_${fileName}`));
  return { ok: true };
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve sprite images
  if (url.pathname.startsWith("/sprites/")) {
    const fileName = path.basename(url.pathname);
    const filePath = path.join(BASE_SPRITES, fileName);
    if (!filePath.startsWith(BASE_SPRITES)) { res.writeHead(403); res.end(); return; }
    return serveImage(filePath, res);
  }

  // API: full sprite list
  if (url.pathname === "/api/sprites") {
    const data = buildSpriteList();
    const names = {};
    for (let i = 1; i <= MAX_IFDEX; i++) {
      const n = pokeName(i);
      if (n) names[i] = n;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ byDex: data.byDex, skipped: data.skipped, names, maxDex: MAX_IFDEX }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rename") {
    return readBody(req, (body) => {
      const { oldName, newName } = JSON.parse(body);
      const result = safeRename(oldName, newName);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
  }

  if (req.method === "POST" && url.pathname === "/api/delete") {
    return readBody(req, (body) => {
      const { fileName } = JSON.parse(body);
      const result = safeDelete(fileName);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
  }

  // Serve the UI
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

function readBody(req, cb) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => cb(body));
}

function serveImage(filePath, res) {
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
  res.end(data);
}

server.listen(PORT, () => {
  console.log(`\n  🖼️  Sprite Manager UI running at http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop.\n`);
  try {
    if (process.platform === "win32") {
      require("child_process").execSync(`start http://localhost:${PORT}`, { stdio: "ignore", shell: true });
    } else if (process.platform === "darwin") {
      require("child_process").execSync(`open http://localhost:${PORT}`, { stdio: "ignore" });
    } else {
      require("child_process").execSync(`xdg-open http://localhost:${PORT}`, { stdio: "ignore" });
    }
  } catch {}
});

// ── HTML / CSS / JS for the UI ───────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sprite Manager — Base Sprite Review</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    min-height: 100vh;
  }
  header {
    background: #16213e;
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid #333;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  header h1 { font-size: 1.2em; color: #e94560; white-space: nowrap; }

  .nav-row {
    display: flex; gap: 8px; align-items: center;
  }
  .nav-row input[type=number] {
    width: 80px; padding: 6px 10px; border-radius: 6px;
    border: 1px solid #444; background: #1a1a2e; color: #e0e0e0;
    font-size: 1em; text-align: center;
  }
  .stats { margin-left: auto; font-size: 0.85em; color: #888; }

  main { padding: 16px 24px; }

  .review-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    min-height: 500px;
  }

  .sprite-column {
    background: #16213e;
    border-radius: 8px;
    padding: 20px;
  }
  .sprite-column h2 {
    text-align: center;
    margin-bottom: 16px;
    color: #e94560;
    font-size: 1.1em;
  }

  .sprite-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
  }
  .sprite-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border-radius: 8px;
    background: rgba(0,0,0,0.2);
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .sprite-card:hover { border-color: #e94560; }
  .sprite-card.selected { border-color: #0f0; }
  .sprite-card img {
    width: 192px;
    height: 192px;
    image-rendering: pixelated;
    background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px;
    border-radius: 8px;
    object-fit: contain;
  }
  .sprite-card .label {
    font-family: monospace;
    font-size: 0.9em;
    color: #aaa;
  }

  .info-column {
    background: #16213e;
    border-radius: 8px;
    padding: 20px;
  }
  .info-column h2 {
    margin-bottom: 16px;
    color: #fff;
    font-size: 1.1em;
    text-align: center;
  }

  .dex-info {
    text-align: center;
    margin-bottom: 20px;
    padding: 16px;
    background: rgba(0,0,0,0.2);
    border-radius: 8px;
  }
  .dex-info .dex-num {
    font-size: 2em;
    font-weight: 700;
    color: #e94560;
  }
  .dex-info .dex-name {
    font-size: 1.4em;
    font-weight: 600;
    color: #fff;
    margin-top: 4px;
  }
  .dex-info .dex-sub {
    font-size: 0.85em;
    color: #888;
    margin-top: 4px;
  }

  .status-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 0.85em;
    font-weight: 600;
    margin-top: 8px;
  }
  .status-badge.ok { background: rgba(0,200,0,0.15); color: #4f4; border: 1px solid rgba(0,200,0,0.3); }
  .status-badge.missing { background: rgba(200,0,0,0.15); color: #f44; border: 1px solid rgba(200,0,0,0.3); }
  .status-badge.multi { background: rgba(200,200,0,0.15); color: #ff4; border: 1px solid rgba(200,200,0,0.3); }

  .actions-section {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid #333;
  }
  .actions-section h3 { margin-bottom: 10px; color: #ccc; font-size: 0.95em; }

  .rename-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
  }
  .rename-row input {
    padding: 8px 12px;
    border: 1px solid #444;
    background: #1a1a2e;
    color: #e0e0e0;
    border-radius: 6px;
    font-family: monospace;
    font-size: 0.95em;
    flex: 1;
  }
  .rename-row input:focus { border-color: #e94560; outline: none; }

  .btn {
    padding: 8px 16px;
    border: 1px solid #444;
    background: #0f3460;
    color: #fff;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }
  .btn:hover { background: #1a4a8a; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.danger { background: #8b0000; border-color: #a00; }
  .btn.danger:hover { background: #a00; }
  .btn.success { background: #1a6b1a; border-color: #2a8a2a; }
  .btn.success:hover { background: #2a8a2a; }
  .btn.small { padding: 4px 10px; font-size: 0.8em; }

  .nav-buttons {
    display: flex; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #333; flex-wrap: wrap;
  }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 0.9em;
    z-index: 200;
    transition: opacity 0.3s;
  }
  .toast.ok { background: #1a6b1a; color: #fff; }
  .toast.err { background: #8b0000; color: #fff; }

  .shortcuts-bar {
    margin-top: 12px;
    padding: 8px 12px;
    background: rgba(255,255,255,0.03);
    border-radius: 6px;
    font-size: 0.8em;
    color: #666;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  kbd {
    padding: 2px 6px;
    background: #333;
    border: 1px solid #555;
    border-radius: 3px;
    font-size: 0.85em;
    font-family: monospace;
  }

  .empty-state { color: #666; font-style: italic; padding: 40px; text-align: center; }
  .missing-placeholder {
    width: 192px; height: 192px;
    display: flex; align-items: center; justify-content: center;
    background: #222; border-radius: 8px; font-size: 3em; opacity: 0.3;
  }
</style>
</head>
<body>

<header>
  <h1>🖼️ Base Sprite Reviewer</h1>
  <div class="nav-row">
    <button class="btn" onclick="go(-1)">← Prev</button>
    <input type="number" id="dexJump" value="1" min="1" />
    <button class="btn" onclick="jumpToDex()">Go</button>
    <button class="btn" onclick="go(1)">Next →</button>
    <button class="btn" style="margin-left:12px" onclick="jumpToNextIssue()">Next Issue ⚠️</button>
  </div>
  <div class="stats" id="statsBar">Loading...</div>
</header>

<main id="app">
  <div class="empty-state">Loading sprite data...</div>
</main>

<div id="toast" class="toast" style="display:none"></div>

<script>
// ── State ────────────────────────────────────────────────────────────────────
let byDex = {};
let names = {};
let maxDex = 572;
let currentDex = 1;
let selectedFile = null; // currently selected sprite file for actions

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const data = await fetch('/api/sprites').then(r => r.json());
  byDex = data.byDex;
  names = data.names;
  maxDex = data.maxDex;

  // Count stats
  let present = 0, missing = 0, multi = 0;
  for (let i = 1; i <= maxDex; i++) {
    const files = byDex[i];
    if (!files || files.length === 0) missing++;
    else { present++; if (files.length > 1) multi++; }
  }

  document.getElementById('statsBar').textContent =
    present + ' present | ' + missing + ' missing | ' + multi + ' multi-form | ' + maxDex + ' total';
  document.getElementById('dexJump').max = maxDex;

  render();
}

// ── Navigate ─────────────────────────────────────────────────────────────────
function go(delta) {
  currentDex = Math.max(1, Math.min(maxDex, currentDex + delta));
  selectedFile = null;
  document.getElementById('dexJump').value = currentDex;
  render();
}

function jumpToDex() {
  const v = parseInt(document.getElementById('dexJump').value, 10);
  if (!isNaN(v) && v >= 1 && v <= maxDex) {
    currentDex = v;
    selectedFile = null;
    render();
  }
}

function jumpToNextIssue() {
  // Find next dex number where sprite is missing (no default form)
  for (let i = currentDex + 1; i <= maxDex; i++) {
    const files = byDex[i];
    if (!files || files.length === 0) {
      currentDex = i;
      selectedFile = null;
      document.getElementById('dexJump').value = i;
      render();
      return;
    }
  }
  // Wrap around
  for (let i = 1; i < currentDex; i++) {
    const files = byDex[i];
    if (!files || files.length === 0) {
      currentDex = i;
      selectedFile = null;
      document.getElementById('dexJump').value = i;
      render();
      return;
    }
  }
  showToast('No missing sprites found!', 'ok');
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  const files = byDex[currentDex] || [];
  const name = names[currentDex] || 'Unknown';
  const hasMissing = files.length === 0;
  const hasDefault = files.some(f => f.form === '');

  // Left column: sprite images
  let spriteCards = '';
  if (files.length === 0) {
    spriteCards = '<div class="missing-placeholder">?</div><div style="color:#f44;margin-top:8px">No sprite files found</div>';
  } else {
    for (const f of files) {
      const isSelected = f.file === selectedFile;
      spriteCards += \`
        <div class="sprite-card \${isSelected ? 'selected' : ''}" onclick="selectFile('\${escAttr(f.file)}')">
          <img src="/sprites/\${encodeURIComponent(f.file)}" alt="\${escAttr(f.file)}"
               onerror="this.style.opacity=0.15" />
          <div class="label">\${escHtml(f.file)}\${f.form ? ' (form: ' + f.form + ')' : ' (default)'}</div>
        </div>
      \`;
    }
  }

  // Right column: dex info + actions
  let statusBadge = '';
  if (hasMissing) statusBadge = '<span class="status-badge missing">MISSING</span>';
  else if (!hasDefault) statusBadge = '<span class="status-badge missing">NO DEFAULT FORM</span>';
  else if (files.length > 1) statusBadge = '<span class="status-badge multi">' + files.length + ' FORMS</span>';
  else statusBadge = '<span class="status-badge ok">OK</span>';

  // Actions for selected file
  let actionsHtml = '';
  if (selectedFile) {
    actionsHtml = \`
      <div class="actions-section">
        <h3>Selected: <span style="color:#e94560;font-family:monospace">\${escHtml(selectedFile)}</span></h3>
        <div class="rename-row">
          <input type="text" id="renameInput" value="\${escAttr(selectedFile)}" placeholder="New filename" />
          <button class="btn success" onclick="doRename()">Rename</button>
        </div>
        <div style="margin-top:8px">
          <button class="btn danger" onclick="doDelete()">🗑️ Move to Trash</button>
        </div>
      </div>
    \`;
  } else if (files.length > 0) {
    actionsHtml = '<div class="actions-section"><div class="dim" style="color:#666">Click a sprite to select it for renaming or removal.</div></div>';
  }

  app.innerHTML = \`
    <div class="review-layout">
      <div class="sprite-column">
        <h2>Sprites for #\${currentDex}</h2>
        <div class="sprite-grid">
          \${spriteCards}
        </div>
      </div>
      <div class="info-column">
        <h2>Dex Reference</h2>
        <div class="dex-info">
          <div class="dex-num">#\${currentDex}</div>
          <div class="dex-name">\${escHtml(name)}</div>
          <div class="dex-sub">This dex number should be \${escHtml(name)}</div>
          \${statusBadge}
        </div>

        \${actionsHtml}

        <div class="nav-buttons">
          <button class="btn" onclick="go(-1)" \${currentDex <= 1 ? 'disabled' : ''}>← Previous</button>
          <button class="btn" onclick="go(1)" \${currentDex >= maxDex ? 'disabled' : ''}>Next →</button>
          <button class="btn" onclick="jumpToNextIssue()">Next Missing ⚠️</button>
          <button class="btn" onclick="go(-10)">← 10</button>
          <button class="btn" onclick="go(10)">10 →</button>
        </div>
        <div class="shortcuts-bar">
          <span><kbd>←</kbd> Previous</span>
          <span><kbd>→</kbd> Next</span>
          <span><kbd>Enter</kbd> Rename selected</span>
          <span><kbd>Delete</kbd> Trash selected</span>
          <span><kbd>N</kbd> Next missing</span>
        </div>
      </div>
    </div>
  \`;

  // Bind rename input Enter key
  const inp = document.getElementById('renameInput');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') doRename();
      e.stopPropagation();
    });
  }
}

function selectFile(file) {
  selectedFile = (selectedFile === file) ? null : file;
  render();
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function doRename() {
  if (!selectedFile) return;
  const inp = document.getElementById('renameInput');
  const newName = (inp?.value || '').trim();
  if (!newName || newName === selectedFile) return;

  const res = await fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldName: selectedFile, newName }),
  }).then(r => r.json());

  if (res.ok) {
    showToast(selectedFile + ' → ' + newName, 'ok');
    // Update local data
    const files = byDex[currentDex] || [];
    const idx = files.findIndex(f => f.file === selectedFile);
    if (idx >= 0) {
      const m = newName.match(/^(\\d+)([a-z]*)\\.png$/i);
      if (m) {
        const newDex = parseInt(m[1], 10);
        const newForm = m[2] || '';
        // Remove from current dex
        files.splice(idx, 1);
        if (files.length === 0) delete byDex[currentDex];
        // Add to new dex
        if (!byDex[newDex]) byDex[newDex] = [];
        byDex[newDex].push({ file: newName, form: newForm });
        byDex[newDex].sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
      }
    }
    selectedFile = null;
    render();
  } else {
    showToast(res.error || 'Rename failed', 'err');
  }
}

async function doDelete() {
  if (!selectedFile) return;
  if (!confirm('Move ' + selectedFile + ' to trash?')) return;

  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: selectedFile }),
  }).then(r => r.json());

  if (res.ok) {
    showToast(selectedFile + ' moved to trash', 'ok');
    const files = byDex[currentDex] || [];
    const idx = files.findIndex(f => f.file === selectedFile);
    if (idx >= 0) files.splice(idx, 1);
    if (files.length === 0) delete byDex[currentDex];
    selectedFile = null;
    render();
  } else {
    showToast(res.error || 'Delete failed', 'err');
  }
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  else if (e.key === 'Delete') { e.preventDefault(); doDelete(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); jumpToNextIssue(); }
});

// ── Toast notifications ──────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Start ────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>`;

