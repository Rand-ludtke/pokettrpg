import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GameProps } from './types';

/*
  Slot Machine – 3 reels, 7 symbols, 1-3 bet lines.
  Based on the pokeemerald game corner mechanics:
    Symbols: 7_RED, 7_BLUE, AZURILL, LOTAD, CHERRY, POWER, REPLAY
    Payouts: Cherry line=2, Cherry top/bot=4, Replay=free, Lotad=6, Azurill=12, Power=3×bet, Mixed 7=90, Same 7=300
*/

const SYMBOLS = ['🔴', '🔵', '💧', '🌿', '🍒', '⚡', '🔁'] as const;
const SYMBOL_NAMES = ['7 Red', '7 Blue', 'Azurill', 'Lotad', 'Cherry', 'Power', 'Replay'] as const;

// Each reel has 21 positions (like the original)
function buildReel(seed: number): number[] {
  const reel: number[] = [];
  const base = [0, 1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 2, 3, 4, 5];
  // Shuffle deterministically based on seed
  const shuffled = base.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = ((seed * (i + 1) * 7 + 13) >>> 0) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const REELS = [buildReel(1), buildReel(2), buildReel(3)];

interface ReelState { pos: number; spinning: boolean; }

function getSymbolAt(reelIdx: number, pos: number): number {
  const reel = REELS[reelIdx];
  return reel[((pos % reel.length) + reel.length) % reel.length];
}

function checkPayouts(grid: number[][], betLines: number): { total: number; winLines: string[] } {
  // grid[row][col], rows: 0=top, 1=mid, 2=bottom
  const lines: { row: number[]; name: string }[] = [];
  lines.push({ row: [1, 1, 1], name: 'center' });
  if (betLines >= 2) {
    lines.push({ row: [0, 0, 0], name: 'top' });
    lines.push({ row: [2, 2, 2], name: 'bottom' });
  }
  if (betLines >= 3) {
    lines.push({ row: [0, 1, 2], name: 'diagonal ↘' });
    lines.push({ row: [2, 1, 0], name: 'diagonal ↗' });
  }

  let total = 0;
  const winLines: string[] = [];

  for (const line of lines) {
    const syms = line.row.map((r, c) => grid[r][c]);
    const payout = calcLinePayout(syms, line.name);
    if (payout > 0) {
      total += payout;
      winLines.push(`${line.name}: ${payout}×`);
    }
  }
  return { total, winLines };
}

function calcLinePayout(syms: number[], lineName: string): number {
  const [a, b, c] = syms;
  // All same
  if (a === b && b === c) {
    switch (a) {
      case 0: return 300; // 7 Red
      case 1: return 300; // 7 Blue
      case 2: return 12;  // Azurill
      case 3: return 6;   // Lotad
      case 4: return (lineName === 'center') ? 2 : 4; // Cherry
      case 5: return 3;   // Power
      case 6: return 0;   // Replay = free spin, handled separately
    }
  }
  // Mixed 7s (red+blue mix)
  if ([a, b, c].every(s => s === 0 || s === 1) && !(a === b && b === c)) return 90;
  // Cherry in first position
  if (a === 4) return (lineName === 'center') ? 2 : 4;
  // Replay
  if (a === 6 && b === 6 && c === 6) return 0; // free spin
  return 0;
}

export function SlotMachine({ coins, addCoins, spendCoins }: GameProps) {
  const [betLines, setBetLines] = useState(1);
  const [reels, setReels] = useState<ReelState[]>([
    { pos: 0, spinning: false },
    { pos: 7, spinning: false },
    { pos: 14, spinning: false },
  ]);
  const [spinning, setSpinning] = useState(false);
  const [message, setMessage] = useState('Place your bet and spin!');
  const [lastWin, setLastWin] = useState(0);
  const [winLines, setWinLines] = useState<string[]>([]);
  const [freeSpins, setFreeSpins] = useState(0);
  const animRef = useRef<number>(0);

  const betCost = betLines; // 1 coin per line

  const spin = useCallback(() => {
    if (spinning) return;
    if (freeSpins <= 0 && coins < betCost) {
      setMessage('Not enough coins!');
      return;
    }
    if (freeSpins > 0) {
      setFreeSpins(f => f - 1);
      setMessage('Free spin!');
    } else {
      spendCoins(betCost);
    }

    setSpinning(true);
    setLastWin(0);
    setWinLines([]);
    setMessage('Spinning...');

    // Random target positions
    const targets = [
      Math.floor(Math.random() * 21),
      Math.floor(Math.random() * 21),
      Math.floor(Math.random() * 21),
    ];

    let frame = 0;
    const maxFrames = 40;
    const stopAt = [20, 28, maxFrames]; // stagger stops

    const startPos = reels.map(r => r.pos);

    const animate = () => {
      frame++;
      setReels(prev => prev.map((r, i) => {
        if (frame > stopAt[i]) return { pos: targets[i], spinning: false };
        // Spin: advance position
        return { pos: (startPos[i] + frame * 2 + i * 3) % 21, spinning: true };
      }));

      if (frame < maxFrames) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        // Final positions
        setReels([
          { pos: targets[0], spinning: false },
          { pos: targets[1], spinning: false },
          { pos: targets[2], spinning: false },
        ]);

        // Build 3x3 grid
        const grid: number[][] = [];
        for (let row = -1; row <= 1; row++) {
          grid.push([0, 1, 2].map(col => getSymbolAt(col, targets[col] + row)));
        }

        const result = checkPayouts(grid, betLines);
        // Check for replay (free spin)
        const centerLine = [grid[1][0], grid[1][1], grid[1][2]];
        if (centerLine[0] === 6 && centerLine[1] === 6 && centerLine[2] === 6) {
          setFreeSpins(f => f + 1);
          setMessage('REPLAY! Free spin earned!');
        } else if (result.total > 0) {
          const winAmount = result.total * betCost;
          addCoins(winAmount);
          setLastWin(winAmount);
          setWinLines(result.winLines);
          setMessage(`WIN! +${winAmount} coins!`);
        } else {
          setMessage('No luck... try again!');
        }
        setSpinning(false);
      }
    };

    animRef.current = requestAnimationFrame(animate);
  }, [spinning, freeSpins, coins, betCost, reels, betLines, spendCoins, addCoins]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // Build visible grid (3 rows × 3 cols)
  const grid = [0, 1, 2].map(col =>
    [-1, 0, 1].map(offset => getSymbolAt(col, reels[col].pos + offset))
  );

  return (
    <div className="slot-machine">
      <h2>🎰 Slot Machine</h2>

      <div className="slot-controls">
        <div>
          <label>Bet Lines: </label>
          <button className={betLines === 1 ? 'active mini' : 'mini'} onClick={() => !spinning && setBetLines(1)}>1</button>
          <button className={betLines === 2 ? 'active mini' : 'mini'} onClick={() => !spinning && setBetLines(2)}>2</button>
          <button className={betLines === 3 ? 'active mini' : 'mini'} onClick={() => !spinning && setBetLines(3)}>3</button>
          <span className="dim" style={{ marginLeft: 8 }}>Cost: {betCost} coin{betCost > 1 ? 's' : ''}/spin</span>
        </div>
        {freeSpins > 0 && <div style={{ color: '#28c76f' }}>Free spins: {freeSpins}</div>}
      </div>

      <div className="slot-reels-frame">
        {/* Bet line indicators */}
        <div className="slot-line-indicators">
          <div className={`slot-line-ind ${betLines >= 2 ? 'active' : ''}`}>─</div>
          <div className="slot-line-ind active">─</div>
          <div className={`slot-line-ind ${betLines >= 2 ? 'active' : ''}`}>─</div>
        </div>
        <div className="slot-reels">
          {[0, 1, 2].map(row => (
            <div key={row} className={`slot-row ${row === 1 ? 'center' : ''}`}>
              {[0, 1, 2].map(col => (
                <div key={col} className={`slot-cell ${reels[col].spinning ? 'spinning' : ''}`}>
                  {SYMBOLS[grid[col][row]]}
                </div>
              ))}
            </div>
          ))}
        </div>
        {betLines >= 3 && (
          <div className="slot-diag-lines">
            <div className="slot-diag-line down" />
            <div className="slot-diag-line up" />
          </div>
        )}
      </div>

      <button className="slot-spin-btn" onClick={spin} disabled={spinning}>
        {spinning ? 'Spinning...' : 'SPIN'}
      </button>

      <div className={`slot-message ${lastWin > 0 ? 'win' : ''}`}>{message}</div>
      {winLines.length > 0 && (
        <div className="slot-win-lines">
          {winLines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      <div className="slot-paytable">
        <h3>Payouts</h3>
        <table>
          <tbody>
            <tr><td>🔴🔴🔴 / 🔵🔵🔵</td><td>300×</td></tr>
            <tr><td>🔴🔵 mixed</td><td>90×</td></tr>
            <tr><td>💧💧💧 Azurill</td><td>12×</td></tr>
            <tr><td>🌿🌿🌿 Lotad</td><td>6×</td></tr>
            <tr><td>⚡⚡⚡ Power</td><td>3×</td></tr>
            <tr><td>🍒🍒🍒 Cherry</td><td>2-4×</td></tr>
            <tr><td>🔁🔁🔁 Replay</td><td>Free Spin</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
