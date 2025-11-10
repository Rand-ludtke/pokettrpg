import React, { useEffect, useMemo, useState } from 'react';
import { BoxGrid } from './BoxGrid.tsx';
import { SidePanel } from './SidePanel.tsx';
import { TeamView } from './TeamView.tsx';
import { BattleTab } from './BattleTab.tsx';
import { LobbyTab } from './LobbyTab';
import { BattlePokemon } from '../types.ts';
import { getSpriteSettings, setSpriteSettings, SpriteSet, loadTeams, saveTeams, createTeam, cloneForTeam } from '../data/adapter.ts';
import { ImportExport } from './ImportExport';
import { CustomDexBuilder } from './CustomDexBuilder';
import { CustomsFileImporter } from './CustomsFileImporter';
import { SimpleBattleTab } from './SimpleBattleTab';
import { CharacterSheet } from './CharacterSheet';
import { BadgeCase } from './BadgeCase';

type Tab = 'pc' | 'team' | 'battle' | 'lobby' | 'sheet' | 'badges' | { kind: 'psbattle'; id: string; title: string };

export function App() {
  const [tab, setTab] = useState<Tab>('pc');
  const [extraTabs, setExtraTabs] = useState<Array<{ kind: 'psbattle'; id: string; title: string }>>([]);
  const [mountedBattles, setMountedBattles] = useState<Record<string, { id: string; title: string }>>({});

  useEffect(() => {
    try {
      const s: WebSocket | null = (window as any).__pokettrpgWS || null;
      if (s && s.readyState === 1) {
        s.send(JSON.stringify({ t: 'state-request' }));
        try { window.dispatchEvent(new CustomEvent('lan:state-request')); } catch {}
      }
    } catch {}
    const w: any = window as any;
    if (!w.lan || !w.lan.on) return;
    const off = w.lan.on('room-start', (d: any) => {
      const id = d?.roomId || ('r_' + Math.random().toString(36).slice(2, 8));
      const title = d?.name || 'Battle';
      setExtraTabs(prev => (prev.find(t => t.id === id) ? prev : [...prev, { kind: 'psbattle', id, title }]));
      setMountedBattles(prev => ({ ...prev, [id]: { id, title } }));
      setTab({ kind: 'psbattle', id, title });
    });
    const onWsRoomStart = (ev: any) => {
      try {
        const d = (ev && ev.detail) || ev; if (!d) return;
        const id = d?.roomId || ('r_' + Math.random().toString(36).slice(2, 8));
        const title = d?.name || 'Battle';
        setExtraTabs(prev => (prev.find(t => t.id === id) ? prev : [...prev, { kind: 'psbattle', id, title }]));
        setMountedBattles(prev => ({ ...prev, [id]: { id, title } }));
        setTab({ kind: 'psbattle', id, title });
      } catch {}
    };
    window.addEventListener('pokettrpg-room-start', onWsRoomStart as any);
    return () => { off && off(); window.removeEventListener('pokettrpg-room-start', onWsRoomStart as any); };
  }, []);

  useEffect(() => {
    try {
      const s: WebSocket | null = (window as any).__pokettrpgWS || null;
      if (!s || s.readyState !== 1) return;
      if (tab === 'lobby' || (typeof tab === 'object' && (tab as any).kind === 'psbattle')) {
        s.send(JSON.stringify({ t: 'state-request' }));
        try { window.dispatchEvent(new CustomEvent('lan:state-request')); } catch {}
      }
    } catch {}
  }, [tab]);

  useEffect(() => {
    function onFocus() {
      try {
        const s: WebSocket | null = (window as any).__pokettrpgWS || null;
        if (s && s.readyState === 1) {
          s.send(JSON.stringify({ t: 'state-request' }));
          try { window.dispatchEvent(new CustomEvent('lan:state-request')); } catch {}
        }
      } catch {}
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

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

  function addToTeam(p: BattlePokemon, teamId?: string) {
    let targetId = teamId || teams.activeId || teams.teams[0]?.id || null;
    let newTeams = [...teams.teams];
    if (!targetId) {
      const t = createTeam(`Team ${newTeams.length + 1}`);
      newTeams.push(t);
      targetId = t.id;
    }
    newTeams = newTeams.map(t => (t.id === targetId ? { ...t, members: t.members.length >= 6 ? t.members : [...t.members, cloneForTeam(p)] } : t));
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

  useEffect(() => { saveTeams(teams.teams, teams.activeId); }, [teams]);
  useEffect(() => { try { localStorage.setItem('ttrpg.boxes', JSON.stringify(boxes)); } catch {} }, [boxes]);
  useEffect(() => { try { localStorage.setItem('ttrpg.boxIndex', String(boxIndex)); } catch {} }, [boxIndex]);

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
  <div className="brand">&gt; POKÉMON TTRPG v1.2.5</div>
        <nav className="tabs">
          <button className={tab === 'pc' ? 'active' : ''} onClick={() => setTab('pc')}>PC</button>
          <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Team</button>
          <button className={tab === 'battle' ? 'active' : ''} onClick={() => setTab('battle')}>Battle</button>
          <button className={tab === 'lobby' ? 'active' : ''} onClick={() => setTab('lobby')}>Lobby</button>
          <button className={tab === 'sheet' ? 'active' : ''} onClick={() => setTab('sheet')}>Character</button>
          <button className={tab === 'badges' ? 'active' : ''} onClick={() => setTab('badges')}>Badges</button>
          {extraTabs.map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button className={(typeof tab === 'object' && (tab as any).id === t.id) ? 'active' : ''} onClick={() => setTab(t)}>{t.title}</button>
              <button className="mini" onClick={() => {
                setExtraTabs(prev => prev.filter(x => x.id !== t.id));
                setMountedBattles(prev => { const n = { ...prev }; delete n[t.id]; return n; });
                if (typeof tab === 'object' && (tab as any).id === t.id) setTab('lobby');
              }}>×</button>
            </span>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="dim" htmlFor="spriteSet">Sprites:</label>
          <select id="spriteSet" defaultValue={getSpriteSettings().set} onChange={(e) => setSpriteSettings({ set: e.target.value as SpriteSet })}>
            <option value="gen5">Gen 5</option>
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
            <ImportExport
              onImport={(t) => addAcrossBoxes(t)}
              exportList={currentBox().filter((x): x is BattlePokemon => !!x)}
              exportLabel="Export Current Box"
            />
            <section className="panel" style={{ display: 'grid', gap: 8 }}>
              <h3>Bulk Actions</h3>
              {!pcMulti.enabled ? (
                <button className="danger" onClick={() => setPcMulti({ enabled: true, indices: [] })}>&gt; Multi Delete…</button>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="dim">{pcMulti.indices.length} selected</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="danger" disabled={pcMulti.indices.length === 0} onClick={confirmPcMultiDelete}>
                      Yes, delete
                    </button>
                    <button className="secondary" onClick={() => setPcMulti({ enabled: false, indices: [] })}>Cancel</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="secondary" onClick={selectAllInPcBox}>Select All</button>
                    <button className="secondary" onClick={invertSelectionInPcBox}>Invert Selection</button>
                    <button className="secondary" onClick={() => setPcMulti(prev => ({ ...prev, indices: [] }))}>Clear</button>
                  </div>
                  <div className="dim" style={{ fontSize: '0.9em' }}>Click Pokémon in the PC box to toggle selection.</div>
                </div>
              )}
            </section>
            <CustomDexBuilder onAddToPC={(mons) => addAcrossBoxes(mons)} />
            <CustomsFileImporter />
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
              {teams.teams.map(t => (
                <li key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gridTemplateRows: 'auto auto', gap: 8, alignItems: 'center' }}>
                  <div style={{ gridColumn: '1 / 2', gridRow: '1' }}>
                    <strong>{t.name}</strong> {teams.activeId === t.id && <span className="dim">(active)</span>}
                    <div className="dim" style={{ fontSize: '0.9em' }}>{t.members.length} / 6</div>
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
              ))}
            </ul>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
              <input id="newTeamName" placeholder={`Team ${teams.teams.length + 1}`} />
              <button onClick={() => {
                const el = document.getElementById('newTeamName') as HTMLInputElement | null;
                const nameRaw = (el?.value || '').trim() || `Team ${teams.teams.length + 1}`;
                const t = createTeam(nameRaw);
                const newTeams = [...teams.teams, t];
                setTeams({ teams: newTeams, activeId: t.id }); saveTeams(newTeams, t.id);
                if (el) el.value = '';
              }}>+ Create</button>
            </div>
          </section>
          <ImportExport onImport={(t) => { const active = activeTeam; if (!active) return; const newTeams = teams.teams.map(x => x.id === active.id ? { ...x, members: t.slice(0, 6) } : x); setTeams({ teams: newTeams, activeId: active.id }); saveTeams(newTeams, active.id); }} maxCount={6} exportList={team} exportLabel="Export Team" />
        </div>
      )}

      {tab === 'battle' && (<BattleTab friendly={team[0] ?? null} enemy={selected} team={team} onReplaceTeam={replaceTeamAt} />)}
      {tab === 'lobby' && (<LobbyTab />)}
      {tab === "sheet" && (<CharacterSheet />)}
      {tab === 'badges' && (<BadgeCase />)}

      {Object.values(mountedBattles).map(b => (
        <div key={b.id} style={{ display: (typeof tab === 'object' && (tab as any).id === b.id) ? 'block' : 'none' }}>
          <SimpleBattleTab id={b.id} title={b.title} />
        </div>
      ))}
    </div>
  );
}
