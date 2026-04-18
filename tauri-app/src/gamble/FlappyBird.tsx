import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GameProps } from './types';
import { gamecornerAsset } from './assets';

/*
  Flappy Bird – Tap/click/space to flap. Navigate through gaps.
  Uses Butterfree sprite from pokeemerald game corner.
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
const BIRD_R = 24; // bigger hitbox for 64×64 sprite scaled down
const ENTRY_COST = 5;

const SP = gamecornerAsset('flappybird/');

/* Pre-load sprite images */
function loadImg(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

interface Pipe { x: number; topH: number; scored: boolean; }

export function FlappyBird({ coins, addCoins, spendCoins }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState(`Flap through pipes! ${ENTRY_COST} coins to play.`);

  /* Sprite images – loaded once */
  const spritesRef = useRef({
    butterfree: loadImg(`${SP}butterfree.png`),   // 64×192 = 3 frames of 64×64
    bg: loadImg(`${SP}flappy-bg.png`),             // 128×40 tileable bg
    fg: loadImg(`${SP}flappy-fg.png`),             // 128×24 tileable fg
    topleft: loadImg(`${SP}topleft.png`),           // pipe cap top
    bottomleft: loadImg(`${SP}bottomleft.png`),     // pipe cap bottom
  });

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
      const spr = spritesRef.current;

      // Background – tile the bg sprite
      ctx.fillStyle = '#1a1a3e';
      ctx.fillRect(0, 0, W, H);
      if (spr.bg.complete && spr.bg.naturalWidth > 0) {
        const scale = 3;
        const bgW = spr.bg.naturalWidth * scale;
        const bgH = spr.bg.naturalHeight * scale;
        const scrollX = (s.frame * 0.5) % bgW;
        ctx.imageSmoothingEnabled = false;
        for (let x = -scrollX; x < W; x += bgW) {
          ctx.drawImage(spr.bg, x, H - bgH - 6, bgW, bgH);
        }
      }

      // Pipes – green with GBA-style pipe caps
      for (const p of s.pipes) {
        // Pipe body
        ctx.fillStyle = '#2d8a4e';
        ctx.fillRect(p.x, 0, PIPE_W, p.topH);
        ctx.fillRect(p.x, p.topH + GAP, PIPE_W, H - p.topH - GAP);
        // Pipe caps
        ctx.fillStyle = '#3ab05a';
        ctx.fillRect(p.x - 3, p.topH - 12, PIPE_W + 6, 12);
        ctx.fillRect(p.x - 3, p.topH + GAP, PIPE_W + 6, 12);
        // Pipe cap highlights
        ctx.fillStyle = '#5ac07a';
        ctx.fillRect(p.x - 1, p.topH - 10, PIPE_W + 2, 3);
        ctx.fillRect(p.x - 1, p.topH + GAP + 2, PIPE_W + 2, 3);
      }

      // Butterfree – draw from sprite sheet (3 frames of 64×64)
      ctx.imageSmoothingEnabled = false;
      if (spr.butterfree.complete && spr.butterfree.naturalWidth > 0) {
        const flapFrame = Math.floor(s.frame / 6) % 3;
        const sprW = 64;
        const sprH = 64;
        const drawSize = 40;
        // Slight rotation based on velocity
        const angle = Math.max(-0.5, Math.min(0.5, s.vel * 0.05));
        ctx.save();
        ctx.translate(BIRD_X, s.birdY);
        ctx.rotate(angle);
        ctx.drawImage(
          spr.butterfree,
          0, flapFrame * sprH, sprW, sprH,   // source: frame from sprite sheet
          -drawSize / 2, -drawSize / 2, drawSize, drawSize  // dest: centered on bird pos
        );
        ctx.restore();
      } else {
        // Fallback circle while loading
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(BIRD_X, s.birdY, 14, 0, Math.PI * 2);
        ctx.fill();
      }

      // Foreground – tile the fg sprite
      if (spr.fg.complete && spr.fg.naturalWidth > 0) {
        const scale = 3;
        const fgW = spr.fg.naturalWidth * scale;
        const fgH = spr.fg.naturalHeight * scale;
        const scrollX = (s.frame * 1.5) % fgW;
        ctx.imageSmoothingEnabled = false;
        for (let x = -scrollX; x < W; x += fgW) {
          ctx.drawImage(spr.fg, x, H - fgH, fgW, fgH);
        }
      }

      // Score
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText(String(s.score), W / 2, 40);
      ctx.fillText(String(s.score), W / 2, 40);
      ctx.fillStyle = '#5a3825';
      ctx.fillRect(0, H - 2, W, 2);

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, addCoins]);

  return (
    <div className="flappy-bird">
      <h2>Flappy Bird</h2>

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
