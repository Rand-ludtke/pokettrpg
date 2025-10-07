import { defineConfig } from 'vite';
import path from 'node:path';
import serveStatic from 'serve-static';
import { rmSync, existsSync } from 'node:fs';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    open: false,
    fs: {
      // allow serving files from the monorepo root and the showdown client folder
      allow: [
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../pokemon-showdown-client'),
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [{
    name: 'mount-showdown-static',
    configureServer(server) {
      const distShowdown = path.resolve(__dirname, 'dist', 'vendor', 'showdown');
      const publicShowdown = path.resolve(__dirname, 'public', 'vendor', 'showdown');
      let showdownRoot = publicShowdown;
      if (!existsSync(showdownRoot)) {
        showdownRoot = existsSync(distShowdown)
          ? distShowdown
          : path.resolve(__dirname, '../pokemon-showdown-client/play.pokemonshowdown.com');
      }
      const staticHandler = (serveStatic as any)(showdownRoot);
      server.middlewares.use('/showdown', (req, res, next) => staticHandler(req, res, next));
    },
  }, {
    name: 'prune-ps-from-dist',
    closeBundle() {
      // Ensure /public/vendor/showdown is copied by Vite; remove any accidental /showdown root artifact
      const distPs = path.resolve(__dirname, 'dist', 'showdown');
      if (existsSync(distPs)) {
        try { rmSync(distPs, { recursive: true, force: true }); } catch {}
      }
    }
  }],
});
