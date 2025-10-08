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
			badges: Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false, image: undefined })),
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
			badges: Array.isArray(raw.badges) && raw.badges.length ? raw.badges.slice(0,8).map((b: any, i: number) => ({ name: String((b && b.name) || (i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '')), earned: !!(b && b.earned), image: (b && typeof b.image==='string') ? b.image : undefined })) : Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false, image: undefined })),
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
		badges: Array.from({ length: 8 }, (_, i) => ({ name: i===0? 'string' : i===1? 'ranch' : i===2? 'generic fight badge' : '', earned: false, image: undefined })),
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
	const [activeInvTab, setActiveInvTab] = useState<string>(() => (DEFAULT_SECTIONS[0].key));
	const [addingItem, setAddingItem] = useState<boolean>(false);
	const [newItemName, setNewItemName] = useState<string>('');
	const [newItemCount, setNewItemCount] = useState<number>(1);
	useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(ch)); } catch {} }, [ch]);

	const invParsed = useMemo(() => {
		const map: Record<string, Array<{ name: string; count: number }>> = {};
		for (const s of ch.inventory) map[s.key] = parseInventory(s.lines);
		return map;
	}, [ch.inventory]);

	// Derived maxes; updated per latest spec: HP = 10 + Fortitude; SP = 5 + Athletics
	const hpMax = useMemo(() => 10 + (ch.stats.fortitude||0), [ch.stats]);
	const spMax = useMemo(() => 5 + (ch.stats.athletics||0), [ch.stats]);
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
		{ name: 'Guys Type trainer', desc: '1.5x catch rate if a Pokémon has more than one head/being.', reqText: 'No requirements' },
		{ name: 'Expanding Horizons', desc: 'Wild Card: gain a Type Specialty. If you have one, gain another (no limit).', reqText: 'No requirements' },
		{ name: 'In Tune', desc: 'Become in tune with your Type Specialty (bonuses vary by type).', req: reqTypeSpec, reqText: 'Requires Type Specialty' },
	];

	const canTake = (t: {req?: any}) => (t.req ? t.req(ch.stats, hasTrait, hasTypeSpec) : true);

	// Helpers to rebuild inventory lines from parsed list
	function setSectionLinesByKey(key: string, newLines: string) {
		const idx = ch.inventory.findIndex(s => s.key === key);
		if (idx < 0) return;
		setCh({ ...ch, inventory: ch.inventory.map((s,i)=> i===idx ? { ...s, lines: newLines } : s) });
	}
	function setItemCount(key: string, index: number, nextCount: number) {
		const list = (invParsed[key] || []).slice();
		if (index < 0 || index >= list.length) return;
		if (nextCount <= 0) { list.splice(index, 1); } else { list[index] = { ...list[index], count: nextCount }; }
		const text = list.map(it => `${it.name}${it.count>1?` + " x${it.count}" + `:''}`).join('\n');
		setSectionLinesByKey(key, text);
	}
	function addItemToSection(key: string, name: string, count: number) {
		name = name.trim(); if (!name) return;
		const cur = ch.inventory.find(s => s.key === key)?.lines || '';
		const next = (cur ? (cur.trim() + '\n') : '') + `${name}${count>1?` + " x${count}" + `:''}`;
		setSectionLinesByKey(key, next);
	}

	// Layout (skinnier, three columns similar to the reference)
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

					{/* Personality */}
					<label>
						<div className="label"><strong>Personality</strong></div>
						<textarea rows={2} value={ch.personality} onChange={e => setCh({ ...ch, personality: e.target.value })} />
					</label>
				</div>

				{/* Right: Trainer Traits (skinny, scrollable) */}
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

			{/* Badge Case */}
			<div style={{ marginTop:12, border:'1px solid var(--accent)', borderRadius:6, padding:8 }}>
				<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
					<h3 style={{ margin:0 }}>Badge Case</h3>
					<span className="dim">Mark earned badges and label them</span>
				</div>
				<div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginTop:8 }}>
								{ch.badges.map((b, i) => (
									<div key={i} style={{ border:'1px solid var(--accent)', borderRadius:6, padding:6, display:'grid', gap:8, alignItems:'center', justifyItems:'center' }}>
										{/* Big clickable box: toggles earned; shows image if present else a big check if earned or empty */}
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
		</section>
	);
}
