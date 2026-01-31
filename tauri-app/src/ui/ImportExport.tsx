import React, { useMemo, useState } from 'react';
import { parseShowdownTeam, loadShowdownDex, toPokemon, prepareBattle, mapMoves, formatShowdownTeam } from '../data/adapter';
import { BattlePokemon } from '../types';

export function ImportExport({ 
  onImport, 
  maxCount, 
  exportList, 
  exportLabel,
  onImportAsTeam,
  teamImportLabel,
}: { 
  onImport: (team: BattlePokemon[]) => void; 
  maxCount?: number; 
  exportList?: BattlePokemon[]; 
  exportLabel?: string;
  onImportAsTeam?: (team: BattlePokemon[], teamName: string) => void;
  teamImportLabel?: string;
}) {
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parseTeam(): Promise<BattlePokemon[]> {
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
    return built;
  }

  async function doImport() {
    setImporting(true); setError(null);
    try {
      const built = await parseTeam();
      onImport(built);
    } catch (e: any) {
      setError(e?.message || 'Failed to import');
    } finally {
      setImporting(false);
    }
  }

  async function doImportAsTeam() {
    if (!onImportAsTeam) return;
    setImporting(true); setError(null);
    try {
      const built = await parseTeam();
      if (built.length === 0) {
        setError('No valid Pokémon found in import');
        return;
      }
      // Generate team name from first Pokemon or use generic
      const teamName = `Imported Team (${built[0]?.species || 'Team'})`;
      onImportAsTeam(built, teamName);
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
    <div style={{ display: 'grid', gap: 8 }}>
      <p className="dim" style={{ margin: 0, fontSize: '0.85em' }}>Paste a Showdown team to import{typeof maxCount==='number' ? ` up to ${maxCount}` : ''} Pokémon, or export from current selection.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={6} style={{width:'100%'}} />
      <div style={{ display:'flex', gap:8, flexWrap: 'wrap' }}>
        <button onClick={doImport} disabled={importing}>&gt; Import to PC</button>
        {onImportAsTeam && (
          <button onClick={doImportAsTeam} disabled={importing}>&gt; {teamImportLabel || 'Import as New Team'}</button>
        )}
        {exportList && (
          <button className="secondary" onClick={doExport}>&gt; {exportLabel || 'Export'}</button>
        )}
        {error && <span style={{color:'#ff8'}}>{error}</span>}
      </div>
    </div>
  );
}
