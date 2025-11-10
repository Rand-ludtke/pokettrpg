/**
 * Main entry file for Pokémon TTRPG Battle App
 *
 * Current responsibilities:
 *  - Import Pokémon data from pokedex.ts/js
 *  - Build PC Box (list of all Pokémon with stats calculated using TTRPG rules)
 *  - Provide functions to:
 *      - View Pokémon details
 *      - Create a Team
 *      - Track HP and stat changes during a battle session
 *
 * Future upgrades:
 *  - Add battle engine (damage calc, type matchups, turn order, dodge/block/counter mechanics)
 *  - Add Showdown integration (import/export teams, use battle formats)
 *  - Add UI (web or desktop app)
 *  - Multiplayer / Online play
 */

// -----------------------------
// Imports
// -----------------------------
import { Pokedex } from "./pokedex"; // <-- JSON or TS object of Pokémon data
// Each Pokémon entry should include base stats, typing, abilities, and moves

// -----------------------------
// Types
// -----------------------------
interface Pokemon {
  name: string;
  level: number;
  type: string[];
  ability: string;
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    spAtk: number;
    spDef: number;
    speed: number;
  };
  moves: Move[];
}

interface Move {
  name: string;
  type: string;
  power: number; // base move power
  category: "Physical" | "Special" | "Status";
  effect?: string; // status chance, recoil, etc
}

interface BattlePokemon extends Pokemon {
  currentHp: number;
  statStages: {
    atk: number;
    def: number;
    spAtk: number;
    spDef: number;
    speed: number;
  };
}

// -----------------------------
// Utility functions (stubs for now)
// -----------------------------

/**
 * Calculate Pokémon HP for TTRPG rules:
 * (Base HP ÷ 2) + Level
 */
function calculateHp(baseHp: number, level: number): number {
  return Math.floor(baseHp / 2) + level;
}

/**
 * Convert base attack/special attack into modifier
 */
function getAttackModifier(baseStat: number): number {
  if (baseStat >= 200) return 7;
  if (baseStat >= 150) return 5;
  if (baseStat >= 120) return 4;
  if (baseStat >= 100) return 3;
  if (baseStat >= 80) return 2;
  if (baseStat >= 60) return 1;
  return 0;
}

/**
 * Convert base defense/special defense into damage reduction
 */
function getDefenseModifier(baseStat: number): number {
  if (baseStat >= 150) return -4;
  if (baseStat >= 120) return -3;
  if (baseStat >= 100) return -2;
  if (baseStat >= 80) return -1;
  if (baseStat >= 60) return 0;
  return +1;
}

/**
 * Convert move power into dice roll (damage dice)
 */
function getMoveDice(power: number): string {
  if (power >= 120) return "d20";
  if (power >= 85) return "d12";
  if (power >= 75) return "d10";
  if (power >= 60) return "d8";
  if (power >= 30) return "d6";
  return "d4";
}

// -----------------------------
// PC Box Logic
// -----------------------------

/**
 * Build a "Battle-ready Pokémon" from the Pokedex
 * (includes current HP and initialized stat stages)
 */
function preparePokemon(entry: Pokemon): BattlePokemon {
  return {
    ...entry,
    currentHp: calculateHp(entry.baseStats.hp, entry.level),
    statStages: {
      atk: 0,
      def: 0,
      spAtk: 0,
      spDef: 0,
      speed: 0,
    },
  };
}

/**
 * Display PC Box (list of all Pokémon with summary info)
 */
function showPcBox(): BattlePokemon[] {
  return Pokedex.map(preparePokemon);
}

// -----------------------------
// Team Management
// -----------------------------

let activeTeam: BattlePokemon[] = [];

/**
 * Add Pokémon to active team (max 6)
 */
function addToTeam(pokemon: BattlePokemon): void {
  if (activeTeam.length >= 6) {
    console.log("Team is full!");
    return;
  }
  activeTeam.push(pokemon);
  console.log(`${pokemon.name} added to team.`);
}

/**
 * Remove Pokémon from team
 */
function removeFromTeam(name: string): void {
  activeTeam = activeTeam.filter(p => p.name !== name);
  console.log(`${name} removed from team.`);
}

/**
 * Show current team
 */
function showTeam(): void {
  console.log("Active Team:");
  activeTeam.forEach(p => {
    console.log(`${p.name} | HP: ${p.currentHp}`);
  });
}

// -----------------------------
// Battle Tracking (simplified for now)
// -----------------------------

/**
 * Apply damage to a Pokémon
 */
function applyDamage(target: BattlePokemon, damage: number): void {
  target.currentHp = Math.max(0, target.currentHp - damage);
  console.log(`${target.name} took ${damage} damage! HP: ${target.currentHp}`);
}

/**
 * Heal a Pokémon
 */
function healPokemon(target: BattlePokemon, heal: number): void {
  const maxHp = calculateHp(target.baseStats.hp, target.level);
  target.currentHp = Math.min(maxHp, target.currentHp + heal);
  console.log(`${target.name} healed ${heal} HP! HP: ${target.currentHp}`);
}

// -----------------------------
// MAIN
// -----------------------------

function main() {
  console.log("=== Pokémon TTRPG App ===");

  const pcBox = showPcBox();
  console.log("PC Box loaded:", pcBox.map(p => p.name));

  // Example usage:
  addToTeam(pcBox[0]);
  addToTeam(pcBox[1]);
  showTeam();

  // Apply some test damage
  applyDamage(activeTeam[0], 12);
  healPokemon(activeTeam[0], 5);
}

main();
