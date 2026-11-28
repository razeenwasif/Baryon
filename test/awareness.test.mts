import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceGate, UtteranceDetector } from '../src/voice-gate.js';
import { ScreenAwareness, type ScreenDisplayId } from '../desktop/awareness.mjs';
import { cleanSettings, DEFAULTS } from '../desktop/core.mjs';
import { startConversation } from '../desktop/proactive.mjs';
import { declinesScreen } from '../src/chat-routing.js';

test('wake names route addressed speech; mentions, substrings and background chat stay local', () => {
  const gate = new VoiceGate();
  for (const text of ['What is for dinner?', 'I told Fairy about it', 'Stellarium is neat', 'Maverick is a movie']) assert.equal(gate.accept(text), null);
  for (const name of ['Fairy', 'Fairy', 'Fairy', 'Mavuika', 'Mav', 'Hey, Fairy', 'Okay Mavuika']) assert.deepEqual(gate.accept(`${name}, explain this`), { kind: 'message', text: 'explain this' });
  assert.deepEqual(gate.accept('Hello A+B, hello', { name: 'A+B' }), { kind: 'message', text: 'hello' });
  for (const heard of ['Hey Fairy', 'hey fairy', 'Fairy', 'Faerie', 'Hey Ferry', 'Hey, fairly', 'Okay Fairey', 'Ferry,', 'Hey, Mary.', 'Hey Barry', 'Hey, very', 'February.', 'Okay, fairy.']) assert.equal(gate.accept(heard, { followups: false })?.kind, 'wake', heard);
  assert.deepEqual(gate.accept('Hey Fairy, what time is it?'), { kind: 'message', text: 'what time is it?' });
  assert.deepEqual(gate.accept('Ferry, open Safari.'), { kind: 'message', text: 'open Safari.' });
  assert.deepEqual(gate.accept('February, what time is it?'), { kind: 'message', text: 'what time is it?' });
  assert.deepEqual(gate.accept('Hey Mary, what time is it?'), { kind: 'message', text: 'what time is it?' });
  for (const text of ['Fairly sure it rained', 'Ferry times are on the site', 'Fairytale endings', 'February is cold', 'Okay, very good', 'Mary had a lamb', 'Hey Marty', 'Hello Mary']) assert.equal(gate.accept(text, { followups: false }), null, text);
  assert.equal(gate.accept('AAAB hello', { name: 'A+B' }), null);
});
test('follow-up window expires, closes on stop, and opens only when explicitly engaged', () => {
  let now = 1000; const gate = new VoiceGate({ now: () => now });
  assert.equal(gate.accept('Fairy')?.kind, 'wake');
  now += 11000; assert.equal((gate.accept('Why is that?') as { text?: string } | null)?.text, 'Why is that?');
  assert.equal(gate.accept('Background speech'), null);
  gate.engage(); now += 12000; assert.equal(gate.accept('Too late'), null);
  gate.engage(); assert.equal(gate.accept('No wake', { followups: false }), null);
  gate.close(); assert.equal(gate.accept('No wake'), null);
  gate.engage(); const startedAt = now + 11000; now += 15000;
  assert.equal(gate.accept('A longer follow-up', { startedAt })?.kind, 'message');
  assert.equal(gate.accept('Mav, stop listening.')?.kind, 'pause');
  gate.engage(); assert.equal(gate.accept("That's all.")?.kind, 'dismiss');
  assert.equal(gate.accept('Anything else'), null);
});
const frame = (level: number) => new Float32Array(960).fill(level); // 20 ms
test('VAD retains speech onset, ends after silence, ignores clicks and bounds long utterances', () => {
  const vad = new UtteranceDetector();
  for (let i = 0; i < 10000; i++) assert.equal(vad.push(frame(.001)), null);
  assert(vad.pre.length <= 15);
  for (let i = 0; i < 3; i++) vad.push(frame(.1));
  for (let i = 0; i < 50; i++) assert.equal(vad.push(frame(0)), null);
  for (let i = 0; i < 30; i++) assert.equal(vad.push(frame(.08)), null);
  let clip: Float32Array | null = null;
  for (let i = 0; i < 50; i++) clip ||= vad.push(frame(0));
  assert(clip instanceof Float32Array); assert(clip.some(x => x > .07));
  assert(clip.length <= 48000 * 2);
  vad.reset(); let long: Float32Array | undefined;
  for (let i = 0; i < 1005; i++) { const value = vad.push(frame(.08)); if (value) { long = value; break; } }
  assert(long!.length <= 48000 * 20.03);
});
test('blocked playback, task activity and cancellation discard partial microphone buffers', () => {
  const vad = new UtteranceDetector();
  for (let i = 0; i < 20; i++) vad.push(frame(.1));
  assert(vad.started); vad.push(frame(.1), true);
  assert.equal(vad.started, false); assert.equal(vad.frames.length, 0);
  for (let i = 0; i < 100; i++) assert.equal(vad.push(frame(.1), true), null);
  for (let i = 0; i < 50; i++) assert.equal(vad.push(frame(0)), null);
});
test('screen cache refreshes after five seconds and respects display changes', async () => {
  let now = 0, count = 0; const ids: ScreenDisplayId[] = [];
  const watch = new ScreenAwareness<{ id: ScreenDisplayId; count: number }>({ now: () => now, allowed: () => true, capture: async id => { ids.push(id); return { id, count: ++count }; } });
  assert.equal((await watch.fresh()).count, 1);
  now = 4999; assert.equal((await watch.fresh()).count, 1);
  now = 5000; assert.equal((await watch.fresh()).count, 2);
  watch.select(7); assert.equal(watch.image, null);
  assert.equal((await watch.fresh()).id, 7); assert.deepEqual(ids, [null, null, 7]);
});
test('lock or pause invalidates pending screen capture; disabled watching cannot capture', async () => {
  let enabled = true, release!: (value: Record<string, string>) => void;
  const watch = new ScreenAwareness<Record<string, string>>({ allowed: () => enabled, capture: () => new Promise(resolve => { release = resolve; }) });
  const result = watch.fresh();
  enabled = false; watch.clear(); release({ secret: 'old frame' });
  await assert.rejects(result, /changed/); assert.equal(watch.image, null);
  await assert.rejects(watch.fresh(), /paused/);
  enabled = true;
  const next = watch.fresh(); watch.select(42); release({ wrong: 'display' });
  await assert.rejects(next, /changed/); assert.equal(watch.image, null);
});
test('concurrent screen reads share one capture and aborted callers do not get an image', async () => {
  let release!: (value: { id: number }) => void, count = 0;
  const watch = new ScreenAwareness<{ id: number }>({ allowed: () => true, capture: () => { count++; return new Promise(resolve => { release = resolve; }); } });
  const controller = new AbortController();
  const a = watch.fresh(controller.signal), b = watch.fresh();
  controller.abort(); release({ id: 1 });
  await assert.rejects(a, { name: 'AbortError' }); assert.deepEqual(await b, { id: 1 }); assert.equal(count, 1);
});
test('awareness settings are opt-in for other installs and explicit no-screen requests are honored', () => {
  const settings = cleanSettings({}); assert.equal(settings.screenAwareness, 'off'); assert.equal(settings.handsFree, 'off');
  assert.equal(cleanSettings({ handsFree: 'on' }).handsFree, 'on');
  assert.throws(() => cleanSettings({ voiceFollowups: 'anything' } as any), /hands-free/);
  assert(declinesScreen("Don't look at my screen for this")); assert(declinesScreen('Answer without a screenshot'));
  assert.equal(declinesScreen('Explain what is here'), false);
});
test('ordinary starters get awareness only when enabled; saved lines do not capture', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let count = 0, args: any[] = [];
  const getScreenshot = async () => { count++; return { url: 'test' }; };
  const provider = { chat: async (...v: unknown[]) => { args = v; return { text: 'An idea' }; } };
  const base = { provider, history: [], signal: new AbortController().signal, getScreenshot };
  await startConversation({ ...base, settings: { ...DEFAULTS, newsMode: 'off', screenAwareness: 'on' } });
  assert.equal(count, 1); assert.equal(args[4].url, 'test'); assert.match(args[0].personality, /untrusted evidence/);
  await startConversation({ ...base, settings: { ...DEFAULTS, newsMode: 'off' } });
  assert.equal(count, 1); assert.equal(args.length, 4);
});
