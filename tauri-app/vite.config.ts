import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { rmSync, existsSync, mkdirSync, cpSync, readdirSync, writeFileSync } from 'node:fs';

// Tauri expects a fixed port, fail if that port is not available
export default defineConfig(({ mode }) => {
  const isTauri = !!process.env.TAURI_PLATFORM || mode === 'tauri';

  return {
    root: '.',
    base: process.env.VITE_PUBLIC_BASE || './',
    publicDir: 'public',
    plugins: [
      react(),
      {
        name: 'prune-ps-from-dist',
        closeBundle() {
          // Ensure /public/vendor/showdown is copied by Vite; remove any accidental /showdown root artifact
          const distPs = path.resolve(__dirname, 'dist', 'showdown');
          if (existsSync(distPs)) {
            try { rmSync(distPs, { recursive: true, force: true }); } catch {}
          }
          // Ensure animated sprite folders are present in the build output
          try {
            const srcRoot = path.resolve(__dirname, '../pokemon-showdown-client/play.pokemonshowdown.com/sprites');
            const dstRoot = path.resolve(__dirname, 'dist', 'vendor', 'showdown', 'sprites');
            const ensureDir = (p: string) => { try { mkdirSync(p, { recursive: true }); } catch {} };
            ensureDir(dstRoot);
            const folders = ['ani', 'ani-shiny', 'ani-back', 'ani-back-shiny'];
            for (const f of folders) {
              const src = path.resolve(srcRoot, f);
              const dst = path.resolve(dstRoot, f);
              if (existsSync(src) && !existsSync(dst)) {
                try { cpSync(src, dst, { recursive: true }); } catch {}
              }
            }
          } catch {}
          // Generate trainer sprite manifest for static builds (can't list directories)
          try {
            const publicTrainersDir = path.resolve(__dirname, 'public', 'vendor', 'showdown', 'sprites', 'trainers');
            const distTrainersDir = path.resolve(__dirname, 'dist', 'vendor', 'showdown', 'sprites', 'trainers');
            const listDir = existsSync(distTrainersDir) ? distTrainersDir : publicTrainersDir;
            if (existsSync(listDir)) {
              const files = readdirSync(listDir)
                .filter(name => name.toLowerCase().endsWith('.png'))
                .map(name => name.replace(/\.png$/i, ''))
                .sort();
              const manifestPath = path.resolve(__dirname, 'dist', 'vendor', 'showdown', 'sprites', 'trainers.json');
              try { mkdirSync(path.dirname(manifestPath), { recursive: true }); } catch {}
              writeFileSync(manifestPath, JSON.stringify(files, null, 2));
            }
          } catch {}
          // Mirror vendor/showdown assets into dist/assets for PWA hosting only
          // Skip for Tauri desktop builds to avoid doubling the dist size (~650MB)
          if (!isTauri) {
            try {
              const srcVendor = path.resolve(__dirname, 'public', 'vendor', 'showdown');
              const dstVendor = path.resolve(__dirname, 'dist', 'assets', 'vendor', 'showdown');
              if (existsSync(srcVendor)) {
                try { mkdirSync(dstVendor, { recursive: true }); } catch {}
                try { cpSync(srcVendor, dstVendor, { recursive: true }); } catch {}
              }
              const srcCustomSprites = path.resolve(__dirname, 'public', 'assets', 'custom-sprites');
              const dstCustomSprites = path.resolve(__dirname, 'dist', 'assets', 'custom-sprites');
              if (existsSync(srcCustomSprites)) {
                try { mkdirSync(dstCustomSprites, { recursive: true }); } catch {}
                try { cpSync(srcCustomSprites, dstCustomSprites, { recursive: true }); } catch {}
              }
              const srcCustomItems = path.resolve(__dirname, 'public', 'assets', 'custom-items');
              const dstCustomItems = path.resolve(__dirname, 'dist', 'assets', 'custom-items');
              if (existsSync(srcCustomItems)) {
                try { mkdirSync(dstCustomItems, { recursive: true }); } catch {}
                try { cpSync(srcCustomItems, dstCustomItems, { recursive: true }); } catch {}
              }
            } catch {}
          }
        }
      }
    ],
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Env variables starting with TAURI_ and VITE_ are exposed to tauri's source code through `import.meta.env`.
  envPrefix: ['VITE_', 'TAURI_'],
    build: {
      // Tauri uses Chromium on Windows and WebKit on macOS and Linux
      target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      // don't minify for debug builds
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      // produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_DEBUG,
    },
  };
});
