import test from 'node:test';
import assert from 'node:assert/strict';
import { replyHTML } from '../src/reply-renderer.js';

test('paragraphs and emphasis render without showing Markdown markers', () => {
  const html = replyHTML('One **important** idea.\n\nAnother _idea_.');
  assert.match(html, /<strong>important<\/strong>/); assert.match(html, /<em>idea<\/em>/);
  assert.equal((html.match(/<p>/g) || []).length, 2); assert(!html.includes('**'));
});
test('bracket and dollar LaTeX support inline and display formulas', () => {
  for (const math of [String.raw`Inline \(x^2\).`, '$x^2$', String.raw`\[\frac{a}{b}\]`, '$$\frac{a}{b}$$', '\\[\nx^2 + y^2\n\\]']) {
    assert.match(replyHTML(math), /class="katex"/);
  }
  assert.match(replyHTML(String.raw`\[\frac{a}{b}\]`), /katex-display/);
  assert(!replyHTML('It costs $12.50 or $20.').includes('class="katex"'));
  assert(!replyHTML(String.raw`Escaped \$x\$`).includes('class="katex"'));
});
test('fenced code is highlighted and math inside code stays literal', () => {
  const html = replyHTML('```python\nprint("hello")\n```');
  assert.match(html, /language-python/); assert.match(html, /hljs-built_in/);
  const unknown = replyHTML('```unknown_language\n<script>alert(1)</script>\n```');
  assert(!unknown.includes('<script>')); assert(unknown.includes('&lt;script&gt;'));
  assert(!replyHTML('```tex\n$x$\n```').includes('class="katex"'));
  assert(!replyHTML('`\\(x\\)`').includes('class="katex"'));
});
test('untrusted HTML, links and LaTeX cannot activate scripts or load images', () => {
  const html = replyHTML('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![remote](https://example.com/track.png)\n\n[bad](javascript:alert(1)) [data](data:text/html,hello) [good](https://example.com)');
  assert(!/<(?:script|img)\b/i.test(html));
  assert(!/href="(?:javascript|data):/i.test(html)); assert.match(html, /href="https:\/\/example.com"/);
  const math = replyHTML(String.raw`\[\href{javascript:alert(1)}{click}\]`);
  assert(!/href="javascript:/i.test(math));
  assert(!replyHTML(String.raw`\[\includegraphics{https://example.com/a.png}\]`).includes('<img'));
});
test('broken or excessive math degrades safely and macros do not leak across messages', () => {
  assert.doesNotThrow(() => replyHTML(String.raw`\[\frac{\]`));
  assert.doesNotThrow(() => replyHTML(String.raw`\[\def\a{\a}\a\]`));
  const before = replyHTML(String.raw`\[\privateMacro\]`);
  replyHTML(String.raw`\[\gdef\privateMacro{private}\privateMacro\]`);
  assert.equal(replyHTML(String.raw`\[\privateMacro\]`), before);
});
