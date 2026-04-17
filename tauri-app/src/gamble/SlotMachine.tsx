import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GameProps } from './types';

/*
  Slot Machine – faithful to pokeemerald game corner:
  - 3 reels × 21 symbols each, 3 visible rows (top / center / bottom)
  - 5 match lines: center (bet 1), top+bottom (bet 2), 2 diagonals (bet 3)
  - Pika Power meter (0-16 bolts), fills on losses, triggers bonus
  - Symbols: 7_RED, 7_BLUE, AZURILL, LOTAD, CHERRY, POWER, REPLAY
  - Staggered reel stops
*/

const SYMBOLS = ['🔴', '🔵', '💧', '🌿', '🍒', '⚡', '🔁'] as const;
const SYM_LABELS = ['7 Red', '7 Blue', 'Azurill', 'Lotad', 'Cherry', 'Power', 'Replay'];
const SYM_COUNT = 21;

// Original reel strips (indices into SYMBOLS), 21 positions each
const REEL_STRIPS: number[][] = [
  [0, 5, 3, 4, 2, 6, 3, 5, 4, 6, 2, 3, 5, 4, 6, 1, 3, 4, 5, 2, 6], // left
  [1, 4, 3, 5, 6, 2, 4, 3, 6, 5, 4, 2, 3, 6, 5, 0, 4, 3, 2, 6, 5], // mid
  [2, 6, 4, 3, 5, 4, 6, 3, 2, 5, 4, 6, 3, 5, 0, 4, 6, 3, 1, 5, 4], // right
];

function symAt(reel: number, pos: number) {
  const p = ((pos % SYM_COUNT) + SYM_COUNT) % SYM_COUNT;
  return REEL_STRIPS[reel][p];
}

// Match-line definitions
const MATCH_LINES = [
  { name: 'Center',  rows: [1, 1, 1], color: '#FFD700', minBet: 1 },
  { name: 'Top',     rows: [0, 0, 0], color: '#FF6B6B', minBet: 2 },
  { name: 'Bottom',  rows: [2, 2, 2], color: '#FF6B6B', minBet: 2 },
  { name: 'Diag ↘',  rows: [0, 1, 2], color: '#6BFFB8', minBet: 3 },
  { name: 'Diag ↗',  rows: [2, 1, 0], color: '#6BFFB8', minBet: 3 },
];

function calcLinePayout(syms: number[]): { payout: number; label: string } {
  const [a, b, c] = syms;
  if (a === b && b === c) {
    if (a === 0) return { payout: 300, label: '7 RED!' };
    if (a === 1) return { payout: 300, label: '7 BLUE!' };
    if (a === 2) return { payout: 12, label: 'Azurill!' };
    if (a === 3) return { payout: 6, label: 'Lotad!' };
    if (a === 4) return { payout: 2, label: 'Cherry!' };
    if (a === 5) return { payout: 6, label: 'Power!' };
    if (a === 6) return { payout: 0, label: 'REPLAY' };
  }
  if ([a, b, c].every(s => s <= 1)) return { payout: 90, label: 'Mixed 7s!' };
  if (a === 4) return { payout: 2, label: 'Cherry' };
  return { payout: 0, label: '' };
}

export function SlotMachine({ coins, addCoins, spendCoins }: GameProps) {
  const [bet, setBet] = useState(1);
  const [reelPos, setReelPos] = useState([0, 7, 14]);
  const [spinning, setSpinning] = useState(false);
  const [reelStopped, setReelStopped] = useState([true, true, true]);
  const [message, setMessage] = useState('Insert coins and press SPIN!');
  const [lastWin, setLastWin] = useState(0);
  const [winLineIdxs, setWinLineIdxs] = useState<number[]>([]);
  const [freeSpins, setFreeSpins] = useState(0);
  const [pikaPower, setPikaPower] = useState(0);
  const animRef = useRef(0);

  const spin = useCallback(() => {
    if (spinning) return;
    if (freeSpins <= 0 && coins < bet) {
      setMessage('Not enough coins!');
      return;
    }
    if (freeSpins > 0) {
      setFreeSpins(f => f - 1);
    } else {
      spendCoins(bet);
    }

    setSpinning(true);
    setLastWin(0);
    setWinLineIdxs([]);
    setMessage('');
    setReelStopped([false, false, false]);

    const targets = [
      Math.floor(Math.random() * SYM_COUNT),
      Math.floor(Math.random() * SYM_COUNT),
      Math.floor(Math.random() * SYM_COUNT),
    ];

    let frame = 0;
    const stopFrames = [30, 42, 54];
    const startPos = [...reelPos];

    const animate = () => {
      frame++;
      const next = [0, 1, 2].map(i => {
        if (frame >= stopFrames[i]) return targets[i];
        return (startPos[i] + Math.floor(frame * 1.5) + i * 4) % SYM_COUNT;
      });
      const stopped = [0, 1, 2].map(i => frame >= stopFrames[i]);

      setReelPos(next);
      setReelStopped(stopped);

      if (frame < stopFrames[2]) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        setReelPos(targets);
        setReelStopped([true, true, true]);
        setSpinning(false);

        // Build 3×3 grid: grid[row][col]
        const grid = [0, 1, 2].map(row =>
          [0, 1, 2].map(col => symAt(col, targets[col] + row - 1))
        );

        let totalPay = 0;
        const wins: number[] = [];
        let gotReplay = false;

        for (let li = 0; li < MATCH_LINES.length; li++) {
          if (MATCH_LINES[li].minBet > bet) continue;
          const syms = MATCH_LINES[li].rows.map((r, c) => grid[r][c]);
          const result = calcLinePayout(syms);
          if (result.label === 'REPLAY') {
            gotReplay = true;
            wins.push(li);
          } else if (result.payout > 0) {
            totalPay += result.payout;
            wins.push(li);
          }
        }

        setWinLineIdxs(wins);

        if (gotReplay) {
          setFreeSpins(f => f + 1);
          setMessage('🔁 REPLAY! Free spin!');
          setPikaPower(pp => Math.min(16, pp + 1));
        }
        if (totalPay > 0) {
          addCoins(totalPay);
          setLastWin(totalPay);
          setMessage(`🎉 WIN ${totalPay} coins!`);
        } else if (!gotReplay) {
          setMessage('No match...');
          setPikaPower(pp => {
            const next = pp + 1;
            if (next >= 16) {
              setTimeout(() => {
                addCoins(bet * 10);
                setMessage('⚡ PIKA POWER! Bonus ' + (bet * 10) + ' coins!');
              }, 300);
              return 0;
            }
            return next;
          });
        }
      }
    };

    animRef.current = requestAnimationFrame(animate);
  }, [spinning, freeSpins, coins, bet, reelPos, spendCoins, addCoins]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // Visible 3×3 grid
  const grid = [0, 1, 2].map(row =>
    [0, 1, 2].map(col => symAt(col, reelPos[col] + row - 1))
  );

  const isWinCell = (row: number, col: number) => {
    for (const li of winLineIdxs) {
      if (MATCH_LINES[li].rows[col] === row) return true;
    }
    return false;
  };

  return (
    <div className="slot-machine">
      <div className="slot-header">
        <h2>🎰 Slot Machine</h2>
        <div className="slot-pika-power">
          <span className="slot-pika-label">⚡ Pika Power</span>
          <div className="slot-pika-bar">
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} className={`slot-pika-bolt ${i < pikaPower ? 'lit' : ''}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="slot-bet-area">
        <div className="slot-bet-buttons">
          {[1, 2, 3].map(b => (
            <button
              key={b}
              className={`slot-bet-btn ${bet === b ? 'active' : ''}`}
              onClick={() => !spinning && setBet(b)}
              disabled={spinning}
            >
              {b} Line{b > 1 ? 's' : ''}
            </button>
          ))}
        </div>
        <span className="slot-bet-cost">Cost: {bet} coin{bet > 1 ? 's' : ''}</span>
        {freeSpins > 0 && <span className="slot-free-spins">🔁 Free: {freeSpins}</span>}
      </div>

      <div className="slot-cabinet">
        <div className="slot-line-marks left">
          {MATCH_LINES.map((ml, i) => (
            <div
              key={i}
              className={`slot-mark ${bet >= ml.minBet ? 'active' : ''} ${winLineIdxs.includes(i) ? 'win' : ''}`}
              style={{ '--line-color': ml.color } as React.CSSProperties}
              title={ml.name}
            >
              {i + 1}
            </div>
          ))}
        </div>

        <div className="slot-reels-box">
          <div className="slot-row-labels">
            <span className={bet >= 2 ? 'active' : ''}>TOP</span>
            <span className="active">MID</span>
            <span className={bet >= 2 ? 'active' : ''}>BOT</span>
          </div>

          <div className="slot-reel-grid">
            {[0, 1, 2].map(row => (
              <div key={row} className={`slot-reel-row ${row === 1 ? 'center-row' : 'outer-row'}`}>
                {[0, 1, 2].map(col => {
                  const sym = grid[row][col];
                  const win = !spinning && isWinCell(row, col);
                  const stopped = reelStopped[col];
                  return (
                    <div
                      key={col}
                      className={
                        'slot-sym' +
                        (!stopped ? ' spinning' : '') +
                        (win ? ' win' : '')
                      }
                    >
                      <span className="slot-sym-emoji">{SYMBOLS[sym]}</span>
                      <span className="slot-sym-name">{SYM_LABELS[sym]}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="slot-line-marks right">
          {MATCH_LINES.map((ml, i) => (
            <div
              key={i}
              className={`slot-mark ${bet >= ml.minBet ? 'active' : ''} ${winLineIdxs.includes(i) ? 'win' : ''}`}
              style={{ '--line-color': ml.color } as React.CSSProperties}
              title={ml.name}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <button
        className={`slot-spin-btn ${spinning ? 'spinning' : ''}`}
        onClick={spin}
        disabled={spinning}
      >
        {spinning ? '⏳ SPINNING...' : '🎰 SPIN'}
      </button>

      <div className={`slot-message ${lastWin > 0 ? 'win' : ''}`}>{message}</div>

      <div className="slot-paytable">
        <h3>Paytable</h3>
        <div className="slot-pay-grid">
          <div className="slot-pay-row jackpot"><span>🔴🔴🔴 or 🔵🔵🔵</span><span>300×</span></div>
          <div className="slot-pay-row jackpot"><span>🔴🔵 Mixed 7s</span><span>90×</span></div>
          <div className="slot-pay-row"><span>💧💧💧 Azurill</span><span>12×</span></div>
          <div className="slot-pay-row"><span>🌿🌿🌿 Lotad</span><span>6×</span></div>
          <div className="slot-pay-row"><span>⚡⚡⚡ Power</span><span>6×</span></div>
          <div className="slot-pay-row"><span>🍒🍒🍒 Cherry</span><span>2×</span></div>
          <div className="slot-pay-row"><span>🍒 on reel 1</span><span>2×</span></div>
          <div className="slot-pay-row replay"><span>🔁🔁🔁 Replay</span><span>Free Spin</span></div>
        </div>
        <div className="slot-line-legend">
          <span><b>Bet 1:</b> Center row</span>
          <span><b>Bet 2:</b> + Top &amp; Bottom rows</span>
          <span><b>Bet 3:</b> + Both diagonals</span>
        </div>
      </div>
    </div>
  );
}
