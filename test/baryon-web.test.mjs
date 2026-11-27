import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  createEmptyState,
  createThread,
  appendNode,
  getActivePath,
  selectBranchNode,
  countThreadBranches,
  chooseFanoutWinner,
} from '../web/src/store.js';
import { renderMarkdown, extractArtifacts, buildArtifactSrcdoc } from '../web/src/markdown.js';

test('Baryon Web DAG store supports branching timelines, branch counting, and /fanout winners', () => {
  const state = createEmptyState();
  const thread = createThread(state, { title: 'DAG Test' });
  const u1 = appendNode(thread, { role: 'user', content: 'First prompt' });
  const a1 = appendNode(thread, {
    parentId: u1.id,
    role: 'assistant',
    model: 'gemini-neon',
    candidates: [
      { model: 'gemini-neon', content: 'Alpha answer', meta: { elapsedMs: 120, tokPerSec: 80 } },
      { model: 'claude-fable', content: 'Beta answer', meta: { elapsedMs: 180, tokPerSec: 65 } },
    ],
  });
  assert.equal(chooseFanoutWinner(a1, 1), true);
  assert.equal(a1.content, 'Beta answer');
  assert.equal(a1.model, 'claude-fable');

  // Fork a second branch from u1
  const a1Alt = appendNode(thread, { parentId: u1.id, role: 'assistant', model: 'gpt-astra', content: 'Alternate branch' });
  assert.equal(countThreadBranches(thread), 1);
  assert.equal(getActivePath(thread).map(n => n.content).at(-1), 'Alternate branch');

  // Switch timeline back to original winner branch
  selectBranchNode(thread, a1.id);
  assert.equal(getActivePath(thread).map(n => n.content).at(-1), 'Beta answer');
  assert.notEqual(a1.id, a1Alt.id);
});

test('Baryon Web markdown safely renders HTML/SVG artifacts and escapes XSS tags', () => {
  const md = 'Hello <script>alert(1)</script>\n\n```html\n<div>Hi Widget</div>\n```\n\n```svg\n<svg><circle r="5"/></svg>\n```';
  const html = renderMarkdown(md, { messageId: 'm_1' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /data-run-artifact="0"/);
  assert.match(html, /data-run-artifact="1"/);

  const arts = extractArtifacts(md);
  assert.equal(arts.length, 2);
  assert.match(buildArtifactSrcdoc(arts[1]), /<!doctype html>.*<svg>/s);
});

test('Baryon Web Studio at /chat bundles Stratus palette, mobile breakpoints, and manifest start_url', () => {
  const css = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');
  const chatHtml = readFileSync(new URL('../web/chat/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../web/public/manifest.webmanifest', import.meta.url), 'utf8'));

  assert.match(css, /--ground:#050507/);
  assert.match(css, /100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /max-width:900px/);
  assert.match(css, /max-width:640px/);
  assert.match(chatHtml, /viewport-fit=cover/);
  assert.match(chatHtml, /interactive-widget=resizes-content/);
  assert.match(chatHtml, /src="\.\.\/src\/app\.js"/);
  assert.equal(manifest.background_color, '#050507');
  assert.equal(manifest.start_url, '/chat');
});

test('Baryon Landing Page, releases.json, and Firebase Hosting config serve DMG installer and /chat routes', () => {
  const landingHtml = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const landingCss = readFileSync(new URL('../web/src/landing.css', import.meta.url), 'utf8');
  const viteCfg = readFileSync(new URL('../web/vite.config.js', import.meta.url), 'utf8');
  const fb = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  const rel = JSON.parse(readFileSync(new URL('../web/public/releases.json', import.meta.url), 'utf8'));

  assert.match(landingHtml, /id="baryon-aurora"/);
  assert.match(landingHtml, /https:\/\/github\.com\/razeenwasif\/baryon-releases\/releases\/download\/v0\.1\.0\/Baryon-0\.1\.0-arm64\.dmg/);
  assert.match(landingHtml, /href="\/chat"/);
  assert.match(landingHtml, /xattr -dr com\.apple\.quarantine/);
  assert.match(landingCss, /--ground:\s*#050507/);
  assert.match(landingCss, /prefers-reduced-motion/);
  assert.match(viteCfg, /chat\/index\.html/);

  assert.equal(fb.hosting.site, 'baryon');
  assert.equal(fb.hosting.public, 'web/dist');
  assert.ok(fb.hosting.rewrites.some(r => r.source === '/chat' && r.destination === '/chat/index.html'));
  assert.ok(fb.hosting.headers.some(h => h.source === '/releases.json'));

  assert.equal(rel.product, 'Baryon');
  assert.equal(rel.macos.arm64.filename, 'Baryon-0.1.0-arm64.dmg');
  assert.equal(rel.macos.arm64.url, 'https://github.com/razeenwasif/baryon-releases/releases/download/v0.1.0/Baryon-0.1.0-arm64.dmg');
  assert.match(rel.macos.arm64.sha256, /^[a-f0-9]{64}$/);
  assert.ok(rel.macos.arm64.bytes > 100_000_000);

  const landingJs = readFileSync(new URL('../web/src/landing.js', import.meta.url), 'utf8');
  const expectedShots = [
    'baryon-home.webp',
    'baryon-work.webp',
    'baryon-research.webp',
    'baryon-analytics.webp',
    'baryon-notebooks.webp',
    'baryon-plugins.webp',
    'baryon-usage.webp',
  ];
  for (const file of expectedShots) {
    assert.ok(existsSync(new URL(`../web/public/media/${file}`, import.meta.url)), `Missing screenshot ${file}`);
    assert.match(landingJs, new RegExp(file));
    assert.match(landingHtml, new RegExp(file));
  }
  assert.match(landingHtml, /id="bl-lightbox"/);
});
