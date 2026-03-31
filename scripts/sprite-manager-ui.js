#!/usr/bin/env node
/**
 * Browser-based Sprite Manager UI.
 *
 * Serves a web UI for reviewing and renaming base sprites
 * and custom battler (fusion) sprites one-by-one.
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
const CUSTOM_BATTLERS = path.join(ROOT, ".fusion-sprites-local", "CustomBattlers");
const IFDEX_JSON = path.join(ROOT, "scripts", "ifdex_names.json");
const DEX_JSON = path.join(ROOT, "scripts", "pokemon_names.json");
const PORT = 4400;

// ── Load dex data ────────────────────────────────────────────────────────────
let ifDex = {};
let natDex = {};
if (fs.existsSync(IFDEX_JSON)) ifDex = JSON.parse(fs.readFileSync(IFDEX_JSON, "utf-8"));
if (fs.existsSync(DEX_JSON)) natDex = JSON.parse(fs.readFileSync(DEX_JSON, "utf-8"));
const dex = { ...natDex, ...ifDex };
const MAX_IFDEX = Math.max(...Object.keys(ifDex).map(Number), 0);

function pokeName(num) {
  return ifDex[String(num)] || natDex[String(num)] || `Unknown(${num})`;
}

// ── File parsing helpers ─────────────────────────────────────────────────────
function parseBaseSprite(name) {
  const m = name.match(/^(\d+)([a-z]*)\.png$/i);
  if (!m) return null;
  return { dexNum: parseInt(m[1], 10), form: m[2] || "", ext: ".png" };
}

function parseFusion(name) {
  const m = name.match(/^(\d+)\.(\d+)([a-z]*)\.png$/i);
  if (!m) return null;
  return { head: parseInt(m[1], 10), body: parseInt(m[2], 10), form: m[3] || "", ext: ".png" };
}

// ── Scan anomalies ───────────────────────────────────────────────────────────
function scanAll() {
  const maxDex = MAX_IFDEX || Math.max(...Object.keys(dex).map(Number));
  const anomalies = [];

  // Scan BaseSprites
  if (fs.existsSync(BASE_SPRITES)) {
    const files = fs.readdirSync(BASE_SPRITES);
    const presentDex = new Set();

    for (const f of files) {
      if (f === ".DS_Store" || f.startsWith("96x96")) continue;
      const p = parseBaseSprite(f);
      if (!p) {
        anomalies.push({
          type: "non-standard",
          folder: "BaseSprites",
          file: f,
          reason: "Filename does not match pattern DEXNUM[form].png",
        });
        continue;
      }
      if (!p.form) presentDex.add(p.dexNum);
      if (p.dexNum > maxDex || p.dexNum < 1) {
        anomalies.push({
          type: "out-of-range",
          folder: "BaseSprites",
          file: f,
          dexNum: p.dexNum,
          form: p.form,
          reason: `Dex number ${p.dexNum} is beyond IF dex max (${maxDex})`,
          name: pokeName(p.dexNum),
        });
      }
    }

    for (let i = 1; i <= maxDex; i++) {
      if (!presentDex.has(i)) {
        anomalies.push({
          type: "missing",
          folder: "BaseSprites",
          file: `${i}.png`,
          dexNum: i,
          reason: `Missing default base sprite for #${i} ${pokeName(i)}`,
          name: pokeName(i),
        });
      }
    }
  }

  // Scan CustomBattlers for non-standard filenames
  if (fs.existsSync(CUSTOM_BATTLERS)) {
    const files = fs.readdirSync(CUSTOM_BATTLERS);
    for (const f of files) {
      if (f === ".DS_Store") continue;
      const p = parseFusion(f);
      if (!p) {
        anomalies.push({
          type: "non-standard",
          folder: "CustomBattlers",
          file: f,
          reason: "Filename does not match pattern HEAD.BODY[form].png",
        });
      }
    }
  }

  return { anomalies, maxDex };
}

// ── Browse by dex number ─────────────────────────────────────────────────────
function getDexInfo(dexNum) {
  const baseFiles = [];
  const fusions = { asHead: [], asBody: [] };

  if (fs.existsSync(BASE_SPRITES)) {
    const prefix = String(dexNum);
    for (const f of fs.readdirSync(BASE_SPRITES)) {
      const p = parseBaseSprite(f);
      if (p && p.dexNum === dexNum) baseFiles.push(f);
    }
  }

  if (fs.existsSync(CUSTOM_BATTLERS)) {
    for (const f of fs.readdirSync(CUSTOM_BATTLERS)) {
      const p = parseFusion(f);
      if (!p) continue;
      if (p.head === dexNum) fusions.asHead.push(f);
      if (p.body === dexNum) fusions.asBody.push(f);
    }
  }

  return {
    dexNum,
    name: pokeName(dexNum),
    baseFiles: baseFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    fusionsAsHead: fusions.asHead.length,
    fusionsAsBody: fusions.asBody.length,
  };
}

// ── Safe rename ──────────────────────────────────────────────────────────────
function safeRename(folder, oldName, newName) {
  // Validate newName matches expected patterns
  const dir = folder === "BaseSprites" ? BASE_SPRITES : CUSTOM_BATTLERS;
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: "Directory not found" };

  // Sanitize: only allow alphanumeric, dots, and .png extension
  if (!/^[\d]+[a-z]*\.png$/.test(newName) && !/^[\d]+\.[\d]+[a-z]*\.png$/.test(newName)) {
    return { ok: false, error: `Invalid filename pattern: ${newName}` };
  }

  const oldPath = path.join(dir, oldName);
  const newPath = path.join(dir, newName);

  // Prevent path traversal
  if (!oldPath.startsWith(dir) || !newPath.startsWith(dir)) {
    return { ok: false, error: "Invalid path" };
  }

  if (!fs.existsSync(oldPath)) return { ok: false, error: `File not found: ${oldName}` };
  if (fs.existsSync(newPath)) return { ok: false, error: `Target already exists: ${newName}` };

  fs.renameSync(oldPath, newPath);
  return { ok: true };
}

// ── Delete sprite ────────────────────────────────────────────────────────────
function safeDelete(folder, fileName) {
  const dir = folder === "BaseSprites" ? BASE_SPRITES : CUSTOM_BATTLERS;
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: "Directory not found" };

  const filePath = path.join(dir, fileName);
  if (!filePath.startsWith(dir)) return { ok: false, error: "Invalid path" };
  if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${fileName}` };

  // Move to trash folder instead of permanent delete
  const trashDir = path.join(dir, "_trash");
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
  const trashPath = path.join(trashDir, `${Date.now()}_${fileName}`);
  fs.renameSync(filePath, trashPath);
  return { ok: true };
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve sprite images
  if (url.pathname.startsWith("/sprites/base/")) {
    const fileName = path.basename(url.pathname);
    const filePath = path.join(BASE_SPRITES, fileName);
    if (!filePath.startsWith(BASE_SPRITES)) { res.writeHead(403); res.end(); return; }
    return serveImage(filePath, res);
  }
  if (url.pathname.startsWith("/sprites/fusion/")) {
    const fileName = path.basename(url.pathname);
    const filePath = path.join(CUSTOM_BATTLERS, fileName);
    if (!filePath.startsWith(CUSTOM_BATTLERS)) { res.writeHead(403); res.end(); return; }
    return serveImage(filePath, res);
  }

  // API endpoints
  if (url.pathname === "/api/scan") {
    const data = scanAll();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  if (url.pathname === "/api/dex" && url.searchParams.has("num")) {
    const num = parseInt(url.searchParams.get("num"), 10);
    if (isNaN(num) || num < 1) { res.writeHead(400); res.end("Invalid dex number"); return; }
    const data = getDexInfo(num);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  if (url.pathname === "/api/dex-names") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ifDex, maxDex: MAX_IFDEX }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rename") {
    return readBody(req, (body) => {
      const { folder, oldName, newName } = JSON.parse(body);
      const result = safeRename(folder, oldName, newName);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
  }

  if (req.method === "POST" && url.pathname === "/api/delete") {
    return readBody(req, (body) => {
      const { folder, fileName } = JSON.parse(body);
      const result = safeDelete(folder, fileName);
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

  // Auto-open browser
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
<title>Sprite Manager</title>
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
  .tabs { display: flex; gap: 4px; }
  .tabs button {
    padding: 6px 16px;
    border: 1px solid #444;
    background: #1a1a2e;
    color: #ccc;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    font-size: 0.9em;
  }
  .tabs button.active { background: #0f3460; color: #fff; border-bottom-color: #0f3460; }
  .stats { margin-left: auto; font-size: 0.85em; color: #888; }

  main { padding: 16px 24px; }

  /* Anomaly list view */
  .anomaly-controls {
    display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap;
  }
  .anomaly-controls select, .anomaly-controls input {
    padding: 6px 10px; border-radius: 6px; border: 1px solid #444;
    background: #16213e; color: #e0e0e0; font-size: 0.9em;
  }
  .anomaly-counter { font-size: 0.9em; color: #888; }

  .sprite-review {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 24px;
    min-height: 500px;
  }
  .sprite-preview {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .sprite-preview img {
    width: 192px;
    height: 192px;
    image-rendering: pixelated;
    background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px;
    border-radius: 8px;
    object-fit: contain;
  }
  .sprite-preview .file-name {
    font-family: monospace;
    font-size: 1em;
    color: #e94560;
    word-break: break-all;
    text-align: center;
  }
  .sprite-preview .poke-name {
    font-size: 1.1em;
    font-weight: 600;
    color: #fff;
  }
  .sprite-preview .folder-badge {
    font-size: 0.8em;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(100, 200, 100, 0.2);
    border: 1px solid rgba(100, 200, 100, 0.4);
  }
  .sprite-preview .folder-badge.fusion {
    background: rgba(180, 100, 255, 0.2);
    border-color: rgba(180, 100, 255, 0.4);
  }

  .sprite-details {
    background: #16213e;
    border-radius: 8px;
    padding: 20px;
  }
  .sprite-details h3 { margin-bottom: 12px; color: #e94560; }

  .detail-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 0.9em;
  }
  .detail-row .label { color: #888; }
  .detail-row .value { color: #e0e0e0; font-family: monospace; }

  .rename-section {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid #333;
  }
  .rename-section h4 { margin-bottom: 8px; color: #ccc; }
  .rename-row {
    display: flex; gap: 8px; align-items: center; margin-bottom: 8px;
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

  .nav-buttons {
    display: flex; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #333;
  }

  .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8em;
    font-weight: 600;
  }
  .type-badge.non-standard { background: #8b4513; color: #ffd; }
  .type-badge.out-of-range { background: #4a148c; color: #e8d5ff; }
  .type-badge.missing { background: #1a237e; color: #c5cae9; }

  .suggestion {
    padding: 6px 12px;
    background: rgba(100, 200, 100, 0.1);
    border: 1px solid rgba(100, 200, 100, 0.3);
    border-radius: 6px;
    font-family: monospace;
    font-size: 0.9em;
    cursor: pointer;
    display: inline-block;
    margin: 2px;
  }
  .suggestion:hover { background: rgba(100, 200, 100, 0.25); }

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

  /* Dex browse view */
  .dex-nav {
    display: flex; gap: 8px; align-items: center; margin-bottom: 16px;
  }
  .dex-nav input {
    width: 80px; padding: 6px 10px; border-radius: 6px;
    border: 1px solid #444; background: #16213e; color: #e0e0e0;
    font-size: 1em; text-align: center;
  }
  .dex-grid {
    display: flex; flex-wrap: wrap; gap: 12px;
  }
  .dex-card {
    background: #16213e;
    border-radius: 8px;
    padding: 12px;
    text-align: center;
    width: 140px;
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.15s;
  }
  .dex-card:hover { border-color: #e94560; }
  .dex-card img {
    width: 96px; height: 96px;
    image-rendering: pixelated;
    background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0 / 12px 12px;
    border-radius: 4px;
  }
  .dex-card .name { font-size: 0.8em; margin-top: 4px; color: #ccc; }
  .dex-card .num { font-size: 0.75em; color: #888; }

  .empty-state { color: #666; font-style: italic; padding: 40px; text-align: center; }

  kbd {
    padding: 2px 6px;
    background: #333;
    border: 1px solid #555;
    border-radius: 3px;
    font-size: 0.85em;
    font-family: monospace;
  }

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
</style>
</head>
<body>

<header>
  <h1>🖼️ Sprite Manager</h1>
  <div class="tabs">
    <button class="active" onclick="switchTab('anomalies')">Anomalies</button>
    <button onclick="switchTab('browse')">Browse Dex</button>
  </div>
  <div class="stats" id="statsBar">Loading...</div>
</header>

<main id="app">
  <div class="empty-state">Loading anomaly data...</div>
</main>

<div id="toast" class="toast" style="display:none"></div>

<script>
// ── State ────────────────────────────────────────────────────────────────────
let anomalies = [];
let filtered = [];
let currentIdx = 0;
let currentTab = 'anomalies';
let filterType = 'all';
let filterFolder = 'all';
let searchText = '';
let dexNames = {};
let maxDex = 572;
let browseDex = 1;

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const [scanRes, dexRes] = await Promise.all([
    fetch('/api/scan').then(r => r.json()),
    fetch('/api/dex-names').then(r => r.json()),
  ]);
  anomalies = scanRes.anomalies;
  maxDex = scanRes.maxDex || dexRes.maxDex;
  dexNames = dexRes.ifDex;

  document.getElementById('statsBar').textContent =
    anomalies.length + ' anomalies found | IF Dex max: ' + maxDex;

  applyFilter();
  render();
}

// ── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tabs button').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'anomalies') || (i === 1 && tab === 'browse'));
  });
  render();
}

// ── Filtering ────────────────────────────────────────────────────────────────
function applyFilter() {
  filtered = anomalies.filter(a => {
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (filterFolder !== 'all' && a.folder !== filterFolder) return false;
    if (searchText && !a.file.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });
  if (currentIdx >= filtered.length) currentIdx = Math.max(0, filtered.length - 1);
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (currentTab === 'anomalies') renderAnomalies(app);
  else renderBrowse(app);
}

function renderAnomalies(app) {
  if (filtered.length === 0) {
    app.innerHTML = \`
      <div class="anomaly-controls">
        \${renderFilters()}
      </div>
      <div class="empty-state">
        \${anomalies.length === 0 ? 'No anomalies found — all sprites look good! 🎉' : 'No anomalies match the current filter.'}
      </div>
    \`;
    bindFilterEvents();
    return;
  }

  const a = filtered[currentIdx];
  const imgSrc = a.type === 'missing' ? '' :
    (a.folder === 'BaseSprites' ? '/sprites/base/' : '/sprites/fusion/') + encodeURIComponent(a.file);

  // Build suggestions based on anomaly type
  let suggestions = '';
  if (a.type === 'non-standard') {
    suggestions = buildSuggestions(a);
  }

  app.innerHTML = \`
    <div class="anomaly-controls">
      \${renderFilters()}
      <span class="anomaly-counter">\${currentIdx + 1} / \${filtered.length}</span>
    </div>

    <div class="sprite-review">
      <div class="sprite-preview">
        \${a.type !== 'missing' ? \`<img src="\${imgSrc}" alt="\${a.file}" onerror="this.style.opacity=0.3" />\` : '<div style="width:192px;height:192px;display:flex;align-items:center;justify-content:center;background:#222;border-radius:8px;font-size:3em;opacity:0.3">?</div>'}
        <div class="file-name">\${escHtml(a.file)}</div>
        \${a.name ? '<div class="poke-name">' + escHtml(a.name) + '</div>' : ''}
        <span class="folder-badge \${a.folder === 'CustomBattlers' ? 'fusion' : ''}">\${escHtml(a.folder)}</span>
        <span class="type-badge \${a.type}">\${escHtml(a.type)}</span>
      </div>

      <div class="sprite-details">
        <h3>Anomaly Details</h3>
        <div class="detail-row"><span class="label">Type</span><span class="value">\${escHtml(a.type)}</span></div>
        <div class="detail-row"><span class="label">Folder</span><span class="value">\${escHtml(a.folder)}</span></div>
        <div class="detail-row"><span class="label">File</span><span class="value">\${escHtml(a.file)}</span></div>
        <div class="detail-row"><span class="label">Reason</span><span class="value">\${escHtml(a.reason)}</span></div>
        \${a.dexNum ? '<div class="detail-row"><span class="label">Dex #</span><span class="value">' + a.dexNum + '</span></div>' : ''}

        \${a.type !== 'missing' ? \`
          <div class="rename-section">
            <h4>Rename</h4>
            \${suggestions ? '<div style="margin-bottom:8px">Suggestions: ' + suggestions + '</div>' : ''}
            <div class="rename-row">
              <input type="text" id="renameInput" value="\${escAttr(a.file)}" placeholder="New filename" />
              <button class="btn success" onclick="doRename()">Rename</button>
            </div>
            <div style="margin-top:12px">
              <button class="btn danger" onclick="doDelete()">🗑️ Move to Trash</button>
            </div>
          </div>
        \` : \`
          <div class="rename-section">
            <h4>This sprite is missing</h4>
            <p style="color:#888;font-size:0.9em">No default base sprite exists for #\${a.dexNum} \${escHtml(a.name || '')}. You can add one manually to the BaseSprites folder.</p>
          </div>
        \`}

        <div class="nav-buttons">
          <button class="btn" onclick="go(-1)" \${currentIdx <= 0 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn" onclick="go(1)" \${currentIdx >= filtered.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
          <button class="btn" onclick="skipToType('non-standard')">Next Non-standard</button>
          <button class="btn" onclick="skipToType('out-of-range')">Next Out-of-range</button>
        </div>
        <div class="shortcuts-bar">
          <span><kbd>&larr;</kbd> Previous</span>
          <span><kbd>&rarr;</kbd> Next</span>
          <span><kbd>Enter</kbd> Rename</span>
          <span><kbd>Delete</kbd> Trash</span>
          <span><kbd>S</kbd> Skip to next non-standard</span>
        </div>
      </div>
    </div>
  \`;

  bindFilterEvents();

  // Focus rename input if available
  const inp = document.getElementById('renameInput');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') doRename();
      e.stopPropagation();
    });
  }
}

function renderFilters() {
  return \`
    <select id="filterType" value="\${filterType}">
      <option value="all" \${filterType==='all'?'selected':''}>All types</option>
      <option value="non-standard" \${filterType==='non-standard'?'selected':''}>Non-standard</option>
      <option value="out-of-range" \${filterType==='out-of-range'?'selected':''}>Out-of-range</option>
      <option value="missing" \${filterType==='missing'?'selected':''}>Missing</option>
    </select>
    <select id="filterFolder" value="\${filterFolder}">
      <option value="all" \${filterFolder==='all'?'selected':''}>All folders</option>
      <option value="BaseSprites" \${filterFolder==='BaseSprites'?'selected':''}>BaseSprites</option>
      <option value="CustomBattlers" \${filterFolder==='CustomBattlers'?'selected':''}>CustomBattlers</option>
    </select>
    <input type="text" id="filterSearch" placeholder="Search filename..." value="\${escAttr(searchText)}" />
  \`;
}

function bindFilterEvents() {
  const typeEl = document.getElementById('filterType');
  const folderEl = document.getElementById('filterFolder');
  const searchEl = document.getElementById('filterSearch');
  if (typeEl) typeEl.onchange = () => { filterType = typeEl.value; applyFilter(); render(); };
  if (folderEl) folderEl.onchange = () => { filterFolder = folderEl.value; applyFilter(); render(); };
  if (searchEl) searchEl.oninput = () => { searchText = searchEl.value; applyFilter(); render(); };
}

function buildSuggestions(a) {
  const suggestions = [];
  const f = a.file;

  // Try to extract a dex number from the filename
  const nums = f.match(/\\d+/g);
  if (nums) {
    if (a.folder === 'BaseSprites') {
      // Suggest the cleaned-up version
      const num = nums[0];
      suggestions.push(num + '.png');
      if (nums.length === 1) {
        // Maybe it has some suffix
        const suffix = f.replace(/^\\d+/, '').replace(/\\.png$/i, '').replace(/[^a-z]/gi, '').toLowerCase();
        if (suffix) suggestions.push(num + suffix.charAt(0) + '.png');
      }
    } else if (a.folder === 'CustomBattlers' && nums.length >= 2) {
      suggestions.push(nums[0] + '.' + nums[1] + '.png');
      suggestions.push(nums[0] + '.' + nums[1] + 'a.png');
    }
  }

  return suggestions.map(s =>
    '<span class="suggestion" onclick="setSuggestion(\\'' + escAttr(s) + '\\')">' + escHtml(s) + '</span>'
  ).join(' ');
}

function setSuggestion(name) {
  const inp = document.getElementById('renameInput');
  if (inp) inp.value = name;
}

// ── Browse dex tab ───────────────────────────────────────────────────────────
function renderBrowse(app) {
  const cards = [];
  const start = browseDex;
  const end = Math.min(start + 29, maxDex);
  for (let i = start; i <= end; i++) {
    const name = dexNames[String(i)] || 'Unknown';
    cards.push(\`
      <div class="dex-card" onclick="viewDex(\${i})">
        <img src="/sprites/base/\${i}.png" alt="\${escAttr(name)}" onerror="this.style.opacity=0.15" />
        <div class="name">\${escHtml(name)}</div>
        <div class="num">#\${i}</div>
      </div>
    \`);
  }

  app.innerHTML = \`
    <div class="dex-nav">
      <button class="btn" onclick="browsePage(-30)">&larr; Prev 30</button>
      <input type="number" id="dexJump" value="\${browseDex}" min="1" max="\${maxDex}" />
      <button class="btn" onclick="browsePage(0)">Go</button>
      <button class="btn" onclick="browsePage(30)">Next 30 &rarr;</button>
      <span style="color:#888;font-size:0.9em">Showing #\${start}–\${end} of \${maxDex}</span>
    </div>
    <div class="dex-grid">
      \${cards.join('')}
    </div>
  \`;
}

function browsePage(offset) {
  if (offset === 0) {
    const v = parseInt(document.getElementById('dexJump').value, 10);
    if (!isNaN(v) && v >= 1) browseDex = v;
  } else {
    browseDex = Math.max(1, Math.min(browseDex + offset, maxDex));
  }
  render();
}

function viewDex(num) {
  // Switch to anomalies view filtered to this dex number
  filterType = 'all';
  filterFolder = 'all';
  searchText = String(num);
  applyFilter();
  currentIdx = 0;
  switchTab('anomalies');
}

// ── Navigation ───────────────────────────────────────────────────────────────
function go(delta) {
  currentIdx = Math.max(0, Math.min(filtered.length - 1, currentIdx + delta));
  render();
}

function skipToType(type) {
  for (let i = currentIdx + 1; i < filtered.length; i++) {
    if (filtered[i].type === type) { currentIdx = i; render(); return; }
  }
  // Wrap around
  for (let i = 0; i < currentIdx; i++) {
    if (filtered[i].type === type) { currentIdx = i; render(); return; }
  }
  showToast('No more ' + type + ' anomalies', 'err');
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function doRename() {
  const a = filtered[currentIdx];
  if (!a || a.type === 'missing') return;
  const inp = document.getElementById('renameInput');
  const newName = (inp?.value || '').trim();
  if (!newName || newName === a.file) return;

  const res = await fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: a.folder, oldName: a.file, newName }),
  }).then(r => r.json());

  if (res.ok) {
    showToast(a.file + ' → ' + newName, 'ok');
    // Remove from anomalies and advance
    const origIdx = anomalies.indexOf(a);
    if (origIdx >= 0) anomalies.splice(origIdx, 1);
    applyFilter();
    if (currentIdx >= filtered.length) currentIdx = Math.max(0, filtered.length - 1);
    render();
  } else {
    showToast(res.error || 'Rename failed', 'err');
  }
}

async function doDelete() {
  const a = filtered[currentIdx];
  if (!a || a.type === 'missing') return;
  if (!confirm('Move ' + a.file + ' to trash?')) return;

  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: a.folder, fileName: a.file }),
  }).then(r => r.json());

  if (res.ok) {
    showToast(a.file + ' moved to trash', 'ok');
    const origIdx = anomalies.indexOf(a);
    if (origIdx >= 0) anomalies.splice(origIdx, 1);
    applyFilter();
    if (currentIdx >= filtered.length) currentIdx = Math.max(0, filtered.length - 1);
    render();
  } else {
    showToast(res.error || 'Delete failed', 'err');
  }
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Don't intercept when typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (currentTab !== 'anomalies') return;

  if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  else if (e.key === 'Delete') { e.preventDefault(); doDelete(); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipToType('non-standard'); }
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
