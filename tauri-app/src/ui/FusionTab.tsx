import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  loadShowdownDex, normalizeName, toPokemon, prepareBattle, mapMoves,
  nameToDexNum, dexNumToName, fusionSpriteUrlWithFallback, buildDexNumMaps,
  speciesAbilityOptions, isMoveLegalForSpecies, placeholderSpriteDataURL,
  spriteUrl,
} from '../data/adapter';
import type { BattlePokemon, Pokemon, Move } from '../types';

/* ──────────────────────────── constants ──────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  normal:'#A8A878', fire:'#F08030', water:'#6890F0', electric:'#F8D030',
  grass:'#78C850', ice:'#98D8D8', fighting:'#C03028', poison:'#A040A0',
  ground:'#E0C068', flying:'#A890F0', psychic:'#F85888', bug:'#A8B820',
  rock:'#B8A038', ghost:'#705898', dragon:'#7038F8', dark:'#705848',
  steel:'#B8B8D0', fairy:'#EE99AC',
};

/* ──────────────────────────── stat helpers ───────────────────────── */

/**
 * Infinite Fusion stat formula:
 *   HP:      head HP / 3   + 2 × body HP / 3
 *   Attack:  2 × head Atk / 3 + body Atk / 3
 *   Defense: head Def / 3   + 2 × body Def / 3
 *   Sp.Atk:  2 × head SpA / 3 + body SpA / 3
 *   Sp.Def:  head SpD / 3   + 2 × body SpD / 3
 *   Speed:   (head Spe + body Spe) / 2
 */
function fusionStats(
  head: { hp:number; atk:number; def:number; spAtk:number; spDef:number; speed:number },
  body: { hp:number; atk:number; def:number; spAtk:number; spDef:number; speed:number },
) {
  return {
    hp:    Math.round(head.hp / 3 + (2 * body.hp) / 3),
    atk:   Math.round((2 * head.atk) / 3 + body.atk / 3),
    def:   Math.round(head.def / 3 + (2 * body.def) / 3),
    spAtk: Math.round((2 * head.spAtk) / 3 + body.spAtk / 3),
    spDef: Math.round(head.spDef / 3 + (2 * body.spDef) / 3),
    speed: Math.round((head.speed + body.speed) / 2),
  };
}

function fusionName(headName: string, bodyName: string): string {
  const splitH = Math.ceil(headName.length / 2);
  const splitB = Math.floor(bodyName.length / 2);
  const name = headName.slice(0, splitH) + bodyName.slice(splitB);
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function fusionTypes(headTypes: string[], bodyTypes: string[]): string[] {
  const t1 = headTypes[0];
  const t2 = bodyTypes.length > 1 ? bodyTypes[1] : bodyTypes[0];
  if (normalizeName(t1) === normalizeName(t2)) return [t1];
  return [t1, t2];
}

/* ──────────────────────────── types ──────────────────────────────── */

type FusionMode = 'pc' | 'creative';
type ComboSide = 'ab' | 'ba';
type FusionStep = 'select' | 'preview' | 'moves';

interface FusionPreview {
  name: string;
  types: string[];
  stats: { hp:number; atk:number; def:number; spAtk:number; spDef:number; speed:number };
  total: number;
  abilities: string[];
  spriteChain: ReturnType<typeof fusionSpriteUrlWithFallback>;
}

interface Props {
  onAddToPC?: (mons: BattlePokemon[]) => void;
  /** All PC boxes — needed so PC mode can list available Pokémon */
  boxes?: Array<Array<BattlePokemon | null>>;
  /** Replace a Pokémon in a specific box slot (for in-place fusion in PC mode) */
  onReplaceInPC?: (boxIdx: number, slotIdx: number, mon: BattlePokemon) => void;
  /** Remove a Pokémon from a specific box slot */
  onRemoveFromPC?: (boxIdx: number, slotIdx: number) => void;
}

/* ──────────────────────────── main component ────────────────────── */

export function FusionTab({ onAddToPC, boxes, onReplaceInPC, onRemoveFromPC }: Props) {
  const [mode, setMode] = useState<FusionMode>('pc');
  const [step, setStep] = useState<FusionStep>('select');
  const [dex, setDex] = useState<any>(null);
  const [dexList, setDexList] = useState<{name:string; num:number}[]>([]);

  // Selected Pokemon
  const [headSpecies, setHeadSpecies] = useState('');
  const [bodySpecies, setBodySpecies] = useState('');
  // For PC mode: track which slot they came from
  const [headSlot, setHeadSlot] = useState<{box:number;slot:number}|null>(null);
  const [bodySlot, setBodySlot] = useState<{box:number;slot:number}|null>(null);

  // Combo choice & sprite pick
  const [chosenCombo, setChosenCombo] = useState<ComboSide>('ab');
  const [chosenSprite, setChosenSprite] = useState<string|null>(null);

  // Move selection (for fuse step)
  const [selectedMoves, setSelectedMoves] = useState<string[]>(['', '', '', '']);
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState(50);
  const [chosenAbility, setChosenAbility] = useState('');

  // Search filters
  const [headSearch, setHeadSearch] = useState('');
  const [bodySearch, setBodySearch] = useState('');

  // Load dex
  useEffect(() => {
    (async () => {
      const d = await loadShowdownDex();
      buildDexNumMaps(d.pokedex);
      setDex(d);
      const list: {name:string;num:number}[] = [];
      for (const [, entry] of Object.entries(d.pokedex)) {
        const e = entry as any;
        if (e.num > 0 && e.num <= 1025 && !e.forme) {
          list.push({ name: e.name, num: e.num });
        }
      }
      list.sort((a, b) => a.num - b.num);
      setDexList(list);
    })();
  }, []);

  // PC Pokémon list
  const pcPokemon = useMemo(() => {
    if (!boxes) return [];
    const result: { mon: BattlePokemon; box: number; slot: number }[] = [];
    boxes.forEach((box, bi) => {
      box.forEach((p, si) => {
        if (p) {
          result.push({ mon: p, box: bi, slot: si });
        }
      });
    });
    return result;
  }, [boxes]);

  // Filtered lists for selectors
  const availableList = useMemo(() => {
    if (mode === 'pc') {
      return pcPokemon.map(p => ({
        name: p.mon.species || p.mon.name,
        num: nameToDexNum(p.mon.species || p.mon.name) || 0,
        mon: p.mon,
        box: p.box,
        slot: p.slot,
      }));
    }
    return dexList.map(d => ({ ...d, mon: null as BattlePokemon | null, box: -1, slot: -1 }));
  }, [mode, pcPokemon, dexList]);

  const filteredHeadList = useMemo(() => {
    const q = headSearch.toLowerCase().trim();
    if (!q) return availableList;
    return availableList.filter(p =>
      p.name.toLowerCase().includes(q) || String(p.num).includes(q)
    );
  }, [availableList, headSearch]);

  const filteredBodyList = useMemo(() => {
    const q = bodySearch.toLowerCase().trim();
    if (!q) return availableList;
    return availableList.filter(p =>
      p.name.toLowerCase().includes(q) || String(p.num).includes(q)
    );
  }, [availableList, bodySearch]);

  // Resolved head/body Pokemon objects
  const headPokemon = useMemo(() => {
    if (!dex || !headSpecies.trim()) return null;
    return toPokemon(headSpecies, dex.pokedex, level);
  }, [dex, headSpecies, level]);

  const bodyPokemon = useMemo(() => {
    if (!dex || !bodySpecies.trim()) return null;
    return toPokemon(bodySpecies, dex.pokedex, level);
  }, [dex, bodySpecies, level]);

  const headNum = useMemo(() => headPokemon ? nameToDexNum(headPokemon.species || headPokemon.name) || 0 : 0, [headPokemon]);
  const bodyNum = useMemo(() => bodyPokemon ? nameToDexNum(bodyPokemon.species || bodyPokemon.name) || 0 : 0, [bodyPokemon]);

  // Build fusion previews for BOTH combos
  const comboAB = useMemo<FusionPreview | null>(() => {
    if (!headPokemon || !bodyPokemon || !headNum || !bodyNum || !dex) return null;
    const stats = fusionStats(headPokemon.baseStats, bodyPokemon.baseStats);
    const types = fusionTypes(headPokemon.types, bodyPokemon.types);
    const name = fusionName(headPokemon.species || headPokemon.name, bodyPokemon.species || bodyPokemon.name);
    const total = stats.hp + stats.atk + stats.def + stats.spAtk + stats.spDef + stats.speed;
    const abilities = Array.from(new Set([
      ...speciesAbilityOptions(headSpecies, dex.pokedex),
      ...speciesAbilityOptions(bodySpecies, dex.pokedex),
    ]));
    const spriteChain = fusionSpriteUrlWithFallback(headNum, bodyNum, () => {}, {});
    return { name, types, stats, total, abilities, spriteChain };
  }, [headPokemon, bodyPokemon, headNum, bodyNum, dex, headSpecies, bodySpecies]);

  const comboBA = useMemo<FusionPreview | null>(() => {
    if (!headPokemon || !bodyPokemon || !headNum || !bodyNum || !dex) return null;
    const stats = fusionStats(bodyPokemon.baseStats, headPokemon.baseStats);
    const types = fusionTypes(bodyPokemon.types, headPokemon.types);
    const name = fusionName(bodyPokemon.species || bodyPokemon.name, headPokemon.species || headPokemon.name);
    const total = stats.hp + stats.atk + stats.def + stats.spAtk + stats.spDef + stats.speed;
    const abilities = Array.from(new Set([
      ...speciesAbilityOptions(bodySpecies, dex.pokedex),
      ...speciesAbilityOptions(headSpecies, dex.pokedex),
    ]));
    const spriteChain = fusionSpriteUrlWithFallback(bodyNum, headNum, () => {}, {});
    return { name, types, stats, total, abilities, spriteChain };
  }, [headPokemon, bodyPokemon, headNum, bodyNum, dex, headSpecies, bodySpecies]);

  const activeCombo = chosenCombo === 'ab' ? comboAB : comboBA;

  // Reset on mode/selection change
  useEffect(() => { setStep('select'); setChosenCombo('ab'); setChosenSprite(null); }, [mode]);
  useEffect(() => {
    setStep(headSpecies && bodySpecies ? 'preview' : 'select');
    setChosenSprite(null);
    setChosenCombo('ab');
  }, [headSpecies, bodySpecies]);
  useEffect(() => {
    if (activeCombo?.abilities.length) setChosenAbility(activeCombo.abilities[0]);
  }, [activeCombo]);

  // Swap head ↔ body
  const handleSwap = useCallback(() => {
    setHeadSpecies(bodySpecies);
    setBodySpecies(headSpecies);
    const hs = headSlot; setHeadSlot(bodySlot); setBodySlot(hs);
  }, [headSpecies, bodySpecies, headSlot, bodySlot]);

  // Select a Pokémon from the grid
  const selectHead = useCallback((name: string, box: number, slot: number) => {
    setHeadSpecies(name);
    setHeadSlot(box >= 0 ? { box, slot } : null);
    setHeadSearch('');
  }, []);
  const selectBody = useCallback((name: string, box: number, slot: number) => {
    setBodySpecies(name);
    setBodySlot(box >= 0 ? { box, slot } : null);
    setBodySearch('');
  }, []);

  // Handle move selection
  const availableMoves = useMemo(() => {
    if (!dex) return [] as string[];
    const allMoves = new Set<string>();
    if (headSpecies.trim() && dex.learnsets) {
      const key = normalizeName(headSpecies);
      const ls = dex.learnsets[key];
      if (ls?.learnset) Object.keys(ls.learnset).forEach(m => allMoves.add(m));
    }
    if (bodySpecies.trim() && dex.learnsets) {
      const key = normalizeName(bodySpecies);
      const ls = dex.learnsets[key];
      if (ls?.learnset) Object.keys(ls.learnset).forEach(m => allMoves.add(m));
    }
    return Array.from(allMoves).sort();
  }, [dex, headSpecies, bodySpecies]);

  // Finalize fusion
  const handleFuse = useCallback(() => {
    if (!dex || !activeCombo || !headPokemon || !bodyPokemon) return;

    const isAB = chosenCombo === 'ab';
    const hNum = isAB ? headNum : bodyNum;
    const bNum = isAB ? bodyNum : headNum;

    const fusedPokemon: Pokemon = {
      name: nickname.trim() || activeCombo.name,
      species: activeCombo.name,
      level,
      types: activeCombo.types,
      gender: 'N',
      ability: chosenAbility || activeCombo.abilities[0] || undefined,
      shiny: false,
      baseStats: activeCombo.stats,
      moves: mapMoves(selectedMoves.filter(Boolean), dex.moves),
      fusion: {
        headId: hNum,
        bodyId: bNum,
        headName: isAB ? (headPokemon.species || headPokemon.name) : (bodyPokemon.species || bodyPokemon.name),
        bodyName: isAB ? (bodyPokemon.species || bodyPokemon.name) : (headPokemon.species || headPokemon.name),
        spriteFile: chosenSprite || undefined,
      },
    };

    const bp = prepareBattle(fusedPokemon);

    if (mode === 'pc' && headSlot && bodySlot && onReplaceInPC && onRemoveFromPC) {
      // Replace head slot with fusion, remove body slot
      onReplaceInPC(headSlot.box, headSlot.slot, bp);
      onRemoveFromPC(bodySlot.box, bodySlot.slot);
    } else if (onAddToPC) {
      onAddToPC([bp]);
    }

    // Reset
    setStep('select');
    setHeadSpecies('');
    setBodySpecies('');
    setHeadSlot(null);
    setBodySlot(null);
    setChosenSprite(null);
    setSelectedMoves(['', '', '', '']);
    setNickname('');
  }, [dex, activeCombo, headPokemon, bodyPokemon, chosenCombo, headNum, bodyNum, nickname, level, chosenAbility, selectedMoves, chosenSprite, mode, headSlot, bodySlot, onReplaceInPC, onRemoveFromPC, onAddToPC]);

  // ─── Render ───

  if (!dex) return <div className="panel" style={{ padding: 24, textAlign: 'center' }}>Loading Pokédex…</div>;

  return (
    <div className="panel" style={{ display: 'grid', gap: 0, padding: 0, overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--accent, #333)' }}>
        <h2 style={{ margin: 0, fontSize: '1.2em' }}>🔀 Fusion Lab</h2>
        <div style={{ display: 'flex', gap: 4, background: 'var(--panel-bg-dark, #111)', borderRadius: 8, padding: 2 }}>
          <button
            className={mode === 'pc' ? 'active' : 'mini'}
            onClick={() => setMode('pc')}
            style={{ borderRadius: 6, padding: '6px 14px', fontSize: '0.85em' }}
          >
            📦 PC Mode
          </button>
          <button
            className={mode === 'creative' ? 'active' : 'mini'}
            onClick={() => setMode('creative')}
            style={{ borderRadius: 6, padding: '6px 14px', fontSize: '0.85em' }}
          >
            🎨 Creative Mode
          </button>
        </div>
      </div>

      {mode === 'pc' && pcPokemon.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
          No Pokémon in your PC boxes yet. Add some from the PC tab first, or switch to Creative Mode to fuse any Pokémon.
        </div>
      )}

      {/* ── Step 1: Selection ── */}
      {(step === 'select' || step === 'preview') && (
        <div style={{ display: 'grid', gap: 12, padding: 16 }}>

          {/* Head & Body pickers side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'start' }}>
            {/* Head picker */}
            <PokemonPicker
              label="Head"
              sublabel="offensive stats"
              selected={headSpecies}
              search={headSearch}
              onSearch={setHeadSearch}
              list={filteredHeadList}
              onSelect={(name, box, slot) => selectHead(name, box, slot)}
              dex={dex}
            />

            {/* Swap button */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 32 }}>
              <button
                className="mini"
                onClick={handleSwap}
                title="Swap head ↔ body"
                style={{ fontSize: '1.3em', padding: '6px 10px', borderRadius: '50%' }}
                disabled={!headSpecies || !bodySpecies}
              >
                ⇄
              </button>
            </div>

            {/* Body picker */}
            <PokemonPicker
              label="Body"
              sublabel="defensive stats"
              selected={bodySpecies}
              search={bodySearch}
              onSearch={setBodySearch}
              list={filteredBodyList}
              onSelect={(name, box, slot) => selectBody(name, box, slot)}
              dex={dex}
            />
          </div>

          {/* ── Step 2: Preview both combos ── */}
          {step === 'preview' && comboAB && comboBA && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ textAlign: 'center', fontSize: '0.85em', color: '#aaa' }}>
                Choose a fusion combo — each direction produces different stats & sprites
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FusionComboCard
                  label={`${headPokemon?.species || headPokemon?.name || '?'} head + ${bodyPokemon?.species || bodyPokemon?.name || '?'} body`}
                  preview={comboAB}
                  selected={chosenCombo === 'ab'}
                  chosenSprite={chosenCombo === 'ab' ? chosenSprite : null}
                  onSelect={() => { setChosenCombo('ab'); setChosenSprite(null); }}
                  onSpriteSelect={setChosenSprite}
                />
                <FusionComboCard
                  label={`${bodyPokemon?.species || bodyPokemon?.name || '?'} head + ${headPokemon?.species || headPokemon?.name || '?'} body`}
                  preview={comboBA}
                  selected={chosenCombo === 'ba'}
                  chosenSprite={chosenCombo === 'ba' ? chosenSprite : null}
                  onSelect={() => { setChosenCombo('ba'); setChosenSprite(null); }}
                  onSpriteSelect={setChosenSprite}
                />
              </div>

              {/* Proceed to moves */}
              <button
                onClick={() => setStep('moves')}
                disabled={!activeCombo}
                style={{ padding: '10px 20px', fontWeight: 600, fontSize: '1em', borderRadius: 8, margin: '0 auto' }}
              >
                Choose Moves & Finalize →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Move selection & finalize ── */}
      {step === 'moves' && activeCombo && (
        <div style={{ display: 'grid', gap: 12, padding: 16 }}>
          <button className="mini" onClick={() => setStep('preview')} style={{ justifySelf: 'start' }}>← Back to Preview</button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Left: fusion summary */}
            <div style={{ border: '1px solid #444', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <FusionSpriteImg chain={activeCombo.spriteChain} size={96} alt={activeCombo.name} overrideSrc={chosenSprite} />
              </div>
              <h3 style={{ margin: 0, textAlign: 'center' }}>{activeCombo.name}</h3>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                {activeCombo.types.map(t => (
                  <TypeBadge key={t} type={t} />
                ))}
              </div>
              <StatBars stats={activeCombo.stats} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em' }}>
                <span className="dim">BST</span>
                <strong>{activeCombo.total}</strong>
              </div>
            </div>

            {/* Right: options */}
            <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
              <label>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Nickname</div>
                <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={activeCombo.name} style={{ width: '100%' }} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Level</div>
                  <input type="number" min={1} max={100} value={level} onChange={e => setLevel(Number(e.target.value) || 1)} style={{ width: '100%' }} />
                </label>
                <label>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Ability</div>
                  <select value={chosenAbility} onChange={e => setChosenAbility(e.target.value)} style={{ width: '100%' }}>
                    {activeCombo.abilities.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Moves <span className="dim" style={{ fontWeight: 400, fontSize: '0.85em' }}>(from either parent)</span></div>
                {selectedMoves.map((mv, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <input
                      list={`fusion-mv-${i}`}
                      value={mv}
                      onChange={e => { const c = selectedMoves.slice(); c[i] = e.target.value; setSelectedMoves(c); }}
                      placeholder={`Move ${i + 1}`}
                      style={{ width: '100%' }}
                    />
                    <datalist id={`fusion-mv-${i}`}>
                      {availableMoves.map(m => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                ))}
              </div>

              <button
                onClick={handleFuse}
                style={{ padding: '10px 20px', fontWeight: 700, fontSize: '1.05em', borderRadius: 8, marginTop: 8 }}
              >
                🔀 {mode === 'pc' ? 'Fuse in PC' : 'Create & Add to PC'}
              </button>
              {mode === 'pc' && (
                <div className="dim" style={{ fontSize: '0.8em', textAlign: 'center' }}>
                  The head Pokémon's slot will become the fusion. The body Pokémon will be consumed.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Sub-components                                                  */
/* ══════════════════════════════════════════════════════════════════ */

/** Pick a Pokémon from a scrollable grid */
function PokemonPicker({ label, sublabel, selected, search, onSearch, list, onSelect, dex }: {
  label: string;
  sublabel: string;
  selected: string;
  search: string;
  onSearch: (v: string) => void;
  list: { name: string; num: number; mon?: BattlePokemon | null; box: number; slot: number }[];
  onSelect: (name: string, box: number, slot: number) => void;
  dex: any;
}) {
  const selectedMon = useMemo(() => {
    if (!selected || !dex) return null;
    return toPokemon(selected, dex.pokedex, 50);
  }, [selected, dex]);

  const selectedNum = selectedMon ? nameToDexNum(selectedMon.species || selectedMon.name) || 0 : 0;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: '0.95em' }}>{label} <span className="dim" style={{ fontWeight: 400, fontSize: '0.85em' }}>({sublabel})</span></div>

      {/* Selected preview */}
      {selectedMon && selectedNum > 0 ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: 8,
          background: 'var(--panel-bg-dark, #111)', borderRadius: 8, border: '1px solid var(--accent, #333)',
        }}>
          <img
            src={spriteUrl(selectedMon.species || selectedMon.name)}
            alt={selectedMon.species || selectedMon.name}
            style={{ width: 64, height: 64, imageRendering: 'pixelated' }}
            onError={e => { (e.target as HTMLImageElement).src = placeholderSpriteDataURL(String(selectedNum)); }}
          />
          <div>
            <div style={{ fontWeight: 600 }}>{selectedMon.species || selectedMon.name}</div>
            <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
              {selectedMon.types.map(t => <TypeBadge key={t} type={t} small />)}
            </div>
            <div className="dim" style={{ fontSize: '0.78em', marginTop: 2 }}>
              #{selectedNum} · BST {selectedMon.baseStats.hp + selectedMon.baseStats.atk + selectedMon.baseStats.def + selectedMon.baseStats.spAtk + selectedMon.baseStats.spDef + selectedMon.baseStats.speed}
            </div>
          </div>
          <button className="mini" onClick={() => onSelect('', -1, -1)} style={{ marginLeft: 'auto', fontSize: '0.8em' }}>✕</button>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search by name or #…"
            style={{ width: '100%', padding: '6px 10px' }}
          />
          <div style={{
            maxHeight: 200, overflowY: 'auto', display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 4,
            background: 'var(--panel-bg-dark, #111)', borderRadius: 8, padding: 6,
            border: '1px solid var(--accent, #333)',
          }}>
            {list.slice(0, 150).map((p, i) => {
              const sUrl = spriteUrl(p.name);
              return (
                <button
                  key={`${p.name}-${p.box}-${p.slot}-${i}`}
                  className="mini"
                  onClick={() => onSelect(p.name, p.box, p.slot)}
                  title={`#${p.num} ${p.name}`}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: 2, fontSize: '0.65em', gap: 0, minHeight: 56,
                  }}
                >
                  <img
                    src={sUrl}
                    alt={p.name}
                    style={{ width: 40, height: 40, imageRendering: 'pixelated' }}
                    onError={e => { (e.target as HTMLImageElement).src = placeholderSpriteDataURL(String(p.num)); }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 52, whiteSpace: 'nowrap' }}>{p.name}</span>
                </button>
              );
            })}
            {list.length > 150 && <div className="dim" style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: '0.75em', padding: 4 }}>Showing first 150 — type to search</div>}
            {list.length === 0 && <div className="dim" style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: '0.8em', padding: 8 }}>No matches</div>}
          </div>
        </>
      )}
    </div>
  );
}

/** One side of the combo comparison */
function FusionComboCard({ label, preview, selected, chosenSprite, onSelect, onSpriteSelect }: {
  label: string;
  preview: FusionPreview;
  selected: boolean;
  chosenSprite: string | null;
  onSelect: () => void;
  onSpriteSelect: (url: string) => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        border: selected ? '2px solid #6366f1' : '1px solid #444',
        borderRadius: 10,
        padding: 12,
        cursor: 'pointer',
        background: selected ? 'rgba(99,102,241,0.08)' : 'transparent',
        display: 'grid',
        gap: 8,
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: '0.78em', color: '#888', textAlign: 'center' }}>{label}</div>

      {/* Fusion name + types */}
      <div style={{ textAlign: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1.1em' }}>{preview.name}</h3>
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center', marginTop: 4 }}>
          {preview.types.map(t => <TypeBadge key={t} type={t} />)}
        </div>
      </div>

      {/* Main sprite + variants */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{
          display: 'flex', justifyContent: 'center', padding: 8,
          background: 'linear-gradient(135deg, #16213e 0%, #0f172a 100%)', borderRadius: 8,
        }}>
          <FusionSpriteImg chain={preview.spriteChain} size={80} alt={preview.name} overrideSrc={chosenSprite} />
        </div>
        {/* Variant thumbnails */}
        {preview.spriteChain.candidates.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
            {preview.spriteChain.candidates.slice(0, 8).map((url, i) => (
              <button
                key={i}
                className="mini"
                onClick={e => { e.stopPropagation(); onSpriteSelect(url); onSelect(); }}
                style={{
                  width: 40, height: 40, padding: 2, borderRadius: 4,
                  border: chosenSprite === url ? '2px solid #22c55e' : '1px solid #444',
                  background: chosenSprite === url ? 'rgba(34,197,94,0.1)' : 'transparent',
                }}
              >
                <img src={url} alt={`Variant ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <StatBars stats={preview.stats} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82em' }}>
        <span className="dim">BST</span>
        <strong>{preview.total}</strong>
      </div>

      {/* Abilities */}
      <div>
        <div className="dim" style={{ fontSize: '0.75em', marginBottom: 2 }}>Abilities</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {preview.abilities.map(a => (
            <span key={a} style={{
              padding: '1px 6px', borderRadius: 4, fontSize: '0.72em',
              background: 'rgba(255,255,255,0.08)', border: '1px solid #444',
            }}>{a}</span>
          ))}
        </div>
      </div>

      {selected && <div style={{ textAlign: 'center', color: '#6366f1', fontWeight: 600, fontSize: '0.85em' }}>✓ Selected</div>}
    </div>
  );
}

/** Stat bars */
function StatBars({ stats }: { stats: { hp:number; atk:number; def:number; spAtk:number; spDef:number; speed:number } }) {
  const rows = [
    { key: 'hp', label: 'HP', value: stats.hp, color: '#ff9aa2' },
    { key: 'atk', label: 'Atk', value: stats.atk, color: '#ffb347' },
    { key: 'def', label: 'Def', value: stats.def, color: '#ffd56e' },
    { key: 'spAtk', label: 'SpA', value: stats.spAtk, color: '#a0a6ff' },
    { key: 'spDef', label: 'SpD', value: stats.spDef, color: '#b0ffd4' },
    { key: 'speed', label: 'Spe', value: stats.speed, color: '#8fff8f' },
  ];
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {rows.map(s => (
        <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 34px', gap: 4, alignItems: 'center', fontSize: '0.8em' }}>
          <span className="dim">{s.label}</span>
          <div style={{ background: '#333', borderRadius: 3, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (s.value / 180) * 100)}%`, background: s.color, height: '100%', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          <span style={{ textAlign: 'right', fontWeight: 600 }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Type badge */
function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  return (
    <span style={{
      padding: small ? '0px 4px' : '1px 6px',
      borderRadius: 3,
      fontSize: small ? '0.65em' : '0.72em',
      fontWeight: 'bold',
      color: '#fff',
      background: TYPE_COLORS[type.toLowerCase()] || '#888',
    }}>{type}</span>
  );
}

/** Fusion sprite image with fallback chain */
function FusionSpriteImg({ chain, size, alt, overrideSrc }: {
  chain: ReturnType<typeof fusionSpriteUrlWithFallback>;
  size: number;
  alt: string;
  overrideSrc?: string | null;
}) {
  const [src, setSrc] = useState(overrideSrc || chain.src || chain.placeholder);
  const idxRef = useRef(0);

  useEffect(() => {
    idxRef.current = 0;
    setSrc(overrideSrc || chain.src || chain.placeholder);
  }, [chain, overrideSrc]);

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      onError={() => {
        idxRef.current++;
        setSrc(chain.candidates[idxRef.current] || chain.placeholder);
      }}
    />
  );
}

export default FusionTab;
