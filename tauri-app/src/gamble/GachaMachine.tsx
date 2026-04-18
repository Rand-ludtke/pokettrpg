import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GameProps } from './types';
import { gamecornerAsset } from './assets';

/*
  Gacha Machine – 4 tiers (Basic / Great / Ultra / Master).
  Higher tiers cost more but have better drop rates and exclusive prizes.
  Uses Pokémon sprites from pokeemerald game corner expansion.
*/

const SP = gamecornerAsset('gacha/');

/* 5 Pokémon sprites – each 32×128, 4 frames of 32×32 */
const POKEMON_SPRITES = ['belossom', 'elekid', 'hoppip', 'phanpy', 'teddiursa'] as const;

function PokemonSprite({ name, frame = 0, size = 48 }: { name: string; frame?: number; size?: number }) {
  return (
    <span style={{ display: 'inline-block', width: size, height: size, overflow: 'hidden', lineHeight: 0 }}>
      <img
        src={`${SP}${name}.png`}
        alt={name}
        style={{
          imageRendering: 'pixelated',
          width: size,
          height: 'auto',
          marginTop: -(frame * size),
          display: 'block',
        }}
      />
    </span>
  );
}

type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

interface Prize {
  name: string;
  rarity: Rarity;
  sprite: string; // one of POKEMON_SPRITES or empty for coin-icon
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
    id: 'basic', label: 'Basic', cost: 50, color: '#aaa', icon: 'hoppip',
    rates: { legendary: 2, rare: 10, uncommon: 35, common: 100 },
    bonusCoins: { common: 0, uncommon: 0, rare: 25, legendary: 100 },
    prizes: [
      { name: 'Potion', rarity: 'common', sprite: 'hoppip' },
      { name: 'Poké Ball', rarity: 'common', sprite: 'hoppip' },
      { name: 'Antidote', rarity: 'common', sprite: 'phanpy' },
      { name: 'Repel', rarity: 'common', sprite: 'phanpy' },
      { name: 'Berry', rarity: 'common', sprite: 'teddiursa' },
      { name: 'Great Ball', rarity: 'uncommon', sprite: 'teddiursa' },
      { name: 'Super Potion', rarity: 'uncommon', sprite: 'elekid' },
      { name: 'Rare Candy', rarity: 'uncommon', sprite: 'elekid' },
      { name: 'Ultra Ball', rarity: 'rare', sprite: 'belossom' },
      { name: 'Nugget', rarity: 'rare', sprite: 'belossom' },
      { name: 'PP Up', rarity: 'legendary', sprite: 'belossom' },
    ],
  },
  {
    id: 'great', label: 'Great', cost: 250, color: '#2196F3', icon: 'elekid',
    rates: { legendary: 3, rare: 15, uncommon: 45, common: 100 },
    bonusCoins: { common: 0, uncommon: 25, rare: 125, legendary: 500 },
    prizes: [
      { name: 'Super Potion', rarity: 'common', sprite: 'hoppip' },
      { name: 'Great Ball', rarity: 'common', sprite: 'hoppip' },
      { name: 'Revive', rarity: 'common', sprite: 'phanpy' },
      { name: 'Ether', rarity: 'common', sprite: 'phanpy' },
      { name: 'Rare Candy', rarity: 'uncommon', sprite: 'teddiursa' },
      { name: 'PP Up', rarity: 'uncommon', sprite: 'teddiursa' },
      { name: 'Heart Scale', rarity: 'uncommon', sprite: 'elekid' },
      { name: 'TM Disc', rarity: 'rare', sprite: 'elekid' },
      { name: 'Gold Nugget', rarity: 'rare', sprite: 'belossom' },
      { name: 'Lucky Egg', rarity: 'legendary', sprite: 'belossom' },
      { name: 'Leftovers', rarity: 'legendary', sprite: 'belossom' },
    ],
  },
  {
    id: 'ultra', label: 'Ultra', cost: 1000, color: '#FFD700', icon: 'phanpy',
    rates: { legendary: 5, rare: 20, uncommon: 50, common: 100 },
    bonusCoins: { common: 0, uncommon: 100, rare: 500, legendary: 2000 },
    prizes: [
      { name: 'Hyper Potion', rarity: 'common', sprite: 'hoppip' },
      { name: 'Ultra Ball', rarity: 'common', sprite: 'phanpy' },
      { name: 'Max Revive', rarity: 'common', sprite: 'phanpy' },
      { name: 'Elixir', rarity: 'uncommon', sprite: 'teddiursa' },
      { name: 'Bottle Cap', rarity: 'uncommon', sprite: 'teddiursa' },
      { name: 'Ability Capsule', rarity: 'uncommon', sprite: 'elekid' },
      { name: 'Choice Band', rarity: 'rare', sprite: 'elekid' },
      { name: 'Life Orb', rarity: 'rare', sprite: 'belossom' },
      { name: 'Sacred Ash', rarity: 'legendary', sprite: 'belossom' },
      { name: 'Master Ball', rarity: 'legendary', sprite: 'belossom' },
    ],
  },
  {
    id: 'master', label: 'Master', cost: 4500, color: '#9C27B0', icon: 'belossom',
    rates: { legendary: 10, rare: 30, uncommon: 60, common: 100 },
    bonusCoins: { common: 0, uncommon: 500, rare: 2250, legendary: 9000 },
    prizes: [
      { name: 'Max Elixir', rarity: 'common', sprite: 'hoppip' },
      { name: 'Bottle Cap', rarity: 'common', sprite: 'phanpy' },
      { name: 'Gold Bottle Cap', rarity: 'uncommon', sprite: 'teddiursa' },
      { name: 'Ability Patch', rarity: 'uncommon', sprite: 'elekid' },
      { name: 'Focus Sash', rarity: 'uncommon', sprite: 'elekid' },
      { name: 'Choice Specs', rarity: 'rare', sprite: 'belossom' },
      { name: 'Assault Vest', rarity: 'rare', sprite: 'belossom' },
      { name: 'Shiny Charm', rarity: 'rare', sprite: 'belossom' },
      { name: 'Master Ball', rarity: 'legendary', sprite: 'belossom' },
      { name: 'Sacred Ash', rarity: 'legendary', sprite: 'belossom' },
      { name: 'Enigma Berry', rarity: 'legendary', sprite: 'belossom' },
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
  const [animFrame, setAnimFrame] = useState(0);

  const tier = TIERS[tierIdx];

  // Animate pulled sprite
  useEffect(() => {
    if (!result) return;
    const id = setInterval(() => setAnimFrame(f => f + 1), 250);
    return () => clearInterval(id);
  }, [result]);

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
      setAnimFrame(0);

      const bonus = tier.bonusCoins[prize.rarity];
      if (bonus > 0) addCoins(bonus);
      const bonusMsg = bonus > 0 ? ` (+${bonus} bonus coins!)` : '';
      setMessage(`You got: ${prize.name} (${prize.rarity})!${bonusMsg}`);
    }, delay);
  }, [pulling, coins, tier, tierIdx, spendCoins, addCoins]);

  return (
    <div className="gacha-machine">
      <h2>Gacha Machine</h2>

      {/* Tier selector */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
        {TIERS.map((t, i) => (
          <button key={t.id}
            onClick={() => { setTierIdx(i); setResult(null); setMessage(`${t.label} Machine – ${t.cost} coins per pull`); }}
            disabled={pulling}
            style={{
              padding: '6px 12px', border: `2px solid ${t.color}`,
              background: tierIdx === i ? t.color : 'transparent',
              color: tierIdx === i ? '#fff' : 'var(--fg)',
              borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
              opacity: pulling ? 0.5 : 1,
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <PokemonSprite name={t.icon} frame={0} size={24} /> {t.label} ({t.cost}c)
          </button>
        ))}
      </div>

      {/* Machine backdrop */}
      <div className="gacha-backdrop">
        <img src={`${SP}bg_left.png`} alt="" className="gacha-bg-piece" />
        <img src={`${SP}bg_middle.png`} alt="" className="gacha-bg-piece" />
        <img src={`${SP}bg_right.png`} alt="" className="gacha-bg-piece" />
      </div>

      <div className="gacha-capsule-area">
        <div className={`gacha-capsule ${pulling ? 'shaking' : ''} ${result ? `rarity-${result.rarity}` : ''}`}
             style={{ borderColor: pulling ? tier.color : undefined }}>
          {result ? (
            <div className="gacha-reveal">
              <PokemonSprite name={result.sprite} frame={animFrame % 4} size={64} />
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
                <PokemonSprite name={p.sprite} frame={0} size={28} />
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="gacha-rates dim">
        Drop rates vary by tier. Higher tiers = better odds for rare pulls + bonus coins.
      </div>
    </div>
  );
}
