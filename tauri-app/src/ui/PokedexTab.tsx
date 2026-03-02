import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BattlePokemon } from '../types';
import { CustomDexBuilder } from './CustomDexBuilder';
import { adapter as adapterUtils } from '../data/adapterPublic';
import type { DexSpecies } from '../data/adapterPublic';
type SpriteSlot =
  | 'front' | 'shiny' | 'back' | 'back-shiny'
  | 'gen5' | 'gen5-shiny' | 'gen5-back' | 'gen5-back-shiny'
  | 'home' | 'home-shiny' | 'home-back' | 'home-back-shiny'
  | 'ani' | 'ani-shiny' | 'ani-back' | 'ani-back-shiny';

const adapter = adapterUtils;

const TYPE_OPTIONS = [
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying',
  'Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy',
];

// Helper to convert to ID (same as PS's toID)
function toID(text: string): string {
  return adapter.normalizeName(text);
}

// Types for PS data
interface Species {
  id: string;
  name: string;
  num: number;
  types: string[];
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  abilities: { [key: string]: string };
  heightm: number;
  weightkg: number;
  prevo?: string;
  evos?: string[];
  forme?: string;
  baseForme?: string;
  baseSpecies?: string;
  otherFormes?: string[];
  cosmeticFormes?: string[];
  eggGroups?: string[];
  gender?: 'M' | 'F' | 'N';
  genderRatio?: { M: number; F: number };
  tier?: string;
  isNonstandard?: string | null;
  gen?: number;
  requiredItem?: string;
  color?: string;
  spriteid?: string;
  changesFrom?: string;
  evoType?: string;
  evoLevel?: number;
  evoItem?: string;
  evoCondition?: string;
  evoMove?: string;
}

interface Move {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | true;
  pp: number;
  desc?: string;
  shortDesc?: string;
  priority?: number;
  target?: string;
  gen?: number;
  flags?: Record<string, number>;
}

interface Ability {
  id: string;
  name: string;
  desc?: string;
  shortDesc?: string;
  gen?: number;
  isNonstandard?: string | null;
}

interface Item {
  id: string;
  name: string;
  desc?: string;
  shortDesc?: string;
  gen?: number;
  spritenum?: number;
  sprite?: string;
  megaStone?: string;
}

type DexMode = 'search' | 'pokemon' | 'moves' | 'abilities' | 'items' | 'types' | 'pc' | 'custom';
type CustomSeed = { key?: string; entry?: DexSpecies; learnset?: Record<string, any> };

// PS-style type colors with gradients
const TYPE_STYLE: Record<string, React.CSSProperties> = {
  normal: { background: 'linear-gradient(#A8A878,#8A8A59)', borderColor: '#79794E' },
  fire: { background: 'linear-gradient(#F08030,#DD6610)', borderColor: '#B4530D' },
  water: { background: 'linear-gradient(#6890F0,#386CEB)', borderColor: '#1753E3' },
  electric: { background: 'linear-gradient(#F8D030,#F0C108)', borderColor: '#C19B07' },
  grass: { background: 'linear-gradient(#78C850,#5CA935)', borderColor: '#4A892B' },
  ice: { background: 'linear-gradient(#98D8D8,#69C6C6)', borderColor: '#45B6B6' },
  fighting: { background: 'linear-gradient(#C03028,#9D2721)', borderColor: '#82211B' },
  poison: { background: 'linear-gradient(#A040A0,#803380)', borderColor: '#662966' },
  ground: { background: 'linear-gradient(#E0C068,#D4A82F)', borderColor: '#AA8623' },
  flying: { background: 'linear-gradient(#A890F0,#9180C4)', borderColor: '#7762B6' },
  psychic: { background: 'linear-gradient(#F85888,#F61C5D)', borderColor: '#D60945' },
  bug: { background: 'linear-gradient(#A8B820,#8D9A1B)', borderColor: '#616B13' },
  rock: { background: 'linear-gradient(#B8A038,#93802D)', borderColor: '#746523' },
  ghost: { background: 'linear-gradient(#705898,#554374)', borderColor: '#413359' },
  dragon: { background: 'linear-gradient(#7038F8,#4C08EF)', borderColor: '#3D07C0' },
  dark: { background: 'linear-gradient(#705848,#513F34)', borderColor: '#362A23' },
  steel: { background: 'linear-gradient(#B8B8D0,#9797BA)', borderColor: '#7A7AA7' },
  fairy: { background: 'linear-gradient(#F830D0,#F008C1)', borderColor: '#C1079B' },
};

const STAT_NAMES: Record<string, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
};

const CUSTOM_SPRITE_SLOTS: Array<{ slot: SpriteSlot; label: string; group: string }> = [
  { slot: 'gen5', label: 'Gen 5 Front', group: 'Gen 5' },
  { slot: 'gen5-back', label: 'Gen 5 Back', group: 'Gen 5' },
  { slot: 'gen5-shiny', label: 'Gen 5 Shiny Front', group: 'Gen 5' },
  { slot: 'gen5-back-shiny', label: 'Gen 5 Shiny Back', group: 'Gen 5' },
  { slot: 'home', label: 'HOME Front', group: 'HOME' },
  { slot: 'home-back', label: 'HOME Back', group: 'HOME' },
  { slot: 'home-shiny', label: 'HOME Shiny Front', group: 'HOME' },
  { slot: 'home-back-shiny', label: 'HOME Shiny Back', group: 'HOME' },
  { slot: 'ani', label: 'Animated Front', group: 'Animated' },
  { slot: 'ani-back', label: 'Animated Back', group: 'Animated' },
  { slot: 'ani-shiny', label: 'Animated Shiny Front', group: 'Animated' },
  { slot: 'ani-back-shiny', label: 'Animated Shiny Back', group: 'Animated' },
];

function CustomSpriteManager({ speciesId, speciesName }: { speciesId: string; speciesName: string }) {
  const [spriteMap, setSpriteMap] = useState<Partial<Record<SpriteSlot, string>>>({});
  const id = useMemo(() => adapter.normalizeName(speciesId || speciesName), [speciesId, speciesName]);

  useEffect(() => {
    const next: Partial<Record<SpriteSlot, string>> = {};
    for (const slot of CUSTOM_SPRITE_SLOTS) {
      const existing = adapter.getCustomSprite(id, slot.slot as any);
      if (existing) next[slot.slot] = existing;
    }
    setSpriteMap(next);
  }, [id]);

  const grouped = useMemo(() => {
    return CUSTOM_SPRITE_SLOTS.reduce<Record<string, typeof CUSTOM_SPRITE_SLOTS>>((acc, slot) => {
      acc[slot.group] = acc[slot.group] || [];
      acc[slot.group].push(slot);
      return acc;
    }, {} as Record<string, typeof CUSTOM_SPRITE_SLOTS>);
  }, []);

  const onFile = (slot: SpriteSlot, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      adapter.saveCustomSprite(id, slot as any, dataUrl);
      setSpriteMap(prev => ({ ...prev, [slot]: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.entries(grouped).map(([group, slots]) => (
        <div key={group} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 10 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{group}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {slots.map(({ slot, label }) => {
              const preview = spriteMap[slot] || adapter.placeholderSpriteDataURL(label.slice(0, 2).toUpperCase(), 80, 80);
              return (
                <label key={slot} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
                  <span style={{ fontSize: 11, textAlign: 'center' }}>{label}</span>
                  <img alt={label} src={preview} style={{ width: 80, height: 80, imageRendering: 'pixelated', objectFit: 'contain' }} />
                  <input type="file" accept=".png,.gif,.webp" onChange={e => onFile(slot, e)} />
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#777' }}>Custom sprites are stored locally for this device.</div>
    </div>
  );
}

// PS-style type badge
function TypeBadge({ type, href }: { type: string; href?: string }) {
  const style: React.CSSProperties = {
    display: 'inline-block',
    width: 62,
    height: 14,
    padding: '1px 0',
    border: '1px solid #A99890',
    borderRadius: 3,
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
    textShadow: '1px 1px 1px #333',
    textTransform: 'uppercase',
    textDecoration: 'none',
    marginRight: 4,
    ...TYPE_STYLE[type.toLowerCase()],
  };
  
  if (href) {
    return <a href={href} style={style} onClick={e => e.preventDefault()}>{type}</a>;
  }
  return <span style={style}>{type}</span>;
}

// PS-style category badge
function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, React.CSSProperties> = {
    Physical: { background: 'linear-gradient(#E39088,#D65D51)', borderColor: '#A99890', color: '#FBC290' },
    Special: { background: 'linear-gradient(#ADB1BD,#7D828D)', borderColor: '#A1A5AD', color: '#E0E2E4' },
    Status: { background: 'linear-gradient(#CBC9CB,#AAA6AA)', borderColor: '#A99890', color: '#F5F4F5' },
  };
  return (
    <span style={{
      display: 'inline-block',
      width: 62,
      height: 14,
      padding: '1px 0',
      border: '1px solid #A99890',
      borderRadius: 3,
      fontSize: 10,
      textAlign: 'center',
      textShadow: '1px 1px 1px #333',
      textTransform: 'uppercase',
      ...colors[category],
    }}>
      {category}
    </span>
  );
}

// PS-style stat bar
function StatBar({ stat, value, level = 100 }: { stat: string; value: number; level?: number }) {
  const width = Math.min(200, Math.floor((value / 200) * 200));
  const hue = Math.min(360, Math.floor((value / 255) * 180));
  
  // Calculate real stats at level
  const getStat = (base: number, isHp: boolean, lv: number, iv: number, ev: number, nature: number) => {
    if (isHp) {
      if (base === 1) return 1; // Shedinja
      return Math.floor((2 * base + iv + Math.floor(ev / 4)) * lv / 100) + lv + 10;
    }
    return Math.floor((Math.floor((2 * base + iv + Math.floor(ev / 4)) * lv / 100) + 5) * nature);
  };
  
  const isHp = stat === 'hp';
  const minMinus = isHp ? '' : getStat(value, false, level, 0, 0, 0.9);
  const min = getStat(value, isHp, level, 31, 0, 1.0);
  const max = getStat(value, isHp, level, 31, 252, 1.0);
  const maxPlus = isHp ? '' : getStat(value, false, level, 31, 252, 1.1);
  
  return (
    <tr>
      <th style={{ textAlign: 'right', paddingRight: 6, fontSize: 9, fontWeight: 'normal' }}>{STAT_NAMES[stat]}:</th>
      <td style={{ fontWeight: 'bold', width: 38, textAlign: 'right' }}>{value}</td>
      <td style={{ width: 210 }}>
        <span style={{
          display: 'block',
          height: 12,
          width: width,
          background: `hsl(${hue}, 85%, 45%)`,
          borderRadius: 2,
          border: `1px solid hsl(${hue}, 75%, 35%)`,
          boxShadow: 'inset 1px 4px 0 rgba(255,255,255,.4), inset -1px -1px 0 rgba(0,0,0,.3)',
        }} />
      </td>
      <td style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 10 }}><small>{minMinus}</small></td>
      <td style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 10 }}><small>{min}</small></td>
      <td style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 10 }}><small>{max}</small></td>
      <td style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 10 }}><small>{maxPlus}</small></td>
    </tr>
  );
}

// Pokemon icon (40x30 picon style)
function PokemonIcon({ pokemon, style }: { pokemon: Species | string; style?: React.CSSProperties }) {
  const id = typeof pokemon === 'string'
    ? toID(pokemon)
    : (pokemon.spriteid || pokemon.id || toID(pokemon.name));
  const iconRef = useRef(adapter.iconUrlWithFallback(id, () => {}));
  const [src, setSrc] = useState(() => adapter.iconUrl(id));

  useEffect(() => {
    const next = adapter.iconUrlWithFallback(id, (nextUrl: string) => setSrc(nextUrl));
    iconRef.current = next;
    setSrc(next.src);
  }, [id]);

  return (
    <img
      className="picon"
      src={src}
      alt=""
      onError={() => iconRef.current.handleError()}
      style={{
        display: 'inline-block',
        width: 40,
        height: 30,
        objectFit: 'contain',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  );
}

// Pokemon detail panel - PS style
function PokemonDetail({ pokemon, dexData, onNavigate, onMakeForme, onAddToPC }: { 
  pokemon: Species; 
  dexData: DexData;
  onNavigate: (id: string, mode: DexMode) => void;
  onMakeForme: (species: Species) => void;
  onAddToPC?: (mons: BattlePokemon[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<'moves' | 'details'>('moves');
  const [level, setLevel] = useState(100);
  const spriteId = pokemon.spriteid || pokemon.name || pokemon.id;
  const spriteRef = useRef(adapter.spriteUrlWithFallback(spriteId, () => {}));
  const [pokemonSpriteUrl, setPokemonSpriteUrl] = useState(() => adapter.spriteUrl(spriteId, false));
  
  const bst = Object.values(pokemon.baseStats).reduce((a, b) => a + b, 0);
  useEffect(() => {
    const next = adapter.spriteUrlWithFallback(spriteId, (nextUrl: string) => setPokemonSpriteUrl(nextUrl), { shiny: false });
    spriteRef.current = next;
    setPokemonSpriteUrl(next.src);
  }, [spriteId]);
  
  // Get evolution method text
  const getEvoMethod = (evo: Species) => {
    const condition = evo.evoCondition ? ` ${evo.evoCondition}` : '';
    switch (evo.evoType) {
      case 'levelExtra': return 'level-up' + condition;
      case 'levelFriendship': return 'level-up with high Friendship' + condition;
      case 'levelHold': return `level-up holding ${evo.evoItem}` + condition;
      case 'useItem': return (evo.evoItem || 'Evolution Item') + condition;
      case 'levelMove': return evo.evoMove ? `level-up while knowing ${evo.evoMove}` + condition : 'level-up' + condition;
      case 'trade': return 'trade' + condition;
      case 'other': return evo.evoCondition || 'Special';
      default: return evo.evoLevel ? `level ${evo.evoLevel}` + condition : 'level-up' + condition;
    }
  };

  // Get evolution chain
  const getEvoChain = () => {
    let basic: Species = pokemon;
    while (basic.prevo && dexData.pokedex[toID(basic.prevo)]) {
      basic = dexData.pokedex[toID(basic.prevo)];
    }

    const chain: Species[][] = [];
    let current: Species[] = [basic];

    while (current.length > 0) {
      chain.push(current);
      const next: Species[] = [];
      const nextSeen = new Set<string>();
      for (const mon of current) {
        if (mon.evos) {
          for (const evo of mon.evos) {
            const evoMon = dexData.pokedex[toID(evo)];
            if (evoMon && !nextSeen.has(evoMon.id)) {
              nextSeen.add(evoMon.id);
              next.push(evoMon);
            }
          }
        }
      }
      current = next;
    }

    return chain;
  };

  const evoChain = getEvoChain();
  
  // Grass Knot power
  const gkPower = pokemon.weightkg >= 200 ? 120 : pokemon.weightkg >= 100 ? 100 : 
                  pokemon.weightkg >= 50 ? 80 : pokemon.weightkg >= 25 ? 60 : 
                  pokemon.weightkg >= 10 ? 40 : 20;

  // Learnset data
  const learnset = useMemo(() => {
    const ls = dexData.learnsets[pokemon.id] || dexData.learnsets[toID(pokemon.baseSpecies || pokemon.name)];
    if (!ls?.learnset) return null;
    
    // Merge with changesFrom if applicable
    let merged = { ...ls.learnset };
    if (pokemon.changesFrom) {
      const cfLs = dexData.learnsets[toID(pokemon.changesFrom)];
      if (cfLs?.learnset) {
        merged = { ...merged, ...cfLs.learnset };
      }
    }
    
    // Categorize moves
    const levelUp: { level: number; move: Move }[] = [];
    const tm: Move[] = [];
    const tutor: Move[] = [];
    const egg: Move[] = [];
    const other: Move[] = [];
    
    for (const moveId in merged) {
      const move = dexData.moves[moveId];
      if (!move) continue;
      
      const sources = Array.isArray(merged[moveId]) ? merged[moveId] : [merged[moveId]];
      let addedAs = new Set<string>();
      
      for (const source of sources) {
        const gen = source.charAt(0);
        const method = source.charAt(1);
        
        // Only show moves from current gen (9) or compatible
        if (gen !== '9' && gen !== '8' && gen !== '7') continue;
        
        if (method === 'L' && !addedAs.has('L')) {
          const lvl = parseInt(source.slice(2), 10) || 0;
          levelUp.push({ level: lvl, move });
          addedAs.add('L');
        } else if (method === 'M' && !addedAs.has('M')) {
          tm.push(move);
          addedAs.add('M');
        } else if (method === 'T' && !addedAs.has('T')) {
          tutor.push(move);
          addedAs.add('T');
        } else if (method === 'E' && !addedAs.has('E')) {
          egg.push(move);
          addedAs.add('E');
        }
      }
    }
    
    // Add remaining moves as "other"
    for (const moveId in merged) {
      const move = dexData.moves[moveId];
      if (!move) continue;
      if (!levelUp.find(m => m.move.id === moveId) && 
          !tm.find(m => m.id === moveId) && 
          !tutor.find(m => m.id === moveId) && 
          !egg.find(m => m.id === moveId)) {
        other.push(move);
      }
    }
    
    levelUp.sort((a, b) => a.level - b.level);
    tm.sort((a, b) => a.name.localeCompare(b.name));
    tutor.sort((a, b) => a.name.localeCompare(b.name));
    egg.sort((a, b) => a.name.localeCompare(b.name));
    other.sort((a, b) => a.name.localeCompare(b.name));
    
    return { levelUp, tm, tutor, egg, other };
  }, [pokemon, dexData]);

  const renderMoveRow = (move: Move, tag?: string) => (
    <li key={move.id} style={{ 
      display: 'flex', 
      alignItems: 'center', 
      padding: '4px 8px', 
      borderBottom: '1px solid #ddd',
      gap: 8,
      cursor: 'pointer',
    }}
    onClick={() => onNavigate(move.id, 'moves')}
    >
      {tag && <span style={{ width: 40, fontSize: 11, color: '#777', fontWeight: 'bold' }}>{tag}</span>}
      <TypeBadge type={move.type} />
      <CategoryBadge category={move.category} />
      <span style={{ flex: 1, fontWeight: 'bold' }}>{move.name}</span>
      <span style={{ width: 40, textAlign: 'right' }}>{move.basePower || '—'}</span>
      <span style={{ width: 40, textAlign: 'right' }}>{move.accuracy === true ? '—' : `${move.accuracy}%`}</span>
    </li>
  );

  return (
    <div className="dexentry" style={{ padding: 16, maxWidth: 640 }}>
      {/* Back button */}
      <a 
        href="#" 
        onClick={(e) => { e.preventDefault(); onNavigate('', 'pokemon'); }}
        style={{ color: '#6688cc', textDecoration: 'none', fontSize: 12 }}
      >
        ← Pokédex
      </a>
      
      {/* Tier badge */}
      {pokemon.tier && (
        <span style={{ 
          float: 'right', 
          padding: '2px 6px', 
          border: '1px solid #aaa', 
          borderRadius: 4, 
          fontSize: 10,
          color: '#555',
          marginTop: 4,
        }}>
          {pokemon.tier}
        </span>
      )}
      
      {/* Header */}
      <h1 style={{ margin: '8px 0 4px', fontSize: 24 }}>
        {pokemon.forme ? (
          <>{pokemon.baseSpecies}<small style={{ opacity: 0.7, fontSize: '0.7em' }}>-{pokemon.forme}</small></>
        ) : pokemon.name}
        {pokemon.num !== 0 && <code style={{ marginLeft: 8, fontSize: 11, color: '#999', fontWeight: 'normal' }}>{pokemon.num < 0 ? `#S${Math.abs(pokemon.num)}` : `#${pokemon.num}`}</code>}
      </h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => onMakeForme(pokemon)}
          style={{
            padding: '4px 8px',
            border: '1px solid #bbb',
            background: '#e6e6e6',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Make Forme
        </button>
        {onAddToPC && (
          <button
            type="button"
            onClick={() => {
              const mon: BattlePokemon = {
                name: pokemon.name,
                species: pokemon.name,
                level: 50,
                types: pokemon.types || [],
                baseStats: {
                  hp: pokemon.baseStats?.hp ?? 50,
                  atk: pokemon.baseStats?.atk ?? 50,
                  def: pokemon.baseStats?.def ?? 50,
                  spAtk: pokemon.baseStats?.spa ?? 50,
                  spDef: pokemon.baseStats?.spd ?? 50,
                  speed: pokemon.baseStats?.spe ?? 50,
                },
                moves: [],
                maxHp: pokemon.baseStats?.hp ?? 50,
                currentHp: pokemon.baseStats?.hp ?? 50,
                statStages: { atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 },
                ability: pokemon.abilities ? Object.values(pokemon.abilities)[0] : undefined,
              };
              onAddToPC([mon]);
            }}
            style={{
              padding: '4px 8px',
              border: '1px solid #4a9eff',
              background: '#4a9eff',
              color: '#fff',
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            + Add to PC
          </button>
        )}
      </div>
      
      {/* Nonstandard warning */}
      {pokemon.isNonstandard && (
        <div style={{ 
          border: '1px solid #F56C11', 
          background: '#4a3020', 
          borderRadius: 3, 
          padding: '5px 9px', 
          margin: '8px 0',
          fontSize: 12,
        }}>
          {pokemon.isNonstandard === 'Past' && 'Only usable in past generations and National Dex formats.'}
          {pokemon.isNonstandard === 'LGPE' && "Pokémon Let's Go only."}
          {pokemon.isNonstandard === 'CAP' && 'A made-up Pokémon by Smogon CAP.'}
          {!['Past', 'LGPE', 'CAP'].includes(pokemon.isNonstandard) && pokemon.num !== 0 && 'Unreleased.'}
        </div>
      )}
      
      {/* Sprite */}
      <img 
        src={pokemonSpriteUrl} 
        alt={pokemon.name} 
        onError={() => spriteRef.current.handleError()}
        style={{ float: 'left', width: 96, height: 96, imageRendering: 'pixelated', padding: 10 }} 
      />
      
      {/* Types */}
      <dl style={{ margin: '0 0 0 116px' }}>
        <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777', margin: '10px 0 0' }}>Types:</dt>
        <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
          {pokemon.types.map(t => <TypeBadge key={t} type={t} />)}
        </dd>
      </dl>
      
      {/* Size */}
      <dl style={{ margin: '0 0 0 116px', fontSize: 9 }}>
        <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777', margin: '10px 0 0' }}>Size:</dt>
        <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
          {pokemon.heightm}m, {pokemon.weightkg}kg
          <br />
          <small style={{ color: '#888' }}>Grass Knot: {gkPower}</small>
        </dd>
      </dl>
      
      {/* Abilities */}
      <dl style={{ margin: '10px 0 0 0', clear: 'left' }}>
        <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Abilities:</dt>
        <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
          {Object.entries(pokemon.abilities).map(([slot, name], i) => (
            <span key={slot}>
              {i > 0 && ' | '}
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); onNavigate(toID(name), 'abilities'); }}
                style={{ color: slot === 'H' ? '#888' : '#6688cc', fontStyle: slot === 'H' ? 'italic' : 'normal', textDecoration: 'none' }}
              >
                {name}
              </a>
              {slot === 'H' && <small style={{ color: '#777' }}> (H)</small>}
              {slot === 'S' && <small style={{ color: '#777' }}> (special)</small>}
            </span>
          ))}
        </dd>
      </dl>
      
      {/* Stats */}
      <dl style={{ margin: '16px 0 0' }}>
        <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777', clear: 'left' }}>Base stats:</dt>
        <dd style={{ margin: 0, padding: 0 }}>
          <table style={{ borderSpacing: 0 }}>
            <thead>
              <tr>
                <td></td>
                <td></td>
                <td style={{ width: 200 }}></td>
                <th style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 9, fontStyle: 'italic' }} title="0 IVs, 0 EVs, negative nature">min−</th>
                <th style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 9, fontStyle: 'italic' }} title="31 IVs, 0 EVs, neutral nature">min</th>
                <th style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 9, fontStyle: 'italic' }} title="31 IVs, 252 EVs, neutral nature">max</th>
                <th style={{ width: 40, textAlign: 'center', color: '#555', fontSize: 9, fontStyle: 'italic' }} title="31 IVs, 252 EVs, positive nature">max+</th>
              </tr>
            </thead>
            <tbody>
              {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map(stat => (
                <StatBar key={stat} stat={stat} value={pokemon.baseStats[stat]} level={level} />
              ))}
              <tr>
                <th style={{ textAlign: 'right', paddingRight: 6, fontSize: 9, color: '#777' }}>Total:</th>
                <td style={{ fontWeight: 'normal', color: '#777' }}>{bst}</td>
                <td></td>
                <td colSpan={4} style={{ fontSize: 10, color: '#777' }}>
                  at level <input 
                    type="number" 
                    value={level} 
                    onChange={e => setLevel(Math.max(1, Math.min(100, parseInt(e.target.value) || 100)))}
                    style={{ width: 50, padding: '2px 4px', background: '#fff', border: '1px solid #bbb', borderRadius: 3, color: '#111' }}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </dd>
      </dl>
      
      {/* Evolution */}
      <dl style={{ margin: '16px 0 0' }}>
        <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Evolution:</dt>
        <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
          {evoChain.length > 1 ? (
            <table style={{ borderSpacing: 0 }}>
              <tbody>
                <tr>
                  {evoChain.map((stage, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <td style={{ padding: '0 8px', fontSize: 21, verticalAlign: 'middle' }}>
                          <span title={Array.from(new Set(stage.map(mon => mon.prevo ? getEvoMethod(mon) : '').filter(Boolean))).join(' / ')}>→</span>
                        </td>
                      )}
                      <td style={{ verticalAlign: 'top' }}>
                        {stage.map(mon => (
                          <div 
                            key={mon.id}
                            style={{ 
                              padding: '4px 8px',
                              background: mon.id === pokemon.id ? 'rgba(100,200,255,0.15)' : 'transparent',
                              borderRadius: 4,
                              cursor: mon.id !== pokemon.id ? 'pointer' : 'default',
                            }}
                            onClick={() => mon.id !== pokemon.id && onNavigate(mon.id, 'pokemon')}
                          >
                            <PokemonIcon pokemon={mon} />
                            <span style={{ fontSize: 11 }}>
                              {mon.forme ? <>{mon.baseSpecies}<small>-{mon.forme}</small></> : mon.name}
                            </span>
                            {mon.prevo && (
                              <div style={{ fontSize: 10, color: '#888', marginLeft: 22 }}>
                                {getEvoMethod(mon)}
                              </div>
                            )}
                          </div>
                        ))}
                      </td>
                    </React.Fragment>
                  ))}
                </tr>
              </tbody>
            </table>
          ) : (
            <em style={{ color: '#888' }}>Does not evolve</em>
          )}
          {pokemon.prevo && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              Evolves from {dexData.pokedex[toID(pokemon.prevo)]?.name || pokemon.prevo} ({getEvoMethod(pokemon)})
            </div>
          )}
        </dd>
      </dl>
      
      {/* Formes */}
      {(pokemon.otherFormes || pokemon.forme) && (
        <dl style={{ margin: '16px 0 0' }}>
          <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Formes:</dt>
          <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
            {(() => {
              const baseMon = pokemon.forme ? dexData.pokedex[toID(pokemon.baseSpecies || '')] || pokemon : pokemon;
              const formes = [baseMon, ...(baseMon.otherFormes || []).map(f => dexData.pokedex[toID(f)]).filter(Boolean)];
              return formes.map((mon, i) => (
                <span key={mon.id}>
                  {i > 0 && ', '}
                  <span 
                    style={{ 
                      cursor: mon.id !== pokemon.id ? 'pointer' : 'default',
                      fontWeight: mon.id === pokemon.id ? 'bold' : 'normal',
                    }}
                    onClick={() => mon.id !== pokemon.id && onNavigate(mon.id, 'pokemon')}
                  >
                    <PokemonIcon pokemon={mon} style={{ marginTop: -12 }} />
                    {mon.forme || mon.baseForme || 'Base'}
                  </span>
                </span>
              ));
            })()}
            {pokemon.requiredItem && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Must hold {pokemon.requiredItem}
              </div>
            )}
          </dd>
        </dl>
      )}
      
      {/* Cosmetic Formes */}
      {pokemon.cosmeticFormes && pokemon.cosmeticFormes.length > 0 && (
        <dl style={{ margin: '16px 0 0' }}>
          <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Cosmetic formes:</dt>
          <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
            <PokemonIcon pokemon={pokemon} style={{ marginTop: -12 }} />
            {pokemon.baseForme || 'Base'}
            {pokemon.cosmeticFormes.map(forme => {
              const formeMon = dexData.pokedex[toID(forme)];
              return (
                <span key={forme}>
                  , <PokemonIcon pokemon={formeMon || forme} style={{ marginTop: -12 }} />
                  {formeMon?.forme || forme}
                </span>
              );
            })}
          </dd>
        </dl>
      )}
      
      {/* Egg Groups & Gender */}
      {pokemon.eggGroups && (
        <div style={{ display: 'flex', gap: 32, marginTop: 16 }}>
          <dl style={{ margin: 0 }}>
            <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Egg groups:</dt>
            <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
              <PokemonIcon pokemon="egg" style={{ marginTop: -12 }} />
              {pokemon.eggGroups.join(', ')}
            </dd>
          </dl>
          <dl style={{ margin: 0 }}>
            <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Gender ratio:</dt>
            <dd style={{ margin: 0, padding: '0 0 0 10px' }}>
              {pokemon.gender === 'M' && '100% male'}
              {pokemon.gender === 'F' && '100% female'}
              {pokemon.gender === 'N' && 'Genderless'}
              {!pokemon.gender && pokemon.genderRatio && `${(pokemon.genderRatio.M * 100)}% male, ${(pokemon.genderRatio.F * 100)}% female`}
              {!pokemon.gender && !pokemon.genderRatio && '50% male, 50% female'}
            </dd>
          </dl>
        </div>
      )}
      
      {/* Tabs */}
      <ul style={{ 
        listStyle: 'none', 
        margin: '24px 0 0', 
        padding: '5px 0 0 10px',
        textAlign: 'left',
        borderBottom: '1px solid #ccc',
      }}>
        <li style={{ display: 'inline' }}>
          <button 
            onClick={() => setActiveTab('moves')}
            style={{
              padding: '4px 10px',
              margin: '0 -1px 0 0',
              border: '1px solid #bbb',
              borderBottom: activeTab === 'moves' ? 0 : '1px solid #bbb',
              borderRadius: '5px 0 0 0',
              background: activeTab === 'moves' ? '#f8f8f8' : '#e6e6e6',
              color: activeTab === 'moves' ? '#333' : '#555',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            Moves
          </button>
        </li>
        <li style={{ display: 'inline' }}>
          <button 
            onClick={() => setActiveTab('details')}
            style={{
              padding: '4px 10px',
              margin: '0 -1px 0 0',
              border: '1px solid #bbb',
              borderBottom: activeTab === 'details' ? 0 : '1px solid #bbb',
              borderRadius: '0 5px 0 0',
              background: activeTab === 'details' ? '#f8f8f8' : '#e6e6e6',
              color: activeTab === 'details' ? '#333' : '#555',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            Flavor
          </button>
        </li>
      </ul>
      
      {/* Learnset */}
      {activeTab === 'moves' && learnset && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {/* Move header */}
          <li style={{ 
            display: 'flex', 
            alignItems: 'center', 
            padding: '4px 8px', 
            gap: 8,
            fontSize: 10,
            color: '#555',
            background: '#f0f0f0',
          }}>
            <span style={{ width: 40 }}></span>
            <span style={{ width: 64 }}>Type</span>
            <span style={{ width: 64 }}>Cat.</span>
            <span style={{ flex: 1 }}>Move</span>
            <span style={{ width: 40, textAlign: 'right' }}>Pow</span>
            <span style={{ width: 40, textAlign: 'right' }}>Acc</span>
          </li>
          
          {learnset.levelUp.length > 0 && (
            <>
              <li style={{ padding: '8px', background: '#f7f7f7', fontWeight: 'bold', fontSize: 12 }}>Level-up</li>
              {learnset.levelUp.map(({ level, move }) => renderMoveRow(move, level === 0 || level === 1 ? '—' : `L${level}`))}
            </>
          )}
          
          {learnset.tm.length > 0 && (
            <>
              <li style={{ padding: '8px', background: '#f7f7f7', fontWeight: 'bold', fontSize: 12 }}>TM/HM</li>
              {learnset.tm.map(move => renderMoveRow(move))}
            </>
          )}
          
          {learnset.tutor.length > 0 && (
            <>
              <li style={{ padding: '8px', background: '#f7f7f7', fontWeight: 'bold', fontSize: 12 }}>Tutor</li>
              {learnset.tutor.map(move => renderMoveRow(move))}
            </>
          )}
          
          {learnset.egg.length > 0 && (
            <>
              <li style={{ padding: '8px', background: '#f7f7f7', fontWeight: 'bold', fontSize: 12 }}>Egg</li>
              {learnset.egg.map(move => renderMoveRow(move))}
            </>
          )}
          
          {learnset.other.length > 0 && (
            <>
              <li style={{ padding: '8px', background: '#f7f7f7', fontWeight: 'bold', fontSize: 12 }}>Past generation only</li>
              {learnset.other.map(move => renderMoveRow(move))}
            </>
          )}
        </ul>
      )}
      
      {/* Flavor/Details */}
      {activeTab === 'details' && (
        <div style={{ padding: 8 }}>
          <h4 style={{ margin: '0 0 8px' }}>Flavor</h4>
          <dl>
            <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Color:</dt>
            <dd style={{ margin: '0 0 8px 10px' }}>{pokemon.color || 'Unknown'}</dd>
          </dl>
          
          <h4 style={{ margin: '16px 0 8px' }}>Sprites</h4>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <img 
                src={adapter.spriteUrl(spriteId, false)} 
                alt="Normal" 
                style={{ width: 96, height: 96, imageRendering: 'pixelated' }} 
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (img.dataset.fallback) return;
                  img.dataset.fallback = '1';
                  img.src = adapter.spriteUrl(spriteId, false, { setOverride: 'gen5' });
                }}
              />
              <div style={{ fontSize: 10, color: '#777' }}>Normal</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <img 
                src={adapter.spriteUrl(spriteId, true)} 
                alt="Shiny" 
                style={{ width: 96, height: 96, imageRendering: 'pixelated' }} 
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (img.dataset.fallback) return;
                  img.dataset.fallback = '1';
                  img.src = adapter.spriteUrl(spriteId, true, { setOverride: 'gen5' });
                }}
              />
              <div style={{ fontSize: 10, color: '#777' }}>Shiny</div>
            </div>
          </div>
          <h4 style={{ margin: '16px 0 8px' }}>Custom Sprites</h4>
          <CustomSpriteManager speciesId={spriteId} speciesName={pokemon.name} />
        </div>
      )}
    </div>
  );
}

// Move detail panel
function MoveDetail({ move, dexData, onNavigate }: { move: Move; dexData: DexData; onNavigate: (id: string, mode: DexMode) => void }) {
  // Find Pokemon that learn this move
  const pokemonWithMove = useMemo(() => {
    const results: Species[] = [];
    for (const id in dexData.learnsets) {
      const ls = dexData.learnsets[id]?.learnset;
      if (ls && move.id in ls) {
        const pokemon = dexData.pokedex[id];
        if (pokemon && pokemon.num !== 0) {
          results.push(pokemon);
        }
      }
    }
    return results.slice(0, 50);
  }, [move, dexData]);

  return (
    <div className="dexentry" style={{ padding: 16, maxWidth: 640 }}>
      <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('', 'moves'); }} style={{ color: '#6688cc', textDecoration: 'none', fontSize: 12 }}>← Pokédex</a>
      
      <h1 style={{ margin: '8px 0 16px', fontSize: 24 }}>
        {move.name}
        <span style={{ marginLeft: 8 }}><TypeBadge type={move.type} /></span>
      </h1>
      
      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <dl style={{ margin: 0 }}>
          <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Category</dt>
          <dd style={{ margin: 0, padding: '4px 0 0 10px' }}><CategoryBadge category={move.category} /></dd>
        </dl>
        <dl style={{ margin: 0 }}>
          <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Power</dt>
          <dd style={{ margin: 0, padding: '4px 0 0 10px', fontSize: 24, fontWeight: 'bold' }}>{move.basePower || '—'}</dd>
        </dl>
        <dl style={{ margin: 0 }}>
          <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>Accuracy</dt>
          <dd style={{ margin: 0, padding: '4px 0 0 10px', fontSize: 20, fontWeight: 'bold' }}>{move.accuracy === true ? '—' : `${move.accuracy}%`}</dd>
        </dl>
        <dl style={{ margin: 0 }}>
          <dt style={{ fontSize: 9, fontWeight: 'bold', color: '#777' }}>PP</dt>
          <dd style={{ margin: 0, padding: '4px 0 0 10px', fontSize: 13, color: '#555' }}>{move.pp}</dd>
        </dl>
      </div>
      
      <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>{move.desc || move.shortDesc || 'No description available.'}</p>
      
      {pokemonWithMove.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Pokémon that learn this move</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pokemonWithMove.map(p => (
              <div 
                key={p.id}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 4, 
                  padding: '2px 6px', 
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
                onClick={() => onNavigate(p.id, 'pokemon')}
              >
                <PokemonIcon pokemon={p} style={{ width: 32, height: 24 }} />
                {p.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Ability detail panel
function AbilityDetail({ ability, dexData, onNavigate }: { ability: Ability; dexData: DexData; onNavigate: (id: string, mode: DexMode) => void }) {
  const pokemonWithAbility = useMemo(() => {
    const results: Species[] = [];
    for (const id in dexData.pokedex) {
      const pokemon = dexData.pokedex[id];
      if (!pokemon.abilities) continue;
      for (const slot in pokemon.abilities) {
        if (toID(pokemon.abilities[slot]) === ability.id) {
          results.push(pokemon);
          break;
        }
      }
    }
    return results.filter(p => p.num !== 0).sort((a, b) => a.num - b.num).slice(0, 50);
  }, [ability, dexData]);

  return (
    <div className="dexentry" style={{ padding: 16, maxWidth: 640 }}>
      <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('', 'abilities'); }} style={{ color: '#6688cc', textDecoration: 'none', fontSize: 12 }}>← Pokédex</a>
      
      <h1 style={{ margin: '8px 0 16px', fontSize: 24 }}>{ability.name}</h1>
      
      {ability.isNonstandard && (
        <div style={{ border: '1px solid #F56C11', background: '#4a3020', borderRadius: 3, padding: '5px 9px', margin: '8px 0', fontSize: 12 }}>
          A made-up ability by Smogon CAP.
        </div>
      )}
      
      <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>{ability.desc || ability.shortDesc || 'No description available.'}</p>
      
      {pokemonWithAbility.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Pokémon with this ability</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pokemonWithAbility.map(p => (
              <div 
                key={p.id}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 4, 
                  padding: '2px 6px', 
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
                onClick={() => onNavigate(p.id, 'pokemon')}
              >
                <PokemonIcon pokemon={p} style={{ width: 32, height: 24 }} />
                {p.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Item detail panel
function ItemDetail({ item, dexData, onNavigate }: { item: Item; dexData: DexData; onNavigate: (id: string, mode: DexMode) => void }) {
  return (
    <div className="dexentry" style={{ padding: 16, maxWidth: 640 }}>
      <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('', 'items'); }} style={{ color: '#6688cc', textDecoration: 'none', fontSize: 12 }}>← Pokédex</a>
      
      <h1 style={{ margin: '8px 0 16px', fontSize: 24 }}>{item.name}</h1>
      {item.sprite && (
        <img src={item.sprite} alt={item.name} style={{ width: 64, height: 64, imageRendering: 'pixelated', marginBottom: 12 }} />
      )}
      {item.megaStone && (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          Mega Stone Target: <strong>{item.megaStone}</strong>
        </div>
      )}
      <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>{item.desc || item.shortDesc || 'No description available.'}</p>
    </div>
  );
}

interface DexData {
  pokedex: Record<string, Species>;
  moves: Record<string, Move>;
  abilities: Record<string, Ability>;
  items: Record<string, Item>;
  learnsets: Record<string, any>;
}

type PcEntry = {
  speciesId: string;
  nickname?: string;
  level?: number;
  shiny?: boolean;
  index: number;
};

export function PokedexTab({ onAddToPC }: { onAddToPC?: (mons: BattlePokemon[]) => void }) {
  const [mode, setMode] = useState<DexMode>('search');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dexData, setDexData] = useState<DexData | null>(null);
  const [pcList, setPcList] = useState<PcEntry[]>([]);
  const [customDexVersion, setCustomDexVersion] = useState(0);
  const [customSeed, setCustomSeed] = useState<CustomSeed | null>(null);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemShortDesc, setCustomItemShortDesc] = useState('');
  const [customItemSprite, setCustomItemSprite] = useState<string>('');
  const [customItemMega, setCustomItemMega] = useState('');
  const [customMoveName, setCustomMoveName] = useState('');
  const [customMoveType, setCustomMoveType] = useState('Normal');
  const [customMoveCategory, setCustomMoveCategory] = useState<'Physical'|'Special'|'Status'>('Status');
  const [customMovePower, setCustomMovePower] = useState<number>(0);
  const [customMoveAccuracy, setCustomMoveAccuracy] = useState<number>(100);
  const [customMovePP, setCustomMovePP] = useState<number>(10);
  const [customMovePriority, setCustomMovePriority] = useState<number>(0);
  const [customMoveAlwaysHits, setCustomMoveAlwaysHits] = useState<boolean>(false);
  const [customMoveShortDesc, setCustomMoveShortDesc] = useState('');
  const [customMoveDesc, setCustomMoveDesc] = useState('');
  const [customAbilityName, setCustomAbilityName] = useState('');
  const [customAbilityShortDesc, setCustomAbilityShortDesc] = useState('');
  const [customAbilityDesc, setCustomAbilityDesc] = useState('');

  const dexOptions = useMemo(() => {
    if (!dexData) return null;
    const species = Object.values(dexData.pokedex)
      .filter(s => s.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    const abilities = Object.values(dexData.abilities)
      .filter(a => a.name)
      .map(a => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const moves = Object.values(dexData.moves)
      .filter(m => m.name)
      .map(m => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { species, abilities, moves };
  }, [dexData]);

  // Load data
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        const dex = await adapter.loadShowdownDex();
        if (!mounted) return;
        
        const pokedex: Record<string, Species> = {};
        for (const [id, entry] of Object.entries(dex.pokedex)) {
          const e = entry as any;
          pokedex[id] = {
            id,
            name: e.name || id,
            num: e.num || 0,
            types: e.types || [],
            baseStats: e.baseStats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            abilities: e.abilities || {},
            heightm: e.heightm || 0,
            weightkg: e.weightkg || 0,
            prevo: e.prevo,
            evos: e.evos,
            forme: e.forme,
            baseForme: e.baseForme,
            baseSpecies: e.baseSpecies,
            otherFormes: e.otherFormes,
            cosmeticFormes: e.cosmeticFormes,
            eggGroups: e.eggGroups,
            gender: e.gender,
            genderRatio: e.genderRatio,
            tier: e.tier,
            isNonstandard: e.isNonstandard,
            gen: e.gen,
            requiredItem: e.requiredItem,
            color: e.color,
            spriteid: e.spriteid || e.name,
            changesFrom: e.changesFrom,
            evoType: e.evoType,
            evoLevel: e.evoLevel,
            evoItem: e.evoItem,
            evoCondition: e.evoCondition,
            evoMove: e.evoMove,
          };
        }
        
        const moves: Record<string, Move> = {};
        for (const [id, entry] of Object.entries(dex.moves)) {
          const e = entry as any;
          moves[id] = {
            id,
            name: e.name || id,
            type: e.type || 'Normal',
            category: e.category || 'Status',
            basePower: e.basePower || 0,
            accuracy: e.accuracy ?? true,
            pp: e.pp || 0,
            desc: e.desc,
            shortDesc: e.shortDesc,
            priority: e.priority,
            target: e.target,
            gen: e.gen,
            flags: e.flags,
          };
        }
        
        const abilities: Record<string, Ability> = {};
        for (const [id, entry] of Object.entries(dex.abilities)) {
          const e = entry as any;
          abilities[id] = {
            id,
            name: e.name || id,
            desc: e.desc,
            shortDesc: e.shortDesc,
            gen: e.gen,
            isNonstandard: e.isNonstandard,
          };
        }
        
        const items: Record<string, Item> = {};
        for (const [id, entry] of Object.entries(dex.items)) {
          const e = entry as any;
          items[id] = {
            id,
            name: e.name || id,
            desc: e.desc,
            shortDesc: e.shortDesc,
            gen: e.gen,
            spritenum: e.spritenum,
            sprite: e.sprite,
            megaStone: e.megaStone,
          };
        }
        
        setDexData({
          pokedex,
          moves,
          abilities,
          items,
          learnsets: dex.learnsets as Record<string, any>,
        });
        setDataLoaded(true);
      } catch (err) {
        console.error('Failed to load Pokédex data:', err);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, []);

  const customDex = useMemo<Record<string, DexSpecies>>(() => adapter.getCustomDex() as Record<string, DexSpecies>, [customDexVersion]);
  const customList = useMemo(() => {
    return Object.entries(customDex).map(([id, entry]) => ({
      id,
      name: entry.name || id,
      num: (entry as any).num || 0,
      types: entry.types || [],
      baseStats: entry.baseStats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      abilities: entry.abilities || {},
      heightm: entry.heightm || 0,
      weightkg: entry.weightkg || 0,
      prevo: entry.prevo,
      evos: entry.evos,
      forme: (entry as any).forme,
      baseForme: entry.baseForme,
      baseSpecies: entry.baseSpecies,
      otherFormes: entry.otherFormes,
      cosmeticFormes: entry.cosmeticFormes,
      eggGroups: entry.eggGroups,
      gender: entry.gender,
      genderRatio: (entry as any).genderRatio,
      tier: (entry as any).tier,
      isNonstandard: (entry as any).isNonstandard,
      gen: (entry as any).gen,
      requiredItem: entry.requiredItem,
      color: entry.color,
      spriteid: (entry as any).spriteid || entry.name,
      changesFrom: (entry as any).changesFrom,
      evoType: entry.evoType,
      evoLevel: entry.evoLevel,
      evoItem: (entry as any).evoItem,
      evoCondition: entry.evoCondition,
      evoMove: (entry as any).evoMove,
    } as Species));
  }, [customDex]);

  // Load PC list from localStorage
  const loadPc = useCallback(() => {
    try {
      const raw = localStorage.getItem('ttrpg.boxes');
      if (!raw) { setPcList([]); return; }
      const boxes = JSON.parse(raw) as Array<Array<any | null>>;
      const entries: PcEntry[] = [];
      let idx = 0;
      for (const box of boxes || []) {
        for (const slot of box || []) {
          if (slot) {
            const speciesId = toID(slot.species || slot.name || '');
            entries.push({
              speciesId,
              nickname: slot.name,
              level: slot.level,
              shiny: !!slot.shiny,
              index: idx,
            });
          }
          idx++;
        }
      }
      setPcList(entries);
    } catch {
      setPcList([]);
    }
  }, []);

  useEffect(() => {
    loadPc();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ttrpg.boxes') loadPc();
    };
    const onBoxesUpdated = () => loadPc();
    window.addEventListener('storage', onStorage);
    window.addEventListener('ttrpg-boxes-updated', onBoxesUpdated);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('ttrpg-boxes-updated', onBoxesUpdated);
    };
  }, [loadPc]);

  useEffect(() => {
    if (mode === 'pc') loadPc();
  }, [mode, loadPc]);

  // Navigation handler
  const handleNavigate = useCallback((id: string, newMode: DexMode) => {
    if (id) {
      setSelectedId(id);
      if (newMode !== mode) setMode(newMode);
      if (newMode === 'custom') {
        const entry = customDex[id];
        if (entry) setCustomSeed({ key: id, entry });
      } else if (customSeed) {
        setCustomSeed(null);
      }
    } else {
      setSelectedId(null);
    }
  }, [mode, customDex, customSeed]);

  const handleMakeForme = useCallback((species: Species) => {
    const base = species.baseSpecies || species.name;
    const newName = `${base}-Custom`;
    const entry: DexSpecies = {
      name: newName,
      baseSpecies: base,
      types: species.types?.length ? species.types : ['Normal'],
      baseStats: { ...species.baseStats },
      abilities: { ...species.abilities },
      heightm: species.heightm,
      weightkg: species.weightkg,
      color: species.color,
      baseForme: species.baseForme || species.forme,
      prevo: species.prevo,
      evos: species.evos,
      eggGroups: species.eggGroups,
      gender: species.gender,
      evoType: species.evoType,
      evoLevel: species.evoLevel,
      evoCondition: species.evoCondition,
      requiredItem: species.requiredItem,
    } as any;
    (entry as any).forme = 'Custom';
    const key = adapter.normalizeName(newName);
    setCustomSeed({ key, entry });
    setSelectedId(key);
    setMode('custom');
  }, []);

  const handleCustomSaved = useCallback((payload: { key: string; entry: DexSpecies; learnset?: Record<string, any> }) => {
    setCustomDexVersion(v => v + 1);
    setCustomSeed({ key: payload.key, entry: payload.entry, learnset: payload.learnset });
    setSelectedId(payload.key);
    setDexData(prev => {
      if (!prev) return prev;
      const e = payload.entry as any;
      const nextPokedex = {
        ...prev.pokedex,
        [payload.key]: {
          id: payload.key,
          name: e.name || payload.key,
          num: e.num || 0,
          types: e.types || [],
          baseStats: e.baseStats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          abilities: e.abilities || {},
          heightm: e.heightm || 0,
          weightkg: e.weightkg || 0,
          prevo: e.prevo,
          evos: e.evos,
          forme: e.forme,
          baseForme: e.baseForme,
          baseSpecies: e.baseSpecies,
          otherFormes: e.otherFormes,
          cosmeticFormes: e.cosmeticFormes,
          eggGroups: e.eggGroups,
          gender: e.gender,
          genderRatio: e.genderRatio,
          tier: e.tier,
          isNonstandard: e.isNonstandard,
          gen: e.gen,
          requiredItem: e.requiredItem,
          color: e.color,
          spriteid: e.spriteid || e.name,
          changesFrom: e.changesFrom,
          evoType: e.evoType,
          evoLevel: e.evoLevel,
          evoItem: e.evoItem,
          evoCondition: e.evoCondition,
          evoMove: e.evoMove,
        } as Species,
      };
      const nextLearnsets = payload.learnset
        ? { ...prev.learnsets, [payload.key]: { learnset: payload.learnset } }
        : prev.learnsets;
      return { ...prev, pokedex: nextPokedex, learnsets: nextLearnsets };
    });
  }, []);

  const handleCreateDerivedForme = useCallback((payload: CustomSeed) => {
    setCustomSeed(payload);
    if (payload.key) setSelectedId(payload.key);
    setMode('custom');
  }, []);

  const handleStartNewCustom = useCallback(() => {
    setCustomSeed(null);
    setSelectedId(null);
    setMode('custom');
  }, []);

  const handleCustomItemSprite = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCustomItemSprite(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSaveCustomItem = () => {
    if (!customItemName.trim()) return;
    const key = adapter.normalizeName(customItemName);
    const entry = {
      name: customItemName.trim(),
      shortDesc: customItemShortDesc.trim() || undefined,
      sprite: customItemSprite || undefined,
      megaStone: customItemMega.trim() || undefined,
    };
    adapter.saveCustomItem(key, entry as any);
    setDexData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: {
          ...prev.items,
          [key]: { id: key, name: entry.name, shortDesc: entry.shortDesc, sprite: entry.sprite, megaStone: entry.megaStone },
        },
      };
    });
    setSelectedId(key);
    setMode('items');
  };

  const handleSaveCustomMove = () => {
    if (!customMoveName.trim()) return;
    const key = adapter.normalizeName(customMoveName);
    const entry = {
      name: customMoveName.trim(),
      type: customMoveType,
      category: customMoveCategory,
      basePower: Math.max(0, Number(customMovePower) || 0),
      accuracy: customMoveAlwaysHits ? true : Math.max(1, Math.min(100, Number(customMoveAccuracy) || 100)),
      pp: Math.max(1, Number(customMovePP) || 10),
      priority: Number(customMovePriority) || 0,
      shortDesc: customMoveShortDesc.trim() || undefined,
      desc: customMoveDesc.trim() || undefined,
    };
    adapter.saveCustomMove(key, entry as any);
    setDexData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        moves: {
          ...prev.moves,
          [key]: { id: key, ...entry } as any,
        },
      };
    });
    setSelectedId(key);
    setMode('moves');
  };

  const handleSaveCustomAbility = () => {
    if (!customAbilityName.trim()) return;
    const key = adapter.normalizeName(customAbilityName);
    const entry = {
      name: customAbilityName.trim(),
      shortDesc: customAbilityShortDesc.trim() || undefined,
      desc: customAbilityDesc.trim() || undefined,
    };
    adapter.saveCustomAbility(key, entry as any);
    setDexData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        abilities: {
          ...prev.abilities,
          [key]: { id: key, ...entry } as any,
        },
      };
    });
    setSelectedId(key);
    setMode('abilities');
  };

  // Get filtered list
  const filteredList = useMemo(() => {
    if (!dexData) return [];
    const query = search.toLowerCase().trim();
    
    if (mode === 'search' || mode === 'pokemon') {
      let list = Object.values(dexData.pokedex)
        .filter(p => {
          if (!p.name) return false;
          return true;
        })
        .sort((a, b) => {
          if (a.num !== b.num) return a.num - b.num;
          if (!a.baseSpecies && b.baseSpecies) return -1;
          if (a.baseSpecies && !b.baseSpecies) return 1;
          return a.name.localeCompare(b.name);
        });
      
      if (query) {
        list = list.filter(p => 
          p.name.toLowerCase().includes(query) ||
          p.id.includes(query) ||
          p.num.toString() === query ||
          (p.types && p.types.some(t => t.toLowerCase().includes(query))) ||
          (p.abilities && Object.values(p.abilities).some(a => a.toLowerCase().includes(query))) ||
          (() => {
            const tags: string[] = [];
            if (p.tier) tags.push(p.tier);
            if (p.isNonstandard) tags.push(p.isNonstandard);
            if (p.isNonstandard) tags.push('illegal');
            if (p.isNonstandard === 'CAP') tags.push('cap');
            return tags.some(t => t.toLowerCase().includes(query));
          })()
        );
      }
      
      return list;
    }
    
    if (mode === 'moves') {
      let list = Object.values(dexData.moves)
        .filter(m => m.name && !m.name.startsWith('Max ') && !m.name.startsWith('G-Max '))
        .sort((a, b) => a.name.localeCompare(b.name));
      
      if (query) {
        list = list.filter(m => 
          m.name.toLowerCase().includes(query) ||
          m.id.includes(query) ||
          m.type.toLowerCase().includes(query) ||
          m.category.toLowerCase().includes(query)
        );
      }
      
      return list;
    }
    
    if (mode === 'abilities') {
      let list = Object.values(dexData.abilities)
        .filter(a => a.name && !a.isNonstandard)
        .sort((a, b) => a.name.localeCompare(b.name));
      
      if (query) {
        list = list.filter(a => 
          a.name.toLowerCase().includes(query) ||
          a.id.includes(query) ||
          (a.shortDesc && a.shortDesc.toLowerCase().includes(query))
        );
      }
      
      return list;
    }
    
    if (mode === 'items') {
      let list = Object.values(dexData.items)
        .filter(i => i.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      
      if (query) {
        list = list.filter(i => 
          i.name.toLowerCase().includes(query) ||
          i.id.includes(query) ||
          (i.shortDesc && i.shortDesc.toLowerCase().includes(query))
        );
      }
      
      return list;
    }

    if (mode === 'pc') {
      let list = pcList.slice();
      if (query) {
        list = list.filter(p => (
          p.nickname?.toLowerCase().includes(query) ||
          p.speciesId.includes(query) ||
          (p.level != null && String(p.level) === query)
        ));
      }
      return list;
    }

    if (mode === 'custom') {
      let list = customList.slice();
      if (query) {
        list = list.filter(p => (
          p.name.toLowerCase().includes(query) ||
          p.id.includes(query) ||
          (p.types && p.types.some(t => t.toLowerCase().includes(query)))
        ));
      }
      return list;
    }
    
    return [];
  }, [mode, search, dexData, pcList, customList]);

  // Render result row
  const renderResultRow = (item: any) => {
    if (mode === 'search' || mode === 'pokemon') {
      const p = item as Species;
      return (
        <li 
          key={p.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            cursor: 'pointer',
            background: selectedId === p.id ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
            borderLeft: selectedId === p.id ? '3px solid #4a9eff' : '3px solid transparent',
            borderBottom: '1px solid #ddd',
          }}
          onClick={() => handleNavigate(p.id, 'pokemon')}
        >
          <PokemonIcon pokemon={p} />
          <div style={{ flex: 1, marginLeft: 4 }}>
            <div style={{ fontWeight: 'bold', fontSize: 12 }}>
              {p.num !== 0 && <span style={{ opacity: 0.5, marginRight: 4 }}>{p.num < 0 ? `S${Math.abs(p.num)}` : `#${p.num}`}</span>}
              {p.forme ? <>{p.baseSpecies}<small style={{ opacity: 0.7 }}>-{p.forme}</small></> : p.name}
            </div>
            <div>{p.types.map(t => <TypeBadge key={t} type={t} />)}</div>
          </div>
        </li>
      );
    }

    if (mode === 'custom') {
      const p = item as Species;
      return (
        <li
          key={p.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            cursor: 'pointer',
            background: selectedId === p.id ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
            borderLeft: selectedId === p.id ? '3px solid #4a9eff' : '3px solid transparent',
            borderBottom: '1px solid #ddd',
          }}
          onClick={() => handleNavigate(p.id, 'custom')}
        >
          <PokemonIcon pokemon={p} />
          <div style={{ flex: 1, marginLeft: 4 }}>
            <div style={{ fontWeight: 'bold', fontSize: 12 }}>
              {p.forme ? <>{p.baseSpecies}<small style={{ opacity: 0.7 }}>-{p.forme}</small></> : p.name}
            </div>
            <div>{p.types.map(t => <TypeBadge key={t} type={t} />)}</div>
          </div>
        </li>
      );
    }

    if (mode === 'pc') {
      const entry = item as PcEntry;
      const species = dexData?.pokedex[entry.speciesId];
      const displayName = entry.nickname || species?.name || entry.speciesId || 'Unknown';
      return (
        <li
          key={`${entry.speciesId}-${entry.index}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            cursor: 'pointer',
            background: selectedId === entry.speciesId ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
            borderLeft: selectedId === entry.speciesId ? '3px solid #4a9eff' : '3px solid transparent',
            borderBottom: '1px solid #ddd',
          }}
          onClick={() => handleNavigate(entry.speciesId, 'pc')}
        >
          <PokemonIcon pokemon={species?.id || entry.speciesId} />
          <div style={{ flex: 1, marginLeft: 4 }}>
            <div style={{ fontWeight: 'bold', fontSize: 12 }}>
              {displayName}
              {entry.level != null && <small style={{ marginLeft: 6, color: '#666' }}>Lv. {entry.level}</small>}
              {entry.shiny && <small style={{ marginLeft: 6, color: '#f2b233' }}>★</small>}
            </div>
            {species?.types?.length ? <div>{species.types.map(t => <TypeBadge key={t} type={t} />)}</div> : null}
          </div>
        </li>
      );
    }
    
    if (mode === 'moves') {
      const m = item as Move;
      return (
        <li 
          key={m.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 8px',
            cursor: 'pointer',
            background: selectedId === m.id ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
            borderLeft: selectedId === m.id ? '3px solid #4a9eff' : '3px solid transparent',
            borderBottom: '1px solid #ddd',
            gap: 8,
          }}
          onClick={() => handleNavigate(m.id, 'moves')}
        >
          <TypeBadge type={m.type} />
          <CategoryBadge category={m.category} />
          <span style={{ flex: 1, fontWeight: 'bold' }}>{m.name}</span>
          <span style={{ width: 40, textAlign: 'right', fontSize: 11 }}>{m.basePower || '—'}</span>
          <span style={{ width: 40, textAlign: 'right', fontSize: 11, color: '#888' }}>{m.accuracy === true ? '—' : `${m.accuracy}%`}</span>
        </li>
      );
    }
    
    if (mode === 'abilities') {
      const a = item as Ability;
      return (
        <li 
          key={a.id}
          style={{
            padding: '6px 8px',
            cursor: 'pointer',
            background: selectedId === a.id ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
            borderLeft: selectedId === a.id ? '3px solid #4a9eff' : '3px solid transparent',
            borderBottom: '1px solid #ddd',
          }}
          onClick={() => handleNavigate(a.id, 'abilities')}
        >
          <div style={{ fontWeight: 'bold' }}>{a.name}</div>
          <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.shortDesc || a.desc}
          </div>
        </li>
      );
    }
    
    if (mode === 'items') {
      const i = item as Item;
      return (
        <li 
          key={i.id}
          style={{
            padding: '6px 8px',
            cursor: 'pointer',
            background: selectedId === i.id ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
            borderLeft: selectedId === i.id ? '3px solid #4a9eff' : '3px solid transparent',
            borderBottom: '1px solid #ddd',
          }}
          onClick={() => handleNavigate(i.id, 'items')}
        >
          <div style={{ fontWeight: 'bold' }}>{i.name}</div>
          <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i.shortDesc || i.desc}
          </div>
        </li>
      );
    }
    
    return null;
  };

  // Get selected detail
  const selectedDetail = useMemo(() => {
    if (!dexData) return null;
    if (!selectedId && mode !== 'custom' && mode !== 'items') return null;
    const activeId = selectedId ?? '';
    
    if (mode === 'pokemon' || mode === 'search') {
      const pokemon = dexData.pokedex[activeId];
      if (pokemon) return <PokemonDetail pokemon={pokemon} dexData={dexData} onNavigate={handleNavigate} onMakeForme={handleMakeForme} onAddToPC={onAddToPC} />;
    }
    if (mode === 'pc') {
      const pokemon = dexData.pokedex[activeId];
      if (pokemon) return <PokemonDetail pokemon={pokemon} dexData={dexData} onNavigate={handleNavigate} onMakeForme={handleMakeForme} onAddToPC={onAddToPC} />;
    }
    if (mode === 'custom') {
      const seed = customSeed || (selectedId ? { key: selectedId, entry: customDex[selectedId], learnset: dexData.learnsets[selectedId]?.learnset } : null);
      return (
        <div style={{ padding: 16 }}>
          <CustomDexBuilder onAddToPC={onAddToPC} seed={seed} onSaved={handleCustomSaved} dexOptions={dexOptions} onCreateDerivedForme={handleCreateDerivedForme} />
        </div>
      );
    }
    if (mode === 'moves') {
      if (!selectedId) {
        return (
          <div style={{ padding: 16, maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>Create Custom Move</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                Name
                <input value={customMoveName} onChange={e => setCustomMoveName(e.target.value)} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  Type
                  <select value={customMoveType} onChange={e => setCustomMoveType(e.target.value)}>
                    {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  Category
                  <select value={customMoveCategory} onChange={e => setCustomMoveCategory(e.target.value as any)}>
                    <option value="Physical">Physical</option>
                    <option value="Special">Special</option>
                    <option value="Status">Status</option>
                  </select>
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  Power
                  <input type="number" min={0} value={customMovePower} onChange={e => setCustomMovePower(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  Accuracy
                  <input type="number" min={1} max={100} value={customMoveAccuracy} onChange={e => setCustomMoveAccuracy(Number(e.target.value) || 100)} disabled={customMoveAlwaysHits} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  PP
                  <input type="number" min={1} value={customMovePP} onChange={e => setCustomMovePP(Number(e.target.value) || 10)} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  Priority
                  <input type="number" value={customMovePriority} onChange={e => setCustomMovePriority(Number(e.target.value) || 0)} />
                </label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={customMoveAlwaysHits} onChange={e => setCustomMoveAlwaysHits(e.target.checked)} />
                Always hits (— accuracy)
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Short Description
                <input value={customMoveShortDesc} onChange={e => setCustomMoveShortDesc(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Description
                <textarea value={customMoveDesc} onChange={e => setCustomMoveDesc(e.target.value)} rows={3} />
              </label>
              <button type="button" onClick={handleSaveCustomMove} disabled={!customMoveName.trim()}>
                Save Custom Move
              </button>
            </div>
          </div>
        );
      }
      const move = dexData.moves[activeId];
      if (move) return <MoveDetail move={move} dexData={dexData} onNavigate={handleNavigate} />;
    }
    if (mode === 'abilities') {
      if (!selectedId) {
        return (
          <div style={{ padding: 16, maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>Create Custom Ability</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                Name
                <input value={customAbilityName} onChange={e => setCustomAbilityName(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Short Description
                <input value={customAbilityShortDesc} onChange={e => setCustomAbilityShortDesc(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Description
                <textarea value={customAbilityDesc} onChange={e => setCustomAbilityDesc(e.target.value)} rows={3} />
              </label>
              <button type="button" onClick={handleSaveCustomAbility} disabled={!customAbilityName.trim()}>
                Save Custom Ability
              </button>
            </div>
          </div>
        );
      }
      const ability = dexData.abilities[activeId];
      if (ability) return <AbilityDetail ability={ability} dexData={dexData} onNavigate={handleNavigate} />;
    }
    if (mode === 'items') {
      if (!selectedId) {
        return (
          <div style={{ padding: 16, maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>Create Custom Item</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                Name
                <input value={customItemName} onChange={e => setCustomItemName(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Short Description
                <input value={customItemShortDesc} onChange={e => setCustomItemShortDesc(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Mega Stone Target (optional)
                <input value={customItemMega} onChange={e => setCustomItemMega(e.target.value)} placeholder="Charizard" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                Sprite
                <input type="file" accept=".png,.gif,.webp" onChange={handleCustomItemSprite} />
              </label>
              {customItemSprite && (
                <img src={customItemSprite} alt="custom item" style={{ width: 64, height: 64, imageRendering: 'pixelated' }} />
              )}
              <button type="button" onClick={handleSaveCustomItem} disabled={!customItemName.trim()}>
                Save Custom Item
              </button>
            </div>
          </div>
        );
      }
      const item = dexData.items[activeId];
      if (item) return <ItemDetail item={item} dexData={dexData} onNavigate={handleNavigate} />;
    }
    
    return null;
  }, [selectedId, mode, dexData, handleNavigate, handleMakeForme, customSeed, customDex, onAddToPC, handleCustomSaved, dexOptions, handleCreateDerivedForme]);

  return (
    <div className="pokedex-tab" style={{ display: 'flex', flexDirection: 'column', height: '100%', color: '#111' }}>
      {/* Header - PS style */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #ccc', 
        textAlign: 'center',
        background: '#f7f7f7',
      }}>
        <h1 style={{ 
          margin: 0, 
          padding: search || selectedId ? '6px 0' : '20px 0', 
          fontSize: search || selectedId ? 14 : 24,
          transition: 'all 0.2s',
        }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setSearch(''); setSelectedId(null); setMode('search'); }} style={{ color: '#6688cc', textDecoration: 'none' }}>
            Pokédex
          </a>
        </h1>
        
        {/* Mode tabs */}
        <ul style={{ 
          listStyle: 'none', 
          margin: '12px 0', 
          padding: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 0,
        }}>
          {(['search', 'pokemon', 'moves', 'abilities', 'items', 'pc', 'custom'] as const).map((m, i, arr) => (
            <li key={m} style={{ display: 'inline' }}>
              <button
                onClick={() => { setMode(m); setSelectedId(null); }}
                style={{
                  padding: '6px 12px',
                  margin: '0 -1px 0 0',
                  border: '1px solid #bbb',
                  borderRadius: i === 0 ? '5px 0 0 5px' : i === arr.length - 1 ? '0 5px 5px 0' : 0,
                  background: mode === m ? '#4a9eff' : '#e6e6e6',
                  color: mode === m ? '#fff' : '#333',
                  cursor: 'pointer',
                  fontSize: 10,
                  textTransform: 'capitalize',
                }}
              >
                {m === 'search' ? 'Search' : m === 'pc' ? 'PC' : m === 'custom' ? 'Custom' : m}
              </button>
            </li>
          ))}
        </ul>
        
        {/* Search box */}
        <input
          type="search"
          placeholder={`Search ${mode === 'search' ? 'Pokémon, moves, abilities, items, types...' : mode === 'pc' ? 'PC Pokémon...' : mode === 'custom' ? 'Custom Pokémon...' : mode}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '8px 12px',
            background: '#fff',
            border: '1px solid #bbb',
            borderRadius: 4,
            color: '#111',
            fontSize: 14,
          }}
        />
        {mode === 'custom' && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={handleStartNewCustom}
              style={{
                padding: '6px 12px',
                border: '1px solid #bbb',
                background: '#e6e6e6',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              + New Custom Pokémon
            </button>
          </div>
        )}
        {mode === 'moves' && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={{
                padding: '6px 12px',
                border: '1px solid #bbb',
                background: '#e6e6e6',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              + New Custom Move
            </button>
          </div>
        )}
        {mode === 'abilities' && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={{
                padding: '6px 12px',
                border: '1px solid #bbb',
                background: '#e6e6e6',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              + New Custom Ability
            </button>
          </div>
        )}
        {mode === 'items' && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={{
                padding: '6px 12px',
                border: '1px solid #bbb',
                background: '#e6e6e6',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              + New Custom Item
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Results list */}
        <div style={{
          width: 300,
          borderRight: '1px solid #ddd',
          overflowY: 'auto',
          background: '#fafafa',
          height: 'calc(100vh - 220px)',
          maxHeight: 'calc(100vh - 220px)',
        }}>
          {!dataLoaded ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#888' }}>
              Loading Pokédex data...
            </div>
          ) : filteredList.length === 0 ? (
            <div style={{ padding: 16, color: '#888' }}>
              {search ? 'No results found' : 'Type to search'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {filteredList.map(renderResultRow)}
            </ul>
          )}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
          {selectedDetail || (
            <div style={{ padding: 32, textAlign: 'center', color: '#666' }}>
              Select an item from the list to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
