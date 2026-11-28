import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BOARD_FILE_VERSION,
  BoardStore,
  applyBoardTaskResponse,
  buildBoardFromPlanSpec,
  buildBoardTaskPrompt,
  buildProjectPlanPrompt,
  extractPlanOutputs,
  parsePlanCommand,
  summarizeBoardForAI,
} from '../desktop/boards.mjs';
import { WORK_DEFINITIONS, WorkTools } from '../desktop/work-tools.mjs';
import { REMOTE, READS, LOCAL, WINDOW_EVENTS, isLong } from '../desktop/remote-channels.mjs';

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('parsePlanCommand and buildProjectPlanPrompt handle /plan inputs cleanly', () => {
  assert.deepEqual(parsePlanCommand('/plan'), { matched: true, prompt: '' });
  assert.deepEqual(parsePlanCommand('/PLAN   Launch iOS companion'), {
    matched: true,
    prompt: 'Launch iOS companion',
  });
  assert.deepEqual(parsePlanCommand('/plans something'), { matched: false, prompt: '' });
  assert.deepEqual(parsePlanCommand('Make a plan'), { matched: false, prompt: '' });

  const prompt = buildProjectPlanPrompt({ topic: 'Build offline sync engine' });
  assert.match(prompt, /```board/);
  assert.match(prompt, /Build offline sync engine/);
});

test('buildBoardFromPlanSpec builds valid non-overlapping Miro v1 frames, cards, and bound connectors', () => {
  const doc = buildBoardFromPlanSpec({
    title: 'Launch Roadmap',
    frames: [
      {
        id: 'f-scope',
        title: 'Scope & Goals',
        items: [
          { id: 'g1', kind: 'shape', shape: 'roundRect', title: 'Core Sync', body: 'CRDT engine' },
          { id: 'g2', kind: 'sticky', title: 'Zero Data Loss', body: 'Atomic disk writes', color: 'yellow' },
          { id: 'g3', kind: 'text', title: 'Target Q2' },
        ],
      },
      {
        id: 'f-exec',
        title: 'Execution Phases',
        items: [
          { id: 'p1', kind: 'sticky', title: 'Phase 1', body: 'Schema & Store', color: 'blue' },
          { id: 'p2', kind: 'sticky', title: 'Phase 2', body: 'Canvas & UI', color: 'green' },
        ],
      },
    ],
    connections: [
      { from: 'g1', to: 'p1', label: 'drives', shape: 'curved' },
      { from: 'p1', to: 'p2', label: 'then', shape: 'elbow' },
    ],
  });

  assert.equal(doc.version, BOARD_FILE_VERSION);
  assert.equal(doc.name, 'Launch Roadmap');
  const els = Object.values(doc.elements);
  const frames = els.filter(e => e.type === 'frame');
  const connectors = els.filter(e => e.type === 'connector');
  const cards = els.filter(e => e.type !== 'frame' && e.type !== 'connector');

  assert.equal(frames.length, 2);
  assert.equal(cards.length, 5);
  assert.equal(connectors.length, 2);
  assert.equal(overlaps(frames[0], frames[1]), false);

  for (const frame of frames) {
    const kids = cards.filter(c => c.parentId === frame.id);
    assert.ok(kids.length >= 2);
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        assert.equal(overlaps(kids[i], kids[j]), false);
      }
    }
  }

  for (const conn of connectors) {
    assert.ok(conn.start.elementId && doc.elements[conn.start.elementId]);
    assert.ok(conn.end.elementId && doc.elements[conn.end.elementId]);
  }
  assert.ok(doc.camera.zoom > 0 && doc.camera.zoom <= 1);
});

test('extractPlanOutputs handles explicit ```board JSON and Markdown fallback cleanly', () => {
  const withBoard = `# Auth Migration Plan

## Architecture
- Token service with rotation

## Verification
- Automated integration suite

\`\`\`board
{
  "title": "Auth Migration Board",
  "frames": [
    { "id": "arch", "title": "Architecture", "items": [{ "id": "a1", "kind": "shape", "title": "JWT Service" }] },
    { "id": "ver", "title": "Verification", "items": [{ "id": "v1", "kind": "sticky", "title": "E2E Suite" }] }
  ],
  "connections": [{ "from": "a1", "to": "v1", "label": "tested by" }]
}
\`\`\``;

  const explicit = extractPlanOutputs(withBoard, 'Fallback');
  assert.equal(explicit.hasExplicitBoard, true);
  assert.equal(explicit.title, 'Auth Migration Board');
  assert.equal(explicit.markdown.includes('```board'), false);
  assert.match(explicit.markdown, /Token service with rotation/);
  assert.ok(Object.values(explicit.boardDoc.elements).some(e => e.type === 'connector'));

  const markdownOnly = `# Mobile Offline Sync

## Phase 1: Local Queue
- Queue offline edits safely
- Retry with exponential backoff

## Phase 2: Merge
- Resolve field conflicts cleanly`;

  const fallback = extractPlanOutputs(markdownOnly, 'Sync Plan');
  assert.equal(fallback.hasExplicitBoard, false);
  assert.equal(fallback.title, 'Mobile Offline Sync');
  const fallbackFrames = Object.values(fallback.boardDoc.elements).filter(e => e.type === 'frame');
  assert.equal(fallbackFrames.length, 2);
});

test('BoardStore supports full CRUD, reload persistence, and path validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-boards-'));
  let tick = 1000;
  const events: number[] = [];
  try {
    const store = new BoardStore({
      dir,
      now: () => new Date(tick++).toISOString(),
      onChange: list => events.push(list.length),
    });
    await store.load();
    assert.deepEqual(store.list(), []);

    const doc1 = buildBoardFromPlanSpec({
      title: 'First Board',
      frames: [{ id: 'f1', title: 'Frame A', items: [{ id: 'i1', kind: 'sticky', title: 'Note 1' }] }],
    });
    const created = await store.create({ name: 'First Board', doc: doc1, session: 's1', docId: 'doc-123' });
    assert.equal(created.meta.name, 'First Board');
    assert.equal(created.meta.docId, 'doc-123');
    assert.ok(created.meta.elementCount >= 2);

    const renamed = await store.rename(created.meta.id, 'Renamed Board');
    assert.equal(renamed!.meta.name, 'Renamed Board');

    const fetched = await store.get(created.meta.id);
    assert.equal(fetched!.document.name, 'Renamed Board');
    assert.equal(Object.keys(fetched!.document.elements).length, created.meta.elementCount);

    assert.throws(() => store.boardPath('../escape'), /Invalid board identifier/);

    const reloaded = new BoardStore({ dir });
    await reloaded.load();
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.list()[0].name, 'Renamed Board');

    assert.equal(await reloaded.remove(created.meta.id), true);
    assert.equal(reloaded.list().length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('WorkTools board_plan creates boards, records createdBoards, and emits live events, with remote channels registered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-work-board-'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emitted: any[] = [];
  try {
    assert.ok(WORK_DEFINITIONS.has('board_plan'));
    for (const ch of ['boards-list', 'boards-get', 'boards-create', 'boards-save', 'boards-rename', 'boards-delete']) {
      assert.ok(REMOTE.includes(ch));
    }
    for (const ch of ['boards-export-file', 'boards-import-image', 'boards-open-file']) {
      assert.ok(LOCAL.includes(ch));
    }
    assert.ok(READS.includes('boards-list'));
    assert.ok(READS.includes('boards-get'));
    assert.ok(WINDOW_EVENTS.includes('boards-changed'));

    const boards = new BoardStore({ dir });
    await boards.load();

    const tools = new WorkTools({
      root: dir,
      boards,
      owner: 'work-1',
      onEvent: ev => emitted.push(ev),
    });

    const res = await tools.handle({
      tool: 'board_plan',
      arguments: {
        title: 'Sprint Plan',
        frames: [
          { id: 'f1', title: 'Goals', items: [{ id: 'c1', kind: 'sticky', title: 'Ship Track 3' }] },
          { id: 'f2', title: 'Tasks', items: [{ id: 'c2', kind: 'shape', title: 'Tests Pass' }] },
        ],
        connections: [{ from: 'c1', to: 'c2', shape: 'curved' }],
      },
    });
    assert.equal(res.success, true);
    assert.equal(tools.createdBoards.length, 1);
    const boardId = tools.createdBoards[0].id;
    assert.ok(emitted.some(e => e.type === 'board' && e.board?.id === boardId));

    const updatedRes = await tools.handle({
      tool: 'board_plan',
      arguments: {
        boardId,
        title: 'Sprint Plan v2',
        frames: [
          { id: 'f1', title: 'Goals', items: [{ id: 'c1', kind: 'sticky', title: 'Ship Track 3' }] },
        ],
      },
    });
    assert.equal(updatedRes.success, true);
    assert.equal(boards.list().length, 1);
    assert.equal(boards.list()[0].name, 'Sprint Plan v2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Boards AI tasking helpers handle summary, incremental board-ops, replace, pure Q&A, and malformed JSON safely', () => {
  const initial = buildBoardFromPlanSpec({
    title: 'Design Board',
    frames: [
      { id: 'f1', title: 'Inputs', items: [{ id: 'n1', kind: 'sticky', title: 'Old Note', color: 'yellow' }] },
    ],
  });
  const frameEl = Object.values(initial.elements).find(e => e.type === 'frame')!;
  const noteEl = Object.values(initial.elements).find(e => e.type === 'sticky')!;
  const summary = summarizeBoardForAI(initial, [noteEl.id]);
  assert.equal(summary.name, 'Design Board');
  assert.deepEqual(summary.selectedIds, [noteEl.id]);
  assert.equal(summary.frames.length, 1);
  assert.equal(summary.items.length, 1);

  const built = buildBoardTaskPrompt({ prompt: 'Add an output card and connect it', doc: initial, selectedIds: [noteEl.id] });
  assert.match(built.instructions, /```board-ops/);
  assert.match(built.userPrompt, /Design Board/);

  const opsReply = `Added the output node and linked it cleanly.\n\n\`\`\`board-ops
{
  "mode": "ops",
  "summary": "Added output node",
  "ops": [
    { "op": "rename", "name": "Design Board v2" },
    { "op": "update", "id": "${noteEl.id}", "title": "Validated Note", "color": "green" },
    { "op": "add_card", "id": "new-out", "frameId": "${frameEl.id}", "kind": "shape", "shape": "roundRect", "title": "Output Node", "color": "blue" },
    { "op": "connect", "from": "${noteEl.id}", "to": "new-out", "label": "flows to", "shape": "curved" }
  ]
}
\`\`\``;
  const applied = applyBoardTaskResponse(initial, opsReply);
  assert.equal(applied.changed, true);
  assert.equal(applied.opsApplied, 4);
  assert.equal(applied.reply, 'Added the output node and linked it cleanly.');
  assert.equal(applied.document.name, 'Design Board v2');
  assert.match((applied.document.elements[noteEl.id] as { text?: string }).text!, /Validated Note/);
  assert.equal(applied.document.elements[noteEl.id].style.fill, '#C9F5D4');
  const connectors = Object.values(applied.document.elements).filter(e => e.type === 'connector');
  assert.equal(connectors.length, 1);
  assert.equal(connectors[0].start.elementId, noteEl.id);

  // Delete cleans up bound connectors cleanly.
  const delReply = `Removed old note.\n\`\`\`board-ops\n{ "mode": "ops", "ops": [{ "op": "delete", "ids": ["${noteEl.id}"] }] }\n\`\`\``;
  const afterDel = applyBoardTaskResponse(applied.document, delReply);
  assert.equal(afterDel.changed, true);
  assert.equal(afterDel.document.elements[noteEl.id], undefined);
  assert.equal(Object.values(afterDel.document.elements).filter(e => e.type === 'connector').length, 0);

  // Pure Q&A and malformed JSON do not mutate the board.
  const qa = applyBoardTaskResponse(initial, 'Your board currently has one sticky note inside the Inputs frame.');
  assert.equal(qa.changed, false);
  const bad = applyBoardTaskResponse(initial, 'Hmm.\n```board-ops\n{not-json}\n```');
  assert.equal(bad.changed, false);

  // Replace mode rebuilds the board cleanly.
  const rep = applyBoardTaskResponse(initial, 'Rebuilt.\n```board-ops\n{ "mode": "replace", "title": "Fresh Architecture", "frames": [{ "id": "a", "title": "API", "items": [{ "id": "x", "title": "Gateway" }] }] }\n```');
  assert.equal(rep.changed, true);
  assert.equal(rep.document.name, 'Fresh Architecture');
});

test('Boards pure-black obsidian theme, clickable topbar, and Fairy boards-ask channel are wired cleanly', () => {
  assert.ok(REMOTE.includes('boards-ask'));
  assert.equal(READS.includes('boards-ask'), false);
  assert.equal(isLong('boards-ask'), true);

  const themeSrc = readFileSync(new URL('../src/boards/core/theme.ts', import.meta.url), 'utf8');
  const titleBarSrc = readFileSync(new URL('../src/boards/components/TitleBar.tsx', import.meta.url), 'utf8');
  const boardsCss = readFileSync(new URL('../src/boards/styles/global.css', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/boards/BoardsApp.tsx', import.meta.url), 'utf8');

  assert.match(themeSrc, /background:\s*'#08080a'/);
  assert.match(titleBarSrc, /boards-topbar/);
  assert.doesNotMatch(titleBarSrc, /className=\{`titlebar/);
  assert.match(boardsCss, /--board-bg:\s*#030304/);
  assert.match(boardsCss, /#boards-view\s+\.boards-topbar\s+:where\([^)]*\)\s*\{\s*-webkit-app-region:\s*no-drag/s);
  assert.match(appSrc, /BoardAssistant/);
});
