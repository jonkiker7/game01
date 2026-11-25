import { defineConfig, type Plugin } from 'vite';

/** A version stamp for each build: the game checks it to know when a newer build is live. */
const BUILD = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // e.g. 202611251630

/** Writes version.json next to the game so the running game can check for updates. */
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
  },
});

// Relative base so the build works at any URL (e.g. GitHub Pages at /game01/).
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [versionFile()],
  build: {
    chunkSizeWarningLimit: 800, // three.js alone is ~550 kB
    rollupOptions: {
      // Two pages: the game, and the ship design gallery.
      input: { main: 'index.html', designs: 'designs.html' },
    },
  },
});
