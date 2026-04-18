import React, { useCallback, useMemo, useState } from 'react';
import { GameProps } from './types';

const VF_SP = '/gamecorner/voltorbflip/';
const BOARD_WIDTH = 5;
const BOARD_HEIGHT = 5;
const MAX_LEVEL = 8;

type CursorMode = 'flip' | '1' | '2' | '3' | 'voltorb';
type GameState = 'playing' | 'won' | 'lost';

interface Tile {
  value: number;
  flipped: boolean;
  note1: boolean;
  note2: boolean;
  note3: boolean;
  noteVoltorb: boolean;
}

interface BoardInfo {
  sum: number;
  voltorbs: number;
}

interface BoardState {
  tiles: Tile[][];
  rowInfo: BoardInfo[];
  colInfo: BoardInfo[];
}

interface SpawnCounts {
  x2Count: number;
  x3Count: number;
  voltorbCount: number;
}

const SPAWN_TABLE: SpawnCounts[][] = [
  [
    { x2Count: 3, x3Count: 1, voltorbCount: 6 },
    { x2Count: 0, x3Count: 3, voltorbCount: 6 },
    { x2Count: 5, x3Count: 0, voltorbCount: 6 },
    { x2Count: 2, x3Count: 2, voltorbCount: 6 },
    { x2Count: 4, x3Count: 1, voltorbCount: 6 },
  ],
  [
    { x2Count: 1, x3Count: 3, voltorbCount: 7 },
    { x2Count: 6, x3Count: 0, voltorbCount: 7 },
    { x2Count: 3, x3Count: 2, voltorbCount: 7 },
    { x2Count: 0, x3Count: 4, voltorbCount: 7 },
    { x2Count: 5, x3Count: 1, voltorbCount: 7 },
  ],
  [
    { x2Count: 2, x3Count: 3, voltorbCount: 8 },
    { x2Count: 7, x3Count: 0, voltorbCount: 8 },
    { x2Count: 4, x3Count: 2, voltorbCount: 8 },
    { x2Count: 1, x3Count: 4, voltorbCount: 8 },
    { x2Count: 6, x3Count: 1, voltorbCount: 8 },
  ],
  [
    { x2Count: 3, x3Count: 3, voltorbCount: 8 },
    { x2Count: 0, x3Count: 5, voltorbCount: 8 },
    { x2Count: 8, x3Count: 0, voltorbCount: 10 },
    { x2Count: 5, x3Count: 2, voltorbCount: 10 },
    { x2Count: 2, x3Count: 4, voltorbCount: 10 },
  ],
  [
    { x2Count: 7, x3Count: 1, voltorbCount: 10 },
    { x2Count: 4, x3Count: 3, voltorbCount: 10 },
    { x2Count: 1, x3Count: 5, voltorbCount: 10 },
    { x2Count: 9, x3Count: 0, voltorbCount: 10 },
    { x2Count: 6, x3Count: 2, voltorbCount: 10 },
  ],
  [
    { x2Count: 3, x3Count: 4, voltorbCount: 10 },
    { x2Count: 0, x3Count: 6, voltorbCount: 10 },
    { x2Count: 8, x3Count: 1, voltorbCount: 10 },
    { x2Count: 5, x3Count: 3, voltorbCount: 10 },
    { x2Count: 2, x3Count: 5, voltorbCount: 10 },
  ],
  [
    { x2Count: 7, x3Count: 2, voltorbCount: 10 },
    { x2Count: 4, x3Count: 4, voltorbCount: 10 },
    { x2Count: 1, x3Count: 6, voltorbCount: 10 },
    { x2Count: 9, x3Count: 1, voltorbCount: 10 },
    { x2Count: 6, x3Count: 3, voltorbCount: 10 },
  ],
  [
    { x2Count: 0, x3Count: 7, voltorbCount: 10 },
    { x2Count: 8, x3Count: 2, voltorbCount: 10 },
    { x2Count: 5, x3Count: 4, voltorbCount: 10 },
    { x2Count: 2, x3Count: 6, voltorbCount: 10 },
    { x2Count: 7, x3Count: 3, voltorbCount: 10 },
  ],
];

function VoltorbIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="vf-voltorb-icon"
      style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }}
    >
      <img
        src={`${VF_SP}gameboard.png`}
        alt="V"
        style={{
          imageRendering: 'pixelated',
          width: 48,
          height: 48,
          objectFit: 'none',
          objectPosition: '-96px -24px',
          transform: `scale(${size / 48})`,
          transformOrigin: 'top left',
          display: 'block',
          clip: 'rect(0, 48px, 48px, 0)',
        }}
      />
    </span>
  );
}

function createTile(value = 1): Tile {
  return {
    value,
    flipped: false,
    note1: false,
    note2: false,
    note3: false,
    noteVoltorb: false,
  };
}

function computeBoardInfo(tiles: Tile[][]): Pick<BoardState, 'rowInfo' | 'colInfo'> {
  const rowInfo = tiles.map((row) => ({
    sum: row.reduce((total, tile) => total + tile.value, 0),
    voltorbs: row.filter((tile) => tile.value === 0).length,
  }));

  const colInfo = Array.from({ length: BOARD_WIDTH }, (_, column) => {
    let sum = 0;
    let voltorbs = 0;
    for (let row = 0; row < BOARD_HEIGHT; row++) {
      sum += tiles[row][column].value;
      if (tiles[row][column].value === 0) voltorbs++;
    }
    return { sum, voltorbs };
  });

  return { rowInfo, colInfo };
}

function generateBoard(level: number): BoardState {
  const levelIndex = Math.max(0, Math.min(MAX_LEVEL - 1, level - 1));
  const variants = SPAWN_TABLE[levelIndex];
  const variant = variants[Math.floor(Math.random() * variants.length)];
  const values = new Array(BOARD_WIDTH * BOARD_HEIGHT).fill(1);

  const placeValue = (value: number, count: number) => {
    let placed = 0;
    while (placed < count) {
      const index = Math.floor(Math.random() * values.length);
      if (values[index] === 1) {
        values[index] = value;
        placed++;
      }
    }
  };

  placeValue(0, variant.voltorbCount);
  placeValue(2, variant.x2Count);
  placeValue(3, variant.x3Count);

  const tiles = Array.from({ length: BOARD_HEIGHT }, (_, row) =>
    Array.from({ length: BOARD_WIDTH }, (_, column) => createTile(values[row * BOARD_WIDTH + column]))
  );

  return { tiles, ...computeBoardInfo(tiles) };
}

function calculateBoardState(tiles: Tile[][]): GameState | 'playing' {
  let inProgress = false;

  for (const row of tiles) {
    for (const tile of row) {
      if (tile.flipped) {
        if (tile.value === 0) return 'lost';
      } else if (tile.value === 2 || tile.value === 3) {
        inProgress = true;
      }
    }
  }

  return inProgress ? 'playing' : 'won';
}

function revealAllTiles(tiles: Tile[][]): Tile[][] {
  return tiles.map((row) => row.map((tile) => ({ ...tile, flipped: true })));
}

function NoteGrid({ tile }: { tile: Tile }) {
  const hasNotes = tile.note1 || tile.note2 || tile.note3 || tile.noteVoltorb;
  if (!hasNotes) return <span className="vf-hidden-fill" />;

  return (
    <span className="vf-note-grid">
      <span className={`vf-note ${tile.note1 ? 'active' : ''}`}>1</span>
      <span className={`vf-note ${tile.note2 ? 'active' : ''}`}>2</span>
      <span className={`vf-note ${tile.note3 ? 'active' : ''}`}>3</span>
      <span className={`vf-note ${tile.noteVoltorb ? 'active vf-note-voltorb' : ''}`}>V</span>
    </span>
  );
}

export function VoltorbFlip({ addCoins }: GameProps) {
  const [currentLevel, setCurrentLevel] = useState(1);
  const [nextLevel, setNextLevel] = useState(1);
  const [board, setBoard] = useState<BoardState>(() => generateBoard(1));
  const [cursorMode, setCursorMode] = useState<CursorMode>('flip');
  const [gameState, setGameState] = useState<GameState>('playing');
  const [sessionWinnings, setSessionWinnings] = useState(0);
  const [roundWinnings, setRoundWinnings] = useState(0);
  const [message, setMessage] = useState('Level 1. Clear every hidden 2 and 3 tile to win.');

  const displayedWinnings = useMemo(() => sessionWinnings + roundWinnings, [sessionWinnings, roundWinnings]);

  const applyMode = useCallback((tile: Tile, mode: CursorMode): Tile => {
    if (mode === 'flip') return { ...tile, flipped: true };
    if (mode === '1') return { ...tile, note1: !tile.note1 };
    if (mode === '2') return { ...tile, note2: !tile.note2 };
    if (mode === '3') return { ...tile, note3: !tile.note3 };
    return { ...tile, noteVoltorb: !tile.noteVoltorb };
  }, []);

  const handleTileAction = useCallback((rowIndex: number, columnIndex: number) => {
    if (gameState !== 'playing') return;

    const currentTile = board.tiles[rowIndex][columnIndex];
    if (currentTile.flipped) return;

    const nextTiles = board.tiles.map((row) => row.map((tile) => ({ ...tile })));
    nextTiles[rowIndex][columnIndex] = applyMode(nextTiles[rowIndex][columnIndex], cursorMode);

    if (cursorMode !== 'flip') {
      setBoard({ tiles: nextTiles, ...computeBoardInfo(nextTiles) });
      return;
    }

    const revealedTile = nextTiles[rowIndex][columnIndex];
    let updatedRoundWinnings = roundWinnings;

    if (revealedTile.value === 0) {
      setBoard({ tiles: revealAllTiles(nextTiles), ...computeBoardInfo(nextTiles) });
      setRoundWinnings(0);
      setSessionWinnings(0);
      setGameState('lost');
      setCurrentLevel(1);
      setNextLevel(1);
      setMessage('Voltorb hit. Session winnings lost and the board resets to level 1.');
      return;
    }

    if (updatedRoundWinnings === 0) {
      updatedRoundWinnings = revealedTile.value;
    } else if (revealedTile.value > 1) {
      updatedRoundWinnings *= revealedTile.value;
    }

    const resolvedState = calculateBoardState(nextTiles);
    if (resolvedState === 'won') {
      const totalSession = sessionWinnings + updatedRoundWinnings;
      const advancedLevel = Math.min(MAX_LEVEL, currentLevel + 1);
      setBoard({ tiles: revealAllTiles(nextTiles), ...computeBoardInfo(nextTiles) });
      setRoundWinnings(0);
      setSessionWinnings(totalSession);
      setGameState('won');
      setNextLevel(advancedLevel);
      setMessage(`Board clear. Session winnings are ${totalSession}. Continue to level ${advancedLevel} or cash out.`);
      return;
    }

    setRoundWinnings(updatedRoundWinnings);
    setBoard({ tiles: nextTiles, ...computeBoardInfo(nextTiles) });
    setMessage(`Current round winnings: ${updatedRoundWinnings}. Reveal all hidden 2 and 3 tiles to clear the board.`);
  }, [applyMode, board.tiles, currentLevel, cursorMode, gameState, roundWinnings, sessionWinnings]);

  const startBoard = useCallback((level: number, winnings: number) => {
    setBoard(generateBoard(level));
    setCurrentLevel(level);
    setNextLevel(level);
    setRoundWinnings(0);
    setSessionWinnings(winnings);
    setGameState('playing');
    setCursorMode('flip');
    setMessage(`Level ${level}. Clear every hidden 2 and 3 tile to win.`);
  }, []);

  const continueSession = useCallback(() => {
    startBoard(nextLevel, sessionWinnings);
  }, [nextLevel, sessionWinnings, startBoard]);

  const startNewSession = useCallback(() => {
    startBoard(1, 0);
  }, [startBoard]);

  const cashOut = useCallback(() => {
    if (sessionWinnings <= 0) return;
    const winnings = sessionWinnings;
    addCoins(winnings);
    startBoard(1, 0);
    setMessage(`Cashed out ${winnings} coins. Starting again at level 1.`);
  }, [addCoins, sessionWinnings, startBoard]);

  return (
    <div className="voltorb-flip">
      <h2>Voltorb Flip - Level {currentLevel}</h2>

      <div className="vf-status">
        <span>Session Winnings: <strong>{displayedWinnings}</strong></span>
        <span>Mode:</span>
        {[
          ['flip', 'Flip'],
          ['1', '1'],
          ['2', '2'],
          ['3', '3'],
          ['voltorb', 'V'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            className={`vf-mode-btn ${cursorMode === mode ? 'active' : ''}`}
            onClick={() => setCursorMode(mode as CursorMode)}
            disabled={gameState !== 'playing'}
          >
            {label}
          </button>
        ))}
        {gameState === 'won' && (
          <>
            <button className="mini" onClick={continueSession}>Continue</button>
            <button className="mini" onClick={cashOut}>Cash Out</button>
          </>
        )}
        {gameState === 'lost' && <button className="mini" onClick={startNewSession}>New Session</button>}
      </div>

      <div className={`vf-message ${gameState === 'won' ? 'win' : gameState === 'lost' ? 'lose' : ''}`}>
        {message}
      </div>

      <div className="vf-board">
        <div className="vf-grid-row">
          <div className="vf-corner" />
          {board.colInfo.map((info, column) => (
            <div key={column} className="vf-info-cell col">
              <div className="vf-info-sum">{info.sum}</div>
              <div className="vf-info-volt"><VoltorbIcon size={14} />{info.voltorbs}</div>
            </div>
          ))}
        </div>

        {board.tiles.map((row, rowIndex) => (
          <div key={rowIndex} className="vf-grid-row">
            <div className="vf-info-cell row">
              <div className="vf-info-sum">{board.rowInfo[rowIndex].sum}</div>
              <div className="vf-info-volt"><VoltorbIcon size={14} />{board.rowInfo[rowIndex].voltorbs}</div>
            </div>
            {row.map((tile, columnIndex) => (
              <button
                key={columnIndex}
                className={`vf-tile ${tile.flipped ? 'flipped' : ''} ${tile.flipped && tile.value === 0 ? 'voltorb' : ''} ${tile.flipped && tile.value >= 2 ? 'multiplier' : ''}`}
                onClick={() => handleTileAction(rowIndex, columnIndex)}
                disabled={gameState !== 'playing' && !tile.flipped}
              >
                {tile.flipped ? (
                  tile.value === 0 ? <VoltorbIcon size={24} /> : tile.value
                ) : (
                  <NoteGrid tile={tile} />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="vf-help dim">
        Source-faithful pass: exact Rogue level variants, note modes, no manual collect shortcut, and Voltorb resets the session winnings.
      </div>
    </div>
  );
}
