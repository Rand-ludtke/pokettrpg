import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GameProps } from './types';

/*
  Derby – Bet on Pokémon racers. 5 lanes, each racer has random speed.
  Entry: 10 coins per bet. Payout: 5× for correct pick.
*/

const ENTRY_COST = 10;
const TRACK_LEN = 20;
const TICK_MS = 200;

const RACERS = [
  { name: 'Rapidash', emoji: '🐎', color: '#FF6B35' },
  { name: 'Arcanine', emoji: '🐕', color: '#FF8C42' },
  { name: 'Dodrio',   emoji: '🐦', color: '#8B6914' },
  { name: 'Tauros',   emoji: '🐂', color: '#654321' },
  { name: 'Jolteon',  emoji: '⚡', color: '#FFD700' },
];

interface RacerState { pos: number; finished: boolean; }

export function Derby({ coins, addCoins, spendCoins }: GameProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [racing, setRacing] = useState(false);
  const [positions, setPositions] = useState<RacerState[]>(RACERS.map(() => ({ pos: 0, finished: false })));
  const [winner, setWinner] = useState<number | null>(null);
  const [message, setMessage] = useState('Pick a racer and bet!');
  const tickRef = useRef<number>(0);

  const startRace = useCallback(() => {
    if (picked === null) { setMessage('Pick a racer first!'); return; }
    if (coins < ENTRY_COST) { setMessage('Not enough coins!'); return; }
    spendCoins(ENTRY_COST);
    setRacing(true);
    setWinner(null);
    setPositions(RACERS.map(() => ({ pos: 0, finished: false })));
    setMessage('And they\'re off!');

    // Pre-compute speeds (random with slight variation each tick)
    const baseSpeed = RACERS.map(() => 0.8 + Math.random() * 0.6);

    tickRef.current = window.setInterval(() => {
      setPositions(prev => {
        const next = prev.map((r, i) => {
          if (r.finished) return r;
          const advance = baseSpeed[i] * (0.5 + Math.random());
          const newPos = Math.min(TRACK_LEN, r.pos + advance);
          return { pos: newPos, finished: newPos >= TRACK_LEN };
        });

        // Check winner
        const finisher = next.findIndex(r => r.finished && !prev[r.pos >= TRACK_LEN ? -1 : 0]?.finished);
        const firstFinished = next.findIndex(r => r.finished);
        if (firstFinished >= 0 && !prev[firstFinished].finished) {
          clearInterval(tickRef.current);
          setRacing(false);
          setWinner(firstFinished);
          if (firstFinished === picked) {
            const payout = ENTRY_COST * 5;
            addCoins(payout);
            setMessage(`🏆 ${RACERS[firstFinished].name} wins! You won ${payout} coins!`);
          } else {
            setMessage(`${RACERS[firstFinished].name} wins! Your pick ${RACERS[picked!].name} lost.`);
          }
        }
        return next;
      });
    }, TICK_MS);
  }, [picked, coins, spendCoins, addCoins]);

  const reset = useCallback(() => {
    setPicked(null);
    setWinner(null);
    setPositions(RACERS.map(() => ({ pos: 0, finished: false })));
    setMessage('Pick a racer and bet!');
  }, []);

  useEffect(() => () => clearInterval(tickRef.current), []);

  return (
    <div className="derby">
      <h2>🏇 Derby</h2>

      <div className="derby-message">{message}</div>

      <div className="derby-pick">
        {RACERS.map((r, i) => (
          <button
            key={i}
            className={`derby-racer-btn ${picked === i ? 'active' : ''}`}
            onClick={() => !racing && setPicked(i)}
            disabled={racing}
            style={{ borderColor: r.color }}
          >
            {r.emoji} {r.name}
          </button>
        ))}
      </div>

      <div className="derby-track">
        {RACERS.map((r, i) => (
          <div key={i} className="derby-lane">
            <span className="derby-label" style={{ color: r.color }}>{r.emoji}</span>
            <div className="derby-road">
              <div
                className={`derby-runner ${winner === i ? 'winner' : ''}`}
                style={{ left: `${(positions[i].pos / TRACK_LEN) * 100}%` }}
              >
                {r.emoji}
              </div>
              <div className="derby-finish-line" />
            </div>
          </div>
        ))}
      </div>

      {!racing && (
        <div className="derby-controls">
          {winner !== null ? (
            <button className="mini" onClick={reset}>New Race</button>
          ) : (
            <button className="derby-start-btn" onClick={startRace} disabled={picked === null}>
              Race! ({ENTRY_COST} coins)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
