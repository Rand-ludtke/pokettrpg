import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadShowdownDex, normalizeName, toPokemon, prepareBattle, mapMoves,
  nameToDexNum, dexNumToName, fusionSpriteUrlWithFallback,
  speciesAbilityOptions, isMoveLegalForSpecies, buildDexNumMaps, fetchFusionVariants,
  placeholderSpriteDataURL,
} from '../data/adapter';
import type { BattlePokemon, Pokemon } from '../types';

/**
 * Infinite Fusion stat calculation formula:
 *   HEAD dominates: HP, Sp.Atk, Sp.Def
 *   BODY dominates: Attack, Defense, Speed
 *   Formula: floor((2 × dominant + other) / 3)
 */
function fusionStats(
  head: { hp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number },
  body: { hp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number },
) {
  return {
    hp:    Math.floor((2 * head.hp    + body.hp)    / 3),
    atk:   Math.floor((2 * body.atk   + head.atk)   / 3),
    def:   Math.floor((2 * body.def   + head.def)   / 3),
    spAtk: Math.floor((2 * head.spAtk + body.spAtk) / 3),
    spDef: Math.floor((2 * head.spDef + body.spDef) / 3),
    speed: Math.floor((2 * body.speed + head.speed) / 3),
  };
}

/** Generate a fusion name: first half of head + second half of body */
function fusionName(headName: string, bodyName: string): string {
  const splitH = Math.ceil(headName.length / 2);
  const splitB = Math.floor(bodyName.length / 2);
  const name = headName.slice(0, splitH) + bodyName.slice(splitB);
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** Merge types: type1 from head, type2 from body (dedup) */
function fusionTypes(headTypes: string[], bodyTypes: string[]): string[] {
  const t1 = headTypes[0];
  const t2 = bodyTypes.length > 1 ? bodyTypes[1] : bodyTypes[0];
  if (normalizeName(t1) === normalizeName(t2)) return [t1];
  return [t1, t2];
}

function normalizeBase(base?: string): string {
  const clean = String(base || '').trim();
  return clean.replace(/\/+$/, '');
}

function tripleVariantPath(head: number, body: number, third: number, variant: number, base?: string): string {
  const prefix = normalizeBase(base);
  const root = prefix ? `${prefix}/triple-fusions` : '/triple-fusions';
  return `${root}/${head}.${body}.${third}.v${variant}.png`;
}

function tripleSpriteCandidates(head: number, body: number, third: number, base?: string): string[] {
  const perms: Array<[number, number, number]> = [
    [head, body, third],
    [head, third, body],
    [body, head, third],
    [body, third, head],
    [third, head, body],
    [third, body, head],
  ];
  const out: string[] = [];
  for (const [a, b, c] of perms) {
    for (let v = 1; v <= 3; v++) {
      out.push(tripleVariantPath(a, b, c, v, base));
    }
  }
  return Array.from(new Set(out));
}

const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030',
  grass: '#78C850', ice: '#98D8D8', fighting: '#C03028', poison: '#A040A0',
  ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848',
  steel: '#B8B8D0', fairy: '#EE99AC',
  nuclear: '#92D050', cosmic: '#6B2FA0',
};

interface FusionCreatorProps {
  /** Pre-selected head species name */
  initialHead?: string;
  /** Pre-selected body species name */
  initialBody?: string;
  /** Pre-select third Pokemon for triple fusions (hidden feature) */
  initialThird?: string;
  /** Called when a fusion is created — adds to PC */
  onAdd: (p: BattlePokemon) => void;
  /** Close/cancel callback */
  onClose?: () => void;
  /** Creative mode: allows ANY two Pokemon (or three) */
  creative?: boolean;
  /** Optional allow-list for 3rd fusion species (used for PC-gated flows) */
  allowedThirdSpecies?: string[];
  /** Enable triple fusion without unlocking gesture */
  tripleUnlockedByDefault?: boolean;
  /** Base URL for fusion sprites (RPi backend, etc.) */
  spriteBase?: string;
}

export function FusionCreator({
  initialHead,
  initialBody,
  initialThird,
  onAdd,
  onClose,
  creative = false,
  allowedThirdSpecies,
  tripleUnlockedByDefault = false,
  spriteBase = '',
}: FusionCreatorProps) {
  const [dex, setDex] = useState<any>(null);
  const [headSpecies, setHeadSpecies] = useState(initialHead || '');
  const [bodySpecies, setBodySpecies] = useState(initialBody || '');
  const [thirdSpecies, setThirdSpecies] = useState(initialThird || '');
  const [showTriple, setShowTriple] = useState(!!initialThird);
  const [tripleUnlockClicks, setTripleUnlockClicks] = useState(0);
  const [tripleUnlocked, setTripleUnlocked] = useState(!!initialThird || tripleUnlockedByDefault);
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState(50);
  const [shiny, setShiny] = useState(false);
  const [selectedTripleSprite, setSelectedTripleSprite] = useState('');

  const normalizedAllowedThird = useMemo(() => {
    if (!allowedThirdSpecies?.length) return null;
    return new Set(allowedThirdSpecies.map(s => normalizeName(s)).filter(Boolean));
  }, [allowedThirdSpecies]);

  useEffect(() => {
    (async () => {
      const d = await loadShowdownDex();
      buildDexNumMaps(d.pokedex);
      setDex(d);
    })();
  }, []);

  // Resolve head/body/third Pokemon
  const headPokemon = useMemo(() => {
    if (!dex || !headSpecies.trim()) return null;
    return toPokemon(headSpecies, dex.pokedex, level);
  }, [dex, headSpecies, level]);

  const bodyPokemon = useMemo(() => {
    if (!dex || !bodySpecies.trim()) return null;
    return toPokemon(bodySpecies, dex.pokedex, level);
  }, [dex, bodySpecies, level]);

  const thirdPokemon = useMemo(() => {
    if (!dex || !thirdSpecies.trim() || !showTriple) return null;
    if (!creative && normalizedAllowedThird && !normalizedAllowedThird.has(normalizeName(thirdSpecies))) return null;
    return toPokemon(thirdSpecies, dex.pokedex, level);
  }, [dex, thirdSpecies, level, showTriple, creative, normalizedAllowedThird]);

  // Dex numbers
  const headNum = useMemo(() => headPokemon ? nameToDexNum(headPokemon.species || headPokemon.name) || 0 : 0, [headPokemon]);
  const bodyNum = useMemo(() => bodyPokemon ? nameToDexNum(bodyPokemon.species || bodyPokemon.name) || 0 : 0, [bodyPokemon]);
  const thirdNum = useMemo(() => thirdPokemon ? nameToDexNum(thirdPokemon.species || thirdPokemon.name) || 0 : 0, [thirdPokemon]);

  const thirdSpeciesOptions = useMemo(() => {
    if (!dex) return [] as string[];
    if (!creative && normalizedAllowedThird) {
      return Object.values(dex.pokedex)
        .map((s: any) => s.name as string)
        .filter((n: string) => normalizedAllowedThird.has(normalizeName(n)));
    }
    return Object.values(dex.pokedex).map((s: any) => s.name as string);
  }, [dex, creative, normalizedAllowedThird]);

  const triplePrimaryVariants = useMemo(() => {
    if (!showTriple || !headNum || !bodyNum || !thirdNum) return [] as string[];
    return [1, 2, 3].map(v => tripleVariantPath(headNum, bodyNum, thirdNum, v, spriteBase));
  }, [showTriple, headNum, bodyNum, thirdNum, spriteBase]);

  const tripleAllCandidates = useMemo(() => {
    if (!showTriple || !headNum || !bodyNum || !thirdNum) return [] as string[];
    return tripleSpriteCandidates(headNum, bodyNum, thirdNum, spriteBase);
  }, [showTriple, headNum, bodyNum, thirdNum, spriteBase]);

  useEffect(() => {
    if (!showTriple || !headNum || !bodyNum || !thirdNum) {
      setSelectedTripleSprite('');
      return;
    }
    setSelectedTripleSprite(prev => prev || triplePrimaryVariants[0] || tripleAllCandidates[0] || '');
  }, [showTriple, headNum, bodyNum, thirdNum, triplePrimaryVariants, tripleAllCandidates]);

  // Fusion preview
  const fusionPreview = useMemo(() => {
    if (!headPokemon || !bodyPokemon) return null;
    let stats = fusionStats(headPokemon.baseStats, bodyPokemon.baseStats);
    let types = fusionTypes(headPokemon.types, bodyPokemon.types);
    let name = fusionName(headPokemon.species || headPokemon.name, bodyPokemon.species || bodyPokemon.name);

    // Triple fusion: average in the third Pokemon's stats
    if (thirdPokemon) {
      const thStats = thirdPokemon.baseStats;
      stats = {
        hp:    Math.round((stats.hp * 2 + thStats.hp) / 3),
        atk:   Math.round((stats.atk * 2 + thStats.atk) / 3),
        def:   Math.round((stats.def * 2 + thStats.def) / 3),
        spAtk: Math.round((stats.spAtk * 2 + thStats.spAtk) / 3),
        spDef: Math.round((stats.spDef * 2 + thStats.spDef) / 3),
        speed: Math.round((stats.speed * 2 + thStats.speed) / 3),
      };
      // Triple name: first of head + middle of third + end of body
      const thName = thirdPokemon.species || thirdPokemon.name;
      const mid = thName.slice(Math.floor(thName.length / 3), Math.ceil(2 * thName.length / 3));
      name = name.slice(0, Math.ceil(name.length / 2)) + mid.toLowerCase() + name.slice(Math.ceil(name.length / 2));
      // Add third Pokemon's primary type if not already present
      const t3 = thirdPokemon.types[0];
      if (t3 && !types.map(t => normalizeName(t)).includes(normalizeName(t3))) {
        types = types.slice(0, 2); // still 2 types max but might swap type2
      }
    }

    const total = stats.hp + stats.atk + stats.def + stats.spAtk + stats.spDef + stats.speed;
    return { stats, types, name, total };
  }, [headPokemon, bodyPokemon, thirdPokemon]);

  // Ability options from all parents
  const abilityOptions = useMemo(() => {
    if (!dex) return [] as string[];
    const hAbils = headSpecies.trim() ? speciesAbilityOptions(headSpecies, dex.pokedex) : [];
    const bAbils = bodySpecies.trim() ? speciesAbilityOptions(bodySpecies, dex.pokedex) : [];
    const tAbils = thirdSpecies.trim() && showTriple ? speciesAbilityOptions(thirdSpecies, dex.pokedex) : [];
    return Array.from(new Set([...hAbils, ...bAbils, ...tAbils]));
  }, [dex, headSpecies, bodySpecies, thirdSpecies, showTriple]);

  const [ability, setAbility] = useState('');
  useEffect(() => { if (abilityOptions.length) setAbility(abilityOptions[0]); }, [abilityOptions]);

  const [moves, setMoves] = useState<string[]>(['', '', '', '']);

  const handleSwap = () => {
    setHeadSpecies(bodySpecies);
    setBodySpecies(headSpecies);
  };

  const isTripleActive = !!(showTriple && thirdPokemon && thirdNum);

  // Standard (2-way) fusion sprite preview
  const twoWaySpritePreview = useMemo(() => {
    if (!headNum || !bodyNum) return null;
    return fusionSpriteUrlWithFallback(headNum, bodyNum, () => {}, { base: spriteBase });
  }, [headNum, bodyNum, spriteBase]);

  // Create fusion
  const handleCreate = useCallback(async () => {
    if (!dex || !headPokemon || !bodyPokemon || !fusionPreview || !headNum || !bodyNum) return;
    if (showTriple && !thirdPokemon) return;
    const variants = thirdPokemon ? tripleAllCandidates : await fetchFusionVariants(headNum, bodyNum).catch(() => [`${headNum}.${bodyNum}.png`]);

    const fusedPokemon: Pokemon = {
      name: nickname.trim() || fusionPreview.name,
      species: fusionPreview.name,
      level,
      types: fusionPreview.types,
      gender: 'N',
      ability: ability || abilityOptions[0] || undefined,
      shiny,
      baseStats: fusionPreview.stats,
      moves: mapMoves(moves.filter(Boolean), dex.moves),
      fusion: {
        headId: headNum,
        bodyId: bodyNum,
        headName: headPokemon.species || headPokemon.name,
        bodyName: bodyPokemon.species || bodyPokemon.name,
        variants,
        ...(thirdPokemon ? {
          thirdId: thirdNum,
          thirdName: thirdPokemon.species || thirdPokemon.name,
          triple: true,
          spriteFile: selectedTripleSprite || triplePrimaryVariants[0] || tripleAllCandidates[0] || undefined,
        } : {}),
      },
    };

    const bp = prepareBattle(fusedPokemon);
    onAdd(bp);
    onClose?.();
  }, [dex, headPokemon, bodyPokemon, fusionPreview, headNum, bodyNum, showTriple, thirdPokemon, thirdNum, nickname, level, ability, shiny, moves, abilityOptions, onAdd, onClose, selectedTripleSprite, triplePrimaryVariants, tripleAllCandidates]);

  const statRows = fusionPreview ? [
    { key: 'hp', label: 'HP', value: fusionPreview.stats.hp, color: '#ff9aa2' },
    { key: 'atk', label: 'Atk', value: fusionPreview.stats.atk, color: '#ffb347' },
    { key: 'def', label: 'Def', value: fusionPreview.stats.def, color: '#ffd56e' },
    { key: 'spAtk', label: 'SpA', value: fusionPreview.stats.spAtk, color: '#a0a6ff' },
    { key: 'spDef', label: 'SpD', value: fusionPreview.stats.spDef, color: '#b0ffd4' },
    { key: 'speed', label: 'Spe', value: fusionPreview.stats.speed, color: '#8fff8f' },
  ] : [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3
          style={{ margin: 0, cursor: 'pointer', userSelect: 'none' }}
          title={tripleUnlocked ? 'Triple fusion unlocked' : 'Secret: click title 5x to unlock triple fusion'}
          onClick={() => {
            if (tripleUnlocked) return;
            const next = tripleUnlockClicks + 1;
            setTripleUnlockClicks(next);
            if (next >= 5) setTripleUnlocked(true);
          }}
        >
          🔀 {creative ? 'Creative' : 'Create'} Fusion
          {showTriple && <span style={{ fontSize: '0.7em', marginLeft: 6, color: '#f8d030' }}>✦ Triple</span>}
        </h3>
        {onClose && <button className="mini" onClick={onClose}>✕</button>}
      </div>

      {/* Head & Body selectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'end' }}>
        <label>
          <div className="label"><strong>Head</strong> <span className="dim">(offensive)</span></div>
          <input
            list="fusion-head-species"
            value={headSpecies}
            onChange={e => setHeadSpecies(e.target.value)}
            placeholder="e.g., Charizard"
          />
          <datalist id="fusion-head-species">
            {dex && Object.values(dex.pokedex).map((s: any) => <option key={s.name} value={s.name} />)}
          </datalist>
        </label>
        <button className="mini" onClick={handleSwap} title="Swap head ↔ body" style={{ padding: '4px 8px', fontSize: '1.1em' }}>⇄</button>
        <label>
          <div className="label"><strong>Body</strong> <span className="dim">(defensive)</span></div>
          <input
            list="fusion-body-species"
            value={bodySpecies}
            onChange={e => setBodySpecies(e.target.value)}
            placeholder="e.g., Blastoise"
          />
          <datalist id="fusion-body-species">
            {dex && Object.values(dex.pokedex).map((s: any) => <option key={s.name} value={s.name} />)}
          </datalist>
        </label>
      </div>

      {/* Triple fusion (hidden feature — click to reveal) */}
      {!showTriple && tripleUnlocked && (
        <button
          className="mini dim"
          onClick={() => setShowTriple(true)}
          style={{ justifySelf: 'start', fontSize: '0.78em', opacity: 0.4 }}
          title="Add a third Pokémon (experimental)"
        >
          + Triple fusion...
        </button>
      )}
      {showTriple && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
          <label>
            <div className="label"><strong>Third</strong> <span className="dim">(modifier)</span></div>
            <input
              list="fusion-third-species"
              value={thirdSpecies}
              onChange={e => setThirdSpecies(e.target.value)}
              placeholder={!creative && normalizedAllowedThird ? 'Pick from your allowed list' : 'e.g., Kyurem'}
            />
            <datalist id="fusion-third-species">
              {thirdSpeciesOptions.map(name => <option key={name} value={name} />)}
            </datalist>
          </label>
          <button className="mini" onClick={() => { setShowTriple(false); setThirdSpecies(''); }}>✕</button>
        </div>
      )}

      {/* Sprite preview */}
      {(isTripleActive || twoWaySpritePreview) && (
        <div style={{ display: 'grid', gap: 8, padding: 8, background: 'var(--panel-bg-dark)', borderRadius: 8, border: '1px solid #333' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {isTripleActive ? (
              <TripleSpriteImg
                src={selectedTripleSprite || triplePrimaryVariants[0] || tripleAllCandidates[0] || ''}
                candidates={tripleAllCandidates}
                size={96}
                alt={fusionPreview?.name || 'Triple Fusion'}
              />
            ) : (
              <FusionSpriteImg fb={twoWaySpritePreview!} size={96} alt={fusionPreview?.name || 'Fusion'} />
            )}
          </div>
          {isTripleActive && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              {triplePrimaryVariants.map((variant, idx) => (
                <button
                  key={variant}
                  className="mini"
                  onClick={() => setSelectedTripleSprite(variant)}
                  title={`Triple variant ${idx + 1}`}
                  style={{
                    border: selectedTripleSprite === variant ? '2px solid #f8d030' : '1px solid #444',
                    borderRadius: 6,
                    padding: 2,
                    background: selectedTripleSprite === variant ? 'rgba(248, 208, 48, 0.12)' : 'transparent',
                  }}
                >
                  <img
                    src={variant}
                    alt={`Variant ${idx + 1}`}
                    width={42}
                    height={42}
                    style={{ imageRendering: 'pixelated', display: 'block' }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats preview */}
      {fusionPreview && (
        <div style={{ border: '1px solid #444', borderRadius: 6, padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <strong>{fusionPreview.name}</strong>
            <span style={{ display: 'flex', gap: 4 }}>
              {fusionPreview.types.map(t => (
                <span key={t} style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: '0.72em', fontWeight: 'bold',
                  color: '#fff', background: TYPE_COLORS[t.toLowerCase()] || '#888',
                }}>{t}</span>
              ))}
            </span>
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            {statRows.map(s => (
              <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 40px', gap: 4, alignItems: 'center', fontSize: '0.85em' }}>
                <span className="dim">{s.label}</span>
                <div style={{ background: '#333', borderRadius: 3, height: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (s.value / 180) * 100)}%`, background: s.color, height: '100%', borderRadius: 3 }} />
                </div>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.85em' }}>
              <span className="dim">BST</span>
              <strong>{fusionPreview.total}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Options */}
      <div style={{ display: 'grid', gap: 8 }}>
        <label>
          <div className="label"><strong>Nickname</strong></div>
          <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={fusionPreview?.name || 'Optional'} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label>
            <div className="label"><strong>Level</strong></div>
            <input type="number" min={1} max={255} value={level} onChange={e => setLevel(Number(e.target.value) || 1)} />
          </label>
          <label>
            <div className="label"><strong>Ability</strong></div>
            <select value={ability} onChange={e => setAbility(e.target.value)} disabled={!abilityOptions.length}>
              {abilityOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={shiny} onChange={e => setShiny(e.target.checked)} /> Shiny
        </label>
      </div>

      {/* Moves */}
      <div>
        <h4 style={{ margin: '0 0 6px 0' }}>Moves <span className="dim" style={{ fontWeight: 400 }}>(from either parent)</span></h4>
        {moves.map((mv, i) => {
          const legal = !dex || !mv ? true :
            isMoveLegalForSpecies(headSpecies, mv, dex.learnsets) ||
            isMoveLegalForSpecies(bodySpecies, mv, dex.learnsets) ||
            (!!showTriple && !!thirdSpecies && isMoveLegalForSpecies(thirdSpecies, mv, dex.learnsets));
          return (
            <div key={i} style={{ marginBottom: 4 }}>
              <input
                list={`fusion-move-${i}`}
                value={mv}
                onChange={e => { const copy = moves.slice(); copy[i] = e.target.value; setMoves(copy); }}
                placeholder="Move name"
                style={{ borderColor: legal ? undefined : 'orange', color: legal ? undefined : 'orange' }}
              />
              <datalist id={`fusion-move-${i}`}>
                {dex && Object.values(dex.moves).map((m: any) => <option key={m.name} value={m.name} />)}
              </datalist>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleCreate}
        disabled={!headPokemon || !bodyPokemon || !headNum || !bodyNum}
        style={{ fontWeight: 600, padding: '8px 16px' }}
      >
        🔀 {showTriple ? 'Create Triple Fusion' : 'Create Fusion'}
      </button>
    </div>
  );
}

/** Inline fusion sprite with fallback chain */
function FusionSpriteImg({ fb, size, alt }: {
  fb: ReturnType<typeof fusionSpriteUrlWithFallback>;
  size: number;
  alt: string;
}) {
  const [src, setSrc] = useState(fb.src || fb.placeholder);
  const idxRef = React.useRef(0);

  useEffect(() => {
    idxRef.current = 0;
    setSrc(fb.src || fb.placeholder);
  }, [fb]);

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      onLoad={() => { fb.handleLoad?.(src); }}
      onError={() => {
        idxRef.current++;
        setSrc(fb.candidates[idxRef.current] || fb.placeholder);
      }}
    />
  );
}

function TripleSpriteImg({ src, candidates, size, alt }: {
  src: string;
  candidates: string[];
  size: number;
  alt: string;
}) {
  const [current, setCurrent] = useState(src || candidates[0] || placeholderSpriteDataURL('?'));
  const idxRef = React.useRef(0);

  useEffect(() => {
    idxRef.current = 0;
    setCurrent(src || candidates[0] || placeholderSpriteDataURL('?'));
  }, [src, candidates]);

  return (
    <img
      src={current}
      alt={alt}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      onError={() => {
        idxRef.current++;
        setCurrent(candidates[idxRef.current] || placeholderSpriteDataURL('?'));
      }}
    />
  );
}

export default FusionCreator;
