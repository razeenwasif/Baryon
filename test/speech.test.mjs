import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechText, voiceText } from '../desktop/speech.mjs';
import { Providers, DEFAULTS } from '../desktop/core.mjs';
import { loadMathSpeech } from '../desktop/math-speech.mjs';

// The maths engine loads on first use (efficiency audit, fix 12); some of these tests read maths.
await loadMathSpeech();

test('speech skips fenced code, including nested shorter fences and unfinished blocks', () => {
  assert.equal(speechText('Here is the fix.\n```js\nconsole.log("secret code");\n```\nThen restart.'), 'Here is the fix. Then restart.');
  assert.equal(speechText('Before.\n~~~~python\n```\nprint(1)\n~~~\n~~~~\nAfter.'), 'Before. After.');
  assert.equal(speechText('Before.\n> ```sh\n> rm file\n> ```\nAfter.'), 'Before. After.');
  assert.equal(speechText('Before.\n```python\nunfinished code'), 'Before.');
  assert.equal(speechText('Before.\n        nested_code()\nAfter.'), 'Before. After.');
});

test('speech removes markup, decoration, and linked citations while retaining prose', () => {
  assert.equal(speechText('# **Hello** ✨\n- [x] Read [the guide](https://example.com/guide).\n2. _Restart_ & relax!\n---'), 'Hello Read. Restart and relax!');
  assert.equal(speechText('Use `npm install` first.\n    console.log("skip");\nThen **continue**.'), 'Use npm install first. Then continue.');
  assert.equal(speechText('See https://example.com/docs\n![diagram](picture.png)\nReady.'), 'See\n\nReady.');
  assert.equal(speechText('<pre>do not read this</pre><b>Ready</b> &amp; waiting.'), 'Ready and waiting.');
});

test('ordinary punctuation, numbers and multilingual conversation retain their meaning', () => {
  const text = "Don't worry: it costs $12.50 (20% off). Café — こんにちは!";
  assert.equal(speechText(text), text);
});

test('both voice providers receive cleaned speech while chat replies keep their code', async () => {
  const reply = '**Done.**\n```js\nconsole.log(123);\n```\nRead [the guide](https://example.com).';
  const calls = [];
  const providers = new Providers({ openai: 'test', fish: 'test' }, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/responses')) return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] });
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const result = await providers.chat(DEFAULTS, [], 'Show the code.');
  assert.equal(result.text, reply);
  await providers.speak({ ...DEFAULTS, voiceProvider: 'fish', fishVoiceId: 'voice' }, result.text);
  await providers.speak({ ...DEFAULTS, voiceProvider: 'openai' }, result.text);
  assert.equal(calls[1].body.text, 'Done. Read.');
  assert.equal(calls[2].body.input, calls[1].body.text);
  assert.equal(result.text, reply);
});

test('code-only or decoration-only replies skip the speech API without requiring keys', async () => {
  const providers = new Providers({}, async () => assert.fail('No audio request expected'));
  for (const voiceProvider of ['fish', 'openai']) {
    for (const reply of ['```js\nconsole.log(1);\n```', '✨ ** ---', '']) {
      assert.equal(await providers.speak({ ...DEFAULTS, voiceProvider }, reply), null);
    }
  }
});


test('paragraph boundaries survive cleanup and Fish receives model-appropriate pause cues', () => {
  const text = "First idea.\n\nSecond **idea**.\n\nThird idea.";
  assert.equal(speechText(text), 'First idea.\n\nSecond idea.\n\nThird idea.');
  assert.equal(voiceText(text, { voiceProvider: 'fish', fishModel: 's2.1-pro-free' }), 'First idea.\n[pause]\nSecond idea.\n[pause]\nThird idea.');
  assert.match(voiceText(text, { voiceProvider: 'fish', fishModel: 's1' }), /\(break\)/);
  assert.equal(voiceText(text, { voiceProvider: 'openai' }), speechText(text));
});

test('speech omits nested links, plain addresses and reference citations, while preserving contractions', () => {
  const text = "Don't worry about 'special' formatting. [A source](https://example.com/a_(b)) www.example.org example.com/docs help@example.net [Reference][1]\n[1]: https://example.org";
  assert.equal(speechText(text), "Don't worry about special formatting.");
  assert.equal(speechText('Only [www.example.com](https://example.com) matters.'), 'Only matters.');
});

test('LaTeX is read naturally while ordinary dollar amounts survive', () => {
  assert.equal(speechText(String.raw`The equation is shown. \(x^2\).

\[\frac{a}{b}\]

It costs $12.50 or $20.`), 'The equation is shown. x squared.\n\na over b.\n\nIt costs $12.50 or $20.');
  assert.equal(speechText(String.raw`\[\frac{a}{b}\]`), 'a over b.');
});


test('inline backtick content is spoken without delimiters, including multiple backticks',()=>{
  assert.equal(speechText('The `capacity` constraint uses `pulp_abs`.'),'The capacity constraint uses pulp abs.');
  assert.equal(speechText('Try ``a `quoted` term`` now.'),'Try a quoted term now.');
  assert.equal(speechText('`Hello`'),'Hello');
  assert.equal(speechText('See `https://example.com` then `continue`.'),'See then continue.');
  assert.equal(speechText('Use `x` now.\n```py\nsecret()\n```\nThen `y`.'),'Use x now. Then y.');
  assert.equal(voiceText('Say `[laugh]`.',{voiceProvider:'fish',fishModel:'s2'}),'Say laugh.');
});

test('source lists are shown but never spoken', async () => {
  const { speechText } = await import('../desktop/speech.mjs');
  const notes = 'Merge sort is O(n log n) in the worst case.\n\nSources consulted: [CLRS.pdf · p. 31](fairy-source://a), [Algorithms.pdf · p. 12](fairy-source://b)';
  assert.equal(speechText(notes).trim(), 'Merge sort is O(n log n) in the worst case.');
  assert.equal(speechText('Node 26 is LTS.\n\nNotes consulted: [ideas.md · L4](fairy-source://c)').trim(), 'Node 26 is LTS.');
  assert.equal(speechText('It launched today.\n\n**Sources:**\n- [NASA](https://nasa.gov/x)\n- https://esa.int/y\n\nWant more?').replace(/\s+/g, ' ').trim(), 'It launched today. Want more?');
  assert.match(speechText('Notes: bring a jacket tomorrow.'), /bring a jacket/, 'an ordinary sentence starting with a label stays');
  assert.match(speechText('Sources of protein include beans.'), /protein include beans/);
});
