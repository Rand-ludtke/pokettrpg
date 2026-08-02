const https = require('https');
const fs = require('fs');

// Write output files path for this run
const OUT_SOUL = 'D:/GitHub/pokettrpg/tmp/soulstone_raw.json';
const OUT_CAP = 'D:/GitHub/pokettrpg/tmp/cap_raw.json';

try { fs.mkdirSync('D:/GitHub/pokettrpg/tmp', { recursive: true }); } catch {}

https.get('https://play.pokeathlon.com/data/pokedex.js', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const match = data.match(/exports\.BattlePokedex\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) { console.error('No match'); process.exit(1); }

    const BattlePokedex = eval('(' + match[1] + ')');
    const keys = Object.keys(BattlePokedex).sort((a,b) => 
      (BattlePokedex[a].num || 0) - (BattlePokedex[b].num || 0)
    );

    console.log(`Total entries: ${keys.length}`);

    const standardTypes = new Set([
      'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
      'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark',
      'Steel','Fairy'
    ]);
    const soulstoneTypes = new Set(['Crystal','Cosmic','Nuclear','Stellar','Light','Sound']);

    // Collect ALL entries that have at least one soulstone type (regardless of their first form/region)
    const allSoulstone = [];
    for (const key of keys) {
      const e = BattlePokedex[key];
      if (!e || !Array.isArray(e.types)) continue;
      if (e.types.some(t => soulstoneTypes.has(t))) {
        allSoulstone.push({key, entry: JSON.parse(JSON.stringify(e))});
      }
    }

    // Collect custom-only species (names appearing in pokedex.js that DON'T exist in base showdown)
    // We consider num >= 1000 AND not in standard pokedex as custom
    const customEntries = [];
    for (const key of keys) {
      const e = BattlePokedex[key];
      if (!e || !Array.isArray(e.types)) continue;
      if ((e.num || 0) >= 2500 && !standardTypes.has(e.types[0])) {
        customEntries.push({key, entry: JSON.parse(JSON.stringify(e))});
      }
    }

    // For uniqueness, pick first key per baseSpecies
    const uniqueSoulstone = [];
    const seenBase = new Set();
    for (const s of allSoulstone) {
      const bs = String(s.entry.baseSpecies || s.key).toLowerCase().replace(/\s/g,'');
      if (!seenBase.has(bs)) {
        seenBase.add(bs);
        uniqueSoulstone.push(s);
      }
    }

    // Write outputs
    fs.writeFileSync(OUT_SOUL, JSON.stringify(uniqueSoulstone));
    fs.writeFileSync(OUT_CAP, JSON.stringify(customEntries));

    console.log(`\nUnique soulstone species: ${uniqueSoulstone.length}`);
    console.log(`Custom (num>=2500, non-standard): ${customEntries.length}`);

    // Breakdown of unique soulstone by primary type
    const primaryBreakdown = {};
    for (const s of uniqueSoulstone) {
      const pt = s.entry.types[0];
      primaryBreakdown[pt] = (primaryBreakdown[pt]||0)+1;
    }
    console.log('\nPrimary type breakdown:');
    for (const [t,c] of Object.entries(primaryBreakdown).sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${t}: ${c}`);
    }

    // Show a sample raw entry structure for field analysis
    console.log('\n=== Sample entries by category ===');
    
    // First Normal (non-soulstone) entry
    const normalEntry = keys.find(k => {
      const e = BattlePokedex[k];
      return e && Array.isArray(e.types) && e.types.some(t => standardTypes.has(t));
    });
    if (normalEntry) {
      console.log(`\n--- Normal entry (${normalEntry}) ---`);
      // Show field names only
      for (const k of Object.keys(BattlePokedex[normalEntry]).slice(0,20)) {
        const v = BattlePokedex[normalEntry][k];
        if (Array.isArray(v)) console.log(`  ${k}: [${v.join(',')}]`);
        else if (typeof v === 'object' && v !== null) console.log(`  ${k}: {${Object.keys(v).join(',')}}`);
        else console.log(`  ${k}: ${String(v).substring(0,50)}`);
      }
    }

    // First soulstone entry  
    const firstSoul = allSoulstone[0];
    if (firstSoul) {
      const e = BattlePokedex[firstSoul.key];
      console.log(`\n--- Soulstone entry (${firstSoul.key}) ---`);
      for (const k of Object.keys(e).slice(0,20)) {
        const v = e[k];
        if (Array.isArray(v)) console.log(`  ${k}: [${v.join(',')}]`);
        else if (typeof v === 'object' && v !== null) {
          // Include full sub-object for abilities/stats
          if (k==='abilities' || k==='baseStats') {
            console.log(`  ${k}: ${JSON.stringify(v).substring(0,200)}`);
          } else {
            console.log(`  ${k}: {${Object.keys(v).join(',')}}`);
          }
        }
        else console.log(`  ${k}: ${String(v).substring(0,50)}`);
      }
    }

    // First high-num custom
    const firstCustom = keys.find(k => (BattlePokedex[k].num||0) >= 2500);
    if (firstCustom) {
      const e = BattlePokedex[firstCustom];
      console.log(`\n--- Custom entry (${firstCustom}) ---`);
      for (const k of Object.keys(e).slice(0,20)) {
        const v = e[k];
        if (Array.isArray(v)) console.log(`  ${k}: [${v.join(',')}]`);
        else if (typeof v === 'object' && v !== null) {
          if (k==='abilities'||k==='baseStats') {
            console.log(`  ${k}: ${JSON.stringify(v).substring(0,200)}`);
          } else {
            console.log(`  ${k}: {${Object.keys(v).join(',')}}`);
          }
        }
        else console.log(`  ${k}: ${String(v).substring(0,50)}`);
      }
    }

    // Show all unique custom species names
    const customNames = [...new Set(customEntries.map(e => e.entry.name || e.key))];
    console.log('\n=== All Custom Species Names ===');
    for (const n of customNames.slice(0,80)) {
      console.log(`  ${n}`);
    }

    // Show all unique baseSpecies names from soulstone
    const bsNames = [...new Set(uniqueSoulstone.map(e => e.entry.baseSpecies || e.key))];
    console.log('\n=== All Unique Soulstone Species (baseSpecies) ===');
    for (const n of bsNames.slice(0,80)) {
      console.log(`  ${n}`);
    }

    // Also check: how many soulstone entries are pure Custom tier + only soulstone types?
    const pureSoulton = uniqueSoulstone.filter(e => 
      e.entry.types.every(t => !standardTypes.has(t)) || // no standard types
      (e.entry.tier === 'Custom' || e.entry.tier === 'Illegal') // or marked custom
    );
    console.log(`\nPure soulstone-only (no standard types OR Custom tier): ${pureSoulton.length}`);

  });
}).on('error', e => { console.error(e.message); });
