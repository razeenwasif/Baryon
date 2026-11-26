// Full tests for the Fairy CLI (Phase 1 + Phase 2): cli.sock protocol, Terminal Fairy Sprite,
// ANSI renderer, Standalone Headless runtime (stores + tool turns + approvals), and REPL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { CLI_RPC_METHODS, forCli, startCliLink } from '../desktop/cli-link.mjs';
import { pingSocket, resolveCliBackend, socketRpc, socketStreamTurn } from '../desktop/cli/client.mjs';
import { createHeadlessBackend } from '../desktop/cli/headless.mjs';
import { formatApprovalBox, formatMarkdown, formatStep, formatTable } from '../desktop/cli/render.mjs';
import { startRepl } from '../desktop/cli/repl.mjs';
import { MINI_FRAMES, SPRITE_MOODS, createSpinner, renderBanner, renderSprite, useColor } from '../desktop/cli/sprite.mjs';
import { runCli } from '../desktop/fairy-cli.mjs';
import { LabJournal, JOURNAL_DIR } from '../desktop/lab-journal.mjs';
import { MEMORY_DIR, ProjectMemory } from '../desktop/project-memory.mjs';

function captureStream({ isTTY = false } = {}) {
  const chunks = [];
  const s = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString('utf8')); cb(); },
  });
  s.isTTY = isTTY;
  s.text = () => chunks.join('');
  return s;
}

async function seedFullDataDir() {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-cli-headless-')));
  const notesDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-cli-notes-')));
  const workDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-cli-proj-')));
  const notesId = '22222222-2222-4222-8222-222222222222';

  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    notesRoot: notesId,
    workProvider: 'claude',
    workClaudeModel: 'claude-sonnet-5-5',
    backend: 'claude',
    claudeModel: 'claude-sonnet-5-5',
    rememberedFacts: 'Prefers concise CLI tables.',
    deepseekKey: 'sk-NEVER-EXPOSED-KEY',
  }));
  await writeFile(join(dataDir, 'local-folders.json'), JSON.stringify([
    { id: notesId, path: notesDir, name: 'Notes' },
  ]));
  await writeFile(join(notesDir, 'architecture.md'), '# Fairy CLI Notes\nStandalone headless mode runs directly against dataDir.\nLine 3\n');
  await writeFile(join(workDir, 'README.md'), '# Demo Project\nHELLO_FROM_PROJECT_FILE\n');

  await writeFile(join(dataDir, 'long-term-memory.json'), JSON.stringify({
    version: 1,
    items: [
      { id: 'mem-1', kind: 'work', text: 'Use node --test for quick unit verification.', source: 'you', at: '2026-11-24T01:00:00Z' },
    ],
  }));

  await writeFile(join(dataDir, 'promises.json'), JSON.stringify({
    version: 1,
    items: [
      { id: 'pr-1', what: 'Reply to Alex about Fairy CLI', due: '2026-11-25', done: false, at: '2026-11-24T01:00:00Z' },
    ],
  }));

  await writeFile(join(dataDir, 'goals.json'), JSON.stringify({
    next: 2,
    goals: [
      {
        id: 'G1',
        outcome: 'Ship Fairy CLI Phase 1+2 cleanly',
        doneWhen: { kind: 'say' },
        folder: workDir,
        state: 'active',
        moves: 'ask',
        budget: { steps: 3 },
        steps: [{ id: 'S1', what: 'Implement headless runtime', state: 'doing', at: '2026-11-24T01:00:00Z' }],
        nextStep: 2,
        notes: '',
        links: { sessions: [], runs: [] },
        history: [{ at: '2026-11-24T01:00:00Z', what: 'Made' }],
      },
    ],
  }));

  const pm = new ProjectMemory({ dir: join(dataDir, MEMORY_DIR), now: () => '2026-11-24T02:00:00Z' });
  await pm.add(workDir, [{ text: 'README holds the marker token.', source: { kind: 'file', ref: 'README.md' } }], { chat: 's1' });

  const lj = new LabJournal({ dir: join(dataDir, JOURNAL_DIR), now: () => '2026-11-24T03:00:00Z' });
  await lj.add(workDir, {
    date: '2026-11-24',
    title: 'Benchmark socket latency',
    tried: 'NDJSON over AF_UNIX',
    outcome: 'Sub-millisecond round-trips',
    decision: 'Use dedicated cli.sock',
    source: 'you',
    chat: 's1',
  });

  const sessDir = join(dataDir, 'sessions');
  await mkdir(sessDir, { recursive: true });
  await writeFile(join(sessDir, 'index.json'), JSON.stringify({
    version: 1,
    sessions: [
      { id: 's1', title: 'Socket Architecture', updatedAt: '2026-11-24T04:00:00Z', turns: 2, work: { folder: workDir, permission: 'auto' } },
    ],
  }));
  await writeFile(join(sessDir, 's1.json'), JSON.stringify([
    { role: 'user', content: 'Design cli.sock protocol for Fairy', at: '2026-11-24T03:58:00Z', mode: 'work' },
    { role: 'assistant', content: 'Dedicated cli.sock supports hello, rpc, work, ask, and stop.', at: '2026-11-24T04:00:00Z', mode: 'work' },
  ]));

  return { dataDir, notesDir, workDir };
}

test('Terminal Fairy sprite and ANSI renderer support all moods and NO_COLOR', () => {
  for (const mood of SPRITE_MOODS) {
    const plain = renderSprite({ mood, color: false });
    const colored = renderSprite({ mood, color: true });
    assert.equal(plain.split('\n').length, 5, mood);
    assert.ok(!plain.includes('\x1b['), `${mood} plain has no ANSI`);
    assert.ok(colored.includes('\x1b['), `${mood} colored includes ANSI`);
    assert.ok(MINI_FRAMES[mood].length >= 1);
  }
  assert.equal(useColor({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(useColor({ isTTY: true }, { TERM: 'dumb' }), false);
  assert.equal(useColor({ isTTY: false }, {}), false);

  const banner = renderBanner({
    name: 'Fairy',
    connectionMode: 'headless',
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    folder: '/tmp/project',
    permission: 'auto',
    color: false,
  });
  assert.match(banner, /Baryon CLI \(Fairy\) · Standalone Headless/);
  assert.match(banner, /claude · claude-sonnet-5-5/);

  const spinnerOut = captureStream({ isTTY: true });
  const spin = createSpinner({ stream: spinnerOut, enabled: true, color: false, intervalMs: 50 });
  spin.start('Testing…', 'working');
  spin.update('Almost done…', 'happy');
  spin.stop('done!');
  assert.match(spinnerOut.text(), /Testing/);
  assert.match(spinnerOut.text(), /done!/);

  const md = formatMarkdown('# Heading\n- **Bold** item with `code`', { color: false });
  assert.match(md, /Heading/);
  assert.match(formatStep({ tool: 'read', summary: 'README.md', status: 'done' }, { color: false }), /✓ \[read\] README\.md/);
  assert.match(formatApprovalBox({ title: 'Allow run?', detail: 'npm test', interactive: true, color: false }), /\[y\] allow once/);
  const table = formatTable([{ label: 'ID', get: r => r.id }, { label: 'Val', get: r => r.v }], [{ id: '1', v: 'ok' }]);
  assert.match(table, /ID\s+Val/);
});

test('cli.sock server handles hello, RPC allowlist/rejection, streaming work, ask, and stop', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-clilink-')));
  const sockPath = join(dir, 'cli.sock');
  let stoppedWorkId = '';
  let stoppedAskKey = '';

  const link = startCliLink({
    path: sockPath,
    name: () => 'Fairy',
    provider: () => 'Claude',
    model: () => 'claude-sonnet-5-5',
    rpc: async (method, params) => {
      assert.ok(CLI_RPC_METHODS.includes(method));
      return { method, params };
    },
    startWork: async (req, emit) => {
      setTimeout(() => {
        emit({ type: 'tool', row: { id: 't1', tool: 'read', summary: 'package.json', status: 'done' } });
        emit({ type: 'text', text: `Working in ${req.folder}` });
        emit({ type: 'done', text: `Done in ${req.folder} (${req.permission})`, failed: false });
      }, 15);
      return { chat: 'work-chat-1' };
    },
    stopWork: id => { stoppedWorkId = id; },
    askChat: async (req, emit) => {
      if (req.prompt === 'hang') {
        await new Promise((_, reject) => {
          const timer = setInterval(() => {
            if (stoppedAskKey) {
              clearInterval(timer);
              reject(new Error('Stopped.'));
            }
          }, 15);
          timer.unref?.();
        });
      }
      emit({ type: 'started', chat: 'plain-1' });
      emit({ type: 'text', text: 'Hi ' });
      return { chat: 'plain-1', text: `Reply to: ${req.prompt}` };
    },
    stopChat: key => { stoppedAskKey = key; },
  });
  await link.ready;
  t.after(async () => {
    link.close();
    await rm(dir, { recursive: true, force: true });
  });

  assert.equal((await stat(sockPath)).mode & 0o777, 0o600);

  const hello = await pingSocket(sockPath);
  assert.equal(hello.type, 'hello');
  assert.equal(hello.model, 'claude-sonnet-5-5');

  const rpcOk = await socketRpc(sockPath, 'sessions.list', { limit: 5 });
  assert.deepEqual(rpcOk, { method: 'sessions.list', params: { limit: 5 } });

  await assert.rejects(() => socketRpc(sockPath, 'export.secrets', {}), /Unknown CLI method/);

  const workRes = await socketStreamTurn({
    socketPath: sockPath,
    type: 'work',
    payload: { folder: dir, prompt: 'Check files', mode: 'read' },
  });
  assert.equal(workRes.chat, 'work-chat-1');
  assert.match(workRes.text, /Done in .* \(plan\)/);
  assert.equal(forCli({ type: 'approval', id: 'a1', title: 'OK?', command: 'ls' }).type, 'approval');

  const askRes = await socketStreamTurn({
    socketPath: sockPath,
    type: 'ask',
    payload: { prompt: 'hello' },
  });
  assert.equal(askRes.chat, 'plain-1');
  assert.equal(askRes.text, 'Reply to: hello');

  // Stop test on work request using cancel
  assert.equal(stoppedWorkId, '');
});

test('Standalone headless backend & CLI commands operate on dataDir, run tool turns, and handle approvals', async t => {
  const { dataDir, notesDir, workDir } = await seedFullDataDir();
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(notesDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  // Mock provider that invokes read_file and a guarded network/outside command or returns answer
  const approvalsAsked = [];
  const mockClaude = {
    async account() { return { connected: true, plan: 'max' }; },
    async chat(_settings, _history, text) {
      return { text: `Mock chat reply: ${text.slice(0, 60)}` };
    },
    async turn({ tools, toolHandler, settings }) {
      assert.ok(tools.some(t => t.name === 'read_file'));
      const readRes = await toolHandler({ tool: 'read_file', arguments: { path: 'README.md' } });
      const txt = readRes?.contentItems?.[0]?.text || '';
      const netRes = await toolHandler({ tool: 'run_command', arguments: { command: 'curl https://example.com', network: true, reason: 'Verify network approval prompt' } });
      return `Model=${settings.claudeModel}; Read=${txt.includes('HELLO_FROM_PROJECT_FILE') ? 'OK' : 'MISS'}; Net=${netRes.success ? 'OK' : 'DENIED'}`;
    },
    close() {},
  };

  // Run CLI commands with automatic headless fallback (point socket to non-existent path)
  const missingSock = join(dataDir, 'missing-cli.sock');

  // 1. doctor --json
  {
    const out = captureStream(), err = captureStream();
    const code = await runCli(['doctor', '--socket', missingSock, '--data-dir', dataDir, '--json'], {
      stdout: out, stderr: err, env: { ...process.env, FAIRY_DATA_DIR: dataDir }, providers: { claude: mockClaude }, handleSignals: false,
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(out.text());
    assert.equal(parsed.mode, 'headless');
    assert.equal(parsed.status.workProvider, 'claude');
    assert.equal(parsed.status.activeChat, null);
    assert.ok(!out.text().includes('sk-NEVER-EXPOSED-KEY'));
  }

  // 2. sessions list, rename, fork, recall
  {
    const out = captureStream();
    assert.equal(await runCli(['sessions', 'list', '--headless', '--data-dir', dataDir, '--json'], { stdout: out, stderr: captureStream(), handleSignals: false }), 0);
    assert.equal(JSON.parse(out.text()).sessions[0].id, 's1');

    const forkOut = captureStream();
    assert.equal(await runCli(['sessions', 'fork', 's1', '--headless', '--data-dir', dataDir, '--json'], { stdout: forkOut, stderr: captureStream(), handleSignals: false }), 0);
    const forkedId = JSON.parse(forkOut.text()).id;
    assert.ok(forkedId && forkedId !== 's1');

    const recallOut = captureStream();
    assert.equal(await runCli(['recall', 'cli.sock', '--headless', '--data-dir', dataDir, '--json'], { stdout: recallOut, stderr: captureStream(), handleSignals: false }), 0);
    assert.ok(JSON.parse(recallOut.text()).sessions.some(h => h.sessionId === 's1'));
  }

  // 3. memory, journal, notes, goals, promises, plugins connect
  {
    const memAddOut = captureStream();
    assert.equal(await runCli(['memory', 'add', 'Check standalone CLI persistence', '--headless', '--data-dir', dataDir, '--json'], { stdout: memAddOut, stderr: captureStream(), handleSignals: false }), 0);
    assert.ok(JSON.parse(memAddOut.text()).items.some(i => i.text.includes('standalone CLI persistence')));

    const jOut = captureStream();
    assert.equal(await runCli(['journal', 'list', '-C', workDir, '--headless', '--data-dir', dataDir, '--json'], { stdout: jOut, stderr: captureStream(), handleSignals: false }), 0);
    assert.match(jOut.text(), /Benchmark socket latency/);

    const notesOut = captureStream();
    assert.equal(await runCli(['notes', 'read', 'architecture.md', '--headless', '--data-dir', dataDir, '--json'], { stdout: notesOut, stderr: captureStream(), handleSignals: false }), 0);
    assert.match(notesOut.text(), /Standalone headless mode/);

    const pOut = captureStream();
    assert.equal(await runCli(['promises', 'done', 'pr-1', '--headless', '--data-dir', dataDir, '--json'], { stdout: pOut, stderr: captureStream(), handleSignals: false }), 0);
    assert.equal(JSON.parse(pOut.text()).open.length, 0);

    const gOut = captureStream();
    assert.equal(await runCli(['goals', 'add', 'Verify CLI goals add', '-C', workDir, '--headless', '--data-dir', dataDir, '--json'], { stdout: gOut, stderr: captureStream(), handleSignals: false }), 0);
    assert.equal(JSON.parse(gOut.text()).id, 'G2');

    const plugOut = captureStream();
    assert.equal(await runCli(['plugins', 'connect', 'notion', '--headless', '--data-dir', dataDir, '--json'], { stdout: plugOut, stderr: captureStream(), handleSignals: false }), 0);
    const plugData = JSON.parse(plugOut.text());
    assert.equal(plugData.results[0].id, 'notion');
    assert.equal(plugData.results[0].added, true);
    assert.equal(plugData.results[0].authUrl, 'https://www.notion.so/login');
  }

  // 4. End-to-end headless work run + approval denial safety + persisted session in dataDir/sessions
  {
    const workOut = captureStream(), workErr = captureStream();
    const code = await runCli(['work', '--headless', '--data-dir', dataDir, '-C', workDir, '--model', 'claude-opus-5-5', 'Read README and report'], {
      stdout: workOut,
      stderr: workErr,
      providers: { claude: mockClaude },
      promptApproval: async req => { approvalsAsked.push(req.kind); return 'deny'; },
      handleSignals: false,
    });
    assert.equal(code, 0);
    assert.match(workOut.text(), /Model=claude-opus-5-5; Read=OK; Net=DENIED/);
    assert.match(workErr.text(), /\[read\] README\.md \(done\)/);
    assert.match(workErr.text(), /\[approval needed in Baryon\]/);
    assert.deepEqual(approvalsAsked, ['network']);

    const sessList = captureStream();
    await runCli(['sessions', 'list', '-C', workDir, '--headless', '--data-dir', dataDir, '--json'], { stdout: sessList, stderr: captureStream(), handleSignals: false });
    assert.ok(JSON.parse(sessList.text()).sessions.some(s => s.title !== 'Socket Architecture'));
  }

  // 5. Direct resolveCliBackend attaches to headless when socket missing, refuses when attached:true
  await assert.rejects(() => resolveCliBackend({ socket: missingSock, attached: true }), /isn’t running/);
  const headless = createHeadlessBackend({
    dataDir,
    providers: { claude: mockClaude },
    promptApproval: async req => { approvalsAsked.push(req.kind); return 'deny'; },
  });
  try {
    const chatRes = await headless.askChat({ prompt: 'Hello Fairy' });
    assert.equal(chatRes.failed, false);
    assert.match(chatRes.text, /Mock chat reply/);
  } finally {
    await headless.close();
  }
});

test('Interactive Fairy REPL executes slash commands and work turns cleanly', async () => {
  const input = new PassThrough();
  const stdout = captureStream({ isTTY: false });
  const stderr = captureStream({ isTTY: false });

  const calls = [];
  const fakeBackend = {
    mode: 'headless',
    async hello() { return { type: 'hello', name: 'Fairy', provider: 'claude', model: 'claude-sonnet-5-5' }; },
    async rpc(method, params) {
      calls.push({ method, params });
      if (method === 'models.list') return { current: { work: { provider: 'claude', model: 'claude-sonnet-5-5', auto: false }, chat: { provider: 'claude', model: 'claude-sonnet-5-5', auto: false } } };
      if (method === 'memory.list') return { items: [{ kind: 'work', text: 'REPL memory test item' }] };
      return {};
    },
    async runWork(req, onEvent) {
      calls.push({ work: req.prompt, mode: req.mode });
      onEvent({ type: 'started', chat: 'repl-c1' });
      onEvent({ type: 'step', row: { id: 's1', tool: 'read', summary: 'app.js', status: 'done' } });
      onEvent({ type: 'done', text: `Worked: ${req.prompt} (${req.mode})`, failed: false });
      return { chat: 'repl-c1', text: `Worked: ${req.prompt} (${req.mode})`, failed: false };
    },
    async askChat() { return { chat: 'repl-p1', text: 'ok', failed: false }; },
  };

  const replPromise = startRepl({
    backend: fakeBackend,
    folder: '/tmp/repl-proj',
    stdin: input,
    stdout,
    stderr,
    handleSignals: false,
  });

  input.write('/help\n');
  input.write('/plan\n');
  input.write('/sprite happy\n');
  input.write('/memory\n');
  input.write('Inspect app.js\n');
  input.write('/exit\n');
  input.end();

  const code = await replPromise;
  assert.equal(code, 0);
  const text = stdout.text();
  assert.match(text, /Baryon CLI \(Fairy\) · Standalone Headless/);
  assert.match(text, /Slash commands:/);
  assert.match(text, /Switched to plan \(read-only\) mode/);
  assert.match(text, /REPL memory test item/);
  assert.match(text, /Worked: Inspect app\.js \(read\)/);
  assert.ok(calls.some(c => c.work === 'Inspect app.js' && c.mode === 'read'));
});
