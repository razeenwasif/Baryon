import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replyHTML, highlightCode } from '../src/reply-renderer.js';
import { detectFileReference, fileIconHTML, fileTypeInfo, languageDisplayInfo, languageForPath } from '../src/file-icons.js';
import { WorkTools } from '../desktop/work-tools.mjs';
import { WorkRuns } from '../desktop/work-runs.mjs';
import { runInSandbox } from '../desktop/work-sandbox.mjs';
import { ClaudeConnection } from '../desktop/claude.mjs';
import { CodexConnection } from '../desktop/codex.mjs';
import { AntigravityConnection } from '../desktop/antigravity.mjs';
import { readChatStream, readResponseStream } from '../desktop/streaming.mjs';
import { DEFAULTS } from '../desktop/core.mjs';
import { sourceLink } from '../desktop/local-files.mjs';

test('code blocks render with Antigravity-style header, file/language icons, copy button, and full highlighting', () => {
  const py = replyHTML('```python\ndef add(a, b):\n    return a + b\n```');
  assert.match(py, /class="code-block"/);
  assert.match(py, /class="code-block-header"/);
  assert.match(py, /class="code-copy"/);
  assert.match(py, /file-icon-python/);
  assert.match(py, /<span class="code-block-label">Python<\/span>/);
  assert.match(py, /hljs-keyword/);

  const withFile = replyHTML('```js src/app.js\nconst x = 42;\n```');
  assert.match(withFile, /file-icon-javascript/);
  assert.match(withFile, /<span class="code-block-label">src\/app\.js<\/span>/);
  assert.match(withFile, /hljs-number/);

  const docker = highlightCode('FROM node:22\nRUN npm test', 'dockerfile');
  assert.equal(docker.highlighted, true);
  assert.match(docker.html, /hljs-keyword/);

  const tex = highlightCode('\\frac{a}{b}', 'tex');
  assert.equal(tex.highlighted, true);
  assert.match(tex.html, /hljs-/);
});

test('file type icons render on inline file references and citations without false positives or text nodes in SVG', () => {
  const icon = fileIconHTML('src/app.js');
  assert.match(icon, /file-icon-javascript/);
  assert.match(icon, /<svg\b/);
  assert(!/<text\b/i.test(icon), 'SVGs stay pure vector so textContent & copy/paste stay clean');

  assert.equal(fileTypeInfo('Desktop.swift').id, 'swift');
  assert.equal(fileTypeInfo('Dockerfile').id, 'docker');
  assert.equal(fileTypeInfo('.gitignore').id, 'git');
  assert.equal(fileTypeInfo('.env.local').id, 'lock');
  assert.equal(fileTypeInfo('notes/lec1.pdf').id, 'pdf');
  assert.equal(fileTypeInfo('src', { isFolder: true }).id, 'folder');
  assert.equal(languageForPath('src/work-view.mjs'), 'javascript');
  assert.equal(languageDisplayInfo('zsh').iconId, 'shell');

  for (const good of ['src/app.js', 'package.json', 'Desktop.swift:42', 'src/replies.css#L10-L20', 'Dockerfile', '.gitignore', 'README.md', 'scripts/install-fairy.py']) {
    assert.ok(detectFileReference(good), `expected file reference: ${good}`);
  }
  for (const bad of ['console.log', 'process.env', 'window.stella', 'a.c', 'v1.2.3', 'https://example.com', 'foo(bar.js)', '--flag.js', '1.5']) {
    assert.equal(detectFileReference(bad), null, `should not match as file: ${bad}`);
  }

  const inline = replyHTML('Updated `src/reply-renderer.js` and `package.json`, calling `console.log`.');
  assert.match(inline, /file-ref-code[^>]*data-file-type="javascript"[^>]*>.*file-icon-javascript.*src\/reply-renderer\.js/s);
  assert.match(inline, /file-ref-code[^>]*data-file-type="json"[^>]*>.*file-icon-json.*package\.json/s);
  assert.match(inline, /<code>console\.log<\/code>/);

  const link = sourceLink('12345678-1234-1234-1234-1234567890ab', 'analysis/model.py', 12);
  const cited = replyHTML(`See [model.py, line 12](${link}).`);
  assert.match(cited, /class="file-ref-link"/);
  assert.match(cited, /file-icon-python/);

  const codeInLink = replyHTML(`See [\`model.py\`](${link}).`);
  assert.equal((codeInLink.match(/class="file-icon /g) || []).length, 1, 'backticked file inside a file link gets only one icon');
});

test('Claude streams summarized thinking blocks and pre-tool reasoning in chronological order', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'fairy-claude-think-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let seenArgs = [];
  const connection = new ClaudeConnection({
    cwd, executable: '/fake/claude',
    exec: (_b, _a, _o, done) => done(null, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })),
    spawnProcess: (_bin, args) => {
      seenArgs = args;
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => queueMicrotask(() => child.emit('close', 0));
      child.stdin = new Writable({
        write(_c, _e, done) {
          done();
          const emit = e => child.stdout.write(JSON.stringify(e) + '\n');
          queueMicrotask(() => {
            emit({ type: 'stream_event', event: { type: 'message_start' } });
            emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } });
            emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'First check package.json.' } } });
            emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
            emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking package.json now.' } } });
            emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' } } });
            emit({ type: 'stream_event', event: { type: 'message_start' } });
            emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } });
            emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Now summarize findings.' } } });
            emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
            emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'All set!' } } });
            emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
            emit({ type: 'result', result: 'All set!', is_error: false });
            child.emit('close', 0);
          });
        },
      });
      return child;
    },
  });

  const thoughts = [], texts = [];
  const reply = await connection.turn({ settings: DEFAULTS, prompt: 'test', onText: v => texts.push(v), onThought: th => thoughts.push(th) });
  assert.equal(reply, 'All set!');
  assert.equal(seenArgs[seenArgs.indexOf('--thinking-display') + 1], 'summarized');
  const finalized = thoughts.filter(th => th.status === 'done');
  assert.deepEqual(finalized.map(th => [th.kind, th.text]), [
    ['thinking', 'First check package.json.'],
    ['commentary', 'Checking package.json now.'],
    ['thinking', 'Now summarize findings.'],
  ]);
  assert.ok(texts.includes(''), 'pre-tool draft clears after promoting commentary');
  assert.equal(texts.at(-1), 'All set!');
});

test('Codex streams reasoning summaries and commentary via onThought without polluting onText', async () => {
  const calls = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const emit = msg => child.stdout.write(JSON.stringify(msg) + '\n');
  child.kill = () => { child.stdout.end(); child.emit('close', 0); };
  child.stdin = new Writable({
    write(chunk, _enc, done) {
      const msg = JSON.parse(chunk); calls.push(msg); done();
      if (!msg.method || msg.id === undefined) return;
      const result = { 'config/read': { config: {} }, 'account/read': { account: { type: 'chatgpt', planType: 'plus' } }, 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'u1' } }, 'model/list': { data: [] } }[msg.method] || {};
      queueMicrotask(() => {
        emit({ id: msg.id, result });
        if (msg.method === 'turn/start') {
          const send = (method, params) => emit({ method, params: { threadId: 't1', ...params } });
          send('item/started', { item: { id: 'r1', type: 'reasoning' } });
          send('item/reasoning/summaryPartAdded', { itemId: 'r1', summaryIndex: 0 });
          send('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 0, delta: '**Planning tests**' });
          send('item/completed', { item: { id: 'r1', type: 'reasoning', summary: ['**Planning tests**'] } });
          send('item/started', { item: { id: 'c1', type: 'agentMessage', phase: 'commentary' } });
          send('item/agentMessage/delta', { itemId: 'c1', delta: 'Running npm test next.' });
          send('item/completed', { item: { id: 'c1', type: 'agentMessage', phase: 'commentary', text: 'Running npm test next.' } });
          send('item/started', { item: { id: 'a1', type: 'agentMessage', phase: 'final_answer' } });
          send('item/agentMessage/delta', { itemId: 'a1', delta: 'Done.' });
          send('item/completed', { item: { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: 'Done.' } });
          send('turn/completed', { turn: { status: 'completed' } });
        }
      });
    },
  });
  const connection = new CodexConnection({ cwd: '/tmp', executable: '/fake/codex', spawnProcess: () => child });
  const thoughts = [], texts = [];
  try {
    const reply = await connection.turn({ settings: DEFAULTS, input: [{ type: 'text', text: 'hi' }], onText: t => texts.push(t), onThought: th => thoughts.push(th) });
    assert.equal(reply, 'Done.');
    assert.equal(calls.find(c => c.method === 'turn/start').params.summary, 'detailed');
    assert.deepEqual(texts, ['Done.', 'Done.']);
    const done = thoughts.filter(th => th.status === 'done');
    assert.deepEqual(done.map(th => [th.kind, th.text]), [
      ['thinking', '**Planning tests**'],
      ['commentary', 'Running npm test next.'],
    ]);
  } finally { connection.close(); }
});

test('Antigravity streams thinking_delta and promotes pre-tool narration to onThought', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-agy-think-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.stdout.end(); queueMicrotask(() => child.emit('close', 0)); };
    child.stdin = new Writable({
      write(_chunk, _enc, done) {
        done();
        const emit = e => child.stdout.write(JSON.stringify(e) + '\n');
        queueMicrotask(() => {
          emit({ event: 'step_update', step_update: { step_index: 1, step_type: 'thinking', state: 'ACTIVE', thinking_delta: 'Analyzing repo layout.' } });
          emit({ event: 'step_update', step_update: { step_index: 1, step_type: 'thinking', state: 'DONE', duration_seconds: 1.2 } });
          emit({ event: 'step_update', step_update: { step_index: 2, step_type: 'agent_response', state: 'ACTIVE', text_delta: 'I will list files first.' } });
          emit({ event: 'step_update', step_update: { step_index: 3, step_type: 'tool', state: 'ACTIVE', tool_name: 'mcp_fairy_list_files' } });
          emit({ event: 'step_update', step_update: { step_index: 4, step_type: 'agent_response', state: 'DONE', text_delta: 'Found 3 files.' } });
          emit({ event: 'result', result: { status: 'SUCCESS', response: 'Found 3 files.' } });
        });
      },
    });
    return child;
  };
  const connection = new AntigravityConnection({ cwd: join(dir, 'ws'), agentsDir: join(dir, 'agents'), executable: '/fake/agy', spawnProcess, warmAfterTurn: false });
  const thoughts = [];
  const reply = await connection.attempt({ settings: DEFAULTS, prompt: 'hi', home: dir, onThought: th => thoughts.push(th) });
  assert.equal(reply, 'Found 3 files.');
  const done = thoughts.filter(th => th.status === 'done');
  assert.deepEqual(done.map(th => [th.kind, th.text]), [
    ['thinking', 'Analyzing repo layout.'],
    ['commentary', 'I will list files first.'],
  ]);
});

test('DeepSeek and OpenAI streaming emit reasoning thoughts before final content', async () => {
  const sse = lines => new Response(new ReadableStream({
    start(ctrl) { ctrl.enqueue(new TextEncoder().encode(lines.join('\n\n') + '\n\n')); ctrl.close(); },
  }));
  const dsThoughts = [];
  const dsRes = await readChatStream(sse([
    'data: {"choices":[{"delta":{"reasoning_content":"Step 1: "}}]}',
    'data: {"choices":[{"delta":{"reasoning_content":"add 2 + 2."}}]}',
    'data: {"choices":[{"delta":{"content":"4"}}]}',
    'data: [DONE]',
  ]), () => {}, undefined, th => dsThoughts.push(th));
  assert.equal(dsRes.text, '4');
  assert.equal(dsThoughts.at(-1).status, 'done');
  assert.equal(dsThoughts.at(-1).text, 'Step 1: add 2 + 2.');

  const oaiThoughts = [];
  const oaiRes = await readResponseStream(sse([
    'data: {"type":"response.output_item.added","item":{"id":"rs1","type":"reasoning"}}',
    'data: {"type":"response.reasoning_summary_part.added","item_id":"rs1","summary_index":0}',
    'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs1","summary_index":0,"delta":"Checking math"}',
    'data: {"type":"response.output_item.done","item":{"id":"rs1","type":"reasoning","summary":[{"text":"Checking math"}]}}',
    'data: {"type":"response.output_text.delta","delta":"4"}',
    'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
  ]), () => {}, undefined, th => oaiThoughts.push(th));
  assert.equal(oaiRes.status, 'completed');
  assert.equal(oaiThoughts.at(-1).status, 'done');
  assert.equal(oaiThoughts.at(-1).text, 'Checking math');
});

test('WorkTools records interleaved thoughts and live command output in chronological order', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-live-cmd-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs = new WorkRuns();
  const run = runs.start({ session: 's1', root });
  const tools = new WorkTools({
    root, permission: 'auto', runCommand: runInSandbox,
    onEvent: event => runs.emit(run, event),
  });

  tools.recordThought({ id: 'th-1', text: 'First I will print two lines.', status: 'running', kind: 'thinking' });
  tools.recordThought({ id: 'th-1', text: 'First I will print two lines.', status: 'done', kind: 'thinking', durationMs: 1200 });
  // Empty completed thinking placeholder should be cleaned up automatically.
  tools.recordThought({ id: 'th-empty', text: '', status: 'running', kind: 'thinking' });
  tools.recordThought({ id: 'th-empty', text: '   ', status: 'done', kind: 'thinking' });

  const liveOutputs = [];
  const origEmit = tools.onEvent;
  tools.onEvent = event => {
    if (event.type === 'tool' && event.row.tool === 'run' && event.row.status === 'running' && event.row.output) {
      liveOutputs.push(event.row.output);
    }
    origEmit(event);
  };

  const cmdRes = await tools.handle({ tool: 'run_command', arguments: { command: 'echo line-one; sleep 0.15; echo line-two', reason: 'Stream live output' } });
  assert.equal(cmdRes.success, true);

  tools.recordThought({ id: 'th-2', text: 'Both lines printed cleanly.', status: 'done', kind: 'thinking', durationMs: 600 });

  const snapshot = runs.snapshot('s1');
  assert.deepEqual(snapshot.rows.map(r => r.tool), ['thought', 'run', 'thought']);
  assert.equal(snapshot.rows[0].text, 'First I will print two lines.');
  assert.equal(snapshot.rows[1].command, 'echo line-one; sleep 0.15; echo line-two');
  assert.equal(snapshot.rows[1].status, 'done');
  assert.match(snapshot.rows[1].output, /line-one[\s\S]*line-two/);
  assert.ok(liveOutputs.some(out => out.includes('line-one')), 'command output streamed while running');
  assert.equal(snapshot.rows[2].text, 'Both lines printed cleanly.');
  runs.finish('s1');
});
