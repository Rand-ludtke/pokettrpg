const { SyncPSEngine } = require('./dist/sync-ps-engine');
const assert = require('assert');

function makeMon(name, species, hp, moves, spa = 100, def = 80) {
  return {
    id: name.toLowerCase(),
    name,
    species: species || name,
    level: 50,
    types: ['Normal'],
    ability: 'Overgrow',
    item: '',
    moves: moves.map(m => ({ id: m.toLowerCase().replace(/\s+/g, ''), name: m })),
    stats: { hp, atk: 80, def, spa, spd: 80, spe: 80 },
    maxHP: hp,
    currentHP: hp,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'M',
  };
}

console.log('==================================================');
console.log('TEST 1: Atom Split Move Mechanics');
console.log('==================================================');
{
  const p1Team = [
    makeMon('Orbatom', 'Orbatom', 120, ['Atom Split', 'Tackle'], 130),
    makeMon('Raichu', 'Raichu', 140, ['Thunderbolt', 'Quick Attack'])
  ];
  const p2Team = [
    makeMon('Blissey', 'Blissey', 300, ['Soft-Boiled', 'Tackle'], 75, 40)
  ];

  const engine = new SyncPSEngine({ seed: 1234 });
  engine.initializeBattle([
    { id: 'p1', name: 'Player1', team: p1Team },
    { id: 'p2', name: 'Player2', team: p2Team }
  ], { autoTeamPreview: true });

  const res = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'atomsplit' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'tackle' }
  ]);

  const p1Orbatom = res.state.players[0].team[0];
  const p2Blissey = res.state.players[1].team[0];

  console.log('  Orbatom HP:', p1Orbatom.currentHP, '(expected 0 - selfdestruct)');
  console.log('  Blissey HP:', p2Blissey.currentHP, '(expected < 300 - took massive damage)');
  assert.strictEqual(p1Orbatom.currentHP, 0, 'User should faint from Atom Split');
  assert(p2Blissey.currentHP < 300, 'Target should take damage from Atom Split');
  assert.strictEqual(engine.needsForceSwitch('p1'), true, 'Player 1 should need force switch');
  console.log('  PASS: Atom Split fainted user and dealt heavy damage.');
}

console.log('\n==================================================');
console.log('TEST 2: Voluntary Switching & Active Index Tracking');
console.log('==================================================');
{
  const p1Team = [
    makeMon('Pikachu', 'Pikachu', 100, ['Thunder Shock']),
    makeMon('Charizard', 'Charizard', 150, ['Flamethrower']),
    makeMon('Venusaur', 'Venusaur', 160, ['Solar Beam'])
  ];
  const p2Team = [
    makeMon('Snorlax', 'Snorlax', 250, ['Rest'])
  ];

  const engine = new SyncPSEngine({ seed: 5678 });
  engine.initializeBattle([
    { id: 'p1', name: 'Player1', team: p1Team },
    { id: 'p2', name: 'Player2', team: p2Team }
  ], { autoTeamPreview: true });

  assert.strictEqual(engine.state.players[0].activeIndex, 0);
  assert.strictEqual(engine.state.players[0].team[0].name, 'Pikachu');
  assert.strictEqual(engine.state.players[0].team[1].name, 'Charizard');

  // Turn 1: Switch to Charizard (side index 1 in request.side.pokemon)
  console.log('  Turn 1: Switch to Charizard (index 1)...');
  const t1 = engine.processTurn([
    { type: 'switch', actorPlayerId: 'p1', toIndex: 1 },
    { type: 'move', actorPlayerId: 'p2', moveId: 'rest' }
  ]);

  console.log('    P1 activeIndex:', t1.state.players[0].activeIndex);
  console.log('    P1 team[0]:', t1.state.players[0].team[0].name, 'HP:', t1.state.players[0].team[0].currentHP);
  console.log('    P1 team[1]:', t1.state.players[0].team[1].name, 'HP:', t1.state.players[0].team[1].currentHP);
  assert.strictEqual(t1.state.players[0].activeIndex, 1, 'Active index should be 1 (Charizard)');
  assert.strictEqual(t1.state.players[0].team[1].name, 'Charizard');
  assert(t1.state.players[0].team[1].currentHP > 0);
  assert.strictEqual(t1.state.players[0].team[0].name, 'Pikachu');
  assert(t1.state.players[0].team[0].currentHP > 0);

  // Helper methods verification
  assert.strictEqual(engine.isSideIndexActive('p1', 0), true, 'Showdown slot 0 should be active');
  assert.strictEqual(engine.isSideIndexActive('p1', 1), false, 'Showdown slot 1 should be benched');
  const monAtSlot1 = engine.getPokemonAtSideIndex('p1', 1);
  console.log('    Showdown bench slot 1 is:', monAtSlot1?.name);
  assert.strictEqual(monAtSlot1?.name, 'Pikachu', 'Showdown slot 1 should map to Pikachu');

  // Turn 2: Switch back to Pikachu (which is at Showdown side index 1)
  console.log('  Turn 2: Switch back to Pikachu (side index 1)...');
  const t2 = engine.processTurn([
    { type: 'switch', actorPlayerId: 'p1', toIndex: 1 },
    { type: 'move', actorPlayerId: 'p2', moveId: 'rest' }
  ]);

  console.log('    P1 activeIndex:', t2.state.players[0].activeIndex);
  assert.strictEqual(t2.state.players[0].activeIndex, 0, 'Active index should be back to 0 (Pikachu)');
  assert(t2.state.players[0].team[0].currentHP > 0);
  assert(t2.state.players[0].team[1].currentHP > 0);
  console.log('  PASS: Voluntary switches accurately track activeIndex and preserve team stats.');
}

console.log('\n==================================================');
console.log('TEST 3: Force-Switch Execution & Prompt Flow');
console.log('==================================================');
{
  const p1Team = [
    makeMon('Magikarp', 'Magikarp', 10, ['Splash']),
    makeMon('Gyarados', 'Gyarados', 180, ['Waterfall'])
  ];
  const p2Team = [
    makeMon('Mewtwo', 'Mewtwo', 200, ['Psychic'])
  ];

  const engine = new SyncPSEngine({ seed: 9999 });
  engine.initializeBattle([
    { id: 'p1', name: 'Player1', team: p1Team },
    { id: 'p2', name: 'Player2', team: p2Team }
  ], { autoTeamPreview: true });

  // Turn 1: Magikarp takes Psychic and faints
  const t1 = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'splash' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'psychic' }
  ]);

  assert.strictEqual(t1.state.players[0].team[0].currentHP, 0, 'Magikarp faints');
  assert.strictEqual(engine.needsForceSwitch('p1'), true, 'P1 needs force switch');

  // P1 force-switches to Gyarados (bench index 1)
  const fsResult = engine.forceSwitch('p1', 1);
  console.log('  Force switch success:', fsResult.success);
  console.log('  P1 activeIndex:', fsResult.state.players[0].activeIndex);
  console.log('  P1 active mon:', fsResult.state.players[0].team[fsResult.state.players[0].activeIndex].name);
  assert.strictEqual(fsResult.success, true);
  assert.strictEqual(fsResult.state.players[0].activeIndex, 1, 'Gyarados (index 1) is now active');
  assert.strictEqual(fsResult.state.players[0].team[1].name, 'Gyarados');
  assert(fsResult.state.players[0].team[1].currentHP > 0);
  assert.strictEqual(fsResult.state.players[0].team[0].currentHP, 0, 'Magikarp remains 0 HP');
  assert.strictEqual(engine.needsForceSwitch('p1'), false, 'P1 no longer needs switch');
  console.log('  PASS: Force-switch resolved cleanly with correct active mon and HP.');
}

console.log('\n==================================================');
console.log('TEST 4: Simultaneous Force-Switch (Double Faint)');
console.log('==================================================');
{
  const p1Team = [
    makeMon('Orbatom', 'Orbatom', 120, ['Atom Split'], 150),
    makeMon('Jolteon', 'Jolteon', 130, ['Thunderbolt'])
  ];
  const p2Team = [
    makeMon('Rattata', 'Rattata', 10, ['Tackle']), // will faint from Atom Split
    makeMon('Snorlax', 'Snorlax', 250, ['Body Slam'])
  ];

  const engine = new SyncPSEngine({ seed: 777 });
  engine.initializeBattle([
    { id: 'p1', name: 'Player1', team: p1Team },
    { id: 'p2', name: 'Player2', team: p2Team }
  ], { autoTeamPreview: true });

  const t1 = engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', moveId: 'atomsplit' },
    { type: 'move', actorPlayerId: 'p2', moveId: 'tackle' }
  ]);

  console.log('  Turn 1 results:');
  console.log('    P1 needs switch:', engine.needsForceSwitch('p1'));
  console.log('    P2 needs switch:', engine.needsForceSwitch('p2'));
  assert.strictEqual(engine.needsForceSwitch('p1'), true);
  assert.strictEqual(engine.needsForceSwitch('p2'), true);

  // P1 chooses switch 1 (Jolteon)
  const fs1 = engine.forceSwitch('p1', 1);
  console.log('  P1 chose switch. fs1.success:', fs1.success);
  assert.strictEqual(fs1.success, true);
  // Showdown should be waiting for P2
  const p1Side = engine.battle.sides[0];
  console.log('  P1 choice done in Showdown:', p1Side.isChoiceDone());
  assert.strictEqual(p1Side.isChoiceDone(), true, 'P1 choice should be registered');

  // P2 chooses switch 1 (Snorlax)
  const fs2 = engine.forceSwitch('p2', 1);
  console.log('  P2 chose switch. fs2.success:', fs2.success);
  assert.strictEqual(fs2.success, true);
  assert.strictEqual(engine.needsForceSwitch('p1'), false);
  assert.strictEqual(engine.needsForceSwitch('p2'), false);

  console.log('  After both switched:');
  console.log('    P1 active:', fs2.state.players[0].team[fs2.state.players[0].activeIndex].name);
  console.log('    P2 active:', fs2.state.players[1].team[fs2.state.players[1].activeIndex].name);
  assert.strictEqual(fs2.state.players[0].team[fs2.state.players[0].activeIndex].name, 'Jolteon');
  assert.strictEqual(fs2.state.players[1].team[fs2.state.players[1].activeIndex].name, 'Snorlax');
  console.log('  PASS: Simultaneous force switches resolve smoothly without deadlock.');
}

console.log('\n==================================================');
console.log('ALL TESTS PASSED SUCCESSFULLY!');
console.log('==================================================');
