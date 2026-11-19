import { defineConfig } from 'vite';

// base: './' — относительные пути, чтобы игра работала по адресу
// https://klim-mertens.github.io/Gnomski-Dom/ (подпапка GitHub Pages)
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
