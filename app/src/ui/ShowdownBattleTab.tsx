import React, { useEffect, useRef, useState } from 'react';
import { getSpriteSettings } from '../data/adapter';

export function ShowdownBattleTab({ id, title }: { id: string; title: string }) {
  const [log, setLog] = useState<string[]>([]);
  const [requests, setRequests] = useState<{p1?: any; p2?: any}>({});
  // Embed the mini-battler and feed it engine log lines
  const iframeRef = useRef<HTMLIFrameElement|null>(null);
  // Derive identity from lobby
  const [myName, setMyName] = useState<string>(() => {
    try { return localStorage.getItem('ttrpg.username') || 'Player'; } catch { return 'Player'; }
  });
  const [myAvatar, setMyAvatar] = useState<string>(() => {
    try { return localStorage.getItem('ttrpg.trainerSprite') || 'Ace Trainer'; } catch { return 'Ace Trainer'; }
  });
  // Per-side move options (target + special flags)
  const [moveOpts, setMoveOpts] = useState<Record<'p1'|'p2', { target?: string; z?: boolean; mega?: boolean; dynamax?: boolean; tera?: boolean }>>({
    p1: {},
    p2: {},
  });
  // Per-side team preview order (array of slot numbers as strings: '1'..'6')
  const [previewOrder, setPreviewOrder] = useState<Record<'p1'|'p2', string[]>>({ p1: [], p2: [] });
  function inferMySlot(side: 'p1'|'p2'): 'p1a'|'p1b'|'p1c'|'p2a'|undefined {
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
        // singles/doubles fallback
        return side === 'p2' ? 'p2a' : 'p1a';
      }
    } catch {}
    return undefined;
  }
  function sendChoice(side: 'p1'|'p2', choice: string) {
    const slot = inferMySlot(side);
    const payload = { roomId: id, slot, choice };
    (window as any).lan?.send?.('room-choose', payload);
  }
  // Track room players for overlay and iframe bridge
  const [roomPlayers, setRoomPlayers] = useState<Array<{id:string; name:string; avatar?:string}>>([]);
  // Keep room players in sync for identity hinting
  useEffect(() => {
    const offRooms = (window as any).lan?.on?.('rooms', (list:any[]) => {
      if (!Array.isArray(list)) return;
      const r = list.find((r:any) => r.id === id);
      if (r && Array.isArray(r.players)) setRoomPlayers(r.players);
    });
    return () => { offRooms && offRooms(); };
  }, [id]);
  // Target picking from mini-battler clicks
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data: any = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'mb:clickTarget') {
        let clicked = 'auto';
        if (data.side === 'p1a' || data.side === 'p1b' || data.side === 'p1c') clicked = '1';
        if (data.side === 'p2a' || data.side === 'p2b' || data.side === 'p2c') clicked = '1';
        setMoveOpts(prev => ({ p1: { ...prev.p1, target: clicked }, p2: { ...prev.p2, target: clicked } }));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // Wire mini viewer: sprites dir, boss mode, and room streams
  useEffect(() => {
    try {
      const set = getSpriteSettings().set;
  const dir = set === 'home' ? '/showdown/sprites/home' : '/showdown/sprites/gen5';
      iframeRef.current?.contentWindow?.postMessage({ type:'mb:setSpritesDir', url: dir }, '*');
    } catch {}
    try {
      const room = (window as any).lan?.rooms?.find?.((r:any)=> r.id===id);
      const isBoss = !!(room && room.mode === 'boss');
      const send = () => {
        try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:mode', mode: isBoss ? 'boss3v1' : 'singles' }, '*'); } catch {}
      };
      send();
      // Keepalive for ~3s in case iframe loads late
      const iv = setInterval(send, 500);
      setTimeout(()=> clearInterval(iv), 3000);
    } catch {}
    try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:reset' }, '*'); } catch {}
    // Fetch buffered lines from host to resync after remounts/tab switches
    (async () => {
      try {
        const buf = await (window as any).lan?.room?.buffer?.(id);
        let lines = Array.isArray(buf?.lines) ? buf.lines : [];
        if (!lines.length) {
          // Fallback: ask remote host over WS
          try { (window as any).__pokettrpgWS?.send(JSON.stringify({ t:'room-buffer-request', d:{ roomId: id } })); } catch {}
        }
        if (lines.length) {
          try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:appendLines', lines }, '*'); } catch {}
        }
      } catch {}
    })();
    // Listen once for remote buffer response
    const offBuf = (window as any).lan?.on?.('room-buffer', (d:any) => {
      try { if (!d || d.roomId !== id) return; const arr = Array.isArray(d.lines)? d.lines: []; if (arr.length) iframeRef.current?.contentWindow?.postMessage({ type:'mb:appendLines', lines: arr }, '*'); } catch {}
    });
    const off = (window as any).lan?.on?.('room-log', (d:any) => {
      if (!d || d.roomId !== id) return;
      const text = String(d.chunk);
      setLog(prev => [...prev, text]);
      const lines = text.split('\n').filter(Boolean);
      try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:appendLines', lines }, '*'); } catch {}
    });
    const offReq = (window as any).lan?.on?.('room-request', (d:any) => {
      if (!d || d.roomId !== id) return;
      setRequests(prev => ({ ...prev, [d.side]: d.request }));
    });
    const offEnd = (window as any).lan?.on?.('room-end', (d:any) => {
      if (!d || d.roomId !== id) return;
      setLog(prev => [...prev, `\n${String(d.result)}\n`]);
      try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:appendLine', line: String(d.result) }, '*'); } catch {}
    });
  return () => { off && off(); offReq && offReq(); offEnd && offEnd(); offBuf && offBuf(); };
  }, [id, title]);

  // Resync on tab visibility/focus to avoid perceived disconnects
  useEffect(() => {
    async function resync() {
      try {
        const buf = await (window as any).lan?.room?.buffer?.(id);
        const lines = Array.isArray(buf?.lines) ? buf.lines : [];
        try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:reset' }, '*'); } catch {}
        if (lines.length) {
          try { iframeRef.current?.contentWindow?.postMessage({ type:'mb:appendLines', lines }, '*'); } catch {}
        }
      } catch {}
    }
    function onVis() { if (document.visibilityState === 'visible') resync(); }
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', resync); document.removeEventListener('visibilitychange', onVis); };
  }, [id]);
  // Identity hint for viewer
  useEffect(() => {
    const iv = setInterval(() => {
      try {
        let inferred: 'p1'|'p2'|undefined = undefined;
        try {
          if (Array.isArray(roomPlayers)) {
            if (roomPlayers[0]?.name === myName) inferred = 'p1';
            else if (roomPlayers[1]?.name === myName) inferred = 'p2';
          }
        } catch {}
        const payload:any = { type:'pokettrpg-ident', name: myName, avatar: myAvatar };
        if (inferred) payload.side = inferred;
        iframeRef.current?.contentWindow?.postMessage(payload, '*');
      } catch {}
    }, 500);
    const stop = setTimeout(() => { try { clearInterval(iv); } catch {} }, 3500);
    return () => { try { clearInterval(iv); } catch {}; try { clearTimeout(stop); } catch {} };
  }, [myName, myAvatar, roomPlayers]);
  const src = '/mini-battle/index.html';
  // Utility (kept from earlier UI)
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
  function activeFor(side: 'p1'|'p2') {
    const req = requests[side];
    const list: any[] = (req && req.side && Array.isArray(req.side.pokemon)) ? req.side.pokemon : [];
    const active = list.find(p => p.active) || list[0] || null;
    return active;
  }
  const p1Active = activeFor('p1');
  const p2Active = activeFor('p2');
  function slotToIndex(slot?: 'p1a'|'p1b'|'p1c'|'p2a'): number { if (!slot) return 0; if (slot==='p1b') return 1; if (slot==='p1c') return 2; return 0; }
  function slotToSide(slot?: 'p1a'|'p1b'|'p1c'|'p2a'): 'p1'|'p2' { return slot && slot.startsWith('p2') ? 'p2' : 'p1'; }
  function renderControlsForMySlot() {
    const mySlot = inferMySlot('p1');
    const side = slotToSide(mySlot);
    const req = requests[side];
    if (!req) return <div className="dim">Waiting…</div>;
    // Team Preview stays side-wide
    if (req.teamPreview) {
      const pokes: any[] = (req.side && req.side.pokemon) || [];
      const maxSize: number = req.maxTeamSize || pokes.length || 6;
      const current = previewOrder[side];
      const submitOrder = () => {
        const order = (previewOrder[side] || []).join('');
        if (order.length === Math.min(maxSize, pokes.length)) sendChoice(side, `team ${order}`);
      };
      return (
        <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
          <div className="dim">Team Preview:</div>
          {pokes.map((pkm, i) => {
            const slot = i+1;
            const pickedIdx = current.indexOf(String(slot));
            const picked = pickedIdx !== -1;
            const fainted = pkm.condition?.startsWith('0/');
            return (
              <button key={i} className="mini" disabled={picked || fainted} onClick={()=> setPreviewOrder(prev => ({ ...prev, [side]: [...(prev[side]||[]), String(slot)].slice(0, Math.min(maxSize, pokes.length)) }))}>
                {picked ? `${pickedIdx+1}` : slot}. {pkm.details?.split(',')[0] || 'Pokemon'}
              </button>
            );
          })}
          <button className="mini" onClick={submitOrder} disabled={current.length !== Math.min(maxSize, pokes.length)}>Submit</button>
          <button className="mini" onClick={()=> setPreviewOrder(prev => ({ ...prev, [side]: [] }))}>Clear</button>
          <button className="mini" onClick={()=> sendChoice(side, 'default')}>Auto</button>
        </div>
      );
    }
    const idx = slotToIndex(mySlot);
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
    const act = req.active && req.active[idx];
    if (act && Array.isArray(act.moves)) {
      const canZ = Array.isArray((act as any).canZMove) ? (act as any).canZMove : null;
      const canMega = !!(act as any).canMegaEvo;
      const canDmax = !!(act as any).canDynamax;
      const canTera = !!(act as any).canTerastallize;
      const opts = moveOpts[side] || {};
      const setOpts = (patch: Partial<typeof opts>) => setMoveOpts(prev => ({ ...prev, [side]: { ...prev[side], ...patch } }));
      const sendMove = (moveIndex: number) => {
        let choice = `move ${moveIndex+1}`;
        if (opts.target && opts.target !== 'auto') choice += ` ${opts.target}`;
        if (opts.mega && canMega) choice += ' mega';
        if (opts.z && canZ && canZ[moveIndex]) choice += ' zmove';
        if (opts.dynamax && canDmax) choice += ' dynamax';
        if (opts.tera && canTera) choice += ' terastallize';
        sendChoice(side, choice);
      };
      return (
        <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
          <div className="dim">Moves {(mySlot||'').toUpperCase()}:</div>
          <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
            {act.moves.map((m:any, i:number) => (
              <button key={i} className="mini" disabled={!!m.disabled} onClick={()=> sendMove(i)} title={m.target ? `Target: ${m.target}` : undefined}>
                {i+1}. {m.move}{m.disabled ? ' (disabled)' : ''}
              </button>
            ))}
            <button className="mini" onClick={()=> sendChoice(side, 'default')}>Auto</button>
          </div>
          <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
            {canMega ? (
              <label style={{display:'flex', alignItems:'center', gap:4}}>
                <input type="checkbox" checked={!!opts.mega} onChange={(e)=> setOpts({ mega: e.currentTarget.checked })} /> Mega
              </label>
            ) : null}
            {canZ ? (
              <label style={{display:'flex', alignItems:'center', gap:4}}>
                <input type="checkbox" checked={!!opts.z} onChange={(e)=> setOpts({ z: e.currentTarget.checked })} /> Z-Move
              </label>
            ) : null}
            {canDmax ? (
              <label style={{display:'flex', alignItems:'center', gap:4}}>
                <input type="checkbox" checked={!!opts.dynamax} onChange={(e)=> setOpts({ dynamax: e.currentTarget.checked })} /> Dynamax
              </label>
            ) : null}
            {canTera ? (
              <label style={{display:'flex', alignItems:'center', gap:4}}>
                <input type="checkbox" checked={!!opts.tera} onChange={(e)=> setOpts({ tera: e.currentTarget.checked })} /> Terastallize
              </label>
            ) : null}
            <div className="dim">Target:</div>
            {['auto','1','2','-1','-2'].map(t => (
              <button key={t} className="mini" onClick={() => setOpts({ target: t })} disabled={opts.target === t}>{t}</button>
            ))}
          </div>
        </div>
      );
    }
    return <div className="dim">Waiting…</div>;
  }
  return (
    <section className="panel" style={{display:'grid', gridTemplateRows:'auto 1fr auto', height:'calc(100vh - 120px)'}}>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <h2 style={{margin:0}}>Battle: {title}</h2>
        <span className="dim">Room ID: {id}</span>
      </div>
      <iframe
        ref={iframeRef}
        title={title}
        src={src}
        style={{width:'100%', height:'100%', border:'1px solid #444', borderRadius:6, background:'#000'}}
      />
      {/* Controls for my slot only (triples-aware) */}
      <div style={{padding:'8px 0', borderTop:'1px solid #333', display:'grid', gap:8}}>
        {renderControlsForMySlot()}
      </div>
    </section>
  );
}
