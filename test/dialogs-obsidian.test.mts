import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('all modal dialogs and approval cards share the Obsidian palette with Fairy Blue accent', () => {
  const dialogs = read('../src/dialogs.css');
  const music = read('../src/music.css');
  const panels = read('../src/panels.css');
  const saveEval = read('../src/save-eval.css');
  const companion = read('../src/companion.css');
  const workspace = read('../src/workspace.css');
  const sideSessions = read('../src/side-sessions.css');

  assert.match(dialogs, /background:#0b0c0f/);
  assert.match(dialogs, /background:#14151a/);
  assert.doesNotMatch(dialogs, /project-review/, 'legacy project-review class must remain absent');

  assert.match(music, /#9fb2ff/);
  assert.match(music, /#14151a/);
  for (const legacy of ['#a5d9ba', '#354b48', '#15262a', '#2b3749', '#879ab5']) {
    assert.ok(!music.includes(legacy), `stale music.css colour left behind: ${legacy}`);
  }

  assert.match(panels, /\.approval-card\{[^}]*rgba\(11,12,15,\.96\)/);
  assert.match(panels, /\.approval-detail\{[^}]*#08090c/);
  assert.match(panels, /\.approval-buttons \.panel-button\.primary\{[^}]*#3e5aec/);
  assert.match(panels, /\.pdf-clip-dialog\{[^}]*#0b0c0f/);

  assert.match(saveEval, /background:#0b0c0f/);
  assert.match(saveEval, /background:#14151a/);
  assert.match(saveEval, /background:#3e5aec/);

  assert.match(companion, /\.approval\{[^}]*rgba\(11,12,15,\.96\)/);
  assert.match(companion, /\.approval pre\{[^}]*#08090c/);

  assert.match(workspace, /\.palette\{[^}]*#0b0c0f/);
  assert.match(workspace, /\.chat-notes\{[^}]*#0b0c0f/);
  assert.match(sideSessions, /\.session-message\{[^}]*#0b0c0f/);
});
