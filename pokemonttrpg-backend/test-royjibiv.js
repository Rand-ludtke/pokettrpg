/**
 * Verification: Royjibiv's Spectrum ability + Prism Beam move.
 * Run: node test-royjibiv.js
 */
const ps = require('pokemon-showdown');
require('./dist/sync-ps-engine.js');
const { SyncPSEngine } = require('./dist/sync-ps-engine');

const Dex = ps.Dex;

// ── 1. Dex-level checks ──
const s = Dex.species.get('Royjibiv');
console.log(`[dex] royjibiv: exists=${s.exists} types=${JSON.stringify(s.types)} color=${JSON.stringify(s.color)} abilities=${JSON.stringify(s.abilities)}`);
const raw = Dex.data.Pokedex['royjibiv'] || {};
console.log(`[dex] raw royjibiv color field: ${JSON.stringify(raw.color)}`);
const mv = Dex.moves.get('prismbeam');
console.log(`[dex] prismbeam: exists=${mv.exists} type=${mv.type} bp=${mv.basePower} cat=${mv.category} hasOnModifyType=${typeof Dex.data.Moves['prismbeam'].onModifyType === 'function'}`);
const ab = Dex.data.Abilities['spectrum'];
console.log(`[dex] spectrum: exists=${!!ab} onAnySwitchIn=${typeof ab.onAnySwitchIn} onUpdate=${typeof ab.onUpdate}`);

// ── 2. Battle behavior: Spectrum should recolor vs foe colors; Prism Beam should shift type ──
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
    stats: p.stats || { hp: 300, atk: 150, def: 150, spa: 150, spd: 150, spe: 150 },
    maxHP: p.stats?.hp || 300,
    currentHP: p.stats?.hp || 300,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'M',
  };
}

function battleVs(foeName, foeColor) {
  const engine = new SyncPSEngine({ seed: 42 });
  const state = engine.initializeBattle([
    {
      id: 'p1', name: 'Player1',
      team: [makeMon({ name: 'Royjibiv', species: 'Royjibiv', ability: 'Spectrum', types: ['Normal', 'Dragon'], moves: ['Prism Beam'] })],
    },
    {
      id: 'p2', name: 'Player2',
      team: [makeMon({ name: foeName, ability: 'Pressure', types: ['Normal'], moves: ['Tackle'], stats: { hp: 500, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 } })],
    },
  ], { seed: 42, autoTeamPreview: true });

  const allEvents = state.log || [];
  const typeChanges = allEvents.filter(l => l.includes('typechange'));
  const engine_ = engine;
  // Get the live PS pokemon via the engine's battle for type inspection
  const side = engine_.battle.sides.find(sd => sd.id === 'p1');
  const roy = side.active[0];
  console.log(`[battle vs ${foeName} (color=${foeColor})]: royjibiv types=${JSON.stringify(roy.getTypes())} | typechange msgs=${JSON.stringify(typeChanges)}`);
  // Prism Beam type check
  const t1 = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'prismbeam', pokemonId: 'royjibiv' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'tackle', pokemonId: foeName.toLowerCase() },
  ]);
  const beamLine = (t1.events || []).find(l => l.startsWith('|move|') && l.includes('Prism Beam'));
  const effLine = (t1.events || []).find(l => l.startsWith('|-supereffective|') || l.startsWith('|-resisted|'));
  console.log(`  beam line: ${beamLine || 'NONE'} | effectiveness: ${effLine || 'neutral'}`);
  return { roy, allEvents };
}

console.log('\n=== Spectrum vs Charizard (color Red -> Fire) ===');
battleVs('Charizard', 'Red');
console.log('\n=== Spectrum vs Gengar (color Purple -> Poison) ===');
battleVs('Gengar', 'Purple');
console.log('\n=== Spectrum vs Umbreon (color Black -> Dark) ===');
battleVs('Umbreon', 'Black');
console.log('\nDONE');
