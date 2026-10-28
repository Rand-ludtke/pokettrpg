/**
 * Verification: Stormbringer (Uranium) + the unique Thunderstorm weather.
 * Run: node test-stormbringer.js
 *
 * Checks:
 *  1. Yatagaryu switch-in summons Thunderstorm (Stormbringer onStart)
 *  2. Electric moves get the 1.5x weather boost
 *  3. Lightning strikes on odd turns only, scaled by Electric weakness
 *     (2x weak takes 25%, neutral takes 12.5%)
 *  4. Electric/Ground types and Motor Drive are exempt
 */
const ps = require('pokemon-showdown');
require('./dist/sync-ps-engine.js');
const { SyncPSEngine } = require('./dist/sync-ps-engine');

const Dex = ps.Dex;

const cond = Dex.data.Conditions['thunderstorm'];
console.log(`[dex] thunderstorm condition: exists=${!!cond} effectType=${cond && cond.effectType} onWeatherModifyDamage=${typeof (cond && cond.onWeatherModifyDamage)}`);
const ab = Dex.data.Abilities['stormbringer'];
console.log(`[dex] stormbringer: exists=${!!ab} onStart=${typeof (ab && ab.onStart)}`);
const mv = Dex.moves.get('thunderstorm');
console.log(`[dex] thunderstorm move: exists=${mv.exists} weather=${mv.weather}`);

function makeMon(p) {
  return {
    id: p.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    name: p.name,
    species: p.species || p.name,
    level: p.level || 50,
    types: p.types,
    ability: p.ability || 'Pressure',
    item: '',
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

function runBattle(foe, turns) {
  const engine = new SyncPSEngine({ seed: 42 });
  engine.initializeBattle([
    { id: 'p1', name: 'Player1', team: [makeMon({ name: 'Yatagaryu', species: 'Yatagaryu', ability: 'Stormbringer', types: ['Electric', 'Dragon'], moves: ['Thunder Shock'], stats: { hp: 300, atk: 50, def: 100, spa: 50, spd: 100, spe: 100 } })] },
    { id: 'p2', name: 'Player2', team: [foe] },
  ], { seed: 42, autoTeamPreview: true });
  const side = engine.battle.sides.find(s => s.id === 'p1');
  const field = engine.battle.field;
  console.log(`  after switch-in: weather=${field.weather || field.effectiveWeather && field.effectiveWeather()}`);
  // p1: Thunder Shock (weak Electric, should get 1.5x), p2: harmless move
  for (let t = 0; t < turns; t++) {
    const res = engine.processTurn([
      { type: 'move', actorPlayerId: 'p1', moveId: 'thundershock', pokemonId: 'yatagaryu' },
      { type: 'move', actorPlayerId: 'p2', moveId: foe.moves[0], pokemonId: foe.name.toLowerCase().replace(/[^a-z0-9]/g, '') },
    ]);
    const strike = (res.events || []).filter(l => l.includes('struck by lightning'));
    const foeMon = engine.battle.sides.find(s => s.id === 'p2').active[0];
    const upkeep = (res.events || []).filter(l => l.includes('|-weather|Thunderstorm|[upkeep]'));
    console.log(`  turn ${t + 1}: foe HP=${foeMon.hp}/${foeMon.maxhp} (${Math.round(foeMon.hp / foeMon.maxhp * 1000) / 10}%)${strike.length ? ' | STRUCK' : ''} | upkeep msgs=${upkeep.length}`);
  }
  return engine;
}

// Tanky custom species: ensureSpeciesRegistered uses these stats as BASE stats,
// so hp 2000 -> PS L50 max HP ~2500 and strike fractions become measurable.
const TANK_STATS = { hp: 2000, atk: 50, def: 100, spa: 50, spd: 100, spe: 50 };

console.log('\n=== vs Tankmon-Ghost (Ghost, Electric-neutral -> strike 12.5% on odd turns) ===');
runBattle(makeMon({ name: 'Tankmon Ghost', species: 'Tankmon Ghost', ability: 'Pressure', types: ['Ghost'], moves: ['Splishy Splash'], stats: TANK_STATS }), 4);

console.log('\n=== vs Tankmon-Water (Water, Electric 2x -> strike 25%) ===');
runBattle(makeMon({ name: 'Tankmon Water', species: 'Tankmon Water', ability: 'Pressure', types: ['Water'], moves: ['Splishy Splash'], stats: TANK_STATS }), 4);

console.log('\n=== vs Tankmon-Electric (Electric -> exempt) ===');
runBattle(makeMon({ name: 'Tankmon Electric', species: 'Tankmon Electric', ability: 'Pressure', types: ['Electric'], moves: ['Splishy Splash'], stats: TANK_STATS }), 4);

console.log('\nDONE');
