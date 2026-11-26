import { defineConfig } from 'vite';

const isCore = process.env.BARYON_EDITION === 'core';
const STUB_VIEWS = {
  './notebook-view.js': 'virtual:baryon-core-stub-notebook',
  './research-view.js': 'virtual:baryon-core-stub-research',
  './analytics-view.js': 'virtual:baryon-core-stub-analytics',
  './academy-view.js': 'virtual:baryon-core-stub-academy',
  './studio-view.js': 'virtual:baryon-core-stub-studio',
  './diffusion-view.js': 'virtual:baryon-core-stub-diffusion',
  './worlds-view.js': 'virtual:baryon-core-stub-worlds',
  './game-view.js': 'virtual:baryon-core-stub-game',
};

function baryonEditionGate() {
  return {
    name: 'baryon-edition-gate',
    resolveId(source) {
      if (isCore && STUB_VIEWS[source]) return STUB_VIEWS[source];
      return null;
    },
    load(id) {
      if (id === 'virtual:baryon-core-stub-notebook') return 'export function notebookView() { return null; }';
      if (id === 'virtual:baryon-core-stub-research') return 'export function researchView() { return null; }';
      if (id === 'virtual:baryon-core-stub-analytics') return 'export function analyticsView() { return null; }';
      if (id === 'virtual:baryon-core-stub-academy') return 'export function academyView() { return null; }';
      if (id === 'virtual:baryon-core-stub-studio') return 'export function studioView() { return null; }';
      if (id === 'virtual:baryon-core-stub-diffusion') return 'export function diffusionView() { return null; }';
      if (id === 'virtual:baryon-core-stub-worlds') return 'export function worldsView() { return null; }';
      if (id === 'virtual:baryon-core-stub-game') return 'export function gameView() { return null; }';
      return null;
    },
  };
}

export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
  define: {
    __BARYON_EDITION__: JSON.stringify(isCore ? 'core' : 'pro'),
    __BARYON_FEATURES__: JSON.stringify({
      research: !isCore,
      reproduce: !isCore,
      analytics: !isCore,
      academy: !isCore,
      notebooks: !isCore,
      studio: !isCore,
      worlds: !isCore,
      game: !isCore,
    }),
  },
  plugins: [baryonEditionGate()],
  build: { chunkSizeWarningLimit: 900, rollupOptions: { input: { main: 'index.html', companion: 'companion.html', chats: 'chats.html', ink: 'ink.html', quickask: 'quickask.html' } } },
});
