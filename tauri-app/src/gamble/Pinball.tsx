import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GameProps } from './types';

/*
  Pinball / Pachinko – launch a ball and watch it bounce through pegs into scoring zones.
  Inspired by the pokeemerald pachinko mini-game.
  Uses pokeball sprite from pokeemerald game corner expansion.
  Canvas-based for smooth animation.
*/

const W = 320;
const H = 480;
const BALL_R = 8;
const PEG_R = 4;
const GRAVITY = 0.15;
const BOUNCE = 0.55;
const FRICTION = 0.998;
const ENTRY_COST = 10;
const BALLS_PER_GAME = 5;

const PIN_SP = '/gamecorner/pinball/';

/* ball_pokeball.png: 16×128 = 8 frames of 16×16 */
function loadImg(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

const ZONE_COUNT = 9;
const ZONE_MULTIPLIERS = [0, 1, 2, 5, 10, 5, 2, 1, 0];
const ZONE_LABELS = ['0×', '1×', '2×', '5×', '10×', '5×', '2×', '1×', '0×'];
const ZONE_COLORS = ['#555', '#666', '#2d8a4e', '#2196F3', '#FFD700', '#2196F3', '#2d8a4e', '#666', '#555'];

interface Peg { x: number; y: number; lit: number }
interface Ball { x: number; y: number; vx: number; vy: number; active: boolean }

function buildPegs(): Peg[] {
  const pegs: Peg[] = [];
  const rows = 10;
  const startY = 80;
  const rowGap = 36;
  for (let r = 0; r < rows; r++) {
    const count = r % 2 === 0 ? 8 : 9;
    const offset = r % 2 === 0 ? (W / 9) : (W / 9) - (W / 18);
    for (let c = 0; c < count; c++) {
      pegs.push({ x: offset + c * (W / 9) + (W / 18), y: startY + r * rowGap, lit: 0 });
    }
  }
  return pegs;
}

export function Pinball({ coins, addCoins, spendCoins }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    balls: [] as Ball[],
    pegs: buildPegs(),
    phase: 'idle' as 'idle' | 'playing' | 'done',
    ballsLeft: 0,
    score: 0,
    launchTimer: 0,
    zoneLit: new Array(ZONE_COUNT).fill(0),
  });
  const [phase, setPhase] = useState<'idle' | 'playing' | 'done'>('idle');
  const [score, setScore] = useState(0);
  const [ballsLeft, setBallsLeft] = useState(0);
  const [message, setMessage] = useState(`Launch ${BALLS_PER_GAME} balls for ${ENTRY_COST} coins!`);
  const animRef = useRef(0);
  const pokeballImg = useRef(loadImg(`${PIN_SP}ball_pokeball.png`));

  const launchBall = useCallback(() => {
    const s = stateRef.current;
    if (s.ballsLeft <= 0) return;
    s.ballsLeft--;
    const spread = (Math.random() - 0.5) * 2;
    s.balls.push({ x: W / 2 + spread * 20, y: 10, vx: spread * 1.5, vy: 1, active: true });
    setBallsLeft(s.ballsLeft);
  }, []);

  const startGame = useCallback(() => {
    if (!spendCoins(ENTRY_COST)) { setMessage('Not enough coins!'); return; }
    const s = stateRef.current;
    s.balls = [];
    s.pegs = buildPegs();
    s.phase = 'playing';
    s.ballsLeft = BALLS_PER_GAME;
    s.score = 0;
    s.launchTimer = 0;
    s.zoneLit = new Array(ZONE_COUNT).fill(0);
    setPhase('playing');
    setScore(0);
    setBallsLeft(BALLS_PER_GAME);
    setMessage('Click to launch balls!');
  }, [spendCoins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const zoneW = W / ZONE_COUNT;
    const zoneY = H - 36;

    function tick() {
      const s = stateRef.current;

      // Auto-launch on interval while playing
      if (s.phase === 'playing' && s.ballsLeft > 0) {
        s.launchTimer++;
        if (s.launchTimer > 40 && s.balls.filter(b => b.active).length === 0) {
          // auto-launch if no active ball
        }
      }

      // Physics
      for (const ball of s.balls) {
        if (!ball.active) continue;
        ball.vy += GRAVITY;
        ball.vx *= FRICTION;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Wall bounce
        if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * BOUNCE; }
        if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx) * BOUNCE; }

        // Peg collision
        for (const peg of s.pegs) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = BALL_R + PEG_R;
          if (dist < minDist && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            ball.x = peg.x + nx * minDist;
            ball.y = peg.y + ny * minDist;
            const dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 2 * dot * nx * BOUNCE;
            ball.vy -= 2 * dot * ny * BOUNCE;
            // Add slight random deflection
            ball.vx += (Math.random() - 0.5) * 0.5;
            peg.lit = 8;
          }
        }

        // Zone detection
        if (ball.y > zoneY) {
          ball.active = false;
          const zi = Math.min(ZONE_COUNT - 1, Math.max(0, Math.floor(ball.x / zoneW)));
          const mult = ZONE_MULTIPLIERS[zi];
          s.score += mult * ENTRY_COST;
          s.zoneLit[zi] = 15;
          setScore(s.score);
        }
      }

      // Decay peg/zone lit
      for (const peg of s.pegs) if (peg.lit > 0) peg.lit--;
      for (let i = 0; i < s.zoneLit.length; i++) if (s.zoneLit[i] > 0) s.zoneLit[i]--;

      // Check done
      if (s.phase === 'playing' && s.ballsLeft === 0 && s.balls.every(b => !b.active)) {
        s.phase = 'done';
        setPhase('done');
        if (s.score > 0) addCoins(s.score);
        setMessage(s.score > 0 ? `Done! Won ${s.score} coins!` : 'No luck this time!');
      }

      // Draw
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0a1a');
      bg.addColorStop(1, '#1a1a3e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Pegs
      for (const peg of s.pegs) {
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, PEG_R, 0, Math.PI * 2);
        ctx.fillStyle = peg.lit > 0 ? `hsl(45, 100%, ${50 + peg.lit * 3}%)` : '#556';
        ctx.fill();
      }

      // Zones
      for (let i = 0; i < ZONE_COUNT; i++) {
        const x = i * zoneW;
        const glow = s.zoneLit[i] > 0;
        ctx.fillStyle = glow ? '#fff' : ZONE_COLORS[i];
        ctx.fillRect(x + 1, zoneY, zoneW - 2, H - zoneY);
        ctx.fillStyle = glow ? '#000' : '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ZONE_LABELS[i], x + zoneW / 2, zoneY + 22);
      }

      // Balls – draw with pokeball sprite
      const pbImg = pokeballImg.current;
      ctx.imageSmoothingEnabled = false;
      for (const ball of s.balls) {
        if (!ball.active) continue;
        if (pbImg.complete && pbImg.naturalWidth > 0) {
          // 8 frames of 16×16, animate based on frame counter
          const frame = Math.floor(Date.now() / 100) % 8;
          const sprSize = 16;
          const drawSize = BALL_R * 2.5;
          ctx.drawImage(
            pbImg,
            0, frame * sprSize, sprSize, sprSize,
            ball.x - drawSize / 2, ball.y - drawSize / 2, drawSize, drawSize
          );
        } else {
          // Fallback while loading
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
          ctx.fillStyle = '#ff4444';
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillRect(ball.x - BALL_R, ball.y - 1, BALL_R * 2, 2);
        }
      }

      // Launch area indicator
      if (s.phase === 'playing' && s.ballsLeft > 0) {
        ctx.fillStyle = 'rgba(255,215,0,0.15)';
        ctx.fillRect(W / 2 - 40, 0, 80, 30);
        ctx.fillStyle = '#FFD700';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▼ CLICK TO LAUNCH ▼', W / 2, 20);
      }

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [addCoins]);

  const handleCanvasClick = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'playing' && s.ballsLeft > 0) {
      launchBall();
    }
  }, [launchBall]);

  return (
    <div className="pinball" style={{ textAlign: 'center' }}>
      <h2>Pinball</h2>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '8px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Score: <b>{score}</b></span>
        <span>Balls: <b>{ballsLeft}</b></span>
      </div>
      <div className="pinball-message" style={{ margin: '8px 0', minHeight: 24 }}>{message}</div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onClick={handleCanvasClick}
        style={{ display: 'block', margin: '8px auto', border: '2px solid var(--accent)', borderRadius: 8, cursor: phase === 'playing' ? 'pointer' : 'default' }}
      />
      {phase !== 'playing' && (
        <button className="pinball-start-btn" onClick={startGame} style={{
          padding: '10px 24px', fontSize: 16, fontWeight: 700,
          background: 'var(--accent)', color: 'white', border: 'none',
          borderRadius: 10, cursor: 'pointer', margin: '8px 0',
        }}>
          {phase === 'done' ? 'Play Again' : 'Start'} ({ENTRY_COST} coins)
        </button>
      )}
    </div>
  );
}
