/**
 * test-battle-fixes.mjs
 *
 * Regression tests driving the REAL production engine (dist/sync-ps-engine.js):
 *   1. Multi-hit vanilla moves (Bullet Seed) resolve multiple hits even though
 *      the generated custom-moves data overrides them with desc-only entries.
 *   2. Asteroid Belt (SS2) blocks attacks, retaliates vs contact for 1/8 maxHP
 *      with a 5% freeze chance, and shatters after absorbing 5 attacks.
 *
 * Run: node pokemonttrpg-backend/scripts/test-battle-fixes.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SyncPSEngine } = require('../dist/sync-ps-engine.js');

const SEED = [7, 13, 29, 51]; // fixed PRNG seed => deterministic outcomes

function mon(overrides) {
    return {
        name: 'Mon',
        species: 'Mon',
        level: 50,
        ability: 'Immunity',
        item: '',
        nature: 'Hardy',
        gender: 'M',
        shiny: false,
        evs: {},
        ivs: {},
        moves: [],
        ...overrides,
    };
}

const move = (actor, pokemonId, moveId) => ({
    type: 'move',
    actorPlayerId: actor,
    playerId: actor,
    pokemonId,
    moveId,
});

async function runBattle({ p1Team, p2Team, script }) {
    const engine = new SyncPSEngine({ seed: SEED, format: 'gen9customgame' });
    const players = [
        { id: 'p1', name: 'TesterOne', team: p1Team, activeIndex: 0 },
        { id: 'p2', name: 'TesterTwo', team: p2Team, activeIndex: 0 },
    ];
    await engine.initializeBattle(players, { seed: SEED, autoTeamPreview: true });
    const allEvents = [];
    for (const actions of script) {
        const result = engine.processTurn(actions);
        const events = Array.isArray(result?.events) ? result.events : [];
        allEvents.push(...events);
    }
    return { allEvents };
}

function eventsForTurn(allEvents, turnNumber, nextTurnNumber) {
    const start = allEvents.findIndex((l) => l.startsWith(`|turn|${turnNumber}`));
    if (start < 0) return [];
    const end = nextTurnNumber != null ? allEvents.findIndex((l) => l.startsWith(`|turn|${nextTurnNumber}`)) : allEvents.length;
    return allEvents.slice(start, end < 0 ? allEvents.length : end);
}

// ── Test 1: Bullet Seed multi-hit ────────────────────────────────────────────
async function testMultiHit() {
    console.log('=== Test 1: Bullet Seed hits multiple times ===');
    const p1Team = [mon({ name: 'Machamp', species: 'Machamp', ability: 'Guts', moves: ['bulletseed', 'tackle', 'rest', 'earthquake'] })];
    const p2Team = [mon({ name: 'Blissey', species: 'Blissey', ability: 'Natural Cure', moves: ['celebrate', 'softboiled', 'sing', 'minimize'] })];
    const script = [];
    for (let i = 0; i < 10; i++) {
        script.push([move('p1', 'machamp', 'bulletseed'), move('p2', 'blissey', 'celebrate')]);
    }
    const { allEvents } = await runBattle({ p1Team, p2Team, script });
    const hitcounts = allEvents
        .filter((l) => l.startsWith('|-hitcount|'))
        .map((l) => parseInt(l.split('|')[3], 10))
        .filter((n) => Number.isFinite(n));
    const multiHitTurns = hitcounts.filter((n) => n >= 2).length;
    console.log(`  hitcounts: [${hitcounts.join(', ')}] -> turns with >=2 hits: ${multiHitTurns}`);
    if (multiHitTurns === 0) {
        console.error('  FAIL: Bullet Seed never hit more than once.');
        return false;
    }
    console.log('  PASS: multi-hit resolution works\n');
    return true;
}

// ── Test 2: Asteroid Belt ───────────────────────────────────────────────────
async function testAsteroidBelt() {
    console.log('=== Test 2: Asteroid Belt protect + contact retaliation ===');
    // Blissey target: bulky enough to survive 4 retaliations; Magma Armor
    // prevents the belt's 5% freeze proc from stalling the scripted attacker;
    // celebrate filler keeps Snorlax's own attacks from muddying attribution.
    const p1Team = [mon({ name: 'Snorlax', species: 'Snorlax', moves: ['asteroidbelt', 'celebrate', 'rest', 'earthquake'] })];
    const p2Team = [mon({ name: 'Blissey', species: 'Blissey', ability: 'Magma Armor', moves: ['tackle', 'swift', 'celebrate', 'softboiled'] })];
    const script = [
        [move('p1', 'snorlax', 'asteroidbelt'), move('p2', 'blissey', 'tackle')], // T1 contact -> blocked + retaliation
        [move('p1', 'snorlax', 'celebrate'), move('p2', 'blissey', 'swift')],     // T2 non-contact -> blocked, no retal
        [move('p1', 'snorlax', 'celebrate'), move('p2', 'blissey', 'tackle')],    // T3 hit 3
        [move('p1', 'snorlax', 'celebrate'), move('p2', 'blissey', 'tackle')],    // T4 hit 4
        [move('p1', 'snorlax', 'celebrate'), move('p2', 'blissey', 'tackle')],    // T5 hit 5 -> shatters
        [move('p1', 'snorlax', 'celebrate'), move('p2', 'blissey', 'tackle')],    // T6 lands on Snorlax
    ];
    const { allEvents } = await runBattle({ p1Team, p2Team, script });

    // NOTE: PS does not emit "|turn|1" for the first turn, so T1 is events[0..] up to |turn|2.
    const t2Start = allEvents.findIndex((l) => l.startsWith('|turn|2'));
    const t1 = allEvents.slice(0, t2Start >= 0 ? t2Start : allEvents.length);
    const t2 = eventsForTurn(allEvents, 2, 3);
    const t5 = eventsForTurn(allEvents, 5, 6);
    const t6 = eventsForTurn(allEvents, 6, null);

    const countRetaliation = (window_) => window_.filter((l) => l.includes('[from] Asteroid Belt')).length;
    const hasActivate = (window_) => window_.some((l) => l.includes('-activate') && l.includes('Asteroid Belt'));

    const checks = [
        ['belt started (-start)', allEvents.some((l) => l.startsWith('|-start|p1a') && l.includes('Asteroid Belt'))],
        ['T1 tackle blocked (activate)', hasActivate(t1)],
        ['T1 Snorlax took no damage', !t1.some((l) => l.startsWith('|-damage|p1a'))],
        ['T1 contact retaliation hit Blissey', countRetaliation(t1) >= 1],
        ['T2 swift blocked (activate)', hasActivate(t2)],
        ['T2 Snorlax took no damage', !t2.some((l) => l.startsWith('|-damage|p1a'))],
        ['T2 non-contact: NO retaliation', countRetaliation(t2) === 0],
        ['T5 fifth attack blocked then belt shattered (-end)', hasActivate(t5) && t5.some((l) => l.startsWith('|-end|p1a') && l.includes('Asteroid Belt'))],
        ['T6 attack finally landed on Snorlax', t6.some((l) => l.startsWith('|-damage|p1a'))],
        ['T6 belt no longer blocking (no activate)', !hasActivate(t6)],
    ];

    let pass = true;
    for (const [label, passed] of checks) {
        console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${label}`);
        if (!passed) pass = false;
    }
    if (!pass) {
        console.log('\n  --- full event dump ---');
        for (const l of allEvents) console.log('   ', l);
    }
    return pass;
}

(async () => {
    let ok = true;
    try { ok = (await testMultiHit()) && ok; } catch (err) { console.error('Test 1 crashed:', err); ok = false; }
    try { ok = (await testAsteroidBelt()) && ok; } catch (err) { console.error('Test 2 crashed:', err); ok = false; }
    console.log(ok ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
    process.exit(ok ? 0 : 1);
})();

