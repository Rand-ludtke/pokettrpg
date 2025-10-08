import React, { useEffect, useMemo, useState } from 'react';
import { BoxGrid } from './BoxGrid.tsx';
import { SidePanel } from './SidePanel.tsx';
import { TeamView } from './TeamView.tsx';
import { BattleTab } from './BattleTab.tsx';
import { LobbyTab } from './LobbyTab';
import { BattlePokemon, Pokemon } from '../types.ts';
import { getSpriteSettings, setSpriteSettings, SpriteSet, loadTeams, saveTeams, createTeam, cloneForTeam } from '../data/adapter.ts';
import { ImportExport } from './ImportExport';
import { CustomDexBuilder } from './CustomDexBuilder';
import { CustomsImportExport } from './CustomsImportExport';
import { CustomsFileImporter } from './CustomsFileImporter';
import { ShowdownBattleTab } from './ShowdownBattleTab';
import { SimpleBattleTab } from './SimpleBattleTab';
import { CharacterSheet } from './CharacterSheet';

type Tab = 'pc' | 'team' | 'battle' | 'lobby' | 'sheet' | 'help' | { kind:'psbattle'; id:string; title:string };

export function App() {
  const [tab, setTab] = useState<Tab>('pc');
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState<boolean>(false);
  const [extraTabs, setExtraTabs] = useState<Array<{ kind:'psbattle'; id:string; title:string }>>([]);
  // Keep battle iframes mounted even when not active to avoid tearing down connections
  const [mountedBattles, setMountedBattles] = useState<Record<string,{id:string; title:string}>>({});
  useEffect(()=>{
    // Non-host hydration: if a WS exists on load, request state
    try {
      const s: WebSocket | null = (window as any).__pokettrpgWS || null;
      if (s && s.readyState === 1) {
        s.send(JSON.stringify({ t:'state-request' }));
        try { window.dispatchEvent(new CustomEvent('lan:state-request')); } catch {}
      }
    } catch {}
    // Listen for room-start to create a temporary PS battle tab
    const w: any = window as any;
    if (!w.lan || !w.lan.on) return;
    const off = w.lan.on('room-start', (d:any) => {
      const id = d?.roomId || ('r_'+Math.random().toString(36).slice(2,8));
      const title = d?.name || 'Battle';
      setExtraTabs(prev => (prev.find(t=>t.id===id) ? prev : [...prev, { kind:'psbattle', id, title }]));
      setMountedBattles(prev => ({ ...prev, [id]: { id, title } }));
      setTab({ kind:'psbattle', id, title });
    });
    // Also listen for room-start events coming from WebSocket clients (non-host):
    const onWsRoomStart = (ev: any) => {
      try {
        const d = ev && ev.detail || ev;
        if (!d) return;
        const id = d?.roomId || ('r_'+Math.random().toString(36).slice(2,8));
        const title = d?.name || 'Battle';
        setExtraTabs(prev => (prev.find(t=>t.id===id) ? prev : [...prev, { kind:'psbattle', id, title }]));
        setMountedBattles(prev => ({ ...prev, [id]: { id, title } }));
        setTab({ kind:'psbattle', id, title });
      } catch {}
    };
    window.addEventListener('pokettrpg-room-start', onWsRoomStart as any);
    return () => { off && off(); window.removeEventListener('pokettrpg-room-start', onWsRoomStart as any); };
  }, []);

  // Listen for updater events on Windows to surface install option (v1.0.5 behavior)
  useEffect(() => {
    const w: any = window as any;
    if (!w.updates || !w.updates.on) return;
    const offAvail = w.updates.on('available', (_info: any) => {
      setUpdateStatus('update found');
      setTimeout(()=> setUpdateStatus(null), 3000);
    });
    const offDl = w.updates.on('downloaded', (_info: any) => {
      setUpdateDownloaded(true);
      setUpdateStatus('ready to install');
    });
    const offErr = w.updates.on('error', (_err: any) => {
      setUpdateStatus('update error');
      setTimeout(()=> setUpdateStatus(null), 4000);
    });
    return () => { offAvail && offAvail(); offDl && offDl(); offErr && offErr(); };
  }, []);

  // Rehydrate on tab activation (non-host): whenever tab changes to lobby or a battle tab
  useEffect(() => {
    try {
      const s: WebSocket | null = (window as any).__pokettrpgWS || null;
      if (!s || s.readyState !== 1) return;
      if (tab === 'lobby' || (typeof tab === 'object' && (tab as any).kind === 'psbattle')) {
        s.send(JSON.stringify({ t:'state-request' }));
        try { window.dispatchEvent(new CustomEvent('lan:state-request')); } catch {}
      }
    } catch {}
  }, [tab]);

  // Also rehydrate when app regains focus
  useEffect(() => {
    function onFocus(){ try { const s: WebSocket | null = (window as any).__pokettrpgWS || null; if (s && s.readyState === 1) { s.send(JSON.stringify({ t:'state-request' })); try { window.dispatchEvent(new CustomEvent('lan:state-request')); } catch {} } } catch {} }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const [selected, setSelected] = useState<BattlePokemon | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Boxes: array of boxes, each 30 slots; seed up to 64 boxes by default
  const BOX_SIZE = 30;
  const MAX_BOXES = 64;
  const [boxes, setBoxes] = useState<Array<Array<BattlePokemon | null>>>(() => {
    try {
      const raw = localStorage.getItem('ttrpg.boxes');
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Array<BattlePokemon | null>>;
        // Sanitize to ensure exactly MAX_BOXES boxes and BOX_SIZE slots each
        const out: Array<Array<BattlePokemon | null>> = Array.from({ length: MAX_BOXES }, (_, i) => {
          const src = parsed[i] || [];
          const row: Array<BattlePokemon | null> = Array.from({ length: BOX_SIZE }, (_, j) => src[j] ?? null);
          return row;
        });
        return out;
      }
    } catch {}
    // Default to MAX_BOXES empty boxes
    return Array.from({ length: MAX_BOXES }, () => Array.from({ length: BOX_SIZE }, () => null));
  });
  const [boxIndex, setBoxIndex] = useState<number>(() => {
    const raw = localStorage.getItem('ttrpg.boxIndex');
    return raw ? Number(raw) : 0;
  });
  const [teams, setTeams] = useState(() => loadTeams());
  const activeTeam = useMemo(() => teams.teams.find(t => t.id === teams.activeId) || teams.teams[0] || null, [teams]);
  const team = activeTeam?.members || [];

  // Show a one-time banner after importing customs
  const [showReloadBanner, setShowReloadBanner] = useState<boolean>(() => {
    try { return localStorage.getItem('ttrpg.customsReloadPending') === '1'; } catch { return false; }
  });
  function doReload() {
    try { localStorage.removeItem('ttrpg.customsReloadPending'); } catch {}
    location.reload();
  }

  // no-op: box is now stateful

  function addToTeam(p: BattlePokemon, teamId?: string) {
    let targetId = teamId || teams.activeId || teams.teams[0]?.id || null;
    let newTeams = [...teams.teams];
    if (!targetId) {
      const t = createTeam(`Team ${newTeams.length+1}`);
      newTeams.push(t);
      targetId = t.id;
    }
    newTeams = newTeams.map(t => (t.id === targetId ? { ...t, members: t.members.length>=6 ? t.members : [...t.members, cloneForTeam(p)] } : t));
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
    const newTeams = teams.teams.map(t => (t.id === active.id ? { ...t, members: t.members.map((m,i)=> i===index ? p : m) } : t));
    setTeams({ teams: newTeams, activeId: active.id });
    saveTeams(newTeams, active.id);
  }

  useEffect(() => {
    saveTeams(teams.teams, teams.activeId);
  }, [teams]);
  useEffect(() => {
    try { localStorage.setItem('ttrpg.boxes', JSON.stringify(boxes)); } catch {}
  }, [boxes]);
  useEffect(() => {
    try { localStorage.setItem('ttrpg.boxIndex', String(boxIndex)); } catch {}
  }, [boxIndex]);

  function currentBox(): Array<BattlePokemon | null> { return boxes[boxIndex] ?? []; }
  function setCurrentBox(next: Array<BattlePokemon | null>) {
    // sanitize incoming row to BOX_SIZE
    const row = Array.from({ length: BOX_SIZE }, (_, j) => next[j] ?? null);
    setBoxes(prev => prev.map((b, i) => (i === boxIndex ? row : b)));
  }

  function prevBox() { setBoxIndex(i => Math.max(0, i - 1)); }
  function nextBox() { setBoxIndex(i => Math.min(boxes.length - 1, i + 1)); }

  // Insert Pokémon into the first available slots across boxes, creating boxes as needed
  function addAcrossBoxes(newMons: BattlePokemon[]) {
    setBoxes(prev => {
      const out = prev.map(b => b.slice());
      let queue = newMons.slice();
      let boxPtr = 0;
      while (queue.length) {
        if (!out[boxPtr]) out[boxPtr] = Array.from({ length: BOX_SIZE }, () => null);
        const box = out[boxPtr];
        for (let s = 0; s < BOX_SIZE && queue.length; s++) {
          if (!box[s]) {
            box[s] = queue.shift()!;
          }
        }
        if (queue.length) boxPtr++;
        if (boxPtr >= out.length && queue.length && out.length < MAX_BOXES) {
          out.push(Array.from({ length: BOX_SIZE }, () => null));
        }
        // safety to avoid runaway loops
        if (boxPtr > 200) break;
      }
      return out;
    });
  }

  // Selection helper
  function handleSelect(p: BattlePokemon | null, index: number) {
    setSelected(p);
    setSelectedIndex(index);
  }

  function changeSelectedAbility(nextAbility: string) {
    if (selected == null || selectedIndex == null) return;
    // update in boxes
    setBoxes(prev => prev.map((box, i) => {
      if (i !== boxIndex) return box;
      const nb = box.slice();
      const cur = nb[selectedIndex];
      if (cur) nb[selectedIndex] = { ...cur, ability: nextAbility };
      return nb;
    }));
    // update across teams by nickname
    setTeams(prev => {
      const updated = prev.teams.map(t => ({ ...t, members: t.members.map(m => (m.name === selected.name ? { ...m, ability: nextAbility } : m)) }));
      const state = { teams: updated, activeId: prev.activeId };
      saveTeams(updated, prev.activeId);
      return state;
    });
    // update local selected snapshot
  setSelected((prev: BattlePokemon | null) => (prev ? { ...prev, ability: nextAbility } : prev));
  }

  return (
    <div className="app">
      {showReloadBanner && (
        <div style={{background:'#174', color:'#dff', padding:'8px 12px', borderBottom:'1px solid #0b2', display:'flex', gap:12, alignItems:'center'}}>
          <strong>Customs imported.</strong>
          <span className="dim">Reload to load new species and learnsets.</span>
          <button onClick={doReload}>&gt; Reload now</button>
          <button onClick={()=>{ setShowReloadBanner(false); try{ localStorage.removeItem('ttrpg.customsReloadPending'); }catch{} }} style={{marginLeft:'auto'}}>Dismiss</button>
        </div>
      )}
      <header className="topbar">
  <div className="brand">&gt; POKÉMON TTRPG v1.0</div>
        <nav className="tabs">
          <button className={tab==='pc'? 'active':''} onClick={() => setTab('pc')}>PC</button>
          <button className={tab==='team'? 'active':''} onClick={() => setTab('team')}>Team</button>
          <button className={tab==='battle'? 'active':''} onClick={() => setTab('battle')}>Battle</button>
          <button className={tab==='lobby'? 'active':''} onClick={() => setTab('lobby')}>Lobby</button>
          <button className={tab==='sheet'? 'active':''} onClick={() => setTab('sheet')}>Character</button>
          <button className={tab==='help'? 'active':''} onClick={() => setTab('help')}>Help</button>
          {extraTabs.map(t => (
            <span key={t.id} style={{display:'inline-flex', alignItems:'center'}}>
              <button className={(typeof tab==='object' && (tab as any).id===t.id)? 'active':''} onClick={() => setTab(t)}>{t.title}</button>
              <button className="mini" onClick={()=>{
                setExtraTabs(prev => prev.filter(x => x.id !== t.id));
                setMountedBattles(prev => { const n = { ...prev }; delete n[t.id]; return n; });
                if (typeof tab==='object' && (tab as any).id===t.id) setTab('lobby');
              }}>×</button>
            </span>
          ))}
        </nav>
        <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:6}}>
          {/* Windows-only manual updater button (v1.0.5 behavior) */}
          {typeof (window as any).env !== 'undefined' && (window as any).env.platform === 'win32' && (
            <>
              <button
                title="Check for updates"
                onClick={async ()=>{
                  try {
                    setUpdateStatus('checking…');
                    const r = await (window as any).updates?.check?.();
                    if (r && r.ok) {
                      setUpdateStatus('up to date');
                    } else {
                      setUpdateStatus('no updates');
                    }
                  } catch (e) {
                    setUpdateStatus('error');
                  } finally {
                    setTimeout(()=> setUpdateStatus(null), 3000);
                  }
                }}
              >Check Updates</button>
              {updateDownloaded && (
                <button
                  title="Install downloaded update and restart"
                  onClick={async ()=>{
                    try { await (window as any).updates?.install?.(); } catch {}
                  }}
                >Install and Restart</button>
              )}
              {updateStatus && <span className="dim" style={{marginLeft:6}}>{updateStatus}</span>}
            </>
          )}
          <label className="dim" htmlFor="spriteSet">Sprites:</label>
          <select id="spriteSet" defaultValue={getSpriteSettings().set} onChange={(e)=> setSpriteSettings({ set: e.target.value as SpriteSet })}>
            <option value="gen5">Gen 5</option>
            <option value="home">HOME</option>
          </select>
        </div>
      </header>

      {tab === 'pc' && (
        <div className="pc-layout">
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <BoxGrid
              pokes={currentBox()}
              onSelect={handleSelect}
              boxIndex={boxIndex}
              boxCount={boxes.length}
              onPrevBox={prevBox}
              onNextBox={nextBox}
            />
            <ImportExport
              onImport={(t) => addAcrossBoxes(t)}
              exportList={currentBox().filter((x): x is BattlePokemon => !!x)}
              exportLabel="Export Current Box"
            />
            <CustomDexBuilder onAddToPC={(mons)=> addAcrossBoxes(mons)} />
            <CustomsImportExport />
            <CustomsFileImporter />
          </div>
          <SidePanel
            selected={selected}
            onAdd={addToTeam}
            onChangeAbility={changeSelectedAbility}
            onAddToSlot={(p)=>{
              // If we expose empty-slot panel later, we will need to know the selectedIndex even when null/empty
              if (selectedIndex == null) return;
              setBoxes(prev => prev.map((box,i)=>{
                if (i!==boxIndex) return box;
                const nb = box.slice();
                nb[selectedIndex] = p;
                return nb;
              }));
              setSelected(p);
            }}
            onReplaceSelected={(p)=>{
              if (selectedIndex == null) return;
              setBoxes(prev => prev.map((box,i)=>{
                if (i!==boxIndex) return box;
                const nb = box.slice();
                nb[selectedIndex] = p;
                return nb;
              }));
              setSelected(p);
              // sync all teams entry by nickname
              setTeams(prev => {
                const beforeName = selected?.name ?? '';
                const updated = prev.teams.map(t => ({ ...t, members: t.members.map(m => (m.name === beforeName ? { ...p } as BattlePokemon : m)) }));
                const state = { teams: updated, activeId: prev.activeId };
                saveTeams(updated, prev.activeId); return state;
              });
            }}
            onDeleteSelected={() => {
              if (selectedIndex == null) return;
              setBoxes(prev => prev.map((box,i)=>{
                if (i!==boxIndex) return box;
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
        <div className="team-layout" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <TeamView team={team} onRemove={removeFromTeam} onMove={(from,to)=>{
            const active = activeTeam; if (!active || from===to) return;
            const arr = active.members.slice();
            const [m] = arr.splice(from,1);
            arr.splice(to,0,m);
            const newTeams = teams.teams.map(t => t.id===active.id ? { ...t, members: arr } : t);
            setTeams({ teams: newTeams, activeId: active.id }); saveTeams(newTeams, active.id);
          }} />
          <section className="panel">
            <h2>Teams</h2>
            {teams.teams.length === 0 && <div className="dim">No teams yet.</div>}
            <ul style={{listStyle:'none', padding:0, margin:0, display:'grid', gap:6}}>
              {teams.teams.map(t => (
                <li
                  key={t.id}
                  style={{
                    display:'grid',
                    gridTemplateColumns:'1fr auto auto auto auto',
                    gridTemplateRows:'auto auto',
                    gap:8,
                    alignItems:'center'
                  }}
                >
                  {/* Row 1: name/count on left; small action buttons on right */}
                  <div style={{gridColumn:'1 / 2', gridRow:'1'}}>
                    <strong>{t.name}</strong> {teams.activeId === t.id && <span className="dim">(active)</span>}
                    <div className="dim" style={{fontSize:'0.9em'}}>{t.members.length} / 6</div>
                  </div>
                  <button className="mini" style={{gridColumn:'2', gridRow:'1'}} onClick={()=>{
                    const nn = prompt('Rename team', t.name);
                    if (nn==null) return; const name = nn.trim(); if (!name) return;
                    const newTeams = teams.teams.map(x => x.id===t.id ? { ...x, name } : x);
                    setTeams({ teams: newTeams, activeId: teams.activeId }); saveTeams(newTeams, teams.activeId);
                  }}>Rename</button>
                  <button className="mini" style={{gridColumn:'3', gridRow:'1'}} onClick={()=>{
                    const copy = { ...t, id: createTeam(`${t.name} (copy)`).id, name: `${t.name} (copy)` };
                    const newTeams = [...teams.teams, copy];
                    setTeams({ teams: newTeams, activeId: teams.activeId }); saveTeams(newTeams, teams.activeId);
                  }}>Duplicate</button>
                  <button className="mini" style={{gridColumn:'4', gridRow:'1'}} onClick={()=>{
                    const copy = { ...t, id: createTeam(`${t.name} (copy)`).id, name: `${t.name} (copy)` };
                    const newTeams = [...teams.teams, copy];
                    setTeams({ teams: newTeams, activeId: copy.id }); saveTeams(newTeams, copy.id);
                  }}>Duplicate as Active</button>
                  <button className="mini" style={{gridColumn:'5', gridRow:'1'}} onClick={()=>{
                    if (!confirm('Delete this team?')) return;
                    const list = teams.teams.filter(x => x.id !== t.id);
                    const newActive = teams.activeId === t.id ? (list[0]?.id || null) : teams.activeId;
                    setTeams({ teams: list, activeId: newActive }); saveTeams(list, newActive);
                  }}>Delete</button>

                  {/* Row 2: full-width Set Active bar */}
                  <button
                    onClick={()=>{
                      const nextActive = t.id;
                      // Keep teams array as-is to avoid re-render churn
                      setTeams(prev => {
                        const currentTeams = prev.teams;
                        saveTeams(currentTeams, nextActive);
                        return { teams: currentTeams, activeId: nextActive };
                      });
                    }}
                    disabled={teams.activeId===t.id}
                    style={{gridColumn:'1 / -1', gridRow:'2'}}
                  >
                    Set Active
                  </button>
                </li>
              ))}
            </ul>
            <div style={{marginTop:8, display:'grid', gridTemplateColumns:'1fr auto', gap:6, alignItems:'center'}}>
              <input id="newTeamName" placeholder={`Team ${teams.teams.length+1}`} />
              <button onClick={()=>{
                const el = document.getElementById('newTeamName') as HTMLInputElement | null;
                const nameRaw = (el?.value || '').trim() || `Team ${teams.teams.length+1}`;
                const t = createTeam(nameRaw);
                const newTeams = [...teams.teams, t];
                setTeams({ teams: newTeams, activeId: t.id }); saveTeams(newTeams, t.id);
                if (el) el.value = '';
              }}>+ Create</button>
            </div>
          </section>
          <ImportExport
            onImport={(t) => {
              const active = activeTeam; if (!active) return;
              const newTeams = teams.teams.map(x => x.id===active.id ? { ...x, members: t.slice(0,6) } : x);
              setTeams({ teams: newTeams, activeId: active.id }); saveTeams(newTeams, active.id);
            }}
            maxCount={6}
            exportList={team}
            exportLabel="Export Team"
          />
        </div>
      )}

    {tab === 'battle' && (
      <BattleTab friendly={team[0] ?? null} enemy={selected} team={team} onReplaceTeam={replaceTeamAt} />
    )}
    {tab === 'lobby' && (
      <LobbyTab />
    )}

    {tab === 'sheet' && (
      <CharacterSheet />
    )}

    {/* Keep all created battles mounted; hide those not active */}
    {Object.values(mountedBattles).map(b => (
      <div key={b.id} style={{ display: (typeof tab==='object' && (tab as any).id===b.id) ? 'block' : 'none' }}>
        <SimpleBattleTab id={b.id} title={b.title} />
      </div>
    ))}

      {tab === 'help' && (
        <section className="panel">
          <h2>Help</h2>
          <p>Arrow keys to navigate; Enter to open; Space to add to team. Retro green/black theme.</p>
        </section>
      )}
    </div>
  );
}
