import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, cleanSettings, Providers } from '../desktop/core.mjs';
import { readChatStream } from '../desktop/streaming.mjs';

function makeSSEStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

test('DeepSeek non-streaming chat sends messages, model and headers, returning text and usage', async () => {
  let requestUrl: string | null = null;
  let requestHeaders: Record<string, string> | null = null;
  let requestBody: any = null;

  const mockResponse = {
    id: 'chatcmpl-123',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Hello from DeepSeek! How can I assist you today?',
        },
      },
    ],
    usage: { prompt_tokens: 15, completion_tokens: 12, total_tokens: 27 },
  };

  const provider = new Providers({ deepseek: 'sk-test-deepseek-key' }, async (url, options) => {
    requestUrl = String(url);
    requestHeaders = (options?.headers ?? {}) as Record<string, string>;
    requestBody = JSON.parse(String(options?.body));
    return Response.json(mockResponse);
  });

  const settings = { ...DEFAULTS, backend: 'deepseek' as const, model: 'deepseek-chat' };
  const history = [{ role: 'user' as const, content: 'Hi' }, { role: 'assistant' as const, content: 'Hello' }];
  const result = await provider.chat(settings, history, 'What is the speed of light?');

  assert.equal(requestUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(requestHeaders!.Authorization, 'Bearer sk-test-deepseek-key');
  assert.equal(requestHeaders!['Content-Type'], 'application/json');
  assert.equal(requestBody.model, 'deepseek-chat');
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.messages[0].role, 'system');
  assert.match(requestBody.messages[0].content, /Fairy/);
  assert.equal(requestBody.messages.at(-1).content, 'What is the speed of light?');

  assert.equal(result.text, 'Hello from DeepSeek! How can I assist you today?');
  assert.deepEqual(result.usage, { prompt_tokens: 15, completion_tokens: 12, total_tokens: 27 });
});

test('DeepSeek streaming chat parses standard SSE chunks and delivers tokens via onText', async () => {
  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"Stars "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"shine "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"brightly."}}],"usage":{"total_tokens":20}}\n\n',
    'data: [DONE]\n\n',
  ];

  const provider = new Providers({ deepseek: 'sk-test-stream-key' }, async () => {
    return new Response(makeSSEStream(sseChunks), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  const streamedDeltas: string[] = [];
  const settings = { ...DEFAULTS, backend: 'deepseek' as const, model: 'deepseek-chat' };
  const result = await provider.chat(settings, [], 'Tell me about stars', undefined, null, {
    onText: delta => streamedDeltas.push(delta),
  });

  assert.equal(result.text, 'Stars shine brightly.');
  assert.deepEqual(streamedDeltas, ['Stars ', 'Stars shine ', 'Stars shine brightly.']);
  assert.equal((result.usage as any)?.total_tokens, 20);
});

test('DeepSeek chat rejects when API key is missing', async () => {
  const provider = new Providers({}, async () => {
    assert.fail('Should not make network request without key');
  });

  const settings = { ...DEFAULTS, backend: 'deepseek' as const };
  await assert.rejects(
    provider.chat(settings, [], 'Hello'),
    /Add your DeepSeek API key in Settings first/
  );
});

test('DeepSeek chat handles HTTP 401 and 429 cleanly without leaking secrets', async () => {
  const provider401 = new Providers({ deepseek: 'super-secret-key-401' }, async () => {
    return new Response('Unauthorized: super-secret-key-401 invalid', { status: 401 });
  });
  await assert.rejects(
    provider401.chat({ ...DEFAULTS, backend: 'deepseek' }, [], 'Hi'),
    (err: unknown) => err instanceof Error && /API key was rejected/.test(err.message) && !err.message.includes('super-secret-key-401')
  );

  const provider429 = new Providers({ deepseek: 'super-secret-key-429' }, async () => {
    return new Response('Rate limit: super-secret-key-429', { status: 429 });
  });
  await assert.rejects(
    provider429.chat({ ...DEFAULTS, backend: 'deepseek' }, [], 'Hi'),
    (err: unknown) => err instanceof Error && /Rate limit or API quota reached/.test(err.message) && !err.message.includes('super-secret-key-429')
  );
});

test('DeepSeek chat rejects empty or whitespace-only model replies', async () => {
  const providerEmpty = new Providers({ deepseek: 'sk-key' }, async () => {
    return Response.json({ choices: [{ message: { role: 'assistant', content: '   ' } }] });
  });

  await assert.rejects(
    providerEmpty.chat({ ...DEFAULTS, backend: 'deepseek' }, [], 'Hi'),
    /The model returned no spoken reply/
  );
});

test('DeepSeek chat surfaces provider API error messages', async () => {
  const providerError = new Providers({ deepseek: 'sk-key' }, async () => {
    return Response.json({ error: { message: 'Insufficient balance on DeepSeek account.' } });
  });

  await assert.rejects(
    providerError.chat({ ...DEFAULTS, backend: 'deepseek' }, [], 'Hi'),
    /Insufficient balance on DeepSeek account/
  );
});

const screenshot = { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', width: 1, height: 1 };

test('DeepSeek screen request sends inline vision input directly, without tools or file uploads', async () => {
  let body: any, endpoint: string | undefined;
  const provider = new Providers({ deepseek: 'test' }, async (url, options) => {
    endpoint = String(url); body = JSON.parse(String(options?.body));
    return Response.json({ choices: [{ message: { content: 'A pixel.' } }] });
  });
  (provider as any).fallback = { chat: () => assert.fail('Do not forward the image to another provider') };
  const history = [{ role: 'user' as const, content: 'Hello' }, { role: 'assistant' as const, content: 'Hi' }];
  const before = structuredClone(history);
  const result = await provider.chat({ ...DEFAULTS, model: 'deepseek-reasoner' }, history, 'What is on my screen?', undefined, screenshot);
  assert.equal(endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.messages.at(-1).content, [{ type: 'text', text: 'What is on my screen?' }, { type: 'image_url', image_url: { url: screenshot.url, detail: 'original' } }]);
  assert.equal(body.tools, undefined); assert.match(body.messages[0].content, /single snapshot/); assert.match(body.messages[0].content, /untrusted/);
  assert.equal(result.text, 'A pixel.'); assert(!JSON.stringify(result).includes('data:image')); assert.deepEqual(history, before);
  assert(body.messages.slice(0,-1).every((m: any)=>typeof m.content==='string'));
  await provider.chat({ ...DEFAULTS, model: 'deepseek-reasoner' }, history, 'Thanks');
  assert.equal(body.model, 'deepseek-reasoner'); assert.equal(body.messages.at(-1).content, 'Thanks'); assert(!JSON.stringify(body).includes('image_url'));
});

test('DeepSeek vision also streams its reply', async () => {
  let body: any; const updates: string[] = [];
  const provider = new Providers({ deepseek: 'test' }, async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return new Response(makeSSEStream(['data: {"choices":[{"delta":{"content":"A chart."}}]}\n\n', 'data: [DONE]\n\n']));
  });
  const result = await provider.chat(DEFAULTS, [], 'Read my screen', undefined, screenshot, { onText: t => updates.push(t) });
  assert.equal(body.stream, true); assert.equal(body.model, 'deepseek-flash'); assert.equal(result.text, 'A chart.'); assert.deepEqual(updates, ['A chart.']);
});

test('invalid, cancelled, or missing-key vision requests never fall back or transmit', async () => {
  const provider = new Providers({ openai: 'other-key' }, async () => assert.fail('No network allowed'));
  await assert.rejects(provider.chat(DEFAULTS, [], 'Screen?', undefined, screenshot), /DeepSeek API key/);
  provider.keys.deepseek = 'test';
  await assert.rejects(provider.chat(DEFAULTS, [], 'Screen?', undefined, { ...screenshot, url: 'https://example.com/private' }), /Invalid screen image/);
  await assert.rejects(provider.chat(DEFAULTS, [], 'Screen?', undefined, { ...screenshot, height: 8193 }), /8192/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(provider.chat(DEFAULTS, [], 'Screen?', abort.signal, screenshot), { name: 'AbortError' });
});

test('cleanSettings defaults to Fairy, deepseek backend and s2.1-pro-free Fish voice model', () => {
  const cleaned = cleanSettings({});
  assert.equal(cleaned.name, 'Fairy');
  assert.equal(cleaned.backend, 'deepseek');
  assert.equal(cleaned.model, 'deepseek-chat');
  assert.equal(cleaned.fishModel, 's2.1-pro-free');
  assert.equal(cleaned.voiceProvider, 'fish');
});
