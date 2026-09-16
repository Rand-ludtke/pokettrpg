/**
 * Repro test 4: what happens when a team contains a move the engine dex doesn't know?
 * (User's L150 campaign mons carry the newest pokeathlon-era customs the server never loads.)
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

async function runCase(label, level, moves) {
  console.log(`\n===== ${label} (L${level}) =====`);
  const players = [
    {
      id: 'p1', name: 'Player1',
      team: [
        makeMon({ name: 'Testmon', species: 'Testmon', ability: 'TestAbilityNope', level, moves }),
      ],
    },
    {
      id: 'p2', name: 'Player2',
      team: [makeMon({ name: 'Snorlax', level, moves: ['Body Slam'] })],
    },
  ];
  try {
    const engine = new SyncPSEngine({ seed: 42 });
    const state = engine.initializeBattle(players, { seed: 42, autoTeamPreview: true });
    console.log('  init OK, active:', state.players[0].team[state.players[0].activeIndex]?.name);
    const req = engine.getRequest('p1');
    console.log('  p1 request:', req ? `valid moves=${JSON.stringify((req.active?.[0]?.moves || []).map(m => m.id))}` : 'NULL *** battle dead at start');
    const t1 = engine.processTurn([
      { type: 'move', actorPlayerId: 'p1', moveId: moves[0], pokemonId: 'testmon' },
      { type: 'move', actorPlayerId: 'p2', moveId: 'bodyslam', pokemonId: 'snorlax' },
    ]);
    console.log('  turn1 events:', JSON.stringify(t1.events.slice(0, 10)));
  } catch (err) {
    console.log('  *** THREW ***');
    console.log('    ' + String(err && err.stack || err).split('\n').slice(0, 8).join('\n    '));
  }
}

(async () => {
  await runCase('completely unknown move + unknown ability', 50, ['Made Up Move', 'Tackle']);
  await runCase('completely unknown move + unknown ability', 150, ['Made Up Move', 'Tackle']);
})();
