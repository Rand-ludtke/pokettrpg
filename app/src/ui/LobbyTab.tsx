import React, { useEffect, useRef, useState } from 'react';
import { loadTeams, teamToShowdownText } from '../data/adapter';

export function LobbyTab() {
  const teamsState = loadTeams();
  const [hosting, setHosting] = useState<{port:number}|null>(null);
  // Keep a singleton WebSocket on window to avoid duplicate connects across tab switches/remounts
  const [ws, setWs] = useState<WebSocket|null>(() => (window as any).__pokettrpgWS || null);
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
  const [manualJoinUrl, setManualJoinUrl] = useState<string>('');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [username, setUsername] = useState<string>(()=> localStorage.getItem('ttrpg.username') || ('Trainer-'+Math.random().toString(36).slice(2,6)));
  useEffect(()=>{ try { localStorage.setItem('ttrpg.username', username); } catch {} }, [username]);
  const [roster, setRoster] = useState<Array<{id:string; name:string}>>([]);
  const [remoteChallenges, setRemoteChallenges] = useState<Array<any>>([]);
  const [joinLinks, setJoinLinks] = useState<string[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [myReady, setMyReady] = useState<boolean>(false);
  const clientIdRef = useRef<string>('');
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
  function attachFanout(s: WebSocket) {
    const anyS: any = s as any;
    if (anyS.__fanoutAttached) return;
    const onMsg = (ev: MessageEvent) => {
      let msg: any; try { msg = JSON.parse(String((ev as any).data)); } catch { return; }
      if (!msg || !msg.t) return;
      // Forward all relevant LAN events as page-level CustomEvents
      // Special-case 'state' to fan out its parts and set lan.rooms
      if (msg.t === 'state') {
        const snap = msg.d || {};
        setSyncing(false);
        if (Array.isArray(snap.rooms)) { setLanRooms(snap.rooms); dispatchLan('rooms', snap.rooms); }
        if (Array.isArray(snap.roster)) dispatchLan('roster', snap.roster);
        if (Array.isArray(snap.challenges)) dispatchLan('challenge-sync', { list: snap.challenges });
        if (Array.isArray(snap.chat)) for (const line of snap.chat) dispatchLan('chat', line);
        return;
      }
  if (msg.t === 'rooms') { setLanRooms(msg.d || []); setSyncing(false); }
      // Pass-through for everything else
      dispatchLan(msg.t, msg.d);
    };
    try { (s as any).addEventListener('message', onMsg); } catch { /* older TS dom types */ }
    anyS.__fanoutAttached = true;
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

  useEffect(() => {
    const lan = (window as any).lan;
    if (!lan) return;
    // Hydrate from main snapshot so remounts don't show empty UI
    (async () => {
      try {
        const snap = await lan.state?.();
        if (snap?.ok) {
          const rlist = Array.isArray(snap.rooms) ? snap.rooms : [];
          setRooms(rlist);
          setRoster(Array.isArray(snap.roster) ? snap.roster : []);
          const chall = Array.isArray(snap.challenges) ? snap.challenges : [];
          setRemoteChallenges(chall);
          const chatHist = Array.isArray(snap.chat) ? snap.chat : [];
          setChat(chatHist);
          // Also fan these out for other tabs and set lan.rooms for viewer inference
          setLanRooms(rlist);
          dispatchLan('rooms', rlist);
          dispatchLan('roster', Array.isArray(snap.roster) ? snap.roster : []);
          dispatchLan('challenge-sync', { list: chall });
          for (const line of chatHist) dispatchLan('chat', line);
          setStatus('Connected');
        }
      } catch {}
    })();
    const offRoster = lan.on('roster', (list:any) => setRoster(list || []));
    const offChat = lan.on('chat', (d:any) => pushChat(d?.from ?? 'peer', d?.text ?? ''));
    const offChallengeSync = lan.on('challenge-sync', (d:any) => setRemoteChallenges((d && d.list) || []));
  const offRooms = lan.on('rooms', (list:any) => { setLanRooms(list || []); setRooms(list || []); });
    const offHostFound = lan.on('host-found', (h:any) => {
      setHosts(prev => {
        const next = prev.slice();
        if (!next.find(x => x.ip===h.ip && x.port===h.port)) next.push(h);
        return next;
      });
    });
    const offRoomStart = lan.on('room-start', (_d:any) => {
      setStatus('Battle started');
    });
    const offRoomDebug = lan.on('room-debug', (d:any) => {
      if (!d || !d.roomId) return;
      // Show last few debug lines inline for visibility
      setStatus(`[${d.where}] ${d.msg}`);
    });
  lan.discover?.start?.();
  lan.discover?.ping?.();
  if (!hosting) setStatus('Scanning for hosts…');
    const scanTimer = setInterval(()=> lan.discover?.ping?.(), 5000);
    // Auto-resume hosting if previously set
    try { if (localStorage.getItem('ttrpg.hosting') === '1') hostServer(); } catch {}
    return () => { offRoster && offRoster(); offChat && offChat(); offChallengeSync && offChallengeSync(); offRooms && offRooms(); offHostFound && offHostFound(); offRoomStart && offRoomStart(); offRoomDebug && offRoomDebug(); clearInterval(scanTimer); lan.discover?.stop?.(); };
  }, []);

  function hostServer() {
    const lan = (window as any).lan;
    if (!lan) { setStatus('Hosting is only available in the desktop app.'); return; }
    setStatus('Starting host…');
    lan.host({ port: 17646 }).then((r:any)=>{
      if (r?.ok) { setHosting({ port: r.port }); setStatus(`Hosting on port ${r.port}`); try { localStorage.setItem('ttrpg.hosting','1'); } catch {} }
      else { setStatus('Failed to start host.'); }
    }).catch(()=> setStatus('Failed to start host.'));
  }
  function stopServer() { const lan = (window as any).lan; if (!lan) return; lan.stop().then(()=> { setHosting(null); setStatus('Stopped hosting'); try { localStorage.removeItem('ttrpg.hosting'); } catch {} }); }
  function pushChat(from: string, text: string) {
    setChat(prev => {
      const last = prev[prev.length-1];
      if (last && last.from === from && last.text === text && Date.now() - last.at < 500) return prev;
      return [...prev, { from, text, at: Date.now() }];
    });
  }

  function joinServer(url: string) {
    // Reuse existing open socket if available
    const existing: WebSocket | null = (window as any).__pokettrpgWS || null;
    if (existing && existing.readyState === 1) { attachFanout(existing); setWs(existing); setStatus('Connected'); return; }
    try {
  const s = new WebSocket(url);
  s.onopen = ()=> { pushChat('system','Connected'); setStatus('Connected'); try { s.send(JSON.stringify({ t:'hello', d:{ clientId: clientIdRef.current, username, avatar: trainerSpriteToAvatar(trainerSprite) } })); } catch {}; try { setSyncing(true); s.send(JSON.stringify({ t:'state-request' })); } catch {} };
      s.onmessage = (ev)=>{
        let msg; try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (!msg || !msg.t) return;
        if (msg.t === 'roster') setRoster(msg.d || []);
        else if (msg.t === 'chat') pushChat(msg.d?.from ?? 'peer', msg.d?.text ?? '');
        else if (msg.t === 'challenge-sync') setRemoteChallenges((msg.d && msg.d.list) || []);
        else if (msg.t === 'rooms') { setLanRooms(msg.d || []); setRooms(msg.d || []); setSyncing(false); }
        else if (msg.t === 'state') {
          const snap = msg.d || {};
          setSyncing(false);
          const rlist = Array.isArray(snap.rooms) ? snap.rooms : [];
          const rstr = Array.isArray(snap.roster) ? snap.roster : [];
          const chall = Array.isArray(snap.challenges) ? snap.challenges : [];
          const chatHist = Array.isArray(snap.chat) ? snap.chat : [];
          setLanRooms(rlist);
          setRooms(rlist);
          setRoster(rstr);
          setRemoteChallenges(chall);
          setChat(chatHist);
          // Also fan-out for other tabs immediately
          dispatchLan('rooms', rlist);
          dispatchLan('roster', rstr);
          dispatchLan('challenge-sync', { list: chall });
          for (const line of chatHist) dispatchLan('chat', line);
        }
  else if (msg.t === 'room-start') {
    setStatus('Battle started');
    try {
      // Non-host clients: emit a window event so App can open a PS battle tab too
      const evt = new CustomEvent('pokettrpg-room-start', { detail: msg.d });
      window.dispatchEvent(evt);
    } catch {}
    try {
      // Auto-join the room to register presence with the host
      const rid = msg?.d?.roomId;
      if (rid && s.readyState === 1) s.send(JSON.stringify({ t:'room-join', d:{ roomId: rid } }));
    } catch {}
  }
        // Note: room-log/request/end/room-buffer/room-chat are fanned out by attachFanout()
      };
      s.onerror = ()=> setStatus('Connect error');
      s.onclose = ()=> {
        pushChat('system','Disconnected'); setStatus('Disconnected');
        // Try to reconnect after a short delay
        setTimeout(()=>{
          if (!ws || ws.readyState !== 1) joinServer(url);
        }, 1500);
      };
  // Persist globally and in state
  (window as any).__pokettrpgWS = s;
  attachFanout(s);
  setWs(s);
      // hello already sent in onopen above
    } catch {}
  }
  function leaveServer(){ if (ws) { try { ws.onclose = null as any; } catch {} ws.close(); (window as any).__pokettrpgWS = null; setWs(null); } }
  function sendChat(text: string) {
    const msg = { t:'chat', d:{ text } };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    if ((window as any).lan && hosting) (window as any).lan.send('chat', { text });
    // No local echo; rely on loopback
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
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
      setStatus('Challenge created');
    } else if ((window as any).lan && hosting) {
      (window as any).lan.send('challenge-create', d);
      setStatus('Challenge created (local)');
    } else {
      setStatus('Not connected');
    }
  }
  function cancelChallenge(id: string) {
    const msg = { t:'challenge-cancel', d:{ id } };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    if ((window as any).lan && hosting) (window as any).lan.send('challenge-cancel', { id });
  }
  function acceptChallenge(id: string) {
    // Use explicitly chosen team if provided; else fall back to active team
    const pickedId = acceptTeams[id] || challengeTeamId || '';
    const chosen = teamsState.teams.find(t => t.id === pickedId) || null;
    const active = chosen || teamsState.teams.find(t => t.id === teamsState.activeId) || teamsState.teams[0] || null;
    const teamText = active ? teamToShowdownText(active.members as any) : '';
    const msg = { t:'challenge-accept', d:{ id, teamText } };
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    } else if ((window as any).lan && hosting) {
      (window as any).lan.send('challenge-accept', { id, teamText });
    }
  }

  async function refreshJoinLinks() {
    const lan = (window as any).lan;
    if (!lan) return;
    try {
      const info = (lan.info ? await lan.info() : (lan.discover?.info ? await lan.discover.info() : null)) as any;
      const port = info?.port || hosting?.port || 17646;
      const addrs: string[] = info?.addresses || [];
      const links = addrs.map(ip => `ws://${ip}:${port}`);
      // Always include localhost as a fallback
      links.unshift(`ws://127.0.0.1:${port}`);
      setJoinLinks(Array.from(new Set(links)));
    } catch { /* ignore */ }
  }

  const teamOptions = teamsState.teams;

  return (
    <section className="panel battle">
      <h2>Lobby</h2>
      {syncing && <div className="dim" style={{margin:'-6px 0 6px 0'}}>Syncing…</div>}
      <div style={{display:'flex', gap:8, marginBottom:8, alignItems:'center', flexWrap:'wrap'}}>
        {!hosting && <button onClick={hostServer}>&gt; Host (LAN)</button>}
        {hosting && <>
          <span className="dim">Hosting on port {hosting.port}</span>
          <button className="secondary" onClick={stopServer}>Stop</button>
          <button className="secondary" onClick={refreshJoinLinks}>Copy Join Links</button>
        </>}
        {!ws && <button onClick={()=> joinServer('ws://127.0.0.1:17646')}>&gt; Join localhost</button>}
        {ws && <button className="secondary" onClick={leaveServer}>Leave</button>}
        {status && <span className="dim">{status}</span>}
        <label style={{marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:6}}>
          <span className="dim">Username</span>
          <input value={username} onChange={e=> setUsername(e.target.value)} style={{width:160}} />
        </label>
      </div>
      {/* Manual join URL entry */}
      <div className="panel" style={{padding:8, marginBottom:8}}>
        <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:6, alignItems:'center'}}>
          <input placeholder="ws://host-or-ip:17646" value={manualJoinUrl} onChange={e=> setManualJoinUrl(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') { const u = manualJoinUrl.trim(); if (u) joinServer(u); } }} />
          <button onClick={()=>{ const u = manualJoinUrl.trim(); if (u) joinServer(u); }}>&gt; Join via Link</button>
        </div>
        <div className="dim" style={{marginTop:6}}>Paste a ws:// join URL from the host if auto-discovery doesn't work.</div>
      </div>
      {hosting && joinLinks.length>0 && (
        <div className="panel" style={{padding:8, marginBottom:8}}>
          <div><strong>Shareable Join Links</strong> <span className="dim">(click to copy)</span></div>
          <ul style={{listStyle:'none', padding:0, margin:0, display:'grid', gap:6}}>
            {joinLinks.map(link => (
              <li key={link} style={{display:'grid', gridTemplateColumns:'1fr auto', gap:6, alignItems:'center'}}>
                <code>{link}</code>
                <button className="mini" onClick={async()=>{ try { await navigator.clipboard.writeText(link); setStatus('Copied join link'); } catch { setStatus('Copy failed'); } }}>Copy</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hosts.length>0 && (
        <div className="panel" style={{padding:8, marginBottom:8}}>
          <div><strong>Discovered Hosts</strong></div>
          <ul style={{listStyle:'none', padding:0, margin:0, display:'grid', gap:6}}>
            {hosts.map((h,i)=> (
              <li key={`${h.ip}:${h.port}:${i}`} style={{display:'grid', gridTemplateColumns:'1fr auto', gap:6, alignItems:'center'}}>
                <div>{h.name || 'Host'} <span className="dim">{h.ip}:{h.port}</span></div>
                <button onClick={()=> joinServer(`ws://${h.ip}:${h.port}`)}>&gt; Join</button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
                            {p.avatar && <img src={`/showdown/sprites/trainers/${p.avatar}.png`} alt="" style={{width:16, height:16, imageRendering:'pixelated'}} />}
                            {p.name}
                          </span>
                        ))}
                        <span>• {b.status} {spectatorCount>0 ? `• ${spectatorCount} spec` : ''}</span>
                      </div>
                    </div>
                    <button className="secondary" disabled={amPlayer} onClick={()=>{
                      const msg = { t:'room-spectate', d:{ roomId: b.id } };
                      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
                      if ((window as any).lan && hosting) (window as any).lan.send('room-spectate', { roomId: b.id });
                    }}>Spectate</button>
                    <button disabled={amPlayer} onClick={()=>{
                      const msg = { t:'room-join', d:{ roomId: b.id } };
                      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
                      if ((window as any).lan && hosting) (window as any).lan.send('room-join', { roomId: b.id });
                      setActiveRoomId(b.id);
                    }}>Join</button>
                    <button className="mini" disabled={!amPlayer && !amSpectator} onClick={()=>{
                      const msg = { t:'room-leave', d:{ roomId: b.id } };
                      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
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
            {chat.length===0 && <div className="dim">Welcome to the LAN lobby. Host or Join to start chatting.</div>}
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
                  <img src={`/showdown/sprites/trainers/${name}.png`} alt={name} style={{width:44, height:44, imageRendering:'pixelated'}} />
                </button>
              ))}
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <div className="dim">Current:</div>
            <img src={`/showdown/sprites/trainers/${trainerSprite}.png`} alt="avatar" style={{width:28, height:28, imageRendering:'pixelated', background:'transparent'}} />
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
                              {s.avatar && <img src={`/showdown/sprites/trainers/${s.avatar}.png`} alt="" style={{width:16, height:16, imageRendering:'pixelated'}} />}
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
                        const msg = { t:'room-ready', d: payload };
                        if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
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
    </section>
  );
}

function trainerSpriteToAvatar(name: string): string {
  // The Showdown client references avatars by basename (without .png)
  // Our selector provides the basename directly, so pass through.
  return name;
}
