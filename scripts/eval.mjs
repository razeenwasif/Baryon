// Runs Fairy's saved eval tasks against fake Calendar, Gmail, Drive and file backends, and saves the results so two
// runs can be compared. Real model runs go through the claude, agy and codex CLIs on your subscriptions; the default
// plays each task's scripted path instead, which uses no allowance and checks the evals themselves.
//
//   node scripts/eval.mjs                                   scripted, no model
//   node scripts/eval.mjs --provider claude [--model claude-opus-5-5] [--effort high]
//   node scripts/eval.mjs --provider gemini --task calendar-first-meeting,gmail-injection --repeat 2
//   node scripts/eval.mjs --provider claude --model claude-opus-5-5 --effort high --kind work   the orchestrator's baseline
//   node scripts/eval.mjs --provider claude --model claude-opus-5-5 --effort high --kind work --roles   helpers on their roles' models
//   node scripts/eval.mjs --provider claude --model claude-opus-5-5 --effort high --kind work --split   plan-shaped tasks led, steps built
//   GEMINI_API_KEY=… node scripts/eval.mjs --provider claude --kind work --orchestrator --repeat 2   as Fairy runs work: the
//     orchestrator picks each task's model and effort, plans and splits, and puts helpers on their roles (stage 5's run)
//   node scripts/eval.mjs --provider claude --model claude-opus-5-5 --effort high --hard [--way review|swarm]   Swarm's
//     measure: the hard tasks with one designer, with a Second opinion from Gemini, or as a swarm of Claude and Gemini.
//     --stand-in runs the other family's seats on --provider too, for a dry run while one is out of allowance.
//   node scripts/swarm-report.mjs   the three ways side by side
//   node scripts/eval.mjs --saved [--provider claude …] [--tag bugfix] [--task <id>]   the tasks saved from your own work
//     sessions (Fairy's data folder, evals/saved; --saved-dir to read another), each from its repository's commit
//   node scripts/eval.mjs --kinds maths,circuits --provider claude --model claude-opus-5-5   evals by kind (Auto by task,
//     stage 3): the tasks of each kind (evals/kind-tasks.mjs) on one model, the result written into Fairy's strengths
//     table (model-strengths.json, the evals layer) and the experiment tracker (Experiments → Evals by kind). A scripted
//     run writes nothing there unless --data names a data folder, so made-up passes never reach your table.
//   node scripts/eval.mjs --reliability [--provider claude --model claude-opus-5-5]   the four reliability evals
//     (evals/reliability-tasks.mjs): recorded in the experiment tracker (Experiments → Reliability evals) for a real
//     model or with --data, and kept apart from the by-kind sets so they never move Auto's strengths table.
//   node scripts/eval.mjs --list [--saved | --kinds code,maths | --reliability]
//   node scripts/eval.mjs compare .local-data/evals/<before>.json .local-data/evals/<after>.json
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ZONE, compareRuns, evalSettings, runSuite, scriptedProvider } from '../evals/runner.mjs';
import { TASKS } from '../evals/tasks.mjs';
import { SAVED_DIR, loadSaved } from '../evals/saved.mjs';

process.env.TZ = ZONE;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: {
  provider: { type: 'string', default: 'scripted' }, model: { type: 'string', default: '' }, effort: { type: 'string', default: '' },
  task: { type: 'string', default: '' }, kind: { type: 'string', default: '' }, repeat: { type: 'string', default: '1' }, out: { type: 'string', default: '' }, list: { type: 'boolean', default: false }, roles: { type: 'boolean', default: false }, split: { type: 'boolean', default: false }, orchestrator: { type: 'boolean', default: false },
  hard: { type: 'boolean', default: false }, way: { type: 'string', default: 'designer' }, 'stand-in': { type: 'boolean', default: false },
  saved: { type: 'boolean', default: false }, 'saved-dir': { type: 'string', default: '' }, tag: { type: 'string', default: '' },
  kinds: { type: 'string', default: '' }, reliability: { type: 'boolean', default: false }, data: { type: 'string', default: '' },
} });

if (positionals[0] === 'compare') {
  const [before, after] = await Promise.all(positionals.slice(1, 3).map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const { rows, changed, before: a, after: b } = compareRuns(before, after);
  const spent = (run, sum) => `${sum.tokens?.input ?? 0} in / ${sum.tokens?.output ?? 0} out tokens${sum.helpers?.turns ? `, helpers ${sum.helpers.tokens.input} in / ${sum.helpers.tokens.output} out` : ''}`;
  console.log(`before: ${before.provider} ${before.model || ''}${before.roles ? ' with roles' : ''} at ${before.commit}, ${a.passed}/${a.total} passed, ${a.seconds}s, ${a.toolCalls} tool calls, lead ${spent(before, a)}`);
  console.log(`after:  ${after.provider} ${after.model || ''}${after.roles ? ' with roles' : ''} at ${after.commit}, ${b.passed}/${b.total} passed, ${b.seconds}s, ${b.toolCalls} tool calls, lead ${spent(after, b)}`);
  for (const row of rows) console.log(`${row.before === row.after ? ' ' : row.after === 'pass' ? '+' : '-'} ${row.id.padEnd(28)} ${row.before.padEnd(4)} → ${row.after.padEnd(4)} ${row.seconds == null ? '' : `${row.seconds >= 0 ? '+' : ''}${row.seconds}s`} ${row.toolCalls == null ? '' : `${row.toolCalls >= 0 ? '+' : ''}${row.toolCalls} calls`}`);
  console.log(changed.length ? `${changed.length} task${changed.length === 1 ? '' : 's'} changed.` : 'No task changed.');
  process.exit(0);
}

// --saved: the tasks saved from your work sessions instead of the made-up ones; one that can't be read is said and left out.
let pool = TASKS;
if (flags.saved) {
  const { tasks: savedTasks, problems } = await loadSaved({ dir: flags['saved-dir'] || SAVED_DIR });
  for (const { id, problem } of problems) console.error(`Left out ${id}: ${problem}`);
  if (!savedTasks.length) { console.error(`No saved tasks in ${flags['saved-dir'] || SAVED_DIR}. Save one from a work session first.`); process.exit(1); }
  pool = savedTasks;
}
// --kinds: the tasks of each kind named, the tagged ones and the new sets (evals/kind-tasks.mjs).
const { KIND_SETS, tasksOfKind } = await import('../evals/kind-tasks.mjs');
const kindsAsked = flags.kinds.split(',').map(kind => kind.trim()).filter(Boolean);
if (kindsAsked.length) {
  const unknownKinds = kindsAsked.filter(kind => !KIND_SETS.includes(kind));
  if (unknownKinds.length) { console.error(`No kind called ${unknownKinds.join(', ')}. The kinds with tasks are ${KIND_SETS.join(', ')}.`); process.exit(1); }
  if (flags.saved || flags.reliability) { console.error('Use only one of --kinds, --saved or --reliability.'); process.exit(1); }
  pool = [...new Map(kindsAsked.flatMap(kind => tasksOfKind(kind)).map(task => [task.id, task])).values()];
}
if (flags.reliability) {
  if (flags.saved) { console.error('Use --reliability or --saved, not both.'); process.exit(1); }
  const { RELIABILITY_TASKS } = await import('../evals/reliability-tasks.mjs');
  pool = RELIABILITY_TASKS;
}
const wanted = new Set(flags.task.split(',').filter(Boolean).map(id => (flags.saved && !id.startsWith('saved-') ? `saved-${id}` : id))), kinds = new Set(flags.kind.split(',').filter(Boolean)), tags = new Set(flags.tag.split(',').filter(Boolean));
const unknown = [...wanted].filter(id => !pool.some(task => task.id === id));
if (unknown.length) { console.error(`No task called ${unknown.join(', ')}. Run with --list to see them.`); process.exit(1); }
// The hard tasks are Swarm's measure, so they run with --hard (or by name) and not in the everyday baselines.
const tasks = pool.filter(task => (!wanted.size || wanted.has(task.id)) && (!kinds.size || kinds.has(task.kind)) && (!tags.size || (task.tags || []).some(tag => tags.has(tag))) && (wanted.has(task.id) || Boolean(task.hard) === flags.hard));
if (!['designer', 'review', 'swarm'].includes(flags.way)) { console.error('Choose --way designer, review or swarm.'); process.exit(1); }
if (flags.way !== 'designer' && (!['claude', 'gemini'].includes(flags.provider) || tasks.some(task => task.kind !== 'work'))) { console.error(`--way ${flags.way} runs work tasks on --provider claude or gemini.`); process.exit(1); }
if (flags.list) { for (const task of pool) console.log(`${task.id.padEnd(28)} ${(task.taskKind || task.kind).padEnd(9)} ${task.title}`); process.exit(0); }
if (!['scripted', 'claude', 'gemini', 'codex'].includes(flags.provider)) { console.error('Choose --provider scripted, claude, gemini or codex.'); process.exit(1); }

const work = await mkdtemp(join(tmpdir(), 'fairy-eval-cli-'));
let connection = null;
if (flags.provider === 'claude') connection = new (await import('../desktop/claude.mjs')).ClaudeConnection({ cwd: join(work, 'claude') });
if (flags.provider === 'gemini') connection = new (await import('../desktop/antigravity.mjs')).AntigravityConnection({ cwd: join(work, 'antigravity'), warmAfterTurn: false });
if (flags.provider === 'codex') { await mkdir(join(work, 'codex'), { recursive: true }); connection = new (await import('../desktop/codex.mjs')).CodexConnection({ cwd: join(work, 'codex') }); }
const settings = evalSettings(flags.provider, flags);
// Split big tasks needs builders on their own seat, so it brings --roles with it.
if (flags.split || flags.orchestrator) flags.roles = true;
// The orchestrator's decisions need the Gemini key Fairy uses, which only Fairy can unlock, so a run reads it from the
// terminal it's started in. It goes to Google's Decisions API in a header, as in Fairy, and nowhere else.
if (flags.orchestrator && (!process.env.GEMINI_API_KEY || !['claude', 'gemini', 'codex'].includes(flags.provider))) {
  console.error(!process.env.GEMINI_API_KEY ? 'The orchestrator needs your Gemini API key: set GEMINI_API_KEY in this terminal first.' : 'Use --orchestrator with --provider claude, gemini or codex.');
  process.exit(1);
}
// ask_helper's helpers: on the lead's own model, as with Auto off, or with --roles on the seat each role gets in the app.
let helpers = null, others = [];
if (connection) {
  const { seatFor } = await import('../desktop/orchestrator.mjs');
  // Codex's seats (Astra, Terra, Luna) come from the models its CLI lists, so a Codex run is ready once its plan allows them.
  const offered = flags.provider === 'claude' ? { claude: (await import('../src/model-menu.js')).CLAUDE_MODELS } : flags.provider === 'gemini' ? { gemini: (await connection.account()).models || [] } : { codex: await connection.models().catch(() => []) };
  const home = { claude: 'claude', gemini: 'gemini', codex: 'codex' }[flags.provider];
  helpers = { provider: connection, split: flags.split, seat: role => {
    const seat = flags.roles ? seatFor(role, { auto: true, home, offered }) : null;
    const used = seat ? evalSettings(flags.provider, { model: seat.model, effort: seat.effort || '' }) : settings;
    return { settings: used, label: { model: seat?.model || model, role } };
  } };
  if (flags.roles && !home) { console.error('--roles works with --provider claude, gemini or codex.'); process.exit(1); }
  // The other family, for a Second opinion or a swarm: Gemini through agy beside Claude, or Claude beside Gemini. With
  // --stand-in it runs on this provider and model instead, under the other's name.
  const standIn = flags['stand-in'], other = flags.provider === 'claude' ? 'gemini' : 'claude';
  const linked = { [flags.provider]: connection };
  if (flags.way !== 'designer') linked[other] = standIn ? connection : other === 'claude' ? new (await import('../desktop/claude.mjs')).ClaudeConnection({ cwd: join(work, 'claude-other') })
    : new (await import('../desktop/antigravity.mjs')).AntigravityConnection({ cwd: join(work, 'antigravity-other'), warmAfterTurn: false });
  others = Object.values(linked).filter(item => item !== connection);
  const seatTurn = seat => ({ provider: linked[seat.provider], settings: standIn && seat.provider !== flags.provider ? evalSettings(flags.provider, { model, effort: seat.effort }) : evalSettings(seat.provider, { model: seat.model, effort: seat.effort }) });
  const designerOf = name => ({ provider: name, name: { claude: 'Claude', gemini: 'Gemini' }[name], model: name === 'claude' ? 'claude-opus-5-5' : 'gemini-4-argon-high', effort: 'high' });
  if (flags.way === 'review') helpers.review = seatTurn(designerOf(other));
  if (flags.way === 'swarm') {
    const { runSwarmTask } = await import('../evals/swarm-run.mjs'), { builderSeat } = await import('../desktop/swarm.mjs'), { runInSandbox } = await import('../desktop/work-sandbox.mjs');
    const seats = ['claude', 'gemini'].map(designerOf), offeredHere = flags.provider === 'claude' ? offered.claude : offered.gemini;
    const geminiOffered = linked.gemini === connection && !standIn ? offered.gemini : standIn ? ['gemini-4-argon-high', 'gemini-4-argon-medium'] : (await linked.gemini.account()).models || [];
    // The builder: your provider's standard tier at medium effort, as a swarm's builder runs without Auto's choice.
    const built = builderSeat({ provider: flags.provider, offered: offeredHere });
    const builder = { provider: connection, settings: evalSettings(flags.provider, { model: built.model, effort: built.effort }), model: built.model };
    helpers.swarm = ({ task, root: folder, signal }) => runSwarmTask({ prompt: task.ask, root: folder, seats, connect: seatTurn, builder, place: join(work, 'copies'), run: runInSandbox, offered: geminiOffered, signal });
  }
}
// With --orchestrator each work task goes through Fairy's own router first: the tier, effort and model, and whether it
// needs a plan, which gives the lead build_step.
let route = null;
if (flags.orchestrator) {
  const { ModelRouter } = await import('../desktop/model-router.mjs');
  const offeredNow = { claude: (await import('../src/model-menu.js')).CLAUDE_MODELS, ...(flags.provider === 'gemini' ? { gemini: (await connection.account()).models || [] } : {}), ...(flags.provider === 'codex' ? { codex: await connection.models().catch(() => []) } : {}) };
  const router = new ModelRouter({ key: () => process.env.GEMINI_API_KEY, offered: () => offeredNow, log: line => console.error(line) });
  const home = { claude: 'claude', gemini: 'gemini', codex: 'codex' }[flags.provider];
  route = async task => {
    if (task.kind !== 'work') return null;
    const picked = await router.pick({ provider: home, text: task.ask, where: 'work', permission: task.permission || 'auto' });
    if (!picked) return { pick: { problem: router.problem || 'no pick' } };
    const led = picked.route?.role === 'lead' && picked.route.shape !== 'step';
    return { settings: evalSettings(flags.provider, { model: picked.model, effort: picked.effort || '' }), helpers: { ...helpers, lead: led },
      pick: { tier: picked.tier, effort: picked.effort, model: picked.model, shape: picked.route?.shape, role: picked.route?.role, confidence: picked.route?.confidence } };
  };
}
const model = { claude: settings.claudeModel, gemini: settings.antigravityModel, codex: settings.model }[flags.provider] || '';

const controller = new AbortController();
process.once('SIGINT', () => { console.error('\nStopping after this task…'); controller.abort(); });

const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const started = new Date();
console.log(`${tasks.length} task${tasks.length === 1 ? '' : 's'} on ${flags.provider}${model ? ` (${model}, effort ${settings.reasoning})` : ''}${flags.orchestrator ? ', on the orchestrator' : flags.split ? ', big tasks split' : flags.roles ? ', helpers on their roles’ models' : ''}${flags.way !== 'designer' ? `, ${flags.way === 'swarm' ? 'as a swarm of Claude and Gemini' : 'with a Second opinion'}${flags['stand-in'] ? ' (stand-in: every seat on this provider)' : ''}` : ''}${Number(flags.repeat) > 1 ? `, ${flags.repeat} rounds` : ''}`);
let outcome, quota = '';
try {
  outcome = await runSuite(tasks, { provider: connection || (task => scriptedProvider(task.scripts ? { turns: task.scripts } : task.script)), settings, helpers, route, repeat: Math.max(1, Number(flags.repeat) || 1), signal: controller.signal,
    onResult: r => {
      // A provider out of allowance fails every task the same way, which says nothing about the tasks, so stop there.
      if (/quota reached|usage limit|limit reached|rate.?limit/i.test(r.error || '')) { quota = r.error; controller.abort(); }
      console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.id.padEnd(28)} ${String(r.seconds).padStart(5)}s  ${r.calls.length} call${r.calls.length === 1 ? '' : 's'}${r.approvals.length ? `, ${r.approvals.length} approval${r.approvals.length === 1 ? '' : 's'}` : ''}${r.helpers ? `, helper ${r.helpers.seats.join(', ') || ''} ${r.helpers.tokens.input}/${r.helpers.tokens.output} tokens` : ''}${r.pick ? `  [${r.pick.problem || `${r.pick.model} ${r.pick.effort}, ${r.pick.shape}${r.pick.shape === r.shape || (r.pick.shape !== 'step' && r.shape === 'plan') ? '' : ` (labelled ${r.shape})`}`}]` : ''}${r.error ? `  error: ${r.error}` : ''}`);
      if (flags.hard || flags.way !== 'designer') console.log(`      ${r.way}: ${r.designerCalls} designer call${r.designerCalls === 1 ? '' : 's'}${r.swarm ? `, ${r.swarm.rounds} convening round${r.swarm.rounds === 1 ? '' : 's'}, ${r.swarm.settled ? 'settled' : 'not settled'}, build ${r.swarm.outcome}` : ''}`);
      for (const c of r.checks.filter(c => !c.ok)) console.log(`      ✗ ${c.name}: ${c.detail}`);
      // A saved task beside the session it came from.
      if (r.saved && !r.skipped) console.log(`      the first time: ${r.reference.seconds ?? '?'}s${r.reference.tokens ? `, ${r.reference.tokens.input} in / ${r.reference.tokens.output} out tokens` : ''}${r.reference.model ? ` on ${r.reference.model}` : ''}; now ${r.seconds}s, ${r.tokens.input} in / ${r.tokens.output} out`);
    } });
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally { connection?.close?.(); for (const item of others) item.close?.(); await rm(work, { recursive: true, force: true }); }
if (quota) { console.error(`\nStopped: ${quota}\nNothing was saved, since a run cut short by allowance can't be compared.`); process.exit(1); }
if (!outcome) process.exit(130);

const { summary, results } = outcome;
console.log(`\n${summary.passed}/${summary.total} tasks passed, ${summary.checks} checks, ${summary.seconds}s, ${summary.turns} turns, ${summary.toolCalls} tool calls, ${summary.approvals} approvals${summary.tokens.input || summary.tokens.output ? `, lead ${summary.tokens.input} in / ${summary.tokens.output} out tokens` : ''}${summary.helpers.turns ? `, helpers and builders ${summary.helpers.turns} turns, ${summary.helpers.tokens.input} in / ${summary.helpers.tokens.output} out` : ''}, the lead wrote ${summary.leadWrites} time${summary.leadWrites === 1 ? '' : 's'} itself${summary.plans ? `, plan answers matched ${summary.plans.matched}/${summary.plans.asked}` : ''}`);
const stamp = started.toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-');
const out = flags.out || join(root, '.local-data', 'evals', `${stamp}-${flags.provider}${model ? `-${model}` : ''}${flags.orchestrator ? '-orchestrator' : flags.split ? '-split' : flags.roles ? '-roles' : ''}${flags.hard ? '-hard' : ''}${flags.way !== 'designer' ? `-${flags.way}` : ''}${flags['stand-in'] ? '-stand-in' : ''}${flags.saved ? '-saved' : ''}${flags.reliability ? '-reliability' : ''}.json`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify({ started: started.toISOString(), finished: new Date().toISOString(), provider: flags.provider, model, effort: settings.reasoning, roles: flags.roles, split: flags.split, orchestrator: flags.orchestrator, hard: flags.hard, way: flags.way, standIn: flags['stand-in'], saved: flags.saved, reliability: flags.reliability, commit: `${git(['rev-parse', '--short', 'HEAD'])}${git(['status', '--porcelain']) ? '+changes' : ''}`, summary, results }, null, 2)}\n`);
console.log(`Saved ${out}`);
// Reliability evals go into the experiment tracker only (never Auto's strengths table), for a real model or with --data.
if (flags.reliability && (flags.provider !== 'scripted' || flags.data)) {
  const data = flags.data || join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra');
  const { RunStore } = await import('../desktop/runs.mjs'), { trackedRun } = await import('../desktop/eval-run.mjs');
  const store = new RunStore({ dir: join(data, 'runs') }), folder = join(data, 'evals', 'reliability');
  const tracked = trackedRun({ results, model, provider: flags.provider, version: git(['rev-parse', '--short', 'HEAD']) });
  const kept = await store.start(folder, { name: `reliability · ${tracked.name}`, command: `node scripts/eval.mjs --reliability --provider ${flags.provider}${model ? ` --model ${model}` : ''}`, params: { ...tracked.params, suite: 'reliability' }, where: { kind: 'here' } });
  await store.finish(folder, kept.id, { state: tracked.state, metrics: tracked.metrics, seconds: tracked.seconds });
  console.log(`Recorded reliability evals (${summary.passed}/${summary.total}) for ${model || flags.provider} in the experiment tracker.`);
}
// Evals by kind go into the strengths table and the tracker, for a real model, or for a scripted run only with --data.
if (kindsAsked.length && (flags.provider !== 'scripted' || flags.data)) {
  const data = flags.data || join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra');
  const { evalRows, withEvalRows } = await import('../desktop/strengths/evals-layer.mjs'), { StrengthsStore } = await import('../desktop/strengths/store.mjs');
  const rows = evalRows(results, { model: model || flags.provider, provider: flags.provider, run: out, at: started.toISOString() });
  await new StrengthsStore({ path: join(data, 'model-strengths.json') }).update(table => withEvalRows(table, rows));
  const { RunStore } = await import('../desktop/runs.mjs'), { trackedRun } = await import('../desktop/eval-run.mjs');
  const store = new RunStore({ dir: join(data, 'runs') }), folder = join(data, 'evals', 'kinds');
  for (const kind of kindsAsked) {
    const tracked = trackedRun({ results: results.filter(r => r.taskKind === kind), model, provider: flags.provider, version: git(['rev-parse', '--short', 'HEAD']) });
    const kept = await store.start(folder, { name: `${kind} · ${tracked.name}`, command: `node scripts/eval.mjs --kinds ${kind} --provider ${flags.provider}${model ? ` --model ${model}` : ''}`, params: { ...tracked.params, kind }, where: { kind: 'here' } });
    await store.finish(folder, kept.id, { state: tracked.state, metrics: tracked.metrics, seconds: tracked.seconds });
  }
  console.log(`Wrote ${rows.map(row => `${row.kind} ${row.passed}/${row.total}`).join(', ')} for ${model || flags.provider} into the strengths table and the tracker.`);
}
process.exit(summary.passed === summary.total ? 0 : 1);
