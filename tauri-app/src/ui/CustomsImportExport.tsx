import React, { useCallback, useMemo, useState } from 'react';
import {
  getCustomDex,
  getCustomMoves,
  getCustomAbilities,
  getCustomLearnsets,
  getCustomItems,
  getCustomSprites,
  loadShowdownDex,
  normalizeName,
  saveCustomDex,
  saveCustomMove,
  saveCustomAbility,
  saveCustomLearnset,
  saveCustomItem,
  saveCustomSprite,
  SpriteSlot,
} from '../data/adapter';
import { getClient } from '../net/pokettrpgClient';

type ExternalDex = {
  species: Record<string, { id: string; name: string; types: string[]; baseStats: Record<string, number>; moves: string[] }>;
  moves: Record<string, { id: string; name: string; type: string; category: string; basePower: number; accuracy?: number | true; priority?: number }>;
  abilities: Record<string, { id: string; name: string; desc?: string; shortDesc?: string }>;
};

type CustomSprites = Record<string, Partial<Record<SpriteSlot, string>>>;
type ExternalDexPayload = ExternalDex & { sprites: CustomSprites; items?: Record<string, any> };

type SyncDiff = {
  missingOnClient: { species: Record<string, any>; moves: Record<string, any>; abilities: Record<string, any>; sprites: CustomSprites };
  missingOnServer: { species: Record<string, any>; moves: Record<string, any>; abilities: Record<string, any>; sprites: CustomSprites };
};

function countSpriteSlots(sprites?: CustomSprites): number {
  if (!sprites) return 0;
  let total = 0;
  for (const entry of Object.values(sprites)) {
    total += Object.keys(entry || {}).length;
  }
  return total;
}

const ALLOWED_SPRITE_SLOTS = new Set<SpriteSlot>([
  'front', 'shiny', 'back', 'back-shiny',
  'gen5', 'gen5-shiny', 'gen5-back', 'gen5-back-shiny',
  'home', 'home-shiny', 'home-back', 'home-back-shiny',
  'ani', 'ani-shiny', 'ani-back', 'ani-back-shiny',
]);

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
      const moves = getCustomMoves();
      const abilities = getCustomAbilities();
      const sprites = getCustomSprites();
      const items = getCustomItems();
      const blob = new Blob([JSON.stringify({ dex, learnsets, moves, abilities, sprites, items }, null, 2)], { type: 'application/json' });
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
        if (obj.items) localStorage.setItem('ttrpg.customItems', JSON.stringify(obj.items));
        if (obj.moves) localStorage.setItem('ttrpg.customMoves', JSON.stringify(obj.moves));
        if (obj.abilities) localStorage.setItem('ttrpg.customAbilities', JSON.stringify(obj.abilities));
        const sprites = obj.sprites || obj.customSprites;
        if (sprites && typeof sprites === 'object') {
          for (const [id, slots] of Object.entries(sprites)) {
            const slotMap = slots as Record<string, string>;
            for (const [slot, dataUrl] of Object.entries(slotMap || {})) {
              if (!dataUrl) continue;
              if (ALLOWED_SPRITE_SLOTS.has(slot as SpriteSlot)) {
                saveCustomSprite(id, slot as SpriteSlot, String(dataUrl));
              }
            }
          }
        }
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
        setOk('Customs imported. Use the Reload banner at the top to apply.');
      } catch (err: any) {
        setError(err?.message || 'Invalid file');
      }
    };
    reader.readAsText(file);
  }, []);

  const buildExternalDex = useCallback(async (): Promise<ExternalDexPayload> => {
    const dex = getCustomDex();
    const learnsets = getCustomLearnsets();
    const sprites = getCustomSprites();
    const customMoves = getCustomMoves();
    const customAbilities = getCustomAbilities();
    const showdown = await loadShowdownDex();
    const usedMoves = new Set<string>();
    const usedAbilities = new Set<string>();
    Object.keys(customMoves || {}).forEach(id => { const n = normalizeName(id); if (n) usedMoves.add(n); });
    Object.keys(customAbilities || {}).forEach(id => { const n = normalizeName(id); if (n) usedAbilities.add(n); });
    const species: ExternalDex['species'] = {};
    for (const key of Object.keys(dex)) {
      const entry = dex[key];
      const ls = learnsets[key]?.learnset || {};
      const moveIds = Object.keys(ls || {});
      moveIds.forEach(m => usedMoves.add(normalizeName(m)));
      Object.values(entry.abilities || {}).forEach(ab => {
        const id = normalizeName(String(ab || ''));
        if (id) usedAbilities.add(id);
      });
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
      const mv: any = (customMoves as any)[moveId] || (showdown.moves as any)[moveId];
      if (!mv) continue;
      moves[moveId] = {
        id: moveId,
        name: mv.name || moveId,
        type: mv.type || 'Normal',
        category: mv.category || 'Status',
        basePower: mv.basePower ?? 0,
        ...(mv.accuracy != null ? { accuracy: mv.accuracy } : {}),
        ...(mv.priority != null ? { priority: mv.priority } : {}),
      };
    }
    const abilities: ExternalDex['abilities'] = {};
    for (const abilityId of usedAbilities) {
      const ab: any = (customAbilities as any)[abilityId] || (showdown.abilities as any)[abilityId];
      if (!ab) continue;
      abilities[abilityId] = {
        id: abilityId,
        name: ab.name || abilityId,
        ...(ab.desc ? { desc: ab.desc } : {}),
        ...(ab.shortDesc ? { shortDesc: ab.shortDesc } : {}),
      };
    }
    return { species, moves, abilities, sprites };
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
      const addedA = Number(json?.added?.abilities ?? Object.keys(external.abilities || {}).length);
      const addedSprites = Number(json?.added?.sprites ?? countSpriteSlots(external.sprites));
      setOk(`Uploaded to server. Added ${addedS} species, ${addedM} moves, ${addedA} abilities, ${addedSprites} sprites.`);
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
      const missingOnClient = payload?.missingOnClient || { species: {}, moves: {}, abilities: {}, sprites: {} };
      const missingOnServer = payload?.missingOnServer || { species: {}, moves: {}, abilities: {}, sprites: {} };
      setDiff({ missingOnClient, missingOnServer });
      const addedClientSpecies = Object.keys(missingOnClient.species || {}).length;
      const addedClientMoves = Object.keys(missingOnClient.moves || {}).length;
      const addedClientAbilities = Object.keys(missingOnClient.abilities || {}).length;
      const addedClientSprites = countSpriteSlots(missingOnClient.sprites || {});
      const addedServerSpecies = Object.keys(missingOnServer.species || {}).length;
      const addedServerMoves = Object.keys(missingOnServer.moves || {}).length;
      const addedServerAbilities = Object.keys(missingOnServer.abilities || {}).length;
      const addedServerSprites = countSpriteSlots(missingOnServer.sprites || {});
      setOk(`Sync complete. Server → You: ${addedClientSpecies} species, ${addedClientMoves} moves, ${addedClientAbilities} abilities, ${addedClientSprites} sprites. You → Server: ${addedServerSpecies} species, ${addedServerMoves} moves, ${addedServerAbilities} abilities, ${addedServerSprites} sprites.`);
    } catch (e: any) {
      setError(e?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [buildExternalDex, client, serverUrl]);

  const mergeIntoLocal = useCallback((missing: { species: Record<string, any>; moves: Record<string, any>; abilities?: Record<string, any>; sprites?: CustomSprites }) => {
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
      const moves = missing?.moves || {};
      let insertedMoves = 0;
      for (const [id, move] of Object.entries(moves)) {
        if (!move) continue;
        saveCustomMove(id, move as any);
        insertedMoves++;
      }
      const abilities = missing?.abilities || {};
      let insertedAbilities = 0;
      for (const [id, ability] of Object.entries(abilities)) {
        if (!ability) continue;
        saveCustomAbility(id, ability as any);
        insertedAbilities++;
      }
      const sprites = missing?.sprites || {};
      let spriteSlots = 0;
      for (const [id, slots] of Object.entries(sprites)) {
        const slotMap = slots as Record<string, string>;
        for (const [slot, dataUrl] of Object.entries(slotMap || {})) {
          if (!dataUrl) continue;
          if (slot === 'front' || slot === 'shiny' || slot === 'back' || slot === 'back-shiny') {
            saveCustomSprite(id, slot, String(dataUrl));
            spriteSlots++;
          }
        }
      }
      try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      setOk(`Imported ${inserted} species, ${insertedMoves} moves, ${insertedAbilities} abilities, and ${spriteSlots} sprites to local storage. Reload to apply.`);
    } catch (e: any) {
      setError(e?.message || 'Failed merging into local');
    }
  }, []);

  const importMissingFromServer = useCallback(() => {
    if (!diff) { setError('Run Sync first'); return; }
    mergeIntoLocal(diff.missingOnClient || { species: {}, moves: {}, abilities: {}, sprites: {} });
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
        abilities: diff.missingOnServer?.abilities || {},
        sprites: diff.missingOnServer?.sprites || {},
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
      const addedA = Number(json?.added?.abilities ?? Object.keys(payload.abilities).length);
      const addedSprites = Number(json?.added?.sprites ?? countSpriteSlots(payload.sprites));
      setOk(`Uploaded to server: ${addedS} species, ${addedM} moves, ${addedA} abilities, ${addedSprites} sprites.`);
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
      const missingOnClient = payload?.missingOnClient || { species: {}, moves: {}, abilities: {}, sprites: {} };
      const missingOnServer = payload?.missingOnServer || { species: {}, moves: {}, abilities: {}, sprites: {} };
      let importedCount = 0;
      let importedMoves = 0;
      let importedAbilities = 0;
      let uploadedSpecies = 0;
      let uploadedMoves = 0;
      let uploadedAbilities = 0;
      let importedSprites = 0;
      let uploadedSprites = 0;

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

      const movesCount = Object.keys(missingOnClient?.moves || {}).length;
      if (movesCount > 0) {
        for (const [id, move] of Object.entries(missingOnClient.moves || {})) {
          if (!move) continue;
          saveCustomMove(id, move as any);
          importedMoves++;
        }
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      }

      const abilitiesCount = Object.keys(missingOnClient?.abilities || {}).length;
      if (abilitiesCount > 0) {
        for (const [id, ability] of Object.entries(missingOnClient.abilities || {})) {
          if (!ability) continue;
          saveCustomAbility(id, ability as any);
          importedAbilities++;
        }
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      }

      const spriteCount = countSpriteSlots(missingOnClient?.sprites || {});
      if (spriteCount > 0) {
        for (const [id, slots] of Object.entries(missingOnClient.sprites || {})) {
          const slotMap = slots as Record<string, string>;
          for (const [slot, dataUrl] of Object.entries(slotMap || {})) {
            if (!dataUrl) continue;
            if (slot === 'front' || slot === 'shiny' || slot === 'back' || slot === 'back-shiny') {
              saveCustomSprite(id, slot, String(dataUrl));
              importedSprites++;
            }
          }
        }
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      }

      // Auto-upload what server is missing from us
      const serverSpeciesCount = Object.keys(missingOnServer?.species || {}).length;
      const serverMovesCount = Object.keys(missingOnServer?.moves || {}).length;
      const serverAbilitiesCount = Object.keys(missingOnServer?.abilities || {}).length;
      const serverSpriteCount = countSpriteSlots(missingOnServer?.sprites || {});
      if (serverSpeciesCount > 0 || serverMovesCount > 0 || serverAbilitiesCount > 0 || serverSpriteCount > 0) {
        const uploadPayload = {
          species: missingOnServer?.species || {},
          moves: missingOnServer?.moves || {},
          abilities: missingOnServer?.abilities || {},
          sprites: missingOnServer?.sprites || {},
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
          uploadedAbilities = Number(uploadJson?.added?.abilities ?? serverAbilitiesCount);
          uploadedSprites = Number(uploadJson?.added?.sprites ?? serverSpriteCount);
        }
      }

      setDiff({ missingOnClient, missingOnServer });
      const messages: string[] = [];
      if (importedCount > 0 || importedMoves > 0 || importedAbilities > 0 || importedSprites > 0) {
        messages.push(`Imported ${importedCount} species, ${importedMoves} moves, ${importedAbilities} abilities, ${importedSprites} sprites from server`);
      }
      if (uploadedSpecies > 0 || uploadedMoves > 0 || uploadedAbilities > 0 || uploadedSprites > 0) {
        messages.push(`Uploaded ${uploadedSpecies} species, ${uploadedMoves} moves, ${uploadedAbilities} abilities, ${uploadedSprites} sprites to server`);
      }
      if (messages.length === 0) messages.push('Already in sync!');
      setOk(messages.join('. ') + (importedCount > 0 || importedSprites > 0 ? ' (Reload to apply)' : ''));
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
              <div>Server → You: {Object.keys(diff.missingOnClient?.species || {}).length} species, {Object.keys(diff.missingOnClient?.moves || {}).length} moves, {countSpriteSlots(diff.missingOnClient?.sprites || {})} sprites.</div>
              <div>You → Server: {Object.keys(diff.missingOnServer?.species || {}).length} species, {Object.keys(diff.missingOnServer?.moves || {}).length} moves, {countSpriteSlots(diff.missingOnServer?.sprites || {})} sprites.</div>
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
