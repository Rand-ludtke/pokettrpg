import React, { useCallback, useMemo, useState } from 'react';
import {
  getCustomDex,
  getCustomLearnsets,
  loadShowdownDex,
  normalizeName,
  saveCustomDex,
  saveCustomLearnset,
} from '../data/adapter';
import { getClient } from '../net/pokettrpgClient';

type ExternalDex = {
  species: Record<string, { id: string; name: string; types: string[]; baseStats: Record<string, number>; moves: string[] }>;
  moves: Record<string, { id: string; name: string; type: string; category: string; basePower: number; accuracy?: number | true; priority?: number }>;
};

type SyncDiff = {
  missingOnClient: { species: Record<string, any>; moves: Record<string, any> };
  missingOnServer: { species: Record<string, any>; moves: Record<string, any> };
};

function trimBase(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function resolveApi(base: string, path: string): string {
  const normalized = trimBase(base);
  if (!normalized) return path;
  try {
    const url = new URL(path, normalized.endsWith('/') ? normalized : `${normalized}/`);
    return url.toString();
  } catch {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${normalized}${suffix}`;
  }
}

export function CustomsImportExport() {
  const client = useMemo(() => getClient(), []);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [serverUrl, setServerUrl] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('ttrpg.customDexServerUrl');
      if (stored) return stored;
    } catch {}
    return client.getServerEndpoint();
  });

  const exportCustoms = useCallback(() => {
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
    } catch (e: any) {
      setError(e?.message || 'Failed to export');
    }
  }, []);

  const importCustoms = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null); setOk(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || '{}'));
        if (obj.dex) localStorage.setItem('ttrpg.customDex', JSON.stringify(obj.dex));
        if (obj.learnsets) localStorage.setItem('ttrpg.customLearnsets', JSON.stringify(obj.learnsets));
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
        setOk('Customs imported. Use the Reload banner at the top to apply.');
      } catch (err: any) {
        setError(err?.message || 'Invalid file');
      }
    };
    reader.readAsText(file);
  }, []);

  const buildExternalDex = useCallback(async (): Promise<ExternalDex> => {
    const dex = getCustomDex();
    const learnsets = getCustomLearnsets();
    const showdown = await loadShowdownDex();
    const usedMoves = new Set<string>();
    const species: ExternalDex['species'] = {};
    for (const key of Object.keys(dex)) {
      const entry = dex[key];
      const ls = learnsets[key]?.learnset || {};
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
    const moves: ExternalDex['moves'] = {};
    for (const moveId of usedMoves) {
      const mv: any = (showdown.moves as any)[moveId];
      if (!mv) continue;
      moves[moveId] = {
        id: moveId,
        name: mv.name,
        type: mv.type,
        category: mv.category,
        basePower: mv.basePower ?? 0,
        ...(mv.accuracy != null ? { accuracy: mv.accuracy } : {}),
        ...(mv.priority != null ? { priority: mv.priority } : {}),
      };
    }
    return { species, moves };
  }, []);

  const exportExternalDexFile = useCallback(async () => {
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
  }, [buildExternalDex]);

  const uploadAllToServer = useCallback(async () => {
    setError(null); setOk(null);
    const base = trimBase(serverUrl || client.getServerEndpoint());
    if (!base) { setError('Enter server URL'); return; }
    try {
      const external = await buildExternalDex();
      const res = await fetch(resolveApi(base, '/api/customdex/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(external),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const json = await res.json().catch(() => ({}));
      const addedS = Number(json?.added?.species ?? Object.keys(external.species).length);
      const addedM = Number(json?.added?.moves ?? Object.keys(external.moves).length);
      setOk(`Uploaded to server. Added ${addedS} species, ${addedM} moves.`);
    } catch (e: any) {
      setError(e?.message || 'Failed to upload to server');
    }
  }, [buildExternalDex, client, serverUrl]);

  const syncWithServer = useCallback(async () => {
    setError(null); setOk(null); setSyncing(true); setDiff(null);
    const base = trimBase(serverUrl || client.getServerEndpoint());
    if (!base) { setError('Enter server URL'); setSyncing(false); return; }
    try {
      const external = await buildExternalDex();
      const res = await fetch(resolveApi(base, '/api/customdex/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(external),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const payload = await res.json();
      const missingOnClient = payload?.missingOnClient || { species: {}, moves: {} };
      const missingOnServer = payload?.missingOnServer || { species: {}, moves: {} };
      setDiff({ missingOnClient, missingOnServer });
      const addedClientSpecies = Object.keys(missingOnClient.species || {}).length;
      const addedClientMoves = Object.keys(missingOnClient.moves || {}).length;
      const addedServerSpecies = Object.keys(missingOnServer.species || {}).length;
      const addedServerMoves = Object.keys(missingOnServer.moves || {}).length;
      setOk(`Sync complete. Server → You: ${addedClientSpecies} species, ${addedClientMoves} moves. You → Server: ${addedServerSpecies} species, ${addedServerMoves} moves.`);
    } catch (e: any) {
      setError(e?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [buildExternalDex, client, serverUrl]);

  const mergeIntoLocal = useCallback((missing: { species: Record<string, any>; moves: Record<string, any> }) => {
    try {
      const species = missing?.species || {};
      let inserted = 0;
      for (const id of Object.keys(species)) {
        const data = species[id];
        if (!data) continue;
        saveCustomDex(id, {
          name: data.name || id,
          types: data.types || [],
          baseStats: data.baseStats || { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
        } as any);
        const ls: Record<string, any> = {};
        for (const mv of data.moves || []) {
          ls[normalizeName(String(mv))] = ['9L1'];
        }
        if (Object.keys(ls).length) saveCustomLearnset(id, ls);
        inserted++;
      }
      try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      setOk(`Imported ${inserted} species from server. Reload banner will appear to apply.`);
    } catch (e: any) {
      setError(e?.message || 'Failed merging into local');
    }
  }, []);

  const importMissingFromServer = useCallback(() => {
    if (!diff) { setError('Run Sync first'); return; }
    mergeIntoLocal(diff.missingOnClient || { species: {}, moves: {} });
  }, [diff, mergeIntoLocal]);

  const uploadMissingToServer = useCallback(async () => {
    setError(null); setOk(null);
    const base = trimBase(serverUrl || client.getServerEndpoint());
    if (!base) { setError('Enter server URL'); return; }
    if (!diff) { setError('Run Sync first'); return; }
    try {
      const payload = {
        species: diff.missingOnServer?.species || {},
        moves: diff.missingOnServer?.moves || {},
      };
      const res = await fetch(resolveApi(base, '/api/customdex/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const json = await res.json().catch(() => ({}));
      const addedS = Number(json?.added?.species ?? Object.keys(payload.species).length);
      const addedM = Number(json?.added?.moves ?? Object.keys(payload.moves).length);
      setOk(`Uploaded to server: ${addedS} species, ${addedM} moves.`);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    }
  }, [client, diff, serverUrl]);

  // One-click sync: downloads from server to client and uploads client data to server in one step
  const quickSync = useCallback(async () => {
    setError(null); setOk(null); setSyncing(true); setDiff(null);
    const base = trimBase(serverUrl || client.getServerEndpoint());
    if (!base) { setError('Enter server URL'); setSyncing(false); return; }
    try {
      // Build local dex
      const external = await buildExternalDex();
      // Get diff from server
      const syncRes = await fetch(resolveApi(base, '/api/customdex/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(external),
      });
      if (!syncRes.ok) throw new Error(`Server responded ${syncRes.status}`);
      const payload = await syncRes.json();
      const missingOnClient = payload?.missingOnClient || { species: {}, moves: {} };
      const missingOnServer = payload?.missingOnServer || { species: {}, moves: {} };
      let importedCount = 0;
      let uploadedSpecies = 0;
      let uploadedMoves = 0;

      // Auto-import what we're missing from server
      const speciesCount = Object.keys(missingOnClient?.species || {}).length;
      if (speciesCount > 0) {
        for (const id of Object.keys(missingOnClient.species || {})) {
          const data = missingOnClient.species[id];
          if (!data) continue;
          saveCustomDex(id, {
            name: data.name || id,
            types: data.types || [],
            baseStats: data.baseStats || { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
          } as any);
          const ls: Record<string, any> = {};
          for (const mv of data.moves || []) {
            ls[normalizeName(String(mv))] = ['9L1'];
          }
          if (Object.keys(ls).length) saveCustomLearnset(id, ls);
          importedCount++;
        }
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      }

      // Auto-upload what server is missing from us
      const serverSpeciesCount = Object.keys(missingOnServer?.species || {}).length;
      const serverMovesCount = Object.keys(missingOnServer?.moves || {}).length;
      if (serverSpeciesCount > 0 || serverMovesCount > 0) {
        const uploadPayload = {
          species: missingOnServer?.species || {},
          moves: missingOnServer?.moves || {},
        };
        const uploadRes = await fetch(resolveApi(base, '/api/customdex/upload'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(uploadPayload),
        });
        if (uploadRes.ok) {
          const uploadJson = await uploadRes.json().catch(() => ({}));
          uploadedSpecies = Number(uploadJson?.added?.species ?? serverSpeciesCount);
          uploadedMoves = Number(uploadJson?.added?.moves ?? serverMovesCount);
        }
      }

      setDiff({ missingOnClient, missingOnServer });
      const messages: string[] = [];
      if (importedCount > 0) messages.push(`Imported ${importedCount} species from server`);
      if (uploadedSpecies > 0 || uploadedMoves > 0) messages.push(`Uploaded ${uploadedSpecies} species, ${uploadedMoves} moves to server`);
      if (messages.length === 0) messages.push('Already in sync!');
      setOk(messages.join('. ') + (importedCount > 0 ? ' (Reload to apply)' : ''));
    } catch (e: any) {
      setError(e?.message || 'Quick sync failed');
    } finally {
      setSyncing(false);
    }
  }, [buildExternalDex, client, serverUrl]);

  const applyLobbyServerUrl = useCallback(() => {
    const next = client.getServerEndpoint();
    setServerUrl(next);
    try { localStorage.setItem('ttrpg.customDexServerUrl', next); } catch {}
  }, [client]);

  const handleServerUrlChange = useCallback((value: string) => {
    setServerUrl(value);
    try { localStorage.setItem('ttrpg.customDexServerUrl', value); } catch {}
  }, []);

  return (
    <section className="panel">
      <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Custom Dex Sync</span>
        <button className="mini" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '▲ Hide Options' : '▼ Show Options'}
        </button>
      </h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={quickSync} disabled={syncing} style={{ fontWeight: 'bold', background: 'var(--accent, #008080)', padding: '8px 16px' }}>
          🔄 Sync with Server
        </button>
        {ok && <span style={{ color: '#7f7' }}>{ok}</span>}
        {error && <span style={{ color: '#ff8' }}>{error}</span>}
      </div>
      {showAdvanced && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8, borderTop: '1px solid #333', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={exportCustoms}>&gt; Export Customs</button>
            <label className="button-like">
              <input type="file" accept="application/json" onChange={importCustoms} style={{ display: 'none' }} />
              <span>&gt; Import Customs</span>
            </label>
            <button onClick={exportExternalDexFile}>&gt; Export External Dex</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dim">Server URL</span>
              <input
                value={serverUrl}
                onChange={e => handleServerUrlChange(e.target.value)}
                placeholder={client.getServerEndpoint()}
                style={{ minWidth: 280 }}
              />
            </label>
            <button className="mini" onClick={applyLobbyServerUrl}>Use Lobby Server</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={syncWithServer} disabled={syncing}>&gt; Sync Only</button>
            <button onClick={importMissingFromServer} disabled={!diff}>&gt; Import Missing</button>
            <button onClick={uploadMissingToServer} disabled={!diff}>&gt; Upload Missing</button>
            <button onClick={uploadAllToServer}>&gt; Upload All</button>
          </div>
          {diff ? (
            <div className="dim" style={{ fontSize: '0.9em' }}>
              <div>Server → You: {Object.keys(diff.missingOnClient?.species || {}).length} species, {Object.keys(diff.missingOnClient?.moves || {}).length} moves.</div>
              <div>You → Server: {Object.keys(diff.missingOnServer?.species || {}).length} species, {Object.keys(diff.missingOnServer?.moves || {}).length} moves.</div>
            </div>
          ) : (
            <div className="dim" style={{ fontSize: '0.9em' }}>
              Quick Sync automatically imports from server and uploads your changes. Use advanced options for manual control.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
