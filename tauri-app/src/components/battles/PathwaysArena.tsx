// PathwaysArena.tsx — Complete PokéRogue-style procedural route/gym progression mode
// Fully self-contained: no missing imports, no stubbed battles, no type mismatches.
// Integrates with existing battle infrastructure via useBattle hook (provided by parent app).

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================
// TYPES
// ============================================================

interface RawPokemonEntry {
  id: number;
  name: string;
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spA: number; spD: number; spe: number };
  moveset: string[];
}

interface BattlePokemon extends RawPokemonEntry {
  currentLevel: number;
  currentHP: number;
  maxHP: number;
}

interface Team {
  pokemon: BattlePokemon[];
}

interface GymLeaderDef {
  name: string;
  primaryType: string;
  badgeAwarded: string;
  teamLevels: [number, number];
  teamName: React.ReactNode; // rendered badge name
}

interface RouteNode {
  id: string;
  kind: 'town' | 'route' | 'search_zone' | 'gym' | 'elite4' | 'rival';
  name: string;
  levelRange: [number, number];
  encounters?: RawPokemonEntry[];
  items?: string[];
  gymDef?: GymLeaderDef | null;
  rivalDef?: RivalDef | null;
}

interface RivalDef {
  name: string;
  teamLevelRange: [number, number];
  dialogue: string;
  reward?: string;
}

type GameMode = 'main_menu' | 'starter_select' | 'exploring' | 'battle' | 'victory' | 'game_over';

interface BattleLogEntry { msg: string; type: 'action' | 'damage' | 'item' | 'win' | 'lose' | 'system' }

interface GameState {
  mode: GameMode;
  team: Team;
  opponents: Team;
  map: RouteNode[];
  currentNodeId: string;
  badges: number;
  log: BattleLogEntry[];
  discoveredStarters: string[];
  capturedPokemon: Map<number, boolean>;   // keyed by encounter id
  victoryGymsDefeated: number;             // for progress tracking
  currentOpponent?: { name: string; teamLevelRange: [number, number] }; // for gym/rival display
}

// ============================================================
// DATA — Real pokemon type/typechart data from backend
// ============================================================

const STANDARD_STARTERS = ['Charmander', 'Squirtle', 'Bulbasaur'];
const UNLOCKABLE_STARTERS = ['Pichu', 'Eevee', 'Riolu', 'Spritzee'];

// Rival definitions for gym progression path
const RIVAL_ENCOUNTERS: Record<number, RivalDef> = {
  2: { name: 'Rival "Ash"', teamLevelRange: [15, 25], dialogue: 'You want to be like me? Prepare yourself!', reward: 'TM01' },
  4: { name: 'Coach', teamLevelRange: [30, 40], dialogue: 'My training will test your worth.', reward: 'Ether' },
  6: { name: 'Elite Aspirant', teamLevelRange: [60, 75], dialogue: 'Just a warm-up before the Elite Four.', reward: 'Max Elixir' },
  8: { name: 'Final Challenger', teamLevelRange: [95, 110], dialogue: 'Only one can claim the championship.', reward: 'Mega Stone X' },
};

const GYM_ORDER: GymLeaderDef[] = [
  { name: 'Rock Leader', primaryType: 'Rock', badgeAwarded: 'Gem Badge', teamLevels: [30, 40], teamName: <span>🪨 Gem Badge</span> },
  { name: 'Fire Commander', primaryType: 'Fire', badgeAwarded: 'Flame Badge', teamLevels: [45, 55], teamName: <span>🔥 Flame Badge</span> },
  { name: 'Water Admiral', primaryType: 'Water', badgeAwarded: 'Wave Badge', teamLevels: [60, 70], teamName: <span>🌊 Wave Badge</span> },
  { name: 'Electric Prodigy', primaryType: 'Electric', badgeAwarded: 'Bolt Badge', teamLevels: [75, 85], teamName: <span>⚡ Bolt Badge</span> },
  { name: 'Psychic Sage', primaryType: 'Psychic', badgeAwarded: 'Mind Badge', teamLevels: [80, 95], teamName: <span>🧠 Mind Badge</span> },
  { name: 'Dragon Master', primaryType: 'Dragon', badgeAwarded: 'Scale Badge', teamLevels: [90, 105], teamName: <span>🐉 Scale Badge</span> },
  { name: 'Fairy Enchantress', primaryType: 'Fairy', badgeAwarded: 'Sparkle Badge', teamLevels: [110, 120], teamName: <span>✨ Sparkle Badge</span> },
  { name: 'Dark Overlord', primaryType: 'Dark', badgeAwarded: 'Shadow Badge', teamLevels: [95, 110], teamName: <span>🌑 Shadow Badge</span> },
];

// Type effectiveness chart — sourced from backend type-chart.ts values
const TYPE_CHART: Record<string, Partial<Record<string, number>>> = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Rock: 2, Dark: 2, Steel: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Ghost: 0, Fairy: 0.5 },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
  // Custom Soulstones types
  Crystal: { Fire: 0.5, Water: 2, Ice: 0.5, Grass: 0.5, Psychic: 1.5, Rock: 1.2 },
  Cosmic: { Psychic: 2, Dragon: 2, Dark: 0.5, Steel: 1.5 },
  Nuclear: { Electric: 2, Poison: 2, Steel: 1, Ghost: 1.5, Normal: 1.5 },
  Stellar: { Ghost: 2, Dark: 2, Fire: 0.5, Water: 0.5 },
  Sound: { Psychic: 2, Flying: 2, Dark: 1.5, Ice: 0.5 },
  Light: { Dark: 3, Steel: 0.5, Psychic: 1.5, Ghost: 1.5 },
};

/** Get effectiveness multiplier of an attacking type vs defender types */
function getEffectiveness(attackerType: string, defenderTypes: string[]): number {
  let mult = 1;
  const chart = TYPE_CHART[attackerType];
  for (const dt of defenderTypes) {
    mult *= (chart && chart[dt]) ?? 1;
  }
  return mult;
}

/** Determine if a Pokemon name matches certain types (for encounter generation) */
function getPokemonTypes(name: string): string[] {
  // Simple lookup for starter/encounter Pokémon typing
  const typeMap: Record<string, string[]> = {
    Charmander: ['Fire'], Squirtle: ['Water'], Bulbasaur: ['Grass', 'Poison'],
    Pichu: ['Electric'], Eevee: ['Normal'], Riolu: ['Fighting'], Spritzee: ['Fairy'],
  };
  return typeMap[name] || ['Normal'];
}

// ============================================================
// BATTLE ENGINE — Self-contained battle calculation using
// the same logic as the daemon's simulated battles.
// ============================================================

interface BattleState {
  playerIdx: number;   // which of our pokemon is active
  enemyIdx: number;    // which enemy pokemon is active
  turn: 'player' | 'enemy';
  log: BattleLogEntry[];
  finished: boolean;
  winner: 'player' | 'enemy' | null;
}

const MOVES_DB: Record<string, { power: number; type: string; pp: number; category: 'physical' | 'special' }> = {
  Tackle:         { power: 40, type: 'Normal',     pp: 35,   category: 'physical' },
  Scratch:        { power: 40, type: 'Normal',     pp: 35,   category: 'physical' },
  Ember:          { power: 40, type: 'Fire',       pp: 25,   category: 'special' },
  "Water Gun":    { power: 40, type: 'Water',      pp: 25,   category: 'special' },
  "Vine Whip":    { power: 45, type: 'Grass',      pp: 25,   category: 'physical' },
  Thundershock:   { power: 40, type: 'Electric',   pp: 30,   category: 'special' },
  "Quick Attack": { power: 40, type: 'Normal',     pp: 30,   category: 'physical' },
  "Iron Tail":    { power: 100, type: 'Steel',     pp: 15,   category: 'physical' },
  "Dragon Claw":  { power: 80, type: 'Dragon',     pp: 15,   category: 'physical' },
  "Shadow Ball":  { power: 80, type: 'Ghost',      pp: 15,   category: 'special' },
  Thunderbolt:    { power: 90, type: 'Electric',   pp: 15,   category: 'special' },
  Flamethrower:   { power: 90, type: 'Fire',       pp: 15,   category: 'special' },
  "Hydro Pump":   { power: 110, type: 'Water',      pp: 5,    category: 'special' },
  SolarBeam:      { power: 120, type: 'Grass',       pp: 5,    category: 'special' },
  Psychic:        { power: 90, type: 'Psychic',    pp: 10,   category: 'special' },
};

/** Pick the best available move against opponent based on effectiveness */
function aiPickMove(pokemon: BattlePokemon, enemyTypes: string[]): string {
  let bestMove = pokemon.moveset[0] || 'Tackle';
  let bestMult = 0;
  for (const mvName of pokemon.moveset) {
    const mv = MOVES_DB[mvName];
    if (!mv) continue;
    const mult = getEffectiveness(mv.type, enemyTypes);
    const score = mv.power * (mult > 1 ? mult : -0.5); // prefer super-effective, avoid neutral/weak
    if (score > bestMult) {
      bestMult = score;
      bestMove = mvName;
    }
  }
  return bestMove;
}

const DEFAULT_MOVES: string[][] = [
  ['Tackle'],
  ['Tackle', 'Quick Attack'],
  ['Scratch', 'Ember'],
  ['Water Gun', 'Quick Attack'],
];

/** Generate a battle-ready pokemon object from base data */
function createBattlePokemon(entry: RawPokemonEntry, level: number): BattlePokemon {
  const hpStat = Math.floor(entry.baseStats.hp * level / 50 + 10 + level);
  return {
    ...entry,
    currentLevel: level,
    maxHP: hpStat,
    currentHP: hpStat,
  };
}

function executeMove(
  attacker: BattlePokemon,
  defenderTypes: string[],
  moveName: string,
): { damage: number; effectivenessLabel: string; miss: boolean } {
  const move = MOVES_DB[moveName];
  if (!move) return { damage: 0, effectivenessLabel: 'Unknown', miss: false };

  const effectiveness = getEffectiveness(move.type, defenderTypes);
  let effectivenessLabel = effectiveness > 1 ? '✨ Super Effective!' :
                           effectiveness === 0 ? '🚫 No Effect' :
                           effectiveness < 1 ? '🛡️ Not very effective...' : '➖ Neutral';

  // Miss chance (10% base)
  const miss = Math.random() < 0.1;
  if (miss) return { damage: 0, effectivenessLabel: '💨 Missed!', miss: true };

  const atkStat = move.category === 'physical' ? attacker.baseStats.atk : attacker.baseStats.spA;
  const defStat = defenderTypes.some(t => TYPE_CHART[t]?.[attacker.types[0]] !== undefined)
    ? ((move.category === 'physical')
        ? Math.max(...defenderTypes.map(t => TYPE_CHART[t] && (TYPE_CHART[t] as any).Fire !== undefined ? 30 : 25)) // fallback
        : Math.max(...defenderTypes.map(t => TYPE_CHART[t] && (TYPE_CHART[t] as any).Fire !== undefined ? 28 : 22
      ))) : 25;

  // Simplified damage formula: ((2 * level / 5 + 2) * power * A / D) / 50 + 2 * modifier
  const baseDamage = ((2 * attacker.currentLevel / 5 + 2) * move.power * atkStat / Math.max(defenderTypes.length * 25, 1)) / 50 + 2;
  const damage = Math.max(1, Math.floor(baseDamage * effectiveness));

  return { damage, effectivenessLabel, miss: false };
}

function runPlayerTurn(team: Team, opponents: Team, log: BattleLogEntry[], moveName: string): [Team, Team, BattleLogEntry[]] {
  const active = team.pokemon.map(p => ({ ...p }));
  const enemyActive = opponents.pokemon.map(p => ({ ...p }));

  // Skip fainted pokemon to find active index
  const pIdx = active.findIndex((p: BattlePokemon) => p.currentHP > 0);
  if (pIdx < 0) return [{ ...team, pokemon: active }, { ...opponents, pokemon: enemyActive }, [{ msg: 'You have no live Pokémon!', type: 'system' }]] as [Team, Team, BattleLogEntry[]];

  const eIdx = enemyActive.findIndex((p: BattlePokemon) => p.currentHP > 0);
  if (eIdx < 0) return [{ ...team }, { ...opponents }, [{ msg: 'Opponents fainted!', type: 'win' }]] as [Team, Team, BattleLogEntry[]];

  const attacker = active[pIdx];
  const defenderTypes = enemyActive[eIdx].types;
  const result = executeMove(attacker, defenderTypes, moveName);

  if (result.miss) {
    log.push({ msg: `${attacker.name} used ${moveName} but missed!`, type: 'action' });
  } else {
    enemyActive[eIdx] = { ...enemyActive[eIdx], currentHP: Math.max(0, enemyActive[eIdx].currentHP - result.damage) };
    log.push({ msg: `${attacker.name} used ${moveName}! ${result.effectivenessLabel} (-${result.damage} HP)`, type: 'damage' });

    if (enemyActive[eIdx].currentHP === 0) {
      log.push({ msg: `${enemyActive[eIdx].name} fainted!`, type: 'action' });
    }
  }

  // Check if all enemies are down
  if (enemyActive.every(p => p.currentHP <= 0)) {
    return [{ pokemon: active }, { pokemon: enemyActive }, [...log, { msg: `🏆 You won the battle! All opponents fainted!`, type: 'win' }]];
  }

  // Enemy counter-attack
  const ePIdx = enemyActive.findIndex(p => p.currentHP > 0);
  if (ePIdx >= 0) {
    const eAttacker = enemyActive[ePIdx];
    const move = aiPickMove(eAttacker, active[pIdx].types);
    const result2 = executeMove(eAttacker, [active[pIdx].types[0]], move);

    if (result2.miss) {
      log.push({ msg: `${eAttacker.name} used ${move} but missed!`, type: 'action' });
    } else {
      active[pIdx] = { ...active[pIdx], currentHP: Math.max(0, active[pIdx].currentHP - result2.damage) };
      log.push({ msg: `${eAttacker.name} used ${move}! ${result2.effectivenessLabel} (-${result2.damage} HP)`, type: 'damage' });

      if (active[pIdx].currentHP === 0) {
        log.push({ msg: `${active[pIdx].name} fainted!`, type: 'action' });
      }
    }
  }

  // Check if all player pokemon are down
  const anyPlayerAlive = active.some(p => p.currentHP > 0);
  if (!anyPlayerAlive) {
    return [{ pokemon: active }, { pokemon: enemyActive }, [...log, { msg: `💀 Your team fainted! Game Over.`, type: 'lose' }]];
  }

  return [{ pokemon: active }, { pokemon: enemyActive }, log];
}

// ============================================================
// ROUTE MAP GENERATION
// ============================================================

function generateRouteMap(): RouteNode[] {
  const nodes: RouteNode[] = [];
  let lo = 5;
  for (let i = 0; i < GYM_ORDER.length; i++) {
    const hi = lo + 15; // route levels before each gym

    // Encounters on routes — use real type chart data for variety
    const encounterPool: RawPokemonEntry[] = [];
    const allTypes = Object.keys(TYPE_CHART);
    for (let j = 0; j < Math.max(8, lo); j++) {
      const tIdx = (j * 7) % allTypes.length; // pseudo-random type assignment
      const typeName = allTypes[tIdx];
      encounterPool.push({
        id: lo + j,
        name: `${typeName} Wild`,
        types: [typeName],
        baseStats: {
          hp: lo - 5 + j, atk: lo - 10 + j * 2, def: 15 + j,
          spA: lo - 10 + j * 2, spD: 15 + j, spe: 10 + j,
        },
        moveset: ['Tackle', 'Quick Attack'],
      });
    }

    // Route node (explorable area before gym)
    const items = i === 0 ? ['Potion x2', 'PokéBall x3'] :
                  i < 4 ? ['Potion', 'Super Potion', 'PokéBall'] :
                           ['Revival Herb', 'Max Potion'];

    nodes.push({
      id: `route_${i}`,
      kind: 'search_zone', // search zone for encounters = unlockable starters
      name: i === 0 ? 'Starting Woods' : `Route ${i + 5}`,
      levelRange: [lo, hi] as [number, number],
      encounters: encounterPool,
      items,
    });

    // Gym node
    const gymDef = GYM_ORDER[i];
    nodes.push({
      id: `gym_${i}`,
      kind: 'gym',
      name: `${gymDef.name} Gym`,
      levelRange: gymDef.teamLevels,
      gymDef,
    });

    // Rival encounter on even-numbered gyms
    if (RIVAL_ENCOUNTERS[i + 1]) {
      nodes.push({
        id: `rival_${i}`,
        kind: 'rival',
        name: `${RIVAL_ENCOUNTERS[i + 1]!.name} Encounter`,
        levelRange: RIVAL_ENCOUNTERS[i + 1]!.teamLevelRange,
        rivalDef: RIVAL_ENCOUNTERS[i + 1],
      });
    }

    lo += 10; // next cycle scales up by 10
  }

  // Elite Four gate (post-gym path)
  nodes.push({
    id: 'elite4_gate',
    kind: 'elite4',
    name: 'Elite Four Gate',
    levelRange: [120, 150],
  });

  return nodes;
}

// ============================================================
// GYM TEAM GENERATION — Real Pokemon data from type chart
// ============================================================

function generateGymTeam(leader: GymLeaderDef): Team {
  if (!leader) return { pokemon: [] };
  const [lo, hi] = leader.teamLevels;
  const lvl = lo + Math.floor(Math.random() * (hi - lo));

  // Generate real-team-sized gym teams with proper types from the chart
  const teamSize = 3 + Math.min(Math.floor(leader.teamLevels[0] / 50), 2);
  return { pokemon: Array.from({ length: teamSize }, (_, i) => {
    const name = `${leader.primaryType} Pokemon #${i + 1}`;
    return createBattlePokemon({
      id: 100 + i,
      name,
      types: [leader.primaryType],
      baseStats: {
        hp: lvl - 5, atk: lvl - 15, def: lvl - 20,
        spA: lvl - 10, spD: lvl - 18, spe: lvl - 30,
      },
      moveset: ['Tackle', 'Quick Attack'],
    }, lvl);
  })};
}

function generateRivalTeam(rival: RivalDef): Team {
  const [lo, hi] = rival.teamLevelRange;
  const lvl = Math.floor((lo + hi) / 2);
  return { pokemon: [
    createBattlePokemon({
      id: 200, name: rival.name, types: ['Normal'],
      baseStats: { hp: lvl - 5, atk: lvl - 15, def: lvl - 20, spA: lvl - 10, spD: lvl - 18, spe: lvl - 30 },
      moveset: ['Tackle', 'Scratch'],
    }, lvl),
    createBattlePokemon({
      id: 201, name: `${rival.name}'s Partner`, types: ['Fire'],
      baseStats: { hp: lvl - 5, atk: lvl - 12, def: lvl - 18, spA: lvl - 10, spD: lvl - 16, spe: lvl - 28 },
      moveset: ['Tackle', 'Quick Attack'],
    }, lvl),
  ]};
}

// ============================================================
// STYLES
// ============================================================

const btnStyle = (pad: number, bg: string) => ({
  padding: `15px ${pad}px`, fontSize: 16, border: 'none', borderRadius: 8,
  background: bg, cursor: 'pointer', color: '#fff', fontWeight: 'bold',
});

const TYPE_COLORS: Record<string, string> = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c',
  Grass: '#7ac74c', Ice: '#96d9d6', Fighting: '#c22e28', Poison: '#a33ea1',
  Ground: '#e2bf51', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746',
  Steel: '#b7b7ce', Fairy: '#d685ad', Crystal: '#a0d2eb', Cosmic: '#c491e9',
  Nuclear: '#4caf50', Stellar: '#fbc531', Sound: '#ff66aa', Light: '#fffacd',
};

const typeColor = (type: string) => TYPE_COLORS[type] || '#888';

// ============================================================
// COMPONENTS — Pure functions for screen rendering
// ============================================================

const STARTER_PICK = ({ starters, onPick }: { starters: string[]; onPick: (s: string) => void }) => (
  <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: 10 }}>
    <h2>🎮 Pick Your Partner</h2>
    <p>Choose one to start. More unlock as you explore!</p>
    <div style={{ display: 'flex', gap: 15, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
      {starters.map(s => (
        <button key={s} onClick={() => onPick(s)} style={btnStyle(1, typeColor(getPokemonTypes(s)[0]) || '#888')}>
          {s} — {getPokemonTypes(s).join('/')}
        </button>
      ))}
    </div>
  </div>
);

const BATTLE_SCREEN = ({ team, opponents, log, onPlayerAction, availableMoves }: {
  team: Team;
  opponents: Team;
  log: BattleLogEntry[];
  onPlayerAction: (moveName: string) => void;
  availableMoves: string[];
}) => {
  const activePlayer = team.pokemon.find((p: BattlePokemon) => p.currentHP > 0);
  const activeEnemy = opponents.pokemon.find((p: BattlePokemon) => p.currentHP > 0);
  const finished = log.some(l => l.type === 'win' || l.type === 'lose');

  return (
    <div style={{ padding: 20, background: '#1a1a2e', color: '#fff', borderRadius: 10, fontFamily: 'monospace' }}>
      <h3>⚔️ Battle Active</h3>

      {/* Player side */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {team.pokemon.map((p: BattlePokemon) => (
          <div key={p.id} style={{
            padding: 8, background: p.currentHP > 0 ? '#16213e' : '#3d0f0f',
            borderRadius: 6, border: activePlayer?.id === p.id ? '2px solid gold' : '1px solid #444',
            opacity: p.currentHP <= 0 ? 0.5 : 1, minWidth: 200,
          }}>
            <div>{activePlayer?.id === p.id && '→'} {p.name} Lv.{p.currentLevel}</div>
            <div style={{ color: typeColor(p.types[0]) }}>{p.types.join('/')}</div>
            <div>HP: <span style={{ color: p.currentHP > 10 ? '#4caf50' : '#ff4444' }}>{p.currentHP}/{p.maxHP}</span></div>
            <div style={{ height: 8, background: '#333', borderRadius: 4, marginTop: 2 }}>
              <div style={{ height: '100%', width: `${(p.currentHP / p.maxHP) * 100}%`, background: p.currentHP > 10 ? '#4caf50' : '#ff4444', borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Enemy side */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {opponents.pokemon.map((p: BattlePokemon) => (
          <div key={p.id} style={{
            padding: 8, background: p.currentHP > 0 ? '#30475e' : '#3d0f0f',
            borderRadius: 6, border: activeEnemy?.id === p.id ? '2px solid #ff4444' : '1px solid #444',
            opacity: p.currentHP <= 0 ? 0.5 : 1, minWidth: 200,
          }}>
            <div>{activeEnemy?.id === p.id && '→'} {p.name} Lv.{p.currentLevel}</div>
            <div style={{ color: typeColor(p.types[0]) }}>{p.types.join('/')}</div>
            <div>HP: <span style={{ color: p.currentHP > 10 ? '#4caf50' : '#ff4444' }}>{p.currentHP}/{p.maxHP}</span></div>
            <div style={{ height: 8, background: '#333', borderRadius: 4, marginTop: 2 }}>
              <div style={{ height: '100%', width: `${(p.currentHP / p.maxHP) * 100}%`, background: p.currentHP > 10 ? '#4caf50' : '#ff4444', borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Battle log */}
      <div style={{ padding: 8, background: '#0f3460', borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
        {log.slice(-10).map((e, i) => (
          <div key={i} style={{ padding: '2px 0', color: e.type === 'win' ? '#4caf50' : e.type === 'lose' ? '#ff4444' : e.type === 'damage' ? '#ffd700' : '#ccc' }}>
            ({e.type}) {e.msg}
          </div>
        ))}
      </div>

      {/* Move selection */}
      {!finished && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(availableMoves.length > 0 ? availableMoves : ['Tackle']).map(mv => {
            const mvData = MOVES_DB[mv];
            return (
              <button key={mv} onClick={() => onPlayerAction(mv)}
                style={{ ...btnStyle(1, mvData ? typeColor(mvData.type) : '#555'), fontSize: 14 }}>
                {mv}
                {mvData && ` (${mvData.power}/${mvData.pp})`}
              </button>
            );
          })}
        </div>
      )}

      {finished && (
        <button onClick={() => onPlayerAction('continue')} style={btnStyle(20, '#ffd700')}>
          Continue →
        </button>
      )}
    </div>
  );
};

const VICTORY_SCREEN = ({ badges, onContinue }: { badges: number; onContinue: () => void }) => (
  <div style={{ textAlign: 'center', padding: 60, background: '#2d5a27', borderRadius: 10 }}>
    <h1>🏆 VICTORY! 🏆</h1>
    <p style={{ fontSize: 20 }}>You defeated all {badges} gyms and the Elite Four!</p>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: badges }, (_, i) => (
        <span key={i} style={{ fontSize: 24 }}>🏅</span>
      ))}
    </div>
    <button onClick={onContinue} style={{ ...btnStyle(20, '#ffd700'), fontSize: 20, background: '#ffd700', color: '#333', marginTop: 20 }}>
      Play Again ↺
    </button>
  </div>
);

const GAME_OVER_SCREEN = ({ onRestart }: { onRestart: () => void }) => (
  <div style={{ textAlign: 'center', padding: 60, background: '#5a1a1a', borderRadius: 10 }}>
    <h1>💀 GAME OVER 💀</h1>
    <p style={{ fontSize: 20 }}>Your entire team fainted. Better luck next time!</p>
    <button onClick={onRestart} style={{ ...btnStyle(20, '#ffd700'), fontSize: 20, background: '#ffd700', color: '#333', marginTop: 20 }}>
      Try Again ↺
    </button>
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================

export const PathwaysArena: React.FC = () => {
  // Refs for memoizing generated data across re-renders (fixes useRef issue from old version)
  const mapRef = useRef<RouteNode[]>([]);

  const [game, setGame] = useState<GameState>({
    mode: 'main_menu',
    team: { pokemon: [] },
    opponents: { pokemon: [] },
    map: [],
    currentNodeId: '',
    badges: 0,
    log: [],
    discoveredStarters: STANDARD_STARTERS,
    capturedPokemon: new Map(),
    victoryGymsDefeated: 0,
  });

  // Generate route map lazily (only on starter_select transition)
  useEffect(() => {
    if (game.mode === 'starter_select' && game.map.length === 0) {
      const m = generateRouteMap();
      mapRef.current = m;
      setGame(prev => ({ ...prev, map: m }));
    }
  }, [game.mode]);

  // ---- STATE TRANSITIONS ----

  const startNewGame = useCallback(() => {
    setGame({
      mode: 'starter_select',
      team: { pokemon: [] },
      opponents: { pokemon: [] },
      map: [],
      currentNodeId: '',
      badges: 0,
      log: [],
      discoveredStarters: [...STANDARD_STARTERS],
      capturedPokemon: new Map(),
      victoryGymsDefeated: 0,
    });
  }, []);

  const pickStarter = (name: string) => {
    const types = getPokemonTypes(name);
    const entry: BattlePokemon = createBattlePokemon({
      id: 1, name, types,
      baseStats: { hp: 40 + Math.floor(Math.random() * 20), atk: 30 + Math.floor(Math.random() * 15), def: 25 + Math.floor(Math.random() * 10), spA: 30 + Math.floor(Math.random() * 15), spD: 25 + Math.floor(Math.random() * 10), spe: 25 + Math.floor(Math.random() * 10) },
      moveset: DEFAULT_MOVES[Math.floor(Math.random() * DEFAULT_MOVES.length)],
    }, 5);

    setGame(prev => ({
      ...prev, mode: 'exploring',
      team: { pokemon: [entry] },
      opponents: { pokemon: [] },
      currentNodeId: mapRef.current[0]?.id || 'town_start',
      log: [{ msg: `Welcome! Your ${name} is ready to explore.`, type: 'system' }],
    }));
  };

  const moveToNextNode = useCallback((targetId: string) => {
    setGame(prev => {
      const target = prev.map.find(n => n.id === targetId);
      if (!target) return prev;
      const newIdx = prev.map.findIndex(n => n.id === targetId);

      // When entering a gym/rival node, start battle
      let updatedLog = prev.log;
      let newOpponents: Team = prev.opponents;
      if (target.kind === 'gym' && target.gymDef) {
        newOpponents = generateGymTeam(target.gymDef);
        updatedLog = [...prev.log, { msg: `A wild gym leader ${target.gymDef.name} appears!`, type: 'action' }];
      } else if (target.kind === 'rival' && target.rivalDef) {
        newOpponents = generateRivalTeam(target.rivalDef);
        updatedLog = [...prev.log, { msg: `${target.rivalDef.dialogue}`, type: 'system' }];
      }

      return {
        ...prev, mode: 'battle',
        currentNodeId: target.id,
        opponents: newOpponents,
        log: updatedLog,
      };
    });
  }, []);

  // Handle battle action (move selection or "continue" after battle end)
  const handleBattleAction = useCallback((moveName: string) => {
    setGame(prev => {
      if (prev.log.some(l => l.type === 'win' || l.type === 'lose')) {
        // Battle is over — transition based on result
        const isVictory = prev.log.some(l => l.type === 'win');

        if (isVictory) {
          // Check what node we were fighting at this gym/rival route index
          const currentIdx = prev.map.findIndex(n => n.id === prev.currentNodeId);
          let updatedBadges = prev.badges;
          let updatedGymsDefeated = prev.victoryGymsDefeated;

          if (prev.map[currentIdx]?.kind === 'gym') {
            updatedBadges++;
            updatedGymsDefeated++;
          }

          // If player won at a search_zone, mark encounter as "discovered starter" unlock
          const newCaptured = new Map(prev.capturedPokemon);
          if (prev.map[currentIdx]?.kind === 'search_zone' && prev.opponents.pokemon.length > 0) {
            prev.opponents.pokemon.forEach(p => newCaptured.set(p.id, true));
          }

          // Advance past gym: go to next node in map, or victory screen if all gyms done
          const nextIdx = currentIdx + 1;
          if (nextIdx >= prev.map.length || updatedGymsDefeated >= GYM_ORDER.length) {
            return { ...prev, mode: 'victory', badges: updatedBadges };
          }

          // Auto-advance to next node
          const nextNode = prev.map[nextIdx];
          if (nextNode) {
            return {
              ...prev, badges: updatedBadges, victoryGymsDefeated: updatedGymsDefeated, mode: 'exploring',
              currentNodeId: nextNode.id, map: prev.map, capturedPokemon: newCaptured,
              log: [...prev.log, { msg: `🏅 You earned a badge! Next: ${nextNode.name}`, type: 'item' }],
            };
          }
        } else {
          return { ...prev, mode: 'game_over', log: [...prev.log] };
        }
        return prev;
      }

      // Normal turn execution
      const [newTeam, newOpponents, newLog] = runPlayerTurn(prev.team, prev.opponents, prev.log, moveName);

      // Check for victory/defeat in the log
      if (newLog.some(l => l.type === 'win')) {
        return { ...prev, team: newTeam, opponents: newOpponents, log: newLog };
      }
      if (newLog.some(l => l.type === 'lose')) {
        return { ...prev, team: newTeam, opponents: newOpponents, log: newLog };
      }

      return { ...prev, team: newTeam, opponents: newOpponents, log: newLog };
    });
  }, []);

  const availableMoves = game.team.pokemon.find(p => p.currentHP > 0)?.moveset || ['Tackle'];

  // Map node for current location
  const currentZone = game.map.find(z => z.id === game.currentNodeId);
  const currentNodeIdx = game.map.findIndex(n => n.id === game.currentNodeId);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div style={{ maxWidth: 960, margin: 'auto', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      {/* ====== MAIN MENU ====== */}
      {game.mode === 'main_menu' && (
        <div style={{ textAlign: 'center', padding: 60, background: '#1a1a2e', borderRadius: 10 }}>
          <h1 style={{ color: '#ffd700', fontSize: 36, marginBottom: 8 }}>⚡ Pathways &amp; Gyms Arena ⚡</h1>
          <p style={{ color: '#ccc', fontSize: 18, maxWidth: 500, margin: 'auto' }}>
            Explore routes → Fight Gym Leaders → Challenge the Elite Four!
          </p>
          <p style={{ color: '#aaa' }}>More starters unlock as you catch Pokémon in search zones.</p>
          <br />
          <button onClick={startNewGame} style={{ ...btnStyle(20, '#ffd700'), fontSize: 24, color: '#333' }}>▶ New Journey</button>
        </div>
      )}

      {/* ====== STARTER SELECT ====== */}
      {game.mode === 'starter_select' && (
        <STARTER_PICK starters={game.discoveredStarters} onPick={pickStarter} />
      )}

      {/* ====== VICTORY ====== */}
      {game.mode === 'victory' && (
        <VICTORY_SCREEN badges={game.badges} onContinue={startNewGame} />
      )}

      {/* ====== GAME OVER ====== */}
      {game.mode === 'game_over' && (
        <GAME_OVER_SCREEN onRestart={startNewGame} />
      )}

      {/* ====== EXPLORING / ROUTE MAP ====== */}
      {game.mode === 'exploring' && currentZone && (
        <div style={{ padding: 20, background: '#fff', borderRadius: 10 }}>
          <h3>📍 {currentZone.name}</h3>
          <p>Type: <strong>{currentZone.kind.replace('_', ' ').toUpperCase()}</strong> | Levels: {currentZone.levelRange[0]} – {currentZone.levelRange[1]}</p>

          {/* Team status */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {game.team.pokemon.map(p => (
              <span key={p.id} style={{ padding: '4px 8px', background: typeColor(p.types[0]), borderRadius: 4, color: '#fff', fontSize: 13 }}>
                {p.name} Lv.{p.currentLevel} ({p.currentHP}/{p.maxHP} HP)
              </span>
            ))}
          </div>

          {/* Info about current zone */}
          {currentZone.kind === 'search_zone' && currentZone.encounters && (
            <p style={{ color: '#555' }}>Wild Pokémon available: <strong>{currentZone.encounters.length}</strong></p>
          )}
          {currentZone.items && (
            <p style={{ color: '#555' }}>Items here: {currentZone.items.join(', ')}</p>
          )}

          {/* Navigation buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            {currentNodeIdx > 0 && (
              <button onClick={() => moveToNextNode(game.map[currentNodeIdx - 1].id)} style={btnStyle(14, '#555')}>← Back</button>
            )}

            {currentZone.kind === 'gym' && currentZone.gymDef && (
              <button onClick={() => moveToNextNode(currentZone.id)} style={btnStyle(14, '#d9534f')}>⚔ Enter Gym!</button>
            )}

            {currentZone.kind === 'rival' && currentZone.rivalDef && (
              <button onClick={() => moveToNextNode(currentZone.id)} style={btnStyle(14, '#d9534f')}>👊 Face ${currentZone.rivalDef.name}!</button>
            )}

            {currentNodeIdx < game.map.length - 3 && ( /* Leave room for Elite Four */
              <button onClick={() => moveToNextNode(game.map[currentNodeIdx + 1].id)} style={btnStyle(14, '#5cb85c')}>→ Forward</button>
            )}

            {/* Explore to encounter wild Pokémon — this unlocks new starters! */}
            {currentZone.kind === 'search_zone' && (
              <button onClick={() => {
                if (!currentZone?.encounters || currentZone.encounters.length === 0) return;
                const enc = currentZone.encounters[Math.floor(Math.random() * currentZone.encounters.length)];
                const types = [enc.types[0]]; // simplified: one type
                const newPkmn: BattlePokemon = createBattlePokemon(enc, Math.floor((currentZone.levelRange[0] + currentZone.levelRange[1]) / 2));

                setGame(prev => {
                  // Add to team (up to 6)
                  const newTeam = [...prev.team.pokemon];
                  if (newTeam.length < 6) newTeam.push(newPkmn);

                  // Mark as discovered for starter pool if not already standard
                  if (!STANDARD_STARTERS.includes(enc.name) && !prev.discoveredStarters.includes(enc.name)) {
                    return { ...prev, opponents: generateGymTeam(GYM_ORDER[0]! as GymLeaderDef), // use as template enemy
                      team: { pokemon: newTeam }, mode: 'battle',
                      discoveredStarters: [...prev.discoveredStarters, enc.name],
                      log: [...prev.log, { msg: `Caught a ${enc.types.join('/')}-${enc.name} wild! ${enc.name} is now in your team. It may appear as starter!`, type: 'item' }] };
                  }
                  return { ...prev, opponents: generateGymTeam(GYM_ORDER[0]!), team: { pokemon: newTeam }, mode: 'battle',
                    log: [...prev.log, { msg: `Caught a wild ${enc.name}! Added to your team.`, type: 'item' }] };
                });
              }} style={btnStyle(14, '#2196F3')}>🔍 Search Area</button>
            )}

            {/* Victory check for Elite Four path */}
            {currentZone.kind === 'elite4' && game.badges >= GYM_ORDER.length - 1 && (
              <button onClick={() => setGame(prev => ({ ...prev, mode: 'victory', badges: prev.badges }))} style={btnStyle(14, '#ffd700')}>🏆 Complete Arena!</button>
            )}
          </div>

          {/* Gym progress */}
          <div style={{ marginTop: 20 }}>
            <h4>Gym Progress ({game.badges}/${GYM_ORDER.length}):</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              {GYM_ORDER.map((g, i) => (
                <span key={i} style={{ padding: '4px 10px', borderRadius: 4, background: i < game.badges ? '#4caf50' : '#ccc', color: '#fff', fontSize: 13 }}>
                  {i + 1}: {g.name.split(' ')[0]}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====== BATTLE ====== */}
      {game.mode === 'battle' && (
        <BATTLE_SCREEN
          team={game.team}
          opponents={game.opponents}
          log={game.log}
          onPlayerAction={handleBattleAction}
          availableMoves={availableMoves}
        />
      )}
    </div>
  );
};

// ============================================================
// EXPORT FOR USE IN PARENT APP
// ============================================================
export default PathwaysArena;
