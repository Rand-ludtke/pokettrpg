import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GameProps } from './types';

/*
  Roulette – bet on numbers, colors, or sections; spin the wheel.
  Simplified Pokémon-themed roulette with canvas wheel rendering.
*/

const POCKETS = 12;
const COLORS = ['#e74c3c', '#2c3e50', '#e74c3c', '#2c3e50', '#e74c3c', '#2c3e50',
                '#e74c3c', '#2c3e50', '#e74c3c', '#2c3e50', '#e74c3c', '#2c3e50'];
const POCKET_LABELS = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const EMOJIS = ['🔥','💧','🔥','💧','🔥','💧','🔥','💧','🔥','💧','🔥','💧'];

type BetType = 'number' | 'red' | 'black' | 'odd' | 'even' | 'high' | 'low';

interface Bet {
  type: BetType;
  value?: number; // for number bets
  amount: number;
}

const BET_OPTIONS: { type: BetType; label: string; payout: number; desc: string }[] = [
  { type: 'red', label: '🔥 Red', payout: 2, desc: '2×' },
  { type: 'black', label: '💧 Black', payout: 2, desc: '2×' },
  { type: 'odd', label: 'Odd', payout: 2, desc: '2×' },
  { type: 'even', label: 'Even', payout: 2, desc: '2×' },
  { type: 'low', label: '1-6', payout: 2, desc: '2×' },
  { type: 'high', label: '7-12', payout: 2, desc: '2×' },
];

const W = 300;
const H = 300;
const CX = W / 2;
const CY = H / 2;
const OUTER_R = 130;
const INNER_R = 70;

function checkWin(pocket: number, bet: Bet): boolean {
  const num = pocket + 1;
  switch (bet.type) {
    case 'number': return num === bet.value;
    case 'red': return pocket % 2 === 0;
    case 'black': return pocket % 2 === 1;
    case 'odd': return num % 2 === 1;
    case 'even': return num % 2 === 0;
    case 'low': return num <= 6;
    case 'high': return num >= 7;
  }
}

function getPayout(bet: Bet): number {
  if (bet.type === 'number') return bet.amount * POCKETS;
  return bet.amount * 2;
}

export function Roulette({ coins, addCoins, spendCoins }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [message, setMessage] = useState('Place your bets!');
  const [betAmount, setBetAmount] = useState(10);
  const [selectedBet, setSelectedBet] = useState<BetType>('red');
  const [numberBet, setNumberBet] = useState(1);
  const angleRef = useRef(0);
  const targetAngleRef = useRef(0);
  const spinningRef = useRef(false);
  const animRef = useRef(0);

  // Draw wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      const angle = angleRef.current;
      const sliceAngle = (Math.PI * 2) / POCKETS;

      // Draw pockets
      for (let i = 0; i < POCKETS; i++) {
        const startA = angle + i * sliceAngle;
        const endA = startA + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, OUTER_R, startA, endA);
        ctx.closePath();

        const isResult = result === i && !spinningRef.current;
        ctx.fillStyle = isResult ? '#FFD700' : COLORS[i];
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        const midA = startA + sliceAngle / 2;
        const lx = CX + Math.cos(midA) * (OUTER_R * 0.72);
        const ly = CY + Math.sin(midA) * (OUTER_R * 0.72);
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(midA + Math.PI / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(POCKET_LABELS[i], 0, 0);
        ctx.restore();

        // Emoji in inner ring
        const ex = CX + Math.cos(midA) * (OUTER_R * 0.45);
        const ey = CY + Math.sin(midA) * (OUTER_R * 0.45);
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(EMOJIS[i], ex, ey);
      }

      // Center circle
      ctx.beginPath();
      ctx.arc(CX, CY, 25, 0, Math.PI * 2);
      const cg = ctx.createRadialGradient(CX, CY, 5, CX, CY, 25);
      cg.addColorStop(0, '#555');
      cg.addColorStop(1, '#222');
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Pointer (top)
      ctx.beginPath();
      ctx.moveTo(CX, CY - OUTER_R - 10);
      ctx.lineTo(CX - 8, CY - OUTER_R - 22);
      ctx.lineTo(CX + 8, CY - OUTER_R - 22);
      ctx.closePath();
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      ctx.strokeStyle = '#a90';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [result]);

  const spin = useCallback(() => {
    if (spinning) return;
    if (!spendCoins(betAmount)) { setMessage('Not enough coins!'); return; }

    setSpinning(true);
    spinningRef.current = true;
    setResult(null);
    setMessage('Spinning...');

    const winPocket = Math.floor(Math.random() * POCKETS);
    const sliceAngle = (Math.PI * 2) / POCKETS;
    // Spin several full rotations + land on pocket
    // The pointer is at top (angle = -π/2), so we need to align pocket center to top
    const targetAngle = -(winPocket * sliceAngle + sliceAngle / 2) - Math.PI / 2;
    const fullSpins = 4 + Math.floor(Math.random() * 3);
    const totalAngle = fullSpins * Math.PI * 2 + (targetAngle - (angleRef.current % (Math.PI * 2)));

    const startAngle = angleRef.current;
    const endAngle = startAngle + totalAngle;
    const duration = 3000 + Math.random() * 1000;
    const startTime = performance.now();

    function animateSpin() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - t, 3);
      angleRef.current = startAngle + (endAngle - startAngle) * ease;

      if (t < 1) {
        requestAnimationFrame(animateSpin);
      } else {
        angleRef.current = endAngle;
        spinningRef.current = false;
        setSpinning(false);
        setResult(winPocket);

        const bet: Bet = {
          type: selectedBet,
          value: selectedBet === 'number' ? numberBet : undefined,
          amount: betAmount,
        };
        const won = checkWin(winPocket, bet);
        if (won) {
          const payout = getPayout(bet);
          addCoins(payout);
          setMessage(`🎉 Landed on ${winPocket + 1}! You won ${payout} coins!`);
        } else {
          setMessage(`Landed on ${winPocket + 1}. Better luck next time!`);
        }
      }
    }

    requestAnimationFrame(animateSpin);
  }, [spinning, spendCoins, betAmount, selectedBet, numberBet, addCoins]);

  return (
    <div className="roulette" style={{ textAlign: 'center' }}>
      <h2>🎡 Roulette</h2>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ display: 'block', margin: '8px auto' }}
      />

      <div className="roulette-message" style={{ margin: '8px 0', minHeight: 24, fontWeight: result !== null ? 700 : 400 }}>{message}</div>

      {/* Bet amount */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Bet:</span>
        {[5, 10, 25, 50, 100].map(v => (
          <button key={v}
            style={{
              padding: '4px 10px', border: '2px solid var(--accent)',
              background: betAmount === v ? 'var(--accent)' : 'transparent',
              color: betAmount === v ? 'white' : 'var(--fg)',
              borderRadius: 6, cursor: 'pointer', fontWeight: 700,
            }}
            onClick={() => setBetAmount(v)}
            disabled={spinning}
          >{v}</button>
        ))}
      </div>

      {/* Bet type */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        {BET_OPTIONS.map(o => (
          <button key={o.type}
            style={{
              padding: '6px 12px', border: '2px solid var(--accent)',
              background: selectedBet === o.type ? 'var(--accent)' : 'transparent',
              color: selectedBet === o.type ? 'white' : 'var(--fg)',
              borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
            onClick={() => setSelectedBet(o.type)}
            disabled={spinning}
          >{o.label} ({o.desc})</button>
        ))}
        <button
          style={{
            padding: '6px 12px', border: '2px solid var(--accent)',
            background: selectedBet === 'number' ? 'var(--accent)' : 'transparent',
            color: selectedBet === 'number' ? 'white' : 'var(--fg)',
            borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
          onClick={() => setSelectedBet('number')}
          disabled={spinning}
        ># Exact ({POCKETS}×)</button>
      </div>

      {selectedBet === 'number' && (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', margin: '4px 0', flexWrap: 'wrap' }}>
          {Array.from({ length: POCKETS }, (_, i) => i + 1).map(n => (
            <button key={n}
              style={{
                width: 30, height: 30, border: '2px solid',
                borderColor: numberBet === n ? '#FFD700' : COLORS[n - 1],
                background: numberBet === n ? '#FFD700' : COLORS[n - 1],
                color: 'white', borderRadius: '50%', cursor: 'pointer',
                fontWeight: 700, fontSize: 12,
                opacity: numberBet === n ? 1 : 0.7,
              }}
              onClick={() => setNumberBet(n)}
              disabled={spinning}
            >{n}</button>
          ))}
        </div>
      )}

      <button onClick={spin} disabled={spinning} style={{
        padding: '12px 28px', fontSize: 16, fontWeight: 700,
        background: 'var(--accent)', color: 'white', border: 'none',
        borderRadius: 10, cursor: 'pointer', margin: '12px 0',
        opacity: spinning ? 0.5 : 1,
      }}>
        {spinning ? 'Spinning...' : `Spin! (${betAmount} coins)`}
      </button>
    </div>
  );
}
