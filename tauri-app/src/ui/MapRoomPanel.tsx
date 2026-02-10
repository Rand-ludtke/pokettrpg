import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapState, MapToken, PoketTRPGClient } from '../net/pokettrpgClient';

function toRgba(color: string, opacity: number): string {
  const hex = (color || '').trim();
  if (/^#?[0-9a-f]{6}$/i.test(hex)) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color || `rgba(90,90,90,${opacity})`;
}

type DragState = {
  tokenId: string;
  offsetX: number;
  offsetY: number;
};

export function MapRoomPanel({
  roomId,
  client,
  isOwner,
  players,
}: {
  roomId: string;
  client: PoketTRPGClient;
  isOwner: boolean;
  players?: Array<{ id: string; username?: string; name?: string }>;
}) {
  const [mapState, setMapState] = useState<MapState | null>(() => client.getMapState(roomId));
  const [draft, setDraft] = useState<MapState | null>(() => client.getMapState(roomId));
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const dragRef = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = client.on('mapState', payload => {
      if (payload.roomId !== roomId) return;
      setMapState(payload.state);
      setDraft(prev => (prev ? { ...payload.state } : payload.state));
    });
    return () => unsub();
  }, [client, roomId]);

  useEffect(() => {
    if (!mapState) return;
    setDraft(mapState);
  }, [mapState]);

  const handlePointerDown = useCallback((token: MapToken, e: React.PointerEvent<HTMLDivElement>) => {
    const canDrag = isOwner || (!token.ownerId || token.ownerId === client.user?.id);
    if (!canDrag) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - token.x;
    const offsetY = e.clientY - rect.top - token.y;
    dragRef.current = { tokenId: token.id, offsetX, offsetY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [client.user?.id, isOwner]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !containerRef.current || !mapState) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - dragRef.current.offsetX;
    const y = e.clientY - rect.top - dragRef.current.offsetY;
    setMapState(prev => {
      if (!prev) return prev;
      const nextTokens = prev.tokens.map(t => t.id === dragRef.current?.tokenId ? { ...t, x, y } : t);
      return { ...prev, tokens: nextTokens };
    });
  }, [mapState]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !mapState) return;
    const token = mapState.tokens.find(t => t.id === dragRef.current?.tokenId);
    if (token) {
      let x = token.x;
      let y = token.y;
      if (snapToGrid && mapState.gridSize) {
        const snap = mapState.gridSize;
        x = Math.round(x / snap) * snap;
        y = Math.round(y / snap) * snap;
        setMapState(prev => {
          if (!prev) return prev;
          return { ...prev, tokens: prev.tokens.map(t => t.id === token.id ? { ...t, x, y } : t) };
        });
      }
      client.moveMapToken(roomId, token.id, x, y);
    }
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [client, mapState, roomId, snapToGrid]);

  const updateDraftToken = useCallback((tokenId: string, patch: Partial<MapToken>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const tokens = prev.tokens.map(t => t.id === tokenId ? { ...t, ...patch } : t);
      return { ...prev, tokens };
    });
  }, []);

  const removeDraftToken = useCallback((tokenId: string) => {
    setDraft(prev => {
      if (!prev) return prev;
      return { ...prev, tokens: prev.tokens.filter(t => t.id !== tokenId) };
    });
  }, []);

  const addDraftToken = useCallback(() => {
    setDraft(prev => {
      if (!prev) return prev;
      const id = `token-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const size = prev.gridSize || 32;
      const next: MapToken = {
        id,
        name: 'Token',
        x: 40,
        y: 40,
        size,
        color: '#5aa2ff',
      };
      return { ...prev, tokens: [...prev.tokens, next] };
    });
  }, []);

  const addTrainerToken = useCallback(() => {
    setDraft(prev => {
      if (!prev) return prev;
      const id = `trainer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const size = prev.gridSize || 32;
      let sprite: string | undefined;
      try {
        const storedImage = localStorage.getItem('ttrpg.trainerImage') || '';
        if (storedImage) sprite = storedImage;
      } catch {}
      const next: MapToken = {
        id,
        name: 'Trainer',
        x: 40,
        y: 40,
        size,
        color: '#3cb371',
        sprite,
        ownerId: client.user?.id || undefined,
      };
      return { ...prev, tokens: [...prev.tokens, next] };
    });
  }, [client.user?.id]);

  const addTeamTokens = useCallback(() => {
    setDraft(prev => {
      if (!prev) return prev;
      const size = prev.gridSize || 32;
      const baseX = 40;
      const baseY = 40;
      const spacing = size + 8;
      const additions: MapToken[] = Array.from({ length: 6 }, (_, idx) => ({
        id: `team-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 4)}`,
        name: `P${idx + 1}`,
        x: baseX + (idx % 3) * spacing,
        y: baseY + Math.floor(idx / 3) * spacing,
        size,
        color: '#5aa2ff',
        ownerId: client.user?.id || undefined,
      }));
      return { ...prev, tokens: [...prev.tokens, ...additions] };
    });
  }, [client.user?.id]);

  const addPlayerTokens = useCallback(() => {
    if (!players || players.length === 0) return;
    setDraft(prev => {
      if (!prev) return prev;
      const size = prev.gridSize || 32;
      const baseX = 40;
      const baseY = 40;
      const spacing = size + 10;
      const additions: MapToken[] = players.map((pl, idx) => ({
        id: `player-${pl.id}`,
        name: pl.username || pl.name || 'Player',
        x: baseX + (idx % 4) * spacing,
        y: baseY + Math.floor(idx / 4) * spacing,
        size,
        color: '#f1a33c',
        ownerId: pl.id,
      }));
      return { ...prev, tokens: [...prev.tokens, ...additions] };
    });
  }, [players]);

  const snapAllTokens = useCallback(() => {
    if (!draft || !draft.gridSize) return;
    const snap = draft.gridSize;
    const tokens = draft.tokens.map(t => ({
      ...t,
      x: Math.round(t.x / snap) * snap,
      y: Math.round(t.y / snap) * snap,
    }));
    const next = { ...draft, tokens };
    setDraft(next);
    client.updateMapState(roomId, next);
  }, [client, draft, roomId]);

  const clearAllTokens = useCallback(() => {
    if (!draft) return;
    if (!confirm('Clear all tokens?')) return;
    const next = { ...draft, tokens: [] };
    setDraft(next);
    client.updateMapState(roomId, next);
  }, [client, draft, roomId]);

  const gridStyle = useMemo(() => {
    if (!mapState) return {} as React.CSSProperties;
    if (!mapState.showGrid) return {} as React.CSSProperties;
    const color = toRgba(mapState.gridColor, mapState.gridOpacity);
    const size = mapState.gridSize;
    return {
      backgroundImage: `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px`,
    } as React.CSSProperties;
  }, [mapState]);

  if (!mapState) {
    return <div className="dim">Map state not available yet.</div>;
  }

  const width = mapState.width || 960;
  const height = mapState.height || 640;
  const showLabels = mapState.showLabels ?? true;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {isOwner && draft && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px 110px 110px', gap: 8, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            Background URL
            <input value={draft.background || ''} onChange={e => setDraft({ ...draft, background: e.target.value })} placeholder="https://..." />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Width
            <input type="number" min={200} value={draft.width} onChange={e => setDraft({ ...draft, width: Number(e.target.value) || 960 })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Height
            <input type="number" min={200} value={draft.height} onChange={e => setDraft({ ...draft, height: Number(e.target.value) || 640 })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Grid Size
            <input type="number" min={8} max={128} value={draft.gridSize} onChange={e => setDraft({ ...draft, gridSize: Number(e.target.value) || 32 })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Grid Opacity
            <input type="number" min={0} max={1} step={0.05} value={draft.gridOpacity} onChange={e => setDraft({ ...draft, gridOpacity: Number(e.target.value) || 0.35 })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Grid Color
            <input value={draft.gridColor} onChange={e => setDraft({ ...draft, gridColor: e.target.value })} placeholder="#5a5a5a" />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={draft.showGrid} onChange={e => setDraft({ ...draft, showGrid: e.target.checked })} />
            Show Grid
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={draft.showLabels ?? true} onChange={e => setDraft({ ...draft, showLabels: e.target.checked })} />
            Show Labels
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={draft.lockTokens ?? false} onChange={e => setDraft({ ...draft, lockTokens: e.target.checked })} />
            Lock Tokens
          </label>
          <button
            type="button"
            className="mini secondary"
            onClick={() => setDraft({ ...draft, background: '' })}
          >
            Clear Background
          </button>
          <button
            type="button"
            className="mini"
            onClick={() => setDraft({ ...draft, showGrid: !draft.showGrid })}
          >
            Toggle Grid
          </button>
          <button
            type="button"
            onClick={() => client.updateMapState(roomId, draft)}
            style={{ gridColumn: '1 / -1' }}
          >
            Save Map Settings
          </button>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={addDraftToken} className="mini">
              + Add Token
            </button>
            <button type="button" onClick={addTrainerToken} className="mini">
              + Trainer Token
            </button>
            <button type="button" onClick={addTeamTokens} className="mini">
              + Team Tokens
            </button>
            <button type="button" onClick={addPlayerTokens} className="mini">
              + Player Tokens
            </button>
            <button type="button" onClick={snapAllTokens} className="mini secondary">
              Snap All to Grid
            </button>
            <button type="button" onClick={clearAllTokens} className="mini secondary">
              Clear Tokens
            </button>
          </div>
          {draft.tokens.length > 0 && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 6 }}>
              {draft.tokens.map(token => (
                <div key={token.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 90px auto', gap: 6, alignItems: 'center' }}>
                  <input value={token.name} onChange={e => updateDraftToken(token.id, { name: e.target.value })} />
                  <input type="number" min={8} value={token.size || 32} onChange={e => updateDraftToken(token.id, { size: Number(e.target.value) || 32 })} />
                  <input value={token.color || ''} onChange={e => updateDraftToken(token.id, { color: e.target.value })} placeholder="#5aa2ff" />
                  <input value={token.ownerId || ''} onChange={e => updateDraftToken(token.id, { ownerId: e.target.value })} placeholder="ownerId" />
                  <input value={token.sprite || ''} onChange={e => updateDraftToken(token.id, { sprite: e.target.value })} placeholder="sprite url" />
                  <button type="button" className="mini secondary" onClick={() => removeDraftToken(token.id)}>Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => client.updateMapState(roomId, draft)} className="mini">
                Save Tokens
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width,
          height,
          border: '1px solid #444',
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: '#1b1b1b',
          backgroundImage: mapState.background ? `url(${mapState.background})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {mapState.showGrid && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...gridStyle }} />
        )}
        {mapState.tokens.map(token => {
          const size = token.size || 32;
          const canDrag = isOwner || (!token.ownerId || token.ownerId === client.user?.id);
          return (
            <div key={token.id} style={{ position: 'absolute', left: token.x, top: token.y }}>
              <div
                onPointerDown={(e) => handlePointerDown(token, e)}
                style={{
                  width: size,
                  height: size,
                  borderRadius: 6,
                  background: token.sprite ? `url(${token.sprite}) center/cover no-repeat` : (token.color || '#58a'),
                  border: '1px solid rgba(255,255,255,0.4)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: canDrag ? 'grab' : 'not-allowed',
                  userSelect: 'none',
                  opacity: canDrag ? 1 : 0.7,
                }}
                title={token.name}
              >
                {!token.sprite && token.name?.slice(0, 2).toUpperCase()}
              </div>
              {showLabels && token.name && (
                <div style={{ marginTop: 2, fontSize: 10, color: '#eee', textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
                  {token.name}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} />
        Snap tokens to grid
      </label>
    </div>
  );
}
