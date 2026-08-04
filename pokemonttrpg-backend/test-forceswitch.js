/**
 * Test script: Verify PS engine behavior after force-switch resolution
 * Tests that getRequest() returns valid requests for both players after a force-switch.
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

const players = [
  {
    id: 'p1',
    name: 'Player1',
    team: makeTeam([
      { name: 'Venusaur', species: 'Venusaur', ability: 'Overgrow', types: ['Grass','Poison'],
        moves: ['Vine Whip', 'Tackle'], stats: { hp: 155, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 },
        currentHP: 5
      },
      { name: 'Charizard', species: 'Charizard', ability: 'Blaze', types: ['Fire','Flying'],
        moves: ['Flamethrower', 'Air Slash'], stats: { hp: 153, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }
      },
    ]),
  },
  {
    id: 'p2',
    name: 'Player2',
    team: makeTeam([
      { name: 'Gliscor', species: 'Gliscor', ability: 'Hyper Cutter', types: ['Ground','Flying'],
        moves: ['Ice Fang', 'Earthquake'], stats: { hp: 150, atk: 95, def: 125, spa: 45, spd: 75, spe: 95 }
      },
    ]),
  },
];

const engine = new SyncPSEngine({ seed: 42 });
const initState = engine.initializeBattle(players, { seed: 42, autoTeamPreview: true });
console.log('\n=== Initial State ===');
console.log('Turn:', initState.turn);
for (const p of initState.players) {
  const act = p.team[p.activeIndex];
  console.log('  ' + p.id + ': activeIndex=' + p.activeIndex + ' active=' + (act ? act.name : 'NONE') + ' HP=' + (act ? act.currentHP + '/' + act.maxHP : 'N/A'));
}

console.log('\n=== Initial Requests ===');
for (const p of initState.players) {
  const req = engine.getRequest(p.id);
  console.log('  ' + p.id + ':', req ? JSON.stringify({ requestType: req.requestType, hasActive: !!req.active, hasSide: !!req.side, hasForceSwitch: !!req.forceSwitch }) : 'NULL');
}

// Turn 1: Try to make Venusaur faint
console.log('\n=== Processing Turn 1 ===');
const turn1Result = engine.processTurn([
  { type: 'move', actorPlayerId: 'p1', moveId: 'vinewhip', pokemonId: 'venusaur' },
  { type: 'move', actorPlayerId: 'p2', moveId: 'icefang', pokemonId: 'gliscor' },
]);
console.log('Turn after processTurn:', turn1Result.state.turn);
console.log('Events:');
for (const e of turn1Result.events) console.log('  ' + e);

for (const p of turn1Result.state.players) {
  const active = p.team[p.activeIndex];
  console.log('  ' + p.id + ': active=' + active.name + ' HP=' + active.currentHP + '/' + active.maxHP + ' fainted=' + (active.currentHP <= 0));
}

console.log('\n=== Requests After Turn ===');
for (const p of turn1Result.state.players) {
  const req = engine.getRequest(p.id);
  console.log('  ' + p.id + ':', req ? JSON.stringify({ requestType: req.requestType, hasActive: !!req.active, hasSide: !!req.side, hasForceSwitch: !!req.forceSwitch, forceSwitch: req.forceSwitch }) : 'NULL');
}

console.log('\n=== needsForceSwitch ===');
console.log('  p1:', engine.needsForceSwitch('p1'));
console.log('  p2:', engine.needsForceSwitch('p2'));

// If fainted, do force switch
const venusaur = turn1Result.state.players[0].team[0];
if (venusaur.currentHP <= 0) {
  doForceSwitchTest();
} else {
  console.log('\nVenusaur survived with', venusaur.currentHP, 'HP. Running turn 2...');
  const turn2Result = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'tackle', pokemonId: 'venusaur' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'icefang', pokemonId: 'gliscor' },
  ]);
  console.log('Events:');
  for (const e of turn2Result.events) console.log('  ' + e);
  const v2 = turn2Result.state.players[0].team[0];
  if (v2.currentHP <= 0) {
    doForceSwitchTest();
  } else {
    console.log('Still alive after turn 2! HP:', v2.currentHP);
  }
}

function doForceSwitchTest() {
  console.log('\n====== FORCE SWITCH TEST ======');
  console.log('Switching p1 to Charizard (index 1)...');
  const switchResult = engine.forceSwitch('p1', 1);
  console.log('Turn after forceSwitch:', switchResult.state.turn);
  console.log('Events:');
  for (const e of switchResult.events) console.log('  ' + e);
  
  for (const p of switchResult.state.players) {
    const active = p.team[p.activeIndex];
    console.log('  ' + p.id + ': active=' + active.name + ' HP=' + active.currentHP + '/' + active.maxHP);
  }
  
  console.log('\n====== CRITICAL: Requests After Force-Switch ======');
  let allGood = true;
  for (const p of switchResult.state.players) {
    const req = engine.getRequest(p.id);
    if (!req) {
      console.log('  *** ' + p.id + ' request: NULL *** BUG: no request after force-switch!');
      allGood = false;
    } else {
      console.log('  ' + p.id + ':', JSON.stringify({
        requestType: req.requestType,
        hasActive: !!req.active,
        activeMovesCount: req.active?.[0]?.moves?.length || 0,
        hasSide: !!req.side,
        pokemonCount: req.side?.pokemon?.length || 0,
        hasForceSwitch: !!req.forceSwitch,
        forceSwitch: req.forceSwitch || null,
        rqid: req.rqid,
      }));
      if (req.forceSwitch) {
        console.log('  *** ' + p.id + ' STILL HAS forceSwitch! Stale request! ***');
        allGood = false;
      }
      if (!req.side) {
        console.log('  *** ' + p.id + ' has NO side data! emitMovePrompts will skip! ***');
        allGood = false;
      }
    }
  }
  
  console.log('\n=== needsForceSwitch After Switch ===');
  console.log('  p1:', engine.needsForceSwitch('p1'));
  console.log('  p2:', engine.needsForceSwitch('p2'));
  
  if (allGood) {
    console.log('\n*** ALL GOOD: Both players have valid requests after force-switch ***');
  } else {
    console.log('\n*** FAILURE: One or more players have invalid requests ***');
  }
}

console.log('\n=== TEST COMPLETE ===');
