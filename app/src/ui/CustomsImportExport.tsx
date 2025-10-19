import React, { useEffect, useState } from 'react';
import { getCustomDex, getCustomLearnsets, loadShowdownDex, normalizeName, saveCustomDex, saveCustomLearnset } from '../data/adapter';

export function CustomsImportExport() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(() => {
    try { return localStorage.getItem('ttrpg.backendUrl') || 'http://raspberrypi:3000'; } catch { return 'http://raspberrypi:3000'; }
  });
  const [syncing, setSyncing] = useState(false);
  const [diff, setDiff] = useState<null | { missingOnClient: { species: Record<string, any>, moves: Record<string, any> }, missingOnServer: { species: Record<string, any>, moves: Record<string, any> } }>(null);

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
      // Upload entire dataset; server will add only new IDs (no overwrite)
      const res = await fetch(`${base}/api/customdex/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(external),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const j = await res.json().catch(()=>({}));
      const addedS = Number(j?.added?.species ?? 0);
      const addedM = Number(j?.added?.moves ?? 0);
      setOk(`Uploaded to server. Added ${addedS} species, ${addedM} moves.`);
    } catch (e:any) {
      setError(e?.message || 'Failed to upload to server');
    }
  }

  async function syncWithServer() {
    setError(null); setOk(null); setSyncing(true); setDiff(null);
    const base = (serverUrl || '').trim().replace(/\/$/, '');
    if (!base) { setError('Enter server URL'); setSyncing(false); return; }
    try {
      const external = await buildExternalDex();
      const res = await fetch(`${base}/api/customdex/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(external)
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      const missingOnClient = data?.missingOnClient || { species: {}, moves: {} };
      const missingOnServer = data?.missingOnServer || { species: {}, moves: {} };
      setDiff({ missingOnClient, missingOnServer });
      const c1 = Object.keys(missingOnClient.species || {}).length;
      const m1 = Object.keys(missingOnClient.moves || {}).length;
      const c2 = Object.keys(missingOnServer.species || {}).length;
      const m2 = Object.keys(missingOnServer.moves || {}).length;
      setOk(`Sync complete. Server → You: ${c1} species, ${m1} moves. You → Server: ${c2} species, ${m2} moves.`);
    } catch (e:any) {
      setError(e?.message || 'Sync failed');
    } finally { setSyncing(false); }
  }

  function mergeIntoLocal(missing: { species: Record<string, any>; moves: Record<string, any> }) {
    try {
      const species = missing?.species || {};
      let added = 0;
      for (const id of Object.keys(species)) {
        const s = species[id];
        if (!s) continue;
        // Save species entry
        saveCustomDex(id, {
          name: s.name || id,
          types: s.types || [],
          baseStats: s.baseStats || { hp:1, atk:1, def:1, spa:1, spd:1, spe:1 },
        } as any);
        // Synthesize learnset from provided move list
        const ls: Record<string, any> = {};
        for (const mv of (s.moves || [])) ls[normalizeName(String(mv))] = ["9L1"];
        if (Object.keys(ls).length) saveCustomLearnset(id, ls);
        added++;
      }
      try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      setOk(`Imported ${added} species from server. Reload banner will appear to apply.`);
    } catch (e:any) {
      setError(e?.message || 'Failed merging into local');
    }
  }

  async function importMissingFromServer() {
    if (!diff) { setError('Run Sync first'); return; }
    mergeIntoLocal(diff.missingOnClient || { species:{}, moves:{} });
  }

  async function uploadMissingToServer() {
    setError(null); setOk(null);
    const base = (serverUrl || '').trim().replace(/\/$/, '');
    if (!base) { setError('Enter server URL'); return; }
    if (!diff) { setError('Run Sync first'); return; }
    try {
      const payload = {
        species: diff.missingOnServer?.species || {},
        moves: diff.missingOnServer?.moves || {},
      };
      const res = await fetch(`${base}/api/customdex/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const j = await res.json().catch(()=>({}));
      const addedS = Number(j?.added?.species ?? Object.keys(payload.species).length);
      const addedM = Number(j?.added?.moves ?? Object.keys(payload.moves).length);
      setOk(`Uploaded to server: ${addedS} species, ${addedM} moves.`);
    } catch (e:any) {
      setError(e?.message || 'Upload failed');
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
          <button onClick={syncWithServer} disabled={syncing}>&gt; Sync with Server</button>
          <button onClick={importMissingFromServer} disabled={!diff}>&gt; Import Missing from Server</button>
          <button onClick={uploadMissingToServer} disabled={!diff}>&gt; Upload Missing to Server</button>
          <button onClick={exportExternalDexToServer}>&gt; Upload All (add-only)</button>
        </div>
        {diff && (
          <div className="dim" style={{fontSize:'0.9em'}}>
            <div>
              Server → You: {Object.keys(diff.missingOnClient?.species||{}).length} species, {Object.keys(diff.missingOnClient?.moves||{}).length} moves.
            </div>
            <div>
              You → Server: {Object.keys(diff.missingOnServer?.species||{}).length} species, {Object.keys(diff.missingOnServer?.moves||{}).length} moves.
            </div>
          </div>
        )}
        {!diff && (
          <div className="dim" style={{fontSize:'0.9em'}}>
            Flow: Sync → Import Missing from Server → Upload Missing to Server. Upload All sends your full set to <code>/api/customdex/upload</code> (add-only).
          </div>
        )}
      </div>
    </section>
  );
}
