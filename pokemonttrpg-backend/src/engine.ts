import {
	Action,
	BattleAction,
	BattleRuleset,
	BattleInitializeOptions,
	BattleStartConditions,
	BattleState,
	Category,
	AnimationEvent,
	LogSink,
	Move,
	MoveAction,
	SwitchAction,
	Pokemon,
	TurnResult,
	clamp,
	stageMultiplier,
	EngineUtils,
	NonVolatileStatusId,
	Player,
	StartSideConditions,
} from "./types";
	import { calcDamage, chooseDefenseStat } from "./damage";
	import { Abilities } from "./data/abilities";
	import { Items } from "./data/items";
import { typeEffectiveness } from "./data/type-chart";

type Handler<T extends any[]> = (...args: T) => void;

export class Engine implements BattleRuleset {
	private state!: BattleState;

	// Event handlers
	private moveHandlers: Handler<[Move, Pokemon, Pokemon, BattleState, LogSink]>[] = [];
	private statusTickHandlers: Handler<[
		Pokemon,
		NonVolatileStatusId,
		BattleState,
		LogSink
	]>[] = [];
	private switchInHandlers: Handler<[Pokemon, BattleState, LogSink]>[] = [];

	constructor(private readonly options?: { seed?: number; deterministicTies?: boolean; startConditions?: BattleStartConditions }) {}

	initializeBattle(players: Player[], options?: BattleInitializeOptions): BattleState {
		this.state = {
			turn: 0,
			rngSeed: options?.seed ?? this.options?.seed,
			players,
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
		this.applyStartConditions(options?.startConditions ?? this.options?.startConditions);
		// Trigger switch-in handlers for initial actives
		for (const p of this.state.players) {
			const active = p.team[p.activeIndex];
			// Initialize PP store per mon
			(active as any).volatile = (active as any).volatile || {};
			(active as any).volatile.pp = (active as any).volatile.pp || {};
			this.emitSwitchIn(active);
		}
		return this.state;
	}

	private applyStartConditions(startConditions?: BattleStartConditions) {
		if (!startConditions) return;

		const applyField = (key: "weather" | "terrain" | "room" | "magicRoom" | "wonderRoom", idRaw: unknown, turnsRaw: unknown) => {
			const id = typeof idRaw === "string" ? idRaw.trim().toLowerCase() : "";
			if (!id || id === "none") return;
			const turns = this.clampInt(turnsRaw, 1, 99, 5);
			this.state.field[key] = { id, turnsLeft: turns };
			this.state.log.push(`[StartConditions] ${key}=${id} (${turns} turns)`);
		};

		const field = startConditions.field;
		applyField("weather", field?.weather?.id, field?.weather?.turnsLeft);
		applyField("terrain", field?.terrain?.id, field?.terrain?.turnsLeft);
		applyField("room", field?.room?.id, field?.room?.turnsLeft);
		applyField("magicRoom", field?.magicRoom?.id, field?.magicRoom?.turnsLeft);
		applyField("wonderRoom", field?.wonderRoom?.id, field?.wonderRoom?.turnsLeft);

		const sideConfigs: Array<StartSideConditions | undefined> = [
			startConditions.side1,
			startConditions.side2,
		];
		if (Array.isArray(startConditions.sides)) {
			for (let i = 0; i < startConditions.sides.length && i < sideConfigs.length; i++) {
				sideConfigs[i] = startConditions.sides[i] ?? sideConfigs[i];
			}
		}

		for (let i = 0; i < Math.min(2, this.state.players.length); i++) {
			const player = this.state.players[i];
			const cfg = sideConfigs[i];
			if (!cfg) continue;

			const hazards = cfg.sideHazards;
			if (hazards) {
				player.sideHazards = player.sideHazards || {};
				if (hazards.stealthRock != null) player.sideHazards.stealthRock = Boolean(hazards.stealthRock);
				if (hazards.stickyWeb != null) player.sideHazards.stickyWeb = Boolean(hazards.stickyWeb);
				if (hazards.spikesLayers != null) player.sideHazards.spikesLayers = this.clampInt(hazards.spikesLayers, 0, 3, 0);
				if (hazards.toxicSpikesLayers != null) player.sideHazards.toxicSpikesLayers = this.clampInt(hazards.toxicSpikesLayers, 0, 2, 0);
			}

			const side = cfg.sideConditions;
			if (side) {
				player.sideConditions = player.sideConditions || {};
				if (side.tailwindTurns != null) player.sideConditions.tailwindTurns = this.clampInt(side.tailwindTurns, 0, 99, 0);
				if (side.reflectTurns != null) player.sideConditions.reflectTurns = this.clampInt(side.reflectTurns, 0, 99, 0);
				if (side.lightScreenTurns != null) player.sideConditions.lightScreenTurns = this.clampInt(side.lightScreenTurns, 0, 99, 0);
			}
		}
	}

	private clampInt(value: unknown, min: number, max: number, fallback: number): number {
		const n = Number(value);
		if (!Number.isFinite(n)) return fallback;
		const i = Math.trunc(n);
		return Math.max(min, Math.min(max, i));
	}

	// Allow the server to perform a forced switch outside of a normal turn.
	// Does not advance the turn or process end-of-turn effects.
	forceSwitch(playerId: string, toIndex: number): { state: BattleState; events: string[]; anim: AnimationEvent[] } {
		if (!this.state) throw new Error("Engine not initialized");
		const events: string[] = [];
		const anim: AnimationEvent[] = [];
		const log: LogSink = (msg) => {
			this.state.log.push(msg);
			events.push(msg);
		};
		const player = this.state.players.find((p) => p.id === playerId);
		if (!player) throw new Error("player not found");
		const idx = Math.max(0, Math.min(player.team.length - 1, toIndex));
		player.activeIndex = idx;
		const active = player.team[player.activeIndex];
		log(`${player.name} switched to ${active.name}!`);
		this.emitSwitchIn(active, log);
		anim.push({ type: "switch", payload: { playerId: player.id, pokemonId: active.id } });
		return { state: this.state, events, anim };
	}

	processTurn(actions: BattleAction[]): TurnResult {
		if (!this.state) throw new Error("Engine not initialized");
		this.state.turn += 1;
		const events: string[] = [];
		const anim: AnimationEvent[] = [];
		// temporary binding so inner helpers can emit animations without threading a param everywhere
		(this as any)._pushAnim = (ev: AnimationEvent) => { anim.push(ev); };
		const log: LogSink = (msg) => {
			this.state.log.push(msg);
			events.push(msg);
		};

		// Process actions for this turn

		// ============================================================
		// PHASE 1: Process SWITCHES first (before any moves)
		// This matches Pokemon Showdown's behavior: switches have order 103, moves have order 200
		// Lower order executes first, so switches always go before moves.
		// ============================================================
		const switchActions = actions.filter((a): a is SwitchAction => a.type === "switch");
		const moveActions = actions.filter((a): a is MoveAction => a.type === "move");
		
		// Sort switches by speed (higher speed switches first) with random tie-break
		const sortedSwitches = [...switchActions].sort((a, b) => {
			const speA = this.actionSpeed({ ...a, type: "switch" } as BattleAction);
			const speB = this.actionSpeed({ ...b, type: "switch" } as BattleAction);
			if (speA !== speB) return speB - speA; // higher speed first
			return this.rng() < 0.5 ? -1 : 1; // random tie-break
		});
		
		// Execute all switches BEFORE any moves
		for (const switchAction of sortedSwitches) {
			const player = this.state.players.find((p) => p.id === switchAction.actorPlayerId);
			if (!player) continue;
			
			// Validate switch target is not fainted
			const targetIndex = switchAction.toIndex;
			const targetPokemon = player.team[targetIndex];
			if (!targetPokemon || targetPokemon.currentHP <= 0) {
				continue;
			}
			
			// Validate not switching to self (already active)
			if (targetIndex === player.activeIndex) {
				continue;
			}
			
			// Clear substitute and reset stages/volatiles on the outgoing mon
			const outgoing = player.team[player.activeIndex];
			if (outgoing) {
				if (outgoing.volatile) (outgoing.volatile as any).substituteHP = 0;
				// Reset stages
				outgoing.stages = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
				// Preserve PP store but clear other volatiles including Choice lock
				const ppKeep = (outgoing.volatile as any)?.pp;
				outgoing.volatile = { pp: ppKeep } as any;
			}
			
			player.activeIndex = Math.max(0, Math.min(player.team.length - 1, targetIndex));
			const active = player.team[player.activeIndex];
			log(`${player.name} switched to ${active.name}!`);
			this.emitSwitchIn(active, log);
			anim.push({ type: "switch", payload: { playerId: player.id, pokemonId: active.id } });
		}
		
		// ============================================================
		// PHASE 2: Process MOVES (after all switches are complete)
		// Moves now target the CURRENT active Pokemon (after switches)
		// ============================================================
		
		// Filter legal move actions (actor must be alive and be the current active)
		const legalMoveActions = moveActions.filter((a) => {
			const player = this.state.players.find((p) => p.id === a.actorPlayerId);
			if (!player) return false;
			// The action's pokemonId should match the current active Pokemon
			const currentActive = player.team[player.activeIndex];
			if (!currentActive || currentActive.currentHP <= 0) return false;
			// Accept the action - we'll use the current active, not the pokemonId from the action
			// This handles the case where a player switched but also sent a move action
			return true;
		});

		// Sort moves by priority then speed, with random tie-break for true speed ties
		// (This matches Pokemon Showdown's speedSort behavior)
		const sortedMoves = [...legalMoveActions].sort((a, b) => this.compareMoveActions(a, b));

		// Execute each move
		for (const ma of sortedMoves) {
			// Get the CURRENT active Pokemon for this player (after switches!)
			const player = this.state.players.find((p) => p.id === ma.actorPlayerId);
			if (!player) continue;
			const actor = player.team[player.activeIndex];
			if (!actor || actor.currentHP <= 0) continue; // fainted already
			
			// Find the opponent's CURRENT active Pokemon as the target (after switches!)
			const opponentPlayer = this.state.players.find(pl => pl !== player);
			let target = opponentPlayer ? opponentPlayer.team[opponentPlayer.activeIndex] : undefined;
			
			// Override with explicit target if it's still valid
			if (ma.targetPokemonId) {
				const explicitTarget = this.getPokemonById(ma.targetPokemonId);
				// Only use explicit target if it's the opponent's current active and alive
				if (explicitTarget && explicitTarget.currentHP > 0 && 
				    opponentPlayer?.team.some(m => m.id === explicitTarget.id)) {
					if (opponentPlayer.team[opponentPlayer.activeIndex]?.id === explicitTarget.id) {
						target = explicitTarget;
					}
				}
			}
			
			if (!target || target.currentHP <= 0) continue;
			
			// Status gating at start of action
			if (actor.status === "sleep") {
				const turns = actor.volatile?.sleepTurns ?? 0;
				if (turns > 0) {
					actor.volatile = actor.volatile || {};
					(actor.volatile as any).sleepTurns = Math.max(0, turns - 1);
					if ((actor.volatile as any).sleepTurns > 0) {
						log(`${actor.name} is fast asleep.`);
						continue;
					} else {
						actor.status = "none";
						log(`${actor.name} woke up!`);
					}
				}
			}
			if (actor.status === "freeze") {
				const thaw = this.rng() < 0.2;
				if (thaw) {
					actor.status = "none";
					log(`${actor.name} thawed out!`);
				} else {
					log(`${actor.name} is frozen solid!`);
					continue;
				}
			}
			if (actor.status === "paralysis") {
				if (this.rng() < 0.25) {
					log(`${actor.name} is paralyzed! It can't move!`);
					continue;
				}
			}
			// Encore enforcement: if actor is encored, force the selected moveId
			if ((actor.volatile?.encoreTurns ?? 0) > 0 && actor.volatile?.encoreMoveId) {
				const forcedId = actor.volatile.encoreMoveId as string;
				if (ma.moveId !== forcedId) {
					ma.moveId = forcedId;
				}
			}
			let requested = actor.moves.find((m) => m.id === ma.moveId);
			let move = requested;
			
			actor.volatile = actor.volatile || {};
			(actor.volatile as any).pp = (actor.volatile as any).pp || {};
			const ppStore = (actor.volatile as any).pp as Record<string, number>;
			// Choice item lock enforcement: if holding a Choice item and locked, block other moves (ignored under Magic Room)
			const hasChoice = ["choice_band","choice_specs","choice_scarf"].includes((actor.item ?? "").toLowerCase());
			const lockedId = (actor.volatile as any).choiceLockedMoveId as string | undefined;
			if (!this.areItemsSuppressed() && hasChoice && lockedId && requested && requested.id !== lockedId) {
				// Allow Struggle fallback path to handle when no PP remains on any move; otherwise block
				log(`${actor.name} is locked into ${lockedId} due to its Choice item!`);
				continue;
			}
			// Determine PP availability
			const hasAnyPP = actor.moves.some(m => (ppStore[m.id] ?? (m.pp ?? 10)) > 0);
			let usingStruggle = false;
			if (!move) {
				// Missing move definition: if no PP anywhere, fall back silently to Struggle
				if (!hasAnyPP) {
					move = { id: "__struggle", name: "Struggle", type: "Normal", category: "Physical", power: 50 } as any;
					usingStruggle = true;
				} else {
					continue;
				}
			} else {
				// Move exists: check its remaining PP
				const basePP0 = move.pp ?? 10;
				const remaining0 = ppStore[move.id] ?? basePP0;
				if (remaining0 <= 0) {
					if (hasAnyPP) {
						log(`${actor.name} has no PP left for ${move.name}!`);
						continue;
					} else {
						// Log the PP exhaustion, then use Struggle
							log(`${actor.name} has no PP left for ${move.name}!`);
							move = { id: "__struggle", name: "Struggle", type: "Normal", category: "Physical", power: 50 } as any;
							usingStruggle = true;
						}
					}
				}
				if (!move) continue;
				// At this point, either using Struggle or we have PP to use the move
				const basePP = move.pp ?? 10;
				const remaining = ppStore[move.id] ?? basePP;
				log(`${actor.name} used ${move.name}!`);
				anim.push({ type: "move:start", payload: { userId: actor.id, moveId: move.id } });
				// Taunt: block Status-category moves while taunted (skip for Struggle)
				if (!usingStruggle && (actor.volatile?.tauntTurns ?? 0) > 0 && move.category === "Status") {
					log(`${actor.name} can't use status moves due to Taunt!`);
					anim.push({ type: "status:taunt:block", payload: { userId: actor.id, moveId: move.id } });
					continue;
				}
				// Disable: if this specific move is disabled, block it (skip for Struggle)
				if (!usingStruggle && (actor.volatile?.disabledTurns ?? 0) > 0 && actor.volatile?.disabledMoveId === move.id) {
					log(`${actor.name} can't use ${move.name} due to Disable!`);
					anim.push({ type: "status:disable:block", payload: { userId: actor.id, moveId: move.id } });
					continue;
				}
				// Torment: cannot use the same move twice in a row (skip for Struggle)
				if (!usingStruggle && (actor.volatile?.tormentTurns ?? 0) > 0 && (actor.volatile?.lastMoveId === move.id)) {
					log(`${actor.name} can't use ${move.name} twice in a row due to Torment!`);
					anim.push({ type: "status:torment:block", payload: { userId: actor.id, moveId: move.id } });
					continue;
				}
				// Track last used move for mechanics like Encore/Disable source
				actor.volatile = actor.volatile || {};
				(actor.volatile as any).lastMoveId = move.id;
				this.executeMove(move, actor, target, log);
				// Struggle recoil: 25% of user's max HP after executing Struggle
				if (usingStruggle && actor.currentHP > 0) {
					const recoil = Math.max(1, Math.floor(actor.maxHP / 4));
					const selfDmg = this.utils(log).dealDamage(actor, recoil);
					log(`${actor.name} was hurt by recoil! (-${selfDmg})`);
					anim.push({ type: "move:recoil", payload: { userId: actor.id, damage: selfDmg } });
				}
				// Set Choice lock after first successful move (skip Struggle) unless items are suppressed
				if (!usingStruggle && hasChoice && !(actor.volatile as any).choiceLockedMoveId && !this.areItemsSuppressed()) {
					(actor.volatile as any).choiceLockedMoveId = move.id;
				}
				// Decrement PP only on successful execution (skip for Struggle). Pressure causes -2 per use.
				if (!usingStruggle) {
					if ((actor.volatile as any).skipPPThisAction) {
						(actor.volatile as any).skipPPThisAction = false;
					} else {
						let dec = 1;
						const targetHasPressure = (target.ability === "pressure");
						if (targetHasPressure) dec = 2;
						ppStore[move.id] = Math.max(0, (ppStore[move.id] ?? basePP) - dec);
					}
				}
				// Life Orb recoil only if a damaging move dealt damage this turn, unless items are suppressed
				if (!this.areItemsSuppressed() && actor.item === "life_orb" && move.category !== "Status") {
					// naive check: if target took any damage this action (totalDealt tracked? we infer by lastMoveId + target hp change)
					// Simpler: emit a marker on actor when executeMove dealt damage; read and clear here
					if ((actor.volatile as any).dealtDamageThisAction) {
						const recoil = Math.max(1, Math.floor(actor.maxHP / 10));
						const selfDmg = this.utils(log).dealDamage(actor, recoil);
						log(`${actor.name} is hurt by its Life Orb! (-${selfDmg})`);
						anim.push({ type: "item:life-orb:recoil", payload: { pokemonId: actor.id, damage: selfDmg } });
						(actor.volatile as any).dealtDamageThisAction = false;
					}
				}
				if (target.currentHP <= 0) {
					log(`${target.name} fainted!`);
					anim.push({ type: "pokemon:faint", payload: { pokemonId: target.id } });
				}
			// NOTE: Switches are processed in Phase 1, before any moves, so no switch handling here
		}

		// End-of-turn effects (statuses, items, weather, terrain)
		for (const p of this.state.players) {
			const mon = p.team[p.activeIndex];
			if (mon.currentHP > 0) this.emitStatusTick(mon, mon.status, log);
					if (!this.areItemsSuppressed() && mon.item && Items[mon.item]?.onEndOfTurn) Items[mon.item].onEndOfTurn!(mon, this.state, log);
					// Weather ability EOT: Rain Dish heal, Solar Power chip
					if (!this.isWeatherSuppressed() && mon.currentHP > 0) {
						const w = this.state.field.weather.id;
						const monUmbrella = !this.areItemsSuppressed() && ((mon.item ?? "").toLowerCase() === "utility_umbrella");
						if (w === "rain" && mon.ability === "rain_dish" && !monUmbrella) {
							const heal = Math.max(1, Math.floor(mon.maxHP / 16));
							const before = mon.currentHP;
							mon.currentHP = Math.min(mon.maxHP, mon.currentHP + heal);
							const delta = mon.currentHP - before;
							if (delta > 0) log(`${mon.name} restored HP with Rain Dish. (+${delta})`);
						}
						if (w === "sun" && mon.ability === "solar_power" && !monUmbrella) {
							const dmg = Math.max(1, Math.floor(mon.maxHP / 8));
							mon.currentHP = Math.max(0, mon.currentHP - dmg);
							log(`${mon.name} was hurt by Solar Power. (-${dmg})`);
						}
						if ((w === "hail" || w === "snow") && mon.ability === "ice_body") {
							const heal = Math.max(1, Math.floor(mon.maxHP / 16));
							const before = mon.currentHP;
							mon.currentHP = Math.min(mon.maxHP, mon.currentHP + heal);
							const delta = mon.currentHP - before;
							if (delta > 0) log(`${mon.name} restored HP with Ice Body. (+${delta})`);
						}
					}
				// Clear one-turn volatiles like Protect
				if (mon.volatile) {
					if ((mon.volatile as any).protect) {
						(mon.volatile as any).protect = false;
					} else if ((mon.volatile as any).protectChain) {
						// If Protect wasn't used successfully this turn, reset the chain
						(mon.volatile as any).protectChain = 0;
					}
						// Magnet Rise duration
						if ((mon.volatile as any).magnetRiseTurns && (mon.volatile as any).magnetRiseTurns > 0) {
							(mon.volatile as any).magnetRiseTurns -= 1;
							if ((mon.volatile as any).magnetRiseTurns === 0) {
								log(`${mon.name} came back down to the ground.`);
								anim.push({ type: "status:magnetrise:end", payload: { pokemonId: mon.id } });
							}
						}
						// Taunt duration
						if ((mon.volatile as any).tauntTurns && (mon.volatile as any).tauntTurns > 0) {
							(mon.volatile as any).tauntTurns -= 1;
							if ((mon.volatile as any).tauntTurns === 0) {
								log(`${mon.name} is no longer taunted.`);
								anim.push({ type: "status:taunt:end", payload: { pokemonId: mon.id } });
							}
						}
						// Encore duration
						if ((mon.volatile as any).encoreTurns && (mon.volatile as any).encoreTurns > 0) {
							(mon.volatile as any).encoreTurns -= 1;
							if ((mon.volatile as any).encoreTurns === 0) {
								log(`${mon.name}'s Encore ended!`);
								anim.push({ type: "status:encore:end", payload: { pokemonId: mon.id } });
							}
						}
						// Disable duration
						if ((mon.volatile as any).disabledTurns && (mon.volatile as any).disabledTurns > 0) {
							(mon.volatile as any).disabledTurns -= 1;
							if ((mon.volatile as any).disabledTurns === 0) {
								log(`${mon.name}'s Disable wore off!`);
								(mon.volatile as any).disabledMoveId = undefined;
								anim.push({ type: "status:disable:end", payload: { pokemonId: mon.id } });
							}
						}
						// Torment duration
						if ((mon.volatile as any).tormentTurns && (mon.volatile as any).tormentTurns > 0) {
							(mon.volatile as any).tormentTurns -= 1;
							if ((mon.volatile as any).tormentTurns === 0) {
								log(`${mon.name} is no longer tormented.`);
								anim.push({ type: "status:torment:end", payload: { pokemonId: mon.id } });
							}
						}
				}
		}

			// Default non-volatile status residuals
			for (const pl of this.state.players) {
				const mon = pl.team[pl.activeIndex];
				if (mon.currentHP <= 0) continue;
				switch (mon.status) {
					case "burn": {
						const dmg = Math.max(1, Math.floor(mon.maxHP / 16));
						mon.currentHP = Math.max(0, mon.currentHP - dmg);
						log(`${mon.name} is hurt by its burn! (${dmg})`);
						anim.push({ type: "status:burn:tick", payload: { pokemonId: mon.id, damage: dmg } });
						break;
					}
					case "poison": {
						const dmg = Math.max(1, Math.floor(mon.maxHP / 8));
						mon.currentHP = Math.max(0, mon.currentHP - dmg);
						log(`${mon.name} is hurt by poison! (${dmg})`);
						anim.push({ type: "status:poison:tick", payload: { pokemonId: mon.id, damage: dmg } });
						break;
					}
					case "toxic": {
						mon.volatile = mon.volatile || {};
						const prev = (mon.volatile as any).toxicCounter ?? 0;
						(mon.volatile as any).toxicCounter = prev + 1;
						const counter = (mon.volatile as any).toxicCounter as number;
						const dmg = Math.max(1, Math.floor((mon.maxHP / 16) * counter));
						mon.currentHP = Math.max(0, mon.currentHP - dmg);
						log(`${mon.name} is hurt by poison! (${dmg})`);
						anim.push({ type: "status:toxic:tick", payload: { pokemonId: mon.id, damage: dmg, counter } });
						break;
					}
				}
			}

			// Weather residuals (very simplified)
			if (!this.isWeatherSuppressed() && this.state.field.weather.id === "sandstorm") {
				for (const pl of this.state.players) {
					const mon = pl.team[pl.activeIndex];
					if (mon.currentHP <= 0) continue;
					// Overcoat prevents weather chip; Umbrella does not affect hail/snow
					if (mon.ability === "overcoat") continue;
					// Rock/Ground/Steel immune
					if (mon.types.some((t) => t === "Rock" || t === "Ground" || t === "Steel")) continue;
					const dmg = Math.max(1, Math.floor(mon.maxHP / 16));
					mon.currentHP = Math.max(0, mon.currentHP - dmg);
					log(`${mon.name} is buffeted by the sandstorm! (${dmg})`);
					anim.push({ type: "weather:sandstorm:tick", payload: { pokemonId: mon.id, damage: dmg } });
				}
			}

			// Hail residuals: chip non-Ice types (classic behavior), distinct from Gen9 Snow
			if (!this.isWeatherSuppressed() && this.state.field.weather.id === "hail") {
				for (const pl of this.state.players) {
					const mon = pl.team[pl.activeIndex];
					if (mon.currentHP <= 0) continue;
					if (mon.ability === "overcoat") continue;
					if (mon.types.includes("Ice")) continue;
					const dmg = Math.max(1, Math.floor(mon.maxHP / 16));
					mon.currentHP = Math.max(0, mon.currentHP - dmg);
					log(`${mon.name} is pelted by hail! (${dmg})`);
					anim.push({ type: "weather:hail:tick", payload: { pokemonId: mon.id, damage: dmg } });
				}
			}


			// Terrain residuals (Grassy Terrain heal simplified)
			if (this.state.field.terrain.id === "grassy") {
				for (const pl of this.state.players) {
					const mon = pl.team[pl.activeIndex];
					if (mon.currentHP <= 0) continue;
					const heal = Math.max(1, Math.floor(mon.maxHP / 16));
					const before = mon.currentHP;
					mon.currentHP = Math.min(mon.maxHP, mon.currentHP + heal);
					const delta = mon.currentHP - before;
					if (delta > 0) log(`${mon.name} is healed by the grassy terrain. (+${delta})`);
					if (delta > 0) anim.push({ type: "terrain:grassy:heal", payload: { pokemonId: mon.id, heal: delta } });
				}
			}

			// Decrement durations with end notifications
			const prevWeather = { ...this.state.field.weather };
			const prevTerrain = { ...this.state.field.terrain };
			const prevRoom = { ...this.state.field.room };
			const prevMagic = { ...this.state.field.magicRoom };
			const prevWonder = { ...this.state.field.wonderRoom };
			if (this.state.field.weather.turnsLeft > 0) this.state.field.weather.turnsLeft -= 1;
			if (this.state.field.terrain.turnsLeft > 0) this.state.field.terrain.turnsLeft -= 1;
			if (this.state.field.room.turnsLeft > 0) this.state.field.room.turnsLeft -= 1;
			if (this.state.field.magicRoom.turnsLeft > 0) this.state.field.magicRoom.turnsLeft -= 1;
			if (this.state.field.wonderRoom.turnsLeft > 0) this.state.field.wonderRoom.turnsLeft -= 1;
			if (prevWeather.id !== "none" && prevWeather.turnsLeft === 1) {
				// ended now
				log(`${prevWeather.id} weather subsided.`);
				anim.push({ type: `weather:${prevWeather.id}:end`, payload: {} });
				this.state.field.weather.id = "none";
			}
			if (prevTerrain.id !== "none" && prevTerrain.turnsLeft === 1) {
				log(`The ${prevTerrain.id} terrain faded.`);
				anim.push({ type: `terrain:${prevTerrain.id}:end`, payload: {} });
				this.state.field.terrain.id = "none";
			}
			if (prevRoom.id !== "none" && prevRoom.turnsLeft === 1) {
				log(`Trick Room twisted the dimensions back to normal.`);
				anim.push({ type: `room:trick_room:end`, payload: {} });
				this.state.field.room.id = "none";
			}
			if (prevMagic.id !== "none" && prevMagic.turnsLeft === 1) {
				log(`Magic Room's aura faded. Items work normally again.`);
				anim.push({ type: `room:magic_room:end`, payload: {} });
				this.state.field.magicRoom.id = "none";
			}
			if (prevWonder.id !== "none" && prevWonder.turnsLeft === 1) {
				log(`Wonder Room's bizarre area disappeared. Defenses swapped back.`);
				anim.push({ type: `room:wonder_room:end`, payload: {} });
				this.state.field.wonderRoom.id = "none";
			}

			// Side conditions timers: Tailwind, Reflect, Light Screen
			for (const pl of this.state.players) {
				if (!pl.sideConditions) continue;
				const before = { t: pl.sideConditions.tailwindTurns ?? 0, r: pl.sideConditions.reflectTurns ?? 0, l: pl.sideConditions.lightScreenTurns ?? 0 };
				if ((pl.sideConditions.tailwindTurns ?? 0) > 0) pl.sideConditions.tailwindTurns!--;
				if ((pl.sideConditions.reflectTurns ?? 0) > 0) pl.sideConditions.reflectTurns!--;
				if ((pl.sideConditions.lightScreenTurns ?? 0) > 0) pl.sideConditions.lightScreenTurns!--;
				if (before.t === 1 && (pl.sideConditions.tailwindTurns ?? 0) === 0) {
					log(`Tailwind petered out for ${pl.name}'s side.`);
					anim.push({ type: "side:tailwind:end", payload: { playerId: pl.id } });
				}
				if (before.r === 1 && (pl.sideConditions.reflectTurns ?? 0) === 0) {
					log(`Reflect wore off on ${pl.name}'s side.`);
					anim.push({ type: "side:reflect:end", payload: { playerId: pl.id } });
				}
				if (before.l === 1 && (pl.sideConditions.lightScreenTurns ?? 0) === 0) {
					log(`Light Screen wore off on ${pl.name}'s side.`);
					anim.push({ type: "side:lightscreen:end", payload: { playerId: pl.id } });
				}
			}

		const result = { state: this.state, events, anim } as TurnResult;
		// cleanup binding
		(this as any)._pushAnim = undefined;
		return result;
	}

	// Event subscriptions
	onMoveExecute(handler: Handler<[Move, Pokemon, Pokemon, BattleState, LogSink]>): void {
		this.moveHandlers.push(handler);
	}
	onStatusTick(handler: Handler<[Pokemon, NonVolatileStatusId, BattleState, LogSink]>): void {
		this.statusTickHandlers.push(handler);
	}
	onSwitchIn(handler: Handler<[Pokemon, BattleState, LogSink]>): void {
		this.switchInHandlers.push(handler);
	}

	// Internals
	private rng() {
		// Simple LCG for deterministic ties/tests if seed provided
		if (this.state.rngSeed == null) return Math.random();
		let seed = this.state.rngSeed;
		seed = (seed * 1664525 + 1013904223) % 0xffffffff;
		this.state.rngSeed = seed;
		return (seed & 0xfffffff) / 0xfffffff;
	}

	private getPokemonById(id: string): Pokemon | undefined {
		for (const pl of this.state.players) {
			for (const mon of pl.team) if (mon.id === id) return mon;
		}
		return undefined;
	}

	private isWeatherSuppressed(): boolean {
		// Suppressed if any active Pokémon has Cloud Nine or Air Lock
		for (const pl of this.state.players) {
			const mon = pl.team[pl.activeIndex];
			const abil = (mon.ability ?? "").toLowerCase();
			if (abil === "cloud_nine" || abil === "cloudnine" || abil === "air_lock" || abil === "airlock") return true;
		}
		return false;
	}

	private areItemsSuppressed(): boolean {
		return this.state.field.magicRoom.id === "magic_room";
	}

	private isGrounded(p: Pokemon): boolean {
		// Flying-types are not grounded
		if (p.types.includes("Flying")) return false;
		// Magnet Rise volatile effect
		if ((p.volatile?.magnetRiseTurns ?? 0) > 0) return false;
		// Air Balloon item
		const item = (p.item ?? "").toLowerCase();
		if (!this.areItemsSuppressed() && ["air_balloon", "airballoon", "air-balloon"].includes(item)) return false;
		return true;
	}

	private compareActions(a: BattleAction, b: BattleAction): number {
		// Switches generally happen before moves in Pokémon; we keep it simple: switch priority = 6
		const priorityA = a.type === "switch" ? 6 : this.actionPriority(a);
		const priorityB = b.type === "switch" ? 6 : this.actionPriority(b);
		if (priorityA !== priorityB) return priorityB - priorityA; // higher first

		// Speed comparison (note: actionSpeed accounts for Trick Room)
		const speA = this.actionSpeed(a);
		const speB = this.actionSpeed(b);
		if (speA !== speB) return speB - speA; // higher speed first

		// TRUE SPEED TIE: same priority AND same speed
		// Random tie-break each time (matches Pokemon Showdown's behavior)
		return this.rng() < 0.5 ? -1 : 1;
	}

	// Compare move actions only (for Phase 2 sorting after switches)
	private compareMoveActions(a: MoveAction, b: MoveAction): number {
		// Get the CURRENT active Pokemon for each player (after switches!)
		const playerA = this.state.players.find(p => p.id === a.actorPlayerId);
		const playerB = this.state.players.find(p => p.id === b.actorPlayerId);
		const actorA = playerA?.team[playerA.activeIndex];
		const actorB = playerB?.team[playerB.activeIndex];
		
		// Move priority comparison
		const moveA = actorA?.moves.find(m => m.id === a.moveId);
		const moveB = actorB?.moves.find(m => m.id === b.moveId);
		const priorityA = moveA?.priority ?? 0;
		const priorityB = moveB?.priority ?? 0;
		if (priorityA !== priorityB) return priorityB - priorityA; // higher priority first
		
		// Speed comparison using current active Pokemon
		const speA = actorA ? this.getEffectiveSpeed(actorA) : 0;
		const speB = actorB ? this.getEffectiveSpeed(actorB) : 0;
		const trickRoom = this.state.field.room.id === "trick_room";
		const adjustedSpeA = trickRoom ? -speA : speA;
		const adjustedSpeB = trickRoom ? -speB : speB;
		if (adjustedSpeA !== adjustedSpeB) return adjustedSpeB - adjustedSpeA; // higher speed first
		
		// TRUE SPEED TIE: random each time
		return this.rng() < 0.5 ? -1 : 1;
	}

	private actionPriority(a: BattleAction): number {
		if (a.type === "move") {
			const actor = this.getPokemonById(a.pokemonId);
			const move = actor?.moves.find((m) => m.id === a.moveId);
			return move?.priority ?? 0;
		}
		return 0;
	}

	private actionSpeed(a: BattleAction): number {
		const actor = this.getPokemonById(a.pokemonId);
		if (!actor) return 0;
		const base = this.getEffectiveSpeed(actor);
		const trick = this.state.field.room.id === "trick_room";
		return trick ? -base : base;
	}

		private executeMove(move: Move, user: Pokemon, target: Pokemon, log: LogSink) {
		// broadcast to external listeners first
		for (const h of this.moveHandlers) h(move, user, target, this.state, log);

			// Default handling: if move has onUse, call it; otherwise do a damage calc with STAB/type chart
		if (move.onUse) {
			move.onUse({ state: this.state, user, target, move, log, utils: this.utils(log) });
		} else if (move.power && move.category !== "Status") {
			// Protect check (volatile flag set by move effects)
			if (target.volatile?.protect) {
				log(`${target.name} protected itself!`);
				(this as any)._pushAnim?.({ type: "move:blocked", payload: { targetId: target.id } });
				return;
			}
			// Move overrides before accuracy/damage (Weather Ball adapts to weather; Solar Beam charge)
			let executingMove: Move = { ...move };
			if (!this.isWeatherSuppressed() && move.id === "weather_ball") {
				const w = this.state.field.weather.id;
				if (w === "sun") executingMove.type = "Fire";
				else if (w === "rain") executingMove.type = "Water";
				else if (w === "sandstorm") executingMove.type = "Rock";
				else if (w === "hail" || w === "snow") executingMove.type = "Ice";
				if (w !== "none") executingMove.power = Math.max(1, Math.floor((move.power ?? 0) * 2));
			}
			// Solar Beam: two-turn when not sunny; charge first, fire next turn (skip PP on the firing turn)
			if (executingMove.id === "solar_beam") {
				const sunny = (!this.isWeatherSuppressed() && this.state.field.weather.id === "sun");
				const charging = (user.volatile as any)?.solarBeamCharging === true;
				if (!sunny && !charging) {
					user.volatile = user.volatile || {} as any;
					(user.volatile as any).solarBeamCharging = true;
					log(`${user.name} absorbed light!`);
					(this as any)._pushAnim?.({ type: "move:charge", payload: { userId: user.id, moveId: executingMove.id } });
					return;
				}
				if (charging) {
					(user.volatile as any).solarBeamCharging = false;
					(user.volatile as any).skipPPThisAction = true;
				}
			}
				// Accuracy check incl. acc/eva stages and No Guard
				if (executingMove.accuracy != null) {
					const noGuard = (["no_guard", "noguard"].includes(user.ability ?? "")) || (["no_guard", "noguard"].includes(target.ability ?? ""));
					if (!noGuard) {
						const accStage = user.stages.acc ?? 0;
						const evaStage = target.stages.eva ?? 0;
						const accMult = stageMultiplier(accStage, 3, 3);
						const evaMult = stageMultiplier(evaStage, 3, 3);
						let effectiveAcc = (executingMove.accuracy as number) * (accMult / evaMult);
						// Weather accuracy mods for Thunder/Hurricane
						if (!this.isWeatherSuppressed()) {
							const targetUmbrellaActive = !this.areItemsSuppressed() && ((target.item ?? "").toLowerCase() === "utility_umbrella");
							const w = this.state.field.weather.id;
							// If the move targets an Umbrella holder, ignore rain/sun accuracy changes
							if (!targetUmbrellaActive) {
								if (w === "rain" && (executingMove.id === "thunder" || executingMove.name.toLowerCase() === "thunder" || executingMove.id === "hurricane" || executingMove.name.toLowerCase() === "hurricane")) {
									effectiveAcc = 100;
								}
								if (w === "sun" && (executingMove.id === "thunder" || executingMove.name.toLowerCase() === "thunder" || executingMove.id === "hurricane" || executingMove.name.toLowerCase() === "hurricane")) {
									effectiveAcc = Math.floor(effectiveAcc * 0.5);
								}
							}
						}
						// Snow Cloak evasion under hail/snow (approx -20% hit chance)
						if (!this.isWeatherSuppressed() && (["hail", "snow"].includes(this.state.field.weather.id))) {
							if ((target.ability ?? "") === "snow_cloak") {
								effectiveAcc *= 0.8;
							}
						}
						// Target-held evasion items: Bright Powder / Lax Incense (~10% reduction)
						{
							const item = (target.item ?? "").toLowerCase().replace(/[-_\s]/g, "");
							if (!this.areItemsSuppressed() && (item === "brightpowder" || item === "laxincense")) {
								effectiveAcc *= 0.9;
							}
						}
						effectiveAcc = this.modifyAccuracy(user, effectiveAcc);
						effectiveAcc = Math.max(1, Math.min(100, Math.floor(effectiveAcc)));
						const roll = this.rng() * 100;
						if (roll >= effectiveAcc) {
							log(`${user.name}'s attack missed!`);
							return;
						}
					}
				}

				// reset damage marker for Life Orb timing
				user.volatile = user.volatile || {};
				(user.volatile as any).dealtDamageThisAction = false;
				const hits = this.getMultiHit(move);
				let totalDealt = 0;
				let effectivenessSeen: number | null = null;
				let critHappened = false;
				for (let i = 0; i < hits; i++) {
					if (user.currentHP <= 0 || target.currentHP <= 0) break;

					// Absorb/immunity abilities
					if (move.type === "Water" && target.ability === "water_absorb") {
						const heal = Math.max(1, Math.floor(target.maxHP / 4));
						const healed = this.utils(log).heal(target, heal);
						log(`${target.name} absorbed the water and restored HP! (+${healed})`);
						(this as any)._pushAnim?.({ type: "ability:water-absorb", payload: { pokemonId: target.id, heal: healed } });
						return;
					}
					if (move.type === "Electric" && target.ability === "volt_absorb") {
						const heal = Math.max(1, Math.floor(target.maxHP / 4));
						const healed = this.utils(log).heal(target, heal);
						log(`${target.name} absorbed the electricity and restored HP! (+${healed})`);
						(this as any)._pushAnim?.({ type: "ability:volt-absorb", payload: { pokemonId: target.id, heal: healed } });
						return;
					}
					if (move.type === "Fire" && target.ability === "flash_fire") {
						target.volatile = target.volatile || {} as any;
						(target.volatile as any).flashFireBoost = true;
						log(`${target.name}'s Flash Fire boosted its Fire power!`);
						(this as any)._pushAnim?.({ type: "ability:flash-fire", payload: { pokemonId: target.id } });
						return;
					}

					const atk = this.modifyAttack(user, this.getEffectiveAttack(user, executingMove.category), executingMove.category);
					// Wonder Room: swap the defensive stat used for damage calculation
					const useWonderSwap = this.state.field.wonderRoom.id === "wonder_room";
					const baseDefStat = (() => {
						if (!useWonderSwap) return chooseDefenseStat(target, executingMove.category);
						// Swap: Physical uses SpD, Special uses Def
						return executingMove.category === "Physical" ? target.baseStats.spd : target.baseStats.def;
					})();
					const usedStatKind: "def" | "spd" = useWonderSwap ? (executingMove.category === "Physical" ? "spd" : "def") : (executingMove.category === "Physical" ? "def" : "spd");
					(this as any)._usingDefenseStatKind = usedStatKind;
					const def = this.modifyDefense(target, baseDefStat, executingMove.category);
					(this as any)._usingDefenseStatKind = undefined;
					const crit = this.rollCrit((move.critRatio as number) ?? 0);
					// Ground immunity via Levitate/Magnet Rise/Air Balloon (Flying handled by type chart)
					if (executingMove.type === "Ground") {
						const hasLevitate = target.ability === "levitate";
						const hasMagnetRise = (target.volatile?.magnetRiseTurns ?? 0) > 0;
						const hasBalloon = !this.areItemsSuppressed() && ["air_balloon", "airballoon", "air-balloon"].includes((target.item ?? "").toLowerCase());
						if (hasLevitate || hasMagnetRise || hasBalloon) {
							log(`${target.name} is unaffected by Ground moves!`);
							effectivenessSeen = 0;
							continue;
						}
					}
					const { damage, effectiveness, stab } = calcDamage(user, target, executingMove, atk, def, { rng: () => this.rng() });
					effectivenessSeen = effectivenessSeen ?? effectiveness;
					let finalDamage = damage;
					if (crit) {
						finalDamage = Math.floor(finalDamage * 1.5);
						critHappened = true;
					}
					// Ability/item damage mods hooks
					finalDamage = this.modifyDamage(user, target, finalDamage);

					// Field modifiers: weather/terrain simplified + conditional ability boosts
					(this as any)._currentTarget = target;
					finalDamage = this.applyFieldDamageMods(finalDamage, executingMove, user);
					(this as any)._currentTarget = undefined;

					// Side conditions: Reflect/Light Screen on the target's side (ignored on critical hits)
					const targetOwner = this.state.players.find(pl => pl.team.some(m => m.id === target.id));
					if (!crit && targetOwner?.sideConditions) {
						if (move.category === "Physical" && (targetOwner.sideConditions.reflectTurns ?? 0) > 0) {
							finalDamage = Math.floor(finalDamage * 0.5);
						}
						if (move.category === "Special" && (targetOwner.sideConditions.lightScreenTurns ?? 0) > 0) {
							finalDamage = Math.floor(finalDamage * 0.5);
						}
					}

					// Survival effects (Focus Sash/Sturdy)
					finalDamage = this.applySurvivalEffects(target, user, finalDamage, log);

					// Substitute redirection: if target has a substitute, damage the sub instead
					let dealt: number;
					if ((target.volatile as any)?.substituteHP && (target.volatile as any).substituteHP > 0) {
						const subHP = (target.volatile as any).substituteHP as number;
						const dmgToSub = Math.min(subHP, finalDamage);
						(target.volatile as any).substituteHP = subHP - dmgToSub;
						dealt = dmgToSub;
						(this as any)._pushAnim?.({ type: "substitute:hit", payload: { targetId: target.id, damage: dmgToSub } });
						if ((target.volatile as any).substituteHP === 0) {
							log(`${target.name}'s substitute faded!`);
							(this as any)._pushAnim?.({ type: "substitute:break", payload: { pokemonId: target.id } });
						}
					} else {
						dealt = this.utils(log).dealDamage(target, finalDamage);
					}
					if (dealt > 0) {
						(this as any)._pushAnim?.({ type: "move:hit", payload: { targetId: target.id, damage: dealt } });
						// mark on user that damage was dealt this action for Life Orb timing
						user.volatile = user.volatile || {};
						(user.volatile as any).dealtDamageThisAction = true;
					}
					// Pop Air Balloon if present and took damage (but not while items are suppressed by Magic Room)
					if (dealt > 0 && !this.areItemsSuppressed() && ["air_balloon", "airballoon", "air-balloon"].includes((target.item ?? "").toLowerCase())) {
						log(`${target.name}'s Air Balloon popped!`);
						(this as any)._pushAnim?.({ type: "item:air-balloon:pop", payload: { pokemonId: target.id } });
						target.item = undefined;
					}
					totalDealt += dealt;
				}

				if (effectivenessSeen === 0) {
					log(`It doesn't affect ${target.name}...`);
					return;
				}
				// Calculate damage as percentage of max HP
				const damagePercent = target.maxHP > 0 ? ((totalDealt / target.maxHP) * 100).toFixed(2) : '0.00';
				log(`It dealt ${damagePercent}% damage${hits > 1 ? ` in ${hits} hits` : ""}.`);
				if (critHappened) log("A critical hit!");
				if (effectivenessSeen! > 1) log("It's super effective!");
				else if (effectivenessSeen! < 1) log("It's not very effective...");

				// Post-damage switch for pivoting moves (U-turn / Volt Switch simplified)
				if (move.switchesUserOut) {
					const owner = this.state.players.find(pl => pl.team.some(m => m.id === user.id));
					if (owner && user.currentHP > 0) {
						// pick first healthy bench mon different from current active
						const currentIdx = owner.team.findIndex(m => m.id === user.id);
						const nextIdx = owner.team.findIndex((m, idx) => idx !== currentIdx && m.currentHP > 0);
						if (nextIdx >= 0) {
							owner.activeIndex = nextIdx;
							const next = owner.team[nextIdx];
							log(`${owner.name} pivoted out to ${next.name}!`);
							this.emitSwitchIn(next, log);
							(this as any)._pushAnim?.({ type: "switch", payload: { playerId: owner.id, pokemonId: next.id } });
						}
					}
				}
		}
	}

	private emitStatusTick(pokemon: Pokemon, status: NonVolatileStatusId, log: LogSink = (m) => this.state.log.push(m)) {
		for (const h of this.statusTickHandlers) h(pokemon, status, this.state, log);
	}

	private emitSwitchIn(pokemon: Pokemon, log: LogSink = (m) => this.state.log.push(m)) {
		for (const h of this.switchInHandlers) h(pokemon, this.state, log);
		// Ability on-switch-in hooks
		if (pokemon.ability && Abilities[pokemon.ability]?.onSwitchIn) {
			Abilities[pokemon.ability].onSwitchIn!(pokemon, this.state, log);
		}
		// Hazards: Stealth Rock (stored on the side the Pokémon belongs to)
		const owner = this.state.players.find(p => p.team.some(m => m.id === pokemon.id));
		// Initialize PP store
		pokemon.volatile = pokemon.volatile || {};
		(pokemon.volatile as any).pp = (pokemon.volatile as any).pp || {};
		// Reset toxic counter on switch-in
		(pokemon.volatile as any).toxicCounter = 0;
		// Clear substitute on switch-in (cannot persist)
		if (pokemon.volatile) (pokemon.volatile as any).substituteHP = 0;
		// Heavy-Duty Boots: ignore all hazard effects (including absorption) unless Magic Room suppresses items
		const hasBoots = ["heavy-duty-boots","heavy_duty_boots","heavydutyboots"].includes(pokemon.item ?? "");
		if (hasBoots && !this.areItemsSuppressed()) return;
		if (owner?.sideHazards?.stealthRock) {
			const mult = typeEffectiveness("Rock", pokemon.types);
			const frac = (1 / 8) * mult; // simplified scaling by effectiveness
			const dmg = Math.max(1, Math.floor(pokemon.maxHP * frac));
			pokemon.currentHP = Math.max(0, pokemon.currentHP - dmg);
			log(`${pokemon.name} is hurt by Stealth Rock! (-${dmg})`);
			(this as any)._pushAnim?.({ type: "hazard:stealth-rock", payload: { pokemonId: pokemon.id, damage: dmg } });
		}
		// Hazards: Spikes (grounded only)
		if (owner?.sideHazards?.spikesLayers && this.isGrounded(pokemon)) {
			const layers = Math.max(1, Math.min(3, owner.sideHazards.spikesLayers));
			const frac = layers === 1 ? 1/8 : layers === 2 ? 1/6 : 1/4;
			const dmg = Math.max(1, Math.floor(pokemon.maxHP * frac));
			pokemon.currentHP = Math.max(0, pokemon.currentHP - dmg);
			log(`${pokemon.name} is hurt by Spikes! (-${dmg})`);
			(this as any)._pushAnim?.({ type: "hazard:spikes", payload: { pokemonId: pokemon.id, layers, damage: dmg } });
		}
		// Hazards: Toxic Spikes (grounded only): 1 layer = poison, 2 layers = bad poison; Poison-type absorbs
		if (owner?.sideHazards?.toxicSpikesLayers && this.isGrounded(pokemon)) {
			if (pokemon.types.includes("Poison")) {
				// Absorb and clear
				owner.sideHazards.toxicSpikesLayers = 0;
				log(`${pokemon.name} absorbed the Toxic Spikes!`);
				(this as any)._pushAnim?.({ type: "hazard:toxicspikes:absorb", payload: { pokemonId: pokemon.id } });
			} else if (pokemon.status === "none") {
				const layers = Math.max(1, Math.min(2, owner.sideHazards.toxicSpikesLayers));
				pokemon.status = layers >= 2 ? "toxic" : "poison";
				log(`${pokemon.name} was poisoned by Toxic Spikes!`);
				(this as any)._pushAnim?.({ type: "hazard:toxicspikes", payload: { pokemonId: pokemon.id, layers } });
			}
		}
		// Hazards: Sticky Web (grounded only) -> drop speed stage by 1
		if (owner?.sideHazards?.stickyWeb && this.isGrounded(pokemon)) {
			pokemon.stages.spe = Math.max(-6, (pokemon.stages.spe ?? 0) - 1);
			log(`${pokemon.name}'s Speed was lowered by Sticky Web!`);
			(this as any)._pushAnim?.({ type: "hazard:stickyweb", payload: { pokemonId: pokemon.id } });
		}
	}

	private utils(log: LogSink): EngineUtils {
		return {
			dealDamage: (pokemon, amount) => {
				const before = pokemon.currentHP;
				pokemon.currentHP = clamp(pokemon.currentHP - Math.max(0, Math.floor(amount)), 0, pokemon.maxHP);
				return before - pokemon.currentHP;
			},
			heal: (pokemon, amount) => {
				const before = pokemon.currentHP;
				pokemon.currentHP = clamp(pokemon.currentHP + Math.max(0, Math.floor(amount)), 0, pokemon.maxHP);
				const healed = pokemon.currentHP - before;
				if (healed > 0) (this as any)._pushAnim?.({ type: "heal", payload: { pokemonId: pokemon.id, heal: healed } });
				return healed;
			},
			applyStatus: (pokemon, status) => {
				// Block status application if a Substitute is active
				if (((pokemon.volatile as any)?.substituteHP ?? 0) > 0) return;
				// Type/field immunities (subset)
				const types = pokemon.types;
				if (status === "burn" && types.includes("Fire")) return;
				if ((status === "poison" || status === "toxic") && (types.includes("Steel") || types.includes("Poison"))) return;
				if (status === "paralysis" && types.includes("Electric")) return;
				if (status === "sleep") {
					if (this.state.field.terrain.id === "electric" && this.isGrounded(pokemon)) {
						return;
					}
				}
				if (pokemon.status === "none") {
					pokemon.status = status;
					// Initialize timers/counters for some statuses
					if (status === "sleep") {
						pokemon.volatile = pokemon.volatile || {};
						(pokemon.volatile as any).sleepTurns = 2; // simplified duration
					}
					if (status === "toxic") {
						pokemon.volatile = pokemon.volatile || {};
						(pokemon.volatile as any).toxicCounter = 0;
					}
					log(`${pokemon.name} is now ${status}!`);
					// Lum Berry cures on application
					if ((pokemon.item ?? "").toLowerCase() === "lum_berry") {
						pokemon.status = "none";
						pokemon.item = undefined;
						log(`${pokemon.name}'s Lum Berry cured its status!`);
					}
				}
			},
					modifyStatStages: (pokemon, changes) => {
						for (const [k, v] of Object.entries(changes)) {
							const key = k as keyof typeof pokemon.stages;
							const current = (pokemon.stages as any)[key] ?? 0;
							const next = Math.max(-6, Math.min(6, current + (v ?? 0)));
							(pokemon.stages as any)[key] = next;
						}
					},
			getEffectiveSpeed: (pokemon) => this.getEffectiveSpeed(pokemon),
			getEffectiveAttack: (pokemon, category) => this.getEffectiveAttack(pokemon, category),
			emitAnim: (event) => ((this as any)._pushAnim?.(event)),
			rng: () => this.rng(),
		};
	}

	private getEffectiveSpeed(p: Pokemon): number {
		const base = p.baseStats.spe;
		let mult = stageMultiplier(p.stages.spe ?? 0);
		if (p.status === "paralysis") mult *= 0.5; // simplified
		// Weather speed abilities (ignored if holder has Utility Umbrella)
		const hasUmbrella = !this.areItemsSuppressed() && ((p.item ?? "").toLowerCase() === "utility_umbrella");
		if (!this.isWeatherSuppressed() && !hasUmbrella && this.state.field.weather.id === "rain" && ["swift_swim","swiftswim"].includes(p.ability ?? "")) mult *= 2;
		if (!this.isWeatherSuppressed() && !hasUmbrella && this.state.field.weather.id === "sun" && p.ability === "chlorophyll") mult *= 2;
		if (!this.isWeatherSuppressed() && (this.state.field.weather.id === "snow" || this.state.field.weather.id === "hail") && p.ability === "slush_rush") mult *= 2;
		// Tailwind on owner's side doubles speed
		const owner = this.state.players.find(pl => pl.team.some(m => m.id === p.id));
		if (owner?.sideConditions?.tailwindTurns && owner.sideConditions.tailwindTurns > 0) {
			mult *= 2;
		}
		let speed = Math.floor(base * mult);
		// Ability/item hooks
		if (p.ability && Abilities[p.ability]?.onModifySpeed) speed = Abilities[p.ability].onModifySpeed!(p, speed);
		if (p.item && Items[p.item]?.onModifySpeed) speed = Items[p.item].onModifySpeed!(p, speed);
		return speed;
	}

	private getEffectiveAttack(p: Pokemon, category: Category): number {
		const isPhysical = category === "Physical";
		const base = isPhysical ? p.baseStats.atk : p.baseStats.spa;
		const stage = isPhysical ? (p.stages.atk ?? 0) : (p.stages.spa ?? 0);
		let mult = stageMultiplier(stage);
		if (isPhysical && p.status === "burn") mult *= 0.5; // simplified burn halving
		// Solar Power: boost Special Attack in sun (ignored if holder has Utility Umbrella)
		if (!isPhysical && !this.isWeatherSuppressed() && this.state.field.weather.id === "sun" && p.ability === "solar_power") {
			const pUmbrella = !this.areItemsSuppressed() && ((p.item ?? "").toLowerCase() === "utility_umbrella");
			if (!pUmbrella) {
			mult *= 1.5;
			}
		}
		return Math.floor(base * mult);
	}

	private applyFieldDamageMods(damage: number, move: Move, user: Pokemon): number {
		const weather = this.state.field.weather.id;
		const terrain = this.state.field.terrain.id;
		let d = damage;
		// Weather
		const userUmbrella = !this.areItemsSuppressed() && ((user.item ?? "").toLowerCase() === "utility_umbrella");
		const target = (this as any)._currentTarget as Pokemon | undefined;
		const targetUmbrella = target ? (!this.areItemsSuppressed() && ((target.item ?? "").toLowerCase() === "utility_umbrella")) : false;
		if (!this.isWeatherSuppressed()) {
			// Special handling: Hydro Steam is boosted by sun and not reduced by sun; in rain it's still boosted like Water
			const isHydroSteam = (move.id === "hydro_steam" || move.name.toLowerCase() === "hydro steam");
			if (weather === "sun") {
				if (!targetUmbrella) {
					if (move.type === "Fire") d = Math.floor(d * 1.5);
					// Sun normally reduces Water; exception for Hydro Steam
					if (move.type === "Water" && !isHydroSteam) d = Math.floor(d * 0.5);
				}
				// Hydro Steam gets a sun boost regardless of target Umbrella (cartridge behavior)
				if (move.type === "Water" && isHydroSteam) d = Math.floor(d * 1.5);
			}
			if (weather === "rain") {
				if (!targetUmbrella) {
					if (move.type === "Water") d = Math.floor(d * 1.5);
					if (move.type === "Fire") d = Math.floor(d * 0.5);
				}
			}
			// Solar Beam: halved power in rain, sandstorm, hail/snow; normal in sun and clear
			if (move.id === "solar_beam") {
				if (weather === "rain" || weather === "sandstorm" || weather === "hail" || weather === "snow") {
					d = Math.floor(d * 0.5);
				}
			}
		}
		// In Gen 9, Snow boosts Defense of Ice-types; no Ice power boost here
		// Terrain (subset)
		if (terrain === "grassy") {
			if (move.type === "Grass") d = Math.floor(d * 1.3);
		}
		// Conditional abilities at low HP
		if (user.currentHP <= Math.floor(user.maxHP / 3)) {
			if (user.ability === "blaze" && move.type === "Fire") d = Math.floor(d * 1.5);
			if (user.ability === "torrent" && move.type === "Water") d = Math.floor(d * 1.5);
			if (user.ability === "overgrow" && move.type === "Grass") d = Math.floor(d * 1.5);
		}
		// Flash Fire boost (toggle set when absorbing Fire hit)
		if (move.type === "Fire" && (user.volatile as any)?.flashFireBoost) {
			d = Math.floor(d * 1.5);
		}
		// Sand Force: boost Rock/Ground/Steel moves in sandstorm
		if (!this.isWeatherSuppressed() && this.state.field.weather.id === "sandstorm" && user.ability === "sand_force") {
			if (["Rock","Ground","Steel"].includes(move.type)) d = Math.floor(d * 1.3);
		}
		return d;
	}

	private applySurvivalEffects(target: Pokemon, user: Pokemon, damage: number, log: LogSink): number {
		if (damage < target.currentHP) return damage;
		if (target.currentHP <= 1) return damage;
		// Only from full HP
		if (target.currentHP === target.maxHP) {
			if (!this.areItemsSuppressed() && target.item === "focus_sash") {
				const reduced = target.currentHP - 1;
				log(`${target.name} hung on using its Focus Sash!`);
				(this as any)._pushAnim?.({ type: "survive:focus-sash", payload: { pokemonId: target.id } });
				// consume item
				target.item = undefined;
				return reduced;
			}
			if (target.ability === "sturdy") {
				const reduced = target.currentHP - 1;
				log(`${target.name} endured the hit with Sturdy!`);
				(this as any)._pushAnim?.({ type: "survive:sturdy", payload: { pokemonId: target.id } });
				return reduced;
			}
		}
		return damage;
	}

		// Accuracy modifications via abilities/items (simplified)
		private modifyAccuracy(user: Pokemon, acc: number): number {
			if (user.ability && Abilities[user.ability]?.onModifyAccuracy)
				acc = Abilities[user.ability].onModifyAccuracy!(user, acc);
			return Math.max(1, Math.min(100, acc));
		}

		private modifyAttack(user: Pokemon, atk: number, category: Category): number {
			if (user.ability && Abilities[user.ability]?.onModifyAtk)
				atk = Abilities[user.ability].onModifyAtk!(user, atk, category);
			if (user.item && Items[user.item]?.onModifyAtk)
				atk = Items[user.item].onModifyAtk!(user, atk, category);
			return atk;
		}

		private modifyDefense(target: Pokemon, def: number, category: Category): number {
			if (target.ability && Abilities[target.ability]?.onModifyDef)
				def = Abilities[target.ability].onModifyDef!(target, def, category);
			if (target.item && Items[target.item]?.onModifyDef)
				def = Items[target.item].onModifyDef!(target, def, category);
			// Sandstorm Rock Sp. Def boost and Snow Ice-type Def boost (Umbrella does not affect)
			// Apply based on the actual defensive stat used (accounts for Wonder Room swaps)
			const usedKind = (this as any)._usingDefenseStatKind as ("def"|"spd"|undefined);
			const weatherId = this.state.field.weather.id;
			if (!this.isWeatherSuppressed() && weatherId === "sandstorm" && target.types.includes("Rock")) {
				const usingSpD = usedKind ? (usedKind === "spd") : (category === "Special");
				if (usingSpD) def = Math.floor(def * 1.5);
			}
			if (!this.isWeatherSuppressed() && weatherId === "snow" && target.types.includes("Ice")) {
				const usingDef = usedKind ? (usedKind === "def") : (category === "Physical");
				if (usingDef) def = Math.floor(def * 1.5);
			}
			return def;
		}

		private modifyDamage(user: Pokemon, target: Pokemon, damage: number): number {
			if (user.ability && Abilities[user.ability]?.onModifyDamage)
				damage = Abilities[user.ability].onModifyDamage!(user, target, damage);
			if (user.item && Items[user.item]?.onModifyDamage)
				damage = Items[user.item].onModifyDamage!(user, damage);
			return damage;
		}

		private rollCrit(critRatio: number): boolean {
			// Showdown-ish tiers: 0 => 1/24, 1 => 1/8, 2 => 1/2, 3+ => 1
			const p = critRatio >= 3 ? 1 : critRatio === 2 ? 0.5 : critRatio === 1 ? 1 / 8 : 1 / 24;
			return this.rng() < p;
		}

		private getMultiHit(move: Move): number {
			if (!move.multiHit) return 1;
			if (typeof move.multiHit === "number") return move.multiHit;
			const [min, max] = move.multiHit;
			const r = this.rng();
			return min + Math.floor(r * (max - min + 1));
		}

	// Simple helper to set/unset Protect on a Pokémon for this turn
	setProtect(pokemon: Pokemon, enabled: boolean) {
		pokemon.volatile = pokemon.volatile || {};
		(pokemon.volatile as any).protect = enabled;
	}

	// Get the current battle state
	getState(): BattleState {
		return this.state;
	}
}

export default Engine;

