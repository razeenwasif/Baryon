import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHandoffContext, detectProviderHandoff, formatModelLabel, normalizeProvider } from '../desktop/context-handoff.mjs';
import { liveActionLabel, segmentActivity, summarizeActionGroup, thoughtHeadline } from '../src/action-summary.js';
import { WINDOW_EVENTS } from '../desktop/remote-channels.mjs';

const ROOT = join(import.meta.dirname, '..');

test('normalizeProvider and formatModelLabel normalize model names cleanly', () => {
  assert.deepEqual(normalizeProvider('codex'), { key: 'codex', family: 'openai', name: 'OpenAI' });
  assert.deepEqual(normalizeProvider('antigravity'), { key: 'gemini', family: 'google', name: 'Gemini' });
  assert.equal(formatModelLabel('gpt-6.1-sol', 'codex'), 'GPT-6.1-Sol');
  assert.equal(formatModelLabel('claude-opus-5-5', 'claude'), 'Claude Opus 5.5');
  assert.equal(formatModelLabel('gemini-4-argon-high', 'antigravity'), 'Gemini 4 Argon');
  assert.equal(formatModelLabel('deepseek-v4-pro', 'deepseek'), 'DeepSeek V4 Pro');
  assert.equal(formatModelLabel('', 'claude'), 'Claude');
});

test('detectProviderHandoff ignores same-family changes and detects cross-provider switches', () => {
  const sameFamily = [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello', seat: { provider: 'claude', model: 'claude-sonnet-5-5' } },
  ];
  assert.equal(detectProviderHandoff(sameFamily, { provider: 'claude', model: 'claude-opus-5-5' }), null);

  const codexToClaude = [
    { role: 'user', content: 'Check simulator' },
    { role: 'assistant', content: 'Running checks', seat: { provider: 'codex', model: 'gpt-6.1-sol' } },
  ];
  const handoff1 = detectProviderHandoff(codexToClaude, { provider: 'claude', model: 'claude-opus-5-5' })!;
  assert.ok(handoff1);
  assert.equal(handoff1.from.family, 'openai');
  assert.equal(handoff1.from.label, 'GPT-6.1-Sol');
  assert.equal(handoff1.to.family, 'anthropic');
  assert.equal(handoff1.to.label, 'Claude Opus 5.5');

  const claudeToGemini = [
    { role: 'assistant', content: 'Done', auto: { provider: 'claude', model: 'claude-fable-5-2' } },
  ];
  const handoff2 = detectProviderHandoff(claudeToGemini, { provider: 'antigravity', model: 'gemini-4-neon-medium' })!;
  assert.equal(handoff2.from.family, 'anthropic');
  assert.equal(handoff2.to.family, 'google');
  assert.equal(handoff2.to.label, 'Gemini 4 Neon');

  const geminiToDeepSeek = [
    { role: 'assistant', content: 'Done', seat: { provider: 'gemini', model: 'gemini-4-argon-high' } },
  ];
  const handoff3 = detectProviderHandoff(geminiToDeepSeek, { provider: 'deepseek', model: 'deepseek-v4-pro' })!;
  assert.equal(handoff3.from.family, 'google');
  assert.equal(handoff3.to.family, 'deepseek');
  assert.equal(handoff3.to.label, 'DeepSeek V4 Pro');
});

test('buildHandoffContext includes chat/work state and respects maxChars', () => {
  const history = [
    { role: 'user', content: 'Launch the simulator app' },
    {
      role: 'assistant',
      content: 'Metro is running and build is compiling.',
      seat: { provider: 'codex', model: 'gpt-6.1-sol' },
      activity: [{ tool: 'edit', status: 'done', summary: 'src/app.js' }],
      verdict: { line: 'Checks passed (14/14)' },
      tasks: [{ status: 'done', text: 'Boot simulator' }, { status: 'in_progress', text: 'Verify thread row layout' }],
    },
  ];
  const from = { label: 'GPT-6.1-Sol' };
  const to = { label: 'Claude Opus 5.5' };
  const chatBrief = buildHandoffContext({ history, from, to, isWork: false });
  assert.match(chatBrief, /^\[Context handoff: GPT-6\.1-Sol -> Claude Opus 5\.5\]/);
  assert.match(chatBrief, /Launch the simulator app/);

  const workBrief = buildHandoffContext({ history, from, to, isWork: true, summary: { text: 'Earlier setup done.' } });
  assert.match(workBrief, /Files changed recently: src\/app\.js/);
  assert.match(workBrief, /Latest check verdict: Checks passed/);
  assert.match(workBrief, /Remaining tasks: Verify thread row layout/);

  const capped = buildHandoffContext({ history, from, to, isWork: true, maxChars: 120 });
  assert.ok(capped.length <= 120);
});

test('segmentActivity, summarizeActionGroup, liveActionLabel, and thoughtHeadline match expected UI output', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, tool: 'run', status: 'done', summary: `cmd ${i}` })),
    { id: 's1', tool: 'simulator', status: 'done', summary: 'tap' },
    { id: 's2', tool: 'computer', status: 'done', summary: 'screenshot' },
    { id: 'n1', tool: 'thought', kind: 'commentary', status: 'done', text: 'The iPhone 17 simulator is open.' },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `k${i}`, tool: 'run', status: 'done', summary: `cmd2 ${i}` })),
    { id: 'vp', tool: 'run', status: 'running', command: 'vp dev', summary: 'vp' },
    { id: 't1', tool: 'thought', kind: 'thinking', status: 'running', text: 'Filtering output in JavaScript' },
  ];
  const segments = segmentActivity(rows);
  assert.deepEqual(segments.map(s => s.type), ['action-group', 'commentary', 'action-group', 'action-live', 'thought']);

  const mixed = summarizeActionGroup((segments[0] as any).rows);
  assert.equal(mixed.icon, 'tool');
  assert.equal(mixed.text, 'Ran 7 commands and used device controls 2 times');

  const commandsOnly = summarizeActionGroup((segments[2] as any).rows);
  assert.equal(commandsOnly.icon, 'terminal');
  assert.equal(commandsOnly.text, 'Ran 4 commands');

  const threeWay = summarizeActionGroup([
    { tool: 'read', status: 'done', summary: 'a.js' },
    ...Array.from({ length: 6 }, () => ({ tool: 'run', status: 'done', summary: 'test' })),
    { tool: 'plan', status: 'done', summary: 'plan' },
  ]);
  assert.equal(threeWay.icon, 'tool');
  assert.equal(threeWay.text, 'Read 1 file, ran 6 commands, and performed 1 other action');

  assert.deepEqual(liveActionLabel({ tool: 'run', command: 'vp' }), { icon: 'terminal', text: 'Running vp' });
  assert.deepEqual(liveActionLabel({ tool: 'simulator', summary: 'screenshot' }), { icon: 'device', text: 'Taking a screenshot of the device' });
  assert.deepEqual(liveActionLabel({ tool: 'simulator_screenshot', summary: 'home screen' }), { icon: 'device', text: 'Taking a screenshot of the device' });
  assert.deepEqual(liveActionLabel({ tool: 'read_file', summary: 'desktop/main.cjs' }), { icon: 'file', text: 'Reading desktop/main.cjs' });

  const rawToolGroup = summarizeActionGroup([
    ...Array.from({ length: 4 }, () => ({ tool: 'read_file', status: 'done', summary: 'a.js' })),
    ...Array.from({ length: 14 }, () => ({ tool: 'run_command', status: 'done', summary: 'test' })),
    { tool: 'edit_file', status: 'done', summary: 'b.js' },
  ]);
  assert.equal(rawToolGroup.icon, 'tool');
  assert.equal(rawToolGroup.text, 'Read 4 files, ran 14 commands, and edited 1 file');

  const rawBrowser = summarizeActionGroup([
    { tool: 'browser_click_element', status: 'done', summary: 'button' },
  ]);
  assert.equal(rawBrowser.icon, 'globe');
  assert.equal(rawBrowser.text, 'Browsed 1 source');

  assert.equal(thoughtHeadline('', 0, 'running'), 'Thinking');
  assert.equal(thoughtHeadline('', 4200, 'done'), 'Thought for 4.2s');
  assert.equal(thoughtHeadline('**Checking** `src/app.js` layout next', 1000, 'done'), 'Checking src/app.js layout next');
});

test('thinking and handoff events and pending indicator are wired across preload, core, work-agent, and views', () => {
  assert.ok(WINDOW_EVENTS.includes('thought'));
  assert.ok(WINDOW_EVENTS.includes('handoff'));
  const preload = readFileSync(join(ROOT, 'desktop/preload.cts'), 'utf8');
  const core = readFileSync(join(ROOT, 'desktop/core.mts'), 'utf8');
  const workAgent = readFileSync(join(ROOT, 'desktop/work-agent.mts'), 'utf8');
  const workView = readFileSync(join(ROOT, 'src/work-view.ts'), 'utf8');
  const appJs = readFileSync(join(ROOT, 'src/app.ts'), 'utf8');
  assert.match(preload, /onHandoff:/);
  assert.match(core, /settings\.handoffContext/);
  assert.match(workAgent, /handoffContext\s*=/);
  assert.match(workView, /createPendingThinkingRow/);
  assert.match(appJs, /createPendingThinkingRow/);
});
