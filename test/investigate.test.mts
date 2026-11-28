import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectLiteratureItems,
  collectPaperEvidence,
  defaultWebScout,
  parseInvestigateCommand,
  runInvestigate,
  type ActivityRowInput,
} from '../desktop/investigate.mjs';
import { linkCitations } from '../desktop/work-citations.mjs';
import { webSources } from '../src/web-sources.js';

test('parseInvestigateCommand parses /investigate questions accurately', () => {
  assert.deepEqual(parseInvestigateCommand('/investigate how does RoPE extrapolate?'), {
    matched: true,
    question: 'how does RoPE extrapolate?',
  });
  assert.deepEqual(parseInvestigateCommand('  /INVESTIGATE  '), {
    matched: true,
    question: '',
  });
  assert.deepEqual(parseInvestigateCommand('/review check diff'), {
    matched: false,
    question: '',
  });
  assert.deepEqual(parseInvestigateCommand('investigate this without slash'), {
    matched: false,
    question: '',
  });
});

test('runInvestigate fans out code, web, and notes/papers scouts in parallel and passes tools: [] to lead', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-investigate-')));
  try {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'attention.py'), 'def rope():\n  return 1\n', 'utf8');

    const started: string[] = [];
    let releaseAll!: () => void;
    const gate = new Promise<void>(resolve => { releaseAll = resolve; });
    let leadArgs: any = null;

    const task = runInvestigate({
      question: 'How does RoPE extrapolation behave?',
      root: dir,
      runCodeScout: async () => {
        started.push('code');
        await gate;
        return { summary: 'Defined in [attention.py line 1](src/attention.py#L1).' };
      },
      runWebScout: async ({ question, signal, onRow }) => {
        started.push('web');
        await gate;
        return defaultWebScout({
          searchWeb: async () => ({
            results: [{ title: 'YaRN Paper', url: 'https://arxiv.org/abs/2309.00071', snippet: 'NTK-by-parts' }],
            text: '',
          }),
          readPage: async ({ url }) => ({
            url,
            title: 'YaRN: Efficient Context Window Extension',
            text: 'YaRN combines temperature scaling with NTK-by-parts interpolation.',
          }),
          question,
          signal,
          onRow,
        });
      },
      searchNotes: async () => {
        started.push('notes');
        await gate;
        return {
          hits: [{
            id: 'n1',
            question: 'Scaling RoPE notes',
            answer: 'Base frequency 10000 needs NTK scaling beyond 4k.',
            path: '/notes/rope.md',
            line: 14,
            source: 'lyra-file://notes-root/rope.md#L14',
            score: 0.9,
          }],
        };
      },
      listPapers: async () => {
        started.push('papers');
        return {
          literatureItems: [{ id: '2309.00071', title: 'YaRN', year: 2023, url: 'https://arxiv.org/abs/2309.00071', abstract: 'RoPE context window extension.' }],
          watcherPapers: [],
        };
      },
      runLead: async (args) => {
        leadArgs = args;
        return {
          text: [
            '## Answer',
            'YaRN uses NTK-by-parts scaling ([attention.py line 1](src/attention.py#L1)).',
            '',
            '## Sources & Evidence',
            '- [YaRN: Efficient Context Window Extension](https://arxiv.org/abs/2309.00071)',
            '- [Scaling RoPE notes](lyra-file://notes-root/rope.md#L14)',
            '',
            '## What could not be confirmed',
            '- Benchmarks beyond 128k context were not verified locally.',
          ].join('\n'),
        };
      },
      linkCitations,
    });

    // Wait briefly so all async scouts reach the concurrency gate simultaneously.
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(started.includes('code'), 'code scout should start concurrently');
    assert.ok(started.includes('web'), 'web scout should start concurrently');
    assert.ok(started.includes('notes'), 'notes scout should start concurrently');
    assert.ok(started.includes('papers'), 'papers lookup should start concurrently');

    releaseAll();
    const res = await task;

    assert.ok(leadArgs, 'lead should be called');
    assert.deepEqual(leadArgs.tools, []);
    assert.match(leadArgs.dossier, /YaRN combines temperature scaling/);
    assert.match(leadArgs.dossier, /Base frequency 10000/);

    // linkCitations turned repo relative link into lyra-file:// citation while keeping web & note URLs intact.
    assert.match(res.text, /\[attention\.py line 1\]\(lyra-file:\/\/[0-9a-f-]+\/[A-Za-z0-9_-]+\?line=1\)/);
    assert.match(res.text, /https:\/\/arxiv\.org\/abs\/2309\.00071/);
    assert.match(res.text, /lyra-file:\/\/notes-root\/rope\.md#L14/);

    // Activity rows include done web-read URL usable by Sources panel (webSources).
    const sources = webSources([{ role: 'assistant', activity: res.activity as any }]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, 'https://arxiv.org/abs/2309.00071');
    assert.equal(sources[0].site, 'arxiv.org');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runInvestigate reports failed or skipped scouts in gaps passed to lead', async () => {
  let seenDossier = '';
  const res = await runInvestigate({
    question: 'Does custom kernel work on MPS?',
    root: '',
    runWebScout: async () => { throw new Error('Network offline'); },
    searchNotes: async () => ({ hits: [] }),
    listPapers: async () => ({ literatureItems: [], watcherPapers: [] }),
    runLead: async ({ prompt }) => {
      seenDossier = prompt;
      return '## Answer\nUnable to verify online.\n\n## Sources & Evidence\n- None.\n\n## What could not be confirmed\n- Web search failed (Network offline).\n- No project folder open.';
    },
  });

  assert.equal(res.scouts.code!.status, 'skipped');
  assert.equal(res.scouts.web!.status, 'failed');
  assert.ok(res.gaps.some(g => g.includes('Project code search skipped')));
  assert.ok(res.gaps.some(g => g.includes('Network offline')));
  assert.match(seenDossier, /Web scout failed: Network offline/);
});

test('defaultWebScout marks failed/redirected reads in gaps while preserving readable pages', async () => {
  const rows: ActivityRowInput[] = [];
  const out = await defaultWebScout({
    question: 'flash attention 3',
    searchWeb: async () => ({
      results: [
        { title: 'Good', url: 'https://example.org/fa3', snippet: 'good snippet' },
        { title: 'Bad', url: 'https://example.org/blocked', snippet: 'bad snippet' },
      ],
      text: '',
    }),
    readPage: async ({ url }) => {
      if (url.endsWith('/blocked')) throw new Error('Timed out');
      return { url, title: 'FA3 Blog', text: 'Warp-specialization increases FP8 throughput.' };
    },
    onRow: r => { rows.push({ ...r }); return r as any; },
  });

  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].url, 'https://example.org/fa3');
  assert.equal(out.gaps.length, 1);
  assert.match(out.gaps[0], /Timed out/);
  assert.ok(rows.some(r => r.tool === 'web-read' && r.status === 'done' && r.summary === 'https://example.org/fa3'));
});

test('collectLiteratureItems & collectPaperEvidence gather research literature.json and watcher papers', async () => {
  const researchDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-lit-')));
  try {
    await mkdir(join(researchDir, 'inv-1'), { recursive: true });
    await writeFile(join(researchDir, 'inv-1', 'literature.json'), JSON.stringify([
      { id: '2405.00001', title: 'FlashAttention-3', year: 2024, url: 'https://arxiv.org/abs/2405.00001', abstract: 'Asynchronous Hopper tensor cores.' },
      { id: '2101.00002', title: 'Unrelated Study', year: 2021, url: 'https://arxiv.org/abs/2101.00002', abstract: 'Botany image dataset.' },
    ]), 'utf8');

    const lit = await collectLiteratureItems(researchDir);
    assert.equal(lit.length, 2);

    const evidence = collectPaperEvidence({
      question: 'Hopper FlashAttention throughput',
      literatureItems: lit,
      watcherPapers: [
        { id: '2406.99999', title: 'Hopper Kernel Scheduling', url: 'https://arxiv.org/abs/2406.99999', summary: 'Throughput study for Hopper kernels.' },
      ],
    });
    assert.equal(evidence.papers[0].title, 'FlashAttention-3');
    assert.ok(evidence.papers.some(p => p.id === '2406.99999'));
    assert.ok(!evidence.papers.some(p => p.id === '2101.00002'));
  } finally {
    await rm(researchDir, { recursive: true, force: true });
  }
});

test('/investigate wiring exists in desktop/main.cjs and src/app.js', async () => {
  const [mainSrc, appSrc] = await Promise.all([
    readFile(join(process.cwd(), 'build-ts', 'desktop', 'main.cjs'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'app.ts'), 'utf8'),
  ]);
  assert.match(mainSrc, /async function executeInvestigate\(/);
  assert.match(mainSrc, /async function driveWorkInvestigate\(/);
  assert.match(mainSrc, /parseInvestigateCommand/);
  assert.match(appSrc, /name:\s*'investigate'/);
  assert.match(appSrc, /\\\/investigate/);
});
