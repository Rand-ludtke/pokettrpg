/**
 * Verification: Deep Cold Shard item + Ice Burn (Custom) move + frostbite status.
 * Run: node test-deepcold.js
 *
 * Checks:
 *  1. Deep Cold Shard: Ice move damage with the shard = without + 20 BP worth
 *  2. Ice Burn (Custom): fires 180 BP, user must recharge next turn
 *  3. Status split: ~50% burn / ~50% frostbite across seeds
 *  4. Frostbite: 1/8 max HP per turn + Special Attack halved
 */
const ps = require('pokemon-showdown');
require('./dist/sync-ps-engine.js');
const { SyncPSEngine } = require('./dist/sync-ps-engine');

const Dex = ps.Dex;
console.log(`[dex] deepcoldshard: exists=${!!Dex.data.Items['deepcoldshard']} onBasePower=${typeof (Dex.data.Items['deepcoldshard'] || {}).onBasePower}`);
console.log(`[dex] iceburncustom: exists=${Dex.moves.get('iceburncustom').exists} type=${Dex.moves.get('iceburncustom').type} bp=${Dex.moves.get('iceburncustom').basePower} pp=${Dex.moves.get('iceburncustom').pp} acc=${Dex.moves.get('iceburncustom').accuracy}`);
const frb = Dex.data.Conditions['frb'];
console.log(`[dex] frostbite: exists=${!!frb} effectType=${frb && frb.effectType} onResidual=${typeof (frb && frb.onResidual)} onModifySpA=${typeof (frb && frb.onModifySpA)}`);

function makeMon(p) {
  return {
    id: p.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    name: p.name,
    species: p.species || p.name,
    level: p.level || 50,
    types: p.types,
    ability: p.ability || 'Pressure',
    item: p.item || '',
    moves: p.moves.map(m => ({ id: m.toLowerCase().replace(/\s+/g, ''), name: m })),
    stats: p.stats || { hp: 300, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    maxHP: p.stats?.hp || 300,
    currentHP: p.stats?.hp || 300,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'M',
  };
}

function damageOf(events, sideId) {
  const lines = (events || []).filter(l => l.startsWith(`|-damage|${sideId}`));
  return lines.map(l => {
    const m = l.match(/\|(\d+)\/(\d+)/);
    return m ? Number(m[1]) : null;
  });
}

// ── 1. Deep Cold Shard: +20 BP on Ice moves ──
// NOTE: target must be an UNKNOWN species so ensureSpeciesRegistered applies
// the app stats (2000 HP) — known species use their real dex stats and would
// be OHKO'd, capping the measurable damage.
const ITEM_TARGET = { name: 'Icetank', species: 'Icetank', ability: 'Pressure', types: ['Dragon', 'Flying'], moves: ['Splash'], stats: { hp: 2000, atk: 50, def: 100, spa: 50, spd: 100, spe: 50 } };

function runItemBattle(seed, withItem) {
  const engine = new SyncPSEngine({ seed });
  engine.initializeBattle([
    { id: 'p1', name: 'P1', team: [makeMon({ name: 'Mamoswine', species: 'Mamoswine', ability: 'Thick Fat', types: ['Ice', 'Ground'], item: withItem ? 'Deep Cold Shard' : '', moves: ['Ice Beam'], stats: { hp: 300, atk: 100, def: 100, spa: 60, spd: 100, spe: 100 } })] },
    { id: 'p2', name: 'P2', team: [makeMon(ITEM_TARGET)] },
  ], { seed, autoTeamPreview: true });
  const res = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'icebeam', pokemonId: 'mamoswine' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'splash', pokemonId: 'icetank' },
  ]);
  const foe = engine.battle.sides.find(s => s.id === 'p2').active[0];
  return foe ? foe.maxhp - foe.hp : null;
}

console.log('\n=== Deep Cold Shard: Ice Beam damage with vs without (same seed) ===');
const dmgNo = runItemBattle(42, false);
const dmgWith = runItemBattle(42, true);
console.log(`  no item: ${dmgNo} dmg | with shard: ${dmgWith} dmg | delta: ${dmgWith != null && dmgNo != null ? dmgWith - dmgNo : '?'}`);
// one more seed pair for confidence
const dmgNo2 = runItemBattle(77, false);
const dmgWith2 = runItemBattle(77, true);
console.log(`  seed 77: no item: ${dmgNo2} | with: ${dmgWith2} | delta: ${dmgWith2 != null && dmgNo2 != null ? dmgWith2 - dmgNo2 : '?'}`);

// Control: canonical Never-Melt Ice (+20% Ice) — does ANY item change damage here?
const engineCtl = new SyncPSEngine({ seed: 42 });
engineCtl.initializeBattle([
  { id: 'p1', name: 'P1', team: [makeMon({ name: 'Mamoswine', species: 'Mamoswine', ability: 'Thick Fat', types: ['Ice', 'Ground'], item: 'Never-Melt Ice', moves: ['Ice Beam'], stats: { hp: 300, atk: 100, def: 100, spa: 60, spd: 100, spe: 100 } })] },
  { id: 'p2', name: 'P2', team: [makeMon(ITEM_TARGET)] },
], { seed: 42, autoTeamPreview: true });
engineCtl.processTurn([
  { type: 'move', actorPlayerId: 'p1', moveId: 'icebeam', pokemonId: 'mamoswine' },
  { type: 'move', actorPlayerId: 'p2', moveId: 'splash', pokemonId: 'icetank' },
]);
const ctlFoe = engineCtl.battle.sides.find(s => s.id === 'p2').active[0];
console.log(`  control (Never-Melt Ice): ${ctlFoe.maxhp - ctlFoe.hp} dmg (expect ~${Math.round(dmgNo * 1.2)} if item handlers work)`);

// ── 2-4. Ice Burn (Custom): recharge, 50/50 status, frostbite mechanics ──
function runIceBurn(seed) {
  const engine = new SyncPSEngine({ seed });
  engine.initializeBattle([
    { id: 'p1', name: 'P1', team: [makeMon({ name: 'Kyurem-Cust', species: 'Kyurem', ability: 'Pressure', types: ['Ice', 'Dragon'], moves: ['Ice Burn (Custom)'] })] },
    { id: 'p2', name: 'P2', team: [makeMon({ name: 'Tankmon', species: 'Tankmon', ability: 'Pressure', types: ['Normal'], moves: ['Splishy Splash'], stats: { hp: 2000, atk: 50, def: 100, spa: 50, spd: 100, spe: 50 } })] },
  ], { seed, autoTeamPreview: true });
  const res = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'iceburncustom', pokemonId: 'kyurem' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'splishysplash', pokemonId: 'tankmon' },
  ]);
  const statusLine = (res.events || []).find(l => l.startsWith('|-status|p2a'));
  const foe = engine.battle.sides.find(s => s.id === 'p2').active[0];
  const me = engine.battle.sides.find(s => s.id === 'p1').active[0];
  // next turn: attacker must recharge
  const res2 = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'iceburncustom', pokemonId: 'kyurem' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'splishysplash', pokemonId: 'tankmon' },
  ]);
  const recharge = (res2.events || []).find(l => l.startsWith('|cant|') && l.includes('recharge'));
  return { statusLine, status: foe.status || 'none', foeHp: foe.hp, foeMax: foe.maxhp, recharged: !!recharge, me };
}

console.log('\n=== Ice Burn (Custom): 8 seeds — status split + recharge ===');
const counts = { brn: 0, frb: 0, none: 0 };
for (let seed = 1; seed <= 8; seed++) {
  const r = runIceBurn(seed);
  counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(`  seed ${seed}: status=${r.status} | line=${r.statusLine || 'none'} | recharge next turn=${r.recharged}`);
}
console.log(`  status distribution: ${JSON.stringify(counts)}`);

// ── 4. Frostbite: 1/8 per turn + SpA halved at damage-calc time ──
console.log('\n=== Frostbite mechanics detail (seed 2 = frostbite roll) ===');
{
  const engine = new SyncPSEngine({ seed: 2 });
  engine.initializeBattle([
    { id: 'p1', name: 'P1', team: [makeMon({ name: 'Kyurem-Cust', species: 'Kyurem', ability: 'Pressure', types: ['Ice', 'Dragon'], moves: ['Ice Burn (Custom)'] })] },
    { id: 'p2', name: 'P2', team: [makeMon({ name: 'Tankmon', species: 'Tankmon', ability: 'Pressure', types: ['Normal'], moves: ['Splishy Splash'], stats: { hp: 2000, atk: 50, def: 100, spa: 200, spd: 100, spe: 50 } })] },
  ], { seed: 2, autoTeamPreview: true });
  engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'iceburncustom', pokemonId: 'kyurem' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'splishysplash', pokemonId: 'tankmon' },
  ]);
  const foe = engine.battle.sides.find(s => s.id === 'p2').active[0];
  console.log(`  status after Ice Burn: ${foe.status} (expect frostbite)`);
  // After the recharge turn resolves, the frostbitten mon should lose exactly
  // 1/8 of max HP (259 of 2075) at each turn end. p1's choice fails during the
  // recharge turn (engine falls back to the forced recharge); afterwards it
  // keeps using Ice Burn. p2's own HP only changes via the frostbite residual.
  let prev = foe.hp;
  for (let t = 0; t < 4; t++) {
    engine.processTurn([
      { type: 'move', actorPlayerId: 'p1', moveId: 'iceburncustom', pokemonId: 'kyurem' },
      { type: 'move', actorPlayerId: 'p2', moveId: 'splishysplash', pokemonId: 'tankmon' },
    ]);
    const cur = engine.battle.sides.find(s => s.id === 'p2').active[0].hp;
    const dropped = prev - cur;
    console.log(`  post-burn turn ${t + 1}: HP ${prev} -> ${cur} (drop ${dropped}, 1/8 of max = ${Math.floor(foe.maxhp / 8)})`);
    prev = cur;
  }
  console.log(`  frostbite handler present: onResidual=${typeof (Dex.data.Conditions['frb'] || {}).onResidual}, onModifySpA=${typeof (Dex.data.Conditions['frb'] || {}).onModifySpA} (SpA halving applies at damage-calc time, mirroring burn's Attack halving)`);
}

console.log('\nDONE');
