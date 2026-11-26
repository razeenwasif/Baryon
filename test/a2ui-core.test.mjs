import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  A2UI_CATALOG_ID,
  A2UI_LIMITS,
  ALL_COMPONENTS,
  BASIC_COMPONENTS,
  FAIRY_COMPONENTS,
  applyA2UIMessages,
  cleanSurface,
  extractA2UIBlocks,
  pointerDelete,
  pointerGet,
  pointerSet,
  resolveActionContext,
  resolveDynamic,
} from '../desktop/page-kinds/a2ui-core.mjs';
import { formatA2UIActionPrompt, parseUiCommand, updateSurfaceDataInList } from '../desktop/a2ui.mjs';
import { buildPage, kindFiles, parseA2UI } from '../desktop/page-agent.mjs';
import { KINDS, SOURCE_FILES } from '../desktop/artifacts.mjs';
import { pageKind, requestMode, wantsA2UI, wantsPage } from '../src/chat-routing.js';
import { WorkTools } from '../desktop/work-tools.mjs';
import { kindOf, REMOTE, WINDOW_EVENTS } from '../desktop/remote-channels.mjs';

test('JSON Pointer operations handle nested paths, escaping, and block prototype pollution', () => {
  const base = { user: { name: 'Razeen', tags: ['ml', 'systems'] }, 'a/b': { 'c~d': 42 } };
  assert.equal(pointerGet(base, '/user/name'), 'Razeen');
  assert.equal(pointerGet(base, '/user/tags/1'), 'systems');
  assert.equal(pointerGet(base, '/a~1b/c~0d'), 42);
  assert.equal(pointerGet(base, 'name', { name: 'Scoped' }), 'Scoped');

  const updated = pointerSet(base, '/user/score', 98);
  assert.equal(updated.user.score, 98);
  assert.equal(base.user.score, undefined, 'pointerSet does not mutate original');

  const deleted = pointerDelete(updated, '/user/tags/0');
  assert.deepEqual(deleted.user.tags, ['systems']);

  // Prototype pollution attempts must be ignored cleanly.
  const polluted = pointerSet(base, '/__proto__/polluted', true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.hasOwn(polluted, '__proto__'), false);
  const ctorPolluted = pointerSet(base, '/constructor/prototype/evil', 1);
  assert.equal(({}).evil, undefined);
  assert.equal(pointerGet(base, '/__proto__/toString'), undefined);
});

test('all 18 Basic Catalog and 6 Fairy extension components survive cleaning while unknown or unsafe entries are stripped', () => {
  assert.equal(BASIC_COMPONENTS.length, 19);
  assert.equal(FAIRY_COMPONENTS.length, 6);
  const comps = [
    { id: 'root', component: 'Column', children: ALL_COMPONENTS.filter(c => c !== 'Column').map((_, i) => `c-${i}`) },
    ...ALL_COMPONENTS.filter(c => c !== 'Column').map((name, i) => ({
      id: `c-${i}`,
      component: name,
      ...(name === 'Image' ? { url: 'https://example.com/ok.png' } : {}),
      ...(name === 'Video' ? { url: 'javascript:alert(1)' } : {}),
      ...(name === 'AudioPlayer' ? { url: 'file:///etc/passwd' } : {}),
    })),
    { id: 'alias-cb', component: 'checkbox', label: 'Opt in', value: { path: '/opt' } },
    { id: 'alias-dd', component: 'Dropdown', label: 'Pick', options: ['a', 'b'], value: { path: '/pick' } },
    { id: 'bad-script', component: 'Script', code: 'alert(1)' },
    { id: 'bad-html', component: 'RawHTML', html: '<img onerror=alert(1)>' },
  ];
  const surf = cleanSurface({ surfaceId: 's1', root: 'root', components: comps });
  const kinds = new Set(surf.components.map(c => c.component));
  for (const name of ALL_COMPONENTS) assert.ok(kinds.has(name), `expected ${name}`);
  assert.equal(kinds.has('Script'), false);
  assert.equal(kinds.has('RawHTML'), false);
  assert.equal(surf.components.find(c => c.id === 'alias-cb')?.component, 'CheckBox');
  assert.equal(surf.components.find(c => c.id === 'alias-dd')?.component, 'ChoicePicker');
  assert.equal(surf.components.find(c => c.component === 'Image')?.url, 'https://example.com/ok.png');
  assert.equal(surf.components.find(c => c.component === 'Video')?.url, undefined);
  assert.equal(surf.components.find(c => c.component === 'AudioPlayer')?.url, undefined);
});

test('cycle breaking, depth clamp, component count cap, and data byte cap hold unconditionally', () => {
  const cyclic = cleanSurface({
    surfaceId: 'cycle',
    root: 'a',
    components: [
      { id: 'a', component: 'Column', children: ['b'] },
      { id: 'b', component: 'Row', children: ['a'] },
    ],
  });
  const bNode = cyclic.components.find(c => c.id === 'b');
  assert.deepEqual(bNode.children, []);

  const many = Array.from({ length: 260 }, (_, i) => ({ id: `n-${i}`, component: 'Text', text: 'hi' }));
  const capped = cleanSurface({ surfaceId: 'big', components: many });
  assert.equal(capped.components.length, A2UI_LIMITS.components);

  const oversizedData = { a: 'x'.repeat(100000), small: 'ok' };
  const clamped = cleanSurface({ surfaceId: 'data-cap', components: [], dataModel: oversizedData });
  assert.ok(Buffer.byteLength(JSON.stringify(clamped.dataModel), 'utf8') <= A2UI_LIMITS.dataBytes);
  assert.equal(clamped.dataModel.small, 'ok');
});

test('applyA2UIMessages, extractA2UIBlocks, resolveDynamic, and resolveActionContext conform to v0.9.1', () => {
  const msgs = [
    { createSurface: { surfaceId: 'calc', title: 'Mortgage', catalogId: A2UI_CATALOG_ID } },
    {
      updateComponents: {
        surfaceId: 'calc',
        root: 'root',
        components: [
          { id: 'root', component: 'Column', children: ['lbl', 'in', 'go'] },
          { id: 'lbl', component: 'Text', text: { call: 'formatString', args: { value: 'Principal: ${/amount}' } } },
          { id: 'in', component: 'Slider', label: 'Amount', min: 100, max: 1000, value: { path: '/amount' } },
          { id: 'go', component: 'Button', label: 'Run', action: { event: { name: 'calculate', context: { amount: { path: '/amount' } } } } },
        ],
      },
    },
    { updateDataModel: { surfaceId: 'calc', path: '/', value: { amount: 500, active: true, scores: [10, 20, 30] } } },
  ];

  const markdown = `Here is a calculator:\n\`\`\`a2ui\n${JSON.stringify(msgs)}\n\`\`\`\nUse the slider above.`;
  const extracted = extractA2UIBlocks(markdown);
  assert.equal(extracted.text, 'Here is a calculator:\n\nUse the slider above.');
  assert.equal(extracted.surfaces.length, 1);
  const surf = extracted.surfaces[0];
  assert.equal(surf.surfaceId, 'calc');
  assert.equal(resolveDynamic({ call: 'formatString', args: { value: 'Principal: ${/amount}' } }, surf.dataModel), 'Principal: 500');
  assert.equal(resolveDynamic({ call: 'formatNumber', args: { value: 3.14159, decimals: 2 } }, surf.dataModel), '3.14');
  assert.equal(resolveDynamic({ call: 'if', args: { cond: { call: 'and', args: [{ call: 'gt', args: [{ path: '/amount' }, 400] }, { path: '/active' }] }, then: 'High', else: 'Low' } }, surf.dataModel), 'High');
  assert.equal(resolveDynamic({ call: 'count', args: { list: { path: '/scores' } } }, surf.dataModel), 3);

  const action = resolveActionContext(surf.components.find(c => c.id === 'go'), surf.dataModel, null, surf.surfaceId);
  assert.equal(action.actionName, 'calculate');
  assert.deepEqual(action.context, { amount: 500 });
  assert.match(formatA2UIActionPrompt({ surface: surf, ...action }), /\[A2UI Action "calculate" on surface "calc" \(Mortgage\) from go\]/);

  // JSONL stream + deleteSurface
  const jsonl = `\`\`\`a2ui\n{"createSurface":{"surfaceId":"temp","title":"Temp"}}\n{"updateComponents":{"surfaceId":"temp","root":"t1","components":[{"id":"t1","component":"Text","text":"Hi"}]}}\n{"deleteSurface":{"surfaceId":"temp"}}\n\`\`\``;
  const afterDelete = extractA2UIBlocks(jsonl);
  assert.equal(afterDelete.surfaces.length, 0);

  // Local input update helper
  const updated = updateSurfaceDataInList(extracted.surfaces, 'calc', '/amount', 750);
  assert.equal(updated.updated, true);
  assert.equal(updated.surface.dataModel.amount, 750);

  // Malformed block leaves prose untouched without throwing
  const bad = extractA2UIBlocks('Before\n```a2ui\n{not json\n```\nAfter');
  assert.equal(bad.surfaces.length, 0);
  assert.match(bad.text, /\{not json/);
});

test('dedicated a2ui page kind, chat routing, remote channels, and WorkTools ui_surface work cleanly', async t => {
  assert.ok(KINDS.includes('a2ui'));
  assert.equal(SOURCE_FILES.a2ui, 'surface.json');
  assert.ok(REMOTE.includes('a2ui-update-data'));
  assert.ok(REMOTE.includes('a2ui-to-page'));
  assert.ok(REMOTE.includes('a2ui-action'));
  assert.equal(kindOf('a2ui-action'), 'remote');
  assert.ok(WINDOW_EVENTS.includes('a2ui-update'));

  assert.equal(parseUiCommand('/ui build a timer').prompt, 'build a timer');
  assert.equal(wantsA2UI('/ui loan calculator'), true);
  assert.equal(wantsA2UI('What is a binary tree?'), false);
  assert.equal(wantsPage('/ui loan calculator'), false);
  assert.equal(wantsPage('Make an interactive UI for budgeting'), true);
  assert.equal(pageKind('Make an interactive UI for budgeting'), 'a2ui');
  assert.equal(requestMode('Make an interactive UI for budgeting', 'chat', { autoDesktop: 'off', autoScreen: 'off' }), 'page');

  const built = buildPage('a2ui', 'TITLE: Loan Planner\nABOUT: Interactive calculator\n```json\n[{"createSurface":{"surfaceId":"loan-1","title":"Loan Planner"}},{"updateComponents":{"surfaceId":"loan-1","root":"r","components":[{"id":"r","component":"Text","text":"Rate"}]}}]\n```');
  assert.equal(built.title, 'Loan Planner');
  assert.ok(built.files['index.html'].includes('class="a2ui"'));
  assert.ok(built.files['surface.json'].includes('"surfaceId": "loan-1"'));
  const parsed = parseA2UI('TITLE: Direct\n{"surfaceId":"d1","root":"x","components":[{"id":"x","component":"Badge","label":"OK"}]}');
  assert.equal(parsed.surface.components[0].component, 'Badge');
  assert.ok(kindFiles('a2ui', parsed.surface, 'Direct')['index.html'].includes('renderPageSurface'));

  // WorkTools ui_surface emits live a2ui event and stores cleaned surfaces
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-a2ui-tool-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const tools = new WorkTools({
    root,
    permission: 'auto',
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
    approve: async () => true,
    onEvent: e => events.push(e),
  });
  const res = await tools.handle({
    tool: 'ui_surface',
    arguments: {
      messages: [
        { createSurface: { surfaceId: 'w1', title: 'Build Matrix' } },
        { updateComponents: { surfaceId: 'w1', root: 'm', components: [{ id: 'm', component: 'MetricTile', label: 'Tests', value: '36/36' }] } },
      ],
    },
  });
  assert.equal(res.outcome, 'ok');
  assert.equal(tools.a2uiSurfaces.length, 1);
  assert.equal(tools.a2uiSurfaces[0].components[0].component, 'MetricTile');
  assert.ok(events.some(e => e.type === 'a2ui' && e.surfaces.length === 1));
});
