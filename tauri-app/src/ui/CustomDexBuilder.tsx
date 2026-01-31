import React, { useEffect, useMemo, useState } from 'react';
import { BattlePokemon } from '../types';
import { DexSpecies, SpriteSlot, saveCustomDex, saveCustomLearnset, prepareBattle, toPokemon, loadShowdownDex, placeholderSpriteDataURL, normalizeName, saveCustomSprite, getCustomSprite } from '../data/adapter';

type StatBlock = { hp:number; atk:number; def:number; spa:number; spd:number; spe:number };
type CustomDexSeed = { key?: string; entry?: DexSpecies; learnset?: Record<string, any> };
type DexOptionSpecies = DexSpecies & { id?: string };
type DexOptions = {
  species: DexOptionSpecies[];
  abilities: Array<{ id: string; name: string }>;
  moves: Array<{ id: string; name: string }>;
};
type LearnsetEntry = { id: string; method: 'L' | 'M' | 'T' | 'E'; level?: number };

const TYPE_OPTIONS = [
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying',
  'Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy',
];

const SPRITE_SLOTS: Array<{ slot: SpriteSlot; label: string; group: string }> = [
  { slot: 'gen5', label: 'Gen 5 Front', group: 'Gen 5' },
  { slot: 'gen5-back', label: 'Gen 5 Back', group: 'Gen 5' },
  { slot: 'gen5-shiny', label: 'Gen 5 Shiny Front', group: 'Gen 5' },
  { slot: 'gen5-back-shiny', label: 'Gen 5 Shiny Back', group: 'Gen 5' },
  { slot: 'home', label: 'HOME Front', group: 'HOME' },
  { slot: 'home-back', label: 'HOME Back', group: 'HOME' },
  { slot: 'home-shiny', label: 'HOME Shiny Front', group: 'HOME' },
  { slot: 'home-back-shiny', label: 'HOME Shiny Back', group: 'HOME' },
  { slot: 'ani', label: 'Animated Front', group: 'Animated' },
  { slot: 'ani-back', label: 'Animated Back', group: 'Animated' },
  { slot: 'ani-shiny', label: 'Animated Shiny Front', group: 'Animated' },
  { slot: 'ani-back-shiny', label: 'Animated Shiny Back', group: 'Animated' },
];

export function CustomDexBuilder({
  onAddToPC,
  seed,
  onSaved,
  dexOptions,
  onCreateDerivedForme,
}: {
  onAddToPC?: (mons: BattlePokemon[]) => void;
  seed?: CustomDexSeed | null;
  onSaved?: (payload: { key: string; entry: DexSpecies; learnset?: Record<string, any> }) => void;
  dexOptions?: DexOptions | null;
  onCreateDerivedForme?: (payload: CustomDexSeed) => void;
}) {
  const [name, setName] = useState('');
  const [baseSpecies, setBaseSpecies] = useState('');
  const [forme, setForme] = useState('');
  const [types, setTypes] = useState<string[]>(['Normal']);
  const [genderless, setGenderless] = useState<boolean>(true);
  const [maleRatio, setMaleRatio] = useState<number>(50);
  const [femaleRatio, setFemaleRatio] = useState<number>(50);
  const [baseStats, setBaseStats] = useState<StatBlock>({ hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 });
  const [abilities, setAbilities] = useState<Record<string,string>>({ 0: '' });
  const [cosmeticFormes, setCosmeticFormes] = useState<string>('');
  const [otherFormes, setOtherFormes] = useState<string>('');
  const [formeOrder, setFormeOrder] = useState<string>('');
  const [baseForme, setBaseForme] = useState<string>('');
  const [heightm, setHeightm] = useState<number>(1.0);
  const [weightkg, setWeightkg] = useState<number>(10.0);
  const [color, setColor] = useState<string>('Gray');
  const [prevo, setPrevo] = useState<string>('');
  const [evoType, setEvoType] = useState<string>('level');
  const [evoLevel, setEvoLevel] = useState<number | ''>('');
  const [evosCsv, setEvosCsv] = useState<string>('');
  const [evoCondition, setEvoCondition] = useState<string>('');
  const [eggGroups, setEggGroups] = useState<string>('');
  const [gmax, setGmax] = useState<string>('');
  const [requiredItem, setRequiredItem] = useState<string>('');
  const [learnsetEntries, setLearnsetEntries] = useState<LearnsetEntry[]>([]);
  const [level, setLevel] = useState<number>(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spriteDrafts, setSpriteDrafts] = useState<Partial<Record<SpriteSlot, string>>>({});
  const [templateId, setTemplateId] = useState<string>('');
  const [derivedFormeName, setDerivedFormeName] = useState<string>('');

  useEffect(() => {
    if (!seed?.entry) return;
    const entry = seed.entry;
    setName(entry.name || seed.key || '');
    setBaseSpecies((entry as any).baseSpecies || '');
    setForme((entry as any).forme || '');
    setTypes(entry.types?.length ? entry.types : ['Normal']);
    if (entry.gender === 'N') {
      setGenderless(true);
      setMaleRatio(0);
      setFemaleRatio(0);
    } else if (entry.genderRatio) {
      setGenderless(false);
      setMaleRatio(Math.round((entry.genderRatio.M ?? 0.5) * 100));
      setFemaleRatio(Math.round((entry.genderRatio.F ?? 0.5) * 100));
    } else {
      setGenderless(false);
      setMaleRatio(50);
      setFemaleRatio(50);
    }
    setBaseStats({ ...entry.baseStats });
    setAbilities(entry.abilities || { 0: '' });
    setCosmeticFormes((entry.cosmeticFormes || []).join(', '));
    setOtherFormes((entry.otherFormes || []).join(', '));
    setFormeOrder((entry.formeOrder || []).join(', '));
    setBaseForme(entry.baseForme || '');
    setHeightm(entry.heightm ?? 1.0);
    setWeightkg(entry.weightkg ?? 10.0);
    setColor(entry.color || 'Gray');
    setPrevo(entry.prevo || '');
    setEvoType(entry.evoType || 'none');
    setEvoLevel(entry.evoLevel ?? '');
    setEvosCsv((entry.evos || []).join(', '));
    setEvoCondition(entry.evoCondition || '');
    setEggGroups((entry.eggGroups || []).join(', '));
    setGmax((entry as any).canGigantamax || '');
    setRequiredItem(entry.requiredItem || '');
    const seedLearnset = seed.learnset || {};
    const seedEntries: LearnsetEntry[] = [];
    Object.entries(seedLearnset).forEach(([id, sources]) => {
      const srcList = Array.isArray(sources) ? sources : [sources];
      srcList.forEach((src: string) => {
        const method = (src?.[1] || 'L') as LearnsetEntry['method'];
        const levelValue = method === 'L' ? Number(src?.slice(2) || 1) : undefined;
        seedEntries.push({ id, method, level: levelValue });
      });
    });
    setLearnsetEntries(seedEntries);
    const seedKey = normalizeName(seed.key || entry.name || '');
    if (seedKey) {
      const nextDrafts: Partial<Record<SpriteSlot, string>> = {};
      for (const slot of SPRITE_SLOTS) {
        const existing = getCustomSprite(seedKey, slot.slot);
        if (existing) nextDrafts[slot.slot] = existing;
      }
      setSpriteDrafts(nextDrafts);
    }
  }, [seed]);

  function parseCSVList(s: string) {
    return Array.from(new Set(
      (s||'')
        .replace(/\band\b|\bor\b/gi, ',')
        .replace(/[\/]/g, ',')
        .split(/[\s,]+/)
        .map(x=>x.trim())
        .filter(Boolean)
    ));
  }

  function onFileSprite(slot: SpriteSlot, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSpriteDrafts(prev => ({ ...prev, [slot]: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  function buildEntry(): { key: string; entry: DexSpecies } {
    const key = normalizeName(name || baseForme || baseSpecies || 'custom');
    const entry: DexSpecies = {
      name: name || baseForme || baseSpecies || 'CustomMon',
      types: (types.length ? types : ['Normal']) as any,
      ...(genderless ? { gender: 'N' } : { genderRatio: { M: maleRatio / 100, F: femaleRatio / 100 } }),
      baseStats: { ...baseStats },
      abilities: Object.fromEntries(Object.entries(abilities).filter(([,v])=>v && v.trim())) as any,
      heightm, weightkg, color,
      ...(baseSpecies ? { baseSpecies } : {}),
      ...(forme ? { forme } : {}),
      ...(baseForme ? { baseForme } : {}),
      ...(prevo ? { prevo } : {}),
  ...(evoType && evoType !== 'none' ? { evoType } : {}),
  ...(evoLevel !== '' ? { evoLevel: Number(evoLevel) } : {}),
  ...(evosCsv.trim() ? { evos: parseCSVList(evosCsv) } : {}),
      ...(evoCondition ? { evoCondition } : {}),
      ...(eggGroups ? { eggGroups: parseCSVList(eggGroups) as any } : {}),
      ...(cosmeticFormes ? { cosmeticFormes: parseCSVList(cosmeticFormes) } : {}),
      ...(otherFormes ? { otherFormes: parseCSVList(otherFormes) } : {}),
      ...(formeOrder ? { formeOrder: parseCSVList(formeOrder) } : {}),
      ...(gmax ? { canGigantamax: gmax } as any : {}),
      ...(requiredItem ? { requiredItem } : {}),
    } as any;
    return { key, entry };
  }

  function parseLearnset(): Record<string, any> {
    const out: Record<string, any> = {};
    learnsetEntries.forEach(entry => {
      if (!entry.id) return;
      const key = normalizeName(entry.id);
      if (!out[key]) out[key] = [] as string[];
      if (entry.method === 'L') {
        const levelValue = Math.max(1, Math.min(100, Number(entry.level) || 1));
        out[key].push(`9L${levelValue}`);
      } else if (entry.method === 'M') {
        out[key].push('9M');
      } else if (entry.method === 'T') {
        out[key].push('9T');
      } else if (entry.method === 'E') {
        out[key].push('9E');
      }
    });
    return out;
  }

  async function onSave() {
    setSaving(true); setError(null);
    try {
      const { key, entry } = buildEntry();
      saveCustomDex(key, entry);
      const ls = parseLearnset();
      if (Object.keys(ls).length) saveCustomLearnset(key, ls);
      Object.entries(spriteDrafts).forEach(([slot, dataUrl]) => {
        if (!dataUrl) return;
        saveCustomSprite(key, slot as SpriteSlot, dataUrl);
      });
      if (onSaved) onSaved({ key, entry, learnset: Object.keys(ls).length ? ls : undefined });
    } catch (e:any) { setError(e?.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function onSaveAndAdd() {
    await onSave();
    const dex = await loadShowdownDex();
    const p = toPokemon(name || baseForme || baseSpecies || 'CustomMon', dex.pokedex, level);
    if (p && onAddToPC) onAddToPC([prepareBattle(p)]);
  }

  const abilityRows = Object.keys(abilities).map(k=>({slot:k, name:abilities[k]}));

  const groupedSprites = useMemo(() => {
    return SPRITE_SLOTS.reduce<Record<string, typeof SPRITE_SLOTS>>((acc, slot) => {
      acc[slot.group] = acc[slot.group] || [];
      acc[slot.group].push(slot);
      return acc;
    }, {} as Record<string, typeof SPRITE_SLOTS>);
  }, []);

  const speciesOptions = useMemo(() => dexOptions?.species || [], [dexOptions]);
  const abilityOptions = useMemo(() => dexOptions?.abilities || [], [dexOptions]);
  const moveOptions = useMemo(() => dexOptions?.moves || [], [dexOptions]);

  const applyTemplate = (template: DexOptionSpecies | undefined) => {
    if (!template) return;
    const templateName = template.name || template.id || '';
    const base = template.baseSpecies || template.name || template.id || '';
    const formeName = (template as any).forme || '';
    setName(`${templateName}-Custom`);
    setBaseSpecies(base);
    setForme(formeName);
    setBaseForme(template.baseForme || formeName || '');
    setTypes(template.types?.length ? template.types : ['Normal']);
    setBaseStats({ ...template.baseStats });
    setAbilities(template.abilities || { 0: '' });
    setHeightm(template.heightm ?? 1.0);
    setWeightkg(template.weightkg ?? 10.0);
    setColor(template.color || 'Gray');
    setPrevo(template.prevo || '');
    setEvoType(template.evoType || 'none');
    setEvoLevel(template.evoLevel ?? '');
    setEvosCsv((template.evos || []).join(', '));
    setEvoCondition(template.evoCondition || '');
    setEggGroups((template.eggGroups || []).join(', '));
    setRequiredItem(template.requiredItem || '');
    if (template.gender === 'N') {
      setGenderless(true);
      setMaleRatio(0);
      setFemaleRatio(0);
    } else if (template.genderRatio) {
      setGenderless(false);
      setMaleRatio(Math.round((template.genderRatio.M ?? 0.5) * 100));
      setFemaleRatio(Math.round((template.genderRatio.F ?? 0.5) * 100));
    } else {
      setGenderless(false);
      setMaleRatio(50);
      setFemaleRatio(50);
    }
  };

  const calcStat = (base: number, isHp: boolean, lv: number) => {
    if (isHp) return Math.floor((2 * base + 31 + Math.floor(0 / 4)) * lv / 100) + lv + 10;
    return Math.floor((Math.floor((2 * base + 31 + Math.floor(0 / 4)) * lv / 100) + 5) * 1.0);
  };

  const previewStats = useMemo(() => {
    const lv = 50;
    return {
      hp: calcStat(baseStats.hp, true, lv),
      atk: calcStat(baseStats.atk, false, lv),
      def: calcStat(baseStats.def, false, lv),
      spa: calcStat(baseStats.spa, false, lv),
      spd: calcStat(baseStats.spd, false, lv),
      spe: calcStat(baseStats.spe, false, lv),
    };
  }, [baseStats]);

  const sectionStyle: React.CSSProperties = {
    background: '#f7f7f7',
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 8px',
    border: '1px solid #bbb',
    borderRadius: 4,
    background: '#fff',
    color: '#111',
    fontSize: 12,
  };

  return (
    <div style={{display:'grid', gridTemplateColumns:'minmax(320px, 1fr) minmax(320px, 1fr)', gap:16}}>
      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Template</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center'}}>
            <input
              style={inputStyle}
              list="dex-species-list"
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              placeholder="Pick a species (e.g., Charizard-Mega-X)"
            />
            <button
              type="button"
              onClick={() => {
                const target = speciesOptions.find(s => normalizeName(s.id || s.name) === normalizeName(templateId))
                  || speciesOptions.find(s => normalizeName(s.name) === normalizeName(templateId));
                applyTemplate(target);
              }}
            >
              Use Template
            </button>
          </div>
          <div className="dim" style={{fontSize: 11}}>Use a Dex species as a base to create new formes (e.g., a new Mega).</div>
        </div>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Basics</div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8}}>
            <label style={labelStyle}>Name
              <input style={inputStyle} value={name} onChange={e=>setName(e.target.value)} placeholder="Charizard-Mega-Z" />
            </label>
            <label style={labelStyle}>Base Species
              <input style={inputStyle} value={baseSpecies} onChange={e=>setBaseSpecies(e.target.value)} placeholder="Charizard" list="dex-species-list" />
            </label>
            <label style={labelStyle}>Forme Name
              <input style={inputStyle} value={forme} onChange={e=>setForme(e.target.value)} placeholder="Mega-Z" />
            </label>
            <label style={labelStyle}>Base Forme
              <input style={inputStyle} value={baseForme} onChange={e=>setBaseForme(e.target.value)} placeholder="Mega-X" />
            </label>
          </div>
        </div>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Types</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
            {TYPE_OPTIONS.map(t => {
              const active = types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTypes(prev => {
                      if (prev.includes(t)) return prev.filter(x => x !== t);
                      if (prev.length >= 3) return prev;
                      return [...prev, t];
                    });
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: `1px solid ${active ? '#4a9eff' : '#bbb'}`,
                    background: active ? '#4a9eff' : '#fff',
                    color: active ? '#fff' : '#333',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="dim" style={{fontSize: 11}}>Select up to 3 types.</div>
        </div>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Base Stats</div>
          {(['hp','atk','def','spa','spd','spe'] as const).map(stat => (
            <div key={stat} style={{display:'grid', gridTemplateColumns:'70px 1fr', gap:8, alignItems:'center'}}>
              <input
                style={inputStyle}
                type="number"
                min={1}
                max={500}
                value={baseStats[stat]}
                onChange={e => setBaseStats({...baseStats, [stat]: Math.max(1, Math.min(500, Number(e.target.value) || 1))})}
              />
              <input
                type="range"
                min={1}
                max={300}
                value={Math.min(baseStats[stat], 300)}
                onChange={e => setBaseStats({...baseStats, [stat]: Number(e.target.value) || 1})}
              />
            </div>
          ))}
        </div>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Traits & Evolution</div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8}}>
            <label style={labelStyle}>Color
              <input style={inputStyle} value={color} onChange={e=>setColor(e.target.value)} />
            </label>
            <label style={labelStyle}>Height (m)
              <input style={inputStyle} type="number" value={heightm} onChange={e=>setHeightm(Number(e.target.value)||0)} />
            </label>
            <label style={labelStyle}>Weight (kg)
              <input style={inputStyle} type="number" value={weightkg} onChange={e=>setWeightkg(Number(e.target.value)||0)} />
            </label>
            <label style={labelStyle}>Prevo
              <input style={inputStyle} list="dex-prevo-list" value={prevo} onChange={e=>setPrevo(e.target.value)} placeholder="Choose from Dex" />
            </label>
            <label style={labelStyle}>Evo Type
              <select style={inputStyle} value={evoType} onChange={e=>setEvoType(e.target.value)}>
                <option value="none">None</option>
                <option value="level">Level</option>
                <option value="levelFriendship">Level (Friendship)</option>
                <option value="levelHold">Level (Hold Item)</option>
                <option value="levelMove">Level (Knowing Move)</option>
                <option value="levelExtra">Level (Extra Condition)</option>
                <option value="useItem">Use Item</option>
                <option value="trade">Trade</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label style={labelStyle}>Evo Level
              <input style={inputStyle} type="number" min={1} max={255} value={evoLevel} onChange={e=>{
                const v = e.target.value;
                setEvoLevel(v === '' ? '' : Math.max(1, Math.min(255, Number(v)||1)));
              }} placeholder="16" />
            </label>
            <label style={labelStyle}>Evo Condition
              <input style={inputStyle} value={evoCondition} onChange={e=>setEvoCondition(e.target.value)} placeholder="Daytime, Holding Razor Claw" />
            </label>
            <label style={labelStyle}>Evolutions (CSV)
              <input style={inputStyle} value={evosCsv} onChange={e=>setEvosCsv(e.target.value)} placeholder="Raichu, Raichu-Alola" />
            </label>
            <label style={labelStyle}>Egg Groups
              <input style={inputStyle} value={eggGroups} onChange={e=>setEggGroups(e.target.value)} placeholder="Fairy, Amorphous" />
            </label>
            <label style={labelStyle}>Required Item
              <input style={inputStyle} value={requiredItem} onChange={e=>setRequiredItem(e.target.value)} placeholder="Charizardite X" />
            </label>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center'}}>
            <label style={{display:'flex', alignItems:'center', gap:6}}>
              <input type="checkbox" checked={genderless} onChange={e => setGenderless(e.target.checked)} />
              Genderless
            </label>
            {!genderless && (
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                <label style={labelStyle}>Male %
                  <input style={inputStyle} type="number" min={0} max={100} value={maleRatio} onChange={e => {
                    const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    setMaleRatio(val);
                    setFemaleRatio(Math.max(0, 100 - val));
                  }} />
                </label>
                <label style={labelStyle}>Female %
                  <input style={inputStyle} type="number" min={0} max={100} value={femaleRatio} onChange={e => {
                    const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    setFemaleRatio(val);
                    setMaleRatio(Math.max(0, 100 - val));
                  }} />
                </label>
              </div>
            )}
          </div>
        </div>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Abilities & Formes</div>
          <label style={labelStyle}>Abilities (slots 0/1/H)
            {abilityRows.map((r,i)=> (
              <div key={r.slot} style={{display:'grid', gridTemplateColumns:'24px 1fr auto', gap:6, alignItems:'center', marginTop:4}}>
                <span className="dim">{r.slot}</span>
                <select style={inputStyle} value={r.name} onChange={e=>setAbilities({...abilities, [r.slot]: e.target.value})}>
                  <option value="">Select ability</option>
                  {abilityOptions.map(a => (
                    <option key={a.id} value={a.name}>{a.name}</option>
                  ))}
                </select>
                {i===abilityRows.length-1 && abilityRows.length<3 && (
                  <button type="button" onClick={()=>{
                    const nextSlot = r.slot==='0' ? '1' : 'H';
                    setAbilities({...abilities, [nextSlot]: ''});
                  }}>+ Slot</button>
                )}
              </div>
            ))}
          </label>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8}}>
            <label style={labelStyle}>Other Formes
              <input style={inputStyle} value={otherFormes} onChange={e=>setOtherFormes(e.target.value)} placeholder="Alcremie-Ruby-Cream" />
            </label>
            <label style={labelStyle}>Cosmetic Formes
              <input style={inputStyle} value={cosmeticFormes} onChange={e=>setCosmeticFormes(e.target.value)} placeholder="Alcremie-Ruby-Cream" />
            </label>
            <label style={labelStyle}>Forme Order
              <input style={inputStyle} value={formeOrder} onChange={e=>setFormeOrder(e.target.value)} placeholder="Alcremie, Alcremie-Ruby-Cream" />
            </label>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center'}}>
            <input
              style={inputStyle}
              value={derivedFormeName}
              onChange={e=>setDerivedFormeName(e.target.value)}
              placeholder="Create derived forme (e.g., Crimson)"
            />
            <button
              type="button"
              onClick={() => {
                const base = baseSpecies || name || 'CustomMon';
                const formeLabel = derivedFormeName.trim();
                if (!formeLabel || !onCreateDerivedForme) return;
                const derivedName = `${base}-${formeLabel}`;
                const { entry } = buildEntry();
                const clone = { ...entry, name: derivedName, baseSpecies: base, forme: formeLabel, baseForme: entry.baseForme || formeLabel } as DexSpecies;
                onCreateDerivedForme({ key: normalizeName(derivedName), entry: clone });
                setDerivedFormeName('');
              }}
            >
              Create Forme
            </button>
          </div>
        </div>
        <div style={sectionStyle}>
          <div style={{fontWeight:'bold'}}>Learnset</div>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {learnsetEntries.map((entry, idx) => (
              <div key={`${entry.id}-${idx}`} style={{display:'grid', gridTemplateColumns:'1fr 110px 90px auto', gap:8, alignItems:'center'}}>
                <input
                  style={inputStyle}
                  list="dex-moves-list"
                  value={entry.id}
                  onChange={e => {
                    const next = e.target.value;
                    setLearnsetEntries(prev => prev.map((r, i) => i === idx ? { ...r, id: next } : r));
                  }}
                  placeholder="Move name"
                />
                <select
                  style={inputStyle}
                  value={entry.method}
                  onChange={e => {
                    const next = e.target.value as LearnsetEntry['method'];
                    setLearnsetEntries(prev => prev.map((r, i) => i === idx ? { ...r, method: next } : r));
                  }}
                >
                  <option value="L">Level</option>
                  <option value="M">TM/HM</option>
                  <option value="T">Tutor</option>
                  <option value="E">Egg</option>
                </select>
                {entry.method === 'L' ? (
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={100}
                    value={entry.level ?? 1}
                    onChange={e => {
                      const val = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                      setLearnsetEntries(prev => prev.map((r, i) => i === idx ? { ...r, level: val } : r));
                    }}
                  />
                ) : (
                  <span className="dim" style={{fontSize: 11}}>—</span>
                )}
                <button type="button" onClick={() => setLearnsetEntries(prev => prev.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setLearnsetEntries(prev => [...prev, { id: '', method: 'L', level: 1 }])}>+ Add Move</button>
          </div>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            <button onClick={onSave} disabled={!name.trim() || saving}>&gt; Save Local</button>
            {onAddToPC && (
              <button onClick={onSaveAndAdd} disabled={!name.trim() || saving}>&gt; Save + Add to PC</button>
            )}
          </div>
          {onAddToPC && (
            <div>
              <label className="dim">Level to add</label>
              <input style={inputStyle} type="number" min={1} max={255} value={level} onChange={e=>setLevel(Number(e.target.value)||1)} />
            </div>
          )}
          {error && <span style={{color:'#ff8'}}>{error}</span>}
          <p className="dim" style={{marginTop:4, marginBottom: 0}}>
            Local customs are stored in-browser and merged into the Dex. To share, export your PC box or team.
          </p>
        </div>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        <div style={{border:'1px solid #ccc', borderRadius:8, padding:12, background:'#f7f7f7'}}>
          <div style={{fontWeight:'bold', marginBottom:8}}>Preview (Lv. 50)</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
            <div>
              <div style={{fontSize: 14, fontWeight: 'bold'}}>{name || 'CustomMon'}</div>
              <div style={{display:'flex', gap:4, flexWrap:'wrap', marginTop:4}}>
                {(types.length ? types : ['Normal']).map(t => (
                  <span key={t} style={{fontSize: 10, padding: '2px 6px', borderRadius: 4, border:'1px solid #bbb', background:'#fff'}}>{t}</span>
                ))}
              </div>
              <div style={{marginTop:8, fontSize: 11}}>
                Abilities: {Object.values(abilities).filter(Boolean).join(', ') || '—'}
              </div>
            </div>
            <div style={{fontSize: 11}}>
              HP {previewStats.hp}
              <br />Atk {previewStats.atk}
              <br />Def {previewStats.def}
              <br />SpA {previewStats.spa}
              <br />SpD {previewStats.spd}
              <br />Spe {previewStats.spe}
            </div>
          </div>
        </div>
        <h3 style={{margin:'0 0 4px 0'}}>Sprite Slots</h3>
        {Object.entries(groupedSprites).map(([group, slots]) => (
          <div key={group} style={{border:'1px solid #ccc', borderRadius:8, padding:10, background:'#f7f7f7'}}>
            <div style={{fontWeight:'bold', marginBottom:8}}>{group}</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10}}>
              {slots.map(({ slot, label }) => {
                const preview = spriteDrafts[slot] || placeholderSpriteDataURL(label.slice(0, 2).toUpperCase(), 80, 80);
                return (
                  <label key={slot} style={{display:'flex', flexDirection:'column', gap:6, alignItems:'center', border:'1px solid #ddd', borderRadius:6, padding:8}}>
                    <span style={{fontSize:11, textAlign:'center'}}>{label}</span>
                    <img alt={label} src={preview} style={{width:80, height:80, imageRendering:'pixelated', objectFit:'contain'}} />
                    <input type="file" accept=".png,.gif,.webp" onChange={e => onFileSprite(slot, e)} />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <p className="dim" style={{marginTop:0}}>
          Tip: You can upload sprites later from the Pokédex detail panel.
        </p>
        <datalist id="dex-species-list">
          {speciesOptions.map(s => (
            <option key={s.id || s.name} value={s.name} />
          ))}
        </datalist>
        <datalist id="dex-prevo-list">
          {speciesOptions.map(s => (
            <option key={`${s.id || s.name}-prevo`} value={s.name} />
          ))}
        </datalist>
        <datalist id="dex-moves-list">
          {moveOptions.map(m => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
