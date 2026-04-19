import React, { useEffect, useMemo, useRef, useState } from 'react';
import { withPublicBase } from '../utils/publicBase';
import { parseEmeraldSave } from './emeraldSave';
import { loadStoredRom, loadStoredSave, persistRom, persistSave, StoredRom } from './gameCornerPersistence';
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

export function GameCornerEmulator({
  appCoins,
  setAppCoins,
  stationLabel,
  stationSubtitle,
}: {
  appCoins: number;
  setAppCoins: (coins: number) => void;
  stationLabel: string;
  stationSubtitle: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const restoreCommandTimerRef = useRef<number | null>(null);
  const [storedRom, setStoredRom] = useState<StoredRom | null>(null);
  const [pendingSave, setPendingSave] = useState<ArrayBuffer | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [bootNonce, setBootNonce] = useState(0);
  const [launchRequestedAt, setLaunchRequestedAt] = useState<number | null>(null);
  const [status, setStatus] = useState('Preparing the exact ROM runtime for this station.');
  const [error, setError] = useState<string | null>(null);
  const [romReady, setRomReady] = useState(false);
  const [syncNote, setSyncNote] = useState('Save files stay hidden and sync automatically.');
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
    if (pendingSave) return;

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

  function requestFullscreen() {
    if (!iframeRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    iframeRef.current.requestFullscreen?.().catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadStoredRom(), loadStoredSave()])
      .then(([rom, save]) => {
        if (cancelled) return;
        setStoredRom(rom);
        setPendingSave(save);
        setRomReady(true);
        setStatus(rom
          ? `Exact ROM ready for ${stationLabel}.`
          : 'Install a compiled Game Corner .gba once, then this station will reopen it automatically.');
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Failed to read stored Game Corner data.');
        setRomReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [stationLabel]);

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
        setStatus(`Exact ROM running for ${stationLabel}.`);
        setError(null);
        scheduleBundledStateRestore();
        return;
      }

      if (data.type === 'ejs:restore-bundled-state-result') {
        console.debug('[GameCornerEmulator] restore result', data);
        return;
      }

      if (data.type === 'ejs:error') {
        clearRestoreCommandTimer();
        setError(typeof data.message === 'string' ? data.message : 'EmulatorJS failed to boot.');
        return;
      }

      if (data.type === 'ejs:save-update' && isArrayBuffer(data.saveBuffer)) {
        const saveBuffer = data.saveBuffer;
        clearRestoreCommandTimer();
        setPendingSave(saveBuffer);
        persistSave(saveBuffer).catch(console.error);
        setSyncNote('A fresh ROM save was captured. Syncing coins and imported Pokemon now.');
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      clearRestoreCommandTimer();
      releaseAllControls();
      window.removeEventListener('message', onMessage);
    };
  }, [pendingSave, stationLabel]);

  useEffect(() => {
    if (!isArrayBuffer(pendingSave)) return;
    const saveBuffer: ArrayBuffer = pendingSave;
    let cancelled = false;

    async function syncSave() {
      const parsed = parseEmeraldSave(saveBuffer);
      if (!parsed) {
        if (!cancelled) {
          setSyncNote('A save was captured, but sync is waiting for a recognizable Emerald-format save.');
        }
        return;
      }

      setAppCoins(parsed.coins);
      const imported = await importParsedEmeraldSaveToPc(parsed);
      if (cancelled) return;

      const fragments = [`ROM save synced automatically. Current ROM coin total: ${parsed.coins.toLocaleString()}.`];
      if (imported.importedCount > 0) {
        fragments.push(`Imported ${imported.importedCount} new Pokemon into the app PC.`);
      } else if (parsed.party.length || parsed.boxes.length) {
        fragments.push('No new Pokemon were added because this save has already been imported.');
      } else {
        fragments.push('No importable Pokemon were present in the current party or PC boxes yet.');
      }
      if (imported.droppedCount > 0) {
        fragments.push(`${imported.droppedCount} Pokemon could not be stored because the app PC is full.`);
      }
      setSyncNote(fragments.join(' '));
      setStatus(`Exact ROM running for ${stationLabel}.`);
    }

    syncSave().catch((reason) => {
      if (cancelled) return;
      setSyncNote(reason instanceof Error ? reason.message : 'Save sync failed.');
    });

    return () => {
      cancelled = true;
    };
  }, [pendingSave, setAppCoins, stationLabel]);

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

    iframeRef.current.contentWindow.postMessage(message, '*', transfer);
    setLaunchRequestedAt(null);
    setStatus(`Booting the exact ROM for ${stationLabel}...`);
  }, [hostReady, launchRequestedAt, pendingSave, stationLabel, storedRom]);

  useEffect(() => {
    if (!romReady || !storedRom) return;
    setError(null);
    setHostReady(false);
    setBootNonce((value) => value + 1);
    setLaunchRequestedAt(Date.now());
  }, [romReady, stationLabel, storedRom]);

  async function onInstallRom(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const rom = await persistRom(file);
      setStoredRom(rom);
      setError(null);
      setSyncNote('ROM installed. Future saves remain hidden and persist automatically.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to store the selected ROM.');
    } finally {
      event.target.value = '';
    }
  }

  function relaunchInstalledRom() {
    if (!storedRom) {
      setError('Install a compiled Game Corner .gba first.');
      return;
    }
    setError(null);
    clearRestoreCommandTimer();
    setHostReady(false);
    setBootNonce((value) => value + 1);
    setLaunchRequestedAt(Date.now());
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
      <div className="emulator-topline">
        <div className="emulator-topline-copy">
          <strong>{stationLabel}</strong>
          <span>{status}</span>
        </div>
        <div className="emulator-topline-meta">
          <span>{stationSubtitle}</span>
          <span>{appCoins.toLocaleString()} app coins</span>
        </div>
      </div>

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
      ) : (
        <div className="emulator-toolbar">
          <div className="emulator-runtime-chip">
            <strong>ROM</strong>
            <span>{storedRom.name}</span>
          </div>
          <button className="emulator-launch-btn" onClick={relaunchInstalledRom}>Reload ROM</button>
          <button className="emulator-secondary-btn" onClick={requestFullscreen}>Fullscreen</button>
          <label className="emulator-replace-link">
            Replace ROM
            <input
              type="file"
              accept=".gba,application/octet-stream"
              onChange={onInstallRom}
            />
          </label>
        </div>
      )}

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
          <div className="emulator-sync-copy emulator-sync-copy--compact">
            <strong>Hidden save sync</strong>
            <p>{syncNote}</p>
          </div>
        </div>
      </div>
    </div>
  );
}