import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GameProps } from './types';
import { gamecornerAsset } from './assets';

/*
  Slot Machine – faithful to pokeemerald-gamecorner-expansion
  Uses actual repo PNG sprites from /gamecorner/slot_machine/
  Reel strips, payouts, Pika Power, digital display all from C source
*/

// Symbol IDs matching the C enum
const SYM = { RED7: 0, BLUE7: 1, AZURILL: 2, LOTAD: 3, CHERRY: 4, POWER: 5, REPLAY: 6 } as const;
const SYM_LABELS = ['7 Red', '7 Blue', 'Azurill', 'Lotad', 'Cherry', 'Power', 'Replay'];
const SYM_COUNT = 21;

// Sprite path for each symbol (1-indexed PNGs)
const symSprite = (id: number) => gamecornerAsset(`slot_machine/reel_symbols/${id + 1}.png`);

// Exact reel strips from pokeemerald C source
const REEL_STRIPS: number[][] = [
  // LEFT_REEL
  [0, 4, 2, 6, 5, 3, 1, 3, 4, 5, 6, 2, 0, 5, 3, 6, 2, 1, 5, 3, 6],
  // MIDDLE_REEL
  [0, 4, 6, 3, 2, 4, 6, 5, 5, 3, 1, 3, 6, 4, 2, 3, 6, 4, 3, 6, 4],
  // RIGHT_REEL
  [0, 5, 1, 6, 3, 2, 6, 3, 5, 2, 6, 3, 2, 5, 6, 3, 2, 5, 6, 3, 4],
];

function symAt(reel: number, pos: number) {
  const p = ((pos % SYM_COUNT) + SYM_COUNT) % SYM_COUNT;
  return REEL_STRIPS[reel][p];
}

// Match-line definitions from C source
const MATCH_LINES = [
  { name: 'Center',  rows: [1, 1, 1], color: '#FFD700', minBet: 1 },
  { name: 'Top',     rows: [0, 0, 0], color: '#FF6B6B', minBet: 2 },
  { name: 'Bottom',  rows: [2, 2, 2], color: '#FF6B6B', minBet: 2 },
  { name: 'Diag ↘',  rows: [0, 1, 2], color: '#6BFFB8', minBet: 3 },
  { name: 'Diag ↗',  rows: [2, 1, 0], color: '#6BFFB8', minBet: 3 },
];

// Digital display states
type DigDisplay = 'INSERT' | 'STOP' | 'WIN' | 'LOSE' | 'BONUS_REG' | 'BONUS_BIG' | 'REPLAY';

// Payout calculation - exact C source logic
function getMatchResult(syms: number[]): { payout: number; label: string; display: DigDisplay } {
  const [a, b, c] = syms;
  // All 3 same
  if (a === b && b === c) {
    switch (a) {
      case SYM.RED7:   return { payout: 300, label: 'BIG BONUS!', display: 'BONUS_BIG' };
      case SYM.BLUE7:  return { payout: 300, label: 'BIG BONUS!', display: 'BONUS_BIG' };
      case SYM.AZURILL: return { payout: 12, label: 'Azurill!', display: 'WIN' };
      case SYM.LOTAD:  return { payout: 6, label: 'Lotad!', display: 'WIN' };
      case SYM.CHERRY: return { payout: 6, label: 'Cherry!', display: 'WIN' };
      case SYM.POWER:  return { payout: 3, label: 'Power!', display: 'WIN' };
      case SYM.REPLAY: return { payout: 0, label: 'REPLAY', display: 'REPLAY' };
    }
  }
  // Mixed 7s (all are 7s but not all same)
  if ([a, b, c].every(s => s <= SYM.BLUE7)) return { payout: 90, label: 'REG BONUS!', display: 'BONUS_REG' };
  // Cherry on reel 1 (center)
  if (a === SYM.CHERRY) return { payout: 2, label: 'Cherry', display: 'WIN' };
  return { payout: 0, label: '', display: 'LOSE' };
}

// Top/Bottom cherry special check (C source: CheckMatch_TopAndBottom)
function checkTopBotCherry(grid: number[][]): number {
  const topLeft = grid[0][0] === SYM.CHERRY;
  const botLeft = grid[2][0] === SYM.CHERRY;
  if (topLeft && botLeft) return 4; // MATCH_TOPBOT_CHERRY
  if (topLeft || botLeft) return 2; // MATCH_CHERRY
  return 0;
}

export function SlotMachine({ coins, addCoins, spendCoins }: GameProps) {
  const [bet, setBet] = useState(1);
  const [reelPos, setReelPos] = useState([0, 0, 0]);
  const [spinning, setSpinning] = useState(false);
  const [reelStopped, setReelStopped] = useState([true, true, true]);
  const [digDisplay, setDigDisplay] = useState<DigDisplay>('INSERT');
  const [lastWin, setLastWin] = useState(0);
  const [winLineIdxs, setWinLineIdxs] = useState<number[]>([]);
  const [freeSpins, setFreeSpins] = useState(0);
  const [pikaPower, setPikaPower] = useState(0);
  const [payout, setPayout] = useState(0);
  const [paying, setPaying] = useState(false);
  const animRef = useRef(0);
  const payRef = useRef(0);

  // Coin-by-coin payout animation (faithful to C source - 8 frame delay per coin)
  useEffect(() => {
    if (payout <= 0) { setPaying(false); return; }
    setPaying(true);
    payRef.current = window.setTimeout(() => {
      addCoins(1);
      setPayout(p => p - 1);
    }, 50); // ~8 frames at 60fps
    return () => clearTimeout(payRef.current);
  }, [payout, addCoins]);

  const spin = useCallback(() => {
    if (spinning || paying) return;
    if (freeSpins <= 0 && coins < bet) {
      setDigDisplay('INSERT');
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
    setDigDisplay('STOP');
    setReelStopped([false, false, false]);

    const targets = [
      Math.floor(Math.random() * SYM_COUNT),
      Math.floor(Math.random() * SYM_COUNT),
      Math.floor(Math.random() * SYM_COUNT),
    ];

    let frame = 0;
    const stopFrames = [30, 42, 54]; // staggered stops
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

        // Build 3×3 grid: grid[row][col] with top=pos-1, center=pos, bottom=pos+1
        const grid = [0, 1, 2].map(row =>
          [0, 1, 2].map(col => symAt(col, targets[col] + row - 1))
        );

        let totalPay = 0;
        const wins: number[] = [];
        let gotReplay = false;
        let gotPower = false;
        let bestDisplay: DigDisplay = 'LOSE';

        // Check all active match lines
        for (let li = 0; li < MATCH_LINES.length; li++) {
          if (MATCH_LINES[li].minBet > bet) continue;
          const syms = MATCH_LINES[li].rows.map((r, c) => grid[r][c]);
          const result = getMatchResult(syms);
          if (result.label === 'REPLAY') {
            gotReplay = true;
            wins.push(li);
          } else if (result.payout > 0) {
            totalPay += result.payout;
            wins.push(li);
            // Priority: BONUS_BIG > BONUS_REG > WIN
            if (result.display === 'BONUS_BIG') bestDisplay = 'BONUS_BIG';
            else if (result.display === 'BONUS_REG' && bestDisplay !== 'BONUS_BIG') bestDisplay = 'BONUS_REG';
            else if (result.display === 'WIN' && bestDisplay === 'LOSE') bestDisplay = 'WIN';
          }
          // Track Power matches
          if (syms.every(s => s === SYM.POWER)) gotPower = true;
        }

        // Cherry top/bottom special (only at bet >= 2)
        if (bet >= 2) {
          const cherryBonus = checkTopBotCherry(grid);
          if (cherryBonus > 0) {
            totalPay += cherryBonus;
            if (bestDisplay === 'LOSE') bestDisplay = 'WIN';
          }
        }

        setWinLineIdxs(wins);

        if (gotReplay) {
          setFreeSpins(f => f + 1);
          setDigDisplay('REPLAY');
        }

        if (gotPower) {
          setPikaPower(pp => Math.min(16, pp + 1));
        }

        if (totalPay > 0) {
          setLastWin(totalPay);
          setPayout(totalPay);
          if (!gotReplay) setDigDisplay(bestDisplay);
        } else if (!gotReplay) {
          setDigDisplay('LOSE');
          // Pika Power accumulates on losses (C source behavior)
          setPikaPower(pp => {
            const next = pp + 1;
            if (next >= 16) {
              // Pika Power bonus - multiplied by bet
              setTimeout(() => {
                const bonus = bet * 10;
                setPayout(bonus);
                setLastWin(bonus);
                setDigDisplay('WIN');
              }, 400);
              return 0;
            }
            return next;
          });
        }
      }
    };

    animRef.current = requestAnimationFrame(animate);
  }, [spinning, paying, freeSpins, coins, bet, reelPos, spendCoins, addCoins]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    clearTimeout(payRef.current);
  }, []);

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

  // Digital display text
  const displayText: Record<DigDisplay, string> = {
    INSERT: 'INSERT COIN',
    STOP: '• • STOP • •',
    WIN: `WIN ${lastWin || payout}`,
    LOSE: 'LOSE',
    BONUS_REG: 'REG BONUS',
    BONUS_BIG: 'BIG BONUS',
    REPLAY: 'REPLAY',
  };

  return (
    <div className="slot-machine">
      {/* Digital display panel */}
      <div className={`slot-digital-display ${digDisplay.toLowerCase()}`}>
        <span>{displayText[digDisplay]}</span>
      </div>

      {/* Credit / Payout / Pika Power bar */}
      <div className="slot-info-bar">
        <div className="slot-info-item">
          <span className="slot-info-label">CREDIT</span>
          <span className="slot-info-value">{coins}</span>
        </div>
        <div className="slot-pika-power">
          <img src={gamecornerAsset('slot_machine/bolt.png')} alt="" className="slot-pika-icon" />
          <div className="slot-pika-bar">
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} className={`slot-pika-bolt ${i < pikaPower ? 'lit' : ''}`} />
            ))}
          </div>
        </div>
        <div className="slot-info-item">
          <span className="slot-info-label">PAYOUT</span>
          <span className={`slot-info-value ${payout > 0 ? 'paying' : ''}`}>{payout}</span>
        </div>
      </div>

      {/* Bet selector */}
      <div className="slot-bet-area">
        <div className="slot-bet-buttons">
          {[1, 2, 3].map(b => (
            <button
              key={b}
              className={`slot-bet-btn ${bet === b ? 'active' : ''}`}
              onClick={() => !spinning && !paying && setBet(b)}
              disabled={spinning || paying}
            >
              {b}
            </button>
          ))}
        </div>
        <span className="slot-bet-cost">BET: {bet}</span>
        {freeSpins > 0 && <span className="slot-free-spins">FREE: {freeSpins}</span>}
      </div>

      {/* Cabinet: line markers + reels + line markers */}
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
                      <img
                        src={symSprite(sym)}
                        alt={SYM_LABELS[sym]}
                        className="slot-sym-img"
                        draggable={false}
                      />
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

      {/* Spin button */}
      <button
        className={`slot-spin-btn ${spinning ? 'spinning' : ''}`}
        onClick={spin}
        disabled={spinning || paying}
      >
        {paying ? 'PAYING...' : spinning ? 'SPINNING...' : 'SPIN'}
      </button>

      {/* Paytable with actual sprites */}
      <div className="slot-paytable">
        <h3>Paytable</h3>
        <div className="slot-pay-grid">
          <div className="slot-pay-row jackpot">
            <span className="slot-pay-syms">
              <img src={symSprite(0)} alt="7R" /><img src={symSprite(0)} alt="7R" /><img src={symSprite(0)} alt="7R" />
            </span>
            <span>300</span>
          </div>
          <div className="slot-pay-row jackpot">
            <span className="slot-pay-syms">
              <img src={symSprite(1)} alt="7B" /><img src={symSprite(1)} alt="7B" /><img src={symSprite(1)} alt="7B" />
            </span>
            <span>300</span>
          </div>
          <div className="slot-pay-row jackpot">
            <span className="slot-pay-syms">
              <img src={symSprite(0)} alt="7" /><img src={symSprite(1)} alt="7" /> Mixed
            </span>
            <span>90</span>
          </div>
          <div className="slot-pay-row">
            <span className="slot-pay-syms">
              <img src={symSprite(2)} alt="Az" /><img src={symSprite(2)} alt="Az" /><img src={symSprite(2)} alt="Az" />
            </span>
            <span>12</span>
          </div>
          <div className="slot-pay-row">
            <span className="slot-pay-syms">
              <img src={symSprite(3)} alt="Lo" /><img src={symSprite(3)} alt="Lo" /><img src={symSprite(3)} alt="Lo" />
            </span>
            <span>6</span>
          </div>
          <div className="slot-pay-row">
            <span className="slot-pay-syms">
              <img src={symSprite(4)} alt="Ch" /><img src={symSprite(4)} alt="Ch" /><img src={symSprite(4)} alt="Ch" />
            </span>
            <span>6</span>
          </div>
          <div className="slot-pay-row">
            <span className="slot-pay-syms">
              <img src={symSprite(5)} alt="Pw" /><img src={symSprite(5)} alt="Pw" /><img src={symSprite(5)} alt="Pw" />
            </span>
            <span>3</span>
          </div>
          <div className="slot-pay-row">
            <span className="slot-pay-syms">
              <img src={symSprite(4)} alt="Ch" /> on reel 1
            </span>
            <span>2</span>
          </div>
          <div className="slot-pay-row replay">
            <span className="slot-pay-syms">
              <img src={symSprite(6)} alt="Re" /><img src={symSprite(6)} alt="Re" /><img src={symSprite(6)} alt="Re" />
            </span>
            <span>Free Spin</span>
          </div>
        </div>
        <div className="slot-line-legend">
          <span><b>Bet 1:</b> Center row</span>
          <span><b>Bet 2:</b> + Top &amp; Bottom</span>
          <span><b>Bet 3:</b> + Diagonals</span>
        </div>
      </div>
    </div>
  );
}
