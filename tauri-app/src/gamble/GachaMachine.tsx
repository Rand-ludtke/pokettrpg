import React, { useState, useCallback } from 'react';
import { GameProps } from './types';

/*
  Gacha Machine – 4 tiers (Basic / Great / Ultra / Master).
  Higher tiers cost more but have better drop rates and exclusive prizes.
  Inspired by pokeemerald game-corner gacha.
*/

type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

interface Prize {
  name: string;
  rarity: Rarity;
  emoji: string;
}

interface MachineTier {
  id: string;
  label: string;
  cost: number;
  color: string;
  icon: string;
  rates: Record<Rarity, number>; // cumulative percentages
  prizes: Prize[];
  bonusCoins: Record<Rarity, number>;
}

const TIERS: MachineTier[] = [
  {
    id: 'basic', label: 'Basic', cost: 50, color: '#aaa', icon: '⚪',
    rates: { legendary: 2, rare: 10, uncommon: 35, common: 100 },
    bonusCoins: { common: 0, uncommon: 0, rare: 25, legendary: 100 },
    prizes: [
      { name: 'Potion', rarity: 'common', emoji: '🧴' },
      { name: 'Poké Ball', rarity: 'common', emoji: '🔴' },
      { name: 'Antidote', rarity: 'common', emoji: '💊' },
      { name: 'Repel', rarity: 'common', emoji: '🌫️' },
      { name: 'Berry', rarity: 'common', emoji: '🍓' },
      { name: 'Great Ball', rarity: 'uncommon', emoji: '🔵' },
      { name: 'Super Potion', rarity: 'uncommon', emoji: '💧' },
      { name: 'Rare Candy', rarity: 'uncommon', emoji: '🍬' },
      { name: 'Ultra Ball', rarity: 'rare', emoji: '🟡' },
      { name: 'Nugget', rarity: 'rare', emoji: '🪙' },
      { name: 'PP Up', rarity: 'legendary', emoji: '⬆️' },
    ],
  },
  {
    id: 'great', label: 'Great', cost: 250, color: '#2196F3', icon: '🔵',
    rates: { legendary: 3, rare: 15, uncommon: 45, common: 100 },
    bonusCoins: { common: 0, uncommon: 25, rare: 125, legendary: 500 },
    prizes: [
      { name: 'Super Potion', rarity: 'common', emoji: '💧' },
      { name: 'Great Ball', rarity: 'common', emoji: '🔵' },
      { name: 'Revive', rarity: 'common', emoji: '💛' },
      { name: 'Ether', rarity: 'common', emoji: '🔮' },
      { name: 'Rare Candy', rarity: 'uncommon', emoji: '🍬' },
      { name: 'PP Up', rarity: 'uncommon', emoji: '⬆️' },
      { name: 'Heart Scale', rarity: 'uncommon', emoji: '💖' },
      { name: 'TM Disc', rarity: 'rare', emoji: '💿' },
      { name: 'Gold Nugget', rarity: 'rare', emoji: '🪙' },
      { name: 'Lucky Egg', rarity: 'legendary', emoji: '🥚' },
      { name: 'Leftovers', rarity: 'legendary', emoji: '🍖' },
    ],
  },
  {
    id: 'ultra', label: 'Ultra', cost: 1000, color: '#FFD700', icon: '🟡',
    rates: { legendary: 5, rare: 20, uncommon: 50, common: 100 },
    bonusCoins: { common: 0, uncommon: 100, rare: 500, legendary: 2000 },
    prizes: [
      { name: 'Hyper Potion', rarity: 'common', emoji: '💧' },
      { name: 'Ultra Ball', rarity: 'common', emoji: '🟡' },
      { name: 'Max Revive', rarity: 'common', emoji: '💛' },
      { name: 'Elixir', rarity: 'uncommon', emoji: '🔮' },
      { name: 'Bottle Cap', rarity: 'uncommon', emoji: '🧢' },
      { name: 'Ability Capsule', rarity: 'uncommon', emoji: '💊' },
      { name: 'Choice Band', rarity: 'rare', emoji: '🎗️' },
      { name: 'Life Orb', rarity: 'rare', emoji: '🔴' },
      { name: 'Sacred Ash', rarity: 'legendary', emoji: '✨' },
      { name: 'Master Ball', rarity: 'legendary', emoji: '🟣' },
    ],
  },
  {
    id: 'master', label: 'Master', cost: 4500, color: '#9C27B0', icon: '🟣',
    rates: { legendary: 10, rare: 30, uncommon: 60, common: 100 },
    bonusCoins: { common: 0, uncommon: 500, rare: 2250, legendary: 9000 },
    prizes: [
      { name: 'Max Elixir', rarity: 'common', emoji: '🔮' },
      { name: 'Bottle Cap', rarity: 'common', emoji: '🧢' },
      { name: 'Gold Bottle Cap', rarity: 'uncommon', emoji: '👑' },
      { name: 'Ability Patch', rarity: 'uncommon', emoji: '🩹' },
      { name: 'Focus Sash', rarity: 'uncommon', emoji: '🎀' },
      { name: 'Choice Specs', rarity: 'rare', emoji: '👓' },
      { name: 'Assault Vest', rarity: 'rare', emoji: '🦺' },
      { name: 'Shiny Charm', rarity: 'rare', emoji: '💎' },
      { name: 'Master Ball', rarity: 'legendary', emoji: '🟣' },
      { name: 'Sacred Ash', rarity: 'legendary', emoji: '✨' },
      { name: 'Enigma Berry', rarity: 'legendary', emoji: '🫐' },
    ],
  },
];

function pullPrize(tier: MachineTier): Prize {
  const roll = Math.random() * 100;
  let rarity: Rarity;
  if (roll < tier.rates.legendary) rarity = 'legendary';
  else if (roll < tier.rates.rare) rarity = 'rare';
  else if (roll < tier.rates.uncommon) rarity = 'uncommon';
  else rarity = 'common';
  const pool = tier.prizes.filter(p => p.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

const RARITY_COLORS: Record<string, string> = {
  common: '#aaa',
  uncommon: '#4CAF50',
  rare: '#2196F3',
  legendary: '#FFD700',
};

export function GachaMachine({ coins, addCoins, spendCoins }: GameProps) {
  const [tierIdx, setTierIdx] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<Prize | null>(null);
  const [history, setHistory] = useState<Prize[]>([]);
  const [message, setMessage] = useState('Select a machine tier and pull!');

  const tier = TIERS[tierIdx];

  const pull = useCallback(() => {
    if (pulling) return;
    if (coins < tier.cost) { setMessage('Not enough coins!'); return; }
    spendCoins(tier.cost);
    setPulling(true);
    setResult(null);
    setMessage('Pulling...');

    const delay = 1200 + (tierIdx * 300); // higher tiers = more suspense
    setTimeout(() => {
      const prize = pullPrize(tier);
      setResult(prize);
      setHistory(prev => [prize, ...prev].slice(0, 30));
      setPulling(false);

      const bonus = tier.bonusCoins[prize.rarity];
      if (bonus > 0) addCoins(bonus);
      const bonusMsg = bonus > 0 ? ` (+${bonus} bonus coins!)` : '';
      setMessage(`You got: ${prize.emoji} ${prize.name} (${prize.rarity})!${bonusMsg}`);
    }, delay);
  }, [pulling, coins, tier, tierIdx, spendCoins, addCoins]);

  return (
    <div className="gacha-machine">
      <h2>🎲 Gacha Machine</h2>

      {/* Tier selector */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
        {TIERS.map((t, i) => (
          <button key={t.id}
            onClick={() => { setTierIdx(i); setResult(null); setMessage(`${t.label} Machine – ${t.cost} coins per pull`); }}
            disabled={pulling}
            style={{
              padding: '8px 16px', border: `2px solid ${t.color}`,
              background: tierIdx === i ? t.color : 'transparent',
              color: tierIdx === i ? '#fff' : 'var(--fg)',
              borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
              opacity: pulling ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            {t.icon} {t.label} ({t.cost}c)
          </button>
        ))}
      </div>

      {/* Rates display */}
      <div style={{ fontSize: 11, opacity: 0.6, margin: '0 0 8px' }}>
        Drop rates: ⭐ {tier.rates.uncommon - tier.rates.rare}% | 💎 {tier.rates.rare - tier.rates.legendary}% | 👑 {tier.rates.legendary}%
      </div>

      <div className="gacha-capsule-area">
        <div className={`gacha-capsule ${pulling ? 'shaking' : ''} ${result ? `rarity-${result.rarity}` : ''}`}
             style={{ borderColor: pulling ? tier.color : undefined }}>
          {result ? (
            <div className="gacha-reveal">
              <span className="gacha-emoji">{result.emoji}</span>
              <span className="gacha-name" style={{ color: RARITY_COLORS[result.rarity] }}>{result.name}</span>
              <span className="gacha-rarity" style={{ color: RARITY_COLORS[result.rarity] }}>{result.rarity.toUpperCase()}</span>
              {tier.bonusCoins[result.rarity] > 0 && (
                <span className="gacha-bonus">+{tier.bonusCoins[result.rarity]} bonus coins!</span>
              )}
            </div>
          ) : (
            <span className="gacha-question">{pulling ? '...' : '?'}</span>
          )}
        </div>
      </div>

      <div className="gacha-message">{message}</div>

      <button className="gacha-pull-btn" onClick={pull} disabled={pulling}>
        {pulling ? 'Pulling...' : `Pull ${tier.label}! (${tier.cost} coins)`}
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
