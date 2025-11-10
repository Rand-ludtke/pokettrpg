import React, { useMemo, useState } from 'react';
import { BattlePokemon } from '../types';
import { DexSpecies, saveCustomDex, saveCustomLearnset, prepareBattle, toPokemon, loadShowdownDex, placeholderSpriteDataURL, normalizeName, saveCustomSprite } from '../data/adapter';

type StatBlock = { hp:number; atk:number; def:number; spa:number; spd:number; spe:number };

export function CustomDexBuilder({ onAddToPC }: { onAddToPC: (mons: BattlePokemon[]) => void }) {
  const [name, setName] = useState('');
  const [types, setTypes] = useState<string[]>(['Normal']);
  const [gender, setGender] = useState<'M'|'F'|'N'|'N/A'|'F/M'|'F'|'M'|string>('N');
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
  const [learnsetRaw, setLearnsetRaw] = useState<string>('');
  const [level, setLevel] = useState<number>(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

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

  function onFileSprite(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function buildEntry(): { key: string; entry: DexSpecies } {
    const key = normalizeName(name || baseForme || 'custom');
    const entry: DexSpecies = {
      name: name || baseForme || 'CustomMon',
      types: types.slice(0,2) as any,
      gender: (gender as any),
      baseStats: { ...baseStats },
      abilities: Object.fromEntries(Object.entries(abilities).filter(([,v])=>v && v.trim())) as any,
      heightm, weightkg, color,
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
    // Accept comma/space/line-separated move names → convert to { movenameid: ["8L1"] }
    const out: Record<string, any> = {};
    const parts = learnsetRaw.split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
    for (const m of parts) {
      const id = normalizeName(m);
      out[id] = ["9L1"]; // tag learned in gen9 at level 1 (neutral for legality)
    }
    return out;
  }

  async function onSave() {
    setSaving(true); setError(null);
    try {
      const { key, entry } = buildEntry();
      saveCustomDex(key, entry);
      const ls = parseLearnset();
      if (Object.keys(ls).length) saveCustomLearnset(key, ls);
      if (previewUrl) {
        saveCustomSprite(normalizeName(name || baseForme || 'CustomMon'), 'front', previewUrl);
      }
    } catch (e:any) { setError(e?.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function onSaveAndAdd() {
    await onSave();
    const dex = await loadShowdownDex();
    const p = toPokemon(name || baseForme || 'CustomMon', dex.pokedex, level);
    if (p) onAddToPC([prepareBattle(p)]);
  }

  const abilityRows = Object.keys(abilities).map(k=>({slot:k, name:abilities[k]}));

  return (
    <section className="panel">
      <h3>Create Custom Pokémon</h3>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          <label>Name <input value={name} onChange={e=>setName(e.target.value)} placeholder="Alcremie" /></label>
          <label>Base Forme <input value={baseForme} onChange={e=>setBaseForme(e.target.value)} placeholder="Vanilla-Cream" /></label>
          <label>Types <input value={types.slice(0,2).join(', ')} onChange={e=>{
            const parsed = parseCSVList(e.target.value).slice(0,2);
            setTypes(parsed.length ? parsed : ['Normal']);
          }} placeholder="Fairy / Grass, Poison or Steel" /></label>
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6}}>
            {(['hp','atk','def','spa','spd','spe'] as const).map(stat=> (
              <label key={stat} style={{display:'flex', flexDirection:'column'}}>
                {stat.toUpperCase()}
                <input type="number" min={1} max={255} value={baseStats[stat]} onChange={e=>setBaseStats({...baseStats,[stat]:Number(e.target.value)||1})} />
              </label>
            ))}
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6}}>
            <label>Gender <input value={gender as any} onChange={e=>setGender(e.target.value)} placeholder="M/F/N" /></label>
            <label>Color <input value={color} onChange={e=>setColor(e.target.value)} /></label>
            <label>Height (m) <input type="number" value={heightm} onChange={e=>setHeightm(Number(e.target.value)||0)} /></label>
            <label>Weight (kg) <input type="number" value={weightkg} onChange={e=>setWeightkg(Number(e.target.value)||0)} /></label>
            <label>Prevo <input value={prevo} onChange={e=>setPrevo(e.target.value)} /></label>
            <label>Evo Type
              <select value={evoType} onChange={e=>setEvoType(e.target.value)}>
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
            <label>Evo Level <input type="number" min={1} max={100} value={evoLevel} onChange={e=>{
              const v = e.target.value;
              setEvoLevel(v === '' ? '' : Math.max(1, Math.min(100, Number(v)||1)));
            }} placeholder="16" /></label>
            <label>Evo Condition <input value={evoCondition} onChange={e=>setEvoCondition(e.target.value)} placeholder="Daytime, Holding Razor Claw, etc." /></label>
            <label>Evoutions (CSV) <input value={evosCsv} onChange={e=>setEvosCsv(e.target.value)} placeholder="Raichu, Raichu-Alola" /></label>
            <label>Egg Groups <input value={eggGroups} onChange={e=>setEggGroups(e.target.value)} placeholder="Fairy, Amorphous" /></label>
            <label>Can Gigantamax <input value={gmax} onChange={e=>setGmax(e.target.value)} placeholder="G-Max Finale" /></label>
            <label>Required Item <input value={requiredItem} onChange={e=>setRequiredItem(e.target.value)} placeholder="Charizardite X" /></label>
          </div>
          <label>Abilities (slots 0/1/H)
            {abilityRows.map((r,i)=> (
              <div key={r.slot} style={{display:'flex', gap:6, alignItems:'center', marginTop:4}}>
                <span className="dim" style={{width:18}}>{r.slot}</span>
                <input value={r.name} onChange={e=>setAbilities({...abilities, [r.slot]: e.target.value})} placeholder={r.slot==='H'? 'Hidden Ability' : 'Ability'} />
                {i===abilityRows.length-1 && abilityRows.length<3 && (
                  <button type="button" onClick={()=>{
                    const nextSlot = r.slot==='0' ? '1' : 'H';
                    setAbilities({...abilities, [nextSlot]: ''});
                  }}>+ Slot</button>
                )}
              </div>
            ))}
          </label>
          <label>Other Formes <input value={otherFormes} onChange={e=>setOtherFormes(e.target.value)} placeholder="Alcremie-Ruby-Cream, ..." /></label>
          <label>Cosmetic Formes <input value={cosmeticFormes} onChange={e=>setCosmeticFormes(e.target.value)} placeholder="Alcremie-Ruby-Cream, ..." /></label>
          <label>Forme Order <input value={formeOrder} onChange={e=>setFormeOrder(e.target.value)} placeholder="Alcremie, Alcremie-Ruby-Cream, ..." /></label>
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          <label>Learnset (comma or newline-separated move names)
            <textarea rows={10} value={learnsetRaw} onChange={e=>setLearnsetRaw(e.target.value)} placeholder="Dazzling Gleam, Decorate, Mystical Fire..." />
          </label>
          <label>Upload Sprite (optional)
            <input type="file" accept=".png,.gif,.webp" onChange={onFileSprite} />
          </label>
          <div className="slot large" style={{width:120, height:120, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <img className="pixel" alt="preview" src={previewUrl || placeholderSpriteDataURL('?')} style={{imageRendering:'pixelated', maxWidth:'100%', maxHeight:'100%'}} />
          </div>
          <div style={{display:'flex', gap:8}}>
            <button onClick={onSave} disabled={!name.trim() || saving}>&gt; Save Local</button>
            <button onClick={onSaveAndAdd} disabled={!name.trim() || saving}>&gt; Save + Add to PC</button>
          </div>
          <div>
            <label className="dim">Level to add</label>
            <input type="number" min={1} max={100} value={level} onChange={e=>setLevel(Number(e.target.value)||1)} />
          </div>
          {error && <span style={{color:'#ff8'}}>{error}</span>}
          <p className="dim" style={{marginTop:8}}>
            Note: Local customs are stored in-browser and merged into the Dex. To share, export your PC box or team.
          </p>
        </div>
      </div>
    </section>
  );
}
