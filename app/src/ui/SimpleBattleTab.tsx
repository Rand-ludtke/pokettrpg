import React, { useEffect, useMemo, useRef, useState } from 'react';
import { spriteUrlWithFallback } from '../data/adapter';

// A simple, from-scratch battler UI that uses the WS room-request data to render controls
// and shows a minimal field. It does not embed Showdown; it only reuses sprites/learnsets via host mechanics.

type Side = 'p1' | 'p2';
type Slot = 'p1a'|'p1b'|'p1c'|'p2a';

export function SimpleBattleTab({ id, title }: { id: string; title: string }) {
  const [requests, setRequests] = useState<{p1?: any; p2?: any}>({});
  const [roomPlayers, setRoomPlayers] = useState<Array<{id:string; name:string; avatar?:string}>>([]);
  const [log, setLog] = useState<string[]>([]);

  // Infer my slot based on window.lan.rooms
  function inferMySlot(defaultSide: Side): Slot | undefined {
    try {
      const rooms = (window as any).lan?.rooms;
      const r = rooms?.find?.((x:any)=> x.id===id);
      const myId = localStorage.getItem('ttrpg.clientId') || '';
      if (!r) return undefined;
      if (r.mode === 'boss' || /boss/i.test(r.format||'')) {
        const slots = r.slots || {};
        for (const k of ['p1a','p1b','p1c','p2a'] as const) {
          if (slots[k] === myId) return k;
        }
      } else {
        // Map by players array: index 0 -> p1, index 1 -> p2
        const p = Array.isArray(r.players) ? r.players : [];
        if (p[1]?.id === myId) return 'p2a';
        return 'p1a';
      }
    } catch {}
    return undefined;
  }
  function slotToIndex(slot?: Slot): number { if (!slot) return 0; if (slot==='p1b') return 1; if (slot==='p1c') return 2; return 0; }
  function slotToSide(slot?: Slot): Side { return slot && slot.startsWith('p2') ? 'p2' : 'p1'; }
  function parseHP(cond?: string): { hpPct: number; text: string } {
    if (!cond) return { hpPct: 100, text: '' };
    const parts = cond.split(' ');
    const hp = parts[0] || '';
    const status = parts[1] || '';
    let pct = 100;
    if (hp.includes('/')) {
      const [num, den] = hp.split('/').map(x => parseInt(x, 10));
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) pct = Math.max(0, Math.min(100, Math.round((num / den) * 100)));
    } else if (!isNaN(parseInt(hp,10))) {
      const n = parseInt(hp,10);
      pct = Math.max(0, Math.min(100, n));
    }
    return { hpPct: pct, text: status };
  }
  function sendChoice(side: Side, choice: string) {
    const slot = inferMySlot(side);
    const payload = { roomId: id, slot, choice };
    (window as any).lan?.send?.('room-choose', payload);
  }

  // Subscribe to room events
  useEffect(() => {
    const offRooms = (window as any).lan?.on?.('rooms', (list:any[]) => {
      if (!Array.isArray(list)) return; const r = list.find((r:any) => r.id === id); if (r && Array.isArray(r.players)) setRoomPlayers(r.players);
    });
    const offReq = (window as any).lan?.on?.('room-request', (d:any) => { if (!d || d.roomId !== id) return; setRequests(prev => ({ ...prev, [d.side]: d.request })); });
    const offLog = (window as any).lan?.on?.('room-log', (d:any) => { if (!d || d.roomId !== id) return; const text = String(d.chunk); setLog(prev => [...prev, text]); });
    const offEnd = (window as any).lan?.on?.('room-end', (d:any) => { if (!d || d.roomId !== id) return; setLog(prev => [...prev, String(d.result)]); });
    const offDbg = (window as any).lan?.on?.('room-debug', (d:any) => { if (!d || d.roomId !== id) return; setLog(prev => [...prev, `[dbg:${d.where}] ${d.msg}`]); });
    // Initial buffer sync: try IPC first; if empty, request over WS
    (async () => {
      try {
        const buf = await (window as any).lan?.room?.buffer?.(id);
        let lines: string[] = Array.isArray(buf?.lines) ? buf.lines : [];
        if (!lines.length) {
          try { (window as any).__pokettrpgWS?.send(JSON.stringify({ t:'room-buffer-request', d:{ roomId: id } })); } catch {}
        }
        if (lines.length) setLog(prev => [...prev, ...lines.map(String)]);
      } catch {}
    })();
    const offBuf = (window as any).lan?.on?.('room-buffer', (d:any) => {
      if (!d || d.roomId !== id) return; const arr = Array.isArray(d.lines)? d.lines: []; if (arr.length) setLog(prev => [...prev, ...arr.map(String)]);
    });
    return () => { offRooms && offRooms(); offReq && offReq(); offLog && offLog(); offEnd && offEnd(); offDbg && offDbg(); };
  }, [id]);

  // Resync on focus/visibility to avoid perceived disconnects
  useEffect(() => {
    async function resync() {
      try {
        const buf = await (window as any).lan?.room?.buffer?.(id);
        const lines: string[] = Array.isArray(buf?.lines) ? buf.lines : [];
        if (lines.length) setLog(lines.map(String));
      } catch {}
    }
    function onVis() { if (document.visibilityState === 'visible') resync(); }
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', resync); document.removeEventListener('visibilitychange', onVis); };
  }, [id]);

  function activeFor(side: Side): any[] {
    const req = requests[side];
    const list: any[] = (req && req.side && Array.isArray(req.side.pokemon)) ? req.side.pokemon : [];
    // Return up to three active mons for triples; otherwise first active or first
    const actives = list.filter(p => p.active);
    if (actives.length) return actives.slice(0,3);
    return list.slice(0, side==='p1' ? 3 : 1);
  }
  const p1Actives = activeFor('p1');
  const p2Actives = activeFor('p2');

  // Very basic species parser: take the first token before comma, strip forms parentheses
  function inferSpeciesName(pkm: any): string {
    const raw = String(pkm?.details || '').split(',')[0].trim() || '';
    if (!raw) return '';
    return raw.replace(/\s*\(.*\)\s*/g, '').trim();
  }
  function buildSpriteChain(side: Side, pkm: any) {
    const species = inferSpeciesName(pkm);
    const back = side === 'p1';
    const shiny = !!pkm?.shiny;
    const data = spriteUrlWithFallback(species || '', () => {}, { back, shiny });
    const initial = data.src;
    const candidates = (data as any).candidates as string[];
    const placeholder = (data as any).placeholder as string;
    return { initial, candidates, placeholder };
  }

  function renderHP(pkm: any, side: Side, label?: string) {
    const { hpPct, text } = parseHP(pkm?.condition || '');
    const chain = buildSpriteChain(side, pkm);
    const fainted = hpPct <= 0 || (pkm?.condition || '').startsWith('0/');
    const imgCommon = {
      style: { height: 64, imageRendering: 'pixelated' as const, opacity: 0, transition: 'opacity .25s ease' },
      onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.opacity = '1'; },
      onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
        const el = e.currentTarget as HTMLImageElement;
        const n = Number(el.dataset.fbIdx || '0') + 1;
        el.dataset.fbIdx = String(n);
        el.src = chain.candidates[n] || chain.placeholder;
      }
    };
    return (
      <div className={`field-row ${side}${fainted ? ' fainted' : ''}` } style={{width:200}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
          {side==='p1' && <img alt="p1" src={chain.initial} data-fb-idx="0" {...imgCommon} />}
          <div style={{flex:1}}>
            <div style={{fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {label ? <span className="dim" style={{marginRight:6}}>{label}</span> : null}
              {pkm?.details?.split(',')[0] || 'Pokemon'}
            </div>
            <div style={{height:8, background:'#333', borderRadius:4, overflow:'hidden'}}>
              <div className="hp-fill" style={{height:'100%', width:`${hpPct}%`, background: hpPct>50?'#4caf50':hpPct>20?'#ff9800':'#f44336', transition:'width .3s ease-out'}} />
            </div>
            {text && <div className="dim" style={{fontSize:12, marginTop:2}}>{text}</div>}
          </div>
          {side==='p2' && <img alt="p2" src={chain.initial} data-fb-idx="0" {...imgCommon} />}
        </div>
      </div>
    );
  }

  function renderControls() {
    const mySlot = inferMySlot('p1');
    const side = slotToSide(mySlot);
    const req = requests[side];
    if (!req) return <div className="dim">Waiting for request…</div>;
    // Team Preview
    const [previewOrder, setPreviewOrder] = useState<Record<Side, string[]>>({ p1: [], p2: [] });
    // This is a little hacky but keeps state per render; acceptable for simple UI
    // Switch request
    const idx = slotToIndex(mySlot);
    if (req.teamPreview) {
      const pokes: any[] = (req.side && req.side.pokemon) || [];
      const maxSize: number = req.maxTeamSize || pokes.length || 6;
      const current = previewOrder[side] || [];
      const submit = () => { const order = (previewOrder[side] || []).join(''); if (order.length === Math.min(maxSize, pokes.length)) sendChoice(side, `team ${order}`); };
      return (
        <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
          <div className="dim">Team Preview:</div>
          {pokes.map((pkm, i) => {
            const slot = i+1; const pickedIdx = current.indexOf(String(slot)); const picked = pickedIdx !== -1; const fainted = pkm.condition?.startsWith('0/');
            return (
              <button key={i} className="mini" disabled={picked || fainted}
                onClick={()=> setPreviewOrder(prev => ({ ...prev, [side]: [...(prev[side]||[]), String(slot)].slice(0, Math.min(maxSize, pokes.length)) }))}>
                {picked ? `${pickedIdx+1}` : slot}. {pkm.details?.split(',')[0] || 'Pokemon'}
              </button>
            );
          })}
          <button className="mini" onClick={submit} disabled={current.length !== Math.min(maxSize, pokes.length)}>Submit</button>
          <button className="mini" onClick={()=> setPreviewOrder(prev => ({ ...prev, [side]: [] }))}>Clear</button>
          <button className="mini" onClick={()=> sendChoice(side, 'default')}>Auto</button>
        </div>
      );
    }
    if (req.forceSwitch && req.forceSwitch[idx]) {
      const pokes: any[] = (req.side && req.side.pokemon) || [];
      return (
        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
          <div className="dim">Switch ({(mySlot||'').toUpperCase()}):</div>
          {pokes.map((pkm, i) => (
            <button key={i} className="mini" disabled={pkm.condition?.startsWith('0/') || pkm.active} onClick={()=> sendChoice(side, `switch ${i+1}`)}>
              {i+1}. {pkm.details?.split(',')[0] || 'Pokemon'}
            </button>
          ))}
        </div>
      );
    }
    const slots: Slot[] = side==='p2' ? ['p2a'] : ['p1a','p1b','p1c'];
    const activeList: any[] = Array.isArray(req.active) ? req.active : [];
    return (
      <div style={{display:'grid', gap:10}}>
        {slots.map((slotKey, slotIdx) => {
          const isMine = (slotKey === mySlot) || (side==='p1' && !mySlot && slotIdx===0); // fallback first
          const act = activeList[slotIdx];
          const moves: Array<{move:string; target?:string}> = (act && Array.isArray(act.moves)) ? act.moves : [];
          if (!moves.length) return null;
          return (
            <div key={slotKey} className={isMine?'' :'dim'}>
              <div className="dim" style={{marginBottom:4}}>Actions ({slotKey.toUpperCase()})</div>
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:6}}>
                {moves.map((m,i) => (
                  <button key={i} disabled={!isMine} onClick={()=> sendChoice(side, `move ${i+1}`)}>{m.move}</button>
                ))}
                <button className="secondary" disabled={!isMine} onClick={()=> sendChoice(side, 'default')}>Auto</button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Small layout: names + HP bars, then controls, then raw log for transparency
  const [flashTick, setFlashTick] = useState(0);
  useEffect(() => {
    // Add a tiny flash when damage/move occurs in the latest log line
    const last = log[log.length - 1] || '';
    if (/\|damage\||\|move\|/i.test(last)) {
      setFlashTick(t => t + 1);
      const el = document.querySelector('.panel.battle');
      if (el) {
        el.classList.add('hit-flash');
        setTimeout(() => el.classList.remove('hit-flash'), 150);
      }
    }
  }, [log.length]);
  return (
    <section className="panel battle">
      <h2>{title}</h2>
      {/* Field layout: p1 can show up to three, p2 shows one */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'stretch', marginBottom:12}}>
        <div style={{display:'grid', gap:8, justifyItems:'start'}}>
          {p1Actives.map((pkm, i) => renderHP(pkm, 'p1', ['A','B','C'][i]))}
        </div>
        <div style={{display:'grid', gap:8, justifyItems:'end'}}>
          {p2Actives.slice(0,1).map((pkm) => renderHP(pkm, 'p2'))}
        </div>
      </div>
      <div style={{marginBottom:12}}>{renderControls()}</div>
      <div className="panel" style={{maxHeight:200, overflow:'auto', fontFamily:'monospace', fontSize:12}}>
        {log.map((l, i) => <div key={i}>{l.replace(/\n/g,'')}</div>)}
      </div>
    </section>
  );
}
