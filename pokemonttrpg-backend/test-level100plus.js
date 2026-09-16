/**
 * Repro test: battles with Pokemon over level 100 + faint/force-switch flow.
 * Mirrors test-forceswitch.js but with high levels.
 */
const { SyncPSEngine } = require('./dist/sync-ps-engine');

function makeTeam(pokemon) {
  return pokemon.map(p => ({
    id: p.name.toLowerCase(),
    name: p.name,
    species: p.species || p.name,
    level: p.level || 50,
    types: p.types || ['Normal'],
    ability: p.ability || 'Overgrow',
    item: p.item || '',
    moves: p.moves.map(m => ({ id: m.toLowerCase().replace(/\s+/g, ''), name: m })),
    stats: p.stats || { hp: 150, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
    maxHP: p.stats?.hp || 150,
    currentHP: p.currentHP !== undefined ? p.currentHP : (p.stats?.hp || 150),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'M',
  }));
}

async function runTest(level) {
  console.log(`\n########## TEST: level ${level} ##########`);
  const players = [
    {
      id: 'p1',
      name: 'Player1',
      team: makeTeam([
        { name: 'Venusaur', species: 'Venusaur', ability: 'Overgrow', level, types: ['Grass','Poison'],
          moves: ['Vine Whip', 'Tackle'], stats: { hp: 155, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 },
          currentHP: 5
        },
        { name: 'Charizard', species: 'Charizard', ability: 'Blaze', level, types: ['Fire','Flying'],
          moves: ['Flamethrower', 'Air Slash'], stats: { hp: 153, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }
        },
      ]),
    },
    {
      id: 'p2',
      name: 'Player2',
      team: makeTeam([
        { name: 'Gliscor', species: 'Gliscor', ability: 'Hyper Cutter', level, types: ['Ground','Flying'],
          moves: ['Ice Fang', 'Earthquake'], stats: { hp: 150, atk: 95, def: 125, spa: 45, spd: 75, spe: 95 }
        },
      ]),
    },
  ];

  const engine = new SyncPSEngine({ seed: 42 });
  try {
    const initState = engine.initializeBattle(players, { seed: 42, autoTeamPreview: true });
    for (const p of initState.players) {
      const act = p.team[p.activeIndex];
      console.log(`  init: ${p.id} active=${act ? act.name : 'NONE'} HP=${act ? act.currentHP + '/' + act.maxHP : 'N/A'} lvl=${act ? act.level : '?'}`);
    }
    const req1 = engine.getRequest('p1');
    const req2 = engine.getRequest('p2');
    console.log('  init requests:', !!req1, !!req2);

    // p1 Venusaur has 5 HP, p2 attacks -> faint -> force switch
    const turn1 = engine.processTurn([
      { type: 'move', actorPlayerId: 'p1', moveId: 'vinewhip', pokemonId: 'venusaur' },
      { type: 'move', actorPlayerId: 'p2', moveId: 'icefang', pokemonId: 'gliscor' },
    ]);
    console.log('  turn1 events:', JSON.stringify(turn1.events.slice(0, 12), null, 0));
    const ven = turn1.state.players[0].team[0];
    console.log(`  venusaur HP after: ${ven.currentHP}/${ven.maxHP}`);

    const afterReq1 = engine.getRequest('p1');
    console.log('  p1 request after faint:', afterReq1 ? JSON.stringify({ forceSwitch: afterReq1.forceSwitch, requestType: afterReq1.requestType }) : 'NULL');

    if (ven.currentHP <= 0) {
      const sw = engine.forceSwitch('p1', 1);
      console.log('  forceSwitch events:', JSON.stringify(sw.events.slice(0, 12), null, 0));
      const reqP1 = engine.getRequest('p1');
      const reqP2 = engine.getRequest('p2');
      console.log('  post-switch p1 request:', reqP1 ? JSON.stringify({ requestType: reqP1.requestType, moves: reqP1.active?.[0]?.moves?.length, forceSwitch: reqP1.forceSwitch || null }) : 'NULL *** BUG');
      console.log('  post-switch p2 request:', reqP2 ? JSON.stringify({ requestType: reqP2.requestType, moves: reqP2.active?.[0]?.moves?.length, forceSwitch: reqP2.forceSwitch || null }) : 'NULL *** BUG');
      // condition strings in side data (what the client party UI parses)
      const side = reqP1?.side?.pokemon || [];
      for (const p of side) {
        console.log(`    side mon: ${p.ident} | details=${p.details} | condition=${p.condition} | active=${p.active}`);
      }
      // do another move turn after the switch
      const t2 = engine.processTurn([
        { type: 'move', actorPlayerId: 'p1', moveId: 'flamethrower', pokemonId: 'charizard' },
        { type: 'move', actorPlayerId: 'p2', moveId: 'icefang', pokemonId: 'charizard' },
      ]);
      console.log('  turn2 events:', JSON.stringify(t2.events.slice(0, 12), null, 0));
    }
    console.log(`  => level ${level} OK`);
  } catch (err) {
    console.error(`  => level ${level} CRASHED:`);
    console.error(err && err.stack || err);
  }
}

(async () => {
  await runTest(100);
  await runTest(150);
  await runTest(200);
})();
