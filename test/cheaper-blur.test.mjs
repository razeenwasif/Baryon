// Efficiency audit, fix 11: blur only where it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');

test('a suggestion’s tooltip blurs only while it shows', () => {
  const hidden = css.match(/#suggestions button::after\{[^}]*\}/)[0];
  assert.doesNotMatch(hidden, /backdrop-filter/, 'no blur on the hidden tooltip');
  const shown = css.match(/#suggestions button:hover::after,#suggestions button:focus-visible::after\{[^}]*\}/)[0];
  assert.match(shown, /backdrop-filter:blur\(12px\)/, 'the same blur once it shows');
});

test('the mode pill keeps its glass over Aurora and drops it over a plain background', () => {
  assert.match(css, /\.mode-switch button\.selected\{[^}]*backdrop-filter:blur\(10px\) saturate\(115%\)/, 'the glass is still there');
  assert.match(css, /html:not\(\.floating\)\[data-wallpaper="velvet"\] \.mode-switch button\.selected,html:not\(\.floating\):not\(\.wallpaper\) \.mode-switch button\.selected\{-webkit-backdrop-filter:none;backdrop-filter:none\}/);
});
