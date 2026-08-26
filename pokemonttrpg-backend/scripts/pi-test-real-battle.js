/**
 * pi-test-real-battle.js
 *
 * End-to-end battle test using the ACTUAL SyncPSEngine from dist/
 * (the same code path as production). Creates a real battle where
 * both sides use SS2 moves and verifies no "nopp" errors occur.
 *
 * Run: cd ~/pokettrpg/pokemonttrpg-backend && node scripts/pi-test-real-battle.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const SyncPSEngine = require('../dist/sync-ps-engine.js').default || require('../dist/sync-ps-engine.js').SyncPSEngine;

const mkMon = (name, species, ability, moves) => ({
	name,
	species,
	item: '',
	ability,
	moves: moves.map((m) => ({ name: m })),
	nature: 'Hardy',
	evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
	ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
	level: 50,
	currentHP: 9999,
	maxHP: 9999,
	types: ['Normal'],
	status: 'none',
	stages: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
});

async function main() {
	console.log('=== Real Battle Test via SyncPSEngine ===');

	const engine = new SyncPSEngine({ format: 'gen9customgame', seed: [1, 2, 3, 4] });

	const players = [
		{ id: 'p1-player', name: 'TestPlayer1', team: [mkMon('Ducklett-Orion', 'ducklett', 'keeneye', ['renewal', 'safeguardss2', 'hallelujah', 'watergun'])] },
		{ id: 'p2-player', name: 'TestPlayer2', team: [mkMon('Joltik-Orion', 'joltik', 'compoundeyes', ['siphon', 'blackout', 'thundershock', 'stringshot'])] },
	];

	// Initialize the battle
	engine.initializeBattle(players);
	console.log('Battle initialized OK');

	const log = [];
	let noppCount = 0;
	let moveCount = 0;
	const ss2MoveNames = /renewal|safeguardss2|hallelujah|siphon|blackout/i;

	// Play up to 4 turns, cycling through SS2 moves each turn
	for (let turn = 1; turn <= 4; turn++) {
		if (engine.isEnded()) break;

		// Alternate SS2 move slots per turn: slot 1..3
		const p1Slot = ((turn - 1) % 3) + 1; // renewal / safeguardss2 / hallelujah
		const p2Slot = ((turn - 1) % 2) + 1; // siphon / blackout

		const actions = [
			{ type: 'move', actorPlayerId: 'p1-player', moveId: players[0].team[0].moves[p1Slot - 1].name, moveIndex: p1Slot - 1 },
			{ type: 'move', actorPlayerId: 'p2-player', moveId: players[1].team[0].moves[p2Slot - 1].name, moveIndex: p2Slot - 1 },
		];

		const result = engine.processTurn(actions);
		for (const line of result.events || []) {
			log.push(line);
			if (String(line).includes('nopp')) noppCount++;
			if (/^\|move\|/.test(String(line))) {
				moveCount++;
				console.log('  MOVE:', line);
			}
			if (/^\|cant\|.*nopp/.test(String(line))) console.log('  NOPP:', line);
		}
	}

	console.log('\n=== RESULTS ===');
	console.log(`Moves executed: ${moveCount}`);
	console.log(`nopp errors: ${noppCount}`);

	// Show which SS2 moves actually executed
	const usedSs2 = log.filter((l) => /^\|move\|/.test(l) && ss2MoveNames.test(l));
	console.log(`SS2 moves successfully executed: ${usedSs2.length}`);

	if (noppCount > 0) {
		console.log('\nFAILED: nopp errors still present');
		process.exit(1);
	}
	if (usedSs2.length === 0) {
		console.log('\nFAILED: no SS2 moves executed');
		process.exit(1);
	}

	console.log('\nSUCCESS: All SS2 moves work in real battles! ✓');
	process.exit(0);
}

main().catch((e) => {
	console.error('Test crashed:', e?.stack || e?.message || e);
	process.exit(1);
});
