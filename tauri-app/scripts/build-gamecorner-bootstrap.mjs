import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const RASTATE_HEADER = 'RASTATE';
const RASTATE_MEM_BLOCK = 'MEM ';
const RASTATE_END_BLOCK = 'END ';
const RASTATE_BLOCK_HEADER_SIZE = 8;
const MGBA_GBA_STATE_SIZE = 0x61000;
const MGBA_GBA_STATE_MAGIC = 0x01000000;
const MGBA_GBA_STATE_VERSION = 0x0000000a;
const MGBA_EXTDATA_HEADER_SIZE = 16;
const MGBA_EXTDATA_SAVEDATA = 2;

function parseArgs(argv) {
  const args = {
    out: 'public/gamecorner-bootstrap.json',
    description: 'Bundled Game Corner bootstrap',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--save' && next) {
      args.save = next;
      index += 1;
      continue;
    }

    if (token === '--state' && next) {
      args.state = next;
      index += 1;
      continue;
    }

    if (token === '--out' && next) {
      args.out = next;
      index += 1;
      continue;
    }

    if (token === '--description' && next) {
      args.description = next;
      index += 1;
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${token}`);
  }

  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/build-gamecorner-bootstrap.mjs [--save <path>] [--state <path>] [--out <path>] [--description <text>]',
    '',
    'Examples:',
    '  node scripts/build-gamecorner-bootstrap.mjs --save .\\session.sav',
    '  node scripts/build-gamecorner-bootstrap.mjs --save .\\session.sav --state .\\session.state',
    '  node scripts/build-gamecorner-bootstrap.mjs --state .\\session.state',
  ].join('\n'));
}

function readBinary(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  return {
    filePath: resolvedPath,
    bytes: fs.readFileSync(resolvedPath),
  };
}

function isUniformBuffer(buffer, value) {
  for (const byte of buffer) {
    if (byte !== value) return false;
  }
  return buffer.length > 0;
}

function assertMeaningfulBuffer(label, buffer) {
  if (!buffer.length) {
    throw new Error(`${label} is empty.`);
  }
  if (isUniformBuffer(buffer, 0xff)) {
    throw new Error(`${label} is all 0xFF and is not usable.`);
  }
  if (isUniformBuffer(buffer, 0x00)) {
    throw new Error(`${label} is all 0x00 and is not usable.`);
  }
}

function readU32(bytes, offset) {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readI64(bytes, offset) {
  const low = readU32(bytes, offset);
  const high = readU32(bytes, offset + 4);
  return low + (high * 0x1_0000_0000);
}

function alignRaStateBlockSize(size) {
  return (size + 7) & ~7;
}

function hasRaStateHeader(bytes) {
  if (bytes.length < RASTATE_BLOCK_HEADER_SIZE) return false;
  return String.fromCharCode(...bytes.subarray(0, 7)) === RASTATE_HEADER;
}

function findRaStateMemBlock(bytes) {
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

function isMgbaGbaState(memBlockBytes) {
  if (memBlockBytes.length < MGBA_GBA_STATE_SIZE) return false;
  const magic = readU32(memBlockBytes, 0);
  return magic >= MGBA_GBA_STATE_MAGIC && magic <= (MGBA_GBA_STATE_MAGIC + MGBA_GBA_STATE_VERSION);
}

function findMgbaSavedataExtdata(memBlockBytes) {
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

function extractEmeraldSaveFromMgbaState(stateBytes) {
  const memBlock = findRaStateMemBlock(stateBytes);
  if (!memBlock) return null;

  const memBlockBytes = stateBytes.subarray(memBlock.dataOffset, memBlock.dataOffset + memBlock.size);
  const saveExtdata = findMgbaSavedataExtdata(memBlockBytes);
  if (!saveExtdata) return null;

  return Buffer.from(memBlockBytes.subarray(saveExtdata.offset, saveExtdata.offset + saveExtdata.size));
}

function toGzipBase64(buffer) {
  return gzipSync(buffer, { level: 9 }).toString('base64');
}

function writeBootstrap(outPath, payload) {
  const resolvedOutPath = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return resolvedOutPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.save && !args.state) {
    throw new Error('A --save or --state file is required.');
  }

  let state = null;
  if (args.state) {
    state = readBinary(args.state);
    assertMeaningfulBuffer('State file', state.bytes);
  }

  let save = null;
  if (args.save) {
    save = readBinary(args.save);
  } else if (state) {
    const extractedSave = extractEmeraldSaveFromMgbaState(state.bytes);
    if (!extractedSave) {
      throw new Error(`Could not extract an Emerald save from state file: ${state.filePath}`);
    }
    save = {
      filePath: `${state.filePath}#extracted-save`,
      bytes: extractedSave,
    };
  }

  assertMeaningfulBuffer('Save file', save.bytes);

  const payload = {
    version: 1,
    description: args.description,
    saveGzipBase64: toGzipBase64(save.bytes),
    stateGzipBase64: state ? toGzipBase64(state.bytes) : null,
  };

  const writtenPath = writeBootstrap(args.out, payload);

  console.log(JSON.stringify({
    out: writtenPath,
    savePath: save.filePath,
    saveBytes: save.bytes.length,
    saveDerivedFromState: !args.save,
    statePath: state?.filePath ?? null,
    stateBytes: state?.bytes.length ?? 0,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}