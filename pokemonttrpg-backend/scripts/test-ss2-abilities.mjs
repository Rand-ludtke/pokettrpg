/**
 * test-ss2-abilities.mjs — SS2 ability audit (real-engine battles).
 *
 * A) Static: every custom-only SS2 ability must exist in Dex.data.Abilities
 *    with the handlers from dist/data/ss2-ability-handlers.js registered.
 * B) Behavior: one real battle per mechanic class, asserting observed events
 *    match the ability description. Ethereal (user-reported broken) is first.
 *
 * Run: node scripts/test-ss2-abilities.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SyncPSEngine } = require('../dist/sync-ps-engine.js');
const ps = require('pokemon-showdown');
const generatedMoves = require('../dist/data/moves.js').default;
const ss2Handlers = require('../dist/data/ss2-ability-handlers.js');

const SEED = [7, 13, 29, 51];
let pass = 0, fail = 0;
function check(label, ok) { if (ok) { pass++; } else { fail++; console.log('  FAIL: ' + label); } return ok; }

function mon(overrides) {
    return { name: 'Mon', species: 'Snorlax', level: 50, ability: 'Immunity', item: '', nature: 'Hardy', gender: 'M', shiny: false, evs: {}, ivs: {}, moves: [], ...overrides };
}
const move = (actor, pokemonId, moveId, extra = {}) => ({ type: 'move', actorPlayerId: actor, playerId: actor, pokemonId, moveId, ...extra });
const switchAct = (actor, pokemonId, toIndex) => ({ type: 'switch', actorPlayerId: actor, playerId: actor, pokemonId, toIndex });

async function runBattle({ p1Team, p2Team, script }) {
    const engine = new SyncPSEngine({ seed: SEED, format: 'gen9customgame' });
    const players = [
        { id: 'p1', name: 'TesterOne', team: p1Team, activeIndex: 0 },
        { id: 'p2', name: 'TesterTwo', team: p2Team, activeIndex: 0 },
    ];
    await engine.initializeBattle(players, { seed: SEED, autoTeamPreview: true });
    const allEvents = [];
    let cursor = 0; // capture switch-in emissions from initializeBattle too
    for (const actions of script) {
        engine.processTurn(actions);
        const log = engine.getState().log || [];
        allEvents.push(...log.slice(cursor));
        cursor = log.length;
    }
    return allEvents;
}

// Parse final HP of a slot from |-damage|/-heal lines (e.g. "116/159").
function hpOf(events, slot) {
    let cur = null, max = null;
    for (const l of events) {
        if (l.startsWith('|-damage|' + slot + '|') || l.startsWith('|-heal|' + slot + '|')) {
            const m = l.match(/\|(\d+)\/(\d+)/);
            if (m) { cur = parseInt(m[1], 10); max = parseInt(m[2], 10); }
        }
    }
    return { cur, max };
}
function dmgPct(events, slot) {
    const h = hpOf(events, slot);
    if (!h.max) return 0;
    return 100 - Math.round(100 * (h.cur || 0) / h.max);
}

// ---------- Part A: static registration ----------
console.log('=== Part A: SS2 ability registration (' + Object.keys(ss2Handlers.patches).length + ' handlers) ===');
const Dex = ps.Dex;
{
    let missing = [], noHandler = [];
    for (const [id, patch] of Object.entries(ss2Handlers.patches)) {
        const a = Dex.data.Abilities[id];
        if (!a || a.name !== patch.name) { missing.push(id); continue; }
        const hooks = Object.keys(patch).filter((k) => k.startsWith('on') || k.endsWith('Priority'));
        if (hooks.length && !hooks.some((k) => typeof a[k] === 'function')) noHandler.push(id);
    }
    check('A: all SS2 ability handlers resolve in Dex (' + Object.keys(ss2Handlers.patches).length + ')', missing.length === 0 && noHandler.length === 0);
    if (missing.length) console.log('  missing:', missing.join(','));
    if (noHandler.length) console.log('  no handler fn:', noHandler.join(','));
    check('A: SS2 volatile conditions registered', Object.keys(ss2Handlers.conditions).every((c) => !!Dex.data.Conditions[c]));
}

// ---------- Part B: behavior battles ----------
const p2Snorlax = (moves, ability) => [mon({ species: 'Snorlax', level: 55, moves, ability: ability || 'Immunity', evs: { hp: 252 } })];

console.log('=== Part B: SS2 ability behavior battles ===');
{ // B1. Ethereal (user report): blocks the first contact hit
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Ethereal', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B1: Ethereal blocks the first contact move (|-immune|p1a)', ev.some((l) => l.startsWith('|-immune|p1a')));
    check('B1: Ethereal takes no damage from the blocked hit', !ev.some((l) => l.startsWith('|-damage|p1a')));
}
{ // B1b. Ethereal shield restored on switch-out
    const ev = await runBattle({
        p1Team: [
            mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Ethereal', evs: { hp: 252 } }),
            mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Immunity', evs: { hp: 252 } }),
        ],
        p2Team: p2Snorlax(['tackle']),
        script: [
            [move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')],  // immune (shield spent)
            [switchAct('p1', 'p1a', 1), move('p2', 'p2a', 'tackle')],    // switch out (Immunity takes slot 0)
            [switchAct('p1', 'p1b', 1), move('p2', 'p2a', 'tackle')],    // switch back to Ethereal (now at roster index 1)
            [move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')],  // immune again
        ],
    });
    const immuneCount = ev.filter((l) => l.startsWith('|-immune|p1a')).length;
    check('B1b: Ethereal shield restored on switch-out (immunes: ' + immuneCount + ')', immuneCount >= 2);
}
{ // B2. Genius: SpA doubled -> icebeam damage roughly 2x control
    const base = { species: 'Snorlax', level: 55, moves: ['icebeam'], evs: { hp: 252 } };
    const ctrl = await runBattle({ p1Team: [mon({ ...base, ability: 'Immunity' })], p2Team: p2Snorlax(['tackle']), script: [[move('p1', 'p1a', 'icebeam'), move('p2', 'p2a', 'tackle')]] });
    const test = await runBattle({ p1Team: [mon({ ...base, ability: 'Genius' })], p2Team: p2Snorlax(['tackle']), script: [[move('p1', 'p1a', 'icebeam'), move('p2', 'p2a', 'tackle')]] });
    const dCtrl = dmgPct(ctrl, 'p2a: Mon');
    const dTest = dmgPct(test, 'p2a: Mon');
    check('B2: Genius ~doubles special damage (ctrl ' + dCtrl + '% vs ' + dTest + '%)', dCtrl > 0 && dTest > dCtrl * 1.7);
}
{ // B3. Arsonist: Fire 1.5x
    const base = { species: 'Snorlax', level: 55, moves: ['flamethrower'], evs: { hp: 252 } };
    const ctrl = await runBattle({ p1Team: [mon({ ...base, ability: 'Immunity' })], p2Team: p2Snorlax(['tackle']), script: [[move('p1', 'p1a', 'flamethrower'), move('p2', 'p2a', 'tackle')]] });
    const test = await runBattle({ p1Team: [mon({ ...base, ability: 'Arsonist' })], p2Team: p2Snorlax(['tackle']), script: [[move('p1', 'p1a', 'flamethrower'), move('p2', 'p2a', 'tackle')]] });
    const dCtrl = dmgPct(ctrl, 'p2a: Mon');
    const dTest = dmgPct(test, 'p2a: Mon');
    check('B3: Arsonist boosts Fire damage ~1.5x (ctrl ' + dCtrl + '% vs ' + dTest + '%)', dCtrl > 0 && dTest > dCtrl * 1.35);
}
{ // B4. Dishearten: -1 SpA to the foe on entry
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Dishearten', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B4: Dishearten lowers foe Sp.Atk on entry', ev.some((l) => l.startsWith('|-unboost|p2a') && l.includes('spa')));
}
{ // B5. Orbit: Gravity on entry
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Orbit', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B5: Orbit sets Gravity on entry', ev.some((l) => l.startsWith('|-fieldstart|move: Gravity')));
}
{ // B6. Disarray: Trick Room on entry
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Disarray', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B6: Disarray sets Trick Room on entry', ev.some((l) => l.startsWith('|-fieldstart|move: Trick Room')));
}
{ // B7. Regrowth: restores a lowered stat at end of turn
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Regrowth', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['growl']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'growl')]],
    });
    check('B7: Regrowth restores the lowered stat (-boost|p1a|atk)', ev.some((l) => l.startsWith('|-boost|p1a') && l.includes('atk')));
}
{ // B8. Pureheart: 1/16 heal at end of turn
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Pure Heart', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B8: Pure Heart heals at end of turn', ev.some((l) => l.startsWith('|-heal|p1a')));
}
{ // B9. Cometstorm: immune to Rock + SpA/Spe boost
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Comet Storm', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['rockthrow']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'rockthrow')]],
    });
    check('B9: Comet Storm absorbs the Rock move (no damage taken)', !ev.some((l) => l.startsWith('|-damage|p1a')));
    check('B9: Comet Storm gains Sp.Atk + Speed', ev.some((l) => l.startsWith('|-boost|p1a') && l.includes('spa')) && ev.some((l) => l.startsWith('|-boost|p1a') && l.includes('spe')));
}
{ // B10. Opaqueness: immune to Light-type moves (uses a generated Light move)
    const lightMove = Object.entries(generatedMoves).find(([, m]) => m && m.isNonstandard === 'Custom' && m.type === 'Light' && m.category === 'Physical' && m.basePower > 0 && m.target === 'normal');
    check('B10 pre: a Light physical move exists (' + (lightMove ? lightMove[1].name : 'none') + ')', !!lightMove);
    if (lightMove) {
        const ev = await runBattle({
            p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Opaqueness', evs: { hp: 252 } })],
            p2Team: p2Snorlax([lightMove[0]]),
            script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', lightMove[0])]],
        });
        check('B10: Opaqueness immune to Light (|-immune|p1a)', ev.some((l) => l.startsWith('|-immune|p1a')));
    }
}
{ // B11. Forcefield: special attacker takes 1/8 recoil
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Forcefield', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['icebeam']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'icebeam')]],
    });
    check('B11: Forcefield retaliates vs special moves (|-damage|p2a)', ev.some((l) => l.startsWith('|-damage|p2a')));
}
{ // B12. Vitality: +1 Sp.Def when hit
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Vitality', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B12: Vitality raises Sp.Def when hit', ev.some((l) => l.startsWith('|-boost|p1a') && l.includes('spd')));
}
{ // B13. Unbreakable: Def drop blocked
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Unbreakable', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['leer']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'leer')]],
    });
    check('B13: Unbreakable blocks Def drop (|-fail|p1a)', ev.some((l) => l.startsWith('|-fail|p1a')) && !ev.some((l) => l.startsWith('|-unboost|p1a') && l.includes('def')));
}
{ // B14. Charisma: +1 SpA on KO (2nd mon so the battle continues to AfterFaint)
    const ev = await runBattle({
        p1Team: [mon({ species: 'Gengar', level: 100, moves: ['sludgebomb'], ability: 'Charisma' })],
        p2Team: [mon({ species: 'Snorlax', level: 30, moves: ['tackle'], ability: 'Immunity' }), mon({ species: 'Snorlax', level: 30, moves: ['tackle'], ability: 'Immunity' })],
        script: [[move('p1', 'p1a', 'sludgebomb'), move('p2', 'p2a', 'tackle')]],
    });
    check('B14: Charisma boosts Sp.Atk on KO', ev.some((l) => l.startsWith('|-boost|p1a') && l.includes('spa')));
}
{ // B15. Reaper: heals 20% on KO (2nd mon so the battle continues to AfterFaint;
    // p1a damages the holder first so the heal is observable)
    const ev = await runBattle({
        p1Team: [mon({ species: 'Gengar', level: 60, moves: ['sludgebomb'], ability: 'Immunity' }), mon({ species: 'Gengar', level: 30, moves: ['sludgebomb'], ability: 'Immunity' })],
        p2Team: [mon({ species: 'Snorlax', level: 100, moves: ['shadowball'], ability: 'Reaper', evs: { hp: 252 } })],
        script: [[move('p1', 'p1a', 'sludgebomb'), move('p2', 'p2a', 'shadowball')]],
    });
    check('B15: Reaper heals on KO (|-heal|p2a)', ev.some((l) => l.startsWith('|-heal|p2a')));
}
{ // B16. Nobility: foe priority move nullified (cant is emitted on the holder)
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle'], ability: 'Nobility', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['machpunch']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'machpunch')]],
    });
    check('B16: Nobility blocks foe priority move (|cant|p1a)', ev.some((l) => l.startsWith('|cant|p1a') && l.includes('Nobility')));
}
{ // B17. Impulsive: self stat drop after a physical move
    const ev = await runBattle({
        p1Team: [mon({ species: 'Snorlax', level: 55, moves: ['tackle', 'icebeam'], ability: 'Impulsive', evs: { hp: 252 } })],
        p2Team: p2Snorlax(['tackle']),
        script: [[move('p1', 'p1a', 'tackle'), move('p2', 'p2a', 'tackle')]],
    });
    check('B17: Impulsive lowers its own Atk after a physical move', ev.some((l) => l.startsWith('|-unboost|p1a') && l.includes('atk')));
}

console.log('');
console.log('================================');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
console.log('================================');
process.exit(fail === 0 ? 0 : 1);
