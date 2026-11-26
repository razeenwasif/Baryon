import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Approvals, AuditLog, auditSummary, macOnlyKind, redact } from '../desktop/approvals.mjs';

const memoryLog = () => { const lines = []; return { lines, add: async entry => { lines.push(entry); } }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a request waits for its answer, from wherever it comes, and says who answered', async () => {
  const log = memoryLog(), changes = [], drawn = [];
  const approvals = new Approvals({ log, onChange: list => changes.push(list.length), now: () => new Date('2026-11-08T08:00:00Z') });
  const asked = approvals.ask({ kind: 'calendar-event', tool: 'calendar_create', risk: 'write', title: 'Create this Google Calendar event?', detail: 'Dentist, Tuesday 3 pm', source: 'chat', chat: 'C1', provider: 'claude', model: 'claude-opus-5-5' },
    { shown: id => drawn.push(`shown ${id}`), closed: id => drawn.push(`closed ${id}`) });
  const [pending] = approvals.pending();
  assert.equal(pending.title, 'Create this Google Calendar event?');
  assert.deepEqual(pending.choices, ['allow', 'deny']);
  assert.equal(pending.macOnly, false);
  assert.throws(() => approvals.answer(pending.id, 'always'), /Unknown answer/);
  approvals.answer(pending.id, 'allow', 'phone');
  assert.equal(await asked, 'allow');
  assert.deepEqual(drawn, [`shown ${pending.id}`, `closed ${pending.id}`]);
  assert.deepEqual(changes, [1, 0]);
  assert.throws(() => approvals.answer(pending.id, 'deny'), /already been answered/);
  assert.deepEqual(log.lines.map(l => [l.event, l.via ?? null]), [['asked', null], ['allowed', 'phone']]);
  assert.deepEqual(log.lines[0], { at: '2026-11-08T08:00:00.000Z', id: pending.id, event: 'asked', kind: 'calendar-event', tool: 'calendar_create', risk: 'write', title: 'Create this Google Calendar event?', detail: 'Dentist, Tuesday 3 pm', source: 'chat', chat: 'C1', provider: 'claude', model: 'claude-opus-5-5' });
});

test('no answer in time is a no, Stop ends it, and a stopped request can’t be answered', async () => {
  const log = memoryLog(), approvals = new Approvals({ log, wait: 20 });
  assert.equal(await approvals.ask({ kind: 'edit', title: 'Edit notes.md' }), 'deny');
  const controller = new AbortController();
  const asked = approvals.ask({ kind: 'command', title: 'Run npm test' }, { signal: controller.signal, wait: 10_000 });
  const id = approvals.pending()[0].id;
  controller.abort();
  await assert.rejects(asked, /Stopped/);
  assert.throws(() => approvals.answer(id, 'allow'), /already been answered/);
  assert.equal(approvals.pending().length, 0);
  assert.deepEqual(log.lines.map(l => l.event), ['asked', 'timed-out', 'asked', 'stopped']);
  const done = new AbortController(); done.abort();
  assert.throws(() => approvals.ask({ title: 'x' }, { signal: done.signal }), { name: 'AbortError' });
});

test('a step past the sandbox can be refused from a phone, but only allowed on the Mac', async () => {
  const approvals = new Approvals({ log: memoryLog() });
  for (const kind of ['outside', 'computer', 'screen', 'browser:open']) assert.equal(macOnlyKind(kind), true, kind);
  assert.equal(macOnlyKind('edit'), false);
  const asked = approvals.ask({ kind: 'outside', title: 'Run git push outside the sandbox' }, { choices: ['allow', 'always', 'auto', 'deny'] });
  const { id, macOnly } = approvals.pending()[0];
  assert.equal(macOnly, true);
  assert.throws(() => approvals.answer(id, 'allow', 'phone'), /only be allowed on the Mac/);
  approvals.answer(id, 'allow', 'window');
  assert.equal(await asked, 'allow');
  const refused = approvals.ask({ kind: 'computer', title: 'Use the Mac' });
  approvals.answer(approvals.pending()[0].id, 'deny', 'phone');
  assert.equal(await refused, 'deny');
  const always = approvals.ask({ kind: 'edit', title: 'Edit a file' }, { choices: ['allow', 'always', 'auto', 'deny'] });
  approvals.answer(approvals.pending()[0].id, 'always');
  assert.equal(await always, 'always');
});

test('the log keeps what was asked, never contents, with keys hidden', async t => {
  assert.equal(redact('curl -H "Authorization: Bearer abcdefghijklmnop1234" https://x'), 'curl -H "Authorization: [hidden]" https://x');
  assert.equal(redact('export OPENAI_API_KEY=sk-abcdefghijklmnopqrstu && npm test'), 'export OPENAI_API_KEY=[hidden] && npm test');
  assert.equal(redact('token: 12345 and password=hunter22'), 'token: [hidden] and password=[hidden]');
  assert.equal(redact('git push origin main'), 'git push origin main');
  const summary = auditSummary({ kind: 'edit', title: 'Edit src/app.js', diff: { rows: [1, 2, 3], before: 'secret file contents' }, source: 'work', chat: 'W1' });
  assert.deepEqual(summary, { kind: 'edit', risk: 'write', title: 'Edit src/app.js', changes: 3, source: 'work', chat: 'W1' });
  assert.equal(auditSummary({ title: 'x', command: 'y'.repeat(500) }).detail.length, 240);

  const dir = mkdtempSync(join(tmpdir(), 'fairy-approvals-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = new AuditLog({ path: join(dir, 'approvals.jsonl') }), approvals = new Approvals({ log });
  const asked = approvals.ask({ kind: 'drive-file', tool: 'drive_create_file', title: 'Create this file in Google Drive?', detail: 'Name: plan.md\n\nContent preview:\nThe plan' });
  approvals.answer(approvals.pending()[0].id, 'deny');
  await asked;
  approvals.note({ kind: 'gmail-draft', tool: 'gmail_save_reply_draft', title: 'Saved a reply draft to sam@example.org', source: 'chat' }, 'done');
  await tick(); await log.queue;
  const recent = await log.recent(10);
  assert.deepEqual(recent.map(e => e.event), ['done', 'denied', 'asked']);
  assert.match(readFileSync(join(dir, 'approvals.jsonl'), 'utf8'), /drive_create_file/);
  assert.deepEqual(await new AuditLog({ path: join(dir, 'missing.jsonl') }).recent(), []);
});
