import React, { useEffect, useState } from 'react';

const LS_BADGES = 'ttrpg.badgecase';

type Badge = { image?: string; earned: boolean; name?: string };
type BadgeState = { color: string; badges: Badge[] };

const defaultState: BadgeState = {
	color: '#c83a3a',
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
		try { const raw = localStorage.getItem(LS_BADGES); if (raw) return { ...defaultState, ...JSON.parse(raw) }; } catch {}
		return defaultState;
	});
	useEffect(()=>{ try { localStorage.setItem(LS_BADGES, JSON.stringify(state)); } catch {} }, [state]);

	const setColor = (color:string)=> setState(prev=>({ ...prev, color }));
	const toggleEarned = (i:number)=> setState(prev=>({ ...prev, badges: prev.badges.map((b,idx)=> idx===i? { ...b, earned: !b.earned }: b)}));
	const setImage = (i:number, dataUrl?:string)=> setState(prev=>({ ...prev, badges: prev.badges.map((b,idx)=> idx===i? { ...b, image: dataUrl }: b)}));
	const setName = (i:number, name?:string)=> setState(prev=>({ ...prev, badges: prev.badges.map((b,idx)=> idx===i? { ...b, name }: b)}));

	const onUpload = (i:number)=>{
		const input = document.createElement('input'); input.type='file'; input.accept='image/*';
		input.onchange=()=>{ const f=input.files&&input.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=> setImage(i, String(r.result||'')); r.readAsDataURL(f); };
		input.click();
	};

	// Dimensions
	const caseW = 560;
	const baseH = 360; // bottom height
	const lidH = baseH; // make lid same size as bottom

	// Slot geometry: ensure images are larger than the ring but do not overlap neighboring cells
	const slotOuter = 112;  // grid cell box
	const ringSize = 96;    // decorative circle size
	const imageSize = 108;  // slightly larger than ring

	const rootStyle: React.CSSProperties = { display:'grid', gap:12, justifyItems:'center' };
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
		position:'relative', width:slotOuter, height:slotOuter, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer'
	};
		const ringStyle: React.CSSProperties = {
			position:'absolute', width:ringSize, height:ringSize, border:'2px solid #444', borderRadius:'50%', background:'#222', zIndex:1
		};

	return (
		<div style={rootStyle}>
			<h3 style={{margin:0}}>Badge Case</h3>
			<div>
				<label className="dim" style={{marginRight:8}}>Case Color:</label>
				<input type="color" value={state.color} onChange={e=> setColor((e.target as HTMLInputElement).value)} />
			</div>

			{/* Lid (same size as base) */}
			<div style={lidStyle}>
				{/* Decorative Poké Ball */}
				<div style={{ position:'absolute', top:10, right:10 }} aria-hidden>
					<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
						<circle cx="32" cy="32" r="30" fill="#ffffff" stroke="#000" strokeWidth="4" />
						<path d="M2,32 A30,30 0 0,1 62,32 L2,32 Z" fill="#e53935" />
						<rect x="2" y="30" width="60" height="4" fill="#000" />
						<circle cx="32" cy="32" r="10" fill="#fff" stroke="#000" strokeWidth="4" />
						<circle cx="32" cy="32" r="4" fill="#fff" stroke="#000" strokeWidth="3" />
					</svg>
				</div>
				<EditableNames names={state.badges.map(b=> b.name||'')} onChange={(idx,val)=> setName(idx,val)} />
			</div>

			{/* Base with badge slots */}
			<div style={baseStyle}>
				{state.badges.map((b,i)=> (
					<div key={i} style={slotStyle} className={b.earned? 'checked':''} onClick={()=> toggleEarned(i)} title={b.name || `Badge ${i+1}`}>
						<div style={ringStyle} />
									{b.image ? (
										<img src={b.image} alt={`Badge ${i+1}`} style={{ position:'relative', zIndex:2, width:imageSize, height:imageSize, objectFit:'contain', borderRadius:'50%' }} />
						) : (
							b.earned ? <span style={{color:'#fff', fontSize:24}}>✔</span> : null
						)}
					</div>
				))}
			</div>

			{/* Controls */}
			<div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, width:caseW }}>
				{state.badges.map((b,i)=> (
					<div key={i} style={{ display:'flex', gap:6, justifyContent:'center' }}>
						<button className="mini" onClick={()=> onUpload(i)}>Add Image</button>
						{b.image && <button className="mini" onClick={()=> setImage(i, undefined)}>Clear</button>}
					</div>
				))}
			</div>

			{/* Subtle helper to reduce blank space and guide users */}
			<div className="dim" style={{fontSize:'0.85em', textAlign:'center', maxWidth:caseW}}>
				Tip: Click a slot to mark a badge earned. Use “Add Image” to place your badge art; images display slightly larger than the ring to look pinned but won’t overlap neighboring slots.
			</div>
		</div>
	);
}

type EditableNamesProps = { names: string[]; onChange: (index:number, value:string) => void };

function EditableNames({ names, onChange }: EditableNamesProps) {
	const [editing, setEditing] = useState<number | null>(null);
	const [value, setValue] = useState('');
	useEffect(()=>{ if (editing!=null) setValue(names[editing]||''); }, [editing]);

	const pillStyle: React.CSSProperties = { padding:'6px 10px', borderRadius:6, background:'rgba(0,0,0,0.25)', cursor:'pointer', display:'inline-block', color:'#fff' };
	const inputStyle: React.CSSProperties = { width:130, fontSize:14, padding:'4px 6px', borderRadius:4, border:'1px solid #888' };
	const row = (idxs:number[]) => (
		<p style={{margin:6}}>
			{idxs.map((i,j)=> (
				<span key={i} style={{ display:'inline-flex', alignItems:'center' }}>
					{editing===i ? (
						<input autoFocus value={value} onChange={e=> setValue((e.target as HTMLInputElement).value)} onBlur={()=>{ onChange(i, value.trim()); setEditing(null); }} onKeyDown={e=>{ if(e.key==='Enter'){ onChange(i, value.trim()); setEditing(null); } if(e.key==='Escape'){ setEditing(null); }}} style={inputStyle} />
					) : (
						<span style={pillStyle} onClick={()=> setEditing(i)} title="Click to rename badge">{names[i] || `Badge ${i+1}`}</span>
					)}
					{j<idxs.length-1 ? <span> &nbsp;•&nbsp; </span> : null}
				</span>
			))}
		</p>
	);
	return (
		<div style={{ color:'#fff', fontWeight:600, textAlign:'center', fontSize:14 }}>
			{row([0,1,2,3])}
			{row([4,5,6,7])}
		</div>
	);
}

