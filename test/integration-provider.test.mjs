import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleTaskProvider } from '../desktop/integration-provider.mjs';

const stub = name => ({ name });

test('googleTaskProvider keeps existing behavior when connected map is omitted', () => {
  const picked = googleTaskProvider({
    settings: { integrationProvider: 'claude', integrationClaudeModel: 'claude-opus-5-5', desktopReasoning: 'high' },
    provider: stub('openai'),
    codex: stub('codex'),
    claude: stub('claude'),
    antigravity: stub('antigravity'),
  });
  assert.equal(picked.provider.name, 'claude');
  assert.equal(picked.settings.backend, 'claude');
  assert.equal(picked.fallbackFrom, undefined);
});

test('googleTaskProvider falls back to antigravity then codex when claude is disconnected', () => {
  const agy = googleTaskProvider({
    settings: { integrationProvider: 'claude', integrationClaudeModel: 'claude-opus-5-5', desktopAntigravityModel: 'gemini-4-neon-medium' },
    provider: stub('openai'),
    codex: stub('codex'),
    claude: stub('claude'),
    antigravity: stub('antigravity'),
    connected: { claude: false, antigravity: true, codex: true, openai: false },
  });
  assert.equal(agy.provider.name, 'antigravity');
  assert.equal(agy.settings.backend, 'antigravity');
  assert.equal(agy.fallbackFrom, 'claude');

  const cdx = googleTaskProvider({
    settings: { integrationProvider: 'claude', desktopModel: 'gpt-6-astra' },
    provider: stub('openai'),
    codex: stub('codex'),
    claude: stub('claude'),
    antigravity: stub('antigravity'),
    connected: { claude: false, antigravity: false, codex: true, openai: false },
  });
  assert.equal(cdx.provider.name, 'codex');
  assert.equal(cdx.settings.backend, 'codex');
  assert.equal(cdx.fallbackFrom, 'claude');
});

test('googleTaskProvider honors preferred provider when connected', () => {
  const picked = googleTaskProvider({
    settings: { integrationProvider: 'claude', integrationClaudeModel: 'claude-opus-5-5' },
    provider: stub('openai'),
    codex: stub('codex'),
    claude: stub('claude'),
    antigravity: stub('antigravity'),
    connected: { claude: true, antigravity: true, codex: true, openai: false },
  });
  assert.equal(picked.provider.name, 'claude');
  assert.equal(picked.settings.backend, 'claude');
  assert.equal(picked.fallbackFrom, undefined);
});
