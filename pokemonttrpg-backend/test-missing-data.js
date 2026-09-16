/**
 * Repro test 3: engine behavior with species/moves missing from its dex
 * (chandelureorionmega + gammarray) at L50 vs L150 — is the L150 "crash" data-related?
 */
const { SyncPSEngine } = require('./dist/sync-ps-engine');

function makeMon(p) {
  return {
    id: p.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    name: p.name,
    species: p.species || p.name,
    level: p.level || 50,
    types: p.types || ['Normal'],
    ability: p.ability || 'Pressure',
    item: p.item || '',
    moves: p.moves.map(m => ({ id: m.toLowerCase().replace(/\s+/g, ''), name: m })),
    stats: p.stats || { hp: 300, atk: 150, def: 150, spa: 150, spd: 150, spe: 100 },
    maxHP: p.stats?.hp || 300,
    currentHP: p.stats?.hp || 300,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'M',
  };
}

async function runCase(label, level) {
  console.log(`\n===== ${label} (L${level}) =====`);
  const players = [
    {
      id: 'p1', name: 'DR.NOCHT',
      team: [
        makeMon({ name: 'Chandelure-Orion-Mega', species: 'Chandelure-Orion-Mega', ability: 'Ethereal', level,
          moves: ['Photon Geyser', 'Gamma Ray'], stats: { hp: 392, atk: 150, def: 160, spa: 320, spd: 250, spe: 230 } }),
        makeMon({ name: 'Greninja-Orion', species: 'Greninja-Orion', ability: 'Protean', level,
          moves: ['Ice Beam', 'Dark Pulse'] }),
      ],
    },
    {
      id: 'p2', name: 'Revel',
      team: [
        makeMon({ name: 'Milotic-Orion', species: 'Milotic-Orion', ability: 'Cute Charm', level,
          moves: ['Gamma Ray', 'Surf'] }),
      ],
    },
  ];
  try {
    const engine = new SyncPSEngine({ seed: 42 });
    const state = engine.initializeBattle(players, { seed: 42, autoTeamPreview: true });
    const chande = state.players[0].team[0];
    console.log(`  init OK. Chandelure-Orion-Mega: HP=${chande.currentHP}/${chande.maxHP} (app stats said hp=392)`);
    const t1 = engine.processTurn([
      { type: 'move', actorPlayerId: 'p1', moveId: 'photongeyser', pokemonId: 'chandelure' },
      { type: 'move', actorPlayerId: 'p2', moveId: 'gammarray', pokemonId: 'milotic' },
    ]);
    console.log('  turn1 events:', JSON.stringify(t1.events.slice(0, 14)));
    const req1 = engine.getRequest('p1');
    console.log('  p1 request after turn:', req1 ? 'valid' : 'NULL *** soft-lock');
  } catch (err) {
    console.log('  *** THREW ***');
    console.log('    ' + String(err && err.stack || err).split('\n').slice(0, 8).join('\n    '));
  }
}

(async () => {
  await runCase('missing mega species + missing move', 50);
  await runCase('missing mega species + missing move', 150);
})();
