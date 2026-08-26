/**
 * pi-diagnose-dex.js
 *
 * Diagnoses why battles report nopp even though moves exist in global Dex.
 * Checks whether the Battle object uses a different Dex instance.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const ps = require('pokemon-showdown');
const { Battle, Teams } = ps;

// Load custom moves into GLOBAL dex like sync-ps-engine does
const cm = require('../dist/data/moves.js').default || require('../dist/data/moves.js');
Object.assign(ps.Dex.data.Moves, cm);
console.log('Global Dex renewal pp:', ps.Dex.data.Moves.renewal?.pp);
console.log('Global Dex safeguardss2 pp:', ps.Dex.data.Moves.safeguardss2?.pp);

// Now create a battle and inspect ITS dex
const team = Teams.pack([{
	name: 'TestMon', species: 'ducklett', item: '', ability: 'keeneye',
	moves: ['renewal', 'safeguardss2', 'watergun', 'quickattack'],
	nature: 'Hardy', evs: {}, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
}]);

let battle;
try {
	battle = new Battle({
		formatid: 'gen9customgame',
		seed: [1, 2, 3, 4],
		p1: { name: 'P1', avatar: 'acetrainer', team },
		p2: { name: 'P2', avatar: 'acetrainer', team },
	});
	console.log('Battle created');
} catch (e) {
	console.error('Battle creation FAILED:', e.message);
	process.exit(1);
}

// Check the battle's own dex reference
console.log('\n=== DEX IDENTITY ===');
console.log('battle.dex exists:', !!battle.dex);
if (battle.dex) {
	console.log('battle.dex === ps.Dex:', battle.dex === ps.Dex);
	const bd = battle.dex;
	console.log('battle.dex.data.Moves renewal:', bd.data?.Moves?.renewal ? `pp=${bd.data.Moves.renewal.pp}` : 'MISSING');
	console.log('battle.dex.data.Moves safeguardss2:', bd.data?.Moves?.safeguardss2 ? `pp=${bd.data.Moves.safeguardss2.pp}` : 'MISSING');

	// Try Dex.moves.get lookup (cached accessor)
	try {
		const mv = bd.moves.get('renewal');
		console.log('battle.dex.moves.get(renewal):', mv && mv.exists ? `pp=${mv.pp}` : JSON.stringify(mv));
	} catch (e) {
		console.log('moves.get error:', e.message);
	}
}

// Check the actual pokemon move slots after start
try {
	if (typeof battle.start === 'function') {
		battle.start();
		battle.choose('p1', 'move 1');
		battle.choose('p2', 'move 1');
	}
} catch (e) { /* ignore */ }

const p1mon = battle.sides?.[0]?.active?.[0] || battle.p1?.active?.[0];
console.log('\n=== POKEMON MOVE SLOTS ===');
if (p1mon) {
	console.log('Active mon:', p1mon.name || p1mon.species);
	for (const slot of p1mon.moveSlots || p1mon.baseMoveSlots || []) {
		console.log(`  slot: ${slot.move} id=${slot.id} pp=${slot.pp}/${slot.maxpp}`);
	}
} else {
	console.log('No active pokemon found');
}

// Check log for nopp
const noppLines = (battle.log || []).filter((l) => String(l).includes('nopp'));
console.log('\nnopp lines in battle log:', noppLines.length ? noppLines : '(none)');
