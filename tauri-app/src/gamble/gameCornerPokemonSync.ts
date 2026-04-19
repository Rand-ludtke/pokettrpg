import {
  dexNumToName,
  loadShowdownDex,
  normalizeName,
  prepareBattle,
  speciesAbilityOptions,
  toPokemon,
  type DexIndex,
  type ItemEntry,
  type ItemIndex,
  type MoveEntry,
  type MoveIndex,
} from '../data/adapter';
import { appendBattlePokemonToPc, loadImportedSignatures, persistImportedSignatures } from '../data/pcStorage';
import type { BattlePokemon, Move } from '../types';
import type { ParsedEmeraldMon, ParsedEmeraldSave } from './emeraldSave';

interface RewardPokemonInput {
  species: string;
  level: number;
  shiny?: boolean;
  nickname?: string;
}

interface SyncContext {
  dex: DexIndex;
  moveLookup: Map<string, Move>;
  itemLookup: Map<number, string>;
}

export interface ImportedGameCornerPokemonResult {
  importedCount: number;
  duplicateCount: number;
  droppedCount: number;
  unsupportedCount: number;
}

let syncContextPromise: Promise<SyncContext> | null = null;

function buildMoveLookup(moves: MoveIndex): Map<string, Move> {
  const result = new Map<string, Move>();

  for (const move of Object.values(moves)) {
    if (!move?.name) continue;
    result.set(normalizeName(move.name), {
      name: move.name,
      type: move.type,
      power: move.basePower,
      category: move.category,
      accuracy: move.accuracy,
      secondary: move.secondary ?? move.secondaries?.[0] ?? null,
    });
  }

  return result;
}

function buildNumberLookup(table: ItemIndex): Map<number, string> {
  const result = new Map<number, string>();

  for (const entry of Object.values(table) as Array<ItemEntry & { num?: number }>) {
    if (!entry?.name || typeof entry.num !== 'number') continue;
    result.set(entry.num, entry.name);
  }

  return result;
}

async function getSyncContext(): Promise<SyncContext> {
  if (!syncContextPromise) {
    syncContextPromise = loadShowdownDex().then((data) => ({
      dex: data.pokedex,
      moveLookup: buildMoveLookup(data.moves as MoveIndex & Record<string, MoveEntry>),
      itemLookup: buildNumberLookup(data.items as ItemIndex & Record<string, ItemEntry & { num?: number }>),
    }));
  }

  return syncContextPromise;
}

function selectAbility(speciesName: string, abilitySlot: 0 | 1, dex: DexIndex): string | undefined {
  const options = speciesAbilityOptions(speciesName, dex);
  if (!options.length) return undefined;
  return options[Math.min(abilitySlot, options.length - 1)];
}

function resolveSpeciesName(mon: ParsedEmeraldMon): string {
  return dexNumToName(mon.speciesId) || mon.speciesName;
}

function buildMoves(mon: ParsedEmeraldMon, moveLookup: Map<string, Move>): Move[] {
  const out: Move[] = [];

  for (const moveName of mon.moveNames) {
    const move = moveLookup.get(normalizeName(moveName));
    if (move) out.push(move);
    if (out.length >= 4) break;
  }

  return out;
}

function buildBattlePokemonFromParsedMon(mon: ParsedEmeraldMon, context: SyncContext): BattlePokemon | null {
  const speciesName = resolveSpeciesName(mon);
  const pokemon = toPokemon(speciesName, context.dex, mon.level);
  if (!pokemon) return null;

  const canonicalSpecies = pokemon.species || pokemon.name;
  const nickname = mon.nickname?.trim();
  pokemon.name = nickname && normalizeName(nickname) !== normalizeName(canonicalSpecies)
    ? nickname
    : canonicalSpecies;
  pokemon.level = mon.level;
  pokemon.shiny = mon.shiny;
  pokemon.ivs = { ...mon.ivs };
  pokemon.evs = { ...mon.evs };

  const ability = selectAbility(canonicalSpecies, mon.abilitySlot, context.dex);
  if (ability) pokemon.ability = ability;

  const heldItem = context.itemLookup.get(mon.heldItemId);
  if (heldItem && normalizeName(heldItem) !== 'none') {
    pokemon.item = heldItem;
  }

  const moves = buildMoves(mon, context.moveLookup);
  if (moves.length) pokemon.moves = moves;

  return prepareBattle(pokemon);
}

export async function importParsedEmeraldSaveToPc(parsed: ParsedEmeraldSave): Promise<ImportedGameCornerPokemonResult> {
  const context = await getSyncContext();
  const importedSignatures = loadImportedSignatures();
  const candidates = [...parsed.party, ...parsed.boxes];
  const queued: Array<{ signature: string; pokemon: BattlePokemon }> = [];
  let duplicateCount = 0;
  let unsupportedCount = 0;

  for (const mon of candidates) {
    if (importedSignatures.has(mon.signature)) {
      duplicateCount += 1;
      continue;
    }

    const built = buildBattlePokemonFromParsedMon(mon, context);
    if (!built) {
      unsupportedCount += 1;
      continue;
    }

    queued.push({ signature: mon.signature, pokemon: built });
  }

  const appendResult = appendBattlePokemonToPc(queued.map((entry) => entry.pokemon));
  if (appendResult.added > 0) {
    for (const signature of queued.slice(0, appendResult.added).map((entry) => entry.signature)) {
      importedSignatures.add(signature);
    }
    persistImportedSignatures(importedSignatures);
  }

  return {
    importedCount: appendResult.added,
    duplicateCount,
    droppedCount: appendResult.dropped,
    unsupportedCount,
  };
}

export async function addPrizePokemonToPc(rewards: RewardPokemonInput[]): Promise<{
  added: number;
  dropped: number;
  pokemon: BattlePokemon[];
}> {
  if (!rewards.length) {
    return { added: 0, dropped: 0, pokemon: [] };
  }

  const context = await getSyncContext();
  const pokemon: BattlePokemon[] = [];

  for (const reward of rewards) {
    const base = toPokemon(reward.species, context.dex, reward.level);
    if (!base) continue;
    const canonicalSpecies = base.species || base.name;
    base.name = reward.nickname?.trim() || canonicalSpecies;
    base.shiny = Boolean(reward.shiny);
    pokemon.push(prepareBattle(base));
  }

  const appendResult = appendBattlePokemonToPc(pokemon);
  return {
    added: appendResult.added,
    dropped: appendResult.dropped,
    pokemon,
  };
}