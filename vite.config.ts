import { defineConfig, type Plugin } from 'vite';
import { resolveEdition } from './desktop/edition.mts';

const isCore = resolveEdition().isCore;
const STUB_VIEWS: Record<string, string> = {
  './notebook-view.js': 'virtual:baryon-core-stub-notebook',
  './research-view.js': 'virtual:baryon-core-stub-research',
  './analytics-view.js': 'virtual:baryon-core-stub-analytics',
  './academy-view.js': 'virtual:baryon-core-stub-academy',
  './studio-view.js': 'virtual:baryon-core-stub-studio',
  './diffusion-view.js': 'virtual:baryon-core-stub-diffusion',
  './worlds-view.js': 'virtual:baryon-core-stub-worlds',
  './game-view.js': 'virtual:baryon-core-stub-game',
};

function baryonEditionGate(): Plugin {
  return {
    name: 'baryon-edition-gate',
    resolveId(source: string) {
      if (!isCore) return null;
      const normalized = source.replace(/\.(?:[cm]?js|tsx?)$/, '.js');
      if (STUB_VIEWS[source]) return STUB_VIEWS[source];
      if (STUB_VIEWS[normalized]) return STUB_VIEWS[normalized];
      return null;
    },
    load(id: string) {
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
