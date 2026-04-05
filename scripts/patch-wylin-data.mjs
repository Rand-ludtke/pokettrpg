#!/usr/bin/env node
/**
 * patch-wylin-data.mjs
 * Comprehensive patch for wylin-customs.generated.json
 * Fixes: Chatot/Lechonk entries, heights, weights, abilities, evolutions,
 *        adds missing Pokemon (Chivir, Thundird, Dravolation), fixes Gaterston,
 *        fills Wylin Ralts line learnsets, adds TM/egg moves.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const FILE = resolve("tauri-app/public/data/more-pokemon/generated/wylin-customs.generated.json");

console.log("Reading JSON...");
const raw = readFileSync(FILE, "utf-8");
const data = JSON.parse(raw);

const dex = data.dex;
const learnsets = data.learnsets;
const moves = data.moves;
const abilities = data.abilities;

// ─── helpers ────────────────────────────────────────────────────────────────
function lbsToKg(lbs) { return Math.round(lbs * 0.453592 * 100) / 100; }
function feetInchesToM(feet, inches = 0) { return Math.round(((feet * 12 + inches) * 0.0254) * 100) / 100; }

// ─── 1. Fix Chatot placeholder entries ──────────────────────────────────────
// chatot (20012) and chatotwylin (20013) are broken placeholders with all-70 stats.
// The real data is in wylinchatot (20055). Fix the base form entries.
if (dex.chatot) {
  dex.chatot.types = ["Normal", "Flying"];
  dex.chatot.baseStats = { hp: 76, atk: 65, def: 45, spa: 92, spd: 42, spe: 91 };
  dex.chatot.abilities = { "0": "Keen Eye", "1": "Tangled Feet", "H": "Big Pecks" };
  dex.chatot.weightkg = 1.9;
  dex.chatot.heightm = 0.5;
  dex.chatot.name = "Chatot";
  dex.chatot.color = "Black";
}
if (dex.chatotwylin) {
  dex.chatotwylin.types = ["Normal", "Flying"];
  dex.chatotwylin.baseStats = { hp: 76, atk: 65, def: 45, spa: 92, spd: 42, spe: 91 };
  dex.chatotwylin.abilities = { "0": "Keen Eye", "1": "Tangled Feet", "H": "Big Pecks" };
  dex.chatotwylin.weightkg = 1.9;
  dex.chatotwylin.heightm = 0.5;
  dex.chatotwylin.color = "Black";
}
// Fix wylinchatot - add HA Prankster, height
if (dex.wylinchatot) {
  dex.wylinchatot.abilities = { "0": "Soundproof", "H": "Prankster" };
  dex.wylinchatot.heightm = feetInchesToM(1, 0); // 1'0
  dex.wylinchatot.color = "Green";
}

// ─── 2. Fix Lechonk placeholder entries ─────────────────────────────────────
if (dex.lechonk) {
  dex.lechonk.types = ["Normal"];
  dex.lechonk.baseStats = { hp: 54, atk: 45, def: 40, spa: 35, spd: 45, spe: 35 };
  dex.lechonk.abilities = { "0": "Aroma Veil", "1": "Gluttony", "H": "Thick Fat" };
  dex.lechonk.weightkg = 10.2;
  dex.lechonk.heightm = 0.5;
  dex.lechonk.name = "Lechonk";
  dex.lechonk.color = "Gray";
}
if (dex.lechonkwylian) {
  dex.lechonkwylian.types = ["Normal"];
  dex.lechonkwylian.baseStats = { hp: 54, atk: 45, def: 40, spa: 35, spd: 45, spe: 35 };
  dex.lechonkwylian.abilities = { "0": "Aroma Veil", "1": "Gluttony", "H": "Thick Fat" };
  dex.lechonkwylian.weightkg = 10.2;
  dex.lechonkwylian.heightm = 0.5;
  dex.lechonkwylian.color = "Gray";
}
// Fix wylianlechonk - add height, evolution
if (dex.wylianlechonk) {
  dex.wylianlechonk.heightm = feetInchesToM(1, 8); // 1'08
  dex.wylianlechonk.evos = ["Hoggore"];
  dex.wylianlechonk.color = "Brown";
}

// ─── 3. Fix Hoggore - add prevo, fix abilities ─────────────────────────────
if (dex.hoggore) {
  dex.hoggore.prevo = "Wylian Lechonk";
  dex.hoggore.evoLevel = 18;
  dex.hoggore.evoType = "levelExtra";
  dex.hoggore.abilities = { "0": "Anger Point", "1": "Intimidate" };
  dex.hoggore.heightm = feetInchesToM(3, 0);
}

// ─── 4. Fix Gaterston - should be Water/Dragon, not Electric/Flying ────────
// The txt has Gaterston as Water/Dragon with incomplete stats.
// Keep it as a placeholder with the correct type at least.
if (dex.gaterston) {
  dex.gaterston.types = ["Water", "Dragon"];
  dex.gaterston.baseStats = { hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe: 70 };
  dex.gaterston.abilities = { "0": "No Ability" };
  dex.gaterston.color = "Blue";
  delete dex.gaterston.weightkg; // no weight specified in txt
}

// ─── 5. Add missing heights to all Pokemon ──────────────────────────────────
const heightData = {
  bullwart:              feetInchesToM(2, 1),
  bullwartstienmark:     feetInchesToM(2, 1),
  cattastophie:          feetInchesToM(4, 6),
  cattastophiestienmark: feetInchesToM(4, 6),
  cattastrophie:         feetInchesToM(4, 6),
  rodiole:               feetInchesToM(6, 4),
  rodiolemega:           feetInchesToM(8, 0),
  rodiolestienmark:      feetInchesToM(6, 4),
  bufflow:               feetInchesToM(3, 0),
  hydruffo:              feetInchesToM(5, 0),
  babuffall:             feetInchesToM(6, 0),
  babuffallmega:         feetInchesToM(6, 5),
  bleepoat:              feetInchesToM(1, 0),
  gardam:                feetInchesToM(3, 0),
  rockram:               feetInchesToM(5, 0),
  rockrammega:           feetInchesToM(5, 5),
  rockramshinymega:      feetInchesToM(5, 5),
  sleg:                  feetInchesToM(1, 0),
  meespeed:              feetInchesToM(2, 0),
  machrun:               feetInchesToM(5, 0),
  machrunmega:           feetInchesToM(5, 5),
  dogrun:                feetInchesToM(2, 0),
  sheeruf:               feetInchesToM(3, 0),
  howound:               feetInchesToM(6, 0),
  howoundmega:           feetInchesToM(6, 0),
  monkiestidor:          feetInchesToM(1, 0),
  monkiestitdor:         feetInchesToM(1, 0),
  gortez:                feetInchesToM(4, 0),
  monquisitor:           feetInchesToM(3, 0),
  wylianlechonk:         feetInchesToM(1, 8),
  hoggore:               feetInchesToM(3, 0),
  arweet:                feetInchesToM(1, 0),
  ameroc:                feetInchesToM(7, 0),
  goldica:               feetInchesToM(7, 0),
  wylinchatot:           feetInchesToM(1, 0),
  armydillo:             feetInchesToM(0, 5),
  ferrodillo:            feetInchesToM(4, 0),
  ferrodillomega:        feetInchesToM(6, 0),
  feraldillo:            feetInchesToM(3, 0),
  farmine:               feetInchesToM(0, 9), // 0'75 interpreted as ~9 inches
  felandit:              feetInchesToM(1, 5),
  felindillo:            feetInchesToM(1, 5),
  wakindor:              feetInchesToM(25, 0),
  wakindormega:          feetInchesToM(50, 0),
  wylinralts:            feetInchesToM(1, 4),  // standard Ralts height
  wylinkirlia:           feetInchesToM(2, 7),
  wylingardevoir:        feetInchesToM(5, 3),  // standard Gardevoir height
  wylingardevoirthebellydancer: feetInchesToM(5, 3),
  wylingardevoirmega:    feetInchesToM(5, 11),
  wylingallade:          feetInchesToM(5, 3),  // standard Gallade height
  wylingalladetheswashbuckler: feetInchesToM(5, 3),
};

for (const [key, h] of Object.entries(heightData)) {
  if (dex[key] && !dex[key].heightm) {
    dex[key].heightm = h;
  }
}

// ─── 6. Fix incorrect weights ───────────────────────────────────────────────
const weightFixes = {
  cattastophie:          lbsToKg(200),
  cattastophiestienmark: lbsToKg(200),
  cattastrophie:         lbsToKg(200),
  rodiole:               lbsToKg(400),
  rodiolemega:           lbsToKg(600),
  rodiolestienmark:      lbsToKg(400),
  bufflow:               lbsToKg(75),
  hydruffo:              lbsToKg(200),
  babuffall:             lbsToKg(500),
  babuffallmega:         lbsToKg(500),
  rockram:               lbsToKg(175),
  rockrammega:           lbsToKg(195),
  rockramshinymega:      lbsToKg(195),
  meespeed:              lbsToKg(15),
  machrun:               lbsToKg(85),
  machrunmega:           lbsToKg(100),
  ameroc:                lbsToKg(150),
  goldica:               lbsToKg(350),
  wakindor:              lbsToKg(500),
  wakindormega:          lbsToKg(950),
  wylinkirlia:           lbsToKg(44),
  wylingardevoirmega:    lbsToKg(110),
};

for (const [key, w] of Object.entries(weightFixes)) {
  if (dex[key]) dex[key].weightkg = w;
}

// ─── 7. Add evolution chains ────────────────────────────────────────────────
// Fire starter
if (dex.bullwart) dex.bullwart.evos = ["Cattastrophie"];
if (dex.cattastophie) { dex.cattastophie.prevo = "Bullwart"; dex.cattastophie.evoLevel = 16; dex.cattastophie.evos = ["Rodiole"]; }
if (dex.cattastrophie && dex.cattastrophie.num === 20047) {
  dex.cattastrophie.prevo = "Bullwart"; dex.cattastrophie.evoLevel = 16; dex.cattastrophie.evos = ["Rodiole"];
}
if (dex.rodiole) { dex.rodiole.prevo = "Cattastrophie"; dex.rodiole.evoLevel = 36; }

// Water starter
if (dex.bufflow) dex.bufflow.evos = ["Hydruffo"];
if (dex.hydruffo) { dex.hydruffo.prevo = "Bufflow"; dex.hydruffo.evoLevel = 16; dex.hydruffo.evos = ["BaBuffall"]; }
if (dex.babuffall) { dex.babuffall.prevo = "Hydruffo"; dex.babuffall.evoLevel = 36; }

// Grass starter
if (dex.bleepoat) dex.bleepoat.evos = ["Gardam"];
if (dex.gardam) { dex.gardam.prevo = "Bleepoat"; dex.gardam.evoLevel = 16; dex.gardam.evos = ["Rockram"]; }
if (dex.rockram) { dex.rockram.prevo = "Gardam"; dex.rockram.evoLevel = 36; }

// Bird line (Sleg → Meespeed → Machrun)
if (dex.sleg) dex.sleg.evos = ["Meespeed"];
if (dex.meespeed) { dex.meespeed.prevo = "Sleg"; dex.meespeed.evoLevel = 16; dex.meespeed.evos = ["Machrun"]; }
if (dex.machrun) { dex.machrun.prevo = "Meespeed"; dex.machrun.evoLevel = 36; }

// Dog line (Dugrun → Sheeruf → Howound)
if (dex.dogrun) dex.dogrun.evos = ["Sheeruf"];
if (dex.sheeruf) { dex.sheeruf.prevo = "Dugrun"; dex.sheeruf.evoLevel = 16; dex.sheeruf.evos = ["Howound"]; }
if (dex.howound) { dex.howound.prevo = "Sheeruf"; dex.howound.evoLevel = 36; }

// Monkey line
if (dex.monkiestidor) dex.monkiestidor.evos = ["Gortez", "Monquisitor"];
if (dex.monkiestitdor) dex.monkiestitdor.evos = ["Gortez", "Monquisitor"];
if (dex.gortez) { dex.gortez.prevo = "Monkiestitdor"; dex.gortez.evoLevel = 20; dex.gortez.evoCondition = "with higher Attack"; }
if (dex.monquisitor) { dex.monquisitor.prevo = "Monkiestitdor"; dex.monquisitor.evoLevel = 20; dex.monquisitor.evoCondition = "with higher Special Attack"; }

// Bird line (Arweet → Ameroc / Goldica)
if (dex.arweet) dex.arweet.evos = ["Ameroc", "Goldica"];
if (dex.ameroc) { dex.ameroc.prevo = "Arweet"; dex.ameroc.evoType = "useItem"; dex.ameroc.evoItem = "Metal Coat"; }
if (dex.goldica) { dex.goldica.prevo = "Arweet"; dex.goldica.evoLevel = 27; }

// Armydillo → Ferrodillo / Feraldillo (trade w/ Farmine)
if (dex.armydillo) dex.armydillo.evos = ["Ferrodillo", "Feraldillo"];
if (dex.ferrodillo) { dex.ferrodillo.prevo = "Armydillo"; dex.ferrodillo.evoLevel = 25; }
if (dex.feraldillo) { dex.feraldillo.prevo = "Armydillo"; dex.feraldillo.evoType = "trade"; dex.feraldillo.evoCondition = "with Farmine"; }

// Farmine → Felandit / Felindillo (trade w/ Armydillo)
if (dex.farmine) dex.farmine.evos = ["Felandit", "Felindillo"];
if (dex.felandit) { dex.felandit.prevo = "Farmine"; dex.felandit.evoLevel = 36; }
if (dex.felindillo) { dex.felindillo.prevo = "Farmine"; dex.felindillo.evoType = "trade"; dex.felindillo.evoCondition = "with Armydillo"; }

// Wylin Ralts line
if (dex.wylinralts) dex.wylinralts.evos = ["Wylin Kirlia"];
if (dex.wylinkirlia) {
  dex.wylinkirlia.prevo = "Wylin Ralts"; dex.wylinkirlia.evoLevel = 20;
  dex.wylinkirlia.evos = ["Wylin Gardevoir", "Wylin Gallade"];
}
if (dex.wylingardevoir) { dex.wylingardevoir.prevo = "Wylin Kirlia"; dex.wylingardevoir.evoLevel = 30; }
if (dex.wylingallade) { dex.wylingallade.prevo = "Wylin Kirlia"; dex.wylingallade.evoType = "useItem"; dex.wylingallade.evoItem = "Water Stone"; dex.wylingallade.evoCondition = "Must be male"; }

// ─── 8. Fix abilities for Wylin Ralts line ──────────────────────────────────
if (dex.wylinralts) {
  dex.wylinralts.types = ["Water", "Fairy"];
  dex.wylinralts.baseStats = { hp: 30, atk: 25, def: 25, spa: 35, spd: 55, spe: 20 };
  dex.wylinralts.abilities = { "0": "Trace", "H": "Distillation" };
  dex.wylinralts.weightkg = lbsToKg(14.6); // standard Ralts weight
  dex.wylinralts.color = "Blue";
}
if (dex.wylinkirlia) {
  dex.wylinkirlia.types = ["Water", "Fairy"];
  dex.wylinkirlia.baseStats = { hp: 38, atk: 35, def: 35, spa: 65, spd: 55, spe: 50 };
  dex.wylinkirlia.abilities = { "0": "Trace", "1": "Dancer", "H": "Distillation" };
  dex.wylinkirlia.weightkg = lbsToKg(44);
  dex.wylinkirlia.color = "Blue";
}
if (dex.wylingardevoir) {
  dex.wylingardevoir.types = ["Water", "Fairy"];
  dex.wylingardevoir.baseStats = { hp: 68, atk: 65, def: 65, spa: 125, spd: 115, spe: 80 };
  dex.wylingardevoir.abilities = { "0": "Trace", "1": "Dancer", "H": "Distillation" };
  dex.wylingardevoir.weightkg = lbsToKg(106.7); // standard Gardevoir weight
  dex.wylingardevoir.color = "Blue";
}
if (dex.wylingardevoirthebellydancer) {
  dex.wylingardevoirthebellydancer.types = ["Water", "Fairy"];
  dex.wylingardevoirthebellydancer.baseStats = { hp: 68, atk: 65, def: 65, spa: 125, spd: 115, spe: 80 };
  dex.wylingardevoirthebellydancer.abilities = { "0": "Trace", "1": "Dancer", "H": "Distillation" };
  dex.wylingardevoirthebellydancer.color = "Blue";
}
if (dex.wylingallade) {
  dex.wylingallade.types = ["Water", "Fighting"];
  dex.wylingallade.baseStats = { hp: 68, atk: 125, def: 65, spa: 65, spd: 115, spe: 80 };
  dex.wylingallade.abilities = { "0": "Sharpness", "1": "Dancer", "H": "Distillation" };
  dex.wylingallade.weightkg = lbsToKg(114.6); // standard Gallade weight
  dex.wylingallade.color = "Blue";
  dex.wylingallade.gender = "M";
}
if (dex.wylingalladetheswashbuckler) {
  dex.wylingalladetheswashbuckler.types = ["Water", "Fighting"];
  dex.wylingalladetheswashbuckler.baseStats = { hp: 68, atk: 125, def: 65, spa: 65, spd: 115, spe: 80 };
  dex.wylingalladetheswashbuckler.abilities = { "0": "Sharpness", "1": "Dancer", "H": "Distillation" };
  dex.wylingalladetheswashbuckler.color = "Blue";
  dex.wylingalladetheswashbuckler.gender = "M";
}
if (dex.wylingardevoirmega) {
  dex.wylingardevoirmega.abilities = { "0": "Distillation" };
  dex.wylingardevoirmega.gender = "F";
}

// Fix placeholder base-form alias entries for Ralts line
if (dex.ralts) {
  dex.ralts.types = ["Psychic", "Fairy"];
  dex.ralts.baseStats = { hp: 28, atk: 25, def: 25, spa: 45, spd: 35, spe: 40 };
  dex.ralts.abilities = { "0": "Synchronize", "1": "Trace", "H": "Telepathy" };
  dex.ralts.weightkg = 6.6;
  dex.ralts.heightm = 0.4;
  dex.ralts.color = "White";
}
if (dex.raltswylin) {
  dex.raltswylin.types = ["Psychic", "Fairy"];
  dex.raltswylin.baseStats = { hp: 28, atk: 25, def: 25, spa: 45, spd: 35, spe: 40 };
  dex.raltswylin.abilities = { "0": "Synchronize", "1": "Trace", "H": "Telepathy" };
  dex.raltswylin.weightkg = 6.6;
  dex.raltswylin.heightm = 0.4;
  dex.raltswylin.color = "White";
}
if (dex.kirlia) {
  dex.kirlia.types = ["Psychic", "Fairy"];
  dex.kirlia.baseStats = { hp: 38, atk: 35, def: 35, spa: 65, spd: 55, spe: 50 };
  dex.kirlia.abilities = { "0": "Synchronize", "1": "Trace", "H": "Telepathy" };
  dex.kirlia.color = "White";
}
if (dex.kirliawylin) {
  dex.kirliawylin.types = ["Psychic", "Fairy"];
  dex.kirliawylin.baseStats = { hp: 38, atk: 35, def: 35, spa: 65, spd: 55, spe: 50 };
  dex.kirliawylin.abilities = { "0": "Synchronize", "1": "Trace", "H": "Telepathy" };
  dex.kirliawylin.color = "White";
}
if (dex.gardevoir) {
  dex.gardevoir.types = ["Psychic", "Fairy"];
  dex.gardevoir.baseStats = { hp: 68, atk: 65, def: 65, spa: 125, spd: 115, spe: 80 };
  dex.gardevoir.abilities = { "0": "Synchronize", "1": "Trace", "H": "Telepathy" };
  dex.gardevoir.color = "White";
}
if (dex.gardevoirwylin) {
  dex.gardevoirwylin.types = ["Psychic", "Fairy"];
  dex.gardevoirwylin.baseStats = { hp: 68, atk: 65, def: 65, spa: 125, spd: 115, spe: 80 };
  dex.gardevoirwylin.abilities = { "0": "Synchronize", "1": "Trace", "H": "Telepathy" };
  dex.gardevoirwylin.color = "White";
}
if (dex.gallade) {
  dex.gallade.types = ["Psychic", "Fighting"];
  dex.gallade.baseStats = { hp: 68, atk: 125, def: 65, spa: 65, spd: 115, spe: 80 };
  dex.gallade.abilities = { "0": "Steadfast", "1": "Sharpness", "H": "Justified" };
  dex.gallade.color = "White";
}
if (dex.galladewylin) {
  dex.galladewylin.types = ["Psychic", "Fighting"];
  dex.galladewylin.baseStats = { hp: 68, atk: 125, def: 65, spa: 65, spd: 115, spe: 80 };
  dex.galladewylin.abilities = { "0": "Steadfast", "1": "Sharpness", "H": "Justified" };
  dex.galladewylin.color = "White";
}

// ─── 9. Add missing Pokemon: Chivir, Thundird, Dravolation ─────────────────
const nextNum = 20070; // safe range above existing

if (!dex.chivir) {
  dex.chivir = {
    name: "Chivir", num: nextNum, types: ["Electric"],
    baseStats: { hp: 50, atk: 20, def: 70, spa: 50, spd: 70, spe: 40 },
    abilities: { "0": "Lightning Rod" },
    weightkg: lbsToKg(10), heightm: feetInchesToM(0, 5),
    color: "Yellow", gen: 9, isNonstandard: "Custom",
    spriteid: "Chivir", otherFormes: [], formeOrder: ["Chivir"],
    evos: ["Thundird"]
  };
}
if (!dex.thundird) {
  dex.thundird = {
    name: "Thundird", num: nextNum + 1, types: ["Electric"],
    baseStats: { hp: 70, atk: 20, def: 70, spa: 90, spd: 70, spe: 90 },
    abilities: { "0": "Lightning Rod" },
    weightkg: lbsToKg(50), heightm: feetInchesToM(2, 0),
    color: "Yellow", gen: 9, isNonstandard: "Custom",
    spriteid: "Thundird", otherFormes: [], formeOrder: ["Thundird"],
    prevo: "Chivir", evoLevel: 25, evos: ["Wakindor"]
  };
}
if (!dex.dravolation) {
  dex.dravolation = {
    name: "Dravolation", num: nextNum + 2, types: ["Water", "Dragon"],
    baseStats: { hp: 150, atk: 100, def: 150, spa: 100, spd: 150, spe: 20 },
    abilities: { "0": "Harold of the End" },
    weightkg: lbsToKg(500), heightm: feetInchesToM(18, 2),
    color: "Blue", gen: 9, isNonstandard: "Custom",
    spriteid: "Dravolation", otherFormes: [], formeOrder: ["Dravolation"],
    tags: ["Sub-Legendary"]
  };
}

// Fix Wakindor prevo chain
if (dex.wakindor) {
  dex.wakindor.prevo = "Thundird";
  dex.wakindor.evoLevel = 100;
  dex.wakindor.heightm = feetInchesToM(25, 0);
}

// ─── 10. Add Mega Howound ability "Heartbreak" ─────────────────────────────
if (dex.howoundmega) {
  dex.howoundmega.abilities = { "0": "Heartbreak" };
}

// ─── 11. Add missing custom moves ──────────────────────────────────────────
if (!moves.slagdart) {
  moves.slagdart = {
    name: "Slag Dart", type: "Ground", basePower: 80, category: "Physical",
    priority: 2,
    shortDesc: "80 Power. Ground. Physical. +2 Priority",
    desc: "80 Power. Ground. Physical. +2 Priority"
  };
}
if (!moves.herd) {
  moves.herd = {
    name: "Herd", type: "Normal", basePower: 0, category: "Status",
    shortDesc: "Swap hazards/stats/status; -3 Spe, trap opponent",
    desc: "Swap all stat changes, entrance hazards, and status effects. Decrease the opponent's speed by 3 stages and prevent switch-outs, escapes and pivots."
  };
}
if (!moves.bustdown) {
  moves.bustdown = {
    name: "Bustdown", type: "Dark", basePower: 0, category: "Status",
    shortDesc: "Steals opponent's item and stat boosts. Triggers hazards on self.",
    desc: "Steals opponent pokemon's item and stat boosts. Triggers all entrance hazards on this pokemon."
  };
}
if (!moves.shadowbite) {
  moves.shadowbite = {
    name: "Shadow Bite", type: "Ghost", basePower: 80, category: "Physical",
    shortDesc: "80 Power. Physical. Ghost. Lowers Speed by 1 stage.",
    desc: "80 Power. Physical. Ghost. Lowers Speed by one stage."
  };
}
if (!moves.guard) {
  moves.guard = {
    name: "Guard", type: "Normal", basePower: 0, category: "Status",
    shortDesc: "Switches out opponent, sets up Normal-type Spikes",
    desc: "Switches out opponent, sets up Normal-Type Spikes."
  };
}
if (!moves.bury) {
  moves.bury = {
    name: "Bury", type: "Normal", basePower: 0, category: "Physical",
    accuracy: 30,
    shortDesc: "30% accurate OHKO. Normal type.",
    desc: "30% Accurate, instant KO attack. Normal Type."
  };
}
if (!moves.conquer) {
  moves.conquer = {
    name: "Conquer", type: "Fighting", basePower: 90, category: "Physical",
    shortDesc: "90 Power. Fighting. Physical. Lowers opponent's speed by 1 stage.",
    desc: "90 Power. Fighting. Physical. Lowers opponent's speed by 1 stage."
  };
}
if (!moves.inquisit) {
  moves.inquisit = {
    name: "Inquisit", type: "Dark", basePower: 90, category: "Special",
    shortDesc: "90 Power. Dark. Special. Lowers opponent's speed by 1 stage.",
    desc: "90 Power. Dark. Special. Lowers opponent's speed by 1 stage."
  };
}
if (!moves.headache) {
  moves.headache = {
    name: "Headache", type: "Psychic", basePower: 0, category: "Special",
    shortDesc: "A psychic move with unknown effects.",
    desc: "0 Power. Psychic. Special."
  };
}
if (!moves.unexpected) {
  moves.unexpected = {
    name: "Unexpected", type: "Dark", basePower: 0, category: "Status",
    shortDesc: "Lowers opponent's speed and attack by 1 stage and switches out.",
    desc: "Lowers opponents speed and attack by 1 stage and switches out."
  };
}
if (!moves.hydrovortex) {
  moves.hydrovortex = {
    name: "Hydro-Vortex", type: "Water", basePower: 80, category: "Special",
    shortDesc: "Traps target for 4-5 turns, deals 1/8 HP per turn.",
    desc: "Traps the target for 4-5 turns and deals 1/8th of the target's maximum HP as damage at the end of each turn."
  };
}
if (!moves.brineblade) {
  moves.brineblade = {
    name: "Brine Blade", type: "Water", basePower: 65, category: "Physical",
    shortDesc: "Slicing move. Double damage if target below 50% HP.",
    desc: "Slicing move. Deals double damage if the target is below 50% HP. 65 BP."
  };
}
if (!moves.oasisembrace) {
  moves.oasisembrace = {
    name: "Oasis Embrace", type: "Water", basePower: 100, category: "Special",
    shortDesc: "Traps target; heals user 1/16 HP/turn while trapped.",
    desc: "Traps the opponent in a whirlpool. Heals Mega Gardevoir for 1/16th max HP every turn the opponent remains trapped and deals 1/8th max HP damage per turn."
  };
}

// ─── 12. Add missing custom abilities ───────────────────────────────────────
if (!abilities.heartbreak) {
  abilities.heartbreak = {
    name: "Heartbreak",
    shortDesc: "Lowers Defense and Special Defense by 1 stage on switch in.",
    desc: "Lowers Defense and Special Defense by 1 stage on Switch In. Ability activates the moment Mega Howound appears on the field."
  };
}
if (!abilities.quickfoot) {
  abilities.quickfoot = {
    name: "Quick Foot",
    shortDesc: "Attacks under 60 power are given +1 Priority.",
    desc: "Attacks under 60 power are given +1 Priority."
  };
}
if (!abilities.unexpected) {
  abilities.unexpected = {
    name: "Unexpected",
    shortDesc: "1/6 chance to instantly go first and hit any move.",
    desc: "1/6 chance to instantly go first and instantly hit any move."
  };
}
if (!abilities.distillation) {
  abilities.distillation = {
    name: "Distillation",
    shortDesc: "Poison-type moves become Water-type.",
    desc: "Poison-type moves targeting this Pokemon or used by this Pokemon become Water-type instead."
  };
}
if (!abilities.haroldoftheend) {
  abilities.haroldoftheend = {
    name: "Harold of the End",
    shortDesc: "Moves above 90 power become 150 power.",
    desc: "If a move's power is higher, not equal to, 90 pre-modifiers, then it gets increased to 150 pre-modifiers."
  };
}

// ─── 13. Fill learnsets: Wylin Ralts line ───────────────────────────────────
learnsets.wylinralts = { learnset: {
  watergun: ["9L1"], growl: ["9L1"], disarmingvoice: ["9L3"],
  chillingwater: ["9L6"], hypnosis: ["9L9"], drainingkiss: ["9L12"],
  aquaring: ["9L15"], lifedew: ["9L18"],
  // TMs
  protect: ["9M"], rest: ["9M"], substitute: ["9M"], raindance: ["9M"],
  calmmind: ["9M"], scald: ["9M"], icebeam: ["9M"], psychic: ["9M"],
  dazzlinggleam: ["9M"], shadowball: ["9M"], thunderbolt: ["9M"],
  // Egg moves
  wish: ["9E"], destinybond: ["9E"], memento: ["9E"], encore: ["9E"]
}};

learnsets.wylinkirlia = { learnset: {
  watergun: ["9L1"], growl: ["9L1"], disarmingvoice: ["9L3"],
  chillingwater: ["9L6"], hypnosis: ["9L9"], drainingkiss: ["9L12"],
  aquaring: ["9L15"], lifedew: ["9L18"],
  teeterdance: ["9L20"],  // evolution move
  bubblebeam: ["9L23"], charm: ["9L26"], raindance: ["9L30"],
  sparklingaria: ["9L34"], calmmind: ["9L38"],
  // TMs
  protect: ["9M"], rest: ["9M"], substitute: ["9M"],
  scald: ["9M"], icebeam: ["9M"], psychic: ["9M"],
  dazzlinggleam: ["9M"], shadowball: ["9M"], thunderbolt: ["9M"],
  surf: ["9M"], lightscreen: ["9M"], reflect: ["9M"], trick: ["9M"],
  // Egg moves (inherited)
  wish: ["9E"], destinybond: ["9E"], memento: ["9E"], encore: ["9E"]
}};

learnsets.wylingardevoir = { learnset: {
  watergun: ["9L1"], growl: ["9L1"], disarmingvoice: ["9L3"],
  chillingwater: ["9L6"], hypnosis: ["9L9"], drainingkiss: ["9L12"],
  aquaring: ["9L15"], lifedew: ["9L18"], teeterdance: ["9L20"],
  bubblebeam: ["9L23"], charm: ["9L26"], raindance: ["9L30"],
  sparklingaria: ["9L34"], calmmind: ["9L38"],
  fierydance: ["9L30"],  // evolution move ("Vibrant Dance")
  muddywater: ["9L42"], moonblast: ["9L49"],
  hydrovortex: ["9L55"], quiverdance: ["9L62"],
  // TMs
  protect: ["9M"], rest: ["9M"], substitute: ["9M"],
  scald: ["9M"], icebeam: ["9M"], blizzard: ["9M"], psychic: ["9M"],
  dazzlinggleam: ["9M"], shadowball: ["9M"], thunderbolt: ["9M"],
  surf: ["9M"], lightscreen: ["9M"], reflect: ["9M"], trick: ["9M"],
  energyball: ["9M"], focusblast: ["9M"], toxic: ["9M"],
  willowisp: ["9M"], mysticalfire: ["9M"], healingwish: ["9M"],
  // Egg moves
  wish: ["9E"], destinybond: ["9E"], memento: ["9E"], encore: ["9E"]
}};

// Copy Gardevoir learnset to bellydancer forme
learnsets.wylingardevoirthebellydancer = JSON.parse(JSON.stringify(learnsets.wylingardevoir));
// Add oasis embrace for mega
learnsets.wylingardevoirthebellydancer.learnset.oasisembrace = ["9L55"];

learnsets.wylingallade = { learnset: {
  watergun: ["9L1"], growl: ["9L1"], disarmingvoice: ["9L3"],
  chillingwater: ["9L6"], hypnosis: ["9L9"], drainingkiss: ["9L12"],
  aquaring: ["9L15"], lifedew: ["9L18"], teeterdance: ["9L20"],
  bubblebeam: ["9L23"], charm: ["9L26"], raindance: ["9L30"],
  aquacutter: ["9L30"],  // evolution move
  swordsdance: ["9L35"], sacredsword: ["9L42"],
  liquidation: ["9L49"], brineblade: ["9L55"], closecombat: ["9L62"],
  // TMs
  protect: ["9M"], rest: ["9M"], substitute: ["9M"],
  scald: ["9M"], icebeam: ["9M"], psychic: ["9M"],
  shadowball: ["9M"], brickbreak: ["9M"], poisonjab: ["9M"],
  xscissor: ["9M"], rockslide: ["9M"], earthquake: ["9M"],
  surf: ["9M"], bulkup: ["9M"], drainpunch: ["9M"], leafblade: ["9M"],
  nightslash: ["9M"], aerialace: ["9M"], falseswipe: ["9M"],
  // Egg moves
  wish: ["9E"], destinybond: ["9E"], memento: ["9E"], encore: ["9E"]
}};

learnsets.wylingalladetheswashbuckler = JSON.parse(JSON.stringify(learnsets.wylingallade));

// ─── 14. Add missing learnsets: Chivir, Thundird, Dravolation ──────────────
if (!learnsets.chivir) {
  learnsets.chivir = { learnset: {
    pound: ["9L1"], screech: ["9L1"], thundershock: ["9L1"],
    thunderwave: ["9L5"], wingattack: ["9L10"], razorwind: ["9L14"],
    electroball: ["9L16"], aircutter: ["9L23"], thunderbolt: ["9L30"],
    divinestrike: ["9L48"], thunder: ["9L49"], airslash: ["9L53"],
    zapcannon: ["9L54"], electroshot: ["9L56"], hurricane: ["9L60"],
    blizzard: ["9L68"], focusblast: ["9L75"], sunnyday: ["9L86"],
    solarbeam: ["9L90"], blastburn: ["9L98"], naturesmadness: ["9L100"],
    // TMs
    protect: ["9M"], rest: ["9M"], substitute: ["9M"],
    voltswitch: ["9M"], roost: ["9M"], uturn: ["9M"],
    heatwave: ["9M"], chargebeam: ["9M"],
    // Egg moves
    discharge: ["9E"], ancientpower: ["9E"], weatherball: ["9E"]
  }};
}
if (!learnsets.thundird) {
  learnsets.thundird = JSON.parse(JSON.stringify(learnsets.chivir));
  // Add some extra TMs for the evo
  learnsets.thundird.learnset.agility = ["9M"];
  learnsets.thundird.learnset.calmmind = ["9M"];
  learnsets.thundird.learnset.tailwind = ["9M"];
}
if (!learnsets.dravolation) {
  learnsets.dravolation = { learnset: {
    hydropump: ["9L1"], dracometeor: ["9L1"], aquatail: ["9L1"],
    dragonpulse: ["9L1"], surf: ["9L10"], dragondance: ["9L20"],
    earthquake: ["9L30"], icebeam: ["9L40"], outrage: ["9L50"],
    thunderbolt: ["9L60"], calmmind: ["9L70"], rest: ["9L80"],
    originpulse: ["9L90"], roaroftime: ["9L100"],
    // TMs
    protect: ["9M"], substitute: ["9M"], scald: ["9M"],
    blizzard: ["9M"], thunder: ["9M"], fireblast: ["9M"],
    psychic: ["9M"], darkpulse: ["9M"], flashcannon: ["9M"],
    stealthrock: ["9M"], toxic: ["9M"], raindance: ["9M"],
    waterfall: ["9M"], dive: ["9M"], bodypress: ["9M"]
  }};
}

// ─── 15. Add TM moves to ALL existing Wylin Pokemon ────────────────────────
// We'll add type-appropriate TMs and universal moves to each Pokemon's learnset.

function addTMs(key, tmMoves) {
  if (!learnsets[key]) return;
  const ls = learnsets[key].learnset;
  for (const move of tmMoves) {
    if (!ls[move]) ls[move] = ["9M"];
    else if (!ls[move].includes("9M")) ls[move].push("9M");
  }
}

function addEggs(key, eggMoves) {
  if (!learnsets[key]) return;
  const ls = learnsets[key].learnset;
  for (const move of eggMoves) {
    if (!ls[move]) ls[move] = ["9E"];
  }
}

// Universal TMs almost everything gets
const universalTMs = ["protect", "rest", "substitute", "sleeptalk", "facade", "endure"];

// Fire starter line
const fireTMs = [...universalTMs, "fireblast", "overheat", "willowisp", "sunnyday",
  "rockslide", "rocktomb", "brickbreak", "bulkup", "swordsdance", "ironhead",
  "stompingtantrum", "bodypress", "zenheadbutt", "workup", "roar",
  "stealthrock", "superpower", "firepunch", "scorchingsands"];
const fireEggs = ["morningsun", "doublekick", "revenge", "counter"];
for (const k of ["bullwart", "bullwartstienmark"]) { addTMs(k, fireTMs); addEggs(k, fireEggs); }
for (const k of ["cattastophie", "cattastophiestienmark", "cattastrophie"]) { addTMs(k, fireTMs); addEggs(k, fireEggs); }
for (const k of ["rodiole", "rodiolemega", "rodiolestienmark"]) { addTMs(k, fireTMs); addEggs(k, fireEggs); }

// Water/Steel starter line
const waterSteelTMs = [...universalTMs, "scald", "icebeam", "blizzard", "raindance",
  "stealthrock", "calmmind", "irondefense", "flashcannon", "bodypress",
  "surf", "waterfall", "heavyslam", "ironhead", "toxic", "roar",
  "thunderwave", "gyroball"];
const waterSteelEggs = ["aquaring", "mirrorcoat", "wideguard", "curse"];
for (const k of ["bufflow"]) { addTMs(k, waterSteelTMs); addEggs(k, waterSteelEggs); }
for (const k of ["hydruffo"]) { addTMs(k, waterSteelTMs); addEggs(k, waterSteelEggs); }
for (const k of ["babuffall", "babuffallmega"]) { addTMs(k, waterSteelTMs); addEggs(k, waterSteelEggs); }

// Grass/Rock starter line
const grassRockTMs = [...universalTMs, "energyball", "gigadrain", "stoneedge", "rockslide",
  "stealthrock", "swordsdance", "bulkup", "bodypress", "seedbomb",
  "leechseed", "synthesis", "bulldoze", "earthquake", "rockpolish",
  "grassknot", "solarblade", "solarbeam", "sunnyday", "toxic"];
const grassRockEggs = ["leechseed", "synthesis", "counter", "curse"];
for (const k of ["bleepoat"]) { addTMs(k, grassRockTMs); addEggs(k, grassRockEggs); }
for (const k of ["gardam"]) { addTMs(k, grassRockTMs); addEggs(k, grassRockEggs); }
for (const k of ["rockram", "rockrammega", "rockramshinymega"]) { addTMs(k, grassRockTMs); addEggs(k, grassRockEggs); }

// Ground/Flying bird line (Sleg, Meespeed, Machrun)
const groundFlyTMs = [...universalTMs, "earthquake", "uturn", "acrobatics", "fly",
  "rockslide", "stealthrock", "swordsdance", "bravbird", "drillpeck",
  "aerialace", "agility", "sandstorm", "roost", "defog", "poisonjab",
  "knockoff", "closecombat", "wildcharge"];
const groundFlyEggs = ["featherdance", "quickattack", "defog", "counter"];
for (const k of ["sleg", "meespeed", "machrun", "machrunmega"]) { addTMs(k, groundFlyTMs); addEggs(k, groundFlyEggs); }

// Normal/Ghost dog line (Dugrun, Sheeruf, Howound)
const dogTMs = [...universalTMs, "shadowball", "shadowclaw", "willowisp",
  "bulkup", "swordsdance", "crunch", "bodyslam", "stealthrock",
  "thunderwave", "toxic", "psychicfangs", "firefang", "icefang", "thunderfang",
  "playrough", "wildcharge", "earthquake", "knockoff"];
const dogEggs = ["yawn", "wish", "curse", "morningsun"];
for (const k of ["dogrun", "sheeruf", "howound", "howoundmega"]) { addTMs(k, dogTMs); addEggs(k, dogEggs); }

// Monkiestitdor line
const monkeyTMs = [...universalTMs, "brickbreak", "bulkup", "rockslide",
  "irondefense", "thunderpunch", "icepunch", "firepunch", "uturn",
  "knockoff", "swordsdance", "earthquake", "stealthrock"];
const monkeyEggs = ["counter", "fakeout", "focuspunch", "quickguard"];
for (const k of ["monkiestidor", "monkiestitdor"]) { addTMs(k, monkeyTMs); addEggs(k, monkeyEggs); }

// Gortez (Fighting)
const gortezTMs = [...universalTMs, ...monkeyTMs, "closecombat", "superpower",
  "drainpunch", "aurasphere", "psychic", "focusblast", "stoneEdge",
  "poisonjab", "crosschop"];
addTMs("gortez", gortezTMs);
addEggs("gortez", monkeyEggs);

// Monquisitor (Dark)
const monqTMs = [...universalTMs, "darkpulse", "nastyplot", "foulplay", "snarl",
  "shadowball", "focusblast", "psychic", "uturn", "knockoff", "taunt",
  "thunderbolt", "heatwave", "trick"];
addTMs("monquisitor", monqTMs);
addEggs("monquisitor", monkeyEggs);

// Wylian Lechonk / Hoggore
const lechonkTMs = [...universalTMs, "earthquake", "rockslide", "bulkup",
  "swordsdance", "poisonjab", "brickbreak", "ironhead", "stompingtantrum",
  "superpower", "zenheadbutt", "wildcharge", "firefang", "icefang", "thunderfang"];
const lechonkEggs = ["counter", "revenge", "quickattack"];
addTMs("wylianlechonk", lechonkTMs);
addEggs("wylianlechonk", lechonkEggs);
addTMs("hoggore", lechonkTMs);
addEggs("hoggore", lechonkEggs);

// Wylin Chatot
const chatotTMs = [...universalTMs, "airslash", "hurricane", "heatwave", "uturn",
  "encore", "nastyplot", "hypervoice", "roost", "focusblast", "shadowball",
  "dazzlinggleam", "thunderbolt", "icebeam", "trick", "defog", "toxic"];
const chatotEggs = ["nastyplot", "boomburst", "defog", "agility"];
addTMs("wylinchatot", chatotTMs);
addEggs("wylinchatot", chatotEggs);

// Arweet / Ameroc / Goldica
const birdBaseTMs = [...universalTMs, "fly", "rockslide", "stealthrock",
  "uturn", "roost", "defog"];
addTMs("arweet", birdBaseTMs);
addEggs("arweet", ["quickattack", "whirlwind", "haze"]);

const amerocTMs = [...birdBaseTMs, "stoneedge", "earthquake", "bodypress",
  "irondefense", "bravbird", "rockblast", "sandstorm"];
addTMs("ameroc", amerocTMs);

const goldicaTMs = [...birdBaseTMs, "flashcannon", "airslash", "thunderbolt",
  "irondefense", "calmmind", "powergem", "metalsound"];
addTMs("goldica", goldicaTMs);

// Armydillo / Ferrodillo / Feraldillo
const armadilloTMs = [...universalTMs, "stealthrock", "rockslide", "stoneedge",
  "earthquake", "ironhead", "irondefense", "bodypress", "sandstorm",
  "toxic", "gyroball"];
const armadilloEggs = ["counter", "curse", "wideguard", "rapidspin"];
addTMs("armydillo", armadilloTMs); addEggs("armydillo", armadilloEggs);
addTMs("ferrodillo", armadilloTMs); addEggs("ferrodillo", armadilloEggs);
addTMs("ferrodillomega", armadilloTMs);
addTMs("feraldillo", [...armadilloTMs, "closecombat", "superpower", "drainpunch",
  "swordsdance", "knockoff", "poisonjab"]);
addEggs("feraldillo", armadilloEggs);

// Farmine / Felandit / Felindillo
const catTMs = [...universalTMs, "darkpulse", "crunch", "knockoff",
  "uturn", "taunt", "thunderwave", "toxic", "shadowclaw"];
const catEggs = ["fakeout", "quickattack", "yawn", "partingshot"];
addTMs("farmine", catTMs); addEggs("farmine", catEggs);
addTMs("felandit", [...catTMs, "nastyplot", "foulplay", "snarl",
  "psychic", "encore", "willowisp", "trick"]);
addEggs("felandit", catEggs);
addTMs("felindillo", [...catTMs, "irondefense", "bodypress", "ironhead",
  "flashcannon", "stealthrock"]);
addEggs("felindillo", catEggs);

// Wakindor / Wakindor-Mega (pseudo-legendary final form)
const wakindorTMs = [...universalTMs, "thunderbolt", "thunder", "hurricane",
  "airslash", "heatwave", "focusblast", "icebeam", "blizzard",
  "solarbeam", "calmmind", "agility", "roost", "voltswitch", "uturn",
  "tailwind", "defog", "batonpass", "chargebeam", "electroshot",
  "zapcannon"];
addTMs("wakindor", wakindorTMs);
addTMs("wakindormega", wakindorTMs);

// Also fix Gaterston learnset (remove tripled entries, give placeholder)
if (learnsets.gaterston) {
  learnsets.gaterston = { learnset: {
    watergun: ["9L1"], bite: ["9L1"], dragonbreath: ["9L5"],
    aquajet: ["9L10"], dragonrage: ["9L15"], waterpulse: ["9L20"],
    dragonpulse: ["9L30"], surf: ["9L40"], dragondance: ["9L50"],
    hydropump: ["9L60"],
    protect: ["9M"], rest: ["9M"], substitute: ["9M"],
    icebeam: ["9M"], thunderbolt: ["9M"], earthquake: ["9M"],
    scald: ["9M"]
  }};
}

// ─── 16. Add evolution moves to evolutions ──────────────────────────────────
// In PS format, evolution moves can be "9L0" (learned on evolution) or just at evo level

// Cattastrophie: learns Flame Wheel on evolution at 16
if (learnsets.cattastophie?.learnset) learnsets.cattastophie.learnset.flamewheel = ["9L16"];
if (learnsets.cattastrophie?.learnset) learnsets.cattastrophie.learnset.flamewheel = ["9L16"];

// Rodiole: learns Flare Blitz on evolution at 36
// (already in learnset at L85, keep as is)

// Hydruffo: learns Water Pulse on evolution
if (learnsets.hydruffo?.learnset) learnsets.hydruffo.learnset.waterpulse = ["9L16"];

// Babuffall: learns Hydro Cannon
// (already at L100)

// Gardam: learns Razor Leaf on evolution
if (learnsets.gardam?.learnset) learnsets.gardam.learnset.razorleaf = ["9L16"];

// Meespeed: learns Aerial Ace on evo
if (learnsets.meespeed?.learnset) learnsets.meespeed.learnset.aerialace = ["9L16"];

// Machrun: learns Drill Peck on evo
if (learnsets.machrun?.learnset) learnsets.machrun.learnset.drillpeck = ["9L36"];

// Sheeruf: learns Court Change on evo
if (learnsets.sheeruf?.learnset) learnsets.sheeruf.learnset.courtchange = ["9L16"];

// Howound: learns Herd on evo
if (learnsets.howound?.learnset) learnsets.howound.learnset.herd = ["9L36"];

// Gortez: learns Conquer on evo
if (learnsets.gortez?.learnset) learnsets.gortez.learnset.conquer = ["9L20"];

// Monquisitor: learns Inquisit on evo
if (learnsets.monquisitor?.learnset) learnsets.monquisitor.learnset.inquisit = ["9L20"];

// Hoggore: learns Maul on evo
if (learnsets.hoggore?.learnset) learnsets.hoggore.learnset.maul = ["9L18"];

// Ameroc: learns Stone Edge on evo
if (learnsets.ameroc?.learnset) learnsets.ameroc.learnset.stoneedge = ["9L30"];

// Goldica: learns Flash Cannon on evo
if (learnsets.goldica?.learnset) learnsets.goldica.learnset.flashcannon = ["9L27"];

// Ferrodillo: learns Iron Defense on evo
if (learnsets.ferrodillo?.learnset) learnsets.ferrodillo.learnset.irondefense = ["9L25"];

// Felandit: learns Crunch on evo
if (learnsets.felandit?.learnset) learnsets.felandit.learnset.crunch = ["9L36"];

// Thundird: learns Electro Ball on evo
if (learnsets.thundird?.learnset) learnsets.thundird.learnset.electroball = ["9L25"];

// Wakindor: learns Divine Strike on evo (already in learnset via inheritance)

console.log("Writing JSON...");
writeFileSync(FILE, JSON.stringify(data));
console.log("Done! Patched wylin-customs.generated.json successfully.");

// Summary
console.log("\n=== PATCH SUMMARY ===");
console.log("Fixed: Chatot base form entries (types, stats, abilities)");
console.log("Fixed: Lechonk base form entries (types, stats, abilities)");
console.log("Fixed: Wylin Chatot (added HA: Prankster, height)");
console.log("Fixed: Wylian Lechonk (added height, evolution link)");
console.log("Fixed: Hoggore (added prevo, split abilities, height)");
console.log("Fixed: Gaterston (corrected types to Water/Dragon)");
console.log("Fixed: All Wylin Ralts line (types, stats, abilities, full learnsets)");
console.log("Fixed: All placeholder base-form aliases (Ralts, Kirlia, Gardevoir, Gallade)");
console.log("Added: Chivir (Electric pseudo-baby)");
console.log("Added: Thundird (Electric pseudo-mid)");
console.log("Added: Dravolation (Water/Dragon mythical)");
console.log("Added: Heights to all Pokemon");
console.log("Added: Weight corrections");
console.log("Added: Evolution chains (evos/prevo/evoLevel) for all lines");
console.log("Added: 12+ custom moves (Slag Dart, Herd, Bustdown, etc.)");
console.log("Added: 5 custom abilities (Heartbreak, Quick Foot, etc.)");
console.log("Added: TM moves to all Pokemon");
console.log("Added: Egg moves to relevant Pokemon");
console.log("Added: Evolution moves to evolved forms");
