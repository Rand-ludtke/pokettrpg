import React, { useState, useCallback } from 'react';
import { GameProps } from './types';

/*
  Voltorb Flip – 5×5 grid. Each tile is 1, 2, 3, or Voltorb (0).
  Row/column info shows sum + voltorb count.
  Flipping multipliers multiply current winnings. Hitting voltorb = lose current round.
  Level progression: winning advances level, losing resets to level based on max flipped.
*/

interface Tile {
  value: number; // 0=voltorb, 1, 2, 3
  flipped: boolean;
  marked: boolean; // player note
}

interface BoardInfo { sum: number; voltorbs: number; }

const LEVEL_CONFIGS: { twos: number; threes: number; voltorbs: number }[] = [
  { twos: 3, threes: 1, voltorbs: 6 },  // Level 1
  { twos: 1, threes: 3, voltorbs: 7 },  // Level 2
  { twos: 2, threes: 3, voltorbs: 7 },  // Level 3
  { twos: 3, threes: 3, voltorbs: 8 },  // Level 4
  { twos: 1, threes: 4, voltorbs: 8 },  // Level 5
  { twos: 2, threes: 4, voltorbs: 10 }, // Level 6
  { twos: 3, threes: 4, voltorbs: 10 }, // Level 7
  { twos: 4, threes: 4, voltorbs: 10 }, // Level 8
];

function generateBoard(level: number): { tiles: Tile[][]; rowInfo: BoardInfo[]; colInfo: BoardInfo[] } {
  const cfg = LEVEL_CONFIGS[Math.min(level - 1, LEVEL_CONFIGS.length - 1)];
  const values: number[] = [];

  // Place special tiles
  for (let i = 0; i < cfg.threes; i++) values.push(3);
  for (let i = 0; i < cfg.twos; i++) values.push(2);
  for (let i = 0; i < cfg.voltorbs; i++) values.push(0);
  // Fill rest with 1s
  while (values.length < 25) values.push(1);

  // Shuffle
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }

  const tiles: Tile[][] = [];
  for (let r = 0; r < 5; r++) {
    tiles.push([]);
    for (let c = 0; c < 5; c++) {
      tiles[r].push({ value: values[r * 5 + c], flipped: false, marked: false });
    }
  }

  const rowInfo = tiles.map(row => ({
    sum: row.reduce((s, t) => s + t.value, 0),
    voltorbs: row.filter(t => t.value === 0).length,
  }));

  const colInfo: BoardInfo[] = [];
  for (let c = 0; c < 5; c++) {
    let sum = 0, voltorbs = 0;
    for (let r = 0; r < 5; r++) {
      sum += tiles[r][c].value;
      if (tiles[r][c].value === 0) voltorbs++;
    }
    colInfo.push({ sum, voltorbs });
  }

  return { tiles, rowInfo, colInfo };
}

export function VoltorbFlip({ coins, addCoins, spendCoins }: GameProps) {
  const [level, setLevel] = useState(1);
  const [board, setBoard] = useState(() => generateBoard(1));
  const [multiplier, setMultiplier] = useState(1);
  const [gameState, setGameState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [message, setMessage] = useState(`Level ${1} — Flip tiles to multiply your coins!`);
  const [revealAll, setRevealAll] = useState(false);

  const totalMultiplierTiles = board.tiles.flat().filter(t => t.value >= 2).length;
  const flippedMultiplierTiles = board.tiles.flat().filter(t => t.value >= 2 && t.flipped).length;

  const flipTile = useCallback((r: number, c: number) => {
    if (gameState !== 'playing') return;
    const tile = board.tiles[r][c];
    if (tile.flipped) return;

    const newTiles = board.tiles.map(row => row.map(t => ({ ...t })));
    newTiles[r][c].flipped = true;

    if (tile.value === 0) {
      // Hit Voltorb!
      setRevealAll(true);
      setGameState('lost');
      const nextLevel = Math.max(1, Math.min(level, Math.max(1, flippedMultiplierTiles)));
      setMessage(`💥 Voltorb! You lose your winnings. Dropping to level ${nextLevel}.`);
      setLevel(nextLevel);
    } else {
      const newMult = multiplier * tile.value;
      setMultiplier(newMult);

      // Check if all multiplier tiles flipped
      const newFlippedMult = newTiles.flat().filter(t => t.value >= 2 && t.flipped).length;
      if (newFlippedMult === totalMultiplierTiles) {
        // Won the round!
        addCoins(newMult);
        setRevealAll(true);
        setGameState('won');
        const nextLevel = Math.min(level + 1, LEVEL_CONFIGS.length);
        setMessage(`🎉 Round clear! Won ${newMult} coins! Advancing to level ${nextLevel}.`);
        setLevel(nextLevel);
      } else {
        setMessage(`Multiplier: ×${newMult} — Keep going or collect!`);
      }
    }

    setBoard({ ...board, tiles: newTiles });
  }, [board, gameState, multiplier, level, flippedMultiplierTiles, totalMultiplierTiles, addCoins]);

  const toggleMark = useCallback((r: number, c: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (gameState !== 'playing') return;
    const tile = board.tiles[r][c];
    if (tile.flipped) return;
    const newTiles = board.tiles.map(row => row.map(t => ({ ...t })));
    newTiles[r][c].marked = !newTiles[r][c].marked;
    setBoard({ ...board, tiles: newTiles });
  }, [board, gameState]);

  const collect = useCallback(() => {
    if (gameState !== 'playing' || multiplier <= 1) return;
    addCoins(multiplier);
    setRevealAll(true);
    setGameState('won');
    setMessage(`Collected ${multiplier} coins!`);
  }, [gameState, multiplier, addCoins]);

  const newRound = useCallback(() => {
    const b = generateBoard(level);
    setBoard(b);
    setMultiplier(1);
    setGameState('playing');
    setRevealAll(false);
    setMessage(`Level ${level} — Flip tiles to multiply your coins!`);
  }, [level]);

  return (
    <div className="voltorb-flip">
      <h2>⚡ Voltorb Flip — Level {level}</h2>

      <div className="vf-status">
        <span>Current Multiplier: <strong>×{multiplier}</strong></span>
        {gameState === 'playing' && multiplier > 1 && (
          <button className="mini" onClick={collect}>Collect {multiplier} coins</button>
        )}
        {gameState !== 'playing' && (
          <button className="mini" onClick={newRound}>New Round</button>
        )}
      </div>

      <div className={`vf-message ${gameState === 'won' ? 'win' : gameState === 'lost' ? 'lose' : ''}`}>
        {message}
      </div>

      <div className="vf-board">
        {/* Column info header */}
        <div className="vf-grid-row">
          <div className="vf-corner" />
          {board.colInfo.map((info, c) => (
            <div key={c} className="vf-info-cell col">
              <div className="vf-info-sum">{info.sum}</div>
              <div className="vf-info-volt">💣{info.voltorbs}</div>
            </div>
          ))}
        </div>

        {/* Rows */}
        {board.tiles.map((row, r) => (
          <div key={r} className="vf-grid-row">
            <div className="vf-info-cell row">
              <div className="vf-info-sum">{board.rowInfo[r].sum}</div>
              <div className="vf-info-volt">💣{board.rowInfo[r].voltorbs}</div>
            </div>
            {row.map((tile, c) => {
              const show = tile.flipped || revealAll;
              return (
                <button
                  key={c}
                  className={`vf-tile ${show ? 'flipped' : ''} ${tile.marked && !show ? 'marked' : ''} ${show && tile.value === 0 ? 'voltorb' : ''} ${show && tile.value >= 2 ? 'multiplier' : ''}`}
                  onClick={() => flipTile(r, c)}
                  onContextMenu={(e) => toggleMark(r, c, e)}
                  disabled={show || gameState !== 'playing'}
                >
                  {show ? (
                    tile.value === 0 ? '💣' : tile.value
                  ) : (
                    tile.marked ? '🚩' : '?'
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="vf-help dim">
        Left-click to flip. Right-click to mark/unmark.
      </div>
    </div>
  );
}
