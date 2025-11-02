import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { CustomsImportExport } from './CustomsImportExport';
import { loadTeams, teamToShowdownText } from '../data/adapter';

export function LobbyTab() {
  const teamsState = loadTeams();
  const [hosting, setHosting] = useState<{port:number}|null>(null);
  // Keep a singleton Socket.IO connection on window to avoid duplicate connects across tab switches/remounts
  const [sock, setSock] = useState<Socket | null>(() => (window as any).__pokettrpgIO || null);
  // WebSocket server URL (persisted). Default to given IP; dev default port 3000.
  const [wsUrl, setWsUrl] = useState<string>(() => localStorage.getItem('ttrpg.lobbyWsUrl') || 'wss://pokettrpg.duckdns.org');
  const [autoJoin, setAutoJoin] = useState<boolean>(() => {
    const raw = localStorage.getItem('ttrpg.lobbyAutoJoin');
    return raw == null ? true : raw === '1';
  });
  useEffect(()=>{ try { localStorage.setItem('ttrpg.lobbyWsUrl', wsUrl); } catch {} }, [wsUrl]);
  useEffect(()=>{ try { localStorage.setItem('ttrpg.lobbyAutoJoin', autoJoin ? '1' : '0'); } catch {} }, [autoJoin]);
  const [chat, setChat] = useState<Array<{from:string; text:string; at:number}>>([]);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [trainerSprite, setTrainerSprite] = useState<string>(() => localStorage.getItem('ttrpg.trainerSprite') || 'Ace Trainer');
  const [trainerOptions, setTrainerOptions] = useState<string[]>([]);
  const [rooms, setRooms] = useState<Array<{id:string; name:string; format:string; players:Array<{id:string; name:string}>; status:'open'|'active'|'started'}>>([]);
  const [challengeFormat, setChallengeFormat] = useState<string>('Singles');
  const [challengeTeamId, setChallengeTeamId] = useState<string>('');
  const [challengeToId, setChallengeToId] = useState<string>('');
  const [acceptTeams, setAcceptTeams] = useState<Record<string,string>>({});
  const [hosts, setHosts] = useState<Array<{ip:string; port:number; name:string}>>([]);
  const [status, setStatus] = useState<string>('');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [username, setUsername] = useState<string>(()=> localStorage.getItem('ttrpg.username') || ('Trainer-'+Math.random().toString(36).slice(2,6)));
  useEffect(()=>{ try { localStorage.setItem('ttrpg.username', username); } catch {} }, [username]);
  const [roster, setRoster] = useState<Array<{id:string; name:string}>>([]);
  const [remoteChallenges, setRemoteChallenges] = useState<Array<any>>([]);
  const [joinLinks, setJoinLinks] = useState<string[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [myReady, setMyReady] = useState<boolean>(false);
  const clientIdRef = useRef<string>('');
  const lastUrlRef = useRef<string>('');
  const connectingRef = useRef<boolean>(false);
  if (!clientIdRef.current) {
    const saved = localStorage.getItem('ttrpg.clientId');
    if (saved) clientIdRef.current = saved;
    else {
      const id = 'c_'+Math.random().toString(36).slice(2,10);
      clientIdRef.current = id;
      try { localStorage.setItem('ttrpg.clientId', id); } catch {}
    }
  }

  useEffect(()=>{ try { localStorage.setItem('ttrpg.trainerSprite', trainerSprite); } catch {} }, [trainerSprite]);
  // Utility: dispatch a page-level CustomEvent so any tab can listen via lan.on(event, ...)
  function dispatchLan(event: string, detail: any) {
    try { window.dispatchEvent(new CustomEvent(`lan:${event}`, { detail })); } catch {}
  }
  function setLanRooms(list: any[]) {
    try { (window as any).lan = (window as any).lan || {}; (window as any).lan.rooms = Array.isArray(list) ? list : []; } catch {}
  }
  // Ensure WS -> CustomEvent fan-out is attached once per socket, persists across unmounts
  function attachHandlers(s: Socket) {
    const anyS: any = s as any;
    if (anyS.__handlersAttached) return;
    // Core snapshots
    s.on('state', (snap: any) => {
      const rlist = Array.isArray(snap?.rooms) ? snap.rooms : [];
      const rstr = Array.isArray(snap?.roster) ? snap.roster : [];
      const chall = Array.isArray(snap?.challenges) ? snap.challenges : [];
      const chatHist = Array.isArray(snap?.chat) ? snap.chat : [];
      setSyncing(false);
      setLanRooms(rlist); setRooms(rlist); setRoster(rstr); setRemoteChallenges(chall); setChat(chatHist);
      dispatchLan('rooms', rlist); dispatchLan('roster', rstr); dispatchLan('challenge-sync', { list: chall });
      for (const line of chatHist) dispatchLan('chat', line);
    });
    s.on('rooms', (list: any[]) => { setLanRooms(list || []); setRooms(list || []); setSyncing(false); });
    s.on('roster', (list: any[]) => setRoster(list || []));
    s.on('chat', (line: any) => pushChat(line?.from ?? 'peer', line?.text ?? ''));
    s.on('challenge-sync', (d: any) => setRemoteChallenges((d && d.list) || []));
    s.on('room-start', (d: any) => {
      setStatus('Battle started');
      try { window.dispatchEvent(new CustomEvent('pokettrpg-room-start', { detail: d })); } catch {}
      try { const rid = d?.roomId; if (rid && s.connected) s.emit('room-join', { roomId: rid }); } catch {}
    });
    // Generic message envelope fallback
    s.on('message', (msg: any) => {
      if (!msg || !msg.t) return;
      if (msg.t === 'state') { (s as any).emit('state-ack'); return; }
      if (msg.t === 'rooms') { setLanRooms(msg.d || []); setSyncing(false); }
      dispatchLan(msg.t, msg.d);
    });
    anyS.__handlersAttached = true;
  }
  useEffect(()=>{
    const api = (window as any).lan?.assets;
    if (!api?.listTrainers) return;
    let cancelled=false;
    function load(){
      api.listTrainers().then((r:any)=>{
        if(cancelled) return;
        if (r?.ok && Array.isArray(r.list)) setTrainerOptions(r.list);
        else setTrainerOptions([]);
      }).catch(()=>{ if(!cancelled) setTrainerOptions([]); });
    }
    load();
    const t = setTimeout(load, 2000); // one retry in case filesystem not ready yet
    return ()=>{ cancelled=true; clearTimeout(t); };
  }, []);

  // Removed LAN hosting/discovery hydration; Lobby operates only via WS URL

  // Hosting removed
  function pushChat(from: string, text: string) {
    setChat(prev => {
      const last = prev[prev.length-1];
      if (last && last.from === from && last.text === text && Date.now() - last.at < 500) return prev;
      return [...prev, { from, text, at: Date.now() }];
    });
  }

  function normalizeWsUrl(input: string): string {
    let u = (input || '').trim();
    if (!u) return '';
    // Map http(s) to ws(s)
    if (/^https:\/\//i.test(u)) u = 'wss://' + u.replace(/^https:\/\//i, '');
    else if (/^http:\/\//i.test(u)) u = 'ws://' + u.replace(/^http:\/\//i, '');
    // Ensure ws(s) scheme exists
    if (!/^wss?:\/\//i.test(u)) u = 'ws://' + u;
    // Only add a default port when connecting to localhost in dev.
    // For production (wss) and any non-local host, do not append a port.
    const isSecure = /^wss:\/\//i.test(u);
    const hostMatch = u.match(/^wss?:\/\/([^/:]+)(:\d+)?(\/.*)?$/i);
    const host = hostMatch ? hostMatch[1] : '';
    const hasPort = /^wss?:\/\/[^/:]+:\d+/i.test(u);
    const isLocalhost = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(host);
    if (!hasPort && !isSecure && isLocalhost) {
      // Default dev server port
      u = u.replace(/^(ws:\/\/[^/]+)(.*)$/i, `$1:3000$2`);
    }
    return u;
  }

  function joinServer(url: string) {
    // Reuse existing open socket if available
    const existing: Socket | null = (window as any).__pokettrpgIO || null;
    if (existing && existing.connected) { attachHandlers(existing); setSock(existing); setStatus('Connected'); return; }
    // Don’t try while offline
    if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
      setStatus('Offline – will retry when back online');
      return;
    }
    if (connectingRef.current) return; // prevent concurrent connects
    connectingRef.current = true;
    try {
      const target = normalizeWsUrl(url);
      if (!target) { setStatus('Enter a server URL'); connectingRef.current = false; return; }
      setStatus(`Connecting to ${target}…`);
      const s = io(target, { transports: ['websocket'], path: '/socket.io' });
      s.on('connect', () => {
        pushChat('system', 'Connected'); setStatus('Connected');
        try { s.emit('hello', { clientId: clientIdRef.current, username, avatar: trainerSpriteToAvatar(trainerSprite) }); } catch {}
        try { setSyncing(true); s.emit('state-request'); } catch {}
      });
      s.on('disconnect', () => { pushChat('system','Disconnected'); setStatus('Disconnected'); });
      s.on('connect_error', () => setStatus('Connect error'));
      attachHandlers(s);
      // Persist globally and in state
      (window as any).__pokettrpgIO = s;
      lastUrlRef.current = target;
      connectingRef.current = false;
      setSock(s);
    } catch {}
  }
  function leaveServer(){ const s: Socket | null = sock; if (s) { try { s.removeAllListeners(); } catch {} s.disconnect(); (window as any).__pokettrpgIO = null; setSock(null); } }
  function sendChat(text: string) {
    const msg = { t:'chat', d:{ text } };
    const s = sock;
    if (s && s.connected) s.emit('chat', msg.d);
    if ((window as any).lan && hosting) (window as any).lan.send('chat', { text });
    // Local echo for immediate feedback; server echo will be deduped by pushChat
    pushChat(username || 'me', text);
  }
  function sendChatLine() {
    const text = (chatInputRef.current?.value || '').trim(); if (!text) return;
    sendChat(text);
    if (chatInputRef.current) chatInputRef.current.value = '';
  }
  function createChallenge(format: string) {
    const id = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
    const chosen = teamsState.teams.find(t => t.id === challengeTeamId) || null;
    const fallback = teamsState.teams.find(t => t.id === teamsState.activeId) || teamsState.teams[0] || null;
    const team = chosen || fallback;
    const teamName = team?.name || 'Random';
    const teamText = team ? teamToShowdownText(team.members as any) : '';
    const d:any = { id, format, teamName, teamText };
    if (challengeToId) d.toId = challengeToId;
    const msg = { t:'challenge-create', d };
    const s = sock;
    if (s && s.connected) {
      s.emit('challenge-create', d);
      setStatus('Challenge created');
    } else if ((window as any).lan && hosting) {
      (window as any).lan.send('challenge-create', d);
      setStatus('Challenge created (local)');
    } else {
      setStatus('Not connected');
    }
  }
  function cancelChallenge(id: string) {
    const s = sock; const d = { id };
    if (s && s.connected) s.emit('challenge-cancel', d);
    if ((window as any).lan && hosting) (window as any).lan.send('challenge-cancel', { id });
  }
  function acceptChallenge(id: string) {
    // Use explicitly chosen team if provided; else fall back to active team
    const pickedId = acceptTeams[id] || challengeTeamId || '';
    const chosen = teamsState.teams.find(t => t.id === pickedId) || null;
    const active = chosen || teamsState.teams.find(t => t.id === teamsState.activeId) || teamsState.teams[0] || null;
    const teamText = active ? teamToShowdownText(active.members as any) : '';
    const s = sock; const d = { id, teamText };
    if (s && s.connected) {
      s.emit('challenge-accept', d);
    } else if ((window as any).lan && hosting) {
      (window as any).lan.send('challenge-accept', d);
    }
  }

  // LAN share links removed

  const teamOptions = teamsState.teams;

  // Auto-join on mount if enabled and not already connected (deferred to avoid blocking initial UI)
  useEffect(() => {
    if (autoJoin) {
      const existing: Socket | null = (window as any).__pokettrpgIO || null;
      if (!existing || !existing.connected) {
        const t = setTimeout(() => joinServer(wsUrl), 300);
        return () => { clearTimeout(t); };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause reconnects while offline; resume when back online
  useEffect(() => {
    function handleOnline() {
      setStatus('Back online');
      const existing: Socket | null = (window as any).__pokettrpgIO || null;
      if (autoJoin && (!existing || !existing.connected)) {
        const next = lastUrlRef.current || wsUrl;
        if (next) joinServer(next);
      }
    }
    function handleOffline() {
      setStatus('Offline');
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      // Socket.IO handles reconnection automatically
    };
  }, [autoJoin, wsUrl]);

  // If auto-join is enabled and URL changes, reconnect to the new URL
  useEffect(() => {
    if (autoJoin) {
  try { if ((window as any).__pokettrpgIO) { ((window as any).__pokettrpgIO as Socket).disconnect(); (window as any).__pokettrpgIO = null; } } catch {}
      joinServer(wsUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return (
    <section className="panel battle">
      <h2>Lobby</h2>
      {syncing && <div className="dim" style={{margin:'-6px 0 6px 0'}}>Syncing…</div>}
      <div style={{display:'flex', gap:8, marginBottom:8, alignItems:'center', flexWrap:'wrap'}}>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span className="dim">Server</span>
          <input value={wsUrl} onChange={e=> setWsUrl(e.target.value)} style={{width:320}} placeholder="wss://pokettrpg.duckdns.org (or your wss:// host)" />
        </label>
  {!sock && <button onClick={()=> joinServer(wsUrl)}>&gt; Join</button>}
  {sock && <button className="secondary" onClick={leaveServer}>Leave</button>}
        <label style={{display:'inline-flex', alignItems:'center', gap:6}} title="Auto-connect to this server on startup and reconnect if disconnected">
          <input type="checkbox" checked={autoJoin} onChange={e=> setAutoJoin(e.target.checked)} />
          <span className="dim">Auto-join</span>
        </label>
  {status && <span className="dim">{status}</span>}
  <span className="dim" style={{fontSize:'0.9em'}} title="No port is added automatically except ws://localhost, which uses :3000 for dev.">No default port (except localhost→3000)</span>
        <label style={{marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:6}}>
          <span className="dim">Username</span>
          <input value={username} onChange={e=> setUsername(e.target.value)} style={{width:160}} />
        </label>
      </div>
      {(/timed out|Offline|Connect error|Disconnected/i.test(status)) && (
        <div className="dim" style={{marginTop:-4, marginBottom:8}}>
          Having trouble connecting on your home network? Your router may not support NAT loopback. Try a Windows hosts override or a dev tunnel. See Help: <a href="/docs/lan-networking.html" target="_blank" rel="noreferrer">LAN networking</a>.
        </div>
      )}
      {/* LAN hosting and discovery removed */}
      <div style={{display:'grid', gridTemplateColumns:'520px 1fr 280px', gap:12}}>
        <aside className="panel" style={{padding:8, display:'grid', gap:8}}>
          <h3>Challenge</h3>
          <label>
            <div className="label"><strong>Format</strong></div>
            <select value={challengeFormat} onChange={e=> setChallengeFormat(e.target.value)}>
              {['Singles','Doubles','Random Singles','Boss: 3v1','2v2'].map(f=> <option key={f} value={f}>{f}</option>)}
            </select>
            {/^Boss:/i.test(challengeFormat) && (
              <div className="dim" style={{fontSize:'0.9em'}}>Challenger is the Boss (single active); opponent controls the 3.</div>
            )}
          </label>
          <label>
            <div className="label"><strong>Team</strong></div>
            <select value={challengeTeamId} onChange={e=> setChallengeTeamId(e.target.value)}>
              <option value="">Random</option>
              {teamOptions.map(t => <option key={t.id} value={t.id}>{t.name} ({t.members.length}/6)</option>)}
            </select>
          </label>
          <label>
            <div className="label"><strong>Opponent</strong> <span className="dim">(optional)</span></div>
            <select value={challengeToId} onChange={e=> setChallengeToId(e.target.value)}>
              <option value="">Anyone</option>
              {roster.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
          </label>
          <button onClick={()=> createChallenge(challengeFormat)}>&gt; Create Challenge</button>
          <div style={{marginTop:8}}>
            <h4 style={{marginTop:0}}>Open Challenges</h4>
            {remoteChallenges.length===0 && <div className="dim">None</div>}
            <ul style={{listStyle:'none', padding:0, margin:0, display:'grid', gap:6}}>
              {remoteChallenges.map(ch => (
                <li key={ch.id} style={{display:'grid', gridTemplateColumns:'1fr auto auto', gap:6, alignItems:'center'}}>
                  <div>
                    <div><strong>{ch.format}</strong> • {ch.teamName}</div>
                    <div className="dim" style={{fontSize:'0.9em'}}>from {ch.from}</div>
                    {/boss/i.test(String(ch.format||'')) && (
                      <div className="dim" style={{fontSize:'0.85em'}}>Fighters: {Array.isArray(ch.fighters) ? ch.fighters.length : 0}/3</div>
                    )}
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <select value={acceptTeams[ch.id] || ''} onChange={e=> setAcceptTeams(prev => ({ ...prev, [ch.id]: e.target.value }))}>
                      <option value="">Use Active Team</option>
                      {teamsState.teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.members.length}/6)</option>)}
                    </select>
                    {(() => {
                      const myId = clientIdRef.current;
                      const isBoss = /boss/i.test(String(ch.format||''));
                      const fighters = Array.isArray(ch.fighters) ? ch.fighters : [];
                      const alreadyJoined = !!fighters.find((f:any)=> f?.id === myId);
                      const full = isBoss && fighters.length >= 3;
                      const targeted = ch.toId && ch.toId.length;
                      const notTargetedToMe = targeted && ch.toId !== myId;
                      const disabled = alreadyJoined || full || notTargetedToMe;
                      return (
                        <button className="secondary" disabled={disabled} onClick={()=> acceptChallenge(ch.id)}>
                          {alreadyJoined ? 'Joined' : full ? 'Full' : notTargetedToMe ? 'Locked' : 'Accept'}
                        </button>
                      );
                    })()}
                  </div>
                  <button className="mini" onClick={()=> cancelChallenge(ch.id)}>Cancel</button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 style={{marginTop:12}}>Active Battles</h4>
            {rooms.length===0 && <div className="dim">None yet</div>}
            <ul style={{listStyle:'none', padding:0, margin:0, display:'grid', gap:6}}>
              {rooms.map(b => {
                const playerNames = (b.players||[]).map(p=>p.name).join(', ');
                const spectatorCount = (b as any).spectators ? (b as any).spectators.length : 0;
                const myId = clientIdRef.current;
                const amPlayer = !!(b.players||[]).find((p:any)=> p.id===myId);
                const amSpectator = !!((b as any).spectators||[]).find((s:any)=> s.id===myId);
                return (
                  <li key={b.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto auto', gap:6, alignItems:'center'}}>
                    <div>
                      <div><strong>{b.name}</strong></div>
                      <div className="dim" style={{fontSize:'0.9em', display:'flex', alignItems:'center', gap:6}}>
                        {(b.players||[]).map((p:any) => (
                          <span key={p.id} style={{display:'inline-flex', alignItems:'center', gap:4}}>
                            {p.avatar && <img src={`/showdown/sprites/trainers/${p.avatar}.png`} alt="" style={{width:16, height:16, imageRendering:'pixelated'}} onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; img.onerror=null; img.src=`/vendor/showdown/sprites/trainers/${p.avatar}.png`; }} />}
                            {p.name}
                          </span>
                        ))}
                        <span>• {b.status} {spectatorCount>0 ? `• ${spectatorCount} spec` : ''}</span>
                      </div>
                    </div>
                    <button className="secondary" disabled={amPlayer} onClick={()=>{
                      const msg = { t:'room-spectate', d:{ roomId: b.id } };
                      if (sock && sock.connected) (sock as Socket).emit('room-spectate', { roomId: b.id });
                      if ((window as any).lan && hosting) (window as any).lan.send('room-spectate', { roomId: b.id });
                    }}>Spectate</button>
                    <button disabled={amPlayer} onClick={()=>{
                      if (sock && sock.connected) (sock as Socket).emit('room-join', { roomId: b.id });
                      if ((window as any).lan && hosting) (window as any).lan.send('room-join', { roomId: b.id });
                      setActiveRoomId(b.id);
                    }}>Join</button>
                    <button className="mini" disabled={!amPlayer && !amSpectator} onClick={()=>{
                      if (sock && sock.connected) (sock as Socket).emit('room-leave', { roomId: b.id });
                      if ((window as any).lan && hosting) (window as any).lan.send('room-leave', { roomId: b.id });
                      if (activeRoomId === b.id) setActiveRoomId('');
                    }}>Leave</button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
        <section className="panel" style={{padding:8, display:'grid', gridTemplateRows:'1fr auto', gap:8}}>
          <div style={{overflow:'auto', border:'1px solid #444', borderRadius:6, padding:8, background:'var(--section-bg)'}}>
            {chat.length===0 && <div className="dim">Welcome to the lobby. Join your server to start chatting.</div>}
            {chat.map((m,i)=> (
              <div key={`${m.at || i}-${i}`}><strong>{m.from}:</strong> {m.text}</div>
            ))}
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:6}}>
            <input ref={chatInputRef} onKeyDown={(e)=>{ if (e.key==='Enter') sendChatLine(); }} placeholder="Type a message..." />
            <button onClick={sendChatLine}>Send</button>
          </div>
        </section>
        <aside className="panel" style={{padding:8, display:'grid', gap:8}}>
          <h3>Trainer</h3>
          <div>
            <div className="label"><strong>Sprite</strong></div>
            <div style={{maxHeight:220, overflow:'auto', border:'1px solid #444', borderRadius:6, padding:6, display:'grid', gridTemplateColumns:'repeat(auto-fill, 48px)', gap:8}}>
              {trainerOptions.length===0 && <div className="dim">Loading trainer sprites…</div>}
              {trainerOptions.map(name => (
                <button key={name} title={name} className={trainerSprite===name? 'active':''} onClick={()=> setTrainerSprite(name)} style={{width:48, height:48, padding:0, border: trainerSprite===name? '2px solid var(--acc)': '1px solid #444', borderRadius:4, background:'transparent'}}>
                  <img src={`/vendor/showdown/sprites/trainers/${name}.png`} alt={name} style={{width:44, height:44, imageRendering:'pixelated'}} onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; img.onerror=null; img.src=`/showdown/sprites/trainers/${name}.png`; }} />
                </button>
              ))}
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <div className="dim">Current:</div>
            <img src={`/vendor/showdown/sprites/trainers/${trainerSprite}.png`} alt="avatar" style={{width:28, height:28, imageRendering:'pixelated', background:'transparent'}} onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; img.onerror=null; img.src=`/showdown/sprites/trainers/${trainerSprite}.png`; }} />
            <span>{trainerSprite}</span>
          </div>
          <div className="dim">LAN lobby: host broadcasts on port 17646. Other devices on the same network can join via discovery or ws://host-ip:17646</div>
          <div>
            <h4>Peers</h4>
            <ul>
              {roster.map(p => <li key={p.id}>{p.name} <span className="dim">({p.id})</span></li>)}
              {roster.length===0 && <li className="dim">No peers</li>}
            </ul>
          </div>
          {activeRoomId && (
            <div>
              <h4>Room</h4>
              {rooms.filter(r=> r.id===activeRoomId).map(r => {
                const myId = clientIdRef.current;
                const amPlayer = !!(r.players||[]).find(p=>p.id===myId);
                const readyMap = (r as any).ready || {} as Record<string,boolean>;
                const myReadyValue = !!readyMap[myId];
                return (
                  <div key={r.id} style={{display:'grid', gap:6}}>
                    <div><strong>{r.name}</strong> <span className="dim">• {r.status}</span></div>
                    <div>
                      <div className="dim">Players</div>
                      <ul style={{margin:0}}>
                        {(r.players||[]).map((p:any) => (
                          <li key={p.id} style={{display:'flex', alignItems:'center', gap:6}}>
                            {p.avatar && <img src={`/showdown/sprites/trainers/${p.avatar}.png`} alt="" style={{width:18, height:18, imageRendering:'pixelated'}} />}
                            {p.name} {readyMap[p.id] ? '✓' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {(r as any).spectators && (r as any).spectators.length>0 && (
                      <div>
                        <div className="dim">Spectators</div>
                        <ul style={{margin:0}}>
                          {(r as any).spectators.map((s:any) => (
                            <li key={s.id} style={{display:'flex', alignItems:'center', gap:6}}>
                              {s.avatar && <img src={`/showdown/sprites/trainers/${s.avatar}.png`} alt="" style={{width:16, height:16, imageRendering:'pixelated'}} onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; img.onerror=null; img.src=`/vendor/showdown/sprites/trainers/${s.avatar}.png`; }} />}
                              {s.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {amPlayer && (
                      <button onClick={()=>{
                        const next = !myReadyValue; setMyReady(next);
                        const active = teamsState.teams.find(t => t.id===teamsState.activeId) || teamsState.teams[0] || null;
                        const teamText = active ? teamToShowdownText(active.members as any) : '';
                        const payload = { roomId: r.id, ready: next, team: teamText, avatar: trainerSpriteToAvatar(trainerSprite), username } as any;
                        if (sock && sock.connected) (sock as Socket).emit('room-ready', payload);
                        if ((window as any).lan && hosting) (window as any).lan.send('room-ready', payload);
                      }}>{myReadyValue ? 'Unready' : 'Ready'}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
      {/* Custom Dex Sync: moved here per request */}
      <div style={{marginTop:12}}>
        <CustomsImportExport />
      </div>
    </section>
  );
}

function trainerSpriteToAvatar(name: string): string {
  // The Showdown client references avatars by basename (without .png)
  // Our selector provides the basename directly, so pass through.
  return name;
}
