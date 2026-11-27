import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, DEFAULTS } from '../desktop/core.mjs';
import { cleanStore, snapshotProfile, upsertProfile, profileSettings, rebrandStore, FAIRY_PERSONALITY, PROFILE_SETTINGS } from '../desktop/profiles.mjs';

const robin = cleanSettings({ ...DEFAULTS, name: 'Robin', backend: 'claude', fishVoiceId: 'voice-1', idleDialogueLines: 'Hello there' });
const motion = { roaming: false, cursorTracking: true, companionAnimations: true, reactions: false };

test('the one-time rebrand keeps the current companion and creates Fairy from it', () => {
  const { store, fairy } = rebrandStore(cleanStore({}), { settings: robin, avatar: 'lyra', animations: motion, now: 5 });
  assert.equal(store.migrated, true);
  assert.deepEqual(store.profiles.map(p => [p.label, p.avatar]), [['Robin', 'lyra'], ['Fairy', 'fairy']]);
  const [saved] = store.profiles;
  assert.equal(saved.settings.idleDialogueLines, 'Hello there');assert.equal(saved.settings.fishVoiceId, 'voice-1');assert.deepEqual(saved.animations, motion);
  assert.equal(fairy.settings.name, 'Fairy');assert.equal(fairy.settings.personality, FAIRY_PERSONALITY);assert.equal(fairy.settings.fishVoiceId, 'voice-1');
  assert.equal(rebrandStore(store, { settings: robin, avatar: 'lyra', animations: motion }).fairy, null, 'never runs twice');
  const own = '# Role\nYou are Fairy. A Type-III AI.';
  assert.equal(rebrandStore(cleanStore({}), { settings: { ...robin, personality: own }, avatar: 'lyra', animations: motion }).fairy.settings.personality, own, 'an existing Fairy persona is kept');
});

test('your name is optional, trimmed and bounded', () => {
  assert.equal(cleanSettings({ ...DEFAULTS }).userName, '');
  assert.equal(cleanSettings({ ...DEFAULTS, userName: '  Razeen ' }).userName, 'Razeen');
  assert.equal(cleanSettings({ ...DEFAULTS, userName: 'x'.repeat(90) }).userName.length, 60);
});

test('profiles carry persona settings only; applying keeps providers and validates values', () => {
  const profile = snapshotProfile({ label: 'Fairy', avatar: 'fairy', animations: motion, settings: { ...robin, name: 'Fairy', personality: FAIRY_PERSONALITY } });
  assert(Object.keys(profile.settings).every(key => PROFILE_SETTINGS.includes(key)));assert.equal(profile.settings.backend, undefined);
  const next = profileSettings(profile, robin, cleanSettings);
  assert.equal(next.name, 'Fairy');assert.equal(next.backend, 'claude');assert.equal(next.personality, FAIRY_PERSONALITY);
  assert.throws(() => profileSettings({ settings: { proactiveMinutes: '7' } }, robin, cleanSettings));
});

test('saving under an existing name replaces it; bad input and stored junk are rejected', () => {
  let store = cleanStore({});
  const first = upsertProfile(store, snapshotProfile({ label: 'Night', avatar: 'fairy', animations: motion, settings: robin }));store = first.store;
  const again = upsertProfile(store, snapshotProfile({ label: 'night', avatar: 'lyra', animations: motion, settings: robin }));
  assert.equal(again.store.profiles.length, 1);assert.equal(again.profile.id, first.profile.id);assert.equal(again.store.profiles[0].avatar, 'lyra');
  assert.throws(() => snapshotProfile({ label: '  ', avatar: 'fairy', settings: robin }), /Name the profile/);
  assert.throws(() => snapshotProfile({ label: 'X', avatar: 'unknown', settings: robin }), /supported avatar/);
  const cleaned = cleanStore({ migrated: true, profiles: [{ id: '../x', label: 'Bad' }, { id: 'ok-1', label: 'Good', avatar: 'nope', settings: { name: 'G', backend: 'openai' } }] });
  assert.deepEqual(cleaned.profiles.map(p => [p.id, p.avatar, p.settings]), [['ok-1', 'lyra', { name: 'G' }]]);
});
