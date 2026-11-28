import test from 'node:test';
import assert from 'node:assert/strict';
import { createVocal, VOCAL_PROMPTS, requireQuietSpotify } from '../desktop/vocals.mjs';
const settings = { voiceProvider: 'fish', fishVoiceId: 'custom-voice', fishModel: 's2-pro' };
function fixture() {
  const calls: any[] = []; let checks = 0;
  return { calls, checks: () => checks, args: { settings, kind: 'hum', signal: new AbortController().signal,
    provider: { keys: { fish: 'test-key' }, request: async (...args: any[]) => { calls.push(args); return new Response(new Uint8Array([1, 2, 3])); } },
    checkPlayback: async () => { checks++; },
  } };
}
test('vocal path preserves only fixed Fish instructions and uses the saved custom voice', async () => {
  for (const kind of ['hum', 'sing'] as const) {
    const f = fixture(); await createVocal({ ...f.args, kind } as any);
    const body = JSON.parse(f.calls[0][1].body);
    assert.deepEqual(body, { text: VOCAL_PROMPTS[kind], reference_id: 'custom-voice', format: 'mp3' });
    assert.ok(body.text.startsWith('[')); assert.equal(f.checks(), 2);
  }
});
test('arbitrary songs, lyrics, unsupported voices and missing credentials never request audio', async () => {
  const f = fixture();
  await assert.rejects(createVocal({ ...f.args, kind: 'Some Song lyrics' } as any), /Choose humming/);
  await assert.rejects(createVocal({ ...f.args, settings: { ...settings, voiceProvider: 'openai' } } as any), /Fish Audio/);
  await assert.rejects(createVocal({ ...f.args, settings: { ...settings, fishVoiceId: '' } } as any), /custom voice ID/);
  assert.equal(f.calls.length, 0);
});
test('playing Spotify blocks generation and playback errors fail closed', async () => {
  const f = fixture();
  const playing = { status: () => ({ connected: true }), nowPlaying: async () => ({ playing: true }) };
  await assert.rejects(createVocal({ ...f.args, checkPlayback: () => requireQuietSpotify(playing as any) } as any), /Pause Spotify/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(requireQuietSpotify({ ...playing, nowPlaying: async () => { throw Error('offline'); } } as any), /Could not check/);
});
test('Spotify starting during generation prevents returning the clip', async () => {
  const f = fixture(); let checks = 0;
  await assert.rejects(createVocal({ ...f.args, checkPlayback: async () => { if (++checks === 2) throw Error('Pause Spotify'); } } as any), /Pause Spotify/);
  assert.equal(f.calls.length, 1);
});
test('cancellation after generation prevents playback', async () => {
  const f = fixture(); const controller = new AbortController();
  f.args.provider.request = async () => { controller.abort(); return new Response(new Uint8Array([1])); };
  await assert.rejects(createVocal({ ...f.args, signal: controller.signal } as any), { name: 'AbortError' });
});
