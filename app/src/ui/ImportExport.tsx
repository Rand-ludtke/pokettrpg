import React, { useMemo, useState } from 'react';
import { parseShowdownTeam, loadShowdownDex, toPokemon, prepareBattle, mapMoves, formatShowdownTeam } from '../data/adapter';
import { BattlePokemon } from '../types';

export function ImportExport({ onImport, maxCount, exportList, exportLabel }: { onImport: (team: BattlePokemon[]) => void; maxCount?: number; exportList?: BattlePokemon[]; exportLabel?: string }) {
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doImport() {
    setImporting(true); setError(null);
    try {
      const sets = parseShowdownTeam(text);
      const dex = await loadShowdownDex();
      let built: BattlePokemon[] = [];
      for (const s of sets) {
        const p = toPokemon(s.species, dex.pokedex, s.level ?? 50);
        if (!p) continue;
        p.name = s.name || p.name;
        p.ability = s.ability || p.ability;
        (p as any).item = s.item || (p as any).item;
        p.level = s.level ?? p.level;
        p.moves = mapMoves(s.moves || [], dex.moves);
        // Store extras even if not used yet
        (p as any).teraType = s.teraType;
        (p as any).evs = s.evs;
        (p as any).ivs = s.ivs;
        (p as any).nature = s.nature;
        built.push(prepareBattle(p));
      }
      if (typeof maxCount === 'number') built = built.slice(0, maxCount);
      onImport(built);
    } catch (e: any) {
      setError(e?.message || 'Failed to import');
    } finally {
      setImporting(false);
    }
  }

  function doExport() {
    if (!exportList || exportList.length === 0) {
      setText('');
      return;
    }
    const out = formatShowdownTeam(exportList);
    setText(out);
  }

  return (
    <section className="panel">
      <h3>Import / Export</h3>
      <p>Paste a Showdown team to import{typeof maxCount==='number' ? ` up to ${maxCount}` : ''} Pokémon, or export from current selection.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={10} style={{width:'100%'}} />
      <div style={{marginTop:8, display:'flex', gap:8}}>
        <button onClick={doImport} disabled={importing}>&gt; Import</button>
        {exportList && (
          <button className="secondary" onClick={doExport}>&gt; {exportLabel || 'Export'}</button>
        )}
        {error && <span style={{color:'#ff8'}}>{error}</span>}
      </div>
    </section>
  );
}
