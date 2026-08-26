import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { SyncPSEngine } = require('../dist/sync-ps-engine.js');
const SEED = [7, 13, 29, 51];

function mon(overrides) {
    return {
        name: 'Mon', species: 'Mon', level: 50, ability: 'Immunity', item: '',
        nature: 'Hardy', gender: 'M', shiny: false, evs: {}, ivs: {}, moves: [],
        ...overrides,
    };
}

const engine = new SyncPSEngine({ seed: SEED, format: 'gen9customgame' });
await engine.initializeBattle(
    [
        { id: 'p1', name: 'T1', activeIndex: 0, team: [mon({ name: 'Snorlax', species: 'Snorlax', moves: ['asteroidbelt', 'tackle', 'rest', 'earthquake'] })] },
        { id: 'p2', name: 'T2', activeIndex: 0, team: [mon({ name: 'Machamp', species: 'Machamp', ability: 'Guts', moves: ['tackle', 'swift', 'celebrate', 'rest'] })] },
    ],
    { seed: SEED, autoTeamPreview: true },
);

engine.processTurn([
    { type: 'move', actorPlayerId: 'p1', playerId: 'p1', pokemonId: 'snorlax', moveId: 'asteroidbelt' },
    { type: 'move', actorPlayerId: 'p2', playerId: 'p2', pokemonId: 'machamp', moveId: 'celebrate' },
]);

const battle = engine.battle;
const bd = battle?.dex;
console.log('battle.dex === global Dex:', bd === require('pokemon-showdown').Dex);
console.log('bd.data.Moves.asteroidbelt?.condition?.onTryHit:', typeof bd?.data?.Moves?.asteroidbelt?.condition?.onTryHit);
const c = bd?.conditions.get('asteroidbelt');
console.log('bd.conditions.get.exists:', c?.exists);
console.log('bd.conditions.get.onTryHit:', typeof c?.onTryHit);
const active = battle?.sides?.find((s) => s.id === 'p1')?.active?.[0];
console.log('volatiles:', Object.keys(active?.volatiles || {}));
console.log('volatile state duration/hits:', JSON.stringify(active?.volatiles?.asteroidbelt || null));

// Replicate findPokemonEventHandlers lookup exactly
if (active && bd) {
    const volatile = bd.conditions.getByID('asteroidbelt');
    console.log('getByID onTryHit:', typeof volatile?.onTryHit);
    console.log('would collect onTryHit handler:', typeof volatile?.onTryHit === 'function' || !!active.volatiles.asteroidbelt?.duration);
}
