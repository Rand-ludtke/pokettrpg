/**
 * Synchronous Pokemon Showdown Battle Engine
 * 
 * This provides a synchronous interface to the PS BattleStream by running
 * the battle simulation synchronously (PS simulator supports this mode).
 */

import {
	BattleState,
	BattleAction,
	MoveAction,
	SwitchAction,
	TurnResult,
	AnimationEvent,
	BattleInitializeOptions,
	BattleStartConditions,
	Player,
	Pokemon,
	NonVolatileStatusId,
} from "./types";

// Import Pokemon Showdown simulator
const ps = require("pokemon-showdown");
const { Battle: PSBattle, Teams, PRNG, Dex } = ps;

interface PSRequest {
	rqid?: number;
	teamPreview?: boolean;
	forceSwitch?: boolean[];
	wait?: boolean;
	active?: Array<{
		moves: Array<{
			id: string;
			name: string;
			pp: number;
			maxpp: number;
			disabled?: boolean;
			target: string;
		}>;
		trapped?: boolean;
		canMegaEvo?: boolean;
	}>;
	side?: {
		name: string;
		id: string;
		pokemon: Array<{
			ident: string;
			details: string;
			condition: string;
			active: boolean;
			stats: { atk: number; def: number; spa: number; spd: number; spe: number };
			moves: string[];
			baseAbility: string;
			item: string;
			pokeball: string;
			ability?: string;
		}>;
	};
}

/**
 * SyncPSEngine provides a synchronous interface to Pokemon Showdown's battle simulation.
 * It uses PS's Battle class directly (not the stream) for synchronous operation.
 */
export class SyncPSEngine {
	private battle: InstanceType<typeof PSBattle> | null = null;
	private state!: BattleState;
	private playerIdToSide: Map<string, "p1" | "p2"> = new Map();
	private sideToPlayerId: Map<"p1" | "p2", string> = new Map();
	private format: string;
	private lastLogIndex = 0;
	private startSent = false; // Track if |start| has already been emitted
	private initialProtocolComplete = false; // Track when initial start/switch/turn phase is complete
	private seenInitialLines = new Set<string>();
	private seenInitialSwitches = new Set<string>();
	private seenInitialTurns = new Set<number>();
	private rules?: any; // Battle rules/clauses

	constructor(private readonly options?: { format?: string; seed?: number | number[]; rules?: any }) {
		this.format = options?.format || "gen9customgame";
		this.rules = options?.rules;
	}

	/**
	 * Initialize a battle with the given players.
	 * Teams should be in our Pokemon format - they will be converted to PS packed format.
	 */
	initializeBattle(players: Player[], options?: BattleInitializeOptions): BattleState {
		// Reset protocol tracking for a fresh battle
		this.lastLogIndex = 0;
		this.startSent = false;
		this.initialProtocolComplete = false;
		this.seenInitialLines.clear();
		this.seenInitialSwitches.clear();
		this.seenInitialTurns.clear();

		const seed = options?.seed || this.options?.seed;
		const seedArray = Array.isArray(seed) ? seed : seed ? [seed, seed, seed, seed] : PRNG.generateSeed();

		// Map player IDs to sides
		this.playerIdToSide.set(players[0].id, "p1");
		this.playerIdToSide.set(players[1].id, "p2");
		this.sideToPlayerId.set("p1", players[0].id);
		this.sideToPlayerId.set("p2", players[1].id);

		// Convert our teams to PS packed format
		const p1Team = this.convertTeamToPacked(players[0].team);
		const p2Team = this.convertTeamToPacked(players[1].team);

		// Extract avatar/trainerSprite for PS protocol
		// IMPORTANT: Default to 'acetrainer' not empty string - PS client calls rollTrainerSprites() if avatar is falsy
		const p1Avatar = (players[0] as any).trainerSprite || (players[0] as any).avatar || "acetrainer";
		const p2Avatar = (players[1] as any).trainerSprite || (players[1] as any).avatar || "acetrainer";

		// Create the battle directly (synchronous)
		this.battle = new PSBattle({
			formatid: this.format as any,
			seed: seedArray,
			p1: { name: players[0].name, avatar: p1Avatar, team: p1Team },
			p2: { name: players[1].name, avatar: p2Avatar, team: p2Team },
		});

		// Initialize our state mirror
		this.state = {
			turn: 0,
			rngSeed: seedArray[0],
			players: players.map((p, idx) => ({
				...p,
				team: p.team.map((mon) => ({ ...mon })),
			})),
			field: {
				weather: { id: "none", turnsLeft: 0 },
				terrain: { id: "none", turnsLeft: 0 },
				room: { id: "none", turnsLeft: 0 },
				magicRoom: { id: "none", turnsLeft: 0 },
				wonderRoom: { id: "none", turnsLeft: 0 },
			},
			log: [],
			coinFlipWinner: undefined,
		};

		// Start the battle if the simulator exposes start()
		if (this.battle && typeof (this.battle as any).start === "function") {
			const alreadyStarted = (this.battle as any).started || (this.battle as any).turn > 0;
			if (!alreadyStarted) {
				try {
					(this.battle as any).start();
				} catch (err: any) {
					const msg = String(err?.message || err || "");
					if (!/already started/i.test(msg)) {
						throw err;
					}
				}
			}
		}

		// Sync initial state
		this.syncStateFromPS();

		// Auto-complete Team Preview if needed (server handles ordering before this)
		if (this.battle) {
			const p1 = this.battle.p1 as any;
			const p2 = this.battle.p2 as any;
			const p1TeamSize = this.state.players?.[0]?.team?.length || 6;
			const p2TeamSize = this.state.players?.[1]?.team?.length || 6;
			const buildTeamOrder = (size: number) => `team ${Array.from({ length: size }, (_v, i) => i + 1).join("")}`;
			
			if (p1?.request?.teamPreview) {
				this.battle.choose("p1", buildTeamOrder(p1TeamSize));
			}
			if (p2?.request?.teamPreview) {
				this.battle.choose("p2", buildTeamOrder(p2TeamSize));
			}
			
			// Re-sync state in case turn advanced
			this.syncStateFromPS();
		}

		this.applyStartConditions(options?.startConditions ?? this.rules?.startConditions);
		this.syncStateFromPS();

		// Capture initial PS log entries (setup, switch-ins, turn start)
		this.collectNewLogEntries();

		return this.state;
	}

	/**
	 * Convert our Pokemon team to PS packed format
	 */
	private convertTeamToPacked(team: Pokemon[]): string {
		const sets = team.map((mon) => ({
			name: mon.nickname || mon.name,
			species: mon.name,
			item: mon.item || "",
			ability: mon.ability || "",
			moves: mon.moves.map((m) => m.name || m.id),
			nature: (mon as any).nature || "Hardy",
			evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(mon as any).evs },
			ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...(mon as any).ivs },
			level: mon.level,
			shiny: !!(mon as any).shiny,
			gender: (mon as any).gender || "",
			teraType: (mon as any).teraType || "",
		}));
		return Teams.pack(sets);
	}

	/**
	 * Get the current request for a player
	 */
	getRequest(playerId: string): PSRequest | null {
		if (!this.battle) return null;
		const side = this.playerIdToSide.get(playerId);
		if (!side) return null;
		
		const psSide = this.battle.sides.find((s: any) => s.id === side);
		return psSide?.activeRequest || null;
	}

	/**
	 * Get the active Pokemon's moves with current PP directly from PS engine
	 * This is useful as a fallback when activeRequest is not available
	 */
	getActiveMovesPP(playerId: string): Array<{ id: string; name: string; pp: number; maxpp: number; target: string; disabled: boolean }> | null {
		if (!this.battle) return null;
		const side = this.playerIdToSide.get(playerId);
		if (!side) return null;

		const psSide = this.battle.sides.find((s: any) => s.id === side);
		if (!psSide) return null;

		const activePokemon = psSide.active?.[0];
		if (!activePokemon) return null;

		// PS stores move data in moveSlots array
		const moveSlots = activePokemon.moveSlots || activePokemon.baseMoveSlots || [];
		return moveSlots.map((slot: any) => ({
			id: slot.id || slot.move?.toLowerCase().replace(/[^a-z0-9]/g, '') || '',
			name: slot.move || slot.name || '',
			pp: slot.pp ?? slot.maxpp ?? 10,
			maxpp: slot.maxpp ?? 10,
			target: slot.target || 'normal',
			disabled: slot.disabled || false,
		}));
	}

	/**
	 * Check if a player needs to make a force switch
	 */
	needsForceSwitch(playerId: string): boolean {
		const req = this.getRequest(playerId);
		return !!(req?.forceSwitch?.some((f: boolean) => f));
	}

	/**
	 * Submit a force switch choice
	 */
	forceSwitch(playerId: string, toIndex: number): TurnResult {
		if (!this.battle) {
			return { state: this.state, events: [], anim: [] };
		}

		const side = this.playerIdToSide.get(playerId);
		if (!side) {
			return { state: this.state, events: [], anim: [] };
		}

		const events: string[] = [];
		const anim: AnimationEvent[] = [];

		// Submit the switch choice
		// PS uses 1-based indices for switches
		const success = this.battle.choose(side, `switch ${toIndex + 1}`);
		
		if (!success) {
			console.error(`[SyncPSEngine] forceSwitch failed for ${side}`);
		}

		// If all choices are done, the battle will auto-process
		// Collect log entries
		events.push(...this.collectNewLogEntries());
		anim.push(...this.parseLogToAnimations(events));

		// Sync state
		this.syncStateFromPS();

		return { state: this.state, events, anim };
	}

	/**
	 * Process a turn with the given actions
	 */
	processTurn(actions: BattleAction[]): TurnResult {
		if (!this.battle) {
			return { state: this.state, events: ["Battle not initialized"], anim: [] };
		}

		const events: string[] = [];
		const anim: AnimationEvent[] = [];
		const prevTurn = this.state.turn;

		// Group actions by player
		const actionsByPlayer = new Map<string, BattleAction>();
		for (const action of actions) {
			actionsByPlayer.set(action.actorPlayerId, action);
		}

		// Submit choices for each player
		for (const [playerId, action] of actionsByPlayer) {
			const side = this.playerIdToSide.get(playerId);
			if (!side) continue;

			const choice = this.actionToChoice(action, side);
			if (choice) {
				console.log(`[DIAG-PROTOCOL] [engine] choose side=${side} player=${playerId} choice=${choice}`);
				const success = this.battle.choose(side, choice);
				if (!success) {
					console.error(`[SyncPSEngine] Choice failed for ${side}: ${choice}`);
					// Try a default choice
					this.battle.choose(side, "default");
				}
			}
		}

		// Ensure decisions are committed if the simulator didn't advance the turn
		if (this.battle && typeof (this.battle as any).commitDecisions === "function") {
			if (this.battle.turn === prevTurn) {
				console.log(`[DIAG-PROTOCOL] [engine] commitDecisions (turn=${this.battle.turn}, prev=${prevTurn})`);
				try {
					(this.battle as any).commitDecisions();
				} catch (err: any) {
					console.error(`[SyncPSEngine] commitDecisions failed:`, err?.stack || err);
				}
			}
		}

		// Collect log entries after the turn processes
		events.push(...this.collectNewLogEntries());
		if (events.length > 0) {
			const hasStart = events.some((l) => l === "|start" || l.startsWith("|start|"));
			const hasTurn = events.some((l) => l.startsWith("|turn|"));
			const sample = events.slice(0, 8);
			console.log(`[DIAG-PROTOCOL] [engine] turn=${this.battle.turn} events=${events.length} start=${hasStart} turnLine=${hasTurn} sample=${JSON.stringify(sample)}`);
		}
		anim.push(...this.parseLogToAnimations(events));

		// Update our state
		this.syncStateFromPS();
		this.state.turn = this.battle.turn;

		// If Unlimited Terastallization clause is enabled, re-enable canTerastallize for all Pokemon after each turn
		if (this.hasUnlimitedTeraClause()) {
			this.resetTerastallizeForAll();
		}

		return { state: this.state, events, anim };
	}

	/**
	 * Check if the unlimited terastallization clause is enabled
	 */
	private hasUnlimitedTeraClause(): boolean {
		const clauses = this.rules?.clauses;
		const clauseList = Array.isArray(clauses)
			? clauses.map((c: any) => String(c).toLowerCase())
			: (typeof clauses === 'string' ? clauses.split(/\s*,\s*/) : []);
		const customRules = String(this.rules?.customRules || this.rules?.displayString || '').toLowerCase();
		const hasClause = clauseList.includes('unlimitedtera') || customRules.includes('unlimitedtera');
		console.log(`[SyncPSEngine] hasUnlimitedTeraClause check: rules=${JSON.stringify(this.rules)}, clauses=${JSON.stringify(clauses)}, result=${hasClause}`);
		return hasClause;
	}

	/**
	 * Re-enable canTerastallize for all Pokemon (for unlimited tera clause)
	 */
	private resetTerastallizeForAll(): void {
		if (!this.battle) return;
		console.log('[SyncPSEngine] resetTerastallizeForAll called - re-enabling tera for all Pokemon');
		let resetCount = 0;
		for (const side of this.battle.sides) {
			// Reset side-level tera flags so another Pokemon can terastallize
			if (side && typeof (side as any).canTerastallize !== 'undefined') {
				(side as any).canTerastallize = true;
			}
			if (side && typeof (side as any).teraUsed !== 'undefined') {
				(side as any).teraUsed = false;
			}
			for (const pokemon of (side as any).pokemon || []) {
				// Only re-enable if the Pokemon has a tera type and hasn't already terastallized this turn
				if (pokemon.teraType && !pokemon.terastallized) {
					pokemon.canTerastallize = pokemon.teraType;
					resetCount++;
					console.log(`[SyncPSEngine] Reset canTerastallize for ${pokemon.name || pokemon.species}: teraType=${pokemon.teraType}`);
				}
			}
		}
		console.log(`[SyncPSEngine] resetTerastallizeForAll complete - reset ${resetCount} Pokemon`);
	}

	/**
	 * Collect new log entries from PS battle
	 * Filters out duplicate |start| blocks that PS may generate
	 */
	private collectNewLogEntries(): string[] {
		if (!this.battle) return [];
		
		const log = this.battle.log || [];
		const newEntries: string[] = [];

		// If the battle log was reset, rewind our cursor.
		if (this.lastLogIndex > log.length) {
			this.lastLogIndex = 0;
		}

		if (log.length > this.lastLogIndex) {
			const slice = log.slice(this.lastLogIndex);
			
			// Track if we see a duplicate |start| block
			let inDuplicateStartBlock = false;
			let seenTurnInBlock = false;
			
			for (const entry of slice) {
				// Mark initial protocol complete when we see real action lines or later turns
				if (!this.initialProtocolComplete) {
					const actionLine = this.isActionProtocolLine(entry);
					const turnNum = this.extractTurnNumber(entry);
					if (actionLine || (typeof turnNum === "number" && turnNum >= 2)) {
						this.initialProtocolComplete = true;
					}
				}

				// If we see |start| and we've already sent start, skip this block
				if (entry === "|start" || entry.startsWith("|start|")) {
					if (this.startSent) {
						inDuplicateStartBlock = true;
						seenTurnInBlock = false;
						console.log(`[SyncPSEngine] Skipping duplicate |start| block`);
						continue;
					} else {
						this.startSent = true;
					}
				}
				
				// If we're in a duplicate start block, skip until we see |turn|
				// Then skip the duplicate |turn| too
				if (inDuplicateStartBlock) {
					if (entry.startsWith("|turn|")) {
						if (!seenTurnInBlock) {
							seenTurnInBlock = true;
							continue; // Skip the duplicate turn line
						}
						// Second turn line means we're past the duplicate block
						inDuplicateStartBlock = false;
					} else {
						continue; // Skip lines in duplicate start block
					}
				}
				
				// During initial protocol phase, aggressively dedupe setup/switch/turn lines
				if (!this.initialProtocolComplete && this.isInitialProtocolLine(entry)) {
					const switchKey = this.extractSwitchKey(entry);
					const turnNum = this.extractTurnNumber(entry);
					if (switchKey) {
						if (this.seenInitialSwitches.has(switchKey)) {
							continue;
						}
						this.seenInitialSwitches.add(switchKey);
					} else if (typeof turnNum === "number") {
						if (this.seenInitialTurns.has(turnNum)) {
							continue;
						}
						this.seenInitialTurns.add(turnNum);
					} else if (this.seenInitialLines.has(entry)) {
						continue;
					} else {
						this.seenInitialLines.add(entry);
					}
				}

				this.state.log.push(entry);
				newEntries.push(entry);
			}
			this.lastLogIndex = log.length;
		}
		
		return newEntries;
	}

	private isInitialProtocolLine(line: string): boolean {
		return (
			line === "|" ||
			line.startsWith("|t:|") ||
			line.startsWith("|gametype|") ||
			line.startsWith("|player|") ||
			line.startsWith("|teamsize|") ||
			line.startsWith("|gen|") ||
			line.startsWith("|tier|") ||
			line.startsWith("|clearpoke") ||
			line.startsWith("|poke|") ||
			line.startsWith("|teampreview") ||
			line.startsWith("|start") ||
			line.startsWith("|split|") ||
			line.startsWith("|switch|") ||
			line.startsWith("|drag|") ||
			line.startsWith("|replace|") ||
			line.startsWith("|turn|")
		);
	}

	private isActionProtocolLine(line: string): boolean {
		return (
			line.startsWith("|move|") ||
			line.startsWith("|cant|") ||
			line.startsWith("|-damage|") ||
			line.startsWith("|damage|") ||
			line.startsWith("|-heal|") ||
			line.startsWith("|heal|") ||
			line.startsWith("|faint|")
		);
	}

	private extractTurnNumber(line: string): number | null {
		if (!line.startsWith("|turn|")) return null;
		const parts = line.split("|");
		const num = parseInt(parts[2] || "", 10);
		return Number.isFinite(num) ? num : null;
	}

	private extractSwitchKey(line: string): string | null {
		if (!line.startsWith("|switch|") && !line.startsWith("|drag|") && !line.startsWith("|replace|")) {
			return null;
		}
		const parts = line.split("|");
		const ident = parts[2] || "";
		const match = ident.match(/^(p[12][a-z]?):\s*(.+)$/);
		if (!match) return null;
		const slot = match[1];
		const name = match[2];
		return `${slot}:${String(name).toLowerCase().trim()}`;
	}

	/**
	 * Parse log entries into animation events
	 */
	private parseLogToAnimations(lines: string[]): AnimationEvent[] {
		const anim: AnimationEvent[] = [];

		for (const line of lines) {
			if (!line.startsWith("|")) continue;
			
			const parts = line.slice(1).split("|");
			const cmd = parts[0];

			switch (cmd) {
				case "move": {
					const [, attacker, moveName, target] = parts;
					const attackerSide = this.extractSide(attacker);
					const playerId = attackerSide ? this.sideToPlayerId.get(attackerSide) || "" : "";
					anim.push({
						type: "move",
						payload: {
							playerId,
							moveName: moveName || "",
							pokemonId: this.extractPokemonName(attacker),
							targetId: this.extractPokemonName(target),
						},
					});
					break;
				}
				case "switch":
				case "drag": {
					const [, ident] = parts;
					const side = this.extractSide(ident);
					const playerId = side ? this.sideToPlayerId.get(side) || "" : "";
					anim.push({
						type: "switch",
						payload: {
							playerId,
							pokemonId: this.extractPokemonName(ident),
						},
					});
					break;
				}
				case "-damage":
				case "-heal": {
					const [, ident, condition] = parts;
					const side = this.extractSide(ident);
					const playerId = side ? this.sideToPlayerId.get(side) || "" : "";
					const hpParts = (condition || "").split("/");
					const current = parseInt(hpParts[0]) || 0;
					const max = parseInt(hpParts[1]?.split(" ")[0]) || 100;
					anim.push({
						type: cmd === "-damage" ? "damage" : "heal",
						payload: {
							playerId,
							pokemonId: this.extractPokemonName(ident),
							hpAfter: current,
							maxHP: max,
						},
					});
					break;
				}
				case "faint": {
					const [, ident] = parts;
					const side = this.extractSide(ident);
					const playerId = side ? this.sideToPlayerId.get(side) || "" : "";
					anim.push({
						type: "faint",
						payload: {
							playerId,
							pokemonId: this.extractPokemonName(ident),
						},
					});
					break;
				}
				case "-status": {
					const [, ident, status] = parts;
					const side = this.extractSide(ident);
					const playerId = side ? this.sideToPlayerId.get(side) || "" : "";
					anim.push({
						type: "status",
						payload: {
							playerId,
							pokemonId: this.extractPokemonName(ident),
							status: status || "",
						},
					});
					break;
				}
			}
		}

		return anim;
	}

	/**
	 * Extract side from PS ident like "p1a: Pikachu"
	 */
	private extractSide(ident: string | undefined): "p1" | "p2" | null {
		if (!ident) return null;
		const match = ident.match(/^(p[12])/);
		return match ? (match[1] as "p1" | "p2") : null;
	}

	/**
	 * Extract pokemon name from PS ident like "p1a: Pikachu"
	 */
	private extractPokemonName(ident: string | undefined): string {
		if (!ident) return "";
		const match = ident.match(/^p[12][a-z]?: (.+)$/);
		return match ? match[1] : ident;
	}

	/**
	 * Convert our action to PS choice format
	 */
	private actionToChoice(action: BattleAction, side: "p1" | "p2"): string | null {
		if (action.type === "move") {
			const moveAction = action as MoveAction;
			if (!moveAction.moveId || moveAction.moveId === "default") {
				return "default";
			}
			const moveIndex = this.findMoveIndex(moveAction.moveId, side);
			let choice = `move ${moveIndex}`;
			if (moveAction.mega) choice += " mega";
			if (moveAction.zmove) choice += " zmove";
			if (moveAction.dynamax) choice += " dynamax";
			if (moveAction.terastallize) choice += " terastallize";
			return choice;
		}

		if (action.type === "switch") {
			const switchAction = action as SwitchAction;
			// PS uses 1-based indices
			return `switch ${switchAction.toIndex + 1}`;
		}

		return "default";
	}

	/**
	 * Find the index of a move (1-based)
	 */
	private findMoveIndex(moveId: string, side: "p1" | "p2"): number {
		if (!this.battle) return 1;

		const psSide = this.battle.sides.find((s: any) => s.id === side);
		if (!psSide) return 1;

		const activePokemon = psSide.active[0];
		if (!activePokemon) return 1;

		const normalizedMoveId = moveId.toLowerCase().replace(/[^a-z0-9]/g, "");
		
		for (let i = 0; i < activePokemon.moves.length; i++) {
			const move = activePokemon.moves[i];
			const moveNormalized = (move || "").toLowerCase().replace(/[^a-z0-9]/g, "");
			if (moveNormalized === normalizedMoveId) {
				return i + 1;
			}
		}

		return 1;
	}

	private applyStartConditions(start?: BattleStartConditions): void {
		if (!this.battle || !start) return;

		const field = this.battle.field as any;
		const applyTimedField = (
			rawId: unknown,
			rawTurns: unknown,
			setter: (id: string) => void,
			statePath: any,
			idMapper: (id: string) => string
		) => {
			const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
			if (!id || id === "none") return;
			const mapped = idMapper(id);
			if (!mapped) return;
			try {
				setter(mapped);
				const turns = this.clampInt(rawTurns, 1, 99, 5);
				if (statePath) {
					statePath.duration = turns;
					statePath.durationLeft = turns;
				}
			} catch {}
		};

		applyTimedField(
			start.field?.weather?.id,
			start.field?.weather?.turnsLeft,
			(id) => field.setWeather?.(id, null),
			field.weatherState,
			(id) => this.toPSWeatherId(id)
		);

		applyTimedField(
			start.field?.terrain?.id,
			start.field?.terrain?.turnsLeft,
			(id) => field.setTerrain?.(id, null),
			field.terrainState,
			(id) => this.toPSTerrainId(id)
		);

		this.applyPseudoWeatherStart("room", start.field?.room?.id, start.field?.room?.turnsLeft, "trickroom");
		this.applyPseudoWeatherStart("magicRoom", start.field?.magicRoom?.id, start.field?.magicRoom?.turnsLeft, "magicroom");
		this.applyPseudoWeatherStart("wonderRoom", start.field?.wonderRoom?.id, start.field?.wonderRoom?.turnsLeft, "wonderroom");

		const sideConfigs = [start.side1, start.side2];
		if (Array.isArray(start.sides)) {
			for (let i = 0; i < Math.min(2, start.sides.length); i++) {
				sideConfigs[i] = start.sides[i] ?? sideConfigs[i];
			}
		}

		for (let i = 0; i < 2; i++) {
			const side = this.battle.sides[i] as any;
			const cfg = sideConfigs[i] as any;
			if (!side || !cfg) continue;

			const hazards = cfg.sideHazards || {};
			if (hazards.stealthRock) side.addSideCondition?.("stealthrock", null);
			if (hazards.stickyWeb) side.addSideCondition?.("stickyweb", null);

			const spikes = this.clampInt(hazards.spikesLayers, 0, 3, 0);
			for (let layer = 0; layer < spikes; layer++) side.addSideCondition?.("spikes", null);

			const tspikes = this.clampInt(hazards.toxicSpikesLayers, 0, 2, 0);
			for (let layer = 0; layer < tspikes; layer++) side.addSideCondition?.("toxicspikes", null);

			const sideConds = cfg.sideConditions || {};
			this.addSideConditionWithDuration(side, "tailwind", sideConds.tailwindTurns);
			this.addSideConditionWithDuration(side, "reflect", sideConds.reflectTurns);
			this.addSideConditionWithDuration(side, "lightscreen", sideConds.lightScreenTurns);
		}
	}

	private applyPseudoWeatherStart(_key: string, rawId: unknown, rawTurns: unknown, psId: string): void {
		if (!this.battle?.field) return;
		const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
		if (!id || id === "none") return;
		const acceptable = {
			room: "trickroom",
			trick_room: "trickroom",
			trickroom: "trickroom",
			magic_room: "magicroom",
			magicroom: "magicroom",
			wonder_room: "wonderroom",
			wonderroom: "wonderroom",
		};
		if ((acceptable as any)[id] !== psId) return;
		try {
			(this.battle.field as any).addPseudoWeather?.(psId, null);
			const turns = this.clampInt(rawTurns, 1, 99, 5);
			const ps = (this.battle.field as any).pseudoWeather?.[psId];
			if (ps) {
				ps.duration = turns;
				ps.durationLeft = turns;
			}
		} catch {}
	}

	private addSideConditionWithDuration(side: any, psConditionId: string, rawTurns: unknown): void {
		const turns = this.clampInt(rawTurns, 0, 99, 0);
		if (turns <= 0) return;
		try {
			side.addSideCondition?.(psConditionId, null);
			const state = side.sideConditions?.[psConditionId];
			if (state) {
				state.duration = turns;
				state.durationLeft = turns;
			}
		} catch {}
	}

	private toPSWeatherId(id: string): string {
		const map: Record<string, string> = {
			rain: "raindance",
			raindance: "raindance",
			sun: "sunnyday",
			sunnyday: "sunnyday",
			sand: "sandstorm",
			sandstorm: "sandstorm",
			snow: "snow",
			hail: "hail",
		};
		return map[id] || id;
	}

	private toPSTerrainId(id: string): string {
		const map: Record<string, string> = {
			electric: "electricterrain",
			electricterrain: "electricterrain",
			grassy: "grassyterrain",
			grassyterrain: "grassyterrain",
			misty: "mistyterrain",
			mistyterrain: "mistyterrain",
			psychic: "psychicterrain",
			psychicterrain: "psychicterrain",
		};
		return map[id] || id;
	}

	private clampInt(value: unknown, min: number, max: number, fallback: number): number {
		const n = Number(value);
		if (!Number.isFinite(n)) return fallback;
		const i = Math.trunc(n);
		return Math.max(min, Math.min(max, i));
	}

	/**
	 * Sync our state from PS's current state
	 */
	private syncStateFromPS() {
		if (!this.battle) return;

		for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
			const psSide = this.battle.sides[sideIdx];
			const player = this.state.players[sideIdx];
			if (!psSide || !player) continue;

			// Find active index - PS's active[0] is a reference to an object in psSide.pokemon
			const activePokemon = psSide.active[0];
			if (activePokemon) {
				// Direct object reference check
				let activeIdx = psSide.pokemon.indexOf(activePokemon);
				
				// If indexOf failed, try by position/slot property
				if (activeIdx < 0) {
					// In PS, each pokemon has a 'position' property (0-based index in team)
					const pos = activePokemon.position;
					if (typeof pos === 'number' && pos >= 0 && pos < psSide.pokemon.length) {
						activeIdx = pos;
					}
				}
				
				// Final fallback - compare by species/name
				if (activeIdx < 0) {
					activeIdx = psSide.pokemon.findIndex((p: any) => 
						p && (p.speciesState?.id === activePokemon.speciesState?.id || 
						      p.species === activePokemon.species ||
						      p.name === activePokemon.name)
					);
				}
				
				if (activeIdx >= 0) {
					console.log(`[SyncPSEngine] Side ${sideIdx} active: ${activePokemon.name || activePokemon.species}, index ${activeIdx} (was ${player.activeIndex})`);
					player.activeIndex = activeIdx;
				} else {
					console.warn(`[SyncPSEngine] Could not find active pokemon for side ${sideIdx}`);
				}
			}

			// Update each pokemon
			for (let i = 0; i < psSide.pokemon.length && i < player.team.length; i++) {
				const psMon = psSide.pokemon[i];
				const ourMon = player.team[i];
				if (!psMon) continue;

				// Update HP
				ourMon.currentHP = psMon.hp || 0;
				ourMon.maxHP = psMon.maxhp || ourMon.maxHP;

				// Update status
				if (psMon.status) {
					ourMon.status = this.parseStatus(psMon.status);
				} else if (psMon.fainted) {
					ourMon.status = "none";
					ourMon.currentHP = 0;
				}

				// Sync ability (handles mega evolution and Trace/ability changes)
				const abilityId = psMon.ability || psMon.baseAbility;
				if (abilityId) {
					ourMon.ability = String(abilityId);
				}

				// Update stages/boosts - check if this is the active pokemon
				// In PS, boosts are on the active pokemon object (psSide.active[0])
				// which may or may not be the same reference as psSide.pokemon[i]
				const isActive = activePokemon && (
					psMon === activePokemon || 
					psMon.position === activePokemon.position ||
					(psMon.speciesState?.id === activePokemon.speciesState?.id && psMon.name === activePokemon.name)
				);
				
				// Get boosts from the appropriate source
				const boostSource = isActive && activePokemon?.boosts ? activePokemon.boosts : psMon.boosts;
				
				if (boostSource) {
					ourMon.stages = {
						hp: 0,
						atk: boostSource.atk || 0,
						def: boostSource.def || 0,
						spa: boostSource.spa || 0,
						spd: boostSource.spd || 0,
						spe: boostSource.spe || 0,
						acc: boostSource.accuracy || 0,
						eva: boostSource.evasion || 0,
					};
					
					// Debug logging for boost sync
					if (isActive && (boostSource.atk || boostSource.def || boostSource.spa || boostSource.spd || boostSource.spe)) {
						console.log(`[SyncPSEngine] Active pokemon ${ourMon.name} boosts synced:`, {
							atk: boostSource.atk || 0,
							def: boostSource.def || 0,
							spa: boostSource.spa || 0,
							spd: boostSource.spd || 0,
							spe: boostSource.spe || 0,
						});
					}
				}
			}
		}

		// Update turn
		this.state.turn = this.battle.turn;

		// Update weather
		const weather = this.battle.field?.weather;
		if (weather && weather !== "none") {
			this.state.field.weather = {
				id: weather,
				turnsLeft: this.battle.field.weatherState?.duration || 0,
			};
		}

		// Update terrain
		const terrain = this.battle.field?.terrain;
		if (terrain && terrain !== "none") {
			this.state.field.terrain = {
				id: terrain,
				turnsLeft: this.battle.field.terrainState?.duration || 0,
			};
		}
	}

	/**
	 * Parse PS status to our format
	 */
	private parseStatus(status: string): NonVolatileStatusId {
		const map: Record<string, NonVolatileStatusId> = {
			par: "paralysis",
			brn: "burn",
			psn: "poison",
			tox: "toxic",
			slp: "sleep",
			frz: "freeze",
		};
		return map[status] || "none";
	}

	/**
	 * Check if battle has ended
	 */
	isEnded(): boolean {
		return this.battle?.ended || false;
	}

	/**
	 * Get winner's player ID
	 */
	getWinner(): string | null {
		if (!this.battle?.winner) return null;
		
		// Winner is the side ID or name
		const winnerSide = this.battle.winner;
		for (const [playerId, side] of this.playerIdToSide) {
			if (side === winnerSide) return playerId;
			const player = this.state.players.find((p) => p.id === playerId);
			if (player?.name === winnerSide) return playerId;
		}
		
		return null;
	}

	/**
	 * Get the full battle log
	 */
	getLog(): string[] {
		return this.state.log;
	}

	/**
	 * Get the current state
	 */
	getState(): BattleState {
		return this.state;
	}

	/**
	 * Access the internal PS battle for advanced usage
	 */
	getPSBattle(): any {
		return this.battle;
	}
}

export default SyncPSEngine;
