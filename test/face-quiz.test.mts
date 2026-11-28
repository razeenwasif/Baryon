// Two Macs, step 8: quiz hints for a question open on the MacBook, with only the model call made on the mini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { call, setup } from './helpers/face-pair.mjs';
import { faceTrayTemplate } from '../desktop/presence.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const observation = { text: 'Is it true or false that 2 + 2 = 4?', region: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 }, snapshot: { url: 'data:image/png;base64,AAAA', width: 10, height: 10, visualKey: 'k' }, previousQuestions: [] };

test('/v1/face/quiz runs the mini’s own quiz solve on what the face recognised, and sends back its reply', async () => {
  const solved: Array<{ seen: Record<string, unknown>; signal: AbortSignal }> = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.quiz = async (seen, signal) => { solved.push({ seen, signal }); return '{"kind":"binary","answer":"True"}'; };
  try {
    const answered = await call(s.link, '/v1/face/quiz', { method: 'POST', key: s.key, body: { observation } });
    assert.equal(answered.status, 200);
    assert.equal(answered.json.reply, '{"kind":"binary","answer":"True"}');
    assert.deepEqual(solved[0].seen, observation);
    assert.equal(solved[0].signal.aborted, false);
    // A reply given as { text } is passed on as its text; anything else as nothing.
    s.face.quiz = async () => ({ text: 'B' });
    assert.equal((await call(s.link, '/v1/face/quiz', { method: 'POST', key: s.key, body: { observation } })).json.reply, 'B');
    for (const body of [{}, { observation: 'text' }, { observation: { text: 4 } }, { observation: [] }])
      assert.equal((await call(s.link, '/v1/face/quiz', { method: 'POST', key: s.key, body })).status, 400, JSON.stringify(body));
    // Without the face's key there's no answer, and a face link with no quiz has no such route.
    assert.equal((await call(s.link, '/v1/face/quiz', { method: 'POST', body: { observation } })).status, 401);
    s.face.quiz = null;
    assert.equal((await call(s.link, '/v1/face/quiz', { method: 'POST', key: s.key, body: { observation } })).status, 404);
  } finally { await s.done(); }
});

test('a newer question stops the model call for the one before', async () => {
  const signals: AbortSignal[] = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.quiz = (_seen, signal) => new Promise(resolve => { signals.push(signal); signal.addEventListener('abort', () => resolve('')); if (signals.length === 2) resolve('second'); });
  try {
    const first = call(s.link, '/v1/face/quiz', { method: 'POST', key: s.key, body: { observation } });
    while (signals.length < 1) await new Promise(resolve => setTimeout(resolve, 5));
    const second = await call(s.link, '/v1/face/quiz', { method: 'POST', key: s.key, body: { observation: { ...observation, text: 'Next?' } } });
    assert.equal(second.json.reply, 'second');
    assert.equal(signals[0].aborted, true);
    await first;
  } finally { await s.done(); }
});

test('the mini answers a face’s question with the solve its own quiz uses, noted as one background call', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /quiz: \(observation, signal\) => solveQuizHere\(observation, signal, \(\) => \{\s*\}\),/);
  assert.match(main, /solve: \(observation, signal, onText\) => solveQuizHere\(observation, signal, onText\),/);
  const solve = main.slice(main.indexOf('solveQuizHere = async (observation, signal, onText) => {'), main.indexOf('({ quiz, target: quizTarget } = buildQuiz({'));
  assert.equal((solve.match(/noteBackground\('quiz'/g) || []).length, 1);
  assert.match(solve, /answer\s*=\s*await solveQuiz\(/);
});

test('a face watches its own screen with the same watcher, and makes no model call of its own', async () => {
  const face = await read('../desktop/face-main.cts');
  assert.match(face, /const \{ buildQuiz, quizTasks \} = await import\('\.\/quiz-setup\.mjs'\);/);
  assert.match(face, /solve: \(observation, signal\) => client!\.quiz\(observation, \{ signal \}\),/);
  for (const name of ['quiz-provider.mjs', 'claude.mjs', 'codex.mjs', 'solveQuiz']) assert.ok(!face.includes(name), name);
  // Its pictures are its own, only with Let Fairy see this screen on and Screen Recording allowed.
  assert.match(face, /const quizAllowed = \(\)(?:: boolean)? => Boolean\(store\?\.state\(\)\.screen\) && !faceLocked && client\?\.state\(\) === 'connected' && systemPreferences\.getMediaAccessStatus\('screen'\) === 'granted';/);
  assert.match(face, /if \(!store!\.state\(\)\.screen && quiz\?\.enabled\) quiz\.enable\(false\);/);
  const client = await read('../desktop/face-client.mts');
  assert.match(client, /async quiz\(observation[^)]*, \{ signal \}[^)]* = \{\}\)[^{]*\{ return \(await this\.call\('POST', '\/v1\/face\/quiz', \{ body: \{ observation \}, timeoutMs: 60000, signal \}\)\)\.reply \?\? ''; \}/);
});

test('the face’s menu offers Quiz hints once paired, with what it’s doing while it’s on', () => {
  assert.ok(!faceTrayTemplate({ link: 'unpaired', quiz: { enabled: false } }).some(item => item.id === 'quiz'));
  assert.ok(!faceTrayTemplate({ link: 'connected' }).some(item => item.id === 'quiz'), 'not before the quiz is set up');
  const off = faceTrayTemplate({ link: 'connected', quiz: { enabled: false, status: 'Off' } });
  assert.deepEqual(off.find(item => item.id === 'quiz'), { id: 'quiz', label: 'Quiz hints', type: 'checkbox', checked: false });
  assert.ok(!off.some(item => item.id === 'quiz-status'));
  const on = faceTrayTemplate({ link: 'connected', quiz: { enabled: true, status: 'Hover a question heading to select it' } });
  assert.equal(on.find(item => item.id === 'quiz-status')!.label, 'Hover a question heading to select it');
});
