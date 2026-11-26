// Doc 7, #11: fairy CLI client over local Unix socket and read-only Fairy MCP stdio server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startElectronLink } from '../desktop/electron-link.mjs';
import {
  defaultDataDir,
  defaultSocketPath,
  parseCliArgs,
  pingFairy,
  runCli,
  runFairyWork,
} from '../desktop/fairy-cli.mjs';
import { MCP_TOOLS, createFairyMcpHandler } from '../desktop/fairy-mcp.mjs';
import { LabJournal, JOURNAL_DIR } from '../desktop/lab-journal.mjs';
import { McpClient } from '../desktop/mcp-client.mjs';
import { MEMORY_DIR, ProjectMemory } from '../desktop/project-memory.mjs';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function memoryStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString('utf8')); cb(); },
  });
  stream.text = () => chunks.join('');
  return stream;
}

async function linkAt(start, stop = () => {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-cli-sock-')));
  const path = join(dir, 'electron.sock');
  const link = startElectronLink({ path, start, stop, name: () => 'Fairy', provider: () => 'Claude' });
  for (let i = 0; i < 50 && !existsSync(path); i += 1) await new Promise(r => setTimeout(r, 10));
  return { dir, path, link };
}

async function seedDataDir() {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-mcp-data-')));
  const notesDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-mcp-notes-')));
  const notesId = '11111111-1111-4111-8111-111111111111';

  // Settings intentionally includes API key fields that MCP MUST NEVER leak
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    notesRoot: notesId,
    rememberedFacts: 'User prefers dark mode\nsk-shouldBeRedacted123456',
    deepseekKey: 'sk-SUPER-SECRET-DEEPSEEK',
    openaiKey: 'sk-SUPER-SECRET-OPENAI',
  }));
  await writeFile(join(dataDir, 'local-folders.json'), JSON.stringify([
    { id: notesId, path: notesDir, name: 'Notes' },
  ]));
  await writeFile(join(notesDir, 'caching.md'), '# Embedding Cache\nWe store SHA-256 keyed embeddings in LRU memory up to 512 MB.\nLine 3\n');
  await writeFile(join(notesDir, '.env'), 'SECRET_TOKEN=must_not_read\n');

  await writeFile(join(dataDir, 'long-term-memory.json'), JSON.stringify({
    version: 1,
    items: [
      { id: 'm1', kind: 'you', text: 'Working on ML systems in Sydney.', source: 'you', at: '2026-11-20T01:00:00Z' },
      { id: 'm2', kind: 'projects', text: 'Ship Fairy Doc 7 Batch 2 cleanly.', source: 'reflection', at: '2026-11-21T02:00:00Z' },
      { id: 'm3', kind: 'work', text: 'Run targeted node --test suites before committing.', source: 'you', at: '2026-11-21T03:00:00Z' },
    ],
  }));

  const projectMemory = new ProjectMemory({ dir: join(dataDir, MEMORY_DIR), now: () => '2026-11-21T04:00:00Z' });
  await projectMemory.add('/repos/demo', [
    { text: 'Build scripts use Vite with desktop tests under node --test.', source: { kind: 'file', ref: 'package.json' } },
  ], { chat: 'sess-1' });

  const journal = new LabJournal({ dir: join(dataDir, JOURNAL_DIR), now: () => '2026-11-22T05:00:00Z' });
  await journal.add('/repos/demo', {
    date: '2026-11-22',
    title: 'Tune KV cache eviction',
    tried: 'Benchmarked FIFO vs LRU on 10k prompts',
    outcome: 'LRU improved hit rate by 14%',
    decision: 'Keep LRU with 512 MB cap.',
    source: 'auto',
    chat: 'sess-1',
    replyAt: '2026-11-22T05:00:00Z',
  });

  const sessionsDir = join(dataDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, 'index.json'), JSON.stringify({
    version: 1,
    sessions: [
      { id: 'sess-1', title: 'KV cache discussion', updatedAt: '2026-11-22T05:00:00Z', turns: 2, work: { folder: '/repos/demo', permission: 'auto' } },
    ],
  }));
  await writeFile(join(sessionsDir, 'sess-1.json'), JSON.stringify([
    { role: 'user', content: 'Should we keep LRU eviction for KV cache?', at: '2026-11-22T04:58:00Z', mode: 'work' },
    { role: 'assistant', content: 'Yes, LRU improved hit rate by 14% with a 512 MB cap.', at: '2026-11-22T05:00:00Z', mode: 'work' },
  ]));

  return { dataDir, notesDir };
}

test('parseCliArgs and path helpers handle subcommands, flags, and errors', () => {
  assert.equal(defaultDataDir({ FAIRY_DATA_DIR: '/custom/fairy' }), '/custom/fairy');
  assert.equal(defaultSocketPath({ FAIRY_SOCKET: '/tmp/custom.sock' }), '/tmp/custom.sock');
  assert.equal(defaultSocketPath({ FAIRY_DATA_DIR: '/custom/fairy' }), '/custom/fairy/electron.sock');

  assert.equal(parseCliArgs([]).command, 'repl');
  assert.deepEqual(parseCliArgs(['--help']), { command: 'help' });
  const pingOpts = parseCliArgs(['ping', '--json']);
  assert.equal(pingOpts.command, 'status');
  assert.equal(pingOpts.json, true);
  assert.equal(pingOpts.mode, 'edit');
  assert.equal(pingOpts.quiet, false);
  const runOpts = parseCliArgs(['run', '-C', '/tmp/proj', '--read', '--chat', 'c1', '--quiet', 'Fix', 'the', 'tests']);
  assert.equal(runOpts.command, 'run');
  assert.equal(runOpts.folder, '/tmp/proj');
  assert.equal(runOpts.mode, 'read');
  assert.equal(runOpts.chat, 'c1');
  assert.equal(runOpts.quiet, true);
  assert.equal(runOpts.prompt, 'Fix the tests');

  assert.equal(parseCliArgs(['mcp', '--data-dir', '/tmp/d']).dataDir, '/tmp/d');
  assert.throws(() => parseCliArgs(['run', '--mode', 'yolo']), /Invalid mode/);
  assert.throws(() => parseCliArgs(['run', '--unknown-flag']), /Unknown option/);
});

test('pingFairy, runFairyWork, runCli, and bin/fairy work over a real local Unix socket', async t => {
  let stoppedChat = null;
  let triggerStopReply = null;
  const { dir, path, link } = await linkAt(async (request, emit) => {
    if (request.prompt === 'reject-me') throw new Error('Busy in that folder.');
    if (request.prompt === 'hang') {
      triggerStopReply = () => emit({ type: 'done', text: 'Stopped.', failed: true });
      return { chat: 'chat-hang' };
    }
    setTimeout(() => {
      emit({ type: 'tool', row: { id: 'r1', tool: 'read', summary: 'package.json', status: 'done' } });
      emit({ type: 'approval', id: 'ap1', title: 'Run npm test', command: 'npm test' });
      emit({ type: 'text', text: `Ran in ${request.folder} (${request.permission})` });
      emit({ type: 'done', text: `Completed in ${request.folder} (${request.permission})`, failed: false });
    }, 20);
    return { chat: 'chat-42' };
  }, id => {
    stoppedChat = id;
    triggerStopReply?.();
  });
  t.after(async () => {
    link.close();
    await rm(dir, { recursive: true, force: true });
  });

  const hello = await pingFairy({ socketPath: path });
  assert.deepEqual(hello, { type: 'hello', name: 'Fairy', provider: 'Claude' });

  const workRes = await runFairyWork({ socketPath: path, folder: dir, prompt: 'Run check', mode: 'read' });
  assert.equal(workRes.chat, 'chat-42');
  assert.equal(workRes.failed, false);
  assert.match(workRes.text, /Completed in/);
  assert.ok(workRes.events.some(e => e.type === 'approval'));

  // Aborting sends stop over socket and settles cleanly
  const controller = new AbortController();
  const abortPromise = runFairyWork({ socketPath: path, folder: dir, prompt: 'hang', signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  const aborted = await abortPromise;
  assert.equal(stoppedChat, 'chat-hang');
  assert.equal(aborted.failed, true);

  // CLI human output + JSON NDJSON output + error exit code
  const out1 = memoryStream(), err1 = memoryStream();
  const code1 = await runCli(['run', '--socket', path, '--folder', dir, 'hello'], { stdout: out1, stderr: err1, handleSignals: false });
  assert.equal(code1, 0);
  assert.match(out1.text(), /Completed in/);
  assert.match(err1.text(), /\[chat chat-42\]/);
  assert.match(err1.text(), /\[approval needed in Baryon\]/);

  const out2 = memoryStream(), err2 = memoryStream();
  const code2 = await runCli(['run', '--socket', path, '--folder', dir, '--json', 'hello'], { stdout: out2, stderr: err2, handleSignals: false });
  assert.equal(code2, 0);
  const lines = out2.text().trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.some(l => l.type === 'started' && l.chat === 'chat-42'));
  assert.ok(lines.some(l => l.type === 'done'));

  const out3 = memoryStream(), err3 = memoryStream();
  const code3 = await runCli(['run', '--socket', path, '--folder', dir, 'reject-me'], { stdout: out3, stderr: err3, handleSignals: false });
  assert.equal(code3, 1);
  assert.match(err3.text(), /Busy in that folder/);

  // Friendly error when socket does not exist
  const err4 = memoryStream();
  const code4 = await runCli(['status', '--socket', join(dir, 'missing.sock')], { stdout: memoryStream(), stderr: err4, handleSignals: false });
  assert.equal(code4, 1);
  assert.match(err4.text(), /isn’t running/);

  // Subprocess bin/baryon --help & bin/fairy --help
  const { stdout: helpOut } = await execFileAsync(process.execPath, [join(ROOT, 'bin/baryon'), '--help']);
  assert.match(helpOut, /Baryon CLI/);
  assert.match(helpOut, /Usage:/);
  const { stdout: legacyHelp } = await execFileAsync(process.execPath, [join(ROOT, 'bin/fairy'), '--help']);
  assert.match(legacyHelp, /Usage:/);
});

test('createFairyMcpHandler serves all 6 read-only tools & resources and blocks secrets / path escape', async t => {
  const { dataDir, notesDir } = await seedDataDir();
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(notesDir, { recursive: true, force: true });
  });

  const { handleMessage } = createFairyMcpHandler({ dataDir });
  const rpc = async (method, params = {}, id = 1) => handleMessage({ jsonrpc: '2.0', id, method, params });

  const init = await rpc('initialize', {});
  assert.equal(init.result.serverInfo.name, 'fairy-mcp');
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const toolsList = await rpc('tools/list');
  assert.equal(toolsList.result.tools.length, 6);
  assert.deepEqual(toolsList.result.tools.map(t => t.name), MCP_TOOLS.map(t => t.name));

  // 1. fairy_memory_read
  const mem = await rpc('tools/call', { name: 'fairy_memory_read', arguments: { kind: 'projects' } });
  const memText = mem.result.content[0].text;
  assert.match(memText, /Ship Fairy Doc 7 Batch 2/);
  assert.ok(!memText.includes('sk-SUPER-SECRET'), 'never leaks settings API keys');
  assert.ok(!memText.includes('sk-shouldBeRedacted123456'), 'redacts secret tokens');

  // 2. fairy_project_memory
  const pmAll = await rpc('tools/call', { name: 'fairy_project_memory', arguments: {} });
  assert.match(pmAll.result.content[0].text, /\/repos\/demo/);
  const pmDemo = await rpc('tools/call', { name: 'fairy_project_memory', arguments: { folder: '/repos/demo' } });
  assert.match(pmDemo.result.content[0].text, /Build scripts use Vite/);

  // 3. fairy_lab_journal
  const lj = await rpc('tools/call', { name: 'fairy_lab_journal', arguments: { folder: '/repos/demo', query: 'LRU' } });
  assert.match(lj.result.content[0].text, /Tune KV cache eviction/);

  // 4. fairy_recall_sessions
  const recall = await rpc('tools/call', { name: 'fairy_recall_sessions', arguments: { query: 'LRU cache eviction' } });
  assert.match(recall.result.content[0].text, /KV cache discussion/);
  assert.match(recall.result.content[0].text, /sess-1/);

  // 5. fairy_notes_search
  const ns = await rpc('tools/call', { name: 'fairy_notes_search', arguments: { query: 'SHA-256 embeddings' } });
  assert.match(ns.result.content[0].text, /caching\.md/);

  // 6. fairy_notes_read + path escape & secret file blocking
  const nr = await rpc('tools/call', { name: 'fairy_notes_read', arguments: { path: 'caching.md', start_line: 1, max_lines: 2 } });
  assert.equal(nr.result.isError, false);
  assert.match(nr.result.content[0].text, /Embedding Cache/);

  for (const forbidden of ['../outside.txt', '.env', '/etc/passwd']) {
    const escaped = await rpc('tools/call', { name: 'fairy_notes_read', arguments: { path: forbidden } });
    assert.equal(escaped.result.isError, true, forbidden);
  }

  // Invalid argument check
  const invalid = await rpc('tools/call', { name: 'fairy_notes_read', arguments: { path: 'caching.md', bogus: true } });
  assert.equal(invalid.result.isError, true);

  // Resources
  const resList = await rpc('resources/list');
  assert.equal(resList.result.resources.length, 2);
  const resProj = await rpc('resources/read', { uri: 'fairy://projects' });
  assert.match(resProj.result.contents[0].text, /\/repos\/demo/);
  const resMissing = await rpc('resources/read', { uri: 'fairy://nope' });
  assert.equal(resMissing.error.code, -32002);
});

test('McpClient connects end-to-end over stdio to bin/fairy-mcp', async t => {
  const { dataDir, notesDir } = await seedDataDir();
  const target = `${shellQuote(process.execPath)} ${shellQuote(join(ROOT, 'bin/fairy-mcp'))} --data-dir ${shellQuote(dataDir)}`;
  const client = new McpClient({ connector: { name: 'fairy', kind: 'command', target } });
  t.after(async () => {
    client.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(notesDir, { recursive: true, force: true });
  });

  const tools = await client.connect();
  assert.equal(tools.length, 6);
  assert.ok(tools.some(tool => tool.remote === 'fairy_lab_journal'));

  const journalRes = await client.call('fairy_lab_journal', { folder: '/repos/demo' });
  assert.equal(journalRes.failed, false);
  assert.match(journalRes.text, /Tune KV cache eviction/);

  const recallRes = await client.call('fairy_recall_sessions', { query: 'LRU eviction 14%' });
  assert.equal(recallRes.failed, false);
  assert.match(recallRes.text, /sess-1/);

  const notesRes = await client.call('fairy_notes_read', { path: 'caching.md' });
  assert.equal(notesRes.failed, false);
  assert.match(notesRes.text, /SHA-256 keyed embeddings/);
});
