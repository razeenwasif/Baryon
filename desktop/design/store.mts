// Persistent storage for Baryon UI Design Mode projects, artboards, tokens, and seeded Stitch showcase.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AESTHETIC_PRESETS, renderDesignMarkdown } from './skill.mjs';
import type {
  CaptureEntry,
  CritiqueFeedback,
  DesignSpecInput,
  DesignTokens,
  PresetId,
  RepoScanSummary,
  StaticGateReport,
} from './skill.mjs';

export interface DesignScreen {
  id: string;
  title: string;
  viewport: string;
  width: number;
  height: number;
  x: number;
  y: number;
  html: string;
  reactCode: string;
  notes: string;
  staticGate?: StaticGateReport;
  critique?: CritiqueFeedback;
  captures?: CaptureEntry[];
  updatedAt: number;
  [key: string]: unknown;
}

export interface DesignTurn {
  id: string;
  at: number;
  prompt: string;
  provider: string;
  archetype: string;
  iterations: number;
  score: number;
  summary: string;
  [key: string]: unknown;
}

export interface DesignProject {
  id: string;
  name: string;
  folder: string;
  createdAt: number;
  updatedAt: number;
  spec: DesignSpecInput;
  designMd: string;
  repoScan: RepoScanSummary | null;
  screens: DesignScreen[];
  turns: DesignTurn[];
  [key: string]: unknown;
}

export interface DesignProjectSummary {
  id: string;
  name: string;
  folder: string;
  archetype: string;
  screenCount: number;
  updatedAt: number;
}

export interface DesignStoreOptions {
  root: string;
}

export interface CreateProjectOptions {
  name?: unknown;
  folder?: unknown;
  preset?: unknown;
}

export interface ScreenPositionInput {
  x?: unknown;
  y?: unknown;
}

export function checkDesignId(id: unknown): string {
  if (typeof id !== 'string') {
    throw new Error('Invalid design project or screen identifier.');
  }
  const clean = id.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(clean)) {
    throw new Error('Invalid design project or screen identifier.');
  }
  return clean;
}

export function slugifyDesignName(text: unknown, fallback = 'project'): string {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/**
 * Update :root CSS custom property values live inside an HTML document without disturbing layout rules.
 */
export function patchHtmlTokens(html: unknown, tokens: Record<string, unknown> = {}): string {
  let out = String(html || '');
  if (!out || !tokens || typeof tokens !== 'object') return out;
  const entries = Object.entries(tokens).filter(([k, v]) => /^--[a-z0-9_-]+$/i.test(k) && String(v || '').trim());
  if (!entries.length) return out;

  const rootMatch = /:root\s*\{([\s\S]*?)\}/i.exec(out);
  if (rootMatch) {
    let body = rootMatch[1];
    for (const [key, val] of entries) {
      const propRe = new RegExp(`(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*)([^;}\\n]+)(;?)`, 'i');
      if (propRe.test(body)) {
        body = body.replace(propRe, `$1${String(val).trim()}$3`);
      } else {
        body += `\n      ${key}: ${String(val).trim()};`;
      }
    }
    out = `${out.slice(0, rootMatch.index)}:root {${body}}${out.slice(rootMatch.index + rootMatch[0].length)}`;
  }
  return out;
}

function buildSeedDesktopHtml(tokens: DesignTokens): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aurelia — Editorial Telemetry Workspace</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-canvas: ${tokens['--bg-canvas']};
      --bg-surface: ${tokens['--bg-surface']};
      --bg-elevated: ${tokens['--bg-elevated']};
      --text-primary: ${tokens['--text-primary']};
      --text-secondary: ${tokens['--text-secondary']};
      --accent-primary: ${tokens['--accent-primary']};
      --border-subtle: ${tokens['--border-subtle']};
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      min-height: 100vh;
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      line-height: 1.55;
      overflow-x: hidden;
    }
    .shell { display: grid; grid-template-columns: 230px minmax(0, 1fr); min-height: 100vh; }
    nav {
      border-right: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      padding: 28px 20px;
      display: flex; flex-direction: column; justify-content: space-between; gap: 24px;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 10px; height: 10px; border-radius: 50%; background: var(--accent-primary); }
    .brand-name { font-family: 'Instrument Serif', serif; font-size: 24px; letter-spacing: -0.02em; }
    .nav-links { display: flex; flex-direction: column; gap: 6px; margin-top: 24px; }
    .nav-btn {
      text-align: left; background: transparent; border: 1px solid transparent; color: var(--text-secondary);
      padding: 9px 12px; border-radius: 8px; cursor: pointer; font: inherit; transition: transform 150ms ease, background 150ms ease;
    }
    .nav-btn.is-active, .nav-btn:hover { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border-subtle); }
    .nav-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    main { padding: 36px 44px; display: flex; flex-direction: column; gap: 28px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 22px; }
    .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-primary); }
    h1 { font-family: 'Instrument Serif', serif; font-size: clamp(32px, 4vw, 46px); font-weight: 400; letter-spacing: -0.03em; line-height: 1.05; margin-top: 6px; }
    .split { display: grid; grid-template-columns: 1.35fr 0.65fr; gap: 24px; align-items: start; }
    .panel {
      background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 24px;
      animation: riseIn 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .panel.delay { animation-delay: 80ms; }
    .stat-band { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
    .stat { border-top: 1px solid var(--border-subtle); padding-top: 14px; }
    .stat label { display: block; font-size: 11.5px; color: var(--text-secondary); }
    .stat strong { display: block; font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 4px; }
    .ledger { display: flex; flex-direction: column; }
    .ledger-row {
      display: grid; grid-template-columns: 1.2fr 0.7fr auto; gap: 12px; align-items: center;
      padding: 13px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .ledger-row:last-child { border-bottom: 0; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
    .cta {
      height: 36px; padding: 0 16px; border-radius: 9px; border: 1px solid var(--accent-primary);
      background: var(--accent-primary); color: var(--bg-canvas); font-weight: 600; cursor: pointer;
    }
    @keyframes riseIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 900px) { .shell, .split { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <nav aria-label="Workspace navigation">
      <div>
        <div class="brand"><span class="brand-mark"></span><span class="brand-name">Aurelia</span></div>
        <div class="nav-links" role="tablist">
          <button class="nav-btn is-active" role="tab" data-tab="overview">Overview</button>
          <button class="nav-btn" role="tab" data-tab="runs">Experiment Runs</button>
          <button class="nav-btn" role="tab" data-tab="tokens">Token Ledger</button>
        </div>
      </div>
      <div class="nav-meta">CLUSTER · FORGE-02 · HEALTHY</div>
    </nav>
    <main>
      <header>
        <div>
          <span class="eyebrow">01 / SYSTEM TELEMETRY</span>
          <h1>Editorial Precision Instrument</h1>
        </div>
        <button class="cta" type="button" id="refresh-btn">Reconcile Epoch</button>
      </header>
      <div class="split">
        <section class="panel" aria-label="Primary metrics">
          <div class="eyebrow">THROUGHPUT &amp; CACHE EFFICIENCY</div>
          <div class="stat-band">
            <div class="stat"><label>Effective Latency</label><strong id="lat-val">142 ms</strong></div>
            <div class="stat"><label>Cache Hit Share</label><strong>91.4%</strong></div>
            <div class="stat"><label>Active Evaluators</label><strong>04</strong></div>
          </div>
        </section>
        <section class="panel delay" aria-label="Recent sweeps">
          <div class="eyebrow">RECENT EPOCHS</div>
          <div class="ledger">
            <div class="ledger-row"><span>Epoch 48 · Contrast Audit</span><span class="mono">8.9 / 10</span><span class="mono">PASS</span></div>
            <div class="ledger-row"><span>Epoch 47 · Mobile 390px</span><span class="mono">8.6 / 10</span><span class="mono">PASS</span></div>
            <div class="ledger-row"><span>Epoch 46 · Typography Gate</span><span class="mono">8.4 / 10</span><span class="mono">PASS</span></div>
          </div>
        </section>
      </div>
    </main>
  </div>
  <script>
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
      });
    });
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      const el = document.getElementById('lat-val');
      if (el) el.textContent = el.textContent === '142 ms' ? '128 ms' : '142 ms';
    });
  </script>
</body>
</html>`;
}

function buildSeedMobileHtml(tokens: DesignTokens): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aurelia Mobile</title>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-canvas: ${tokens['--bg-canvas']};
      --bg-surface: ${tokens['--bg-surface']};
      --bg-elevated: ${tokens['--bg-elevated']};
      --text-primary: ${tokens['--text-primary']};
      --text-secondary: ${tokens['--text-secondary']};
      --accent-primary: ${tokens['--accent-primary']};
      --border-subtle: ${tokens['--border-subtle']};
    }
    * { box-sizing: border-box; margin: 0; }
    body { background: var(--bg-canvas); color: var(--text-primary); font-family: 'Plus Jakarta Sans', sans-serif; padding: 20px 18px 80px; }
    header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle); }
    .title { font-family: 'Instrument Serif', serif; font-size: 28px; letter-spacing: -0.02em; }
    .pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-primary); border: 1px solid var(--border-subtle); padding: 4px 10px; border-radius: 999px; }
    main { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }
    .card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 18px; }
    .metric { font-family: 'JetBrains Mono', monospace; font-size: 30px; margin-top: 6px; font-variant-numeric: tabular-nums; }
    .sub { font-size: 12.5px; color: var(--text-secondary); margin-top: 4px; }
    .btn { width: 100%; height: 42px; margin-top: 8px; border-radius: 10px; border: 0; background: var(--accent-primary); color: var(--bg-canvas); font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <header><span class="title">Aurelia</span><span class="pill">8.9 PASS</span></header>
  <main>
    <section class="card"><div class="sub">CACHE EFFICIENCY</div><div class="metric">91.4%</div><div class="sub">Forge-02 cluster synchronized</div></section>
    <section class="card"><div class="sub">ACTIVE EVALUATION</div><div class="metric">142 ms</div><button class="btn" type="button">Inspect Telemetry</button></section>
  </main>
</body>
</html>`;
}

function createSeedProject(): DesignProject {
  const preset = AESTHETIC_PRESETS.auto;
  const spec: DesignSpecInput = {
    preset: 'auto',
    archetype: preset.archetype,
    mood: preset.mood,
    typography: {
      display: preset.displayFont,
      body: preset.bodyFont,
      mono: preset.monoFont,
    },
    tokens: { ...preset.tokens },
    layout: {
      grid: 'Asymmetric 1.35fr / 0.65fr editorial telemetry workspace with fixed navigation rail',
      signatureDetail: '1px structural hairlines + warm gold telemetry dot + Instrument Serif display titles',
      responsiveStrategy: 'Desktop 1440px dual-column view collapses cleanly into single-column mobile sheet at 390px',
    },
    states: ['default', 'interactive-tabs', 'empty', 'loading'],
    bans: ['No Inter/Roboto/Arial defaults', 'No purple-blue SaaS gradients', 'No uniform 3-card hero grids'],
  };
  const designMd = renderDesignMarkdown(spec, 'Aurelia Editorial Telemetry');
  const now = Date.now();
  return {
    id: 'aurelia-studio',
    name: 'Aurelia Telemetry Studio',
    folder: '',
    createdAt: now,
    updatedAt: now,
    spec,
    designMd,
    repoScan: null,
    screens: [
      {
        id: 'scr-desktop-1',
        title: 'Editorial Overview',
        viewport: 'desktop',
        width: 1440,
        height: 900,
        x: 60,
        y: 64,
        html: buildSeedDesktopHtml(preset.tokens),
        reactCode: `export function AureliaOverview() {\n  return (\n    <main className="aurelia-shell">\n      <header><h1>Editorial Precision Instrument</h1></header>\n      <section className="aurelia-split">...</section>\n    </main>\n  );\n}`,
        notes: 'Seeded Stitch showcase project obeying DESIGN.md tokens and contrast rules.',
        staticGate: { passed: true, errors: [], warnings: [], metrics: { rawHexOutsideRoot: 0, textContrast: 18.2, accentContrast: 8.6, tokenCount: 7, bannedFontsFound: [] } },
        critique: {
          scores: { designQuality: 9.0, originality: 8.8, craft: 8.9, functionality: 8.8 },
          weightedTotal: 8.89,
          threshold: 8.0,
          passed: true,
          strengths: ['Warm editorial Instrument Serif + tabular JetBrains Mono hierarchy with clean 1px hairlines.'],
          criticalIssues: [],
        },
        captures: [],
        updatedAt: now,
      },
      {
        id: 'scr-mobile-1',
        title: 'Mobile Companion',
        viewport: 'mobile',
        width: 390,
        height: 844,
        x: 640,
        y: 64,
        html: buildSeedMobileHtml(preset.tokens),
        reactCode: `export function AureliaMobile() {\n  return <main className="aurelia-mobile">...</main>;\n}`,
        notes: 'Responsive 390x844 paired companion screen.',
        staticGate: { passed: true, errors: [], warnings: [], metrics: { rawHexOutsideRoot: 0, textContrast: 18.2, accentContrast: 8.6, tokenCount: 7, bannedFontsFound: [] } },
        critique: {
          scores: { designQuality: 8.8, originality: 8.6, craft: 9.0, functionality: 8.5 },
          weightedTotal: 8.74,
          threshold: 8.0,
          passed: true,
          strengths: ['Zero overflow on 390px viewport with consistent warm obsidian palette.'],
          criticalIssues: [],
        },
        captures: [],
        updatedAt: now,
      },
    ],
    turns: [
      {
        id: 'turn-seed-1',
        at: now,
        prompt: 'Design an editorial dark-mode research telemetry workspace paired with a 390px mobile companion.',
        provider: 'claude',
        archetype: preset.archetype,
        iterations: 1,
        score: 8.89,
        summary: 'Synthesized DESIGN.md with Instrument Serif + Plus Jakarta Sans + JetBrains Mono and generated paired desktop/mobile artboards.',
      },
    ],
  };
}

export class DesignStore {
  root: string;
  projectsDir: string;
  seeded: boolean;

  constructor({ root }: DesignStoreOptions) {
    if (!root) throw new Error('DesignStore requires root.');
    this.root = root;
    this.projectsDir = join(root, 'projects');
    this.seeded = false;
  }

  projectDir(id: string): string {
    return join(this.projectsDir, checkDesignId(id));
  }

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    await mkdir(this.projectsDir, { recursive: true });
    const entries = await readdir(this.projectsDir, { withFileTypes: true }).catch(() => []);
    if (!entries.some(e => e.isDirectory())) {
      await this.saveProject(createSeedProject());
    }
    this.seeded = true;
  }

  async listProjects(): Promise<DesignProjectSummary[]> {
    await this.ensureSeeded();
    const entries = await readdir(this.projectsDir, { withFileTypes: true }).catch(() => []);
    const out: DesignProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const proj = await this.getProject(entry.name).catch(() => null);
      if (proj) {
        out.push({
          id: proj.id,
          name: proj.name,
          folder: proj.folder || '',
          archetype: proj.spec?.archetype || '',
          screenCount: proj.screens?.length || 0,
          updatedAt: proj.updatedAt || 0,
        });
      }
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async getProject(id: string): Promise<DesignProject | null> {
    await this.ensureSeeded();
    const dir = this.projectDir(id);
    const jsonPath = join(dir, 'project.json');
    if (!existsSync(jsonPath)) return null;
    return JSON.parse(await readFile(jsonPath, 'utf8')) as DesignProject;
  }

  async saveProject(project: DesignProject): Promise<DesignProject> {
    const id = checkDesignId(project?.id);
    const dir = this.projectDir(id);
    await mkdir(dir, { recursive: true });
    const next: DesignProject = { ...project, id, updatedAt: Date.now() };
    await writeFile(join(dir, 'project.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    if (next.designMd) {
      await writeFile(join(dir, 'DESIGN.md'), `${next.designMd}\n`, 'utf8');
    }
    return next;
  }

  async createProject({ name, folder = '', preset = 'auto' }: CreateProjectOptions = {}): Promise<DesignProject> {
    await this.ensureSeeded();
    const cleanName = String(name || 'Untitled Design').trim().slice(0, 80) || 'Untitled Design';
    const base = slugifyDesignName(cleanName, 'design');
    let id = base;
    let n = 2;
    while (existsSync(join(this.projectsDir, id))) id = `${base.slice(0, 56)}-${n++}`;

    const p = AESTHETIC_PRESETS[preset as PresetId] || AESTHETIC_PRESETS.auto;
    const spec: DesignSpecInput = {
      preset: p.id,
      archetype: p.archetype,
      mood: p.mood,
      typography: { display: p.displayFont, body: p.bodyFont, mono: p.monoFont },
      tokens: { ...p.tokens },
      layout: {
        grid: 'Asymmetric split with sticky primary controls',
        signatureDetail: '1px structural hairlines + tabular metrics',
        responsiveStrategy: 'Desktop 1440px adapts cleanly to 390px mobile without overflow',
      },
      states: ['default', 'loading', 'empty', 'interactive-tabs'],
      bans: ['No Inter/Roboto/Arial defaults', 'No purple-blue SaaS gradients', 'No uniform 3-card hero grids'],
    };
    const now = Date.now();
    return this.saveProject({
      id,
      name: cleanName,
      folder: String(folder || '').trim(),
      createdAt: now,
      updatedAt: now,
      spec,
      designMd: renderDesignMarkdown(spec, cleanName),
      repoScan: null,
      screens: [],
      turns: [],
    });
  }

  async deleteProject(id: string): Promise<{ deleted: string }> {
    await this.ensureSeeded();
    const clean = checkDesignId(id);
    await rm(this.projectDir(clean), { recursive: true, force: true });
    return { deleted: clean };
  }

  async updateScreenPosition(projectId: string, screenId: string, { x, y }: ScreenPositionInput = {}): Promise<DesignProject> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Design project not found.');
    const cleanScreen = checkDesignId(screenId);
    const screen = (project.screens || []).find(s => s.id === cleanScreen);
    if (!screen) throw new Error('Screen not found.');
    screen.x = Math.round(Number(x) || 0);
    screen.y = Math.round(Number(y) || 0);
    screen.updatedAt = Date.now();
    return this.saveProject(project);
  }

  async duplicateScreen(projectId: string, screenId: string): Promise<DesignProject> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Design project not found.');
    const cleanScreen = checkDesignId(screenId);
    const source = (project.screens || []).find(s => s.id === cleanScreen);
    if (!source) throw new Error('Screen not found.');
    const copyId = checkDesignId(`scr-${Date.now().toString(36)}`);
    const copy: DesignScreen = {
      ...(JSON.parse(JSON.stringify(source)) as DesignScreen),
      id: copyId,
      title: `${source.title} (Copy)`.slice(0, 80),
      x: (Number(source.x) || 60) + 46,
      y: (Number(source.y) || 60) + 46,
      updatedAt: Date.now(),
    };
    project.screens = [...(project.screens || []), copy];
    return this.saveProject(project);
  }

  async deleteScreen(projectId: string, screenId: string): Promise<DesignProject> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Design project not found.');
    const cleanScreen = checkDesignId(screenId);
    project.screens = (project.screens || []).filter(s => s.id !== cleanScreen);
    return this.saveProject(project);
  }

  async applyTokens(projectId: string, tokens: Record<string, unknown> = {}): Promise<DesignProject> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Design project not found.');
    const cleanTokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(tokens || {})) {
      if (/^--[a-z0-9_-]{2,48}$/i.test(k) && String(v || '').trim()) {
        cleanTokens[k] = String(v).trim().slice(0, 64);
      }
    }
    project.spec = {
      ...(project.spec || {}),
      tokens: { ...(project.spec?.tokens || {}), ...cleanTokens },
    };
    project.designMd = renderDesignMarkdown(project.spec, project.name);
    project.screens = (project.screens || []).map(scr => ({
      ...scr,
      html: patchHtmlTokens(scr.html, cleanTokens),
      updatedAt: Date.now(),
    }));
    return this.saveProject(project);
  }

  async updateDesignMd(projectId: string, designMd: unknown): Promise<DesignProject> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Design project not found.');
    project.designMd = String(designMd || '').slice(0, 40_000);
    return this.saveProject(project);
  }
}
