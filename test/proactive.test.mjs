import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationTimer } from '../src/conversation-timer.js';
import { chooseTopic, TOPICS, startConversation } from '../desktop/proactive.mjs';
import { cleanSettings, DEFAULTS, conversationInput } from '../desktop/core.mjs';

test('quiet timer waits, defers interruptions, backs off, and stops after two unanswered openings', () => {
  let now = 0;
  const timer = new ConversationTimer({ now: () => now, random: () => 0 });
  now = 299999; assert.equal(timer.due(false), false);
  now = 300000; assert.equal(timer.due(true), false); assert.equal(timer.due(false), true);
  timer.defer(); now += 299999; assert.equal(timer.due(false), false);
  now++; timer.delivered();
  // UI/audio activity must not shorten the longer wait after an ignored topic.
  timer.defer(); now += 300000; assert.equal(timer.due(false), false);
  now += 300000; assert.equal(timer.due(false), true);
  timer.delivered(); now += 3600000; assert.equal(timer.due(false), false);
  timer.engage(); now += 300000; assert.equal(timer.due(false), true);
});

test('snooze survives UI activity and an explicit conversation resets it', () => {
  let now = 0;
  const timer = new ConversationTimer({ now: () => now, random: () => 0 });
  timer.snooze(); now = 60000; timer.defer();
  now = 300000; assert.equal(timer.due(false), false);
  now = 1800000; assert.equal(timer.due(false), true);
  timer.configure(20); now += 1199999; assert.equal(timer.due(false), false);
  now++; assert.equal(timer.due(false), true);
});

test('topic rotation avoids eight recently introduced categories', () => {
  const history = TOPICS.slice(0, 8).map(([topic]) => ({ role: 'assistant', mode: 'proactive', topic, content: 'An idea.' }));
  assert.equal(chooseTopic(history, () => 0)[0], TOPICS[8][0]);
  assert.equal(chooseTopic(history, () => .99)[0], TOPICS[9][0]);
});

test('conversation starters use the conversation provider without a screenshot and do not mutate history', async () => {
  const history = [{ role: 'user', content: 'I like music.' }, { role: 'assistant', content: 'What do you listen to?' }];
  const original = structuredClone(history);
  let args;
  const result = await startConversation({ provider: { chat: async (...values) => { args = values; return { text: ' Here is a fresh idea. ' }; } }, settings: { ...DEFAULTS, newsMode: 'off', conversationInterests: 'Space and music' }, history, signal: new AbortController().signal, random: () => 0 });
  assert.equal(result.text, 'Here is a fresh idea.');
  assert.equal(args.length, 4); // No screen image, desktop executor, or extra tool input.
  assert.match(args[0].personality, /not a reply to a new user message/);
  assert.match(args[0].personality, /unverified current news/);
  assert.match(args[2], /Space and music/);
  assert.deepEqual(history, original);
});

test('a user interruption discards a starter that returns after cancellation', async () => {
  const controller = new AbortController();
  await assert.rejects(startConversation({ settings: DEFAULTS, history: [], signal: controller.signal,
    provider: { chat: async () => { controller.abort(); return { text: 'Too late.' }; } },
  }), { name: 'AbortError' });
});

test('history keeps standalone ideas and subsequent user replies in order', () => {
  const history = [
    { role: 'assistant', content: 'An idea about space.', mode: 'proactive' },
    { role: 'assistant', content: 'An idea about music.', mode: 'proactive' },
    { role: 'user', content: 'Tell me about the second one.' },
    { role: 'assistant', content: 'Here is more about music.' },
  ];
  assert.deepEqual(conversationInput(history, 'Why?'), [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: 'Why?' }]);
  const large = Array.from({ length: 50 }, () => ({ role: 'assistant', content: 'x'.repeat(2000), mode: 'proactive' }));
  assert(conversationInput(large, 'Hi').reduce((n, entry) => n + entry.content.length, 0) <= 24000);
});

test('settings enable requested conversations for existing installs and validate controls', () => {
  const settings = cleanSettings({ fishVoiceId: 'existing-voice', personality: 'Keep my personality.' });
  assert.equal(settings.proactiveMode, 'on'); assert.equal(settings.proactiveMinutes, '5');
  assert.equal(settings.fishVoiceId, 'existing-voice'); assert.equal(settings.personality, 'Keep my personality.');
  assert.equal(cleanSettings({ proactiveMode: 'off', proactiveMinutes: '20' }, settings).proactiveMode, 'off');
  assert.throws(() => cleanSettings({ proactiveMinutes: '0' }), /interval/);
  assert.throws(() => cleanSettings({ proactiveMode: 'maybe' }), /starts conversations/);
});
