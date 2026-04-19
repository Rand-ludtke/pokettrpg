import { invoke } from '@tauri-apps/api/core';

const DB_NAME = 'pokettrpg-gamecorner';
const STORE_NAME = 'runtime';
const ROM_KEY = 'rom-buffer';
const ROM_NAME_KEY = 'rom-name';
const SAVE_KEY = 'save-buffer';
const STATE_KEY = 'state-buffer';

export interface StoredRom {
  name: string;
  buffer: ArrayBuffer;
}

function isBlankSaveBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) return true;

  let allFF = true;
  let allZero = true;
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value !== 0xff) allFF = false;
    if (value !== 0x00) allZero = false;
    if (!allFF && !allZero) return false;
  }

  return true;
}

function isTauriApp(): boolean {
  return typeof window !== 'undefined' && !!(window as Window & { __TAURI__?: unknown }).__TAURI__;
}

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null;

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

async function getIndexedValue<T>(key: string): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);

    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error(`Failed to read ${key}.`));
  });
}

async function putIndexedValue(key: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to write ${key}.`));
  });
}

export async function loadStoredRom(): Promise<StoredRom | null> {
  const [name, buffer] = await Promise.all([
    getIndexedValue<string>(ROM_NAME_KEY),
    getIndexedValue<ArrayBuffer>(ROM_KEY),
  ]);

  if (!name || !(buffer instanceof ArrayBuffer)) return null;
  return { name, buffer: cloneBuffer(buffer) };
}

export async function persistRom(file: File): Promise<StoredRom> {
  const buffer = await file.arrayBuffer();
  await Promise.all([
    putIndexedValue(ROM_NAME_KEY, file.name),
    putIndexedValue(ROM_KEY, cloneBuffer(buffer)),
  ]);
  return { name: file.name, buffer };
}

export async function loadStoredSave(): Promise<ArrayBuffer | null> {
  if (isTauriApp()) {
    const bytes = await invoke<number[] | null>('get_game_corner_save');
    if (!bytes?.length) return null;
    const buffer = new Uint8Array(bytes).buffer;
    return isBlankSaveBuffer(buffer) ? null : buffer;
  }

  const buffer = await getIndexedValue<ArrayBuffer>(SAVE_KEY);
  if (!(buffer instanceof ArrayBuffer)) return null;

  const cloned = cloneBuffer(buffer);
  return isBlankSaveBuffer(cloned) ? null : cloned;
}

export async function persistSave(saveBuffer: ArrayBuffer): Promise<void> {
  const buffer = cloneBuffer(saveBuffer);
  if (isBlankSaveBuffer(buffer)) return;

  if (isTauriApp()) {
    await invoke('set_game_corner_save', {
      bytes: Array.from(new Uint8Array(buffer)),
    });
    return;
  }

  await putIndexedValue(SAVE_KEY, buffer);
}

export async function loadStoredState(): Promise<ArrayBuffer | null> {
  const buffer = await getIndexedValue<ArrayBuffer>(STATE_KEY);
  if (!(buffer instanceof ArrayBuffer)) return null;
  return cloneBuffer(buffer);
}

export async function persistState(stateBuffer: ArrayBuffer): Promise<void> {
  await putIndexedValue(STATE_KEY, cloneBuffer(stateBuffer));
}