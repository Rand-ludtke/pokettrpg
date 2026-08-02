const https = require('https');
const fs = require('fs');

// Fetch pokedex.js
https.get('https://play.pokeathlon.com/data/pokedex.js', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    // Extract the exported object - BattlePokedex is the main export
    const match = data.match(/exports\.BattlePokedex\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) {
      console.error('Could not find BattlePokedex');
      process.exit(1);
    }

    // Create a sandbox with empty exports and eval it
    const pokedex = {};
    const fn = new Function('exports', `return ${match[1]}`);
    fn(pokedex);
    
    let BattlePokedex;
    if (pokedex) {
      for (const key of Object.keys(pokedex)) {
        // Check if it's the pokedex object itself
        if (typeof pokedex[key] === 'object' && pokedex[key] !== null && !Array.isArray(pokedex[key])) {
          // Check nested content
          const innerKeys = Object.keys(pokedex[key]);
          for (const innerKey of innerKeys) {
            if (innerKey.startsWith('BattlePokedex')) {
              BattlePokedex = pokedex[key][innerKey];
              break;
            }
          }
        }
      }
    }

    if (!BattlePokedex) {
      // Try directly as the returned value
      const testVal = fn({});
      console.log('Top level keys:', Object.keys(testVal).slice(0, 10));
      
      // The fn returns the object we're interested in
      BattlePokedex = testVal;
    }

    if (typeof BattlePokedex !== 'object') {
      console.error('BattlePokedex is not an object');
      process.exit(1);
    }

    const speciesKeys = Object.keys(BattlePokedex).sort((a, b) => 
      (BattlePokedex[a].num || 0) - (BattlePokedex[b].num || 0)
    );
    
    console.log(`\nTotal Pokédex entries: ${speciesKeys.length}`);
    
    const SOULSTONE_TYPES = ['Crystal', 'Cosmic', 'Nuclear', 'Stellar', 'Light', 'Sound'];
    const standardTypes = new Set([
      'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 
      'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 
      'Dragon', 'Dark', 'Steel', 'Fairy'
    ]);

    const soulstoneEntries = [];
    const capEntries = [];
    
    for (const key of speciesKeys) {
      const entry = BattlePokedex[key];
      if (!entry || !Array.isArray(entry.types)) continue;
      
      const hasSoulstone = entry.types.some(t => SOULSTONE_TYPES.includes(t));
      const unknownTypes = entry.types.filter(t => !standardTypes.has(t));
      
      if (hasSoulstone) {
        soulstoneEntries.push({ key, name: entry.name || key, species: entry.baseSpecies || entry.name || key, types: entry.types, num: entry.num });
      }
    }

    // Also scan for entries with unknown types (CAP, custom types not in standard or soulstone)
    for (const key of speciesKeys) {
      const entry = BattlePokedex[key];
      if (!entry || !Array.isArray(entry.types)) continue;
      
      const unknownTypes = entry.types.filter(t => 
        !standardTypes.has(t) && !SOULSTONE_TYPES.includes(t) && t !== '???',
      );
      
      // Also look for entries with baseSpecies mentioning CAP or containing CAP in name
      if (unknownTypes.length > 0 || /\bCAP/i.test(entry.name || '') || /\bCAP/i.test(entry.baseSpecies || '') || /\bCAP/i.test(key)) {
        capEntries.push({ key, name: entry.name || key, species: entry.baseSpecies || entry.name || key, types: entry.types, num: entry.num });
      }
    }

    // Deduplicate soulstone entries by baseSpecies (take first)
    const seenBase = new Set();
    const uniqueSoulstones = [];
    for (const entry of soulstoneEntries) {
      const bs = (entry.species || '').toLowerCase().trim();
      if (!seenBase.has(bs)) {
        seenBase.add(bs);
        uniqueSoulstones.push(entry);
      } else {
        // Multiple forme: also check if name differs from baseSpecies
        const nm = (entry.name || entry.key).toLowerCase().trim();
        if (nm !== bs && !seenBase.has(nm)) {
          seenBase.add(nm);
          uniqueSoulstones.push(entry);
        }
      }
    }

    console.log('\n=== SOULSTONE POKEMON (unique species/forms) ===');
    for (const e of uniqueSoulstones) {
      console.log(`  ${e.key} | Base: ${e.species} | Name: ${e.name} | Types: [${e.types.join(', ')}] | Num: ${e.num}`);
    }

    console.log('\n=== Additional CAP entries (unknown types or CAP name) ===');
    const uniqueCaps = [];
    const capSeen = new Set();
    for (const e of capEntries) {
      const nm = (e.name || e.key).toLowerCase().trim();
      if (!capSeen.has(nm)) {
        capSeen.add(nm);
        uniqueCaps.push(e);
      }
    }
    for (const e of uniqueCaps) {
      console.log(`  ${e.key} | Base: ${e.species} | Name: ${e.name} | Types: [${e.types.join(', ')}] | Num: ${e.num}`);
    }

    // Also check the abilities.js and items.js
    https.get('https://play.pokeathlon.com/data/abilities.js', (res2) => {
      let abData = '';
      res2.on('data', (c) => abData += c);
      res2.on('end', () => {
        const abMatch = abData.match(/exports\.BattleAbilities\s*=\s*(\{[\s\S]*?\})/);
        if (abMatch) {
          console.log('\n=== ABILITIES ===');
          // Count total ability entries  
          const abRe = /([a-z0-9]+):.*?(?=\n[a-z0-9]+:|$)/g;
          const matches = abData.match(abRe);
          if (matches) {
            console.log(`Total abilities in file: ${matches.length}`);
          }
          
          // Search for custom/soulstone-related abilities
          const customAbilities = ['soulguard', 'soulfire', 'soulcapture', 'soulshift'];
          for (const cab of customAbilities) {
            if (abData.includes(cab)) {
              console.log(`  Found ability: ${cab}`);
            }
          }
        }
      });
    }).on('error', e => console.error('Abilities fetch error:', e.message));

    // Write soulstone entries to JSON for TypeScript conversion 
    fs.writeFileSync('/tmp/soulstone_pokemon.json', JSON.stringify(uniqueSoulstones, null, 2));
    fs.writeFileSync('/tmp/cap_pokemon.json', JSON.stringify(uniqueCaps, null, 2));
    console.log('\nWrote soulstone data to /tmp/soulstone_pokemon.json');
    console.log('Wrote CAP data to /tmp/cap_pokemon.json');
    
    // Also dump the full pokeathlon pokedex for reference 
    fs.writeFileSync('/tmp/full_pokedex_keys.json', JSON.stringify(speciesKeys, null, 2));
    console.log(`\nDumped ${speciesKeys.length} species keys to /tmp/full_pokedex_keys.json`);
  });
}).on('error', e => {
  console.error('Fetch error:', e.message);
});
