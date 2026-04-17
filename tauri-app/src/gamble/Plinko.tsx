import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GameProps } from './types';

/*
  Plinko – Drop a ball through a peg board.
  Ball bounces L/R at each row. Landing zone determines multiplier.
  Cost: 5 coins per drop. Multipliers: 0× 0.5× 1× 2× 5× 10× 5× 2× 1× 0.5× 0×
  Uses pokeball sprite from pokeemerald game corner expansion.
*/

const ROWS = 10;
const COLS = 11; // landing zones = ROWS + 1
const MULTIPLIERS = [0, 0.5, 1, 2, 5, 10, 5, 2, 1, 0.5, 0];
const DROP_COST = 5;

/* Pokeball sprite for the ball (reuse from pinball) */
const BALL_IMG = '/gamecorner/pinball/ball_pokeball.png';

interface BallState {
  row: number;
  col: number; // fractional position (0 to COLS-1)
  path: number[];
  done: boolean;
  landed: number; // final column
}

export function Plinko({ coins, addCoins, spendCoins }: GameProps) {
  const [ball, setBall] = useState<BallState | null>(null);
  const [message, setMessage] = useState('Drop a ball for 5 coins!');
  const [lastWin, setLastWin] = useState(0);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef<number>(0);

  const drop = useCallback(() => {
    if (animating) return;
    if (coins < DROP_COST) { setMessage('Not enough coins!'); return; }
    spendCoins(DROP_COST);
    setLastWin(0);
    setMessage('Dropping...');
    setAnimating(true);

    // Pre-compute path
    const path: number[] = [5]; // start at center (col index 5)
    let col = 5;
    for (let r = 0; r < ROWS; r++) {
      col += Math.random() < 0.5 ? -0.5 : 0.5;
      col = Math.max(0, Math.min(COLS - 1, col));
      path.push(Math.round(col * 2) / 2);
    }
    const finalCol = Math.round(col);

    // Animate step by step
    let step = 0;
    setBall({ row: 0, col: 5, path, done: false, landed: finalCol });

    const tick = () => {
      step++;
      if (step <= ROWS) {
        setBall(prev => prev ? { ...prev, row: step, col: path[step] } : null);
        timerRef.current = window.setTimeout(tick, 150);
      } else {
        // Landed
        const mult = MULTIPLIERS[finalCol] || 0;
        const win = Math.floor(DROP_COST * mult);
        if (win > 0) addCoins(win);
        setLastWin(win);
        setBall(prev => prev ? { ...prev, done: true } : null);
        setMessage(mult > 0 ? `Landed on ${mult}×! Won ${win} coins!` : 'Landed on 0× — no win.');
        setAnimating(false);
      }
    };
    timerRef.current = window.setTimeout(tick, 150);
  }, [animating, coins, spendCoins, addCoins]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="plinko">
      <h2>Plinko</h2>

      <button className="plinko-drop-btn" onClick={drop} disabled={animating}>
        {animating ? 'Dropping...' : `Drop Ball (${DROP_COST} coins)`}
      </button>

      <div className={`plinko-message ${lastWin > 0 ? 'win' : ''}`}>{message}</div>

      <div className="plinko-board">
        {/* Peg rows */}
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="plinko-row" style={{ paddingLeft: r % 2 === 0 ? 0 : 14 }}>
            {Array.from({ length: COLS - (r % 2 === 0 ? 0 : 1) }, (_, c) => (
              <div key={c} className="plinko-peg">●</div>
            ))}
            {/* Ball on this row */}
            {ball && Math.floor(ball.row) === r && !ball.done && (
              <div className="plinko-ball" style={{ left: `${(ball.col / (COLS - 1)) * 100}%` }}>
                <span style={{ display: 'inline-block', width: 16, height: 16, overflow: 'hidden', lineHeight: 0 }}>
                  <img src={BALL_IMG} alt="ball" style={{ imageRendering: 'pixelated', width: 16, display: 'block' }} />
                </span>
              </div>
            )}
          </div>
        ))}

        {/* Landing zones */}
        <div className="plinko-zones">
          {MULTIPLIERS.map((m, i) => (
            <div key={i} className={`plinko-zone ${ball?.done && ball.landed === i ? 'hit' : ''} ${m >= 5 ? 'high' : m >= 2 ? 'med' : 'low'}`}>
              {m}×
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
