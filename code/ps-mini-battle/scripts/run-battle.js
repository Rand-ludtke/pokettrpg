#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';
import ps from 'pokemon-showdown';
// ps exports CommonJS; in ESM we access default and destructure
const {BattleStream, getPlayerStreams, Teams, PRNG} = ps;

// Contract:
// Inputs (via data/test-config.json):
// - format (e.g., 'gen9randombattle' or 'gen7customgame')
// - p1.name, p2.name (usernames)
// - teams.p1, teams.p2 (packed team or JSON array of sets)
// - seed (string like 'gen5,1,2,3,4' or array [1,2,3,4])
// Output: output/battle-log.json { log: string[], format, players, seed }

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'output');
const dataDir = path.join(root, 'data');

function ensureDir(p) { fs.mkdirSync(p, {recursive: true}); }
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function packIfNeeded(team) {
  if (!team) return null;
  if (typeof team === 'string') return team;
  return Teams.pack(team);
}

function normalizeSeed(seed) {
  if (!seed) return PRNG.generateSeed();
  if (Array.isArray(seed)) return PRNG.convertSeed(seed);
  return seed; // assume already PRNGSeed string
}

function makeRandomChoice(req) {
  // Singles-only naive random chooser
  if (req.teamPreview) {
    // Choose default order
    return 'team default';
  }
  if (req.forceSwitch) {
    // find first available bench slot to switch in
    const choices = [];
    for (let i = 0; i < req.forceSwitch.length; i++) {
      if (!req.forceSwitch[i]) continue; // not forced for this slot
      const bench = req.side.pokemon
        .map((p, idx) => ({idx: idx + 1, active: p.active, condition: p.condition}))
        .filter(p => !p.active && !String(p.condition).startsWith('0'));
      const sw = bench.length ? `switch ${bench[0].idx}` : 'pass';
      choices.push(sw);
    }
    return choices.join(', ');
  }
  if (req.active && req.active.length) {
    const choices = [];
    for (const slot of req.active) {
      const legalMoves = (slot.moves || []).filter(m => !m.disabled);
      const moveIdx = legalMoves.length ? (1 + Math.floor(Math.random() * legalMoves.length)) : 1;
      choices.push(`move ${moveIdx}`);
    }
    return choices.join(', ');
  }
  return 'pass';
}

async function run() {
  ensureDir(outputDir);
  const cfgPath = path.join(dataDir, 'test-config.json');
  const cfg = fs.existsSync(cfgPath) ? readJSON(cfgPath) : {
    format: 'gen9randombattle',
    p1: {name: 'Red'},
    p2: {name: 'Blue'},
  };

  const format = cfg.format || 'gen9randombattle';
  const seed = normalizeSeed(cfg.seed);
  const p1name = cfg.p1?.name || 'Player 1';
  const p2name = cfg.p2?.name || 'Player 2';

  // Teams
  let p1team = packIfNeeded(cfg.teams?.p1);
  let p2team = packIfNeeded(cfg.teams?.p2);
  if (!p1team || !p2team) {
    const t1 = Teams.generate(format);
    const t2 = Teams.generate(format);
    p1team = Teams.pack(t1);
    p2team = Teams.pack(t2);
  }

  console.log('[mini-battle] starting with format', format);
  const stream = new BattleStream({debug: true});
  const {omniscient, spectator, p1, p2} = getPlayerStreams(stream);

  const spec = {formatid: format, seed};
  await omniscient.write(`>start ${JSON.stringify(spec)}`);
  await omniscient.write(`>player p1 ${JSON.stringify({name: p1name, team: p1team})}`);
  await omniscient.write(`>player p2 ${JSON.stringify({name: p2name, team: p2team})}`);
  console.log('[mini-battle] players registered');

  // Simple bots: listen to requests and choose
  (async () => {
    for await (const chunk of p1) {
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('|')) continue;
        const [cmd, rest] = line.slice(1).split('|', 2);
        if (cmd === 'request') {
          const req = JSON.parse(rest);
          const choice = makeRandomChoice(req);
          await p1.write(choice);
        }
        if (cmd === 'error') console.error('[p1 error]', rest);
      }
    }
  })();

  (async () => {
    for await (const chunk of p2) {
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('|')) continue;
        const [cmd, rest] = line.slice(1).split('|', 2);
        if (cmd === 'request') {
          const req = JSON.parse(rest);
          const choice = makeRandomChoice(req);
          await p2.write(choice);
        }
        if (cmd === 'error') console.error('[p2 error]', rest);
      }
    }
  })();

  // Collect spectator log lines
  const log = [];
  let ended = false;
  const done = (async () => {
    for await (const chunk of spectator) {
      const [type, data] = String(chunk).split('\n', 2);
      if (type === 'end') { ended = true; break; }
      const lines = String(chunk).split('\n').filter(l => l.startsWith('|'));
      log.push(...lines);
    }
  })();

  // Safety timeout in case of unexpected hang
  const timeoutMs = 15000;
  await Promise.race([
    done,
    new Promise(res => setTimeout(res, timeoutMs))
  ]);

  const outPath = path.join(outputDir, 'battle-log.json');
  const spectators = Array.isArray(cfg.spectators) ? cfg.spectators : [];
  fs.writeFileSync(outPath, JSON.stringify({log, seed, format, players: [p1name, p2name], spectators}, null, 2));
  console.log(`[mini-battle] ${ended ? 'Finished' : 'Timed out'}; wrote ${outPath} with ${log.length} lines.`);
}

run().catch(err => { console.error(err); process.exit(1); });
