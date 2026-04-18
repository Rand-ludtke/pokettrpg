import { useState, useCallback, useRef } from 'react';

const STORAGE_KEY = 'ttrpg.gambleCoins';
const DEFAULT_COINS = 500;

export function useCoins() {
  const [coins, setCoinsRaw] = useState<number>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v != null ? Math.max(0, parseInt(v, 10) || 0) : DEFAULT_COINS;
    } catch { return DEFAULT_COINS; }
  });
  const coinsRef = useRef(coins);

  const setCoins = useCallback((next: number | ((prev: number) => number)) => {
    const prev = coinsRef.current;
    const val = typeof next === 'function' ? next(prev) : next;
    const clamped = Math.max(0, val);
    coinsRef.current = clamped;
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch {}
    setCoinsRaw(clamped);
  }, []);

  const addCoins = useCallback((amount: number) => setCoins(c => c + amount), [setCoins]);
  const spendCoins = useCallback((amount: number): boolean => {
    if (coinsRef.current < amount) return false;
    setCoins(coinsRef.current - amount);
    return true;
  }, [setCoins]);

  return { coins, setCoins, addCoins, spendCoins };
}
