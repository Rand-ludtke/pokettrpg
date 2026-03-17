/**
 * ReplayTab - Browse and view battle replays
 */

import React, { useState, useEffect, useCallback } from 'react';
import ReplayViewer from './ReplayViewer';
import type { PoketTRPGClient } from '../net/pokettrpgClient';

interface ReplayMeta {
  id: string;
  room?: { id: string; name: string };
  createdAt?: number;
  turns?: number;
  size?: number;
}

interface ReplayTabProps {
  client: PoketTRPGClient;
}

const ReplayTab: React.FC<ReplayTabProps> = ({ client }) => {
  const [replays, setReplays] = useState<ReplayMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  
  // Load replay list
  const loadReplays = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const base = client.getServerEndpoint();
      const res = await fetch(`${base}/api/replays`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      
      // Fetch metadata for each replay
      const withMeta = await Promise.all(
        list.map(async (item: { id: string; size: number }) => {
          try {
            const metaRes = await fetch(`${base}/api/replays/${item.id}/meta`);
            if (metaRes.ok) {
              const meta = await metaRes.json();
              return { ...item, ...meta };
            }
          } catch {}
          return item;
        })
      );
      
      // Sort by createdAt descending (newest first)
      withMeta.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      setReplays(withMeta);
    } catch (err: any) {
      setError(err.message || 'Failed to load replays');
    } finally {
      setLoading(false);
    }
  }, [client]);
  
  useEffect(() => {
    loadReplays();
  }, [loadReplays]);
  
  const handleSelectReplay = (id: string) => {
    setSelectedReplayId(id);
  };
  
  const handleCloseViewer = () => {
    setSelectedReplayId(null);
  };
  
  // If a replay is selected, show the viewer
  if (selectedReplayId) {
    return (
      <ReplayViewer
        replayId={selectedReplayId}
        onClose={handleCloseViewer}
      />
    );
  }
  
  // Show replay list
  return (
    <div className="replay-tab">
      <div className="replay-tab__header">
        <h2>Battle Replays</h2>
        <button onClick={loadReplays} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      
      {error && (
        <div className="replay-tab__error">
          <p>{error}</p>
          <button onClick={loadReplays}>Retry</button>
        </div>
      )}
      
      {!loading && !error && replays.length === 0 && (
        <div className="replay-tab__empty">
          <p>No replays found</p>
          <p className="replay-tab__hint">
            Complete a battle to save a replay automatically.
          </p>
        </div>
      )}
      
      {replays.length > 0 && (
        <div className="replay-tab__list">
          {replays.map(replay => (
            <div
              key={replay.id}
              className="replay-tab__item"
              onClick={() => handleSelectReplay(replay.id)}
            >
              <div className="replay-tab__item-title">
                {replay.room?.name || `Replay ${replay.id}`}
              </div>
              <div className="replay-tab__item-meta">
                {replay.createdAt && (
                  <span>{new Date(replay.createdAt).toLocaleDateString()}</span>
                )}
                {replay.turns !== undefined && (
                  <span>{replay.turns} turns</span>
                )}
                {replay.size !== undefined && (
                  <span>{Math.round(replay.size / 1024)}KB</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReplayTab;
