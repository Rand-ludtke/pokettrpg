// PS2 PBS to Orion/Templeton mapping
// Maps PS2 PBS species names to Orion/Templeton entries based on matching base name AND exact types

export interface SoulstonePS2Mapping {
  ps2Species: string; // PS2 PBS species name (e.g., "SOLOSIS")
  orionTempletonKey: string; // Orion/Templeton entry key (e.g., "solosisorion")
  description: string;
}

// Mapping based on matching base name AND exact types between PS2 PBS and Orion/Templeton
export const SOULSTONE_PS2_MAPPING: SoulstonePS2Mapping[] = [
  // Solosis line - Water/Psychic
  { ps2Species: 'SOLOSIS', orionTempletonKey: 'solosisorion', description: 'Solosis-Orion (Water/Psychic)' },
  { ps2Species: 'DUOSION', orionTempletonKey: 'duosionorion', description: 'Duosion-Orion (Water/Psychic)' },
  { ps2Species: 'REUNICLUS', orionTempletonKey: 'reuniclusorion', description: 'Reuniclus-Orion (Water/Psychic)' },

  // Gastly line - Ice/Flying
  { ps2Species: 'GASTLY', orionTempletonKey: 'gastlyorion', description: 'Gastly-Orion (Ice/Flying)' },
  { ps2Species: 'HAUNTER', orionTempletonKey: 'haunterorion', description: 'Haunter-Orion (Ice/Flying)' },
  { ps2Species: 'GENGAR', orionTempletonKey: 'gengarorion', description: 'Gengar-Orion (Ice/Flying)' },

  // Doduo line - Cosmic/Flying
  { ps2Species: 'DODUO', orionTempletonKey: 'doduoorion', description: 'Doduo-Orion (Cosmic/Flying)' },
  { ps2Species: 'DODRIO', orionTempletonKey: 'dodrioorion', description: 'Dodrio-Orion (Cosmic/Flying)' },

  // Ekans line - Ground/Poison
  { ps2Species: 'EKANS', orionTempletonKey: 'ekansorion', description: 'Ekans-Orion (Ground/Poison)' },
  { ps2Species: 'ARBOK', orionTempletonKey: 'arbokorion', description: 'Arbok-Orion (Ground/Poison)' },

  // Staryu line - Cosmic/Rock
  { ps2Species: 'STARYU', orionTempletonKey: 'staryuorion', description: 'Staryu-Orion (Cosmic/Rock)' },
  { ps2Species: 'STARMIE', orionTempletonKey: 'starmieorion', description: 'Starmie-Orion (Cosmic/Rock)' },

  // Onix line - Ice/Rock
  { ps2Species: 'ONIX', orionTempletonKey: 'onixorion', description: 'Onix-Orion (Ice/Rock)' },
  { ps2Species: 'STEELIX', orionTempletonKey: 'steelixorion', description: 'Steelix-Orion (Ice/Rock)' },

  // Slugma line - Poison
  { ps2Species: 'SLUGMA', orionTempletonKey: 'slugmaorion', description: 'Slugma-Orion (Poison)' },
  { ps2Species: 'MAGCARGO', orionTempletonKey: 'magcargoorion', description: 'Magcargo-Orion (Poison/Steel)' },

  // Wailmer line - Ghost/Water
  { ps2Species: 'WAILMER', orionTempletonKey: 'wailmerorion', description: 'Wailmer-Orion (Ghost/Water)' },
  { ps2Species: 'WAILORD', orionTempletonKey: 'wailordorion', description: 'Wailord-Orion (Ghost/Water)' },

  // Fletchling line - Electric/Flying
  { ps2Species: 'FLETCHLING', orionTempletonKey: 'fletchlingorion', description: 'Fletchling-Orion (Electric/Flying)' },
  { ps2Species: 'FLETCHINDER', orionTempletonKey: 'fletchinderorion', description: 'Fletchinder-Orion (Electric/Flying)' },
  { ps2Species: 'TALONFLAME', orionTempletonKey: 'talonflameorion', description: 'Talonflame-Orion (Electric/Flying)' },

  // Natu line - Steel/Electric
  { ps2Species: 'NATU', orionTempletonKey: 'natorion', description: 'Natu-Orion (Steel/Electric)' },
  { ps2Species: 'XATU', orionTempletonKey: 'xatuorion', description: 'Xatu-Orion (Steel/Electric)' },

  // Rufflet line - Fire/Flying
  { ps2Species: 'RUFFLET', orionTempletonKey: 'ruffletorion', description: 'Rufflet-Orion (Fire/Flying)' },
  { ps2Species: 'BRAVIARY', orionTempletonKey: 'bravariyorion', description: 'Braviary-Orion (Fire/Flying)' },

  // Nosepass line - Grass/Psychic
  { ps2Species: 'NOSEPASS', orionTempletonKey: 'nosepassorion', description: 'Nosepass-Orion (Grass/Psychic)' },
  { ps2Species: 'PROBOPASS', orionTempletonKey: 'probopassorion', description: 'Probopass-Orion (Grass/Psychic)' },

  // Zubat line - Dark/Sound
  { ps2Species: 'ZUBAT', orionTempletonKey: 'zubatorion', description: 'Zubat-Orion (Dark/Sound)' },
  { ps2Species: 'GOLBAT', orionTempletonKey: 'golbatorion', description: 'Golbat-Orion (Dark/Sound)' },
  { ps2Species: 'CROBAT', orionTempletonKey: 'crobatorion', description: 'Crobat-Orion (Dark/Sound)' },

  // Tangela line - Ground/Grass
  { ps2Species: 'TANGELA', orionTempletonKey: 'tangelaorion', description: 'Tangela-Orion (Ground/Grass)' },
  { ps2Species: 'TANGROWTH', orionTempletonKey: 'tangrowthorion', description: 'Tangrowth-Orion (Ground/Grass)' },

  // Tympole line - Grass/Poison
  { ps2Species: 'TYMPOLE', orionTempletonKey: 'tympoletemporal', description: 'Tympole-Temporal (Grass/Poison)' },
  { ps2Species: 'PALPITOAD', orionTempletonKey: 'palpitoadtemporal', description: 'Palpitoad-Temporal (Grass/Poison)' },
  { ps2Species: 'SEISMITOAD', orionTempletonKey: 'seismitoadorion', description: 'Seismitoad-Orion (Grass/Poison)' },

  // Gulpin line - Ground
  { ps2Species: 'GULPIN', orionTempletonKey: 'gulpinatorion', description: 'Gulpin-Orion (Ground)' },
  { ps2Species: 'SWALOT', orionTempletonKey: 'swalotorion', description: 'Swalot-Orion (Ground)' },

  // Spinarak line - Dark/Poison
  { ps2Species: 'SPINARAK', orionTempletonKey: 'spinarakorion', description: 'Spinarak-Orion (Dark/Poison)' },
  { ps2Species: 'ARIADOS', orionTempletonKey: 'ariadosorion', description: 'Ariados-Orion (Dark/Poison)' },

  // Baltoy line - Electric/Psychic
  { ps2Species: 'BALTOY', orionTempletonKey: 'baltyorion', description: 'Baltoy-Orion (Electric/Psychic)' },
  { ps2Species: 'CLAYDOL', orionTempletonKey: 'claydolorion', description: 'Claydol-Orion (Electric/Psychic)' },

  // Zorua line - Ice/Dark
  { ps2Species: 'ZORUA', orionTempletonKey: 'zoruatorion', description: 'Zorua-Orion (Ice/Dark)' },
  { ps2Species: 'ZOROARK', orionTempletonKey: 'zoroarkorion', description: 'Zoroark-Orion (Ice/Dark)' },

  // Ducklett line - Light/Flying
  { ps2Species: 'DUCKLETT', orionTempletonKey: 'ducklettorion', description: 'Ducklett-Orion (Light/Flying)' },
  { ps2Species: 'SWANNA', orionTempletonKey: 'swannaorion', description: 'Swanna-Orion (Light/Flying)' },

  // Golett line - Steel/Psychic
  { ps2Species: 'GOLETT', orionTempletonKey: 'golttorion', description: 'Golett-Orion (Steel/Psychic)' },
  { ps2Species: 'GOLURK', orionTempletonKey: 'golurkorion', description: 'Golurk-Orion (Steel/Psychic)' },

  // Morelull line - Ghost/Grass
  { ps2Species: 'MORELULL', orionTempletonKey: 'morelullorion', description: 'Morelull-Orion (Ghost/Grass)' },
  { ps2Species: 'SHIINOTIC', orionTempletonKey: 'shiinoticorion', description: 'Shiinotic-Orion (Ghost/Grass)' },

  // Vullaby line - Dark/Flying
  { ps2Species: 'VULLABY', orionTempletonKey: 'vullabyorion', description: 'Vullaby-Orion (Dark/Flying)' },
  { ps2Species: 'MANDIBUZZ', orionTempletonKey: 'mandibuzzorion', description: 'Mandibuzz-Orion (Dark/Flying)' },

  // Fomantis line - Grass/Fire
  { ps2Species: 'FOMANTIS', orionTempletonKey: 'fomantisorion', description: 'Fomantis-Orion (Grass/Fire)' },
  { ps2Species: 'LURANTIS', orionTempletonKey: 'lurantisorion', description: 'Lurantis-Orion (Grass/Fire)' },

  // Morelull line - Ghost/Grass
  { ps2Species: 'MORELULL', orionTempletonKey: 'morelullorion', description: 'Morelull-Orion (Ghost/Grass)' },
  { ps2Species: 'SHIINOTIC', orionTempletonKey: 'shiinoticorion', description: 'Shiinotic-Orion (Ghost/Grass)' },

  // Salandit line - Poison/Fire
  { ps2Species: 'SALANDIT', orionTempletonKey: 'salanditorion', description: 'Salandit-Orion (Poison/Fire)' },
  { ps2Species: 'SALAZZLE', orionTempletonKey: 'salazzleorion', description: 'Salazzle-Orion (Poison/Fire)' },

  // Stunfisk line - Normal/Sound
  { ps2Species: 'STUNFISK', orionTempletonKey: 'stunfiskorion', description: 'Stunfisk-Orion (Normal/Sound)' },
];

// Helper function to get Orion/Templeton key from PS2 species name
export function getOrionTempletonKey(ps2Species: string): string | undefined {
  const mapping = SOULSTONE_PS2_MAPPING.find(m => m.ps2Species === ps2Species);
  return mapping?.orionTempletonKey;
}

// Helper function to check if a PS2 species has a mapping
export function hasPS2Mapping(ps2Species: string): boolean {
  return SOULSTONE_PS2_MAPPING.some(m => m.ps2Species === ps2Species);
}
