import './diffusion-view.css';
import { RIDGE_MODES, diffusionRidge } from './diffusion-ridge.js';
import { bgAnimOffFor } from './bg-animations.js';

// Diffusion: where Fairy will make images and videos. For now a placeholder in the chat's place, as Research and the
// notebooks take it: what each kind will do, the prompt box it will have (not yet working), and an empty gallery.
// Nothing here calls a model or reaches another machine.
export const DIFFUSION_KINDS = Object.freeze([
  Object.freeze({ id: 'image', name: 'Image', line: 'Pictures from a description, or a new take on one you give her: a size, a style, a few at once.', icon: 'M4 5h16v14H4zM4 15l4.5-4.5 3.5 3.5 2.5-2.5L20 17M15.5 9.5a1.5 1.5 0 1 0 0-.01' }),
  Object.freeze({ id: 'video', name: 'Video', line: 'Short clips from a description or from a still, played here and kept with the pictures.', icon: 'M4 6h12v12H4zM16 10l4-2.5v9L16 14' }),
]);

const TERRAIN_KEY = 'fairy-diffusion-terrain';
const el = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path); svg.append(p);
  return svg;
}

export function diffusionView({ root, sidebarButton, onShow = () => {}, onHide = () => {} }) {
  let shown = false, kind = 'image';
  // Terrain flown over slowly behind everything (src/diffusion-ridge.js); the body scrolls over it. Its view (one of
  // four) and whether slope ribs are drawn are chosen in a small pill at the bottom and remembered in this window.
  const canvas = el('canvas', 'dv-topo'); canvas.setAttribute('aria-hidden', 'true');
  const body = el('div', 'dv-body');
  const terrain = el('div', 'dv-terrain'); terrain.setAttribute('role', 'group'); terrain.setAttribute('aria-label', 'Background');
  root.replaceChildren(canvas, body, terrain);
  const saved = (() => { try { return JSON.parse(localStorage.getItem(TERRAIN_KEY) || '{}') || {}; } catch { return {}; } })();
  const topo = diffusionRidge(canvas, { mode: saved.mode, ribs: saved.ribs !== false }); // on the GPU at 30 a second, or the canvas at 12
  const remember = () => { try { localStorage.setItem(TERRAIN_KEY, JSON.stringify({ mode: topo.mode(), ribs: topo.ribs() })); } catch {} };
  function renderTerrain() {
    const views = el('div', 'dv-terrain-views');
    for (const mode of RIDGE_MODES) {
      const button = el('button', 'dv-terrain-view', mode.name); button.type = 'button';
      button.setAttribute('aria-pressed', String(topo.mode() === mode.id));
      button.onclick = () => { topo.setMode(mode.id); remember(); renderTerrain(); };
      views.append(button);
    }
    const ribs = el('button', 'dv-terrain-ribs', `Slope ribs: ${topo.ribs() ? 'On' : 'Off'}`); ribs.type = 'button';
    ribs.setAttribute('aria-pressed', String(topo.ribs()));
    ribs.onclick = () => { topo.setRibs(!topo.ribs()); remember(); renderTerrain(); };
    terrain.replaceChildren(views, ribs);
  }
  renderTerrain();

  function render() {
    const head = el('header', 'dv-head');
    const title = el('div', 'dv-title');
    title.append(el('h1', '', 'Diffusion'), el('span', 'dv-soon', 'Coming soon'));
    head.append(title, el('p', 'dv-lede', 'Images and videos, made for you. This is where they’ll be made, kept and looked through; making them isn’t built yet.'));

    const kinds = el('div', 'dv-kinds');
    for (const k of DIFFUSION_KINDS) {
      const card = el('article', `dv-kind${k.id === kind ? ' on' : ''}`);
      const mark = el('span', 'dv-kind-mark'); mark.append(icon(k.icon));
      const text = el('div', 'dv-kind-text'); text.append(el('h2', '', k.name), el('p', '', k.line));
      card.append(mark, text);
      kinds.append(card);
    }

    // The prompt box it will have: the kind chips work, sending doesn't yet.
    const form = el('form', 'dv-ask'); form.onsubmit = event => event.preventDefault();
    const input = el('textarea'); input.rows = 2; input.disabled = true;
    input.placeholder = kind === 'video' ? 'Describe a short video… (not yet)' : 'Describe an image… (not yet)';
    input.setAttribute('aria-label', 'Describe what to make (not available yet)');
    const row = el('div', 'dv-ask-row');
    const chips = el('div', 'dv-chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'What to make');
    for (const k of DIFFUSION_KINDS) {
      const chip = el('button', `dv-chip${k.id === kind ? ' on' : ''}`, k.name); chip.type = 'button';
      chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(k.id === kind));
      chip.onclick = () => { kind = k.id; render(); };
      chips.append(chip);
    }
    const go = el('button', 'dv-go', 'Make'); go.type = 'submit'; go.disabled = true; go.title = 'Making images and videos isn’t built yet';
    row.append(chips, go);
    form.append(input, row);

    const gallery = el('section', 'dv-gallery'); gallery.setAttribute('aria-label', 'Gallery');
    const galleryHead = el('div', 'dv-gallery-head'); galleryHead.append(el('h2', '', 'Gallery'), el('span', 'dv-faint', 'Nothing made yet'));
    const grid = el('div', 'dv-grid'); grid.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 8; i++) { const tile = el('div', `dv-tile${i % 3 === 1 ? ' tall' : ''}`); tile.style.setProperty('--i', String(i)); grid.append(tile); }
    gallery.append(galleryHead, grid);

    body.replaceChildren(head, kinds, form, gallery);
  }

  function syncTopo() {
    const off = bgAnimOffFor('diffusion');
    root.classList.toggle('dv-bg-off', off);
    terrain.hidden = off;
    if (shown && !off) topo.start();
    else topo.stop();
  }
  window.addEventListener('fairy:bg-anim-change', syncTopo);

  function setShown(value) {
    if (shown === value) return;
    shown = value;
    root.hidden = !value;
    syncTopo();
    document.documentElement.classList.toggle('diffusion-open', value);
    sidebarButton?.classList.toggle('current', value);
    sidebarButton?.setAttribute('aria-pressed', String(value));
    (value ? onShow : onHide)();
  }

  return {
    show() { render(); setShown(true); },
    hide() { setShown(false); },
    toggle() { if (shown) this.hide(); else this.show(); },
    shown: () => shown,
  };
}
