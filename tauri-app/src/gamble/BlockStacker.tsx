import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GameProps } from './types';

/*
  Block Stacker – Blocks slide L/R, press to drop.
  Each successful stack = score. Misaligned parts get trimmed.
  Entry cost: 5 coins. Payout: score × 2 coins.
*/

const COLS = 10;
const ROWS = 15;
const TICK_MS = 200;
const ENTRY_COST = 5;

interface Layer { left: number; width: number; }

export function BlockStacker({ coins, addCoins, spendCoins }: GameProps) {
  const [playing, setPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [stack, setStack] = useState<Layer[]>([]);
  const [current, setCurrent] = useState<Layer>({ left: 0, width: 4 });
  const [currentRow, setCurrentRow] = useState(ROWS - 1);
  const [movingRight, setMovingRight] = useState(true);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState(`Stack blocks! ${ENTRY_COST} coins to play.`);
  const tickRef = useRef<number>(0);
  const stateRef = useRef({ left: 0, width: 4, right: true, row: ROWS - 1 });

  const start = useCallback(() => {
    if (coins < ENTRY_COST) { setMessage('Not enough coins!'); return; }
    spendCoins(ENTRY_COST);
    const base: Layer = { left: 3, width: 4 };
    setStack([base]);
    const first: Layer = { left: 0, width: 4 };
    setCurrent(first);
    setCurrentRow(ROWS - 2);
    setMovingRight(true);
    stateRef.current = { left: 0, width: 4, right: true, row: ROWS - 2 };
    setScore(0);
    setGameOver(false);
    setPlaying(true);
    setMessage('Click or press Space to drop!');
  }, [coins, spendCoins]);

  // Movement
  useEffect(() => {
    if (!playing) return;
    tickRef.current = window.setInterval(() => {
      const s = stateRef.current;
      let nl = s.left + (s.right ? 1 : -1);
      let nr = s.right;
      if (nl + s.width > COLS) { nl = COLS - s.width; nr = false; }
      if (nl < 0) { nl = 0; nr = true; }
      stateRef.current.left = nl;
      stateRef.current.right = nr;
      setCurrent({ left: nl, width: s.width });
      setMovingRight(nr);
    }, TICK_MS);
    return () => clearInterval(tickRef.current);
  }, [playing]);

  const drop = useCallback(() => {
    if (!playing) return;
    clearInterval(tickRef.current);
    const s = stateRef.current;
    const prev = stack[stack.length - 1];

    // Calculate overlap
    const overlapLeft = Math.max(s.left, prev.left);
    const overlapRight = Math.min(s.left + s.width, prev.left + prev.width);
    const overlapW = overlapRight - overlapLeft;

    if (overlapW <= 0) {
      // Missed entirely
      setPlaying(false);
      setGameOver(true);
      const payout = score * 2;
      if (payout > 0) addCoins(payout);
      setMessage(payout > 0 ? `Missed! Score: ${score}. Won ${payout} coins!` : 'Missed! No score.');
      return;
    }

    const newLayer: Layer = { left: overlapLeft, width: overlapW };
    const newStack = [...stack, newLayer];
    const newScore = score + 1;
    setStack(newStack);
    setScore(newScore);

    if (s.row <= 0) {
      // Reached the top!
      setPlaying(false);
      setGameOver(true);
      const payout = newScore * 2 + 20; // bonus for completing
      addCoins(payout);
      setMessage(`Perfect stack! Score: ${newScore}. Won ${payout} coins!`);
      return;
    }

    // Next layer
    const nextRow = s.row - 1;
    const speed = Math.max(80, TICK_MS - newScore * 8); // gets faster
    stateRef.current = { left: 0, width: overlapW, right: true, row: nextRow };
    setCurrent({ left: 0, width: overlapW });
    setCurrentRow(nextRow);
    setMovingRight(true);
    setMessage(`Score: ${newScore}. Keep stacking!`);

    tickRef.current = window.setInterval(() => {
      const st = stateRef.current;
      let nl = st.left + (st.right ? 1 : -1);
      let nr = st.right;
      if (nl + st.width > COLS) { nl = COLS - st.width; nr = false; }
      if (nl < 0) { nl = 0; nr = true; }
      stateRef.current.left = nl;
      stateRef.current.right = nr;
      setCurrent({ left: nl, width: st.width });
    }, speed);
  }, [playing, stack, score, addCoins]);

  // Input
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); drop(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, drop]);

  useEffect(() => () => clearInterval(tickRef.current), []);

  return (
    <div className="block-stacker">
      <h2>🧱 Block Stacker</h2>

      <div className="stacker-status">
        <span>Score: {score}</span>
        {!playing && <button className="mini" onClick={start}>{gameOver ? 'Play Again' : 'Start'} ({ENTRY_COST} coins)</button>}
        {playing && <button className="mini" onClick={drop}>DROP (Space)</button>}
      </div>

      <div className="stacker-message">{message}</div>

      <div className="stacker-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const col = i % COLS;
          const row = Math.floor(i / COLS);

          // Check if this cell is in any stack layer
          const stackIdx = stack.findIndex((layer, li) => {
            const layerRow = ROWS - 1 - li;
            return row === layerRow && col >= layer.left && col < layer.left + layer.width;
          });

          // Check if current moving block
          const isCurrent = playing && row === currentRow && col >= current.left && col < current.left + current.width;

          const hue = stackIdx >= 0 ? (stackIdx * 25) % 360 : 0;

          return (
            <div
              key={i}
              className={`stacker-cell ${stackIdx >= 0 ? 'stacked' : ''} ${isCurrent ? 'current' : ''}`}
              style={stackIdx >= 0 ? { backgroundColor: `hsl(${hue}, 70%, 55%)` } : isCurrent ? { backgroundColor: '#FFD700' } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
