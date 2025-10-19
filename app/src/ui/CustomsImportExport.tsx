import React, { useEffect, useState } from 'react';
import { getCustomDex, getCustomLearnsets, loadShowdownDex, normalizeName } from '../data/adapter';

export function CustomsImportExport() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(() => {
    try { return localStorage.getItem('ttrpg.backendUrl') || 'http://raspberrypi:3000'; } catch { return 'http://raspberrypi:3000'; }
  });

  useEffect(() => {
    try { localStorage.setItem('ttrpg.backendUrl', serverUrl); } catch {}
  }, [serverUrl]);

  function exportCustoms() {
    setError(null); setOk(null);
    try {
      const dex = getCustomDex();
      const learnsets = getCustomLearnsets();
      const blob = new Blob([JSON.stringify({ dex, learnsets }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pokettrpg-customs.json'; a.click();
      URL.revokeObjectURL(url);
      setOk('Exported pokettrpg-customs.json');
    } catch (e:any) { setError(e?.message || 'Failed to export'); }
  }

  function importCustoms(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setOk(null);
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || '{}'));
        if (obj.dex) localStorage.setItem('ttrpg.customDex', JSON.stringify(obj.dex));
        if (obj.learnsets) localStorage.setItem('ttrpg.customLearnsets', JSON.stringify(obj.learnsets));
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
        setOk('Customs imported. Use the Reload banner at the top to apply.');
      } catch (e:any) { setError(e?.message || 'Invalid file'); }
    };
    reader.readAsText(file);
  }

  // Build External Dex JSON from local overlays + current learnsets
  async function buildExternalDex(): Promise<any> {
    const dex = getCustomDex();
    const learnsets = getCustomLearnsets();
    const sd = await loadShowdownDex();
    const usedMoves = new Set<string>();
    const species: Record<string, any> = {};
    for (const key of Object.keys(dex)) {
      const entry: any = (dex as any)[key] || {};
      const ls: Record<string, any> = (learnsets as any)[key]?.learnset || {};
      const moveIds = Object.keys(ls || {});
      moveIds.forEach(m => usedMoves.add(normalizeName(m)));
      species[key] = {
        id: key,
        name: entry.name || key,
        types: entry.types || [],
        baseStats: entry.baseStats || { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
        moves: moveIds,
      };
    }
    const moves: Record<string, any> = {};
    for (const mid of usedMoves) {
      const m: any = (sd.moves as any)[mid];
      if (!m) continue;
      moves[mid] = {
        id: mid,
        name: m.name,
        type: m.type,
        category: m.category,
        basePower: m.basePower ?? 0,
        ...(m.accuracy != null ? { accuracy: m.accuracy } : {}),
        ...(m.priority != null ? { priority: m.priority } : {}),
      };
    }
    return { species, moves };
  }

  async function exportExternalDexFile() {
    setError(null); setOk(null);
    try {
      const external = await buildExternalDex();
      const blob = new Blob([JSON.stringify(external, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pokettrpg-external-dex.json'; a.click();
      URL.revokeObjectURL(url);
      setOk('Exported pokettrpg-external-dex.json');
    } catch (e: any) {
      setError(e?.message || 'Failed to build external dex');
    }
  }

  async function exportExternalDexToServer() {
    setError(null); setOk(null);
    const base = (serverUrl || '').trim().replace(/\/$/, '');
    if (!base) { setError('Enter server URL'); return; }
    try {
      const external = await buildExternalDex();
      const res = await fetch(`${base}/api/custom-dex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(external),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setOk('Uploaded external dex to server');
    } catch (e:any) {
      setError(e?.message || 'Failed to upload to server');
    }
  }

  return (
    <section className="panel">
      <h3>Customs: Export / Import</h3>
      <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
        <button onClick={exportCustoms}>&gt; Export Customs</button>
        <label className="button-like">
          <input type="file" accept="application/json" onChange={importCustoms} style={{display:'none'}} />
          <span>&gt; Import Customs</span>
        </label>
        <button onClick={exportExternalDexFile}>&gt; Export External Dex (sync)</button>
        {ok && <span style={{color:'#7f7'}}>{ok}</span>}
        {error && <span style={{color:'#ff8'}}>{error}</span>}
      </div>
      <div style={{marginTop:10, display:'grid', gap:8}}>
        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
          <label>Server URL <input value={serverUrl} onChange={e=> setServerUrl(e.target.value)} style={{minWidth:320}} placeholder="http://raspberrypi:3000" /></label>
          <button onClick={exportExternalDexToServer}>&gt; Export to Server</button>
        </div>
        <div className="dim" style={{fontSize:'0.9em'}}>
          POST {`{ species, moves }`} to <code>/api/custom-dex</code>. Species come from your local customs; moves include only those referenced in the custom learnsets.
        </div>
      </div>
    </section>
  );
}
