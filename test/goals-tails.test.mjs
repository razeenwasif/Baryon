import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

test('processed goals-tails.mp4 asset exists and is non-empty', () => {
  const assetUrl = new URL('../assets/goals-tails.mp4', import.meta.url);
  assert.equal(existsSync(assetUrl), true, 'assets/goals-tails.mp4 should exist');
  assert.ok(statSync(assetUrl).size > 100_000, 'assets/goals-tails.mp4 should contain video data');
});

test('Goals view and stylesheet wire enlarged, dimmed video backdrop with background removal and bg-anim-off support', () => {
  const js = readFileSync(new URL('../src/goals-view.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/goals-view.css', import.meta.url), 'utf8');
  assert.match(js, /import\s+goalsTailsVideo\s+from\s+'\.\.\/assets\/goals-tails\.mp4'/);
  assert.match(js, /el\('video',\s*'gv-tails'\)/);
  assert.match(js, /tailsVideo\.muted\s*=\s*true/);
  assert.match(js, /tailsVideo\.loop\s*=\s*true/);
  assert.match(js, /tailsVideo\.play\(\)/);
  assert.match(js, /tailsVideo\.pause\(\)/);
  assert.match(js, /import\s+\{\s*bgAnimOffFor\s*\}\s+from\s+'\.\/bg-animations\.js'/);
  assert.match(js, /fairy:bg-anim-change/);
  assert.match(js, /visibilitychange/);
  assert.match(css, /#goals-view \.gv-tails\{/);
  assert.match(css, /mix-blend-mode:screen/);
  assert.match(css, /grayscale\(1\)/);
  assert.match(css, /bottom:-17%/);
  assert.match(css, /width:112%;height:112%/);
  const opacityMatch = css.match(/#goals-view\.gv-tails-on \.gv-tails\{opacity:([.\d]+)\}/);
  assert.ok(opacityMatch, 'gv-tails-on sets explicit dimmed opacity');
  assert.ok(Number(opacityMatch[1]) <= 0.15, `dimmed opacity (${opacityMatch[1]}) should be <= 0.15`);
  assert.match(css, /html\.bg-anim-off #goals-view \.gv-tails\{opacity:0\}/);
});
