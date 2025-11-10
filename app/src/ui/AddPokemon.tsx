import React, { useEffect, useMemo, useState } from 'react';
import { BattlePokemon } from '../types';
import { loadShowdownDex, toPokemon, prepareBattle } from '../data/adapter';

export function AddPokemon({ onAdd }: { onAdd: (mon: BattlePokemon[]) => void }) {
  const [dexNames, setDexNames] = useState<string[]>([]);
  const [species, setSpecies] = useState('');
  const [level, setLevel] = useState<number>(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const dex = await loadShowdownDex();
        if (!mounted) return;
        const names = Array.from(new Set(Object.values(dex.pokedex).map(s => s.name))).sort((a,b)=>a.localeCompare(b));
        setDexNames(names);
      } catch (e: any) {
        setError(e?.message || 'Failed to load dex');
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function addOne() {
    setLoading(true); setError(null);
    try {
      const dex = await loadShowdownDex();
      const p = toPokemon(species, dex.pokedex, level);
      if (!p) {
        setError('Species not found');
      } else {
        onAdd([prepareBattle(p)]);
        setSpecies('');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to add');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h3>Add Pokémon (Full Dex)</h3>
      <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
        <div style={{display:'flex', flexDirection:'column'}}>
          <label className="dim" htmlFor="speciesInput">Species</label>
          <input
            id="speciesInput"
            list="speciesList"
            value={species}
            onChange={e => setSpecies(e.target.value)}
            placeholder="e.g., Pikachu"
            style={{minWidth:220}}
          />
          <datalist id="speciesList">
            {dexNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div style={{display:'flex', flexDirection:'column'}}>
          <label className="dim" htmlFor="levelInput">Level</label>
          <input id="levelInput" type="number" min={1} max={100} value={level} onChange={e => setLevel(Number(e.target.value)||1)} style={{width:90}} />
        </div>
        <div style={{alignSelf:'flex-end'}}>
          <button onClick={addOne} disabled={loading || !species.trim()}>&gt; Add to PC</button>
        </div>
        {error && <span style={{color:'#ff8'}}>{error}</span>}
      </div>
    </section>
  );
}
