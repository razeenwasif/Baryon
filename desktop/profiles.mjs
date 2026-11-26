import { randomUUID } from 'node:crypto';
import { DEFAULTS } from '../src/defaults.js';

// A profile is a companion persona: who it is, how it sounds and moves.
// Providers, keys, models, folders and integrations stay shared across profiles.
export const PROFILE_SETTINGS = ['name', 'personality', 'voiceProvider', 'voice', 'speechModel', 'fishVoiceId', 'fishModel',
  'idleDialogueMode', 'idleDialogueLines', 'conversationInterests', 'proactiveMode', 'proactiveMinutes', 'vocalMode', 'vocalMinutes', 'pixelEffects'];
export const PROFILE_ANIMATIONS = ['roaming', 'cursorTracking', 'companionAnimations', 'reactions'];
export const PROFILE_AVATARS = ['fairy', 'lyra', 'stella', 'custom'];
export const FAIRY_PERSONALITY = DEFAULTS.personality;
const MAX_PROFILES = 20;

const pick = (source, keys) => Object.fromEntries(keys.filter(key => typeof source?.[key] === 'string').map(key => [key, source[key]]));
const animations = value => Object.fromEntries(PROFILE_ANIMATIONS.map(key => [key, value?.[key] !== false]));
const label = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

export function cleanProfile(value) {
  const name = label(value?.label);
  if (!name || typeof value?.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.id)) return null;
  return { id: value.id, label: name, avatar: PROFILE_AVATARS.includes(value.avatar) ? value.avatar : 'lyra',
    animations: animations(value.animations), settings: pick(value.settings, PROFILE_SETTINGS), savedAt: Number(value.savedAt) || 0 };
}

export function cleanStore(value) {
  const profiles = (Array.isArray(value?.profiles) ? value.profiles : []).map(cleanProfile).filter(Boolean).slice(0, MAX_PROFILES);
  return { version: 1, migrated: value?.migrated === true, profiles };
}

export function snapshotProfile({ label: name, avatar, animations: motion, settings, now = Date.now() }) {
  const clean = label(name);
  if (!clean) throw new Error('Name the profile first.');
  if (!PROFILE_AVATARS.includes(avatar)) throw new Error('Choose a supported avatar for this profile.');
  return { id: randomUUID(), label: clean, avatar, animations: animations(motion), settings: pick(settings, PROFILE_SETTINGS), savedAt: now };
}

// Saving under an existing name replaces that profile but keeps its id.
export function upsertProfile(store, profile) {
  const index = store.profiles.findIndex(p => p.label.toLowerCase() === profile.label.toLowerCase());
  if (index < 0 && store.profiles.length >= MAX_PROFILES) throw new Error(`Delete a profile first; up to ${MAX_PROFILES} are kept.`);
  const saved = index < 0 ? profile : { ...profile, id: store.profiles[index].id };
  const profiles = [...store.profiles]; if (index < 0) profiles.push(saved); else profiles[index] = saved;
  return { store: { ...store, profiles }, profile: saved };
}

// Only persona settings change; cleanSettings validates them like any save.
export const profileSettings = (profile, settings, cleanSettings) => cleanSettings(pick(profile.settings, PROFILE_SETTINGS), settings);

// One-time rebrand: keep today's companion as a profile, then create Fairy from it.
export function rebrandStore(store, { settings, avatar, animations: motion, now = Date.now() }) {
  if (store.migrated) return { store, fairy: null };
  let next = { ...store, migrated: true };
  const current = snapshotProfile({ label: settings.name || 'Robin', avatar: PROFILE_AVATARS.includes(avatar) ? avatar : 'lyra', animations: motion, settings, now });
  next = upsertProfile(next, current).store;
  // A personality that already describes Fairy is the user's own; keep it.
  const personality = /\bYou are Fairy\b/.test(settings.personality || '') ? settings.personality : FAIRY_PERSONALITY;
  const fairy = snapshotProfile({ label: 'Fairy', avatar: 'fairy', animations: motion, settings: { ...settings, name: 'Fairy', personality }, now });
  const saved = upsertProfile(next, fairy);
  return { store: saved.store, fairy: saved.profile };
}
