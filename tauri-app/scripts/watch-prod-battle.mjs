/**
 * watch-prod-battle.mjs
 *
 * Attaches a raw socket.io listener to the production backend and prints
 * EVERY event it receives. Use this to observe a real battle while someone
 * drives the controls in the browser.
 *
 * Usage:
 *   cd tauri-app
 *   node scripts/watch-prod-battle.mjs [--room <roomId>] [--name Watcher]
 *
 * Without --room it lists active rooms (via /api/rooms) and watches the lobby,
 * printing any newly created/updated rooms so you can spot your battle's ID.
 */

import { io } from 'socket.io-client';

const BASE = process.env.POKETTRPG_BASE || 'https://pokettrpg-app.pokemondnd.xyz';
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const ROOM = getArg('--room');
const NAME = getArg('--name') || 'ProtocolWatcher';
const USER_ID = `watcher-${Date.now().toString(36)}`;

const ts = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(`[${ts()}]`, ...a);

function highlight(event, payload) {
  const s = JSON.stringify(payload);
  if (!s) return '';
  if (/nopp/.test(s)) return '  ⚠️ NOPP DETECTED';
  return '';
}

function printInteresting(event, payload) {
  const events =
    payload?.result?.events ||
    payload?.state?.log ||
    payload?.log ||
    payload?.messages;
  if (!Array.isArray(events)) return;
  const interesting = events.filter((l) =>
    /\|cant\||nopp|\|move\|/.test(String(l))
  );
  if (interesting.length) {
    for (const line of interesting) log('   ↳', line);
  }
}

// ── List rooms over REST first ──
try {
  const res = await fetch(`${BASE}/api/rooms`);
  const rooms = await res.json();
  log('=== ACTIVE ROOMS ===');
  for (const r of rooms) {
    log(
      `  ${r.id}  "${r.name}"  type=${r.roomType || 'battle'}  players=${(r.players || []).length}  started=${!!(r.battleStarted ?? r.started)}`
    );
  }
  if (!rooms.length) log('  (none)');
} catch (e) {
  log('Failed to list rooms:', e.message);
}

const socket = io(BASE, {
  transports: ['polling'],
  upgrade: false,
  path: '/socket.io',
  forceNew: true,
  withCredentials: false,
});

socket.on('connect', () => {
  log('CONNECTED', socket.id);
  socket.emit('identify', { username: NAME, userId: USER_ID });
  if (ROOM) {
    log(`Joining room "${ROOM}" as spectator…`);
    socket.emit('joinRoom', { roomId: ROOM, role: 'spectator' });
  }
});

socket.on('identified', (user) => {
  log('IDENTIFIED as', JSON.stringify(user));
});

// Log literally every other event
socket.onAny((event, ...payloads) => {
  if (event === 'identified') return;
  const payload = payloads.length === 1 ? payloads[0] : payloads;
  try {
    console.log(
      `\n[${ts()}] 📨 ${event}`,
      JSON.stringify(payload).slice(0, 500),
      highlight(event, payload)
    );
    printInteresting(event, payload);
  } catch {
    console.log(`[${ts()}] 📨 ${event} (unserializable)`);
  }
});

socket.on('disconnect', (reason) => log('DISCONNECTED:', reason));
socket.on('connect_error', (err) => log('CONNECT ERROR:', err.message));

log(`Watcher running against ${BASE}${ROOM ? ` (room ${ROOM})` : ' (lobby only)'}`);
log('Press Ctrl+C to stop.');
