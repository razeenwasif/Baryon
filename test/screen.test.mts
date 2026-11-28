import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askAboutScreen, Providers, DEFAULTS, validateScreenshot } from '../desktop/core.mjs';
import { CodexConnection } from '../desktop/codex.mjs';

const snapshot = { url: 'data:image/png;base64,dGVzdA==', width: 1280, height: 800 };
test('screen questions capture once, restore the app, and send the snapshot with the question', async () => {
  const order: string[] = [];
  const response = await askAboutScreen({
    settings: DEFAULTS, history: [], text: 'Explain this chart', signal: new AbortController().signal,
    capture: async () => { order.push('capture'); return snapshot; }, restore: () => order.push('restore'),
    provider: { chat: async (_settings: any, _history: any, text: string, _signal: any, image: any) => { order.push('chat'); assert.equal(text, 'Explain this chart'); assert.deepEqual(image, snapshot); return { text: 'The chart shows growth.' }; } },
  });
  assert.deepEqual(order, ['capture', 'restore', 'chat']); assert.equal(response.text, 'The chart shows growth.');
  assert.equal((response as any).screenshot, undefined);
});
test('capture failure restores Fairy and does not send a model request', async () => {
  let restored = false, sent = false;
  await assert.rejects(askAboutScreen({ settings: DEFAULTS, history: [], text: 'What is this?', signal: new AbortController().signal,
    capture: async () => { throw new Error('Screen permission denied'); }, restore: () => { restored = true; }, provider: { chat: (async () => { sent = true; }) as any },
  }), /permission denied/);
  assert(restored); assert.equal(sent, false);
});
test('stop after capture prevents screenshot transmission', async () => {
  const controller = new AbortController(); let restored = false, sent = false;
  await assert.rejects(askAboutScreen({ settings: DEFAULTS, history: [], text: 'What is this?', signal: controller.signal,
    capture: async () => { controller.abort(); return snapshot; }, restore: () => { restored = true; }, provider: { chat: (async () => { sent = true; }) as any },
  }), { name: 'AbortError' });
  assert(restored); assert.equal(sent, false);
});
test('OpenAI screen request sends the image without computer tools or storage', async () => {
  let body: any;
  const provider = new Providers({ openai: 'test' }, async (_url, options) => { body = JSON.parse(options!.body as string); return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'A chart.' }] }] }); });
  await provider.chat({ ...DEFAULTS, backend: 'openai' }, [], 'What is this?', undefined, snapshot);
  assert.equal(body.input[0].content[1].image_url, snapshot.url);
  assert.equal(body.tools, undefined); assert.equal(body.store, false);
  assert.match(body.instructions, /single snapshot/); assert.match(body.instructions, /untrusted/);
});
test('Codex screen request uses vision input and exposes no desktop tool', async () => {
  const provider = new CodexConnection({ cwd: '/private/tmp', executable: '/fake/codex' }); let request: any;
  provider.turn = async args => { request = args; return 'A chart.'; };
  await provider.chat({ ...DEFAULTS, backend: 'openai' }, [], 'What is this?', undefined, snapshot);
  assert.deepEqual(request.input[1], { type: 'image', url: snapshot.url, detail: 'original' });
  assert.equal(request.tools, undefined); assert.equal(request.toolHandler, undefined);
  assert.match(request.instructions, /cannot click/);
  await provider.chat(DEFAULTS, [], 'Hello');
  assert.equal(request.input.length, 1); assert.match(request.instructions, /cannot see the screen/);
});
test('invalid screenshots are rejected before transmission', () => {
  assert.throws(() => validateScreenshot({ ...snapshot, url: 'file:///private/file.png' }), /Invalid screen image/);
  assert.throws(() => validateScreenshot({ ...snapshot, width: -1 }), /dimensions/);
});

test('request-owned snapshot is released after success without changing an ambient cache', async () => {
  let sentImage: any;
  const cached = { ...snapshot };
  await askAboutScreen({ settings: DEFAULTS, history: [], text: 'Read my screen', signal: new AbortController().signal,
    capture: async () => cached, restore: () => {}, provider: { chat: async (_s: any,_h: any,_t: any,_signal: any,image: any) => { sentImage = image; assert.equal(image.url, snapshot.url); return { text: 'Read.' }; } },
  });
  assert.equal(sentImage.url, ''); assert.equal(cached.url, snapshot.url);
});

test('request-owned image is released on provider errors and cancellation during analysis', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let sentImage: any;
    await assert.rejects(askAboutScreen({ settings: DEFAULTS, history: [], text: 'Read my screen', signal: controller.signal,
      capture: async () => ({ ...snapshot }), restore: () => {}, provider: { chat: async (_s: any,_h: any,_t: any,signal: any,image: any) => {
        sentImage = image;
        if (cancel) { controller.abort(); signal.throwIfAborted(); }
        throw new Error('Provider unavailable');
      } },
    }), cancel ? { name: 'AbortError' } : /Provider unavailable/);
    assert.equal(sentImage.url, '');
  }
});

test('each explicit question receives a fresh snapshot and no image is added to history', async () => {
  let count = 0; const seen: string[] = []; const history: any[] = [];
  const capture = async () => ({ ...snapshot, url: 'data:image/png;base64,' + Buffer.from(String(++count)).toString('base64') });
  const provider = { chat: async (_s: any, h: any, _t: any, _signal: any, image: any) => { assert.deepEqual(h, []); seen.push(image.url); return { text: 'Text only.' }; } };
  for (let i = 0; i < 2; i++) await askAboutScreen({ settings: DEFAULTS, history, text: 'What is on screen now?', signal: new AbortController().signal, capture, restore: () => {}, provider });
  assert.equal(count, 2); assert.notEqual(seen[0], seen[1]); assert.deepEqual(history, []);
});
