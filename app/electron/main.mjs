import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;
import path from 'node:path';
import { createServer } from 'node:http';
import serveStatic from 'serve-static';
import finalhandler from 'finalhandler';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Single-instance lock on Windows
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/**
 * Create a tiny static server that serves our built Vite dist folder.
 * This avoids file:// CORS issues and keeps fetch('/vendor/...') paths working.
 */
function resolveShowdownRoot(distRoot) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // In packaged app, prefer unpacked resources to avoid any asar quirks and large file perf issues
  if (app.isPackaged) {
    try {
      const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'vendor', 'showdown');
      if (existsSync(unpacked)) return unpacked;
    } catch {}
  }
  // Prefer built assets in dist/public vendor (works in dev and also from asar)
  const distShowdown = path.join(distRoot, 'vendor', 'showdown');
  if (existsSync(distShowdown)) return distShowdown;
  // Fallback to repo location at project root (dev convenience)
  const repoShowdown = path.join(__dirname, '..', '..', 'pokemon-showdown-client', 'play.pokemonshowdown.com');
  if (existsSync(repoShowdown)) return repoShowdown;
  // Last resort: old relative path
  const alt = path.join(__dirname, '..', 'pokemon-showdown-client', 'play.pokemonshowdown.com');
  return alt;
}

function createStaticServer(root, preferredPort = 17645) {
  const serve = serveStatic(root, { index: ['index.html'] });
  // Serve Showdown client assets from the vendored folder under a stable path
  const showdownRoot = resolveShowdownRoot(root);
  const serveShowdown = serveStatic(showdownRoot, { index: ['index.html'] });
  const server = createServer((req, res) => {
    // Do not set COOP/COEP headers; these can cause the Showdown iframe to render black in packaged apps
    const isShowdown = !!(req.url && req.url.startsWith('/showdown/'));
    // Try to serve, otherwise fall back to index.html (SPA routing)
    if (isShowdown) {
      // Strip /showdown prefix for static serving
      const origUrl = req.url;
      req.url = req.url.replace('/showdown', '') || '/index.html';
      serveShowdown(req, res, () => finalhandler(req, res));
      req.url = origUrl;
      return;
    }
    serve(req, res, () => {
      const origUrl = req.url;
      req.url = '/index.html';
      serve(req, res, finalhandler(req, res));
      req.url = origUrl;
    });
  });
  function tryListen(port, resolve) {
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && port < preferredPort + 10) {
        // try the next port in a small range
        tryListen(port + 1, resolve);
      } else {
        resolve({ server: null, port: null, error: err });
      }
    });
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port });
    });
  }
  return new Promise((resolve) => {
    tryListen(preferredPort, resolve);
  });
}

let mainWindow = null;

// Check for updates before starting the full app UI; prompt user to download/install
async function maybeUpdateBeforeStart() {
  if (!app.isPackaged) return; // only check when packaged
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    const r = await autoUpdater.checkForUpdates();
    const info = r && r.updateInfo;
    const available = !!(info && info.version && info.version !== app.getVersion());
    if (!available) return;

    const msg = `Version ${info.version} is available.`;
    const detail = 'Download now and restart to install, or skip to continue without updating.';
    const res = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Download and Install', 'Skip'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: msg,
      detail,
      noLink: true,
    });
    if (res.response !== 0) return;

    // Download update; this may take time. If it fails, continue startup.
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      console.warn('Update download failed:', e);
      return;
    }

    const ready = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'Update downloaded',
      detail: 'Restart now to install the update. If you choose Later, it will install on the next app launch.',
      noLink: true,
    });
    if (ready.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
      // prevent continuing to create the window since we are quitting
      await new Promise(() => {});
    }
  } catch (e) {
    console.warn('Startup update check failed:', e);
  }
}
async function createWindow() {
  // Resolve dist folder both in dev and when packaged in asar
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDir = app.isPackaged
    ? path.join(app.getAppPath(), 'dist')
    : path.join(__dirname, '..', 'dist');
  
  // Small console hint if something goes wrong
  console.log('Serving dist from:', distDir);
  const { server, port, error } = await createStaticServer(distDir);
  if (!server || !port) {
    console.error('Failed to start static server:', error);
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#d4f7e5',
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.mjs'),
    },
  });

  win.on('closed', () => server.close());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow = win;

  // Note: updater temporarily disabled while we rework update flow
}

app.whenReady().then(async () => {
  await maybeUpdateBeforeStart();
  await createWindow();
});

app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length) {
    const w = wins[0];
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Minimal LAN WebSocket host in main ---
let wss = null;
let wssHttp = null;
let udpBeacon = null;
let udpBeaconTimer = null;
let udpDiscover = null;
const clientsById = new Map(); // clientId -> ws
const wsMeta = new WeakMap(); // ws -> { clientId, username, avatar }
let challenges = []; // { id, fromId, from, toId?, format, teamName, teamText? }
let rooms = []; // { id, name, format, players:[{id,name,avatar?, teamText?}], spectators:[{id,name,avatar?}], allowedIds?:string[], status:'open'|'active'|'started' }
const psBattles = new Map(); // roomId -> PS battle handle
// Track in-progress battle initializations to avoid racey double inits
const initializingBattles = new Set();
// Keep a rolling buffer of recent omni logs per room for replays when UI remounts
const roomLogs = new Map(); // roomId -> string[]
// Keep a small chat history so new tabs can hydrate
const chatLog = [];
// Aggregate multi-user choices per room (for boss mode triples): roomId -> { p1: {a?:string,b?:string,c?:string}, p2?: string }
const pendingChoices = new Map();

async function tryStartPSBattle(room) {
  // Attempt to load @pkmn/sim dynamically; if unavailable, no-op
  let sim;
  try {
    sim = await import('@pkmn/sim');
  } catch (e) {
    console.warn('PS simulator not available. Install @pkmn/sim to enable engine.');
    return false;
  }
  try {
    // Minimal stub: create a Battle instance (future: BattleStreams for IO)
    // eslint-disable-next-line new-cap
    const battle = new sim.Battle({ formatid: 'gen9customgame' });
    psBattles.set(room.id, battle);
    if (mainWindow) mainWindow.webContents.send('lan:ps-status', { roomId: room.id, ok: true });
    return true;
  } catch (e) {
    console.warn('Failed to start PS battle:', e);
    if (mainWindow) mainWindow.webContents.send('lan:ps-status', { roomId: room.id, ok: false, error: String(e) });
    return false;
  }
}

async function initPSBattleWithTeams(room) {
  // Prevent double init for the same room (including race conditions)
  if (psBattles.has(room.id) || initializingBattles.has(room.id)) {
    sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'Battle already initialized – skipping' });
    return;
  }
  initializingBattles.add(room.id);
  let sim;
  try {
    sim = await import('@pkmn/sim');
  } catch { initializingBattles.delete(room.id); return; }
  try {
    // Use BattleStreams with per-player streams
    const { BattleStreams, Teams } = sim;
  const omni = new BattleStreams.BattleStream();
  const ps = BattleStreams.getPlayerStreams(omni);
  psBattles.set(room.id, { omni: ps.omniscient, p1: ps.p1, p2: ps.p2 });
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'Battle streams created' });
  const isBoss = !!(room && room.mode === 'boss');
  // Singles: use plain customgame to avoid extra unrecognized rule issues
  const format = isBoss ? 'gen9customgame@@@Game Type: Triples' : 'gen9customgame';
    // Pipe omni logs to renderer
    (async () => {
      sendAll('room-debug', { roomId: room.id, where: 'omniscient', msg: 'reader started' });
      try {
        for await (const chunk of ps.omniscient) {
          const text = String(chunk);
          sendAll('room-debug', { roomId: room.id, where: 'omniscient', msg: text.slice(0, 200) });
          // store in buffer
          const arr = roomLogs.get(room.id) || [];
          const lines = text.split('\n');
          for (const l of lines) if (l) arr.push(l);
          while (arr.length > 400) arr.shift(); // cap buffer
          roomLogs.set(room.id, arr);
          // broadcast
          sendAll('room-log', { roomId: room.id, chunk: text });
        }
      } catch (e) {
        sendAll('room-debug', { roomId: room.id, where: 'omniscient', msg: 'reader error: ' + String(e) });
      } finally {
        sendAll('room-debug', { roomId: room.id, where: 'omniscient', msg: 'reader ended' });
      }
    })();
    // Listen for per-player requests and forward to clients
    const watchPlayer = async (side, stream) => {
      sendAll('room-debug', { roomId: room.id, where: side, msg: 'reader started' });
      for await (const chunk of stream) {
        const text = String(chunk);
        sendAll('room-debug', { roomId: room.id, where: side, msg: ('chunk: ' + text).slice(0, 200) });
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith('|request|')) {
            try {
              const req = JSON.parse(line.slice('|request|'.length));
              // send to host UI and all connected clients
              sendAll('room-request', { roomId: room.id, side, request: req });
              sendAll('room-debug', { roomId: room.id, where: side, msg: 'request sent' });
              // Forward the raw request line into the PS client stream so it can render prompts
              sendAll('room-log', { roomId: room.id, chunk: line + '\n' });
            } catch {}
          }
          if (line.startsWith('|win|') || line.startsWith('|tie|')) {
            sendAll('room-end', { roomId: room.id, result: line });
            // Also forward to PS client stream to finalize the room UI
            sendAll('room-log', { roomId: room.id, chunk: line + '\n' });
          }
        }
      }
    };
    watchPlayer('p1', ps.p1);
    watchPlayer('p2', ps.p2);
    // Start battle and send sides/teams
  let p1Team = (room.players[0] && room.players[0].teamText) || '';
  let p2Team = (room.players[1] && room.players[1].teamText) || '';
  if (isBoss && room.meta && Array.isArray(room.meta.fighters) && room.meta.fighters.length) {
      // Fighters become p1 triplet; boss becomes p2 single
      const pickFirstMon = (teamText) => {
        if (!teamText) return '';
        const parts = String(teamText).split(/\n\s*\n/);
        return (parts[0] || '').trim();
      };
      const mons = room.meta.fighters.map(f => pickFirstMon(f.teamText)).filter(Boolean);
      if (mons.length) p1Team = mons.join('\n\n');
      if (room.meta.boss) p2Team = room.meta.boss.teamText || p2Team;
    }
  // Seed a header into buffers and broadcast for all (host + clients)
  {
    const arr = roomLogs.get(room.id) || [];
    arr.push('>localbattle');
    roomLogs.set(room.id, arr);
    sendAll('room-log', { roomId: room.id, chunk: '>localbattle\n' });
  }
  // Write control commands to the omniscient stream, include teams in player definitions
  const p1Payload = { name: room.players[0]?.name || 'P1', avatar: room.players[0]?.avatar || 'generic' };
  const p2Payload = { name: room.players[1]?.name || 'P2', avatar: room.players[1]?.avatar || 'generic' };
  try {
    if (p1Team) {
      const t = Teams.import(p1Team); p1Payload.team = Teams.pack(t);
      sendAll('room-debug', { roomId: room.id, where: 'engine', msg: `packed p1 team (${(t?.length)||0} mons)` });
    }
  } catch (e) { sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'p1 team pack error: '+String(e) }); }
  try {
    if (p2Team) {
      const t = Teams.import(p2Team); p2Payload.team = Teams.pack(t);
      sendAll('room-debug', { roomId: room.id, where: 'engine', msg: `packed p2 team (${(t?.length)||0} mons)` });
    }
  } catch (e) { sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'p2 team pack error: '+String(e) }); }
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'Starting battle with format ' + format });
  // IMPORTANT: write to the BattleStream (omni), not the read-only omniscient stream
  omni.write(`>start ${JSON.stringify({ formatid: format })}\n`);
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'wrote >start' });
  omni.write(`>player p1 ${JSON.stringify(p1Payload)}\n`);
  omni.write(`>player p2 ${JSON.stringify(p2Payload)}\n`);
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'wrote >player p1/p2' });
  // Proactively submit a default team order (1..N) via player streams to kick off Team Preview/lead selection
  const countMons = (txt) => {
    if (!txt) return 0; const parts = String(txt).trim().split(/\n\s*\n/).filter(Boolean); return Math.min(6, Math.max(1, parts.length));
  };
  const p1Count = countMons(p1Team);
  const p2Count = countMons(p2Team);
  const orderStr = (n) => Array.from({ length: n }, (_, i) => String(i + 1)).join('');
  if (p1Count) { ps.p1.write(`team ${orderStr(p1Count)}\n`); }
  if (p2Count) { ps.p2.write(`team ${orderStr(p2Count)}\n`); }
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: `wrote default team order p1(${p1Count})/p2(${p2Count})` });
  // Trigger the first request cycle
  omni.write(`>ut\n`);
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'wrote >ut' });
  // As a failsafe, queue default choices to both sides after a tiny delay to ensure the engine advances
  setTimeout(() => {
    try { ps.p1.write('choose default\n'); sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'kick: p1 choose default' }); } catch {}
    try { ps.p2.write('choose default\n'); sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'kick: p2 choose default' }); } catch {}
  }, 10);
  } catch (e) {
    console.warn('PS battle stream init error:', e);
  } finally {
    initializingBattles.delete(room.id);
  }
}

function roster() {
  const arr = [];
  for (const ws of wss?.clients || []) {
    const meta = wsMeta.get(ws);
    if (meta && meta.clientId) arr.push({ id: meta.clientId, name: meta.username || 'Player', avatar: meta.avatar || null });
  }
  return arr;
}
function sendAll(t, d) { broadcast(t, d); }
function broadcastRoster() { sendAll('roster', roster()); }
function syncChallenges() { sendAll('challenge-sync', { list: challenges }); }
function broadcast(event, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ t: event, d: payload });
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(msg);
  }
  // also mirror to renderer for local display
  if (mainWindow) mainWindow.webContents.send(`lan:${event}`, payload);
}

function sendTo(ws, event, payload) {
  try {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: event, d: payload }));
  } catch {}
}

// Forward a player's choice to PS engine
ipcMain.handle('ps:room:choose', async (_e, { roomId, side, choice }) => {
  try {
    const inst = psBattles.get(roomId);
    if (!inst) return { ok: false, error: 'no-room' };
    const stream = side === 'p1' ? inst.p1 : inst.p2;
    if (!stream) return { ok: false, error: 'no-side' };
    // BattleStreams expect newline-terminated commands
    stream.write(String(choice).endsWith('\n') ? String(choice) : String(choice) + '\n');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('lan:host', async (_event, opts = {}) => {
  if (wss) return { ok: true, port: wssHttp?.address()?.port };
  let port = Number(opts.port || 17646);
  wssHttp = createServer();
  await new Promise((resolve, reject) => {
    const tryPort = (p) => {
      wssHttp.removeAllListeners('error');
      wssHttp.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && p < port + 10) {
          tryPort(p + 1);
        } else {
          reject(err);
        }
      });
      wssHttp.listen(p, '0.0.0.0', () => { port = p; resolve(); });
    };
    tryPort(port);
  });
  wss = new WebSocketServer({ server: wssHttp });
  wss.on('connection', (ws, req) => {
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(String(buf)); } catch { return; }
      if (!msg || !msg.t) return;
      if (msg.t === 'hello') {
        const { clientId, username, avatar } = msg.d || {};
        if (!clientId) return;
        // Ensure a single active socket per clientId to avoid duplication
        const prev = clientsById.get(clientId);
        if (prev && prev !== ws && prev.readyState === 1) {
          try { prev.close(1000, 'replaced'); } catch {}
        }
        clientsById.set(clientId, ws);
        wsMeta.set(ws, { clientId, username: username || 'Player', avatar: avatar || null });
        broadcastRoster();
        // Send current challenges to all (keeps everyone in sync)
        syncChallenges();
        // Also send rooms so new joiners can see active battles
        sendAll('rooms', rooms);
        return;
      }
      if (msg.t === 'state-request') {
        // Reply only to requester with a snapshot
        sendTo(ws, 'state', { rooms, challenges, roster: roster(), chat: chatLog.slice(-200) });
        return;
      }
      // Regular messages
      const meta = wsMeta.get(ws) || {};
      if (msg.t === 'chat') {
        const text = (msg.d && msg.d.text) || '';
        sendAll('chat', { from: meta.username || 'Player', text });
        try { chatLog.push({ from: meta.username || 'Player', text, at: Date.now() }); while (chatLog.length > 200) chatLog.shift(); } catch {}
        return;
      }
      if (msg.t === 'room-chat') {
        const roomId = (msg.d && msg.d.roomId) || '';
        const text = (msg.d && msg.d.text) || '';
        if (!roomId || !text) return;
        const r = rooms.find(r => r.id === roomId);
        if (!r) return;
        // Optional: basic permission check – allow players or spectators (if any)
        const uid = meta.clientId;
        const isPlayer = !!r.players?.find(p => p.id === uid);
        const isSpectator = !!r.spectators?.find(s => s.id === uid);
        if (!isPlayer && !isSpectator) return;
        sendAll('room-chat', { roomId, from: meta.username || 'Player', text });
        return;
      }
      if (msg.t === 'room-choose') {
        const d = msg.d || {};
        const roomId = d.roomId;
        let choice = String(d.choice || '').trim();
        const slot = d.slot || '';
        if (!roomId || !choice) return;
        const r = rooms.find(r => r.id === roomId);
        if (!r) return;
        const inst = psBattles.get(roomId);
        if (!inst) return; // engine not started
        // Normalize choice (remove leading 'choose ' if provided)
        if (/^choose\s+/i.test(choice)) choice = choice.replace(/^choose\s+/i, '');
        const isBoss = r && (r.mode === 'boss' || (/boss/i.test(r.format||'')));
        const uid = meta.clientId;
        if (isBoss && r.meta && r.slots) {
          // Authorization: fighters can send p1a/p1b/p1c; boss can send p2a
          const fighters = r.meta.fighters || [];
          const boss = r.meta.boss || {};
          // Route boss side immediate
          if (slot === 'p2a') {
            if (uid !== boss.id) return;
            inst.p2.write(`choose ${choice}\n`);
            return;
          }
          // Route fighter partial choices into aggregator
          const slotMap = { p1a: 'a', p1b: 'b', p1c: 'c' };
          const key = slotMap[slot];
          if (!key) return;
          const expectedId = r.slots[slot];
          if (uid !== expectedId) return;
          let p = pendingChoices.get(roomId);
          if (!p) { p = { p1: {}, p2: undefined }; pendingChoices.set(roomId, p); }
          p.p1[key] = choice;
          // If we have all three, flush combined; else wait
          const a = p.p1.a || 'default';
          const b = p.p1.b || 'default';
          const c = p.p1.c || 'default';
          const haveAll = ['a','b','c'].every(k => typeof p.p1[k] === 'string');
          if (haveAll) {
            inst.p1.write(`choose ${a}, ${b}, ${c}\n`);
            pendingChoices.delete(roomId);
          }
          return;
        } else {
          // Non-boss: allow only room players to act; map slot to side
          const side = (slot && /^p2/i.test(slot)) ? 'p2' : 'p1';
          const isPlayer = !!r.players?.find(p => p.id === uid);
          if (!isPlayer) return;
          const stream = side === 'p2' ? inst.p2 : inst.p1;
          stream.write(`choose ${choice}\n`);
          return;
        }
      }
      if (msg.t === 'room-buffer-request') {
        try {
          const roomId = msg?.d?.roomId;
          if (!roomId) return;
          const lines = roomLogs.get(roomId) || [];
          sendTo(ws, 'room-buffer', { roomId, lines: lines.slice(-400) });
        } catch {}
        return;
      }
      if (msg.t === 'challenge-create') {
        const d = msg.d || {};
        const id = d.id;
        if (!id) return;
        // enforce one open challenge per user
        challenges = challenges.filter(c => c.fromId !== meta.clientId);
        const isBoss = typeof d.format === 'string' && /boss/i.test(d.format || '');
        challenges.push({ id, fromId: meta.clientId, from: meta.username || 'Player', toId: d.toId || null, format: d.format || 'Singles', teamName: d.teamName || 'Random', teamText: d.teamText || '', fighters: isBoss ? [] : undefined });
        syncChallenges();
        return;
      }
      if (msg.t === 'challenge-cancel') {
        const id = (msg.d && msg.d.id) || '';
        const before = challenges.length;
        challenges = challenges.filter(c => c.id !== id || c.fromId !== (wsMeta.get(ws)||{}).clientId);
        if (challenges.length !== before) syncChallenges();
        return;
      }
      if (msg.t === 'challenge-accept') {
        const id = (msg.d && msg.d.id) || '';
        const ch = challenges.find(c => c.id === id);
        if (!ch) return;
        // Prevent accepting your own challenge
        if (ch.fromId === (wsMeta.get(ws)||{}).clientId) {
          return;
        }
        // If targeted to a specific player, only they can accept
        if (ch.toId && ch.toId !== meta.clientId) return;
          // Boss challenge behavior: accumulate fighters until 3 then start
          const isBoss = typeof ch.format === 'string' && /boss/i.test(ch.format || '');
          if (isBoss) {
            ch.fighters = ch.fighters || [];
            if (!ch.fighters.find(f => f.id === meta.clientId)) {
              ch.fighters.push({ id: meta.clientId, name: meta.username || 'Player', avatar: meta.avatar || null, teamText: (msg.d && msg.d.teamText) || '' });
            }
            syncChallenges();
            if (ch.fighters.length >= 3) {
              const chWs = clientsById.get(ch.fromId);
              const chMeta = chWs ? (wsMeta.get(chWs) || {}) : {};
              const boss = { id: ch.fromId, name: ch.from, avatar: chMeta.avatar || null, teamText: ch.teamText || '' };
              const fighters = ch.fighters.slice(0,3);
              const roomId = 'r_'+Math.random().toString(36).slice(2,8);
              const slots = { p1a: fighters[0].id, p1b: fighters[1].id, p1c: fighters[2].id };
              const room = { id: roomId, name: ch.format+' • '+ch.teamName, format: ch.format, players:[fighters[0], boss, fighters[1], fighters[2]], spectators:[], allowedIds:[boss.id, ...fighters.map(f=>f.id)], status:'started', mode:'boss', bossSide:'p2', slots, meta:{ boss, fighters } };
              rooms.push(room);
              challenges = challenges.filter(c => c.id !== id);
              syncChallenges();
              sendAll('rooms', rooms);
              sendAll('room-start', { roomId: room.id, name: room.name, format: room.format, players: room.players, mode:'boss', slots });
              sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'init battle (boss) requested' });
              initPSBattleWithTeams(room).catch(e=> console.warn('PS battle init failed:', e));
            }
            return;
          } else {
            // 1v1: create room immediately
            const accepter = { id: meta.clientId, name: meta.username || 'Player', avatar: meta.avatar || null, teamText: (msg.d && msg.d.teamText) || '' };
            const chWs = clientsById.get(ch.fromId);
            const chMeta = chWs ? (wsMeta.get(chWs) || {}) : {};
            const challenger = { id: ch.fromId, name: ch.from, avatar: chMeta.avatar || null, teamText: ch.teamText || '' };
            const roomId = 'r_'+Math.random().toString(36).slice(2,8);
            const room = { id: roomId, name: ch.format+' • '+ch.teamName, format: ch.format, players:[challenger, accepter], spectators:[], allowedIds:[challenger.id, accepter.id], status:'started' };
            rooms.push(room);
            challenges = challenges.filter(c => c.id !== id);
            syncChallenges();
            sendAll('rooms', rooms);
            sendAll('room-start', { roomId: room.id, name: room.name, format: room.format, players: room.players });
            sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'init battle (singles) requested' });
            initPSBattleWithTeams(room).catch(e=> console.warn('PS battle init failed:', e));
            return;
          }
      }
      if (msg.t === 'room-join') {
        const roomId = (msg.d && msg.d.roomId) || '';
        const r = rooms.find(r => r.id === roomId);
        if (!r) return;
        // Restrict to intended players if specified
        if (r.allowedIds && !r.allowedIds.includes(meta.clientId)) {
          return; // only allowed players can join
        }
        // ensure not already a player
        if (!r.players.find(p => p.id === meta.clientId)) {
          r.players.push({ id: meta.clientId, name: meta.username || 'Player', avatar: meta.avatar || null });
        }
        // remove from spectators if present
        if (Array.isArray(r.spectators)) r.spectators = r.spectators.filter(s => s.id !== meta.clientId);
        r.status = r.status || 'started';
        sendAll('rooms', rooms);
        return;
      }
      if (msg.t === 'room-leave') {
        const roomId = (msg.d && msg.d.roomId) || '';
        const r = rooms.find(r => r.id === roomId);
        if (!r) return;
        r.players = (r.players || []).filter(p => p.id !== meta.clientId);
        r.spectators = (r.spectators || []).filter(s => s.id !== meta.clientId);
        if (r.ready) delete r.ready[meta.clientId];
        // remove empty rooms (no players and no spectators)
        rooms = rooms.filter(x => x.id !== roomId || (x.players && x.players.length) || (x.spectators && x.spectators.length));
        sendAll('rooms', rooms);
        return;
      }
      if (msg.t === 'room-spectate') {
        const roomId = (msg.d && msg.d.roomId) || '';
        const r = rooms.find(r => r.id === roomId);
        if (!r) return;
        // ensure not already spectator
        r.spectators = r.spectators || [];
        if (!r.spectators.find(s => s.id === meta.clientId)) {
          // also ensure not currently a player
          r.players = (r.players || []).filter(p => p.id !== meta.clientId);
          r.spectators.push({ id: meta.clientId, name: meta.username || 'Player', avatar: meta.avatar || null });
        }
        if (r.ready) delete r.ready[meta.clientId];
        sendAll('rooms', rooms);
        return;
      }
      // room-ready no longer required; ignore gracefully
    });
    ws.on('close', () => {
      const meta = wsMeta.get(ws);
      if (meta && meta.clientId && clientsById.get(meta.clientId) === ws) {
        clientsById.delete(meta.clientId);
      }
      // Remove this client's challenges
      if (meta && meta.clientId) {
        const before = challenges.length;
        challenges = challenges.filter(c => c.fromId !== meta.clientId);
        if (challenges.length !== before) syncChallenges();
        // Remove from any rooms (players/spectators) and clean up empty rooms
        rooms.forEach(r => {
          r.players = (r.players || []).filter(p => p.id !== meta.clientId);
          r.spectators = (r.spectators || []).filter(s => s.id !== meta.clientId);
          if (r.ready) delete r.ready[meta.clientId];
        });
        rooms = rooms.filter(r => (r.players && r.players.length) || (r.spectators && r.spectators.length));
        sendAll('rooms', rooms);
      }
      broadcastRoster();
    });
  });

  // Start UDP beacon for discovery
  try {
    udpBeacon = dgram.createSocket('udp4');
    udpBeacon.bind(() => {
      try { udpBeacon.setBroadcast(true); } catch {}
    });
    const name = (opts && opts.name) || os.hostname?.() || 'Host';
    const sendBeacon = () => {
      const payload = Buffer.from(JSON.stringify({ t:'pokettrpg-host', name, port }));
      try { udpBeacon.send(payload, 0, payload.length, 17647, '255.255.255.255'); } catch {}
    };
    udpBeaconTimer = setInterval(sendBeacon, 2000);
    // respond to targeted pings
    udpBeacon.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(String(msg));
        if (data && data.t === 'pokettrpg-ping') {
          const payload = Buffer.from(JSON.stringify({ t:'pokettrpg-host', name, port }));
          udpBeacon.send(payload, 0, payload.length, rinfo.port, rinfo.address);
        }
      } catch {}
    });
  } catch (e) {
    console.warn('UDP beacon failed:', e);
  }
  return { ok: true, port };
});

ipcMain.handle('lan:stop', async () => {
  if (wss) {
    wss.close(); wss = null;
  }
  if (wssHttp) {
    await new Promise(r => wssHttp.close(r));
    wssHttp = null;
  }
  if (udpBeaconTimer) { clearInterval(udpBeaconTimer); udpBeaconTimer = null; }
  if (udpBeacon) { try { udpBeacon.close(); } catch {} udpBeacon = null; }
  rooms = [];
  challenges = [];
  chatLog.length = 0;
  return { ok: true };
});

// Provide buffered omni lines so a viewer can resync after remounting
ipcMain.handle('lan:room:buffer', async (_e, { roomId }) => {
  try {
    const arr = roomLogs.get(roomId) || [];
    return { ok: true, lines: arr.slice(-400) };
  } catch (e) {
    return { ok: false, error: String(e), lines: [] };
  }
});

ipcMain.handle('lan:send', async (_ev, { t, d }) => {
  try {
    // Handle a subset of commands locally when sent from the host UI
    if (t === 'chat') {
      const text = (d && d.text) || '';
      sendAll('chat', { from: 'host', text });
      return { ok: true };
    }
    if (t === 'challenge-create') {
      const id = d && d.id;
      if (!id) return { ok: false, error: 'no-id' };
      // Remove previous host challenge and add new
      challenges = challenges.filter(c => c.fromId !== 'host');
      const isBoss = typeof (d && d.format) === 'string' && /boss/i.test((d && d.format) || '');
      challenges.push({ id, fromId: 'host', from: (d && d.from) || 'Host', toId: d && d.toId || null, format: d && d.format || 'Singles', teamName: d && d.teamName || 'Random', teamText: d && d.teamText || '', fighters: isBoss ? [] : undefined });
      syncChallenges();
      return { ok: true };
    }
    if (t === 'room-chat') {
      const roomId = d && d.roomId;
      const text = (d && d.text) || '';
      if (!roomId || !text) return { ok: false, error: 'bad-request' };
      const r = rooms.find(r => r.id === roomId);
      if (!r) return { ok: false, error: 'no-room' };
      sendAll('room-chat', { roomId, from: (d && d.from) || 'host', text });
      return { ok: true };
    }
    if (t === 'challenge-cancel') {
      const id = d && d.id;
      const before = challenges.length;
      challenges = challenges.filter(c => c.id !== id || c.fromId !== 'host');
      if (challenges.length !== before) syncChallenges();
      return { ok: true };
    }
    if (t === 'challenge-accept') {
      const id = d && d.id;
      const ch = challenges.find(c => c.id === id);
      if (!ch) return { ok: false, error: 'no-challenge' };
      // Prevent host from accepting host's own challenge
      if (ch.fromId === 'host') return { ok: false, error: 'self-accept' };
      const isBoss = typeof ch.format === 'string' && /boss/i.test(ch.format || '');
      if (isBoss) {
        ch.fighters = ch.fighters || [];
        // Host joins as a fighter
        if (!ch.fighters.find(f => f.id === 'host')) {
          ch.fighters.push({ id: 'host', name: 'Host', avatar: null, teamText: (d && d.teamText) || '' });
        }
        syncChallenges();
        if (ch.fighters.length >= 3) {
          const boss = { id: ch.fromId, name: ch.from, avatar: null, teamText: ch.teamText || '' };
          const fighters = ch.fighters.slice(0,3);
          const roomId = 'r_'+Math.random().toString(36).slice(2,8);
          const slots = { p1a: fighters[0].id, p1b: fighters[1].id, p1c: fighters[2].id };
          const room = { id: roomId, name: ch.format+' • '+ch.teamName, format: ch.format, players:[fighters[0], boss, fighters[1], fighters[2]], spectators:[], allowedIds:[boss.id, ...fighters.map(f=>f.id)], status:'started', mode:'boss', bossSide:'p2', slots, meta:{ boss, fighters } };
          rooms.push(room);
          challenges = challenges.filter(c => c.id !== id);
          syncChallenges();
          sendAll('rooms', rooms);
          sendAll('room-start', { roomId: room.id, name: room.name, format: room.format, players: room.players, mode:'boss', slots });
          sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'init battle (boss/host) requested' });
          initPSBattleWithTeams(room).catch(e=> console.warn('PS battle init failed:', e));
        }
        return { ok: true };
      } else {
        // 1v1: create room immediately
        const challenger = { id: ch.fromId, name: ch.from, avatar: null, teamText: ch.teamText || '' };
        const accepter = { id: 'host', name: 'Host', avatar: null, teamText: (d && d.teamText) || '' };
        const roomId = 'r_'+Math.random().toString(36).slice(2,8);
        const room = { id: roomId, name: ch.format+' • '+ch.teamName, format: ch.format, players:[challenger, accepter], spectators:[], allowedIds:[challenger.id, accepter.id], status:'started' };
        rooms.push(room);
        challenges = challenges.filter(c => c.id !== id);
        syncChallenges();
  sendAll('rooms', rooms);
  sendAll('room-start', { roomId: room.id, name: room.name, format: room.format, players: room.players });
  sendAll('room-debug', { roomId: room.id, where: 'engine', msg: 'init battle (singles/host) requested' });
        initPSBattleWithTeams(room).catch(e=> console.warn('PS battle init failed:', e));
        return { ok: true };
      }
    }
  } catch (e) {
    console.warn('lan:send error', e);
  }
  // default: broadcast for connected clients
  broadcast(t, d);
  return { ok: true };
});

// Discovery listener for clients
ipcMain.handle('lan:discover:start', async () => {
  if (udpDiscover) return { ok: true };
  udpDiscover = dgram.createSocket('udp4');
  udpDiscover.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(String(msg));
      if (data && data.t === 'pokettrpg-host') {
        if (mainWindow) mainWindow.webContents.send('lan:host-found', { ip: rinfo.address, port: data.port, name: data.name });
      }
    } catch {}
  });
  await new Promise((resolve, reject) => {
    udpDiscover.once('error', reject);
    udpDiscover.bind(17647, '0.0.0.0', resolve);
  });
  return { ok: true };
});

ipcMain.handle('lan:discover:stop', async () => {
  if (udpDiscover) { try { udpDiscover.close(); } catch {} udpDiscover = null; }
  return { ok: true };
});

// (updater IPC removed)

ipcMain.handle('lan:discover:ping', async () => {
  try {
    const sock = dgram.createSocket('udp4');
    await new Promise(res => sock.bind(() => { try { sock.setBroadcast(true); } catch {}; res(); }));
    const payload = Buffer.from(JSON.stringify({ t:'pokettrpg-ping' }));
    sock.send(payload, 0, payload.length, 17647, '255.255.255.255', () => { try { sock.close(); } catch {} });
  } catch {}
  return { ok: true };
});

ipcMain.handle('lan:info', async () => {
  const nets = os.networkInterfaces?.() || os.networkInterfaces();
  const addrs = [];
  for (const key of Object.keys(nets)) {
    for (const n of nets[key] || []) {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    }
  }
  return { ok: true, addresses: addrs, port: wssHttp?.address()?.port || null };
});

// Provide a snapshot of current lobby state for hydration after tab remounts
ipcMain.handle('lan:state', async () => {
  try {
    return {
      ok: true,
      rooms,
      challenges,
      roster: roster(),
      chat: chatLog.slice(-200),
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('assets:list-trainers', async () => {
  try {
    // Use the same root we use to serve /showdown
    const distDir = app.isPackaged
      ? path.join(app.getAppPath(), 'dist')
      : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    const showdownRoot = resolveShowdownRoot(distDir);
    const dir = path.join(showdownRoot, 'sprites', 'trainers');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.png')).map(e => e.name.replace(/\.png$/i, ''));
    return { ok: true, list: files.sort() };
  } catch (e) {
    return { ok: false, error: String(e), list: [] };
  }
});
