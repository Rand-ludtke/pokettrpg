import React, { useEffect, useMemo, useState } from 'react';
import { spriteUrl } from '../data/adapter';

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
	starterPokemon?: string; // optional starter reference
	sheetBg?: string; // optional background image (data URL)
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
			starterPokemon: typeof raw.starterPokemon === 'string' ? raw.starterPokemon : '',
			sheetBg: typeof raw.sheetBg === 'string' ? raw.sheetBg : undefined,
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
		starterPokemon: '',
		sheetBg: undefined,
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
	// Trainer visual state (shared sprite with Lobby via localStorage; optional custom image for sheet)
	const [trainerSprite, setTrainerSprite] = useState<string>(() => {
		try { return localStorage.getItem('ttrpg.trainerSprite') || 'Ace Trainer'; } catch { return 'Ace Trainer'; }
	});
	const [trainerOptions, setTrainerOptions] = useState<string[]>([]);
	const [trainerImage, setTrainerImage] = useState<string>(() => {
		try { return localStorage.getItem('ttrpg.trainerImage') || ''; } catch { return ''; }
	});
	const [showSpritePicker, setShowSpritePicker] = useState<boolean>(false);
    const [spriteSearch, setSpriteSearch] = useState<string>('');
	const [editingBg, setEditingBg] = useState(false);
	// Item data (for icons + descriptions)
	const [itemData, setItemData] = useState<Record<string, any>>({});
	const [itemSuggest, setItemSuggest] = useState<string[]>([]);
	const [selectedInvItem, setSelectedInvItem] = useState<{ key: string; index: number } | null>(null);
	useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(ch)); } catch {} }, [ch]);
	useEffect(()=>{ try { localStorage.setItem('ttrpg.trainerSprite', trainerSprite); } catch {} }, [trainerSprite]);
	useEffect(()=>{ try { if (trainerImage) localStorage.setItem('ttrpg.trainerImage', trainerImage); else localStorage.removeItem('ttrpg.trainerImage'); } catch {} }, [trainerImage]);
	// Fetch items.json for inventory enhancements
	useEffect(()=>{
		let cancelled=false;
		(async()=>{
			try {
				const res = await fetch('/vendor/showdown/data/items.json');
				if(!res.ok) return; const json = await res.json();
				if(cancelled) return;
				// Normalize into id->entry map; id function replicates PS toID semantics
				const toID = (s:string)=> s.toLowerCase().replace(/[^a-z0-9]+/g,'');
				const map: Record<string, any> = {};
				Object.keys(json||{}).forEach(k=>{ const v = (json as any)[k]; if (v && typeof v === 'object') { const id = toID(v.name||k); map[id]=v; }});
				setItemData(map);
			} catch {}
		})();
		return ()=>{ cancelled=true; };
	},[]);
	useEffect(()=>{
		const api = (window as any)?.lan?.assets;
		if (!api?.listTrainers) return;
		let cancelled=false;
		function load(){
			api.listTrainers().then((r:any)=>{ if(cancelled) return; if (r?.ok && Array.isArray(r.list)) setTrainerOptions(r.list); else setTrainerOptions([]); }).catch(()=>{ if(!cancelled) setTrainerOptions([]); });
		}
		load();
		const t = setTimeout(load, 2000);
		return ()=>{ cancelled=true; clearTimeout(t); };
	}, []);

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
		const text = list.map(it => `${it.name}${it.count>1?` x${it.count}`:''}`).join('\n');
		setSectionLinesByKey(key, text);
	}
	function addItemToSection(key: string, name: string, count: number) {
		name = name.trim(); if (!name) return;
		const cur = ch.inventory.find(s => s.key === key)?.lines || '';
		const next = (cur ? (cur.trim() + '\n') : '') + `${name}${count>1?` x${count}`:''}`;
		setSectionLinesByKey(key, next);
		setNewItemName('');
		setItemSuggest([]);
	}

	// Suggestion handling while typing new item name
	useEffect(()=>{
		const q = newItemName.trim().toLowerCase();
		if (!q) { setItemSuggest([]); return; }
		const matches: string[] = [];
		for (const id in itemData) {
			const it = itemData[id]; const name = it?.name || '';
			if (!name) continue;
			if (name.toLowerCase().includes(q)) matches.push(name);
			if (matches.length>=10) break;
		}
		setItemSuggest(matches);
	}, [newItemName, itemData]);

	function getItemEntry(name: string) {
		const id = name.toLowerCase().replace(/[^a-z0-9]+/g,'');
		return itemData[id];
	}

	function renderItemIcon(entry: any, size=20) {
		if (!entry || typeof entry.spritenum !== 'number') return null;
		const num = entry.spritenum; // Showdown spritenum mapping
		const top = Math.floor(num / 16) * 24;
		const left = (num % 16) * 24;
		return <span style={{display:'inline-block', width:size, height:size, background:`transparent url(/vendor/showdown/sprites/itemicons-sheet.png) no-repeat -${left}px -${top}px`, imageRendering:'pixelated', transform: size!==24? `scale(${size/24})` : undefined, transformOrigin:'top left'}} />;
	}

	// Inventory tab icons (simple inline SVG outlines)
	function renderTabIcon(key: string, active: boolean) {
		const stroke = active ? '#fff' : '#222';
		const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' } as any;
		const sw = 2;
		switch(key){
			case 'items': // bag
				return <svg {...common}><path d="M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" stroke={stroke} strokeWidth={sw}/><path d="M9 8c0-2 1.5-3 3-3s3 1 3 3" stroke={stroke} strokeWidth={sw} strokeLinecap="round"/></svg>;
			case 'medicine': // cross
				return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3" stroke={stroke} strokeWidth={sw}/><path d="M12 7v10M7 12h10" stroke={stroke} strokeWidth={sw} strokeLinecap="round"/></svg>;
			case 'balls': // pokeball
				return <svg {...common}><circle cx="12" cy="12" r="8" stroke={stroke} strokeWidth={sw}/><path d="M4 12h16" stroke={stroke} strokeWidth={sw}/><circle cx="12" cy="12" r="2.5" stroke={stroke} strokeWidth={sw}/></svg>;
			case 'berries': // berry
				return <svg {...common}><path d="M12 7c3-3 6 0 6 3s-3 6-6 6-6-3-6-6 3-6 6-3Z" stroke={stroke} strokeWidth={sw}/><path d="M12 7c0-2 1-3 3-3" stroke={stroke} strokeWidth={sw} strokeLinecap="round"/></svg>;
			case 'key': // key
				return <svg {...common}><circle cx="10" cy="10" r="4" stroke={stroke} strokeWidth={sw}/><path d="M13.5 13.5 20 20M17 17l3-3" stroke={stroke} strokeWidth={sw} strokeLinecap="round"/></svg>;
			case 'tms': // book
				return <svg {...common}><path d="M5 6h9a3 3 0 0 1 3 3v9H8a3 3 0 0 0-3 3V6Z" stroke={stroke} strokeWidth={sw}/><path d="M8 6v12" stroke={stroke} strokeWidth={sw}/></svg>;
			case 'battle': // sword
				return <svg {...common}><path d="M6 18l4-4m0 0 6-6 2 2-6 6m-2 2-2 2" stroke={stroke} strokeWidth={sw} strokeLinecap="round"/></svg>;
			case 'other': // box
			default:
				return <svg {...common}><rect x="5" y="6" width="14" height="12" rx="2" stroke={stroke} strokeWidth={sw}/><path d="M5 10h14" stroke={stroke} strokeWidth={sw}/></svg>;
		}
	}

	// Accent color derived from type specialty
	const typeAccentMap: Record<string,string> = {
		fire: '#d05030', water: '#3070d0', grass: '#2f8f4f', electric: '#d0b020', ice: '#6fb8d8', fighting: '#a04040', poison: '#9140a0', ground: '#b09050', flying: '#6e75d8', psychic: '#d84fa8', bug: '#7a9a28', rock: '#a89038', ghost: '#705898', dragon: '#7038f8', dark: '#504840', steel: '#8f8fa0', fairy: '#e87fe7'
	};
	// Simplify styling: remove dark theme accents, use existing CSS accent variable only
	const accent = 'var(--accent)';

	// Layout makeover
	return (
		<>
		<section className="panel" style={{ padding:12 }}>
			<div style={{ display:'grid', gridTemplateColumns:'180px 1fr 270px', gap:12 }}>
				{/* Left: Stats vertical with bonuses */}
				<div style={{ display:'grid', alignContent:'start', gap:28 }}>
					{([
						['strength','Strength'],
						['athletics','Athletics'],
						['intelligence','Intelligence'],
						['speech','Speech'],
						['fortitude','Fortitude'],
					] as const).map(([k,label]) => {
						const val = (ch.stats as any)[k] || 0;
						const bonus = Math.ceil(val / 2);
						return (
							<div key={k} style={{ display:'grid', gridTemplateColumns:'100px 50px 36px', alignItems:'center', gap:4 }}>
								<span className="dim" style={{fontSize:'0.85em'}}>{label}</span>
								<input type="number" value={val} onChange={e => setCh({ ...ch, stats: { ...ch.stats, [k]: Number(e.target.value)||0 } })} style={{ width:54, textAlign:'center' }} />
								<span className="chip" title="Bonus = ceil(stat/2)" style={{minWidth:36, textAlign:'center'}}>+{bonus}</span>
							</div>
						);
					})}
					<div style={{ marginTop:4, display:'grid', gridTemplateColumns:'100px 50px 36px', alignItems:'center', gap:4 }}>
						<span className="dim" style={{fontSize:'0.85em'}}>LUCK</span>
						<input type="number" value={ch.stats.luck||0} onChange={(e)=> setCh({ ...ch, stats: { ...ch.stats, luck: Number(e.target.value)||0 }})} style={{ width:54, textAlign:'center' }} />
						<span className="chip" title="Bonus = ceil(stat/2)" style={{minWidth:36, textAlign:'center'}}>+{Math.ceil((ch.stats.luck||0)/2)}</span>
					</div>
				</div>

				{/* Middle: Name, status, Inventory */}
				<div style={{ display:'grid', gap:20, marginLeft:4 }}>
					{/* Name row */}
					<div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'center' }}>
						<input value={ch.name} onChange={e => setCh({ ...ch, name: e.target.value })} placeholder="Name"
							style={{ fontSize:'1.6em', fontWeight:600, textAlign:'center', padding:'8px 12px', border:`1px solid ${accent}` }} />
						<div style={{ display:'grid', gap:6, justifyItems:'center' }}>
							<label className="dim">lvl:</label>
							<input type="number" min={1} value={ch.level} onChange={e => setCh({ ...ch, level: Math.max(1, Number(e.target.value)||1) })} style={{ width:60, textAlign:'center', border:`1px solid ${accent}` }} />
						</div>
					</div>

					{/* HP / SP / Money small boxes */}
					<div style={{ display:'flex', gap:20 }}>
						<div>
							<div className="dim" style={{textAlign:'center'}}>HP</div>
							<input type="number" min={0} max={hpMax} value={ch.hpCurrent}
								onChange={e => setCh({ ...ch, hpCurrent: Math.max(0, Math.min(hpMax, Number(e.target.value)||0)) })}
								style={{ width:80, textAlign:'center' }} />
							<div className="dim" style={{textAlign:'center'}}>{`(${hpMax})`}</div>
						</div>
						<div>
							<div className="dim" style={{textAlign:'center'}}>SP</div>
							<input type="number" min={0} max={spMax} value={ch.spCurrent}
								onChange={e => setCh({ ...ch, spCurrent: Math.max(0, Math.min(spMax, Number(e.target.value)||0)) })}
								style={{ width:80, textAlign:'center' }} />
							<div className="dim" style={{textAlign:'center'}}>{`(${spMax})`}</div>
						</div>
						<div>
							<div className="dim" style={{textAlign:'center'}}>Money</div>
							<div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:6}}>
								<span style={{fontSize:'1.1em'}}>₽</span>
								<input type="number" min={0} value={ch.money||0} onChange={e=> setCh({ ...ch, money: Math.max(0, Number(e.target.value)||0) })} style={{ width:120, textAlign:'right' }} />
							</div>
						</div>
					</div>

					{/* Background controls */}
					<div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
						<button className="mini" onClick={()=> setEditingBg(v=>!v)}>{editingBg? 'Close BG' : 'Background'}</button>
						{ch.sheetBg && <button className="mini secondary" onClick={()=> setCh({...ch, sheetBg: undefined})}>Clear BG</button>}
					</div>

					{/* Inventory (tabbed, scrollable) */}
					<section style={{ border:'1px solid var(--accent)', borderRadius:6, padding:10, background:'var(--panel-bg)' }}>
						<div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
							{ch.inventory.map((sec: InventorySection) => {
								const active = activeInvTab===sec.key;
								return (
									<button
										key={sec.key}
										onClick={()=> setActiveInvTab(sec.key)}
										style={{
											width:44, height:44, padding:0, borderRadius:8, border:'1px solid var(--accent)', background: active? 'var(--accent)' : '#fff', color: active? '#fff':'#222', display:'flex', alignItems:'center', justifyContent:'center'
										}}
										className={active? 'active inv-tab':'inv-tab'} title={sec.label}
									>
										{renderTabIcon(sec.key, active)}
									</button>
								);
							})}
							<div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
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
							<div style={{ marginTop:8, position:'relative', display:'grid', gap:6 }}>
								<div style={{ display:'grid', gridTemplateColumns:'1fr 90px auto', gap:6 }}>
									<input placeholder="Item name" value={newItemName} onChange={e=> setNewItemName(e.target.value)} />
									<input type="number" min={1} value={newItemCount} onChange={e=> setNewItemCount(Math.max(1, Number(e.target.value)||1))} />
									<button onClick={()=>{ addItemToSection(activeInvTab, newItemName, newItemCount); setNewItemCount(1); setAddingItem(false); }}>Save</button>
								</div>
								{itemSuggest.length>0 && (
									<div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:`1px solid ${accent}`, zIndex:5, maxHeight:200, overflowY:'auto' }}>
										{itemSuggest.map(s => {
											const entry = getItemEntry(s);
											return <button key={s} style={{display:'flex', gap:8, alignItems:'center', width:'100%', textAlign:'left', padding:'4px 8px', background:'transparent', border:'none', borderBottom:'1px solid #eee'}} onClick={()=>{ setNewItemName(s); setItemSuggest([]); }}>
												{renderItemIcon(entry,20)}<span style={{flex:1}}>{s}</span>{entry?.desc && <span className="dim" style={{fontSize:'0.7em'}}>{entry.desc.slice(0,50)}</span>}
											</button>;
										})}
									</div>
								)}
							</div>
						)}
								<div style={{ maxHeight:560, minHeight:360, overflowY:'auto', marginTop:10, display:'grid', gap:8 }}>
							{(() => {
								const list = (activeInvTab==='items') ? (() => {
									const acc: Record<string, number> = {};
									for (const s of ch.inventory) {
										const arr = invParsed[s.key] || [];
										for (const it of arr) acc[it.name] = (acc[it.name]||0) + it.count;
									}
									return Object.keys(acc).map(n => ({ name:n, count: acc[n] }));
								})() : (invParsed[activeInvTab] || []);
								return list.map((it, i) => (
									<div key={i} onClick={()=> activeInvTab==='items' ? null : setSelectedInvItem({ key: activeInvTab, index: i })} style={{ cursor: activeInvTab==='items' ? 'default' : 'pointer', display:'grid', gridTemplateColumns: activeInvTab==='items' ? 'auto 1fr auto' : 'auto 1fr auto auto', gap:8, alignItems:'center', border: selectedInvItem?.key===activeInvTab && selectedInvItem.index===i? '2px solid var(--accent)':'1px solid var(--accent)', borderRadius:6, padding:'6px 8px', background: selectedInvItem?.key===activeInvTab && selectedInvItem.index===i? 'var(--panel-bg-dark)':'#fff' }}>
										{renderItemIcon(getItemEntry(it.name),24)}
										<div className="dim" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
										<div className="chip">x{it.count}</div>
										{activeInvTab!=='items' && (
											<div style={{ display:'flex', gap:4 }} onClick={e=> e.stopPropagation()}>
												<button className="mini" onClick={()=> setItemCount(activeInvTab, i, it.count-1)}>-1</button>
												<button className="mini" onClick={()=> setItemCount(activeInvTab, i, it.count+1)}>+1</button>
											</div>
										)}
									</div>
								));
							})()}
											{(activeInvTab!=='items' ? (invParsed[activeInvTab] || []) : (()=>{ const acc:Record<string,number>={}; for(const s of ch.inventory){ for(const it of (invParsed[s.key]||[])) acc[it.name]=(acc[it.name]||0)+it.count; } return Object.keys(acc);} )()).length===0 && (
											<div style={{textAlign:'center', padding:'8px 0'}} />
										)}
						</div>
						{/* Item detail panel */}
							{activeInvTab!=='items' && selectedInvItem && invParsed[selectedInvItem.key] && invParsed[selectedInvItem.key][selectedInvItem.index] && (()=>{
							const it = invParsed[selectedInvItem.key][selectedInvItem.index];
							const entry = getItemEntry(it.name);
								if (!entry) return <div style={{marginTop:12, padding:10, border:'1px solid var(--accent)', borderRadius:8, background:'#fff'}}><strong>{it.name}</strong><div className="dim" style={{fontSize:'0.8em'}}>No data available.</div></div>;
								return <div style={{marginTop:12, padding:10, border:'1px solid var(--accent)', borderRadius:8, background:'#fff', display:'grid', gap:8}}>
								<div style={{display:'flex', alignItems:'center', gap:8}}>
									{renderItemIcon(entry,24)}
									<strong>{entry.name || it.name}</strong>
								</div>
								{entry.desc && <div className="dim" style={{whiteSpace:'pre-wrap', fontSize:'0.85em'}}>{entry.desc}</div>}
								<div style={{display:'flex', gap:8}}>
									<button className="mini" onClick={()=> setSelectedInvItem(null)}>Close</button>
								</div>
							</div>;
							})()}
					</section>

					{/* Personality + Type Specialty side-by-side */}
					<div style={{ display:'grid', gridTemplateColumns:'1fr 260px', gap:12 }}>
						<label style={{ display:'block' }}>
							<div className="label"><strong>Personality</strong></div>
							<textarea rows={2} value={ch.personality} onChange={e => setCh({ ...ch, personality: e.target.value })} />
						</label>
						<label style={{ display:'block' }}>
							<div className="label"><strong>Type Specialty</strong></div>
							<input value={ch.typeSpecialty} placeholder="e.g. Fire, Water…" onChange={e => setCh({ ...ch, typeSpecialty: e.target.value })} />
						</label>
					</div>

					{/* Trainer visual (custom image or sprite) */}
					<section style={{ border:`1px solid ${accent}`, borderRadius:6, padding:8, background:'var(--panel-bg)' }}>
						<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
							<h3 style={{ margin:0 }}>Trainer</h3>
							<span className="dim">Shown here and used as your lobby avatar when a sprite is selected</span>
						</div>
						<div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:12, alignItems:'center', marginTop:8 }}>
							<div style={{ width:140, height:140, border:'1px solid var(--accent)', borderRadius:8, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
								{trainerImage ? (
									<img src={trainerImage} alt="Trainer" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
								) : (
									<img src={`/vendor/showdown/sprites/trainers/${trainerSprite}.png`} alt="Sprite" style={{ imageRendering:'pixelated', width:'80%', height:'80%', objectFit:'contain', background:'transparent' }} onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; img.onerror=null; img.src=`/showdown/sprites/trainers/${trainerSprite}.png`; }} />
								)}
							</div>
							<div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
								<button onClick={()=> setShowSpritePicker(true)}>Change Sprite</button>
								<button onClick={()=>{
									const input = document.createElement('input');
									input.type = 'file'; input.accept = 'image/*';
									input.onchange = () => {
										const f = input.files && input.files[0]; if (!f) return;
										const reader = new FileReader();
										reader.onload = () => { const dataUrl = String(reader.result || ''); setTrainerImage(dataUrl); };
										reader.readAsDataURL(f);
									};
									input.click();
								}}>Upload Image…</button>
								{trainerImage && <button className="secondary" onClick={()=> setTrainerImage('')}>Clear Image</button>}
								<div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
									<span className="dim">Sprite:</span>
									<code style={{ fontSize:'0.95em' }}>{trainerSprite}</code>
								</div>
							</div>
						</div>
					</section>
				</div>

					{/* Right column: Traits panel + Starter Pokémon panel stacked */}
					<div style={{ display:'grid', gap:8, alignContent:'start' }}>
						<section style={{ width:270, border:`1px solid ${accent}`, borderRadius:6, padding:8, display:'grid', gap:8, alignContent:'start', height:660, overflowY:'auto', background:'var(--panel-bg)' }}>
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
						</section>

						<section style={{ width:270, border:`1px solid ${accent}`, borderRadius:6, padding:8, background:'var(--panel-bg)', display:'grid', gap:8 }}>
							<h3 style={{margin:0}}>Starter Pokémon</h3>
							<div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8, alignItems:'center', marginTop:4, justifyItems:'center' }}>
								<div style={{ width:140, height:140, border:'1px solid var(--accent)', borderRadius:8, background:'var(--panel-bg-dark)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
									{ch.starterPokemon ? (
										<img src={spriteUrl(ch.starterPokemon.trim(), false, {})} alt={ch.starterPokemon} style={{ imageRendering:'pixelated', width:'80%', height:'80%', objectFit:'contain' }}
											onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; if (img.dataset.fallback) return; img.dataset.fallback='1'; img.src=spriteUrl(ch.starterPokemon!.trim(), false, { setOverride:'gen5' }); }} />
									) : (
										<span className="dim" style={{fontSize:'0.7em', textAlign:'center', padding:'4px'}}>Enter species</span>
									)}
								</div>
								<label style={{display:'grid', gap:4, width:'100%'}}>
									<span className="dim" style={{fontSize:'0.7em', letterSpacing:1}}>SPECIES</span>
									<input value={ch.starterPokemon||''} onChange={e=> setCh({...ch, starterPokemon:e.target.value})} placeholder="e.g. Charmander" />
								</label>
							</div>
						</section>
					</div>
			</div>

					{/* Badge Case moved to dedicated Badges tab (matches 1.2.1/1.2.2). */}

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

		{/* Sprite picker modal */}
		{showSpritePicker && (
			<div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=> setShowSpritePicker(false)}>
				<div className="panel" style={{ width:720, maxHeight:'80vh', overflowY:'auto' }} onClick={e=> e.stopPropagation()}>
					<h3 style={{marginTop:0}}>Choose Trainer Sprite</h3>
					<div className="dim" style={{marginBottom:8}}>This also updates your lobby avatar.</div>
						{trainerOptions.length===0 ? (
						<div className="dim">No sprites available yet.</div>
					) : (
							<>
								<div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center', marginBottom:8}}>
									<input placeholder="Search sprites..." value={spriteSearch} onChange={(e)=> setSpriteSearch(e.target.value)} />
									<span className="dim" style={{fontSize:'0.9em'}}>Click a sprite to select</span>
								</div>
								<div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(64px, 1fr))', gap:8 }}>
									{trainerOptions
										.filter(name => { const q = spriteSearch.toLowerCase().trim(); return !q || name.toLowerCase().includes(q); })
										.map((name)=> (
											<button key={name} title={name} className={trainerSprite===name? 'active':''} onClick={()=>{ setTrainerSprite(name); setShowSpritePicker(false); }} style={{width:64, height:64, padding:0, border: trainerSprite===name? '2px solid var(--acc)': '1px solid #444', borderRadius:4, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center'}}>
												<img src={`/vendor/showdown/sprites/trainers/${name}.png`} alt={name} style={{ width:48, height:48, imageRendering:'pixelated', background:'transparent' }} onError={(e)=>{ const img=e.currentTarget as HTMLImageElement; img.onerror=null; img.src=`/showdown/sprites/trainers/${name}.png`; }} />
											</button>
										))}
								</div>
							</>
					)}
					<div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
						<button onClick={()=> setShowSpritePicker(false)}>Close</button>
					</div>
				</div>
			</div>
		)}

		{/* Background picker modal */}
		{editingBg && (
			<div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=> setEditingBg(false)}>
				<div className="panel" style={{ width:480 }} onClick={e=> e.stopPropagation()}>
					<h3 style={{marginTop:0}}>Sheet Background</h3>
					<div className="dim" style={{marginBottom:8}}>Choose an image to display behind this character sheet (saved locally).</div>
					<div style={{display:'flex', gap:8}}>
						<button onClick={()=>{
							const input = document.createElement('input');
							input.type='file'; input.accept='image/*';
							input.onchange=()=>{ const f = input.files && input.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ setCh({...ch, sheetBg: String(r.result||'')}); }; r.readAsDataURL(f); };
							input.click();
						}}>Upload Image…</button>
						{ch.sheetBg && <button className="secondary" onClick={()=> setCh({...ch, sheetBg: undefined})}>Clear</button>}
					</div>
					<div style={{display:'flex', justifyContent:'flex-end', marginTop:16}}>
						<button onClick={()=> setEditingBg(false)}>Close</button>
					</div>
				</div>
			</div>
		)}
		</>
	);
}
