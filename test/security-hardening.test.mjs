import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatA2UIActionPrompt, safeActionContextJson } from '../desktop/a2ui.mjs';
import { BoardStore, sanitizeSvgImport } from '../desktop/boards.mjs';
import { ConnectorStore, McpClient } from '../desktop/mcp-client.mjs';

test('formatA2UIActionPrompt and safeActionContextJson bound size, break cycles, and strip unsafe keys', () => {
  const circular = { safe: 'ok' };
  circular.self = circular;
  const protoInjected = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"bad":1},"prototype":{"bad":2},"ok":"kept"}');
  const shared = { tag: 'x' };
  const prompt = formatA2UIActionPrompt({
    surfaceId: 's1',
    actionName: 'submit',
    sourceComponentId: 'btn1',
    context: { circular, protoInjected, first: shared, second: shared },
  });
  assert.match(prompt, /"safe":"ok"/);
  assert.match(prompt, /"\[Circular\]"/);
  assert.match(prompt, /"ok":"kept"/);
  assert.equal(prompt.includes('"__proto__"'), false);
  assert.equal(prompt.includes('"constructor"'), false);
  assert.equal(prompt.includes('"prototype"'), false);
  // Shared non-circular references serialize twice rather than falsely marked [Circular].
  assert.equal((prompt.match(/"tag":"x"/g) || []).length, 2);

  const huge = safeActionContextJson({ text: 'A'.repeat(20000) });
  assert.ok(huge.endsWith('… [truncated]'));
  assert.ok(huge.length <= 8020);
});

test('sanitizeSvgImport strips active script/foreignObject/handlers/hrefs and keeps safe SVG', () => {
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
    <script>fetch("https://evil.test")</script>
    <foreignObject width="100" height="100"><div>bad</div></foreignObject>
    <a href="javascript:alert(2)"><rect width="10" height="10" onclick="evil()"/></a>
    <use xlink:href="data:text/html,<script>1</script>"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`;
  const clean = sanitizeSvgImport(dirty);
  assert.equal(/<script/i.test(clean), false);
  assert.equal(/<foreignObject/i.test(clean), false);
  assert.equal(/\son(?:load|click)\s*=/i.test(clean), false);
  assert.equal(/javascript:|data:text\/html/i.test(clean), false);
  assert.match(clean, /<rect width="10" height="10"\s*\/>/);
  assert.match(clean, /<circle cx="12" cy="12" r="5" fill="#fff"\/>/);
});

test('BoardStore blocks path traversal and invalid board IDs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-boards-sec-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new BoardStore({ dir });
  for (const bad of ['../escape', 'foo/bar', '..', '', 'a']) {
    assert.throws(() => store.boardPath(bad), /Invalid board/);
  }
});

test('ConnectorStore.add rejects URLs with credentials or metadata/link-local hosts and allows safe endpoints', async () => {
  const store = new ConnectorStore({ read: async () => null, write: async () => {}, id: () => 'id-1' });
  await assert.rejects(
    store.add({ name: 'cred', kind: 'url', target: 'https://user:pass@mcp.example.com/mcp' }),
    /credentials/,
  );
  await assert.rejects(
    store.add({ name: 'aws-meta', kind: 'url', target: 'https://169.254.169.254/latest/meta-data/' }),
    /not allowed/,
  );
  await assert.rejects(
    store.add({ name: 'gcp-meta', kind: 'url', target: 'https://metadata.google.internal/computeMetadata/v1/' }),
    /not allowed/,
  );
  await assert.rejects(
    store.add({ name: 'goog-meta', kind: 'url', target: 'https://metadata.goog/computeMetadata/v1/' }),
    /not allowed/,
  );
  await assert.rejects(
    store.add({ name: 'v6-link', kind: 'url', target: 'https://[fe80::1]/mcp' }),
    /not allowed/,
  );

  await store.add({ name: 'linear', kind: 'url', target: 'https://mcp.linear.app/mcp' });
  await store.add({ name: 'local-mcp', kind: 'url', target: 'http://localhost:3100/mcp' });
  assert.equal(store.state().length, 2);
});

test('McpClient.rpcOverHttp ignores non-JSON SSE keepalives and extracts matching result', async () => {
  const client = new McpClient({
    connector: { name: 'sse-test', kind: 'url', target: 'https://mcp.example.com/mcp' },
    fetchImpl: async () =>
      new Response(
        'event: ping\ndata: :heartbeat\n\ndata: {"jsonrpc":"2.0","id":99,"result":{"wrong":true}}\n\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  const res = await client.request('tools/list', {});
  assert.deepEqual(res, { tools: [] });
});

test('boards helpers and desktop/main.cjs + face-main.cjs enforce Drive write audits, 24 MB board export cap, SVG sanitization, and strict argument checks', async () => {
  const [main, face, boards] = await Promise.all([
    readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/face-main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/boards.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /tool === 'drive_update_file'/);
  assert.match(main, /tool\.startsWith\('drive_create_'\)/);
  assert.match(boards, /MAX_BOARD_EXPORT = 24 \* 1024 \* 1024/);
  assert.match(boards, /sanitizeSvgImport\(/);
  assert.match(main, /createBoardsFileHandlers\(/);
  assert.match(face, /createBoardsFileHandlers\(/);
  assert.match(main, /configureArgumentChecks\(\{ mode: 'enforce'/);
});
