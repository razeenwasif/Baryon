// A note that goes with a .tex file in the notebook's files/ shows it with Compile PDF, or Open PDF once it's made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('a note goes with the .tex whose name is in its title, whole', async () => {
  const { texFilesFor } = await import('../src/note-tex.js');
  const files = ['practice-exam-1.tex', 'practice-exam-1.pdf', 'practice-exam-2.tex', 'practice-exam-2.pdf', 'practice-exam-20.tex', 'optimisation-cheatsheet.tex'].map(name => ({ name }));
  assert.deepEqual(texFilesFor('Practice Exam 2 — COMP4691 Optimisation (Quizzes, Traces, Proofs, MH2 & Construction)', files), ['practice-exam-2.tex']);
  assert.deepEqual(texFilesFor('Optimisation cheatsheet', files), ['optimisation-cheatsheet.tex']);
  assert.deepEqual(texFilesFor('Lecture 3 notes', files), []);
  assert.deepEqual(texFilesFor('Practice exam 2', [{ name: 'practice-exam-2.pdf' }]), [], 'only .tex files');
});

test('the note panel shows those files as the tutor’s answers do', async () => {
  const page = await readFile(new URL('../src/notebook-view.ts', import.meta.url), 'utf8');
  assert.match(page, /const tex = texFilesFor\(note\.title, view\.files \|\| \[\]\);/);
  assert.match(page, /rows\.append\(\.\.\.tex\.map\(name => madeFile\(name\)\)\); meta\.after\(rows\);/);
});
