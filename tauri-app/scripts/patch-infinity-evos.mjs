/**
 * Patch evolution methods into pokedex.infinity.json
 * Data sourced from the Pokemon Infinity wiki (p-infinity.fandom.com) via Wayback Machine
 */
import { readFileSync, writeFileSync } from 'fs';

const DEX_PATH = new URL('../public/data/infinity/generated/pokedex.infinity.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const dex = JSON.parse(readFileSync(DEX_PATH, 'utf8'));

// ── Evolution data mapping ──────────────────────────────────────────────
// Each key is a dex entry key. Value is the evo fields to add.
const evoData = {
  // ═══ EGHO KANTO STARTERS ═══
  ivysauregho:      { evoLevel: 16 },
  venusauregho:     { evoLevel: 34 },
  charmeleonegho:   { evoLevel: 16 },
  charizardegho:    { evoLevel: 36 },
  wartortleegho:    { evoLevel: 16 },
  blastoiseegho:    { evoLevel: 36 },

  // ═══ EGHO JOHTO STARTERS ═══
  bayleefegho:      { evoLevel: 16 },
  meganiumegho:     { evoLevel: 32 },
  quilavaegho:      { evoLevel: 14 },
  typhlosionegho:   { evoLevel: 36 },
  croconawegho:     { evoLevel: 18 },
  feraligatregho:   { evoLevel: 30 },

  // ═══ OTHER EGHO FORMS ═══
  fearowegho:       { evoLevel: 25 },
  gloomegho:        { evoLevel: 21 },
  magnetonegho:     { evoLevel: 30 },
  mukegho:          { evoLevel: 38 },
  shellderegho:     { evoType: "useItem", evoItem: "Slowpoke Tail" },
  chanseyegho:      { evoType: "levelHold", evoItem: "Oval Stone", evoCondition: "during the day" },
  noctowlegho:      { evoLevel: 20 },
  marillegho:       { evoType: "levelFriendship" },
  azumarillegho:    { evoLevel: 20 },
  blisseyegho:      { evoType: "levelFriendship" },
  lombreegho:       { evoLevel: 14 },
  ludicoloegho:     { evoType: "useItem", evoItem: "Fire Stone" },
  altariaegho:      { evoLevel: 35 },
  magnezoneegho:    { evoType: "levelHold", evoItem: "Miracle Seed", evoCondition: "during the day" },
  tangrowthegho:    { evoType: "useItem", evoItem: "Thunder Stone" },
  garbodoregho:     { evoLevel: 36 },

  // ═══ FAKEMON ═══
  lukagon:          { evoType: "levelFriendship" },
  kokipound:        { evoLevel: 16 },
  kokismash:        { evoLevel: 36 },
  burnaram:         { evoLevel: 18 },
  psysteed:         { evoLevel: 36 },
  brutoad:          { evoLevel: 16 },
  godfrogger:       { evoLevel: 36 },
  gorochu:          { evoType: "useItem", evoItem: "Fire Stone" },
  quezsparce:       { evoType: "levelMove", evoMove: "Drill Run" },
  faeralynx:        { evoType: "levelMove", evoMove: "Faeng Rush" },
  skulkraken:       { evoLevel: 39 },
  oozma:            { evoType: "useItem", evoItem: "Fire Stone" },
  terathwack:       { evoType: "levelHold", evoItem: "Long Club" },
  grimfowl:         { evoType: "useItem", evoItem: "Dusk Stone" },
  sunflorid:        { evoType: "useItem", evoItem: "Fire Stone" },
  sorcerice:        { evoType: "useItem", evoItem: "Astral Stone" },
  kecleodon:        { evoType: "levelMove", evoMove: "Thief" },
  wereyena:         { evoType: "useItem", evoItem: "Moon Stone" },
  snosquatch:       { evoType: "useItem", evoItem: "Dawn Stone" },
  grasquatch:       { evoType: "useItem", evoItem: "Leaf Stone" },
  gigantusk:        { evoLevel: 30 },
  glacieros:        { evoLevel: 30 },
  jollibird:        { evoType: "useItem", evoItem: "Astral Stone" },
  kablowfish:       { evoType: "levelHold", evoItem: "Metal Coat" },
  dragalis:         { evoLevel: 30 },
  ceregal:          { evoLevel: 50 },
  wardern:          { evoLevel: 26 },
  dragoyle:         { evoLevel: 46 },
  porygonx:         { evoType: "levelHold", evoItem: "Quantum Upgrade" },
  viledoom:         { evoType: "levelMove", evoMove: "Toxic" },
  mortossum:        { evoType: "levelFriendship" },
  psycholyte:       { evoLevel: 16 },
  shroomage:        { evoLevel: 36 },
  girafaraf:        { evoType: "useItem", evoItem: "Dawn Stone" },
  giragira:         { evoType: "useItem", evoItem: "Dusk Stone" },
  orcabyss:         { evoLevel: 52 },
  joltalope:        { evoType: "levelMove", evoMove: "Horn Leech" },

  // ═══ DIGIMON: Baby → In-Training ═══
  koromon:          { evoLevel: 7, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  tsunomon:         { evoLevel: 7, evoType: "levelExtra", evoCondition: "with Attack < Defense" },
  motimon:          { evoLevel: 7, evoType: "levelExtra", evoCondition: "with Attack = Defense" },
  pagumon:          { evoLevel: 10 },

  // ═══ DIGIMON: In-Training → Rookie (from Koromon) ═══
  agumon:           { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  biyomon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack = Defense" },
  betamon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack < Defense" },
  patamon:          { evoLevel: 15 },

  // ═══ DIGIMON: In-Training → Rookie (from Tsunomon) ═══
  gabumon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  gomamon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack = Defense" },
  elecmon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack < Defense" },

  // ═══ DIGIMON: In-Training → Rookie (from Motimon) ═══
  palmon:           { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  kunemon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack = Defense" },
  tentomon:         { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack < Defense" },
  crabmon:          { evoLevel: 15 },

  // ═══ DIGIMON: In-Training → Rookie (from Pagumon) ═══
  gazimon:          { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  demidevimon:      { evoLevel: 12, evoType: "levelExtra", evoCondition: "with Attack < Defense" },
  keramon:          { evoType: "levelHold", evoItem: "Corrupted Data" },

  // ═══ DIGIMON: Rookie → Champion ═══
  greymon:          { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  tyrannomon:       { evoLevel: 48 },
  birdramon:        { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  seadramon:        { evoLevel: 24, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  garurumon:        { evoType: "levelMove", evoMove: "Ice Punch" },
  ikkakumon:        { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  kabuterimon:      { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  flymon:           { evoLevel: 24, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  togemon:          { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  vegiemon:         { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack < Defense" },
  redvegiemon:      { evoLevel: 34 },
  woodmon:          { evoLevel: 28 },
  coelamon:         { evoLevel: 26 },
  angemon:          { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  etemon:           { evoType: "levelFriendship" },
  devimon:          { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  bakemon:          { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack = Defense" },
  wizardmon:        { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack < Defense" },

  // ═══ DIGIMON: Champion → Ultimate ═══
  metalgreymon:     { evoType: "levelFriendship" },
  skullgreymon:     { evoType: "levelExtra", evoCondition: "with Attack < Defense" },
  weregarurumon:    { evoLevel: 26, evoType: "levelExtra", evoCondition: "with Attack > Defense" },
  megakabuterimon:  { evoType: "levelFriendship" },
  garudamon:        { evoType: "levelFriendship" },
  zudomon:          { evoType: "levelFriendship" },
  megaseadramon:    { evoType: "levelFriendship" },
  metalseadramon:   { evoType: "levelHold", evoItem: "Corrupted Data" },
  okuwamon:         { evoType: "levelFriendship" },
  lillymon:         { evoType: "levelFriendship" },
  whamon:           { evoType: "levelFriendship" },
  monzaemon:        { evoType: "levelHold", evoItem: "Stuffed Bear" },
  magnaangemon:     { evoType: "levelFriendship" },
  saberleomon:      { evoType: "levelFriendship" },
  metaletemon:      { evoType: "levelHold", evoItem: "Metal Coat" },
  myotismon:        { evoLevel: 60 },
  phantomon:        { evoLevel: 60 },
  infermon:         { evoType: "levelFriendship" },
  cherrymon:        { evoType: "levelFriendship" },

  // ═══ DIGIMON: Ultimate → Mega ═══
  wargreymon:       { evoLevel: 76 },
  metalgarurumon:   { evoType: "levelFriendship" },
  machinedramon:    { evoType: "levelHold", evoItem: "Corrupted Data" },
  puppetmon:        { evoLevel: 60 },
  piedmon:          { evoType: "levelHold", evoItem: "Corrupted Data" },
  diaboromon:       { evoLevel: 68 },
};

// ── Apply patches ────────────────────────────────────────────────────────
let patched = 0;
let missing = 0;

for (const [key, fields] of Object.entries(evoData)) {
  if (!dex[key]) {
    console.warn(`⚠ Key "${key}" not found in dex`);
    missing++;
    continue;
  }
  Object.assign(dex[key], fields);
  patched++;
}

// ── Verify all prevo entries now have evo data ──────────────────────────
const stillMissing = [];
for (const [key, entry] of Object.entries(dex)) {
  if (entry.prevo && !entry.evoLevel && !entry.evoType) {
    stillMissing.push(`${key} (prevo: ${entry.prevo})`);
  }
}

// ── Write result ────────────────────────────────────────────────────────
writeFileSync(DEX_PATH, JSON.stringify(dex, null, '\t'), 'utf8');

console.log(`✅ Patched ${patched} entries`);
if (missing > 0) console.log(`⚠ ${missing} keys not found in dex`);
if (stillMissing.length > 0) {
  console.log(`\n❌ ${stillMissing.length} entries STILL missing evo data:`);
  stillMissing.forEach(e => console.log(`   ${e}`));
} else {
  console.log(`✅ All prevo entries now have evo method data`);
}
