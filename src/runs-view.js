import './runs-view.css';
import { MODES, THEMES, runsWater } from './runs-water.js';
import { bgAnimOffFor } from './bg-animations.js';
import { CHART, FILTERS, MAX_COMPARE, SCALE_WORDS, SERIES, STATE_WORDS, WHERE_WORDS, barGeometry, bytes, chartable, columnsOf, compareRows, duration, filterRuns, homeShort, lineGeometry, nearestStep, niceTicks, scatterGeometry, shortHash, shortValue, sortRuns, sparkPath, when, whereWords } from './runs-logic.js';

// Runs (docs/tracker-plan.md, stage 3): every experiment Fairy ran for you, by project, in the chat's place as
// Research and the notebooks take it. Projects, then a project's runs as a table, then one run's page. Research's
// investigations show their Lab and cluster runs, read only. A run's numbers are never changed here; its name, notes
// and tags are, and a run can be deleted.
const el = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text !== '') node.textContent = text; return node; };
const button = (className, text, onclick, title = '') => { const b = el('button', className, text); b.type = 'button'; b.onclick = onclick; if (title) b.title = title; return b; };

export function runsView({ api, root, sidebarButton, home = '', onOpenChat = () => {}, onShow = () => {}, onHide = () => {}, onError = () => {} }) {
  let shown = false, view = 'projects', project = null, runs = [], kind = 'project', runId = '', sort = { key: 'started', dir: 'desc' }, filter = 'all', words = '';
  // Compare (stage 4): the runs ticked in this project, and how the comparison is drawn.
  let picked = new Set(), chart = { kind: 'bars', metric: '', param: '' }, onlyDiffer = false;
  // Benchmark watch (Doc 7 #13): per-commit watches & series per project.
  let watches = [], watchSeries = new Map(), addingBench = false, benchBusy = new Set();
  api?.onBenchmarkChanged?.(event => {
    if (shown && view === 'project' && project && (!event?.folder || event.folder === project)) {
      void openProject(project, { keep: true });
    }
  });
  const body = el('div', 'rv-body');
  // The Zen Pool under the panel (runs-water.js), made the first time Runs shows. The pointer leaves a light wake and
  // sways the camera; a click on bare ground drops a drop there. A pill at the bottom picks how it's drawn and its
  // theme, remembered in the window.
  const canvas = el('canvas', 'rv-water'); canvas.setAttribute('aria-hidden', 'true');
  let water = null, tried = false, waterStopTimer = null;
  function syncWater() {
    clearTimeout(waterStopTimer); waterStopTimer = null;
    const atHome = shown && view === 'projects';
    const off = bgAnimOffFor('runs');
    root.classList.toggle('rv-at-home', atHome);
    root.classList.toggle('rv-bg-off', off);
    if (atHome && !off) {
      if (!tried) { tried = true; makeWater(); }
      water?.start();
    } else if (!shown || off || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      water?.stop();
    } else {
      waterStopTimer = setTimeout(() => { waterStopTimer = null; if (!shown || view !== 'projects' || bgAnimOffFor('runs')) water?.stop(); }, 800);
    }
    drawPool();
  }
  window.addEventListener('fairy:bg-anim-change', syncWater);
  const POOL_KEY = 'fairy-runs-pool';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(POOL_KEY) || '{}') || {}; } catch { return {}; } })();
  const keep = () => { try { localStorage.setItem(POOL_KEY, JSON.stringify({ mode: water?.mode(), theme: water?.theme() })); } catch {} };
  const pool = el('div', 'rv-pool'); pool.setAttribute('role', 'group'); pool.setAttribute('aria-label', 'Background');
  const poolModes = el('div', 'rv-pool-modes');
  const themeButton = button('rv-pool-theme', '', () => {
    if (!water) return;
    water.setTheme(THEMES[(THEMES.findIndex(x => x.id === water.theme()) + 1) % THEMES.length].id); keep(); drawPool();
  });
  function drawPool() {
    pool.hidden = !water || view !== 'projects' || bgAnimOffFor('runs');
    if (!water) return;
    poolModes.replaceChildren(...MODES.map(mode => {
      const b = button('rv-pool-mode', mode.name, () => { water.setMode(mode.id); keep(); drawPool(); }, mode.title);
      b.setAttribute('aria-pressed', String(water.mode() === mode.id));
      return b;
    }));
    const theme = THEMES.find(x => x.id === water.theme());
    themeButton.textContent = `Theme: ${theme.name}`;
    themeButton.title = `Background colours: ${theme.name}. Click for the next.`;
  }
  pool.append(poolModes, themeButton); pool.hidden = true;
  root.replaceChildren(canvas, body, pool);
  const bare = target => !target?.closest?.('button,a,input,textarea,select,summary,label,table,figure,svg,.rv-project,.rv-empty,.rv-pool');
  root.addEventListener('pointerdown', event => { if (view === 'projects' && event.button === 0 && bare(event.target)) water?.dropAt(event.clientX, event.clientY); });
  root.addEventListener('pointermove', event => { if (view === 'projects') water?.pointer(event.clientX, event.clientY); });

  const header = (title, lede, back) => {
    const head = el('header', 'rv-head');
    if (back) head.append(button('rv-back', back.label, back.go));
    const line = el('div', 'rv-title'); line.append(el('h1', '', title));
    head.append(line);
    if (lede) head.append(el('p', 'rv-lede', lede));
    return head;
  };
  const pill = state => el('span', `rv-state ${state}`, STATE_WORDS[state] || state);

  async function showProjects() {
    view = 'projects';
    syncWater();
    body.replaceChildren(header('Experiments', 'What Fairy ran for you, here and on atlas and forge, and what each run found.'), el('p', 'rv-faint', 'Reading…'));
    let projects = [];
    try { projects = await api.runsProjects(); } catch (error) { body.replaceChildren(header('Experiments'), el('p', 'rv-faint', error.message)); return; }
    if (view !== 'projects') return;
    const head = header('Experiments', 'What Fairy ran for you, here and on atlas and forge, and what each run found.');
    if (!projects.length) {
      body.replaceChildren(head, el('p', 'rv-empty', 'No runs yet. When a work session runs an experiment, or sends one to atlas or forge, it shows here with its parameters, metrics and files.'));
      return;
    }
    const grid = el('div', 'rv-projects');
    for (const p of projects) {
      const card = button('rv-project', '', () => openProject(p.folder));
      const top = el('div', 'rv-project-top'); top.append(el('h2', '', p.title));
      if (p.kind === 'investigation') top.append(el('span', 'rv-tag', 'Research'));
      if (p.kind === 'evals') top.append(el('span', 'rv-tag', 'Evals'));
      card.append(top, el('p', 'rv-path', homeShort(p.folder, home)),
        el('p', 'rv-count', `${p.count} ${p.count === 1 ? 'run' : 'runs'}${p.running ? ` · ${p.running} running` : ''}${p.latest ? ` · latest ${when(p.latest)}` : ''}`));
      grid.append(card);
    }
    body.replaceChildren(head, grid);
  }

  async function openProject(folder, { keep = false } = {}) {
    project = folder; view = 'project';
    if (!keep) { filter = 'all'; words = ''; sort = { key: 'started', dir: 'desc' }; picked = new Set(); addingBench = false; }
    try {
      const [got, benchList] = await Promise.all([
        api.runsList(folder),
        api.benchmarkList ? api.benchmarkList(folder).catch(() => []) : Promise.resolve([]),
      ]);
      runs = got.runs; kind = got.kind;
      watches = Array.isArray(benchList) ? benchList : [];
      watchSeries = new Map();
      if (api.benchmarkSeries && watches.length) {
        const entries = await Promise.all(watches.map(w => api.benchmarkSeries(w.id).catch(() => null)));
        entries.forEach((entry, i) => { if (entry) watchSeries.set(watches[i].id, entry); });
      }
    }
    catch (error) { onError(error.message); return showProjects(); }
    drawProject();
  }

  function drawBenchChart(series, regression, watch) {
    const valid = (series || []).filter(p => typeof p.value === 'number' && Number.isFinite(p.value));
    if (!valid.length) return el('p', 'rv-faint', 'No completed benchmark points recorded yet. Press Run now to record the current commit.');
    const C = { w: 580, h: 168, left: 54, right: 20, top: 18, bottom: 28 };
    const x0 = C.left, x1 = C.w - C.right, y0 = C.h - C.bottom, y1 = C.top;
    const vals = valid.map(p => p.value);
    if (regression?.baseline != null && Number.isFinite(regression.baseline)) vals.push(regression.baseline);
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals), 4);
    const sx = i => (valid.length === 1 ? (x0 + x1) / 2 : x0 + (i / (valid.length - 1)) * (x1 - x0));
    const sy = v => y0 - ((v - lo) / (hi - lo || 1)) * (y0 - y1);
    const svg = svgEl('svg', { viewBox: `0 0 ${C.w} ${C.h}`, class: 'rv-bench-svg', role: 'img', 'aria-label': `${watch.title} commit benchmark trend` });
    const gAxes = svgEl('g', { class: 'rv-axes' });
    for (const t of ticks) {
      gAxes.append(svgEl('line', { x1: x0, x2: x1, y1: sy(t), y2: sy(t), class: 'rv-grid' }));
      const lbl = svgEl('text', { x: x0 - 8, y: sy(t) + 4, 'text-anchor': 'end' });
      lbl.textContent = shortValue(t);
      gAxes.append(lbl);
    }
    svg.append(gAxes);
    if (regression?.baseline != null && Number.isFinite(regression.baseline)) {
      const by = sy(regression.baseline);
      svg.append(svgEl('line', { x1: x0, x2: x1, y1: by, y2: by, class: 'rv-bench-baseline' }));
    }
    if (valid.length >= 2) {
      const d = valid.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ');
      svg.append(svgEl('path', { d, class: 'rv-line', stroke: '#5eead4' }));
    }
    const stride = Math.max(1, Math.ceil(valid.length / 6));
    valid.forEach((p, i) => {
      const cx = sx(i), cy = sy(p.value);
      const isBad = regression?.regressed && p.runId === regression.runId;
      const dot = svgEl('circle', { cx, cy, r: isBad ? 5 : 4, fill: isBad ? '#f87171' : '#5eead4', class: 'rv-dot rv-bench-dot' });
      const tipText = `${p.shortCommit}: ${shortValue(p.value)}${p.unit ? ` ${p.unit}` : ''} (${p.runId})`;
      const title = svgEl('title'); title.textContent = tipText; dot.append(title);
      dot.style.cursor = 'pointer';
      dot.onclick = () => openRun(p.runId);
      svg.append(dot);
      if (i % stride === 0 || i === valid.length - 1) {
        const xl = svgEl('text', { x: cx, y: C.h - 8, 'text-anchor': 'middle', class: 'rv-tick-name' });
        xl.textContent = p.shortCommit;
        svg.append(xl);
      }
    });
    return svg;
  }

  function benchmarkSection() {
    const wrap = el('div', 'rv-section rv-bench');
    const top = el('div', 'rv-bench-top');
    const heading = el('div', 'rv-bench-title');
    heading.append(el('h2', '', 'Benchmark watch'), el('span', 'rv-faint', 'Runs automatically per Git commit & alerts on regressions'));
    const addBtn = button('rv-chip', addingBench ? 'Cancel' : '+ Add benchmark', () => { addingBench = !addingBench; drawProject(); });
    top.append(heading, addBtn);
    wrap.append(top);

    if (addingBench) {
      const form = el('form', 'rv-bench-form');
      const titleInput = el('input'); titleInput.placeholder = 'Suite name (e.g. Tokenizer throughput)'; titleInput.required = true;
      const cmdInput = el('input'); cmdInput.placeholder = 'Benchmark command (e.g. python bench.py)'; cmdInput.required = true;
      const metricInput = el('input'); metricInput.placeholder = 'Metric key (e.g. tokens_per_s or latency_ms)'; metricInput.required = true;
      const dirSelect = el('select');
      for (const [val, lbl] of [['lower', 'Lower is better'], ['higher', 'Higher is better']]) { const o = el('option', '', lbl); o.value = val; dirSelect.append(o); }
      const threshInput = el('input'); threshInput.type = 'number'; threshInput.step = '0.5'; threshInput.min = '0.1'; threshInput.max = '100'; threshInput.value = '5'; threshInput.title = 'Regression alert threshold (%)';
      const machineSelect = el('select');
      for (const [val, lbl] of [['atlas', 'Run on Atlas'], ['here', 'Run locally']]) { const o = el('option', '', lbl); o.value = val; machineSelect.append(o); }
      const saveBtn = button('rv-compare', 'Save watch', null); saveBtn.type = 'submit';
      form.onsubmit = async event => {
        event.preventDefault();
        try {
          saveBtn.disabled = true;
          await api.benchmarkAdd({ folder: project, title: titleInput.value.trim(), command: cmdInput.value.trim(), metric: metricInput.value.trim(), direction: dirSelect.value, thresholdPct: Number(threshInput.value) || 5, machine: machineSelect.value });
          addingBench = false;
          await openProject(project, { keep: true });
        } catch (error) { onError(error.message); saveBtn.disabled = false; }
      };
      form.append(titleInput, cmdInput, metricInput, dirSelect, threshInput, machineSelect, saveBtn);
      wrap.append(form);
    }

    if (!watches.length && !addingBench) {
      wrap.append(el('p', 'rv-faint', 'No commit benchmark watches yet. Add one to track metrics across commits on Atlas or locally.'));
      return wrap;
    }

    for (const w of watches) {
      const info = watchSeries.get(w.id) || { series: [], regression: null };
      const card = el('div', 'rv-bench-card');
      const cardHead = el('div', 'rv-bench-card-head');
      const left = el('div', 'rv-bench-meta');
      const dirWord = w.direction === 'higher' ? '↑ higher is better' : '↓ lower is better';
      left.append(
        el('strong', '', w.title),
        el('span', 'rv-tag', w.machine === 'atlas' ? 'Atlas' : 'Local'),
        el('span', 'rv-faint', `${w.metric} · ${dirWord} · alert ≥${w.thresholdPct}%`),
      );
      if (w.state?.lastCommit) left.append(el('span', 'rv-faint', `commit ${w.state.lastCommit.slice(0, 8)}`));
      const actions = el('div', 'rv-bench-actions');
      const runBtn = button('rv-chip', benchBusy.has(w.id) ? 'Running…' : 'Run now', async () => {
        if (benchBusy.has(w.id)) return;
        benchBusy.add(w.id); drawProject();
        try { await api.benchmarkRun(w.id); await openProject(project, { keep: true }); }
        catch (error) { onError(error.message); }
        finally { benchBusy.delete(w.id); drawProject(); }
      });
      runBtn.disabled = benchBusy.has(w.id);
      const toggleBtn = button('rv-chip', w.enabled ? 'Pause' : 'Resume', async () => {
        try { await api.benchmarkSet(w.id, { enabled: !w.enabled }); await openProject(project, { keep: true }); }
        catch (error) { onError(error.message); }
      });
      const rmBtn = button('rv-chip rv-bench-rm', 'Remove', async () => {
        try { await api.benchmarkRemove(w.id); await openProject(project, { keep: true }); }
        catch (error) { onError(error.message); }
      });
      actions.append(runBtn, toggleBtn, rmBtn);
      cardHead.append(left, actions);
      card.append(cardHead);
      if (info.regression?.regressed) {
        const alert = el('div', 'rv-bench-alert');
        alert.append(el('span', '', info.regression.summary));
        if (info.regression.runId) alert.append(button('rv-chip', `Inspect ${info.regression.runId}`, () => openRun(info.regression.runId)));
        card.append(alert);
      }
      if (w.state?.error) card.append(el('p', 'rv-bench-err', w.state.error));
      const chartWrap = el('div', 'rv-chart');
      chartWrap.append(drawBenchChart(info.series, info.regression, w));
      card.append(chartWrap);
      wrap.append(card);
    }
    return wrap;
  }

  function drawProject() {
    syncWater();
    const name = project.split('/').filter(Boolean).at(-1) || project;
    const head = header(name, homeShort(project, home), { label: 'All projects', go: showProjects });
    if (kind === 'investigation') head.querySelector('.rv-title').append(el('span', 'rv-tag', 'Research · read only'));
    const tools = el('div', 'rv-tools');
    const chips = el('div', 'rv-chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Show');
    for (const [id, label] of FILTERS) {
      const chip = button(`rv-chip${filter === id ? ' on' : ''}`, label, () => { filter = id; drawProject(); });
      chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(filter === id));
      chips.append(chip);
    }
    const search = el('input', 'rv-search'); search.type = 'search'; search.placeholder = 'Find a run, command or tag'; search.value = words;
    search.setAttribute('aria-label', 'Find a run');
    search.oninput = () => { words = search.value; drawTable(table, syncCompare); syncCompare(); };
    const compare = button('rv-compare', '', () => drawCompare());
    tools.append(chips, search, compare);
    const table = el('div', 'rv-table-wrap');
    const syncCompare = () => {
      picked = new Set([...picked].filter(id => runs.some(r => r.id === id)));
      compare.hidden = picked.size === 0;
      compare.disabled = picked.size < 2;
      compare.textContent = picked.size < 2 ? 'Tick another run to compare' : `Compare ${picked.size} runs`;
      for (const box of table.querySelectorAll('input.rv-pick')) box.disabled = !box.checked && picked.size >= MAX_COMPARE;
    };
    drawTable(table, syncCompare);
    syncCompare();
    const parts = [head];
    if (kind === 'project' && api?.benchmarkList) parts.push(benchmarkSection());
    parts.push(tools, table);
    body.replaceChildren(...parts);
  }

  function drawTable(holder, onPick = () => {}) {
    const shownRuns = sortRuns(filterRuns(runs, filter, words), sort.key, sort.dir);
    if (!shownRuns.length) { holder.replaceChildren(el('p', 'rv-empty', runs.length ? 'No runs match.' : 'No runs in this project yet.')); return; }
    const { params, metrics } = columnsOf(shownRuns);
    const columns = [['pick', ''], ['id', 'Run'], ['state', 'State'], ['where', 'Where'], ['started', 'Started'], ['seconds', 'Time'], ...params.map(p => [`param:${p}`, p, 'param']), ...metrics.map(m => [`metric:${m}`, m, 'metric'])];
    const table = el('table', 'rv-table');
    const headRow = el('tr');
    for (const [key, label, group] of columns) {
      if (key === 'pick') { const th = el('th', 'rv-pick-cell'); th.append(el('span', 'rv-hidden', 'Compare')); headRow.append(th); continue; }
      const th = el('th', group ? `rv-${group}` : '');
      const b = button('rv-sort', label, () => { sort = { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' }; drawTable(holder, onPick); onPick(); }, group === 'metric' ? 'A metric' : group === 'param' ? 'A parameter' : '');
      th.append(b);
      if (sort.key === key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      headRow.append(th);
    }
    const thead = el('thead'); thead.append(headRow);
    const tbody = el('tbody');
    for (const run of shownRuns) {
      const tr = el('tr'); tr.tabIndex = 0;
      const open = () => openRun(run.id);
      tr.onclick = open; tr.onkeydown = event => { if (event.key === 'Enter') open(); };
      // Ticked for comparing: the box never opens the run.
      const pickCell = el('td', 'rv-pick-cell'), box = el('input', 'rv-pick'); box.type = 'checkbox'; box.checked = picked.has(run.id);
      box.setAttribute('aria-label', `Compare ${run.id}`);
      box.onclick = event => event.stopPropagation();
      box.onchange = () => { if (box.checked) picked.add(run.id); else picked.delete(run.id); onPick(); };
      pickCell.onclick = event => { event.stopPropagation(); if (event.target === pickCell && !box.disabled) { box.checked = !box.checked; box.onchange(); } };
      pickCell.append(box);
      const idCell = el('td'), inner = el('div', 'rv-run'); inner.append(el('b', '', run.label || run.id)); if (run.name) inner.append(el('span', '', run.name));
      if (run.scale) {
        const badge = el('span', `rv-scale ${run.scale}`, SCALE_WORDS[run.scale] || run.scale);
        badge.title = run.scale === 'full' ? 'Full-scale reproduction run' : `${run.scaleNote ? `${run.scaleNote} · ` : ''}Never counts as reproduced`;
        inner.append(badge);
      }
      if (run.claims?.length) inner.append(el('span', 'rv-claims', run.claims.join(', ')));
      idCell.append(inner);
      const stateCell = el('td'); stateCell.append(pill(run.state));
      tr.append(pickCell, idCell, stateCell, el('td', 'rv-faint', whereWords(run)), el('td', 'rv-faint', when(run.started)), el('td', 'rv-num', duration(run.seconds)));
      for (const p of params) { const v = run.params?.[p]; const td = el('td', 'rv-num rv-param', shortValue(v)); if (v !== undefined) td.title = String(v); tr.append(td); }
      for (const m of metrics) { const v = run.metrics?.[m]; const td = el('td', 'rv-num rv-metric', v ? `${shortValue(v.value)}${v.unit ? ` ${v.unit}` : ''}` : ''); if (v) td.title = String(v.value); tr.append(td); }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    holder.replaceChildren(table, el('p', 'rv-faint rv-under', `${shownRuns.length} of ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`));
  }

  function section(title, ...children) { const s = el('section', 'rv-section'); s.append(el('h2', '', title), ...children); return s; }
  function pairs(entries, { metric = false } = {}) {
    const table = el('table', 'rv-pairs');
    for (const [name, value] of entries) {
      const tr = el('tr'), v = metric ? value : { value };
      const td = el('td', 'rv-num', `${shortValue(v.value)}${v.unit ? ` ${v.unit}` : ''}`); td.title = String(v.value);
      tr.append(el('th', '', name), td);
      const spark = metric && v.steps ? sparkPath(v.steps) : '';
      const draw = el('td', 'rv-spark');
      if (spark) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 120 28'); svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `${name} over ${v.steps.length} steps`);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', spark); svg.append(path); draw.append(svg);
      }
      if (metric) tr.append(draw);
      table.append(tr);
    }
    return table;
  }

  function openRun(id) {
    const run = runs.find(r => r.id === id);
    if (!run) return drawProject();
    view = 'run'; runId = id;
    syncWater();
    const back = { label: project.split('/').filter(Boolean).at(-1) || 'Experiments', go: () => { view = 'project'; drawProject(); } };
    const head = header(`${run.label || run.id}${run.name ? ` · ${run.name}` : ''}`, '', back);
    head.querySelector('.rv-title').append(pill(run.state));
    if (run.scale) {
      const badge = el('span', `rv-scale ${run.scale}`, SCALE_WORDS[run.scale] || run.scale);
      badge.title = run.scale === 'full' ? 'Full-scale reproduction run' : 'Scaled-down or smoke runs never count as reproduced';
      head.querySelector('.rv-title').append(badge);
    }
    if (run.claims?.length) head.querySelector('.rv-title').append(el('span', 'rv-claims', `Claims: ${run.claims.join(', ')}`));
    const meta = el('p', 'rv-meta', [whereWords(run), run.where?.limitHours ? `limit ${run.where.limitHours}h` : '', run.scaleNote || '', run.started ? `started ${when(run.started)}` : '', duration(run.seconds) ? `took ${duration(run.seconds)}` : '', Number.isInteger(run.exit) ? `exit ${run.exit}` : ''].filter(Boolean).join(' · '));
    head.append(meta);
    if (run.scale && run.scale !== 'full') {
      head.append(el('p', 'rv-faint', 'Scaled-down and smoke runs are always marked and never count as reproduced — only full-scale finished runs do.'));
    }
    const parts = [head];
    if (run.command) { const pre = el('pre', 'rv-pre', run.command); parts.push(section('Command', pre)); }
    const code = run.code || {}, codeLines = el('div', 'rv-code');
    if (code.commit) codeLines.append(el('p', '', `Commit ${code.commit.slice(0, 10)}${code.branch ? ` on ${code.branch}` : ''}${code.dirty ? `, with ${code.changed?.length || 0} uncommitted ${code.changed?.length === 1 ? 'file' : 'files'}` : ', nothing uncommitted'}`));
    if (code.entry) codeLines.append(el('p', '', `${code.entry.file} · ${shortHash(code.entry.sha256)}`));
    if (code.changed?.length) { const list = el('ul', 'rv-files'); for (const c of code.changed.slice(0, 40)) list.append(el('li', '', `${c.path}${c.gone ? ' (removed)' : c.sha256 ? ` · ${shortHash(c.sha256)}` : ''}`)); codeLines.append(list); }
    if (codeLines.childNodes.length) parts.push(section('Code', codeLines));
    if (Object.keys(run.params || {}).length) parts.push(section('Parameters', pairs(Object.entries(run.params))));
    if (Object.keys(run.metrics || {}).length) parts.push(section('Metrics', pairs(Object.entries(run.metrics), { metric: true })));
    else if (run.state !== 'running') parts.push(section('Metrics', el('p', 'rv-faint', 'It reported none.')));
    const figures = (run.files || []).filter(f => f.figure && /\.(?:png|jpe?g|gif|webp|svg)$/i.test(f.path));
    if (figures.length) {
      const grid = el('div', 'rv-figures');
      for (const f of figures.slice(0, 24)) {
        const fig = el('figure'), img = el('img'); img.alt = f.path.split('/').at(-1); img.loading = 'lazy';
        fig.append(img, el('figcaption', '', f.path.split('/').at(-1)));
        api.runsFigure(project, run.id, f.path).then(got => { img.src = got.url; }, error => { fig.replaceChildren(el('p', 'rv-faint', `${f.path.split('/').at(-1)}: ${error.message}`)); });
        grid.append(fig);
      }
      parts.push(section('Figures', grid));
    }
    if (run.printout) parts.push(section('Printout', el('pre', 'rv-pre rv-printout', run.printout)));
    const others = (run.files || []).filter(f => !figures.includes(f));
    if (others.length) {
      const list = el('ul', 'rv-files');
      for (const f of others.slice(0, 200)) { const li = el('li'); li.append(el('span', '', f.path), el('span', 'rv-faint', [bytes(f.bytes), shortHash(f.sha256)].filter(Boolean).join(' · '))); list.append(li); }
      parts.push(section('Files', list));
    }
    if (run.from?.chat) parts.push(section('Started from', button('rv-link', run.from.title || 'Open the chat that started it', () => onOpenChat(run.from.chat))));
    if (kind === 'project') parts.push(section('Your notes', notesForm(run)));
    body.replaceChildren(...parts);
    body.scrollTop = 0;
  }

  function notesForm(run) {
    const form = el('form', 'rv-notes');
    const name = el('input'); name.value = run.name || ''; name.placeholder = 'Name'; name.setAttribute('aria-label', 'Name'); name.maxLength = 80;
    const tags = el('input'); tags.value = (run.tags || []).join(', '); tags.placeholder = 'Tags, with commas'; tags.setAttribute('aria-label', 'Tags');
    const notes = el('textarea'); notes.value = run.notes || ''; notes.rows = 3; notes.placeholder = 'What this run was for, what it showed'; notes.setAttribute('aria-label', 'Notes'); notes.maxLength = 4000;
    const row = el('div', 'rv-notes-row');
    const save = el('button', 'rv-save', 'Save'); save.type = 'submit';
    const remove = button('rv-remove', 'Delete run', async () => {
      if (!window.confirm(`Delete ${run.id} from Runs? Its files stay where they are.`)) return;
      try { await api.runsRemove(project, run.id); runs = runs.filter(r => r.id !== run.id); view = 'project'; drawProject(); } catch (error) { onError(error.message); }
    });
    row.append(remove, save);
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      try {
        const kept = await api.runsAnnotate(project, run.id, { name: name.value, notes: notes.value, tags: tags.value.split(',').map(t => t.trim()).filter(Boolean) });
        runs = runs.map(r => (r.id === kept.id ? kept : r));
        openRun(kept.id);
      } catch (error) { onError(error.message); save.disabled = false; }
    };
    form.append(name, tags, notes, row);
    return form;
  }

  // ── Compare (stage 4) ──
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node; };
  // The ticked runs in id order, so each keeps its colour however the table was sorted.
  const comparing = () => runs.filter(r => picked.has(r.id)).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const colourOf = (list, id) => SERIES[list.findIndex(r => r.id === id)] || SERIES[0];

  function drawCompare() {
    const list = comparing();
    if (list.length < 2) { view = 'project'; return drawProject(); }
    view = 'compare';
    syncWater();
    const name = project.split('/').filter(Boolean).at(-1) || 'Experiments';
    const head = header(`Comparing ${list.length} runs`, '', { label: name, go: () => { view = 'project'; drawProject(); } });
    const legend = el('ul', 'rv-legend'); legend.setAttribute('aria-label', 'Runs compared');
    for (const run of list) {
      const li = el('li'), swatch = el('span', 'rv-swatch'); swatch.style.background = colourOf(list, run.id);
      li.append(swatch, el('b', '', run.label || run.id), el('span', '', run.name || ''));
      legend.append(li);
    }
    head.append(legend);
    const can = chartable(list);
    if (!can.metrics.includes(chart.metric)) chart.metric = (chart.kind === 'lines' ? can.stepped[0] : '') || can.metrics[0] || '';
    if (!can.params.includes(chart.param)) chart.param = can.params[0] || '';
    const parts = [head];
    if (can.metrics.length) parts.push(chartSection(list, can));
    else parts.push(section('Chart', el('p', 'rv-faint', 'None of these runs reported a metric to draw.')));
    parts.push(compareTable(list));
    body.replaceChildren(...parts);
  }

  function chartSection(list, can) {
    const holder = section('Chart');
    const controls = el('div', 'rv-chart-controls');
    const kinds = el('div', 'rv-chips'); kinds.setAttribute('role', 'radiogroup'); kinds.setAttribute('aria-label', 'Chart');
    const KINDS = [['bars', 'Across runs', can.metrics.length > 0], ['points', 'Against a parameter', can.params.length > 0], ['lines', 'By step', can.stepped.length > 0]];
    if (!KINDS.find(([id, , ok]) => id === chart.kind && ok)) chart.kind = 'bars';
    for (const [id, label, ok] of KINDS) {
      const chip = button(`rv-chip${chart.kind === id ? ' on' : ''}`, label, () => { chart.kind = id; if (id === 'lines' && !can.stepped.includes(chart.metric)) chart.metric = can.stepped[0]; drawCompare(); });
      chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(chart.kind === id)); chip.disabled = !ok;
      if (!ok) chip.title = id === 'points' ? 'No parameter is a number in two of these runs' : 'None of these runs logged a metric by step';
      kinds.append(chip);
    }
    const pick = (label, options, value, set) => {
      const wrap = el('label', 'rv-select'); wrap.append(el('span', '', label));
      const select = el('select'); for (const option of options) { const o = el('option', '', option); o.value = option; select.append(o); }
      select.value = value; select.onchange = () => { set(select.value); drawCompare(); };
      wrap.append(select); return wrap;
    };
    controls.append(kinds, pick('Metric', chart.kind === 'lines' ? can.stepped : can.metrics, chart.metric, v => { chart.metric = v; }));
    if (chart.kind === 'points') controls.append(pick('Parameter', can.params, chart.param, v => { chart.param = v; }));
    const frame = el('div', 'rv-chart'), tip = el('div', 'rv-tip'); tip.hidden = true; tip.setAttribute('role', 'status');
    const unit = list.map(r => r.metrics?.[chart.metric]?.unit).find(Boolean);
    const drawn = chart.kind === 'points' ? drawPoints(list, frame, tip, unit) : chart.kind === 'lines' ? drawLines(list, frame, tip, unit) : drawBars(list, frame, tip, unit);
    frame.append(drawn, tip);
    const missing = list.filter(r => (chart.kind === 'lines' ? (r.metrics?.[chart.metric]?.steps || []).length < 2 : typeof r.metrics?.[chart.metric]?.value !== 'number') || (chart.kind === 'points' && typeof r.params?.[chart.param] !== 'number'));
    holder.append(controls, frame);
    if (missing.length) holder.append(el('p', 'rv-faint', `Not drawn: ${missing.map(r => r.label || r.id).join(', ')}, with no ${chart.kind === 'lines' ? 'steps' : 'number'} for ${chart.kind === 'points' ? `${chart.metric} and ${chart.param}` : chart.metric}.`));
    return holder;
  }

  // Axes shared by the three charts: hairline grid, labels in muted ink, the y axis's ticks on the left.
  function axes(svg, yTicks, { xTicks = null, xLabel = '', yLabel = '' } = {}) {
    const g = svgEl('g', { class: 'rv-axes' });
    for (const t of yTicks) { g.append(svgEl('line', { x1: CHART.left, x2: CHART.w - CHART.right, y1: t.y, y2: t.y, class: 'rv-grid' })); const label = svgEl('text', { x: CHART.left - 8, y: t.y + 4, 'text-anchor': 'end' }); label.textContent = shortValue(t.value); g.append(label); }
    if (xTicks) for (const t of xTicks) { const label = svgEl('text', { x: t.x, y: CHART.h - CHART.bottom + 18, 'text-anchor': 'middle' }); label.textContent = shortValue(t.value); g.append(label); }
    if (yLabel) { const label = svgEl('text', { x: 4, y: 12, class: 'rv-axis-name' }); label.textContent = yLabel; g.append(label); }
    if (xLabel) { const label = svgEl('text', { x: CHART.w - CHART.right, y: CHART.h - 2, 'text-anchor': 'end', class: 'rv-axis-name' }); label.textContent = xLabel; g.append(label); }
    svg.append(g);
  }
  const chartSvg = label => { const svg = svgEl('svg', { viewBox: `0 0 ${CHART.w} ${CHART.h}`, role: 'img', 'aria-label': label }); return svg; };
  const showTip = (frame, tip, svg, x, y, lines) => {
    tip.replaceChildren(...lines.map(([colour, text]) => { const row = el('div', 'rv-tip-row'); if (colour) { const s = el('span', 'rv-swatch'); s.style.background = colour; row.append(s); } row.append(el('span', '', text)); return row; }));
    tip.hidden = false;
    const box = svg.getBoundingClientRect(), scale = box.width / CHART.w, left = x * scale, top = y * scale;
    tip.style.left = `${Math.min(box.width - 170, Math.max(0, left + 12))}px`; tip.style.top = `${Math.max(0, top - 12)}px`;
  };
  const metricText = (value, unit) => `${shortValue(value)}${unit ? ` ${unit}` : ''}`;

  function drawBars(list, frame, tip, unit) {
    const g = barGeometry(list, chart.metric), svg = chartSvg(`${chart.metric} across ${list.length} runs`);
    axes(svg, g.ticks, { yLabel: `${chart.metric}${unit ? ` (${unit})` : ''}` });
    for (const bar of g.bars) {
      const run = list.find(r => r.id === bar.id), colour = colourOf(list, bar.id);
      // A 4px rounded end away from the baseline, flat on it.
      const up = bar.value >= 0, r = Math.min(4, bar.height / 2, bar.width / 2), { x, y, width: w, height: h } = bar;
      const d = up ? `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z` : `M${x} ${y}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + w - r}Q${x + w} ${y + h} ${x + w} ${y + h - r}V${y}Z`;
      svg.append(svgEl('path', { d, fill: colour, class: 'rv-mark' }));
      const label = svgEl('text', { x: bar.mid, y: CHART.h - CHART.bottom + 18, 'text-anchor': 'middle', class: 'rv-tick-name' }); label.textContent = run.label || run.id; svg.append(label);
      // No number on every bar: hover gives it, and the table below has them all.
      // The hover target is the run's whole column, not just its bar.
      const hit = svgEl('rect', { x: bar.mid - g.slot / 2, y: CHART.top, width: g.slot, height: CHART.h - CHART.top - CHART.bottom, class: 'rv-hit' });
      hit.onmouseenter = () => showTip(frame, tip, svg, bar.mid, y, [[colour, `${run.label || run.id}${run.name ? ` · ${run.name}` : ''}`], ['', `${chart.metric}: ${metricText(bar.value, unit)}`]]);
      hit.onmouseleave = () => { tip.hidden = true; };
      svg.append(hit);
    }
    svg.append(svgEl('line', { x1: CHART.left, x2: CHART.w - CHART.right, y1: g.zero, y2: g.zero, class: 'rv-baseline' }));
    return svg;
  }

  // Points in one colour, each named by its run: identity is in the label, not the hue.
  function drawPoints(list, frame, tip, unit) {
    const g = scatterGeometry(list, chart.param, chart.metric), svg = chartSvg(`${chart.metric} against ${chart.param}`);
    axes(svg, g.yTicks, { xTicks: g.xTicks, xLabel: `${chart.param}${g.log ? ' (log scale)' : ''}`, yLabel: `${chart.metric}${unit ? ` (${unit})` : ''}` });
    for (const point of g.points) {
      const run = list.find(r => r.id === point.id);
      svg.append(svgEl('circle', { cx: point.x, cy: point.y, r: 5, fill: SERIES[0], class: 'rv-mark rv-dot' }));
      const hit = svgEl('circle', { cx: point.x, cy: point.y, r: 14, class: 'rv-hit' });
      hit.onmouseenter = () => showTip(frame, tip, svg, point.x, point.y, [['', `${run.label || run.id}${run.name ? ` · ${run.name}` : ''}`], ['', `${chart.param}: ${shortValue(point.xValue)}`], ['', `${chart.metric}: ${metricText(point.yValue, unit)}`]]);
      hit.onmouseleave = () => { tip.hidden = true; };
      svg.append(hit);
    }
    for (const label of g.labels) { const name = svgEl('text', { x: Math.min(label.x + 9, CHART.w - CHART.right - 30), y: label.y - 8, class: 'rv-value' }); name.textContent = label.ids.map(id => list.find(r => r.id === id)?.label || id).join(', '); svg.insertBefore(name, svg.querySelector('.rv-hit')); }
    return svg;
  }

  // One 2px line per run, with a crosshair that reads every line at the nearest step.
  function drawLines(list, frame, tip, unit) {
    const g = lineGeometry(list, chart.metric), svg = chartSvg(`${chart.metric} by step, one line per run`);
    axes(svg, g.yTicks, { xTicks: g.xTicks, xLabel: 'step', yLabel: `${chart.metric}${unit ? ` (${unit})` : ''}` });
    for (const line of g.lines) svg.append(svgEl('path', { d: line.d, stroke: colourOf(list, line.id), class: 'rv-line' }));
    // Each line named at its end when there are at most four.
    // Labels at the lines' ends are nudged apart so two that end close together don't overlap.
    if (g.lines.length <= 4) {
      const ends = g.lines.map(line => ({ line, end: line.points.at(-1), y: line.points.at(-1).y - 6 })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
      // and kept inside the plot: pushed past its floor, they move back up together.
      if (ends.length) { ends.at(-1).y = Math.min(ends.at(-1).y, g.y0 - 4); for (let i = ends.length - 2; i >= 0; i--) ends[i].y = Math.min(ends[i].y, ends[i + 1].y - 13); }
      for (const { line, end, y } of ends) { const run = list.find(r => r.id === line.id); const name = svgEl('text', { x: Math.min(end.x + 6, CHART.w - CHART.right - 24), y, class: 'rv-value' }); name.textContent = run.label || run.id; svg.append(name); }
    }
    const cross = svgEl('line', { y1: g.y1, y2: g.y0, class: 'rv-cross', visibility: 'hidden' }), dots = g.lines.map(line => svgEl('circle', { r: 4, fill: colourOf(list, line.id), class: 'rv-mark', visibility: 'hidden' }));
    svg.append(cross, ...dots);
    const hit = svgEl('rect', { x: g.x0, y: g.y1, width: g.x1 - g.x0, height: g.y0 - g.y1, class: 'rv-hit' });
    hit.onmousemove = event => {
      const box = svg.getBoundingClientRect(), px = (event.clientX - box.left) * (CHART.w / box.width), step = g.stepAt(px);
      const read = g.lines.map(line => ({ line, point: nearestStep(line.points, step) }));
      const at = read[0]?.point; if (!at) return;
      cross.setAttribute('x1', at.x); cross.setAttribute('x2', at.x); cross.setAttribute('visibility', 'visible');
      read.forEach(({ point }, i) => { dots[i].setAttribute('cx', point.x); dots[i].setAttribute('cy', point.y); dots[i].setAttribute('visibility', 'visible'); });
      showTip(frame, tip, svg, at.x, Math.min(...read.map(r => r.point.y)), [['', `step ${shortValue(at.step)}`], ...read.map(({ line, point }) => { const run = list.find(r => r.id === line.id); return [colourOf(list, line.id), `${run.label || run.id}: ${metricText(point.value, unit)}`]; })]);
    };
    hit.onmouseleave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); for (const dot of dots) dot.setAttribute('visibility', 'hidden'); };
    svg.append(hit);
    return svg;
  }

  // Side by side: a column per run, every parameter and metric, what differs marked; or only what differs.
  function compareTable(list) {
    const { params, metrics } = compareRows(list);
    const holder = section('Side by side');
    const toggle = el('label', 'rv-toggle'), box = el('input'); box.type = 'checkbox'; box.checked = onlyDiffer;
    box.onchange = () => { onlyDiffer = box.checked; drawCompare(); };
    toggle.append(box, el('span', '', 'Only what differs'));
    const table = el('table', 'rv-table rv-side');
    const headRow = el('tr'); headRow.append(el('th'));
    for (const run of list) { const th = el('th'), sw = el('span', 'rv-swatch'); sw.style.background = colourOf(list, run.id); th.append(sw, el('span', '', run.label || run.id)); headRow.append(th); }
    const thead = el('thead'); thead.append(headRow);
    const tbody = el('tbody');
    const group = (title, rows, show) => {
      const shownRows = rows.filter(row => !onlyDiffer || row.differs);
      if (!shownRows.length) return;
      const tr = el('tr', 'rv-group'), td = el('td', '', title); td.colSpan = list.length + 1; tr.append(td); tbody.append(tr);
      for (const row of shownRows) {
        const r = el('tr', row.differs ? 'rv-differs' : '');
        const name = el('th', '', row.name); if (row.differs) name.title = 'Differs between these runs';
        r.append(name, ...row.values.map(v => { const td = el('td', 'rv-num', show(v, row)); if (v !== undefined) td.title = String(v); return td; }));
        tbody.append(r);
      }
    };
    group('Parameters', params, v => (v === undefined ? '–' : shortValue(v)));
    group('Metrics', metrics, (v, row) => (v === undefined ? '–' : metricText(v, row.unit)));
    group('Run', [{ name: 'state', values: list.map(r => STATE_WORDS[r.state] || r.state), differs: !list.every(r => r.state === list[0].state) },
      { name: 'where', values: list.map(r => WHERE_WORDS[r.where?.kind] || 'This Mac'), differs: !list.every(r => r.where?.kind === list[0].where?.kind) },
      { name: 'time', values: list.map(r => duration(r.seconds)), differs: !list.every(r => duration(r.seconds) === duration(list[0].seconds)) },
      { name: 'commit', values: list.map(r => (r.code?.commit || '').slice(0, 10) + (r.code?.dirty ? ' + changes' : '')), differs: !list.every(r => r.code?.commit === list[0].code?.commit && Boolean(r.code?.dirty) === Boolean(list[0].code?.dirty)) }], v => v || '–');
    table.append(thead, tbody);
    const wrap = el('div', 'rv-table-wrap rv-flat'); wrap.append(table);
    holder.append(toggle, wrap);
    if (!tbody.children.length) holder.append(el('p', 'rv-faint', 'These runs don’t differ in anything recorded.'));
    return holder;
  }

  // The pool needs WebGL2; without it the panel keeps its own background.
  function makeWater() {
    let made = null;
    try { made = runsWater(canvas, { mode: saved.mode, theme: saved.theme }); } catch { canvas.remove(); }
    water = made; drawPool();
    return made;
  }

  function setShown(value) {
    if (shown === value) return;
    shown = value;
    root.hidden = !value;
    document.documentElement.classList.toggle('runs-open', value);
    sidebarButton?.classList.toggle('current', value);
    sidebarButton?.setAttribute('aria-pressed', String(value));
    if (value) syncWater(); else { view &&= view; syncWater(); }
    (value ? onShow : onHide)();
  }

  return {
    // Shown again where it was left, read afresh: a run that ran meanwhile shows.
    show() { const was = view; setShown(true); if (was === 'projects' || !project) void showProjects(); else void openProject(project, { keep: true }).then(() => { if (was === 'run' && view === 'project' && runs.some(r => r.id === runId)) openRun(runId); else if (was === 'compare' && view === 'project') drawCompare(); }); },
    hide() { setShown(false); },
    toggle() { if (shown) this.hide(); else this.show(); },
    shown: () => shown,
    // Opens a project, and a run in it if given (a run's citation, from stage 5).
    async open(folder, id = '') { setShown(true); await openProject(folder); if (id) openRun(id); },
  };
}
