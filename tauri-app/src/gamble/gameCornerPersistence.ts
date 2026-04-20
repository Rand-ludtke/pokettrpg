import { invoke } from '@tauri-apps/api/core';
import { withPublicBase } from '../utils/publicBase';

const DB_NAME = 'pokettrpg-gamecorner';
const STORE_NAME = 'runtime';
const ROM_KEY = 'rom-buffer';
const ROM_NAME_KEY = 'rom-name';
const SAVE_KEY = 'save-buffer';
const STATE_KEY = 'state-buffer';
const REMOTE_ROM_URL_KEY = 'ttrpg.gameCornerRomUrl';
const REMOTE_ROM_NAME_KEY = 'ttrpg.gameCornerRomName';
const DEFAULT_REMOTE_ROM_URL = 'https://github.com/Rand-ludtke/pokettrpg/releases/download/v1.5.2/pokeemerald_modern.gba';
const DEFAULT_REMOTE_ROM_NAME = 'pokeemerald_modern.gba';
const DEFAULT_WEB_ROM_PATH = 'gamecorner/pokeemerald_modern.gba';

export interface StoredRom {
  name: string;
  buffer: ArrayBuffer;
}

export interface StoredRomLoadResult {
  rom: StoredRom | null;
  importDir: string | null;
  autoImported: boolean;
  remoteUrl: string | null;
}

function getLocalStorageValue(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const value = window.localStorage.getItem(key);
  return value && value.trim() ? value.trim() : null;
}

function setLocalStorageValue(key: string, value: string | null) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!value?.trim()) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, value.trim());
}

function deriveRomNameFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const lastPathSegment = parsedUrl.pathname.split('/').filter(Boolean).pop();
    if (lastPathSegment) return decodeURIComponent(lastPathSegment);
  } catch {
    // Fall back to a generic filename when the URL is not fully qualified yet.
  }

  return 'game-corner.gba';
}

function getSuggestedWebRomUrl(): string {
  if (typeof window === 'undefined') return withPublicBase(DEFAULT_WEB_ROM_PATH);
  return new URL(withPublicBase(DEFAULT_WEB_ROM_PATH), window.location.origin).toString();
}

function parseUrl(value: string): URL | null {
  try {
    return typeof window !== 'undefined'
      ? new URL(value, window.location.origin)
      : new URL(value);
  } catch {
    return null;
  }
}

function isCrossOriginUrl(value: string): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = parseUrl(value);
  return !!parsed && parsed.origin !== window.location.origin;
}

function normalizeConfiguredRemoteRomUrl(value: string | null): string {
  const fallbackUrl = getDefaultRemoteRomUrl();
  if (!value) return fallbackUrl;

  if (!isTauriApp() && isCrossOriginUrl(value)) {
    setLocalStorageValue(REMOTE_ROM_URL_KEY, fallbackUrl);
    return fallbackUrl;
  }

  return value;
}

function getDefaultRemoteRomUrl(): string {
  return isTauriApp() ? DEFAULT_REMOTE_ROM_URL : getSuggestedWebRomUrl();
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

async function loadIndexedRom(): Promise<StoredRom | null> {
  const [name, buffer] = await Promise.all([
    getIndexedValue<string>(ROM_NAME_KEY),
    getIndexedValue<ArrayBuffer>(ROM_KEY),
  ]);

  if (!name || !(buffer instanceof ArrayBuffer)) return null;
  return { name, buffer: cloneBuffer(buffer) };
}

async function persistIndexedRom(rom: StoredRom): Promise<void> {
  await Promise.all([
    putIndexedValue(ROM_NAME_KEY, rom.name),
    putIndexedValue(ROM_KEY, cloneBuffer(rom.buffer)),
  ]);
}

async function fetchConfiguredRemoteRom(): Promise<StoredRom | null> {
  const remoteUrl = getConfiguredRemoteRomUrl();
  if (!remoteUrl) return null;

  if (!isTauriApp() && isCrossOriginUrl(remoteUrl)) {
    throw new Error(
      `Cross-origin ROM URLs are blocked in the web/PWA build. Host the .gba under this app and use ${getSuggestedWebRomUrl()} instead.`
    );
  }

  const response = await fetch(remoteUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download configured ROM (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1024) {
    throw new Error('Configured ROM download did not return a valid .gba file.');
  }

  const name = getConfiguredRemoteRomName() || deriveRomNameFromUrl(response.url || remoteUrl);
  const rom = { name, buffer };
  await persistIndexedRom(rom);
  setConfiguredRemoteRom(name, remoteUrl);
  return rom;
}

export function getConfiguredRemoteRomUrl(): string | null {
  return normalizeConfiguredRemoteRomUrl(getLocalStorageValue(REMOTE_ROM_URL_KEY));
}

export function getConfiguredRemoteRomName(): string | null {
  return getLocalStorageValue(REMOTE_ROM_NAME_KEY) || DEFAULT_REMOTE_ROM_NAME;
}

export function getSuggestedRemoteRomUrl(): string {
  return getDefaultRemoteRomUrl();
}

export function isRemoteRomUrlSupportedOnWeb(url: string): boolean {
  return !isCrossOriginUrl(url);
}

export function setConfiguredRemoteRom(name: string | null, url: string | null) {
  setLocalStorageValue(REMOTE_ROM_NAME_KEY, name);
  setLocalStorageValue(REMOTE_ROM_URL_KEY, url);
}

export async function loadStoredRom(): Promise<StoredRomLoadResult> {
  if (isTauriApp()) {
    const [importDir, name, bytes] = await Promise.all([
      invoke<string>('get_game_corner_import_dir').catch(() => null),
      invoke<string | null>('get_game_corner_rom_name'),
      invoke<number[] | null>('get_game_corner_rom'),
    ]);

    if (name && bytes?.length) {
      return {
        rom: { name, buffer: new Uint8Array(bytes).buffer },
        importDir,
        autoImported: false,
        remoteUrl: getConfiguredRemoteRomUrl(),
      };
    }

    const indexedRom = await loadIndexedRom();
    if (indexedRom) {
      await invoke('set_game_corner_rom', {
        name: indexedRom.name,
        bytes: Array.from(new Uint8Array(indexedRom.buffer)),
      });
      return {
        rom: indexedRom,
        importDir,
        autoImported: false,
        remoteUrl: getConfiguredRemoteRomUrl(),
      };
    }

    const droppedRom = await invoke<{ name: string; bytes: number[]; import_dir: string } | null>('get_game_corner_drop_rom');
    if (!droppedRom?.name || !droppedRom.bytes?.length) {
      return { rom: null, importDir, autoImported: false, remoteUrl: getConfiguredRemoteRomUrl() };
    }

    const droppedBuffer = new Uint8Array(droppedRom.bytes).buffer;
    const rom = { name: droppedRom.name, buffer: droppedBuffer };

    await invoke('set_game_corner_rom', {
      name: rom.name,
      bytes: Array.from(new Uint8Array(rom.buffer)),
    });
    await persistIndexedRom(rom);
    return {
      rom,
      importDir: droppedRom.import_dir || importDir,
      autoImported: true,
      remoteUrl: getConfiguredRemoteRomUrl(),
    };
  }

  const indexedRom = await loadIndexedRom();
  if (indexedRom) {
    return {
      rom: indexedRom,
      importDir: null,
      autoImported: false,
      remoteUrl: getConfiguredRemoteRomUrl(),
    };
  }

  const remoteRom = await fetchConfiguredRemoteRom();
  return {
    rom: remoteRom,
    importDir: null,
    autoImported: !!remoteRom,
    remoteUrl: getConfiguredRemoteRomUrl(),
  };

}

export async function persistRom(file: File): Promise<StoredRom> {
  const buffer = await file.arrayBuffer();
  const rom = { name: file.name, buffer };

  if (isTauriApp()) {
    await invoke('set_game_corner_rom', {
      name: rom.name,
      bytes: Array.from(new Uint8Array(buffer)),
    });
  }

  await persistIndexedRom(rom);
  return rom;
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