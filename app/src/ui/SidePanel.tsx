import React, { useEffect, useMemo, useState } from 'react';
import { BattlePokemon } from '../types';
import { spriteUrl, loadShowdownDex, normalizeName, speciesAbilityOptions, toPokemon, prepareBattle, mapMoves, isMoveLegalForSpecies, formatShowdownSet, parseShowdownTeam, speciesFormesInfo, eligibleMegaFormForItem, computeRealStats, loadTeams, saveTeams, createTeam, iconUrl, placeholderSpriteDataURL } from '../data/adapter';

export function SidePanel({ selected, onAdd, onChangeAbility, onAddToSlot, onReplaceSelected, onDeleteSelected }: {
  selected: BattlePokemon | null;
  onAdd: (p: BattlePokemon, teamId?: string) => void;
  onChangeAbility?: (nextAbility: string) => void;
  onAddToSlot?: (p: BattlePokemon) => void;
  onReplaceSelected?: (p: BattlePokemon) => void;
  onDeleteSelected?: () => void;
}) {
  if (!selected) return (
    <aside className="panel side">
      <div className="side-header">
        <h2>Add Pokémon</h2>
      </div>
      <AddNewPanel onAdd={onAddToSlot} />
    </aside>
  );

  const [dex, setDex] = useState<any>(null);
  const [abilityDesc, setAbilityDesc] = useState<string>('');
  const [itemText, setItemText] = useState<string>('');
  const [itemDesc, setItemDesc] = useState<string>('');
  const [abilityOpts, setAbilityOpts] = useState<string[]>([]);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [activeEditSection, setActiveEditSection] = useState<'basics'|'ability'|'mechanics'|'moves'|null>(null);
  const [speciesInput, setSpeciesInput] = useState<string>('');
  const [nickname, setNickname] = useState<string>(selected.name);
  const [level, setLevel] = useState<number>(selected.level);
  const [abilitySel, setAbilitySel] = useState<string>(selected.ability || '');
  const [movesInput, setMovesInput] = useState<string[]>(selected.moves.map(m=>m.name));
  const [itemSel, setItemSel] = useState<string>(((selected as any).item as string) || '');
  const [shinySel, setShinySel] = useState<boolean>(!!selected.shiny);
  const [importText, setImportText] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const basicsRef = React.useRef<HTMLDivElement|null>(null);
  const abilityRef = React.useRef<HTMLDivElement|null>(null);
  const mechanicsRef = React.useRef<HTMLDivElement|null>(null);
  const movesRef = React.useRef<HTMLDivElement|null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const d = await loadShowdownDex();
      if (!mounted) return;
      setDex(d);
      const abil = selected.ability ? Object.values(d.abilities).find((a: any) => normalizeName((a as any).name) === normalizeName(selected.ability!)) : undefined;
      const heldName = (selected as any).item as string | undefined;
      const item = heldName ? Object.values(d.items).find((i: any) => normalizeName((i as any).name) === normalizeName(heldName)) : undefined;
      setAbilityDesc((abil as any)?.shortDesc || (abil as any)?.desc || '');
      setItemText((item as any)?.name || heldName || '—');
      setItemDesc((item as any)?.shortDesc || (item as any)?.desc || '');
      const speciesId = selected.species || selected.name;
      const opts = speciesAbilityOptions(speciesId, d.pokedex);
      setAbilityOpts(opts);
      setSpeciesInput(speciesId);
      setNickname(selected.name);
      setLevel(selected.level);
      setAbilitySel(selected.ability || (opts[0] || ''));
      // reset item/shiny and moves for this selected pokemon
      setItemSel(heldName || '');
      setShinySel(!!selected.shiny);
      const names = selected.moves.map(m=>m.name);
      while (names.length < 4) names.push('');
      setMovesInput(names);
      setConfirmDelete(false);
    })();
    return () => { mounted = false; };
  }, [selected]);

  const hpPct = Math.round((selected.currentHp / selected.maxHp) * 100);
  const isShedinja = normalizeName(selected.species || selected.name) === 'shedinja';
  const ttrpgMaxHp = isShedinja ? 1 : (Math.floor(selected.baseStats.hp / 2) + selected.level);
  const ttrpgCurrHp = Math.max(0, Math.round((selected.currentHp / selected.maxHp) * ttrpgMaxHp));

  // Real stats (Gen mechanics) based on level/EVs/IVs/nature
  const realStats = useMemo(() => computeRealStats(selected), [selected]);
  const realTotal = realStats.hp + realStats.atk + realStats.def + realStats.spa + realStats.spd + realStats.spe;

  // Toggle between TTRPG view and Real (mechanics) view
  const [viewMode, setViewMode] = useState<'ttrpg'|'real'>('ttrpg');

  const stats = [
    { key: 'hp', label: 'HP', value: selected.baseStats.hp, color: '#ff9aa2' },
    { key: 'atk', label: 'Atk', value: selected.baseStats.atk, color: '#ffb347' },
    { key: 'def', label: 'Def', value: selected.baseStats.def, color: '#ffd56e' },
    { key: 'spAtk', label: 'SpA', value: selected.baseStats.spAtk, color: '#a0a6ff' },
    { key: 'spDef', label: 'SpD', value: selected.baseStats.spDef, color: '#b0ffd4' },
    { key: 'speed', label: 'Spe', value: selected.baseStats.speed, color: '#8fff8f' },
  ] as const;
  const total = stats.reduce((s, x) => s + x.value, 0);
  const toggleShiny = () => {
    const next = { ...selected, shiny: !selected.shiny } as BattlePokemon;
    onReplaceSelected && onReplaceSelected(next);
    setShinySel(!!next.shiny);
  };

  function ZoomableSprite({ species, shiny, cosmetic, back, zoom, onWheel }: { species: string; shiny: boolean; cosmetic?: string; back?: boolean; zoom: number; onWheel?: (e: React.WheelEvent)=>void }) {
    const params: any = cosmetic ? { cosmetic } : {};
    if (back) params.back = true;
    return (
      <div onWheel={onWheel} title="Scroll to zoom"
           style={{ overflow:'hidden', position:'relative', width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:'transparent' }}>
        <img
          className="pixel side-sprite"
          src={spriteUrl(species, shiny, params)}
          alt=""
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          onError={(e)=>{
            const img = e.currentTarget as HTMLImageElement;
            if (img.dataset.fallback) return;
            img.dataset.fallback = '1';
            const p2: any = { setOverride: 'gen5' };
            if (back) p2.back = true; if (cosmetic) p2.cosmetic = cosmetic;
            img.src = spriteUrl(species, shiny, p2);
          }}
        />
      </div>
    );
  }

  const jumpToSection = (s: 'basics'|'ability'|'mechanics'|'moves') => {
    setEditMode(true);
    setActiveEditSection(s);
    const map: Record<string, React.RefObject<HTMLDivElement|null>> = {
      basics: basicsRef,
      ability: abilityRef,
      mechanics: mechanicsRef,
      moves: movesRef,
    };
    setTimeout(() => {
      const el = map[s]?.current; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  // Back/front flip for sprite (independent of shiny toggle)
  const [showBack, setShowBack] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const onWheelZoom = (e: React.WheelEvent) => {
    // Don't call preventDefault to avoid passive listener warning
    const delta = -Math.sign(e.deltaY) * 0.1;
    setZoom(z => Math.max(0.5, Math.min(3, +(z + delta).toFixed(2))));
  };

  // Manual vertical flow: prevent auto equalization of row heights by using a flex column
  return (
    <aside className="panel side" style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {/* Top summary */}
  <div style={{display:'flex', flexDirection:'column', gap:2}}>
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
          <div>
            <h2 style={{margin:'0 0 4px 0'}}>{selected.name}</h2>
            <div style={{fontSize:'0.85em', marginTop:-2}} className="dim">Lv {selected.level} • {selected.types.join(' / ')}</div>
          </div>
            <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
              <button
                title={selected.shiny ? 'Shiny: on' : 'Shiny: off'}
                aria-pressed={selected.shiny ? 'true' : 'false'}
                onClick={toggleShiny}
                style={{
                  border:'1px solid var(--accent)', background:selected.shiny? 'var(--accent)' : '#fff', cursor:'pointer',
                  fontSize:'18px', lineHeight:'18px', padding:'2px 6px', borderRadius:6,
                  color: selected.shiny ? '#fff' : '#444'
                }}
              >{selected.shiny ? '★' : '☆'}</button>
              <button className="mini" onClick={()=> setEditMode(e=>!e)}>{editMode ? 'Close Edit' : 'Edit'}</button>
            </div>
        </div>
        {selected.species && normalizeName(selected.species) !== normalizeName(selected.name) && (
          <div className="dim" style={{fontSize:'0.75em'}}>{selected.species}</div>
        )}
      </div>

      {/* Sprite (full seafoam area, outer border only) */}
  <div style={{ position:'relative', border:'1px solid var(--accent)', borderRadius:8, background:'var(--panel-bg-dark)', padding:0, display:'flex', justifyContent:'center', alignItems:'center', height:132, overflow:'hidden', flexShrink:0 }}>
        <ZoomableSprite species={selected.species || selected.name} shiny={!!selected.shiny} cosmetic={selected.cosmeticForm as any} back={showBack} zoom={zoom} onWheel={onWheelZoom} />
        <div style={{ position:'absolute', top:4, right:4, display:'flex', flexDirection:'column', gap:4 }}>
          <button className="mini" onClick={()=> setShowBack(b=>!b)}>{showBack? 'Front' : 'Back'}</button>
        </div>
        <div style={{ position:'absolute', bottom:4, right:4, display:'flex', gap:4 }}>
          <button className="mini" onClick={()=> setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))}>-</button>
          <button className="mini" onClick={()=> setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))}>+</button>
        </div>
      </div>

      {!editMode && (
        <>
          <div style={{marginTop:6}}>
            <strong>HP</strong>: {ttrpgCurrHp}/{ttrpgMaxHp}
          </div>
          <div className="hpbar large" style={{marginTop:2}} title={`HP ${selected.currentHp}/${selected.maxHp}`}><span style={{ width: `${hpPct}%` }} /></div>

          <div className="stats" style={{border:'1px solid #444', padding:'4px 6px', borderRadius:6, cursor:'pointer', flexShrink:0}} onClick={()=> jumpToSection('mechanics')} title="Click to edit mechanics">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <div className="dim" style={{fontSize:'0.9em'}}>Stats</div>
              <div className="toggle small" role="tablist" aria-label="View Mode">
                <button className={viewMode==='ttrpg'?'active':''} onClick={(e)=>{ e.stopPropagation(); setViewMode('ttrpg'); }} title="Show TTRPG modifiers">TTRPG</button>
                <button className={viewMode==='real'?'active':''} onClick={(e)=>{ e.stopPropagation(); setViewMode('real'); }} title="Show real stats at this level">Regular</button>
              </div>
            </div>
            <div className="stat header" style={{display:'grid',gridTemplateColumns:'auto 1fr 56px 80px',gap:4,alignItems:'center', marginBottom:4}}>
              <div />
              <div />
              <div className="label dim" style={{textAlign:'right'}}>BST</div>
              <div className="label dim" style={{textAlign:'right'}}>{viewMode==='ttrpg' ? 'Modifiers' : 'Real'}</div>
            </div>
            {stats.map(s => {
              const mod = statModifierDisplay(s.key as any, s.value);
              return (
                <div className="stat" key={s.key} style={{display:'grid',gridTemplateColumns:'auto 1fr 56px 80px',gap:4,alignItems:'center'}}>
                  <div className="label" style={{textAlign:'left'}}>{s.label}</div>
                  <div className="bar" aria-valuenow={s.value}>
                    <span style={{ width: `${Math.min(100, (s.value/180)*100)}%`, background: s.color }} />
                  </div>
                  <div className="val">{s.value}</div>
                  {viewMode==='ttrpg' ? (
                    <div className="dim" title="TTRPG modifier" style={{textAlign:'right'}}>{mod}</div>
                  ) : (
                    <div className="val" title="Real stat at this level" style={{textAlign:'right'}}>{
                      s.key==='hp' ? realStats.hp :
                      s.key==='atk' ? realStats.atk :
                      s.key==='def' ? realStats.def :
                      s.key==='spAtk' ? realStats.spa :
                      s.key==='spDef' ? realStats.spd :
                      realStats.spe
                    }</div>
                  )}
                </div>
              );
            })}
            <div className="stat total" style={{display:'grid',gridTemplateColumns:'auto 1fr 56px 80px',alignItems:'center',marginTop:4}}>
              <div className="label">Total</div>
              <div />
              <div className="val" style={{textAlign:'right'}}>{total}</div>
              <div className="val" style={{textAlign:'right'}}>{viewMode==='real' ? realTotal : ''}</div>
            </div>
          </div>

          <div className="ability-item" style={{ cursor:'pointer', marginTop:6, flexShrink:0 }} onClick={()=> jumpToSection('ability')} title="Click to edit ability/item">
            <div>
              <div className="label"><strong>Ability</strong></div>
              <div className="value">{selected.ability || '—'}</div>
              {abilityDesc && <div className="desc dim">{abilityDesc}</div>}
            </div>
            <div>
              <div className="label"><strong>Item</strong></div>
              <div className="value">{itemText}</div>
              {itemDesc && <div className="desc dim">{itemDesc}</div>}
            </div>
          </div>

          {dex && (()=>{
            const held = (selected as any).item as string | undefined;
            const speciesId = selected.species || selected.name;
            const { base } = speciesFormesInfo(speciesId, dex.pokedex);
            const target = eligibleMegaFormForItem(base, held, dex.pokedex);
            const nowEntry = dex.pokedex[normalizeName(speciesId)] || {};
            const nameLooksMega = /(^|[-_\s])mega(\b|[-_\s])/i.test(String(speciesId));
            const isNowMega = !!nowEntry.isMega || nameLooksMega;
            if (!target && !isNowMega) return null;
            const doToggle = async () => {
              if (!dex) return;
              const nextSpecies = isNowMega ? base : (target || base);
              const p0 = toPokemon(nextSpecies, dex.pokedex, selected.level);
              if (!p0) return;
              p0.name = selected.name;
              p0.item = (selected as any).item;
              p0.shiny = selected.shiny;
              p0.moves = selected.moves as any;
              const bp = prepareBattle(p0);
              onReplaceSelected && onReplaceSelected(bp);
            };
            return (
              <div style={{marginTop:8, display:'flex', alignItems:'center', gap:8}}>
                <button onClick={doToggle}>{isNowMega ? '> De-mega' : '> Mega Evolve'}</button>
                {target && !isNowMega && (
                  <span className="dim">Using {held}: toggles to {target}</span>
                )}
              </div>
            );
          })()}

          <section style={{marginTop:6, border:'1px solid #444', borderRadius:6, padding:6, cursor:'pointer', flexShrink:0}} onClick={()=> jumpToSection('moves')} title="Click to edit moves">
            <h4 style={{marginTop:0}}>Moves</h4>
            <div style={{display:'grid', gap:6}}>
              {selected.moves.length === 0 && (
                <div className="dim">No moves yet.</div>
              )}
              {selected.moves.map((m, idx) => {
                const basePow = typeof (m as any).power === 'number' ? (m as any).power as number : -1;
                const hasStab = m.type && selected.types.some(t=> normalizeName(t) === normalizeName(m.type));
                const stabPow = basePow >= 0 ? Math.floor(basePow * (hasStab ? 1.5 : 1)) : -1;
                const die = stabPow >= 0 ? diceFromPower(stabPow) : null;
                return (
                  <div key={idx} style={{display:'grid', gridTemplateColumns:'1fr auto', alignItems:'baseline', gap:8}}>
                    <div>
                      <div><strong>{m.name}</strong> <span className="dim">({m.type}{(m as any).category ? ` • ${(m as any).category}` : ''})</span></div>
                      {viewMode==='ttrpg' ? (
                        <>
                          <div className="dim" style={{fontSize:'0.9em'}}>
                            {basePow >= 0 ? `Power ${basePow}${hasStab ? ` → STAB ${stabPow}` : ''}` : 'Status'}
                            {die ? ` • Dice ${die}` : ''}
                            {(m as any).accuracy != null ? ` • Acc ${(m as any).accuracy === true ? '—' : (m as any).accuracy+'%'}` : ''}
                          </div>
                          {(m as any).effect && <div style={{fontSize:'0.9em'}}>{(m as any).effect}</div>}
                        </>
                      ) : (
                        <div className="dim" style={{fontSize:'0.9em'}}>
                          {basePow >= 0 ? `Power ${basePow}` : 'Status'}
                          {(m as any).accuracy != null ? ` • Acc ${(m as any).accuracy === true ? '—' : (m as any).accuracy+'%'}` : ''}
                          {(m as any).secondary ? ` • Secondary` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {editMode && (
        <div style={{marginTop:12}}>
          <h3><strong>Edit Pokémon</strong></h3>
          <div style={{display:'grid', gap:12}}>
            <section ref={basicsRef}>
              <h4>Basics</h4>
              <div style={{marginTop:8, display:'flex', gap:8, flexWrap:'wrap'}}>
                <button onClick={()=> setShowAddModal(true)} disabled={!onAdd}>&gt; Add to Team</button>
              </div>

              <div style={{display:'grid', gap:8}}>
                <label>
                  <div className="label"><strong>Species</strong></div>
                  <input list="species" value={speciesInput} onChange={e=>setSpeciesInput(e.target.value)} placeholder="e.g., Pikachu" />
                  <datalist id="species">
                    {dex && Object.values(dex.pokedex).filter((s:any)=> !s.baseSpecies || normalizeName(s.baseSpecies)===normalizeName(s.name)).map((s:any)=> <option key={s.name} value={s.name} />)}
                  </datalist>
                </label>
                <label>
                  <div className="label"><strong>Nickname</strong></div>
                  <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Optional" />
                </label>
                <label>
                  <div className="label"><strong>Level</strong></div>
                  <input type="number" min={1} max={100} value={level} onChange={e=>setLevel(Number(e.target.value)||1)} />
                </label>
                <label>
                  <div className="label"><strong>Gender</strong></div>
                  <select value={(selected.gender as any) || 'N'} onChange={e=> (selected as any).gender = e.target.value as any}>
                    <option value="N">None</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8}}>
                  <input type="checkbox" checked={shinySel} onChange={e=>setShinySel(e.target.checked)} /> Shiny
                </label>
              </div>
            </section>

            <section ref={abilityRef}>
              <h4>Ability & Item</h4>
              <div style={{display:'grid', gap:8}}>
                <label>
                  <div className="label"><strong>Ability</strong></div>
                  <select value={abilitySel} onChange={e=>setAbilitySel(e.target.value)} disabled={!speciesInput.trim()}>
                    {abilityOpts.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label>
                  <div className="label"><strong>Item</strong></div>
                  <input list="items" value={itemSel} onChange={e=>setItemSel(e.target.value)} placeholder="Optional" />
                  <datalist id="items">
                    {dex && Object.values(dex.items).map((it:any) => <option key={it.name} value={it.name} />)}
                  </datalist>
                </label>
              </div>
            </section>

            <div ref={mechanicsRef}><MechanicsEditor selected={selected} /></div>

            <section ref={movesRef}>
              <h4>Moves</h4>
              {[0,1,2,3].map((i) => {
                const mv = movesInput[i] ?? '';
                const legal = !dex || !mv ? true : isMoveLegalForSpecies(speciesInput || (selected.species || selected.name), mv, dex.learnsets);
                return (
                  <div key={i} style={{marginBottom:6}}>
                    <input list={`moves-${i}`} value={mv} onChange={e=>{
                      const copy = movesInput.slice();
                      while (copy.length < 4) copy.push('');
                      copy[i] = e.target.value; setMovesInput(copy);
                    }} placeholder="Move name" style={{borderColor: legal ? undefined : 'red', color: legal ? undefined : 'red'}} />
                    <datalist id={`moves-${i}`}>
                      {dex && Object.values(dex.moves).map((m:any)=> <option key={m.name} value={m.name} />)}
                    </datalist>
                    {!legal && <span style={{
                      marginLeft:6,
                      padding:'0 6px',
                      background:'#5a0000',
                      color:'#ffb3b3',
                      border:'1px solid #b30000',
                      borderRadius:4,
                      fontSize:'0.85em'
                    }}>Illegal</span>}
                  </div>
                );
              })}
            </section>

            {dex && (()=>{
              const held = itemSel || ((selected as any).item as string | undefined);
              const speciesId = speciesInput || (selected.species || selected.name);
              const { base } = speciesFormesInfo(speciesId, dex.pokedex);
              const target = eligibleMegaFormForItem(base, held, dex.pokedex);
              const nowEntry = dex.pokedex[normalizeName(speciesId)] || {};
              const nameLooksMega = /(^|[-_\s])mega(\b|[-_\s])/i.test(String(speciesId));
              const isMegaNow = !!nowEntry.isMega || nameLooksMega;
              if (!target && !isMegaNow) return null;
              const doToggle = async () => {
                if (!dex) return;
                const nextSpecies = isMegaNow ? base : (target || base);
                const p0 = toPokemon(nextSpecies, dex.pokedex, level);
                if (!p0) return;
                p0.name = nickname || p0.name;
                p0.item = itemSel || undefined;
                p0.shiny = shinySel;
                p0.moves = mapMoves(movesInput.filter(Boolean), dex.moves);
                const bp = prepareBattle(p0);
                onReplaceSelected && onReplaceSelected(bp);
                setEditMode(false);
              };
              return (
                <section>
                  <h4>Mega Evolution</h4>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <button onClick={doToggle}>{isMegaNow ? '> De-mega' : '> Mega Evolve'}</button>
                    {target && !isMegaNow && (
                      <span className="dim">Using {held}: toggles to {target}</span>
                    )}
                  </div>
                </section>
              );
            })()}

            <section>
              <h4>Import / Export (single)</h4>
              <textarea rows={6} style={{width:'100%'}} value={importText} onChange={e=>setImportText(e.target.value)} placeholder="Paste a single Pokémon set or click Export" />
              <div style={{display:'flex', gap:8, marginTop:6}}>
                <button className="secondary" onClick={()=> setImportText(formatShowdownSet(selected))}>&gt; Export</button>
                <button className="secondary" onClick={()=>{
                  try {
                    const sets = parseShowdownTeam(importText);
                    if (!sets.length) return;
                    const s = sets[0];
                    if (!dex) return;
                    const p = toPokemon(s.species, dex.pokedex, s.level ?? level);
                    if (!p) return;
                    p.name = s.name || p.name;
                    p.species = p.species || s.species;
                    p.ability = s.ability || abilitySel;
                    (p as any).item = s.item || (selected as any).item;
                    p.moves = mapMoves(s.moves || [], dex.moves);
                    const bp = prepareBattle(p);
                    onReplaceSelected && onReplaceSelected(bp);
                  } catch {}
                }}>&gt; Import One</button>
              </div>
            </section>

            <div style={{display:'flex', gap:8, justifyContent:'space-between', marginTop:6}}>
              <div>
                {!confirmDelete ? (
                  <button className="danger" onClick={()=>setConfirmDelete(true)}>&gt; Delete…</button>
                ) : (
                  <>
                    <span className="dim">Are you sure?</span>
                    <button className="danger" onClick={()=>{ onDeleteSelected && onDeleteSelected(); setEditMode(false); setConfirmDelete(false); }}>Yes, delete</button>
                    <button onClick={()=>setConfirmDelete(false)}>Cancel</button>
                  </>
                )}
              </div>
              <div style={{display:'flex', gap:8}}>
                <button onClick={()=>{
                  if (!dex) return;
                  const p0 = toPokemon(speciesInput, dex.pokedex, level);
                  if (!p0) return;
                  p0.name = nickname || p0.name;
                  p0.species = p0.species || speciesInput;
                  p0.ability = abilitySel || p0.ability;
                  p0.item = itemSel || undefined;
                  p0.shiny = shinySel;
                  p0.gender = (selected as any).gender as any;
                  p0.nature = (selected as any).nature;
                  p0.evs = (selected as any).evs;
                  p0.ivs = (selected as any).ivs;
                  p0.moves = mapMoves(movesInput.filter(Boolean), dex.moves);
                  const bp = prepareBattle(p0);
                  onReplaceSelected && onReplaceSelected(bp);
                  setEditMode(false);
                }}>&gt; Save</button>
                <button className="secondary" onClick={()=>setEditMode(false)}>&gt; Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Type Effectiveness */}
  <section style={{marginTop:6, border:'1px solid #444', borderRadius:6, padding:6, background:'var(--section-bg)', flexShrink:0}}>
        <h4 style={{marginTop:0}}>Type Effectiveness</h4>
        {(() => {
          const te = computeTypeEffectiveness(selected.types);
          const icon = (t: string) => (
            <img key={t} className="pixel" src={`/vendor/showdown/sprites/types/${titleCase(t)}.png`} alt={titleCase(t)} style={{height:18}} />
          );
          const renderIcons = (arr: string[], emptyText: string) => (
            arr.length ? (
              <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
                {arr.map(icon)}
              </div>
            ) : <div className="dim">{emptyText}</div>
          );
          return (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:8}}>
              <div>
                <div><strong>4x</strong></div>
                {renderIcons(te.quadWeak, 'None')}
              </div>
              <div>
                <div><strong>2x</strong></div>
                {renderIcons(te.weak, 'None')}
              </div>
              <div>
                <div><strong>1/2x</strong></div>
                {renderIcons(te.resist, 'None')}
              </div>
              <div>
                <div><strong>1/4x</strong></div>
                {renderIcons(te.quadResist, 'None')}
              </div>
              <div>
                <div><strong>Immune</strong></div>
                {renderIcons(te.immune, 'None')}
              </div>
            </div>
          );
        })()}
      </section>

      {!editMode && (
        <div style={{marginTop:4, display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between', alignItems:'center'}}>
          <div style={{display:'flex', gap:8}}>
            <button onClick={()=> setShowAddModal(true)} disabled={!onAdd}>&gt; Add to Team</button>
          </div>
          <div className="dim" style={{fontSize:'0.75em'}}>Tip: Click Stats / Ability / Moves to edit.</div>
        </div>
      )}

      {showAddModal && selected && (
        <AddToTeamModal onClose={()=> setShowAddModal(false)} onPick={(p, teamId)=>{ onAdd && onAdd(p, teamId); setShowAddModal(false); }} selected={selected} />
      )}
    </aside>
  );
}

function AddNewPanel({ onAdd }: { onAdd?: (p: BattlePokemon) => void }) {
  const [dex, setDex] = useState<any>(null);
  const [species, setSpecies] = useState('');
  // Optional cosmetic sprite variant (does not change stats); wired into sprite only
  const [cosmeticForm, setCosmeticForm] = useState<string>('');
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState(50);
  const [ability, setAbility] = useState('');
  const [item, setItem] = useState('');
  const [shiny, setShiny] = useState(false);
  const [moves, setMoves] = useState<string[]>(['', '', '', '']);
  useEffect(() => { (async ()=> setDex(await loadShowdownDex()))(); }, []);
  const abilityOptions = useMemo(() => {
    if (!dex || !species) return [] as string[];
    return speciesAbilityOptions(species, dex.pokedex);
  }, [dex, species]);
  useEffect(()=>{ if (abilityOptions.length) setAbility(abilityOptions[0]); }, [abilityOptions]);
  // Build forme list (base + otherFormes) and cosmetic list for the chosen species
  const formeOptions = useMemo(() => {
    if (!dex || !species) return [] as string[];
    const { base, otherFormes } = speciesFormesInfo(species, dex.pokedex);
    const list = [base, ...(otherFormes||[])].filter(Boolean) as string[];
    // De-dup preserving order
    return Array.from(new Set(list));
  }, [dex, species]);
  const cosmeticOptions = useMemo(() => {
    if (!dex || !species) return [] as string[];
    const { cosmeticFormes } = speciesFormesInfo(species, dex.pokedex);
    return Array.isArray(cosmeticFormes) ? cosmeticFormes : [];
  }, [dex, species]);
  // Ensure cosmetic resets when species/forme changes
  useEffect(()=>{ setCosmeticForm(''); }, [species]);
  const add = async () => {
    if (!dex) return;
    const p = toPokemon(species, dex.pokedex, level);
    if (!p) return;
    p.name = nickname.trim() || p.name;
    p.ability = ability || p.ability;
    p.item = item || undefined;
    p.shiny = shiny;
    p.moves = mapMoves(moves.filter(Boolean), dex.moves);
    if (cosmeticForm) (p as any).cosmeticForm = cosmeticForm;
    const bp = prepareBattle(p);
    onAdd && onAdd(bp);
  };
  return (
    <div style={{display:'grid', gap:12}}>
      <section>
        <h4>Basics</h4>
        <div style={{display:'grid', gap:8}}>
          <label>
            <div className="label"><strong>Species</strong></div>
            <input list="add-species" value={species} onChange={e=>setSpecies(e.target.value)} placeholder="e.g., Urshifu" />
            <datalist id="add-species">
              {dex && Object.values(dex.pokedex).map((s:any)=> <option key={s.name} value={s.name} />)}
            </datalist>
          </label>
          {dex && species && formeOptions.length > 1 && (
            <label>
              <div className="label"><strong>Forme</strong></div>
              <select value={(() => {
                const cur = species;
                const match = formeOptions.find(f => normalizeName(f) === normalizeName(cur));
                return match || formeOptions[0];
              })()}
                onChange={e=> setSpecies(e.target.value)}>
                {formeOptions.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          )}
          {dex && species && cosmeticOptions.length > 0 && (
            <label>
              <div className="label"><strong>Cosmetic</strong> <span className="dim">(sprite only)</span></div>
              <select value={cosmeticForm} onChange={e=> setCosmeticForm(e.target.value)}>
                <option value="">— None —</option>
                {cosmeticOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label>
            <div className="label"><strong>Nickname</strong></div>
            <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Optional" />
          </label>
          <label>
            <div className="label"><strong>Level</strong></div>
            <input type="number" min={1} max={100} value={level} onChange={e=>setLevel(Number(e.target.value)||1)} />
          </label>
          <label style={{display:'flex', alignItems:'center', gap:8}}>
            <input type="checkbox" checked={shiny} onChange={e=>setShiny(e.target.checked)} /> Shiny
          </label>
        </div>
      </section>
      <section>
        <h4>Ability & Item</h4>
        <div style={{display:'grid', gap:8}}>
          <label>
            <div className="label"><strong>Ability</strong></div>
            <select value={ability} onChange={e=>setAbility(e.target.value)} disabled={!species.trim()}>
              {abilityOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            <div className="label"><strong>Item</strong></div>
            <input list="add-items" value={item} onChange={e=>setItem(e.target.value)} placeholder="Optional" />
            <datalist id="add-items">
              {dex && Object.values(dex.items).map((it:any) => <option key={it.name} value={it.name} />)}
            </datalist>
          </label>
        </div>
      </section>
      <section>
        <h4>Moves</h4>
        {moves.map((mv, i) => {
          const legal = !dex || !mv ? true : isMoveLegalForSpecies(species, mv, dex.learnsets);
          return (
            <div key={i} style={{marginBottom:6}}>
              <input list={`add-moves-${i}`} value={mv} onChange={e=>{
                const copy = moves.slice(); copy[i] = e.target.value; setMoves(copy);
              }} placeholder="Move name" style={{borderColor: legal ? undefined : 'red', color: legal ? undefined : 'red'}} />
              <datalist id={`add-moves-${i}`}>
                {dex && Object.values(dex.moves).map((m:any)=> <option key={m.name} value={m.name} />)}
              </datalist>
              {!legal && <span style={{
                marginLeft:6,
                padding:'0 6px',
                background:'#5a0000',
                color:'#ffb3b3',
                border:'1px solid #b30000',
                borderRadius:4,
                fontSize:'0.85em'
              }}>Illegal</span>}
            </div>
          );
        })}
      </section>
      <div>
        <button onClick={add} disabled={!species.trim()}>&gt; Add to this slot</button>
      </div>
    </div>
  );
}

// === TTRPG helpers ===
function statModifierDisplay(stat: 'hp'|'atk'|'def'|'spAtk'|'spDef'|'speed', base: number): string {
  if (stat === 'atk' || stat === 'spAtk') {
    const v = base;
    const mod = v >= 200 ? 7 : v >= 150 ? 5 : v >= 120 ? 4 : v >= 100 ? 3 : v >= 80 ? 2 : v >= 60 ? 1 : 0;
    return mod ? (mod > 0 ? `+${mod}` : `${mod}`) : '—';
  } else if (stat === 'def' || stat === 'spDef') {
    const v = base;
    const mod = v >= 150 ? -4 : v >= 120 ? -3 : v >= 100 ? -2 : v >= 80 ? -1 : v >= 60 ? 0 : 1;
    return mod ? (mod > 0 ? `+${mod}` : `${mod}`) : '—';
  }
  return '—';
}

function diceFromPower(power: number): 'D20'|'D12'|'D10'|'D8'|'D6'|'D4'|null {
  if (power >= 120) return 'D20';
  if (power >= 85) return 'D12';
  if (power >= 75) return 'D10';
  if (power >= 60) return 'D8';
  if (power >= 30) return 'D6';
  if (power >= 0) return 'D4';
  return null;
}

function capitalize(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function titleCase(s: string): string { return s.split(/[\-\s]/).map(capitalize).join(' '); }

// Mechanics editor for EVs/IVs/Nature
function MechanicsEditor({ selected }: { selected: BattlePokemon }) {
  const natures = ['Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky'];
  const [nature, setNature] = useState<string>((selected as any).nature || 'Serious');
  const [evs, setEvs] = useState<Partial<Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe', number>>>((selected as any).evs || {});
  const [ivs, setIvs] = useState<Partial<Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe', number>>>((selected as any).ivs || {});

  const evTotal = ['hp','atk','def','spa','spd','spe'].reduce((s,k)=> s + (Math.max(0, Math.min(252, Math.floor((evs as any)[k] ?? 0))) ), 0);
  const remaining = Math.max(0, 510 - evTotal);
  const clampEV = (v:number)=> Math.max(0, Math.min(252, Math.floor(v)));
  const clampIV = (v:number)=> Math.max(0, Math.min(31, Math.floor(v)));

  useEffect(()=>{ (selected as any).nature = nature; }, [nature]);
  useEffect(()=>{ (selected as any).evs = evs; }, [evs]);
  useEffect(()=>{ (selected as any).ivs = ivs; }, [ivs]);

  const field = (label:string, key:'hp'|'atk'|'def'|'spa'|'spd'|'spe') => {
    const evVal = (evs as any)[key] ?? 0;
    const ivVal = (ivs as any)[key] ?? 31;
    const overCap = evVal > 252;
    return (
      <div style={{display:'grid', gridTemplateColumns:'90px minmax(140px,1fr) 70px 70px', gap:8, alignItems:'center'}}>
        <div className="label">{label}</div>
        <input type="range" min={0} max={252} step={4} value={Math.max(0, Math.min(252, evVal))}
               onChange={e=> setEvs({ ...evs, [key]: clampEV(Number(e.target.value)||0) })} title="EVs slider (0–252)" />
        <input type="number" value={evVal} onChange={e=> setEvs({ ...evs, [key]: Math.floor(Number(e.target.value)||0) })} title="EVs (can exceed cap; warns)" />
        <input type="number" min={0} max={31} value={ivVal} onChange={e=> setIvs({ ...ivs, [key]: clampIV(Number(e.target.value)||0) })} title="IVs (0–31)" />
        {overCap && <div className="dim" style={{gridColumn:'1/-1', color:'#ffb3b3'}}>Warning: EVs exceed 252 for {label}.</div>}
      </div>
    );
  };

  return (
    <section>
      <h4>Mechanics</h4>
      <div style={{display:'grid', gap:8}}>
        <label>
          <div className="label"><strong>Nature</strong></div>
          <select value={nature} onChange={e=> setNature(e.target.value)}>
            {natures.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="dim" style={{marginTop:-4}}>Nature effects are neutral for now.</div>
        <div style={{display:'grid', gridTemplateColumns:'90px minmax(140px,1fr) 70px 70px', gap:8, alignItems:'center', fontWeight:600}}>
          <div />
          <div>EVs</div>
          <div>EVs #</div>
          <div>IVs</div>
        </div>
        {field('HP', 'hp')}
        {field('Atk', 'atk')}
        {field('Def', 'def')}
        {field('SpA', 'spa')}
        {field('SpD', 'spd')}
        {field('Spe', 'spe')}
        <div className="dim">EVs total: {evTotal} / 510 • Remaining: {remaining}</div>
        {evTotal > 510 && (
          <div className="dim" style={{color:'#ffb3b3'}}>Warning: Total EVs exceed 510. Real stats will not match legal caps.</div>
        )}
      </div>
    </section>
  );
}

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
  const toId = (t: string) => normalizeName(t);
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

// --- Modal to pick a team or create a new one ---
function AddToTeamModal({ selected, onPick, onClose }: { selected: BattlePokemon; onPick: (p: BattlePokemon, teamId: string) => void; onClose: ()=>void }) {
  const [state, setState] = useState(loadTeams());
  const [teamId, setTeamId] = useState(state.activeId || (state.teams[0]?.id ?? ''));
  const [newName, setNewName] = useState('');
  const create = () => {
    const name = newName.trim(); if (!name) return;
    const t = createTeam(name); const teams = [...state.teams, t];
    const next = { teams, activeId: t.id } as any; setState(next); saveTeams(teams, t.id); setTeamId(t.id); setNewName('');
  };
  const add = () => {
    if (!teamId) return; // must pick or create
    onPick({ ...selected }, teamId);
  };
  const team = state.teams.find(t => t.id === teamId) || null;
  const isFull = !!team && team.members.length >= 6;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" style={{width:420}}>
        <h3 style={{marginTop:0}}>Add to Team</h3>
        <div style={{display:'grid', gap:8}}>
          <label>
            <div className="label"><strong>Existing Team</strong></div>
            <select value={teamId} onChange={e=> setTeamId(e.target.value)}>
              {state.teams.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.members.length}/6{t.members.length>=6 ? ' • FULL' : ''})
                </option>
              ))}
            </select>
          </label>
          {team && (
            <div className="dim" style={{display:'flex', alignItems:'center', gap:8}}>
              <span style={{minWidth:52,textAlign:'right'}}>{team.members.length} / 6</span>
              <div className="hpbar mini" style={{flex:1}}>
                <span style={{width: `${Math.min(100, (team.members.length/6)*100)}%`}} />
              </div>
            </div>
          )}
          <div className="dim" style={{fontSize:'0.9em'}}>Or create a new team:</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:6}}>
            <input value={newName} onChange={e=> setNewName(e.target.value)} placeholder={`Team ${state.teams.length+1}`} />
            <button className="secondary" onClick={create}>+ Create</button>
          </div>
          {team && (
            <div style={{border:'1px solid #444', borderRadius:6, padding:6}}>
              <div className="dim" style={{marginBottom:6}}>Preview</div>
              <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
                {team.members.map((m,i)=> (
                  <div key={i} style={{display:'flex', alignItems:'center', gap:6}} title={`${m.name} • Lv ${m.level}`}>
                    <img className="pixel" src={spriteUrl(m.species || m.name, !!(m as any).shiny, (m as any).cosmeticForm ? { cosmetic: (m as any).cosmeticForm } : undefined)} alt="" style={{width:48,height:48}}
                      onError={(e)=>{
                        const img = e.currentTarget as HTMLImageElement;
                        if (!(img as any).dataset.step) { (img as any).dataset.step = '1'; img.src = spriteUrl(m.species || m.name, !!(m as any).shiny, { setOverride: 'gen5', cosmetic: (m as any).cosmeticForm }); return; }
                        if ((img as any).dataset.step === '1') { (img as any).dataset.step = '2'; img.src = placeholderSpriteDataURL('?'); return; }
                      }}
                    />
                    <span className="dim" style={{fontSize:'0.9em'}}>{m.name}</span>
                  </div>
                ))}
                {team.members.length===0 && <span className="dim">Empty</span>}
              </div>
              {isFull && <div className="dim" style={{marginTop:6, color:'#ffb3b3'}}>Team is full (6/6).</div>}
            </div>
          )}
        </div>
        <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={add} disabled={isFull} title={isFull? 'Team is full':''}>&gt; Add</button>
        </div>
      </div>
    </div>
  );
}
