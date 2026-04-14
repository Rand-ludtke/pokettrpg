import React, { useEffect, useMemo, useRef, useState } from 'react';
import { withPublicBase } from '../utils/publicBase';
import { BattlePokemon } from '../types';
import { spriteUrlWithFallback, loadShowdownDex, normalizeName, speciesFormesInfo, eligibleMegaFormForItem, prepareBattle, toPokemon, loadTeams, computeRealStats } from '../data/adapter';

const DEFAULT_TRAINER_SPRITE = 'acetrainer';

function sanitizeTrainerSpriteId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const value = typeof raw === 'number' && Number.isFinite(raw)
    ? String(Math.trunc(raw))
    : typeof raw === 'string'
      ? raw
      : '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutFragment = trimmed.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  const segments = withoutQuery.replace(/\\/g, '/').split('/').filter(Boolean);
  let candidate = (segments.length ? segments[segments.length - 1] : withoutQuery).replace(/\.png$/i, '').trim();
  if (!candidate) return '';
  candidate = candidate
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  if (!candidate) return '';
  if (candidate.includes('ace-trainer')) {
    candidate = candidate.replace(/ace-trainer/g, 'acetrainer');
  }
  if (candidate === 'pending' || candidate === 'random' || candidate === 'default' || candidate === 'unknown' || candidate === 'none') return '';
  return candidate;
}

function BattleTeamSprite({ species, shiny }: { species: string; shiny?: boolean }) {
  const spriteRef = React.useRef(spriteUrlWithFallback(species, () => {}, { shiny }));
  const [src, setSrc] = React.useState(() => spriteRef.current.src);

  React.useEffect(() => {
    const next = spriteUrlWithFallback(species, (nextUrl) => setSrc(nextUrl), { shiny });
    spriteRef.current = next;
    setSrc(next.src);
  }, [species, shiny]);

  return (
    <img
      className="pixel"
      alt=""
      src={src}
      style={{ width: 48, height: 48 }}
      onError={() => spriteRef.current.handleError()}
    />
  );
}

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
  const [trainerSprite, setTrainerSprite] = useState<string>(() => {
    try {
      const stored = sanitizeTrainerSpriteId(localStorage.getItem('ttrpg.trainerSprite'));
      return stored || DEFAULT_TRAINER_SPRITE;
    } catch {
      return DEFAULT_TRAINER_SPRITE;
    }
  });
  const [battles, setBattles] = useState<Array<{id:string; name:string; format:string; players:string[]; status:'open'|'active'}>>([]);
  const [challengeFormat, setChallengeFormat] = useState<string>('Singles');
  const [challengeTeamId, setChallengeTeamId] = useState<string>('');
  const teamsState = loadTeams();
  useEffect(()=>{ try { localStorage.setItem('ttrpg.trainerSprite', trainerSprite); } catch {} }, [trainerSprite]);
  const teamList = team ?? (friendly ? [friendly] : []);
  const [activeIdx, setActiveIdx] = useState(0);
  const active = teamList[activeIdx] ?? friendly;

  // Persistent per-Pokemon battle state (survives tab switches)
  type PerPokemonState = {
    hp: number;
    stages: { atk: number; def: number; spAtk: number; spDef: number; speed: number };
    status: PrimaryStatus;
    confused: boolean; confuseTurns: number;
    infatuated: boolean; cursed: boolean; leeched: boolean;
    bound: boolean; bindTurns: number;
    sleepTurns: number; toxicStage: number;
  };
  const defaultState = (p: BattlePokemon): PerPokemonState => ({
    hp: p.currentHp,
    stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 },
    status: null, confused: false, confuseTurns: 0,
    infatuated: false, cursed: false, leeched: false,
    bound: false, bindTurns: 0, sleepTurns: 0, toxicStage: 1,
  });
  const [pokemonStates, setPokemonStates] = useState<Record<number, PerPokemonState>>(() => {
    const init: Record<number, PerPokemonState> = {};
    teamList.forEach((p, i) => { init[i] = defaultState(p); });
    return init;
  });
  const getState = (idx: number): PerPokemonState => pokemonStates[idx] || (teamList[idx] ? defaultState(teamList[idx]) : defaultState(active!));
  const updateState = (idx: number, patch: Partial<PerPokemonState>) => {
    setPokemonStates(prev => ({ ...prev, [idx]: { ...getState(idx), ...patch } }));
  };

  // Current active state accessors
  const pState = getState(activeIdx);
  const hp = pState.hp;
  const setHp = (v: number) => updateState(activeIdx, { hp: v });
  const stages = pState.stages;
  const setStages = (fn: (s: typeof pState.stages) => typeof pState.stages) => updateState(activeIdx, { stages: fn(pState.stages) });
  const status = pState.status;
  const setStatus = (s: PrimaryStatus) => updateState(activeIdx, { status: s });
  const confused = pState.confused;
  const setConfused = (v: boolean) => updateState(activeIdx, { confused: v });
  const confuseTurns = pState.confuseTurns;
  const setConfuseTurns = (v: number) => updateState(activeIdx, { confuseTurns: v });
  const infatuated = pState.infatuated;
  const setInfatuated = (v: boolean) => updateState(activeIdx, { infatuated: v });
  const cursed = pState.cursed;
  const setCursed = (v: boolean) => updateState(activeIdx, { cursed: v });
  const leeched = pState.leeched;
  const setLeeched = (v: boolean) => updateState(activeIdx, { leeched: v });
  const bound = pState.bound;
  const setBound = (v: boolean) => updateState(activeIdx, { bound: v });
  const bindTurns = pState.bindTurns;
  const setBindTurns = (v: number) => updateState(activeIdx, { bindTurns: v });
  const sleepTurns = pState.sleepTurns;
  const setSleepTurns = (v: number) => updateState(activeIdx, { sleepTurns: v });
  const toxicStage = pState.toxicStage;
  const setToxicStage = (v: number) => updateState(activeIdx, { toxicStage: v });
  const [terrain, setTerrain] = useState<string>('none');
  const [weather, setWeather] = useState<string>('none');
  const [moveMult, setMoveMult] = useState<Record<number, number>>({});
  const [turnLog, setTurnLog] = useState<string>('');
  const [infoTab, setInfoTab] = useState<'type'|'quickref'|'rules'|'conditions'|'terrain'|'hazards'|'boss'|'bond'>('quickref');
  const [typePick1, setTypePick1] = useState<string>('');
  const [typePick2, setTypePick2] = useState<string>('');
  const [initiativeRoll, setInitiativeRoll] = useState<{ friendly: number | null; enemy: number | null; winner: 'friendly' | 'enemy' | 'tie' | null; rolledAt: number | null }>({ friendly: null, enemy: null, winner: null, rolledAt: null });

  // Dex data for ability/item descriptions and mega logic
  const [dex, setDex] = useState<any | null>(null);
  useEffect(() => { (async () => { const d = await loadShowdownDex(); setDex(d); })(); }, []);

  const friendlyLabel = friendly?.name || friendly?.species || 'You';
  const enemyLabel = enemy?.name || enemy?.species || 'Opponent';

  const rollInitiative = () => {
    const rollD20 = () => Math.floor(Math.random() * 20) + 1;
    const friendlyValue = rollD20();
    const enemyValue = rollD20();
    let winner: 'friendly' | 'enemy' | 'tie' = 'tie';
    if (friendlyValue > enemyValue) winner = 'friendly';
    else if (enemyValue > friendlyValue) winner = 'enemy';
    setInitiativeRoll({ friendly: friendlyValue, enemy: enemyValue, winner, rolledAt: Date.now() });
  };

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
    if (!dex || !active) return false;
    const speciesId = active.species || active.name;
    const nowEntry = dex.pokedex[normalizeName(speciesId)] || {};
    // Check if the dex entry has isMega flag, or if the name contains "mega"
    const nameLooksMega = /(^|[-_\s])mega(\b|[-_\s])/i.test(String(speciesId));
    return !!nowEntry.isMega || nameLooksMega;
  }, [dex, active]);

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
              <button key={`${p.name}-${idx}`} className={idx===activeIdx?'active':''} onClick={()=> setActiveIdx(idx)} style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:8,alignItems:'center'}}>
                <BattleTeamSprite species={p.species || p.name} shiny={!!p.shiny} />
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
          {/* Computed (level-adjusted) stats – available to all sections */}
          {(() => {
            const cs = active.computedStats || computeRealStats(active);
            const speedMult = stageMultiplier(stages.speed) * (status==='par' ? 0.5 : 1);
            const totalSpeed = Math.floor(cs.spe * speedMult);
          return (<>
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
                      <div style={{display:'flex', gap:6, marginTop:4, alignItems:'center'}}>
                        <input id="dmgInput" type="number" min={0} placeholder="Amount" style={{width:80}} onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = Number((e.target as HTMLInputElement).value) || 0;
                            if (v > 0) { setHp(Math.max(0, hp - v)); (e.target as HTMLInputElement).value = ''; }
                          }
                        }} />
                        <button onClick={() => { const el = document.getElementById('dmgInput') as HTMLInputElement; const v = Number(el?.value) || 0; if (v > 0) { setHp(Math.max(0, hp - v)); el.value = ''; } }} style={{background:'#a33', color:'#fff'}}>Take Damage</button>
                        <button onClick={() => { const el = document.getElementById('dmgInput') as HTMLInputElement; const v = Number(el?.value) || 0; if (v > 0) { setHp(Math.min(active.maxHp, hp + v)); el.value = ''; } }} style={{background:'#3a3', color:'#fff'}}>Heal</button>
                      </div>
                    </div>
                    <div style={{border:'1px solid #444', borderRadius:6, padding:6, fontSize:'0.95em'}}>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                        {(() => { const atkBase = flatAtkMod(cs.atk); const spaBase = flatAtkMod(cs.spa); const netAtk = clampMod(atkBase + stages.atk); const netSpA = clampMod(spaBase + stages.spAtk); return (
                          <div style={{borderRight:'1px solid #444', paddingRight:8}}>
                            <div><span className="dim">Atk</span> <strong>{fmtSign(netAtk)}</strong> <span className="dim">(base {fmtSign(atkBase)}{stages.atk? ` • s ${fmtSign(stages.atk)}`:''})</span></div>
                            <div><span className="dim">SpA</span> <strong>{fmtSign(netSpA)}</strong> <span className="dim">(base {fmtSign(spaBase)}{stages.spAtk? ` • s ${fmtSign(stages.spAtk)}`:''})</span></div>
                          </div>
                        ); })()}
                        {(() => { const defBase = flatDefMod(cs.def); const spdBase = flatDefMod(cs.spd); const guardDef = flatGuardMod(cs.def); const guardSpd = flatGuardMod(cs.spd); const netDef = clampMod(defBase - stages.def); const netSpD = clampMod(spdBase - stages.spDef); return (
                          <div>
                            <div><span className="dim">Def</span> <strong>{fmtSign(netDef)}</strong> <span className="dim">(base {fmtSign(defBase)}{stages.def? ` • s ${fmtSign(stages.def)}`:''})</span></div>
                            <div><span className="dim">SpD</span> <strong>{fmtSign(netSpD)}</strong> <span className="dim">(base {fmtSign(spdBase)}{stages.spDef? ` • s ${fmtSign(stages.spDef)}`:''})</span></div>
                            <div><span className="dim">Guard</span> <strong>{fmtSign(guardDef)}</strong> / <strong>{fmtSign(guardSpd)}</strong> <span className="dim">(Def/SpD)</span></div>
                          </div>
                        ); })()}
                      </div>
                      {(() => { const spdBonus = flatSpeedMod(cs.spe); const passiveEvade = 8 + Math.ceil(spdBonus / 2); const movement = Math.floor(cs.spe / 2); return (
                        <div style={{marginTop:6}}>
                          <div className="dim"><span className="dim">Spe</span> <strong>{fmtSign(spdBonus)}</strong> <span className="dim">(calc {cs.spe})</span> • Passive Evade <strong>{passiveEvade}</strong> • Dodge: d12{fmtSign(spdBonus)}</div>
                          <div className="dim">Movement <strong>{movement} ft</strong> / <strong>{Math.floor(movement / 5)}</strong> sq • Speed × turns: {totalSpeed >= (enemy ? ((enemy.computedStats || computeRealStats(enemy)).spe) * 3 : Infinity) ? '3 turns' : totalSpeed >= (enemy ? ((enemy.computedStats || computeRealStats(enemy)).spe) * 2 : Infinity) ? '2 turns' : '1 turn'}</div>
                        </div>
                      ); })()}
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
                const atkBase = flatAtkMod(cs.atk);
                const spaBase = flatAtkMod(cs.spa);
                const enemyCs = enemy ? (enemy.computedStats || computeRealStats(enemy)) : null;
                const defBaseTarget = enemyCs ? flatDefMod(enemyCs.def) : null;
                const spdBaseTarget = enemyCs ? flatDefMod(enemyCs.spd) : null;
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
                const atkModVal = cat === 'Physical' ? netAtk : (cat === 'Special' ? netSpA : 0);
                const atkModText = cat === 'Physical' ? `• Mod ${fmtSign(netAtk)}` : (cat === 'Special' ? `• Mod ${fmtSign(netSpA)}` : '');
                const accVal = (m as any).accuracy;
                const accBon = accuracyBonus(accVal);
                const atkCheck = accBon !== null ? `d12${fmtSign(accBon + Math.floor(atkModVal / 2))}` : 'auto-hit';
                const cBonus = effPower != null ? clashBonus(effPower) : 0;
                const basePow = typeof base === 'number' ? base as number : -1;
                const hasStab = isDamaging && stab > 1;
                const stabPow = basePow >= 0 && hasStab ? Math.floor(basePow * 1.5) : basePow;
                return (
                  <div key={idx} style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center'}}>
                    <div>
                      <div><strong>{m.name}</strong> <span className="dim">({(m as any).type}{cat ? ` • ${cat}` : ''})</span></div>
                      <div className="dim" style={{fontSize:'0.9em'}}>
                        Power {basePow >= 0 ? basePow : '—'}{hasStab ? ` → STAB ${stabPow}` : ''} • Dice {dice ?? '—'} • Acc {accVal === true ? '∞' : (accVal ?? '—')}
                        {isDamaging && (<>
                          {' '}• Cond {formatMult(terrMult * weathMult * burnMult)} • Eff {effPower} {atkModText}
                          {' '}• Atk Check: {atkCheck} • Clash {fmtSign(cBonus)}
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
                          style={mult === multOpt ? {background:'#666', color:'#fff', fontWeight:700, border:'2px solid #aaa'} : {opacity:0.6}}
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
                  src={withPublicBase(`vendor/showdown/sprites/types/${titleCase(t)}.png`)}
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

          {/* Field Stats (TTRPG skill checks) */}
          <section style={{border:'1px solid #444', borderRadius:6, padding:8, marginTop:8, background:'var(--section-bg)'}}>
            <h4 style={{marginTop:0}}>Field Stats</h4>
            {(() => {
              const types = (active.types || []).map((t: string) => t.toLowerCase());
              const TYPE_BONUS: Record<string, string> = {
                normal:'charm', fire:'charm', water:'fortitude', electric:'athletics',
                grass:'charm', ice:'athletics', fighting:'strength', poison:'intelligence',
                ground:'strength', flying:'athletics', psychic:'intelligence', bug:'athletics',
                rock:'fortitude', ghost:'intelligence', dragon:'strength', dark:'intelligence',
                steel:'fortitude', fairy:'charm',
                nuclear:'intelligence', cosmic:'intelligence', shadow:'intelligence',
                sound:'charm',
              };
              const tbonus = (stat: string) => {
                let b = 0;
                for (const t of types) { if (TYPE_BONUS[t] === stat) b++; }
                return Math.min(b, 2);
              };
              const ceil10 = (x: number) => Math.ceil(x / 10);
              const ceil20 = (x: number) => Math.ceil(x / 20);
              const clamp = (x: number) => Math.max(3, x);
              const fStats = [
                { label: 'Strength',     value: clamp(ceil10(cs.atk) + tbonus('strength')),     color: '#ffb347' },
                { label: 'Athletics',    value: clamp(ceil10(cs.spe) + tbonus('athletics')),   color: '#8fff8f' },
                { label: 'Intelligence', value: clamp(ceil20(cs.spa + cs.spd) + tbonus('intelligence')), color: '#a0a6ff' },
                { label: 'Fortitude',    value: clamp(ceil20(cs.hp + cs.def) + tbonus('fortitude')),         color: '#ffd56e' },
                { label: 'Charm',        value: clamp(ceil20(cs.hp + cs.spd) + tbonus('charm')),           color: '#ff9aa2' },
              ];
              return (
                <div style={{display:'grid', gap:4}}>
                  {fStats.map(fs => (
                    <div key={fs.label} style={{display:'grid', gridTemplateColumns:'90px 1fr 36px 46px', gap:4, alignItems:'center'}}>
                      <div className="dim">{fs.label}</div>
                      <div className="bar" aria-valuenow={fs.value}>
                        <span style={{ width: `${Math.min(100, (fs.value / 40) * 100)}%`, background: fs.color }} />
                      </div>
                      <div style={{textAlign:'right'}}>{fs.value}</div>
                      <div className="dim" style={{textAlign:'right', fontSize:'0.85em'}}>+{Math.ceil(fs.value / 2)}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>
        </>); })()}
        </section>

        {/* Right: rules/info tabs */}
        <aside className="panel" style={{padding:8, overflowY:'auto', maxHeight:'85vh'}}>
          <h3>Rules & Info</h3>
          <div className="tabs small" style={{display:'flex', gap:6, marginBottom:8, flexWrap:'wrap'}}>
            <button className={infoTab==='quickref'?'active':''} onClick={()=>setInfoTab('quickref')}>Quick Ref</button>
            <button className={infoTab==='type'?'active':''} onClick={()=>setInfoTab('type')}>Type Chart</button>
            <button className={infoTab==='rules'?'active':''} onClick={()=>setInfoTab('rules')}>Damage</button>
            <button className={infoTab==='conditions'?'active':''} onClick={()=>setInfoTab('conditions')}>Conditions</button>
            <button className={infoTab==='terrain'?'active':''} onClick={()=>setInfoTab('terrain')}>Terrain</button>
            <button className={infoTab==='boss'?'active':''} onClick={()=>setInfoTab('boss')}>Boss</button>
            <button className={infoTab==='bond'?'active':''} onClick={()=>setInfoTab('bond')}>Bond</button>
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
                    src={withPublicBase(`vendor/showdown/sprites/types/${titleCase(t)}.png`)}
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
          {infoTab === 'quickref' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.5}}>
              <p><strong>Standard Battle Round</strong></p>
              <p>Each side gets: 1 Trainer action, trainer movement, 1 Trainer reaction, each active Pokémon gets at least 1 turn + 1 reaction.</p>
              <p><strong>Turn Order</strong>: Higher Speed acts first. At 2× opponent Speed → 2 turns. At 3× → 3 turns (cap 3). Ties → trainer Initiative. Priority moves jump the line.</p>
              <hr/>
              <p><strong>Pokémon Actions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Use a damaging move</li>
                <li>Use a status / setup / terrain / weather / screen move</li>
                <li>Sprint (extra half-Speed movement instead of attacking)</li>
                <li>Battlefield interaction (break gate, carry objective, move rubble)</li>
                <li>Hold position / protect a trainer or objective</li>
                <li><strong>Prepare</strong>: brace or watch a lane — next dodge/block is with advantage</li>
              </ul>
              <p><strong>Pokémon Reactions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li><strong>Dodge</strong>: d12 + Speed bonus</li>
                <li><strong>Block</strong>: d12 + Guard bonus (Def vs Physical, SpDef vs Special)</li>
                <li>Intercept with Protect / Detect / Wide Guard / Quick Guard</li>
              </ul>
              <hr/>
              <p><strong>Trainer Actions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Throw healing item or battle tool</li>
                <li>Direct strike (unarmed 1d4, weapon/baton 1d6, thrown 1d4)</li>
                <li>Shove, grapple, or body-block</li>
                <li>Trigger trap / gadget / device</li>
                <li><strong>Prepare</strong>: raise cover or steady — grants advantage on next defensive roll</li>
                <li><strong>Hold On</strong> speech: set on allied Pokémon, later spend reaction when it’d hit 0 HP → d12 + SCH bonus, 12+ = survives at 1 HP, 16+ = also keeps reaction</li>
                <li>Cheer, direct, warn (reposition or timing shift)</li>
              </ul>
              <p><strong>Trainer Reactions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Dodge: d12 + Athletics combat bonus</li>
                <li>Block: d12 + Fortitude combat bonus</li>
                <li>Cash in Hold On when allied Pokémon would hit 0 HP</li>
                <li>Intercept item/hazard, warn a Pokémon</li>
              </ul>
              <hr/>
              <p><strong>Trainer Attack Check</strong>: d12 + relevant trainer combat bonus + floor(Athletics bonus / 2)</p>
              <p><strong>Trainer Combat Bonus</strong>: 5–7 → +0, 8–11 → +1, 12–15 → +2, 16–19 → +3, 20+ → +4</p>
              <p><strong>Trainer Movement</strong>: Athletics 5–7 → 15 ft, 8–11 → 20 ft, 12–15 → 25 ft, 16–19 → 30 ft, 20+ → 35 ft</p>
              <hr/>
              <p><strong>Accuracy → Attack Check</strong></p>
              <p>d12 + accuracy bonus + floor(offensive bonus / 2)</p>
              <p>Acc 100 → +4, 95 → +3, 90 → +2, 85 → +1, 80 → +0, 75 → −1, 70 → −2, 60–65 → −3, 50–55 → −4, 30–45 → −5</p>
              <p><strong>Passive Evade</strong>: 8 + ceil(Speed bonus / 2)</p>
              <hr/>
              <p><strong>Block Results</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Beat by 10+ → −4 die steps</li>
                <li>Beat by 5–9 → −3 die steps</li>
                <li>Beat by 1–4 → −2 die steps</li>
                <li>Lose by 1–4 with defensive line → −1 die step</li>
                <li>Never below 1d4 unless fully negated</li>
              </ul>
              <hr/>
              <p><strong>Clash</strong>: d12 + combat bonus + clash power bonus (0–29: +0, 30–49: +1, 50–69: +2, 70–89: +3, 90–109: +4, 110–129: +5, 130+: +6)</p>
              <p><strong>Grappled</strong>: Movement 0, physical attacks clumsier (accuracy penalty), heavy contact drops 1 die step. Break free: Strength or Athletics vs grappler.</p>
            </div>
          )}
          {infoTab === 'quickref' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.5}}>
              <p><strong>Standard Battle Round</strong></p>
              <p>Each side gets: 1 Trainer action, trainer movement, 1 Trainer reaction, each active Pokémon gets at least 1 turn + 1 reaction.</p>
              <p><strong>Turn Order</strong>: Higher Speed acts first. At 2× opponent Speed → 2 turns. At 3× → 3 turns (cap 3). Ties → trainer Initiative. Priority moves jump the line.</p>
              <hr/>
              <p><strong>Pokémon Actions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Use a damaging move</li>
                <li>Use a status / setup / terrain / weather / screen move</li>
                <li>Sprint (extra half-Speed movement instead of attacking)</li>
                <li>Battlefield interaction (break gate, carry objective, move rubble)</li>
                <li>Hold position / protect a trainer or objective</li>
                <li><strong>Prepare</strong>: brace or watch a lane — next dodge/block is with advantage</li>
              </ul>
              <p><strong>Pokémon Reactions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li><strong>Dodge</strong>: d12 + Speed bonus</li>
                <li><strong>Block</strong>: d12 + Guard bonus (Def vs Physical, SpDef vs Special)</li>
                <li>Intercept with Protect / Detect / Wide Guard / Quick Guard</li>
              </ul>
              <hr/>
              <p><strong>Trainer Actions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Throw healing item or battle tool</li>
                <li>Direct strike (unarmed 1d4, weapon/baton 1d6, thrown 1d4)</li>
                <li>Shove, grapple, or body-block</li>
                <li>Trigger trap / gadget / device</li>
                <li><strong>Prepare</strong>: raise cover or steady — grants advantage on next defensive roll</li>
                <li><strong>Hold On</strong> speech: set on allied Pokémon, later spend reaction when it’d hit 0 HP → d12 + SCH bonus, 12+ = survives at 1 HP, 16+ = also keeps reaction</li>
                <li>Cheer, direct, warn (reposition or timing shift)</li>
              </ul>
              <p><strong>Trainer Reactions</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Dodge: d12 + Athletics combat bonus</li>
                <li>Block: d12 + Fortitude combat bonus</li>
                <li>Cash in Hold On when allied Pokémon would hit 0 HP</li>
                <li>Intercept item/hazard, warn a Pokémon</li>
              </ul>
              <hr/>
              <p><strong>Trainer Attack Check</strong>: d12 + relevant trainer combat bonus + floor(Athletics bonus / 2)</p>
              <p><strong>Trainer Combat Bonus</strong>: 5–7 → +0, 8–11 → +1, 12–15 → +2, 16–19 → +3, 20+ → +4</p>
              <p><strong>Trainer Movement</strong>: Athletics 5–7 → 15 ft, 8–11 → 20 ft, 12–15 → 25 ft, 16–19 → 30 ft, 20+ → 35 ft</p>
              <hr/>
              <p><strong>Accuracy → Attack Check</strong></p>
              <p>d12 + accuracy bonus + floor(offensive bonus / 2)</p>
              <p>Acc 100 → +4, 95 → +3, 90 → +2, 85 → +1, 80 → +0, 75 → −1, 70 → −2, 60–65 → −3, 50–55 → −4, 30–45 → −5</p>
              <p><strong>Passive Evade</strong>: 8 + ceil(Speed bonus / 2)</p>
              <hr/>
              <p><strong>Block Results</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Beat by 10+ → −4 die steps</li>
                <li>Beat by 5–9 → −3 die steps</li>
                <li>Beat by 1–4 → −2 die steps</li>
                <li>Lose by 1–4 with defensive line → −1 die step</li>
                <li>Never below 1d4 unless fully negated</li>
              </ul>
              <hr/>
              <p><strong>Clash</strong>: d12 + combat bonus + clash power bonus (0–29: +0, 30–49: +1, 50–69: +2, 70–89: +3, 90–109: +4, 110–129: +5, 130+: +6)</p>
              <p><strong>Grappled</strong>: Movement 0, physical attacks clumsier (accuracy penalty), heavy contact drops 1 die step. Break free: Strength or Athletics vs grappler.</p>
            </div>
          )}
          {infoTab === 'rules' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.5}}>
              <p><strong>HP</strong>: floor(Base HP / 2) + Level. Shedinja: 1.</p>
              <p><strong>STAB</strong>: 1.5× for moves matching any of the user’s types.</p>
              <hr/>
              <p><strong>Damage Steps</strong></p>
              <ol style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Declare move, check reactions</li>
                <li>Roll attack check (if move can miss)</li>
                <li>Apply STAB, weather, terrain, abilities, items, stages, type effectiveness → adjusted power</li>
                <li>Convert adjusted power to damage dice</li>
                <li>Add offensive combat bonus (Atk or SpA)</li>
                <li>Apply defensive modifier (Def or SpD)</li>
                <li>Apply remaining move effects (recoil, status, etc.)</li>
              </ol>
              <p>Minimum 1 damage unless immunity / Protect / Detect negates entirely.</p>
              <hr/>
              <p><strong>Move Power → Damage Dice</strong></p>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.9em'}}>
                <tbody>
                  {[['0–29','1d4'],['30–49','1d6'],['50–69','1d8'],['70–89','1d10'],['90–109','1d12'],['110–129','1d20'],['130–149','1d20+1d4'],['150–169','1d20+1d6'],['170–189','1d20+1d8'],['190–209','1d20+1d10'],['210–229','1d20+1d12'],['230–249','2d20'],['250–269','2d20+1d4']].map(([r,d]) => (
                    <tr key={r}><td style={{padding:'1px 6px', borderBottom:'1px solid #333'}}>{r}</td><td style={{padding:'1px 6px', borderBottom:'1px solid #333', textAlign:'right'}}>{d}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="dim">Above 229: every 120 power adds +1 d20 count. Each 20-step within adds a sub-die (d4→d6→d8→d10→d12).</p>
              <hr/>
              <p><strong>Combat Bonus Bands (Calculated Stat)</strong></p>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.9em'}}>
                <thead><tr><td style={{padding:'1px 4px', borderBottom:'1px solid #555', fontWeight:700}}>Stat</td><td style={{padding:'1px 4px', borderBottom:'1px solid #555', fontWeight:700}}>Atk</td><td style={{padding:'1px 4px', borderBottom:'1px solid #555', fontWeight:700}}>Guard</td><td style={{padding:'1px 4px', borderBottom:'1px solid #555', fontWeight:700}}>Def</td><td style={{padding:'1px 4px', borderBottom:'1px solid #555', fontWeight:700}}>Spd</td></tr></thead>
                <tbody>
                  {[['0–39','+0','+0','+1 taken','+0'],['40–59','+1','+1','0','+1'],['60–79','+2','+2','−1','+2'],['80–99','+3','+3','−2','+3'],['100–119','+4','+4','−3','+4']].map(([r,a,g,d,s]) => (
                    <tr key={r}><td style={{padding:'1px 4px', borderBottom:'1px solid #333'}}>{r}</td><td style={{padding:'1px 4px', borderBottom:'1px solid #333'}}>{a}</td><td style={{padding:'1px 4px', borderBottom:'1px solid #333'}}>{g}</td><td style={{padding:'1px 4px', borderBottom:'1px solid #333'}}>{d}</td><td style={{padding:'1px 4px', borderBottom:'1px solid #333'}}>{s}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="dim">From 100+: every 20 extra stat → +1 Atk/Guard/Speed. Def = 1 − that bonus.</p>
              <hr/>
              <p><strong>Stat Stages</strong>: ×(2+n)/2 for n ≥ 0, or ×2/(2+|n|) for n &lt; 0. Clamp n ∈ [−6, +6].</p>
              <p><strong>Paralysis</strong>: Speed × 0.5; <strong>Burn</strong>: Physical damage × 0.5.</p>
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
              <p><strong>Burn (BRN)</strong>: Physical damage ×0.5; −1/16 Max HP each turn. Non-volatile.</p>
              <p><strong>Freeze (FRZ)</strong>: Cannot act; ~20% thaw chance each turn. Incapacitates bosses for 1 full player round. Non-volatile.</p>
              <p><strong>Paralysis (PAR)</strong>: Speed ×0.5; ~25% fail chance per turn. Non-volatile.</p>
              <p><strong>Poison (PSN)</strong>: −1/8 Max HP each turn. Non-volatile.</p>
              <p><strong>Toxic (TOX)</strong>: −(n/16) Max HP each turn; n increases by 1 each turn. Non-volatile.</p>
              <p><strong>Sleep (SLP)</strong>: Cannot act; lasts 1–3 turns. Incapacitates bosses for 1 full player round. Non-volatile.</p>
              <p><strong>Confusion</strong>: 50% to self-hit instead of moving; lasts 2–5 turns. Volatile.</p>
              <p><strong>Infatuation</strong>: 50% to fail vs opposite gender; ends when source leaves. Volatile.</p>
              <p><strong>Curse (Ghost)</strong>: −1/4 Max HP each turn; cannot switch; ends on switch faint/out. Volatile.</p>
              <p><strong>Leech Seed</strong>: −1/8 Max HP each turn; opponent heals. Volatile.</p>
              <p><strong>Bind/Trap</strong>: −1/16 Max HP each turn; cannot switch; lasts 2–5 turns. Volatile.</p>
            </div>
          )}
          {infoTab === 'boss' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.5}}>
              <p><strong>Boss Incapacitation &amp; Defeat</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li><strong>Sleep / Frozen</strong>: Boss incapacitated for 1 full player round</li>
                <li><strong>Grapple overload</strong>: Enough bodies = incapacitated until break free or next turn</li>
                <li><strong>First break</strong>: First time boss hits 0 HP → incapacitated (not dead)</li>
                <li><strong>Recovery</strong>: At start of next turn → stands back up at 1/16 max HP</li>
                <li><strong>Second break</strong>: 0 HP again after recovery → defeated / captured / rifted</li>
              </ul>
              <hr/>
              <p><strong>Grapple Overload Thresholds</strong></p>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.9em'}}>
                <tbody>
                  {[['Normal large threat','2'],['Very large / multi-limbed','3'],['Huge boss','4'],['Raid-scale monster','5']].map(([s,n]) => (
                    <tr key={s}><td style={{padding:'1px 6px', borderBottom:'1px solid #333'}}>{s}</td><td style={{padding:'1px 6px', borderBottom:'1px solid #333', textAlign:'right'}}>{n} bodies</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="dim">Count both Pokémon and trainers as bodies if they can physically hold the target.</p>
              <hr/>
              <p><strong>Trainer Support Actions (Boss Fights)</strong></p>
              <p>Each trainer gets <strong>1 Support Action</strong> per turn in addition to commanding their Pokémon.</p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Deploy or trigger a prepared trap</li>
                <li>Throw healing item or hand gear to ally</li>
                <li>Mark weak terrain or call a target lane</li>
                <li>Stabilize a device, anchor, or hazard panel</li>
                <li>Recall and resend gear, rope, or support tools</li>
              </ul>
              <p className="dim">Traps: 1 Support Action to place if prepared, 1 to trigger. Usually create control/positioning/openings. Max 1 trap payoff per round.</p>
              <hr/>
              <p><strong>Boss Damage Dice Checkpoints</strong></p>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.9em'}}>
                <tbody>
                  {[['350–369','3d20'],['470–489','4d20'],['590–609','5d20'],['710–729','6d20'],['830–849','7d20'],['950–969','8d20'],['970–989','8d20+1d4'],['990–1000','8d20+1d6']].map(([r,d]) => (
                    <tr key={r}><td style={{padding:'1px 6px', borderBottom:'1px solid #333'}}>{r}</td><td style={{padding:'1px 6px', borderBottom:'1px solid #333', textAlign:'right'}}>{d}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {infoTab === 'bond' && (
            <div className="dim" style={{fontSize:'0.92em', lineHeight:1.5}}>
              <p><strong>Battle Bond (Trait)</strong></p>
              <p>Obtained through Fusion Machine / Bond Sync setup. Temporary buff, not permanent.</p>
              <hr/>
              <p><strong>Effect</strong>: +1 stage to one offensive stat AND +1 stage Speed.</p>
              <p><strong>Requirements</strong>:</p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Trainer Fortitude ≥ 15</li>
                <li>Partner Pokémon must have maxed happiness</li>
              </ul>
              <p><strong>Activation</strong>: Once per long rest, on one Pokémon.</p>
              <hr/>
              <p><strong>SP Drain (while active)</strong>:</p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Level 50 and below: <strong>1 SP/turn</strong></li>
                <li>Level 51+: <strong>2 SP/turn</strong></li>
              </ul>
              <p>If trainer cannot pay SP, sync ends immediately. Cannot reactivate until after a long rest.</p>
              <hr/>
              <p><strong>In Combat</strong>:</p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Visible synced state between trainer and Pokémon</li>
                <li>Apply +1 stage offensive + +1 stage Speed</li>
                <li>Track SP drain at end of each synced Pokémon turn</li>
                <li>Treat as combat toggle (on/off)</li>
              </ul>
              <hr/>
              <p><strong>Hold On Speech</strong></p>
              <ul style={{paddingLeft:16, margin:'4px 0'}}>
                <li>Spend trainer action to set on allied Pokémon in command range</li>
                <li>Later: spend trainer reaction when Pokémon would hit 0 HP (from above 1 HP)</li>
                <li>Roll: d12 + SCH combat bonus</li>
                <li>12+ → stays at 1 HP</li>
                <li>16+ → also keeps its next reaction</li>
                <li>Once per trainer per Pokémon per battle</li>
                <li>Without setup: DM may allow at disadvantage</li>
              </ul>
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
// Extended damage die ladder from Battle Quick Reference — supports up to 1000+ adjusted power
function diceFromPower(power: number): string | null {
  if (power < 0) return null;
  // Base ladder 0-229
  const BASE: [number, string][] = [
    [0, '1d4'], [30, '1d6'], [50, '1d8'], [70, '1d10'], [90, '1d12'], [110, '1d20'],
    [130, '1d20 + 1d4'], [150, '1d20 + 1d6'], [170, '1d20 + 1d8'], [190, '1d20 + 1d10'], [210, '1d20 + 1d12'],
  ];
  for (let i = BASE.length - 1; i >= 0; i--) { if (power >= BASE[i][0]) return BASE[i][1]; }
  // Repeating ladder above 229: every 120 power adds +1 to the d20 count, each 20-step within adds a sub-die
  const SUB = ['', ' + 1d4', ' + 1d6', ' + 1d8', ' + 1d10', ' + 1d12'];
  const above = power - 230;
  const cycle = Math.floor(above / 120);
  const step = Math.floor((above % 120) / 20);
  const d20count = 2 + cycle;
  return `${d20count}d20${SUB[Math.min(step, 5)]}`;
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

// Flat modifiers per TTRPG rules — use CALCULATED stat values (not base stats)
// See Battle Quick Reference: Calculated combat bonus bands
// 0-39: +0, 40-59: +1, 60-79: +2, 80-99: +3, then every 20 above 100 adds +1
function flatAtkMod(calcStat: number): number {
  if (calcStat < 40) return 0;
  if (calcStat < 60) return 1;
  if (calcStat < 80) return 2;
  if (calcStat < 100) return 3;
  return 4 + Math.floor((calcStat - 100) / 20);
}

// Guard bonus = same bands as attack bonus (used for Block rolls)
function flatGuardMod(calcStat: number): number {
  return flatAtkMod(calcStat);
}

// Defense/Sp.Def modifier: always 1 - attack bonus at that stat
function flatDefMod(calcStat: number): number {
  return 1 - flatAtkMod(calcStat);
}

// Speed bonus: same bands as attack
function flatSpeedMod(calcStat: number): number {
  return flatAtkMod(calcStat);
}

function clampMod(n: number): number {
  // Allow full range for boss-scale stats (up to +49 atk, down to -48 def per rules)
  return Math.round(n);
}

function fmtSign(n: number): string { return n > 0 ? `+${n}` : String(n); }

// Accuracy bonus from Battle Quick Reference
function accuracyBonus(acc: number | boolean): number | null {
  if (acc === true) return null; // cannot miss
  const a = Number(acc);
  if (!a || a <= 0) return null;
  if (a >= 100) return 4;
  if (a >= 95) return 3;
  if (a >= 90) return 2;
  if (a >= 85) return 1;
  if (a >= 80) return 0;
  if (a >= 75) return -1;
  if (a >= 70) return -2;
  if (a >= 60) return -3;
  if (a >= 50) return -4;
  return -5;
}

// Clash power bonus from Battle Quick Reference
function clashBonus(adjPower: number): number {
  if (adjPower >= 130) return 6;
  if (adjPower >= 110) return 5;
  if (adjPower >= 90) return 4;
  if (adjPower >= 70) return 3;
  if (adjPower >= 50) return 2;
  if (adjPower >= 30) return 1;
  return 0;
}

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
  nuclear: { normal: 2, fire: 2, water: 2, electric: 2, grass: 2, ice: 2, fighting: 2, poison: 2, ground: 2, flying: 2, psychic: 2, bug: 2, rock: 2, ghost: 2, dragon: 2, dark: 2, fairy: 2, cosmic: 2, nuclear: 0.5, steel: 0.5 },
  cosmic: { fairy: 2, normal: 2, nuclear: 2, psychic: 0.5 },
  shadow: { psychic: 2, ghost: 2, normal: 0.5, shadow: 0.5 },
  sound: { psychic: 2, ghost: 2, steel: 0.5, sound: 0.5 },
  crystal: {},
  '???': {},
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
