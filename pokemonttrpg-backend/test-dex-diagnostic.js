/**
 * Diagnostic: what does the ENGINE's dex actually contain for the battle species/moves?
 */
const ps = require('pokemon-showdown');
const { Dex, Teams } = ps;
require('./dist/sync-ps-engine'); // loads payload injections at module level

const checkSpecies = (name) => {
  const s = Dex.species.get(name);
  console.log(`SPECIES ${name}:`);
  console.log(`  exists=${s.exists} name=${s.name} types=${JSON.stringify(s.types)} baseStats=${JSON.stringify(s.baseStats)}`);
};

const checkMove = (name) => {
  const m = Dex.moves.get(name);
  console.log(`MOVE ${name}:`);
  console.log(`  exists=${m.exists} name=${m.name} type=${m.type} bp=${m.basePower} category=${m.category}`);
};

console.log('=== Battle species from the log ===');
['Pajantom', 'Greninja-Orion', 'Chandelure-Orion-Mega', 'Chandelure-Orion', 'Torterra-Temporal', 'Dusknoir-Temporal', 'Conkeldurr-Orion', 'Milotic-Orion', 'Delta Darmanitan', 'Rockram', 'Seikamater', 'Fafninter', 'Glimmora'].forEach(checkSpecies);

console.log('\n=== Moves in question ===');
['gammarray', 'photongeyser', 'photongeyserss2', 'toxicspikes', 'dragonrush', 'suckerpunch', 'shadowclaw'].forEach(checkMove);

console.log('\n=== Type chart sanity (defending side) ===');
const T = Dex.data.TypeChart;
for (const def of ['ghost', 'fire', 'normal', 'fairy', 'psychic', 'dark']) {
  const dt = T[def]?.damageTaken || {};
  const se = Object.entries(dt).filter(([, v]) => v === 1).map(([k]) => k);
  console.log(`  ${def}: SE from [${se.join(',')}]`);
}

console.log('\n=== Stat calc sanity at L150 (greninjaorion vs unknown species) ===');
const dex = Dex;
const calc = (species, level) => {
  const s = dex.species.get(species);
  const base = s.baseStats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const hp = Math.floor(Math.floor((2 * base.hp + 31 + 0) * level / 100) + level + 10);
  const spe = Math.floor(Math.floor((2 * base.spe + 31 + 0) * level / 100) + 5);
  return { hp, spe };
};
for (const sp of ['Greninja-Orion', 'greninjaorion', 'Greninja', 'Snorlax', 'Unknownthing']) {
  console.log(`  ${sp}: L50=${JSON.stringify(calc(sp, 50))} L150=${JSON.stringify(calc(sp, 150))}`);
}
