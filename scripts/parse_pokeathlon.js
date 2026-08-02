const https = require('https');
const fs = require('fs');

https.get('https://play.pokeathlon.com/data/pokedex.js', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    // Extract the exported object from exports.BattlePokedex = {...}
    const match = data.match(/exports\.BattlePokedex\s*=\s*(\{[\s\S]*\});/);
    if (!match) { console.error('No match'); process.exit(1); }

    // Evaluate to get the actual pokedex object  
    const BattlePokedex = eval('(' + match[1] + ')');
    const keys = Object.keys(BattlePokedex).sort((a,b) => 
      (BattlePokedex[a].num || 0) - (BattlePokedex[b].num || 0)
    );

    console.log(`Total entries: ${keys.length}`);

    // Standard types for filtering
    const standardTypes = new Set([
      'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
      'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark',
      'Steel','Fairy'
    ]);
    const soulstoneTypes = new Set(['Crystal','Cosmic','Nuclear','Stellar','Light','Sound']);

    const soulstoneEntries = [];
    for (const key of keys) {
      const e = BattlePokedex[key];
      if (!e || !Array.isArray(e.types)) continue;
      hasSoulstone: for (const t of e.types) {
        if (soulstoneTypes.has(t)) { soulstoneEntries.push({key, entry:e}); break; }
      }
    }

    // Unique base species by lowercased name 
    const seen = new Map(); // lowercase name -> first key
    for (const s of soulstoneEntries) {
      const bs = String(s.entry.baseSpecies || '').toLowerCase();
      const nm = String(s.entry.name || s.key).toLowerCase();
      const primary = bs || nm;
      if (!seen.has(primary)) seen.set(primary, s);
    }

    console.log(`\n=== Unique Soulstone Species (${seen.size}) ===`);
    for (const [name, s] of seen) {
      const e = s.entry;
      console.log(`${s.key} | name="${e.name||s.key}" base="${e.baseSpecies||'?'}" types=[${e.types.join(',')}] num=${e.num}`);
      
      // Check for abilities if present  
      if (e.abilities) {
        const abStr = Object.entries(e.abilities).map(([k,v]) => `${k}:${v}`).join(',');
        console.log(`  ab: ${abStr}`);
      }
      if (e.baseStats) {
        const bsStr = Object.entries(e.baseStats).map(([k,v]) => `${k}:${v}`).join(',');
        console.log(`  stats: ${bsStr}`);
      }
    }

    // Show entries with only non-standard types (potentially exclusive soulstone/custom)
    console.log('\n=== Only-soulstone-types (no standard type) ===');
    for (const [name, s] of seen) {
      const e = s.entry;
      const hasStandard = e.types.some(t => standardTypes.has(t));
      if (!hasStandard) console.log(`  ${s.key}: [${e.types.join(',')}]`);
    }

    // Show the raw format of a few typical entries to see field differences from DexSpecies
    console.log('\n=== Sample raw entry fields (first, Orion, Nuclear, unique custom) ===');
    const samples = [];
    for (const key of keys) {
      if (samples.length >= 4) break;
      const e = BattlePokedex[key];
      if (!e || !Array.isArray(e.types)) continue;
      let sample = null;
      // First normal entry
      if (!sample && e.types.some(t => standardTypes.has(t) && !soulstoneTypes.has(t))) {
        sample = {key, desc: 'normal'};
      }
      // First soulstone entry
      if (!sample && e.types.some(t => soulstoneTypes.has(t))) {
        sample = {key, desc: 'soulstone'};
      }
      // First high-num custom
      if (!sample && (e.num || 0) >= 5000) {
        sample = {key, desc: 'custom-high-num'};
      }
      // First missingno
      if (!sample && /missing/.test(key)) {
        sample = {key, desc: 'missingno'};
      }
      if (sample) samples.push(sample);
    }

    for (const s of samples) {
      const e = BattlePokedex[s.key];
      console.log(`\n--- ${s.desc} (${s.key}) ---`);
      // Show ALL fields as JSON
      let out = {};
      for (const k of Object.keys(e)) {
        try { out[k] = e[k]; } catch {}
      