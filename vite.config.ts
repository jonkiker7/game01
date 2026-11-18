import { defineConfig } from 'vite';

// Relative base so the build works at any URL (e.g. GitHub Pages at /game01/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~550 kB
});
