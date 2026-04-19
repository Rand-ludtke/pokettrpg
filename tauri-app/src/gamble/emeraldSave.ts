import { EMERALD_MOVES_BY_ID, EMERALD_SPECIES_BY_ID, type EmeraldGrowthRate } from './generated/emeraldMetadata';

const SECTOR_SIZE = 0x1000;
const SECTOR_DATA_SIZE = 3968;
const SECTOR_FOOTER_UNUSED = 116;
const SECTOR_ID_OFFSET = SECTOR_DATA_SIZE + SECTOR_FOOTER_UNUSED;
const SECTOR_CHECKSUM_OFFSET = SECTOR_ID_OFFSET + 2;
const SECTOR_SIGNATURE_OFFSET = SECTOR_ID_OFFSET + 4;
const SECTOR_COUNTER_OFFSET = SECTOR_ID_OFFSET + 8;
const SECTOR_SIGNATURE = 0x08012025;
const NUM_SECTORS_PER_SLOT = 14;
const SAVEBLOCK2_ID = 0;
const SAVEBLOCK1_FIRST_ID = 1;
const POKEMON_STORAGE_FIRST_ID = 5;
const POKEMON_STORAGE_LAST_ID = 13;
const SAVEBLOCK2_SIZE = 0x0f2c;
const POKEMON_STORAGE_SIZE = 0x83d0;
const COINS_OFFSET = 0x0494;
const ENCRYPTION_KEY_OFFSET = 0x00ac;
const PARTY_COUNT_OFFSET = 0x0234;
const PARTY_OFFSET = 0x0238;
const PARTY_MON_SIZE = 100;
const MAX_PARTY_SIZE = 6;
const BOX_MON_SIZE = 80;
const TOTAL_BOXES = 14;
const BOX_SIZE = 30;
const STORAGE_CURRENT_BOX_OFFSET = 0x0000;
const STORAGE_BOXES_OFFSET = 0x0001;
const GEN3_NICKNAME_LENGTH = 10;
const RASTATE_HEADER = 'RASTATE';
const RASTATE_MEM_BLOCK = 'MEM ';
const RASTATE_END_BLOCK = 'END ';
const RASTATE_BLOCK_HEADER_SIZE = 8;
const MGBA_GBA_STATE_SIZE = 0x61000;
const MGBA_GBA_STATE_MAGIC = 0x01000000;
const MGBA_GBA_STATE_VERSION = 0x0000000a;
const MGBA_EXTDATA_HEADER_SIZE = 16;
const MGBA_EXTDATA_SAVEDATA = 2;

const SUBSTRUCT_ORDERS: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
  [0, 2, 3, 1],
  [0, 3, 2, 1],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [2, 0, 1, 3],
  [3, 0, 1, 2],
  [2, 0, 3, 1],
  [3, 0, 2, 1],
  [1, 2, 0, 3],
  [1, 3, 0, 2],
  [2, 1, 0, 3],
  [3, 1, 0, 2],
  [2, 3, 0, 1],
  [3, 2, 0, 1],
  [1, 2, 3, 0],
  [1, 3, 2, 0],
  [2, 1, 3, 0],
  [3, 1, 2, 0],
  [2, 3, 1, 0],
  [3, 2, 1, 0],
];

export interface ParsedEmeraldCoins {
  coins: number;
  slot: 1 | 2;
  counter: number;
}

export interface ParsedEmeraldMon {
  signature: string;
  personality: number;
  otId: number;
  speciesId: number;
  speciesName: string;
  nickname: string | null;
  level: number;
  shiny: boolean;
  abilitySlot: 0 | 1;
  heldItemId: number;
  moveIds: number[];
  moveNames: string[];
  ivs: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  evs: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  origin: 'party' | 'box';
  slotIndex: number;
  boxIndex?: number;
}

export interface ParsedEmeraldSave extends ParsedEmeraldCoins {
  currentBox: number;
  party: ParsedEmeraldMon[];
  boxes: ParsedEmeraldMon[];
}

interface ParsedSector {
  id: number;
  counter: number;
  data: Uint8Array;
  physicalIndex: number;
}

interface ParsedSlot {
  slot: 1 | 2;
  counter: number;
  sectors: Map<number, ParsedSector>;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readI64(bytes: Uint8Array, offset: number): number {
  const low = readU32(bytes, offset);
  const high = readU32(bytes, offset + 4);
  return low + (high * 0x1_0000_0000);
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function calculateChecksum(bytes: Uint8Array, length: number): number {
  let sum = 0;
  for (let offset = 0; offset < length; offset += 4) {
    sum = (sum + readU32(bytes, offset)) >>> 0;
  }
  return (((sum >>> 16) + sum) & 0xffff) >>> 0;
}

function calculateBoxMonChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    sum = (sum + readU16(bytes, offset)) & 0xffff;
  }
  return sum & 0xffff;
}

function expectedSectorSize(id: number): number {
  if (id === SAVEBLOCK2_ID) return SAVEBLOCK2_SIZE;
  if (id >= POKEMON_STORAGE_FIRST_ID && id < POKEMON_STORAGE_LAST_ID) return SECTOR_DATA_SIZE;
  if (id === POKEMON_STORAGE_LAST_ID) return POKEMON_STORAGE_SIZE - (SECTOR_DATA_SIZE * (POKEMON_STORAGE_LAST_ID - POKEMON_STORAGE_FIRST_ID));
  return SECTOR_DATA_SIZE;
}

function validateSector(bytes: Uint8Array, physicalIndex: number): ParsedSector | null {
  if (bytes.length !== SECTOR_SIZE) return null;
  const signature = readU32(bytes, SECTOR_SIGNATURE_OFFSET);
  if (signature !== SECTOR_SIGNATURE) return null;

  const id = readU16(bytes, SECTOR_ID_OFFSET);
  const checksum = readU16(bytes, SECTOR_CHECKSUM_OFFSET);
  const logicalSize = expectedSectorSize(id);
  const expected = calculateChecksum(bytes.subarray(0, logicalSize), logicalSize);
  if (checksum !== expected) return null;

  return {
    id,
    counter: readU32(bytes, SECTOR_COUNTER_OFFSET),
    data: bytes.subarray(0, SECTOR_DATA_SIZE),
    physicalIndex,
  };
}

function isSlot2Newer(counter1: number, counter2: number): boolean {
  if ((counter1 === 0xffffffff && counter2 === 0) || (counter1 === 0 && counter2 === 0xffffffff)) {
    return ((counter1 + 1) >>> 0) < ((counter2 + 1) >>> 0);
  }
  return counter1 < counter2;
}

function decodeGen3Char(value: number): string {
  if (value === 0x00) return ' ';
  if (value >= 0xa1 && value <= 0xaa) return String(value - 0xa1);
  if (value >= 0xbb && value <= 0xd4) return String.fromCharCode('A'.charCodeAt(0) + (value - 0xbb));
  if (value >= 0xd5 && value <= 0xee) return String.fromCharCode('a'.charCodeAt(0) + (value - 0xd5));

  switch (value) {
    case 0xab: return '!';
    case 0xac: return '?';
    case 0xad: return '.';
    case 0xae: return '-';
    case 0xb1:
    case 0xb2:
      return '"';
    case 0xb3:
    case 0xb4:
      return '\'';
    case 0xb5: return '♂';
    case 0xb6: return '♀';
    case 0xb7: return '$';
    case 0xb8: return ',';
    case 0xba: return '/';
    case 0xf0: return ':';
    case 0xfe: return '\n';
    default:
      return '';
  }
}

function decodeGen3String(bytes: Uint8Array): string | null {
  let out = '';

  for (let index = 0; index < bytes.length; index++) {
    const value = bytes[index];
    if (value === 0xff) break;
    if (value === 0xfc) {
      index += 1;
      continue;
    }
    out += decodeGen3Char(value);
  }

  const trimmed = out.trim();
  if (!trimmed || trimmed === '??????????') return null;
  return trimmed;
}

function experienceForLevel(level: number, growthRate: EmeraldGrowthRate): number {
  switch (growthRate) {
    case 'fast':
      return Math.floor((4 * level * level * level) / 5);
    case 'medium-fast':
      return level * level * level;
    case 'medium-slow':
      return Math.floor((6 * level * level * level) / 5 - 15 * level * level + 100 * level - 140);
    case 'slow':
      return Math.floor((5 * level * level * level) / 4);
    case 'erratic':
      if (level <= 50) return Math.floor((level * level * level * (100 - level)) / 50);
      if (level <= 68) return Math.floor((level * level * level * (150 - level)) / 100);
      if (level <= 98) return Math.floor((level * level * level * Math.floor((1911 - 10 * level) / 3)) / 500);
      return Math.floor((level * level * level * (160 - level)) / 100);
    case 'fluctuating':
      if (level <= 15) return Math.floor((level * level * level * (Math.floor((level + 1) / 3) + 24)) / 50);
      if (level <= 36) return Math.floor((level * level * level * (level + 14)) / 50);
      return Math.floor((level * level * level * (Math.floor(level / 2) + 32)) / 50);
    default:
      return level * level * level;
  }
}

function levelFromExperience(exp: number, growthRate: EmeraldGrowthRate): number {
  for (let level = 100; level >= 1; level--) {
    if (exp >= experienceForLevel(level, growthRate)) {
      return level;
    }
  }
  return 1;
}

function decryptSecureData(bytes: Uint8Array, key: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const word = readU32(bytes, offset) ^ key;
    out[offset] = word & 0xff;
    out[offset + 1] = (word >>> 8) & 0xff;
    out[offset + 2] = (word >>> 16) & 0xff;
    out[offset + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

function parseStoredMon(bytes: Uint8Array, origin: 'party' | 'box', slotIndex: number, boxIndex?: number): ParsedEmeraldMon | null {
  if (bytes.length < BOX_MON_SIZE) return null;

  const personality = readU32(bytes, 0);
  const otId = readU32(bytes, 4);
  const flags = bytes[14] ?? 0;
  const hasSpecies = (flags & 0x02) !== 0;
  if (!hasSpecies) return null;

  const nickname = decodeGen3String(bytes.subarray(8, 8 + GEN3_NICKNAME_LENGTH));
  const encryptedData = bytes.subarray(32, 80);
  const secureData = decryptSecureData(encryptedData, personality ^ otId);
  const checksum = readU16(bytes, 28);
  if (calculateBoxMonChecksum(secureData) !== checksum) return null;

  const order = SUBSTRUCT_ORDERS[personality % 24];
  const substruct0 = secureData.subarray(order[0] * 12, order[0] * 12 + 12);
  const substruct1 = secureData.subarray(order[1] * 12, order[1] * 12 + 12);
  const substruct2 = secureData.subarray(order[2] * 12, order[2] * 12 + 12);
  const substruct3 = secureData.subarray(order[3] * 12, order[3] * 12 + 12);

  const speciesId = readU16(substruct0, 0);
  const speciesMeta = EMERALD_SPECIES_BY_ID[speciesId];
  if (!speciesId || !speciesMeta) return null;

  const heldItemId = readU16(substruct0, 2);
  const experience = readU32(substruct0, 4);
  const moveIds = [0, 2, 4, 6].map((offset) => readU16(substruct1, offset)).filter((moveId) => moveId > 0);
  const moveNames = moveIds.map((moveId) => EMERALD_MOVES_BY_ID[moveId]).filter((name): name is string => Boolean(name));
  const ivWord = readU32(substruct3, 4);
  const isEgg = ((ivWord >>> 30) & 0x1) === 1;
  if (isEgg) return null;

  const level = bytes.length >= PARTY_MON_SIZE && bytes[84] > 0
    ? bytes[84]
    : levelFromExperience(experience, speciesMeta.growthRate);

  const shinyValue = ((otId & 0xffff) ^ (otId >>> 16) ^ (personality & 0xffff) ^ (personality >>> 16)) & 0xffff;
  return {
    signature: `${personality.toString(16)}:${otId.toString(16)}:${speciesId}`,
    personality,
    otId,
    speciesId,
    speciesName: speciesMeta.name,
    nickname,
    level,
    shiny: shinyValue < 8,
    abilitySlot: ((ivWord >>> 31) & 0x1) as 0 | 1,
    heldItemId,
    moveIds,
    moveNames,
    ivs: {
      hp: ivWord & 0x1f,
      atk: (ivWord >>> 5) & 0x1f,
      def: (ivWord >>> 10) & 0x1f,
      spe: (ivWord >>> 15) & 0x1f,
      spa: (ivWord >>> 20) & 0x1f,
      spd: (ivWord >>> 25) & 0x1f,
    },
    evs: {
      hp: substruct2[0],
      atk: substruct2[1],
      def: substruct2[2],
      spe: substruct2[3],
      spa: substruct2[4],
      spd: substruct2[5],
    },
    origin,
    slotIndex,
    boxIndex,
  };
}

function parseSlot(bytes: Uint8Array, slotIndex: number): ParsedSlot | null {
  const sectors = new Map<number, ParsedSector>();

  for (let sectorIndex = 0; sectorIndex < NUM_SECTORS_PER_SLOT; sectorIndex++) {
    const physicalIndex = slotIndex * NUM_SECTORS_PER_SLOT + sectorIndex;
    const sectorBytes = bytes.subarray(physicalIndex * SECTOR_SIZE, (physicalIndex + 1) * SECTOR_SIZE);
    const parsed = validateSector(sectorBytes, physicalIndex);
    if (parsed) {
      sectors.set(parsed.id, parsed);
    }
  }

  const block2 = sectors.get(SAVEBLOCK2_ID);
  const block1 = sectors.get(SAVEBLOCK1_FIRST_ID);
  if (!block2 || !block1) return null;

  return {
    slot: slotIndex === 0 ? 1 : 2,
    counter: block2.counter,
    sectors,
  };
}

function rebuildPokemonStorage(slot: ParsedSlot): Uint8Array | null {
  const out = new Uint8Array(POKEMON_STORAGE_SIZE);

  for (let sectorId = POKEMON_STORAGE_FIRST_ID; sectorId <= POKEMON_STORAGE_LAST_ID; sectorId++) {
    const sector = slot.sectors.get(sectorId);
    if (!sector) return null;
    const offset = (sectorId - POKEMON_STORAGE_FIRST_ID) * SECTOR_DATA_SIZE;
    const length = Math.min(SECTOR_DATA_SIZE, out.length - offset);
    out.set(sector.data.subarray(0, length), offset);
  }

  return out;
}

export function parseEmeraldSave(saveBuffer: ArrayBuffer): ParsedEmeraldSave | null {
  const bytes = new Uint8Array(saveBuffer);
  if (bytes.length < SECTOR_SIZE * NUM_SECTORS_PER_SLOT * 2) return null;

  const parsedSlots = [parseSlot(bytes, 0), parseSlot(bytes, 1)].filter((slot): slot is ParsedSlot => Boolean(slot));
  if (!parsedSlots.length) return null;

  const chosen = parsedSlots.length === 1
    ? parsedSlots[0]
    : isSlot2Newer(parsedSlots[0].counter, parsedSlots[1].counter)
      ? parsedSlots[1]
      : parsedSlots[0];

  const block2 = chosen.sectors.get(SAVEBLOCK2_ID);
  const block1 = chosen.sectors.get(SAVEBLOCK1_FIRST_ID);
  if (!block2 || !block1) return null;

  const encryptionKey = readU32(block2.data, ENCRYPTION_KEY_OFFSET);
  const encryptedCoins = readU16(block1.data, COINS_OFFSET);
  const coins = (encryptedCoins ^ (encryptionKey & 0xffff)) & 0xffff;

  const partyCount = Math.min(MAX_PARTY_SIZE, block1.data[PARTY_COUNT_OFFSET] ?? 0);
  const party: ParsedEmeraldMon[] = [];
  for (let slotIndex = 0; slotIndex < partyCount; slotIndex++) {
    const offset = PARTY_OFFSET + (slotIndex * PARTY_MON_SIZE);
    const mon = parseStoredMon(block1.data.subarray(offset, offset + PARTY_MON_SIZE), 'party', slotIndex);
    if (mon) party.push(mon);
  }

  const storageBytes = rebuildPokemonStorage(chosen);
  const boxes: ParsedEmeraldMon[] = [];
  const currentBox = storageBytes?.[STORAGE_CURRENT_BOX_OFFSET] ?? 0;
  if (storageBytes) {
    for (let boxIndex = 0; boxIndex < TOTAL_BOXES; boxIndex++) {
      for (let slotIndex = 0; slotIndex < BOX_SIZE; slotIndex++) {
        const offset = STORAGE_BOXES_OFFSET + (((boxIndex * BOX_SIZE) + slotIndex) * BOX_MON_SIZE);
        const mon = parseStoredMon(storageBytes.subarray(offset, offset + BOX_MON_SIZE), 'box', slotIndex, boxIndex);
        if (mon) boxes.push(mon);
      }
    }
  }

  return {
    coins,
    slot: chosen.slot,
    counter: chosen.counter,
    currentBox,
    party,
    boxes,
  };
}

export function parseEmeraldCoins(saveBuffer: ArrayBuffer): ParsedEmeraldCoins | null {
  const parsed = parseEmeraldSave(saveBuffer);
  if (!parsed) return null;
  return {
    coins: parsed.coins,
    slot: parsed.slot,
    counter: parsed.counter,
  };
}

function alignRaStateBlockSize(size: number): number {
  return (size + 7) & ~7;
}

function hasRaStateHeader(bytes: Uint8Array): boolean {
  if (bytes.length < RASTATE_BLOCK_HEADER_SIZE) return false;
  return String.fromCharCode(...bytes.subarray(0, 7)) === RASTATE_HEADER;
}

function findRaStateMemBlock(bytes: Uint8Array): { dataOffset: number; size: number } | null {
  if (!hasRaStateHeader(bytes)) return null;

  let offset = RASTATE_BLOCK_HEADER_SIZE;
  while (offset + RASTATE_BLOCK_HEADER_SIZE <= bytes.length) {
    const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = readU32(bytes, offset + 4);
    const dataOffset = offset + RASTATE_BLOCK_HEADER_SIZE;
    if (tag === RASTATE_MEM_BLOCK) {
      if (dataOffset + size > bytes.length) return null;
      return { dataOffset, size };
    }
    if (tag === RASTATE_END_BLOCK) return null;
    offset = dataOffset + alignRaStateBlockSize(size);
  }

  return null;
}

function isMgbaGbaState(memBlockBytes: Uint8Array): boolean {
  if (memBlockBytes.length < MGBA_GBA_STATE_SIZE) return false;
  const magic = readU32(memBlockBytes, 0);
  return magic >= MGBA_GBA_STATE_MAGIC && magic <= (MGBA_GBA_STATE_MAGIC + MGBA_GBA_STATE_VERSION);
}

function findMgbaSavedataExtdata(memBlockBytes: Uint8Array): { offset: number; size: number } | null {
  if (!isMgbaGbaState(memBlockBytes)) return null;

  let headerOffset = MGBA_GBA_STATE_SIZE;
  while (headerOffset + MGBA_EXTDATA_HEADER_SIZE <= memBlockBytes.length) {
    const tag = readU32(memBlockBytes, headerOffset);
    const size = readU32(memBlockBytes, headerOffset + 4);
    const offset = readI64(memBlockBytes, headerOffset + 8);
    if (tag === 0) return null;
    if (tag === MGBA_EXTDATA_SAVEDATA) {
      if (offset < 0 || offset + size > memBlockBytes.length) return null;
      return { offset, size };
    }
    headerOffset += MGBA_EXTDATA_HEADER_SIZE;
  }

  return null;
}

function chooseLatestSlot(parsedSlots: ParsedSlot[]): ParsedSlot | null {
  if (!parsedSlots.length) return null;
  if (parsedSlots.length === 1) return parsedSlots[0];
  return isSlot2Newer(parsedSlots[0].counter, parsedSlots[1].counter)
    ? parsedSlots[1]
    : parsedSlots[0];
}

export function extractEmeraldSaveFromMgbaState(stateBuffer: ArrayBuffer): ArrayBuffer | null {
  const stateBytes = new Uint8Array(stateBuffer);
  const memBlock = findRaStateMemBlock(stateBytes);
  if (!memBlock) return null;

  const memBlockBytes = stateBytes.subarray(memBlock.dataOffset, memBlock.dataOffset + memBlock.size);
  const saveExtdata = findMgbaSavedataExtdata(memBlockBytes);
  if (!saveExtdata) return null;

  return memBlockBytes.slice(saveExtdata.offset, saveExtdata.offset + saveExtdata.size).buffer;
}

export function replaceEmeraldSaveInMgbaState(stateBuffer: ArrayBuffer, saveBuffer: ArrayBuffer): ArrayBuffer | null {
  const nextState = stateBuffer.slice(0);
  const stateBytes = new Uint8Array(nextState);
  const memBlock = findRaStateMemBlock(stateBytes);
  if (!memBlock) return null;

  const memBlockBytes = stateBytes.subarray(memBlock.dataOffset, memBlock.dataOffset + memBlock.size);
  const saveExtdata = findMgbaSavedataExtdata(memBlockBytes);
  if (!saveExtdata || saveExtdata.size !== saveBuffer.byteLength) return null;

  stateBytes.set(new Uint8Array(saveBuffer), memBlock.dataOffset + saveExtdata.offset);
  return nextState;
}

export function updateEmeraldSaveCoins(saveBuffer: ArrayBuffer, coins: number): ArrayBuffer | null {
  const nextSave = saveBuffer.slice(0);
  const saveBytes = new Uint8Array(nextSave);
  if (saveBytes.length < SECTOR_SIZE * NUM_SECTORS_PER_SLOT * 2) return null;

  const parsedSlots = [parseSlot(saveBytes, 0), parseSlot(saveBytes, 1)].filter((slot): slot is ParsedSlot => Boolean(slot));
  const chosen = chooseLatestSlot(parsedSlots);
  if (!chosen) return null;

  const block2 = chosen.sectors.get(SAVEBLOCK2_ID);
  const block1 = chosen.sectors.get(SAVEBLOCK1_FIRST_ID);
  if (!block2 || !block1) return null;

  const nextCoins = Math.max(0, Math.min(0xffff, Math.trunc(coins)));
  const encryptionKey = readU32(block2.data, ENCRYPTION_KEY_OFFSET);
  const encryptedCoins = (nextCoins ^ (encryptionKey & 0xffff)) & 0xffff;
  const sectorOffset = block1.physicalIndex * SECTOR_SIZE;
  const sectorBytes = saveBytes.subarray(sectorOffset, sectorOffset + SECTOR_SIZE);
  writeU16(sectorBytes, COINS_OFFSET, encryptedCoins);
  writeU16(
    sectorBytes,
    SECTOR_CHECKSUM_OFFSET,
    calculateChecksum(sectorBytes.subarray(0, expectedSectorSize(block1.id)), expectedSectorSize(block1.id)),
  );

  return nextSave;
}