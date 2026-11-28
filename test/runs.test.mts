import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { RunStore, cleanMetrics, cleanParams, codeState, entryOf, flagParams, madeFiles, readRunFolder, runLine, runName } from '../desktop/runs.mjs';
import { snapshot } from '../desktop/watchers.mjs';
import { PLAIN_NEED, RUN_TOOLS, WorkTools, riskOf } from '../desktop/work-tools.mjs';

const run = promisify(execFile);
const helperPath = new URL('../desktop/fairy_track.py', import.meta.url).pathname;
const temp = async () => mkdtemp(join(tmpdir(), 'fairy-runs-'));
const shell = async ({ command, cwd }: { command: string; cwd: string }) => {
  try { const { stdout, stderr } = await run('/bin/zsh', ['-f', '-c', command], { cwd }); return { exitCode: 0, output: stdout + stderr }; }
  catch (error: unknown) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: typeof err.code === 'number' ? err.code : 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
};
const hasPython = await run('python3', ['--version']).then(() => true, () => false);

test('parameters, metrics and flags are kept as plain values', () => {
  assert.deepEqual(flagParams('python train.py --lr 3e-4 --epochs=10 --name "big run" --fast -x 3 --tag v2 && echo done'), { lr: 0.0003, epochs: 10, name: 'big run', fast: true, tag: 'v2' });
  assert.deepEqual(flagParams('node bench.mjs --runs 5; echo --done|tee x --to="a b"'), { runs: 5, done: true, to: 'a b' });
  assert.deepEqual(cleanParams({ lr: 0.1, ok: true, nested: { a: 1 }, nan: NaN, 'bad\nname': 1 }), { lr: 0.1, ok: true, nested: '{"a":1}', nan: 'NaN' });
  assert.deepEqual(cleanMetrics({ loss: { value: 0.3, unit: null, steps: [[1, 0.9], [2, 0.5], 'x'] }, acc: 92.4, top: { value: 1, unit: '%' } }),
    { loss: { value: 0.3, unit: null, steps: [[1, 0.9], [2, 0.5]] }, acc: { value: 92.4, unit: null }, top: { value: 1, unit: '%' } });
  assert.deepEqual(cleanParams([1, 2]), {});
  assert.equal(entryOf('cd src && python3 -u train.py --lr 1'), 'train.py');
  assert.equal(runName('', 'python3 sweep.py --lr 1'), 'sweep.py');
  assert.equal(runName('  lr 3e-4 ', 'x'), 'lr 3e-4');
});

test('a run’s numbers are fixed once it ends, and its number is never reused', async () => {
  const dir = await temp();
  try {
    let clock = Date.parse('2026-11-18T10:00:00Z');
    const store = new RunStore({ dir, now: () => new Date(clock) });
    const one = await store.start('/p', { name: 'first', command: 'python a.py --lr 1', params: { lr: 1 } });
    assert.equal(one.id, 'R1'); assert.equal(one.state, 'running'); assert.equal(one.folder, '.fairy/runs/R1');
    clock += 41_000;
    const done = await store.finish('/p', 'R1', { state: 'done', exit: 0, params: { batch: 64 }, metrics: { loss: { value: 0.31 } } });
    assert.deepEqual([done.state, done.seconds, done.params, done.metrics.loss.value], ['done', 41, { lr: 1, batch: 64 }, 0.31]);
    await assert.rejects(store.finish('/p', 'R1', { metrics: { loss: { value: 0 } } }), /already ended/);
    const named = await store.annotate('/p', 'R1', { name: 'renamed', notes: 'best so far', tags: ['lr'], metrics: { loss: { value: 0 } } } as any);
    assert.equal(named.name, 'renamed'); assert.equal(named.metrics.loss.value, 0.31);
    await store.start('/p', {}); await store.remove('/p', 'R2');
    assert.equal((await store.start('/p', {})).id, 'R3');
    assert.equal((await store.start('/q', {})).id, 'R1', 'each project counts its own');
    assert.deepEqual((await store.list('/p')).map(r => r.id), ['R3', 'R1']);
    assert.equal(runLine((await store.get('/p', 'R1'))!), 'R1 “renamed” done in 41 s: loss 0.31');
    // Writes at once are queued, so none is lost.
    const many = await Promise.all(Array.from({ length: 8 }, () => store.start('/r', {})));
    assert.deepEqual(many.map(r => r.id).sort(), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'].sort());
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the code’s state: the commit, what was uncommitted, and the entry script', async () => {
  const root = await temp();
  try {
    await writeFile(join(root, 'train.py'), 'print(1)\n');
    const outside = await codeState(root, 'python3 train.py');
    assert.deepEqual(Object.keys(outside), ['entry']); assert.equal(outside.entry!.file, 'train.py'); assert.match(outside.entry!.sha256, /^[0-9a-f]{64}$/);
    const g = (args: string[]) => run('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    await g(['init', '-q']); await g(['add', '.']); await g(['commit', '-qm', 'one']);
    const clean = await codeState(root, 'python3 train.py');
    assert.match(clean.commit!, /^[0-9a-f]{40}$/); assert.equal(clean.dirty, false); assert.equal(clean.changed, undefined);
    await writeFile(join(root, 'train.py'), 'print(2)\n'); await writeFile(join(root, 'new.py'), 'x = 1\n');
    await mkdir(join(root, '.fairy/runs/R1'), { recursive: true }); await writeFile(join(root, '.fairy/runs/R1/metrics.json'), '{}');
    const dirty = await codeState(root, 'python3 train.py');
    assert.equal(dirty.dirty, true);
    assert.deepEqual(dirty.changed!.map(c => c.path).sort(), ['new.py', 'train.py'], 'a run’s own folder isn’t a change to the code');
    assert.notEqual(dirty.entry!.sha256, outside.entry!.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the files a run made, with their hashes, and what it reported', async () => {
  const root = await temp();
  try {
    await writeFile(join(root, 'old.txt'), 'a');
    const before = (await snapshot(root)).files;
    await mkdir(join(root, 'out'), { recursive: true }); await writeFile(join(root, 'out/curve.png'), 'png'); await writeFile(join(root, 'old.txt'), 'bb');
    await mkdir(join(root, '.fairy/runs/R1'), { recursive: true });
    await writeFile(join(root, '.fairy/runs/R1/metrics.json'), JSON.stringify({ acc: { value: 0.9, unit: null } }));
    await writeFile(join(root, '.fairy/runs/R1/params.json'), JSON.stringify({ lr: 0.1 }));
    await writeFile(join(root, '.fairy/runs/R1/model.pt'), 'weights');
    const files = await madeFiles(root, before, (await snapshot(root)).files, { runFolder: '.fairy/runs/R1' });
    assert.deepEqual(files.map(f => [f.path, f.figure === true, f.change || '']), [['.fairy/runs/R1/model.pt', false, ''], ['old.txt', false, 'changed'], ['out/curve.png', true, '']]);
    assert.match(files[0].sha256!, /^[0-9a-f]{64}$/);
    assert.deepEqual(await readRunFolder(join(root, '.fairy/runs/R1')), { params: { lr: 0.1 }, metrics: { acc: { value: 0.9, unit: null } } });
    await writeFile(join(root, '.fairy/runs/R1/metrics.json'), 'not json');
    assert.deepEqual((await readRunFolder(join(root, '.fairy/runs/R1'))).metrics, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('run_experiment records a run in its own group, and a refused one is kept as stopped', async () => {
  assert.equal(riskOf('run_experiment'), 'write');
  assert.equal(RUN_TOOLS.length, 3);
  const root = await temp(), dir = await temp();
  try {
    const store = new RunStore({ dir, helperPath });
    await writeFile(join(root, 'bench.mjs'), `import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
writeFileSync(join(process.env.FAIRY_RUN_DIR, 'metrics.json'), JSON.stringify({ ops: { value: 1234, unit: 'op/s' } }));
writeFileSync('result.csv', 'a,b\\n1,2\\n'); console.log('ran');`);
    const events: any[] = [];
    const tools = new WorkTools({ root, runs: store, permission: 'auto', approve: async () => 'allow', runCommand: shell as any, owner: 'chat-1', onEvent: e => events.push(e) });
    assert.ok(tools.toolGroups().has('runs'));
    assert.ok(tools.offered({ request: 'Run a sweep over the learning rate' }).some(t => t.name === 'run_experiment'));
    assert.ok(!tools.offered({ request: 'Fix the parser' }).some(t => t.name === 'run_experiment'));
    const result = await tools.handle({ tool: 'more_tools', arguments: { name: 'run_experiment', arguments: { command: 'node bench.mjs --size 64', reason: 'Benchmark', name: 'size 64', params: { cache: 'on' } } } }) as any;
    assert.equal(result.success, true);
    assert.match(result.contentItems[0].text, /^Exit code 0\.\nran/);
    assert.match(result.contentItems[0].text, /Recorded as R1 “size 64” done in [\d.]+ s: ops 1234 op\/s\. Files: result\.csv\./);
    const [kept] = await store.list(root);
    assert.deepEqual([kept.id, kept.state, kept.exit, kept.params, kept.metrics.ops.value, kept.files.map(f => f.path), kept.from], ['R1', 'done', 0, { size: 64, cache: 'on' }, 1234, ['result.csv'], { chat: 'chat-1' }]);
    assert.equal(kept.code!.entry!.file, 'bench.mjs');
    assert.equal(await readFile(join(root, '.fairy/runs/.gitignore'), 'utf8'), '*\n');
    assert.match(await readFile(join(root, '.fairy/runs/R1/fairy_track.py'), 'utf8'), /def metric\(name, value, unit=None, step=None\)/);
    const row = tools.activity.at(-1)!;
    assert.deepEqual([row.tool, row.summary, row.run], ['experiment', 'node bench.mjs --size 64', 'R1'], 'the row shows the command as asked, not the run’s setup');
    assert.match(row.detail!, /^R1 · Exit 0/);
    // A failing run is kept as failed; a refused one as stopped, and the next number moves on.
    const failed = await tools.experiment({ command: 'node -e "process.exit(3)"', reason: 'x' });
    assert.equal(failed.success, false); assert.equal((await store.get(root, 'R2'))!.state, 'failed'); assert.equal((await store.get(root, 'R2'))!.exit, 3);
    const asking = new WorkTools({ root, runs: store, permission: 'ask', approve: async () => 'deny', runCommand: shell as any });
    await assert.rejects(asking.experiment({ command: 'node bench.mjs', reason: 'x' }));
    assert.equal((await store.get(root, 'R3'))!.state, 'stopped');
    assert.equal((await new WorkTools({ root, runCommand: shell as any }).handle({ tool: 'run_experiment', arguments: { command: 'true', reason: 'x' } })).success, false, 'no tracker, no tool');
  } finally { await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('a real Python run reports through fairy_track', { skip: !hasPython && 'no python3' }, async () => {
  const root = await temp(), dir = await temp();
  try {
    const store = new RunStore({ dir, helperPath });
    await writeFile(join(root, 'train.py'), `import fairy_track as ft
ft.param("lr", 3e-4)
for step in range(1, 4):
    ft.metric("loss", 1.0 / step, step=step)
ft.metric("acc", 92.5, "%")
print("trained")
`);
    const tools = new WorkTools({ root, runs: store, permission: 'auto', approve: async () => 'allow', runCommand: shell as any });
    const result = await tools.experiment({ command: 'python3 train.py --epochs 3', reason: 'Train', name: 'tiny' }) as any;
    assert.equal(result.success, true, result.contentItems[0].text);
    const [kept] = await store.list(root);
    assert.deepEqual(kept.params, { epochs: 3, lr: 0.0003 });
    assert.deepEqual(kept.metrics.loss, { value: 1 / 3, unit: null, steps: [[1, 1], [2, 0.5], [3, 1 / 3]] });
    assert.deepEqual(kept.metrics.acc, { value: 92.5, unit: '%' });
    assert.equal(kept.files.length, 0, 'the run’s own files are the record, not files it made');
  } finally { await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('asking about experiments is a plain need for the runs group', () => {
  for (const request of ['run the experiment again with lr 1e-3', 'start a sweep', 'benchmark the parser', 'compare R12 and R14', 'try 20 epochs', 'an ablation without dropout'])
    assert.ok(PLAIN_NEED.runs.test(request), request);
  for (const request of ['fix the parser', 'run the tests', 'train of thought', 'the training docs']) assert.ok(!PLAIN_NEED.runs.test(request), request);
});

test('a run in the real sandbox writes its record and can’t write outside the project', { skip: (process.platform !== 'darwin' || !hasPython) && 'needs macOS and python3' }, async () => {
  const { runInSandbox } = await import('../desktop/work-sandbox.mjs');
  const root = await mkdtemp(join(tmpdir(), 'fairy-runs-')), dir = await temp();
  const { realpath } = await import('node:fs/promises'), project = await realpath(root);
  try {
    const store = new RunStore({ dir, helperPath });
    await writeFile(join(project, 'train.py'), 'import fairy_track as ft\nft.metric("loss", 0.25)\nopen("out.txt", "w").write("x")\n');
    const tools = new WorkTools({ root: project, runs: store, permission: 'auto', approve: async () => 'allow', sandboxed: true, runCommand: options => runInSandbox(options) });
    const result = await tools.experiment({ command: 'python3 train.py', reason: 'Train' }) as any;
    assert.equal(result.success, true, result.contentItems[0].text);
    const [kept] = await store.list(project);
    assert.deepEqual([kept.metrics.loss.value, kept.files.map(f => f.path)], [0.25, ['out.txt']]);
  } finally { await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('a job sent to the cluster is a run, settled when its outputs are fetched', async () => {
  const root = await temp(), dir = await temp();
  try {
    const store = new RunStore({ dir, helperPath });
    await writeFile(join(root, 'train.py'), 'print(1)\n');
    const sent: any[] = [];
    const nexus = {
      submit: async (args: any) => { sent.push(args); return { job: `job${sent.length}abc`, target: args.target, status: 'waiting for the user to accept it in Nexus' }; },
      logs: async ({ job }: { job: string }) => ({ job, ended: true, exitCode: 0, log: '' }),
      outputs: async ({ job, root: at }: { job: string; root: string }) => {
        const out = join(at, 'nexus-outputs', job);
        await mkdir(join(out, 'figures'), { recursive: true });
        await writeFile(join(out, 'metrics.json'), JSON.stringify({ loss: { value: 0.12, unit: null } }));
        await writeFile(join(out, 'params.json'), JSON.stringify({ batch: 32 }));
        await writeFile(join(out, 'figures', 'curve.png'), 'png'); await writeFile(join(out, 'model.pt'), 'w');
        return { job, folder: `nexus-outputs/${job}`, files: [] };
      },
    };
    const tools = new WorkTools({ root, runs: store, nexus: nexus as any, permission: 'auto', approve: async () => 'allow', runCommand: shell as any, owner: 'chat-2' });
    const result = await tools.handle({ tool: 'nexus_run', arguments: { target: 'gpu', command: 'python train.py --lr 0.1', params: { seed: 1 } } }) as any;
    assert.match(result.contentItems[0].text, /Recorded as run R1 on forge\. It fills in when the job’s outputs are fetched/);
    assert.deepEqual(Object.keys(sent[0]).sort(), ['command', 'root', 'target'], 'track and params never reach Nexus');
    let [kept] = await store.list(root);
    assert.deepEqual([kept.state, kept.where, kept.folder, kept.params, kept.code!.entry!.file], ['running', { kind: 'forge', job: 'job1abc' }, 'nexus-outputs/job1abc', { lr: 0.1, seed: 1 }, 'train.py']);
    const fetched = await tools.handle({ tool: 'nexus_outputs', arguments: { job: 'job1abc' } }) as any;
    assert.match(fetched.contentItems[0].text, /Run R1 “train.py” done: loss 0\.12\./);
    [kept] = await store.list(root);
    assert.deepEqual([kept.state, kept.exit, kept.seconds, kept.params, kept.metrics.loss.value], ['done', 0, null, { lr: 0.1, seed: 1, batch: 32 }, 0.12]);
    assert.deepEqual(kept.files.map(f => [f.path, f.figure === true]), [['nexus-outputs/job1abc/figures/curve.png', true], ['nexus-outputs/job1abc/model.pt', false]]);
    // Not an experiment: no run.
    await tools.handle({ tool: 'nexus_run', arguments: { target: 'cpu', command: 'make docs', track: false } });
    assert.equal((await store.list(root)).length, 1);
    // A watcher's fetch, in Fairy's own folder: full paths, and a failed exit.
    await tools.handle({ tool: 'nexus_run', arguments: { target: 'cpu', command: 'python train.py', on: 'atlas' } });
    const elsewhere = await temp();
    await writeFile(join(elsewhere, 'log.txt'), 'x');
    const settled = (await store.settleJob('job3abc', { outputs: elsewhere, exit: 2 }))!;
    assert.deepEqual([settled.id, settled.state, settled.exit, settled.files.map(f => f.path)], ['R2', 'failed', 2, [join(elsewhere, 'log.txt')]]);
    assert.equal(await store.settleJob('job3abc', { outputs: elsewhere, exit: 0 }), null, 'a settled run stays as it is');
    assert.equal(await store.settleJob('nojob', { outputs: elsewhere }), null);
    // A failed job with no outputs directory still settles cleanly without throwing.
    await tools.handle({ tool: 'nexus_run', arguments: { target: 'cpu', command: 'python boom.py', on: 'atlas' } });
    const noOut = (await store.settleJob('job4abc', { exit: 2, seconds: 0, printout: 'syntax error' }))!;
    assert.deepEqual([noOut.state, noOut.exit, noOut.seconds, noOut.files], ['failed', 2, 0, []]);
    await rm(elsewhere, { recursive: true, force: true });
  } finally { await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('a Nexus job watcher’s find says where the outputs went, for the tracker', async () => {
  const { nexusJobEnded } = await import('../desktop/watchers.mjs');
  const nexus = { logs: async () => ({ ended: true, exitCode: 1, log: 'boom' }), outputs: async ({ job }: { job: string }) => ({ job, folder: `nexus-outputs/${job}`, files: [{ path: 'x' }] }) };
  const [found] = await nexusJobEnded({ job: 'job9abc' } as any, nexus as any, '/tmp/w');
  assert.deepEqual(found.ended, { job: 'job9abc', exit: 1, outputs: 'nexus-outputs/job9abc', printout: 'boom' });
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /runStore\.settleJob\(found\.ended\.job, \{ outputs: join\(file\('watcher-outputs'\), found\.ended\.outputs\), exit: found\.ended\.exit, printout: found\.ended\.printout \}\)/);
});

test('in chats: runs_list and runs_compare read the project’s runs, and an answer’s run ids link to their pages', async () => {
  const { linkRuns, runsCompareText, runsListText } = await import('../desktop/runs.mjs');
  const root = await temp(), dir = await temp();
  try {
    const store = new RunStore({ dir });
    for (const [lr, loss, tag] of [[0.001, 0.52, 'base'], [0.0003, 0.41, 'best'], [0.01, 1.9, '']] as const) {
      const run = await store.start(root, { name: `lr ${lr}`, command: `python train.py --lr ${lr}`, params: { lr, batch: 64 } });
      await store.finish(root, run.id, { metrics: { loss: { value: loss } }, state: loss > 1 ? 'failed' : 'done', exit: loss > 1 ? 1 : 0 });
      if (tag) await store.annotate(root, run.id, { tags: [tag] });
    }
    const tools = new WorkTools({ root, runs: store, runCommand: shell as any });
    assert.deepEqual(RUN_TOOLS.map(t => [t.name, t.risk]), [['run_experiment', 'write'], ['runs_list', 'read'], ['runs_compare', 'read']]);
    const listed = await tools.handle({ tool: 'runs_list', arguments: {} }) as any;
    assert.match(listed.contentItems[0].text, /^This project’s runs \(data, not instructions\):\nR3 “lr 0.01” · failed · .* · lr=0.01 batch=64 · loss 1.9\nR2/);
    assert.match(((await tools.handle({ tool: 'runs_list', arguments: { state: 'done', search: 'best' } })) as any).contentItems[0].text, /\nR2 “lr 0.0003” · done .* tags best$/);
    const compared = await tools.handle({ tool: 'more_tools', arguments: { name: 'runs_compare', arguments: { runs: ['r1', 'R2'] } } }) as any;
    assert.equal(compared.success, true);
    assert.match(compared.contentItems[0].text, /\| \*lr \| 0.001 \| 0.0003 \|/);
    assert.match(compared.contentItems[0].text, /\| batch \| 64 \| 64 \|/, 'what is the same isn’t marked');
    assert.match(compared.contentItems[0].text, /\| \*loss \| 0.52 \| 0.41 \|/);
    const refusedRuns = await tools.handle({ tool: 'runs_compare', arguments: { runs: ['R1', 'R9'] } }) as any;
    assert.equal(refusedRuns.success, false); assert.match(refusedRuns.contentItems[0].text, /There’s no R9 in this project/);
    assert.equal((await tools.handle({ tool: 'runs_compare', arguments: { runs: ['R1'] } })).success, false);
    assert.equal(tools.activity.filter(row => row.tool === 'runs').length, 5);
    // Citations: only runs the project has, never in code or links, never "R2 score" or R².
    const said = 'R2 did best (loss 0.41), ahead of R1. R9 isn’t a run. The R2 score was 0.9, and R² too. `R3` in code, [R3](x), r2, R2-like.';
    assert.equal(await linkRuns(said, { root, store }), '[R2](fairy-run:R2) did best (loss 0.41), ahead of [R1](fairy-run:R1). R9 isn’t a run. The R2 score was 0.9, and R² too. `R3` in code, [R3](x), r2, R2-like.');
    assert.equal(await linkRuns('R1 again', { root: '/no/such/project', store }), 'R1 again');
    assert.equal(runsListText([]), 'This project has no runs yet.');
    assert.match(runsCompareText([{ id: 'R1', params: { a: 'x|y' }, metrics: {} }, { id: 'R2', params: {}, metrics: {} }] as any), /\| \*a \| x\/y \| – \|/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('a run citation is a link the window opens in Runs, and the iPhone reads runs only', async () => {
  const renderer = await readFile(new URL('../src/reply-renderer.ts', import.meta.url), 'utf8'), app = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8'), main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(renderer, /markdown\.validateLink = url => \/\^fairy-run:R\\d\{1,6\}\$\/\.test\(url\)/);
  assert.match(app, /url\.startsWith\('fairy-run:'\) \? openRunCitation\(url\.slice\('fairy-run:'\.length\)\)/);
  assert.match(app, /const openRunCitation = (?:\(id(?:\s*:\s*string)?\)|id) => \{ const folder = state\.sessions\?\.work\?\.path;/);
  assert.match(main, /reply = await runsModule\.linkRuns\(reply, \{ root, store: runStore \}\)/);
  const { phoneRun } = await import('../desktop/phone-link.mjs');
  const shown = phoneRun({ id: 'R2', name: 'lr', state: 'done', where: { kind: 'forge', job: 'j8f2c1a' }, started: 's', seconds: 12, exit: 0, params: { lr: 0.0003, opt: 'adam' }, metrics: { loss: { value: 0.41, steps: [[1, 2]] }, note: { value: 'NaN', unit: null } }, printout: 'x'.repeat(3000), code: { commit: 'a'.repeat(40), dirty: true }, files: [{ path: 'secret' }] } as any);
  assert.deepEqual(shown.params, { lr: '0.0003', opt: 'adam' });
  assert.deepEqual(shown.metrics, [{ name: 'loss', value: 0.41, text: '', unit: '' }, { name: 'note', value: null, text: 'NaN', unit: '' }]);
  assert.equal(shown.printout.length, 2000); assert.equal(shown.commit, 'aaaaaaaaaa'); assert.equal('files' in shown, false);
  const link = await readFile(new URL('../desktop/phone-link.mts', import.meta.url), 'utf8');
  assert.match(link, /if \(!projects\.some\(p => p\.folder === folder\)\) return this\.send\(response, 404, \{ error: 'There are no runs there\.' \}\);/);
  assert.ok(!/MAC_ROUTES = new Set\([^)]*runs/.test(link), 'a Mac paired as a face can’t read them through the phone routes');
});
