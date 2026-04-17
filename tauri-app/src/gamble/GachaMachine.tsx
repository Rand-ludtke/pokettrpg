import React, { useState, useCallback } from 'react';
import { GameProps } from './types';

/*
  Gacha Machine – Spend coins for random prizes (cosmetic items, titles, etc.)
  Each pull costs 50 coins. Shows a fun animation/reveal.
*/

const PULL_COST = 50;

interface Prize {
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  emoji: string;
}

const PRIZE_POOL: Prize[] = [
  // Common (60%)
  { name: 'Potion', rarity: 'common', emoji: '🧴' },
  { name: 'Poké Ball', rarity: 'common', emoji: '🔴' },
  { name: 'Antidote', rarity: 'common', emoji: '💊' },
  { name: 'Repel', rarity: 'common', emoji: '🌫️' },
  { name: 'Berry', rarity: 'common', emoji: '🍓' },
  { name: 'Nugget Shard', rarity: 'common', emoji: '💎' },
  // Uncommon (25%)
  { name: 'Great Ball', rarity: 'uncommon', emoji: '🔵' },
  { name: 'Super Potion', rarity: 'uncommon', emoji: '💧' },
  { name: 'Rare Candy', rarity: 'uncommon', emoji: '🍬' },
  { name: 'PP Up', rarity: 'uncommon', emoji: '⬆️' },
  // Rare (12%)
  { name: 'Ultra Ball', rarity: 'rare', emoji: '🟡' },
  { name: 'TM Disc', rarity: 'rare', emoji: '💿' },
  { name: 'Gold Nugget', rarity: 'rare', emoji: '🪙' },
  // Legendary (3%)
  { name: 'Master Ball', rarity: 'legendary', emoji: '🟣' },
  { name: 'Sacred Ash', rarity: 'legendary', emoji: '✨' },
];

function pullPrize(): Prize {
  const roll = Math.random() * 100;
  let pool: Prize[];
  if (roll < 3) pool = PRIZE_POOL.filter(p => p.rarity === 'legendary');
  else if (roll < 15) pool = PRIZE_POOL.filter(p => p.rarity === 'rare');
  else if (roll < 40) pool = PRIZE_POOL.filter(p => p.rarity === 'uncommon');
  else pool = PRIZE_POOL.filter(p => p.rarity === 'common');
  return pool[Math.floor(Math.random() * pool.length)];
}

const RARITY_COLORS: Record<string, string> = {
  common: '#aaa',
  uncommon: '#4CAF50',
  rare: '#2196F3',
  legendary: '#FFD700',
};

export function GachaMachine({ coins, addCoins, spendCoins }: GameProps) {
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<Prize | null>(null);
  const [history, setHistory] = useState<Prize[]>([]);
  const [message, setMessage] = useState(`Pull the gacha for ${PULL_COST} coins!`);

  const pull = useCallback(() => {
    if (pulling) return;
    if (coins < PULL_COST) { setMessage('Not enough coins!'); return; }
    spendCoins(PULL_COST);
    setPulling(true);
    setResult(null);
    setMessage('Pulling...');

    // Fake suspense delay
    setTimeout(() => {
      const prize = pullPrize();
      setResult(prize);
      setHistory(prev => [prize, ...prev].slice(0, 20));
      setPulling(false);
      setMessage(`You got: ${prize.emoji} ${prize.name} (${prize.rarity})!`);

      // Bonus coins for rare pulls
      if (prize.rarity === 'rare') addCoins(25);
      if (prize.rarity === 'legendary') addCoins(100);
    }, 1200);
  }, [pulling, coins, spendCoins, addCoins]);

  return (
    <div className="gacha-machine">
      <h2>🎲 Gacha Machine</h2>

      <div className="gacha-capsule-area">
        <div className={`gacha-capsule ${pulling ? 'shaking' : ''} ${result ? `rarity-${result.rarity}` : ''}`}>
          {result ? (
            <div className="gacha-reveal">
              <span className="gacha-emoji">{result.emoji}</span>
              <span className="gacha-name" style={{ color: RARITY_COLORS[result.rarity] }}>{result.name}</span>
              <span className="gacha-rarity" style={{ color: RARITY_COLORS[result.rarity] }}>{result.rarity.toUpperCase()}</span>
              {result.rarity === 'rare' && <span className="gacha-bonus">+25 bonus coins!</span>}
              {result.rarity === 'legendary' && <span className="gacha-bonus">+100 bonus coins!</span>}
            </div>
          ) : (
            <span className="gacha-question">{pulling ? '...' : '?'}</span>
          )}
        </div>
      </div>

      <div className="gacha-message">{message}</div>

      <button className="gacha-pull-btn" onClick={pull} disabled={pulling}>
        {pulling ? 'Pulling...' : `Pull! (${PULL_COST} coins)`}
      </button>

      {history.length > 0 && (
        <div className="gacha-history">
          <h3>Recent Pulls</h3>
          <div className="gacha-history-list">
            {history.map((p, i) => (
              <span key={i} className="gacha-history-item" style={{ borderColor: RARITY_COLORS[p.rarity] }} title={`${p.name} (${p.rarity})`}>
                {p.emoji}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="gacha-rates dim">
        Drop rates: Common 60% · Uncommon 25% · Rare 12% (+25🪙) · Legendary 3% (+100🪙)
      </div>
    </div>
  );
}
