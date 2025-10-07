import React, { useEffect, useMemo, useState } from 'react';

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
type Badge = { name: string; earned: boolean };

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
      badges: Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false })),
      level: 1,
      hpCurrent: 0,
      spCurrent: 0,
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
      badges: Array.isArray(raw.badges) && raw.badges.length ? raw.badges.slice(0,8).map((b: any, i: number) => ({ name: String((b && b.name) || (i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '')), earned: !!(b && b.earned) })) : Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false })),
      level: Number(raw.level || 1),
      hpCurrent: Number(raw.hpCurrent || 0),
      spCurrent: Number(raw.spCurrent || 0),
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
    badges: Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false })),
    level: 1,
    hpCurrent: 0,
    spCurrent: 0,
  };
}

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

export function CharacterSheet() {
  const [ch, setCh] = useState<Character>(() => {
    try { const parsed = JSON.parse(localStorage.getItem(LS_KEY) || ''); return migrate(parsed); } catch { return migrate(null); }
  });
  const [selectedTrait, setSelectedTrait] = useState<number | null>(null);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(ch)); } catch {} }, [ch]);

  const invParsed = useMemo(() => {
    const map: Record<string, Array<{ name: string; count: number }>> = {};
    for (const s of ch.inventory) map[s.key] = parseInventory(s.lines);
    return map;
  }, [ch.inventory]);

  // Derived maxes; tweak formulas here if your rules change
  const hpMax = useMemo(() => 10 + (ch.stats.fortitude||0) * 2 + (ch.stats.strength||0), [ch.stats]);
  const spMax = useMemo(() => 10 + (ch.stats.athletics||0) + (ch.stats.fortitude||0) + Math.floor((ch.stats.luck||0)/2), [ch.stats]);
  // Clamp current pools whenever stats change
  useEffect(() => {
    setCh(prev => ({ ...prev, hpCurrent: Math.max(0, Math.min(hpMax, prev.hpCurrent||0)), spCurrent: Math.max(0, Math.min(spMax, prev.spCurrent||0)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hpMax, spMax]);

  // Trait catalog with stat-locked requirements
  type Req = (S: Stats, has: (name: string)=>boolean, hasType: boolean) => boolean;
  const hasTrait = (name: string) => !!ch.traits.find(t => t.name.toLowerCase() === name.toLowerCase());
  const hasTypeSpec = !!(ch.typeSpecialty && ch.typeSpecialty.trim());
  const atLeast = (stat: keyof Stats, n: number): Req => (S) => (S[stat]||0) >= n;
  const reqAnd = (...rs: Req[]): Req => (S,has,hasType) => rs.every(r => r(S,has,hasType));
  const reqTrait = (name: string): Req => (_S,has) => has(name);
  const reqTypeSpec: Req = (_S,_has,hasT) => hasT;
  const INT = (n:number)=> atLeast('intelligence', n);
  const STR = (n:number)=> atLeast('strength', n);
  const ATH = (n:number)=> atLeast('athletics', n);
  const FTD = (n:number)=> atLeast('fortitude', n);
  const SCH = (n:number)=> atLeast('speech', n);
  const LCK = (n:number)=> atLeast('luck', n);
  const traitCatalog: Array<{ name: string; desc: string; req?: Req; reqText?: string }> = [
    { name: 'Pitcher', desc: 'Throw a Pokéball before the first turn at 1.5x catch rate. Stacks multiplicatively with other multipliers (not Quick Ball; overridden by 4x).', req: STR(8), reqText: '8 STR' },
    { name: 'Black Belt', desc: 'Can use Strength stat for Athletics rolls.', req: STR(15), reqText: '15 STR' },
    { name: 'Runner', desc: 'Run away from any battle (not trainer battles).', req: ATH(10), reqText: '10 ATH' },
    { name: 'Sneak attack', desc: 'Gain “Ambush”: free first hit when unseen and actively sneaking.', req: ATH(10), reqText: '10 ATH' },
    { name: 'Fisher', desc: 'Use a fishing rod without an Athletics check.', req: ATH(10), reqText: '10 ATH' },
    { name: 'Chef', desc: 'Cook a meal to restore party to full HP and SP using extra supplies.', req: INT(10), reqText: '10 INT' },
    { name: 'Scholar', desc: 'Advantage on Intelligence checks about history, Pokémon info, and current events.', req: INT(10), reqText: '10 INT' },
    { name: 'Double Battler', desc: 'Use two Pokémon in wild encounters or wild trainers (not Gyms).', req: INT(10), reqText: '10 INT' },
    { name: 'Jr. Professor', desc: 'Use Intelligence to attempt a Wild Bond.', req: INT(12), reqText: 'INT D12 (12 INT)' },
    { name: 'Nurse', desc: 'Heal People and Pokémon to full HP during a rest without supplies; advantage on Wild Bond with injured Pokémon.', req: INT(12), reqText: 'INT D12 (12 INT)' },
    { name: 'Aura Guardian', desc: 'Loosely speak with Pokémon that share your type enthusiast; Wild Card can speak fluently with starter.', req: INT(10), reqText: '10 INT' },
    { name: 'Trace', desc: 'Copy the ability of one of your Pokémon; persistent until removed by psychic means.', req: reqAnd(INT(12), reqTrait('Aura Guardian')), reqText: '12 INT + Aura Guardian' },
    { name: 'Psychic', desc: 'High-DC Intelligence check to predict opponent’s next Pokémon and allow a switch.', req: INT(20), reqText: '20 INT' },
    { name: 'Ace Trainer', desc: '+1 catch roll bonus per Pokémon in party (max 6) during catch attempts.', req: FTD(10), reqText: '10 FTD' },
    { name: 'Biker', desc: 'Ride a bike to expend one-third SP while traveling (flat and unobstructed).', req: FTD(10), reqText: '10 FTD' },
    { name: 'Hiker', desc: 'Expend half SP when traveling from place to place.', req: FTD(13), reqText: '13 FTD' },
    { name: "It's the Vibes", desc: '1.5x catch modifier for Pokémon of the same gender as you.', req: SCH(8), reqText: '8 SCH' },
    { name: 'Contest Star', desc: 'Use Contest attributes to gain bonuses on Speech rolls.', req: SCH(10), reqText: '10 SCH' },
    { name: 'Down Brock', desc: 'Smooth talk the opposite gender very well (unless a Pokémon is done with your antics).', req: SCH(15), reqText: '15 SCH' },
    { name: 'Actor/Actress', desc: '1.5x Speech bonus when impersonating or deceiving.', req: SCH(15), reqText: '15 SCH' },
    { name: 'Test Your Luck', desc: 'Once a day, reroll a failed check using Luck.', req: LCK(10), reqText: '10 LCK' },
    { name: 'Prepared For Everything', desc: 'Make a “Test Your Luck” roll to have exactly what you need for a situation.', req: reqAnd(LCK(20), reqTrait('Test Your Luck')), reqText: '20 LCK + Test Your Luck' },
    { name: "Guys Type trainer", desc: '1.5x catch rate if a Pokémon has more than one head/being.', reqText: 'No requirements' },
    { name: 'Expanding Horizons', desc: 'Wild Card: gain a Type Specialty. If you have one, gain another (no limit).', reqText: 'No requirements' },
    { name: 'In Tune', desc: 'Become in tune with your Type Specialty (bonuses vary by type).', req: reqTypeSpec, reqText: 'Requires Type Specialty' },
  ];

  const canTake = (t: {req?: Req}) => (t.req ? t.req(ch.stats, hasTrait, hasTypeSpec) : true);

  return (
    <section className="panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
      <h2>Character Sheet</h2>

      {/* Top: identity and money */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <label>
          <div className="label"><strong>Name</strong></div>
          <input value={ch.name} onChange={e => setCh({ ...ch, name: e.target.value })} />
        </label>
        <label>
          <div className="label"><strong>Type Specialty</strong></div>
          <input value={ch.typeSpecialty} onChange={e => setCh({ ...ch, typeSpecialty: e.target.value })} />
        </label>
        <label>
          <div className="label"><strong>Money</strong></div>
          <input type="number" min={0} value={ch.money} onChange={e => setCh({ ...ch, money: Math.max(0, Number(e.target.value)||0) })} />
        </label>
      </div>

  {/* Level, HP & SP */}
  <section style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: 8 }}>
        <h3 style={{ marginTop: 0 }}>Trainer Status</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <label>
            <div className="label"><strong>Level</strong></div>
            <input type="number" min={1} value={ch.level} onChange={e => setCh({ ...ch, level: Math.max(1, Number(e.target.value)||1) })} />
          </label>
          <div>
            <div className="label"><strong>HP</strong></div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px auto', gap: 8, alignItems: 'center' }}>
              <input type="number" min={0} max={hpMax} value={ch.hpCurrent} onChange={e => setCh({ ...ch, hpCurrent: Math.max(0, Math.min(hpMax, Number(e.target.value)||0)) })} />
              <div className="dim">/ {hpMax}</div>
            </div>
            <div className="hpbar large" style={{ marginTop: 4 }}><span style={{ width: `${(hpMax ? (ch.hpCurrent/hpMax) : 0)*100}%` }} /></div>
          </div>
          <div>
            <div className="label"><strong>SP</strong></div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px auto', gap: 8, alignItems: 'center' }}>
              <input type="number" min={0} max={spMax} value={ch.spCurrent} onChange={e => setCh({ ...ch, spCurrent: Math.max(0, Math.min(spMax, Number(e.target.value)||0)) })} />
              <div className="dim">/ {spMax}</div>
            </div>
            <div className="hpbar spbar" style={{ marginTop: 4 }}><span style={{ width: `${(spMax ? (ch.spCurrent/spMax) : 0)*100}%` }} /></div>
          </div>
        </div>
      </section>

  {/* Stats */}
  <section style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: 8 }}>
        <h3 style={{ marginTop: 0 }}>Stats</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {([
            ['strength','Strength'],
            ['athletics','Athletics'],
            ['intelligence','Intelligence'],
            ['speech','Speech'],
            ['fortitude','Fortitude'],
            ['luck','Luck'],
          ] as const).map(([k,label]) => (
            <label key={k}>
              <div className="label"><strong>{label}</strong></div>
              <input type="number" value={(ch.stats as any)[k] || 0} onChange={e => setCh({ ...ch, stats: { ...ch.stats, [k]: Number(e.target.value)||0 } })} />
            </label>
          ))}
        </div>
      </section>

      {/* Personality */}
      <label>
        <div className="label"><strong>Personality</strong></div>
        <textarea rows={3} value={ch.personality} onChange={e => setCh({ ...ch, personality: e.target.value })} />
      </label>

  {/* Inventory */}
  <section style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: 8 }}>
        <h3 style={{ marginTop: 0 }}>Inventory</h3>
        <div className="dim" style={{ marginBottom: 6 }}>Enter one item per line. Append “xN” to set a count, e.g., “Potion x3”.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {ch.inventory.map((sec, idx) => (
            <div key={sec.key} className="panel" style={{ padding: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong>{sec.label}</strong>
                {/* Optional: section rename */}
                <button className="mini" onClick={() => {
                  const nn = prompt('Rename section', sec.label);
                  if (nn==null) return; const label = nn.trim(); if (!label) return;
                  setCh({ ...ch, inventory: ch.inventory.map((s,i)=> i===idx ? { ...s, label } : s) });
                }}>Rename</button>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:6 }}>
                <textarea rows={6} value={sec.lines} onChange={e => setCh({ ...ch, inventory: ch.inventory.map((s,i)=> i===idx ? { ...s, lines: e.target.value } : s) })} />
                {/* Parsed preview */}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                  {(invParsed[sec.key] || []).map((it, i) => (
                    <li key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                      <span>{it.name}</span>
                      <span className="dim">{it.count>1 ? `x${it.count}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

  {/* Trainer Traits */}
  <section style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: 8 }}>
        <h3 style={{ marginTop: 0 }}>Trainer Traits</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Catalog */}
          <div className="panel" style={{ padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong>Trait Catalog</strong>
              <span className="dim" style={{ fontSize: '0.9em' }}>Locked until requirements met</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {traitCatalog.map(t => {
                const owned = hasTrait(t.name);
                const eligible = canTake(t);
                return (
                  <li key={t.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <button className="secondary" onClick={() => setSelectedTrait(ch.traits.findIndex(tt => tt.name.toLowerCase()===t.name.toLowerCase()))} disabled={!owned}>{t.name}</button>
                        {t.reqText && <span className="chip dim">{t.reqText}</span>}
                      </div>
                      <div className="dim" style={{ fontSize:'0.9em' }}>{t.desc}</div>
                    </div>
                    <button onClick={() => {
                      if (owned) return;
                      if (!eligible) return;
                      setCh({ ...ch, traits: [...ch.traits, { name: t.name, description: t.desc }] });
                      setSelectedTrait(ch.traits.length);
                    }} disabled={owned || !eligible}>
                      {owned ? 'Added' : eligible ? 'Add' : 'Locked'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {/* Owned traits */}
          <div className="panel" style={{ padding: 8 }}>
            <strong>My Traits</strong>
            {ch.traits.length === 0 && <div className="dim">No traits yet. Unlock from the catalog.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, marginTop: 8 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                {ch.traits.map((t, i) => (
                  <button key={i} className={selectedTrait===i ? 'active' : 'secondary'} onClick={() => setSelectedTrait(i)}>{t.name || '(unnamed)'}</button>
                ))}
              </div>
              <div>
                {selectedTrait==null ? (
                  <div className="dim">Click a trait to view its description.</div>
                ) : (
                  <div className="panel" style={{ padding: 8, display: 'grid', gap: 8 }}>
                    <div className="label"><strong>{ch.traits[selectedTrait]?.name || ''}</strong></div>
                    <div className="dim" style={{ whiteSpace:'pre-wrap' }}>{ch.traits[selectedTrait]?.description || ''}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="secondary" onClick={() => setSelectedTrait(null)}>Close</button>
                      <button className="mini" onClick={() => {
                        if (selectedTrait == null) return;
                        if (!confirm('Remove this trait?')) return;
                        const list = ch.traits.filter((_t,i)=> i!==selectedTrait);
                        setCh({ ...ch, traits: list }); setSelectedTrait(null);
                      }}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

  {/* Badge Case */}
  <section style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: 8 }}>
        <h3 style={{ marginTop: 0 }}>Badge Case</h3>
        <div className="dim" style={{ marginBottom: 6 }}>Click a badge to toggle a check mark. You can name them below.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8, marginBottom: 8 }}>
          {ch.badges.map((b, i) => (
            <button
              key={i}
              className={`badge-btn ${b.earned ? 'earned' : ''}`}
              onClick={() => setCh({ ...ch, badges: ch.badges.map((x, idx)=> idx===i ? { ...x, earned: !x.earned } : x) })}
            >
              {b.earned ? '✓' : '\u00A0'}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
          {ch.badges.map((b, i) => (
            <input key={i} placeholder={`Badge ${i+1}`} value={b.name} onChange={e => setCh({ ...ch, badges: ch.badges.map((x, idx)=> idx===i ? { ...x, name: e.target.value } : x) })} />
          ))}
        </div>
      </section>
    </section>
  );
}
