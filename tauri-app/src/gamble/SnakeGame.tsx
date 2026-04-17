import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GameProps } from './types';

/*
  Snake – Classic snake game. Eat coins on the grid.
  Each coin eaten = +1 coin. Score at end = bonus coins.
  Entry cost: 5 coins. Payout: 1 coin per food eaten.
*/

const GRID = 20;
const TICK_MS = 120;
const ENTRY_COST = 5;

type Pos = { x: number; y: number };
type Dir = 'up' | 'down' | 'left' | 'right';

function randomPos(exclude: Pos[]): Pos {
  let p: Pos;
  do {
    p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (exclude.some(e => e.x === p.x && e.y === p.y));
  return p;
}

export function SnakeGame({ coins, addCoins, spendCoins }: GameProps) {
  const [playing, setPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [snake, setSnake] = useState<Pos[]>([{ x: 10, y: 10 }]);
  const [food, setFood] = useState<Pos>({ x: 5, y: 5 });
  const [dir, setDir] = useState<Dir>('right');
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState(`Play Snake for ${ENTRY_COST} coins!`);
  const dirRef = useRef<Dir>('right');
  const tickRef = useRef<number>(0);

  const start = useCallback(() => {
    if (coins < ENTRY_COST) { setMessage('Not enough coins!'); return; }
    spendCoins(ENTRY_COST);
    const initial = [{ x: 10, y: 10 }];
    setSnake(initial);
    setFood(randomPos(initial));
    setDir('right');
    dirRef.current = 'right';
    setScore(0);
    setGameOver(false);
    setPlaying(true);
    setMessage('Use arrow keys or WASD to move!');
  }, [coins, spendCoins]);

  // Keyboard
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const map: Record<string, Dir> = {
        arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right',
      };
      const nd = map[key];
      if (!nd) return;
      e.preventDefault();
      // Prevent 180° reversal
      const opposites: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
      if (nd !== opposites[dirRef.current]) {
        dirRef.current = nd;
        setDir(nd);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  // Game loop
  useEffect(() => {
    if (!playing || gameOver) return;

    const tick = () => {
      setSnake(prev => {
        const head = prev[0];
        const d = dirRef.current;
        const next: Pos = {
          x: d === 'left' ? head.x - 1 : d === 'right' ? head.x + 1 : head.x,
          y: d === 'up' ? head.y - 1 : d === 'down' ? head.y + 1 : head.y,
        };

        // Wall collision
        if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
          setGameOver(true);
          setPlaying(false);
          setScore(s => {
            const payout = s;
            if (payout > 0) addCoins(payout);
            setMessage(payout > 0 ? `Game Over! Score: ${s}. Won ${payout} coins!` : `Game Over! Score: ${s}.`);
            return s;
          });
          return prev;
        }

        // Self collision
        if (prev.some(p => p.x === next.x && p.y === next.y)) {
          setGameOver(true);
          setPlaying(false);
          setScore(s => {
            const payout = s;
            if (payout > 0) addCoins(payout);
            setMessage(payout > 0 ? `Game Over! Score: ${s}. Won ${payout} coins!` : `Game Over! Score: ${s}.`);
            return s;
          });
          return prev;
        }

        const newSnake = [next, ...prev];

        // Food?
        setFood(f => {
          if (next.x === f.x && next.y === f.y) {
            setScore(s => s + 1);
            // Don't pop tail (grow)
            const newFood = randomPos(newSnake);
            return newFood;
          }
          // Pop tail (no growth)
          newSnake.pop();
          return f;
        });

        return newSnake;
      });
    };

    tickRef.current = window.setInterval(tick, TICK_MS);
    return () => clearInterval(tickRef.current);
  }, [playing, gameOver, addCoins]);

  return (
    <div className="snake-game">
      <h2>🐍 Snake</h2>

      <div className="snake-status">
        <span>Score: {score}</span>
        {!playing && <button className="mini" onClick={start}>{gameOver ? 'Play Again' : 'Start'} ({ENTRY_COST} coins)</button>}
      </div>

      <div className="snake-message">{message}</div>

      <div className="snake-grid" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }}>
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const x = i % GRID;
          const y = Math.floor(i / GRID);
          const isHead = snake[0]?.x === x && snake[0]?.y === y;
          const isBody = snake.some(p => p.x === x && p.y === y);
          const isFood = food.x === x && food.y === y;
          return (
            <div key={i} className={`snake-cell ${isHead ? 'head' : isBody ? 'body' : ''} ${isFood ? 'food' : ''}`}>
              {isHead ? '🟢' : isFood ? '🪙' : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}
