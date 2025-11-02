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
  badges: [
    { earned:false, name:'Boulder' },
    { earned:false, name:'Cascade' },
    { earned:false, name:'Thunder' },
    { earned:false, name:'Rainbow' },
    { earned:false, name:'Soul' },
    { earned:false, name:'Marsh' },
    { earned:false, name:'Volcano' },
    { earned:false, name:'Earth' },
  ],
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
  function setName(i: number, name?: string) {
    setState(prev => ({ ...prev, badges: prev.badges.map((b, idx) => idx === i ? { ...b, name } : b) }));
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
  const caseW = 560;
  const lidH = 180;
  const baseH = 360;
  const lidStyle: React.CSSProperties = {
    position:'relative', width:caseW, height:lidH, border:'3px solid #000', borderRadius:15,
    backgroundColor: state.color, display:'flex', alignItems:'center', justifyContent:'center',
    boxShadow:'0 6px 10px rgba(0,0,0,0.2)'
  };
  const baseStyle: React.CSSProperties = {
    position:'relative', width:caseW, height:baseH, border:'3px solid #000', borderRadius:15, background:'#111', display:'grid',
    gridTemplateColumns:'repeat(4, 1fr)', gap:16, justifyItems:'center', alignItems:'center', padding:28,
    boxShadow:'0 6px 10px rgba(0,0,0,0.5)'
  };
  const slotStyle: React.CSSProperties = {
    width:96, height:96, background:'#222', border:'2px solid #444', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer'
  };

  return (
    <div style={rootStyle}>
      <h3 style={{margin:0}}>Badge Case</h3>
      <div>
        <label className="dim" style={{marginRight:8}}>Case Color:</label>
        <input type="color" value={state.color} onChange={e=> setColor((e.target as HTMLInputElement).value)} />
      </div>
      <div style={lidStyle}>
        {/* Poké Ball icon (SVG) inspired by provided reference */}
        <div style={{ position:'absolute', top:10, right:10 }} aria-hidden>
          <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            {/* outer circle */}
            <circle cx="32" cy="32" r="30" fill="#ffffff" stroke="#000" strokeWidth="4" />
            {/* top half red */}
            <path d="M2,32 A30,30 0 0,1 62,32 L2,32 Z" fill="#e53935" stroke="#000" strokeWidth="0" />
            {/* middle black band */}
            <rect x="2" y="30" width="60" height="4" fill="#000" />
            {/* center ring */}
            <circle cx="32" cy="32" r="10" fill="#fff" stroke="#000" strokeWidth="4" />
            <circle cx="32" cy="32" r="4" fill="#fff" stroke="#000" strokeWidth="3" />
          </svg>
        </div>
        {/* Editable badge names */}
        <EditableNames
          names={state.badges.map(b => b.name || '')}
          onChange={(idx, val) => setName(idx, val)}
        />
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
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, width:caseW }}>
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

type EditableNamesProps = { names: string[]; onChange: (index:number, value:string) => void };

function EditableNames({ names, onChange }: EditableNamesProps) {
  // Inline editing state
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (editing != null) setValue(names[editing] || '');
  }, [editing]);

  function startEdit(index:number) {
    setEditing(index);
  }
  function commit() {
    if (editing == null) return;
    onChange(editing, value.trim());
    setEditing(null);
  }
  function cancel() { setEditing(null); }

  const labelStyle: React.CSSProperties = { color:'#fff', fontWeight:600, textAlign:'center', fontSize:14, marginTop:70, lineHeight:1.9 };
  const pillStyle: React.CSSProperties = { padding:'3px 8px', borderRadius:6, background:'rgba(0,0,0,0.25)', cursor:'pointer', display:'inline-block' };
  const inputStyle: React.CSSProperties = { width:110, fontSize:13, padding:'3px 5px', borderRadius:4, border:'1px solid #888' };

  const firstRow = [0,1,2,3];
  const secondRow = [4,5,6,7];

  const renderRow = (idxs:number[]) => (
    <p>
      {idxs.map((i, j) => (
        <span key={i} style={{ display:'inline-flex', alignItems:'center' }}>
          {editing === i ? (
            <input
              autoFocus
              value={value}
              onChange={e=> setValue((e.target as HTMLInputElement).value)}
              onBlur={commit}
              onKeyDown={e=> { if (e.key==='Enter') commit(); if (e.key==='Escape') cancel(); }}
              style={inputStyle}
            />
          ) : (
            <span style={pillStyle} onClick={() => startEdit(i)} title="Click to rename badge">
              {names[i] || `Badge ${i+1}`}
            </span>
          )}
          {j < idxs.length - 1 ? <span> &nbsp;•&nbsp; </span> : null}
        </span>
      ))}
    </p>
  );

  return (
    <div style={labelStyle}>
      {renderRow(firstRow)}
      {renderRow(secondRow)}
    </div>
  );
}
