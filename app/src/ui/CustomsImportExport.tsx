import React, { useState } from 'react';
import { getCustomDex, getCustomLearnsets } from '../data/adapter';

export function CustomsImportExport() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function exportCustoms() {
    setError(null); setOk(null);
    try {
      const dex = getCustomDex();
      const learnsets = getCustomLearnsets();
      const blob = new Blob([JSON.stringify({ dex, learnsets }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pokettrpg-customs.json'; a.click();
      URL.revokeObjectURL(url);
      setOk('Exported pokettrpg-customs.json');
    } catch (e:any) { setError(e?.message || 'Failed to export'); }
  }

  function importCustoms(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setOk(null);
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || '{}'));
        if (obj.dex) localStorage.setItem('ttrpg.customDex', JSON.stringify(obj.dex));
        if (obj.learnsets) localStorage.setItem('ttrpg.customLearnsets', JSON.stringify(obj.learnsets));
        try { localStorage.setItem('ttrpg.customsReloadPending', '1'); } catch {}
        setOk('Customs imported. Use the Reload banner at the top to apply.');
      } catch (e:any) { setError(e?.message || 'Invalid file'); }
    };
    reader.readAsText(file);
  }

  return (
    <section className="panel">
      <h3>Customs: Export / Import</h3>
      <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
        <button onClick={exportCustoms}>&gt; Export Customs</button>
        <label className="button-like">
          <input type="file" accept="application/json" onChange={importCustoms} style={{display:'none'}} />
          <span>&gt; Import Customs</span>
        </label>
        {ok && <span style={{color:'#7f7'}}>{ok}</span>}
        {error && <span style={{color:'#ff8'}}>{error}</span>}
      </div>
    </section>
  );
}
