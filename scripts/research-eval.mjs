// Research evals (desktop/research/evals.mjs, stage 8.9): scripted rounds on fixed questions, scored on hypothesis quality
// and review agreement, so a prompt or model change can be compared with the run before it.
//
//   node scripts/research-eval.mjs --list                          the tasks
//   node scripts/research-eval.mjs score <investigation> --task sky-violet   score a folder you have, no model
//   node scripts/research-eval.mjs plan [--task …] [--seats …]      what a run would do, and its call cap, no model
//   node scripts/research-eval.mjs run --seats claude,antigravity [--task sky-violet,ice-floats] [--calls 12]
//        [--model claude=claude-sonnet-5-5 --model antigravity=gemini-4-argon-low] [--fast off]
//   node scripts/research-eval.mjs compare .local-data/evals/research-<a>.json .local-data/evals/research-<b>.json
//
// A run makes one investigation per task in .local-data/research-evals/<time>/ (never your own Research folder), pins
// its seats, models and call cap in investigation.json, and runs one round through Fairy's own driver and connections
// on your subscriptions: it spends real allowance, at most --calls agent calls a task. DeepSeek sits only with
// DEEPSEEK_API_KEY set. There is no web search (the literature phase still reads arXiv and Crossref), and experiments
// stay proposed (the Lab isn't part of it). Results go to .local-data/evals/research-<time>.json.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RESEARCH_TASKS, taskById } from '../evals/research-tasks.mjs';
import { compareRuns, readRound, scoreRound, summarize } from '../desktop/research/evals.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEATS = ['claude', 'codex', 'antigravity', 'deepseek'];
const ROUND_LIMIT = 90 * 60_000;

export function parse(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    task: { type: 'string', default: '' }, seats: { type: 'string', default: '' }, model: { type: 'string', multiple: true, default: [] },
    calls: { type: 'string', default: '12' }, 'per-engine': { type: 'string', default: '2' }, fast: { type: 'string', default: 'on' }, out: { type: 'string', default: '' }, list: { type: 'boolean', default: false },
  } });
  const tasks = values.task ? values.task.split(',').map(id => taskById(id.trim()) ?? (() => { throw new Error(`No task ${id}. Try --list.`); })()) : RESEARCH_TASKS;
  const seats = values.seats ? values.seats.split(',').map(s => s.trim()) : [];
  for (const seat of seats) if (!SEATS.includes(seat)) throw new Error(`No seat ${seat}: ${SEATS.join(', ')}.`);
  const models = {};
  for (const pair of values.model) { const [seat, model] = pair.split('='); if (!SEATS.includes(seat) || !model) throw new Error(`--model is seat=model, as claude=claude-sonnet-5-5 (got ${pair}).`); models[seat] = model.trim(); }
  const calls = Number(values.calls), perEngine = Number(values['per-engine']);
  if (!Number.isInteger(calls) || calls < 4 || calls > 40) throw new Error('--calls is 4 to 40 a task.');
  if (!Number.isInteger(perEngine) || perEngine < 1 || perEngine > 4) throw new Error('--per-engine is 1 to 4.');
  if (!['on', 'off'].includes(values.fast)) throw new Error('--fast is on or off.');
  return { command: values.list ? 'list' : positionals[0] || 'plan', args: positionals.slice(1), tasks, seats, models, calls, perEngine, fast: values.fast === 'on', out: values.out };
}

// The investigation.json a task runs with: the seats asked for (the rest stood down), their models pinned, the call cap.
export function pinned(investigation, { seats, models, calls, perEngine }) {
  const kept = { ...investigation, budget: { ...(investigation.budget || {}), calls, per_engine: perEngine } };
  const table = Array.isArray(investigation.seats) ? investigation.seats.map(s => ({ ...s })) : [];
  for (const seat of SEATS) if (!table.some(s => s.seat === seat) && seats.includes(seat)) table.push({ seat, role: 'engineer', enabled: true });
  kept.seats = table.map(s => {
    const next = { ...s, enabled: seats.includes(s.seat) };
    if (models[s.seat]) next.model = models[s.seat]; else delete next.model;
    return next;
  });
  return kept;
}

// What a task's turns cost, from the token ledger's lines for its investigation.
export function spentOf(lines, seconds) {
  return { calls: lines.length, failed: lines.filter(l => l.failed).length, input: lines.reduce((n, l) => n + (l.reported?.input ?? l.sent ?? 0), 0), output: lines.reduce((n, l) => n + (l.reported?.output ?? 0), 0), seconds: Math.round(seconds) };
}

async function connections() {
  const work = join(root, '.local-data', 'research-evals', 'workspaces');
  for (const name of ['claude', 'codex', 'antigravity']) await mkdir(join(work, name), { recursive: true, mode: 0o700 });
  const codex = new (await import('../desktop/codex.mjs')).CodexConnection({ cwd: join(work, 'codex') });
  const claude = new (await import('../desktop/claude.mjs')).ClaudeConnection({ cwd: join(work, 'claude'), fallback: codex });
  const antigravity = new (await import('../desktop/antigravity.mjs')).AntigravityConnection({ cwd: join(work, 'antigravity'), fallback: codex });
  const core = await import('../desktop/core.mjs');
  const deepseek = process.env.DEEPSEEK_API_KEY ? new (await import('../desktop/research/deepseek.mjs')).DeepSeekConnection({ providers: () => new core.Providers({ deepseek: process.env.DEEPSEEK_API_KEY }) }) : null;
  return { claude, codex, antigravity, deepseek };
}

// Makes the investigation with a helper of its own, then lets it go, so the next one opens the pinned file.
export async function create(folder, task) {
  const { ResearchEngine } = await import('../desktop/research/engine.mjs'), { researchCalls } = await import('../desktop/research/calls.mjs'), { BINARY } = await import('../desktop/research/service.mjs');
  const events = [], engine = new ResearchEngine({ binary: BINARY, folder, onEvent: event => events.push(event) });
  try {
    await researchCalls({ engine }).create({ title: task.title, goal: task.goal, discipline: task.discipline, literature: true });
    const slug = events.filter(e => e.type === 'researchBoard' && e.slug).at(-1)?.slug ?? events.filter(e => e.type === 'researchList').at(-1)?.investigations?.find(i => i.title === task.title)?.slug;
    if (!slug) throw new Error(`The helper made no investigation for ${task.id}.`);
    return slug;
  } finally { await engine.stop(); }
}
export async function pin(dir, options) {
  const path = join(dir, 'investigation.json');
  await writeFile(path, `${JSON.stringify(pinned(JSON.parse(await readFile(path, 'utf8')), options), null, 2)}\n`);
}

// One round of one task, through Fairy's driver: { slug, dir, scores, spent } or { error }.
async function runTask(folder, task, options, providers) {
  const started = Date.now(), lines = [];
  const slug = await create(folder, task), dir = join(folder, slug);
  await pin(dir, options);
  const { researchService, BINARY } = await import('../desktop/research/service.mjs'), { researchCalls } = await import('../desktop/research/calls.mjs');
  let finish, seen = false;
  const ended = new Promise(resolve => { finish = resolve; });
  const service = researchService({ binary: BINARY, folder, providers, record: async line => { lines.push(line); }, prefs: { get: () => ({ fastMatches: options.fast }), set: async () => {} },
    onEvent: event => {
      if (event.type !== 'researchRound' || event.slug !== slug) return;
      const status = event.status?.status || 'idle';
      if (status === 'running') seen = true; else if (seen) finish(status);
    } });
  const timer = setTimeout(() => finish('timed out'), ROUND_LIMIT);
  try {
    await service.refreshSeats();
    const calls = researchCalls({ engine: service.engine });
    await calls.open(slug);
    await calls.start();
    const how = await ended;
    if (how === 'timed out') await calls.stop().catch(() => {});
    const scores = scoreRound(task, await readRound(dir));
    return { task: task.id, slug, dir, ended: how, scores, spent: spentOf(lines, (Date.now() - started) / 1000) };
  } catch (error) {
    return { task: task.id, slug, dir, error: error.message, spent: spentOf(lines, (Date.now() - started) / 1000) };
  } finally { clearTimeout(timer); await service.quit(); }
}

const pct = n => (n == null ? '–' : `${Math.round(n * 100)}%`);
export function describe(result) {
  if (result.error) return `${result.task}: failed, ${result.error}`;
  const q = { missed: [], mistakes: [], ...result.scores?.quality }, a = { ...result.scores?.agreement }, n = result.scores ?? {};
  return [`${result.task}: score ${q.score ?? '–'} · key ${pct(q.coverage)}${q.missed.length ? ` (missed: ${q.missed.join('; ')})` : ''}${q.mistakes.length ? ` · mistakes: ${q.mistakes.join('; ')}` : ''}`,
    `  falsifiable ${pct(q.falsifiable)} · reviewers ${pct(q.reviewScore)} · reviewers agree ${pct(a.withinOneStep)} of ${a.reviewerPairs ?? 0} · judges agree ${pct(a.judgesAgree)} of ${a.judgedMatches ?? 0}`,
    `  ${n.hypotheses ?? 0} live hypotheses, ${n.reviews ?? 0} reviews, ${n.matches ?? 0} matches${result.spent ? ` · ${result.spent.calls} calls${result.spent.failed ? ` (${result.spent.failed} failed)` : ''}, ${result.spent.input} in / ${result.spent.output} out tokens, ${result.spent.seconds}s` : ''}`].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (o.command === 'list') {
    for (const t of RESEARCH_TASKS) console.log(`${t.id}  ${t.title} (${t.discipline}) · key ${t.key.length} points, ${t.mistakes.length} mistake${t.mistakes.length === 1 ? '' : 's'}`);
  } else if (o.command === 'score') {
    if (!o.args[0] || o.tasks.length !== 1) { console.error('score <investigation folder> --task <id>'); process.exit(2); }
    console.log(describe({ task: o.tasks[0].id, scores: scoreRound(o.tasks[0], await readRound(o.args[0])) }));
  } else if (o.command === 'compare') {
    const [before, after] = await Promise.all(o.args.slice(0, 2).map(async path => JSON.parse(await readFile(path, 'utf8'))));
    const { rows, before: a, after: b } = compareRuns(before, after);
    const line = (name, run, s) => `${name}: ${run.commit} · ${Object.entries(run.models || {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'lead models'} · score ${s.score} · key ${pct(s.coverage)} · mistakes ${s.mistakes} · reviewers agree ${pct(s.withinOneStep)} · judges agree ${pct(s.judgesAgree)} · ${s.calls} calls, ${s.tokens.input} in / ${s.tokens.output} out, ${s.seconds}s`;
    console.log(line('before', before, a)); console.log(line('after ', after, b));
    for (const r of rows) console.log(`  ${r.task}: ${r.before ?? '–'} → ${r.after ?? '–'} (key ${pct(r.coverageBefore)} → ${pct(r.coverageAfter)}, reviewers agree ${pct(r.agreeBefore)} → ${pct(r.agreeAfter)})`);
  } else if (o.command === 'plan' || o.command === 'run') {
    if (!o.seats.length) { console.error('Say which seats sit: --seats claude,antigravity (each runs on your own subscription).'); process.exit(2); }
    console.log(`${o.tasks.length} task${o.tasks.length === 1 ? '' : 's'} (${o.tasks.map(t => t.id).join(', ')}), one round each, seats ${o.seats.map(s => (o.models[s] ? `${s}=${o.models[s]}` : s)).join(', ')}, at most ${o.calls} calls a task (${o.calls * o.tasks.length} in all), matches on fast models ${o.fast ? 'on' : 'off'}.`);
    if (o.command === 'plan') { console.log('Nothing run. The same with run instead of plan spends real allowance.'); process.exit(0); }
    const { BINARY } = await import('../desktop/research/service.mjs');
    if (!existsSync(BINARY)) { console.error('Build the research helper first: npm run build:research'); process.exit(1); }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'), folder = join(root, '.local-data', 'research-evals', stamp);
    await mkdir(folder, { recursive: true });
    const providers = await connections(), results = [];
    for (const task of o.tasks) { console.log(`\n${task.id}: running…`); const result = await runTask(folder, task, o, providers); results.push(result); console.log(describe(result)); }
    let commit = '';
    try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
    const run = { kind: 'research', at: new Date().toISOString(), commit, seats: o.seats, models: o.models, calls: o.calls, perEngine: o.perEngine, fast: o.fast, folder, results, summary: summarize(results) };
    const out = o.out || join(root, '.local-data', 'evals', `research-${stamp}.json`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(run, null, 2)}\n`);
    console.log(`\nSaved ${out}`);
  } else { console.error('research-eval.mjs --list | score | plan | run | compare'); process.exit(2); }
}
