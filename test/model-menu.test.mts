import test from 'node:test';
import assert from 'node:assert/strict';
import { currentModel, modelChange, modelGroups, modelLabel } from '../src/model-menu.js';
import { DEFAULTS, cleanSettings } from '../desktop/core.mjs';

const everything = { claude: true, gemini: true, codex: true, deepseek: true };
const lists = { gemini: [{ id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' }], codex: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }], deepseek: [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }] };

test('a chat choice changes the chat model and leaves work sessions alone', () => {
  const start = cleanSettings({ backend: 'antigravity', antigravityModel: 'gemini-4-argon-medium', model: 'gemini-4-argon-medium' });
  for (const [provider, model, backend] of [['claude', 'claude-sonnet-5-5', 'claude'], ['gemini', 'gemini-3.8-flash-low', 'antigravity'], ['codex', 'gpt-5.6-terra', 'codex'], ['deepseek', 'deepseek-v4-pro', 'deepseek']] as const) {
    const next = cleanSettings(modelChange({ provider, model }), start);
    assert.equal(next.backend, backend);
    assert.deepEqual(currentModel(next), { provider, model });
    assert.equal(next.workProvider, start.workProvider);
    assert.equal(next.workClaudeModel, start.workClaudeModel);
  }
});
test('a work choice changes only work sessions, and each provider keeps its own', () => {
  const start = cleanSettings({ backend: 'deepseek', model: 'deepseek-flash', desktopModel: 'gpt-6.1-sol', antigravityModel: 'gemini-4-argon-medium' });
  for (const [provider, model, workProvider] of [['claude', 'claude-haiku-5-5', 'claude'], ['gemini', 'gemini-3.8-flash-low', 'antigravity'], ['codex', 'gpt-5.6-terra', 'codex']] as const) {
    const next = cleanSettings(modelChange({ work: true, provider, model }), start);
    assert.equal(next.workProvider, workProvider);
    assert.deepEqual(currentModel(next, true), { provider, model });
    assert.deepEqual(currentModel(next), { provider: 'deepseek', model: 'deepseek-flash' });
    assert.equal(next.desktopModel, 'gpt-6.1-sol');
    assert.equal(next.antigravityModel, 'gemini-4-argon-medium');
  }
  assert.throws(() => modelChange({ work: true, provider: 'deepseek', model: 'deepseek-flash' }), /Work sessions/);
});
test('work sessions fall back to the older shared models until one is chosen', () => {
  assert.deepEqual(currentModel({ ...DEFAULTS, workProvider: 'antigravity', antigravityModel: 'gemini-4-argon-medium' }, true), { provider: 'gemini', model: 'gemini-4-argon-medium' });
  assert.deepEqual(currentModel({ ...DEFAULTS, workProvider: 'codex', desktopModel: 'gpt-6.1-sol' }, true), { provider: 'codex', model: 'gpt-6.1-sol' });
});
test('bad choices are refused', () => {
  assert.throws(() => modelChange({ provider: 'claude' } as any), /Choose a model/);
  assert.throws(() => modelChange({ provider: 'claude', model: 7 } as any), /Choose a model/);
  assert.throws(() => modelChange({ provider: 'openai', model: 'gpt' } as any), /Choose Claude/);
  assert.throws(() => cleanSettings(modelChange({ provider: 'claude', model: 'not a model' })), /Claude model/);
});
test('every provider is offered, with a saved model kept even if it is no longer listed', () => {
  const settings = { ...DEFAULTS, backend: 'codex' as const, model: 'gpt-6-astra' };
  const groups = modelGroups({ settings, lists, connected: everything });
  assert.deepEqual(groups.map(group => group.provider), ['claude', 'gemini', 'codex', 'deepseek']);
  assert.deepEqual(groups[2].models.map(model => model.id), ['gpt-5.6-terra', 'gpt-6-astra']);
  assert(groups.every(group => !group.note));
  assert.equal(modelLabel(settings, false, groups), 'gpt-6-astra');
  assert.equal(modelLabel({ ...settings, model: 'gpt-5.6-terra' }, false, modelGroups({ settings: { ...settings, model: 'gpt-5.6-terra' }, lists, connected: everything })), 'GPT-5.6-Terra');
});
test('a provider that cannot be used says why', () => {
  const groups = modelGroups({ settings: DEFAULTS, lists: {}, connected: {} });
  assert.deepEqual(groups.map(group => group.note), [{ text: 'Not signed in', fix: true }, { text: 'Not signed in', fix: true }, { text: 'Not signed in', fix: true }, { text: 'Needs your API key', fix: true }]);
  assert.equal(modelGroups({ settings: DEFAULTS, work: true, lists, connected: everything })[3].note!.text, 'For chats only');
  assert.equal(modelGroups({ settings: DEFAULTS, lists: {}, connected: everything })[2].note!.text, 'Loading…');
  assert.equal(modelGroups({ settings: DEFAULTS, lists: { codex: null } as any, connected: everything })[2].note!.text, 'Couldn’t load its models');
  assert.equal(modelGroups({ settings: DEFAULTS, lists: {}, connected: everything })[3].models[0].id, 'deepseek-flash');
});

const agyList = ['gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh', 'gemini-3.8-flash-low', 'gemini-3.8-flash-high', 'gemini-pro-orchestrator-g1-pro']
  .map(id => ({ id, name: id === 'gemini-pro-orchestrator-g1-pro' ? 'Orchestrator (Argon)' : id }));

test('each Gemini model is listed once, with its efforts, and a choice keeps your effort where it can', async () => {
  const { collapseLevels, variantFor, currentEffort, EFFORT_NAMES } = await import('../src/model-menu.js');
  const models = collapseLevels(agyList);
  assert.deepEqual(models.map(model => [model.id, model.name]), [['gemini-4-argon', 'Gemini 4 Argon'], ['gemini-4-hydrogen', 'Gemini 4 Hydrogen'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-pro-orchestrator-g1-pro', 'Orchestrator (Argon)']]);
  const [argon, hydrogen, flash, orchestrator] = models;
  assert.equal(variantFor(argon, 'medium'), 'gemini-4-argon-medium');
  assert.equal(variantFor(argon, 'max'), 'gemini-4-argon-high', 'the nearest it has');
  assert.equal(variantFor(hydrogen, 'max'), 'gemini-4-hydrogen-xhigh');
  assert.equal(variantFor(flash, 'medium'), 'gemini-3.8-flash-high', 'a tie goes up');
  assert.equal(variantFor(orchestrator, 'low'), 'gemini-pro-orchestrator-g1-pro', 'one effort only');
  // The menu's Gemini section and its label.
  const settings = { ...DEFAULTS, backend: 'antigravity' as const, antigravityModel: 'gemini-4-hydrogen-medium', autoModel: 'off' as const };
  const groups = modelGroups({ settings, lists: { gemini: agyList }, connected: everything });
  assert.equal(groups[1].models.length, 4);
  assert.equal(modelLabel(settings, false, groups), 'Gemini 4 Hydrogen');
  assert.deepEqual(currentEffort(settings, false, groups), { provider: 'gemini', effort: 'medium', choices: ['low', 'medium', 'high', 'xhigh'] });
  assert.equal(EFFORT_NAMES.xhigh, 'Extra');
  // A saved Gemini model no longer listed is still shown once.
  const gone = modelGroups({ settings: { ...settings, antigravityModel: 'gemini-9-neon-high' }, lists: { gemini: agyList }, connected: everything });
  assert.equal(gone[1].models.at(-1)!.id, 'gemini-9-neon');
});

test('effort is its own choice: Claude’s and Codex’s a setting, Gemini’s a model, and a chat on Claude can keep Claude Code’s default', async () => {
  const { currentEffort } = await import('../src/model-menu.js');
  const claudeChat = { ...DEFAULTS, backend: 'claude' as const, claudeModel: 'claude-opus-5-5' };
  assert.deepEqual(currentEffort(claudeChat), { provider: 'claude', effort: '', choices: ['', 'low', 'medium', 'high', 'xhigh', 'max'] });
  assert.deepEqual(modelChange({ provider: 'claude', effort: 'xhigh' }), { claudeEffort: 'xhigh' });
  assert.equal(cleanSettings(modelChange({ provider: 'claude', effort: 'max' }), claudeChat).claudeEffort, 'max');
  assert.throws(() => cleanSettings({ claudeEffort: 'ludicrous' } as any), /effort for Claude chats/);
  assert.deepEqual(currentEffort({ ...DEFAULTS, workProvider: 'claude', workEffort: 'xhigh' }, true).effort, 'xhigh');
  assert.deepEqual(modelChange({ work: true, provider: 'claude', effort: 'medium' }), { workEffort: 'medium' });
  assert.deepEqual(currentEffort({ ...DEFAULTS, backend: 'codex', reasoning: 'medium' }), { provider: 'codex', effort: 'medium', choices: ['low', 'medium', 'high'] });
  assert.deepEqual(modelChange({ provider: 'codex', effort: 'high' }), { reasoning: 'high' });
  // Choosing an effort leaves the orchestrator as it was; choosing a model turns it off.
  assert.equal('autoModel' in modelChange({ provider: 'claude', effort: 'low' }), false);
});

test('choosing a provider keeps the Orchestrator on where it can, or brings back the model you had there', async () => {
  const { providerChoice } = await import('../src/model-menu.js');
  const groups = modelGroups({ settings: DEFAULTS, lists: { gemini: agyList, codex: [{ id: 'gpt-6-terra', name: 'Terra' }] }, connected: everything });
  const orchestrated = { ...DEFAULTS, backend: 'claude' as const, autoModel: 'on' as const };
  assert.deepEqual(providerChoice(orchestrated, false, 'gemini', groups), { work: false, provider: 'gemini', auto: true });
  assert.deepEqual(providerChoice(orchestrated, false, 'codex', groups), { work: false, provider: 'codex', auto: true, model: 'gpt-6-terra' });
  // DeepSeek has no Orchestrator, so it's a model by hand.
  assert.deepEqual(providerChoice(orchestrated, false, 'deepseek', groups), { work: false, provider: 'deepseek', model: 'deepseek-flash' });
  const byHand = { ...DEFAULTS, backend: 'claude' as const, autoModel: 'off' as const, antigravityModel: 'gemini-4-hydrogen-low' };
  assert.deepEqual(providerChoice(byHand, false, 'gemini', groups), { work: false, provider: 'gemini', model: 'gemini-4-hydrogen-low' }, 'the Gemini model you had');
  assert.deepEqual(providerChoice({ ...DEFAULTS, workAutoModel: 'off', workClaudeModel: 'claude-sonnet-5-5' }, true, 'claude', groups), { work: true, provider: 'claude', model: 'claude-sonnet-5-5' });
  assert.equal(cleanSettings(modelChange(providerChoice(orchestrated, true, 'gemini', groups))).workProvider, 'antigravity');
});

test('a work session provider override scopes UI state to that session without altering global settings', async () => {
  const { readFileSync } = await import('node:fs');
  const { currentEffort, autoState } = await import('../src/model-menu.js');
  const settings = {
    ...DEFAULTS,
    workProvider: 'claude' as const,
    workClaudeModel: 'claude-sonnet-5-5',
    workGeminiModel: 'gemini-4-argon-high',
    workCodexModel: 'gpt-5.6-terra',
    workAutoModel: 'off' as const,
  };
  const groups = modelGroups({ settings, work: true, lists: { gemini: agyList, codex: lists.codex }, connected: everything, sessionProvider: 'gemini' });
  assert.deepEqual(currentModel(settings, true), { provider: 'claude', model: 'claude-sonnet-5-5' });
  assert.deepEqual(currentModel(settings, true, 'gemini'), { provider: 'gemini', model: 'gemini-4-argon-high' });
  assert.deepEqual(currentModel(settings, true, 'codex'), { provider: 'codex', model: 'gpt-5.6-terra' });
  assert.deepEqual(currentEffort(settings, true, groups, 'gemini'), { provider: 'gemini', effort: 'high', choices: ['low', 'medium', 'high'] });
  assert.equal(autoState(settings, true, true, 'gemini').provider, 'gemini');
  assert.equal(modelLabel(settings, true, groups, { sessionProvider: 'gemini' }), 'Gemini 4 Argon');

  const mainSrc = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(mainSrc, /const saved = sessionScoped \? \{ \.\.\.next, workProvider: settings\.workProvider \} : next;/);
  assert.match(mainSrc, /await sessions\.setWork\(\{ provider: choice\.provider \}\)/);
  assert.match(mainSrc, /sessionProvider \? backendOfProvider\(sessionProvider\) : undefined/);
});
