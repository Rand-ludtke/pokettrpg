import { useState, useCallback } from 'react';

const STORAGE_KEY = 'ttrpg.gambleCoins';
const DEFAULT_COINS = 500;

export function useCoins() {
  const [coins, setCoinsRaw] = useState<number>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v != null ? Math.max(0, parseInt(v, 10) || 0) : DEFAULT_COINS;
    } catch { return DEFAULT_COINS; }
  });

  const setCoins = useCallback((next: number | ((prev: number) => number)) => {
    setCoinsRaw(prev => {
      const val = typeof next === 'function' ? next(prev) : next;
      const clamped = Math.max(0, val);
      try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch {}
      return clamped;
    });
  }, []);

  const addCoins = useCallback((amount: number) => setCoins(c => c + amount), [setCoins]);
  const spendCoins = useCallback((amount: number): boolean => {
    let ok = false;
    setCoins(c => { if (c >= amount) { ok = true; return c - amount; } return c; });
    return ok;
  }, [setCoins]);

  return { coins, setCoins, addCoins, spendCoins };
}
