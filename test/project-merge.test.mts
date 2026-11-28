// Project mode folded into work sessions (16 Nov 2026): its folder became the default work folder, its button and
// settings went, and the plain command runner work sessions still use moved into the sandbox code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSettings, DEFAULTS } from '../desktop/core.mjs';
import { ConversationMemory } from '../desktop/memory.mjs';
import { LOCAL, MINI_ONLY, OTHER, REMOTE, WINDOW_EVENTS } from '../desktop/remote-channels.mjs';
import { plainCommand } from '../desktop/work-sandbox.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('the default work folder replaces Project mode’s three settings', () => {
  for (const key of ['projectRoot', 'projectProvider', 'projectGeminiModel']) assert.ok(!(key in DEFAULTS), key);
  assert.equal(DEFAULTS.workFolder, '');
  const long = `/Users/someone/${'nested/'.repeat(30)}project`;
  assert.equal(cleanSettings({ workFolder: long }).workFolder, long, 'a long path isn’t cut at 160');
  assert.throws(() => cleanSettings({ workFolder: 'relative/folder' }), /default work folder/);
  assert.equal(cleanSettings({ workFolder: '' }).workFolder, '');
  assert.equal((cleanSettings({ projectRoot: 'x' } as any) as any).projectRoot, undefined, 'the old setting is dropped once read');
});

test('the main process moves the project folder over once, offers the default first and starts there from ⌘K', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /if \(!settings\.workFolder && typeof savedSettings\?\.projectRoot === 'string' && savedSettings\.projectRoot\) \{/);
  assert.match(main, /const root = localFiles\.status\(\)\.find\(entry => entry\.id === savedSettings\.projectRoot\);/);
  assert.match(main, /handle\('work-folder-choose', async \(\) => \{/);
  assert.match(main, /handle\('work-folder-clear', async \(\) => \{/);
  assert.match(main, /if \(typeof wanted === 'string' && wanted && wanted === settings\.workFolder\) \{/);
  assert.match(main, /buttonLabel: 'Work here', properties: \['openDirectory', 'createDirectory'\], \.\.\.\(settings\.workFolder \? \{ defaultPath: settings\.workFolder \} : \{\}\)/);
  assert.match(main, /if \(settings\.workFolder\)\s*seen\.set\(settings\.workFolder, \{ path: settings\.workFolder, name: require\('node:path'\)\.basename\(settings\.workFolder\), default: true \}\);/);
  assert.match(main, /if \(mode === 'project'\)\s*mode = 'chat';/);
  for (const gone of ['runProject', 'projectGemini', 'pendingProjectReview', "handle('project-choose'", "handle('project-review-answer'", 'project-agent.mjs']) assert.ok(!main.includes(gone), gone);
  assert.match(main, /sandbox\.plainCommand\(\{ command, cwd, signal: stopped \}\)/);
});

test('the window has Chat and Desktop, a Work sessions tab with the default folder, and no review dialog', async () => {
  const app = await read('../src/app.ts'), css = await read('../src/dialogs.css');
  assert.ok(!app.includes('data-mode="project"'));
  assert.match(app, /<button data-mode="desktop">Desktop<\/button>/);
  assert.match(app, /<span aria-hidden="true">⌥<\/span>Work sessions<\/button>/);
  assert.match(app, /<h3>Work sessions<\/h3>/);
  assert.match(app, /id="work-folder-choose"/);
  assert.match(app, /\[data-mode="\$\{mode === 'chat' \? 'desktop' : 'chat'\}"\]/);
  for (const gone of ['setupProjectReview', 'projectChoose', 'projectProvider', 'projectGeminiModel', 'project-folder']) assert.ok(!app.includes(gone), gone);
  assert.ok(!css.includes('project-review'));
  assert.match(app, /label: `Work in \$\{state\.settings\.workFolder\.split\('\/'\)\.filter\(Boolean\)\.at\(-1\)\}`/);
  const preload = await read('../desktop/preload.cts');
  assert.match(preload, /sessionNewWork: folder => ipcRenderer\.invoke\('fairy:session-new-work', folder\),/);
  assert.ok(!/project(Choose|ReviewAnswer)|onProjectReview/.test(preload));
});

test('the MacBook and phone get the default folder first; choosing it stays on the mini', async () => {
  const all = [...REMOTE, ...LOCAL, ...MINI_ONLY, ...OTHER];
  for (const gone of ['project-choose', 'project-review-answer']) assert.ok(!all.includes(gone), gone);
  assert.ok(!WINDOW_EVENTS.includes('project-review'));
  assert.ok(MINI_ONLY.includes('work-folder-choose') && MINI_ONLY.includes('work-folder-clear'));
  const face = await read('../desktop/face-main.cts');
  assert.match(face, /label: `\$\{String\(item\.name \|\| item\.path\)\}\$\{item\.default === true \? ' · default' : ''\}`/);
});

test('the plain command runner stops when asked and limits its output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-plain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const controller = new AbortController(), pending = plainCommand({ command: 'sleep 10', cwd: dir, signal: controller.signal });
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(pending, /stopped/);
  await assert.rejects(plainCommand({ command: '/usr/bin/yes x', cwd: dir }), /output exceeded/);
  assert.deepEqual(await plainCommand({ command: 'printf ok; exit 3', cwd: dir }), { exitCode: 3, output: 'ok' });
});

test('Project mode’s old exchanges still stay out of long-term recall', async () => {
  const memory = new ConversationMemory({ read: async () => null, write: async () => {} });
  await memory.init([{ role: 'user', mode: 'project', content: 'Private project task' }, { role: 'assistant', mode: 'project', content: 'Private result' }]);
  assert.equal(memory.episodes.length, 0);
});
