import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GameProps } from './types';

/*
  Flappy Bird – Tap/click/space to flap. Navigate through gaps.
  Entry cost: 5 coins. Payout: 1 coin per pipe passed.
  Canvas-based for smooth animation.
*/

const W = 320;
const H = 480;
const GRAVITY = 0.5;
const FLAP = -7;
const PIPE_W = 40;
const GAP = 120;
const PIPE_SPEED = 2.5;
const BIRD_X = 60;
const BIRD_R = 14;
const ENTRY_COST = 5;

interface Pipe { x: number; topH: number; scored: boolean; }

export function FlappyBird({ coins, addCoins, spendCoins }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState(`Flap through pipes! ${ENTRY_COST} coins to play.`);

  const stateRef = useRef({
    birdY: H / 2,
    vel: 0,
    pipes: [] as Pipe[],
    score: 0,
    frame: 0,
    running: false,
  });

  const start = useCallback(() => {
    if (coins < ENTRY_COST) { setMessage('Not enough coins!'); return; }
    spendCoins(ENTRY_COST);
    stateRef.current = {
      birdY: H / 2,
      vel: 0,
      pipes: [],
      score: 0,
      frame: 0,
      running: true,
    };
    setScore(0);
    setGameOver(false);
    setPlaying(true);
    setMessage('Click or press Space to flap!');
  }, [coins, spendCoins]);

  const flap = useCallback(() => {
    if (!stateRef.current.running) return;
    stateRef.current.vel = FLAP;
  }, []);

  // Input handlers
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); flap(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, flap]);

  // Game loop
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const loop = () => {
      const s = stateRef.current;
      if (!s.running) return;

      // Physics
      s.vel += GRAVITY;
      s.birdY += s.vel;
      s.frame++;

      // Spawn pipes
      if (s.frame % 90 === 0) {
        const topH = 40 + Math.random() * (H - GAP - 80);
        s.pipes.push({ x: W, topH, scored: false });
      }

      // Move pipes
      for (const p of s.pipes) p.x -= PIPE_SPEED;
      s.pipes = s.pipes.filter(p => p.x > -PIPE_W);

      // Scoring
      for (const p of s.pipes) {
        if (!p.scored && p.x + PIPE_W < BIRD_X) {
          p.scored = true;
          s.score++;
          setScore(s.score);
        }
      }

      // Collision
      let dead = s.birdY < BIRD_R || s.birdY > H - BIRD_R;
      if (!dead) {
        for (const p of s.pipes) {
          if (BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W) {
            if (s.birdY - BIRD_R < p.topH || s.birdY + BIRD_R > p.topH + GAP) {
              dead = true;
              break;
            }
          }
        }
      }

      if (dead) {
        s.running = false;
        setPlaying(false);
        setGameOver(true);
        const payout = s.score;
        if (payout > 0) addCoins(payout);
        setMessage(payout > 0 ? `Game Over! Passed ${s.score} pipes. Won ${payout} coins!` : 'Game Over! No pipes passed.');
        return;
      }

      // Draw
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(0, 0, W, H);

      // Pipes
      ctx.fillStyle = '#2d8a4e';
      for (const p of s.pipes) {
        ctx.fillRect(p.x, 0, PIPE_W, p.topH);
        ctx.fillRect(p.x, p.topH + GAP, PIPE_W, H - p.topH - GAP);
        // Pipe caps
        ctx.fillStyle = '#3ab05a';
        ctx.fillRect(p.x - 3, p.topH - 10, PIPE_W + 6, 10);
        ctx.fillRect(p.x - 3, p.topH + GAP, PIPE_W + 6, 10);
        ctx.fillStyle = '#2d8a4e';
      }

      // Bird
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(BIRD_X, s.birdY, BIRD_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(BIRD_X + 5, s.birdY - 3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(BIRD_X + 6, s.birdY - 3, 2, 0, Math.PI * 2);
      ctx.fill();

      // Score
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(s.score), W / 2, 40);

      // Ground line
      ctx.fillStyle = '#5a3825';
      ctx.fillRect(0, H - 2, W, 2);

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, addCoins]);

  return (
    <div className="flappy-bird">
      <h2>🐦 Flappy Bird</h2>

      {!playing && (
        <button className="flappy-start-btn" onClick={start}>
          {gameOver ? 'Play Again' : 'Start'} ({ENTRY_COST} coins)
        </button>
      )}

      <div className="flappy-message">{message}</div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="flappy-canvas"
        onClick={flap}
      />
    </div>
  );
}
