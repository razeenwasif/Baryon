import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { designCalls } from '../desktop/design/calls.mjs';
import { captureDesignPreview } from '../desktop/design/capture.mjs';
import { computeWeightedScore, evaluateDesign } from '../desktop/design/evaluator.mjs';
import { runDesignGeneration } from '../desktop/design/orchestrator.mjs';
import { scanRepoDesignSystem } from '../desktop/design/scanner.mjs';
import { renderDesignMarkdown, validateDesignSpec } from '../desktop/design/skill.mjs';
import { contrastRatio, runStaticGate } from '../desktop/design/static-gate.mjs';
import { DesignStore, patchHtmlTokens } from '../desktop/design/store.mjs';

test('scanRepoDesignSystem ingests DESIGN.md, Tailwind config, CSS variables, fonts, components, and rejects traversal', async t => {
  const home = await mkdtemp(join(tmpdir(), 'baryon-design-scan-'));
  t.after(() => rm(home, { recursive: true, force: true }));

  const repo = join(home, 'demo-app');
  await mkdir(join(repo, 'src/components/ui'), { recursive: true });
  await writeFile(join(repo, 'DESIGN.md'), '# DESIGN.md\nMatte paper editorial system.\n');
  await writeFile(join(repo, 'tailwind.config.ts'), 'export default { content: [] };\n');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' } }));
  await writeFile(
    join(repo, 'src/globals.css'),
    `:root { --bg-canvas: #0b0b0e; --accent-primary: #18b8cc; }\nbody { font-family: 'Fraunces', serif; }\n`,
  );
  await writeFile(join(repo, 'src/components/ui/Button.tsx'), 'export const Button = () => null;');

  const scan = await scanRepoDesignSystem(repo, { home });
  assert.equal(scan.hasDesignMd, true);
  assert.equal(scan.tailwindConfigFound, true);
  assert.ok(scan.stack.includes('react'));
  assert.equal(scan.tokens['--bg-canvas'], '#0b0b0e');
  assert.equal(scan.tokens['--accent-primary'], '#18b8cc');
  assert.ok(scan.fonts.includes('Fraunces'));
  assert.ok(scan.components.includes('Button'));

  await assert.rejects(() => scanRepoDesignSystem(join(repo, '../etc'), { home }), /inside your home|does not exist|cannot contain/);
  await assert.rejects(() => scanRepoDesignSystem('/etc/passwd', { home }), /does not exist|inside your home/);
});

test('validateDesignSpec enforces aesthetic direction, bans Inter/Roboto defaults, and renders DESIGN.md', () => {
  const bad = validateDesignSpec({
    archetype: 'Generic App',
    typography: { display: 'Inter', body: 'Roboto', mono: 'JetBrains Mono' },
    tokens: { '--bg-canvas': '#ffffff' },
  } as any);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some(e => e.includes('Inter')));
  assert.ok(bad.errors.some(e => e.includes('Roboto')));
  assert.ok(bad.errors.some(e => e.includes('--accent-primary')));

  const goodSpec = {
    archetype: 'Precision Dark Instrument',
    mood: 'Matte obsidian metal wells with machined 1px borders',
    typography: { display: 'Instrument Serif', body: 'Plus Jakarta Sans', mono: 'JetBrains Mono' },
    tokens: {
      '--bg-canvas': '#09090b',
      '--bg-surface': '#111114',
      '--bg-elevated': '#18181d',
      '--text-primary': '#f4f4f6',
      '--text-secondary': '#a1a1aa',
      '--accent-primary': '#18b8cc',
      '--border-subtle': '#27272f',
    },
  };
  const good = validateDesignSpec(goodSpec);
  assert.equal(good.valid, true);
  const md = renderDesignMarkdown(good.normalized as any, 'Telemetry Studio');
  assert.match(md, /Instrument Serif/);
  assert.match(md, /--accent-primary/);
});

test('runStaticGate enforces Token Lock, banned font checks, JS syntax, and WCAG contrast', () => {
  assert.ok(contrastRatio('#f4f4f6', '#09090b')! > 15);

  const sloppyHtml = `<!doctype html><html><head><style>
    :root { --bg-canvas: #09090b; --text-primary: #f4f4f6; }
    body { font-family: 'Inter', sans-serif; color: #ff00aa; background: #112233; border: 1px solid #445566; }
    .card { box-shadow: 0 2px #778899; }
  </style></head><body><div>Hello</div></body></html>`;

  const fail = runStaticGate({ html: sloppyHtml, enforceTokenLock: true });
  assert.equal(fail.passed, false);
  assert.ok(fail.errors.some(e => e.includes('Token Lock')));
  assert.ok(fail.errors.some(e => e.includes('banned font')));

  const cleanHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root { --bg-canvas: #09090b; --bg-surface: #111114; --text-primary: #f4f4f6; --accent-primary: #18b8cc; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; color: var(--text-primary); background: var(--bg-canvas); }
  </style></head><body><main><h1>Clean</h1></main></body></html>`;

  const pass = runStaticGate({ html: cleanHtml, enforceTokenLock: true });
  assert.equal(pass.passed, true);
  assert.equal(pass.errors.length, 0);
});

test('computeWeightedScore, runDesignGeneration critique refinement loop, and DesignStore CRUD work end to end', async t => {
  assert.equal(computeWeightedScore({ designQuality: 9, originality: 8, craft: 8.5, functionality: 8 }), 8.45);

  const capSkip = await captureDesignPreview({ html: '<html></html>', BrowserWindowCtor: null });
  assert.equal(capSkip.available, false);

  const root = await mkdtemp(join(tmpdir(), 'baryon-design-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new DesignStore({ root });
  const initialList = await store.listProjects();
  assert.ok(initialList.some(p => p.id === 'aurelia-studio'), 'seeded starter project must exist');

  const seeded = await store.getProject('aurelia-studio');
  const patchedHtml = patchHtmlTokens(seeded!.screens[0].html, { '--accent-primary': '#34d399' });
  assert.ok(patchedHtml.includes('--accent-primary: #34d399;'));

  const proj = await store.createProject({ name: 'Swiss Monitor', preset: 'swiss' });
  assert.ok(existsSync(join(root, 'projects', proj.id, 'DESIGN.md')));

  let genCallCount = 0;
  let evalCallCount = 0;
  const events: any[] = [];

  const cleanGeneratedHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root { --bg-canvas: #050608; --bg-surface: #0b0d11; --text-primary: #f0f3f8; --text-secondary: #8892a4; --accent-primary: #34d399; --border-subtle: #1e2430; }
    body { background: var(--bg-canvas); color: var(--text-primary); font-family: 'IBM Plex Sans', sans-serif; }
  </style></head><body><main><button type="button">Filter</button></main></body></html>`;

  const mockAskAI = async ({ instructions }: { instructions: string }) => {
    if (instructions.includes('Phase 1')) {
      return {
        provider: 'claude',
        model: 'claude-sonnet',
        text: JSON.stringify({
          title: 'Swiss Telemetry',
          archetype: 'Swiss Grid Utility',
          mood: 'Crisp hairline rules on dark stone',
          preset: 'swiss',
          typography: { display: 'Syne', body: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
          tokens: {
            '--bg-canvas': '#050608',
            '--bg-surface': '#0b0d11',
            '--bg-elevated': '#131720',
            '--text-primary': '#f0f3f8',
            '--text-secondary': '#8892a4',
            '--accent-primary': '#34d399',
            '--border-subtle': '#1e2430',
          },
        }),
      };
    }
    if (instructions.includes('Phase 2')) {
      genCallCount++;
      return {
        provider: 'claude',
        model: 'claude-sonnet',
        text: JSON.stringify({
          summary: `Iteration ${genCallCount} build.`,
          screens: [
            { title: 'Grid Overview', viewport: 'desktop', html: cleanGeneratedHtml, reactCode: 'export function Grid() { return <main />; }' },
            { title: 'Grid Mobile', viewport: 'mobile', html: cleanGeneratedHtml },
          ],
        }),
      };
    }
    evalCallCount++;
    if (evalCallCount === 1) {
      return {
        provider: 'antigravity',
        model: 'gemini-3-pro',
        text: JSON.stringify({
          scores: { designQuality: 7.0, originality: 7.0, craft: 7.5, functionality: 7.5 },
          criticalIssues: ['Hero spacing feels flat; heighten typographic contrast.'],
        }),
      };
    }
    return {
      provider: 'antigravity',
      model: 'gemini-3-pro',
      text: JSON.stringify({
        scores: { designQuality: 9.0, originality: 8.8, craft: 8.7, functionality: 8.8 },
        strengths: ['Crisp asymmetric hierarchy'],
        criticalIssues: [],
      }),
    };
  };

  const out = await runDesignGeneration({
    store,
    projectId: proj.id,
    prompt: 'Build a Swiss grid energy telemetry console',
    platform: 'responsive',
    maxIterations: 3,
    askAI: mockAskAI,
    capturePreview: (async () => ({
      available: true,
      captures: [{ name: 'desktop', width: 1440, height: 900, dataUrl: 'data:image/png;base64,AA==', overflowX: false, interactiveCount: 1, consoleErrors: [] }],
      consoleErrors: [],
      hasOverflow: false,
    })) as any,
    onEvent: evt => events.push(evt),
  });

  assert.equal(out.iterations, 2, 'should stop once iteration 2 passes >= 8.0');
  assert.equal(genCallCount, 2);
  assert.equal(evalCallCount, 2);
  assert.equal(out.critique.passed, true);
  assert.ok(out.critique.weightedTotal >= 8.8);
  assert.equal(out.project.screens.length, 2);
  assert.ok(events.some(e => e.phase === 'spec'));
  assert.ok(events.some(e => e.phase === 'capture'));
  assert.ok(events.some(e => e.phase === 'critique'));

  // Test evaluator offline fallback
  const fallback = await evaluateDesign({ html: cleanGeneratedHtml, staticGate: { passed: true, errors: [], warnings: [], metrics: {} } as any });
  assert.equal(fallback.passed, true);

  // Test designCalls validation & exportToRepo confinement
  const workDir = join(root, 'work-repo');
  await mkdir(workDir, { recursive: true });
  const calls = designCalls({ store, askAI: mockAskAI, getWorkFolder: () => workDir, home: root });
  await assert.rejects(() => calls.getProject('../escape'), /Invalid design/);
  await assert.rejects(() => calls.exportToRepo({ projectId: proj.id, subdir: '../escape' }), /Invalid export/);

  const exp = await calls.exportToRepo({ projectId: proj.id, subdir: 'design-out' });
  assert.equal(exp.ok, true);
  assert.ok(existsSync(join(workDir, 'DESIGN.md')));
  const exportedHtml = await readFile(join(workDir, exp.files.find(f => f.endsWith('.html'))!), 'utf8');
  assert.match(exportedHtml, /--bg-canvas/);

  const repoRoot = resolve(new URL('..', import.meta.url).pathname);
  const designTsx = await readFile(join(repoRoot, 'src/design/DesignApp.tsx'), 'utf8');
  const designCss = await readFile(join(repoRoot, 'src/design-view.css'), 'utf8');
  for (const token of ['leftOpen', 'inspectorOpen', 'no-left', 'no-inspector', 'ds-float-toggle']) {
    assert.ok(designTsx.includes(token), `DesignApp.tsx must include ${token}`);
  }
  assert.ok(designCss.includes('.no-left') && designCss.includes('.no-inspector'), 'design-view.css must style hidden panel states');
});
