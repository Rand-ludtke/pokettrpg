import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoxGrid } from './BoxGrid.tsx';
import { SidePanel } from './SidePanel.tsx';
import { TeamView } from './TeamView.tsx';
import { BattleTab } from './BattleTab.tsx';
import { LobbyTab } from './LobbyTab';
import { BattlePokemon } from '../types.ts';
import { getSpriteSettings, setSpriteSettings, SpriteSet, loadTeams, saveTeams, createTeam, cloneForTeam, getTeamMaxSize, isTeamFull } from '../data/adapter.ts';
import { ImportExport } from './ImportExport';
import { CustomsFileImporter } from './CustomsFileImporter';
import { SimpleBattleTab } from './SimpleBattleTab';
import { PSBattlePanel } from '../ps';
import { CharacterSheet } from './CharacterSheet';
import { BadgeCase } from './BadgeCase';
import { FusionTab } from './FusionTab';
import { DiceLevelingPanel } from './DiceLevelingPanel';
import { CollapsiblePanel } from './CollapsiblePanel';
import { getClient, RoomSummary } from '../net/pokettrpgClient';
import { BugReporter } from './BugReporter';

// Battle UI mode: 'ps' for Pokemon Showdown UI, 'simple' for custom SimpleBattleTab
const BATTLE_UI_MODE: 'ps' | 'simple' = 'ps';

type Tab = 'pc' | 'team' | 'battle' | 'lobby' | 'sheet' | 'badges' | 'fusion' | { kind: 'psbattle'; id: string; title: string };

export function App() {
  const [tab, setTab] = useState<Tab>('pc');
  const [extraTabs, setExtraTabs] = useState<Array<{ kind: 'psbattle'; id: string; title: string }>>([]);
  const [mountedBattles, setMountedBattles] = useState<Record<string, { id: string; title: string }>>({});
  const dismissedBattlesRef = useRef<Set<string>>(new Set());
  const client = useMemo(() => getClient(), []);

  useEffect(() => {
    const updateBattleTabTitle = (roomId: string, titleOrUpdater: string | ((prevTitle?: string) => string)) => {
      let computed = '';
      setMountedBattles(prev => {
        const prevTitle = prev[roomId]?.title;
        computed = typeof titleOrUpdater === 'function' ? titleOrUpdater(prevTitle) : titleOrUpdater;
        return { ...prev, [roomId]: { id: roomId, title: computed } };
      });
      setExtraTabs(prev => {
        const idx = prev.findIndex(t => t.id === roomId);
        if (idx === -1) return [...prev, { kind: 'psbattle', id: roomId, title: computed }];
        const next = prev.slice();
        next[idx] = { ...next[idx], title: computed };
        return next;
      });
      return computed;
    };

    const ensureBattleTab = (roomId: string, title: string) => {
      if (dismissedBattlesRef.current.has(roomId)) return;
      const computedTitle = updateBattleTabTitle(roomId, title);
      setTab({ kind: 'psbattle', id: roomId, title: computedTitle });
    };

    const participatesInSummary = (summary: RoomSummary) => {
      if (!summary?.players || !Array.isArray(summary.players) || !client.user) return false;
      const myId = (client.user.id || '').toLowerCase();
      const myName = (client.user.username || '').toLowerCase();
      return summary.players.some(player => {
        if (!player) return false;
        const playerAny = player as any;
        const id = (player.id || playerAny.userid || playerAny.userId || '').toLowerCase();
        if (id && myId && id === myId) return true;
        const uname = (player.username || player.name || playerAny.user?.username || playerAny.user?.name || '').toLowerCase();
        return !!myName && uname === myName;
      });
    };

    const ensureTabFromSummary = (summary: RoomSummary) => {
      if (!summary?.battleStarted) return;
      if (!participatesInSummary(summary)) return;
      if (dismissedBattlesRef.current.has(summary.id)) return;
      const state = client.getBattleState(summary.id);
      const title = deriveTitle(state, summary.id) || summary.name || `Battle ${summary.id}`;
      ensureBattleTab(summary.id, title);
    };

    const deriveTitle = (state: any, roomId: string) => {
      if (!state) return `Battle ${roomId}`;
      if (state?.players && Array.isArray(state.players)) {
        const names = state.players.map((p: any) => p?.name || p?.username).filter(Boolean);
        if (names.length >= 2) return `${names[0]} vs ${names[1]}`;
        if (names.length === 1) return `${names[0]} Battle`;
      }
      return state?.name || `Battle ${roomId}`;
    };

    const offStart = client.on('battleStarted', ({ roomId, state }) => {
      const title = deriveTitle(state, roomId);
      dismissedBattlesRef.current.delete(roomId);
      ensureBattleTab(roomId, title);
    });
    const offTeamPreview = client.on('teamPreviewStarted', ({ roomId }) => {
      const room = client.getRooms().find(r => r.id === roomId);
      const title = room?.name || `Battle ${roomId}`;
      dismissedBattlesRef.current.delete(roomId);
      ensureBattleTab(roomId, title);
    });
    const offSpectate = client.on('spectateStart', ({ roomId, state }) => {
      const title = deriveTitle(state, roomId);
      dismissedBattlesRef.current.delete(roomId);
      ensureBattleTab(roomId, title);
    });
    const offUpdate = client.on('battleUpdate', ({ roomId, update }) => {
      const title = deriveTitle(update?.state, roomId);
      if (!title) return;
      updateBattleTabTitle(roomId, title);
    });
    const offEnd = client.on('battleEnd', ({ roomId, payload }) => {
      const winner = payload?.result?.winner || payload?.winner;
      if (!winner) return;
      updateBattleTabTitle(roomId, prevTitle => {
        const base = prevTitle || `Battle ${roomId}`;
        return `${base} • ${winner} wins`;
      });
      dismissedBattlesRef.current.delete(roomId);
    });
    const offRoomsSnapshot = client.on('roomsSnapshot', rooms => {
      rooms.forEach(ensureTabFromSummary);
    });
    const offRoomSummaryUpdate = client.on('roomUpdate', ensureTabFromSummary);
    const offIdentified = client.on('identified', () => {
      client.getRooms().forEach(ensureTabFromSummary);
    });
    return () => {
      offStart();
      offTeamPreview();
      offSpectate();
      offUpdate();
      offEnd();
      offRoomsSnapshot();
      offRoomSummaryUpdate();
      offIdentified();
    };
  }, [client]);

  const [selected, setSelected] = useState<BattlePokemon | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const BOX_SIZE = 30;
  const MAX_BOXES = 64;
  const [boxes, setBoxes] = useState<Array<Array<BattlePokemon | null>>>(() => {
    try {
      const raw = localStorage.getItem('ttrpg.boxes');
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Array<BattlePokemon | null>>;
        const out: Array<Array<BattlePokemon | null>> = Array.from({ length: MAX_BOXES }, (_, i) => {
          const src = parsed[i] || [];
          const row: Array<BattlePokemon | null> = Array.from({ length: BOX_SIZE }, (_, j) => src[j] ?? null);
          return row;
        });
        return out;
      }
    } catch {}
    return Array.from({ length: MAX_BOXES }, () => Array.from({ length: BOX_SIZE }, () => null));
  });
  const [boxIndex, setBoxIndex] = useState<number>(() => {
    const raw = localStorage.getItem('ttrpg.boxIndex');
    return raw ? Number(raw) : 0;
  });
  const [teams, setTeams] = useState(() => loadTeams());
  const activeTeam = useMemo(() => teams.teams.find(t => t.id === teams.activeId) || teams.teams[0] || null, [teams]);
  const team = activeTeam?.members || [];

  // Multi-delete state for PC box
  const [pcMulti, setPcMulti] = useState<{ enabled: boolean; indices: number[] }>({ enabled: false, indices: [] });
  // Team selector for bulk add
  const [bulkAddTeamId, setBulkAddTeamId] = useState<string>('');
  // Leveling mode state (for applying levels by selecting PC pokemon)
  const [pendingLevels, setPendingLevels] = useState(0);
  const [levelingMode, setLevelingMode] = useState(false);
  const [levelingSelectedIndices, setLevelingSelectedIndices] = useState<number[]>([]);
  const togglePcPick = (idx: number) => {
    setPcMulti(prev => {
      const has = prev.indices.includes(idx);
      const indices = has ? prev.indices.filter(i => i !== idx) : [...prev.indices, idx];
      return { ...prev, indices };
    });
  };
  const confirmPcMultiDelete = () => {
    const toDel = pcMulti.indices.slice().sort((a, b) => b - a);
    if (toDel.length === 0) return;
    const names: string[] = [];
    const box = currentBox();
    for (const i of toDel) { const p = box[i]; if (p && p.name) names.push(p.name); }
    setBoxes(prev => prev.map((b, i) => {
      if (i !== boxIndex) return b;
      const nb = b.slice();
      for (const idx of toDel) { if (idx >= 0 && idx < nb.length) nb[idx] = null; }
      return nb;
    }));
    if (names.length) {
      setTeams(prev => {
        const updated = prev.teams.map(t => ({ ...t, members: t.members.filter(m => !names.includes(m.name)) }));
        const state = { teams: updated, activeId: prev.activeId };
        saveTeams(updated, prev.activeId);
        return state;
      });
    }
    setSelected(null); setSelectedIndex(null);
    setPcMulti({ enabled: false, indices: [] });
  };
  const selectAllInPcBox = () => {
    const box = currentBox();
    const indices = box.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
    setPcMulti(prev => ({ ...prev, enabled: true, indices }));
  };
  const invertSelectionInPcBox = () => {
    const box = currentBox();
    const cur = new Set(pcMulti.indices);
    const indices = box.map((p, i) => (p ? i : -1)).filter(i => i >= 0).filter(i => !cur.has(i));
    setPcMulti(prev => ({ ...prev, enabled: true, indices }));
  };

  // Clear leveling selection when leveling mode is off or no pending levels
  useEffect(() => {
    if (!levelingMode || pendingLevels === 0) {
      setLevelingSelectedIndices([]);
    }
  }, [levelingMode, pendingLevels]);

  // Show a one-time banner after importing customs
  const [showReloadBanner, setShowReloadBanner] = useState<boolean>(() => {
    try { return localStorage.getItem('ttrpg.customsReloadPending') === '1'; } catch { return false; }
  });
  function doReload() {
    try { localStorage.removeItem('ttrpg.customsReloadPending'); } catch {}
    location.reload();
  }

  function currentBox(): Array<BattlePokemon | null> { return boxes[boxIndex] ?? []; }
  function setCurrentBox(next: Array<BattlePokemon | null>) {
    const row = Array.from({ length: BOX_SIZE }, (_, j) => next[j] ?? null);
    setBoxes(prev => prev.map((b, i) => (i === boxIndex ? row : b)));
  }
  function prevBox() { setBoxIndex(i => (i - 1 + boxes.length) % boxes.length); }
  function nextBox() { setBoxIndex(i => (i + 1) % boxes.length); }

  function addAcrossBoxes(newMons: BattlePokemon[]) {
    setBoxes(prev => {
      const out = prev.map(b => b.slice());
      let queue = newMons.slice();
      let boxPtr = 0;
      while (queue.length) {
        if (!out[boxPtr]) out[boxPtr] = Array.from({ length: BOX_SIZE }, () => null);
        const box = out[boxPtr];
        for (let s = 0; s < BOX_SIZE && queue.length; s++) {
          if (!box[s]) { box[s] = queue.shift()!; }
        }
        if (queue.length) boxPtr++;
        if (boxPtr >= out.length && queue.length && out.length < MAX_BOXES) {
          out.push(Array.from({ length: BOX_SIZE }, () => null));
        }
        if (boxPtr > 200) break;
      }
      return out;
    });
  }

  function handleSelect(p: BattlePokemon | null, index: number) {
    setSelected(p);
    setSelectedIndex(index);
  }

  const toggleLevelingSelect = (idx: number) => {
    setLevelingSelectedIndices(prev => {
      const has = prev.includes(idx);
      if (has) return prev.filter(i => i !== idx);
      if (prev.length >= 6) return prev;
      return [...prev, idx];
    });
  };

  const applySelectedLevels = () => {
    if (!pendingLevels || levelingSelectedIndices.length === 0) return;
    const box = currentBox();
    const multiplier = levelingSelectedIndices.length === 1 ? 2 : 1;
    const addLevels = pendingLevels * multiplier;
    const updatedNames: string[] = [];

    setBoxes(prev => prev.map((b, i) => {
      if (i !== boxIndex) return b;
      const nb = b.slice();
      for (const idx of levelingSelectedIndices) {
        const pokemon = nb[idx];
        if (!pokemon) continue;
        const newLevel = Math.min(100, (pokemon.level || 1) + addLevels);
        nb[idx] = { ...pokemon, level: newLevel };
        updatedNames.push(pokemon.name);
      }
      return nb;
    }));

    // Update selected pokemon view if needed
    if (selected && selectedIndex != null && levelingSelectedIndices.includes(selectedIndex)) {
      const newLevel = Math.min(100, (selected.level || 1) + addLevels);
      setSelected({ ...selected, level: newLevel });
    }

    // Update teams if any selected pokemon exist there
    if (updatedNames.length) {
      setTeams(prev => {
        const updated = prev.teams.map(t => ({
          ...t,
          members: t.members.map(m => updatedNames.includes(m.name) ? { ...m, level: Math.min(100, (m.level || 1) + addLevels) } : m)
        }));
        saveTeams(updated, prev.activeId);
        return { teams: updated, activeId: prev.activeId };
      });
    }

    // Clear pending levels and exit leveling mode
    setPendingLevels(0);
    setLevelingMode(false);
    setLevelingSelectedIndices([]);
  };

  function addToTeam(p: BattlePokemon, teamId?: string) {
    let targetId = teamId || teams.activeId || teams.teams[0]?.id || null;
    let newTeams = [...teams.teams];
    if (!targetId) {
      const t = createTeam(`Team ${newTeams.length + 1}`);
      newTeams.push(t);
      targetId = t.id;
    }
    newTeams = newTeams.map(t => {
      if (t.id !== targetId) return t;
      // Use isTeamFull to respect both standard and TTRPG team limits
      if (isTeamFull(t)) return t;
      return { ...t, members: [...t.members, cloneForTeam(p)] };
    });
    const state = { teams: newTeams, activeId: targetId };
    setTeams(state);
    saveTeams(newTeams, targetId);
  }

  function removeFromTeam(name: string) {
    const active = activeTeam; if (!active) return;
    const newTeams = teams.teams.map(t => (t.id === active.id ? { ...t, members: t.members.filter(x => x.name !== name) } : t));
    setTeams({ teams: newTeams, activeId: active.id });
    saveTeams(newTeams, active.id);
  }

  function replaceTeamAt(index: number, p: BattlePokemon) {
    const active = activeTeam; if (!active) return;
    const newTeams = teams.teams.map(t => (t.id === active.id ? { ...t, members: t.members.map((m, i) => (i === index ? p : m)) } : t));
    setTeams({ teams: newTeams, activeId: active.id });
    saveTeams(newTeams, active.id);
  }

  // Update a specific Pokémon's properties (used by DiceLevelingPanel)
  const updateTeamPokemon = useCallback((teamId: string, pokemonIndex: number, updates: Partial<BattlePokemon>) => {
    setTeams(prev => {
      const newTeams = prev.teams.map(t => {
        if (t.id !== teamId) return t;
        const newMembers = t.members.map((m, i) => {
          if (i !== pokemonIndex) return m;
          return { ...m, ...updates };
        });
        return { ...t, members: newMembers };
      });
      saveTeams(newTeams, prev.activeId);
      return { ...prev, teams: newTeams };
    });
  }, []);

  useEffect(() => { saveTeams(teams.teams, teams.activeId); }, [teams]);
  useEffect(() => {
    try { localStorage.setItem('ttrpg.boxes', JSON.stringify(boxes)); } catch {}
    window.dispatchEvent(new Event('ttrpg-boxes-updated'));
  }, [boxes]);
  useEffect(() => { try { localStorage.setItem('ttrpg.boxIndex', String(boxIndex)); } catch {} }, [boxIndex]);

  // Listen for navigateToLobby events from battle tab
  useEffect(() => {
    const handler = () => setTab('lobby');
    window.addEventListener('navigateToLobby', handler);
    return () => window.removeEventListener('navigateToLobby', handler);
  }, []);

  function changeSelectedAbility(nextAbility: string) {
    if (selected == null || selectedIndex == null) return;
    setBoxes(prev => prev.map((box, i) => {
      if (i !== boxIndex) return box;
      const nb = box.slice();
      const cur = nb[selectedIndex];
      if (cur) nb[selectedIndex] = { ...cur, ability: nextAbility };
      return nb;
    }));
    setTeams(prev => {
      const updated = prev.teams.map(t => ({ ...t, members: t.members.map(m => (m.name === selected.name ? { ...m, ability: nextAbility } : m)) }));
      const state = { teams: updated, activeId: prev.activeId };
      saveTeams(updated, prev.activeId);
      return state;
    });
    setSelected((prev: BattlePokemon | null) => (prev ? { ...prev, ability: nextAbility } : prev));
  }

  return (
    <div className="app">
      {showReloadBanner && (
        <div style={{ background: '#174', color: '#dff', padding: '8px 12px', borderBottom: '1px solid #0b2', display: 'flex', gap: 12, alignItems: 'center' }}>
          <strong>Customs imported.</strong>
          <span className="dim">Reload to load new species and learnsets.</span>
          <button onClick={doReload}>&gt; Reload now</button>
          <button onClick={() => { setShowReloadBanner(false); try { localStorage.removeItem('ttrpg.customsReloadPending'); } catch {} }} style={{ marginLeft: 'auto' }}>Dismiss</button>
        </div>
      )}
      <header className="topbar">
  <div className="brand">&gt; POKÉMON TTRPG v1.3.1</div>
        <nav className="tabs">
          <button className={tab === 'pc' ? 'active' : ''} onClick={() => setTab('pc')}>PC</button>
          <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Team</button>
          <button className={tab === 'battle' ? 'active' : ''} onClick={() => setTab('battle')}>Battle</button>
          <button className={tab === 'lobby' ? 'active' : ''} onClick={() => setTab('lobby')}>Lobby</button>
          <button className={tab === 'fusion' ? 'active' : ''} onClick={() => setTab('fusion')}>Fusion</button>
          <button className={tab === 'sheet' ? 'active' : ''} onClick={() => setTab('sheet')}>Character</button>
          <button className={tab === 'badges' ? 'active' : ''} onClick={() => setTab('badges')}>Badges</button>
          {extraTabs.map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button className={(typeof tab === 'object' && (tab as any).id === t.id) ? 'active' : ''} onClick={() => setTab(t)}>{t.title}</button>
              <button className="mini" onClick={() => {
                dismissedBattlesRef.current.add(t.id);
                setExtraTabs(prev => prev.filter(x => x.id !== t.id));
                setMountedBattles(prev => { const n = { ...prev }; delete n[t.id]; return n; });
                if (typeof tab === 'object' && (tab as any).id === t.id) setTab('lobby');
              }}>×</button>
            </span>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="dim" htmlFor="spriteSet">Sprites:</label>
          <select id="spriteSet" defaultValue={getSpriteSettings().set || 'gen5'} onChange={(e) => setSpriteSettings({ set: e.target.value as SpriteSet })}>
            <option value="gen5">Gen 5 (default)</option>
            <option value="gen1">Gen 1</option>
            <option value="gen2">Gen 2</option>
            <option value="gen3">Gen 3</option>
            <option value="gen4">Gen 4</option>
            <option value="gen6">Gen 6</option>
            <option value="home">HOME</option>
          </select>
          <label className="dim" htmlFor="aniToggle" style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <input id="aniToggle" type="checkbox" defaultChecked={getSpriteSettings().animated} onChange={(e)=> setSpriteSettings({ animated: e.target.checked })} /> Animated
          </label>
        </div>
      </header>

      {tab === 'pc' && (
        <div className="pc-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <BoxGrid
              pokes={currentBox()}
              onSelect={(p, idx) => {
                if (pcMulti.enabled) { togglePcPick(idx); return; }
                handleSelect(p, idx);
              }}
              boxIndex={boxIndex}
              boxCount={boxes.length}
              onPrevBox={prevBox}
              onNextBox={nextBox}
              selectMode={pcMulti.enabled}
              selectedIndices={pcMulti.indices}
              onToggleSelect={togglePcPick}
              onShiftToggle={(idx)=>{
                setPcMulti(prev => {
                  const has = prev.indices.includes(idx);
                  const indices = has ? prev.indices.filter(i => i !== idx) : [...prev.indices, idx];
                  return { enabled: true, indices };
                });
              }}
              levelingMode={levelingMode}
              pendingLevels={pendingLevels}
              levelingSelectedIndices={levelingSelectedIndices}
              onToggleLevelingSelect={toggleLevelingSelect}
              onDrop={(payload, targetIdx) => {
                const { fromBox, indices } = payload;
                if (!indices || !indices.length) return;
                const mons = indices.map(i => boxes[fromBox]?.[i]).filter(Boolean) as BattlePokemon[];
                if (!mons.length) return;
                setBoxes(prev => {
                  const out = prev.map(b => b.slice());
                  for (const i of indices) { if (fromBox>=0 && fromBox<out.length && i>=0 && i<out[fromBox].length) out[fromBox][i] = null; }
                  let bIdx = boxIndex; let sIdx = Math.max(0, Math.min(BOX_SIZE-1, targetIdx));
                  for (const mon of mons) {
                    let placed = false; let scans = 0;
                    while (!placed && scans < (out.length * BOX_SIZE)) {
                      if (!out[bIdx][sIdx]) { out[bIdx][sIdx] = mon; placed = true; break; }
                      if (mons.length===1 && scans===0) {
                        const temp = out[bIdx][sIdx];
                        out[bIdx][sIdx] = mon;
                        let fb = bIdx, fs = (sIdx+1)%BOX_SIZE; let guard=0;
                        while (guard < out.length*BOX_SIZE) {
                          if (!out[fb][fs]) { out[fb][fs] = temp!; break; }
                          fs++; if (fs>=BOX_SIZE) { fs=0; fb=(fb+1)%out.length; }
                          guard++;
                        }
                        placed = true; break;
                      }
                      sIdx++; if (sIdx>=BOX_SIZE) { sIdx=0; bIdx=(bIdx+1)%out.length; }
                      scans++;
                    }
                  }
                  return out;
                });
                setPcMulti({ enabled: false, indices: [] });
                setSelected(null); setSelectedIndex(null);
              }}
            />
            <CollapsiblePanel title="Import / Export" icon="📥">
              <ImportExport
                onImport={(t) => addAcrossBoxes(t)}
                exportList={currentBox().filter((x): x is BattlePokemon => !!x)}
                exportLabel="Export Current Box"
                onImportAsTeam={(mons, teamName) => {
                  // Add all Pokemon to PC boxes
                  addAcrossBoxes(mons);
                  // Create a new team with these Pokemon
                  const newTeam = createTeam(teamName, { type: 'standard' });
                  const newTeams = [...teams.teams, { ...newTeam, members: mons.slice(0, 6) }];
                  setTeams({ teams: newTeams, activeId: newTeam.id });
                  saveTeams(newTeams, newTeam.id);
                }}
                teamImportLabel="Import as New Team"
              />
            </CollapsiblePanel>
            <CollapsiblePanel title="Bulk Actions" icon="📦">
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="dim" style={{ fontSize: '0.85em', marginBottom: 4 }}>
                  Shift-click Pokémon in the PC box to select multiple.
                  {pcMulti.indices.length > 0 && ` (${pcMulti.indices.length} selected)`}
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <label className="dim" style={{ display: 'grid', gap: 4 }}>
                    Target Team
                    <select 
                      value={bulkAddTeamId || teams.activeId || ''} 
                      onChange={e => setBulkAddTeamId(e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: 6 }}
                    >
                      {teams.teams.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.members.length} Pokémon){t.type === 'ttrpg' ? ' [TTRPG]' : ''}
                        </option>
                      ))}
                      {teams.teams.length === 0 && <option value="">No teams - will create new</option>}
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button 
                      disabled={pcMulti.indices.length === 0} 
                      onClick={() => {
                        const box = currentBox();
                        const toAdd = pcMulti.indices.map(i => box[i]).filter((x): x is BattlePokemon => !!x);
                        const targetId = bulkAddTeamId || teams.activeId || teams.teams[0]?.id;
                        for (const p of toAdd) addToTeam(p, targetId);
                        setPcMulti({ enabled: false, indices: [] });
                      }}
                    >
                      + Add {pcMulti.indices.length || ''} to Team
                    </button>
                    <button className="danger" disabled={pcMulti.indices.length === 0} onClick={confirmPcMultiDelete}>
                      🗑️ Delete {pcMulti.indices.length || ''}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="secondary mini" onClick={selectAllInPcBox}>Select All</button>
                  <button className="secondary mini" onClick={invertSelectionInPcBox}>Invert</button>
                  <button className="secondary mini" onClick={() => setPcMulti(prev => ({ ...prev, indices: [] }))} disabled={pcMulti.indices.length === 0}>Clear Selection</button>
                </div>
              </div>
            </CollapsiblePanel>
            <DiceLevelingPanel
              pendingLevels={pendingLevels}
              onPendingLevelsChange={setPendingLevels}
              levelingMode={levelingMode}
              onLevelingModeChange={setLevelingMode}
              levelingSelectionCount={levelingSelectedIndices.length}
              onApplySelectedLevels={applySelectedLevels}
              onClearLevelingSelection={() => setLevelingSelectedIndices([])}
            />
            <CollapsiblePanel title="Import species.json / learnset.json" icon="📄">
              <CustomsFileImporter />
            </CollapsiblePanel>
          </div>
          <SidePanel
            selected={selected}
            onAdd={addToTeam}
            onChangeAbility={changeSelectedAbility}
            onAddToSlot={(p) => {
              if (selectedIndex == null) return;
              setBoxes(prev => prev.map((box, i) => {
                if (i !== boxIndex) return box;
                const nb = box.slice();
                nb[selectedIndex] = p;
                return nb;
              }));
              setSelected(p);
            }}
            onReplaceSelected={(p) => {
              if (selectedIndex == null) return;
              setBoxes(prev => prev.map((box, i) => {
                if (i !== boxIndex) return box;
                const nb = box.slice();
                nb[selectedIndex] = p;
                return nb;
              }));
              setSelected(p);
              setTeams(prev => {
                const beforeName = selected?.name ?? '';
                const updated = prev.teams.map(t => ({ ...t, members: t.members.map(m => (m.name === beforeName ? { ...p } as BattlePokemon : m)) }));
                const state = { teams: updated, activeId: prev.activeId };
                saveTeams(updated, prev.activeId); return state;
              });
            }}
            onDeleteSelected={() => {
              if (selectedIndex == null) return;
              setBoxes(prev => prev.map((box, i) => {
                if (i !== boxIndex) return box;
                const nb = box.slice();
                nb[selectedIndex] = null;
                return nb;
              }));
              if (selected) setTeams(prev => {
                const updated = prev.teams.map(t => ({ ...t, members: t.members.filter(m => m.name !== selected.name) }));
                const state = { teams: updated, activeId: prev.activeId };
                saveTeams(updated, prev.activeId); return state;
              });
              setSelected(null);
              setSelectedIndex(null);
            }}
          />
        </div>
      )}

      {tab === 'team' && (
        <div className="team-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <TeamView team={team} onRemove={removeFromTeam} onMove={(from, to) => {
            const active = activeTeam; if (!active || from === to) return;
            const arr = active.members.slice();
            const [m] = arr.splice(from, 1);
            arr.splice(to, 0, m);
            const newTeams = teams.teams.map(t => t.id === active.id ? { ...t, members: arr } : t);
            setTeams({ teams: newTeams, activeId: active.id }); saveTeams(newTeams, active.id);
          }} />
          <section className="panel">
            <h2>Teams</h2>
            {teams.teams.length === 0 && <div className="dim">No teams yet.</div>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {teams.teams.map(t => {
                const maxSize = getTeamMaxSize(t);
                const typeLabel = t.type === 'ttrpg' ? 'Custom' : 'Standard';
                const sizeLabel = maxSize === Infinity ? '∞' : maxSize;
                return (
                <li key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gridTemplateRows: 'auto auto', gap: 8, alignItems: 'center' }}>
                  <div style={{ gridColumn: '1 / 2', gridRow: '1' }}>
                    <strong>{t.name}</strong> {teams.activeId === t.id && <span className="dim">(active)</span>}
                    <div className="dim" style={{ fontSize: '0.9em' }}>
                      {t.members.length} / {sizeLabel} 
                      <span style={{ marginLeft: 6, fontSize: '0.85em', padding: '1px 5px', borderRadius: 4, background: t.type === 'ttrpg' ? 'rgba(180,100,255,0.2)' : 'rgba(100,200,100,0.2)', border: t.type === 'ttrpg' ? '1px solid rgba(180,100,255,0.4)' : '1px solid rgba(100,200,100,0.4)' }}>
                        {typeLabel}
                      </span>
                    </div>
                  </div>
                  <button className="mini" style={{ gridColumn: '2', gridRow: '1' }} onClick={() => {
                    const nn = prompt('Rename team', t.name);
                    if (nn == null) return; const name = nn.trim(); if (!name) return;
                    const newTeams = teams.teams.map(x => x.id === t.id ? { ...x, name } : x);
                    setTeams({ teams: newTeams, activeId: teams.activeId }); saveTeams(newTeams, teams.activeId);
                  }}>Rename</button>
                  <button className="mini" style={{ gridColumn: '3', gridRow: '1' }} onClick={() => {
                    const copy = { ...t, id: createTeam(`${t.name} (copy)`).id, name: `${t.name} (copy)` };
                    const newTeams = [...teams.teams, copy];
                    setTeams({ teams: newTeams, activeId: teams.activeId }); saveTeams(newTeams, teams.activeId);
                  }}>Duplicate</button>
                  <button className="mini" style={{ gridColumn: '4', gridRow: '1' }} onClick={() => {
                    const copy = { ...t, id: createTeam(`${t.name} (copy)`).id, name: `${t.name} (copy)` };
                    const newTeams = [...teams.teams, copy];
                    setTeams({ teams: newTeams, activeId: copy.id }); saveTeams(newTeams, copy.id);
                  }}>Duplicate as Active</button>
                  <button className="mini" style={{ gridColumn: '5', gridRow: '1' }} onClick={() => {
                    if (!confirm('Delete this team?')) return;
                    const list = teams.teams.filter(x => x.id !== t.id);
                    const newActive = teams.activeId === t.id ? (list[0]?.id || null) : teams.activeId;
                    setTeams({ teams: list, activeId: newActive }); saveTeams(list, newActive);
                  }}>Delete</button>
                  <button onClick={() => {
                    const nextActive = t.id;
                    setTeams(prev => {
                      const currentTeams = prev.teams;
                      saveTeams(currentTeams, nextActive);
                      return { teams: currentTeams, activeId: nextActive };
                    });
                  }} disabled={teams.activeId === t.id} style={{ gridColumn: '1 / -1', gridRow: '2' }}>Set Active</button>
                </li>
              );})}
            </ul>
            <div style={{ marginTop: 12, padding: 10, border: '1px solid #444', borderRadius: 6, background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: '0.9em', color: '#aaa' }}>Create New Team</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <input id="newTeamName" placeholder={`Team ${teams.teams.length + 1}`} style={{ padding: '6px 8px' }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85em', cursor: 'pointer' }}>
                    <input type="radio" name="teamType" id="teamTypeStandard" defaultChecked style={{ cursor: 'pointer' }} />
                    <span>Standard (6 max)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85em', cursor: 'pointer' }}>
                    <input type="radio" name="teamType" id="teamTypeCustom" style={{ cursor: 'pointer' }} />
                    <span>Custom</span>
                  </label>
                  <input 
                    type="number" 
                    id="customTeamSize" 
                    placeholder="Size" 
                    min={1} 
                    max={100} 
                    defaultValue={12}
                    style={{ width: 60, padding: '4px 6px', fontSize: '0.85em' }} 
                    title="Max Pokemon for custom team"
                  />
                </div>
                <button onClick={() => {
                  const nameEl = document.getElementById('newTeamName') as HTMLInputElement | null;
                  const customRadio = document.getElementById('teamTypeCustom') as HTMLInputElement | null;
                  const sizeEl = document.getElementById('customTeamSize') as HTMLInputElement | null;
                  const nameRaw = (nameEl?.value || '').trim() || `Team ${teams.teams.length + 1}`;
                  const isCustom = customRadio?.checked || false;
                  const customSize = Math.min(100, Math.max(1, parseInt(sizeEl?.value || '12', 10) || 12));
                  const t = createTeam(nameRaw, isCustom ? { type: 'ttrpg', maxSize: customSize } : { type: 'standard' });
                  const newTeams = [...teams.teams, t];
                  setTeams({ teams: newTeams, activeId: t.id }); 
                  saveTeams(newTeams, t.id);
                  if (nameEl) nameEl.value = '';
                }}>+ Create Team</button>
              </div>
            </div>
          </section>
          <ImportExport onImport={(t) => { const active = activeTeam; if (!active) return; const newTeams = teams.teams.map(x => x.id === active.id ? { ...x, members: t.slice(0, 6) } : x); setTeams({ teams: newTeams, activeId: active.id }); saveTeams(newTeams, active.id); }} maxCount={6} exportList={team} exportLabel="Export Team" />
        </div>
      )}

      {tab === 'battle' && (<BattleTab friendly={team[0] ?? null} enemy={selected} team={team} onReplaceTeam={replaceTeamAt} />)}
      <div style={{ display: tab === 'lobby' ? 'block' : 'none' }}>
        <LobbyTab />
      </div>
      {tab === "sheet" && (<CharacterSheet />)}
      {tab === 'badges' && (<BadgeCase />)}
      {tab === 'fusion' && (
        <FusionTab
          onAddToPC={(mons) => addAcrossBoxes(mons)}
          boxes={boxes}
          onReplaceInPC={(boxIdx, slotIdx, mon) => {
            setBoxes(prev => prev.map((b, i) => {
              if (i !== boxIdx) return b;
              const row = b.slice(); row[slotIdx] = mon; return row;
            }));
          }}
          onRemoveFromPC={(boxIdx, slotIdx) => {
            setBoxes(prev => prev.map((b, i) => {
              if (i !== boxIdx) return b;
              const row = b.slice(); row[slotIdx] = null; return row;
            }));
          }}
        />
      )}

      {Object.values(mountedBattles).map(b => (
        <div key={b.id} style={{ display: (typeof tab === 'object' && (tab as any).id === b.id) ? 'block' : 'none', height: '100%' }}>
          {BATTLE_UI_MODE === 'ps' ? (
            <PSBattlePanel 
              roomId={b.id} 
              client={client}
              myPlayerId={client.user?.id}
              onClose={() => {
                dismissedBattlesRef.current.add(b.id);
                setMountedBattles(prev => {
                  const next = { ...prev };
                  delete next[b.id];
                  return next;
                });
                setExtraTabs(prev => prev.filter(t => t.id !== b.id));
                setTab('lobby');
              }}
            />
          ) : (
            <SimpleBattleTab roomId={b.id} title={b.title} />
          )}
        </div>
      ))}      <BugReporter currentTab={typeof tab === 'string' ? tab : tab.kind + ':' + tab.id} />    </div>
  );
}
