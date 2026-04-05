import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  loadShowdownDex, normalizeName, toPokemon, prepareBattle, mapMoves,
  nameToDexNum, dexNumToName, fusionSpriteUrlWithFallback, buildDexNumMaps,
  speciesAbilityOptions, isMoveLegalForSpecies, placeholderSpriteDataURL,
  spriteUrlWithFallback, ensureFusionSpriteOnDemand, saveCustomFusionSprite, fetchFusionVariants, getFusionApiBases,
  IFD_CDN_BASE, cacheIfdSprite,
} from '../data/adapter';
import { SpritePainter } from './SpritePainter';
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

type FusionStatBlock = { hp:number; atk:number; def:number; spAtk:number; spDef:number; speed:number };

/**
 * Infinite Fusion stat formula (matches Autoritysama calculator):
 *   HEAD dominates: HP, Sp.Atk, Sp.Def
 *   BODY dominates: Attack, Defense, Speed
 *   Formula: floor((2 × dominant + other) / 3)
 */
function fusionStats(
  head: FusionStatBlock,
  body: FusionStatBlock,
): FusionStatBlock {
  return {
    hp:    Math.floor((2 * head.hp    + body.hp)    / 3),
    atk:   Math.floor((2 * body.atk   + head.atk)   / 3),
    def:   Math.floor((2 * body.def   + head.def)   / 3),
    spAtk: Math.floor((2 * head.spAtk + body.spAtk) / 3),
    spDef: Math.floor((2 * head.spDef + body.spDef) / 3),
    speed: Math.floor((2 * body.speed + head.speed) / 3),
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

/* ──────────────── saved fusion stat overrides ──────────────────── */

const LS_FUSION_STATS = 'ttrpg.fusionStatOverrides';

function fusionStatsKey(headNum: number, bodyNum: number): string {
  return `${headNum}.${bodyNum}`;
}

function loadFusionStatOverrides(): Record<string, FusionStatBlock> {
  try {
    const raw = localStorage.getItem(LS_FUSION_STATS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveFusionStatOverride(headNum: number, bodyNum: number, stats: FusionStatBlock) {
  const overrides = loadFusionStatOverrides();
  overrides[fusionStatsKey(headNum, bodyNum)] = stats;
  try { localStorage.setItem(LS_FUSION_STATS, JSON.stringify(overrides)); } catch {}
}

function clearFusionStatOverride(headNum: number, bodyNum: number) {
  const overrides = loadFusionStatOverrides();
  delete overrides[fusionStatsKey(headNum, bodyNum)];
  try { localStorage.setItem(LS_FUSION_STATS, JSON.stringify(overrides)); } catch {}
}

function getSavedFusionStats(headNum: number, bodyNum: number): FusionStatBlock | null {
  const overrides = loadFusionStatOverrides();
  const saved = overrides[fusionStatsKey(headNum, bodyNum)];
  if (!saved) return null;
  if (typeof saved.hp !== 'number') return null;
  return saved;
}

const REGION_DEMONYM: Record<string, string> = {
  alola: 'alolan',
  galar: 'galarian',
  hisui: 'hisuian',
  paldea: 'paldean',
};

function buildSpeciesSearchText(name: string, key?: string): string {
  const values = [name, key || ''];
  const out: string[] = [];

  for (const v of values) {
    if (!v) continue;
    out.push(v);
    out.push(v.replace(/-/g, ' '));
    out.push(normalizeName(v));
  }

  const m = name.match(/^(.+)-([^-]+)$/);
  if (m) {
    const base = m[1].replace(/-/g, ' ');
    const form = m[2].toLowerCase();
    out.push(`${base} ${form}`);
    out.push(`${form} ${base}`);
    const demonym = REGION_DEMONYM[form];
    if (demonym) {
      out.push(`${demonym} ${base}`);
      out.push(`${base} ${demonym}`);
    }
  }

  return out.join(' ');
}

/* ──────────────────────────── types ──────────────────────────────── */

/** Upload a painted fusion sprite data URL to the backend */
async function uploadFusionSpriteToBackend(headNum: number, bodyNum: number, dataUrl: string) {
  const bases = [
    localStorage.getItem('ttrpg.fusionApiBase'),
    'http://localhost:3000',
    localStorage.getItem('ttrpg.apiBase'),
    'https://pokettrpg.duckdns.org',
  ].filter(Boolean) as string[];

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/fusion/upload-sprite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headNum, bodyNum, dataUrl }),
      });
      if (res.ok) return;
    } catch { /* try next */ }
  }
}

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

function buildFusionVariantUrls(headNum: number, bodyNum: number, variants: string[]): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    if (!value) return;
    if (!out.includes(value)) out.push(value);
  };
  const apiBases = getFusionApiBases();
  for (const raw of variants) {
    const file = String(raw || '').trim();
    if (!file) continue;
    if (/^data:image\//i.test(file) || /^https?:\/\//i.test(file) || file.startsWith('/')) {
      push(file);
      continue;
    }
    for (const base of apiBases) push(`${base}/fusion/sprites/${file}`);
    push(`/fusion-sprites/${file}`);
  }
  // Always ensure at least the standard naming variants are in the list
  const stem = `${headNum}.${bodyNum}`;
  const defaultFiles = [
    `${stem}v1.png`,
    `${stem}v2.png`,
    `${stem}v3.png`,
    `${stem}.png`,
    ...Array.from({ length: 8 }, (_, i) => `${stem}${String.fromCharCode(97 + i)}.png`),
  ];
  for (const file of defaultFiles) {
    for (const base of apiBases) push(`${base}/fusion/sprites/${file}`);
    push(`/fusion-sprites/${file}`);
  }
  return out;
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
  const [dexList, setDexList] = useState<{name:string; num:number; searchText:string}[]>([]);

  // Selected Pokemon
  const [headSpecies, setHeadSpecies] = useState('');
  const [bodySpecies, setBodySpecies] = useState('');
  // For PC mode: track which slot they came from
  const [headSlot, setHeadSlot] = useState<{box:number;slot:number}|null>(null);
  const [bodySlot, setBodySlot] = useState<{box:number;slot:number}|null>(null);
  const sameParentSlot = useMemo(
    () => !!(headSlot && bodySlot && headSlot.box === bodySlot.box && headSlot.slot === bodySlot.slot),
    [headSlot, bodySlot],
  );

  // Combo choice & sprite pick
  const [chosenCombo, setChosenCombo] = useState<ComboSide>('ab');
  const [chosenSprite, setChosenSprite] = useState<string|null>(null);
  const [variantCandidates, setVariantCandidates] = useState<{ ab: string[]; ba: string[] }>({ ab: [], ba: [] });

  // Move selection (for fuse step)
  const [selectedMoves, setSelectedMoves] = useState<string[]>(['', '', '', '']);
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState(50);
  const [chosenAbility, setChosenAbility] = useState('');

  // Stat overrides — user-edited custom stats for the fusion
  const [statOverride, setStatOverride] = useState<FusionStatBlock | null>(null);

  // Search filters
  const [headSearch, setHeadSearch] = useState('');
  const [bodySearch, setBodySearch] = useState('');

  // Sprite painting state
  const [showPainter, setShowPainter] = useState(false);
  const [painterGuideline, setPainterGuideline] = useState('');
  const [painterInitialSrc, setPainterInitialSrc] = useState<string | null>(null);
  const [generationGuidance, setGenerationGuidance] = useState('');
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  // Load dex
  useEffect(() => {
    (async () => {
      const d = await loadShowdownDex();
      buildDexNumMaps(d.pokedex);
      setDex(d);
      const list: {name:string;num:number;searchText:string}[] = [];
      const seen = new Set<string>();
      for (const [key, entry] of Object.entries(d.pokedex)) {
        const e = entry as any;
        const name = String(e.name || key || '').trim();
        if (!name) continue;
        const normName = normalizeName(name);
        if (!normName || seen.has(normName)) continue;

        const num = Number(e.num);
        const isCap = normalizeName(String(e.isNonstandard || '')) === 'cap';
        if (!(num > 0 || isCap)) continue;

        seen.add(normName);
        list.push({ name, num: Number.isFinite(num) ? num : 0, searchText: buildSpeciesSearchText(name, key) });
      }
      list.sort((a, b) => {
        const aPositive = a.num > 0;
        const bPositive = b.num > 0;
        if (aPositive !== bPositive) return aPositive ? -1 : 1;
        if (aPositive && bPositive && a.num !== b.num) return a.num - b.num;
        return a.name.localeCompare(b.name);
      });
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
        searchText: buildSpeciesSearchText(p.mon.species || p.mon.name),
        mon: p.mon,
        box: p.box,
        slot: p.slot,
      }));
    }
    return dexList.map(d => ({ ...d, mon: null as BattlePokemon | null, box: -1, slot: -1 }));
  }, [mode, pcPokemon, dexList]);

  const filteredHeadList = useMemo(() => {
    const q = headSearch.trim();
    const qNorm = normalizeName(q);
    if (!qNorm && !q) return availableList;
    return availableList.filter(p =>
      normalizeName(p.name).includes(qNorm) ||
      normalizeName(p.searchText || '').includes(qNorm) ||
      (q ? String(p.num).includes(q) : false)
    );
  }, [availableList, headSearch]);

  const filteredBodyList = useMemo(() => {
    const q = bodySearch.trim();
    const qNorm = normalizeName(q);
    if (!qNorm && !q) return availableList;
    return availableList.filter(p =>
      normalizeName(p.name).includes(qNorm) ||
      normalizeName(p.searchText || '').includes(qNorm) ||
      (q ? String(p.num).includes(q) : false)
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

  // Load saved stat overrides when combo changes
  useEffect(() => {
    if (!headNum || !bodyNum) { setStatOverride(null); return; }
    const hN = chosenCombo === 'ab' ? headNum : bodyNum;
    const bN = chosenCombo === 'ab' ? bodyNum : headNum;
    const saved = getSavedFusionStats(hN, bN);
    setStatOverride(saved);
  }, [chosenCombo, headNum, bodyNum]);

  useEffect(() => {
    if (!headNum || !bodyNum) {
      setVariantCandidates({ ab: [], ba: [] });
      return;
    }

    let cancelled = false;
    Promise.all([
      fetchFusionVariants(headNum, bodyNum).catch(() => [] as string[]),
      fetchFusionVariants(bodyNum, headNum).catch(() => [] as string[]),
    ]).then(([ab, ba]) => {
      if (cancelled) return;
      setVariantCandidates({
        ab: buildFusionVariantUrls(headNum, bodyNum, ab),
        ba: buildFusionVariantUrls(bodyNum, headNum, ba),
      });
    });

    return () => { cancelled = true; };
  }, [headNum, bodyNum]);

  // Swap head ↔ body
  const handleSwap = useCallback(() => {
    setHeadSpecies(bodySpecies);
    setBodySpecies(headSpecies);
    const hs = headSlot; setHeadSlot(bodySlot); setBodySlot(hs);
  }, [headSpecies, bodySpecies, headSlot, bodySlot]);

  // Open sprite painter for the currently chosen combo
  const handleOpenPainter = useCallback((fromSrc?: string | null) => {
    const isAB = chosenCombo === 'ab';
    const hNum = isAB ? headNum : bodyNum;
    const bNum = isAB ? bodyNum : headNum;
    const hName = headPokemon?.species || headPokemon?.name || '';
    const bName = bodyPokemon?.species || bodyPokemon?.name || '';
    const comboName = isAB ? `${hName} head + ${bName} body` : `${bName} head + ${hName} body`;
    const fusName = activeCombo?.name || 'Fusion';
    const baseGuideline = `Draw a fusion sprite for ${fusName} (${comboName}). The sprite should combine visual elements from both Pokémon in a 96×96 pixel art style.`;
    const extraGuidance = generationGuidance.trim();
    setPainterGuideline(extraGuidance ? `${baseGuideline} Additional guidance: ${extraGuidance}` : baseGuideline);
    setPainterInitialSrc(fromSrc || null);
    setShowPainter(true);
  }, [chosenCombo, headNum, bodyNum, headPokemon, bodyPokemon, activeCombo, generationGuidance]);

  const handleGenerateOnWorker = useCallback(async () => {
    const isAB = chosenCombo === 'ab';
    const hNum = isAB ? headNum : bodyNum;
    const bNum = isAB ? bodyNum : headNum;
    if (!hNum || !bNum) return;

    setGenerationBusy(true);
    setGenerationStatus('Requesting worker generation…');
    try {
      const url = await ensureFusionSpriteOnDemand(hNum, bNum, {
        guidancePrompt: generationGuidance.trim() || undefined,
        onStatus: (msg) => setGenerationStatus(msg),
        regenerate: true,
      });
      if (url) {
        setChosenSprite(url);
        setGenerationStatus('Sprite generated and loaded.');
      } else {
        setGenerationStatus('Generation request failed or timed out.');
      }
    } catch {
      setGenerationStatus('Generation request failed.');
    } finally {
      setGenerationBusy(false);
    }
  }, [chosenCombo, headNum, bodyNum, generationGuidance]);

  // Accept painted sprite
  const handleAcceptPaintedSprite = useCallback((dataUrl: string) => {
    const isAB = chosenCombo === 'ab';
    const hNum = isAB ? headNum : bodyNum;
    const bNum = isAB ? bodyNum : headNum;
    // Save locally
    saveCustomFusionSprite(hNum, bNum, dataUrl);
    // Upload to backend
    uploadFusionSpriteToBackend(hNum, bNum, dataUrl);
    setChosenSprite(dataUrl);
    setShowPainter(false);
  }, [chosenCombo, headNum, bodyNum]);

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
  const handleFuse = useCallback(async () => {
    if (!dex || !activeCombo || !headPokemon || !bodyPokemon) return;
    if (mode === 'pc' && sameParentSlot) return;

    const isAB = chosenCombo === 'ab';
    const hNum = isAB ? headNum : bodyNum;
    const bNum = isAB ? bodyNum : headNum;
    const variants = await fetchFusionVariants(hNum, bNum).catch(() => [`${hNum}.${bNum}.png`]);

    const fusedPokemon: Pokemon = {
      name: nickname.trim() || activeCombo.name,
      species: activeCombo.name,
      level,
      types: activeCombo.types,
      gender: 'N',
      ability: chosenAbility || activeCombo.abilities[0] || undefined,
      shiny: false,
      baseStats: statOverride || activeCombo.stats,
      moves: mapMoves(selectedMoves.filter(Boolean), dex.moves),
      fusion: {
        headId: hNum,
        bodyId: bNum,
        headName: isAB ? (headPokemon.species || headPokemon.name) : (bodyPokemon.species || bodyPokemon.name),
        bodyName: isAB ? (bodyPokemon.species || bodyPokemon.name) : (headPokemon.species || headPokemon.name),
        spriteFile: chosenSprite || variants[0] || undefined,
        variants,
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
  }, [dex, activeCombo, headPokemon, bodyPokemon, chosenCombo, headNum, bodyNum, nickname, level, chosenAbility, selectedMoves, chosenSprite, mode, headSlot, bodySlot, sameParentSlot, onReplaceInPC, onRemoveFromPC, onAddToPC]);

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
                  headNum={headNum}
                  bodyNum={bodyNum}
                  selected={chosenCombo === 'ab'}
                  chosenSprite={chosenCombo === 'ab' ? chosenSprite : null}
                  variantCandidates={variantCandidates.ab}
                  onSelect={() => { setChosenCombo('ab'); setChosenSprite(null); }}
                  onSpriteSelect={setChosenSprite}
                />
                <FusionComboCard
                  label={`${bodyPokemon?.species || bodyPokemon?.name || '?'} head + ${headPokemon?.species || headPokemon?.name || '?'} body`}
                  preview={comboBA}
                  headNum={bodyNum}
                  bodyNum={headNum}
                  selected={chosenCombo === 'ba'}
                  chosenSprite={chosenCombo === 'ba' ? chosenSprite : null}
                  variantCandidates={variantCandidates.ba}
                  onSelect={() => { setChosenCombo('ba'); setChosenSprite(null); }}
                  onSpriteSelect={setChosenSprite}
                />
              </div>

              {/* Paint Custom Sprite section */}
              <div style={{
                display: 'grid', gap: 8,
                border: '1px solid #444', borderRadius: 8, padding: 12,
                background: 'rgba(99,102,241,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1em' }}>🎨</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9em' }}>Custom Sprite</span>
                  <span className="dim" style={{ fontSize: '0.78em' }}>— paint your own or edit an existing one</span>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="mini"
                    onClick={() => handleOpenPainter(null)}
                    style={{ padding: '6px 14px', fontSize: '0.85em' }}
                  >
                    🖌️ Paint from Scratch
                  </button>
                  <button
                    className="mini"
                    onClick={() => {
                      const combo = chosenCombo === 'ab' ? comboAB : comboBA;
                      const src = chosenSprite || combo?.spriteChain?.src || combo?.spriteChain?.candidates?.[0] || null;
                      handleOpenPainter(src);
                    }}
                    style={{ padding: '6px 14px', fontSize: '0.85em' }}
                  >
                    ✏️ Edit Current Sprite
                  </button>
                  {/* File upload option */}
                  <label
                    className="mini"
                    style={{
                      padding: '6px 14px', fontSize: '0.85em', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'var(--panel-bg-dark, #181818)', border: '1px solid #444', borderRadius: 6,
                    }}
                  >
                    📁 Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = reader.result as string;
                          handleOpenPainter(dataUrl);
                        };
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                <label style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82em' }}>Additional Guidance Prompt</div>
                  <textarea
                    value={generationGuidance}
                    onChange={e => setGenerationGuidance(e.target.value)}
                    placeholder="Optional style/details prompt for worker generation and painter guidance"
                    rows={2}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="mini"
                    onClick={handleGenerateOnWorker}
                    disabled={generationBusy}
                    style={{ padding: '6px 14px', fontSize: '0.85em' }}
                  >
                    {generationBusy ? '⏳ Generating…' : '⚙️ Generate via Worker'}
                  </button>
                  {!!generationStatus && (
                    <span className="dim" style={{ fontSize: '0.78em' }}>{generationStatus}</span>
                  )}
                </div>
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

      {/* ── Sprite Painter overlay ── */}
      {showPainter && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{ maxWidth: 700, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <SpritePainter
              initialSrc={painterInitialSrc}
              guideline={painterGuideline}
              onAccept={handleAcceptPaintedSprite}
              onCancel={() => setShowPainter(false)}
            />
          </div>
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
                <FusionSpriteImg
                  chain={activeCombo.spriteChain}
                  size={96}
                  alt={activeCombo.name}
                  overrideSrc={chosenSprite}
                  headNum={chosenCombo === 'ab' ? headNum : bodyNum}
                  bodyNum={chosenCombo === 'ab' ? bodyNum : headNum}
                />
              </div>
              <h3 style={{ margin: 0, textAlign: 'center' }}>{activeCombo.name}</h3>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                {activeCombo.types.map(t => (
                  <TypeBadge key={t} type={t} />
                ))}
              </div>
              <StatBars
                stats={statOverride || activeCombo.stats}
                editable
                onChange={setStatOverride}
                onSave={() => {
                  const hN = chosenCombo === 'ab' ? headNum : bodyNum;
                  const bN = chosenCombo === 'ab' ? bodyNum : headNum;
                  saveFusionStatOverride(hN, bN, statOverride || activeCombo.stats);
                }}
                onReset={() => {
                  const hN = chosenCombo === 'ab' ? headNum : bodyNum;
                  const bN = chosenCombo === 'ab' ? bodyNum : headNum;
                  clearFusionStatOverride(hN, bN);
                  setStatOverride(null);
                }}
                hasOverride={!!statOverride}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em' }}>
                <span className="dim">BST</span>
                <strong>{(() => { const s = statOverride || activeCombo.stats; return s.hp + s.atk + s.def + s.spAtk + s.spDef + s.speed; })()}</strong>
                {statOverride && <span style={{ fontSize: '0.75em', color: '#f59e0b' }}>✏️ Custom</span>}
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
                disabled={mode === 'pc' && sameParentSlot}
                style={{ padding: '10px 20px', fontWeight: 700, fontSize: '1.05em', borderRadius: 8, marginTop: 8 }}
              >
                🔀 {mode === 'pc' ? 'Fuse in PC' : 'Create & Add to PC'}
              </button>
              {mode === 'pc' && (
                <div className="dim" style={{ fontSize: '0.8em', textAlign: 'center' }}>
                  The head Pokémon's slot will become the fusion. The body Pokémon will be consumed.
                </div>
              )}
              {mode === 'pc' && sameParentSlot && (
                <div className="dim" style={{ fontSize: '0.8em', textAlign: 'center', color: '#ff9e9e' }}>
                  Select two different PC slots before fusing.
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
  list: { name: string; num: number; searchText?: string; mon?: BattlePokemon | null; box: number; slot: number }[];
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
      {selectedMon ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: 8,
          background: 'var(--panel-bg-dark, #111)', borderRadius: 8, border: '1px solid var(--accent, #333)',
        }}>
          <SpeciesSprite species={selectedMon.species || selectedMon.name} size={64} fallbackLabel={selectedNum > 0 ? String(selectedNum) : (selectedMon.species || selectedMon.name)} />
          <div>
            <div style={{ fontWeight: 600 }}>{selectedMon.species || selectedMon.name}</div>
            <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
              {selectedMon.types.map(t => <TypeBadge key={t} type={t} small />)}
            </div>
            <div className="dim" style={{ fontSize: '0.78em', marginTop: 2 }}>
              {selectedNum > 0 ? `#${selectedNum}` : 'Special'} · BST {selectedMon.baseStats.hp + selectedMon.baseStats.atk + selectedMon.baseStats.def + selectedMon.baseStats.spAtk + selectedMon.baseStats.spDef + selectedMon.baseStats.speed}
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
              return (
                <button
                  key={`${p.name}-${p.box}-${p.slot}-${i}`}
                  className="mini"
                  onClick={() => onSelect(p.name, p.box, p.slot)}
                  title={p.num > 0 ? `#${p.num} ${p.name}` : p.name}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: 2, fontSize: '0.65em', gap: 0, minHeight: 56,
                  }}
                >
                  <SpeciesSprite species={p.name} size={40} fallbackLabel={p.num > 0 ? String(p.num) : p.name} />
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
function FusionComboCard({ label, preview, headNum, bodyNum, selected, chosenSprite, variantCandidates, onSelect, onSpriteSelect }: {
  label: string;
  preview: FusionPreview;
  headNum: number;
  bodyNum: number;
  selected: boolean;
  chosenSprite: string | null;
  variantCandidates?: string[];
  onSelect: () => void;
  onSpriteSelect: (url: string) => void;
}) {
  const candidateUrls = variantCandidates && variantCandidates.length
    ? variantCandidates
    : preview.spriteChain.candidates;

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
          <FusionSpriteImg chain={preview.spriteChain} size={80} alt={preview.name} overrideSrc={chosenSprite} headNum={headNum} bodyNum={bodyNum} />
        </div>
        {/* Variant thumbnails */}
        {candidateUrls.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
            {candidateUrls.map((url: string, i: number) => (
              <button
                key={i}
                className="mini"
                onClick={e => {
                  e.stopPropagation();
                  onSpriteSelect(url);
                  onSelect();
                  // Auto-cache IFD CDN sprites when user selects them
                  if (url.startsWith(IFD_CDN_BASE)) cacheIfdSprite(headNum, bodyNum, url);
                }}
                style={{
                  width: 40, height: 40, padding: 2, borderRadius: 4,
                  border: chosenSprite === url ? '2px solid #22c55e' : '1px solid #444',
                  background: chosenSprite === url ? 'rgba(34,197,94,0.1)' : 'transparent',
                }}
              >
                <img src={url} alt={`Variant ${i + 1}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
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
function StatBars({ stats, editable, onChange, onSave, onReset, hasOverride }: {
  stats: FusionStatBlock;
  editable?: boolean;
  onChange?: (stats: FusionStatBlock) => void;
  onSave?: () => void;
  onReset?: () => void;
  hasOverride?: boolean;
}) {
  const rows = [
    { key: 'hp' as const, label: 'HP', value: stats.hp, color: '#ff9aa2' },
    { key: 'atk' as const, label: 'Atk', value: stats.atk, color: '#ffb347' },
    { key: 'def' as const, label: 'Def', value: stats.def, color: '#ffd56e' },
    { key: 'spAtk' as const, label: 'SpA', value: stats.spAtk, color: '#a0a6ff' },
    { key: 'spDef' as const, label: 'SpD', value: stats.spDef, color: '#b0ffd4' },
    { key: 'speed' as const, label: 'Spe', value: stats.speed, color: '#8fff8f' },
  ];
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {rows.map(s => (
        <div key={s.key} style={{ display: 'grid', gridTemplateColumns: editable ? '32px 1fr 50px' : '32px 1fr 34px', gap: 4, alignItems: 'center', fontSize: '0.8em' }}>
          <span className="dim">{s.label}</span>
          <div style={{ background: '#333', borderRadius: 3, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (s.value / 180) * 100)}%`, background: s.color, height: '100%', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          {editable && onChange ? (
            <input
              type="number"
              min={1}
              max={999}
              value={s.value}
              onChange={e => onChange({ ...stats, [s.key]: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
              style={{ width: 50, textAlign: 'right', fontWeight: 600, fontSize: '0.9em', padding: '0 2px' }}
            />
          ) : (
            <span style={{ textAlign: 'right', fontWeight: 600 }}>{s.value}</span>
          )}
        </div>
      ))}
      {editable && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 4 }}>
          {onSave && <button className="mini" onClick={onSave} style={{ fontSize: '0.75em', padding: '3px 10px' }}>💾 Save Stats</button>}
          {onReset && hasOverride && <button className="mini" onClick={onReset} style={{ fontSize: '0.75em', padding: '3px 10px' }}>↩ Reset to Formula</button>}
        </div>
      )}
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

function SpeciesSprite({ species, size, fallbackLabel }: { species: string; size: number; fallbackLabel: string }) {
  const chain = useMemo(
    () => spriteUrlWithFallback(species, () => {}, {}),
    [species],
  );
  const [src, setSrc] = useState(chain.src || chain.placeholder);
  const idxRef = useRef(0);

  useEffect(() => {
    idxRef.current = 0;
    setSrc(chain.src || chain.placeholder);
  }, [chain]);

  return (
    <img
      src={src}
      alt={species}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      onError={() => {
        idxRef.current++;
        const next = chain.candidates[idxRef.current];
        if (next) {
          setSrc(next);
          return;
        }
        setSrc(placeholderSpriteDataURL(fallbackLabel));
      }}
    />
  );
}

/** Fusion sprite image with fallback chain */
function FusionSpriteImg({ chain, size, alt, overrideSrc, headNum, bodyNum }: {
  chain: ReturnType<typeof fusionSpriteUrlWithFallback>;
  size: number;
  alt: string;
  overrideSrc?: string | null;
  headNum?: number;
  bodyNum?: number;
}) {
  const [src, setSrc] = useState(overrideSrc || chain.src || chain.placeholder);
  const idxRef = useRef(0);
  const requestedRef = useRef(false);

  useEffect(() => {
    idxRef.current = 0;
    requestedRef.current = false;
    setSrc(overrideSrc || chain.src || chain.placeholder);
  }, [chain, overrideSrc]);

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      onLoad={() => { chain.handleLoad?.(src); }}
      onError={() => {
        idxRef.current++;
        const next = chain.candidates[idxRef.current];
        if (next) {
          setSrc(next);
          return;
        }

        setSrc(chain.placeholder);

        if (!requestedRef.current && typeof headNum === 'number' && typeof bodyNum === 'number') {
          requestedRef.current = true;
          ensureFusionSpriteOnDemand(headNum, bodyNum)
            .then((url: string | null) => {
              if (url) setSrc(url);
            })
            .catch(() => {});
        }
      }}
    />
  );
}

export default FusionTab;
