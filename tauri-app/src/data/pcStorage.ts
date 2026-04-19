import type { BattlePokemon } from '../types';

export const PC_BOX_SIZE = 30;
export const PC_MAX_BOXES = 64;
export const PC_BOXES_STORAGE_KEY = 'ttrpg.boxes';
export const GAME_CORNER_IMPORTED_SIGNATURES_KEY = 'ttrpg.gameCornerImportedMonIds';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getStorage(): StorageLike | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  const globalStorage = (globalThis as { localStorage?: StorageLike }).localStorage;
  return globalStorage ?? null;
}

export function normalizePcBoxes(raw: unknown): Array<Array<BattlePokemon | null>> {
  const parsed = Array.isArray(raw) ? raw : [];
  return Array.from({ length: PC_MAX_BOXES }, (_, boxIndex) => {
    const sourceBox = Array.isArray(parsed[boxIndex]) ? parsed[boxIndex] : [];
    return Array.from({ length: PC_BOX_SIZE }, (_, slotIndex) => {
      const value = sourceBox[slotIndex];
      return value && typeof value === 'object' ? value as BattlePokemon : null;
    });
  });
}

export function readPcBoxesState(): { boxes: Array<Array<BattlePokemon | null>>; raw: string | null } {
  const storage = getStorage();
  const raw = storage?.getItem(PC_BOXES_STORAGE_KEY) ?? null;
  if (!raw) {
    return { boxes: normalizePcBoxes([]), raw: null };
  }

  try {
    return { boxes: normalizePcBoxes(JSON.parse(raw)), raw };
  } catch {
    return { boxes: normalizePcBoxes([]), raw: null };
  }
}

export function loadPcBoxes(): Array<Array<BattlePokemon | null>> {
  return readPcBoxesState().boxes;
}

function dispatchPcBoxesUpdated() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event('ttrpg-boxes-updated'));
}

export function persistPcBoxes(boxes: Array<Array<BattlePokemon | null>>): string | null {
  const storage = getStorage();
  const normalized = normalizePcBoxes(boxes);
  const raw = JSON.stringify(normalized);

  try {
    storage?.setItem(PC_BOXES_STORAGE_KEY, raw);
  } catch {
    return null;
  }

  dispatchPcBoxesUpdated();
  return raw;
}

export function appendBattlePokemonToPc(newMons: BattlePokemon[]): {
  added: number;
  dropped: number;
  boxes: Array<Array<BattlePokemon | null>>;
} {
  if (!newMons.length) {
    return { added: 0, dropped: 0, boxes: loadPcBoxes() };
  }

  const out = loadPcBoxes().map((box) => box.slice());
  let added = 0;

  for (const mon of newMons) {
    let inserted = false;
    for (let boxIndex = 0; boxIndex < out.length && !inserted; boxIndex++) {
      const box = out[boxIndex] ?? (out[boxIndex] = Array.from({ length: PC_BOX_SIZE }, () => null));
      for (let slotIndex = 0; slotIndex < PC_BOX_SIZE; slotIndex++) {
        if (!box[slotIndex]) {
          box[slotIndex] = mon;
          added += 1;
          inserted = true;
          break;
        }
      }
    }
    if (!inserted) break;
  }

  if (added > 0) {
    persistPcBoxes(out);
  }

  return {
    added,
    dropped: Math.max(0, newMons.length - added),
    boxes: out,
  };
}

export function loadImportedSignatures(): Set<string> {
  const storage = getStorage();
  const raw = storage?.getItem(GAME_CORNER_IMPORTED_SIGNATURES_KEY);
  if (!raw) return new Set<string>();

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set<string>();
  }
}

export function persistImportedSignatures(signatures: Iterable<string>): void {
  const storage = getStorage();
  if (!storage) return;

  const unique = Array.from(new Set(signatures)).sort();
  try {
    storage.setItem(GAME_CORNER_IMPORTED_SIGNATURES_KEY, JSON.stringify(unique));
  } catch {
    // Ignore storage write failures; PC import should stay best-effort.
  }
}