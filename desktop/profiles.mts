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

export type ProfileAvatar = 'fairy' | 'lyra' | 'stella' | 'custom';
export type ProfileAnimations = Record<string, boolean>;
export type ProfileSettingsMap = Record<string, string>;

export interface Profile {
  id: string;
  label: string;
  avatar: ProfileAvatar;
  animations: ProfileAnimations;
  settings: ProfileSettingsMap;
  savedAt: number;
}

export interface ProfileStore {
  version: number;
  migrated: boolean;
  profiles: Profile[];
}

export interface SnapshotProfileInput {
  label: unknown;
  avatar: string;
  animations?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  now?: number;
}

export interface RebrandStoreInput {
  settings: Record<string, unknown> & { name?: string; personality?: string };
  avatar: string;
  animations?: Record<string, unknown> | null;
  now?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const pick = (source: unknown, keys: readonly string[]): ProfileSettingsMap => {
  const src = isRecord(source) ? source : undefined;
  return Object.fromEntries(keys.filter(key => typeof src?.[key] === 'string').map(key => [key, src![key] as string]));
};
const animations = (value: unknown): ProfileAnimations => {
  const src = isRecord(value) ? value : undefined;
  return Object.fromEntries(PROFILE_ANIMATIONS.map(key => [key, src?.[key] !== false]));
};
const label = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
const isAvatar = (value: unknown): value is ProfileAvatar => typeof value === 'string' && PROFILE_AVATARS.includes(value);

export function cleanProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  const name = label(value.label);
  if (!name || typeof value.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.id)) return null;
  return { id: value.id, label: name, avatar: isAvatar(value.avatar) ? value.avatar : 'lyra',
    animations: animations(value.animations), settings: pick(value.settings, PROFILE_SETTINGS), savedAt: Number(value.savedAt) || 0 };
}

export function cleanStore(value: unknown): ProfileStore {
  const src = isRecord(value) ? value : undefined;
  const profiles = (Array.isArray(src?.profiles) ? src.profiles : []).map(cleanProfile).filter((p): p is Profile => p !== null).slice(0, MAX_PROFILES);
  return { version: 1, migrated: src?.migrated === true, profiles };
}

export function snapshotProfile({ label: name, avatar, animations: motion, settings, now = Date.now() }: SnapshotProfileInput): Profile {
  const clean = label(name);
  if (!clean) throw new Error('Name the profile first.');
  if (!isAvatar(avatar)) throw new Error('Choose a supported avatar for this profile.');
  return { id: randomUUID(), label: clean, avatar, animations: animations(motion), settings: pick(settings, PROFILE_SETTINGS), savedAt: now };
}

// Saving under an existing name replaces that profile but keeps its id.
export function upsertProfile(store: ProfileStore, profile: Profile): { store: ProfileStore; profile: Profile } {
  const index = store.profiles.findIndex(p => p.label.toLowerCase() === profile.label.toLowerCase());
  if (index < 0 && store.profiles.length >= MAX_PROFILES) throw new Error(`Delete a profile first; up to ${MAX_PROFILES} are kept.`);
  const saved = index < 0 ? profile : { ...profile, id: store.profiles[index].id };
  const profiles = [...store.profiles]; if (index < 0) profiles.push(saved); else profiles[index] = saved;
  return { store: { ...store, profiles }, profile: saved };
}

// Only persona settings change; cleanSettings validates them like any save.
export function profileSettings<T = Record<string, unknown>>(
  profile: Profile,
  settings: Record<string, unknown>,
  cleanSettings: (patch: ProfileSettingsMap, current: Record<string, unknown>) => T,
): T {
  return cleanSettings(pick(profile.settings, PROFILE_SETTINGS), settings);
}

// One-time rebrand: keep today's companion as a profile, then create Fairy from it.
export function rebrandStore(store: ProfileStore, { settings, avatar, animations: motion, now = Date.now() }: RebrandStoreInput): { store: ProfileStore; fairy: Profile | null } {
  if (store.migrated) return { store, fairy: null };
  let next: ProfileStore = { ...store, migrated: true };
  const current = snapshotProfile({ label: settings.name || 'Robin', avatar: isAvatar(avatar) ? avatar : 'lyra', animations: motion, settings, now });
  next = upsertProfile(next, current).store;
  // A personality that already describes Fairy is the user's own; keep it.
  const personality = /\bYou are Fairy\b/.test(settings.personality || '') ? settings.personality! : FAIRY_PERSONALITY;
  const fairy = snapshotProfile({ label: 'Fairy', avatar: 'fairy', animations: motion, settings: { ...settings, name: 'Fairy', personality }, now });
  const saved = upsertProfile(next, fairy);
  return { store: saved.store, fairy: saved.profile };
}
