import React, { useEffect, useMemo, useState } from 'react';

// --- Types ---

type Stats = {
  strength: number;
  athletics: number;
  intelligence: number;
  speech: number;
  fortitude: number;
  luck: number;
};

type InventorySection = {
  key: string; // stable id
  label: string; // display label
  lines: string; // raw multi-line entries
};

type Trait = { name: string; description: string };
type Badge = { name: string; earned: boolean; image?: string };

type Character = {
  name: string;
  stats: Stats;
  inventory: InventorySection[];
  money: number;
  personality: string;
  typeSpecialty: string;
  traits: Trait[];
  badges: Badge[]; // length 8
  level: number;
  hpCurrent: number;
  spCurrent: number;
  trainerImage?: string; // optional custom portrait (data URL)
};

const LS_KEY = 'ttrpg.character';

const DEFAULT_SECTIONS: InventorySection[] = [
  { key: 'items', label: 'Items', lines: '' },
  { key: 'medicine', label: 'Medicine', lines: '' },
  { key: 'balls', label: 'Poké Balls', lines: '' },
  { key: 'berries', label: 'Berries', lines: '' },
  { key: 'key', label: 'Key Items', lines: '' },
  { key: 'tms', label: 'TMs', lines: '' },
  { key: 'battle', label: 'Battle Items', lines: '' },
  { key: 'other', label: 'Other', lines: '' },
];

// --- Persistence + Migration ---
function migrate(raw: any): Character {
  // Handle legacy stub structure
  if (!raw || typeof raw !== 'object') {
    return {
      name: 'Trainer',
      stats: { strength: 0, athletics: 0, intelligence: 0, speech: 0, fortitude: 0, luck: 0 },
      inventory: DEFAULT_SECTIONS,
      money: 0,
      personality: '',
      typeSpecialty: '',
      traits: [],
      badges: Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false, image: undefined })),
      level: 1,
      hpCurrent: 0,
      spCurrent: 0,
      trainerImage: undefined,
    };
  }
  // If already new shape, fill any missing fields
  if (typeof raw.name === 'string' && Array.isArray(raw.badges)) {
    return {
      name: raw.name || 'Trainer',
      stats: {
        strength: Number(raw.stats?.strength || 0),
        athletics: Number(raw.stats?.athletics || 0),
        intelligence: Number(raw.stats?.intelligence || 0),
        speech: Number(raw.stats?.speech || 0),
        fortitude: Number(raw.stats?.fortitude || 0),
        luck: Number(raw.stats?.luck || 0),
      },
      inventory: Array.isArray(raw.inventory) && raw.inventory.length ? raw.inventory.map((s: any, idx: number) => ({ key: s.key || `sec${idx}`, label: s.label || `Section ${idx+1}`, lines: String(s.lines || '') })) : DEFAULT_SECTIONS,
      money: Number(raw.money || 0),
      personality: String(raw.personality || ''),
      typeSpecialty: String(raw.typeSpecialty || ''),
      traits: Array.isArray(raw.traits) ? raw.traits.map((t: any) => ({ name: String(t?.name || ''), description: String(t?.description || '') })) : [],
      badges: Array.isArray(raw.badges) && raw.badges.length ? raw.badges.slice(0,8).map((b: any, i: number) => ({ name: String((b && b.name) || (i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '')), earned: !!(b && b.earned), image: (b && typeof b.image==='string') ? b.image : undefined })) : Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false, image: undefined })),
      level: Number(raw.level || 1),
      hpCurrent: Number(raw.hpCurrent || 0),
      spCurrent: Number(raw.spCurrent || 0),
      trainerImage: (typeof raw.trainerImage === 'string' && raw.trainerImage.startsWith('data:')) ? raw.trainerImage : undefined,
    };
  }
  // Legacy stub -> new
  return {
    name: String(raw.name || 'Trainer'),
    stats: { strength: 0, athletics: 0, intelligence: 0, speech: 0, fortitude: 0, luck: 0 },
    inventory: DEFAULT_SECTIONS,
    money: 0,
    personality: String(raw.notes || ''),
    typeSpecialty: '',
    traits: [],
    badges: Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false, image: undefined })),
    level: 1,
    hpCurrent: 0,
    spCurrent: 0,
    trainerImage: undefined,
  };
}

// --- Helpers ---
function parseInventory(lines: string): Array<{ name: string; count: number }> {
  const out: Array<{ name: string; count: number }> = [];
  const parts = String(lines || '').split(/\r?\n/);
  for (const raw of parts) {
    const line = raw.trim(); if (!line) continue;
    // accept formats: "Name xN", "Name - xN", "Name (xN)", or just "Name"
    let name = line; let count = 1;
    const m = line.match(/^(.*?)(?:\s*[\-–]\s*|\s*\(|\s+)x\s*(\d+)\)?\s*$/i);
    if (m) { name = m[1].trim().replace(/[()\-–]$/,''); count = Math.max(1, Number(m[2])); }
    out.push({ name, count });
  }
  return out;
}
function aggregate(items: Array<{name:string; count:number}>): Array<{name:string; count:number}> {
  const map = new Map<string, number>();
  for (const it of items) {
    const key = it.name.trim(); if (!key) continue;
    map.set(key, (map.get(key) || 0) + Math.max(0, Number(it.count)||0));
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
}
function rebuildLines(list: Array<{name:string; count:number}>): string {
  return list.filter(x => x.count>0).map(x => `${x.name} x${x.count}`).join('\n');
}

type TraitDef = { name: string; desc: string; reqText?: string; require?: (ch: Character) => boolean };
const traitCatalog: TraitDef[] = [
  { name: 'Strong', desc: 'You can lift heavy objects and perform feats of strength.', reqText: 'Strength ≥ 2', require: ch => ch.stats.strength >= 2 },
  { name: 'Enduring', desc: 'You are tough and can push through fatigue.', reqText: 'Fortitude ≥ 2', require: ch => ch.stats.fortitude >= 2 },
  { name: 'Silver Tongue', desc: 'You are persuasive and charismatic.', reqText: 'Speech ≥ 2', require: ch => ch.stats.speech >= 2 },
  { name: 'Athletic', desc: 'You are nimble and fast on your feet.', reqText: 'Athletics ≥ 2', require: ch => ch.stats.athletics >= 2 },
  { name: 'Book Smart', desc: 'Well-read and knowledgeable about many topics.', reqText: 'Intelligence ≥ 2', require: ch => ch.stats.intelligence >= 2 },
  { name: 'Type Ace', desc: 'Specialist of your chosen type; you gain narrative benefits when dealing with that type.', reqText: 'Type Specialty set', require: ch => !!ch.typeSpecialty.trim() },
  { name: 'Lucky', desc: 'Fortune smiles on you more often than not.', reqText: 'Luck ≥ 2', require: ch => ch.stats.luck >= 2 },
];

// --- Component ---
export function CharacterSheet() {
  const [ch, setCh] = useState<Character>(() => {
    try { const parsed = JSON.parse(localStorage.getItem(LS_KEY) || ''); return migrate(parsed); } catch { return migrate(null); }
  });
  const [selectedTrait, setSelectedTrait] = useState<number | null>(null);
  const [activeInvTab, setActiveInvTab] = useState<string>(() => (DEFAULT_SECTIONS[0].key));
  const [addingItem, setAddingItem] = useState<boolean>(false);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemCount, setNewItemCount] = useState<number>(1);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(ch)); } catch {} }, [ch]);

  // Derived HP/SP caps and clamping
  const hpMax = useMemo(() => 10 + Math.max(0, ch.stats.fortitude || 0), [ch.stats.fortitude]);
  const spMax = useMemo(() => 5 + Math.max(0, ch.stats.athletics || 0), [ch.stats.athletics]);
  useEffect(() => {
    setCh(prev => {
      const nh = Math.max(0, Math.min(hpMax, prev.hpCurrent || 0));
      const ns = Math.max(0, Math.min(spMax, prev.spCurrent || 0));
      if (nh !== prev.hpCurrent || ns !== prev.spCurrent) return { ...prev, hpCurrent: nh, spCurrent: ns };
      return prev;
    });
  }, [hpMax, spMax]);

  // Trainer sprite (shared with Lobby) and available options
  const [trainerSprite, setTrainerSprite] = useState<string>(() => localStorage.getItem('ttrpg.trainerSprite') || 'Ace Trainer');
  useEffect(() => { try { localStorage.setItem('ttrpg.trainerSprite', trainerSprite); } catch {} }, [trainerSprite]);
  const [trainerOptions, setTrainerOptions] = useState<string[]>([]);
  const [showSpritePicker, setShowSpritePicker] = useState<boolean>(false);
  useEffect(() => {
    const api = (window as any).lan?.assets;
    if (!api?.listTrainers) return;
    let cancelled=false;
    function load(){
      api.listTrainers().then((r:any)=>{
        if (cancelled) return;
        if (r?.ok && Array.isArray(r.list)) setTrainerOptions(r.list);
        else setTrainerOptions([]);
      }).catch(()=>{ if(!cancelled) setTrainerOptions([]); });
    }
    load();
    const t = setTimeout(load, 2000);
    return ()=>{ cancelled=true; clearTimeout(t); };
  }, []);

  // Inventory parsed (aggregated by name)
  const invParsed: Record<string, Array<{name:string; count:number}>> = useMemo(() => {
    const out: Record<string, Array<{name:string; count:number}>> = {};
    for (const sec of ch.inventory) out[sec.key] = aggregate(parseInventory(sec.lines));
    return out;
  }, [ch.inventory]);

  function setItemCount(sectionKey: string, index: number, newCount: number) {
    setCh(prev => {
      const idx = prev.inventory.findIndex(s => s.key === sectionKey);
      if (idx < 0) return prev;
      const items = aggregate(parseInventory(prev.inventory[idx].lines));
      if (!items[index]) return prev;
      items[index] = { ...items[index], count: Math.max(0, Number(newCount)||0) };
      const lines = rebuildLines(items);
      const inv = prev.inventory.slice();
      inv[idx] = { ...inv[idx], lines };
      return { ...prev, inventory: inv };
    });
  }
  function addItemToSection(sectionKey: string, name: string, count: number) {
    const nm = (name || '').trim(); if (!nm) return;
    setCh(prev => {
      const idx = prev.inventory.findIndex(s => s.key === sectionKey);
      if (idx < 0) return prev;
      const items = aggregate(parseInventory(prev.inventory[idx].lines));
      const pos = items.findIndex(it => it.name.toLowerCase() === nm.toLowerCase());
      if (pos >= 0) items[pos] = { ...items[pos], count: items[pos].count + Math.max(1, Number(count)||1) };
      else items.push({ name: nm, count: Math.max(1, Number(count)||1) });
      const lines = rebuildLines(items);
      const inv = prev.inventory.slice(); inv[idx] = { ...inv[idx], lines };
      return { ...prev, inventory: inv };
    });
  }

  // Traits helpers
  function hasTrait(name: string) { return !!ch.traits.find(t => t.name === name); }
  function canTake(t: TraitDef) { return !t.require || t.require(ch); }

  return (
    <section className="panel" style={{ padding: 12 }}>
      <div style={{ display:'grid', gridTemplateColumns:'160px 1fr 280px', gap:12 }}>
        {/* Left: Stats vertical */}
        <div style={{ display:'grid', alignContent:'start', gap:8 }}>
          {([
            ['strength','Strength'],
            ['athletics','Athletics'],
            ['intelligence','Intelligence'],
            ['speech','Speech'],
            ['fortitude','Fortitude'],
          ] as const).map(([k,label]) => (
            <div key={k} style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:6 }}>
              <span className="dim" style={{fontSize:'0.9em'}}>{label}</span>
              <input type="number" value={(ch.stats as any)[k] || 0} onChange={e => setCh({ ...ch, stats: { ...ch.stats, [k]: Number(e.target.value)||0 } })} style={{ width:60, textAlign:'center' }} />
            </div>
          ))}
          <div style={{ marginTop:4 }}>
            <span className="dim">LUCK:</span>
            <input type="number" value={ch.stats.luck||0} onChange={(e)=> setCh({ ...ch, stats: { ...ch.stats, luck: Number(e.target.value)||0 }})} style={{ width:60, marginLeft:6, textAlign:'center' }} />
          </div>
        </div>

        {/* Middle: Name, status, Inventory */}
        <div style={{ display:'grid', gap:12 }}>
          {/* Name row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'center' }}>
            <input value={ch.name} onChange={e => setCh({ ...ch, name: e.target.value })} placeholder="Name"
              style={{ fontSize:'1.6em', fontWeight:600, textAlign:'center', padding:'8px 12px' }} />
            <div style={{ display:'grid', gap:6, justifyItems:'center' }}>
              <label className="dim">lvl:</label>
              <input type="number" min={1} value={ch.level} onChange={e => setCh({ ...ch, level: Math.max(1, Number(e.target.value)||1) })} style={{ width:60, textAlign:'center' }} />
            </div>
          </div>

          {/* HP / SP small boxes */}
          <div style={{ display:'flex', gap:16 }}>
            <div>
              <div className="dim" style={{textAlign:'center'}}>HP</div>
              <input type="number" min={0} max={hpMax} value={ch.hpCurrent}
                onChange={e => setCh({ ...ch, hpCurrent: Math.max(0, Math.min(hpMax, Number(e.target.value)||0)) })}
                style={{ width:68, textAlign:'center' }} />
              <div className="dim" style={{textAlign:'center'}}>{`(${hpMax})`}</div>
            </div>
            <div>
              <div className="dim" style={{textAlign:'center'}}>SP</div>
              <input type="number" min={0} max={spMax} value={ch.spCurrent}
                onChange={e => setCh({ ...ch, spCurrent: Math.max(0, Math.min(spMax, Number(e.target.value)||0)) })}
                style={{ width:68, textAlign:'center' }} />
              <div className="dim" style={{textAlign:'center'}}>{`(${spMax})`}</div>
            </div>
          </div>

          {/* Inventory (tabbed, skinnier, scrollable) */}
          <section style={{ border:'1px solid var(--accent)', borderRadius:6, padding:8 }}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              {ch.inventory.map(sec => (
                <button key={sec.key} className={activeInvTab===sec.key? 'active tab-btn':'secondary tab-btn'} onClick={()=> setActiveInvTab(sec.key)}>{sec.label}</button>
              ))}
              <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
                <div className="chip dim" title="Money" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span>₽</span>
                  <input type="number" min={0} value={ch.money||0} onChange={e=> setCh({ ...ch, money: Math.max(0, Number(e.target.value)||0) })} style={{ width:100, textAlign:'right' }} />
                </div>
                <button className="mini" onClick={()=>{
                  const idx = ch.inventory.findIndex(s => s.key===activeInvTab);
                  if (idx<0) return; const nn = prompt('Rename section', ch.inventory[idx].label);
                  if (nn==null) return; const label = nn.trim(); if (!label) return;
                  setCh({ ...ch, inventory: ch.inventory.map((s,i)=> i===idx? { ...s, label }: s) });
                }}>Rename</button>
                <button className="mini" onClick={()=>{ setAddingItem(v=>!v); }}>{addingItem? 'Close' : 'Add'}</button>
              </div>
            </div>
            {addingItem && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 90px auto', gap:6, marginTop:8 }}>
                <input placeholder="Item name" value={newItemName} onChange={e=> setNewItemName(e.target.value)} />
                <input type="number" min={1} value={newItemCount} onChange={e=> setNewItemCount(Math.max(1, Number(e.target.value)||1))} />
                <button onClick={()=>{ addItemToSection(activeInvTab, newItemName, newItemCount); setNewItemName(''); setNewItemCount(1); setAddingItem(false); }}>Save</button>
              </div>
            )}
            <div style={{ maxHeight:560, minHeight:360, overflowY:'auto', marginTop:8, display:'grid', gap:6 }}>
              {(invParsed[activeInvTab] || []).map((it, i) => (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:8, alignItems:'center', border:'1px solid var(--accent)', borderRadius:4, padding:'4px 6px' }}>
                  <div className="dim" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
                  <div className="chip">x{it.count}</div>
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="mini" onClick={()=> setItemCount(activeInvTab, i, it.count-1)}>-1</button>
                    <button className="mini" onClick={()=> setItemCount(activeInvTab, i, it.count+1)}>+1</button>
                  </div>
                </div>
              ))}
              {(invParsed[activeInvTab] || []).length===0 && (
                <div style={{textAlign:'center', padding:'8px 0'}} />
              )}
            </div>
          </section>

          {/* Personality and Type Specialty side-by-side */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 240px', gap:12, alignItems:'start' }}>
            <label>
              <div className="label"><strong>Personality</strong></div>
              <textarea rows={2} value={ch.personality} onChange={e => setCh({ ...ch, personality: e.target.value })} />
            </label>
            <label>
              <div className="label"><strong>Type Specialty</strong> <span className="dim">(optional)</span></div>
              <input value={ch.typeSpecialty} onChange={e => setCh({ ...ch, typeSpecialty: e.target.value })} placeholder="e.g., Psychic, Fire, …" />
            </label>
          </div>
        </div>

        {/* Right: Portrait + Trainer Traits */}
        <div style={{ display:'grid', gap:8, alignContent:'start' }}>
          <section className="panel" style={{ border:'1px solid var(--accent)', borderRadius:6, padding:8 }}>
            <h3 style={{marginTop:0}}>Trainer Portrait</h3>
            <div style={{ display:'grid', gap:12, alignItems:'start', justifyItems:'center' }}>
              <div style={{ width:200, height:200, border:'1px solid var(--accent)', borderRadius:6, background:'#102', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                {ch.trainerImage ? (
                  <img src={ch.trainerImage} alt="Trainer" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
                ) : (
                  <img src={`/showdown/sprites/trainers/${trainerSprite}.png`} alt="Trainer Sprite" style={{ imageRendering:'pixelated' }} />
                )}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
                <button className="mini" onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = () => {
                    const f = input.files && input.files[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = String(reader.result || '');
                      setCh(prev => ({ ...prev, trainerImage: dataUrl }));
                    };
                    reader.readAsDataURL(f);
                  };
                  input.click();
                }}>Upload Image</button>
                {ch.trainerImage && <button className="mini" onClick={() => setCh(prev => ({ ...prev, trainerImage: undefined }))}>Clear Image</button>}
                <button onClick={()=> setShowSpritePicker(true)}>Change Sprite</button>
              </div>
              <div className="dim" style={{textAlign:'center'}}>Current sprite: {trainerSprite}</div>
            </div>
          </section>
          <div style={{ border:'1px solid var(--accent)', borderRadius:6, padding:8, display:'grid', gap:8, alignContent:'start', maxHeight:560, overflowY:'auto' }}>
            <h3 style={{marginTop:0}}>Trainer Traits</h3>
            {ch.traits.length === 0 && <div className="dim">No traits yet.</div>}
            <div style={{ display:'grid', gap:8 }}>
              {ch.traits.map((t,i)=> (
                <div key={i} style={{ border:'1px solid var(--accent)', borderRadius:4, padding:6 }}>
                  <strong>{t.name}</strong>
                  <div className="dim" style={{ whiteSpace:'pre-wrap' }}>{t.description}</div>
                  <div style={{ display:'flex', gap:6, marginTop:6 }}>
                    <button className="mini" onClick={()=> setSelectedTrait(i)}>View</button>
                    <button className="mini" onClick={()=>{
                      if (!confirm('Remove this trait?')) return;
                      setCh({ ...ch, traits: ch.traits.filter((_x,idx)=> idx!==i) });
                      if (selectedTrait===i) setSelectedTrait(null);
                    }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:8}}>
              <button onClick={()=> setSelectedTrait(-1)}>Add Traits</button>
            </div>
          </div>
        </div>
      </div>

      {/* Sprite Picker Modal */}
      {showSpritePicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=> setShowSpritePicker(false)}>
          <div className="panel" style={{ width:720, maxHeight:'80vh', overflowY:'auto' }} onClick={e=> e.stopPropagation()}>
            <h3 style={{marginTop:0}}>Choose Trainer Sprite</h3>
            {trainerOptions.length===0 && <div className="dim">Loading sprite list…</div>}
            <div style={{ border:'1px solid #444', borderRadius:6, padding:8 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, 60px)', gap:8 }}>
                {trainerOptions.map(name => (
                  <button key={name} title={name} onClick={()=>{ setTrainerSprite(name); setShowSpritePicker(false); }}
                    style={{ width:60, height:60, padding:0, border: trainerSprite===name? '2px solid var(--accent)' : '1px solid #444', borderRadius:6, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <img src={`/showdown/sprites/trainers/${name}.png`} alt={name} style={{ width:52, height:52, imageRendering:'pixelated' }} />
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
              <button onClick={()=> setShowSpritePicker(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Badge Case */}
      <div style={{ marginTop:12, border:'1px solid var(--accent)', borderRadius:6, padding:8 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h3 style={{ margin:0 }}>Badge Case</h3>
          <span className="dim">Mark earned badges and label them</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginTop:8 }}>
          {ch.badges.map((b, i) => (
            <div key={i} style={{ border:'1px solid var(--accent)', borderRadius:6, padding:6, display:'grid', gap:8, alignItems:'center', justifyItems:'center' }}>
              {/* Big clickable box */}
              <div
                onClick={()=> setCh({ ...ch, badges: ch.badges.map((x,idx)=> idx===i? { ...x, earned: !x.earned } : x) })}
                title={b.earned ? 'Click to uncheck' : 'Click to check'}
                style={{
                  width:'100%', height:100, border:'1px solid var(--accent)', borderRadius:8,
                  display:'flex', alignItems:'center', justifyContent:'center', background:'#102', cursor:'pointer', overflow:'hidden'
                }}
              >
                {b.image ? (
                  <img src={b.image} alt="Badge" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
                ) : (
                  <span style={{ fontSize:48, lineHeight:1, color:b.earned? 'var(--accent)' : '#345' }}>
                    {b.earned ? '✓' : ''}
                  </span>
                )}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button className="mini" onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = () => {
                    const f = input.files && input.files[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = String(reader.result || '');
                      setCh(prev => ({ ...prev, badges: prev.badges.map((x,idx)=> idx===i ? { ...x, image: dataUrl } : x) }));
                    };
                    reader.readAsDataURL(f);
                  };
                  input.click();
                }}>Add Image</button>
                {b.image && <button className="mini" onClick={()=> setCh({ ...ch, badges: ch.badges.map((x,idx)=> idx===i? { ...x, image: undefined } : x) })}>Clear</button>}
              </div>
              <input value={b.name} onChange={e=> setCh({ ...ch, badges: ch.badges.map((x,idx)=> idx===i? { ...x, name: e.target.value } : x) })} placeholder={`Badge ${i+1}`} style={{ width:'100%', textAlign:'center' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Trait Catalog Dialog */}
      {selectedTrait===-1 && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=> setSelectedTrait(null)}>
          <div className="panel" style={{ width:720, maxHeight:'80vh', overflowY:'auto' }} onClick={e=> e.stopPropagation()}>
            <h3 style={{marginTop:0}}>Add Traits</h3>
            <div className="dim" style={{marginBottom:8}}>Only eligible traits are enabled based on your stats and type specialty.</div>
            <div style={{ display:'grid', gap:8 }}>
              {traitCatalog.map((t, idx) => {
                const eligible = canTake(t);
                return (
                  <div key={idx} style={{ border:'1px solid var(--accent)', borderRadius:6, padding:8, display:'grid', gap:4 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                      <strong>{t.name}</strong>
                      {t.reqText && <span className="chip dim">Req: {t.reqText}</span>}
                    </div>
                    <div className="dim" style={{ whiteSpace:'pre-wrap' }}>{t.desc}</div>
                    <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                      <button disabled={!eligible || hasTrait(t.name)} onClick={()=>{
                        const next = { name: t.name, description: t.desc } as Trait;
                        setCh({ ...ch, traits: [...ch.traits, next] });
                      }}>Add</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
              <button onClick={()=> setSelectedTrait(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Trait Viewer Dialog */}
      {typeof selectedTrait === 'number' && selectedTrait >= 0 && ch.traits[selectedTrait] && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=> setSelectedTrait(null)}>
          <div className="panel" style={{ width:520 }} onClick={e=> e.stopPropagation()}>
            <h3 style={{marginTop:0}}>{ch.traits[selectedTrait].name}</h3>
            <div className="dim" style={{ whiteSpace:'pre-wrap' }}>{ch.traits[selectedTrait].description}</div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
              <button onClick={()=> setSelectedTrait(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
