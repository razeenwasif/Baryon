// Offline bundled Ketcher-compatible 2D chemical structure editor.
// Runs inside fairy-artifact://viewer/ketcher/index.html with strict zero-network CSP.
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BOND_LEN = 1.5;
  const SCALE_BASE = 34;

  const ATOM_COLORS = {
    C: '#ececef', H: '#d8dae4', N: '#60a5fa', O: '#f87171', S: '#fbbf24',
    P: '#fb923c', F: '#4ade80', Cl: '#2dd4bf', Br: '#c084fc', I: '#a78bfa',
  };
  const ATOM_WEIGHTS = {
    H: 1.008, C: 12.011, N: 14.007, O: 15.999, F: 18.998, P: 30.974,
    S: 32.06, Cl: 35.45, Br: 79.904, I: 126.904, B: 10.81, Si: 28.085,
  };
  const VALENCE = { C: 4, N: 3, O: 2, S: 2, P: 3, F: 1, Cl: 1, Br: 1, I: 1, H: 1 };

  const TOOLS = [
    ['select', '⌖', 'Select / drag atom (V)'],
    ['erase', '⌫', 'Erase atom or bond (E)'],
    ['bond1', '╱', 'Single bond (1)'],
    ['bond2', '═', 'Double bond (2)'],
    ['bond3', '≡', 'Triple bond (3)'],
    ['chain', '∿', 'Extend carbon chain'],
    ['plus', 'A⁺', 'Increase formal charge'],
    ['minus', 'A⁻', 'Decrease formal charge'],
  ];

  const RINGS = [
    ['benzene', '⬡', 'Benzene ring (6, aromatic)'],
    ['cyclohexane', '⬢', 'Cyclohexane ring (6)'],
    ['cyclopentane', '⬠', 'Cyclopentane ring (5)'],
    ['cyclobutane', '□', 'Cyclobutane ring (4)'],
    ['cyclopropane', '△', 'Cyclopropane ring (3)'],
    ['naphthalene', '⬡⬡', 'Naphthalene bicycle'],
    ['pyridine', '⬡N', 'Pyridine ring'],
  ];

  const ELEMENTS = ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'H'];

  function makeBenzeneSeed(name, hetero = {}, extraSubst = 'F') {
    const atoms = [];
    const bonds = [];
    for (let i = 0; i < 6; i++) {
      const a = ((30 + i * 60) * Math.PI) / 180;
      atoms.push({ label: hetero[i] || 'C', x: Number((Math.cos(a) * BOND_LEN).toFixed(3)), y: Number((Math.sin(a) * BOND_LEN).toFixed(3)), charge: 0 });
      bonds.push({ begin: i, end: (i + 1) % 6, type: i % 2 === 0 ? 2 : 1 });
    }
    // Fused second ring
    const dx = Math.sqrt(3) * BOND_LEN;
    const base = atoms.length;
    const pts2 = [
      [dx + Math.cos((30 * Math.PI) / 180) * BOND_LEN, Math.sin((30 * Math.PI) / 180) * BOND_LEN],
      [dx + Math.cos((90 * Math.PI) / 180) * BOND_LEN, Math.sin((90 * Math.PI) / 180) * BOND_LEN],
      [dx + Math.cos((270 * Math.PI) / 180) * BOND_LEN, Math.sin((270 * Math.PI) / 180) * BOND_LEN],
      [dx + Math.cos((330 * Math.PI) / 180) * BOND_LEN, Math.sin((330 * Math.PI) / 180) * BOND_LEN],
    ];
    atoms.push(
      { label: 'C', x: Number(pts2[0][0].toFixed(3)), y: Number(pts2[0][1].toFixed(3)), charge: 0 },
      { label: 'N', x: Number(pts2[1][0].toFixed(3)), y: Number(pts2[1][1].toFixed(3)), charge: 0 },
      { label: 'C', x: Number(pts2[2][0].toFixed(3)), y: Number(pts2[2][1].toFixed(3)), charge: 0 },
      { label: 'C', x: Number(pts2[3][0].toFixed(3)), y: Number(pts2[3][1].toFixed(3)), charge: 0 },
      { label: extraSubst, x: Number((pts2[0][0] + BOND_LEN * 0.9).toFixed(3)), y: Number((pts2[0][1] + BOND_LEN * 0.45).toFixed(3)), charge: 0 },
      { label: 'O', x: Number((atoms[3].x - BOND_LEN * 0.9).toFixed(3)), y: Number((atoms[3].y - BOND_LEN * 0.5).toFixed(3)), charge: 0 }
    );
    bonds.push(
      { begin: 0, end: base + 1, type: 1 },
      { begin: base + 1, end: base, type: 2 },
      { begin: base, end: base + 3, type: 1 },
      { begin: base + 3, end: base + 2, type: 2 },
      { begin: base + 2, end: 5, type: 1 },
      { begin: base, end: base + 4, type: 1 },
      { begin: 3, end: base + 5, type: 2 }
    );
    return { name, ic50: '', smiles: '', atoms, bonds };
  }

  const state = {
    filename: 'kras_inhibitors.ket',
    format: 'ket',
    molecules: [
      { ...makeBenzeneSeed('Sotorasib', { 1: 'N', 5: 'N' }, 'F'), ic50: 'IC50 68 nM · KRAS G12C' },
      { ...makeBenzeneSeed('Adagrasib', { 1: 'N', 4: 'N' }, 'Cl'), ic50: 'IC50 5 nM · KRAS G12C' },
      { ...makeBenzeneSeed('Divarasib', { 2: 'N', 5: 'N' }, 'F'), ic50: 'IC50 2 nM · KRAS G12C' },
    ],
    selected: 0,
    tool: 'bond1',
    element: 'C',
    ring: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: false,
    undoStack: [],
    redoStack: [],
    hoverAtom: -1,
    hoverBond: -1,
    drag: null,
  };

  const deckEl = document.getElementById('kt-deck');
  const toolsEl = document.getElementById('kt-tools');
  const atomsEl = document.getElementById('kt-atoms');
  const ringsEl = document.getElementById('kt-rings');
  const svgEl = document.getElementById('kt-svg');
  const hudEl = document.getElementById('kt-hud');
  const statusEl = document.getElementById('kt-status');

  const svgNode = (tag, attrs = {}, text = null) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text != null) n.textContent = String(text);
    return n;
  };

  const currentMol = () => state.molecules[state.selected] || state.molecules[0];

  function cloneMol(m) {
    return {
      ...m,
      atoms: (m.atoms || []).map(a => ({ ...a })),
      bonds: (m.bonds || []).map(b => ({ ...b })),
    };
  }

  function pushUndo() {
    state.undoStack.push({ selected: state.selected, mol: cloneMol(currentMol()) });
    if (state.undoStack.length > 60) state.undoStack.shift();
    state.redoStack.length = 0;
    state.dirty = true;
  }

  function computeSummary(mol) {
    const counts = {};
    const bondOrderSum = new Array(mol.atoms.length).fill(0);
    for (const b of mol.bonds) {
      const ord = b.type === 4 ? 1.5 : b.type;
      bondOrderSum[b.begin] += ord;
      bondOrderSum[b.end] += ord;
    }
    let mw = 0;
    mol.atoms.forEach((a, idx) => {
      counts[a.label] = (counts[a.label] || 0) + 1;
      mw += ATOM_WEIGHTS[a.label] || 12.011;
      if (a.label !== 'H') {
        const val = VALENCE[a.label] || 0;
        const impH = Math.max(0, Math.round(val + (a.charge || 0) - bondOrderSum[idx]));
        if (impH > 0) {
          counts.H = (counts.H || 0) + impH;
          mw += impH * ATOM_WEIGHTS.H;
        }
      }
    });
    const order = ['C', 'H', ...Object.keys(counts).filter(k => k !== 'C' && k !== 'H').sort()];
    const formula = order.filter(k => counts[k]).map(k => `${k}${counts[k] > 1 ? counts[k] : ''}`).join('');
    return {
      name: mol.name || 'Molecule',
      formula: formula || 'Empty',
      mw: Number(mw.toFixed(2)),
      atomCount: mol.atoms.length,
      bondCount: mol.bonds.length,
    };
  }

  function notifyChanged() {
    const summary = computeSummary(currentMol());
    try {
      window.parent?.postMessage({
        type: 'ketcher:changed',
        dirty: state.dirty,
        selected: state.selected,
        ...summary,
      }, '*');
    } catch {}
  }

  function fitView() {
    const mol = currentMol();
    const rect = svgEl.getBoundingClientRect();
    const w = rect.width || 600, h = rect.height || 360;
    if (!mol?.atoms?.length) {
      state.panX = w / 2;
      state.panY = h / 2;
      state.zoom = 1;
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const a of mol.atoms) {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(3, (maxX - minX) + 2.6);
    const spanY = Math.max(3, (maxY - minY) + 2.6);
    const scaleX = (w * 0.78) / (spanX * SCALE_BASE);
    const scaleY = (h * 0.76) / (spanY * SCALE_BASE);
    state.zoom = Math.max(0.35, Math.min(2.2, Math.min(scaleX, scaleY)));
    state.panX = w / 2 - cx * SCALE_BASE * state.zoom;
    state.panY = h / 2 + cy * SCALE_BASE * state.zoom;
  }

  const worldToScreen = (x, y) => [
    state.panX + x * SCALE_BASE * state.zoom,
    state.panY - y * SCALE_BASE * state.zoom,
  ];
  const screenToWorld = (sx, sy) => [
    (sx - state.panX) / (SCALE_BASE * state.zoom),
    -(sy - state.panY) / (SCALE_BASE * state.zoom),
  ];

  function findHitAtom(sx, sy, radius = 15) {
    const mol = currentMol();
    let best = -1, bestD = radius;
    mol.atoms.forEach((a, idx) => {
      const [ax, ay] = worldToScreen(a.x, a.y);
      const d = Math.hypot(sx - ax, sy - ay);
      if (d < bestD) { bestD = d; best = idx; }
    });
    return best;
  }

  function findHitBond(sx, sy, tol = 9) {
    const mol = currentMol();
    let best = -1, bestD = tol;
    mol.bonds.forEach((b, idx) => {
      const a1 = mol.atoms[b.begin], a2 = mol.atoms[b.end];
      if (!a1 || !a2) return;
      const [x1, y1] = worldToScreen(a1.x, a1.y);
      const [x2, y2] = worldToScreen(a2.x, a2.y);
      const dx = x2 - x1, dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      if (l2 < 1) return;
      const t = Math.max(0.08, Math.min(0.92, ((sx - x1) * dx + (sy - y1) * dy) / l2));
      const d = Math.hypot(sx - (x1 + t * dx), sy - (y1 + t * dy));
      if (d < bestD) { bestD = d; best = idx; }
    });
    return best;
  }

  function addOrCycleBond(mol, a, b, defaultType) {
    if (a === b) return;
    const existing = mol.bonds.find(x => (x.begin === a && x.end === b) || (x.begin === b && x.end === a));
    if (existing) {
      existing.type = existing.type === defaultType ? ((existing.type % 3) + 1) : defaultType;
    } else {
      mol.bonds.push({ begin: a, end: b, type: defaultType });
    }
  }

  function stampRing(kind, wx, wy) {
    const mol = currentMol();
    pushUndo();
    const spec = {
      benzene: { sides: 6, aromatic: true, hetero: {} },
      cyclohexane: { sides: 6, aromatic: false, hetero: {} },
      cyclopentane: { sides: 5, aromatic: false, hetero: {} },
      cyclobutane: { sides: 4, aromatic: false, hetero: {} },
      cyclopropane: { sides: 3, aromatic: false, hetero: {} },
      pyridine: { sides: 6, aromatic: true, hetero: { 0: 'N' } },
      naphthalene: { sides: 6, aromatic: true, hetero: {}, fused: true },
    }[kind] || { sides: 6, aromatic: true, hetero: {} };

    const r = BOND_LEN / (2 * Math.sin(Math.PI / spec.sides));
    const startIdx = mol.atoms.length;
    for (let i = 0; i < spec.sides; i++) {
      const ang = ((30 + i * (360 / spec.sides)) * Math.PI) / 180;
      mol.atoms.push({
        label: spec.hetero[i] || 'C',
        x: Number((wx + r * Math.cos(ang)).toFixed(3)),
        y: Number((wy + r * Math.sin(ang)).toFixed(3)),
        charge: 0,
      });
    }
    for (let i = 0; i < spec.sides; i++) {
      mol.bonds.push({ begin: startIdx + i, end: startIdx + ((i + 1) % spec.sides), type: spec.aromatic && i % 2 === 0 ? 2 : 1 });
    }
    if (spec.fused) {
      const dx = Math.sqrt(3) * r;
      const b2 = mol.atoms.length;
      const extraAngles = [30, 90, 270, 330];
      for (const deg of extraAngles) {
        const ang = (deg * Math.PI) / 180;
        mol.atoms.push({ label: 'C', x: Number((wx + dx + r * Math.cos(ang)).toFixed(3)), y: Number((wy + r * Math.sin(ang)).toFixed(3)), charge: 0 });
      }
      mol.bonds.push(
        { begin: startIdx + 0, end: b2 + 1, type: 1 },
        { begin: b2 + 1, end: b2 + 0, type: 2 },
        { begin: b2 + 0, end: b2 + 3, type: 1 },
        { begin: b2 + 3, end: b2 + 2, type: 2 },
        { begin: b2 + 2, end: startIdx + 5, type: 1 }
      );
    }
    render();
    notifyChanged();
  }

  function serializeKetcher() {
    const out = { root: { nodes: [] }, meta: { names: [] } };
    state.molecules.forEach((m, idx) => {
      const key = `mol${idx}`;
      out.root.nodes.push({ $ref: key });
      out.meta.names.push(m.name || `Molecule ${idx + 1}`);
      out[key] = {
        type: 'molecule',
        name: m.name || `Molecule ${idx + 1}`,
        ...(m.ic50 ? { ic50: m.ic50 } : {}),
        ...(m.smiles ? { smiles: m.smiles } : {}),
        atoms: m.atoms.map(a => ({
          label: a.label,
          location: [Number(a.x.toFixed(4)), Number(a.y.toFixed(4)), 0],
          ...(a.charge ? { charge: a.charge } : {}),
        })),
        bonds: m.bonds.map(b => ({ type: b.type, begin: b.begin, end: b.end })),
      };
    });
    return `${JSON.stringify(out, null, 2)}\n`;
  }

  function serializeMolV2000(m) {
    const padNum = (n, w) => String(n).padStart(w, ' ');
    const padFloat = (n, w, d) => Number(n || 0).toFixed(d).padStart(w, ' ');
    const lines = [
      String(m.name || 'Molecule').slice(0, 80),
      '  FairyKetcher2D',
      '',
      `${padNum(m.atoms.length, 3)}${padNum(m.bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`,
    ];
    for (const a of m.atoms) {
      lines.push(`${padFloat(a.x, 10, 4)}${padFloat(a.y, 10, 4)}${padFloat(0, 10, 4)} ${String(a.label || 'C').padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`);
    }
    for (const b of m.bonds) {
      lines.push(`${padNum(b.begin + 1, 3)}${padNum(b.end + 1, 3)}${padNum(b.type || 1, 3)}  0  0  0  0`);
    }
    const charged = m.atoms.map((a, i) => [i + 1, a.charge || 0]).filter(([, c]) => c !== 0);
    if (charged.length) {
      const pairs = charged.slice(0, 8).map(([i, c]) => `${padNum(i, 4)}${padNum(c, 4)}`).join('');
      lines.push(`M  CHG${padNum(Math.min(8, charged.length), 3)}${pairs}`);
    }
    lines.push('M  END');
    return lines.join('\n');
  }

  function serializeFormat(format) {
    const f = String(format || state.format || 'ket').replace(/^\./, '').toLowerCase();
    if (f === 'mol') return `${serializeMolV2000(currentMol())}\n`;
    if (f === 'sdf') {
      return state.molecules.map(m => {
        const extra = [];
        if (m.name) extra.push(`> <NAME>\n${m.name}\n`);
        if (m.ic50) extra.push(`> <IC50>\n${m.ic50}\n`);
        return `${serializeMolV2000(m)}\n${extra.join('\n')}$$$$`;
      }).join('\n') + '\n';
    }
    return serializeKetcher();
  }

  function renderControls() {
    // Multi-molecule deck
    if (state.molecules.length > 1) {
      deckEl.hidden = false;
      deckEl.replaceChildren(...state.molecules.map((m, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `kt-deck-btn${idx === state.selected ? ' on' : ''}`;
        const nm = document.createElement('span');
        nm.textContent = m.name || `Molecule ${idx + 1}`;
        b.append(nm);
        if (m.ic50) {
          const meta = document.createElement('span');
          meta.className = 'kt-deck-meta';
          meta.textContent = m.ic50;
          b.append(meta);
        }
        b.onclick = () => { state.selected = idx; fitView(); render(); notifyChanged(); };
        return b;
      }));
    } else {
      deckEl.hidden = true;
    }

    // Left tool rail
    toolsEl.replaceChildren();
    for (const [id, sym, title] of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `kt-btn${state.tool === id && !state.ring ? ' on' : ''}`;
      b.textContent = sym;
      b.title = title;
      b.onclick = () => { state.tool = id; state.ring = null; render(); };
      toolsEl.append(b);
    }
    const sep = document.createElement('div');
    sep.className = 'kt-sep';
    toolsEl.append(sep);
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button'; undoBtn.className = 'kt-btn'; undoBtn.textContent = '↶'; undoBtn.title = 'Undo';
    undoBtn.disabled = !state.undoStack.length;
    undoBtn.onclick = () => {
      const prev = state.undoStack.pop();
      if (!prev) return;
      state.redoStack.push({ selected: state.selected, mol: cloneMol(currentMol()) });
      state.selected = prev.selected;
      state.molecules[state.selected] = prev.mol;
      render(); notifyChanged();
    };
    const redoBtn = document.createElement('button');
    redoBtn.type = 'button'; redoBtn.className = 'kt-btn'; redoBtn.textContent = '↷'; redoBtn.title = 'Redo';
    redoBtn.disabled = !state.redoStack.length;
    redoBtn.onclick = () => {
      const next = state.redoStack.pop();
      if (!next) return;
      state.undoStack.push({ selected: state.selected, mol: cloneMol(currentMol()) });
      state.selected = next.selected;
      state.molecules[state.selected] = next.mol;
      render(); notifyChanged();
    };
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button'; fitBtn.className = 'kt-btn'; fitBtn.textContent = '⊞'; fitBtn.title = 'Fit structure to view';
    fitBtn.onclick = () => { fitView(); render(); };
    toolsEl.append(undoBtn, redoBtn, fitBtn);

    // Right element rail
    atomsEl.replaceChildren();
    for (const elSym of ELEMENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `kt-btn${state.element === elSym && state.tool === 'atom' ? ' on' : ''}`;
      b.textContent = elSym;
      b.style.color = ATOM_COLORS[elSym] || '#ececef';
      b.title = `Place / transmute ${elSym} atom`;
      b.onclick = () => { state.element = elSym; state.tool = 'atom'; state.ring = null; render(); };
      atomsEl.append(b);
    }

    // Bottom ring bar
    ringsEl.replaceChildren();
    for (const [id, glyph, title] of RINGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `kt-ring-btn${state.ring === id ? ' on' : ''}`;
      b.textContent = glyph;
      b.title = title;
      b.onclick = () => { state.ring = state.ring === id ? null : id; render(); };
      ringsEl.append(b);
    }
  }

  function renderCanvas() {
    const mol = currentMol();
    svgEl.className = `kt-svg mode-${state.tool}`;
    svgEl.replaceChildren();

    // Bonds
    mol.bonds.forEach((b, idx) => {
      const a1 = mol.atoms[b.begin], a2 = mol.atoms[b.end];
      if (!a1 || !a2) return;
      const [x1, y1] = worldToScreen(a1.x, a1.y);
      const [x2, y2] = worldToScreen(a2.x, a2.y);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const isHover = idx === state.hoverBond;
      const stroke = isHover ? (state.tool === 'erase' ? '#f87171' : '#5eead4') : '#d8dae4';

      const drawSeg = (ox, oy, dash = null) => {
        const attrs = { x1: (x1 + ox).toFixed(1), y1: (y1 + oy).toFixed(1), x2: (x2 + ox).toFixed(1), y2: (y2 + oy).toFixed(1), stroke, 'stroke-width': isHover ? 2.6 : 1.9, 'stroke-linecap': 'round' };
        if (dash) attrs['stroke-dasharray'] = dash;
        svgEl.append(svgNode('line', attrs));
      };

      if (b.type === 2) {
        drawSeg(nx * 2.5, ny * 2.5);
        drawSeg(-nx * 2.5, -ny * 2.5);
      } else if (b.type === 3) {
        drawSeg(0, 0);
        drawSeg(nx * 4.2, ny * 4.2);
        drawSeg(-nx * 4.2, -ny * 4.2);
      } else if (b.type === 4) {
        drawSeg(nx * 1.8, ny * 1.8);
        drawSeg(-nx * 2.4, -ny * 2.4, '4 3');
      } else {
        drawSeg(0, 0);
      }
    });

    // Rubber-band bond preview during drag
    if (state.drag?.kind === 'bond') {
      const [x1, y1] = worldToScreen(mol.atoms[state.drag.from].x, mol.atoms[state.drag.from].y);
      svgEl.append(svgNode('line', {
        x1: x1.toFixed(1), y1: y1.toFixed(1),
        x2: state.drag.sx.toFixed(1), y2: state.drag.sy.toFixed(1),
        stroke: '#5eead4', 'stroke-width': 1.8, 'stroke-dasharray': '4 3',
      }));
    }

    // Atoms
    mol.atoms.forEach((a, idx) => {
      const [ax, ay] = worldToScreen(a.x, a.y);
      const isHover = idx === state.hoverAtom;
      const degree = mol.bonds.reduce((n, b) => n + (b.begin === idx || b.end === idx ? 1 : 0), 0);
      const showLabel = a.label !== 'C' || a.charge !== 0 || degree === 0;
      if (isHover) {
        svgEl.append(svgNode('circle', {
          cx: ax.toFixed(1), cy: ay.toFixed(1), r: 12,
          fill: state.tool === 'erase' ? 'rgba(248,113,113,0.18)' : 'rgba(94,234,212,0.16)',
          stroke: state.tool === 'erase' ? '#f87171' : '#5eead4', 'stroke-width': 1.3,
        }));
      }
      if (showLabel) {
        svgEl.append(svgNode('circle', { cx: ax.toFixed(1), cy: ay.toFixed(1), r: 9.2, fill: '#111116' }));
        const chg = a.charge > 0 ? (a.charge === 1 ? '+' : `${a.charge}+`) : a.charge < 0 ? (a.charge === -1 ? '−' : `${Math.abs(a.charge)}−`) : '';
        svgEl.append(svgNode('text', {
          x: ax.toFixed(1), y: (ay + 4.2).toFixed(1),
          'text-anchor': 'middle', fill: ATOM_COLORS[a.label] || '#ececef',
          'font-size': 12.5, 'font-weight': 700, 'font-family': 'Inter, -apple-system, sans-serif',
        }, `${a.label}${chg}`));
      }
    });

    const summary = computeSummary(mol);
    hudEl.textContent = `${summary.formula} · MW ${summary.mw} · ${Math.round(state.zoom * 100)}%`;
    statusEl.textContent = `${mol.name || state.filename} · ${summary.atomCount} atoms · ${summary.bondCount} bonds${state.dirty ? ' · unsaved changes' : ''}`;
  }

  function render() {
    renderControls();
    renderCanvas();
  }

  function pointerCoords(e) {
    const rect = svgEl.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  svgEl.addEventListener('pointerdown', e => {
    const [sx, sy] = pointerCoords(e);
    const [wx, wy] = screenToWorld(sx, sy);
    const hitA = findHitAtom(sx, sy);
    const hitB = hitA < 0 ? findHitBond(sx, sy) : -1;
    const mol = currentMol();

    if (state.ring) {
      stampRing(state.ring, wx, wy);
      return;
    }

    if (state.tool === 'erase') {
      if (hitA >= 0) {
        pushUndo();
        mol.atoms.splice(hitA, 1);
        mol.bonds = mol.bonds
          .filter(b => b.begin !== hitA && b.end !== hitA)
          .map(b => ({ ...b, begin: b.begin > hitA ? b.begin - 1 : b.begin, end: b.end > hitA ? b.end - 1 : b.end }));
        render(); notifyChanged();
      } else if (hitB >= 0) {
        pushUndo();
        mol.bonds.splice(hitB, 1);
        render(); notifyChanged();
      }
      return;
    }

    if (state.tool === 'plus' || state.tool === 'minus') {
      if (hitA >= 0) {
        pushUndo();
        mol.atoms[hitA].charge = Math.max(-3, Math.min(3, (mol.atoms[hitA].charge || 0) + (state.tool === 'plus' ? 1 : -1)));
        render(); notifyChanged();
      }
      return;
    }

    if (state.tool === 'atom') {
      pushUndo();
      if (hitA >= 0) {
        mol.atoms[hitA].label = state.element;
      } else {
        mol.atoms.push({ label: state.element, x: Number(wx.toFixed(3)), y: Number(wy.toFixed(3)), charge: 0 });
      }
      render(); notifyChanged();
      return;
    }

    if (state.tool === 'select') {
      if (hitA >= 0) {
        pushUndo();
        state.drag = { kind: 'move', atom: hitA };
        svgEl.setPointerCapture?.(e.pointerId);
      } else {
        state.drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, origPanX: state.panX, origPanY: state.panY };
        svgEl.setPointerCapture?.(e.pointerId);
      }
      return;
    }

    if (state.tool === 'bond1' || state.tool === 'bond2' || state.tool === 'bond3' || state.tool === 'chain') {
      const order = state.tool === 'bond2' ? 2 : state.tool === 'bond3' ? 3 : 1;
      if (hitB >= 0 && hitA < 0) {
        pushUndo();
        mol.bonds[hitB].type = mol.bonds[hitB].type === order ? ((mol.bonds[hitB].type % 3) + 1) : order;
        render(); notifyChanged();
        return;
      }
      if (hitA >= 0) {
        state.drag = { kind: 'bond', from: hitA, order, sx, sy, moved: false };
        svgEl.setPointerCapture?.(e.pointerId);
      } else {
        pushUndo();
        const a0 = mol.atoms.length;
        mol.atoms.push(
          { label: 'C', x: Number(wx.toFixed(3)), y: Number(wy.toFixed(3)), charge: 0 },
          { label: 'C', x: Number((wx + BOND_LEN * 0.866).toFixed(3)), y: Number((wy + BOND_LEN * 0.5).toFixed(3)), charge: 0 }
        );
        mol.bonds.push({ begin: a0, end: a0 + 1, type: order });
        render(); notifyChanged();
      }
    }
  });

  svgEl.addEventListener('pointermove', e => {
    const [sx, sy] = pointerCoords(e);
    if (state.drag) {
      const mol = currentMol();
      if (state.drag.kind === 'move') {
        const [wx, wy] = screenToWorld(sx, sy);
        mol.atoms[state.drag.atom].x = Number(wx.toFixed(3));
        mol.atoms[state.drag.atom].y = Number(wy.toFixed(3));
        renderCanvas();
        return;
      }
      if (state.drag.kind === 'pan') {
        state.panX = state.drag.origPanX + (e.clientX - state.drag.startX);
        state.panY = state.drag.origPanY + (e.clientY - state.drag.startY);
        renderCanvas();
        return;
      }
      if (state.drag.kind === 'bond') {
        state.drag.sx = sx;
        state.drag.sy = sy;
        state.drag.moved = true;
        renderCanvas();
        return;
      }
    }
    const ha = findHitAtom(sx, sy);
    const hb = ha < 0 ? findHitBond(sx, sy) : -1;
    if (ha !== state.hoverAtom || hb !== state.hoverBond) {
      state.hoverAtom = ha;
      state.hoverBond = hb;
      renderCanvas();
    }
  });

  svgEl.addEventListener('pointerup', e => {
    if (!state.drag) return;
    const drag = state.drag;
    state.drag = null;
    const [sx, sy] = pointerCoords(e);
    const mol = currentMol();
    if (drag.kind === 'bond') {
      const target = findHitAtom(sx, sy);
      pushUndo();
      if (target >= 0 && target !== drag.from) {
        addOrCycleBond(mol, drag.from, target, drag.order);
      } else {
        const src = mol.atoms[drag.from];
        let nx, ny;
        if (drag.moved) {
          const [wx, wy] = screenToWorld(sx, sy);
          const ang = Math.atan2(wy - src.y, wx - src.x);
          nx = src.x + Math.cos(ang) * BOND_LEN;
          ny = src.y + Math.sin(ang) * BOND_LEN;
        } else {
          // Click on existing atom extends a clean 30-degree stub.
          nx = src.x + Math.cos(Math.PI / 6) * BOND_LEN;
          ny = src.y + Math.sin(Math.PI / 6) * BOND_LEN;
        }
        const idx = mol.atoms.length;
        mol.atoms.push({ label: state.tool === 'chain' ? 'C' : (state.element || 'C'), x: Number(nx.toFixed(3)), y: Number(ny.toFixed(3)), charge: 0 });
        mol.bonds.push({ begin: drag.from, end: idx, type: drag.order });
      }
      render(); notifyChanged();
    } else if (drag.kind === 'move') {
      render(); notifyChanged();
    }
  });

  svgEl.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    state.zoom = Math.max(0.25, Math.min(3.5, state.zoom * factor));
    renderCanvas();
  }, { passive: false });

  window.addEventListener('message', event => {
    const msg = event?.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ketcher:load' && msg.data) {
      const d = msg.data;
      state.filename = d.filename || state.filename;
      state.format = d.format || state.format;
      if (Array.isArray(d.molecules) && d.molecules.length) {
        state.molecules = d.molecules.map((m, i) => ({
          name: m.name || `Molecule ${i + 1}`,
          ic50: m.ic50 || '',
          smiles: m.smiles || '',
          atoms: Array.isArray(m.atoms) && m.atoms.length ? m.atoms.map(a => ({ ...a })) : makeBenzeneSeed(m.name || `Molecule ${i + 1}`).atoms,
          bonds: Array.isArray(m.bonds) && m.bonds.length ? m.bonds.map(b => ({ ...b })) : makeBenzeneSeed(m.name || `Molecule ${i + 1}`).bonds,
        }));
      }
      state.selected = Math.max(0, Math.min(state.molecules.length - 1, Number(d.selected) || 0));
      state.dirty = false;
      state.undoStack.length = 0;
      state.redoStack.length = 0;
      fitView();
      render();
      notifyChanged();
    } else if (msg.type === 'ketcher:export') {
      const fmt = msg.format || state.format || 'ket';
      const content = serializeFormat(fmt);
      const summary = computeSummary(currentMol());
      state.dirty = false;
      renderCanvas();
      try {
        window.parent?.postMessage({
          type: 'ketcher:exported',
          requestId: msg.requestId || null,
          format: fmt,
          content,
          summary,
        }, '*');
      } catch {}
    }
  });

  window.addEventListener('resize', () => { fitView(); renderCanvas(); });

  fitView();
  render();
  try { window.parent?.postMessage({ type: 'ketcher:ready' }, '*'); } catch {}
})();
