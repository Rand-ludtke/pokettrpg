import React, { useEffect, useRef, useState } from 'react';
import { useCoins } from './useCoins';
import { GameCornerEmulator } from './GameCornerEmulator';
import { gamecornerAsset } from './assets';
import './GambleStyles.css';

const ROOM_STYLE = {
  '--gamble-room-primary': `url("${gamecornerAsset('room/building_tiles.png')}")`,
  '--gamble-room-secondary': `url("${gamecornerAsset('room/mauville_tiles.png')}")`,
} as React.CSSProperties;

const LOBBY_STAGE_STYLE = {
  '--gamble-scene-image': `url("${gamecornerAsset('room/mauville_tiles.png')}")`,
  '--gamble-scene-accent': '#d79334',
} as React.CSSProperties;

export function GambleTab() {
  const { coins, setCoins, addCoins, spendCoins } = useCoins();
  const [editingCoins, setEditingCoins] = useState(false);
  const [coinInput, setCoinInput] = useState('');
  const coinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCoins && coinInputRef.current) coinInputRef.current.focus();
  }, [editingCoins]);

  const startEdit = () => {
    setCoinInput(String(coins));
    setEditingCoins(true);
  };

  const commitEdit = () => {
    const val = parseInt(coinInput, 10);
    if (!isNaN(val) && val >= 0) setCoins(val);
    setEditingCoins(false);
  };

  return (
    <div className="gamble-tab gamble-tab--emulator panel" style={ROOM_STYLE}>
      <div className="gamble-coin-bar">
        {editingCoins ? (
          <input
            ref={coinInputRef}
            className="gamble-coin-edit"
            type="number"
            min={0}
            value={coinInput}
            onChange={e => setCoinInput(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCoins(false); }}
          />
        ) : (
          <span className="gamble-coins" onClick={startEdit} title="Click to edit coins">
            {coins.toLocaleString()} coins
          </span>
        )}
        <span className="gamble-coin-bar-note">Lobby mode</span>
      </div>

      <div className="gamble-stage gamble-stage--emulator-only" style={LOBBY_STAGE_STYLE}>
        <div className="gamble-stage-body gamble-stage-body--emulator-only">
          <GameCornerEmulator
            setAppCoins={setCoins}
          />
        </div>
      </div>
    </div>
  );
}
