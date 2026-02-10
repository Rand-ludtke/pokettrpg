import React, { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FusionSelector } from './FusionSelector';
import { useSyncStatus } from '../hooks/useFusionSync';
import type { IndexBuildResult } from '../types/fusion';
import '../styles/FusionSelector.css';

const DEFAULT_SERVER_BASE = 'https://pokettrpg.duckdns.org';
const DEFAULT_WS_ENDPOINT = 'wss://pokettrpg.duckdns.org/fusion-sync';

export function FusionTab() {
  const syncStatus = useSyncStatus();
  const [serverBase, setServerBase] = useState(() => {
    try { return localStorage.getItem('ttrpg.fusionServerBase') || DEFAULT_SERVER_BASE; } catch { return DEFAULT_SERVER_BASE; }
  });
  const [wsEndpoint, setWsEndpoint] = useState(() => {
    try { return localStorage.getItem('ttrpg.fusionWsEndpoint') || DEFAULT_WS_ENDPOINT; } catch { return DEFAULT_WS_ENDPOINT; }
  });
  const [localSpritePath, setLocalSpritePath] = useState(() => {
    try { return localStorage.getItem('ttrpg.fusionLocalSprites') || ''; } catch { return ''; }
  });
  const [buildResult, setBuildResult] = useState<IndexBuildResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const [headId, setHeadId] = useState(25);
  const [bodyId, setBodyId] = useState(1);
  const [headName, setHeadName] = useState('Pikachu');
  const [bodyName, setBodyName] = useState('Bulbasaur');

  const spriteBaseUrl = useMemo(() => {
    const trimmed = (serverBase || '').replace(/\/$/, '');
    return trimmed ? `${trimmed}/fusion/sprites` : '/fusion-sprites';
  }, [serverBase]);

  const applyEndpoints = useCallback(async () => {
    try {
      if (serverBase) localStorage.setItem('ttrpg.fusionServerBase', serverBase);
      if (wsEndpoint) localStorage.setItem('ttrpg.fusionWsEndpoint', wsEndpoint);
      await invoke('set_sync_endpoint', { endpoint: wsEndpoint });
    } catch (e: any) {
      console.error('Failed to update endpoint', e);
    }
  }, [serverBase, wsEndpoint]);

  const requestVariants = useCallback(async () => {
    try {
      await invoke('request_fusion_variants', { headId, bodyId });
    } catch (e) {
      console.error('Failed to request variants', e);
    }
  }, [headId, bodyId]);

  const buildLocalIndex = useCallback(async () => {
    setBuildError(null);
    setBuildResult(null);
    try {
      if (!localSpritePath.trim()) {
        setBuildError('Enter a local sprite folder path.');
        return;
      }
      localStorage.setItem('ttrpg.fusionLocalSprites', localSpritePath);
      const result = await invoke<IndexBuildResult>('build_sprite_index', {
        basePath: localSpritePath,
        customPath: localSpritePath,
      });
      setBuildResult(result);
    } catch (e: any) {
      setBuildError(e?.message || String(e));
    }
  }, [localSpritePath]);

  const downloadPack = useCallback(() => {
    const trimmed = (serverBase || '').replace(/\/$/, '');
    if (!trimmed) return;
    window.open(`${trimmed}/fusion/pack`, '_blank');
  }, [serverBase]);

  return (
    <div className="panel" style={{ display: 'grid', gap: 16, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Infinite Fusion (Preview)</h2>
      <div className="dim">This tab only affects fusion previews; it does not change battle logic yet.</div>

      <section style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid #333', borderRadius: 8 }}>
        <div style={{ fontWeight: 600 }}>Sync Status: <span>{syncStatus}</span></div>
        <label style={{ display: 'grid', gap: 6 }}>
          Server Base (HTTP)
          <input value={serverBase} onChange={e => setServerBase(e.target.value)} placeholder="https://your-server" />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          WebSocket Endpoint
          <input value={wsEndpoint} onChange={e => setWsEndpoint(e.target.value)} placeholder="wss://your-server/fusion-sync" />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={applyEndpoints}>Apply Endpoint</button>
          <button className="secondary" onClick={downloadPack}>Download Sprite Pack</button>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid #333', borderRadius: 8 }}>
        <div style={{ fontWeight: 600 }}>Local Sprites (Optional)</div>
        <label style={{ display: 'grid', gap: 6 }}>
          Local Sprite Folder (for offline use)
          <input value={localSpritePath} onChange={e => setLocalSpritePath(e.target.value)} placeholder="D:\\Sprites\\CustomBattlers" />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={buildLocalIndex}>Build Local Index</button>
          {buildResult && (
            <div className="dim">Indexed {buildResult.spriteCount} sprites across {buildResult.fusionCount} fusions.</div>
          )}
          {buildError && <div style={{ color: '#f66' }}>{buildError}</div>}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid #333', borderRadius: 8 }}>
        <div style={{ fontWeight: 600 }}>Fusion Preview</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            Head ID
            <input type="number" value={headId} onChange={e => setHeadId(Number(e.target.value) || 0)} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            Body ID
            <input type="number" value={bodyId} onChange={e => setBodyId(Number(e.target.value) || 0)} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            Head Name
            <input value={headName} onChange={e => setHeadName(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            Body Name
            <input value={bodyName} onChange={e => setBodyName(e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={requestVariants}>Fetch Variants</button>
          <div className="dim">Sprites from: {spriteBaseUrl}</div>
        </div>
        <FusionSelector
          headId={headId}
          bodyId={bodyId}
          headName={headName}
          bodyName={bodyName}
          spriteBaseUrl={spriteBaseUrl}
          showStats={false}
        />
      </section>
    </div>
  );
}
