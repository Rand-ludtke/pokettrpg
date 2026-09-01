/**
 * ss2-ability-handlers.js — SS2 (Soulstones 2) custom ability behavior.
 *
 * The fan-game ability packs carry text only (name/desc/shortDesc), so every
 * custom-only SS2 ability (no canonical Showdown counterpart) was a silent
 * no-op in battle. Handlers below are inferred from the in-game descriptions
 * and merged into Dex.data.Abilities by the customAbilityPatches loop in
 * dist/sync-ps-engine.js.
 *
 * `conditions` are Volatile conditions referenced by the handlers. Unknown
 * volatile ids are rejected by PS's addVolatile(), so they must be registered
 * into Dex.data.Conditions (the injection block does this).
 *
 * Documented gaps (packs carry no forme/field data to drive them):
 *   darkswarm / symphony (Lv20+ field forms), the forme-change pieces of
 *   wintergift / teleface / destructivecore, lightswitch's Power Cycle move.
 *   Every behavioral piece expressible with Showdown events IS implemented.
 */
'use strict';

const num = { n: -21000 };
const ability = (name, desc, handlers, flags) => ({
    name,
    desc,
    shortDesc: desc,
    flags: flags || {},
    isNonstandard: 'Custom',
    rating: 3,
    num: num.n--,
    ...handlers,
});

// Flat multiplier on one move type ("User's X-type moves deal N damage").
const typeBoost = (name, desc, moveType, mult) => ability(name, desc, {
    onBasePower(basePower, pokemon, target, move) {
        if (move.type === moveType) return this.chainModify(mult);
    },
});
// Sound-flag multiplier (Sound is a flag, not a type, in the engine).
const soundBoost = (name, desc, mult, lowHp) => ability(name, desc, {
    onBasePower(basePower, pokemon, target, move) {
        if (move.flags && move.flags.sound && (!lowHp || pokemon.hp <= pokemon.maxhp / 3)) {
            return this.chainModify(mult);
        }
    },
});
// Overgrow/Blaze family: 1.5x with one move type at <=1/3 max HP.
const blaze = (name, desc, moveType) => ability(name, desc, {
    onBasePower(basePower, pokemon, target, move) {
        if (move.type === moveType && pokemon.hp <= pokemon.maxhp / 3) return this.chainModify(1.5);
    },
});
// Halve incoming damage from a set of types.
const halveIncoming = (name, desc, types) => ability(name, desc, {
    onSourceModifyDamage(damage, attacker, defender, move) {
        if (types.includes(move.type)) return this.chainModify(0.5);
    },
});
// Galvanize family: converts move type and boosts it.
const galvanize = (name, desc, from, to, mult) => ability(name, desc, {
    onModifyTypePriority: -1,
    onModifyType(move, pokemon) {
        const noModifyType = ['judgment', 'multiattack', 'naturalgift', 'revelationdance', 'technoblast', 'terrainpulse', 'weatherball'];
        if (move.type === from && !noModifyType.includes(move.id) && !(move.isZ && move.category !== 'Status')) {
            move.type = to;
            move.typeChangerBoosted = this.effect;
        }
    },
    onBasePowerPriority: 23,
    onBasePower(basePower, pokemon, target, move) {
        if (move.typeChangerBoosted === this.effect) return this.chainModify(mult);
    },
});
// Berserk family: boost when a hit brings HP to half or less.
const berserk = (name, desc, boosts) => ability(name, desc, {
    onAfterMoveSecondary(target, source, move) {
        if (!source || source === target || !target.hp || !move.totalDamage) return;
        const lastAttackedBy = target.getLastAttackedBy();
        if (!lastAttackedBy) return;
        const damage = move.multihit && !move.smartTarget ? move.totalDamage : lastAttackedBy.damage;
        if (target.hp <= target.maxhp / 2 && target.hp + damage > target.maxhp / 2) {
            this.boost(boosts, target, target);
        }
    },
});
// Special-move retaliation: attacker takes 1/8 of its max HP.
const specialRetaliate = (name, desc) => ability(name, desc, {
    onDamagingHit(damage, target, source, move) {
        if (move.category === 'Special') this.damage(source.maxhp / 8, source, target);
    },
});
// Absorb an attack type: immune + self boosts (Lightning Rod / Storm Drain).
const absorbBoost = (name, desc, moveType, boosts) => ability(name, desc, {
    onTryHit(target, source, move) {
        if (target !== source && move.type === moveType) {
            if (!this.boost(boosts)) {
                this.add('-immune', target, '[from] ability: ' + name);
            }
            return null;
        }
    },
});
// Block opponent-inflicted drops on the given stats (Clear Body family).
const blockDrop = (name, desc, stats) => ability(name, desc, {
    onTryBoost(boost, target, source, effect) {
        if (source && target === source) return;
        let showMsg = false;
        for (const stat of stats) {
            if (boost[stat] && boost[stat] < 0) {
                delete boost[stat];
                showMsg = true;
            }
        }
        if (showMsg && effect && !(effect.secondaries) && effect.id !== 'octolock') {
            this.add('-fail', target, 'unboost', '[from] ability: ' + name, '[of] ' + target);
        }
    },
});
// First move after switch-in gets +1 priority.
const priorityFirst = (name, desc) => ability(name, desc, {
    onStart(pokemon) {
        if (!pokemon.volatiles['leadershipfirst']) pokemon.addVolatile('leadershipfirst');
    },
    onModifyPriority(priority, pokemon, target, move) {
        if (pokemon.volatiles['leadershipfirst']) return priority + 1;
    },
    onAfterMove(pokemon) {
        if (pokemon.volatiles['leadershipfirst']) pokemon.removeVolatile('leadershipfirst');
    },
});

module.exports = {
    conditions: {
        etherealshield: { name: 'Ethereal Shield' },
        telefaceshield: { name: 'Teleface Shield' },
        rebelliousflag: { name: 'Rebellious' },
        leadershipfirst: { name: 'Leadership' },
    },
    patches: {
        // ── Shields / immunity walls ──
        ethereal: ability("Ethereal", "Immune to the first contact move used against it; the shield is restored on switch-out.", {
            onStart(pokemon) {
                if (!pokemon.volatiles['etherealshield']) {
                    pokemon.addVolatile('etherealshield');
                    this.debug('Ethereal shield up');
                }
            },
            onTryHit(target, source, move) {
                if (move.flags && move.flags.contact && target.volatiles['etherealshield']) {
                    this.add('-immune', target, '[from] ability: Ethereal');
                    target.removeVolatile('etherealshield');
                    return null;
                }
            },
        }),
        opaqueness: ability("Opaqueness", "This Pokemon is immune to Light-type moves.", {
            onTryHit(target, source, move) {
                if (target !== source && move.type === 'Light') {
                    this.add('-immune', target, '[from] ability: Opaqueness');
                    return null;
                }
            },
        }),
        // ── Stat-change blocks ──
        impenetrable: blockDrop("Impenetrable", "This Pokemon's Defense and Special Defense cannot be lowered by other Pokemon.", ['def', 'spd']),
        intuition: blockDrop("Intuition", "This Pokemon's Special Attack cannot be lowered by other Pokemon.", ['spa']),
        unbreakable: blockDrop("Unbreakable", "This Pokemon's Defense cannot be lowered by other Pokemon.", ['def']),
        // ── Type multipliers ──
        requiem: typeBoost("Requiem", "This Pokemon's Dark-type moves deal 1.5x damage.", 'Dark', 1.5),
        bonecollector: typeBoost("Bone Collector", "This Pokemon's Ground-type moves deal 1.5x damage.", 'Ground', 1.5),
        hivemind: typeBoost("Hive Mind", "This Pokemon's Bug-type moves deal 1.5x damage.", 'Bug', 1.5),
        haunted: typeBoost("Haunted", "This Pokemon's Ghost-type moves deal 1.5x damage.", 'Ghost', 1.5),
        arsonist: typeBoost("Arsonist", "This Pokemon's Fire-type moves deal 1.5x damage.", 'Fire', 1.5),
        affection: typeBoost("Affection", "This Pokemon's Fairy-type moves deal 1.5x damage.", 'Fairy', 1.5),
        virtuoso: soundBoost("Virtuoso", "This Pokemon's Sound-based moves deal 1.5x damage.", 1.5, false),
        maestro: soundBoost("Maestro", "This Pokemon's Sound-based moves deal 1.5x damage at 1/3 max HP or less.", 1.5, true),
        irradiate: blaze("Irradiate", "This Pokemon's Light-type moves deal 1.5x damage at 1/3 max HP or less.", 'Light'),
        starstruck: blaze("Starstruck", "This Pokemon's Cosmic-type moves deal 1.5x damage at 1/3 max HP or less.", 'Cosmic'),
        spellcaster: blaze("Spellcaster", "This Pokemon's Psychic-type moves deal 1.5x damage at 1/3 max HP or less.", 'Psychic'),
        lightbulb: ability("Light Bulb", "This Pokemon's Light-type moves deal 2x damage and it takes 0.5x damage from Dark-type moves.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.type === 'Light') return this.chainModify(2);
            },
            onSourceModifyDamage(damage, attacker, defender, move) {
                if (move.type === 'Dark') return this.chainModify(0.5);
            },
        }),
        terrorize: ability("Terrorize", "This Pokemon's Psychic-type moves deal 2x damage and it takes 0.5x damage from Bug-type moves.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.type === 'Psychic') return this.chainModify(2);
            },
            onSourceModifyDamage(damage, attacker, defender, move) {
                if (move.type === 'Bug') return this.chainModify(0.5);
            },
        }),
        funeralpyre: ability("Funeral Pyre", "This Pokemon's Ghost-type and Fire-type moves deal 2x damage.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.type === 'Ghost' || move.type === 'Fire') return this.chainModify(2);
            },
        }),
        blacklight: galvanize("Black Light", "This Pokemon's Light-type moves become Dark-type and deal 1.2x damage.", 'Light', 'Dark', 1.2),
        darkmatter: galvanize("Dark Matter", "This Pokemon's Normal-type moves become Cosmic-type and deal 1.2x damage.", 'Normal', 'Cosmic', 1.2),
        whiteout: galvanize("Whiteout", "This Pokemon's Dark-type moves become Light-type and deal 1.2x damage.", 'Dark', 'Light', 1.2),
        // ── Incoming damage reducers ──
        realism: halveIncoming("Realism", "This Pokemon takes halved damage from Ghost- and Fairy-type moves.", ['Ghost', 'Fairy']),
        irredeemable: halveIncoming("Irredeemable", "This Pokemon takes halved damage from Light- and Fairy-type moves.", ['Light', 'Fairy']),
        astralmajesty: halveIncoming("Astral Majesty", "This Pokemon takes halved damage from Light- and Dragon-type moves.", ['Light', 'Dragon']),
        tropicalhide: halveIncoming("Tropical Hide", "This Pokemon takes halved damage from Grass- and Water-type moves.", ['Grass', 'Water']),
        // ── Berserk family (crossing below half HP) ──
        vengeful: berserk("Vengeful", "Ups Atk and Spe if a hit brings its HP to half or less.", { atk: 1, spe: 1 }),
        fortification: berserk("Fortification", "Ups Def and Sp.Def if a hit brings its HP to half or less.", { def: 1, spd: 1 }),
        terminator: berserk("Terminator", "Ups Atk if a hit brings its HP to half or less.", { atk: 1 }),
        // ── Special-move retaliation ──
        forcefield: specialRetaliate("Forcefield", "Attackers that hit it with special moves take 1/8 of their max HP in recoil."),
        feedback: specialRetaliate("Feedback", "Attackers that hit it with special moves take 1/8 of their max HP in recoil."),
        retribution: specialRetaliate("Retribution", "Attackers that hit it with special moves take 1/8 of their max HP in recoil."),
        // ── Switch-in effects ──
        leadership: priorityFirst("Leadership", "On switch-in, its first move gains +1 priority."),
        pounce: priorityFirst("Pounce", "On switch-in, its first move gains +1 priority."),
        dishearten: ability("Dishearten", "Lowers all adjacent foes' Special Attack by one stage on switch-in.", {
            onStart(pokemon) {
                let activated = false;
                for (const target of pokemon.adjacentFoes()) {
                    if (!activated) {
                        this.add('-ability', pokemon, 'Dishearten', 'boost');
                        activated = true;
                    }
                    if (target.volatiles['substitute']) {
                        this.add('-immune', target);
                    } else {
                        this.boost({ spa: -1 }, target, pokemon, null, true);
                    }
                }
            },
        }),
        orbit: ability("Orbit", "On switch-in, sets Gravity for 5 turns (unless it is already active).", {
            onStart(pokemon) {
                if (!this.field.getPseudoWeather('gravity')) {
                    this.field.addPseudoWeather('gravity');
                }
            },
        }),
        disarray: ability("Disarray", "On switch-in, sets Trick Room for 5 turns; if Trick Room is already active, it ends instead.", {
            onStart(pokemon) {
                if (this.field.getPseudoWeather('trickroom')) {
                    this.field.removePseudoWeather('trickroom');
                } else {
                    this.field.addPseudoWeather('trickroom');
                }
            },
        }),
        // ── Contact / retaliation triggers ──
        leechingfangs: ability("Leeching Fangs", "Damaging moves with both the Biting and Contact flags heal the user for 1/8 of the target's max HP.", {
            onAfterMove(pokemon, target, move) {
                if (move.category === 'Status' || !target || !move.totalDamage) return;
                if (!move.flags || !move.flags.bite || !move.flags.contact) return;
                this.heal(target.maxhp / 8);
            },
        }),
        deepchill: ability("Deep Chill", "Attackers that hit it with special moves have a 30% chance to be frostbitten.", {
            onDamagingHit(damage, target, source, move) {
                if (move.category === 'Special' && this.randomChance(3, 10)) {
                    source.trySetStatus('frz', target);
                }
            },
        }),
        scorchscale: ability("Scorch Scale", "If targeted by a priority contact move, the attacker is burned right before its move executes.", {
            onTryHit(target, source, move) {
                if (target !== source && move.priority > 0 && move.flags && move.flags.contact) {
                    if (source.trySetStatus('brn', target, this.effect)) {
                        this.add('-ability', target, 'Scorch Scale');
                    }
                }
            },
        }),
        hivebody: ability("Hive Body", "Attackers that make contact have a 30% chance to be trapped by Infestation.", {
            onDamagingHit(damage, target, source, move) {
                if (this.checkMoveMakesContact(move, source, target, true) && this.randomChance(3, 10)) {
                    source.addVolatile('partiallytrapped', target, this.effect);
                }
            },
        }),
        maelstrom: ability("Maelstrom", "Adjacent grounded foes cannot switch out; contact attackers have a 30% chance to be trapped by Whirlpool.", {
            onFoeTrapPokemon(pokemon) {
                if (!pokemon.hasAbility('shadowtag') && pokemon.isAdjacent(this.effectState.target) && pokemon.isGrounded()) {
                    pokemon.tryTrap(true);
                }
            },
            onFoeMaybeTrapPokemon(pokemon, source) {
                if (!source) source = this.effectState.target;
                if (!source || !pokemon.isAdjacent(source)) return;
                if (pokemon.isGrounded()) pokemon.maybeTrapped = true;
            },
            onDamagingHit(damage, target, source, move) {
                if (this.checkMoveMakesContact(move, source, target, true) && this.randomChance(3, 10)) {
                    source.addVolatile('partiallytrapped', target, this.effect);
                }
            },
        }),
        // ── Stat modifiers ──
        genius: ability("Genius", "This Pokemon's Special Attack is doubled.", {
            onModifySpA(spa, pokemon) {
                return this.chainModify(2);
            },
        }),
        tormented: ability("Tormented", "This Pokemon's Special Attack is 1.5x but special moves have 0.8x accuracy.", {
            onModifySpA(spa, pokemon) {
                return this.chainModify(1.5);
            },
            onModifyMove(move) {
                if (move.category === 'Special' && typeof move.accuracy === 'number') {
                    move.accuracy = Math.round(move.accuracy * 0.8);
                }
            },
        }),
        attunement: ability("Attunement", "This Pokemon's Special Attack is 1.5x while it has a status condition.", {
            onModifySpA(spa, pokemon) {
                if (pokemon.status) return this.chainModify(1.5);
            },
        }),
        impulsive: ability("Impulsive", "Deals 1.4x damage, but Attack falls one stage after physical moves and Sp.Atk falls one stage after special moves.", {
            onBasePower(basePower, pokemon, target, move) {
                return this.chainModify(1.4);
            },
            onAfterMove(pokemon, target, move) {
                if (move.category === 'Physical') this.boost({ atk: -1 }, pokemon, pokemon);
                else if (move.category === 'Special') this.boost({ spa: -1 }, pokemon, pokemon);
            },
        }),
        vitality: ability("Vitality", "This Pokemon's Sp.Def is raised by one stage when it is hit by an attack.", {
            onDamagingHit(damage, target, source, move) {
                this.boost({ spd: 1 });
            },
        }),
        // ── Weather interactions ──
        icyveins: ability("Icy Veins", "This Pokemon's moves deal 1.3x damage during Hail and it takes no damage from Hail.", {
            onBasePower(basePower, pokemon, target, move) {
                if (this.field.isWeather(['hail', 'snowscape'])) return this.chainModify(1.3);
            },
            onImmunity(type, pokemon) {
                if (type === 'hail') return false;
            },
        }),
        packedsnow: ability("Packed Snow", "During Hail this Pokemon takes 0.5x damage from super-effective moves and no damage from Hail.", {
            onSourceModifyDamage(damage, attacker, defender, move) {
                if (this.field.isWeather(['hail', 'snowscape']) && this.getEffectiveness(move, defender) > 0) {
                    return this.chainModify(0.5);
                }
            },
            onImmunity(type, pokemon) {
                if (type === 'hail') return false;
            },
        }),
        synthesize: ability("Synthesize", "This Pokemon heals 1/8 of its max HP in sunlight.", {
            onWeather(target, source, effect) {
                if (effect.id === 'sunnyday' || effect.id === 'desolateland') {
                    this.heal(target.baseMaxhp / 8);
                }
            },
        }),
        clayform: ability("Clay Form", "This Pokemon heals 1/8 of its max HP every turn during a Sandstorm and takes no damage from Sandstorm.", {
            onWeather(target, source, effect) {
                if (effect.id === 'sandstorm') {
                    this.heal(target.baseMaxhp / 8);
                }
            },
            onImmunity(type, pokemon) {
                if (type === 'sandstorm') return false;
            },
        }),
        wintergift: ability("Winter Gift", "During Hail all allies get 1.5x Special Attack and Special Defense, and this Pokemon takes no damage from Hail.", {
            onAllyBasePower(basePower, attacker, defender, move) {
                if (move.category === 'Special' && this.field.isWeather(['hail', 'snowscape'])) return this.chainModify(1.5);
            },
            onAllyModifySpD(spd, pokemon) {
                if (this.field.isWeather(['hail', 'snowscape'])) return this.chainModify(1.5);
            },
            onImmunity(type, pokemon) {
                if (type === 'hail') return false;
            },
        }),
        // ── Type-absorb (immune + boost) ──
        cometstorm: absorbBoost("Comet Storm", "Immune to Rock-type moves; when targeted by one, Sp.Atk and Speed rise by one stage.", 'Rock', { spa: 1, spe: 1 }),
        cacophony: ability("Cacophony", "Redirects single-target Sound-based moves to itself, is immune to them, and gains +1 Sp.Atk when targeted by one.", {
            onTryHit(target, source, move) {
                if (target !== source && move.flags && move.flags.sound) {
                    if (!this.boost({ spa: 1 })) {
                        this.add('-immune', target, '[from] ability: Cacophony');
                    }
                    return null;
                }
            },
            onAnyRedirectTarget(target, source, source2, move) {
                if (!move.flags || !move.flags.sound || move.flags['pledgecombo']) return;
                const redirectTarget = ['randomNormal', 'adjacentFoe'].includes(move.target) ? 'normal' : move.target;
                if (this.validTarget(this.effectState.target, source, redirectTarget)) {
                    if (move.smartTarget) move.smartTarget = false;
                    if (this.effectState.target !== target) {
                        this.add('-activate', this.effectState.target, 'ability: Cacophony');
                    }
                    return this.effectState.target;
                }
            },
        }, { breakable: 1 }),
        conductor: ability("Conductor", "This Pokemon's Electric-type moves hit Ground- and Electric-type Pokemon neutrally.", {
            onModifyMovePriority: -5,
            onModifyMove(move) {
                if (!move.ignoreImmunity) move.ignoreImmunity = {};
                if (move.ignoreImmunity !== true) move.ignoreImmunity['Electric'] = true;
            },
            onBasePower(basePower, pokemon, target, move) {
                if (move.type === 'Electric' && target && target.hasType('Electric')) return this.chainModify(2);
            },
        }),
        antigravity: ability("Antigravity", "This Pokemon's Ground-type moves ignore immunities (hit Cosmic-type Pokemon).", {
            onModifyMovePriority: -5,
            onModifyMove(move) {
                if (!move.ignoreImmunity) move.ignoreImmunity = {};
                if (move.ignoreImmunity !== true) move.ignoreImmunity['Ground'] = true;
            },
        }),
        // ── KO / residual ──
        charisma: ability("Charisma", "On KO, this Pokemon's Sp.Atk rises by one stage (once per switch-in).", {
            onStart(pokemon) {
                pokemon.abilityState.charismaUsed = false;
            },
            onSourceAfterFaint(length, target, source, effect) {
                if (effect && effect.effectType === 'Move' && source.hp && !source.abilityState.charismaUsed) {
                    source.abilityState.charismaUsed = true;
                    this.boost({ spa: length }, source);
                }
            },
        }),
        reaper: ability("Reaper", "When this Pokemon KOs a foe, it heals 20% of its max HP.", {
            onSourceAfterFaint(length, target, source, effect) {
                if (effect && effect.effectType === 'Move' && source.hp) {
                    // AfterFaint's event target is the fainted Pokemon; heal the
                    // KOing holder explicitly or the heal silently no-ops.
                    this.heal(source.maxhp / 5, source, source);
                }
            },
        }),
        regrowth: ability("Regrowth", "At the end of each turn, lowered stats rise one stage; with no lowered stats it heals 1/16 max HP instead.", {
            onResidual(pokemon) {
                const lowered = Object.keys(pokemon.boosts).filter((stat) => pokemon.boosts[stat] < 0);
                if (lowered.length) {
                    const up = {};
                    for (const stat of lowered) up[stat] = 1;
                    this.boost(up, pokemon, pokemon);
                } else {
                    this.heal(pokemon.baseMaxhp / 16);
                }
            },
        }),
        pureheart: ability("Pure Heart", "This Pokemon gradually regains 1/16 of its max HP every turn.", {
            onResidual(pokemon) {
                this.heal(pokemon.baseMaxhp / 16);
            },
        }),
        // ── Damage-condition modifiers ──
        gorging: ability("Gorging", "This Pokemon's draining moves deal 1.3x damage.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.category !== 'Status' && move.drain) return this.chainModify(1.3);
            },
        }),
        vandal: ability("Vandal", "This Pokemon deals 1.3x damage to targets that are holding an item.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.category !== 'Status' && target && target.item) return this.chainModify(1.3);
            },
        }),
        flexible: ability("Flexible", "This Pokemon's moves that don't share a type with it deal 1.3x damage.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.category !== 'Status' && move.type && !pokemon.hasType(move.type)) return this.chainModify(1.3);
            },
        }),
        resonant: ability("Resonant", "This Pokemon's spread moves deal 1.33x damage (cancelling the spread penalty).", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.category !== 'Status' && (move.target === 'allAdjacent' || move.target === 'allAdjacentFoes')) {
                    return this.chainModify(1.33);
                }
            },
        }),
        lightaura: ability("Light Aura", "All Pokemon on the field deal 1.33x damage with Light-type moves.", {
            onAnyBasePowerPriority: 19,
            onAnyBasePower(basePower, source, target, move) {
                if (move.type === 'Light') return this.chainModify([5325, 4096]);
            },
        }, { breakable: 1 }),
        superconductive: ability("Superconductive", "This Pokemon's physical attacks deal 1.5x damage while frostbitten, and it takes halved damage while frostbitten.", {
            onBasePower(basePower, pokemon, target, move) {
                if (pokemon.status === 'frz' && move.category === 'Physical') return this.chainModify(1.5);
            },
            onSourceModifyDamage(damage, attacker, defender, move) {
                if (defender.status === 'frz') return this.chainModify(0.5);
            },
        }),
        precision: ability("Precision", "This Pokemon's moves have 1.3x accuracy.", {
            onModifyMove(move) {
                if (typeof move.accuracy === 'number') {
                    move.accuracy = Math.min(100, Math.round(move.accuracy * 1.3));
                }
            },
        }),
        rebellious: ability("Rebellious", "If its stats are lowered by an opponent, this Pokemon deals 1.3x damage until it switches out.", {
            onTryBoost(boost, target, source, effect) {
                if (!source || target === source) return;
                let lowered = false;
                for (const i in boost) {
                    if (boost[i] < 0) lowered = true;
                }
                if (lowered && !target.volatiles['rebelliousflag']) {
                    target.addVolatile('rebelliousflag');
                }
            },
            onBasePower(basePower, pokemon, target, move) {
                if (pokemon.volatiles['rebelliousflag']) return this.chainModify(1.3);
            },
        }),
        // ── Protection / redirection / modes ──
        nobility: ability("Nobility", "Opposing Pokemon's priority moves that target this Pokemon or its allies are nullified.", {
            onFoeTryMove(target, source, move) {
                const targetAllExceptions = ['perishsong', 'flowershield', 'rototiller'];
                if (move.target === 'foeSide' || (move.target === 'all' && !targetAllExceptions.includes(move.id))) {
                    return;
                }
                const nobilityHolder = this.effectState.target;
                if ((source.isAlly(nobilityHolder) || move.target === 'all') && move.priority > 0.1) {
                    this.attrLastMove('[still]');
                    this.add('cant', nobilityHolder, 'ability: Nobility', move, '[of] ' + target);
                    return false;
                }
            },
        }, { breakable: 1 }),
        teleface: ability("Teleface", "Protects from one physical attack; entering Electric Terrain restores the shield.", {
            onStart(pokemon) {
                if (!pokemon.volatiles['telefaceshield']) {
                    pokemon.addVolatile('telefaceshield');
                }
            },
            onDamagePriority: 1,
            onDamage(damage, target, source, effect) {
                if (effect && effect.effectType === 'Move' && effect.category === 'Physical' && target.volatiles['telefaceshield']) {
                    this.add('-activate', target, 'ability: Teleface');
                    target.removeVolatile('telefaceshield');
                    return 0;
                }
            },
            onTerrainChange(pokemon) {
                if (this.field.isTerrain('electricterrain') && !pokemon.volatiles['telefaceshield']) {
                    pokemon.addVolatile('telefaceshield');
                    this.add('-activate', pokemon, 'ability: Teleface');
                }
            },
        }),
        destructivecore: ability("Destructive Core", "This Pokemon is immune to non-volatile status conditions.", {
            onSetStatus(status, target, source, effect) {
                if ((effect && effect.status) || source !== target) {
                    this.add('-immune', target, '[from] ability: Destructive Core');
                }
                return false;
            },
        }),
        cartographer: ability("Cartographer", "Stats shift with the terrain: Grassy +Atk, Psychic +Def/Sp.Def, Misty +Spe, Electric +Sp.Atk.", {
            onModifyAtk(atk, pokemon) {
                if (this.field.isTerrain('grassyterrain')) return this.chainModify(1.5);
            },
            onModifyDef(def, pokemon) {
                if (this.field.isTerrain('psychicterrain')) return this.chainModify(1.5);
            },
            onModifySpD(spd, pokemon) {
                if (this.field.isTerrain('psychicterrain')) return this.chainModify(1.5);
            },
            onModifySpe(spe, pokemon) {
                if (this.field.isTerrain('mistyterrain')) return this.chainModify(1.5);
            },
            onModifySpA(spa, pokemon) {
                if (this.field.isTerrain('electricterrain')) return this.chainModify(1.5);
            },
        }),
        lightswitch: ability("Light Switch", "Starts in Powered Mode (Light type) and alternates with Unpowered Mode (Dark type) at the end of every turn.", {
            onStart(pokemon) {
                pokemon.abilityState.powered = true;
                pokemon.setType(['Light']);
                this.add('-start', pokemon, 'typechange', 'Light', '[from] ability: Light Switch');
            },
            onResidual(pokemon) {
                const powered = !pokemon.abilityState.powered;
                pokemon.abilityState.powered = powered;
                const type = powered ? 'Light' : 'Dark';
                pokemon.setType([type]);
                this.add('-start', pokemon, 'typechange', type, '[from] ability: Light Switch');
            },
        }),
        sharpshooter: ability("Sharpshooter", "Damaging moves that don't make contact never miss.", {
            onModifyMove(move) {
                if (move.category !== 'Status' && !(move.flags && move.flags.contact)) {
                    move.accuracy = true;
                }
            },
        }),
        windfury: ability("Windfury", "This Pokemon's Wind-based moves deal 1.3x damage and it takes 0.5x damage from them.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.flags && move.flags.wind) return this.chainModify(1.3);
            },
            onSourceModifyDamage(damage, attacker, defender, move) {
                if (move.flags && move.flags.wind) return this.chainModify(0.5);
            },
        }),
        nebulacloud: ability("Nebula Cloud", "Cosmic-type allies are immune to stat drops and non-volatile status inflicted by other Pokemon.", {
            onAllyTryBoost(boost, target, source, effect) {
                if ((source && target === source) || !target.hasType('Cosmic')) return;
                let showMsg = false;
                for (const i in boost) {
                    if (boost[i] < 0) {
                        delete boost[i];
                        showMsg = true;
                    }
                }
                if (showMsg && effect && !(effect.secondaries)) {
                    this.add('-block', target, 'ability: Nebula Cloud', '[of] ' + this.effectState.target);
                }
            },
            onAllySetStatus(status, target, source, effect) {
                if (!target.hasType('Cosmic')) return;
                this.debug('Nebula Cloud blocks status');
                const effectHolder = this.effectState.target;
                this.add('-block', target, 'ability: Nebula Cloud', '[of] ' + effectHolder);
                return null;
            },
        }, { breakable: 1 }),
        cannonfire: ability("Cannon Fire", "This Pokemon's Bomb moves deal 1.5x damage.", {
            onBasePower(basePower, pokemon, target, move) {
                if (move.flags && move.flags.bomb) return this.chainModify(1.5);
            },
        }),
    },
};
