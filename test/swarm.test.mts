import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LETTERS, SwarmRooms, buildRequest, chosenPick, designerSeats, designsReply, parseDesign, pickRequest, runDesigner, runDesigns, seatLabel } from '../desktop/swarm.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { CLAUDE_MODELS } from '../src/model-menu.js';

const offered = { claude: CLAUDE_MODELS, gemini: ['gemini-4-argon-high', 'gemini-4-hydrogen-high'], codex: [{ id: 'gpt-6-astra' }, { id: 'gpt-6.1-sol' }] };
const design = (confidence = 'high') => `## Finding\nThe total ignores quantity.\n## Evidence\nsrc/cart.js:4 adds item.price only.\n## Plan\n1. src/cart.js: multiply by quantity.\n## Check\nnode --test passes.\n## Risk\nQuantity may be missing on old carts.\n## Confidence\n${confidence}: the test shows it.`;

test('the seats: Claude and Gemini today, Codex once it’s signed in with room on its plan', () => {
  const { seats, out } = designerSeats({ status: { claude: true, gemini: true, codex: true }, offered, plans: { codex: { meters: [{ short: 'Month', used: 100 }] } } });
  assert.deepEqual(seats.map(seat => [seat.provider, seat.model, seat.effort]), [['claude', 'claude-opus-5-5', 'high'], ['gemini', 'gemini-4-argon-high', 'high']]);
  assert.deepEqual(out, [{ provider: 'codex', reason: 'at its plan’s limit' }]);
  assert.equal(designerSeats({ status: { claude: true, gemini: true, codex: true }, offered }).seats.at(-1)!.model, 'gpt-6.1-sol', 'Codex joins by itself when it has room');
  assert.equal(designerSeats({ status: { claude: true }, offered, tier: 'extreme' }).seats[0].model, 'claude-fable-5-2', 'the hardest work gets Fable 5.2');
  assert.deepEqual(designerSeats({ status: { claude: true, gemini: false }, offered }).out.map(entry => entry.reason), ['not signed in', 'not signed in']);
  assert.deepEqual(designerSeats({ status: { claude: true, gemini: true }, offered }).seats.map(seatLabel), ['Claude Opus 5.5', 'Gemini 4 Argon']);
});

test('a design is read into its six sections, and what’s missing is named', () => {
  const read = parseDesign(design('medium'));
  assert.deepEqual(Object.keys(read.sections), ['Finding', 'Evidence', 'Plan', 'Check', 'Risk', 'Confidence']);
  assert.deepEqual([read.missing, read.confidence, read.long], [[], 'medium', false]);
  assert.deepEqual(parseDesign('## Finding\nx\n## Plan\n1. y').missing, ['Evidence', 'Check', 'Risk', 'Confidence']);
  assert.equal(parseDesign(`## Finding\n${'word '.repeat(700)}`).long, true);
});

test('designers work side by side; one that fails sits out, and the rest are lettered in order', async () => {
  const seats = designerSeats({ status: { claude: true, gemini: true, codex: true }, offered }).seats, seen: string[] = [];
  const { designs, failed } = await runDesigns({ seats, onSeat: (seat, status) => seen.push(`${seat.provider}:${status}`),
    design: async seat => { if (seat.provider === 'gemini') throw new Error('Individual quota reached.'); return design(); } });
  assert.deepEqual(designs.map(entry => [entry.letter, entry.seat.provider]), [['A', 'claude'], ['B', 'codex']]);
  assert.deepEqual(failed.map(entry => [entry.seat.provider, entry.error]), [['gemini', 'Individual quota reached.']]);
  assert.ok(seen.includes('gemini:failed') && seen.includes('claude:done'));
  const slow = await runDesigns({ seats: seats.slice(0, 1), limit: 30, design: (_seat, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal(slow.failed[0].error, 'Took longer than ten minutes.');
  const stop = new AbortController(); stop.abort();
  await assert.rejects(runDesigns({ seats, signal: stop.signal, design: async () => design() }), /Stopped/);
});

test('the reply shows each design with its model, who sat out, and a card to pick one', () => {
  const seats = designerSeats({ status: { claude: true, gemini: true }, offered }).seats;
  const designs = seats.map((seat, i) => ({ seat, letter: LETTERS[i], text: design(i ? 'low' : 'high'), parsed: parseDesign(design(i ? 'low' : 'high')) }));
  const reply = designsReply({ designs, failed: [], out: [{ provider: 'codex', reason: 'at its plan’s limit' }] });
  assert.match(reply, /^\*\*Swarm: 2 designs, made separately\*\*/);
  assert.match(reply, /### Design A · Claude Opus 5\.5 · high confidence/);
  assert.match(reply, /### Design B · Gemini 4 Argon · low confidence/);
  assert.match(reply, /Sat out: Codex \(at its plan’s limit\)\./);
  const card = pickRequest(designs);
  assert.deepEqual(card.picks.map(pick => [pick.label, pick.decision]), [['Build A', 'allow'], ['Build B', 'always'], ['Put aside', 'deny']]);
  assert.equal(card.macOnly, true);
  assert.equal(chosenPick(card, 'always')!.letter, 'B');
  assert.equal(chosenPick(card, 'deny'), null);
  assert.match(buildRequest(designs[1]), /^Build design B from the swarm \(by Gemini 4 Argon\)\. Follow its plan, run its check/);
});

test('a designer can only read the project', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-swarm-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'a.js'), 'one\n');
  const tools = new WorkTools({ root, permission: 'plan', runCommand: (async () => ({ exitCode: 0, output: '' })) as any });
  let offeredTools: string[] = [];
  const provider = { turn: async (options: any) => {
    offeredTools = options.tools.map((tool: any) => tool.name);
    const read = await options.toolHandler({ tool: 'read_file', arguments: { path: 'a.js' } });
    const wrote = await options.toolHandler({ tool: 'write_file', arguments: { path: 'a.js', content: 'two\n' } });
    return `${read.success} ${wrote.success}`;
  } };
  assert.equal(await runDesigner({ provider, settings: {}, root, prompt: 'Fix it', tools }), 'true false');
  assert.deepEqual(offeredTools, ['read_file', 'list_files', 'search_files']);
  assert.equal(await readFile(join(root, 'a.js'), 'utf8'), 'one\n');
});

test('nothing is left on disk: a room goes when the swarm ends, and leftovers go at start-up', async t => {
  const dir = join(await realpath(await mkdtemp(join(tmpdir(), 'fairy-rooms-'))), 'swarms');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rooms = new SwarmRooms({ dir, log: () => {} });
  const room = await rooms.open({ prompt: 'Why does the cart total ignore quantity?' });
  await room.write('round-1/claude.md', design()); await room.note('1 design');
  assert.equal(await readFile(join(room.path, 'brief.md'), 'utf8'), 'Why does the cart total ignore quantity?');
  assert.equal(await room.remove(), true);
  assert.equal(existsSync(room.path), false);
  // A crash leaves two rooms behind; the next start clears them.
  await mkdir(join(dir, 'left-1', 'round-1'), { recursive: true }); await mkdir(join(dir, 'left-2'), { recursive: true });
  assert.equal(await rooms.sweep(), 2);
  assert.deepEqual(await readdir(dir), []);
  assert.equal(await new SwarmRooms({ dir: join(dir, 'never-made') }).sweep(), 0);
});
