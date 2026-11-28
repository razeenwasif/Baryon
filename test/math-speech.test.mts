import test from 'node:test';
import assert from 'node:assert/strict';
import {speechText, voiceText} from '../desktop/speech.mjs';
import {mathSpeech, loadMathSpeech} from '../desktop/math-speech.mjs';

// The engine loads on first use (efficiency audit, fix 12); these tests read maths, so load it first.
await loadMathSpeech();

test('math retains structure for powers, fractions, roots, comparisons and Greek letters', () => {
  assert.equal(speechText(String.raw`Use \(x^2 + y^3\).`), 'Use x squared plus y cubed.');
  assert.equal(speechText('$\\frac{1}{2}$'), 'one half');
  assert.match(mathSpeech(String.raw`\alpha+\beta\leq\pi`), /alpha plus beta is less than or equal to pi/);
  assert.match(mathSpeech(String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`), /numerator negative b plus or minus the square root of b squared minus 4 a c and denominator 2 a/);
  assert.match(mathSpeech(String.raw`\frac{a+b}{c+d}`), /numerator a plus b and denominator c plus d/);
  assert.match(mathSpeech(String.raw`\int_0^1 x^2\,dx`), /integral from 0 to 1/);
  assert.match(mathSpeech(String.raw`\sum_{i=1}^{n}i`), /sum from i equals 1 to n/);
  assert.equal(speechText('\\[\n    \\frac{a}{b}\n\\]'), 'a over b.');
  assert.match(speechText(String.raw`Here is \(\frac{x`), /incomplete equation/);
});
test('math keeps display paragraphs and does not speak code, links, or unsafe commands', () => {
  assert.match(voiceText(String.raw`First.\[x^2\]Next.`, {voiceProvider:'fish',fishModel:'s2-pro'}), /First\.\n\[pause\]\nx squared\.\n\[pause\]\nNext\./);
  assert.equal(speechText('```latex\n\\frac{a}{b}\n```'), '');
  assert.equal(speechText('[equation](https://example.com/$x$)'), '');
  assert.match(mathSpeech(String.raw`\notarealcommand{x}`), /can’t read reliably/);
  assert(!mathSpeech(String.raw`\href{https://example.com}{x}`).includes('https'));
});
