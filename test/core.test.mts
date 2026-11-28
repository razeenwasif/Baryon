import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, cleanSettings, readJSON, writeJSON, Providers, conversationInput, runDesktop, validateActions } from '../desktop/core.mjs';

const answer = (text: string) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
test('settings retain defaults and reject unsupported providers', () => {
  assert.equal(cleanSettings({ name: '  Nova ' }).name, 'Nova');
  assert.equal(cleanSettings({}).workEffort, 'high');
  assert.equal(cleanSettings({ workEffort: 'xhigh' }).workEffort, 'xhigh');
  assert.throws(() => cleanSettings({ workEffort: 'extra' as any }), /effort/);
  assert.equal(cleanSettings({ model: 'gpt-4.1-mini' }).voice, 'coral');
  assert.throws(() => cleanSettings({ voiceProvider: 'untrusted' as any }), /provider/);
  assert.equal(cleanSettings({}).voiceVolume, '100');
  assert.equal(cleanSettings({ voiceVolume: ' 60 ' }).voiceVolume, '60');
  for (const voiceVolume of ['4', '101', 'loud', '']) assert.throws(() => cleanSettings({ voiceVolume }), /volume/);
  assert.equal(cleanSettings({ workGeminiModel: 'gemini-3.8-flash-low', workCodexModel: 'gpt-5.6-terra' }).workCodexModel, 'gpt-5.6-terra');
  assert.equal(cleanSettings({}).workGeminiModel, '');
  assert.throws(() => cleanSettings({ workCodexModel: 'not a model' }), /work sessions/);
});
test('DeepSeek balance and models are read with the saved key', async () => {
  const seen: Array<[string, string | undefined, string | undefined]> = [];
  const replies: Record<string, unknown> = { '/user/balance': { is_available: true, balance_infos: [] }, '/models': { object: 'list', data: [{ id: 'deepseek-flash', object: 'model', owned_by: 'deepseek', name: 'DeepSeek-V4.1-Flash' }, { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' }] } };
  const provider = new Providers({ deepseek: 'saved-key' }, async (url, options) => {
    const urlStr = String(url);
    const headers = options?.headers as Record<string, string> | undefined;
    seen.push([urlStr, headers?.Authorization, options?.method]);
    return new Response(JSON.stringify(replies[new URL(urlStr).pathname]));
  });
  assert.equal(((await provider.deepseekBalance()) as any).is_available, true);
  assert.deepEqual(await provider.deepseekModels(), [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }, { id: 'deepseek-v4-pro', name: 'deepseek v4 pro' }]);
  assert.deepEqual(seen, [['https://api.deepseek.com/user/balance', 'Bearer saved-key', undefined], ['https://api.deepseek.com/models', 'Bearer saved-key', undefined]]);
  await assert.rejects(new Providers({}).deepseekBalance(), /API key/);
});
test('memory is persisted and corrupt data is not silently overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-test-'));
  const path = join(dir, 'history.json');
  assert.deepEqual(await readJSON(path, []), []);
  const history = [{ role: 'user', content: 'hello' }];
  await writeJSON(path, history); assert.deepEqual(await readJSON(path, []), history);
  assert.equal(JSON.parse(await readFile(path, 'utf8'))[0].content, 'hello');
  await writeFile(path, '{broken');
  await assert.rejects(readJSON(path, []), /Cannot read saved data/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
});
test('conversation context is bounded and retains complete recent turns', () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: 'x'.repeat(1000) }));
  const input = conversationInput(history, 'hello');
  assert.equal(input.at(-1)!.content, 'hello'); assert.equal(input[0].role, 'user');
  assert(input.reduce((n, x) => n + String(x.content).length, 0) <= 24000);
});
test('chat sends personality, user memory and history without server-side storage', async () => {
  let payload: any;
  const provider = new Providers({ openai: 'test-key' }, async (url, options) => { assert.equal(url, 'https://api.openai.com/v1/responses'); payload = JSON.parse(String(options?.body)); return Response.json(answer('Hello there.')); });
  const result = await provider.chat({ ...DEFAULTS, memory: 'I like astronomy' }, [], 'hello');
  assert.equal(result.text, 'Hello there.'); assert.equal(payload.store, false);
  assert.match(payload.instructions, /I like astronomy/); assert.equal(payload.reasoning.effort, 'low');
});
test('provider errors never echo secret-bearing response bodies', async () => {
  const provider = new Providers({ openai: 'secret' }, async () => new Response('secret reflected here', { status: 401 }));
  await assert.rejects(provider.chat(DEFAULTS, [], 'hi'), (error: unknown) => error instanceof Error && /API key was rejected/.test(error.message) && !error.message.includes('secret'));
});
test('empty or incomplete text is surfaced, not saved as a successful reply', async () => {
  const provider = new Providers({ openai: 'test' }, async () => Response.json({ status: 'incomplete', output: [] }));
  await assert.rejects(provider.chat(DEFAULTS, [], 'hi'), /no spoken reply/);
});
test('audio transcription sends multipart and speech routes to selected provider', async () => {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
  const provider = new Providers({ openai: 'test', fish: 'fish-test' }, async (url, options) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, options });
    return urlStr.endsWith('transcriptions') ? Response.json({ text: 'hello Fairy' }) : new Response(new Uint8Array([1, 2, 3]));
  });
  assert.equal(await provider.transcribe({ ...DEFAULTS, transcriptionProvider: 'openai' }, new Uint8Array([1]), 'audio/webm'), 'hello Fairy');
  assert.equal(((calls[0].options!.body as FormData).get('file') as File).name, 'recording.webm');
  assert.deepEqual([...(await provider.speak({ ...DEFAULTS, voiceProvider: 'openai' }, 'hello'))!], [1, 2, 3]);
  await provider.speak({ ...DEFAULTS, voiceProvider: 'fish', fishVoiceId: 'voice-id' }, 'hello');
  assert.equal(calls[2].url, 'https://api.fish.audio/v1/tts');
  assert.equal(JSON.parse(String(calls[2].options!.body)).reference_id, 'voice-id');
  await assert.rejects(provider.transcribe(DEFAULTS, new Uint8Array(), 'audio/webm'), /Recording/);
});
test('Fish listening and custom speech work without an OpenAI key', async () => {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
  const provider = new Providers({ fish: 'fish-test' }, async (url, options) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, options });
    return urlStr.endsWith('/asr') ? Response.json({ text: ' hello Fairy ' }) : new Response(new Uint8Array([2, 3]));
  });
  assert.equal(await provider.transcribe(DEFAULTS, new Uint8Array([1]), 'audio/webm'), 'hello Fairy');
  assert.equal(calls[0].url, 'https://api.fish.audio/v1/asr');
  assert.equal(((calls[0].options!.body as FormData).get('audio') as File).name, 'recording.webm');
  assert.equal((calls[0].options!.body as FormData).get('ignore_timestamps'), 'true');
  assert.equal((calls[0].options!.headers as Record<string, string>).Authorization, 'Bearer fish-test');
  assert.deepEqual([...(await provider.speak({ ...DEFAULTS, fishVoiceId: 'custom-fairy' }, 'hello'))!], [2, 3]);
  assert.equal(JSON.parse(String(calls[1].options!.body)).reference_id, 'custom-fairy');
  await assert.rejects(new Providers({}).transcribe(DEFAULTS, new Uint8Array([1]), 'audio/webm'), /Fish Audio API key/);
});
test('desktop rejects out-of-bounds and unknown actions', () => {
  assert.throws(() => validateActions([{ type: 'click', button: 'left', x: 1000, y: 20 }], 1000, 800), /outside/);
  assert.throws(() => validateActions([{ type: 'shell', command: 'anything' } as any], 1000, 800), /Unsupported/);
  assert.throws(() => validateActions([{ type: 'drag', path: [] }], 1000, 800), /drag/);
  assert.deepEqual(validateActions([{ type: 'open_app', bundle_id: 'com.apple.calculator' }], 1000, 800), [{ type: 'open_app', bundle_id: 'com.apple.calculator' }]);
  for (const bundle_id of ['/Applications/Calculator.app', 'https://example.com', 'com.apple.calculator; say hello', '', null]) {
    assert.throws(() => validateActions([{ type: 'open_app', bundle_id: bundle_id as any }], 1000, 800), /bundle identifier/);
  }
});
function desktopFixture(overrides: Record<string, any> = {}) {
  let calls = 0, executed = 0, captured = 0;
  return {
    stats: () => ({ calls, executed, captured }),
    args: { settings: DEFAULTS, task: 'Calculate 1 + 1', signal: new AbortController().signal, onProgress: () => {},
      provider: { response: async (body: any) => { calls++; if (calls === 2) assert.equal(body.input.at(-1).type, 'computer_call_output'); return calls === 1 ? { output: [{ type: 'computer_call', call_id: 'call-1', actions: [{ type: 'click', button: 'left', x: 40, y: 30 }] }] } : answer('Calculator shows 2.'); } },
      capture: async () => { captured++; return { url: 'data:image/png;base64,test', width: 1000, height: 800 }; },
      execute: async () => { executed++; }, approve: async () => true,
      ...overrides,
    },
  };
}
test('desktop executes approved actions and returns updated screenshots to the model', async () => {
  const f = desktopFixture(); assert.equal(await runDesktop(f.args), 'Calculator shows 2.');
  assert.deepEqual(f.stats(), { calls: 2, executed: 1, captured: 2 });
});
test('denied desktop actions never execute', async () => {
  const f = desktopFixture({ approve: async () => false });
  await assert.rejects(runDesktop(f.args), /cancelled/); assert.equal(f.stats().executed, 0);
});
test('stop during approval prevents execution', async () => {
  const controller = new AbortController();
  const f = desktopFixture({ signal: controller.signal, approve: async () => { controller.abort(); return true; } });
  await assert.rejects(runDesktop(f.args), { name: 'AbortError' }); assert.equal(f.stats().executed, 0);
});
test('model safety checks cause a handoff rather than an automatic acknowledgement', async () => {
  const f = desktopFixture({ provider: { response: async () => ({ output: [{ type: 'computer_call', pending_safety_checks: [{ id: 'check' }] }] }) } });
  await assert.rejects(runDesktop(f.args), /safety handoff/); assert.equal(f.stats().executed, 0);
});
test('desktop step budget stops an endless task', async () => {
  const f = desktopFixture({ maxSteps: 1 });
  await assert.rejects(runDesktop(f.args), /Stopped after 1/);
});
