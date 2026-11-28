import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SETUP_STORAGE_KEY,
  SETUP_STEPS,
  SETUP_FOCUS_OPTIONS,
  SETUP_WORKSPACES,
  SETUP_INTEGRATIONS,
  SETUP_SHORTCUTS,
  SETUP_STEP_MOODS,
  WALLPAPER_MOODS,
  tailoredCaptionForFocus,
  computeSetupReadiness,
  shouldAutoOpenSetup,
  formatStepProgress,
} from '../src/setup-wizard-logic.js';

test('SETUP_STEPS defines 9 ordered unique onboarding steps with WebGL moods and catalog data', () => {
  assert.equal(SETUP_STORAGE_KEY, 'baryon-setup-v1');
  assert.equal(SETUP_STEPS.length, 9);
  const ids = new Set(SETUP_STEPS.map(s => s.id));
  assert.equal(ids.size, 9);
  assert.deepEqual(
    SETUP_STEPS.map(s => s.id),
    ['welcome', 'focus', 'providers', 'integrations', 'workspaces', 'senses', 'appearance', 'ecosystem', 'ready'],
  );
  for (const id of ids) {
    const mood = SETUP_STEP_MOODS[id];
    assert.ok(mood && mood.a.length === 3 && mood.b.length === 3 && mood.c.length === 3, `missing WebGL mood for step ${id}`);
  }
  assert.equal(SETUP_FOCUS_OPTIONS.length, 6);
  assert.ok(WALLPAPER_MOODS.aurora && WALLPAPER_MOODS.velvet && WALLPAPER_MOODS.none);
  assert.ok(SETUP_WORKSPACES.length >= 10);
  assert.ok(SETUP_INTEGRATIONS.length >= 4);
  assert.ok(SETUP_SHORTCUTS.length >= 6);
});

test('tailoredCaptionForFocus adapts to empty, single, dual, and multi-select choices', () => {
  assert.match(tailoredCaptionForFocus([]), /adapts seamlessly/);
  assert.match(tailoredCaptionForFocus(['analytics']), /AutoML|Resolve|3D embeddings/);
  assert.match(tailoredCaptionForFocus(['engineering', 'research']), /Software Engineering \+ Science & Research/);
  assert.match(tailoredCaptionForFocus(['engineering', 'research', 'study']), /3 focus areas/);
});

test('computeSetupReadiness accurately evaluates empty, partial, and fully configured setups', () => {
  const empty = computeSetupReadiness({});
  assert.equal(empty.readyCount, 0);
  assert.equal(empty.totalCount, 5);
  assert.ok(empty.items.every(item => item.ready === false));

  const partial = computeSetupReadiness({
    claude: { connected: true, plan: 'max' } as any,
    settings: { voiceProvider: 'fish', workFolder: '/Users/test/Github/App' },
  });
  assert.equal(partial.readyCount, 2);
  assert.equal(partial.items.find(i => i.id === 'provider')?.ready, true);
  assert.equal(partial.items.find(i => i.id === 'workFolder')?.ready, true);
  assert.equal(partial.items.find(i => i.id === 'voice')?.ready, false);

  const full = computeSetupReadiness({
    claude: { connected: true, plan: 'max' } as any,
    antigravity: { connected: true, models: ['gemini-4-neon-medium'] },
    googleAccount: { connected: true, email: 'user@gmail.com' },
    hasFishKey: true,
    phoneLink: { enabled: true, phones: [{ id: 'p1' }] },
    push: { configured: true },
    checkIns: { morningBrief: true },
    settings: { voiceProvider: 'fish', voiceVolume: '90', workFolder: '/Users/test/Github/App' },
  });
  assert.equal(full.readyCount, 5);
  assert.ok(full.items.every(item => item.ready === true));
});

test('shouldAutoOpenSetup only opens for uncompleted non-floating first-run states', () => {
  assert.equal(shouldAutoOpenSetup({ completed: false, hasSessions: false, conversationReady: false, floating: false }), true);
  assert.equal(shouldAutoOpenSetup({ completed: false, hasSessions: true, conversationReady: false, floating: false }), true);
  assert.equal(shouldAutoOpenSetup({ completed: false, hasSessions: false, conversationReady: true, floating: false }), true);
  assert.equal(shouldAutoOpenSetup({ completed: false, hasSessions: true, conversationReady: true, floating: false }), false);
  assert.equal(shouldAutoOpenSetup({ completed: true, hasSessions: false, conversationReady: false, floating: false }), false);
  assert.equal(shouldAutoOpenSetup({ completed: false, hasSessions: false, conversationReady: false, floating: true }), false);
});

test('formatStepProgress clamps step bounds and reports first/last flags', () => {
  assert.deepEqual(formatStepProgress(-2, 9), { index: 0, stepNumber: 1, total: 9, percent: 11, isFirst: true, isLast: false });
  assert.deepEqual(formatStepProgress(4, 9), { index: 4, stepNumber: 5, total: 9, percent: 56, isFirst: false, isLast: false });
  assert.deepEqual(formatStepProgress(99, 9), { index: 8, stepNumber: 9, total: 9, percent: 100, isFirst: false, isLast: true });
});

test('full-window #baryon-onboarding and WebGL cool-tone shader wire cleanly into app.js', () => {
  const appJs = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const wizardJs = readFileSync(new URL('../src/setup-wizard.ts', import.meta.url), 'utf8');
  const wizardCss = readFileSync(new URL('../src/setup-wizard.css', import.meta.url), 'utf8');
  const backdropJs = readFileSync(new URL('../src/setup-backdrop.ts', import.meta.url), 'utf8');
  const logicJs = readFileSync(new URL('../src/setup-wizard-logic.ts', import.meta.url), 'utf8');

  assert.match(appJs, /import\('\.\/setup-wizard\.js'\)/);
  assert.match(appJs, /name:\s*'setup'/);
  assert.match(appJs, /#open-setup-wizard/);
  assert.match(wizardCss, /dialog#baryon-onboarding/);
  assert.match(wizardCss, /width:100vw;\s*height:100vh;/);
  assert.match(backdropJs, /mountSetupBackdrop/);
  assert.match(backdropJs, /gl_FragColor/);

  for (const term of ['Baryon', 'Analytics', 'Boards', 'Goals', 'Neutrino', 'Google Account', 'Stratus', 'fairy --headless', 'fairy-mcp']) {
    assert.ok(wizardJs.includes(term) || logicJs.includes(term), `wizard should cover "${term}"`);
  }
});
