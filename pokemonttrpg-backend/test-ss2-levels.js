/**
 * Repro test 2: faint/force-switch with SS2 custom abilities + custom moves at level >100.
 * Exercises switch-in ability handlers (the moment replacements are sent out).
 */
const { SyncPSEngine } = require('./dist/sync-ps-engine');

function makeMon(p) {
  return {
    id: p.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    name: p.name,
    species: p.species || p.name,
    level: p.level || 150,
    types: p.types || ['Normal'],
    ability: p.ability || 'Pressure',
    item: p.item || '',
    moves: p.moves.map(m => ({ id: m.toLowerCase().replace(/\s+/g, ''), name: m })),
    stats: p.stats || { hp: 300, atk: 200, def: 180, spa: 200, spd: 180, spe: 150 },
    maxHP: p.stats?.hp || 300,
    currentHP: p.currentHP !== undefined ? p.currentHP : (p.stats?.hp || 300),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'M',
  };
}

const ABILITIES = ['ethereal', 'bonecollector', 'requiem', 'funeralpyre', 'haunted', 'retribution', 'vengeful', 'requiem', 'leadership', 'teleface', 'regrowth', 'wintergift'];

async function runCase(ability, level) {
  const players = [
    {
      id: 'p1', name: 'Player1',
      team: [
        makeMon({ name: 'Venusaur', ability: 'Overgrow', level, currentHP: 5, moves: ['Vine Whip'] }),
        makeMon({ name: 'Charizard', ability, level, moves: ['Flamethrower'] }),
      ],
    },
    {
      id: 'p2', name: 'Player2',
      team: [
        makeMon({ name: 'Gliscor', ability: 'Hyper Cutter', level, moves: ['Ice Fang', 'Earthquake'] }),
      ],
    },
  ];
  try {
    const engine = new SyncPSEngine({ seed: 42 });
    engine.initializeBattle(players, { seed: 42, autoTeamPreview: true });
    engine.processTurn([
      { type: 'move', actorPlayerId: 'p1', moveId: 'vinewhip', pokemonId: 'venusaur' },
      { type: 'move', actorPlayerId: 'p2', moveId: 'icefang', pokemonId: 'gliscor' },
    ]);
    const req = engine.getRequest('p1');
    const needsSwitch = req?.forceSwitch?.some(Boolean);
    if (!needsSwitch) {
      console.log(`  [${ability}] no force switch needed (mon survived) - SKIP`);
      return;
    }
    const sw = engine.forceSwitch('p1', 1);
    const post = engine.getRequest('p1');
    const ok = post && !post.forceSwitch?.some(Boolean) && post.active?.[0]?.moves?.length > 0;
    console.log(`  [${ability}] L${level} switch-in ok=${!!ok} postReq=${post ? 'valid' : 'NULL'}`);
    if (!ok) {
      console.log('    events:', JSON.stringify(sw.events));
      console.log('    post:', JSON.stringify(post)?.slice(0, 400));
    }
  } catch (err) {
    console.log(`  [${ability}] L${level} *** THREW ***:`);
    console.log('    ' + String(err && err.stack || err).split('\n').slice(0, 6).join('\n    '));
  }
}

(async () => {
  for (const ability of ABILITIES) {
    await runCase(ability, 150);
  }
  await runCase('ethereal', 200);
  console.log('DONE');
})();
