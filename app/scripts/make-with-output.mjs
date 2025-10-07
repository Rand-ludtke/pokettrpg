import { spawn } from 'node:child_process';

// Read desired output directory from BUILD_OUTPUT_DIR env var; default to 'release'
const out = process.env.BUILD_OUTPUT_DIR && process.env.BUILD_OUTPUT_DIR.trim()
  ? process.env.BUILD_OUTPUT_DIR.trim()
  : 'release';
process.env.ELECTRON_BUILDER_OUT_DIR = out;

const args = ['-w'];

console.log(`[make-with-output] ELECTRON_BUILDER_OUT_DIR=${process.env.ELECTRON_BUILDER_OUT_DIR}`);

const child = spawn(process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder', args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
