import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdleLines, chooseIdleDialogue, IDLE_TOPIC } from '../desktop/idle-dialogue.mjs';
import { startConversation } from '../desktop/proactive.mjs';
import { cleanSettings, DEFAULTS } from '../desktop/core.mjs';
// Original test fixtures, not copied game dialogue.
const lines = 'A small test thought.\nAnother test thought.\nOne more test thought.';
const settings = { ...DEFAULTS, newsMode: 'off', idleDialogueLines: lines };
const opening = (content, topic = 'everyday science') => ({ role: 'assistant', mode: 'proactive', content, topic });
test('saved lines preserve wording, normalize line endings, deduplicate, and validate limits', () => {
  assert.deepEqual(parseIdleLines('  A small test thought.\r\n\nAnother test thought.\nA small test thought. '), ['A small test thought.', 'Another test thought.']);
  for (const invalid of [null, 'x'.repeat(12001), 'x'.repeat(501), Array.from({ length: 31 }, (_, i) => `Line ${i}`).join('\n')]) assert.throws(() => parseIdleLines(invalid));
  assert.equal(cleanSettings({ idleDialogueLines: lines }).idleDialogueLines, lines);
  assert.throws(() => cleanSettings({ idleDialogueMode: 'generate' }), /saved idle dialogue/);
});
test('empty and disabled collections preserve normal conversation behavior', () => {
  assert.equal(chooseIdleDialogue(DEFAULTS, []), null);
  assert.equal(chooseIdleDialogue({ ...settings, idleDialogueMode: 'off' }, []), null);
});
test('saved lines are spaced between regular topics and do not immediately repeat', () => {
  const first = chooseIdleDialogue(settings, [], () => 0);
  assert.equal(first.text, 'A small test thought.');
  const history = [opening(first.text, IDLE_TOPIC)];
  assert.equal(chooseIdleDialogue(settings, history), null);
  history.push(opening('Regular thought.')); assert.equal(chooseIdleDialogue(settings, history), null);
  history.push(opening('Another regular thought.'));
  assert.equal(chooseIdleDialogue(settings, history, () => 0).text, 'Another test thought.');
  assert.equal(chooseIdleDialogue({ ...settings, idleDialogueLines: first.text }, history, () => 0).text, first.text);
});
test('a saved line bypasses the conversation model and keeps exact text; aborted tasks deliver nothing', async () => {
  const args = { settings, history: [], signal: new AbortController().signal, random: () => 0, provider: { chat: () => { throw new Error('The model must not rewrite saved dialogue'); } } };
  assert.deepEqual(await startConversation(args), { text: 'A small test thought.', topic: IDLE_TOPIC });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startConversation({ ...args, signal: controller.signal }), { name: 'AbortError' });
});
test('due news takes priority over saved dialogue', async () => {
  let usedProvider = false;
  const provider = { chat: async () => { usedProvider = true; return { text: 'News with a source: https://example.com/news' }; } };
  const result = await startConversation({ settings: { ...settings, newsMode: 'on' }, history: [], signal: new AbortController().signal, provider });
  assert(usedProvider); assert.notEqual(result.topic, IDLE_TOPIC);
});
