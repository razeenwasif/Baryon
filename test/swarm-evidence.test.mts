// Swarm stage 5: evidence. A dispute about a failing test is settled by running it.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CHECKS, checksText, convene, conveneReply, conveningInput, conveningInstructions, designerInstructions, parseAnswer, parseDesign, runChecks, runConvener, runDesigner, withCopy } from '../desktop/swarm.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';

const design = (finding: string) => `## Finding\n${finding}\n## Evidence\ntest/cart.test.js:5\n## Plan\n1. src/cart.js: fix.\n## Check\nnode --test\n## Risk\nNone.\n## Confidence\nhigh: the test.`;
const seat = (provider: 'claude' | 'gemini', model: string) => ({ provider, name: ({ claude: 'Claude', gemini: 'Gemini' } as const)[provider], model, effort: 'high' });
const designs = () => [
  { letter: 'A', seat: seat('claude', 'claude-opus-5-5'), text: design('A: the total ignores quantity, so the cart test fails.') },
  { letter: 'B', seat: seat('gemini', 'gemini-4-argon-high'), text: design('B: the cart test passes; the bug is in rounding.') },
].map(entry => ({ ...entry, parsed: parseDesign(entry.text) }));
const answerText = ({ vote, on = {}, checks = [] }: { vote: string; on?: Record<string, string>; checks?: string[] }) => [
  ...Object.entries(on).map(([letter, claim]) => `## On design ${letter}\nStrongest point: clear.\n- Objection (blocking): ${claim}`),
  '## My design\nUnchanged.', `## Vote\n${vote}`, ...(checks.length ? [`## Settle by running\n${checks.map(command => `- \`${command}\``).join('\n')}`] : []),
].join('\n\n');
async function project(t: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fairy-evidence-'))), root = join(base, 'till'), place = join(base, 'copies');
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'cart.js'), 'export const total = items => items.reduce((sum, item) => sum + item.price, 0);\n');
  await writeFile(join(root, '.env'), 'KEY=secret\n');
  return { root, place };
}

test('a designer names the commands that would settle a fact', () => {
  const read = parseAnswer('## Vote\nA\n\n## Settle by running\n- `node --test test/cart.test.js`\n$ grep -rn "quantity" src\n3. npm test\n', { own: 'B' });
  assert.deepEqual(read.checks, ['node --test test/cart.test.js', 'grep -rn "quantity" src'], 'two at most, without bullets, prompts or backticks');
  assert.deepEqual(parseAnswer('## Vote\nA\n## Settle by running\n```sh\nnode --test\n```').checks, ['node --test']);
  assert.deepEqual(parseAnswer('## Vote\nA\n## Settle by running\nNone.').checks, []);
  assert.deepEqual(parseAnswer('## Vote\nA').checks, []);
  assert.match(conveningInstructions('/p'), /## Settle by running\nOnly if the designs disagree about a fact a command can settle/);
});

test('a dispute about a failing test is settled by running it', async () => {
  const ran: any[] = [], seen: any[] = [];
  const script: Record<number, Record<string, string>> = {
    1: { A: answerText({ vote: 'A', on: { B: 'B says the cart test passes, but it fails: total() never reads quantity.' }, checks: ['node --test test/cart.test.js'] }),
         B: answerText({ vote: 'B', on: { A: 'The cart test passes today; A is fixing the wrong thing.' }, checks: ['node --test test/cart.test.js', 'node --test'] }) },
    2: { A: answerText({ vote: 'A' }), B: answerText({ vote: 'A' }) },
  };
  const result = await convene({ designs: designs(),
    answer: async (entry, { round, standing }) => { seen.push({ round, letter: entry.letter, standing }); return script[round][entry.letter]; },
    runChecks: async (commands, { round }) => { ran.push([round, commands]); return commands.map(command => ({ command, exitCode: 1, output: 'not ok 1 - adds each price times its quantity\n# pass 0\n# fail 1' })); } });
  assert.deepEqual(ran, [[1, ['node --test test/cart.test.js', 'node --test']]], 'each command once, between rounds 1 and 2');
  const second = seen.find(entry => entry.round === 2 && entry.letter === 'B');
  assert.equal(second.standing.checks[0].exitCode, 1);
  const input = conveningInput({ prompt: 'Fix the cart.', own: 'B', designs: designs(), round: 2, standing: second.standing });
  assert.match(input, /Between rounds Fairy ran these in a clean copy of the project[^]*<check command="node --test test\/cart\.test\.js" exit="1">\nnot ok 1 - adds each price times its quantity/);
  assert.deepEqual([result.outcome, result.design, result.rounds], ['settled', 'A', 2], 'B saw the test fail and came round');
  assert.match(conveneReply(result), /Between rounds 1 and 2, Fairy ran `node --test test\/cart\.test\.js` \(exit 1\), `node --test` \(exit 1\)\./);
});

test('nothing is run when the round settles, at the limit, or when no designer names a command', async () => {
  let ran = 0;
  const runChecksFn = async (commands: string[]) => { ran++; return commands.map(command => ({ command, exitCode: 0, output: '' })); };
  await convene({ designs: designs(), runChecks: runChecksFn, answer: async () => answerText({ vote: 'A', checks: ['node --test'] }) });
  await convene({ designs: designs(), runChecks: runChecksFn, rounds: 1, answer: async entry => answerText({ vote: entry.letter, checks: ['node --test'] }) });
  await convene({ designs: designs(), runChecks: runChecksFn, answer: async entry => answerText({ vote: entry.letter }) });
  assert.equal(ran, 0);
  // Three at most, however many are named.
  let asked: string[] = [];
  await convene({ designs: designs(), rounds: 2, runChecks: async commands => { asked = commands; return []; },
    answer: async (entry, { round }) => round === 1 ? answerText({ vote: entry.letter, checks: entry.letter === 'A' ? ['a', 'b'] : ['c', 'd'] }) : answerText({ vote: 'A' }) });
  assert.equal(asked.length, MAX_CHECKS);
});

test('a designer works in its own copy: it can try changes and run commands, and the copy goes when it’s done', async t => {
  const { root, place } = await project(t);
  let inside = '';
  const text = await withCopy({ root, place }, async copy => {
    inside = copy!.work;
    assert.equal(existsSync(join(copy!.work, '.env')), false, 'keys don’t come along');
    const tools = new WorkTools({ root: copy!.work, permission: 'auto', sandboxed: true, runCommand: (async ({ command }: { command: string }) => ({ exitCode: 1, output: `ran ${command}` })) as any, approve: async () => { throw new Error('no'); } });
    let offered: string[] = [];
    const provider = { turn: async (options: any) => {
      offered = options.tools.map((tool: any) => tool.name);
      await options.toolHandler({ tool: 'read_file', arguments: { path: 'src/cart.js' } });
      const wrote = await options.toolHandler({ tool: 'write_file', arguments: { path: 'src/cart.js', content: 'tried\n' } });
      const ran = await options.toolHandler({ tool: 'run_command', arguments: { command: 'node --test', reason: 'check' } });
      const asked = await options.toolHandler({ tool: 'ask_helper', arguments: { task: 'x' } });
      return `${wrote.success} ${/ran node --test/.test(ran.contentItems[0].text)} ${asked.success}`;
    } };
    const reply = await runDesigner({ provider, settings: {}, root: copy!.work, prompt: 'Fix it', tools, copy: true });
    assert.deepEqual(offered, ['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'run_command']);
    assert.equal(await readFile(join(copy!.work, 'src', 'cart.js'), 'utf8'), 'tried\n');
    return reply;
  });
  assert.equal(text, 'true true false');
  assert.match(await readFile(join(root, 'src', 'cart.js'), 'utf8'), /item\.price/, 'the project itself is untouched');
  assert.equal(existsSync(inside), false, 'the copy is deleted as soon as the design is written');
  assert.deepEqual(await readdir(place), []);
  // When no copy can be made, the designer reads the project as before.
  assert.equal(await withCopy({ root, place, make: async () => { throw new Error('This project is on a different disk.'); } }, async (copy, why) => `${copy} ${why}`), 'null This project is on a different disk.');
  // A designer that fails still leaves no copy.
  await assert.rejects(withCopy({ root, place }, async () => { throw new Error('quota'); }), /quota/);
  assert.deepEqual(await readdir(place), []);
  assert.match(designerInstructions('/copy', { copy: true }), /your own throwaway copy[^]*run commands \(sandboxed, without the network\)/);
  assert.match(designerInstructions('/p'), /You can't run commands; if a command would settle something, name it\./);
  let convening: any;
  await runConvener({ provider: { turn: async (options: any) => { convening = options; return 'x'; } }, settings: {}, root: '/copy', prompt: 'p', own: 'A', designs: [], round: 1, tools: { handle: () => ({}) } as any, copy: true });
  assert.ok(convening.tools.some((tool: any) => tool.name === 'run_command') && /throwaway copy/.test(convening.instructions));
});

test('checks run in one clean copy, keep the end of long output, and the copy goes', async t => {
  const { root, place } = await project(t);
  const cwds: string[] = [];
  const results = await runChecks({ commands: ['node --test', 'grep -rn quantity src', 'npm test', 'one too many'], root, place,
    run: async ({ command, cwd, timeout }) => { cwds.push(cwd); assert.ok(timeout > 0); if (command === 'npm test') throw new Error('Timed out.'); return { exitCode: command === 'node --test' ? 1 : 0, output: command === 'node --test' ? `${'x'.repeat(5000)}# fail 1` : '' }; } });
  assert.deepEqual(results.map(result => [result.command, result.exitCode, result.error || '']), [['node --test', 1, ''], ['grep -rn quantity src', 0, ''], ['npm test', null, 'Timed out.']]);
  assert.match(results[0].output, /^…x+# fail 1$/);
  assert.ok(results[0].output.length <= 4001);
  assert.equal(new Set(cwds).size, 1, 'one copy for the round’s checks');
  assert.notEqual(cwds[0], root, 'never the project itself');
  assert.deepEqual(await readdir(place), [], 'the copy is deleted afterwards');
  const failed = await runChecks({ commands: ['node --test'], root, place, run: async () => ({}), make: async () => { throw new Error('Too many files.'); } });
  assert.deepEqual(failed, [{ command: 'node --test', exitCode: null, output: '', error: 'Couldn’t copy the project to run it: Too many files.' }]);
  assert.equal(checksText(results.slice(0, 1)).split('\n')[0], '$ node --test');
});
