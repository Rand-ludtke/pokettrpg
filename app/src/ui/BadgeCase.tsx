import React, { useEffect, useMemo, useState } from 'react';

const LS_BADGES = 'ttrpg.badgecase';
const LS_CASE_COLOR = 'ttrpg.badgecase.color';

type Badge = { image?: string; earned: boolean; name?: string };

type BadgeState = {
  color: string;
  badges: Badge[]; // 8 slots
};

const defaultState: BadgeState = {
  color: '#ff0000',
  badges: Array.from({ length: 8 }, () => ({ earned: false })),
};

export function BadgeCase() {
  const [state, setState] = useState<BadgeState>(() => {
    try {
      const raw = localStorage.getItem(LS_BADGES);
      if (raw) return { ...defaultState, ...JSON.parse(raw) } as BadgeState;
    } catch {}
    return defaultState;
  });

  useEffect(() => {
    try { localStorage.setItem(LS_BADGES, JSON.stringify(state)); } catch {}
  }, [state]);

  function setColor(color: string) { setState(prev => ({ ...prev, color })); }
  function toggleEarned(i: number) {
    setState(prev => ({ ...prev, badges: prev.badges.map((b, idx) => idx === i ? { ...b, earned: !b.earned } : b) }));
  }
  function setImage(i: number, dataUrl?: string) {
    setState(prev => ({ ...prev, badges: prev.badges.map((b, idx) => idx === i ? { ...b, image: dataUrl } : b) }));
  }

  function onUpload(i: number) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { setImage(i, String(reader.result || '')); };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  const rootStyle: React.CSSProperties = { display:'grid', gap:12, justifyItems:'center' };
  const lidStyle: React.CSSProperties = {
    position:'relative', width:420, height:260, border:'3px solid #000', borderRadius:15,
    backgroundColor: state.color, display:'flex', alignItems:'center', justifyContent:'center',
  };
  const baseStyle: React.CSSProperties = {
    width:420, height:260, border:'3px solid #000', borderRadius:15, background:'#111', display:'grid',
    gridTemplateColumns:'repeat(4, 1fr)', gap:10, justifyItems:'center', alignItems:'center', padding:20,
    boxShadow:'0 6px 10px rgba(0,0,0,0.5)'
  };
  const slotStyle: React.CSSProperties = {
    width:60, height:60, background:'#222', border:'2px solid #444', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer'
  };

  return (
    <div style={rootStyle}>
      <h3 style={{margin:0}}>Badge Case</h3>
      <div>
        <label className="dim" style={{marginRight:8}}>Case Color:</label>
        <input type="color" value={state.color} onChange={e=> setColor((e.target as HTMLInputElement).value)} />
      </div>
      <div style={lidStyle}>
        <div style={{ position:'absolute', top:10, right:10, width:60, height:60, borderRadius:'50%', border:'3px solid #000', background:'radial-gradient(circle at 30% 30%, white 35%, black 36%, black 39%, red 39%, red 75%, black 76%)' }} />
        <div style={{ color:'#fff', fontWeight:600, textAlign:'center', fontSize:12, marginTop:80 }}>
          <p>Boulder • Cascade • Thunder • Rainbow</p>
          <p>Soul • Marsh • Volcano • Earth</p>
        </div>
      </div>
      <div style={baseStyle}>
        {state.badges.map((b, i) => (
          <div key={i} style={slotStyle} className={b.earned ? 'checked' : ''} onClick={() => toggleEarned(i)} title={b.name || `Badge ${i+1}`}>
            {b.image ? (
              <img src={b.image} alt={`Badge ${i+1}`} style={{ width:'100%', height:'100%', objectFit:'contain', borderRadius:'50%' }} />
            ) : (
              b.earned ? <span style={{color:'#fff', fontSize:24}}>✔</span> : null
            )}
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, width:420 }}>
        {state.badges.map((b,i)=> (
          <div key={i} style={{ display:'flex', gap:6, justifyContent:'center' }}>
            <button className="mini" onClick={()=> onUpload(i)}>Add Image</button>
            {b.image && <button className="mini" onClick={()=> setImage(i, undefined)}>Clear</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
