import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { withPublicBase } from '../utils/publicBase';
import { BattlePokemon } from '../types';
import { spriteUrl, loadShowdownDex, normalizeName, speciesAbilityOptions, toPokemon, prepareBattle, mapMoves, isMoveLegalForSpecies, formatShowdownSet, parseShowdownTeam, speciesFormesInfo, eligibleMegaFormForItem, computeRealStats, loadTeams, saveTeams, createTeam, iconUrl, placeholderSpriteDataURL, getTeamMaxSize, isTeamFull, DEFAULT_TEAM_SIZE, saveCustomFusionSprite, saveCustomSprite, listPokemonSpriteOptions, fetchFusionVariants, cacheSpriteSelectionLocally, clearCustomSprites, clearSpriteSettings, resyncSpriteCatalog, getFusionApiBases, IFD_CDN_BASE, cacheIfdSprite, nameToDexNum, dexNumToName, type PokemonSpriteOption } from '../data/adapter';
import { AVAILABLE_HATS, HatId, HatPicker, SpriteWithHat } from './SpriteWithHat';
import { FusionCreator } from './FusionCreator';
import { SpriteModeToggle, VariantPicker } from './SpriteVariantSelector';

const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A878',
  fire: '#F08030',
  water: '#6890F0',
  electric: '#F8D030',
  grass: '#78C850',
  ice: '#98D8D8',
  fighting: '#C03028',
  poison: '#A040A0',
  ground: '#E0C068',
  flying: '#A890F0',
  psychic: '#F85888',
  bug: '#A8B820',
  rock: '#B8A038',
  ghost: '#705898',
  dragon: '#7038F8',
  dark: '#705848',
  steel: '#B8B8D0',
  fairy: '#EE99AC',
  nuclear: '#92D050',
  cosmic: '#6B2FA0',
  crystal: '#A8D8EA',
  '???': '#68A090',
  stellar: '#44698f',
  shadow: '#5a4975',
};

const NATURES: Array<{ name: string; plus: string | null; minus: string | null }> = [
  { name: 'Hardy', plus: null, minus: null },
  { name: 'Lonely', plus: 'Atk', minus: 'Def' },
  { name: 'Brave', plus: 'Atk', minus: 'Spe' },
  { name: 'Adamant', plus: 'Atk', minus: 'SpA' },
  { name: 'Naughty', plus: 'Atk', minus: 'SpD' },
  { name: 'Bold', plus: 'Def', minus: 'Atk' },
  { name: 'Docile', plus: null, minus: null },
  { name: 'Relaxed', plus: 'Def', minus: 'Spe' },
  { name: 'Impish', plus: 'Def', minus: 'SpA' },
  { name: 'Lax', plus: 'Def', minus: 'SpD' },
  { name: 'Timid', plus: 'Spe', minus: 'Atk' },
  { name: 'Hasty', plus: 'Spe', minus: 'Def' },
  { name: 'Serious', plus: null, minus: null },
  { name: 'Jolly', plus: 'Spe', minus: 'SpA' },
  { name: 'Naive', plus: 'Spe', minus: 'SpD' },
  { name: 'Modest', plus: 'SpA', minus: 'Atk' },
  { name: 'Mild', plus: 'SpA', minus: 'Def' },
  { name: 'Quiet', plus: 'SpA', minus: 'Spe' },
  { name: 'Bashful', plus: null, minus: null },
  { name: 'Rash', plus: 'SpA', minus: 'SpD' },
  { name: 'Calm', plus: 'SpD', minus: 'Atk' },
  { name: 'Gentle', plus: 'SpD', minus: 'Def' },
  { name: 'Sassy', plus: 'SpD', minus: 'Spe' },
  { name: 'Careful', plus: 'SpD', minus: 'SpA' },
  { name: 'Quirky', plus: null, minus: null },
];

function moveTooltip(move: any): string {
  if (!move) return '';
  const name = move.name || '';
  const category = (move as any).category ? ` (${(move as any).category})` : '';
  return (move.shortDesc || move.desc || `${name}${category}`) as string;
}

function itemOptionLabel(itemName: string, dex: any): string {
  if (!dex?.items) return itemName;
  const normalized = normalizeName(itemName);
  const item = dex.items[normalized]
    || Object.values(dex.items).find((i: any) => normalizeName((i as any)?.name || '') === normalized);
  const desc = (item as any)?.shortDesc || (item as any)?.desc || '';
  return desc ? `${itemName} - ${desc}` : itemName;
}

/** Reusable ability picker with legal/illegal grouping and search */
function AbilityPicker({ value, onChange, onCommit, onCancel, legalAbilities, dex, getLabel, style, hideButtons }: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  legalAbilities: string[];
  dex: any;
  getLabel: (name: string) => string;
  style?: React.CSSProperties;
  hideButtons?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filter = value.toLowerCase();

  const legalFiltered = legalAbilities.filter(a => a.toLowerCase().includes(filter));
  const allAbilities = useMemo(() => {
    if (!dex?.abilities) return [];
    return Object.values(dex.abilities).map((a: any) => a.name as string).sort();
  }, [dex]);
  const illegalFiltered = useMemo(() => {
    const legalSet = new Set(legalAbilities.map(a => a.toLowerCase()));
    return allAbilities.filter(a => !legalSet.has(a.toLowerCase()) && a.toLowerCase().includes(filter));
  }, [allAbilities, legalAbilities, filter]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (name: string) => { onChange(name); setOpen(false); setTimeout(onCommit, 0); };
  const maxItems = 80;

  return (
    <div ref={containerRef} style={{position:'relative', flex:1, ...(style || {})}} onClick={e=>e.stopPropagation()}>
      <div style={{display:'flex', gap:4, alignItems:'center'}}>
        <input ref={inputRef} value={value} onChange={e=>{onChange(e.target.value); setOpen(true);}}
          onFocus={()=>setOpen(true)}
          onKeyDown={e=>{ if(e.key==='Enter') onCommit(); if(e.key==='Escape') onCancel(); }}
          style={{width:'100%'}} placeholder="Type any ability..." />
        {!hideButtons && <button className="mini" onClick={onCommit}>✓</button>}
        {!hideButtons && <button className="mini" onClick={onCancel}>✕</button>}
      </div>
      {open && (legalFiltered.length > 0 || illegalFiltered.length > 0) && (
        <div style={{position:'absolute', top:'100%', left:0, right:0, zIndex:999, maxHeight:260, overflowY:'auto',
          background:'#1e1e1e', border:'1px solid #555', borderRadius:4, boxShadow:'0 4px 12px rgba(0,0,0,.5)', marginTop:2}}>
          {legalFiltered.length > 0 && (
            <>
              <div style={{padding:'4px 8px', fontSize:'0.7em', fontWeight:'bold', color:'#4caf50', background:'rgba(76,175,80,.1)', borderBottom:'1px solid #333',
                position:'sticky', top:0, zIndex:1}}>
                ✓ Legal Abilities
              </div>
              {legalFiltered.map(a => (
                <div key={a} onClick={()=>pick(a)} title={getLabel(a)}
                  style={{padding:'4px 8px', cursor:'pointer', fontSize:'0.85em', borderBottom:'1px solid #2a2a2a'}}
                  onMouseEnter={e=>(e.currentTarget.style.background='#333')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                  <span style={{color:'#e0e0e0'}}>{a}</span>
                </div>
              ))}
            </>
          )}
          {illegalFiltered.length > 0 && (
            <>
              <div style={{padding:'4px 8px', fontSize:'0.7em', fontWeight:'bold', color:'#888', background:'rgba(255,255,255,.03)',
                borderTop: legalFiltered.length > 0 ? '2px solid #555' : 'none', borderBottom:'1px solid #333',
                position:'sticky', top: legalFiltered.length > 0 ? undefined : 0, zIndex:1}}>
                Other Abilities
              </div>
              {illegalFiltered.slice(0, maxItems).map(a => (
                <div key={a} onClick={()=>pick(a)} title={getLabel(a)}
                  style={{padding:'4px 8px', cursor:'pointer', fontSize:'0.85em', borderBottom:'1px solid #2a2a2a', opacity:0.7}}
                  onMouseEnter={e=>(e.currentTarget.style.background='#333')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                  <span style={{color:'#aaa'}}>{a}</span>
                </div>
              ))}
              {illegalFiltered.length > maxItems && (
                <div style={{padding:'4px 8px', fontSize:'0.75em', color:'#666'}}>…{illegalFiltered.length - maxItems} more (type to filter)</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function SidePanel({ selected, boxes, onAdd, onChangeAbility, onAddToSlot, onReplaceSelected, onDeleteSelected, onHeal }: {
  selected: BattlePokemon | null;
  boxes?: Array<Array<BattlePokemon | null>>;
  onAdd: (p: BattlePokemon, teamId?: string) => void;
  onChangeAbility?: (nextAbility: string) => void;
  onAddToSlot?: (p: BattlePokemon) => void;
  onReplaceSelected?: (p: BattlePokemon) => void;
  onDeleteSelected?: () => void;
  onHeal?: (amount: number | 'full') => void;
}) {
  if (!selected) return (
    <NoSelectionPanel onAddToSlot={onAddToSlot} onAdd={onAdd} />
  );

  const [dex, setDex] = useState<any>(null);
  const [abilityDesc, setAbilityDesc] = useState<string>('');
  const [itemText, setItemText] = useState<string>('');
  const [itemDesc, setItemDesc] = useState<string>('');
  const [abilityOpts, setAbilityOpts] = useState<string[]>([]);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [activeEditSection, setActiveEditSection] = useState<'basics'|'ability'|'mechanics'|'moves'|null>(null);
  const [speciesInput, setSpeciesInput] = useState<string>('');
  const [nickname, setNickname] = useState<string>(selected.name);
  const [level, setLevel] = useState<number>(selected.level);
  const [abilitySel, setAbilitySel] = useState<string>(selected.ability || '');
  const [movesInput, setMovesInput] = useState<string[]>(selected.moves.map(m=>m.name));
  const [itemSel, setItemSel] = useState<string>(((selected as any).item as string) || '');
  const [shinySel, setShinySel] = useState<boolean>(!!selected.shiny);
  const [showHatPicker, setShowHatPicker] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [showdownEditField, setShowdownEditField] = useState<'level'|'gender'|'shiny'|'tera'|'species'|'item'|'ability'|'nickname'|null>(null);
  const [showdownFieldValue, setShowdownFieldValue] = useState<string>('');
  const [showdownEditMoveIndex, setShowdownEditMoveIndex] = useState<number | null>(null);
  const [showdownMoveValue, setShowdownMoveValue] = useState<string>('');
  const [moveBrowserSlot, setMoveBrowserSlot] = useState<number | null>(null);
  const [moveBrowserFilter, setMoveBrowserFilter] = useState<string>('');
  const [healAmount, setHealAmount] = useState<string>('');
  const [showdownEditStats, setShowdownEditStats] = useState<boolean>(false);
  const [showdownEvs, setShowdownEvs] = useState<{ hp: number; atk: number; def: number; spa: number; spd: number; spe: number }>({
    hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0,
  });
  const [showdownNature, setShowdownNature] = useState<string>('');
  // Move learning prompt
  const [showMoveLearnPrompt, setShowMoveLearnPrompt] = useState(false);
  const [learnableMoves, setLearnableMoves] = useState<{name: string, level: number}[]>([]);
  const [learnReplaceMove, setLearnReplaceMove] = useState<{name: string, level: number} | null>(null);
  const [showFusePanel, setShowFusePanel] = useState<boolean>(false);
  const [showSecretTriplePanel, setShowSecretTriplePanel] = useState<boolean>(false);
  const prevLevelRef = React.useRef<number>(selected.level);
  const prevSelectedRef = React.useRef<BattlePokemon>(selected);
  const basicsRef = React.useRef<HTMLDivElement|null>(null);
  const abilityRef = React.useRef<HTMLDivElement|null>(null);
  const mechanicsRef = React.useRef<HTMLDivElement|null>(null);
  const movesRef = React.useRef<HTMLDivElement|null>(null);
  const resolveSpeciesName = useCallback(() => {
    return selected.species || (selected as any).originalName || selected.name;
  }, [selected]);

  const getAbilityOptionLabel = useCallback((abilityName: string) => {
    const normalized = normalizeName(abilityName);
    const ability = dex?.abilities?.[normalized]
      || Object.values(dex?.abilities || {}).find((a: any) => normalizeName((a as any)?.name || '') === normalized);
    const desc = (ability as any)?.shortDesc || (ability as any)?.desc || '';
    return desc ? `${abilityName} - ${desc}` : abilityName;
  }, [dex]);

  const getItemOptionLabel = useCallback((name: string) => itemOptionLabel(name, dex), [dex]);

  const pcSpeciesPool = useMemo(() => {
    const seen = new Set<string>();
    for (const box of boxes || []) {
      for (const mon of box || []) {
        if (!mon) continue;
        const species = (mon.species || mon.name || '').trim();
        if (species) seen.add(species);
      }
    }
    const cur = resolveSpeciesName().trim();
    if (cur) seen.add(cur);
    return Array.from(seen);
  }, [boxes, resolveSpeciesName]);

  useEffect(() => {
    // Synchronously update refs and clear move-learn state BEFORE the async
    // work below.  The level-detection effect (which depends on selected.level)
    // fires on the same render, so these must be current before it runs.
    prevLevelRef.current = selected.level;
    prevSelectedRef.current = selected;
    setLearnReplaceMove(null);
    setLearnableMoves([]);
    setShowMoveLearnPrompt(false);

    let mounted = true;
    (async () => {
      const d = await loadShowdownDex();
      if (!mounted) return;
      setDex(d);
      const abil = selected.ability ? Object.values(d.abilities).find((a: any) => normalizeName((a as any).name) === normalizeName(selected.ability!)) : undefined;
      const heldName = (selected as any).item as string | undefined;
      const item = heldName ? Object.values(d.items).find((i: any) => normalizeName((i as any).name) === normalizeName(heldName)) : undefined;
      setAbilityDesc((abil as any)?.shortDesc || (abil as any)?.desc || '');
      setItemText((item as any)?.name || heldName || '—');
      setItemDesc((item as any)?.shortDesc || (item as any)?.desc || '');
      const speciesId = resolveSpeciesName();
      const opts = speciesAbilityOptions(speciesId, d.pokedex);
      setAbilityOpts(opts);
      setSpeciesInput(speciesId);
      setNickname(selected.name);
      setLevel(selected.level);
      setAbilitySel(selected.ability || (opts[0] || ''));
      // reset item/shiny and moves for this selected pokemon
      setItemSel(heldName || '');
      setShinySel(!!selected.shiny);
      const names = selected.moves.map(m=>m.name);
      while (names.length < 4) names.push('');
      setMovesInput(names);
      setConfirmDelete(false);
      setShowdownEditField(null);
      setShowdownFieldValue('');
      setShowdownEditMoveIndex(null);
      setShowdownMoveValue('');
      setShowdownEditStats(false);
      setShowdownEvs({
        hp: (selected as any).evs?.hp || 0,
        atk: (selected as any).evs?.atk || 0,
        def: (selected as any).evs?.def || 0,
        spa: (selected as any).evs?.spa || 0,
        spd: (selected as any).evs?.spd || 0,
        spe: (selected as any).evs?.spe || 0,
      });
      setShowdownNature((selected as any).nature || '');
    })();
    return () => { mounted = false; };
  }, [selected]);

  // Detect level-ups outside the editor (e.g., PC leveling) and surface learnable moves
  useEffect(() => {
    const prev = prevLevelRef.current;
    // Only trigger move prompts for level increases on the SAME Pokemon;
    // switching to a different Pokemon with a higher level is not a level-up.
    // Use name identity (not reference equality) so re-renders don't break the check.
    const sameIdentity = selected.name === prevSelectedRef.current?.name
                      && selected.species === prevSelectedRef.current?.species;
    if (sameIdentity && selected.level > prev) {
      checkLearnableMoves(prev, selected.level);
    }
    prevLevelRef.current = selected.level;
  }, [selected.level, dex, speciesInput]);

  const hpPct = Math.round((selected.currentHp / selected.maxHp) * 100);
  const isShedinja = normalizeName(resolveSpeciesName()) === 'shedinja';
  const ttrpgMaxHp = isShedinja ? 1 : (Math.floor(selected.baseStats.hp / 2) + selected.level);
  const ttrpgCurrHp = Math.max(0, Math.round((selected.currentHp / selected.maxHp) * ttrpgMaxHp));

  // Real stats (Gen mechanics) based on level/EVs/IVs/nature
  const realStats = useMemo(() => computeRealStats(selected), [selected]);
  const realTotal = realStats.hp + realStats.atk + realStats.def + realStats.spa + realStats.spd + realStats.spe;

  // Sorted moves with legal moves first
  const sortedMoves = useMemo(() => {
    if (!dex || !dex.moves || !dex.learnsets) return null;
    const species = speciesInput || resolveSpeciesName();
    const speciesId = normalizeName(species);
    
    const legalMoveIds = new Set<string>();

    // Helper: collect all move IDs from a species + its prevo chain.
    // Falls back to baseSpecies/battleOnly for formes without their own learnset
    // (e.g. nuclear formes, megas, regional variants, battle-only forms).
    const collectLearnset = (sid: string, visited?: Set<string>) => {
      const seen = visited || new Set<string>();
      if (seen.has(sid)) return;
      seen.add(sid);
      const ls = dex.learnsets[sid];
      if (ls?.learnset) {
        for (const moveId of Object.keys(ls.learnset)) {
          legalMoveIds.add(moveId);
        }
      }
      const entry = dex.pokedex[sid];
      // If no learnset found, fall back to baseSpecies or battleOnly
      if (!ls?.learnset && entry) {
        const base = entry.baseSpecies || entry.battleOnly;
        if (base) {
          collectLearnset(normalizeName(String(base)), seen);
        }
      }
      if (entry?.prevo) {
        let prevo = entry.prevo;
        while (prevo) {
          const prevoId = normalizeName(prevo);
          const prevoLs = dex.learnsets[prevoId];
          if (prevoLs?.learnset) {
            for (const moveId of Object.keys(prevoLs.learnset)) {
              legalMoveIds.add(moveId);
            }
          }
          prevo = dex.pokedex[prevoId]?.prevo;
        }
      }
    };

    // For fusions, combine learnsets from both (or all three) parent species
    const fusion = selected.fusion;
    if (fusion?.headName && fusion?.bodyName) {
      collectLearnset(normalizeName(fusion.headName));
      collectLearnset(normalizeName(fusion.bodyName));
      if (fusion.thirdName) collectLearnset(normalizeName(fusion.thirdName));
    } else {
      collectLearnset(speciesId);
    }
    
    const allMoves = Object.values(dex.moves) as any[];
    
    // Separate into legal and illegal
    const legal: any[] = [];
    const illegal: any[] = [];
    
    for (const move of allMoves) {
      const moveId = normalizeName(move.name);
      if (legalMoveIds.has(moveId)) {
        legal.push(move);
      } else {
        illegal.push(move);
      }
    }
    
    // Sort each group alphabetically
    legal.sort((a, b) => a.name.localeCompare(b.name));
    illegal.sort((a, b) => a.name.localeCompare(b.name));
    
    // Legal moves first, then illegal
    return { legal, illegal, legalMoveIds };
  }, [dex, speciesInput, selected.species, selected.name, selected.fusion]);

  // Build detailed legal move list with learn methods for the move browser
  const detailedLegalMoves = useMemo(() => {
    if (!dex || !sortedMoves) return [];
    const species = speciesInput || resolveSpeciesName();
    const speciesId = normalizeName(species);

    // Gather learnset sources from this species + prevo chain
    const allSources: Record<string, string[]> = {};
    const collectSources = (sid: string) => {
      const ls = dex.learnsets[sid]?.learnset;
      if (!ls) return;
      for (const [moveId, sources] of Object.entries(ls)) {
        if (!allSources[moveId]) allSources[moveId] = [];
        for (const s of (sources as string[])) {
          if (!allSources[moveId].includes(s)) allSources[moveId].push(s);
        }
      }
    };
    const collectWithPrevo = (sid: string, visited?: Set<string>) => {
      const seen = visited || new Set<string>();
      if (seen.has(sid)) return;
      seen.add(sid);
      collectSources(sid);
      const entry = dex.pokedex[sid];
      // Forme fallback: if this species has no learnset, try baseSpecies/battleOnly
      if (!dex.learnsets[sid]?.learnset && entry) {
        const base = entry.baseSpecies || entry.battleOnly;
        if (base) {
          collectWithPrevo(normalizeName(String(base)), seen);
          return;
        }
      }
      if (entry?.prevo) {
        let prevo = entry.prevo;
        while (prevo) {
          collectSources(normalizeName(prevo));
          prevo = dex.pokedex[normalizeName(prevo)]?.prevo;
        }
      }
    };

    // For fusions, collect from all parent species
    const fusion = selected.fusion;
    if (fusion?.headName && fusion?.bodyName) {
      collectWithPrevo(normalizeName(fusion.headName));
      collectWithPrevo(normalizeName(fusion.bodyName));
      if (fusion.thirdName) collectWithPrevo(normalizeName(fusion.thirdName));
    } else {
      collectWithPrevo(speciesId);
    }

    const parseLearnMethod = (sources: string[]): string => {
      const methods: string[] = [];
      for (const s of sources) {
        const levelMatch = s.match(/^\d+L(\d+)$/);
        if (levelMatch) { methods.push(`Lv ${levelMatch[1]}`); continue; }
        if (/^\d+M$/.test(s)) { methods.push('TM'); continue; }
        if (/^\d+E$/.test(s)) { methods.push('Egg'); continue; }
        if (/^\d+T$/.test(s)) { methods.push('Tutor'); continue; }
        if (/^\d+S\d*$/.test(s)) { methods.push('Event'); continue; }
        if (/^\d+R$/.test(s)) { methods.push('Reminder'); continue; }
      }
      // Deduplicate
      return [...new Set(methods)].join(', ') || '?';
    };

    // Extract the lowest learn level for sorting
    const getLowestLevel = (sources: string[]): number => {
      let min = Infinity;
      for (const s of sources) {
        const m = s.match(/^\d+L(\d+)$/);
        if (m) min = Math.min(min, parseInt(m[1], 10));
      }
      return min;
    };

    return sortedMoves.legal.map((move: any) => {
      const moveId = normalizeName(move.name);
      const sources = allSources[moveId] || [];
      return {
        ...move,
        learnMethod: parseLearnMethod(sources),
        lowestLevel: getLowestLevel(sources),
        sources,
      };
    }).sort((a: any, b: any) => {
      // Level-up moves first sorted by level, then TM, then Egg, then others
      if (a.lowestLevel !== Infinity && b.lowestLevel !== Infinity) return a.lowestLevel - b.lowestLevel;
      if (a.lowestLevel !== Infinity) return -1;
      if (b.lowestLevel !== Infinity) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [dex, sortedMoves, speciesInput, selected.species, selected.name, selected.fusion]);

  // Check for available evolutions
  interface EvoOption {
    name: string;
    id: string;
    method: string;
    detail: string;
    canEvolve: boolean;
    reason?: string;
    status: 'green' | 'gray' | 'red';
    requiredItem?: string;
    consumeItem?: boolean;
  }

  type CharacterInventorySection = { key: string; label: string; lines: string };
  type CharacterSheetData = { inventory?: CharacterInventorySection[] };

  const parseInventoryLines = useCallback((lines: string): Array<{ name: string; count: number }> => {
    const out: Array<{ name: string; count: number }> = [];
    for (const raw of String(lines || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let name = line;
      let count = 1;
      const m = line.match(/^(.*?)(?:\s*[\-–]\s*|\s*\(|\s+)x\s*(\d+)\)?\s*$/i);
      if (m) {
        name = m[1].trim().replace(/[()\-–]$/, '');
        count = Math.max(1, Number(m[2]));
      }
      out.push({ name, count });
    }
    return out;
  }, []);

  const getCharacterInventory = useCallback((): CharacterInventorySection[] => {
    try {
      const raw = localStorage.getItem('ttrpg.character');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CharacterSheetData;
      return Array.isArray(parsed.inventory) ? parsed.inventory : [];
    } catch {
      return [];
    }
  }, []);

  const getInventoryItemCount = useCallback((itemName: string): number => {
    const wanted = normalizeName(itemName || '');
    if (!wanted) return 0;
    let total = 0;
    for (const section of getCharacterInventory()) {
      const items = parseInventoryLines(section.lines);
      for (const item of items) {
        if (normalizeName(item.name) === wanted) total += Math.max(1, Number(item.count) || 1);
      }
    }
    return total;
  }, [getCharacterInventory, parseInventoryLines]);

  const consumeInventoryItem = useCallback((itemName: string): boolean => {
    const wanted = normalizeName(itemName || '');
    if (!wanted) return false;
    try {
      const raw = localStorage.getItem('ttrpg.character');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as CharacterSheetData;
      if (!Array.isArray(parsed.inventory)) return false;

      let consumed = false;
      const nextInventory = parsed.inventory.map((section) => {
        const items = parseInventoryLines(section.lines);
        const nextItems: Array<{ name: string; count: number }> = [];
        for (const item of items) {
          if (!consumed && normalizeName(item.name) === wanted) {
            const nextCount = Math.max(0, (Number(item.count) || 1) - 1);
            consumed = true;
            if (nextCount > 0) nextItems.push({ name: item.name, count: nextCount });
            continue;
          }
          nextItems.push(item);
        }
        return {
          ...section,
          lines: nextItems.map((it) => `${it.name} x${Math.max(1, Number(it.count) || 1)}`).join('\n'),
        };
      });

      if (!consumed) return false;
      localStorage.setItem('ttrpg.character', JSON.stringify({ ...parsed, inventory: nextInventory }));
      window.dispatchEvent(new Event('storage'));
      return true;
    } catch {
      return false;
    }
  }, [parseInventoryLines]);

  const evolutionOptions = useMemo((): EvoOption[] => {
    if (!dex || !dex.pokedex) return [];
    const speciesId = normalizeName(resolveSpeciesName());
    const entry = dex.pokedex[speciesId];
    if (!entry?.evos || entry.evos.length === 0) return [];

    const currentLevel = selected.level;

    return entry.evos.map((evoName: string) => {
      const evoId = normalizeName(evoName);
      const evoEntry = dex.pokedex[evoId];
      if (!evoEntry) return null;

      let method = '';
      let detail = '';
      let canEvolve = false;
      let reason = '';
      let status: 'green' | 'gray' | 'red' = 'red';
      let requiredItem: string | undefined;
      let consumeItem = false;

      // Check evolution type
      const evoType = evoEntry.evoType || (evoEntry.evoLevel ? 'levelUp' : 'other');
      const evoLevel = evoEntry.evoLevel;
      const evoItem = evoEntry.evoItem;
      const evoCondition = evoEntry.evoCondition;
      const evoMove = evoEntry.evoMove;

      if (evoType === 'levelUp' || evoType === 'levelExtra' || evoType === undefined) {
        if (evoLevel) {
          method = `Level ${evoLevel}`;
          detail = `Level to ${evoLevel} or higher`;
          canEvolve = currentLevel >= evoLevel;
          if (!canEvolve) reason = `Needs level ${evoLevel}`;
        } else {
          method = 'Level up';
          detail = 'Level up once';
          canEvolve = true;
        }
        if (evoCondition) {
          method += ` (${evoCondition})`;
          detail += ` — ${evoCondition}`;
        }
        status = canEvolve ? 'green' : 'red';
      } else if (evoType === 'useItem') {
        method = evoItem || 'Evolution Item';
        requiredItem = evoItem;
        consumeItem = !!requiredItem;
        const count = requiredItem ? getInventoryItemCount(requiredItem) : 0;
        detail = requiredItem ? `Use ${requiredItem} (Bag: ${count})` : 'Use the required evolution item';
        canEvolve = !!requiredItem && count > 0;
        if (!canEvolve) reason = `Needs ${evoItem} in Character Sheet inventory`;
        status = canEvolve ? 'green' : 'gray';
      } else if (evoType === 'levelFriendship') {
        method = 'Friendship';
        detail = 'High friendship required';
        canEvolve = true; // TTRPG: assume friendship is met
        status = 'green';
      } else if (evoType === 'trade') {
        method = evoItem ? `Trade with ${evoItem}` : 'Trade';
        detail = evoItem ? `Trade while using ${evoItem}` : 'Trade this Pokemon';
        if (evoItem) {
          requiredItem = evoItem;
          consumeItem = true;
          const count = getInventoryItemCount(evoItem);
          detail = `Trade with ${evoItem} (Bag: ${count})`;
          canEvolve = count > 0;
          if (!canEvolve) reason = `Needs ${evoItem} in Character Sheet inventory`;
        } else {
          canEvolve = true;
        }
        status = canEvolve ? 'green' : 'gray';
      } else if (evoType === 'levelHold') {
        const holdItem = evoItem || 'required item';
        requiredItem = evoItem;
        consumeItem = false;
        if (evoLevel) {
          method = `Level ${evoLevel} holding ${holdItem}`;
          detail = `Level to ${evoLevel}+ while holding ${holdItem}`;
          canEvolve = currentLevel >= evoLevel;
          if (!canEvolve) reason = `Needs level ${evoLevel}`;
        } else {
          method = `Level up holding ${holdItem}`;
          detail = `Level up while holding ${holdItem}`;
          canEvolve = true;
        }
        status = canEvolve ? 'green' : 'red';
      } else if (evoType === 'levelMove') {
        method = evoMove ? `Learn ${evoMove}` : 'Learn required move';
        detail = evoMove ? `Know ${evoMove}` : 'Know required move';
        const moveId = normalizeName(evoMove || '');
        canEvolve = selected.moves.some(m => normalizeName(m.name) === moveId);
        if (!canEvolve) reason = `Needs move ${evoMove}`;
        status = canEvolve ? 'green' : 'red';
      } else {
        method = evoCondition || evoType || 'Special';
        detail = evoCondition || `Special method: ${evoType || 'unknown'}`;
        canEvolve = false;
        reason = detail;
        status = 'gray';
      }

      if (evoCondition && evoType !== 'levelMove') {
        method += ` (${evoCondition})`;
        if (!detail) detail = evoCondition;
      }

      if (!detail) detail = method;

      return { name: evoEntry.name, id: evoId, method, detail, canEvolve, reason, status, requiredItem, consumeItem };
    }).filter(Boolean) as EvoOption[];
  }, [dex, selected, getInventoryItemCount]);

  // Handle evolution
  const handleEvolve = async (evo: EvoOption) => {
    if (!dex) return;
    if (!evo.canEvolve) return;
    if (evo.requiredItem && evo.consumeItem) {
      const consumed = consumeInventoryItem(evo.requiredItem);
      if (!consumed) return;
    }

    const evoId = evo.id;
    const p0 = toPokemon(evoId, dex.pokedex, selected.level);
    if (!p0) return;
    
    // Preserve nickname if different from species
    const currentNickname = selected.name;
    const currentSpeciesName = dex.pokedex[normalizeName(resolveSpeciesName())]?.name;
    if (currentNickname !== currentSpeciesName) {
      p0.name = currentNickname;
    }
    
    // Preserve shiny and moves; evolution items consumed from inventory are not held afterward
    p0.item = evo.consumeItem ? undefined : (selected as any).item;
    p0.shiny = selected.shiny;
    // Keep current moves if legal, otherwise use evolved species defaults
    const evoLearnset = dex.learnsets[evoId];
    const newMoves = selected.moves.filter(m => {
      const moveId = normalizeName(m.name);
      return evoLearnset?.learnset?.[moveId];
    });
    if (newMoves.length > 0) {
      p0.moves = newMoves;
    }
    
    // Prepare as battle-ready pokemon (this adds maxHp, currentHp)
    const battleReady = prepareBattle(p0);
    
    // Keep current HP percentage
    const hpPct = selected.currentHp / selected.maxHp;
    battleReady.currentHp = Math.round(hpPct * battleReady.maxHp);
    
    onReplaceSelected && onReplaceSelected(withVisualState(battleReady, false));
  };

  // Check for learnable moves when level changes
  const checkLearnableMoves = (oldLevel: number, newLevel: number) => {
    if (!dex || !dex.learnsets || newLevel <= oldLevel) return;
    
    const speciesId = normalizeName(speciesInput || resolveSpeciesName());
    const learnset = dex.learnsets[speciesId];
    if (!learnset?.learnset) return;

    const newMoves: {name: string, level: number}[] = [];
    const currentMoveIds = new Set(movesInput.map(m => normalizeName(m)));

    for (const moveId in learnset.learnset) {
      if (currentMoveIds.has(moveId)) continue; // Already knows this move
      
      const sources = learnset.learnset[moveId];
      for (const source of sources) {
        // Check for level-up moves (format: "9L5" means Gen 9 Level 5)
        const match = source.match(/^\d+L(\d+)$/);
        if (match) {
          const learnLevel = parseInt(match[1], 10);
          // Check if move was learnable between old and new level
          if (learnLevel > oldLevel && learnLevel <= newLevel) {
            const move = dex.moves[moveId];
            if (move) {
              newMoves.push({ name: move.name, level: learnLevel });
            }
            break; // Only add once per move
          }
        }
      }
    }

    if (newMoves.length > 0) {
      // Sort by level
      newMoves.sort((a, b) => a.level - b.level);
      setLearnableMoves(newMoves);
      setShowMoveLearnPrompt(true);
    }
  };

  // Handle level change with move learning check
  const handleLevelChange = (newLevel: number) => {
    const oldLevel = level;
    setLevel(newLevel);
    checkLearnableMoves(oldLevel, newLevel);
  };

  // Learn a move (replace a move slot or skip)
  const learnMove = (moveName: string, slotIndex: number | null) => {
    if (slotIndex === null) {
      // Skip learning this move
      return;
    }
    const copy = [...movesInput];
    copy[slotIndex] = moveName;
    setMovesInput(copy);
  };

  const removeLearnableMove = (name: string) => {
    setLearnableMoves(prev => {
      const next = prev.filter(m => normalizeName(m.name) !== normalizeName(name));
      if (next.length === 0) setShowMoveLearnPrompt(false);
      return next;
    });
  };

  const replaceMoveAtIndex = (index: number) => {
    if (!learnReplaceMove || !dex) return;
    const names = selected.moves.map(m => m.name);
    while (names.length < 4) names.push('');
    names[index] = learnReplaceMove.name;
    const nextMoves = mapMoves(names.filter(Boolean), dex.moves);
    const next = { ...selected, moves: nextMoves as any } as BattlePokemon;
    onReplaceSelected && onReplaceSelected(next);
    setMovesInput(names);
    removeLearnableMove(learnReplaceMove.name);
    setLearnReplaceMove(null);
  };

  // Toggle between TTRPG view and Real (mechanics) view
  const [viewMode, setViewMode] = useState<'ttrpg'|'real'>('ttrpg');
  
  // Panel layout mode: compact (TTRPG horizontal groupings) vs showdown (PS team builder style)
  const [panelMode, setPanelMode] = useState<'compact'|'showdown'>('showdown');

  const stats = [
    { key: 'hp', label: 'HP', value: selected.baseStats.hp, color: '#ff9aa2' },
    { key: 'atk', label: 'Atk', value: selected.baseStats.atk, color: '#ffb347' },
    { key: 'def', label: 'Def', value: selected.baseStats.def, color: '#ffd56e' },
    { key: 'spAtk', label: 'SpA', value: selected.baseStats.spAtk, color: '#a0a6ff' },
    { key: 'spDef', label: 'SpD', value: selected.baseStats.spDef, color: '#b0ffd4' },
    { key: 'speed', label: 'Spe', value: selected.baseStats.speed, color: '#8fff8f' },
  ] as const;
  const total = stats.reduce((s, x) => s + x.value, 0);
  const toggleShiny = () => {
    const nextShiny = !selected.shiny;
    const fusion = (selected as any)?.fusion;
    if (!onReplaceSelected || fusion) {
      const next = { ...selected, shiny: nextShiny } as BattlePokemon;
      onReplaceSelected && onReplaceSelected(next);
      setShinySel(!!next.shiny);
      return;
    }
    const preferredId = String((selected as any).spriteChoiceId || '').trim();
    const species = resolveSpeciesName();
    listPokemonSpriteOptions(species, {
      shiny: nextShiny,
      cosmetic: selected.cosmeticForm,
      allowFormVariants: false,
      strictExisting: true,
    }).then((opts) => {
      const chosen = preferredId ? opts.find(o => o.id === preferredId) : undefined;
      const next: any = { ...selected, shiny: nextShiny };
      if (chosen) {
        next.sprite = chosen.front;
        next.backSprite = chosen.back;
        next.spriteChoiceId = chosen.id;
        next.spriteChoiceLabel = chosen.label;
      } else if (preferredId && !String((selected as any).sprite || '').startsWith('data:')) {
        delete next.sprite;
        delete next.backSprite;
        delete next.spriteChoiceId;
        delete next.spriteChoiceLabel;
      }
      onReplaceSelected(next);
      setShinySel(nextShiny);
      setSpriteChangeKey(k => k + 1);
    }).catch(() => {
      const next = { ...selected, shiny: nextShiny } as BattlePokemon;
      onReplaceSelected(next);
      setShinySel(nextShiny);
    });
  };

  const setHat = (hatId: HatId) => {
    const next = { ...selected, hatId: hatId === 'none' ? undefined : hatId } as BattlePokemon;
    onReplaceSelected && onReplaceSelected(next);
    setShowHatPicker(false);
  };

  const currentHatId = ((selected as any).hatId as HatId) || 'none';
  const currentHatIcon = AVAILABLE_HATS.find(h => h.id === currentHatId)?.icon || '❌';

  const withVisualState = useCallback((mon: BattlePokemon, keepSprite: boolean): BattlePokemon => {
    const next: any = { ...mon };
    next.cosmeticForm = (selected as any).cosmeticForm;
    next.hatId = (selected as any).hatId;
    next.hatYOffset = (selected as any).hatYOffset;
    next.hatXOffset = (selected as any).hatXOffset;
    next.hatScale = (selected as any).hatScale;
    next.spriteMode = (selected as any).spriteMode;
    next.fusion = (selected as any).fusion;
    if (keepSprite) {
      next.sprite = (selected as any).sprite;
      next.backSprite = (selected as any).backSprite;
      next.spriteChoiceId = (selected as any).spriteChoiceId;
      next.spriteChoiceLabel = (selected as any).spriteChoiceLabel;
    } else {
      delete next.sprite;
      delete next.backSprite;
      delete next.spriteChoiceId;
      delete next.spriteChoiceLabel;
    }
    return next as BattlePokemon;
  }, [selected]);

  const applyShowdownUpdate = (overrides: {
    species?: string;
    level?: number;
    ability?: string;
    item?: string;
    shiny?: boolean;
    gender?: 'M' | 'F' | 'N';
    teraType?: string;
    moves?: string[];
    name?: string;
    evs?: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
    nature?: string;
  }) => {
    if (!dex) return;
    const speciesId = overrides.species || resolveSpeciesName();
    const nextLevel = overrides.level ?? selected.level;
    const p0 = toPokemon(speciesId, dex.pokedex, nextLevel);
    if (!p0) return;
    p0.name = overrides.name ?? selected.name;
    p0.species = speciesId;
    p0.ability = overrides.ability ?? selected.ability ?? p0.ability;
    (p0 as any).item = overrides.item ?? (selected as any).item;
    p0.shiny = overrides.shiny ?? selected.shiny;
    (p0 as any).gender = overrides.gender ?? (selected as any).gender;
    (p0 as any).teraType = overrides.teraType ?? (selected as any).teraType;
    p0.nature = overrides.nature ?? (selected as any).nature;
    p0.evs = overrides.evs ?? (selected as any).evs;
    p0.ivs = (selected as any).ivs;
    const moveNames = (overrides.moves ?? selected.moves.map(m => m.name)).filter(Boolean);
    p0.moves = mapMoves(moveNames, dex.moves);
    if ((selected as any).cosmeticForm) (p0 as any).cosmeticForm = (selected as any).cosmeticForm;
    const bp = prepareBattle(p0);
    const speciesChanged = normalizeName(speciesId) !== normalizeName(resolveSpeciesName());
    onReplaceSelected && onReplaceSelected(withVisualState(bp, !speciesChanged));
  };

  const startShowdownEdit = (field: 'level'|'gender'|'shiny'|'tera'|'species'|'item'|'ability'|'nickname', value: string) => {
    setShowdownEditField(field);
    setShowdownFieldValue(value);
    setShowdownEditMoveIndex(null);
  };

  const cancelShowdownEdit = () => {
    setShowdownEditField(null);
    setShowdownFieldValue('');
  };

  const commitShowdownEdit = () => {
    const field = showdownEditField;
    if (!field) return;
    if (field === 'level') {
      const lvl = Math.max(1, Math.min(100, Number(showdownFieldValue) || selected.level));
      applyShowdownUpdate({ level: lvl });
    } else if (field === 'gender') {
      const g = (showdownFieldValue || 'N') as 'M'|'F'|'N';
      applyShowdownUpdate({ gender: g });
    } else if (field === 'shiny') {
      applyShowdownUpdate({ shiny: showdownFieldValue === 'yes' });
    } else if (field === 'tera') {
      applyShowdownUpdate({ teraType: showdownFieldValue || undefined });
    } else if (field === 'species') {
      applyShowdownUpdate({ species: showdownFieldValue || resolveSpeciesName() });
    } else if (field === 'item') {
      applyShowdownUpdate({ item: showdownFieldValue || '' });
    } else if (field === 'ability') {
      applyShowdownUpdate({ ability: showdownFieldValue || selected.ability || '' });
    } else if (field === 'nickname') {
      applyShowdownUpdate({ name: showdownFieldValue || selected.name });
    }
    cancelShowdownEdit();
  };

  const startShowdownMoveEdit = (index: number, value: string) => {
    setShowdownEditMoveIndex(index);
    setShowdownMoveValue(value);
    setShowdownEditField(null);
  };

  const commitShowdownMoveEdit = () => {
    if (showdownEditMoveIndex == null) return;
    const next = selected.moves.map(m => m.name);
    while (next.length < 4) next.push('');
    next[showdownEditMoveIndex] = showdownMoveValue;
    applyShowdownUpdate({ moves: next.filter(Boolean) });
    setShowdownEditMoveIndex(null);
    setShowdownMoveValue('');
  };

  const jumpToSection = (s: 'basics'|'ability'|'mechanics'|'moves') => {
    setEditMode(true);
    setActiveEditSection(s);
    const map: Record<string, React.RefObject<HTMLDivElement|null>> = {
      basics: basicsRef,
      ability: abilityRef,
      mechanics: mechanicsRef,
      moves: movesRef,
    };
    setTimeout(() => {
      const el = map[s]?.current; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  // Back/front flip for sprite (independent of shiny toggle)
  const [showBack, setShowBack] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [spriteOptions, setSpriteOptions] = useState<PokemonSpriteOption[]>([]);
  const [spriteOptionId, setSpriteOptionId] = useState<string>('');
  const [spriteOptionsLoading, setSpriteOptionsLoading] = useState<boolean>(false);

  // Sprite change via file upload
  const spriteFileRef = useRef<HTMLInputElement | null>(null);
  const [spriteChangeKey, setSpriteChangeKey] = useState(0);
  const handleSpriteFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const fusion = (selected as any).fusion;
      if (fusion && fusion.headId && fusion.bodyId) {
        saveCustomFusionSprite(fusion.headId, fusion.bodyId, dataUrl);
        // Set the sprite directly on the Pokemon so it persists through prepareBattle()
        const next: any = { ...selected, sprite: dataUrl, spriteChoiceId: 'custom-upload', spriteChoiceLabel: 'Custom Upload' };
        if (next.fusion) next.fusion = { ...next.fusion, spriteFile: dataUrl };
        onReplaceSelected && onReplaceSelected(next);
      } else {
        // Persist to localStorage (and auto-upload to backend) so it survives refreshes
        const speciesId = normalizeName(selected.species || selected.name || '');
        if (speciesId) saveCustomSprite(speciesId, 'front', dataUrl);
        const next: any = { ...selected, sprite: dataUrl, spriteChoiceId: 'custom-upload', spriteChoiceLabel: 'Custom Upload' };
        if (!next.backSprite) next.backSprite = undefined;
        onReplaceSelected && onReplaceSelected(next);
      }
      setSpriteChangeKey(k => k + 1);
    };
    reader.readAsDataURL(file);
    // Reset file input so the same file can be re-selected
    e.target.value = '';
  }, [selected, onReplaceSelected]);

  useEffect(() => {
    let cancelled = false;
    const fusion = (selected as any)?.fusion;
    if (!selected || fusion) {
      setSpriteOptions([]);
      setSpriteOptionId('');
      return () => { cancelled = true; };
    }
    setSpriteOptionsLoading(true);
    const species = resolveSpeciesName();
    listPokemonSpriteOptions(species, {
      shiny: !!selected.shiny,
      cosmetic: selected.cosmeticForm,
      allowFormVariants: false,
      strictExisting: true,
    }).then((opts) => {
      if (cancelled) return;
      const currentFront = String((selected as any).sprite || '').trim();
      const currentBack = String((selected as any).backSprite || '').trim();
      const preferredId = String((selected as any).spriteChoiceId || '').trim();
      let resolved = opts.slice();
      let chosen = preferredId ? resolved.find(o => o.id === preferredId) : undefined;
      if (!chosen) {
        chosen = resolved.find(o => o.front === currentFront && (!currentBack || (o.back || '') === currentBack));
      }
      if (!chosen && currentFront && currentFront.startsWith('data:')) {
        const label = String((selected as any).spriteChoiceLabel || 'Current Custom Sprite');
        const injected: PokemonSpriteOption = {
          id: `current:${normalizeName(species)}`,
          label,
          spriteId: normalizeName(species),
          set: 'custom',
          front: currentFront,
          back: currentBack || undefined,
        };
        resolved = [injected, ...resolved];
        chosen = injected;
      }
      setSpriteOptions(resolved);
      setSpriteOptionId(chosen?.id || '');
      if (onReplaceSelected && chosen && (chosen.front !== currentFront || String(chosen.back || '') !== currentBack)) {
        onReplaceSelected({
          ...(selected as any),
          sprite: chosen.front,
          backSprite: chosen.back,
          spriteChoiceId: chosen.id,
          spriteChoiceLabel: chosen.label,
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setSpriteOptions([]);
        setSpriteOptionId('');
      }
    }).finally(() => {
      if (!cancelled) setSpriteOptionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [selected, resolveSpeciesName, onReplaceSelected]);

  useEffect(() => {
    const fusion = (selected as any)?.fusion;
    if (!fusion || !onReplaceSelected) return;
    if (!fusion.headId || !fusion.bodyId) return;
    if (fusion.triple) return;
    const current = Array.isArray(fusion.variants) ? fusion.variants.filter(Boolean) : [];
    const needsHydration = current.length <= 1 || current.includes('default');
    if (!needsHydration) return;

    let cancelled = false;
    fetchFusionVariants(fusion.headId, fusion.bodyId).then((variants) => {
      if (cancelled || !variants.length) return;
      const nextFusion = {
        ...fusion,
        variants,
        spriteFile: fusion.spriteFile || variants[0],
      };
      onReplaceSelected({ ...(selected as any), fusion: nextFusion });
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [selected, onReplaceSelected]);

  const applySpriteOption = useCallback((id: string) => {
    setSpriteOptionId(id);
    if (!selected || !onReplaceSelected) return;
    const chosen = spriteOptions.find(o => o.id === id);
    if (!chosen) {
      const next: any = { ...selected };
      delete next.sprite;
      delete next.backSprite;
      delete next.spriteChoiceId;
      delete next.spriteChoiceLabel;
      onReplaceSelected(next);
      setSpriteChangeKey(k => k + 1);
      return;
    }
    const next: any = {
      ...selected,
      sprite: chosen.front,
      backSprite: chosen.back,
      spriteChoiceId: chosen.id,
      spriteChoiceLabel: chosen.label,
    };
    onReplaceSelected(next);
    const speciesKey = chosen.spriteId || normalizeName(resolveSpeciesName() || selected.species || selected.name || '');
    if (speciesKey && chosen.front) {
      void cacheSpriteSelectionLocally(speciesKey, chosen.front, chosen.back, chosen.set as any);
    }
    setSpriteChangeKey(k => k + 1);
  }, [selected, onReplaceSelected, spriteOptions, resolveSpeciesName]);

  // Inline learn prompt will be rendered in compact view (below moves)

  // Manual vertical flow: prevent auto equalization of row heights by using a flex column
  return (
    <aside className="panel side" style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {/* Move learning prompt rendered inline in compact view */}
      
      {/* Panel mode toggle + Top summary */}
      <div style={{display:'flex', flexDirection:'column', gap:4}}>
        {/* View mode toggle row */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 4}}>
          <div className="toggle small" role="tablist" aria-label="Panel Mode">
            <button 
              className={panelMode==='showdown'?'active':''} 
              onClick={()=> { setPanelMode('showdown'); setEditMode(false); setShowdownEditField(null); setShowdownEditMoveIndex(null); }} 
              title="Showdown team builder style"
              style={{ padding: '2px 8px', fontSize: '0.75em' }}
            >
              Showdown
            </button>
            <button 
              className={panelMode==='compact'?'active':''} 
              onClick={()=> { setPanelMode('compact'); setShowdownEditField(null); setShowdownEditMoveIndex(null); }} 
              title="TTRPG compact view"
              style={{ padding: '2px 8px', fontSize: '0.75em' }}
            >
              TTRPG
            </button>
          </div>
          <div style={{display:'flex', gap:4, alignItems:'center'}}>
            <button
              title={selected.shiny ? 'Shiny: on' : 'Shiny: off'}
              aria-pressed={selected.shiny ? 'true' : 'false'}
              onClick={toggleShiny}
              style={{
                border:'1px solid var(--accent)', background:selected.shiny? 'var(--accent)' : '#fff', cursor:'pointer',
                fontSize:'14px', lineHeight:'14px', padding:'2px 6px', borderRadius:4,
                color: selected.shiny ? '#fff' : '#444'
              }}
            >{selected.shiny ? '★' : '☆'}</button>
            <button
              title={`Hat: ${AVAILABLE_HATS.find(h => h.id === currentHatId)?.name || 'None'} (click to change)`}
              onClick={() => setShowHatPicker(p => !p)}
              style={{
                border:'1px solid var(--accent)', background: currentHatId !== 'none' ? 'var(--accent)' : '#fff', cursor:'pointer',
                fontSize:'14px', lineHeight:'14px', padding:'2px 6px', borderRadius:4,
                color: currentHatId !== 'none' ? '#fff' : '#444'
              }}
            >{currentHatIcon}</button>
            {panelMode === 'compact' && (
              <button className="mini" onClick={()=> setEditMode(e=>!e)}>{editMode ? 'Close' : 'Edit'}</button>
            )}
            {panelMode === 'showdown' && (
              <span className="dim" style={{ fontSize: '0.75em' }}>Click fields to edit</span>
            )}
          </div>
        </div>
        
        {/* Name and info */}
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
          <div style={{flex: 1}}>
            <h2
              style={{margin:'0 0 2px 0', fontSize: '1.1em', cursor:'pointer'}}
              onClick={() => startShowdownEdit('nickname', selected.name)}
              title="Click to rename"
            >{selected.name}</h2>
            {showdownEditField === 'nickname' && (
              <div style={{display:'flex',gap:4,alignItems:'center',marginBottom:4}}>
                <input
                  autoFocus
                  value={showdownFieldValue}
                  onChange={e => setShowdownFieldValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitShowdownEdit(); if (e.key === 'Escape') cancelShowdownEdit(); }}
                  style={{flex:1, padding:'2px 4px', fontSize:'0.9em'}}
                />
                <button className="mini" onClick={commitShowdownEdit}>✓</button>
                <button className="mini" onClick={cancelShowdownEdit}>✕</button>
              </div>
            )}
            {/* Show level+type for TTRPG mode, just nickname for Showdown */}
            {panelMode === 'compact' && (
              <div style={{fontSize:'0.8em', marginTop:0}} className="dim">Lv {selected.level} • {selected.types.join(' / ')}</div>
            )}
          </div>
          {/* Types on the right for Showdown mode */}
          {panelMode === 'showdown' && (
            <div style={{display:'flex', gap:4, alignItems:'center'}}>
              {selected.types.map(t => (
                <span key={t} style={{
                  padding:'2px 8px',
                  borderRadius:4,
                  fontSize:'0.75em',
                  fontWeight:'bold',
                  color:'#fff',
                  background: TYPE_COLORS[t.toLowerCase()] || '#888',
                  textShadow:'0 1px 1px rgba(0,0,0,0.5)'
                }}>{t}</span>
              ))}
            </div>
          )}
        </div>
        {selected.species && normalizeName(selected.species) !== normalizeName(selected.name) && (
          <div className="dim" style={{fontSize:'0.7em', marginTop: -2}}>{selected.species}</div>
        )}
      </div>

      {/* Sprite (full seafoam area, outer border only) */}
  <div style={{ position:'relative', border:'1px solid var(--accent)', borderRadius:8, background:'var(--panel-bg-dark)', padding:0, display:'flex', justifyContent:'center', alignItems:'center', height: panelMode === 'compact' ? 100 : 132, overflow:'hidden', flexShrink:0 }}>
        <SpriteWithHat 
          key={spriteChangeKey}
          species={resolveSpeciesName()} 
          shiny={!!selected.shiny} 
          spriteOverride={(selected as any).sprite}
          backSpriteOverride={(selected as any).backSprite}
          cosmeticForm={selected.cosmeticForm} 
          back={showBack && !(selected as any).fusion}
          hatId={currentHatId}
          hatYOffset={((selected as any).hatYOffset as number) ?? 10}
          hatXOffset={((selected as any).hatXOffset as number) ?? 0}
          hatScale={((selected as any).hatScale as number) ?? 1}
          fusion={(selected as any).fusion}
          size={panelMode === 'compact' ? 96 : 100}
          style={{ transform: `scale(${zoom})${(showBack && (selected as any).fusion) ? ' scaleX(-1)' : ''}`, transformOrigin: 'center center' }}
          onHatMove={currentHatId !== 'none' && onReplaceSelected ? (x, y) => {
            const next = { ...selected, hatXOffset: x, hatYOffset: y } as any;
            onReplaceSelected(next);
          } : undefined}
          onHatScale={currentHatId !== 'none' && onReplaceSelected ? (s) => {
            const next = { ...selected, hatScale: s } as any;
            onReplaceSelected(next);
          } : undefined}
        />
        <div style={{ position:'absolute', top:4, right:4, display:'flex', flexDirection:'column', gap:4 }}>
          <button className="mini" onClick={()=> setShowBack(b=>!b)}>{showBack? 'Front' : 'Back'}</button>
          <button className="mini" onClick={() => spriteFileRef.current?.click()} title="Upload custom sprite image">📷</button>
          <input ref={spriteFileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleSpriteFileChange} />
        </div>
        <div style={{ position:'absolute', bottom:4, right:4, display:'flex', gap:4 }}>
          <button className="mini" onClick={()=> setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))}>-</button>
          <button className="mini" onClick={()=> setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))}>+</button>
        </div>
        {(selected as any).fusion && (
          <div style={{ position: 'absolute', top: 4, left: 4, fontSize: '10px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 4 }}>
            🔀 Fusion
          </div>
        )}
        {!(selected as any).fusion && (
          <button
            className="mini"
            onClick={(e) => {
              if (e.shiftKey || e.altKey) {
                setShowSecretTriplePanel(true);
                setShowFusePanel(false);
                return;
              }
              setShowFusePanel(p => !p);
            }}
            style={{ position: 'absolute', bottom: 4, left: 4, fontSize: '10px', padding: '2px 6px' }}
            title="Fuse with another Pokémon (Shift/Alt+Click: secret triple)"
          >🔀 Fuse</button>
        )}
      </div>

      {/* Fusion Creator Panel */}
      {showFusePanel && (
        <div style={{ border: '1px solid var(--accent)', borderRadius: 8, padding: 10, background: 'var(--panel-bg-dark)' }}>
          <FusionCreator
            initialHead={selected.species || selected.name}
            onAdd={(p) => { onAdd(p); setShowFusePanel(false); }}
            onClose={() => setShowFusePanel(false)}
          />
        </div>
      )}

      {showSecretTriplePanel && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" style={{ width: 520, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Secret Triple Fusion</h3>
              <button className="mini" onClick={() => setShowSecretTriplePanel(false)}>✕</button>
            </div>
            <FusionCreator
              initialHead={selected.species || selected.name}
              tripleUnlockedByDefault
              allowedThirdSpecies={pcSpeciesPool}
              onAdd={(p) => { onAdd(p); setShowSecretTriplePanel(false); }}
              onClose={() => setShowSecretTriplePanel(false)}
            />
          </div>
        </div>
      )}

      {/* Sprite Variant Chooser for Fusions — image thumbnails */}
      {(selected as any).fusion && onReplaceSelected && (() => {
        const fusion = (selected as any).fusion;
        const variants: string[] = fusion.variants || [];
        const apiBases = getFusionApiBases();
        // Resolve variant filenames to full URLs for <img src>
        const resolveVariantUrl = (raw: string): string => {
          if (!raw) return '';
          if (/^(data:|https?:\/\/)/i.test(raw)) return raw;
          if (raw.startsWith('/')) return raw;
          return apiBases.length ? `${apiBases[0]}/fusion/sprites/${raw}` : `/fusion-sprites/${raw}`;
        };
        const currentSpriteFile = fusion.spriteFile || '';
        return (
          <div style={{ display: 'grid', gap: 6, fontSize: '0.82em' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="dim">Fusion Sprites:</span>
              <SpriteModeToggle
                mode={(selected as any).spriteMode || 'auto'}
                onModeChange={(mode: string) => {
                  const next = { ...selected, spriteMode: mode } as any;
                  onReplaceSelected(next);
                }}
                compact
              />
            </div>
            {variants.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 220, overflowY: 'auto', paddingRight: 2 }}>
                {variants.map((v: string, i: number) => {
                  const url = resolveVariantUrl(v);
                  const active = v === currentSpriteFile || (!currentSpriteFile && i === 0);
                  return (
                    <button
                      key={v + i}
                      onClick={() => {
                        const next = { ...selected, fusion: { ...fusion, spriteFile: v } } as any;
                        // Also set sprite property so battle system uses it
                        next.sprite = url;
                        onReplaceSelected(next);
                        if (url.startsWith(IFD_CDN_BASE)) cacheIfdSprite(fusion.headId, fusion.bodyId, url);
                      }}
                      title={v}
                      style={{
                        width: 88,
                        minHeight: 96,
                        display: 'grid',
                        gap: 4,
                        alignContent: 'start',
                        justifyItems: 'center',
                        border: active ? '2px solid var(--accent)' : '1px solid #444',
                        borderRadius: 6,
                        background: active ? 'rgba(255,255,255,0.08)' : 'var(--panel-bg-dark)',
                        padding: 4,
                        cursor: 'pointer',
                      }}
                    >
                      <img
                        src={url}
                        alt={`Variant ${i + 1}`}
                        loading="lazy"
                        style={{ width: 56, height: 56, imageRendering: 'pixelated', objectFit: 'contain' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none';
                        }}
                      />
                      <span className="dim" style={{ fontSize: '0.7em', lineHeight: 1.2, textAlign: 'center' }}>
                        {/^https?:\/\//i.test(v) ? (v.includes(IFD_CDN_BASE) ? `IFD ${i + 1}` : `Web ${i + 1}`) : v.replace(/\.png$/i, '')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {variants.length === 0 && (
              <span className="dim">No fusion sprite variants found.</span>
            )}

            {/* Defuse Button */}
            <button
              className="mini"
              onClick={() => {
                if (!onReplaceSelected || !onAdd || !dex) return;
                const headMon = toPokemon(fusion.headName, dex.pokedex, selected.level);
                const bodyMon = toPokemon(fusion.bodyName, dex.pokedex, selected.level);
                if (headMon) onAdd(prepareBattle(headMon));
                if (bodyMon) onAdd(prepareBattle(bodyMon));
                onDeleteSelected?.();
              }}
              title="Split this fusion back into its two component Pokémon"
              style={{ marginTop: 4, padding: '4px 12px', fontSize: '0.85em' }}
            >
              🔓 Defuse → {fusion.headName} + {fusion.bodyName}
            </button>

            {/* Evolve Head / Body */}
            {dex && (() => {
              const headId = normalizeName(fusion.headName || '');
              const bodyId = normalizeName(fusion.bodyName || '');
              const headEntry = dex.pokedex[headId];
              const bodyEntry = dex.pokedex[bodyId];
              const headEvos: string[] = headEntry?.evos || [];
              const bodyEvos: string[] = bodyEntry?.evos || [];
              if (headEvos.length === 0 && bodyEvos.length === 0) return null;

              const handleFusionEvolve = async (component: 'head' | 'body', evoSpeciesName: string) => {
                if (!onReplaceSelected || !dex) return;
                const evoId = normalizeName(evoSpeciesName);
                const evoEntry = dex.pokedex[evoId];
                if (!evoEntry) return;

                const evoNum = nameToDexNum(evoSpeciesName);
                if (!evoNum) return;

                const newHeadName = component === 'head' ? (evoEntry.name || evoSpeciesName) : fusion.headName;
                const newBodyName = component === 'body' ? (evoEntry.name || evoSpeciesName) : fusion.bodyName;
                const newHeadId = component === 'head' ? evoNum : fusion.headId;
                const newBodyId = component === 'body' ? evoNum : fusion.bodyId;

                // Recalculate fusion name
                const splitH = Math.ceil(newHeadName.length / 2);
                const splitB = Math.floor(newBodyName.length / 2);
                const newFusionName = (newHeadName.slice(0, splitH) + newBodyName.slice(splitB)).charAt(0).toUpperCase()
                  + (newHeadName.slice(0, splitH) + newBodyName.slice(splitB)).slice(1).toLowerCase();

                // Recalculate fusion types
                const hEntry = component === 'head' ? evoEntry : headEntry;
                const bEntry = component === 'body' ? evoEntry : bodyEntry;
                const hTypes = hEntry?.types || ['Normal'];
                const bTypes = bEntry?.types || ['Normal'];
                const t1 = hTypes[0];
                const t2 = bTypes.length > 1 ? bTypes[1] : bTypes[0];
                const newTypes = normalizeName(t1) === normalizeName(t2) ? [t1] : [t1, t2];

                // Recalculate fusion stats
                const hbs = hEntry?.baseStats || { hp:50, atk:50, def:50, spa:50, spd:50, spe:50 };
                const bbs = bEntry?.baseStats || { hp:50, atk:50, def:50, spa:50, spd:50, spe:50 };
                const newBaseStats = {
                  hp:    Math.floor((2 * hbs.hp  + bbs.hp)  / 3),
                  atk:   Math.floor((2 * bbs.atk + hbs.atk) / 3),
                  def:   Math.floor((2 * bbs.def + hbs.def) / 3),
                  spAtk: Math.floor((2 * hbs.spa + bbs.spa) / 3),
                  spDef: Math.floor((2 * hbs.spd + bbs.spd) / 3),
                  speed: Math.floor((2 * bbs.spe + hbs.spe) / 3),
                };

                // Fetch new variants
                const newVariants = await fetchFusionVariants(newHeadId, newBodyId).catch(() => [`${newHeadId}.${newBodyId}.png`]);

                // Build evolved fusion
                const next = {
                  ...selected,
                  species: newFusionName,
                  types: newTypes,
                  baseStats: newBaseStats,
                  fusion: {
                    ...fusion,
                    headId: newHeadId,
                    bodyId: newBodyId,
                    headName: newHeadName,
                    bodyName: newBodyName,
                    spriteFile: newVariants[0] || undefined,
                    variants: newVariants,
                  },
                } as any;

                // Preserve nickname only if it was custom (not the old fusion species name)
                if (selected.name === selected.species) {
                  next.name = newFusionName;
                }

                // Filter moves to ones legal for either component
                const headLearnset = dex.learnsets[normalizeName(newHeadName)]?.learnset || {};
                const bodyLearnset = dex.learnsets[normalizeName(newBodyName)]?.learnset || {};
                next.moves = selected.moves.filter((m: any) => {
                  const mid = normalizeName(m.name);
                  return headLearnset[mid] || bodyLearnset[mid];
                });

                // Recalculate HP
                const bp = prepareBattle(next);
                const hpPct = selected.currentHp / selected.maxHp;
                bp.currentHp = Math.max(1, Math.round(hpPct * bp.maxHp));

                onReplaceSelected(bp);
              };

              return (
                <div style={{ marginTop: 4, padding: 8, background: 'rgba(100, 200, 100, 0.1)', borderRadius: 6, border: '1px solid rgba(100, 200, 100, 0.3)' }}>
                  <div className="dim" style={{ fontSize: '0.75em', marginBottom: 4 }}>Fusion Evolution</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {headEvos.map(evoName => {
                      const evoId = normalizeName(evoName);
                      const evoEntry = dex.pokedex[evoId];
                      if (!evoEntry) return null;
                      const evoLevel = evoEntry.evoLevel;
                      const canEvolve = !evoLevel || selected.level >= evoLevel;
                      return (
                        <button
                          key={`head-${evoId}`}
                          className="mini"
                          onClick={() => handleFusionEvolve('head', evoName)}
                          disabled={!canEvolve}
                          title={`Evolve head (${fusion.headName}) → ${evoEntry.name}${evoLevel ? ` (Lv ${evoLevel})` : ''}`}
                          style={{ opacity: canEvolve ? 1 : 0.5 }}
                        >
                          🧠 Head → {evoEntry.name}
                        </button>
                      );
                    })}
                    {bodyEvos.map(evoName => {
                      const evoId = normalizeName(evoName);
                      const evoEntry = dex.pokedex[evoId];
                      if (!evoEntry) return null;
                      const evoLevel = evoEntry.evoLevel;
                      const canEvolve = !evoLevel || selected.level >= evoLevel;
                      return (
                        <button
                          key={`body-${evoId}`}
                          className="mini"
                          onClick={() => handleFusionEvolve('body', evoName)}
                          disabled={!canEvolve}
                          title={`Evolve body (${fusion.bodyName}) → ${evoEntry.name}${evoLevel ? ` (Lv ${evoLevel})` : ''}`}
                          style={{ opacity: canEvolve ? 1 : 0.5 }}
                        >
                          💪 Body → {evoEntry.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {!(selected as any).fusion && (
        <div style={{ display: 'grid', gap: 6, fontSize: '0.82em' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="dim">Sprite:</span>
            <button className="mini" onClick={() => applySpriteOption('')} title="Use default Gen 5 fallback sprite">
              Auto (Gen 5)
            </button>
            <button className="mini" onClick={() => applySpriteOption('')} title="Clear individual sprite and use default fallback">
              Reset
            </button>
            <button className="mini" onClick={() => {
              const species = selected.species || selected.name;
              clearCustomSprites(species);
              clearSpriteSettings(species);
              applySpriteOption('');
            }} title="Remove all saved/cached custom sprites for this Pokemon">
              Clear Saved
            </button>
            <button
              className="mini"
              onClick={async () => {
                setSpriteOptionsLoading(true);
                try {
                  await resyncSpriteCatalog({ forceBackendReindex: true });
                  onReplaceSelected && onReplaceSelected({ ...(selected as any) });
                  setSpriteChangeKey((k) => k + 1);
                } finally {
                  setSpriteOptionsLoading(false);
                }
              }}
              title="Rebuild backend sprite index and refresh local sprite cache"
            >
              Reindex
            </button>
            {spriteOptionsLoading && <span className="dim">Loading...</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 220, overflowY: 'auto', paddingRight: 2 }}>
            {spriteOptions.map((opt) => {
              const active = spriteOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => applySpriteOption(opt.id)}
                  title={opt.label}
                  style={{
                    width: 88,
                    minHeight: 96,
                    display: 'grid',
                    gap: 4,
                    alignContent: 'start',
                    justifyItems: 'center',
                    border: active ? '2px solid var(--accent)' : '1px solid #444',
                    borderRadius: 6,
                    background: active ? 'rgba(255,255,255,0.08)' : 'var(--panel-bg-dark)',
                    padding: 4,
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={opt.front}
                    alt={opt.label}
                    style={{ width: 56, height: 56, imageRendering: 'pixelated', objectFit: 'contain' }}
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.src = placeholderSpriteDataURL('?');
                    }}
                  />
                  <span className="dim" style={{ fontSize: '0.7em', lineHeight: 1.2, textAlign: 'center' }}>{opt.label}</span>
                </button>
              );
            })}
            {!spriteOptionsLoading && spriteOptions.length === 0 && (
              <span className="dim">No local variants found. Using default Gen 5 fallback.</span>
            )}
          </div>
        </div>
      )}

      {/* Hat Picker Popup */}
      {showHatPicker && (
        <div style={{ position: 'relative', marginTop: -4 }}>
          <HatPicker selectedHat={currentHatId} onSelect={setHat} compact />
          {currentHatId !== 'none' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: '0.78em', flexWrap: 'wrap' }}>
              <span className="dim" style={{ fontSize: '0.85em' }}>💡 Drag hat to move • Scroll to resize</span>
              <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                ↕ Y:
                <input type="range" min={-20} max={60} value={((selected as any).hatYOffset as number) ?? 10}
                  onChange={e => {
                    const next = { ...selected, hatYOffset: Number(e.target.value) } as any;
                    onReplaceSelected && onReplaceSelected(next);
                  }}
                  style={{ width: 70 }} />
                <span style={{ minWidth: 22 }}>{((selected as any).hatYOffset as number) ?? 10}</span>
              </label>
              <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                ↔ X:
                <input type="range" min={-30} max={30} value={((selected as any).hatXOffset as number) ?? 0}
                  onChange={e => {
                    const next = { ...selected, hatXOffset: Number(e.target.value) } as any;
                    onReplaceSelected && onReplaceSelected(next);
                  }}
                  style={{ width: 70 }} />
                <span style={{ minWidth: 22 }}>{((selected as any).hatXOffset as number) ?? 0}</span>
              </label>
              <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                🔍 Size:
                <input type="range" min={3} max={30} value={Math.round(((selected as any).hatScale as number ?? 1) * 10)}
                  onChange={e => {
                    const next = { ...selected, hatScale: Number(e.target.value) / 10 } as any;
                    onReplaceSelected && onReplaceSelected(next);
                  }}
                  style={{ width: 60 }} />
                <span style={{ minWidth: 22 }}>{((selected as any).hatScale as number ?? 1).toFixed(1)}</span>
              </label>
              <button className="mini" style={{ fontSize: '0.78em', padding: '1px 6px' }} onClick={() => {
                const next = { ...selected, hatYOffset: 10, hatXOffset: 0, hatScale: 1 } as any;
                onReplaceSelected && onReplaceSelected(next);
              }}>Reset</button>
            </div>
          )}
        </div>
      )}

      {!editMode && panelMode === 'compact' && (
        <>
          <div style={{marginTop:6}}>
            <strong>HP</strong>: {ttrpgCurrHp}/{ttrpgMaxHp}
          </div>
          <div className="hpbar large" style={{marginTop:2}} title={`HP ${selected.currentHp}/${selected.maxHp}`}><span style={{ width: `${hpPct}%` }} /></div>
          {onHeal && selected.currentHp < selected.maxHp && (
            <div style={{display:'flex', gap:6, alignItems:'center', marginTop:4, flexWrap:'wrap'}}>
              <button className="mini" onClick={() => onHeal('full')}>Full Heal</button>
              <input type="number" min={1} value={healAmount} onChange={e => setHealAmount(e.target.value)} placeholder="HP" style={{width:60}} />
              <button className="mini" disabled={!healAmount || Number(healAmount) <= 0} onClick={() => { onHeal(Number(healAmount)); setHealAmount(''); }}>Heal</button>
            </div>
          )}

          <div className="stats" style={{border:'1px solid #444', padding:'4px 6px', borderRadius:6, cursor:'pointer', flexShrink:0}} onClick={()=> jumpToSection('mechanics')} title="Click to edit mechanics">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <div className="dim" style={{fontSize:'0.9em'}}>Stats</div>
              <div className="toggle small" role="tablist" aria-label="View Mode">
                <button className={viewMode==='ttrpg'?'active':''} onClick={(e)=>{ e.stopPropagation(); setViewMode('ttrpg'); }} title="Show TTRPG modifiers">TTRPG</button>
                <button className={viewMode==='real'?'active':''} onClick={(e)=>{ e.stopPropagation(); setViewMode('real'); }} title="Show real stats at this level">Regular</button>
              </div>
            </div>
            <div className="stat header" style={{display:'grid',gridTemplateColumns:'auto 1fr 56px 80px',gap:4,alignItems:'center', marginBottom:4}}>
              <div />
              <div />
              <div className="label dim" style={{textAlign:'right'}}>BST</div>
              <div className="label dim" style={{textAlign:'right'}}>{viewMode==='ttrpg' ? 'Modifiers' : 'Real'}</div>
            </div>
            {stats.map(s => {
              const mod = statModifierDisplay(s.key as any, s.value);
              return (
                <div className="stat" key={s.key} style={{display:'grid',gridTemplateColumns:'auto 1fr 56px 80px',gap:4,alignItems:'center'}}>
                  <div className="label" style={{textAlign:'left'}}>{s.label}</div>
                  <div className="bar" aria-valuenow={s.value}>
                    <span style={{ width: `${Math.min(100, (s.value/180)*100)}%`, background: s.color }} />
                  </div>
                  <div className="val">{s.value}</div>
                  {viewMode==='ttrpg' ? (
                    <div className="dim" title="TTRPG modifier" style={{textAlign:'right'}}>{mod}</div>
                  ) : (
                    <div className="val" title="Real stat at this level" style={{textAlign:'right'}}>{
                      s.key==='hp' ? realStats.hp :
                      s.key==='atk' ? realStats.atk :
                      s.key==='def' ? realStats.def :
                      s.key==='spAtk' ? realStats.spa :
                      s.key==='spDef' ? realStats.spd :
                      realStats.spe
                    }</div>
                  )}
                </div>
              );
            })}
            <div className="stat total" style={{display:'grid',gridTemplateColumns:'auto 1fr 56px 80px',alignItems:'center',marginTop:4}}>
              <div className="label">Total</div>
              <div />
              <div className="val" style={{textAlign:'right'}}>{total}</div>
              <div className="val" style={{textAlign:'right'}}>{viewMode==='real' ? realTotal : ''}</div>
            </div>
          </div>

          {/* Field Stats (TTRPG skill checks) */}
          {viewMode === 'ttrpg' && (() => {
            const cs = realStats;
            const types = (selected.types || []).map((t: string) => t.toLowerCase());
            const TYPE_BONUS: Record<string, string> = {
              normal:'charm', fire:'charm', water:'fortitude', electric:'athletics',
              grass:'charm', ice:'athletics', fighting:'strength', poison:'intelligence',
              ground:'strength', flying:'athletics', psychic:'intelligence', bug:'athletics',
              rock:'fortitude', ghost:'intelligence', dragon:'strength', dark:'intelligence',
              steel:'fortitude', fairy:'charm',
              // fangame types
              nuclear:'intelligence', cosmic:'intelligence', shadow:'intelligence',
              sound:'charm',
            };
            const tbonus = (stat: string) => {
              let b = 0;
              for (const t of types) { if (TYPE_BONUS[t] === stat) b++; }
              return Math.min(b, 2);
            };
            const ceil10 = (x: number) => Math.ceil(x / 10);
            const ceil20 = (x: number) => Math.ceil(x / 20);
            const clamp = (x: number) => Math.max(3, x);
            const fieldStats = [
              { label: 'Strength',     value: clamp(ceil10(cs.atk) + tbonus('strength')),     color: '#ffb347' },
              { label: 'Athletics',    value: clamp(ceil10(cs.spe) + tbonus('athletics')),   color: '#8fff8f' },
              { label: 'Intelligence', value: clamp(ceil20(cs.spa + cs.spd) + tbonus('intelligence')), color: '#a0a6ff' },
              { label: 'Fortitude',    value: clamp(ceil20(cs.hp + cs.def) + tbonus('fortitude')),         color: '#ffd56e' },
              { label: 'Charm',        value: clamp(ceil20(cs.hp + cs.spd) + tbonus('charm')),           color: '#ff9aa2' },
            ];
            return (
              <div style={{border:'1px solid #444', padding:'4px 6px', borderRadius:6, marginTop:6, flexShrink:0}}>
                <div className="dim" style={{fontSize:'0.9em', marginBottom:4}}>Field Stats</div>
                {fieldStats.map(fs => (
                  <div key={fs.label} style={{display:'grid', gridTemplateColumns:'90px 1fr 36px 46px', gap:4, alignItems:'center'}}>
                    <div className="label">{fs.label}</div>
                    <div className="bar" aria-valuenow={fs.value}>
                      <span style={{ width: `${Math.min(100, (fs.value / 40) * 100)}%`, background: fs.color }} />
                    </div>
                    <div className="val" style={{textAlign:'right'}}>{fs.value}</div>
                    <div className="dim" style={{textAlign:'right', fontSize:'0.85em'}}>+{Math.ceil(fs.value / 2)}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="ability-item" style={{ cursor:'pointer', marginTop:6, flexShrink:0 }} onClick={()=> jumpToSection('ability')} title="Click to edit ability/item">
            <div>
              <div className="label"><strong>Ability</strong></div>
              <div className="value">{selected.ability || '—'}</div>
              {abilityDesc && <div className="desc dim">{abilityDesc}</div>}
            </div>
            <div>
              <div className="label"><strong>Item</strong></div>
              <div className="value">{itemText}</div>
              {itemDesc && <div className="desc dim">{itemDesc}</div>}
            </div>
          </div>

          {dex && (()=>{
            const held = (selected as any).item as string | undefined;
            const speciesId = resolveSpeciesName();
            const { base } = speciesFormesInfo(speciesId, dex.pokedex);
            const target = eligibleMegaFormForItem(base, held, dex.pokedex);
            const nowEntry = dex.pokedex[normalizeName(speciesId)] || {};
            const nameLooksMega = /(^|[-_\s])mega(\b|[-_\s])/i.test(String(speciesId));
            const isNowMega = !!nowEntry.isMega || nameLooksMega;
            if (!target && !isNowMega) return null;
            const doToggle = async () => {
              if (!dex) return;
              const nextSpecies = isNowMega ? base : (target || base);
              const p0 = toPokemon(nextSpecies, dex.pokedex, selected.level);
              if (!p0) return;
              p0.name = selected.name;
              p0.item = (selected as any).item;
              p0.shiny = selected.shiny;
              p0.moves = selected.moves as any;
              const bp = prepareBattle(p0);
              onReplaceSelected && onReplaceSelected(withVisualState(bp, false));
            };
            return (
              <div style={{marginTop:8, display:'flex', alignItems:'center', gap:8}}>
                <button onClick={doToggle}>{isNowMega ? '> De-mega' : '> Mega Evolve'}</button>
                {target && !isNowMega && (
                  <span className="dim">Using {held}: toggles to {target}</span>
                )}
              </div>
            );
          })()}

          <section style={{marginTop:6, border:'1px solid #444', borderRadius:6, padding:6, cursor:'pointer', flexShrink:0}} onClick={()=> jumpToSection('moves')} title="Click to edit moves">
            <h4 style={{marginTop:0}}>Moves</h4>
            <div style={{display:'grid', gap:6}}>
              {selected.moves.length === 0 && (
                <div className="dim">No moves yet.</div>
              )}
              {selected.moves.map((m, idx) => {
                const basePow = typeof (m as any).power === 'number' ? (m as any).power as number : -1;
                const hasStab = m.type && selected.types.some(t=> normalizeName(t) === normalizeName(m.type));
                const stabPow = basePow >= 0 ? Math.floor(basePow * (hasStab ? 1.5 : 1)) : -1;
                const die = stabPow >= 0 ? diceFromPower(stabPow) : null;
                const moveInfo = dex?.moves?.[normalizeName(m.name)];
                const tooltip = moveTooltip(moveInfo || (m as any));
                return (
                  <div
                    key={idx}
                    style={{display:'grid', gridTemplateColumns:'1fr auto', alignItems:'baseline', gap:8, cursor: learnReplaceMove ? 'pointer' : 'default'}}
                    title={tooltip}
                    onClick={(e) => {
                      if (!learnReplaceMove) return;
                      e.stopPropagation();
                      replaceMoveAtIndex(idx);
                    }}
                  >
                    <div>
                      <div><strong>{m.name}</strong> <span className="dim">({m.type}{(m as any).category ? ` • ${(m as any).category}` : ''})</span></div>
                      {viewMode==='ttrpg' ? (
                        <>
                          <div className="dim" style={{fontSize:'0.9em'}}>
                            {basePow >= 0 ? `Power ${basePow}${hasStab ? ` → STAB ${stabPow}` : ''}` : 'Status'}
                            {die ? ` • Dice ${die}` : ''}
                            {(m as any).accuracy != null ? ` • Acc ${(m as any).accuracy === true ? '—' : (m as any).accuracy+'%'}` : ''}
                          </div>
                          {(m as any).effect && <div style={{fontSize:'0.9em'}}>{(m as any).effect}</div>}
                        </>
                      ) : (
                        <div className="dim" style={{fontSize:'0.9em'}}>
                          {basePow >= 0 ? `Power ${basePow}` : 'Status'}
                          {(m as any).accuracy != null ? ` • Acc ${(m as any).accuracy === true ? '—' : (m as any).accuracy+'%'}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {learnableMoves.length > 0 && (
            <section style={{marginTop:6, border:'1px solid #444', borderRadius:6, padding:6, flexShrink:0}}>
              <h4 style={{marginTop:0}}>Learnable Moves</h4>
              {learnReplaceMove && (
                <div className="dim" style={{marginBottom:6}}>
                  Select a move above to replace with <strong>{learnReplaceMove.name}</strong>.
                </div>
              )}
              <div style={{display:'grid', gap:6}}>
                {learnableMoves.map((m) => {
                  const moveInfo = dex?.moves?.[normalizeName(m.name)];
                  const tooltip = moveTooltip(moveInfo || (m as any));
                  return (
                    <div key={m.name} style={{border:'1px solid #555', borderRadius:6, padding:6, background:'rgba(255,255,255,0.03)'}}>
                      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                        <div title={tooltip} style={{fontWeight:'bold'}}>{m.name}</div>
                        <div className="dim">Lv {m.level}</div>
                      </div>
                      <div style={{display:'flex', gap:6, marginTop:6}}>
                        <button className="mini" onClick={() => setLearnReplaceMove(m)}>Yes</button>
                        <button className="mini" onClick={() => removeLearnableMove(m.name)}>No</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {!editMode && panelMode === 'showdown' && (
        <>
          {/* Pokemon Showdown Team Builder Style Layout */}
          {/* PS-style: No action buttons row, everything is click-to-edit */}

          {/* Main content area - PS team builder style without duplicate sprite */}
          <div style={{padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6, border:'1px solid #333'}}>
            {/* Details row: Level, Gender, Shiny, Tera Type */}
            <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:4, padding:4, background:'rgba(255,255,255,0.03)', borderRadius:4, marginBottom:6}}>
              <div onClick={()=> startShowdownEdit('level', String(selected.level))} style={{cursor:'pointer'}}>
                <div className="dim" style={{fontSize:'0.75em'}}>Level</div>
                {showdownEditField === 'level' ? (
                  <div style={{display:'flex', gap:4, alignItems:'center'}} onClick={(e)=>e.stopPropagation()}>
                    <input type="number" min={1} max={100} value={showdownFieldValue} onChange={e=>setShowdownFieldValue(e.target.value)} style={{width:60}} />
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); commitShowdownEdit(); }}>✓</button>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); cancelShowdownEdit(); }}>✕</button>
                  </div>
                ) : (
                  <div style={{fontWeight:'bold'}}>{selected.level}</div>
                )}
              </div>
              <div onClick={()=> startShowdownEdit('gender', (selected.gender as any) || 'N')} style={{cursor:'pointer'}}>
                <div className="dim" style={{fontSize:'0.75em'}}>Gender</div>
                {showdownEditField === 'gender' ? (
                  <div style={{display:'flex', gap:4, alignItems:'center'}} onClick={(e)=>e.stopPropagation()}>
                    <select value={showdownFieldValue} onChange={e=>setShowdownFieldValue(e.target.value)}>
                      <option value="N">N/A</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                    </select>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); commitShowdownEdit(); }}>✓</button>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); cancelShowdownEdit(); }}>✕</button>
                  </div>
                ) : (
                  <div style={{fontWeight:'bold'}}>{selected.gender === 'M' ? 'Male' : selected.gender === 'F' ? 'Female' : 'N/A'}</div>
                )}
              </div>
              <div onClick={()=> startShowdownEdit('shiny', selected.shiny ? 'yes' : 'no')} style={{cursor:'pointer'}}>
                <div className="dim" style={{fontSize:'0.75em'}}>Shiny</div>
                {showdownEditField === 'shiny' ? (
                  <div style={{display:'flex', gap:4, alignItems:'center'}} onClick={(e)=>e.stopPropagation()}>
                    <select value={showdownFieldValue} onChange={e=>setShowdownFieldValue(e.target.value)}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); commitShowdownEdit(); }}>✓</button>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); cancelShowdownEdit(); }}>✕</button>
                  </div>
                ) : (
                  <div style={{fontWeight:'bold'}}>{selected.shiny ? 'Yes' : 'No'}</div>
                )}
              </div>
              <div onClick={()=> startShowdownEdit('tera', (selected as any).teraType || '')} style={{cursor:'pointer'}}>
                <div className="dim" style={{fontSize:'0.75em'}}>Tera Type</div>
                {showdownEditField === 'tera' ? (
                  <div style={{display:'flex', gap:4, alignItems:'center'}} onClick={(e)=>e.stopPropagation()}>
                    <input list="tera-types" value={showdownFieldValue} onChange={e=>setShowdownFieldValue(e.target.value)} style={{width:90}} />
                    <datalist id="tera-types">
                      {Object.keys(TYPE_COLORS).map(t => <option key={t} value={titleCase(t)} />)}
                    </datalist>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); commitShowdownEdit(); }}>✓</button>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); cancelShowdownEdit(); }}>✕</button>
                  </div>
                ) : (
                  <div style={{fontWeight:'bold'}}>{(selected as any).teraType || selected.types[0]}</div>
                )}
              </div>
            </div>

            {/* Pokemon, Item, Ability row */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, fontSize:'0.85em'}}>
              <div style={{cursor:'pointer'}} onClick={()=> startShowdownEdit('species', resolveSpeciesName())} title="Click to edit">
                <div className="dim" style={{fontSize:'0.75em'}}>Pokémon</div>
                {showdownEditField === 'species' ? (
                  <div style={{display:'flex', gap:4, alignItems:'center'}} onClick={(e)=>e.stopPropagation()}>
                    <input list="showdown-species" value={showdownFieldValue} onChange={e=>setShowdownFieldValue(e.target.value)} style={{width:'100%'}} />
                    <datalist id="showdown-species">
                      {dex && Object.values(dex.pokedex).filter((s:any)=> !s.baseSpecies || normalizeName(s.baseSpecies)===normalizeName(s.name)).map((s:any)=> <option key={s.name} value={s.name} />)}
                    </datalist>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); commitShowdownEdit(); }}>✓</button>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); cancelShowdownEdit(); }}>✕</button>
                  </div>
                ) : (
                  <div style={{fontWeight:'bold', fontSize:'0.9em'}}>{resolveSpeciesName()}</div>
                )}
              </div>
              <div style={{cursor:'pointer'}} onClick={()=> startShowdownEdit('item', (selected as any).item || '')} title="Click to edit">
                <div className="dim" style={{fontSize:'0.75em'}}>Item</div>
                {showdownEditField === 'item' ? (
                  <div style={{display:'flex', gap:4, alignItems:'center'}} onClick={(e)=>e.stopPropagation()}>
                    <input list="showdown-items" value={showdownFieldValue} onChange={e=>setShowdownFieldValue(e.target.value)} style={{width:'100%'}} />
                    <datalist id="showdown-items">
                      {dex && Object.values(dex.items).map((it:any) => <option key={it.name} value={it.name} label={getItemOptionLabel(it.name)} />)}
                    </datalist>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); commitShowdownEdit(); }}>✓</button>
                    <button className="mini" onClick={(e)=>{ e.stopPropagation(); cancelShowdownEdit(); }}>✕</button>
                  </div>
                ) : (
                  <div style={{fontWeight:'bold', fontSize:'0.9em'}}>{itemText || '—'}</div>
                )}
              </div>
              <div style={{cursor:'pointer'}} onClick={()=> startShowdownEdit('ability', selected.ability || '')} title="Click to edit">
                <div className="dim" style={{fontSize:'0.75em'}}>Ability</div>
                {showdownEditField === 'ability' ? (
                  <AbilityPicker
                    value={showdownFieldValue}
                    onChange={setShowdownFieldValue}
                    onCommit={commitShowdownEdit}
                    onCancel={cancelShowdownEdit}
                    legalAbilities={abilityOpts}
                    dex={dex}
                    getLabel={getAbilityOptionLabel}
                  />
                ) : (
                  <div style={{fontWeight:'bold', fontSize:'0.9em'}}>{selected.ability || '—'}</div>
                )}
              </div>
            </div>
          </div>

          {/* HP section */}
          <div style={{marginTop:6, padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6, border:'1px solid #333'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
              <div className="dim" style={{fontSize:'0.75em'}}>HP</div>
              <div style={{display:'flex', gap:4, alignItems:'center'}}>
                <span style={{fontSize:'0.85em', fontWeight:'bold', color: hpPct > 50 ? '#4caf50' : hpPct > 20 ? '#ff9800' : '#f44336'}}>{ttrpgCurrHp}/{ttrpgMaxHp}</span>
                <span className="dim" style={{fontSize:'0.75em'}}>({hpPct}%)</span>
              </div>
            </div>
            <div className="hpbar large" style={{marginTop:2}} title={`HP ${selected.currentHp}/${selected.maxHp}`}><span style={{ width: `${hpPct}%` }} /></div>
            <div style={{display:'flex', gap:4, alignItems:'center', marginTop:6, flexWrap:'wrap'}}>
              <button className="mini" title="-10 HP" onClick={() => onHeal && onHeal(-10)} style={{minWidth:32}}>-10</button>
              <button className="mini" title="-5 HP" onClick={() => onHeal && onHeal(-5)} style={{minWidth:28}}>-5</button>
              <button className="mini" title="-1 HP" onClick={() => onHeal && onHeal(-1)} style={{minWidth:24}}>-1</button>
              <button className="mini" title="+1 HP" onClick={() => onHeal && onHeal(1)} style={{minWidth:24}}>+1</button>
              <button className="mini" title="+5 HP" onClick={() => onHeal && onHeal(5)} style={{minWidth:28}}>+5</button>
              <button className="mini" title="+10 HP" onClick={() => onHeal && onHeal(10)} style={{minWidth:32}}>+10</button>
              <button className="mini" title="Full Heal" onClick={() => onHeal && onHeal('full')} style={{marginLeft:'auto'}}>Full Heal</button>
            </div>
            <div style={{display:'flex', gap:4, alignItems:'center', marginTop:4}}>
              <input type="number" min={1} value={healAmount} onChange={e => setHealAmount(e.target.value)} placeholder="Amount" style={{width:70, fontSize:'0.85em'}} />
              <button className="mini" disabled={!healAmount || Number(healAmount) <= 0} onClick={() => { if (onHeal) { onHeal(Number(healAmount)); setHealAmount(''); } }}>Heal</button>
              <button className="mini" disabled={!healAmount || Number(healAmount) <= 0} onClick={() => { if (onHeal) { onHeal(-Number(healAmount)); setHealAmount(''); } }}>Damage</button>
            </div>
          </div>

          {/* Moves section - horizontal list like PS */}
          <div style={{marginTop:6, padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6, border:'1px solid #333'}}>
            <div className="dim" style={{fontSize:'0.75em', marginBottom:4}}>Moves</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:4}}>
              {[0,1,2,3].map((idx) => {
                const move = selected.moves[idx]?.name || '';
                const moveType = selected.moves[idx]?.type || '';
                if (showdownEditMoveIndex === idx) {
                  return (
                    <div key={idx} style={{display:'flex', gap:4, alignItems:'center', gridColumn:'span 1'}}>
                      <input list={`showdown-moves-${idx}`} value={showdownMoveValue} onChange={e=>setShowdownMoveValue(e.target.value)} style={{width:'100%'}} />
                      <datalist id={`showdown-moves-${idx}`}>
                        {sortedMoves ? (
                          <>
                            {sortedMoves.legal.map((m:any)=> <option key={m.name} value={m.name} label={`✓ ${m.name}`} />)}
                            {sortedMoves.illegal.map((m:any)=> <option key={m.name} value={m.name} label={`${m.name}`} />)}
                          </>
                        ) : (
                          dex && Object.values(dex.moves).map((m:any)=> <option key={m.name} value={m.name} />)
                        )}
                      </datalist>
                      <button className="mini" onClick={commitShowdownMoveEdit}>✓</button>
                      <button className="mini" onClick={()=>{ setShowdownEditMoveIndex(null); setShowdownMoveValue(''); }}>✕</button>
                    </div>
                  );
                }
                const moveInfo = dex?.moves?.[normalizeName(move)];
                const tooltip = moveTooltip(moveInfo || { name: move, category: (selected.moves[idx] as any)?.category });
                const isSelected = moveBrowserSlot === idx;
                return (
                  <div key={idx}
                    style={{
                      padding:'4px 8px', 
                      background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.05)', 
                      borderRadius:4,
                      borderLeft:`3px solid ${TYPE_COLORS[moveType?.toLowerCase()] || '#888'}`,
                      border: isSelected ? '1px solid var(--accent-color, #6366f1)' : undefined,
                      cursor:'pointer',
                    }}
                    title={tooltip}
                    onClick={(e)=> {
                      if (e.shiftKey || e.ctrlKey) {
                        startShowdownMoveEdit(idx, move);
                      } else {
                        setMoveBrowserSlot(moveBrowserSlot === idx ? null : idx);
                        setMoveBrowserFilter('');
                      }
                    }}
                    onDoubleClick={()=> startShowdownMoveEdit(idx, move)}
                  >
                    <div style={{fontWeight:'bold', fontSize:'0.9em'}}>{move || '—'}</div>
                  </div>
                );
              })}
            </div>

            {/* Move Browser Panel - shown when a move slot is selected */}
            {moveBrowserSlot !== null && (() => {
              const currentMove = selected.moves[moveBrowserSlot];
              const currentMoveInfo = currentMove ? dex?.moves?.[normalizeName(currentMove.name)] : null;
              const filterLower = moveBrowserFilter.toLowerCase();
              const filteredMoves = filterLower
                ? detailedLegalMoves.filter((m: any) =>
                    m.name.toLowerCase().includes(filterLower) ||
                    (m.type || '').toLowerCase().includes(filterLower) ||
                    (m.learnMethod || '').toLowerCase().includes(filterLower)
                  )
                : detailedLegalMoves;

              return (
                <div style={{marginTop:6, borderTop:'1px solid #444', paddingTop:6}}>
                  {/* Selected move detail */}
                  {currentMoveInfo && (
                    <div style={{
                      padding:8, marginBottom:6, background:'rgba(99, 102, 241, 0.08)',
                      borderRadius:6, border:'1px solid rgba(99, 102, 241, 0.3)',
                    }}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                        <strong style={{fontSize:'0.95em'}}>{currentMoveInfo.name}</strong>
                        <span className="dim" style={{fontSize:'0.75em'}}>Slot {moveBrowserSlot + 1}</span>
                      </div>
                      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:4, fontSize:'0.8em'}}>
                        <span style={{
                          padding:'1px 6px', borderRadius:3, fontSize:'0.85em', fontWeight:'bold',
                          background: TYPE_COLORS[currentMoveInfo.type?.toLowerCase()] || '#888', color:'#fff',
                        }}>{currentMoveInfo.type}</span>
                        <span className="dim">{currentMoveInfo.category}</span>
                        {currentMoveInfo.basePower > 0 && <span>Power: <strong>{currentMoveInfo.basePower}</strong></span>}
                        <span>Acc: <strong>{currentMoveInfo.accuracy === true ? '—' : `${currentMoveInfo.accuracy ?? '—'}%`}</strong></span>
                        {currentMoveInfo.pp && <span>PP: <strong>{currentMoveInfo.pp}</strong></span>}
                        {currentMoveInfo.priority !== undefined && currentMoveInfo.priority !== 0 && (
                          <span>Priority: <strong>{currentMoveInfo.priority > 0 ? '+' : ''}{currentMoveInfo.priority}</strong></span>
                        )}
                      </div>
                      {currentMoveInfo.multihit && (
                        <div style={{fontSize:'0.8em', marginTop:2}}>
                          Hits: <strong>{Array.isArray(currentMoveInfo.multihit) ? `${currentMoveInfo.multihit[0]}–${currentMoveInfo.multihit[1]}` : currentMoveInfo.multihit}×</strong>
                        </div>
                      )}
                      {(currentMoveInfo.secondary || currentMoveInfo.secondaries) && (() => {
                        const sec = currentMoveInfo.secondary || (currentMoveInfo.secondaries && currentMoveInfo.secondaries[0]);
                        if (!sec) return null;
                        const parts: string[] = [];
                        if (sec.chance) parts.push(`${sec.chance}% chance`);
                        if (sec.status) parts.push(`inflict ${sec.status.toUpperCase()}`);
                        if (sec.boosts) {
                          for (const [stat, val] of Object.entries(sec.boosts)) {
                            parts.push(`${(val as number) > 0 ? '+' : ''}${val} ${stat}`);
                          }
                        }
                        if (sec.volatileStatus) parts.push(sec.volatileStatus);
                        return parts.length > 0 ? (
                          <div style={{fontSize:'0.8em', marginTop:2, color:'#f0c040'}}>Effect: {parts.join(', ')}</div>
                        ) : null;
                      })()}
                      {currentMoveInfo.drain && (
                        <div style={{fontSize:'0.8em', marginTop:2}}>Drain: {Math.round((currentMoveInfo.drain[0] / currentMoveInfo.drain[1]) * 100)}%</div>
                      )}
                      {currentMoveInfo.recoil && (
                        <div style={{fontSize:'0.8em', marginTop:2}}>Recoil: {Math.round((currentMoveInfo.recoil[0] / currentMoveInfo.recoil[1]) * 100)}%</div>
                      )}
                      {currentMoveInfo.flags?.contact && <div style={{fontSize:'0.75em', marginTop:2}} className="dim">Makes contact</div>}
                      <div style={{fontSize:'0.8em', marginTop:4, color:'#ccc'}}>{currentMoveInfo.shortDesc || currentMoveInfo.desc || ''}</div>
                    </div>
                  )}

                  {/* Search filter */}
                  <div style={{display:'flex', gap:4, alignItems:'center', marginBottom:4}}>
                    <input
                      placeholder="Search moves..."
                      value={moveBrowserFilter}
                      onChange={e => setMoveBrowserFilter(e.target.value)}
                      style={{flex:1, fontSize:'0.8em', padding:'3px 6px'}}
                    />
                    <span className="dim" style={{fontSize:'0.7em', whiteSpace:'nowrap'}}>
                      {filteredMoves.length} move{filteredMoves.length !== 1 ? 's' : ''}
                    </span>
                    <span className="dim" style={{fontSize:'0.65em'}}>Double-click slot to type</span>
                  </div>

                  {/* Move list */}
                  <div style={{maxHeight:280, overflowY:'auto', display:'grid', gap:2}}>
                    {filteredMoves.map((m: any) => {
                      const isEquipped = selected.moves.some(em => normalizeName(em.name) === normalizeName(m.name));
                      return (
                        <div
                          key={m.name}
                          style={{
                            display:'grid', gridTemplateColumns:'1fr auto', gap:4, alignItems:'start',
                            padding:'4px 6px', borderRadius:4, cursor: isEquipped ? 'default' : 'pointer',
                            background: isEquipped ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.03)',
                            borderLeft:`3px solid ${TYPE_COLORS[m.type?.toLowerCase()] || '#888'}`,
                            opacity: isEquipped ? 0.6 : 1,
                          }}
                          onClick={() => {
                            if (isEquipped) return;
                            // Replace the move in the selected slot
                            const newMoves = [...movesInput];
                            newMoves[moveBrowserSlot!] = m.name;
                            setMovesInput(newMoves);
                            if (onReplaceSelected && dex) {
                              const mapped = mapMoves(newMoves.filter(Boolean), dex.moves);
                              onReplaceSelected({ ...selected, moves: mapped } as any);
                            }
                          }}
                        >
                          <div>
                            <div style={{fontSize:'0.85em'}}>
                              <strong>{m.name}</strong>{' '}
                              <span style={{
                                padding:'0 4px', borderRadius:2, fontSize:'0.75em', fontWeight:'bold',
                                background: TYPE_COLORS[m.type?.toLowerCase()] || '#888', color:'#fff',
                              }}>{m.type}</span>{' '}
                              <span className="dim" style={{fontSize:'0.75em'}}>{m.category}</span>
                              {isEquipped && <span style={{fontSize:'0.7em', marginLeft:4, color:'var(--accent-color, #6366f1)'}}>equipped</span>}
                            </div>
                            <div className="dim" style={{fontSize:'0.75em'}}>
                              {m.basePower > 0 ? `Pow ${m.basePower}` : 'Status'}
                              {m.accuracy != null && ` · Acc ${m.accuracy === true ? '—' : m.accuracy + '%'}`}
                              {m.pp && ` · PP ${m.pp}`}
                              {m.priority !== undefined && m.priority !== 0 && ` · Pri ${m.priority > 0 ? '+' : ''}${m.priority}`}
                              {m.multihit && ` · ${Array.isArray(m.multihit) ? `${m.multihit[0]}–${m.multihit[1]}` : m.multihit}× hits`}
                            </div>
                            {(m.shortDesc || m.desc) && (
                              <div style={{fontSize:'0.73em', color:'#aaa', marginTop:1}}>{m.shortDesc || m.desc}</div>
                            )}
                          </div>
                          <div style={{fontSize:'0.7em', color:'#8b8', whiteSpace:'nowrap', textAlign:'right'}}>
                            {m.learnMethod}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {learnableMoves.length > 0 && (
            <div style={{marginTop:6, padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6, border:'1px solid #333'}}>
              <div className="dim" style={{fontSize:'0.75em', marginBottom:6}}>Learnable Moves</div>
              {learnReplaceMove && (
                <div className="dim" style={{marginBottom:6}}>
                  Select a move above to replace with <strong>{learnReplaceMove.name}</strong>.
                </div>
              )}
              <div style={{display:'grid', gap:6}}>
                {learnableMoves.map((m) => {
                  const moveInfo = dex?.moves?.[normalizeName(m.name)];
                  const tooltip = moveTooltip(moveInfo || { name: m.name });
                  return (
                    <div key={m.name} style={{border:'1px solid #555', borderRadius:6, padding:6, background:'rgba(255,255,255,0.03)'}}>
                      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                        <div title={tooltip} style={{fontWeight:'bold'}}>{m.name}</div>
                        <div className="dim">Lv {m.level}</div>
                      </div>
                      <div style={{display:'flex', gap:6, marginTop:6}}>
                        <button className="mini" onClick={() => setLearnReplaceMove(m)}>Yes</button>
                        <button className="mini" onClick={() => removeLearnableMove(m.name)}>No</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stats section - PS style with EV display */}
          <div
            style={{marginTop:6, padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6, border:'1px solid #333', cursor:'pointer'}}
            onClick={() => { setShowdownEditStats(true); }}
            title="Click to edit EVs/Nature"
          >
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <div className="dim" style={{fontSize:'0.75em'}}>Stats</div>
              <div className="dim" style={{fontSize:'0.7em'}}>EV</div>
            </div>
            <div style={{display:'grid', gap:2}}>
              {[
                { key: 'hp', label: 'HP', base: selected.baseStats.hp, real: realStats.hp, ev: (selected as any).evs?.hp || 0 },
                { key: 'atk', label: 'Atk', base: selected.baseStats.atk, real: realStats.atk, ev: (selected as any).evs?.atk || 0 },
                { key: 'def', label: 'Def', base: selected.baseStats.def, real: realStats.def, ev: (selected as any).evs?.def || 0 },
                { key: 'spa', label: 'SpA', base: (selected.baseStats as any).spAtk || (selected.baseStats as any).spa, real: realStats.spa, ev: (selected as any).evs?.spa || 0 },
                { key: 'spd', label: 'SpD', base: (selected.baseStats as any).spDef || (selected.baseStats as any).spd, real: realStats.spd, ev: (selected as any).evs?.spd || 0 },
                { key: 'spe', label: 'Spe', base: (selected.baseStats as any).spe || selected.baseStats.speed, real: realStats.spe, ev: (selected as any).evs?.spe || 0 },
              ].map(s => {
                const width = Math.min(100, (s.base / 200) * 100);
                const hue = Math.min(360, Math.floor((s.base / 255) * 180));
                return (
                  <div key={s.key} style={{display:'grid', gridTemplateColumns:'28px 24px 1fr 28px', gap:4, alignItems:'center', fontSize:'0.8em'}}>
                    <div className="dim">{s.label}</div>
                    <div style={{fontWeight:'bold'}}>{s.base}</div>
                    <div style={{height:8, background:'#333', borderRadius:2, overflow:'hidden'}}>
                      <div style={{width:`${width}%`, height:'100%', background:`hsl(${hue}, 85%, 45%)`}} />
                    </div>
                    <div className="dim" style={{textAlign:'right', fontSize:'0.85em'}}>{s.ev > 0 ? s.ev : '—'}</div>
                  </div>
                );
              })}
              <div style={{display:'grid', gridTemplateColumns:'1fr auto auto', gap:8, alignItems:'center', marginTop:4, paddingTop:4, borderTop:'1px solid #333', fontSize:'0.8em'}}>
                <div className="dim">Base Stat Total</div>
                <div style={{fontWeight:'bold'}}>{total}</div>
                <div className="dim" style={{fontSize:'0.75em'}}>Real: {realTotal}</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 4, fontSize: '0.85em' }}>
            {(() => {
              const natureName = (selected as any).nature || '';
              const nature = NATURES.find(n => n.name === natureName);
              return (
                <>
                  <span className="dim">Nature:</span>{' '}
                  <strong>
                    {natureName || '—'}
                    {nature && nature.plus && nature.minus ? ` (+${nature.plus}, -${nature.minus})` : ''}
                  </strong>
                </>
              );
            })()}
          </div>

          {showdownEditStats && (
            <div style={{ marginTop: 6, padding: 8, background:'rgba(255,255,255,0.03)', borderRadius: 6, border: '1px solid #333' }}>
              <div className="dim" style={{ fontSize: '0.75em', marginBottom: 6 }}>Edit EVs & Nature</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {(['hp','atk','def','spa','spd','spe'] as const).map(stat => (
                  <div key={stat} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 64px', gap: 8, alignItems: 'center', fontSize: '0.8em' }}>
                    <span className="dim">{stat.toUpperCase()}</span>
                    <input
                      type="range"
                      min={0}
                      max={252}
                      step={4}
                      value={(showdownEvs as any)[stat]}
                      onChange={(e) => setShowdownEvs(prev => ({ ...prev, [stat]: Math.max(0, Math.min(252, Number(e.target.value) || 0)) }))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={252}
                      value={(showdownEvs as any)[stat]}
                      onChange={(e) => setShowdownEvs(prev => ({ ...prev, [stat]: Math.max(0, Math.min(252, Number(e.target.value) || 0)) }))}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'grid', gap: 2, fontSize: '0.8em' }}>
                  <span className="dim">Nature</span>
                  <select value={showdownNature} onChange={(e)=> setShowdownNature(e.target.value)}>
                    <option value="">—</option>
                    {NATURES.map(n => (
                      <option key={n.name} value={n.name}>
                        {n.name}{n.plus && n.minus ? ` (+${n.plus}, -${n.minus})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="mini"
                  onClick={() => {
                    applyShowdownUpdate({ evs: showdownEvs, nature: showdownNature });
                    setShowdownEditStats(false);
                  }}
                >
                  ✓ Save
                </button>
                <button className="mini" onClick={() => setShowdownEditStats(false)}>✕ Cancel</button>
              </div>
            </div>
          )}

          {/* Current Ability with description */}
          <div style={{marginTop:6, padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6, border:'1px solid #333'}}>
            <div style={{fontWeight:'bold', marginBottom:2}}>{selected.ability || '—'}</div>
            {abilityDesc && <div className="dim" style={{fontSize:'0.85em'}}>{abilityDesc}</div>}
          </div>

          {/* Evolution options */}
          {evolutionOptions.length > 0 && (
            <div style={{marginTop:6, padding:8, background:'rgba(100, 200, 100, 0.1)', borderRadius:6, border:'1px solid rgba(100, 200, 100, 0.3)'}}>
              <div className="dim" style={{fontSize:'0.75em', marginBottom:4}}>Evolution</div>
              <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                {evolutionOptions.map(evo => (
                  <button
                    key={evo.id}
                    onClick={() => handleEvolve(evo)}
                    disabled={!evo.canEvolve}
                    className="mini"
                    style={{opacity: evo.canEvolve ? 1 : 0.8}}
                    title={evo.method + (evo.reason ? ` (${evo.reason})` : '')}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        marginRight: 6,
                        background: evo.status === 'green' ? '#38d66b' : evo.status === 'gray' ? '#9aa0a6' : '#e14949',
                        border: '1px solid rgba(0,0,0,0.35)',
                        verticalAlign: 'middle',
                      }}
                    />
                    → {evo.name}
                  </button>
                ))}
              </div>
              <div style={{marginTop:6, display:'grid', gap:4}}>
                {evolutionOptions.map(evo => (
                  <div key={`${evo.id}-detail`} style={{fontSize:'0.75em', color:'var(--text-dim)'}}>
                    {evo.name}: {evo.detail}{evo.reason && !evo.canEvolve ? ` - ${evo.reason}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mega Evolution toggle */}
          {dex && (()=>{
            const held = (selected as any).item as string | undefined;
            const speciesId = resolveSpeciesName();
            const { base } = speciesFormesInfo(speciesId, dex.pokedex);
            const target = eligibleMegaFormForItem(base, held, dex.pokedex);
            const nowEntry = dex.pokedex[normalizeName(speciesId)] || {};
            const nameLooksMega = /(^|[-_\s])mega(\b|[-_\s])/i.test(String(speciesId));
            const isNowMega = !!nowEntry.isMega || nameLooksMega;
            if (!target && !isNowMega) return null;
            const doToggle = async () => {
              if (!dex) return;
              const nextSpecies = isNowMega ? base : (target || base);
              const p0 = toPokemon(nextSpecies, dex.pokedex, selected.level);
              if (!p0) return;
              p0.name = selected.name;
              p0.item = (selected as any).item;
              p0.shiny = selected.shiny;
              p0.moves = selected.moves as any;
              const bp = prepareBattle(p0);
              onReplaceSelected && onReplaceSelected(withVisualState(bp, false));
            };
            return (
              <div style={{marginTop:6}}>
                <button onClick={doToggle} className="mini">
                  {isNowMega ? '◀ De-mega' : '▶ Mega Evolve'}
                </button>
                {target && !isNowMega && (
                  <span className="dim" style={{marginLeft:8, fontSize:'0.8em'}}>Using {held}</span>
                )}
              </div>
            );
          })()}
        </>
      )}

      {editMode && panelMode === 'compact' && (
        <div style={{marginTop:12}}>
          <h3><strong>Edit Pokémon</strong></h3>
          <div style={{display:'grid', gap:12}}>
            <section ref={basicsRef}>
              <h4>Basics</h4>
              <div style={{marginTop:8, display:'flex', gap:8, flexWrap:'wrap'}}>
                <button onClick={()=> { if (onAdd && selected) onAdd(selected); }} disabled={!onAdd}>&gt; Add to Team</button>
              </div>

              <div style={{display:'grid', gap:8}}>
                <label>
                  <div className="label"><strong>Species</strong></div>
                  <input list="species" value={speciesInput} onChange={e=>setSpeciesInput(e.target.value)} placeholder="e.g., Pikachu" />
                  <datalist id="species">
                    {dex && Object.values(dex.pokedex).filter((s:any)=> !s.baseSpecies || normalizeName(s.baseSpecies)===normalizeName(s.name)).map((s:any)=> <option key={s.name} value={s.name} />)}
                  </datalist>
                </label>
                <label>
                  <div className="label"><strong>Nickname</strong></div>
                  <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Optional" />
                </label>
                <label>
                  <div className="label"><strong>Level</strong></div>
                  <input type="number" min={1} max={255} value={level} onChange={e=>handleLevelChange(Number(e.target.value)||1)} />
                </label>
                <label>
                  <div className="label"><strong>Gender</strong></div>
                  <select value={(selected.gender as any) || 'N'} onChange={e=> (selected as any).gender = e.target.value as any}>
                    <option value="N">None</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8}}>
                  <input type="checkbox" checked={shinySel} onChange={e=>setShinySel(e.target.checked)} /> Shiny
                </label>
              </div>
            </section>

            <section ref={abilityRef}>
              <h4>Ability & Item</h4>
              <div style={{display:'grid', gap:8}}>
                <label>
                  <div className="label"><strong>Ability</strong> <span style={{fontSize:'0.75em',opacity:0.6}}>(type any name)</span></div>
                  <AbilityPicker
                    value={abilitySel}
                    onChange={setAbilitySel}
                    onCommit={()=>{}}
                    onCancel={()=>{}}
                    legalAbilities={abilityOpts}
                    dex={dex}
                    getLabel={getAbilityOptionLabel}
                    hideButtons
                  />
                </label>
                <label>
                  <div className="label"><strong>Item</strong></div>
                  <input list="items" value={itemSel} onChange={e=>setItemSel(e.target.value)} placeholder="Optional" />
                  <datalist id="items">
                    {dex && Object.values(dex.items).map((it:any) => <option key={it.name} value={it.name} label={getItemOptionLabel(it.name)} />)}
                  </datalist>
                </label>
              </div>
            </section>

            <div ref={mechanicsRef}><MechanicsEditor selected={selected} /></div>

            <section ref={movesRef}>
              <h4>Moves {sortedMoves && <span style={{fontSize:'0.75em',opacity:0.7}}>({sortedMoves.legal.length} legal)</span>}</h4>
              {[0,1,2,3].map((i) => {
                const mv = movesInput[i] ?? '';
                const legal = !dex || !mv ? true : (sortedMoves?.legalMoveIds ? sortedMoves.legalMoveIds.has(normalizeName(mv)) : isMoveLegalForSpecies(speciesInput || resolveSpeciesName(), mv, dex.learnsets));
                return (
                  <div key={i} style={{marginBottom:6}}>
                    <input list={`moves-${i}`} value={mv} onChange={e=>{
                      const copy = movesInput.slice();
                      while (copy.length < 4) copy.push('');
                      copy[i] = e.target.value; setMovesInput(copy);
                    }} placeholder={sortedMoves ? "Search moves (legal first)" : "Move name"} style={{borderColor: legal ? undefined : 'red', color: legal ? undefined : 'red'}} />
                    <datalist id={`moves-${i}`}>
                      {sortedMoves ? (
                        <>
                          {sortedMoves.legal.map((m:any)=> <option key={m.name} value={m.name} label={`✓ ${m.name}`} />)}
                          {sortedMoves.illegal.map((m:any)=> <option key={m.name} value={m.name} label={`${m.name}`} />)}
                        </>
                      ) : (
                        dex && Object.values(dex.moves).map((m:any)=> <option key={m.name} value={m.name} />)
                      )}
                    </datalist>
                    {!legal && <span style={{
                      marginLeft:6,
                      padding:'0 6px',
                      background:'#5a0000',
                      color:'#ffb3b3',
                      border:'1px solid #b30000',
                      borderRadius:4,
                      fontSize:'0.85em'
                    }}>Illegal</span>}
                  </div>
                );
              })}
            </section>

            {dex && (()=>{
              const held = itemSel || ((selected as any).item as string | undefined);
              const speciesId = speciesInput || resolveSpeciesName();
              const { base } = speciesFormesInfo(speciesId, dex.pokedex);
              const target = eligibleMegaFormForItem(base, held, dex.pokedex);
              const nowEntry = dex.pokedex[normalizeName(speciesId)] || {};
              const nameLooksMega = /(^|[-_\s])mega(\b|[-_\s])/i.test(String(speciesId));
              const isMegaNow = !!nowEntry.isMega || nameLooksMega;
              if (!target && !isMegaNow) return null;
              const doToggle = async () => {
                if (!dex) return;
                const nextSpecies = isMegaNow ? base : (target || base);
                const p0 = toPokemon(nextSpecies, dex.pokedex, level);
                if (!p0) return;
                p0.name = nickname || p0.name;
                p0.item = itemSel || undefined;
                p0.shiny = shinySel;
                p0.moves = mapMoves(movesInput.filter(Boolean), dex.moves);
                const bp = prepareBattle(p0);
                onReplaceSelected && onReplaceSelected(withVisualState(bp, false));
                setEditMode(false);
              };
              return (
                <section>
                  <h4>Mega Evolution</h4>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <button onClick={doToggle}>{isMegaNow ? '> De-mega' : '> Mega Evolve'}</button>
                    {target && !isMegaNow && (
                      <span className="dim">Using {held}: toggles to {target}</span>
                    )}
                  </div>
                </section>
              );
            })()}

            <section>
              <h4>Import / Export (single)</h4>
              <textarea rows={6} style={{width:'100%'}} value={importText} onChange={e=>setImportText(e.target.value)} placeholder="Paste a single Pokémon set or click Export" />
              <div style={{display:'flex', gap:8, marginTop:6}}>
                <button className="secondary" onClick={()=> setImportText(formatShowdownSet(selected))}>&gt; Export</button>
                <button className="secondary" onClick={()=>{
                  try {
                    const sets = parseShowdownTeam(importText);
                    if (!sets.length) return;
                    const s = sets[0];
                    if (!dex) return;
                    const p = toPokemon(s.species, dex.pokedex, s.level ?? level);
                    if (!p) return;
                    p.name = s.name || p.name;
                    p.species = p.species || s.species;
                    p.ability = s.ability || abilitySel;
                    (p as any).item = s.item || (selected as any).item;
                    p.moves = mapMoves(s.moves || [], dex.moves);
                    const bp = prepareBattle(p);
                    const speciesChanged = normalizeName(s.species || resolveSpeciesName()) !== normalizeName(resolveSpeciesName());
                    onReplaceSelected && onReplaceSelected(withVisualState(bp, !speciesChanged));
                  } catch {}
                }}>&gt; Import One</button>
              </div>
            </section>

            <div style={{display:'flex', gap:8, justifyContent:'space-between', marginTop:6}}>
              <div>
                {!confirmDelete ? (
                  <button className="danger" onClick={()=>setConfirmDelete(true)}>&gt; Delete…</button>
                ) : (
                  <>
                    <span className="dim">Are you sure?</span>
                    <button className="danger" onClick={()=>{ onDeleteSelected && onDeleteSelected(); setEditMode(false); setConfirmDelete(false); }}>Yes, delete</button>
                    <button onClick={()=>setConfirmDelete(false)}>Cancel</button>
                  </>
                )}
              </div>
              <div style={{display:'flex', gap:8}}>
                <button onClick={()=>{
                  if (!dex) return;
                  const p0 = toPokemon(speciesInput, dex.pokedex, level);
                  if (!p0) return;
                  p0.name = nickname || p0.name;
                  p0.species = p0.species || speciesInput;
                  p0.ability = abilitySel || p0.ability;
                  p0.item = itemSel || undefined;
                  p0.shiny = shinySel;
                  p0.gender = (selected as any).gender as any;
                  p0.nature = (selected as any).nature;
                  p0.evs = (selected as any).evs;
                  p0.ivs = (selected as any).ivs;
                  p0.moves = mapMoves(movesInput.filter(Boolean), dex.moves);
                  const bp = prepareBattle(p0);
                  const speciesChanged = normalizeName(speciesInput || resolveSpeciesName()) !== normalizeName(resolveSpeciesName());
                  onReplaceSelected && onReplaceSelected(withVisualState(bp, !speciesChanged));
                  setEditMode(false);
                }}>&gt; Save</button>
                <button className="secondary" onClick={()=>setEditMode(false)}>&gt; Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Type Effectiveness */}
  <section style={{marginTop:6, border:'1px solid #444', borderRadius:6, padding:6, background:'var(--section-bg)', flexShrink:0}}>
        <h4 style={{marginTop:0}}>Type Effectiveness</h4>
        {(() => {
          const te = computeTypeEffectiveness(selected.types);
          const icon = (t: string) => (
            <img key={t} className="pixel" src={withPublicBase(`vendor/showdown/sprites/types/${titleCase(t)}.png`)} alt={titleCase(t)} style={{height:18}} />
          );
          const renderIcons = (arr: string[], emptyText: string) => (
            arr.length ? (
              <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
                {arr.map(icon)}
              </div>
            ) : <div className="dim">{emptyText}</div>
          );
          return (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:8}}>
              <div>
                <div><strong>4x</strong></div>
                {renderIcons(te.quadWeak, 'None')}
              </div>
              <div>
                <div><strong>2x</strong></div>
                {renderIcons(te.weak, 'None')}
              </div>
              <div>
                <div><strong>1x</strong></div>
                {renderIcons(te.neutral, 'None')}
              </div>
              <div>
                <div><strong>1/2x</strong></div>
                {renderIcons(te.resist, 'None')}
              </div>
              <div>
                <div><strong>1/4x</strong></div>
                {renderIcons(te.quadResist, 'None')}
              </div>
              <div>
                <div><strong>Immune</strong></div>
                {renderIcons(te.immune, 'None')}
              </div>
            </div>
          );
        })()}
      </section>

      {!editMode && (
        <div style={{marginTop:4, display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between', alignItems:'center'}}>
          <div style={{display:'flex', gap:8}}>
            <button onClick={()=> { if (onAdd && selected) onAdd(selected); }} disabled={!onAdd}>&gt; Add to Team</button>
          </div>
          <div className="dim" style={{fontSize:'0.75em'}}>Tip: Click Stats / Ability / Moves to edit.</div>
        </div>
      )}
    </aside>
  );
}

function AddNewPanel({ onAdd }: { onAdd?: (p: BattlePokemon) => void }) {
  const [dex, setDex] = useState<any>(null);
  const [species, setSpecies] = useState('');
  // Optional cosmetic sprite variant (does not change stats); wired into sprite only
  const [cosmeticForm, setCosmeticForm] = useState<string>('');
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState(50);
  const [ability, setAbility] = useState('');
  const [item, setItem] = useState('');
  const [shiny, setShiny] = useState(false);
  const [moves, setMoves] = useState<string[]>(['', '', '', '']);
  useEffect(() => { (async ()=> setDex(await loadShowdownDex()))(); }, []);
  const abilityOptions = useMemo(() => {
    if (!dex || !species) return [] as string[];
    return speciesAbilityOptions(species, dex.pokedex);
  }, [dex, species]);
  useEffect(()=>{ if (abilityOptions.length) setAbility(abilityOptions[0]); }, [abilityOptions]);
  // Build forme list (base + otherFormes) and cosmetic list for the chosen species
  const formeOptions = useMemo(() => {
    if (!dex || !species) return [] as string[];
    const { base, otherFormes } = speciesFormesInfo(species, dex.pokedex);
    const list = [base, ...(otherFormes||[])].filter(Boolean) as string[];
    // De-dup preserving order
    return Array.from(new Set(list));
  }, [dex, species]);
  const cosmeticOptions = useMemo(() => {
    if (!dex || !species) return [] as string[];
    const { cosmeticFormes } = speciesFormesInfo(species, dex.pokedex);
    return Array.isArray(cosmeticFormes) ? cosmeticFormes : [];
  }, [dex, species]);
  // Ensure cosmetic resets when species/forme changes
  useEffect(()=>{ setCosmeticForm(''); }, [species]);
  const add = async () => {
    if (!dex) return;
    const p = toPokemon(species, dex.pokedex, level);
    if (!p) return;
    p.name = nickname.trim() || p.name;
    p.ability = ability || p.ability;
    p.item = item || undefined;
    p.shiny = shiny;
    p.moves = mapMoves(moves.filter(Boolean), dex.moves);
    if (cosmeticForm) (p as any).cosmeticForm = cosmeticForm;
    const bp = prepareBattle(p);
    onAdd && onAdd(bp);
  };
  return (
    <div style={{display:'grid', gap:12}}>
      <section>
        <h4>Basics</h4>
        <div style={{display:'grid', gap:8}}>
          <label>
            <div className="label"><strong>Species</strong></div>
            <input list="add-species" value={species} onChange={e=>setSpecies(e.target.value)} placeholder="e.g., Urshifu" />
            <datalist id="add-species">
              {dex && Object.values(dex.pokedex).map((s:any)=> <option key={s.name} value={s.name} />)}
            </datalist>
          </label>
          {dex && species && formeOptions.length > 1 && (
            <label>
              <div className="label"><strong>Forme</strong></div>
              <select value={(() => {
                const cur = species;
                const match = formeOptions.find(f => normalizeName(f) === normalizeName(cur));
                return match || formeOptions[0];
              })()}
                onChange={e=> setSpecies(e.target.value)}>
                {formeOptions.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          )}
          {dex && species && cosmeticOptions.length > 0 && (
            <label>
              <div className="label"><strong>Cosmetic</strong> <span className="dim">(sprite only)</span></div>
              <select value={cosmeticForm} onChange={e=> setCosmeticForm(e.target.value)}>
                <option value="">— None —</option>
                {cosmeticOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label>
            <div className="label"><strong>Nickname</strong></div>
            <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Optional" />
          </label>
          <label>
            <div className="label"><strong>Level</strong></div>
            <input type="number" min={1} max={255} value={level} onChange={e=>setLevel(Number(e.target.value)||1)} />
          </label>
          <label style={{display:'flex', alignItems:'center', gap:8}}>
            <input type="checkbox" checked={shiny} onChange={e=>setShiny(e.target.checked)} /> Shiny
          </label>
        </div>
      </section>
      <section>
        <h4>Ability & Item</h4>
        <div style={{display:'grid', gap:8}}>
          <label>
            <div className="label"><strong>Ability</strong></div>
            <select value={ability} onChange={e=>setAbility(e.target.value)} disabled={!species.trim()}>
              {abilityOptions.map(a => <option key={a} value={a}>{a}</option>)}
              {dex && (() => {
                const illegal = Object.values(dex.abilities).map((a:any) => a.name).sort().filter((a:string) => !abilityOptions.includes(a));
                if (!illegal.length) return null;
                return <>{[<option key="__sep" disabled>──── Other Abilities ────</option>, ...illegal.map((a:string) => <option key={`il-${a}`} value={a}>{a}</option>)]}</>;
              })()}
            </select>
          </label>
          <label>
            <div className="label"><strong>Item</strong></div>
            <input list="add-items" value={item} onChange={e=>setItem(e.target.value)} placeholder="Optional" />
            <datalist id="add-items">
              {dex && Object.values(dex.items).map((it:any) => <option key={it.name} value={it.name} label={itemOptionLabel(it.name, dex)} />)}
            </datalist>
          </label>
        </div>
      </section>
      <section>
        <h4>Moves</h4>
        {moves.map((mv, i) => {
          const legal = !dex || !mv ? true : isMoveLegalForSpecies(species, mv, dex.learnsets);
          return (
            <div key={i} style={{marginBottom:6}}>
              <input list={`add-moves-${i}`} value={mv} onChange={e=>{
                const copy = moves.slice(); copy[i] = e.target.value; setMoves(copy);
              }} placeholder="Move name" style={{borderColor: legal ? undefined : 'red', color: legal ? undefined : 'red'}} />
              <datalist id={`add-moves-${i}`}>
                {dex && Object.values(dex.moves).map((m:any)=> <option key={m.name} value={m.name} />)}
              </datalist>
              {!legal && <span style={{
                marginLeft:6,
                padding:'0 6px',
                background:'#5a0000',
                color:'#ffb3b3',
                border:'1px solid #b30000',
                borderRadius:4,
                fontSize:'0.85em'
              }}>Illegal</span>}
            </div>
          );
        })}
      </section>
      <div>
        <button onClick={add} disabled={!species.trim()}>&gt; Add to this slot</button>
      </div>
    </div>
  );
}

// === TTRPG helpers ===
function statModifierDisplay(stat: 'hp'|'atk'|'def'|'spAtk'|'spDef'|'speed', base: number): string {
  if (stat === 'atk' || stat === 'spAtk') {
    const v = base;
    const mod = v >= 200 ? 7 : v >= 150 ? 5 : v >= 120 ? 4 : v >= 100 ? 3 : v >= 80 ? 2 : v >= 60 ? 1 : 0;
    return mod ? (mod > 0 ? `+${mod}` : `${mod}`) : '—';
  } else if (stat === 'def' || stat === 'spDef') {
    const v = base;
    const mod = v >= 150 ? -4 : v >= 120 ? -3 : v >= 100 ? -2 : v >= 80 ? -1 : v >= 60 ? 0 : 1;
    return mod ? (mod > 0 ? `+${mod}` : `${mod}`) : '—';
  }
  return '—';
}

function diceFromPower(power: number): 'D20'|'D12'|'D10'|'D8'|'D6'|'D4'|null {
  if (power >= 120) return 'D20';
  if (power >= 85) return 'D12';
  if (power >= 75) return 'D10';
  if (power >= 60) return 'D8';
  if (power >= 30) return 'D6';
  if (power >= 0) return 'D4';
  return null;
}

function capitalize(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function titleCase(s: string): string { return s.split(/[\-\s]/).map(capitalize).join(' '); }

// Mechanics editor for EVs/IVs/Nature/Tera Type
function MechanicsEditor({ selected }: { selected: BattlePokemon }) {
  const natures = ['Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky'];
  const teraTypes = ['','Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
  const [nature, setNature] = useState<string>((selected as any).nature || 'Serious');
  // Default teraType to Pokemon's primary type if not set
  const defaultTera = selected.types?.[0] || 'Normal';
  const [teraType, setTeraType] = useState<string>((selected as any).teraType || defaultTera);
  const [evs, setEvs] = useState<Partial<Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe', number>>>((selected as any).evs || {});
  const [ivs, setIvs] = useState<Partial<Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe', number>>>((selected as any).ivs || {});

  const evTotal = ['hp','atk','def','spa','spd','spe'].reduce((s,k)=> s + (Math.max(0, Math.min(252, Math.floor((evs as any)[k] ?? 0))) ), 0);
  const remaining = Math.max(0, 510 - evTotal);
  const clampEV = (v:number)=> Math.max(0, Math.min(252, Math.floor(v)));
  const clampIV = (v:number)=> Math.max(0, Math.min(31, Math.floor(v)));

  useEffect(()=>{ (selected as any).nature = nature; }, [nature]);
  // If teraType is empty, use the Pokemon's primary type as default
  useEffect(()=>{ (selected as any).teraType = teraType || defaultTera; }, [teraType, defaultTera]);
  useEffect(()=>{ (selected as any).evs = evs; }, [evs]);
  useEffect(()=>{ (selected as any).ivs = ivs; }, [ivs]);

  const field = (label:string, key:'hp'|'atk'|'def'|'spa'|'spd'|'spe') => {
    const evVal = (evs as any)[key] ?? 0;
    const ivVal = (ivs as any)[key] ?? 31;
    const overCap = evVal > 252;
    return (
      <div style={{display:'grid', gridTemplateColumns:'90px minmax(140px,1fr) 70px 70px', gap:8, alignItems:'center'}}>
        <div className="label">{label}</div>
        <input type="range" min={0} max={252} step={4} value={Math.max(0, Math.min(252, evVal))}
               onChange={e=> setEvs({ ...evs, [key]: clampEV(Number(e.target.value)||0) })} title="EVs slider (0–252)" />
        <input type="number" value={evVal} onChange={e=> setEvs({ ...evs, [key]: Math.floor(Number(e.target.value)||0) })} title="EVs (can exceed cap; warns)" />
        <input type="number" min={0} max={31} value={ivVal} onChange={e=> setIvs({ ...ivs, [key]: clampIV(Number(e.target.value)||0) })} title="IVs (0–31)" />
        {overCap && <div className="dim" style={{gridColumn:'1/-1', color:'#ffb3b3'}}>Warning: EVs exceed 252 for {label}.</div>}
      </div>
    );
  };

  return (
    <section>
      <h4>Mechanics</h4>
      <div style={{display:'grid', gap:8}}>
        <label>
          <div className="label"><strong>Nature</strong></div>
          <select value={nature} onChange={e=> setNature(e.target.value)}>
            {natures.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="dim" style={{marginTop:-4}}>Nature effects are neutral for now.</div>
        <label>
          <div className="label"><strong>Tera Type</strong></div>
          <select value={teraType} onChange={e=> setTeraType(e.target.value)}>
            {teraTypes.map(t => <option key={t || 'default'} value={t}>{t || `(Default: ${defaultTera})`}</option>)}
          </select>
        </label>
        <div className="dim" style={{marginTop:-4}}>Tera Type for Terastallization. Default is the Pokemon's primary type.</div>
        <div style={{display:'grid', gridTemplateColumns:'90px minmax(140px,1fr) 70px 70px', gap:8, alignItems:'center', fontWeight:600}}>
          <div />
          <div>EVs</div>
          <div>EVs #</div>
          <div>IVs</div>
        </div>
        {field('HP', 'hp')}
        {field('Atk', 'atk')}
        {field('Def', 'def')}
        {field('SpA', 'spa')}
        {field('SpD', 'spd')}
        {field('Spe', 'spe')}
        <div className="dim">EVs total: {evTotal} / 510 • Remaining: {remaining}</div>
        {evTotal > 510 && (
          <div className="dim" style={{color:'#ffb3b3'}}>Warning: Total EVs exceed 510. Real stats will not match legal caps.</div>
        )}
      </div>
    </section>
  );
}

const TYPE_CHART: Record<string, Record<string, number>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, fairy: 0.5, ghost: 0 },
  poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
  flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ghost: { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { ghost: 2, psychic: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
  steel: { rock: 2, ice: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 },
  nuclear: { normal: 2, fire: 2, water: 2, electric: 2, grass: 2, ice: 2, fighting: 2, poison: 2, ground: 2, flying: 2, psychic: 2, bug: 2, rock: 2, ghost: 2, dragon: 2, dark: 2, fairy: 2, cosmic: 2, nuclear: 0.5, steel: 0.5 },
  cosmic: { fairy: 2, normal: 2, nuclear: 2, psychic: 0.5 },
  crystal: {},
  '???': {},
};

function computeTypeEffectiveness(defenderTypes: string[]): { quadWeak: string[]; weak: string[]; neutral: string[]; resist: string[]; quadResist: string[]; immune: string[] } {
  const TYPES = Object.keys(TYPE_CHART);
  const toId = (t: string) => normalizeName(t);
  const def = defenderTypes.map(t => toId(t));
  const quadWeak: string[] = [];
  const weak: string[] = [];
  const neutral: string[] = [];
  const resist: string[] = [];
  const quadResist: string[] = [];
  const immune: string[] = [];
  for (const atk of TYPES) {
    let mult = 1;
    for (const dt of def) {
      const m = TYPE_CHART[atk][dt];
      if (typeof m === 'number') mult *= m;
    }
    if (mult === 0) immune.push(atk);
    else if (mult === 4) quadWeak.push(atk);
    else if (mult > 1) weak.push(atk);
    else if (mult === 1) neutral.push(atk);
    else if (mult === 0.25) quadResist.push(atk);
    else if (mult < 1) resist.push(atk);
  }
  const sort = (a: string, b: string) => a.localeCompare(b);
  quadWeak.sort(sort); weak.sort(sort); neutral.sort(sort); resist.sort(sort); quadResist.sort(sort); immune.sort(sort);
  return { quadWeak, weak, neutral, resist, quadResist, immune };
}

/** No-selection view: toggle between "Add Pokémon" and "Create Fusion" */
function NoSelectionPanel({ onAddToSlot, onAdd }: {
  onAddToSlot?: (p: BattlePokemon) => void;
  onAdd: (p: BattlePokemon, teamId?: string) => void;
}) {
  const [mode, setMode] = useState<'add' | 'fuse'>('add');
  const [showSecretCreativeTriple, setShowSecretCreativeTriple] = useState(false);
  return (
    <aside className="panel side">
      <div className="side-header" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className={mode === 'add' ? 'active' : 'mini'} onClick={() => setMode('add')} style={{ fontWeight: mode === 'add' ? 700 : 400 }}>
          Add Pokémon
        </button>
        <button
          className={mode === 'fuse' ? 'active' : 'mini'}
          onClick={(e) => {
            if (e.shiftKey || e.altKey) {
              setMode('fuse');
              setShowSecretCreativeTriple(true);
              return;
            }
            setMode('fuse');
          }}
          style={{ fontWeight: mode === 'fuse' ? 700 : 400 }}
          title="Shift/Alt+Click: secret triple popup"
        >
          🔀 Create Fusion
        </button>
      </div>
      {mode === 'add' && <AddNewPanel onAdd={onAddToSlot} />}
      {mode === 'fuse' && (
        <FusionCreator
          creative
          onAdd={(p) => onAdd(p)}
          onClose={() => setMode('add')}
        />
      )}
      {showSecretCreativeTriple && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" style={{ width: 520, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Secret Creative Triple Fusion</h3>
              <button className="mini" onClick={() => setShowSecretCreativeTriple(false)}>✕</button>
            </div>
            <FusionCreator
              creative
              tripleUnlockedByDefault
              onAdd={(p) => { onAdd(p); setShowSecretCreativeTriple(false); }}
              onClose={() => setShowSecretCreativeTriple(false)}
            />
          </div>
        </div>
      )}
    </aside>
  );
}

// --- Modal to pick a team or create a new one ---
function AddToTeamModal({ selected, onPick, onClose }: { selected: BattlePokemon; onPick: (p: BattlePokemon, teamId: string) => void; onClose: ()=>void }) {
  const [state, setState] = useState(loadTeams());
  const [teamId, setTeamId] = useState(state.activeId || (state.teams[0]?.id ?? ''));
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'standard' | 'ttrpg'>('standard');
  const create = () => {
    const name = newName.trim(); if (!name) return;
    const t = createTeam(name, { type: newType }); const teams = [...state.teams, t];
    const next = { teams, activeId: t.id } as any; setState(next); saveTeams(teams, t.id); setTeamId(t.id); setNewName('');
  };
  const add = () => {
    if (!teamId) return; // must pick or create
    onPick({ ...selected }, teamId);
  };
  const team = state.teams.find(t => t.id === teamId) || null;
  const teamMax = team ? getTeamMaxSize(team) : DEFAULT_TEAM_SIZE;
  const isFull = team ? isTeamFull(team) : false;
  const displayMax = teamMax === Infinity ? '∞' : teamMax;
  const progressPct = teamMax === Infinity ? Math.min(100, (team?.members.length ?? 0) * 5) : ((team?.members.length ?? 0) / teamMax) * 100;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" style={{width:420}}>
        <h3 style={{marginTop:0}}>Add to Team</h3>
        <div style={{display:'grid', gap:8}}>
          <label>
            <div className="label"><strong>Existing Team</strong></div>
            <select value={teamId} onChange={e=> setTeamId(e.target.value)}>
              {state.teams.map(t => {
                const max = getTeamMaxSize(t);
                const full = isTeamFull(t);
                const maxStr = max === Infinity ? '∞' : max;
                const typeLabel = t.type === 'ttrpg' ? ' [TTRPG]' : '';
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.members.length}/{maxStr}{full ? ' • FULL' : ''}){typeLabel}
                  </option>
                );
              })}
            </select>
          </label>
          {team && (
            <div className="dim" style={{display:'flex', alignItems:'center', gap:8}}>
              <span style={{minWidth:52,textAlign:'right'}}>{team.members.length} / {displayMax}</span>
              <div className="hpbar mini" style={{flex:1}}>
                <span style={{width: `${Math.min(100, progressPct)}%`}} />
              </div>
              {team.type === 'ttrpg' && <span style={{color:'#6ec6ff', fontSize:'0.85em'}}>TTRPG</span>}
            </div>
          )}
          <div className="dim" style={{fontSize:'0.9em'}}>Or create a new team:</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto auto', gap:6}}>
            <input value={newName} onChange={e=> setNewName(e.target.value)} placeholder={`Team ${state.teams.length+1}`} />
            <select value={newType} onChange={e => setNewType(e.target.value as 'standard' | 'ttrpg')} style={{width:90}} title="Team type">
              <option value="standard">Standard</option>
              <option value="ttrpg">TTRPG</option>
            </select>
            <button className="secondary" onClick={create}>+ Create</button>
          </div>
          <div className="dim" style={{fontSize:'0.8em', marginTop:-4}}>
            {newType === 'ttrpg' ? 'TTRPG teams have no size limit' : 'Standard teams are limited to 6 Pokémon'}
          </div>
          {team && (
            <div style={{border:'1px solid #444', borderRadius:6, padding:6}}>
              <div className="dim" style={{marginBottom:6}}>Preview</div>
              <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', maxHeight: 200, overflowY: 'auto'}}>
                {team.members.map((m,i)=> (
                  <div key={i} style={{display:'flex', alignItems:'center', gap:6}} title={`${m.name} • Lv ${m.level}`}>
                    <img className="pixel" src={String((m as any).sprite || spriteUrl(m.species || m.name, !!(m as any).shiny, (m as any).cosmeticForm ? { cosmetic: (m as any).cosmeticForm } : undefined))} alt="" style={{width:48,height:48}}
                      onError={(e)=>{
                        const img = e.currentTarget as HTMLImageElement;
                        if (!(img as any).dataset.step) { (img as any).dataset.step = '1'; img.src = spriteUrl(m.species || m.name, !!(m as any).shiny, { setOverride: 'gen5', cosmetic: (m as any).cosmeticForm }); return; }
                        if ((img as any).dataset.step === '1') { (img as any).dataset.step = '2'; img.src = placeholderSpriteDataURL('?'); return; }
                      }}
                    />
                    <span className="dim" style={{fontSize:'0.9em'}}>{m.name}</span>
                  </div>
                ))}
                {team.members.length===0 && <span className="dim">Empty</span>}
              </div>
              {isFull && <div className="dim" style={{marginTop:6, color:'#ffb3b3'}}>Team is full ({team.members.length}/{displayMax}).</div>}
            </div>
          )}
        </div>
        <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={add} disabled={isFull} title={isFull? 'Team is full':''}>&gt; Add</button>
        </div>
      </div>
    </div>
  );
}

