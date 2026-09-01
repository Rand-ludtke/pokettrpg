"use strict";
/**
 * Synchronous Pokemon Showdown Battle Engine
 *
 * This provides a synchronous interface to the PS BattleStream by running
 * the battle simulation synchronously (PS simulator supports this mode).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncPSEngine = void 0;
const fs = require("fs");
const path = require("path");
// Import Pokemon Showdown simulator
const ps = require("pokemon-showdown");
const { Battle: PSBattle, Teams, PRNG, Dex } = ps;
const customMovesData = require("./data/moves.js");

const customMoves = customMovesData.default || customMovesData;

function loadJsonSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (error) {
        console.warn(`[SyncPSEngine] Failed to read ${filePath}: ${error?.message || error}`);
        return null;
    }
}

function loadCustomDexPayload() {
    // Aggregate species/moves/abilities/items across all fan-game / custom datasets.
    const aggregated = { species: {}, moves: {}, abilities: {}, items: {} };

    // (1) Primary unified customdex.json sources (optional). Later entries take
    // precedence so the canonical tauri-app dataset wins over any stale legacy
    // copy under "more pokemon/".
    const primaryCandidates = [
        path.resolve(__dirname, "../data/customdex.json"),
        path.resolve(process.cwd(), "data/customdex.json"),
        path.resolve(__dirname, "../../more pokemon/wylin-customs.generated.json"),
        path.resolve(__dirname, "../../tauri-app/public/data/more-pokemon/generated/wylin-customs.generated.json"),
    ];
    for (const candidate of primaryCandidates) {
        const parsed = loadJsonSafe(candidate);
        if (!parsed) continue;
        const species = parsed.species || parsed.dex || {};
        const moves = parsed.moves || {};
        const abilities = parsed.abilities || {};
        const items = parsed.items || {};
        if (!Object.keys(species).length && !Object.keys(moves).length && !Object.keys(abilities).length && !Object.keys(items).length) continue;
        Object.assign(aggregated.species, species);
        Object.assign(aggregated.moves, moves);
        Object.assign(aggregated.abilities, abilities);
        Object.assign(aggregated.items, items);
        console.log(`[SyncPSEngine] Loaded custom dex payload from ${candidate} (species:${Object.keys(species).length} moves:${Object.keys(moves).length} abilities:${Object.keys(abilities).length})`);
    }

    // (2) Per fan-game custom data: moves / abilities / pokedex split across files.
    // Each entry is a directory under tauri-app/public/data/<game>/generated/.
    // Tuple form: [directoryName, fileNameSuffix] — they differ for ss2-patch,
    // whose files are named *.ss2-soulstones.json.
    const fanGameDirs = [
        ["infinity", "infinity"],
        ["uranium", "uranium"],
        ["mariomon", "mariomon"],
        ["insurgence", "insurgence"],
        ["sage", "sage"],
        ["ss2-patch", "ss2-soulstones"],
    ];
    const baseRoots = [
        path.resolve(__dirname, "../../tauri-app/public/data"),
        path.resolve(process.cwd(), "tauri-app/public/data"),
    ];
    for (const root of baseRoots) {
        if (!fs.existsSync(root)) continue;
        for (const [game, suffix] of fanGameDirs) {
            const genDir = path.join(root, game, "generated");
            if (!fs.existsSync(genDir)) continue;
            const movesFile = path.join(genDir, `moves.custom.${suffix}.json`);
            const abilitiesFile = path.join(genDir, `abilities.custom.${suffix}.json`);
            const pokedexFile = path.join(genDir, `pokedex.${suffix}.json`);
            const moves = loadJsonSafe(movesFile);
            const abilities = loadJsonSafe(abilitiesFile);
            const pokedex = loadJsonSafe(pokedexFile);
            let movesCount = 0, abilitiesCount = 0, speciesCount = 0;
            if (moves && typeof moves === "object") {
                Object.assign(aggregated.moves, moves);
                movesCount = Object.keys(moves).length;
            }
            if (abilities && typeof abilities === "object") {
                Object.assign(aggregated.abilities, abilities);
                abilitiesCount = Object.keys(abilities).length;
            }
            if (pokedex && typeof pokedex === "object") {
                Object.assign(aggregated.species, pokedex);
                speciesCount = Object.keys(pokedex).length;
            }
            if (movesCount || abilitiesCount || speciesCount) {
                console.log(`[SyncPSEngine] Loaded ${game} custom data (species:${speciesCount} moves:${movesCount} abilities:${abilitiesCount})`);
            }
        }
        break; // Found a working root; do not load duplicates from another.
    }

    return aggregated;
}

const customAbilityPatches = {
    fullforce: {
        name: "Full Force",
        shortDesc: "Variable-power moves used by this Pokemon always use their maximum Base Power.",
        desc: "Variable-power moves used by this Pokemon always use their maximum Base Power.",
        flags: {},
        isNonstandard: "Custom",
        num: -20001,
        rating: 3,
        onBasePowerPriority: 23,
        onBasePower(basePower, _pokemon, _target, move) {
            const maxBasePower = move?.id === 'return' || move?.id === 'frustration' ? 102 : 0;
            if (!maxBasePower || !basePower || basePower >= maxBasePower)
                return;
            return this.chainModify([maxBasePower, basePower]);
        },
    },

    // ── Wind Rider (game config): absorb Flying-type moves ──
    // Instead of the canonical wind-flag Attack boost, this game's Wind Rider
    // absorbs Flying-type attacks: the user is immune and heals 1/4 of its
    // max HP (mirrors Volt Absorb / Motor Drive semantics).
    windrider: {
        name: "Wind Rider",
        shortDesc: "Absorbs Flying moves: heals 1/4 max HP instead.",
        desc: "If this Pokemon is targeted by a Flying-type move, it is immune to the move and heals 1/4 of its maximum HP instead.",
        flags: { breakable: 1 },
        rating: 3,
        onTryHit(target, source, move) {
            if (target !== source && move.type === 'Flying') {
                if (!this.heal(target.baseMaxhp / 4)) {
                    this.add('-immune', target, '[from] ability: Wind Rider');
                }
                return null;
            }
        },
    },
};

// ── SS2 (Soulstones 2) custom ability behavior ──
// dist/data/ss2-ability-handlers.js carries handlers for every custom-only SS2
// ability (the fan-game packs provide text only). Merged into
// customAbilityPatches so the loop in the injection block registers them into
// Dex.data.Abilities; its volatile conditions are registered into
// Dex.data.Conditions alongside.
const { patches: ss2AbilityPatches, conditions: ss2AbilityConditions } = require("./data/ss2-ability-handlers");
Object.assign(customAbilityPatches, ss2AbilityPatches);


function normalizeCustomMoveEntries(rawMoves) {
    return Object.fromEntries(Object.entries(rawMoves || {}).map(([moveId, moveData]) => {
        const normalized = { ...(moveData || {}) };
        if (typeof normalized.pp !== "number" || !Number.isFinite(normalized.pp) || normalized.pp <= 0) {
            normalized.pp = 10;
        }
        return [moveId, normalized];
    }));
}

// ── Custom moves that need REAL battle effects ──
// dist/data/moves.js is generated from JSON, which cannot carry event handler
// functions. Effects for such moves are attached here, mirroring how
// customAbilityPatches works for abilities.
const customMoveEffectPatches = {
    asteroidbelt: {
        // Soulstones 2 "Asteroid Belt": protect-style barrier. Blocks attacks
        // aimed at the user; contact attackers take 1/8 of their max HP and
        // have a 5% chance to be frozen. Lasts up to 5 turns or until it has
        // absorbed 5 attacks, whichever comes first.
        priority: 4,
        target: "self",
        stallingMove: true,
        volatileStatus: 'asteroidbelt',
        flags: { noassist: 1, failcopycat: 1 },
        onPrepareHit(pokemon) {
            return !!this.queue.willAct() && this.runEvent('StallMove', pokemon);
        },
        onHit(pokemon) {
            pokemon.addVolatile('stall');
        },
        condition: {
            duration: 5,
            onStart(target) {
                this.add('-start', target, 'Asteroid Belt');
            },
            onTryHitPriority: 3,
            onTryHit(target, source, move) {
                if (!move.flags['protect']) {
                    if (['gmaxoneblow', 'gmaxrapidflow'].includes(move.id)) return;
                    if (move.isZ || move.isMax) target.getMoveHitData(move).zBrokeProtect = true;
                    return;
                }
                this.add('-activate', target, 'move: Asteroid Belt');
                if (this.checkMoveMakesContact(move, source, target)) {
                    this.damage(source.maxhp / 8, source, target);
                    if (this.randomChance(1, 20)) source.trySetStatus('frz', target);
                }
                const state = target.volatiles['asteroidbelt'];
                state.hits = (state.hits || 0) + 1;
                if (state.hits >= 5) {
                    delete target.volatiles['asteroidbelt'];
                    this.add('-end', target, 'Asteroid Belt');
                }
                return this.NOT_FAIL;
            },
                        onEnd(target) {
                this.add('-end', target, 'Asteroid Belt');
            },
        },
        desc: "Protects the user from attacks for up to 5 turns or 5 blocked attacks. Contact attackers are dealt 1/8 of their max HP and have a 5% chance to freeze.",
        shortDesc: "Protect; contact attackers take 1/8 max HP, 5% freeze. 5 turns/hits.",
    },

    // ── Brand-new fangame healing moves (SS2) ──
    // Raw PBS data for these carries no heal condition and an attacking-style
    // target, so PS treats them as attacks. Force them onto the canonical
    // 50% self-heal archetype so battles emit |-heal| instead of |-damage|.
    nectartap: {
        target: "self",
        category: "Status",
        basePower: 0,
        accuracy: true,
        flags: { snatch: 1, heal: 1, metronome: 1 },
        heal: [1, 2],
        secondary: null,
        desc: "Drinks nectar and restores its own HP by half of its max HP.",
        shortDesc: "Drinks nectar and restores its own HP by half of its max HP.",
    },
    nagaskin: {
        target: "self",
        category: "Status",
        basePower: 0,
        accuracy: true,
        flags: { snatch: 1, heal: 1, metronome: 1 },
        heal: [1, 2],
        secondary: null,
        desc: "Sheds their skin to heal theirself for half of their max HP.",
        shortDesc: "Sheds their skin to heal theirself for half of their max HP.",
    },
    odetojoy: {
        target: "self",
        category: "Status",
        basePower: 0,
        accuracy: true,
        flags: { snatch: 1, heal: 1, metronome: 1 },
        heal: [1, 2],
        secondary: null,
        desc: "Sings a beautiful melody that heals the user for half of its total HP.",
        shortDesc: "Sings a beautiful melody that heals the user for half of its total HP.",
    },
    // corecollapse: applies mixed boosts (def -1, atk +2, spe +2) to self
    corecollapse: {
        target: "self",
        boosts: { def: -1, atk: 2, spe: 2 },
        flags: { snatch: 1, metronome: 1 },
        onHit(pokemon) {
            this.boost({ def: -1, atk: 2, spe: 2 }, pokemon);
        },
    },
    // dragonflycharge: +2 priority (already via priority field); apply the
    // 25% recoil as a post-hit self-damage. Uses the damage dealt this turn
    // via getMoveHitData so 25% of dealt damage is the recoil (matches
    // "takes 25% recoil damage").
    dragonflycharge: {
        onAfterMoveSecondarySelf(pokemon, target, move) {
            const dealt = target ? target.getMoveHitData(move) : null;
            const dmg = dealt && typeof dealt.damage === 'number' ? dealt.damage : 0;
            if (dmg > 0 && pokemon.hp > 0) {
                this.damage(this.calcRecoilMove ? Math.ceil((dmg * 25) / 100) : Math.max(1, Math.floor((dmg * 25) / 100)), pokemon, pokemon, 'recoil');
            }
        },
    },
    // lazybreak: puts the target to sleep
    lazybreak: {
        target: "normal",
        status: "slp",
        flags: { protect: 1, reflectable: 1, metronome: 1 },
        onHit(target) {
            if (!target.setStatus("slp", this.activePokemon)) return false;
        },
    },
};

function applyCustomMoveEffectPatches(movesRecord, patches) {
    const map = patches || customMoveEffectPatches;
    for (const [moveId, patch] of Object.entries(map)) {
        const existing = movesRecord[moveId];
        if (existing && typeof existing === 'object') {
            Object.assign(existing, patch);
        } else {
            movesRecord[moveId] = {
                num: -20034,
                name: 'Asteroid Belt',
                type: 'Cosmic',
                category: 'Status',
                basePower: 0,
                accuracy: true,
                pp: 5,
                isNonstandard: 'Custom',
                ...patch,
            };
        }
    }
}

// ---- SS2 bespoke move mechanics -------------------------------------------
// (a) CLONES: SS2 moves whose descriptions match a canonical mechanic exactly
//     (Hex/Revenge/Clear Smite/Knock Off/Dragon Tail/Fury Cutter/...). The
//     canonical entry carries the real handlers; display fields come from the
//     fan-game record so dex text stays correct.
const customMoveClones = {
    innervate: "healblock", suppressaura: "gastroacid", aurablock: "torment",
    nervesofsteel: "mist", guardianangel: "safeguard", firewall: "wideguard",
    hallowedground: "matblock", vexingvines: "fairylock", encircle: "fairylock",
    judoflip: "topsyturvy", frozenheart: "healbell", powernap: "healbell",
    deadsilence: "throatchop", heavensknuckle: "fellstinger",
    shootingstar: "suckerpunch", goldenbullet: "suckerpunch", surgingblow: "suckerpunch",
    coupdegrace: "brine", dracotempest: "brine", spectrallash: "brine",
    huntdown: "pursuit", grabandgo: "spectralthief", mindcrush: "punishment",
    unlockchi: "storedpower", starsaligned: "storedpower", boomingbeats: "storedpower",
    quillvolley: "furycutter", fireball: "furycutter", clonesurge: "furycutter", crescendo: "furycutter",
    spitefulchant: "dragontail", icevortex: "dragontail", karmaspell: "dragontail",
    hypertorrent: "dragontail", waterwhip: "dragontail",
    maleficact: "chipaway", hexbolt: "chipaway", vendetta: "chipaway", refraction: "chipaway", skydive: "chipaway",
    antimatter: "clearsmog", sinfulsmite: "clearsmog", songofsilence: "clearsmog",
    cobaltray: "clearsmog", goldrush: "clearsmog", neutralize: "clearsmog", wyrmbeam: "clearsmog",
    autumnblast: "brickbreak", blight: "brickbreak", hellbrand: "brickbreak",
    powerdrill: "brickbreak", shatter: "brickbreak",
    quakeslam: "knockoff", disturb: "knockoff", mindmeld: "knockoff",
    spoil: "knockoff", powerwash: "knockoff", turbulence: "knockoff",
    infection: "hex", hypothermia: "hex", purge: "hex", allergy: "hex", cruelwhip: "hex", phobia: "hex",
    spiritbarrage: "revenge", rebuke: "revenge",
    spaceinvaders: "beatup", hivemind: "outrage", determination: "outrage", stampede: "outrage",
    blackhole: "thousandarrows",
    divinevision: "futuresight", darkomen: "futuresight", winterwarning: "futuresight",
    zephyrpurge: "lastresort",
    boulderhurl: "bodypress", shieldbash: "bodypress",
    streamrush: "electroball",
};
function applyCustomMoveClones(movesRecord) {
    let n = 0;
    for (const [moveId, cloneId] of Object.entries(customMoveClones)) {
        const clone = Dex.data.Moves[cloneId];
        if (!clone || typeof clone !== "object") continue;
        const ss2 = movesRecord[moveId] && typeof movesRecord[moveId] === "object" ? movesRecord[moveId] : {};
        const merged = Object.assign({}, clone);
        for (const k of ["name", "desc", "shortDesc"]) if (ss2[k]) merged[k] = ss2[k];
        if (ss2.type) merged.type = ss2.type;
        if (Number(ss2.pp) > 0) merged.pp = Number(ss2.pp);
        // Preserve the fan-game's game-accurate combat profile while inheriting
        // the canonical handler. Without this, cloning a Status move (e.g.
        // clearsmog) stampedes category/basePower/accuracy and the move either
        // does 0 damage (no basePower) or gains the wrong category.
        if (ss2.category) merged.category = ss2.category;
        if (Number(ss2.basePower) > 0 || (ss2.basePower === 0 && Number(ss2.basePower) === 0)) {
            merged.basePower = Number(ss2.basePower);
        }
        if (ss2.accuracy != null && !isNaN(Number(ss2.accuracy))) merged.accuracy = Number(ss2.accuracy);
        // Status moves cloned from another Status move keep the target from the
        // SS2 entry if it's sane; attacking clones keep the canonical target.
        if (ss2.target && String(ss2.target) !== 'normal') merged.target = ss2.target;
        merged.num = 0;
        merged.isNonstandard = "Custom";
        movesRecord[moveId] = merged;
        n++;
    }
    return n;
}
// (b) FIELD INTERPRETER: converts JSON-only convention fields emitted by the
//     move-intent generator (hazard/weather/terrain/custom/critRatio) into real
//     mechanics by borrowing the canonical implementation's handlers.
function copyMoveMechanics(entry, src) {
    for (const k of Object.keys(src)) {
        if (k === "name" || k === "desc" || k === "shortDesc" || k === "num" || k === "isNonstandard") continue;
        if (k === "type" || k === "basePower" || k === "category") continue;
        const v = src[k];
        if (typeof v === "function" || k === "condition" || k === "priority" || k === "flags") entry[k] = v;
    }
}
function applyCustomFieldInterpreters(movesRecord) {
    let n = 0;
    for (const [moveId, entry] of Object.entries(movesRecord)) {
        if (!entry || typeof entry !== "object") continue;
        if (entry.hazard) {
            const src = Dex.data.Moves[entry.hazard];
            if (src) { copyMoveMechanics(entry, src); entry.target = src.target || "foeSide"; delete entry.hazard; n++; }
            continue;
        }
        if (entry.weather) {
            const wmap = { sunnyday: "sunnyday", raindance: "raindance", sandstorm: "sandstorm", snowscape: "snowscape", eclipse: "sunnyday" };
            const src = Dex.data.Moves[wmap[entry.weather] || entry.weather];
            if (src) { copyMoveMechanics(entry, src); entry.target = src.target || "field"; delete entry.weather; n++; }
            continue;
        }
        if (entry.terrain) {
            const src = Dex.data.Moves[entry.terrain];
            if (src) { copyMoveMechanics(entry, src); entry.target = src.target || "field"; delete entry.terrain; n++; }
            continue;
        }
        if (entry.critRatio) {
            const cr = entry.critRatio;
            entry.onModifyCritRatio = function () { return cr; };
            delete entry.critRatio;
            n++;
        }
        if (entry.custom) {
            switch (entry.custom) {
                case "protect-family": { const src = Dex.data.Moves["protect"]; if (src) { copyMoveMechanics(entry, src); entry.target = "self"; delete entry.custom; n++; } break; }
                case "wish": { const src = Dex.data.Moves["wish"]; if (src) { copyMoveMechanics(entry, src); entry.target = "self"; delete entry.custom; n++; } break; }
                case "purify": { const src = Dex.data.Moves["purify"]; if (src) { copyMoveMechanics(entry, src); entry.target = "normal"; delete entry.custom; n++; } break; }
                case "cure-status": { const src = Dex.data.Moves["refresh"]; if (src) { copyMoveMechanics(entry, src); entry.target = "self"; delete entry.custom; n++; } break; }
                case "heal-party-status": { const src = Dex.data.Moves["aromatherapy"]; if (src) { copyMoveMechanics(entry, src); entry.target = "self"; delete entry.custom; n++; } break; }
                case "heal-bell-plus": { const src = Dex.data.Moves["lifedew"]; if (src) { copyMoveMechanics(entry, src); entry.target = "self"; delete entry.custom; n++; } break; }
                case "stat-swap": { const src = Dex.data.Moves["powerswap"]; if (src) { copyMoveMechanics(entry, src); entry.target = "normal"; delete entry.custom; n++; } break; }
                case "type-change": {
                    const nt = entry.newType || "Normal";
                    entry.target = "normal";
                    entry.onHit = function (target) { if (!target) return false; target.setType(nt); this.add("-start", target, "typechange", nt); };
                    delete entry.custom; delete entry.newType; n++;
                    break;
                }
                case "solarbeam-family": { const src = Dex.data.Moves["solarbeam"]; if (src) { copyMoveMechanics(entry, src); delete entry.custom; delete entry.chargeMove; n++; } break; }
                case "two-turn-semivulnerable": { const src = Dex.data.Moves["dig"]; if (src) { copyMoveMechanics(entry, src); delete entry.custom; delete entry.chargeMove; n++; } break; }
                case "heatcrash-family": { const src = Dex.data.Moves["heatcrash"]; if (src) { copyMoveMechanics(entry, src); delete entry.custom; delete entry.weightPower; n++; } break; }
            }
        }
    }
    return n;
}
// (c) EXTRA PATCHES: bespoke behaviours that are neither pure clones nor JSON
//     expressible. Built lazily so canonical handler objects are available.
function buildExtraMovePatches() {
    const physpecSwap = Dex.data.Moves.photongeyser && Dex.data.Moves.photongeyser.onModifyMove
        ? Dex.data.Moves.photongeyser.onModifyMove
        : function (move, pokemon) { if (pokemon.getStat("atk", false) > pokemon.getStat("spa", false)) move.category = "Physical"; };
    return {
        holyward: { overrideOffensiveStat: "spd" },
        scentedshield: { overrideOffensiveStat: "spd" },
        soundbarrier: { overrideOffensiveStat: "spd" },
        checkmate: { onAfterMoveSecondarySelf(pokemon, target) { if (target && target.hp <= 0) this.boost({ spa: 2 }); } },
        duneblast: { onAfterMoveSecondarySelf(pokemon, target) { if (target && target.hp <= 0) this.boost({ spa: 2 }); } },
        chillingblast: { onAfterMoveSecondarySelf(pokemon, target) { if (target && target.hp <= 0) this.boost({ spa: 2 }); } },
        parry: { onBasePower(basePower, attacker) { if (attacker.side && attacker.side.pokemon.some((p) => p.fainted)) return this.chainModify(2); } },
        timebomb: { onBasePower(basePower, attacker) { if (attacker.side && attacker.side.pokemon.some((p) => p.fainted)) return this.chainModify(2); } },
        scoresettler: { onBasePower(basePower, attacker) { if (attacker.side && attacker.side.pokemon.some((p) => p.fainted)) return this.chainModify(2); } },
        wail: { onBasePower(basePower, attacker) { if (Object.values(attacker.boosts).some((v) => v < 0)) return this.chainModify(2); } },
        flatulence: { onBasePower(basePower, attacker) { if (!attacker.item) return this.chainModify(2); } },
        oberonswrath: { onBasePower(basePower, attacker) { return this.chainModify(0.5 + attacker.hp / attacker.maxhp); } },
        wraithpulse: { onBasePower(basePower, attacker, defender) { if (attacker.getStat("spe") > defender.getStat("spe")) return this.chainModify(1.5); } },
        icydeluge: { onBasePower(basePower, attacker, defender) { if (attacker.getStat("spe") > defender.getStat("spe")) return this.chainModify(1.5); } },
        valkyriechariot: {
            onTryMove() { if (this.field.getPseudoWeather("gravity")) { this.add("-fail", this.activeTarget || "p1a"); return null; } },
            onMoveFail(target, pokemon) { this.damage(pokemon.maxhp / 2, pokemon, pokemon); },
        },
        radiantlance: {
            onTryMove() { if (this.field.getPseudoWeather("gravity")) { this.add("-fail", this.activeTarget || "p1a"); return null; } },
            onMoveFail(target, pokemon) { this.damage(pokemon.maxhp / 2, pokemon, pokemon); },
        },
        beatdrop: {
            onTryMove() { if (this.field.getPseudoWeather("gravity")) { this.add("-fail", this.activeTarget || "p1a"); return null; } },
            onMoveFail(target, pokemon) { this.damage(pokemon.maxhp / 2, pokemon, pokemon); },
        },
        continentalrift: { ignoreAbility: true, onModifyMove: physpecSwap },
        concoction: { onModifyMove: physpecSwap },
        bombardment: { onModifyMove: physpecSwap },
        overflow: {
            onAfterMove(pokemon) {
                if (pokemon.hp > 0) {
                    this.boost({ spe: 1 }, pokemon);
                    for (const sc of ["stealthrock", "spikes", "toxicspikes", "stickyweb"]) pokemon.side.removeSideCondition(sc);
                }
            },
        },
        stormshield: {
            priority: 4, target: "self", stallingMove: true,
            volatileStatus: "stormshield",
            flags: { noassist: 1, failcopycat: 1 },
            onPrepareHit(pokemon) { return !!this.queue.willAct() && this.runEvent("StallMove", pokemon); },
            onHit(pokemon) { pokemon.addVolatile("stall"); },
            condition: Object.assign({}, Dex.data.Moves.protect && Dex.data.Moves.protect.condition ? Dex.data.Moves.protect.condition : {}, {
                onAfterHit(target, source, move) {
                    if (source && source !== target && move && move.flags && move.flags.contact) {
                        this.boost({ def: -2 }, source, target, this.effect);
                    }
                },
            }),
        },
    };
}

// Store normalized custom moves at module level so SyncPSEngine.initializeBattle
// can inject them into the battle's format-specific Dex after PSBattle construction.
let moduleNormalizedMoves = {};
let moduleNormalizedCustomDexMoves = {};

(function injectCustomDexEntries() {
    const customDex = loadCustomDexPayload();
    // ── Inject custom fangame types into PS's type chart ──
    // (These types exist in the SS2/fan-game move data but PS doesn't know
    // about them by default. Without this, moves using custom types crash
    // the simulator with "Use runStatusImmunity for <Type>".)
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
    // Crystal type (Soulstones)
    tc.crystal = {
        isNonstandard: "Custom",
        damageTaken: { Bug:0, Cosmic:0, Dark:0, Dragon:0, Electric:0, Fairy:0, Fighting:1, Fire:0, Flying:0, Ghost:0, Grass:0, Ground:0, Ice:2, Normal:0, Nuclear:0, Poison:0, Psychic:0, Rock:2, Sound:1, Steel:2, Stellar:0, Water:0, Light:0 },
    };
    // Stellar type (Soulstones)
    tc.stellar = {
        isNonstandard: "Custom",
        damageTaken: { Bug:0, Cosmic:0, Crystal:0, Dark:1, Dragon:1, Electric:0, Fairy:0, Fighting:0, Fire:0, Flying:0, Ghost:2, Grass:0, Ground:0, Ice:0, Normal:0, Nuclear:0, Poison:0, Psychic:2, Rock:0, Sound:0, Steel:0, Water:0, Light:0 },
    };
    // Sound type (Soulstones)
    tc.sound = {
        isNonstandard: "Custom",
        damageTaken: { Bug:0, Cosmic:0, Crystal:0, Dark:0, Dragon:0, Electric:0, Fairy:0, Fighting:1, Fire:0, Flying:0, Ghost:2, Grass:0, Ground:0, Ice:0, Normal:0, Nuclear:0, Poison:0, Psychic:0, Rock:2, Steel:2, Stellar:0, Water:0, Light:0 },
    };
    // Light type (Soulstones)
    tc.light = {
        isNonstandard: "Custom",
        damageTaken: { Bug:2, Cosmic:0, Crystal:0, Dark:1, Dragon:0, Electric:0, Fairy:0, Fighting:0, Fire:0, Flying:0, Ghost:2, Grass:0, Ground:0, Ice:0, Normal:0, Nuclear:0, Poison:0, Psychic:0, Rock:0, Sound:0, Steel:0, Stellar:0, Water:0 },
    };
    // Add Nuclear/Cosmic to existing types' damageTaken
    const seFromNuclear = ["bug","dark","dragon","electric","fairy","fighting","fire","flying","ghost","grass","ground","ice","normal","poison","psychic","rock","water"];
    for (const t of seFromNuclear) { if (tc[t]) tc[t].damageTaken.Nuclear = 1; }
    if (tc.steel) { tc.steel.damageTaken.Nuclear = 2; tc.steel.damageTaken.fallout = 3; }
    // Cosmic SE on Fairy & Normal; resisted by Psychic
    if (tc.fairy) tc.fairy.damageTaken.Cosmic = 1;
    if (tc.normal) tc.normal.damageTaken.Cosmic = 1;
    if (tc.psychic) tc.psychic.damageTaken.Cosmic = 2;
    // Crystal SE on Ice/Rock/Steel (shatters them); resisted by Fighting (blunt force breaks it)
    if (tc.ice) tc.ice.damageTaken.Crystal = 1;
    if (tc.rock) tc.rock.damageTaken.Crystal = 1;
    if (tc.steel) tc.steel.damageTaken.Crystal = 1;
    if (tc.fighting) tc.fighting.damageTaken.Crystal = 2;
    // Stellar SE on Psychic/Ghost (cosmic energy pierces the ethereal); resisted by Dark/Dragon
    if (tc.psychic) tc.psychic.damageTaken.Stellar = 1;
    if (tc.ghost) tc.ghost.damageTaken.Stellar = 1;
    if (tc.dark) tc.dark.damageTaken.Stellar = 2;
    if (tc.dragon) tc.dragon.damageTaken.Stellar = 2;
    // Sound SE on Rock/Steel (resonance shatters); resisted by Fighting; immune for Ghost is inverted (Ghost weak here)
    if (tc.rock) tc.rock.damageTaken.Sound = 1;
    if (tc.steel) tc.steel.damageTaken.Sound = 1;
    if (tc.ghost) tc.ghost.damageTaken.Sound = 1;
    if (tc.fighting) tc.fighting.damageTaken.Sound = 2;
    // Light SE on Dark/Ghost (illuminates); resisted by Bug
    if (tc.dark) tc.dark.damageTaken.Light = 1;
    if (tc.ghost) tc.ghost.damageTaken.Light = 1;
    if (tc.bug) tc.bug.damageTaken.Light = 2;
    const normalizedCustomMoves = normalizeCustomMoveEntries(customMoves);
    const normalizedCustomDexMoves = normalizeCustomMoveEntries(customDex.moves || {});
    moduleNormalizedMoves = normalizedCustomMoves;
    moduleNormalizedCustomDexMoves = normalizedCustomDexMoves;
    Object.assign(Dex.data.Pokedex, customDex.species || {});
    for (const [speciesId, speciesData] of Object.entries(customDex.species || {})) {
        if (!Dex.data.FormatsData[speciesId])
            Dex.data.FormatsData[speciesId] = { tier: "Illegal" };
        const battleOnlyId = String(speciesData?.battleOnly || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (battleOnlyId && !Dex.data.FormatsData[battleOnlyId])
            Dex.data.FormatsData[battleOnlyId] = { tier: "Illegal" };
    }
    // Save original base moves BEFORE injecting custom moves (for SS2 variant creation)
    const originalBaseMoves = { ...Dex.data.Moves };
    // Preserve vanilla engine mechanics (multihit, secondary, drain, self,
    // flags details, etc.) when a custom entry overrides a Showdown move but
    // omits or empties those fields. Deep-merged so generated placeholder
    // values like flags:{} do not wipe base flags such as `protect:1`
    // (which previously made Asteroid Belt / other customs unable to block).
    const mergePreserveBase = (baseObj, customObj) => {
        const out = { ...baseObj };
        for (const key of Object.keys(customObj)) {
            const value = customObj[key];
            const baseValue = baseObj ? baseObj[key] : undefined;
            if (
                value && typeof value === 'object' && !Array.isArray(value) &&
                baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
            ) {
                out[key] = mergePreserveBase(baseValue, value);
            } else {
                out[key] = value;
            }
        }
        return out;
    };
    const mergeBaseMechanics = (moves) => {
        for (const key of Object.keys(moves)) {
            const base = originalBaseMoves[key];
            if (base && typeof base === 'object') {
                moves[key] = mergePreserveBase(base, moves[key]);
            }
        }
        return moves;
    };
    mergeBaseMechanics(normalizedCustomMoves);
    mergeBaseMechanics(normalizedCustomDexMoves);
    // ===== Vanilla-collision guard (mirrors tauri-app/src/data/adapter.ts) =====
    // Raw fan-game/PBS entries sharing a key with a canonical Showdown move used
    // to be merged/assigned OVER the vanilla entry. PBS exports carry only
    // {name,type,basePower,category,accuracy,pp,target,priority,flags,num,desc}
    // — no condition/event-handler functions — so every collided move lost its
    // real battle effect (Protect blocked nothing, Dragon Dance gave no boosts,
    // Stealth Rock/Sticky Web/Leech Seed did nothing, priority moves such as
    // Mach Punch/Bullet Punch/Ice Shard/Extreme Speed lost their priority, and
    // healing moves healed nothing). Enforce the client adapter's rules:
    //   Rule A: same-type collision -> DROP the custom entry (canonical wins).
    //   Rule B: different-type collision -> expose ONLY as a <key>ss2 variant
    //           rebuilt on top of the pristine base so it inherits the base
    //           target/priority/flags/handlers; only display + typed fields are
    //           overridden by the fan-game entry.
    const toPSId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const PRISTINE_BASE_MOVES = originalBaseMoves;
    let droppedCollisionCount = 0;
    let ss2VariantCount = 0;
    const buildRetypeVariant = (baseEntry, entry, suffixLabel) => ({
        // Pristine canonical fields first (target/priority/flags/handlers/
        // secondary/drain/self/multihit/boosts all survive untouched).
        ...baseEntry,
        // Fan-game overrides restricted to display + typed battle fields.
        type: entry.type,
        name: `${entry.name || baseEntry.name}${suffixLabel}`,
        desc: entry.desc || baseEntry.desc,
        shortDesc: entry.shortDesc || baseEntry.shortDesc,
        basePower: Number(entry.basePower) > 0 ? Number(entry.basePower) : baseEntry.basePower,
        category: ["physical", "special", "status"].includes(String(entry.category || "").toLowerCase())
            ? entry.category : baseEntry.category,
        accuracy: entry.accuracy != null && !isNaN(Number(entry.accuracy))
            ? Number(entry.accuracy) : baseEntry.accuracy,
        pp: Number(entry.pp) > 0 ? Number(entry.pp) : baseEntry.pp,
        // Explicitly canonical: never inherit PBS defaults for these.
        target: baseEntry.target,
        priority: typeof entry.priority === "number" && entry.priority !== 0 ? entry.priority : baseEntry.priority,
        flags: { ...(baseEntry.flags || {}) },
        num: 0,
        isNonstandard: "Custom",
    });
    const VANILLA_VARIANT_KEY_RE = /ss1$|ss2$|wylin$|sage$|uranium$|infinity$|mariomon$|insurgence$|extra$/;
    const filterVanillaCollisions = (moves) => {
        for (const key of Object.keys(moves)) {
            const entry = moves[key];
            if (!entry || typeof entry !== "object") continue;
            // Never touch pre-suffixed pack variants or already-patched entries.
            if (VANILLA_VARIANT_KEY_RE.test(key)) continue;
            const keyId = toPSId(key);
            const baseEntry = PRISTINE_BASE_MOVES[keyId];
            if (!baseEntry || typeof baseEntry !== "object") continue; // brand-new move: keep as-is
            const baseType = toPSId(baseEntry.type);
            const customType = toPSId(entry.type);
            // Remove the raw colliding key either way; only variants may exist.
            delete moves[key];
            if (!customType || customType === baseType) {
                droppedCollisionCount++; // Rule A: canonical entry stays untouched
                continue;
            }
            // Rule B: different typing -> rebuild the <key><suffix> variant cleanly.
            const variantKey = `${keyId}ss2`;
            Dex.data.Moves[variantKey] = buildRetypeVariant(baseEntry, entry, " (SS2)");
            moves[variantKey] = Dex.data.Moves[variantKey];
            ss2VariantCount++;
        }
    };
    filterVanillaCollisions(normalizedCustomMoves);
    filterVanillaCollisions(normalizedCustomDexMoves);
    console.log(`[SyncPSEngine] Vanilla-collision guard: dropped ${droppedCollisionCount} canonical-colliding entries, (re)built ${ss2VariantCount} retyped variants`);
    // Attach real battle effects to moves whose generated JSON data cannot
    // carry event handlers (see customMoveEffectPatches above). Applied to the
    // normalized entries themselves so both the global Dex below AND the
    // per-battle dex propagation in initializeBattle inherit them.
    applyCustomMoveClones(normalizedCustomMoves);
    applyCustomMoveClones(normalizedCustomDexMoves);
    applyCustomFieldInterpreters(normalizedCustomMoves);
    applyCustomFieldInterpreters(normalizedCustomDexMoves);
    const extraMovePatches = buildExtraMovePatches();
    // Core hand-written patches (healing moves, Asteroid Belt, Wind Rider, ...)
    applyCustomMoveEffectPatches(normalizedCustomMoves);
    applyCustomMoveEffectPatches(normalizedCustomDexMoves);
    // Bespoke audit patches (SS2 move overhaul)
    applyCustomMoveEffectPatches(normalizedCustomMoves, extraMovePatches);
    applyCustomMoveEffectPatches(normalizedCustomDexMoves, extraMovePatches);
    // Raw fan-game payload first, generated moves.js LAST: moves.js entries carry
    // the inferred SS2 mechanics (boosts/heal/drain/...) and must win over the
    // raw PBS records. Neither record contains canonical entries at this point
    // (filterVanillaCollisions dropped them), so no function-less JSON can
    // overwrite pristine canonical handlers.
    Object.assign(Dex.data.Moves, normalizedCustomDexMoves);
    Object.assign(Dex.data.Moves, normalizedCustomMoves);
    // When a custom move id collides with a Showdown ALIAS (e.g. id 'goldrush'
    // is aliased to 'G-Max Gold Rush' in data.Aliases), Dex.moves.get(id)
    // resolves the alias FIRST and returns the G-Max move instead of our
    // custom entry. Remove those alias entries so the custom move wins.
    for (const moveId of Object.keys(normalizedCustomMoves)) {
        if (Dex.data.Aliases && Object.prototype.hasOwnProperty.call(Dex.data.Aliases, moveId)) {
            delete Dex.data.Aliases[moveId];
        }
    }
    // Merge (not replace) so patched abilities keep canonical metadata
    // (num/gen/etc.) while overriding behaviour handlers and text.
    for (const [patchId, patchData] of Object.entries(customAbilityPatches)) {
        const existingAbility = Dex.data.Abilities[patchId];
        Dex.data.Abilities[patchId] = existingAbility && typeof existingAbility === "object"
            ? { ...existingAbility, ...patchData }
            : patchData;
    }
    // Volatile conditions referenced by SS2 ability handlers (Ethereal shield,
    // Teleface shield, Leadership first-move, Rebellious). PS rejects unknown
    // volatile ids in addVolatile, so register them explicitly.
    Object.assign(Dex.data.Conditions, ss2AbilityConditions);

    // Abilities: fan-game dumps contain 240+ keys that collide with canonical
    // abilities and would wipe their handlers (e.g. Magic Bounce, Sturdy).
    // Only ADD genuinely new abilities; canonical ones stay untouched.
    {
        const addOnlyAbilities = {};
        for (const [abilityKey, abilityData] of Object.entries(customDex.abilities || {})) {
            const abilityId = toPSId(abilityKey);
            if (!abilityId || Dex.data.Abilities[abilityId]) continue;
            addOnlyAbilities[abilityId] = abilityData;
        }
        Object.assign(Dex.data.Abilities, addOnlyAbilities);
    }
    Object.assign(Dex.data.Items, customDex.items || {});

    // SS2 retyped variants (<move>ss2) are built by filterVanillaCollisions()
    // above directly from the pristine base entries. The legacy variant loop
    // was removed: it re-spread raw PBS defaults (target/priority/flags) over
    // baked variants, which corrupted e.g. extremespeedss2's priority.
    if (Dex.species?.speciesCache)
        Dex.species.speciesCache = new Map();
    if (Dex.moves?.moveCache)
        Dex.moves.moveCache = new Map();
    if (Dex.abilities?.abilityCache)
        Dex.abilities.abilityCache = new Map();
    if (Dex.items?.itemCache)
        Dex.items.itemCache = new Map();
    if (Dex.types?.typeCache)
        Dex.types.typeCache = new Map();
    if (Dex.formats?.rulesetCache)
        Dex.formats.rulesetCache = new Map();
    if (Dex.formats?.formatsListCache)
        Dex.formats.formatsListCache = null;

    // Register a custom Gen 9 triples format so 3v1 boss / triples battles use
    // modern data (gen 6+ moves, fairy type, modern items/abilities) instead of
    // the stock gen5triplescustomgame which silently fails on Gen 6+ content.
    try {
        if (Dex.data.Rulesets && !Dex.data.Rulesets["gen9triplescustomgame"]) {
            Dex.data.Rulesets["gen9triplescustomgame"] = {
                effectType: "Format",
                name: "[Gen 9] Triples Custom Game",
                mod: "gen9",
                gameType: "triples",
                searchShow: false,
                debug: true,
                ruleset: ["Team Preview", "Cancel Mod", "Max Team Size = 24", "Max Move Count = 24", "Max Level = 9999", "Default Level = 100"],
            };
            if (Dex.formats?.rulesetCache) Dex.formats.rulesetCache = new Map();
            if (Dex.formats?.formatsListCache) Dex.formats.formatsListCache = null;
            console.log("[SyncPSEngine] Registered custom format gen9triplescustomgame");
        }
    } catch (err) {
        console.warn("[SyncPSEngine] Failed to register gen9triplescustomgame:", err?.message || err);
    }
})();

function canonicalizeMoveId(value) {
    const moveId = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!moveId)
        return '';
    if (/^(return|frustration)\d+$/.test(moveId))
        return moveId.replace(/\d+$/, '');
    if (/^hiddenpower(?:[a-z]+|\d+)$/.test(moveId))
        return 'hiddenpower';
    return moveId;
}
/**
 * SyncPSEngine provides a synchronous interface to Pokemon Showdown's battle simulation.
 * It uses PS's Battle class directly (not the stream) for synchronous operation.
 */
class SyncPSEngine {
    constructor(options) {
        this.options = options;
        this.battle = null;
        this.playerIdToSide = new Map();
        this.sideToPlayerId = new Map();
        this.lastLogIndex = 0;
        this.startSent = false; // Track if |start| has already been emitted
        this.initialProtocolComplete = false; // Track when initial start/switch/turn phase is complete
        this.seenInitialLines = new Set();
        this.seenInitialSwitches = new Set();
        this.seenInitialTurns = new Set();
        this.format = options?.format || "gen9customgame";
        this.rules = options?.rules;
        // Boss battle / team battle / FFA: select PS format based on playerFormat rule
        const playerFormat = options?.rules?.playerFormat;
        if (playerFormat === '2v1' || playerFormat === '2v2-teams') {
            this.format = 'gen9doublescustomgame';
        } else if (playerFormat === '3v1' || playerFormat === '3v3-teams') {
            this.format = 'gen9triplescustomgame';
        } else if (playerFormat === '4ffa') {
            this.format = 'gen9freeforallcustomgame';
        }
    }
    /**
     * Initialize a battle with the given players.
     * Teams should be in our Pokemon format - they will be converted to PS packed format.
     */
    initializeBattle(players, options) {
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
        const p1Avatar = players[0].trainerSprite || players[0].avatar || "acetrainer";
        const p2Avatar = players[1].trainerSprite || players[1].avatar || "acetrainer";
        // Create the battle directly (synchronous)
        try {
            this.battle = new PSBattle({
                formatid: this.format,
                seed: seedArray,
                p1: { name: players[0].name, avatar: p1Avatar, team: p1Team },
                p2: { name: players[1].name, avatar: p2Avatar, team: p2Team },
            });
        } catch (err) {
            console.error(`[SyncPSEngine] PSBattle constructor failed for format ${this.format}:`, err?.stack || err?.message || err);
            console.error(`[SyncPSEngine] p1 team length=${players[0]?.team?.length} p2 team length=${players[1]?.team?.length}`);
            try {
                console.error(`[SyncPSEngine] p1 packed: ${p1Team?.slice(0, 500)}`);
                console.error(`[SyncPSEngine] p2 packed: ${p2Team?.slice(0, 500)}`);
            } catch {}
            throw err;
        }
        // Inject custom moves into the battle's format-specific Dex instance.
        // Pokemon Showdown's Battle constructor may create a fresh Dex via
        // Dex.forFormat() that does NOT inherit our runtime injections into the
        // global Dex.data.Moves.  We must propagate the normalized custom moves
        // (including SS2 retyped variants) into this battle's dex and clear its
        // internal move cache so move lookups succeed during start() / choose().
        if (this.battle && this.battle.dex) {
            const bd = this.battle.dex;
            if (bd.data && bd.data.Moves) {
                // IMPORTANT: apply the RAW fan-game payload FIRST, then the
                // generated/normalized moves LAST so the richer entries (which
                // carry boosts/heal/recoil/cloned handlers) WIN. The raw PBS
                // records are thin (display fields only) and would otherwise
                // stamp over mechanics — the exact same failure mode as the
                // per-battle dex propagation used to trigger for Gossip's
                // boosts and Gold Rush's handler.
                Object.assign(bd.data.Moves, moduleNormalizedCustomDexMoves);
                Object.assign(bd.data.Moves, moduleNormalizedMoves);
            }
            if (bd.moves && bd.moves.moveCache) bd.moves.moveCache = new Map();
            if (bd.species && bd.species.speciesCache) bd.species.speciesCache = new Map();
            if (bd.abilities && bd.abilities.abilityCache) bd.abilities.abilityCache = new Map();
            if (bd.items && bd.items.itemCache) bd.items.itemCache = new Map();
            if (bd.types && bd.types.typeCache) bd.types.typeCache = new Map();
        }
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
        if (this.battle && typeof this.battle.start === "function") {
            const alreadyStarted = this.battle.started || this.battle.turn > 0;
            if (!alreadyStarted) {
                try {
                    this.battle.start();
                }
                catch (err) {
                    const msg = String(err?.message || err || "");
                    if (!/already started/i.test(msg)) {
                        throw err;
                    }
                }
            }
        }
        // Sync initial state
        this.syncStateFromPS();
        // Auto-complete Team Preview only when explicitly requested.
        // The server already manages team preview ordering and prompts.
        if (this.battle && options?.autoTeamPreview) {
            const p1 = this.battle.p1;
            const p2 = this.battle.p2;
            // Use the actual PS side's pokemon count (max 6 per side in standard formats)
            const p1TeamSize = p1?.pokemon?.length || this.state.players?.[0]?.team?.length || 6;
            const p2TeamSize = p2?.pokemon?.length || this.state.players?.[1]?.team?.length || 6;
            const buildTeamOrder = (size) => {
                const capped = Math.min(size, 6); // PS max 6 per side
                return `team ${Array.from({ length: capped }, (_v, i) => i + 1).join("")}`;
            };
            console.log(`[SyncPS autoTeamPreview] p1 request:`, JSON.stringify({ teamPreview: (p1?.request || p1?.activeRequest)?.teamPreview, rqid: (p1?.request || p1?.activeRequest)?.rqid }));
            console.log(`[SyncPS autoTeamPreview] p2 request:`, JSON.stringify({ teamPreview: (p2?.request || p2?.activeRequest)?.teamPreview, rqid: (p2?.request || p2?.activeRequest)?.rqid }));
            const p1Req = p1?.request || p1?.activeRequest;
            const p2Req = p2?.request || p2?.activeRequest;
            if (p1Req?.teamPreview) {
                const order = buildTeamOrder(p1TeamSize);
                console.log(`[SyncPS autoTeamPreview] p1 choosing: "${order}"`);
                try {
                    this.battle.choose("p1", order);
                    console.log(`[SyncPS autoTeamPreview] p1 choose succeeded`);
                } catch(e) {
                    console.log(`[SyncPS autoTeamPreview] p1 choose failed:`, e.message);
                }
            }
            if (p2Req?.teamPreview) {
                const order = buildTeamOrder(p2TeamSize);
                console.log(`[SyncPS autoTeamPreview] p2 choosing: "${order}"`);
                try {
                    this.battle.choose("p2", order);
                    console.log(`[SyncPS autoTeamPreview] p2 choose succeeded`);
                } catch(e) {
                    console.log(`[SyncPS autoTeamPreview] p2 choose failed:`, e.message);
                }
            }
            // Check state after choose
            const p1After = p1?.request || p1?.activeRequest;
            const p2After = p2?.request || p2?.activeRequest;
            console.log(`[SyncPS autoTeamPreview] After choose - p1 still teamPreview?`, !!p1After?.teamPreview, `p2 still teamPreview?`, !!p2After?.teamPreview);
            console.log(`[SyncPS autoTeamPreview] After choose - p1 active?`, !!p1After?.active, `p2 active?`, !!p2After?.active);
            // Re-sync state in case turn advanced
            this.syncStateFromPS();
        }
        this.applyStartConditions(options?.startConditions ?? this.rules?.startConditions);
        this.applyStartingHP(players);
        // Fix |switch| lines in battle log to show correct (reduced) HP
        // applyStartingHP runs AFTER autoTeamPreview, which generates |switch| lines
        // with full HP. Patch the log so collectNewLogEntries captures correct values.
        if (this.battle && this.battle.log) {
            for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
                const psSide = this.battle.sides[sideIdx];
                if (!psSide) continue;
                const activePoke = psSide.active?.[0];
                if (!activePoke) continue;
                const currentHP = activePoke.hp;
                const maxHP = activePoke.maxhp;
                if (currentHP >= maxHP) continue;
                const sideId = `p${sideIdx + 1}`;
                for (let li = 0; li < this.battle.log.length; li++) {
                    const line = this.battle.log[li];
                    if (line.startsWith(`|switch|${sideId}a:`)) {
                        const parts = line.split('|');
                        if (parts.length >= 5) {
                            parts[parts.length - 1] = `${currentHP}/${maxHP}`;
                            this.battle.log[li] = parts.join('|');
                            console.log(`[SyncPSEngine] Fixed |switch| HP for ${sideId}: ${currentHP}/${maxHP}`);
                        }
                    }
                }
            }
        }
        this.syncStateFromPS();
        // Capture initial PS log entries (setup, switch-ins, turn start)
        this.collectNewLogEntries();
        return this.state;
    }
    /**
     * Register a custom/unknown species with PS's Dex so it doesn't throw
     * "Unidentified species" when creating the battle. Uses the mon's own
     * stats, types, and ability so the battle simulation is accurate.
     */
    ensureSpeciesRegistered(mon) {
        const speciesName = mon.species || mon.name;
        if (!speciesName) return;
        const id = speciesName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existing = Dex.species.get(speciesName);
        if (existing && existing.exists) return; // already known
        // Build base stats from the mon's stat block
        const s = mon.stats || mon.baseStats || {};
        const baseStats = {
            hp: s.hp || 80, atk: s.atk || 80, def: s.def || 80,
            spa: s.spa || 80, spd: s.spd || 80, spe: s.spe || 80,
        };
        const types = Array.isArray(mon.types) && mon.types.length > 0
            ? mon.types.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
            : ['Normal'];
        const ability = mon.ability || 'No Ability';
        // Weight is critical for weight-based moves (Heat Crash, Heavy Slam,
        // Low Kick, Sky Drop, etc.). A missing weightkg makes Showdown's
        // getWeight() return NaN, which silently pushes every weight-comparison
        // move to its lowest power tier and breaks weight checks. Use the mon's
        // supplied weight when the client provides one; otherwise fall back to
        // a neutral mid-range weight (50kg) rather than leaving it undefined.
        const weight = Number(mon.weightkg ?? mon.weight);
        Dex.data.Pokedex[id] = {
            num: -1,
            name: speciesName,
            types,
            baseStats,
            abilities: { '0': ability },
            weightkg: Number.isFinite(weight) && weight > 0 ? weight : 50,
        };
        console.log(`[SyncPSEngine] Registered custom species "${speciesName}" with PS Dex (weightkg ${Dex.data.Pokedex[id].weightkg})`);
    }
    /**
     * Convert our Pokemon team to PS packed format
     */
    convertTeamToPacked(team) {
        // Register any custom/unknown species before packing
        for (const mon of team) {
            this.ensureSpeciesRegistered(mon);
        }
        const sets = team.map((mon) => ({
            name: mon.nickname || mon.name,
            species: mon.species || mon.name,
            item: mon.item || "",
            ability: mon.ability || "",
            moves: mon.moves.map((m) => {
                const rawMove = typeof m === "string" ? m : (m?.name || m?.id || "");
                return canonicalizeMoveId(rawMove) || String(rawMove || "");
            }),
            nature: mon.nature || "Hardy",
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...mon.evs },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...mon.ivs },
            level: mon.level,
            shiny: !!mon.shiny,
            gender: mon.gender || "",
            teraType: mon.teraType || "",
        }));
        return Teams.pack(sets);
    }
    /**
     * Get the current request for a player
     */
    getRequest(playerId) {
        if (!this.battle)
            return null;
        const side = this.playerIdToSide.get(playerId);
        if (!side)
            return null;
        const psSide = this.battle.sides.find((s) => s.id === side);
        return psSide?.activeRequest || null;
    }
    /**
     * Get the active Pokemon's moves with current PP directly from PS engine
     * This is useful as a fallback when activeRequest is not available
     */
    getActiveMovesPP(playerId, slotIndex = 0) {
        if (!this.battle)
            return null;
        const side = this.playerIdToSide.get(playerId);
        if (!side)
            return null;
        const psSide = this.battle.sides.find((s) => s.id === side);
        if (!psSide)
            return null;
        const activePokemon = psSide.active?.[slotIndex];
        if (!activePokemon)
            return null;
        // PS stores move data in moveSlots array
        const moveSlots = activePokemon.moveSlots || activePokemon.baseMoveSlots || [];
        return moveSlots.map((slot) => ({
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
    needsForceSwitch(playerId) {
        const req = this.getRequest(playerId);
        return !!(req?.forceSwitch?.some((f) => f));
    }
    /**
     * Submit a force switch choice (supports multi-slot via choices array)
     */
    forceSwitch(playerId, toIndex, choices) {
        if (!this.battle) {
            return { state: this.state, events: [], anim: [] };
        }
        const side = this.playerIdToSide.get(playerId);
        if (!side) {
            return { state: this.state, events: [], anim: [] };
        }
        const events = [];
        const anim = [];
        // Multi-slot force switch: choices = [{slotIndex, toIndex}, ...]
        // Also handles empty choices array (all-pass when no bench available)
        if (Array.isArray(choices)) {
            const req = this.getRequest(playerId);
            const switchParts = [];
            for (let i = 0; i < (req?.forceSwitch?.length || 0); i++) {
                if (req.forceSwitch[i]) {
                    const c = choices.find(ch => ch.slotIndex === i);
                    switchParts.push(c ? `switch ${c.toIndex + 1}` : 'pass');
                } else {
                    switchParts.push('pass');
                }
            }
            const combinedChoice = switchParts.join(', ');
            console.log(`[SyncPSEngine] Multi-slot forceSwitch for ${side}: ${combinedChoice}`);
            const success = this.battle.choose(side, combinedChoice);
            if (!success) {
                console.error(`[SyncPSEngine] Multi-slot forceSwitch failed for ${side}: ${combinedChoice}`);
            }
        } else {
            // Single-slot force switch (legacy)
            // PS uses 1-based indices for switches
            const success = this.battle.choose(side, `switch ${toIndex + 1}`);
            if (!success) {
                console.error(`[SyncPSEngine] forceSwitch failed for ${side}`);
            }
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
    processTurn(actions) {
        if (!this.battle) {
            return { state: this.state, events: ["Battle not initialized"], anim: [] };
        }
        const events = [];
        const anim = [];
        const prevTurn = this.state.turn;
        // Group actions by player
        const actionsByPlayer = new Map();
        for (const action of actions) {
            actionsByPlayer.set(action.actorPlayerId, action);
        }
        // Submit choices for each player
        for (const [playerId, action] of actionsByPlayer) {
            const side = this.playerIdToSide.get(playerId);
            if (!side)
                continue;
            // Handle multi-choice actions (doubles/triples - one choice per active slot)
            if (action.type === 'multi-choice' && Array.isArray(action.choices)) {
                // Sort choices by slotIndex so PS receives them in correct slot order,
                // then use each choice's explicit slotIndex (not the array position).
                const sortedChoices = [...action.choices].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
                const slotChoices = sortedChoices.map((c, idx) => {
                    const slotIdx = typeof c.slotIndex === 'number' ? c.slotIndex : idx;
                    return this.actionToChoice(c, side, slotIdx);
                });
                const combinedChoice = slotChoices.join(', ');
                console.log(`[DIAG-PROTOCOL] [engine] choose side=${side} player=${playerId} multi-choice=${combinedChoice}`);
                const success = this.battle.choose(side, combinedChoice);
                if (!success) {
                    console.error(`[SyncPSEngine] Multi-choice failed for ${side}: ${combinedChoice}`);
                    this.battle.choose(side, "default");
                }
                continue;
            }
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
        if (this.battle && typeof this.battle.commitDecisions === "function") {
            if (this.battle.turn === prevTurn) {
                console.log(`[DIAG-PROTOCOL] [engine] commitDecisions (turn=${this.battle.turn}, prev=${prevTurn})`);
                try {
                    this.battle.commitDecisions();
                }
                catch (err) {
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
        // If Multi Mega Evolution clause is enabled, re-enable canMegaEvo for eligible Pokemon after each turn
        if (this.hasMultiMegaClause()) {
            this.resetMegaEvoForAll();
        }
        return { state: this.state, events, anim };
    }
    /**
     * Check if the unlimited terastallization clause is enabled
     */
    hasUnlimitedTeraClause() {
        const clauses = this.rules?.clauses;
        const clauseList = Array.isArray(clauses)
            ? clauses.map((c) => String(c).toLowerCase())
            : (typeof clauses === 'string' ? clauses.split(/\s*,\s*/) : []);
        const customRules = String(this.rules?.customRules || this.rules?.displayString || '').toLowerCase();
        const hasClause = clauseList.includes('unlimitedtera') || customRules.includes('unlimitedtera');
        console.log(`[SyncPSEngine] hasUnlimitedTeraClause check: rules=${JSON.stringify(this.rules)}, clauses=${JSON.stringify(clauses)}, result=${hasClause}`);
        return hasClause;
    }
    /**
     * Re-enable canTerastallize for all Pokemon (for unlimited tera clause)
     */
    resetTerastallizeForAll() {
        if (!this.battle)
            return;
        console.log('[SyncPSEngine] resetTerastallizeForAll called - re-enabling tera for all Pokemon');
        let resetCount = 0;
        for (const side of this.battle.sides) {
            // Reset side-level tera flags so another Pokemon can terastallize
            if (side && typeof side.canTerastallize !== 'undefined') {
                side.canTerastallize = true;
            }
            if (side && typeof side.teraUsed !== 'undefined') {
                side.teraUsed = false;
            }
            for (const pokemon of side.pokemon || []) {
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
     * Check if the multi mega evolution clause is enabled
     */
    hasMultiMegaClause() {
        const clauses = this.rules?.clauses;
        const clauseList = Array.isArray(clauses)
            ? clauses.map((c) => String(c).toLowerCase())
            : (typeof clauses === 'string' ? clauses.split(/\s*,\s*/) : []);
        const customRules = String(this.rules?.customRules || this.rules?.displayString || '').toLowerCase();
        const hasClause = clauseList.includes('multimega') || customRules.includes('multimega');
        console.log(`[SyncPSEngine] hasMultiMegaClause check: clauses=${JSON.stringify(clauses)}, result=${hasClause}`);
        return hasClause;
    }
    /**
     * Re-enable canMegaEvo for eligible Pokemon (for multi mega clause)
     * Uses PS's own canMegaEvo() to recompute eligibility.
     * Pokemon that already mega evolved will naturally return null.
     */
    resetMegaEvoForAll() {
        if (!this.battle)
            return;
        console.log('[SyncPSEngine] resetMegaEvoForAll called - re-enabling mega for eligible Pokemon');
        let resetCount = 0;
        for (const side of this.battle.sides) {
            for (const pokemon of side.pokemon || []) {
                // Re-compute canMegaEvo using PS's own function
                // Already-mega Pokemon will return null (species changed, item check fails)
                const newMega = this.battle.actions.canMegaEvo(pokemon);
                if (newMega) {
                    pokemon.canMegaEvo = newMega;
                    resetCount++;
                    console.log(`[SyncPSEngine] Reset canMegaEvo for ${pokemon.name || pokemon.species}: ${newMega}`);
                }
            }
        }
        console.log(`[SyncPSEngine] resetMegaEvoForAll complete - reset ${resetCount} Pokemon`);
    }
    /**
     * Collect new log entries from PS battle
     * Filters out duplicate |start| blocks that PS may generate
     */
    collectNewLogEntries() {
        if (!this.battle)
            return [];
        const log = this.battle.log || [];
        const newEntries = [];
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
                // After start protocol has already been sent, stray setup lines from
                // duplicate pre-start protocol blocks should be ignored.
                if (this.startSent && (entry.startsWith("|tier|") || entry.startsWith("|gen|") || entry.startsWith("|gametype|") || entry.startsWith("|player|") || entry.startsWith("|teamsize|") || entry.startsWith("|clearpoke") || entry.startsWith("|poke|") || entry.startsWith("|teampreview"))) {
                    continue;
                }
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
                    }
                    else {
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
                    }
                    else {
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
                    }
                    else if (typeof turnNum === "number") {
                        if (this.seenInitialTurns.has(turnNum)) {
                            continue;
                        }
                        this.seenInitialTurns.add(turnNum);
                    }
                    else if (this.seenInitialLines.has(entry)) {
                        continue;
                    }
                    else {
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
    isInitialProtocolLine(line) {
        return (line === "|" ||
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
            line.startsWith("|turn|"));
    }
    isActionProtocolLine(line) {
        return (line.startsWith("|move|") ||
            line.startsWith("|cant|") ||
            line.startsWith("|-damage|") ||
            line.startsWith("|damage|") ||
            line.startsWith("|-heal|") ||
            line.startsWith("|heal|") ||
            line.startsWith("|faint|"));
    }
    extractTurnNumber(line) {
        if (!line.startsWith("|turn|"))
            return null;
        const parts = line.split("|");
        const num = parseInt(parts[2] || "", 10);
        return Number.isFinite(num) ? num : null;
    }
    extractSwitchKey(line) {
        if (!line.startsWith("|switch|") && !line.startsWith("|drag|") && !line.startsWith("|replace|")) {
            return null;
        }
        const parts = line.split("|");
        const ident = parts[2] || "";
        const match = ident.match(/^(p[12][a-z]?):\s*(.+)$/);
        if (!match)
            return null;
        const slot = match[1];
        const name = match[2];
        return `${slot}:${String(name).toLowerCase().trim()}`;
    }
    /**
     * Parse log entries into animation events
     */
    parseLogToAnimations(lines) {
        const anim = [];
        for (const line of lines) {
            if (!line.startsWith("|"))
                continue;
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
    extractSide(ident) {
        if (!ident)
            return null;
        const match = ident.match(/^(p[12])/);
        return match ? match[1] : null;
    }
    /**
     * Extract pokemon name from PS ident like "p1a: Pikachu"
     */
    extractPokemonName(ident) {
        if (!ident)
            return "";
        const match = ident.match(/^p[12][a-z]?: (.+)$/);
        return match ? match[1] : ident;
    }
    /**
     * Convert our action to PS choice format
     */
    actionToChoice(action, side, slotIndex = 0) {
        if (action.type === "move") {
            const moveAction = action;
            if (!moveAction.moveId || moveAction.moveId === "default") {
                return "default";
            }
            const normalizedMoveId = canonicalizeMoveId(moveAction.moveId);
            const providedMoveIndex = Number.isInteger(moveAction.moveIndex) ? moveAction.moveIndex : -1;
            if (providedMoveIndex >= 0) {
                const indexedMoveId = this.getMoveIdAtIndex(side, slotIndex, providedMoveIndex);
                if (!indexedMoveId || indexedMoveId === normalizedMoveId) {
                    let choice = `move ${providedMoveIndex + 1}`;
                    if (typeof moveAction.targetLoc === "number" && Number.isFinite(moveAction.targetLoc) && moveAction.targetLoc !== 0) {
                        choice += ` ${moveAction.targetLoc}`;
                    }
                    if (moveAction.mega)
                        choice += " mega";
                    if (moveAction.zmove)
                        choice += " zmove";
                    if (moveAction.dynamax)
                        choice += " dynamax";
                    if (moveAction.terastallize)
                        choice += " terastallize";
                    return choice;
                }
            }
            const moveIndex = this.findMoveIndex(moveAction.moveId, side, slotIndex);
            let choice = `move ${moveIndex}`;
            if (typeof moveAction.targetLoc === "number" && Number.isFinite(moveAction.targetLoc) && moveAction.targetLoc !== 0) {
                choice += ` ${moveAction.targetLoc}`;
            }
            if (moveAction.mega)
                choice += " mega";
            if (moveAction.zmove)
                choice += " zmove";
            if (moveAction.dynamax)
                choice += " dynamax";
            if (moveAction.terastallize)
                choice += " terastallize";
            return choice;
        }
        if (action.type === "switch") {
            const switchAction = action;
            // PS uses 1-based indices
            return `switch ${switchAction.toIndex + 1}`;
        }
        return "default";
    }
    /**
     * Find the index of a move (1-based)
     */
    findMoveIndex(moveId, side, slotIndex = 0) {
        if (!this.battle)
            return 1;
        const psSide = this.battle.sides.find((s) => s.id === side);
        if (!psSide)
            return 1;
        const activePokemon = psSide.active[slotIndex];
        if (!activePokemon) {
            console.warn(`[SyncPSEngine] findMoveIndex: no active pokemon at slot ${slotIndex} for ${side}, defaulting to move 1`);
            return 1;
        }
        const normalizedMoveId = canonicalizeMoveId(moveId);
        const moveSlots = activePokemon.moveSlots || activePokemon.baseMoveSlots || [];
        for (let i = 0; i < moveSlots.length; i++) {
            const slot = moveSlots[i];
            const slotMoveId = canonicalizeMoveId(slot?.id || slot?.move || slot?.name || "");
            if (slotMoveId === normalizedMoveId) {
                return i + 1;
            }
        }
        for (let i = 0; i < activePokemon.moves.length; i++) {
            const move = activePokemon.moves[i];
            const moveNormalized = canonicalizeMoveId(move || "");
            if (moveNormalized === normalizedMoveId) {
                return i + 1;
            }
        }
        // Also check the PS request's active moves (they use .id field, not raw move string)
        const request = side === "p1" ? this.battle.p1Request : this.battle.p2Request;
        if (request?.active?.[slotIndex]?.moves) {
            const reqMoves = request.active[slotIndex].moves;
            for (let i = 0; i < reqMoves.length; i++) {
                const m = reqMoves[i];
                const mId = canonicalizeMoveId(m.id || m.name || m.move || "");
                if (mId === normalizedMoveId) {
                    return i + 1;
                }
            }
        }
        console.warn(`[SyncPSEngine] findMoveIndex: moveId '${moveId}' not found in slot ${slotIndex} for ${side}, moves=[${activePokemon.moves.join(',')}], defaulting to move 1`);
        return 1;
    }
    getMoveIdAtIndex(side, slotIndex = 0, moveIndex = -1) {
        if (!this.battle || moveIndex < 0)
            return "";
        const psSide = this.battle.sides.find((s) => s.id === side);
        if (!psSide)
            return "";
        const activePokemon = psSide.active[slotIndex];
        const moveSlots = activePokemon?.moveSlots || activePokemon?.baseMoveSlots || [];
        const slotMove = moveSlots[moveIndex];
        const slotMoveId = canonicalizeMoveId(slotMove?.id || slotMove?.move || slotMove?.name || "");
        if (slotMoveId)
            return slotMoveId;
        const activeMove = activePokemon?.moves?.[moveIndex];
        const activeMoveId = canonicalizeMoveId(activeMove || "");
        if (activeMoveId)
            return activeMoveId;
        const request = side === "p1" ? this.battle.p1Request : this.battle.p2Request;
        const requestMove = request?.active?.[slotIndex]?.moves?.[moveIndex];
        return canonicalizeMoveId(requestMove?.id || requestMove?.name || requestMove?.move || "");
    }
    applyStartingHP(players) {
        if (!this.battle || !players) return;
        for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
            const psSide = this.battle.sides[sideIdx];
            const playerTeam = players[sideIdx]?.team;
            if (!psSide || !playerTeam) continue;
            for (let i = 0; i < psSide.pokemon.length && i < playerTeam.length; i++) {
                const psMon = psSide.pokemon[i];
                const origMon = playerTeam[i];
                if (!psMon || !origMon) continue;
                const origCurrent = origMon.currentHP;
                const origMax = origMon.maxHP;
                if (typeof origCurrent !== 'number' || typeof origMax !== 'number') continue;
                if (origMax <= 0) continue;
                if (origCurrent >= origMax) continue;
                // Scale to PS engine's max HP
                const psMax = psMon.maxhp || psMon.hp;
                if (!psMax || psMax <= 0) continue;
                const ratio = origCurrent / origMax;
                const newHp = Math.max(0, Math.round(ratio * psMax));
                console.log(`[SyncPSEngine] Applying starting HP for side ${sideIdx} slot ${i}: ${origCurrent}/${origMax} (${Math.round(ratio * 100)}%) -> ${newHp}/${psMax}`);
                psMon.hp = newHp;
                if (newHp <= 0) {
                    psMon.hp = 0;
                    psMon.fainted = true;
                    psMon.status = 'fnt';
                }
                // Also update our state mirror
                if (this.state?.players?.[sideIdx]?.team?.[i]) {
                    this.state.players[sideIdx].team[i].currentHP = newHp;
                    this.state.players[sideIdx].team[i].maxHP = psMax;
                }
            }
        }
    }
    applyStartConditions(start) {
        if (!this.battle || !start)
            return;
        const field = this.battle.field;
        const applyTimedField = (rawId, rawTurns, setter, statePath, idMapper) => {
            const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
            if (!id || id === "none")
                return;
            const mapped = idMapper(id);
            if (!mapped)
                return;
            try {
                setter(mapped);
                const turns = this.clampInt(rawTurns, 1, 99, 5);
                if (statePath) {
                    statePath.duration = turns;
                    statePath.durationLeft = turns;
                }
            }
            catch { }
        };
        applyTimedField(start.field?.weather?.id, start.field?.weather?.turnsLeft, (id) => field.setWeather?.(id, null), field.weatherState, (id) => this.toPSWeatherId(id));
        applyTimedField(start.field?.terrain?.id, start.field?.terrain?.turnsLeft, (id) => field.setTerrain?.(id, null), field.terrainState, (id) => this.toPSTerrainId(id));
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
            const side = this.battle.sides[i];
            const cfg = sideConfigs[i];
            if (!side || !cfg)
                continue;
            const hazards = cfg.sideHazards || {};
            try { if (hazards.stealthRock) side.addSideCondition?.("stealthrock", "debug"); } catch(e) { console.warn('[SyncPS] stealthrock addSideCondition failed:', e?.message); }
            try { if (hazards.stickyWeb) side.addSideCondition?.("stickyweb", "debug"); } catch(e) { console.warn('[SyncPS] stickyweb addSideCondition failed:', e?.message); }
            const spikes = this.clampInt(hazards.spikesLayers, 0, 3, 0);
            for (let layer = 0; layer < spikes; layer++) {
                try { side.addSideCondition?.("spikes", "debug"); } catch(e) { console.warn('[SyncPS] spikes addSideCondition failed:', e?.message); }
            }
            const tspikes = this.clampInt(hazards.toxicSpikesLayers, 0, 2, 0);
            for (let layer = 0; layer < tspikes; layer++) {
                try { side.addSideCondition?.("toxicspikes", "debug"); } catch(e) { console.warn('[SyncPS] toxicspikes addSideCondition failed:', e?.message); }
            }
            const sideConds = cfg.sideConditions || {};
            this.addSideConditionWithDuration(side, "tailwind", sideConds.tailwindTurns);
            this.addSideConditionWithDuration(side, "reflect", sideConds.reflectTurns);
            this.addSideConditionWithDuration(side, "lightscreen", sideConds.lightScreenTurns);
        }
    }
    applyPseudoWeatherStart(_key, rawId, rawTurns, psId) {
        if (!this.battle?.field)
            return;
        const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
        if (!id || id === "none")
            return;
        const acceptable = {
            room: "trickroom",
            trick_room: "trickroom",
            trickroom: "trickroom",
            magic_room: "magicroom",
            magicroom: "magicroom",
            wonder_room: "wonderroom",
            wonderroom: "wonderroom",
        };
        if (acceptable[id] !== psId)
            return;
        try {
            this.battle.field.addPseudoWeather?.(psId, "debug");
            const turns = this.clampInt(rawTurns, 1, 99, 5);
            const ps = this.battle.field.pseudoWeather?.[psId];
            if (ps) {
                ps.duration = turns;
                ps.durationLeft = turns;
            }
        }
        catch (e) { console.warn(`[SyncPS] addPseudoWeather(${psId}) failed:`, e?.message); }
    }
    addSideConditionWithDuration(side, psConditionId, rawTurns) {
        const turns = this.clampInt(rawTurns, 0, 99, 0);
        if (turns <= 0)
            return;
        try {
            side.addSideCondition?.(psConditionId, "debug");
            const state = side.sideConditions?.[psConditionId];
            if (state) {
                state.duration = turns;
            }
        }
        catch (e) { console.warn(`[SyncPS] addSideConditionWithDuration(${psConditionId}) failed:`, e?.message); }
    }
    toPSWeatherId(id) {
        const map = {
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
    toPSTerrainId(id) {
        const map = {
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
    clampInt(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n))
            return fallback;
        const i = Math.trunc(n);
        return Math.max(min, Math.min(max, i));
    }
    /**
     * Sync our state from PS's current state
     */
    syncStateFromPS() {
        if (!this.battle)
            return;
        for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
            const psSide = this.battle.sides[sideIdx];
            const player = this.state.players[sideIdx];
            if (!psSide || !player)
                continue;
            // Handle multiple active pokemon (doubles/triples)
            const activeCount = psSide.active?.length || 1;
            let activePokemon = psSide.active?.[0] || null;
            if (activeCount > 1) {
                // Multi-active: track all active indices
                const activeIndices = [];
                for (let slotIdx = 0; slotIdx < activeCount; slotIdx++) {
                    const activePoke = psSide.active[slotIdx];
                    if (activePoke) {
                        let idx = psSide.pokemon.indexOf(activePoke);
                        if (idx < 0 && typeof activePoke.position === 'number') {
                            idx = activePoke.position;
                        }
                        if (idx < 0) {
                            idx = psSide.pokemon.findIndex((p) => p && (p.speciesState?.id === activePoke.speciesState?.id ||
                                p.species === activePoke.species || p.name === activePoke.name));
                        }
                        activeIndices.push(idx >= 0 ? idx : slotIdx);
                    } else {
                        activeIndices.push(-1);
                    }
                }
                player.activeIndex = activeIndices[0] >= 0 ? activeIndices[0] : 0;
                player.activeIndices = activeIndices;
                console.log(`[SyncPSEngine] Side ${sideIdx} multi-active: ${JSON.stringify(activeIndices)}`);
            } else {
            // Find active index - PS's active[0] is a reference to an object in psSide.pokemon
            activePokemon = psSide.active[0];
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
                    activeIdx = psSide.pokemon.findIndex((p) => p && (p.speciesState?.id === activePokemon.speciesState?.id ||
                        p.species === activePokemon.species ||
                        p.name === activePokemon.name));
                }
                if (activeIdx >= 0) {
                    console.log(`[SyncPSEngine] Side ${sideIdx} active: ${activePokemon.name || activePokemon.species}, index ${activeIdx} (was ${player.activeIndex})`);
                    player.activeIndex = activeIdx;
                }
                else {
                    console.warn(`[SyncPSEngine] Could not find active pokemon for side ${sideIdx}`);
                }
            }
            } // end single-active branch
            // Update each pokemon
            for (let i = 0; i < psSide.pokemon.length && i < player.team.length; i++) {
                const psMon = psSide.pokemon[i];
                const ourMon = player.team[i];
                if (!psMon)
                    continue;
                // Update HP
                ourMon.currentHP = psMon.hp || 0;
                ourMon.maxHP = psMon.maxhp || ourMon.maxHP;
                // Update status
                if (psMon.status) {
                    ourMon.status = this.parseStatus(psMon.status);
                }
                else if (psMon.fainted) {
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
                const isActive = activePokemon && (psMon === activePokemon ||
                    psMon.position === activePokemon.position ||
                    (psMon.speciesState?.id === activePokemon.speciesState?.id && psMon.name === activePokemon.name));
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
    parseStatus(status) {
        const map = {
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
    isEnded() {
        return this.battle?.ended || false;
    }
    /**
     * Get winner's player ID
     */
    getWinner() {
        if (!this.battle?.winner)
            return null;
        // Winner is the side ID or name
        const winnerSide = this.battle.winner;
        for (const [playerId, side] of this.playerIdToSide) {
            if (side === winnerSide)
                return playerId;
            const player = this.state.players.find((p) => p.id === playerId);
            if (player?.name === winnerSide)
                return playerId;
        }
        return null;
    }
    /**
     * Get the full battle log
     */
    getLog() {
        return this.state.log;
    }
    /**
     * Get the current state
     */
    getState() {
        return this.state;
    }
    /**
     * Get the gametype string for protocol (singles/doubles/triples)
     */
    getGameType() {
        const playerFormat = this.rules?.playerFormat;
        if (playerFormat === '2v1' || playerFormat === '2v2-teams') return 'doubles';
        if (playerFormat === '3v1' || playerFormat === '3v3-teams') return 'triples';
        if (playerFormat === '4ffa') return 'freeforall';
        // Also infer from the format string
        if (this.format?.includes('doubles')) return 'doubles';
        if (this.format?.includes('triples')) return 'triples';
        if (this.format?.includes('freeforall')) return 'freeforall';
        return 'singles';
    }
    /**
     * Access the internal PS battle for advanced usage
     */
    getPSBattle() {
        return this.battle;
    }
}
exports.SyncPSEngine = SyncPSEngine;
exports.default = SyncPSEngine;
//# sourceMappingURL=sync-ps-engine.js.map