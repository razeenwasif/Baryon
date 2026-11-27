// Doc 7, #7: Data side pane — inspect CSV, TSV, JSON, JSONL, Parquet, and SQLite files beside the chat
// with column types, missing counts, summary statistics, a pure-SVG quick plot (histogram, scatter, line),
// and a sample rows table.
const el = (tag, className = '', text = undefined) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

const formatSize = bytes => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

const fmtNum = v => {
  if (v === null || v === undefined) return '—';
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) >= 10000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
};

function renderHistogramSvg(col) {
  const W = 440, H = 160, pad = { l: 38, r: 12, t: 14, b: 30 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'data-svg', role: 'img', 'aria-label': `Distribution of ${col.name}` });

  const bars = Array.isArray(col.histogram) && col.histogram.length
    ? col.histogram.map(b => ({ label: `${fmtNum(b.lo)}–${fmtNum(b.hi)}`, short: fmtNum(b.lo), count: b.count }))
    : (col.topValues || []).map(v => ({ label: String(v.value), short: String(v.value).slice(0, 10), count: v.count }));

  if (!bars.length) return svg;
  const maxC = Math.max(...bars.map(b => b.count), 1);

  // Axes
  svg.append(svgEl('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: H - pad.b, stroke: 'rgba(255,255,255,.16)' }));
  svg.append(svgEl('line', { x1: pad.l, y1: H - pad.b, x2: W - pad.r, y2: H - pad.b, stroke: 'rgba(255,255,255,.16)' }));

  const yTop = svgEl('text', { x: pad.l - 5, y: pad.t + 8, 'text-anchor': 'end', class: 'data-axis-text' });
  yTop.textContent = String(maxC);
  const yZero = svgEl('text', { x: pad.l - 5, y: H - pad.b, 'text-anchor': 'end', class: 'data-axis-text' });
  yZero.textContent = '0';
  svg.append(yTop, yZero);

  const step = innerW / bars.length;
  const barW = Math.max(4, step - 4);
  bars.forEach((b, idx) => {
    const h = Math.max(1, (b.count / maxC) * innerH);
    const x = pad.l + idx * step + 2;
    const y = H - pad.b - h;
    const rect = svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: barW.toFixed(1), height: h.toFixed(1), rx: 2, class: 'data-bar' });
    const tip = svgEl('title');
    tip.textContent = `${b.label}: ${b.count.toLocaleString()}`;
    rect.append(tip);
    svg.append(rect);
    if (bars.length <= 8 || idx === 0 || idx === bars.length - 1 || idx === Math.floor(bars.length / 2)) {
      const tx = svgEl('text', { x: (x + barW / 2).toFixed(1), y: H - 10, 'text-anchor': 'middle', class: 'data-axis-text' });
      tx.textContent = b.short;
      svg.append(tx);
    }
  });
  return svg;
}

function renderScatterOrLineSvg(plotRows, xCol, yCol, mode) {
  const W = 440, H = 170, pad = { l: 42, r: 14, t: 14, b: 30 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'data-svg', role: 'img', 'aria-label': `${mode === 'line' ? 'Series' : 'Scatter'} plot of ${yCol}` });

  const pts = [];
  for (const r of plotRows || []) {
    const xv = mode === 'line' ? r._row : r[xCol];
    const yv = r[yCol];
    if (typeof xv === 'number' && typeof yv === 'number') pts.push({ x: xv, y: yv });
  }
  if (!pts.length) return svg;

  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
  const sx = v => pad.l + ((v - xMin) / xSpan) * innerW;
  const sy = v => H - pad.b - ((v - yMin) / ySpan) * innerH;

  svg.append(svgEl('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: H - pad.b, stroke: 'rgba(255,255,255,.16)' }));
  svg.append(svgEl('line', { x1: pad.l, y1: H - pad.b, x2: W - pad.r, y2: H - pad.b, stroke: 'rgba(255,255,255,.16)' }));

  const labels = [
    [pad.l - 5, pad.t + 8, 'end', fmtNum(yMax)],
    [pad.l - 5, H - pad.b, 'end', fmtNum(yMin)],
    [pad.l, H - 10, 'start', fmtNum(xMin)],
    [W - pad.r, H - 10, 'end', fmtNum(xMax)],
  ];
  for (const [x, y, anchor, text] of labels) {
    const t = svgEl('text', { x, y, 'text-anchor': anchor, class: 'data-axis-text' });
    t.textContent = text;
    svg.append(t);
  }

  if (mode === 'line') {
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    svg.append(svgEl('path', { d, fill: 'none', stroke: '#818cf8', 'stroke-width': 1.8 }));
  }
  for (const p of pts) {
    const c = svgEl('circle', { cx: sx(p.x).toFixed(1), cy: sy(p.y).toFixed(1), r: mode === 'line' ? 2.2 : 3.1, class: 'data-dot' });
    const tip = svgEl('title');
    tip.textContent = `${mode === 'line' ? `row ${p.x}` : `${xCol}=${fmtNum(p.x)}`}, ${yCol}=${fmtNum(p.y)}`;
    c.append(tip);
    svg.append(c);
  }
  return svg;
}

export function dataPane({ api, work, onError = () => {}, openAnalytics = null }) {
  let activePath = '';
  let activeTable = '';
  let plotMode = 'hist';
  let plotCol = '';
  let plotX = '';
  let plotY = '';
  let cachedProfile = null;
  let cachedFolder = '';

  const pane = {
    id: 'data',
    title: 'Data',
    wide: () => Boolean(activePath),
    reset() { activePath = ''; activeTable = ''; cachedProfile = null; plotCol = ''; plotX = ''; plotY = ''; },
    async render(body, context) {
      const folder = work?.()?.path || '';
      if (!folder) {
        body.replaceChildren(el('p', 'pane-empty', 'Open a work session to inspect CSV, TSV, JSON, JSONL, Parquet, or SQLite files beside the chat.'));
        return;
      }
      if (!api?.dataFiles || !api?.dataInspect) {
        body.replaceChildren(el('p', 'pane-empty', 'Data inspection isn’t available here.'));
        return;
      }
      if (folder !== cachedFolder) {
        cachedFolder = folder;
        activePath = '';
        activeTable = '';
        cachedProfile = null;
      }
      if (typeof context.view === 'string' && context.view && context.view !== activePath) {
        activePath = context.view;
        activeTable = '';
        cachedProfile = null;
      }

      let listing;
      try { listing = await api.dataFiles(); } catch (err) {
        onError(err.message);
        body.replaceChildren(el('p', 'pane-empty', `Couldn’t scan data files: ${err.message}`));
        return;
      }
      const files = Array.isArray(listing?.files) ? listing.files : [];

      if (!activePath) {
        const wrap = el('div', 'data-pane');
        const head = el('div', 'data-head');
        head.append(el('strong', '', 'Data files'));
        const refresh = el('button', 'page-link', 'Refresh');
        refresh.type = 'button';
        refresh.onclick = () => context.redraw();
        head.append(refresh);
        wrap.append(head);

        if (!files.length) {
          wrap.append(el('p', 'pane-empty', 'No CSV, TSV, JSON, JSONL, Parquet, or SQLite files found in this project folder.'));
        } else {
          const list = el('div', 'data-file-list');
          for (const f of files) {
            const btn = el('button', 'data-file-row');
            btn.type = 'button';
            btn.append(
              el('span', 'data-fmt-badge', f.format.toUpperCase()),
              el('span', 'data-file-path', f.path),
              el('span', 'data-file-size', formatSize(f.sizeBytes)),
            );
            btn.onclick = () => { activePath = f.path; activeTable = ''; cachedProfile = null; context.setView(f.path); };
            list.append(btn);
          }
          wrap.append(list);
        }
        body.replaceChildren(wrap);
        return;
      }

      if (!cachedProfile || cachedProfile.path !== activePath || (activeTable && cachedProfile.table !== activeTable)) {
        try {
          cachedProfile = await api.dataInspect(activePath, { sampleRows: 15, ...(activeTable ? { table: activeTable } : {}) });
          if (cachedProfile.table) activeTable = cachedProfile.table;
          plotCol = cachedProfile.columns?.[0]?.name || '';
          plotX = cachedProfile.numericColumns?.[0] || '';
          plotY = cachedProfile.numericColumns?.[1] || cachedProfile.numericColumns?.[0] || '';
          if (plotMode === 'scatter' && (cachedProfile.numericColumns?.length || 0) < 2) plotMode = 'hist';
        } catch (err) {
          onError(err.message);
          const wrap = el('div', 'data-pane');
          const back = el('button', 'page-link', '‹ All data files');
          back.type = 'button';
          back.onclick = () => { activePath = ''; cachedProfile = null; context.setView(null); };
          wrap.append(back, el('p', 'pane-empty', `Couldn’t inspect ${activePath}: ${err.message}`));
          body.replaceChildren(wrap);
          return;
        }
      }

      const p = cachedProfile;
      const wrap = el('div', 'data-pane');

      // Header
      const head = el('div', 'data-head');
      const left = el('div', 'data-head-left');
      const back = el('button', 'page-back', '‹');
      back.type = 'button'; back.title = 'All data files'; back.setAttribute('aria-label', 'All data files');
      back.onclick = () => { activePath = ''; activeTable = ''; cachedProfile = null; context.setView(null); };
      left.append(back, el('span', 'data-fmt-badge', p.format.toUpperCase()), el('strong', 'data-active-path', p.path));

      const right = el('div', 'data-head-right');
      if (Array.isArray(p.tables) && p.tables.length > 1) {
        const sel = document.createElement('select');
        sel.className = 'trace-select';
        sel.setAttribute('aria-label', 'SQLite table');
        for (const t of p.tables) {
          const opt = document.createElement('option');
          opt.value = t; opt.textContent = t; opt.selected = t === p.table;
          sel.append(opt);
        }
        sel.onchange = () => { activeTable = sel.value; cachedProfile = null; context.redraw(); };
        right.append(sel);
      }
      const refresh = el('button', 'page-link', 'Refresh');
      refresh.type = 'button';
      refresh.onclick = () => { cachedProfile = null; context.redraw(); };
      if (typeof openAnalytics === 'function') {
        const openAn = el('button', 'page-link', 'Open in Analytics ↗');
        openAn.type = 'button';
        openAn.title = 'Import into ~/Analytics and open in Analytics mode';
        openAn.onclick = async () => {
          openAn.disabled = true;
          openAn.textContent = 'Opening…';
          try {
            await openAnalytics(p.path);
          } catch (err) {
            onError(err?.message || String(err));
          } finally {
            openAn.disabled = false;
            openAn.textContent = 'Open in Analytics ↗';
          }
        };
        right.append(openAn);
      }
      right.append(refresh);
      head.append(left, right);
      wrap.append(head);

      // Stats strip
      const meta = el('div', 'data-meta');
      meta.append(
        el('span', '', `${p.rows.toLocaleString()} rows`),
        el('span', '', `${p.columnCount} columns`),
        el('span', '', formatSize(p.sizeBytes)),
        ...(p.truncated ? [el('span', 'data-warn', `stats from first ${p.scannedRows.toLocaleString()} rows`)] : []),
      );
      wrap.append(meta);

      // Quick plot card
      if (p.columns?.length) {
        const card = el('div', 'data-card');
        const controls = el('div', 'data-plot-controls');
        const modes = [
          ['hist', 'Distribution'],
          ...(p.numericColumns?.length ? [['line', 'Series']] : []),
          ...(p.numericColumns?.length >= 2 ? [['scatter', 'Scatter']] : []),
        ];
        for (const [m, label] of modes) {
          const b = el('button', `trace-filter${plotMode === m ? ' active' : ''}`, label);
          b.type = 'button';
          b.onclick = () => { plotMode = m; context.redraw(); };
          controls.append(b);
        }
        if (plotMode === 'hist') {
          const sel = document.createElement('select');
          sel.className = 'trace-select';
          for (const c of p.columns) {
            const opt = document.createElement('option');
            opt.value = c.name; opt.textContent = c.name; opt.selected = c.name === plotCol;
            sel.append(opt);
          }
          sel.onchange = () => { plotCol = sel.value; context.redraw(); };
          controls.append(sel);
        } else if (plotMode === 'line') {
          const sel = document.createElement('select');
          sel.className = 'trace-select';
          for (const c of p.numericColumns) {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c; opt.selected = c === plotY;
            sel.append(opt);
          }
          sel.onchange = () => { plotY = sel.value; context.redraw(); };
          controls.append(sel);
        } else {
          const sx = document.createElement('select'); sx.className = 'trace-select';
          const sy = document.createElement('select'); sy.className = 'trace-select';
          for (const c of p.numericColumns) {
            const ox = document.createElement('option'); ox.value = c; ox.textContent = `X: ${c}`; ox.selected = c === plotX; sx.append(ox);
            const oy = document.createElement('option'); oy.value = c; oy.textContent = `Y: ${c}`; oy.selected = c === plotY; sy.append(oy);
          }
          sx.onchange = () => { plotX = sx.value; context.redraw(); };
          sy.onchange = () => { plotY = sy.value; context.redraw(); };
          controls.append(sx, sy);
        }
        card.append(controls);

        const targetCol = p.columns.find(c => c.name === plotCol) || p.columns[0];
        const svg = plotMode === 'hist'
          ? renderHistogramSvg(targetCol)
          : renderScatterOrLineSvg(p.plotRows, plotX, plotY, plotMode);
        card.append(svg);
        wrap.append(card);
      }

      // Columns & summary statistics
      if (p.columns?.length) {
        const sec = el('div', 'data-card');
        sec.append(el('div', 'data-section-title', 'Columns & summary statistics'));
        const scroll = el('div', 'data-table-wrap');
        const tbl = el('table', 'data-table');
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        for (const h of ['Column', 'Type', 'Missing', 'Unique', 'Summary']) htr.append(el('th', '', h));
        thead.append(htr);
        const tbody = document.createElement('tbody');
        for (const c of p.columns) {
          const tr = document.createElement('tr');
          tr.className = c.name === plotCol && plotMode === 'hist' ? 'is-selected' : '';
          tr.onclick = () => { plotCol = c.name; plotMode = 'hist'; context.redraw(); };
          const summary = (c.type === 'number' || c.type === 'integer')
            ? `min ${fmtNum(c.min)} · med ${fmtNum(c.median)} · mean ${fmtNum(c.mean)} · max ${fmtNum(c.max)}`
            : (c.topValues || []).slice(0, 3).map(v => `${v.value} (${v.count})`).join(', ') || '—';
          tr.append(
            el('td', 'trace-mono', c.name),
            el('td', '', c.type),
            el('td', c.missing ? 'data-warn' : '', c.missing ? `${c.missing} (${c.missingPct}%)` : '0'),
            el('td', '', `${c.unique}${c.uniqueCapped ? '+' : ''}`),
            el('td', 'data-summary-cell', summary),
          );
          tbody.append(tr);
        }
        tbl.append(thead, tbody);
        scroll.append(tbl);
        sec.append(scroll);
        wrap.append(sec);
      }

      // Sample rows table
      if (p.sample?.length) {
        const sec = el('div', 'data-card');
        sec.append(el('div', 'data-section-title', `Sample (first ${p.sample.length} rows)`));
        const scroll = el('div', 'data-table-wrap');
        const tbl = el('table', 'data-table');
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        for (const c of p.columns) htr.append(el('th', 'trace-mono', c.name));
        thead.append(htr);
        const tbody = document.createElement('tbody');
        for (const row of p.sample) {
          const tr = document.createElement('tr');
          for (const c of p.columns) {
            const val = row[c.name];
            tr.append(el('td', val === null || val === undefined ? 'data-null' : '', val === null || val === undefined ? 'null' : String(val)));
          }
          tbody.append(tr);
        }
        tbl.append(thead, tbody);
        scroll.append(tbl);
        sec.append(scroll);
        wrap.append(sec);
      }

      body.replaceChildren(wrap);
    },
  };
  return pane;
}
