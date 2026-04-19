import React, { useEffect, useMemo, useRef, useState } from 'react';
import { withPublicBase } from '../utils/publicBase';
import {
  extractEmeraldSaveFromMgbaState,
  parseEmeraldSave,
  replaceEmeraldSaveInMgbaState,
  updateEmeraldSaveCoins,
} from './emeraldSave';
import {
  loadStoredRom,
  loadStoredSave,
  loadStoredState,
  persistRom,
  persistSave,
  persistState,
  StoredRom,
} from './gameCornerPersistence';
import { importParsedEmeraldSaveToPc } from './gameCornerPokemonSync';

type EmulatorControlAlias =
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT'
  | 'BUTTON_1'
  | 'BUTTON_2'
  | 'START'
  | 'SELECT';

interface ControlButton {
  label: string;
  alias: EmulatorControlAlias;
  className?: string;
}

const PRIMARY_CONTROLS: ControlButton[] = [
  { label: 'A', alias: 'BUTTON_1', className: 'emulator-control-btn--action' },
  { label: 'B', alias: 'BUTTON_2', className: 'emulator-control-btn--action emulator-control-btn--alt' },
  { label: 'Start', alias: 'START' },
  { label: 'Select', alias: 'SELECT' },
];

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function getMeaningfulSaveBuffer(saveBuffer: ArrayBuffer | null | undefined): ArrayBuffer | null {
  if (!(saveBuffer instanceof ArrayBuffer)) return null;
  return parseEmeraldSave(saveBuffer) ? saveBuffer : null;
}

function getMeaningfulSaveFromState(stateBuffer: ArrayBuffer | null | undefined): ArrayBuffer | null {
  if (!(stateBuffer instanceof ArrayBuffer)) return null;
  const extractedSave = extractEmeraldSaveFromMgbaState(stateBuffer);
  return extractedSave && parseEmeraldSave(extractedSave) ? extractedSave : null;
}

export function GameCornerEmulator({
  appCoins,
  coinWritebackVersion,
  setAppCoins,
}: {
  appCoins: number;
  coinWritebackVersion: number;
  setAppCoins: (coins: number) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const restoreCommandTimerRef = useRef<number | null>(null);
  const [storedRom, setStoredRom] = useState<StoredRom | null>(null);
  const [pendingSave, setPendingSave] = useState<ArrayBuffer | null>(null);
  const [pendingState, setPendingState] = useState<ArrayBuffer | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [emulatorReady, setEmulatorReady] = useState(false);
  const [bootNonce, setBootNonce] = useState(0);
  const [launchRequestedAt, setLaunchRequestedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [romReady, setRomReady] = useState(false);
  const [activeControls, setActiveControls] = useState<Record<string, boolean>>({});

  const hostSrc = useMemo(() => `${withPublicBase('emulatorjs-host.html')}?session=${bootNonce}`, [bootNonce]);

  function clearRestoreCommandTimer() {
    if (restoreCommandTimerRef.current !== null) {
      window.clearTimeout(restoreCommandTimerRef.current);
      restoreCommandTimerRef.current = null;
    }
  }

  function scheduleBundledStateRestore() {
    clearRestoreCommandTimer();
    if (!pendingState) return;

    restoreCommandTimerRef.current = window.setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: 'ejs:restore-bundled-state',
          source: 'GameCornerEmulator delayed restore',
        },
        '*',
      );
    }, 4000);
  }

  function sendControlInput(alias: EmulatorControlAlias, pressed: boolean) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'ejs:input',
        alias,
        pressed,
      },
      '*',
    );
  }

  function setControlPressed(alias: EmulatorControlAlias, pressed: boolean) {
    setActiveControls((current) => {
      if (!!current[alias] === pressed) return current;
      return { ...current, [alias]: pressed };
    });
    sendControlInput(alias, pressed);
  }

  function releaseAllControls() {
    setActiveControls((current) => {
      const pressedAliases = Object.entries(current)
        .filter(([, isPressed]) => isPressed)
        .map(([alias]) => alias as EmulatorControlAlias);
      if (!pressedAliases.length) return current;
      for (const alias of pressedAliases) {
        sendControlInput(alias, false);
      }
      return {};
    });
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadStoredRom(), loadStoredSave(), loadStoredState()])
      .then(([rom, save, state]) => {
        if (cancelled) return;
        setStoredRom(rom);
        setPendingSave(save);
        setPendingState(state);
        setRomReady(true);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Failed to read stored Game Corner data.');
        setRomReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data.type !== 'string') return;

      if (data.type === 'ejs:host-ready') {
        setHostReady(true);
        return;
      }

      if (data.type === 'ejs:debug') {
        console.debug('[GameCornerEmulator]', data.message, data);
        return;
      }

      if (data.type === 'ejs:ready') {
        setError(null);
        setEmulatorReady(true);
        scheduleBundledStateRestore();
        return;
      }

      if (data.type === 'ejs:restore-bundled-state-result') {
        console.debug('[GameCornerEmulator] restore result', data);
        return;
      }

      if (data.type === 'ejs:error') {
        clearRestoreCommandTimer();
        setEmulatorReady(false);
        setError(typeof data.message === 'string' ? data.message : 'EmulatorJS failed to boot.');
        return;
      }

      if (data.type === 'ejs:state-update' && isArrayBuffer(data.stateBuffer)) {
        const stateBuffer = data.stateBuffer;
        clearRestoreCommandTimer();
        setPendingState(stateBuffer);
        persistState(stateBuffer).catch(console.error);
        const extractedSave = getMeaningfulSaveFromState(stateBuffer);
        if (extractedSave) {
          setPendingSave(extractedSave);
          persistSave(extractedSave).catch(console.error);
        }
        return;
      }

      if (data.type === 'ejs:save-update' && isArrayBuffer(data.saveBuffer)) {
        const saveBuffer = getMeaningfulSaveBuffer(data.saveBuffer);
        if (!saveBuffer) return;
        clearRestoreCommandTimer();
        setPendingSave(saveBuffer);
        persistSave(saveBuffer).catch(console.error);
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      clearRestoreCommandTimer();
      releaseAllControls();
      window.removeEventListener('message', onMessage);
    };
  }, []);

  useEffect(() => {
    if (pendingSave || !pendingState) return;
    const extractedSave = getMeaningfulSaveFromState(pendingState);
    if (!extractedSave) return;

    setPendingSave(extractedSave);
    persistSave(extractedSave).catch(console.error);
  }, [pendingSave, pendingState]);

  useEffect(() => {
    if (!isArrayBuffer(pendingSave)) return;
    const saveBuffer: ArrayBuffer = pendingSave;
    let cancelled = false;

    async function syncSave() {
      const parsed = parseEmeraldSave(saveBuffer);
      if (!parsed) return;

      setAppCoins(parsed.coins);
      const imported = await importParsedEmeraldSaveToPc(parsed);
      if (cancelled) return;
      if (imported.droppedCount > 0) {
        console.warn('Some imported Game Corner Pokemon could not be stored because the app PC is full.', imported);
      }
    }

    syncSave().catch((reason) => {
      if (cancelled) return;
      console.error(reason instanceof Error ? reason.message : 'Save sync failed.');
    });

    return () => {
      cancelled = true;
    };
  }, [pendingSave, setAppCoins]);

  useEffect(() => {
    if (coinWritebackVersion < 1 || !emulatorReady || !pendingState || !iframeRef.current?.contentWindow) return;

    const currentSave = getMeaningfulSaveFromState(pendingState);
    if (!currentSave) return;

    const parsed = parseEmeraldSave(currentSave);
    if (!parsed || parsed.coins === appCoins) return;

    const updatedSave = updateEmeraldSaveCoins(currentSave, appCoins);
    if (!updatedSave) return;

    const updatedState = replaceEmeraldSaveInMgbaState(pendingState, updatedSave);
    if (!updatedState) return;

    setPendingSave(updatedSave);
    setPendingState(updatedState);
    persistSave(updatedSave).catch(console.error);
    persistState(updatedState).catch(console.error);

    const stateBuffer = updatedState.slice(0);
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'ejs:load-state',
        reason: 'coin-writeback',
        stateBuffer,
      },
      '*',
      [stateBuffer],
    );
  }, [appCoins, coinWritebackVersion, emulatorReady, pendingState]);

  useEffect(() => {
    if (!hostReady || !launchRequestedAt || !storedRom || !iframeRef.current?.contentWindow) return;

    clearRestoreCommandTimer();

    const romBuffer = storedRom.buffer.slice(0);
    const transfer: Transferable[] = [romBuffer];
    const message: Record<string, unknown> = {
      type: 'ejs:init',
      romBuffer,
      romName: storedRom.name,
      core: 'gba',
      dataPath: 'https://cdn.emulatorjs.org/stable/data/',
    };

    if (pendingSave) {
      const saveBuffer = pendingSave.slice(0);
      message.saveBuffer = saveBuffer;
      transfer.push(saveBuffer);
    }

    if (pendingState) {
      const stateBuffer = pendingState.slice(0);
      message.stateBuffer = stateBuffer;
      transfer.push(stateBuffer);
    }

    iframeRef.current.contentWindow.postMessage(message, '*', transfer);
    setLaunchRequestedAt(null);
  }, [hostReady, launchRequestedAt, pendingSave, pendingState, storedRom]);

  useEffect(() => {
    if (!romReady || !storedRom) return;
    setError(null);
    setHostReady(false);
    setEmulatorReady(false);
    setBootNonce((value) => value + 1);
    setLaunchRequestedAt(Date.now());
  }, [romReady, storedRom]);

  async function onInstallRom(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const rom = await persistRom(file);
      setStoredRom(rom);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to store the selected ROM.');
    } finally {
      event.target.value = '';
    }
  }

  function renderControlButton({ label, alias, className }: ControlButton) {
    const isPressed = !!activeControls[alias];
    return (
      <button
        key={alias}
        type="button"
        className={`emulator-control-btn ${className || ''} ${isPressed ? 'is-pressed' : ''}`.trim()}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setControlPressed(alias, true);
        }}
        onPointerUp={(event) => {
          event.preventDefault();
          setControlPressed(alias, false);
        }}
        onPointerCancel={() => setControlPressed(alias, false)}
        onPointerLeave={() => setControlPressed(alias, false)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="gamecorner-emulator">
      {error && <div className="emulator-error">{error}</div>}

      {!storedRom ? (
        <div className="emulator-install-panel">
          <div className="emulator-install-copy">
            <strong>Install compiled ROM</strong>
            <p>Select a locally built .gba once. After that this tab reopens it directly.</p>
          </div>
          <label className="emulator-file-picker">
            <span>Game Corner ROM (.gba)</span>
            <input
              type="file"
              accept=".gba,application/octet-stream"
              onChange={onInstallRom}
            />
          </label>
        </div>
      ) : null}

      <div className="emulator-frame-wrap">
        <iframe
          key={hostSrc}
          ref={iframeRef}
          src={hostSrc}
          title="Original Game Corner Emulator"
          className="emulator-frame"
          allowFullScreen
        />
      </div>

      <div className="emulator-controls-panel">
        <div className="emulator-dpad" onPointerLeave={releaseAllControls}>
          {renderControlButton({ label: 'Up', alias: 'DPAD_UP', className: 'emulator-control-btn--dpad emulator-control-btn--up' })}
          {renderControlButton({ label: 'Left', alias: 'DPAD_LEFT', className: 'emulator-control-btn--dpad emulator-control-btn--left' })}
          <span className="emulator-dpad-center" aria-hidden="true">+</span>
          {renderControlButton({ label: 'Right', alias: 'DPAD_RIGHT', className: 'emulator-control-btn--dpad emulator-control-btn--right' })}
          {renderControlButton({ label: 'Down', alias: 'DPAD_DOWN', className: 'emulator-control-btn--dpad emulator-control-btn--down' })}
        </div>

        <div className="emulator-controls-cluster" onPointerLeave={releaseAllControls}>
          <div className="emulator-controls-actions">
            {PRIMARY_CONTROLS.map(renderControlButton)}
          </div>
        </div>
      </div>
    </div>
  );
}