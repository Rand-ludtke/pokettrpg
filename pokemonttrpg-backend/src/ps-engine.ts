/**
 * Pokemon Showdown Battle Engine Wrapper
 * 
 * This wraps the official Pokemon Showdown simulator (BattleStream) to provide
 * battle logic that exactly matches PS's mechanics. It translates between our
 * backend's data format and PS's protocol.
 */

import {
	BattleState,
	BattleAction,
	MoveAction,
	SwitchAction,
	TurnResult,
	AnimationEvent,
	LogSink,
	Player,
	Pokemon,
	Move,
	TypeName,
	StatStages,
	NonVolatileStatusId,
} from "./types";

// Import Pokemon Showdown simulator
const ps = require("pokemon-showdown");
const { BattleStream, getPlayerStreams, Teams, PRNG, Dex } = ps;

// ── Inject custom fangame types (Nuclear, Cosmic) into the PS Dex ──
(function injectCustomTypes() {
	const tc = Dex.data.TypeChart;
	// Nuclear type (Uranium fangame)
	tc.nuclear = {
		isNonstandard: "Custom",
		damageTaken: { fallout:3, Bug:1, Cosmic:1, Dark:1, Dragon:1, Electric:1, Fairy:1, Fighting:1, Fire:1, Flying:1, Ghost:1, Grass:1, Ground:1, Ice:1, Normal:1, Nuclear:2, Poison:1, Psychic:1, Rock:1, Steel:1, Stellar:0, Water:1 },
	};
	// Cosmic type (Infinity fangame)
	tc.cosmic = {
		isNonstandard: "Custom",
		damageTaken: { Bug:0, Cosmic:0, Dark:0, Dragon:0, Electric:0, Fairy:0, Fighting:0, Fire:3, Flying:0, Ghost:0, Grass:0, Ground:0, Ice:0, Normal:2, Nuclear:1, Poison:0, Psychic:0, Rock:0, Steel:0, Stellar:0, Water:0 },
	};
	// Add Nuclear/Cosmic to existing types' damageTaken
	const seFromNuclear = ["bug","dark","dragon","electric","fairy","fighting","fire","flying","ghost","grass","ground","ice","normal","poison","psychic","rock","water"];
	for (const t of seFromNuclear) { if (tc[t]) tc[t].damageTaken.Nuclear = 1; }
	if (tc.steel) { tc.steel.damageTaken.Nuclear = 2; tc.steel.damageTaken.fallout = 3; }
	// Cosmic SE on Fairy & Normal; resisted by Psychic
	if (tc.fairy) tc.fairy.damageTaken.Cosmic = 1;
	if (tc.normal) tc.normal.damageTaken.Cosmic = 1;
	if (tc.psychic) tc.psychic.damageTaken.Cosmic = 2;
	// Clear cached type lookups so Dex re-reads
	if (Dex.types?.cache) Dex.types.cache = new Map();
})();

interface PSRequest {
	rqid?: number;
	teamPreview?: boolean;
	forceSwitch?: boolean[];
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

interface PSBattle {
	stream: any;
	omniscient: any;
	p1: any;
	p2: any;
	spectator: any;
	p1Request: PSRequest | null;
	p2Request: PSRequest | null;
	log: string[];
	ended: boolean;
	winner: string | null;
	format: string;
	turn: number;
}

/**
 * PSEngine wraps Pokemon Showdown's BattleStream to provide accurate battle mechanics.
 */
export class PSEngine {
	private battle: PSBattle | null = null;
	private state!: BattleState;
	private playerIdToSide: Map<string, "p1" | "p2"> = new Map();
	private sideToPlayerId: Map<"p1" | "p2", string> = new Map();
	private pendingChoices: Map<string, string> = new Map();
	private turnLog: string[] = [];
	private turnAnim: AnimationEvent[] = [];

	constructor(private readonly options?: { format?: string; seed?: number[] }) {}

	/**
	 * Initialize a battle with the given players.
	 * Teams should be in our Pokemon format - they will be converted to PS packed format.
	 */
	async initializeBattle(players: Player[], options?: { seed?: number[] }): Promise<BattleState> {
		const format = this.options?.format || "gen9customgame";
		const seed = options?.seed || this.options?.seed || PRNG.generateSeed();

		// Create the battle stream
		const stream = new BattleStream({ debug: false });
		const { omniscient, spectator, p1, p2 } = getPlayerStreams(stream);

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

		this.battle = {
			stream,
			omniscient,
			p1,
			p2,
			spectator,
			p1Request: null,
			p2Request: null,
			log: [],
			ended: false,
			winner: null,
			format,
			turn: 0,
		};

		// Initialize our state mirror
		this.state = {
			turn: 0,
			rngSeed: seed[0],
			players: players.map((p) => ({
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

		// Start listening to streams
		this.startStreamListeners();

		// Start the battle
		const spec = { formatid: format, seed };
		await omniscient.write(`>start ${JSON.stringify(spec)}`);
		await omniscient.write(`>player p1 ${JSON.stringify({ name: players[0].name, avatar: p1Avatar, team: p1Team })}`);
		await omniscient.write(`>player p2 ${JSON.stringify({ name: players[1].name, avatar: p2Avatar, team: p2Team })}`);

		// Wait for initial requests
		await this.waitForRequests();

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
	 * Start listening to PS streams
	 */
	private startStreamListeners() {
		if (!this.battle) return;

		// Listen to p1 stream for requests
		(async () => {
			for await (const chunk of this.battle!.p1) {
				for (const line of String(chunk).split("\n")) {
					if (line.startsWith("|request|")) {
						const json = line.slice(9);
						if (json && json !== "null") {
							try {
								this.battle!.p1Request = JSON.parse(json);
							} catch (e) {
								console.error("[PSEngine] Failed to parse p1 request:", e);
							}
						}
					}
				}
			}
		})();

		// Listen to p2 stream for requests
		(async () => {
			for await (const chunk of this.battle!.p2) {
				for (const line of String(chunk).split("\n")) {
					if (line.startsWith("|request|")) {
						const json = line.slice(9);
						if (json && json !== "null") {
							try {
								this.battle!.p2Request = JSON.parse(json);
							} catch (e) {
								console.error("[PSEngine] Failed to parse p2 request:", e);
							}
						}
					}
				}
			}
		})();

		// Listen to spectator stream for battle log
		(async () => {
			for await (const chunk of this.battle!.spectator) {
				const chunkStr = String(chunk);
				const [type] = chunkStr.split("\n", 1);
				if (type === "end") {
					this.battle!.ended = true;
					// Parse winner from log
					const winMatch = chunkStr.match(/\|win\|(.+)/);
					if (winMatch) {
						this.battle!.winner = winMatch[1];
					}
				}
				const lines = chunkStr.split("\n").filter((l) => l.startsWith("|"));
				this.battle!.log.push(...lines);
				this.turnLog.push(...lines);
				
				// Parse lines into animations
				this.parseLogToAnimations(lines);
			}
		})();
	}

	/**
	 * Parse PS log lines into our animation events
	 */
	private parseLogToAnimations(lines: string[]) {
		for (const line of lines) {
			const parts = line.slice(1).split("|");
			const cmd = parts[0];

			switch (cmd) {
				case "move": {
					// |move|p1a: Pikachu|Thunderbolt|p2a: Charizard
					const [, attacker, moveName, target] = parts;
					const attackerSide = attacker?.slice(0, 2) as "p1" | "p2";
					const playerId = this.sideToPlayerId.get(attackerSide) || "";
					this.turnAnim.push({
						type: "move",
						payload: {
							playerId,
							moveName: moveName || "",
							pokemonId: this.extractPokemonId(attacker),
							targetId: this.extractPokemonId(target),
						},
					});
					break;
				}
				case "switch":
				case "drag": {
					// |switch|p1a: Pikachu|Pikachu, L50|100/100
					const [, ident] = parts;
					const side = ident?.slice(0, 2) as "p1" | "p2";
					const playerId = this.sideToPlayerId.get(side) || "";
					this.turnAnim.push({
						type: "switch",
						payload: {
							playerId,
							pokemonId: this.extractPokemonId(ident),
						},
					});
					break;
				}
				case "-damage":
				case "-heal": {
					// |-damage|p1a: Pikachu|90/100
					const [, ident, condition] = parts;
					const side = ident?.slice(0, 2) as "p1" | "p2";
					const playerId = this.sideToPlayerId.get(side) || "";
					const hpParts = (condition || "").split("/");
					const current = parseInt(hpParts[0]) || 0;
					const max = parseInt(hpParts[1]) || 100;
					this.turnAnim.push({
						type: cmd === "-damage" ? "damage" : "heal",
						payload: {
							playerId,
							pokemonId: this.extractPokemonId(ident),
							damage: cmd === "-damage" ? max - current : current - max,
							hpBefore: max,
							hpAfter: current,
						},
					});
					break;
				}
				case "faint": {
					// |faint|p1a: Pikachu
					const [, ident] = parts;
					const side = ident?.slice(0, 2) as "p1" | "p2";
					const playerId = this.sideToPlayerId.get(side) || "";
					this.turnAnim.push({
						type: "faint",
						payload: {
							playerId,
							pokemonId: this.extractPokemonId(ident),
						},
					});
					break;
				}
				case "-status": {
					// |-status|p1a: Pikachu|par
					const [, ident, status] = parts;
					const side = ident?.slice(0, 2) as "p1" | "p2";
					const playerId = this.sideToPlayerId.get(side) || "";
					this.turnAnim.push({
						type: "status",
						payload: {
							playerId,
							pokemonId: this.extractPokemonId(ident),
							status: status || "",
						},
					});
					break;
				}
				case "turn": {
					// |turn|2
					const turnNum = parseInt(parts[1]) || 0;
					this.battle!.turn = turnNum;
					this.state.turn = turnNum;
					break;
				}
			}
		}
	}

	/**
	 * Extract pokemon ID from PS ident like "p1a: Pikachu"
	 */
	private extractPokemonId(ident: string | undefined): string {
		if (!ident) return "";
		// Format: "p1a: Nickname" - extract the name
		const match = ident.match(/^p[12][a-z]?: (.+)$/);
		return match ? match[1] : ident;
	}

	/**
	 * Wait for both players to have requests
	 */
	private async waitForRequests(timeoutMs = 1000): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (this.battle?.p1Request && this.battle?.p2Request) {
				return;
			}
			if (this.battle?.ended) {
				return;
			}
			await new Promise((r) => setTimeout(r, 10));
		}
	}

	/**
	 * Get the current request for a player (what choices they need to make)
	 */
	getRequest(playerId: string): PSRequest | null {
		const side = this.playerIdToSide.get(playerId);
		if (!side || !this.battle) return null;
		return side === "p1" ? this.battle.p1Request : this.battle.p2Request;
	}

	/**
	 * Check if the battle needs a team preview choice
	 */
	isTeamPreview(): boolean {
		return !!(this.battle?.p1Request?.teamPreview || this.battle?.p2Request?.teamPreview);
	}

	/**
	 * Check if a player needs to make a force switch (fainted Pokemon)
	 */
	needsForceSwitch(playerId: string): boolean {
		const req = this.getRequest(playerId);
		return !!(req?.forceSwitch?.some((f) => f));
	}

	/**
	 * Submit a team order for team preview
	 */
	async submitTeamOrder(playerId: string, order: number[]): Promise<void> {
		const side = this.playerIdToSide.get(playerId);
		if (!side || !this.battle) return;

		const orderStr = order.map((n) => n.toString()).join("");
		const stream = side === "p1" ? this.battle.p1 : this.battle.p2;
		await stream.write(`team ${orderStr}`);

		// Clear the request
		if (side === "p1") this.battle.p1Request = null;
		else this.battle.p2Request = null;

		await this.waitForRequests();
	}

	/**
	 * Submit a force switch choice
	 */
	async forceSwitch(playerId: string, toIndex: number): Promise<TurnResult> {
		const side = this.playerIdToSide.get(playerId);
		if (!side || !this.battle) {
			return { state: this.state, events: [], anim: [] };
		}

		this.turnLog = [];
		this.turnAnim = [];

		const stream = side === "p1" ? this.battle.p1 : this.battle.p2;
		// PS uses 1-based indices
		await stream.write(`switch ${toIndex + 1}`);

		// Clear the request
		if (side === "p1") this.battle.p1Request = null;
		else this.battle.p2Request = null;

		await this.waitForRequests();

		// Update our state from PS
		this.syncStateFromPS();

		return {
			state: this.state,
			events: [...this.turnLog],
			anim: [...this.turnAnim],
		};
	}

	/**
	 * Process a turn with the given actions
	 */
	async processTurn(actions: BattleAction[]): Promise<TurnResult> {
		if (!this.battle) {
			return { state: this.state, events: ["Battle not initialized"], anim: [] };
		}

		this.turnLog = [];
		this.turnAnim = [];

		// Convert our actions to PS choice format and submit
		for (const action of actions) {
			const side = this.playerIdToSide.get(action.actorPlayerId);
			if (!side) continue;

			const stream = side === "p1" ? this.battle.p1 : this.battle.p2;
			const choice = this.actionToChoice(action, side);

			if (choice) {
				await stream.write(choice);
			}
		}

		// Wait for the turn to process
		await this.waitForRequests();

		// Update our state from PS
		this.syncStateFromPS();

		return {
			state: this.state,
			events: [...this.turnLog],
			anim: [...this.turnAnim],
		};
	}

	/**
	 * Convert our action to PS choice format
	 */
	private actionToChoice(action: BattleAction, side: "p1" | "p2"): string | null {
		const request = side === "p1" ? this.battle?.p1Request : this.battle?.p2Request;

		if (action.type === "move") {
			const moveAction = action as MoveAction;
			// Find move index (1-based)
			const moveIndex = this.findMoveIndex(moveAction.moveId, request || null);
			if (moveIndex > 0) {
				let choice = `move ${moveIndex}`;
				if (moveAction.mega) choice += " mega";
				if (moveAction.zmove) choice += " zmove";
				if (moveAction.dynamax) choice += " dynamax";
				if (moveAction.terastallize) choice += " terastallize";
				return choice;
			}
			// Fallback to move 1
			return "move 1";
		}

		if (action.type === "switch") {
			const switchAction = action as SwitchAction;
			// PS uses 1-based indices
			return `switch ${switchAction.toIndex + 1}`;
		}

		return null;
	}

	/**
	 * Find the index of a move in the current request
	 */
	private findMoveIndex(moveId: string, request: PSRequest | null): number {
		if (!request?.active?.[0]?.moves) return 1;

		const normalizedMoveId = moveId.toLowerCase().replace(/[^a-z0-9]/g, "");
		const moves = request.active[0].moves;

		for (let i = 0; i < moves.length; i++) {
			const m = moves[i];
			const mNormalized = (m.id || m.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
			if (mNormalized === normalizedMoveId || m.name === moveId) {
				return i + 1; // 1-based
			}
		}

		return 1; // Default to first move
	}

	/**
	 * Sync our state mirror from PS's current state
	 */
	private syncStateFromPS() {
		if (!this.battle) return;

		// Update HP and status from requests
		const updateFromRequest = (request: PSRequest | null, playerIndex: number) => {
			if (!request?.side?.pokemon) return;

			const player = this.state.players[playerIndex];
			if (!player) return;

			for (let i = 0; i < request.side.pokemon.length && i < player.team.length; i++) {
				const psMon = request.side.pokemon[i];
				const ourMon = player.team[i];

				// Parse condition (e.g., "100/100" or "50/100 par")
				const [hpPart, statusPart] = (psMon.condition || "").split(" ");
				const [current, max] = (hpPart || "").split("/").map((n) => parseInt(n) || 0);

				ourMon.currentHP = current;
				ourMon.maxHP = max || ourMon.maxHP;

				// Update status
				if (statusPart) {
					ourMon.status = this.parseStatus(statusPart);
				} else if (current === 0) {
					ourMon.status = "none";
				}

				// Track if active
				if (psMon.active) {
					player.activeIndex = i;
				}
			}
		};

		updateFromRequest(this.battle.p1Request, 0);
		updateFromRequest(this.battle.p2Request, 1);
	}

	/**
	 * Parse PS status string to our format
	 */
	private parseStatus(status: string): NonVolatileStatusId {
		const map: Record<string, NonVolatileStatusId> = {
			par: "paralysis",
			brn: "burn",
			psn: "poison",
			tox: "toxic",
			slp: "sleep",
			frz: "freeze",
			fnt: "none",
		};
		return map[status] || "none";
	}

	/**
	 * Check if the battle has ended
	 */
	isEnded(): boolean {
		return this.battle?.ended || false;
	}

	/**
	 * Get the winner's player ID (or null if no winner yet)
	 */
	getWinner(): string | null {
		if (!this.battle?.winner) return null;

		// Match winner name to player
		for (const [playerId, side] of this.playerIdToSide) {
			const player = this.state.players.find((p) => p.id === playerId);
			if (player?.name === this.battle.winner) {
				return playerId;
			}
		}

		return null;
	}

	/**
	 * Get the full battle log
	 */
	getLog(): string[] {
		return this.battle?.log || [];
	}

	/**
	 * Get the current battle state
	 */
	getState(): BattleState {
		return this.state;
	}
}

export default PSEngine;
