// The token ledger (token-use plan, step 1): sizes by part for each work turn, with the provider's own counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TurnLedger, recordTurn } from '../desktop/token-ledger.mjs';
import { sentByPart, splitText, toolText } from '../src/token-split.js';
import { runWork } from '../desktop/work-agent.mjs';
import { workMeter } from '../src/work-context.js';

const text = (t: string) => ({ success: true, contentItems: [{ type: 'inputText', text: t }] });

test('the opening is counted by part, with project guidance and memory rules apart from the instructions', () => {
  const ledger = new TurnLedger({ session: 's1', provider: 'claude', model: 'claude-opus-5-5' });
  const guidance = 'G'.repeat(300), memory = 'M'.repeat(50), tools = [{ name: 'read_file', description: 'Reads a file.' }, { name: 'run_command', description: 'Runs it.' }];
  ledger.opening({ instructions: `RULES ${memory} MORE ${guidance}`, guidance, memory, tools, earlier: 'E'.repeat(40), message: 'Fix the test.' });
  assert.deepEqual(ledger.parts, { instructions: 'RULES  MORE '.length, guidance: 300, memory: 50, tools: JSON.stringify(tools[0]).length + JSON.stringify(tools[1]).length, earlier: 40, message: 13, results: 0, reply: 0 });
  assert.equal(ledger.line().tools, 2);
  // Guidance that isn't in the instructions (it was cut, or left out) isn't counted twice.
  const other = new TurnLedger(); other.opening({ instructions: 'short', guidance: 'not inside' });
  assert.equal(other.parts.guidance, 0); assert.equal(other.parts.instructions, 5);
});

test('tool results are counted by tool, pictures by number, and each is sent again on every later step', () => {
  const ledger = new TurnLedger();
  ledger.opening({ instructions: 'I'.repeat(100), message: 'M'.repeat(10) });
  ledger.result('read_file', text('x'.repeat(1000)));
  ledger.result('run_command', { success: false, contentItems: [{ type: 'inputText', text: 'y'.repeat(200) }, { type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' }] } as any);
  ledger.result('read_file', text('z'.repeat(500)));
  ledger.reply('Done.');
  const line = ledger.line();
  assert.equal(line.steps, 4);
  // The opening (110) on all 4 steps; the results on the steps after each: 1000×3, 200×2, 500×1.
  assert.equal(line.sent, 110 * 4 + 1000 * 3 + 200 * 2 + 500);
  assert.deepEqual(line.byTool, { read_file: { calls: 2, chars: 1500, images: 0 }, run_command: { calls: 1, chars: 200, images: 1 } });
  assert.equal(line.parts.results, 1700); assert.equal(line.parts.reply, 5); assert.equal(line.images, 1);
  assert.deepEqual(sentByPart(line), { instructions: 400, guidance: 0, memory: 0, tools: 0, earlier: 0, message: 40, results: 3900 });
});

test('the provider’s counts give a tokens-per-character rate; the last running total wins; no counts, no rate', () => {
  const ledger = new TurnLedger(); ledger.opening({ instructions: 'I'.repeat(4000) });
  assert.equal('reported' in ledger.line(), false);
  ledger.usage({ input: 500, output: 10, cached: 0 }); ledger.usage({ input: 1000, output: 40, cached: 600 });
  assert.deepEqual(ledger.line().reported, { input: 1000, output: 40, cached: 600 });
  assert.equal(ledger.line().rate, 0.25);
  ledger.usage(null); ledger.usage({ input: 0, output: 0 });
  assert.equal(ledger.line().reported!.input, 1000);
});

test('the ledger file gets one line a turn and keeps only the newest once it has grown', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fairy-ledger-')), 'token-ledger.jsonl');
  for (let i = 0; i < 3; i++) await recordTurn(path, { i, pad: 'p'.repeat(10) } as any, { keep: 5 });
  assert.deepEqual(readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line).i), [0, 1, 2]);
  writeFileSync(path, Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, pad: 'p'.repeat(300) })).join('\n') + '\n');
  await recordTurn(path, { i: 40, pad: 'p'.repeat(300) } as any, { keep: 5 });
  assert.deepEqual(readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line).i), [36, 37, 38, 39, 40]);
});

test('a work turn records its opening, every tool result, the reported counts and the reply', async () => {
  const offered = [{ name: 'read_file', description: 'Reads a file.' }];
  const tools = { root: mkdtempSync(join(tmpdir(), 'fairy-ledger-root-')), permission: 'auto', sandboxed: true, available: () => offered, handle: async (call: any) => text(`contents of ${call.arguments.path}`) };
  writeFileSync(join(tools.root, 'AGENTS.md'), 'Use tabs.');
  let seen: any = null, reported: any = null;
  const provider = { turn: async (options: any) => {
    seen = options;
    await options.toolHandler({ tool: 'read_file', arguments: { path: 'a.js' } });
    options.onUsage({ input: 2000, output: 30, cached: 1500 });
    return 'All done.';
  } };
  const ledger = new TurnLedger({ session: 's', provider: 'claude' });
  const reply = await runWork({ provider, settings: {}, text: 'Read a.js', history: [], summary: null, tools: tools as any, rules: 'Prefer short names.', ledger, onUsage: value => { reported = value; } });
  assert.equal(reply, 'All done.');
  assert.equal(seen.tools, offered, 'the provider gets the same tools');
  assert.deepEqual(reported, { input: 2000, output: 30, cached: 1500 }, 'the caller still gets the counts');
  const line = ledger.line();
  assert.equal(line.parts.guidance, 'Use tabs.'.length); assert.equal(line.parts.memory, 'Prefer short names.'.length);
  assert.equal(line.parts.message, seen.input[0].text.length);
  assert.ok(line.parts.message >= 'Read a.js'.length);
  assert.equal(line.parts.instructions + line.parts.guidance + line.parts.memory, seen.instructions.length);
  assert.deepEqual(line.byTool, { read_file: { calls: 1, chars: 'contents of a.js'.length, images: 0 } });
  assert.equal(line.parts.reply, 'All done.'.length); assert.equal(line.reported!.cached, 1500);
  // Without a ledger the turn runs as before.
  assert.equal(await runWork({ provider, settings: {}, text: 'Again', history: [], summary: null, tools: tools as any }), 'All done.');
});

test('the work meter shows the last turn’s split and the chat’s, with how much was read from the cache', () => {
  const ledger = { parts: { instructions: 100, tools: 100, message: 0, results: 0 }, steps: 2, sent: 600, byTool: { read_file: { chars: 300 }, run_command: { chars: 100 } } };
  const history = [{ role: 'user', content: 'Do it' }, { role: 'assistant', content: 'Done', mode: 'work', usage: { input: 1000, output: 10, cached: 400 }, ledger }];
  const meter = workMeter(history as any);
  assert.equal(meter.split!.last, 'instructions 33%, tools 33%, tool results 33%');
  assert.equal(meter.split!.lastTools, 'read_file 75%, run_command 25%');
  assert.equal(meter.split!.lastCached, 40); assert.equal(meter.split!.turns, 1);
  assert.equal(workMeter([{ role: 'user', content: 'x' }] as any).split, undefined, 'no ledger, no split');
  assert.equal(splitText([]), ''); assert.equal(toolText([{ byTool: {} }]), '');
});

test('the work turn makes a ledger, records it in the data folder and keeps its sizes on the reply', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /reply = await runWork\(\{ ledger: \(ledger = new TurnLedger\(\{ session: id, provider: workerSettings\.backend, model: modelOfSettings\(workerSettings\), role: turnLine\?\.role \}\)\),/);
  assert.match(main, /void recordTurn\(file\('token-ledger\.jsonl'\), ledgerLine\)\.catch\(/);
  assert.match(main, /\.\.\.\(ledgerLine \? \{ ledger: \{ parts: ledgerLine\.parts, steps: ledgerLine\.steps, sent: ledgerLine\.sent, images: ledgerLine\.images, byTool: ledgerLine\.byTool \} \} : \{\}\)/);
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /\+ splitTitle\(meter\.split\);/);
});
