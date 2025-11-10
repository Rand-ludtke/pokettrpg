import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BattlePokemon } from '../types';
import { spriteUrl, loadShowdownDex, normalizeName, speciesFormesInfo, eligibleMegaFormForItem, prepareBattle, toPokemon, loadTeams } from '../data/adapter';

type PrimaryStatus = 'par'|'slp'|'brn'|'frz'|'psn'|'tox'|null;
type Volatile = 'confusion'|string;

export function BattleTab({ friendly, enemy, team, onReplaceTeam }: {
  friendly: BattlePokemon | null;
  enemy: BattlePokemon | null;
  team?: BattlePokemon[];
  onReplaceTeam?: (index: number, p: BattlePokemon) => void;
}) {
  const [view] = useState<'battle'>('battle');
  // Lobby state + LAN wiring
  const [hosting, setHosting] = useState<{port:number}|null>(null);
  const [ws, setWs] = useState<WebSocket|null>(null);
  const [peers, setPeers] = useState<string[]>([]);
  const [chat, setChat] = useState<Array<{from:string; text:string; at:number}>>([]);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [trainerSprite, setTrainerSprite] = useState<string>(() => localStorage.getItem('ttrpg.trainerSprite') || 'Ace Trainer');
  const [battles, setBattles] = useState<Array<{id:string; name:string; format:string; players:string[]; status:'open'|'active'}>>([]);
  const [challengeFormat, setChallengeFormat] = useState<string>('Singles');
  const [challengeTeamId, setChallengeTeamId] = useState<string>('');
  const teamsState = loadTeams();
  useEffect(()=>{ try { localStorage.setItem('ttrpg.trainerSprite', trainerSprite); } catch {} }, [trainerSprite]);
  const teamList = team ?? (friendly ? [friendly] : []);
  const [activeIdx, setActiveIdx] = useState(0);
  const active = teamList[activeIdx] ?? friendly;

  // Local battle state (per active)
  const [hp, setHp] = useState<number>(active?.currentHp ?? 0);
  const [stages, setStages] = useState<{atk:number;def:number;spAtk:number;spDef:number;speed:number}>({ atk:0, def:0, spAtk:0, spDef:0, speed:0 });
  const [status, setStatus] = useState<PrimaryStatus>(null);
  const [confused, setConfused] = useState<boolean>(false);
  const [confuseTurns, setConfuseTurns] = useState<number>(0); // 0..5
  const [infatuated, setInfatuated] = useState<boolean>(false);
  const [cursed, setCursed] = useState<boolean>(false);
  const [leeched, setLeeched] = useState<boolean>(false);
  const [bound, setBound] = useState<boolean>(false);
  const [bindTurns, setBindTurns] = useState<number>(0); // 0..5
  const [sleepTurns, setSleepTurns] = useState<number>(0); // 0..3
  const [toxicStage, setToxicStage] = useState<number>(1); // grows each turn while TOX
  const [terrain, setTerrain] = useState<string>('none');
  const [weather, setWeather] = useState<string>('none');
  const [moveMult, setMoveMult] = useState<Record<number, number>>({});
  const [turnLog, setTurnLog] = useState<string>('');
  const [infoTab, setInfoTab] = useState<'type'|'rules'|'conditions'|'terrain'|'hazards'>('type');
  const [typePick1, setTypePick1] = useState<string>('');
  const [typePick2, setTypePick2] = useState<string>('');

  // Dex data for ability/item descriptions and mega logic
  const [dex, setDex] = useState<any | null>(null);
  useEffect(() => { (async () => { const d = await loadShowdownDex(); setDex(d); })(); }, []);

  // Mega eligibility derived from dex + held item

  const statusName: Record<NonNullable<PrimaryStatus>, string> = { par:'Paralysis', slp:'Sleep', brn:'Burn', frz:'Freeze', psn:'Poison', tox:'Badly Poisoned' };
  const statusChances: Record<NonNullable<PrimaryStatus>, number> = { par:25, slp:100, brn:30, frz:10, psn:30, tox:10 };

  const clamp = (n:number,min:number,max:number)=> Math.max(min, Math.min(max, n));
  const changeStage = (key: keyof typeof stages, delta: number)=> setStages(s=> ({...s,[key]: clamp((s[key]||0)+delta, -6, 6)}));

  const stageChips = (
    <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
      {(['atk','def','spAtk','spDef','speed'] as const).map(k => (
        <div key={k} className="chip" style={{display:'flex', alignItems:'center', gap:6, border:'1px solid #666', borderRadius:16, padding:'2px 8px'}}>
          <span style={{minWidth:38, display:'inline-block'}}>{shortStat(k)}</span>
          <button onClick={()=>changeStage(k, -1)}>-1</button>
          <strong>{stages[k] >= 0 ? `+${stages[k]}` : stages[k]}</strong>
          <button onClick={()=>changeStage(k, +1)}>+1</button>
        </div>
      ))}
    </div>
  );

  useEffect(() => {
    // subscribe to host-side forwarded events
    const lan = (window as any).lan;
    if (!lan) return;
    const offJoin = lan.on('peer-join', (e:any) => {
      setPeers(p => Array.from(new Set([...p, e.peer])));
      setChat(c => [...c, { from:'system', text:`${e.peer} joined`, at: Date.now() }]);
    });
    const offLeave = lan.on('peer-leave', (e:any) => {
      setPeers(p => p.filter(x => x !== e.peer));
      setChat(c => [...c, { from:'system', text:`${e.peer} left`, at: Date.now() }]);
    });
    const offChat = lan.on('chat', (d:any) => setChat(c => [...c, { from: d?.from ?? 'peer', text: d?.text ?? '', at: Date.now() }]));
    const offChallenge = lan.on('challenge', (d:any) => setChat(c => [...c, { from:'system', text:`Challenge: ${d?.format ?? 'Singles'} from ${d?.from ?? 'peer'}`, at: Date.now() }]));
    return () => { offJoin && offJoin(); offLeave && offLeave(); offChat && offChat(); offChallenge && offChallenge(); };
  }, []);

  function hostServer() {
    const lan = (window as any).lan; if (!lan) return;
    lan.host({ port: 17646 }).then((r:any)=>{ if (r?.ok) setHosting({ port: r.port }); });
  }
  function stopServer() { const lan = (window as any).lan; if (!lan) return; lan.stop().then(()=> setHosting(null)); }
  function joinServer(url: string) {
    try {
      const s = new WebSocket(url);
      s.onopen = ()=> setChat(c => [...c, { from:'system', text:'Connected', at: Date.now() }]);
      s.onmessage = (ev)=>{
        let msg; try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (!msg || !msg.t) return;
        if (msg.t === 'peer-join') setPeers(p => Array.from(new Set([...p, msg.d?.peer])));
        else if (msg.t === 'peer-leave') setPeers(p => p.filter(x => x !== msg.d?.peer));
        else if (msg.t === 'chat') setChat(c => [...c, { from: msg.d?.from ?? 'peer', text: msg.d?.text ?? '', at: Date.now() }]);
        else if (msg.t === 'challenge') setChat(c => [...c, { from: 'system', text: `Challenge: ${msg.d?.format ?? 'Singles'} from ${msg.d?.from ?? 'peer'}`, at: Date.now() }]);
      };
      s.onclose = ()=> setChat(c => [...c, { from:'system', text:'Disconnected', at: Date.now() }]);
      setWs(s);
    } catch {}
  }
  function leaveServer(){ if (ws) { ws.close(); setWs(null); setPeers([]); } }
  function sendChat(text: string) {
    const msg = { t:'chat', d:{ from:'me', text } };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    if ((window as any).lan && hosting) (window as any).lan.send('chat', { from:'host', text });
    setChat(c => [...c, { from:'me', text, at: Date.now() }]);
  }
  function challenge(format: string) {
    const msg = { t:'challenge', d:{ from:'me', format } };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    if ((window as any).lan && hosting) (window as any).lan.send('challenge', { from:'host', format });
  }

  // lobby view removed; now a top-level tab

  if (!active) {
    return (
      <section className="panel battle">
        <h2>Battle</h2>
        <p>No active Pokémon. Add to your team and switch to the Battle tab.</p>
      </section>
    );
  }

  const { baseSpeciesName, megaTarget } = useMemo(() => {
    if (!dex || !active) return { baseSpeciesName: active?.species || active?.name, megaTarget: null as string | null };
    const baseId = (active.species || active.name);
    const { base } = speciesFormesInfo(baseId, dex.pokedex);
    const target = eligibleMegaFormForItem(base, active.item, dex.pokedex);
    return { baseSpeciesName: base, megaTarget: target };
  }, [dex, active]);

  const isMegaNow = useMemo(() => {
    if (!active) return false;
    const id = normalizeName(active.species || active.name);
    const baseId = normalizeName(baseSpeciesName || id);
    return id !== baseId;
  }, [active, baseSpeciesName]);

  const doMegaToggle = async () => {
    if (!dex || !active) return;
    const nextSpecies = isMegaNow ? (baseSpeciesName || (active.species || active.name)) : (megaTarget || (active.species || active.name));
    const p0 = toPokemon(nextSpecies, dex.pokedex, active.level);
    if (!p0) return;
    p0.name = active.name;
    (p0 as any).item = (active as any).item;
    (p0 as any).shiny = (active as any).shiny;
    (p0 as any).moves = active.moves as any;
    const bp = prepareBattle(p0);
    // Preserve battle HP state (keep same current and max to maintain lost HP visually)
    bp.currentHp = hp;
    bp.maxHp = active.maxHp;
    if (onReplaceTeam) onReplaceTeam(activeIdx, bp);
  };

  const nextTurn = useNextTurn({
    status, setStatus,
    hp, setHp, maxHp: active.maxHp,
    cursed, leeched, bound,
    bindTurns, setBindTurns,
    sleepTurns, setSleepTurns,
    toxicStage, setToxicStage,
    confused, confuseTurns, setConfuseTurns,
    setTurnLog,
  });

  return (
    <section className="panel battle">
      <h2>Battle</h2>
  <div style={{marginBottom:8}} />
  <div className="battle-layout" style={{display:'grid', gridTemplateColumns:'200px 1fr 320px', gap:12}}>
        {/* Left: team tabs */}
        <aside className="panel" style={{padding:8}}>
          <h3>My Team</h3>
          <div style={{display:'grid', gap:6}}>
            {teamList.map((p, idx) => (
              <button key={`${p.name}-${idx}`} className={idx===activeIdx?'active':''} onClick={()=>{ setActiveIdx(idx); setHp(p.currentHp); setStages({atk:0,def:0,spAtk:0,spDef:0,speed:0}); setStatus(null); setConfused(false); setConfuseTurns(0); setInfatuated(false); setCursed(false); setLeeched(false); setBound(false); setBindTurns(0); setSleepTurns(0); setToxicStage(1); }} style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:8,alignItems:'center'}}>
                <img
                  className="pixel"
                  alt=""
                  src={spriteUrl(p.species || p.name, !!p.shiny)}
                  style={{width:48,height:48}}
                  onError={(e)=>{
                    const img = e.currentTarget as HTMLImageElement;
                    if ((img as any).dataset.fallback) return;
                    (img as any).dataset.fallback = '1';
                    img.src = spriteUrl(p.species || p.name, !!p.shiny, { setOverride: 'gen5' });
                  }}
                />
                <div style={{textAlign:'left'}}>
                  <div><strong>{p.name}</strong></div>
                  <div className="dim">Lv {p.level}</div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Middle: interactive statblock */}
        <section className="panel" style={{padding:12}}>
          <header style={{marginBottom:8}}>
            <div><strong>{active.name}</strong></div>
            {(() => {
              const speciesName = active.species || active.name;
              const typesLine = active.types.join(' / ');
              const hasNickname = normalizeName(speciesName) !== normalizeName(active.name);
              if (hasNickname) {
                return (
                  <>
                    <div className="dim" style={{marginTop:2}}>{speciesName} • {typesLine}</div>
                    <div className="dim">Lv {active.level}</div>
                  </>
                );
              }
              return null;
            })()}
          </header>
          {(() => {
            const baseId = (active.species || active.name);
            const typesLine = active.types.join(' / ');
            const hasNickname = normalizeName(baseId) !== normalizeName(active.name);

            // Ability & Item descriptions
            const abilityName = active.ability || '';
            const abilityObj = abilityName && dex ? Object.values(dex.abilities).find((a: any)=> normalizeName((a as any).name) === normalizeName(abilityName)) : null;
            const abilityText = (abilityObj as any)?.shortDesc || (abilityObj as any)?.desc || '';
            const itemName = (active as any).item || '';
            const itemObj = itemName && dex ? Object.values(dex.items).find((i: any)=> normalizeName((i as any).name) === normalizeName(itemName)) : null;
            const itemText = (itemObj as any)?.shortDesc || (itemObj as any)?.desc || '';

            // Speed summary
            const speedMult = stageMultiplier(stages.speed) * (status==='par' ? 0.5 : 1);
            const totalSpeed = Math.floor(active.baseStats.speed * speedMult);

            return (
              <>
                {!hasNickname && (
                  <div className="dim" style={{marginTop:-6, marginBottom:8}}>Lv {active.level} • {typesLine}</div>
                )}
                <div style={{display:'grid', gridTemplateColumns:'1fr 220px', gap:12, alignItems:'stretch'}}>
                  {/* Left: HP first, then Mods box */}
                  <div style={{display:'grid', gap:8}}>
                    <div>
                      <strong>HP</strong>: <input type="number" value={hp} min={0} max={active.maxHp} onChange={(e)=> setHp(Math.max(0, Math.min(active.maxHp, Number(e.target.value)||0)))} style={{width:80}} /> / {active.maxHp}
                      <div className="hpbar large"><span style={{width:`${(hp/active.maxHp)*100}%`}} /></div>
                    </div>
                    <div style={{border:'1px solid #444', borderRadius:6, padding:6, fontSize:'0.95em'}}>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                        {(() => { const atkBase = flatAtkMod(active.baseStats.atk); const spaBase = flatAtkMod(active.baseStats.spAtk); const netAtk = clampMod(atkBase + stages.atk); const netSpA = clampMod(spaBase + stages.spAtk); return (
                          <div style={{borderRight:'1px solid #444', paddingRight:8}}>
                            <div><span className="dim">Atk</span> <strong>{fmtSign(netAtk)}</strong> <span className="dim">(base {fmtSign(atkBase)}{stages.atk? ` • s ${fmtSign(stages.atk)}`:''})</span></div>
                            <div><span className="dim">SpA</span> <strong>{fmtSign(netSpA)}</strong> <span className="dim">(base {fmtSign(spaBase)}{stages.spAtk? ` • s ${fmtSign(stages.spAtk)}`:''})</span></div>
                          </div>
                        ); })()}
                        {(() => { const defBase = flatDefMod(active.baseStats.def); const spdBase = flatDefMod(active.baseStats.spDef); const netDef = clampMod(defBase - stages.def); const netSpD = clampMod(spdBase - stages.spDef); return (
                          <div>
                            <div><span className="dim">Def</span> <strong>{fmtSign(netDef)}</strong> <span className="dim">(base {fmtSign(defBase)}{stages.def? ` • s ${fmtSign(stages.def)}`:''})</span></div>
                            <div><span className="dim">SpD</span> <strong>{fmtSign(netSpD)}</strong> <span className="dim">(base {fmtSign(spdBase)}{stages.spDef? ` • s ${fmtSign(stages.spDef)}`:''})</span></div>
                          </div>
                        ); })()}
                      </div>
                      <div style={{marginTop:6}}><strong>Buffs / Debuffs</strong></div>
                      <div className="dim">Atk {fmtSign(stages.atk)} • Def {fmtSign(stages.def)} • SpA {fmtSign(stages.spAtk)} • SpD {fmtSign(stages.spDef)} • Spe {fmtSign(stages.speed)}</div>
                      <div style={{marginTop:6}} className="dim">Speed <strong>{formatMult(speedMult)}</strong> {status==='par' ? <span className="dim">(PAR)</span> : null} • Total <strong>{totalSpeed}</strong></div>
                    </div>
                  </div>
                  {/* Right: Actions + Ability/Item */}
                  <div style={{display:'grid', gap:8}}>
                    <div style={{display:'flex', justifyContent:'flex-end'}}>
                      <button onClick={()=> nextTurn()}>&gt; Next Turn</button>
                    </div>
                    {(dex && (megaTarget || isMegaNow)) && (
                      <div style={{border:'1px solid #444', borderRadius:6, padding:8, display:'grid', gap:6}}>
                        <div><strong>{isMegaNow ? 'De-Mega' : 'Mega Evolve'}</strong></div>
                        <button onClick={doMegaToggle}>{isMegaNow ? 'De-Mega' : 'Mega Evolve'}</button>
                        {!isMegaNow && megaTarget && ( <div className="dim">Using {(active as any).item || '—'}: toggles to {megaTarget}</div> )}
                      </div>
                    )}
                    <div style={{border:'1px solid #444', borderRadius:6, padding:8}}>
                      <div className="label"><strong>Ability</strong></div>
                      <div className="value">{abilityName || '—'}</div>
                      {abilityText && <div className="dim" style={{fontSize:'0.9em'}}>{abilityText}</div>}
                    </div>
                    <div style={{border:'1px solid #444', borderRadius:6, padding:8}}>
                      <div className="label"><strong>Item</strong></div>
                      <div className="value">{itemName || '—'}</div>
                      {itemText && <div className="dim" style={{fontSize:'0.9em'}}>{itemText}</div>}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
          {/* Stage modifiers */}
          <div style={{marginBottom:8}}>
            {stageChips}
          </div>

          {/* Conditions box */}
          <section style={{border:'1px solid #444', borderRadius:6, padding:8, marginBottom:8, background:'var(--section-bg)'}}>
            <h4 style={{marginTop:0}}>Conditions</h4>
            <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:6}}>
              <span className="dim">Status:</span>
              {[
                {key:'', label:'None', color:'#555', bg:'#333', fg:'#ddd'},
                {key:'par', label:'PAR', color:'#c9c953', bg:'#fff9c4', fg:'#111'},
                {key:'slp', label:'SLP', color:'#7aa7ff', bg:'#e3f2fd', fg:'#111'},
                {key:'brn', label:'BRN', color:'#ff7a59', bg:'#ffe0db', fg:'#111'},
                {key:'frz', label:'FRZ', color:'#9ad6ff', bg:'#e3f2fd', fg:'#111'},
                {key:'psn', label:'PSN', color:'#a65ad9', bg:'#f3e5f5', fg:'#111'},
                {key:'tox', label:'TOX', color:'#6b2c8c', bg:'#ede7f6', fg:'#111'},
              ].map(opt => (
                <button key={opt.key}
                  onClick={()=>{ const v = (opt.key || null) as PrimaryStatus; setStatus(v); if (v !== 'tox') setToxicStage(1); if (v !== 'slp') setSleepTurns(0); }}
                  className={(status||'')===opt.key? 'active': 'secondary'}
                  style={{background:(status||'')===opt.key? (opt as any).bg : 'transparent', borderColor: opt.color, color: (status||'')===opt.key? (opt as any).fg : undefined}}
                >{opt.label}</button>
              ))}
              {status && <span className="dim">Chance: {statusChances[status]}%</span>}
              {status === 'slp' && (
                <span>
                  Turns: <input type="number" min={1} max={3} value={sleepTurns || 1} onChange={(e)=> setSleepTurns(clamp(Number(e.target.value)||1,1,3))} style={{width:60}} />
                </span>
              )}
            </div>
            <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
              <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={confused} onChange={(e)=>{ setConfused(e.target.checked); if (!e.target.checked) setConfuseTurns(0); }} /> Confusion
              </label>
              {confused && (
                <span>
                  Turns: <input type="number" min={1} max={5} value={confuseTurns || 1} onChange={(e)=> setConfuseTurns(clamp(Number(e.target.value)||1,1,5))} style={{width:60}} />
                </span>
              )}
              <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={infatuated} onChange={(e)=> setInfatuated(e.target.checked)} /> Infatuation
              </label>
              <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={cursed} onChange={(e)=> setCursed(e.target.checked)} /> Curse (Ghost)
              </label>
              <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={leeched} onChange={(e)=> setLeeched(e.target.checked)} /> Leech Seed
              </label>
              <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={bound} onChange={(e)=>{ setBound(e.target.checked); if (!e.target.checked) setBindTurns(0); }} /> Bind/Trap
              </label>
              {bound && (
                <span>
                  Turns: <input type="number" min={1} max={5} value={bindTurns || 1} onChange={(e)=> setBindTurns(clamp(Number(e.target.value)||1,1,5))} style={{width:60}} /> <span className="dim">-1/16 max HP</span>
                </span>
              )}
            </div>
            {status === 'frz' && (<div className="dim" style={{marginTop:6}}>~20% thaw chance each turn</div>)}
            {turnLog && <div className="dim" style={{marginTop:6}}>{turnLog}</div>}
          </section>

          {/* Terrain & Weather box */}
          <section style={{border:'1px solid #444', borderRadius:6, padding:8, marginBottom:8, background:'var(--section-bg)'}}>
            <h4 style={{marginTop:0}}>Terrain & Weather</h4>
            <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:6}}>
              <span className="dim">Terrain:</span>
              {[
                {key:'none', label:'None', color:'#555', bg:'#333', fg:'#ddd'},
                {key:'electric', label:'Electric', color:'#ffd54a', bg:'#fff3cd', fg:'#111'},
                {key:'grassy', label:'Grassy', color:'#4caf50', bg:'#e8f5e9', fg:'#111'},
                {key:'misty', label:'Misty', color:'#e1bee7', bg:'#f3e5f5', fg:'#111'},
                {key:'psychic', label:'Psychic', color:'#ab47bc', bg:'#f3e5f5', fg:'#111'},
              ].map(opt => (
                <button key={opt.key}
                  onClick={()=> setTerrain(opt.key)}
                  className={terrain===opt.key? 'active': 'secondary'}
                  style={{background: terrain===opt.key? opt.bg : 'transparent', borderColor: opt.color, color: terrain===opt.key? (opt as any).fg : undefined}}
                >{opt.label}</button>
              ))}
            </div>
            <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>
              <span className="dim">Weather:</span>
              {[
                {key:'none', label:'None', color:'#555', bg:'#333', fg:'#ddd'},
                {key:'sun', label:'Sun', color:'#ff9800', bg:'#fff3e0', fg:'#111'},
                {key:'rain', label:'Rain', color:'#42a5f5', bg:'#e3f2fd', fg:'#111'},
                {key:'sand', label:'Sand', color:'#c2a477', bg:'#f3e5d0', fg:'#111'},
                {key:'hail', label:'Hail/Snow', color:'#90caf9', bg:'#e3f2fd', fg:'#111'},
              ].map(opt => (
                <button key={opt.key}
                  onClick={()=> setWeather(opt.key)}
                  className={weather===opt.key? 'active': 'secondary'}
                  style={{background: weather===opt.key? opt.bg : 'transparent', borderColor: opt.color, color: weather===opt.key? (opt as any).fg : undefined}}
                >{opt.label}</button>
              ))}
            </div>
          </section>

          {/* Moves with effectiveness buttons */}
          <section style={{border:'1px solid #444', borderRadius:6, padding:8, background:'var(--section-bg)'}}>
            <h4 style={{marginTop:0}}>Moves</h4>
            <div style={{display:'grid', gap:8}}>
              {(() => {
                // Use displayed form for STAB/types
                const atkBase = flatAtkMod(active.baseStats.atk);
                const spaBase = flatAtkMod(active.baseStats.spAtk);
                const defBaseTarget = enemy ? flatDefMod(enemy.baseStats.def) : null;
                const spdBaseTarget = enemy ? flatDefMod(enemy.baseStats.spDef) : null;
                const netAtk = clampMod(atkBase + stages.atk);
                const netSpA = clampMod(spaBase + stages.spAtk);
                return active.moves.map((m, idx) => {
                const cat = (m as any).category ?? 'Physical';
                const base = (m as any).power ?? 0;
                const isDamaging = cat !== 'Status' && base > 0;
                const stab = isDamaging && active.types.map(t=>t.toLowerCase()).includes(String((m as any).type).toLowerCase()) ? 1.5 : 1;
                const terrMult = terrainMultiplier(terrain, (m as any).type);
                const weathMult = weatherMultiplier(weather, (m as any).type);
                const burnMult = status === 'brn' && cat === 'Physical' ? 0.5 : 1;
                const mult = moveMult[idx] ?? 1;
                const effPower = isDamaging ? Math.max(0, Math.floor(base * stab * terrMult * weathMult * burnMult * mult)) : null;
                const dice = effPower != null ? diceFromPower(effPower) : null;
                const atkModText = cat === 'Physical' ? `• Mod ${fmtSign(netAtk)}` : (cat === 'Special' ? `• Mod ${fmtSign(netSpA)}` : '');
                const basePow = typeof base === 'number' ? base as number : -1;
                const hasStab = isDamaging && stab > 1;
                const stabPow = basePow >= 0 && hasStab ? Math.floor(basePow * 1.5) : basePow;
                return (
                  <div key={idx} style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center'}}>
                    <div>
                      <div><strong>{m.name}</strong> <span className="dim">({(m as any).type}{cat ? ` • ${cat}` : ''})</span></div>
                      <div className="dim" style={{fontSize:'0.9em'}}>
                        Power {basePow >= 0 ? basePow : '—'}{hasStab ? ` → STAB ${stabPow}` : ''} • Dice {dice ?? '—'} • Acc {((m as any).accuracy === true) ? '—' : (((m as any).accuracy ?? '—'))}
                        {isDamaging && (<>
                          {' '}• Cond {formatMult(terrMult * weathMult * burnMult)} • Eff {effPower} {atkModText}
                        </>)}
                      </div>
                      {(m as any).effect && (
                        <div style={{fontSize:'0.9em'}}>{(m as any).effect}</div>
                      )}
                    </div>
                    <div style={{display:'flex', gap:4}}>
                      {([0.25,0.5,1,2,4] as const).map(multOpt => (
                        <button
                          key={multOpt}
                          className={mult === multOpt ? 'active' : 'secondary'}
                          title={`Apply ${multOpt}x vs target`}
                          onClick={()=> setMoveMult(s=> ({...s, [idx]: multOpt}))}
                        >
                          {multOpt}x
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }); })()}
            </div>
          </section>

          {/* Type chart for this Pokémon (defending) */}
          <section style={{border:'1px solid #444', borderRadius:6, padding:8, marginTop:8, background:'var(--section-bg)'}}>
            <h4 style={{marginTop:0}}>Type Effectiveness (Defending)</h4>
            {(() => {
              const te = computeTypeEffectiveness(active.types);
              const icon = (t: string) => (
                <img
                  key={t}
                  className="pixel"
                  src={`/vendor/showdown/sprites/types/${titleCase(t)}.png`}
                  alt={titleCase(t)}
                  style={{height:18}}
                />
              );
              const renderIcons = (arr: string[]) => (
                arr.length ? (<div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>{arr.map(icon)}</div>) : (<span>—</span>)
              );
              return (
              <div style={{display:'grid', gap:6, fontSize:'0.92em'}}>
                <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>4x</strong> {renderIcons(te.quadWeak)}</div>
                <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>2x</strong> {renderIcons(te.weak)}</div>
                <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>1/2x</strong> {renderIcons(te.resist)}</div>
                <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>1/4x</strong> {renderIcons(te.quadResist)}</div>
                <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>Immune</strong> {renderIcons(te.immune)}</div>
              </div>
            ); })()}
          </section>
        </section>

        {/* Right: rules/info tabs */}
        <aside className="panel" style={{padding:8}}>
          <h3>Rules & Info</h3>
          <div className="tabs small" style={{display:'flex', gap:6, marginBottom:8, flexWrap:'wrap'}}>
            <button className={infoTab==='type'?'active':''} onClick={()=>setInfoTab('type')}>Type Chart</button>
            <button className={infoTab==='rules'?'active':''} onClick={()=>setInfoTab('rules')}>Rules</button>
            <button className={infoTab==='conditions'?'active':''} onClick={()=>setInfoTab('conditions')}>Conditions</button>
            <button className={infoTab==='terrain'?'active':''} onClick={()=>setInfoTab('terrain')}>Terrain/Weather</button>
            <button className={infoTab==='hazards'?'active':''} onClick={()=>setInfoTab('hazards')}>Hazards</button>
          </div>
          {infoTab === 'type' && (
            <div style={{background:'var(--section-bg)', border:'1px solid #444', borderRadius:6, padding:8}}>
              <div style={{display:'flex', gap:6, alignItems:'center', marginBottom:8, flexWrap:'wrap'}}>
                <span className="dim">Pick types to analyze:</span>
                <select value={typePick1} onChange={(e)=> setTypePick1(e.target.value)}>
                  <option value="">—</option>
                  {Object.keys(TYPE_CHART).map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
                </select>
                <select value={typePick2} onChange={(e)=> setTypePick2(e.target.value)}>
                  <option value="">—</option>
                  {Object.keys(TYPE_CHART).map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
                </select>
              </div>
              {(() => { 
                const def = [typePick1, typePick2].filter(Boolean) as string[]; 
                const te = def.length ? computeTypeEffectiveness(def) : computeTypeEffectiveness((enemy ?? active).types); 
                const icon = (t: string) => (
                  <img
                    key={t}
                    className="pixel"
                    src={`/vendor/showdown/sprites/types/${titleCase(t)}.png`}
                    alt={titleCase(t)}
                    style={{height:18}}
                  />
                );
                const renderIcons = (arr: string[]) => (
                  arr.length ? (<div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>{arr.map(icon)}</div>) : (<span>—</span>)
                );
                return (
                <div style={{display:'grid', gap:6, fontSize:'0.92em'}}>
                  <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>4x</strong> {renderIcons(te.quadWeak)}</div>
                  <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>2x</strong> {renderIcons(te.weak)}</div>
                  <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>1/2x</strong> {renderIcons(te.resist)}</div>
                  <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>1/4x</strong> {renderIcons(te.quadResist)}</div>
                  <div style={{display:'grid', gridTemplateColumns:'56px 1fr', alignItems:'center'}}><strong>Immune</strong> {renderIcons(te.immune)}</div>
                </div>
              ); })()}
            </div>
          )}
          {infoTab === 'rules' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.4}}>
              <p><strong>HP</strong>: floor(Base HP / 2) + Level. Shedinja: 1.</p>
              <p><strong>STAB</strong>: 1.5x for moves matching any of the user’s types.</p>
              <p><strong>Dice by Power</strong>: D4 (0–29), D6 (30–59), D8 (60–74), D10 (75–84), D12 (85–119), D20 (120+).</p>
              <p><strong>Stat Stages</strong>: Multiplier = (2+n)/2 for n ≥ 0, or 2/(2+|n|) for n &lt; 0. Clamp n ∈ [−6, +6].</p>
              <p><strong>Paralysis</strong>: Speed × 0.5; Burn halves Physical damage.</p>
            </div>
          )}
          {infoTab === 'terrain' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.4}}>
              <p><strong>Terrains</strong></p>
              <p>Electric: Boosts Electric moves ×1.3; grounded Pokémon cannot fall asleep.</p>
              <p>Grassy: Boosts Grass moves ×1.3; end-of-turn healing to grounded Pokémon; weakens Earthquake/Magnitude/Bulldoze.</p>
              <p>Misty: Halves Dragon vs grounded targets; prevents status to grounded Pokémon.</p>
              <p>Psychic: Boosts Psychic moves ×1.3; blocks priority moves vs grounded Pokémon.</p>
              <p><strong>Weather</strong></p>
              <p>Sun: Fire ×1.5, Water ×0.5; some moves change accuracy/effects (e.g., Thunder).</p>
              <p>Rain: Water ×1.5, Fire ×0.5; some moves change accuracy/effects (e.g., Hurricane).</p>
              <p>Sandstorm: Chips −1/16 each turn to non-Rock/Ground/Steel; Rock Sp. Def ×1.5.</p>
              <p>Hail/Snow: Gen 9 Snow removes chip; grants Ice Defense boost ×1.5.</p>
            </div>
          )}
          {infoTab === 'conditions' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.4}}>
              <p><strong>Burn (BRN)</strong>: Attack ×0.5; −1/16 Max HP each turn. Non-volatile.</p>
              <p><strong>Freeze (FRZ)</strong>: Cannot act; ~20% thaw chance each turn. Non-volatile.</p>
              <p><strong>Paralysis (PAR)</strong>: Speed ×0.5; ~25% fail chance per turn. Non-volatile.</p>
              <p><strong>Poison (PSN)</strong>: −1/8 Max HP each turn. Non-volatile.</p>
              <p><strong>Toxic (TOX)</strong>: −(n/16) Max HP each turn; n increases by 1 each turn. Non-volatile.</p>
              <p><strong>Sleep (SLP)</strong>: Cannot act; lasts 1–3 turns. Non-volatile.</p>
              <p><strong>Confusion</strong>: 50% to self-hit instead of moving; lasts 2–5 turns. Volatile.</p>
              <p><strong>Infatuation</strong>: 50% to fail vs opposite gender; ends when source leaves. Volatile.</p>
              <p><strong>Curse (Ghost)</strong>: −1/4 Max HP each turn; cannot switch; ends on switch faint/out. Volatile.</p>
              <p><strong>Leech Seed</strong>: −1/8 Max HP each turn; opponent heals. Volatile.</p>
              <p><strong>Bind/Trap</strong>: −1/16 Max HP each turn; cannot switch; lasts 2–5 turns. Volatile.</p>
            </div>
          )}
          {infoTab === 'hazards' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.4}}>
              <p><strong>Spikes</strong> (stacking): 1 layer −1/8, 2 layers −1/6, 3 layers −1/4 Max HP on switch-in. Grounded only.</p>
              <p><strong>Stealth Rock</strong>: Damage scales by Rock effectiveness; baseline 1/8 Max HP × type effectiveness (e.g., 2x → 1/4, 4x → 1/2).</p>
              <p><strong>Toxic Spikes</strong> (stacking): 1 layer inflicts PSN; 2 layers inflict TOX. Removed by grounded Poison switch-in.</p>
              <p><strong>Sticky Web</strong>: On switch-in, Speed ↓1 stage (grounded only).</p>
              <p><strong>Sandstorm</strong>: −1/16 Max HP each turn to non-Rock/Ground/Steel. Rock Sp. Def ×1.5 (mainline).</p>
              <p><strong>Hail/Snow</strong>: Older Hail −1/16 to non-Ice; Gen 9 Snow grants Ice Defense ×1.5 (no chip).</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function shortStat(k: 'atk'|'def'|'spAtk'|'spDef'|'speed') {
  return k==='spAtk' ? 'SpA' : k==='spDef' ? 'SpD' : k==='speed' ? 'Spe' : k==='atk' ? 'Atk' : 'Def';
}

// Local helpers (mirror SidePanel behavior)
function diceFromPower(power: number): 'D20'|'D12'|'D10'|'D8'|'D6'|'D4'|null {
  if (power >= 120) return 'D20';
  if (power >= 85) return 'D12';
  if (power >= 75) return 'D10';
  if (power >= 60) return 'D8';
  if (power >= 30) return 'D6';
  if (power >= 0) return 'D4';
  return null;
}

function formatMult(n: number): string {
  const m = Math.round(n * 100) / 100;
  return `${m}x`;
}

function titleCase(s: string): string { return String(s||'').split(/[\-\s]/).map(w => w ? w[0].toUpperCase()+w.slice(1) : w).join(' '); }

function terrainMultiplier(terrain: string, moveType: string): number {
  const t = terrain.toLowerCase();
  const mt = String(moveType || '').toLowerCase();
  if (t === 'electric' && mt === 'electric') return 1.3;
  if (t === 'grassy' && mt === 'grass') return 1.3;
  if (t === 'psychic' && mt === 'psychic') return 1.3;
  // Misty reduces Dragon vs grounded targets; we don't know grounded here, skip reduction.
  return 1;
}

function weatherMultiplier(weather: string, moveType: string): number {
  const w = weather.toLowerCase();
  const mt = String(moveType || '').toLowerCase();
  if (w === 'sun') {
    if (mt === 'fire') return 1.5;
    if (mt === 'water') return 0.5;
  }
  if (w === 'rain') {
    if (mt === 'water') return 1.5;
    if (mt === 'fire') return 0.5;
  }
  // Sand/Hail effects not directly modeled to power here.
  return 1;
}

function stageMultiplier(stage: number): number {
  const s = clampStage(stage);
  if (s >= 0) return (2 + s) / 2;
  return 2 / (2 + Math.abs(s));
}

function clampStage(n: number): number { return Math.max(-6, Math.min(6, n|0)); }

// Flat modifiers per TTRPG rules
function flatAtkMod(base: number): number {
  if (base >= 200) return 7;
  if (base >= 150) return 5;
  if (base >= 120) return 4;
  if (base >= 100) return 3;
  if (base >= 80) return 2;
  if (base >= 60) return 1;
  return 0;
}

function flatDefMod(base: number): number {
  if (base >= 150) return -4;
  if (base >= 120) return -3;
  if (base >= 100) return -2;
  if (base >= 80) return -1;
  if (base >= 60) return 0;
  return 1;
}

function clampMod(n: number): number {
  // Keep within a sensible range: attackers up to +7, defenders down to -6
  return Math.max(-6, Math.min(7, Math.round(n)));
}

function fmtSign(n: number): string { return n > 0 ? `+${n}` : String(n); }

// Apply end-of-turn effects and timers
function useNextTurn(
  deps: {
    status: PrimaryStatus;
    setStatus: (s: PrimaryStatus)=>void;
    hp: number; setHp: (n:number)=>void; maxHp: number;
    cursed: boolean; leeched: boolean; bound: boolean;
    bindTurns: number; setBindTurns: (n:number)=>void;
    sleepTurns: number; setSleepTurns: (n:number)=>void;
    toxicStage: number; setToxicStage: (n:number)=>void;
    confused: boolean; confuseTurns: number; setConfuseTurns: (n:number)=>void;
    setTurnLog: (s:string)=>void;
  }
) {
  return () => {
    const { status, setStatus, hp, setHp, maxHp, cursed, leeched, bound, bindTurns, setBindTurns, sleepTurns, setSleepTurns, toxicStage, setToxicStage, confused, confuseTurns, setConfuseTurns, setTurnLog } = deps;
    let newHp = hp;
    const events: string[] = [];
    const tick = (frac: number, label: string) => {
      const dmg = Math.max(1, Math.floor(maxHp * frac));
      newHp = Math.max(0, newHp - dmg);
      events.push(`${label} -${dmg}`);
    };

    // Non-volatile damage
    if (status === 'brn') tick(1/16, 'Burn');
    if (status === 'psn') tick(1/8, 'Poison');
    if (status === 'tox') { tick((toxicStage)/16, `Toxic x${toxicStage}`); setToxicStage(Math.min(15, toxicStage + 1)); }

    // Volatile effects
    if (cursed) tick(1/4, 'Curse');
    if (leeched) tick(1/8, 'Leech Seed');
    if (bound) { tick(1/16, 'Bind'); if (bindTurns > 0) setBindTurns(bindTurns - 1); }

    // Timers decrement
    if (status === 'slp') {
      if (sleepTurns > 1) setSleepTurns(sleepTurns - 1); else { setSleepTurns(0); setStatus(null); events.push('Woke up'); }
    }
    if (confused) {
      if (confuseTurns > 1) setConfuseTurns(confuseTurns - 1); else { setConfuseTurns(0); events.push('Confusion ended'); }
    }

    setHp(newHp);
    setTurnLog(events.join(' • '));
  };
}

// === Type chart (local copy to keep BattleTab self-contained) ===
const TYPE_CHART: Record<string, Record<string, number>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, fairy: 0.5, ghost: 0 },
  poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
  flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ghost: { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { ghost: 2, psychic: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
  steel: { rock: 2, ice: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 },
};

function computeTypeEffectiveness(defenderTypes: string[]): { quadWeak: string[]; weak: string[]; resist: string[]; quadResist: string[]; immune: string[] } {
  const TYPES = Object.keys(TYPE_CHART);
  const toId = (t: string) => String(t || '').toLowerCase();
  const def = defenderTypes.map(t => toId(t));
  const quadWeak: string[] = [];
  const weak: string[] = [];
  const resist: string[] = [];
  const quadResist: string[] = [];
  const immune: string[] = [];
  for (const atk of TYPES) {
    let mult = 1;
    for (const dt of def) {
      const m = TYPE_CHART[atk][dt];
      if (typeof m === 'number') mult *= m;
    }
    if (mult === 0) immune.push(atk);
    else if (mult === 4) quadWeak.push(atk);
    else if (mult > 1) weak.push(atk);
    else if (mult === 0.25) quadResist.push(atk);
    else if (mult < 1) resist.push(atk);
  }
  const sort = (a: string, b: string) => a.localeCompare(b);
  quadWeak.sort(sort); weak.sort(sort); resist.sort(sort); quadResist.sort(sort); immune.sort(sort);
  return { quadWeak, weak, resist, quadResist, immune };
}
