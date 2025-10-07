import React, { useState } from 'react';
import { saveCustomDex, saveCustomLearnset, normalizeName, saveCustomSprite } from '../data/adapter';

export function CustomsFileImporter() {
  const [speciesText, setSpeciesText] = useState('');
  const [learnsetText, setLearnsetText] = useState('');
  const [spriteDataUrl, setSpriteDataUrl] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [err, setErr] = useState<string>('');

  function onLoadSprite(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setSpriteDataUrl(String(rd.result || ''));
    rd.readAsDataURL(f);
  }

  function onImport() {
    setMsg(''); setErr('');
    try {
      const species = JSON.parse(speciesText || '{}');
      const key = normalizeName(species.name || species.id || 'custom');
      if (!species || !species.name) throw new Error('species.json must include name');
      saveCustomDex(key, species);
      if (learnsetText.trim()) {
        const ls = JSON.parse(learnsetText);
        saveCustomLearnset(key, ls);
      }
      if (spriteDataUrl) saveCustomSprite(key, 'front', spriteDataUrl);
      try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
      setMsg('Imported. Reload banner will appear at the top.');
    } catch (e:any) {
      setErr(e?.message || 'Invalid JSON');
    }
  }

  return (
    <section className="panel">
      <h3>Import species.json / learnset.json (in-app)</h3>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          <label>species.json</label>
          <textarea rows={10} placeholder='{ "name": "Alcremie", ... }' value={speciesText} onChange={e=>setSpeciesText(e.target.value)} />
          <label>learnset.json (optional)</label>
          <textarea rows={8} placeholder='{ "dazzlinggleam": ["9L1"], ... }' value={learnsetText} onChange={e=>setLearnsetText(e.target.value)} />
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          <label>Sprite PNG (optional)</label>
          <input type="file" accept="image/png,image/webp,image/gif" onChange={onLoadSprite} />
          {spriteDataUrl && <img src={spriteDataUrl} alt="sprite" style={{width:96, height:96, imageRendering:'pixelated'}} />}
          <button onClick={onImport}>&gt; Import</button>
          {msg && <span style={{color:'#7f7'}}>{msg}</span>}
          {err && <span style={{color:'#ff8'}}>{err}</span>}
          <p className="dim">Tip: Provide Showdown-style species and learnset JSONs.</p>
        </div>
      </div>
    </section>
  );
}
