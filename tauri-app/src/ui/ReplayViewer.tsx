/**
 * ReplayViewer Component
 * Plays back battle replays with turn-by-turn navigation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PSBattlePanel } from '../ps/PSBattlePanel';
import '../styles/replay-viewer.css';

interface ReplayTurn {
  turn: number;
  events: string[];
  anim?: any[];
  phase?: string;
  auto?: boolean;
}

interface ReplayData {
  id: string;
  room: { id: string; name: string };
  createdAt: number;
  replay: ReplayTurn[];
}

interface ReplayViewerProps {
  replayId?: string;
  replayData?: ReplayData;
  onClose?: () => void;
}

/**
 * ReplayViewer - Plays back battle replays with controls
 */
const ReplayViewer: React.FC<ReplayViewerProps> = ({ replayId, replayData, onClose }) => {
  const [data, setData] = useState<ReplayData | null>(replayData || null);
  const [loading, setLoading] = useState(!replayData);
  const [error, setError] = useState<string | null>(null);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1500); // ms between turns
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Virtual battle state for replay
  const [protocol, setProtocol] = useState<string[]>([]);
  
  // Load replay data if not provided
  useEffect(() => {
    if (replayData) {
      setData(replayData);
      setLoading(false);
      return;
    }
    
    if (!replayId) {
      setError('No replay ID provided');
      setLoading(false);
      return;
    }
    
    const loadReplay = async () => {
      try {
        const base = localStorage.getItem('serverEndpoint') || 'http://localhost:3000';
        const res = await fetch(`${base}/api/replay/${replayId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
        setLoading(false);
      } catch (err: any) {
        setError(err.message || 'Failed to load replay');
        setLoading(false);
      }
    };
    
    loadReplay();
  }, [replayId, replayData]);
  
  // Generate protocol up to current turn
  useEffect(() => {
    if (!data?.replay) return;
    
    const allEvents: string[] = [];
    for (let i = 0; i <= currentTurnIndex && i < data.replay.length; i++) {
      allEvents.push(...(data.replay[i].events || []));
    }
    setProtocol(allEvents);
  }, [data, currentTurnIndex]);
  
  // Auto-play logic
  useEffect(() => {
    if (isPlaying && data?.replay) {
      playIntervalRef.current = setInterval(() => {
        setCurrentTurnIndex(prev => {
          if (prev >= data.replay.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playSpeed);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, playSpeed, data]);
  
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handlePrevTurn = useCallback(() => {
    setIsPlaying(false);
    setCurrentTurnIndex(prev => Math.max(0, prev - 1));
  }, []);
  const handleNextTurn = useCallback(() => {
    setIsPlaying(false);
    setCurrentTurnIndex(prev => data ? Math.min(data.replay.length - 1, prev + 1) : prev);
  }, [data]);
  const handleFirst = useCallback(() => {
    setIsPlaying(false);
    setCurrentTurnIndex(0);
  }, []);
  const handleLast = useCallback(() => {
    setIsPlaying(false);
    setCurrentTurnIndex(data ? data.replay.length - 1 : 0);
  }, [data]);
  
  const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setPlaySpeed(Number(e.target.value));
  }, []);
  
  if (loading) {
    return (
      <div className="replay-viewer replay-viewer--loading">
        <div className="loading-spinner" />
        <p>Loading replay...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="replay-viewer replay-viewer--error">
        <h3>Error Loading Replay</h3>
        <p>{error}</p>
        {onClose && <button onClick={onClose}>Close</button>}
      </div>
    );
  }
  
  if (!data) {
    return (
      <div className="replay-viewer replay-viewer--empty">
        <p>No replay data</p>
        {onClose && <button onClick={onClose}>Close</button>}
      </div>
    );
  }
  
  const currentTurn = data.replay[currentTurnIndex];
  const totalTurns = data.replay.length;
  const displayTurn = currentTurn?.turn ?? currentTurnIndex;
  
  return (
    <div className="replay-viewer">
      <div className="replay-viewer__header">
        <h2>Replay: {data.room?.name || data.id}</h2>
        <span className="replay-viewer__date">
          {new Date(data.createdAt).toLocaleDateString()}
        </span>
        {onClose && (
          <button className="replay-viewer__close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      
      <div className="replay-viewer__battle">
        <PSBattlePanel
          roomId={`replay-${data.id}`}
          isReplay={true}
          replayProtocol={protocol}
        />
      </div>
      
      <div className="replay-viewer__controls">
        <div className="replay-viewer__navigation">
          <button onClick={handleFirst} disabled={currentTurnIndex === 0} title="First turn">
            ⏮
          </button>
          <button onClick={handlePrevTurn} disabled={currentTurnIndex === 0} title="Previous turn">
            ⏪
          </button>
          {isPlaying ? (
            <button onClick={handlePause} title="Pause">
              ⏸
            </button>
          ) : (
            <button onClick={handlePlay} disabled={currentTurnIndex >= totalTurns - 1} title="Play">
              ▶
            </button>
          )}
          <button onClick={handleNextTurn} disabled={currentTurnIndex >= totalTurns - 1} title="Next turn">
            ⏩
          </button>
          <button onClick={handleLast} disabled={currentTurnIndex >= totalTurns - 1} title="Last turn">
            ⏭
          </button>
        </div>
        
        <div className="replay-viewer__progress">
          <span>Turn {displayTurn}</span>
          <input
            type="range"
            min={0}
            max={totalTurns - 1}
            value={currentTurnIndex}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentTurnIndex(Number(e.target.value));
            }}
          />
          <span>/ {data.replay[totalTurns - 1]?.turn ?? totalTurns - 1}</span>
        </div>
        
        <div className="replay-viewer__speed">
          <label>
            Speed:
            <select value={playSpeed} onChange={handleSpeedChange}>
              <option value={3000}>0.5x</option>
              <option value={1500}>1x</option>
              <option value={750}>2x</option>
              <option value={375}>4x</option>
            </select>
          </label>
        </div>
      </div>
      
      <div className="replay-viewer__log">
        <h4>Events (Turn {displayTurn})</h4>
        <pre className="replay-viewer__events">
          {currentTurn?.events?.join('\n') || '(no events)'}
        </pre>
      </div>
    </div>
  );
};

export default ReplayViewer;
