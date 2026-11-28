// Baryon Open Core edition boundary and optional Pro module resolution.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BaryonEdition = 'core' | 'pro';
export type BaryonFeatureName =
  | 'research'
  | 'reproduce'
  | 'analytics'
  | 'academy'
  | 'notebooks'
  | 'studio'
  | 'worlds'
  | 'game';
export type BaryonPlan = 'admin' | 'pro' | 'core';
export type BaryonPrivilege = 'pro-all' | 'admin-override' | 'billing-bypass' | 'edition-preview';

export interface EditionFeatures {
  readonly research: boolean;
  readonly reproduce: boolean;
  readonly analytics: boolean;
  readonly academy: boolean;
  readonly notebooks: boolean;
  readonly studio: boolean;
  readonly worlds: boolean;
  readonly game: boolean;
}

export interface EditionInfo {
  readonly edition: BaryonEdition;
  readonly isCore: boolean;
  readonly isPro: boolean;
  readonly features: EditionFeatures;
}

export interface ResolveEditionOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  rootDir?: string;
}

export interface ResolveAccessOptions {
  editionInfo?: EditionInfo;
  email?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface AccessInfo {
  readonly edition: BaryonEdition;
  readonly isAdmin: boolean;
  readonly email: string;
  readonly plan: BaryonPlan;
  readonly privileges: readonly BaryonPrivilege[];
  readonly features: EditionFeatures;
}

function resolveEditionRoot(fromDir: string): string {
  const parent = resolve(fromDir, '..');
  return basename(fromDir) === 'desktop' && basename(parent) === 'build-ts' ? dirname(parent) : parent;
}

const DEFAULT_ROOT = resolveEditionRoot(dirname(fileURLToPath(import.meta.url)));

export const PRO_FEATURE_GROUPS = Object.freeze({
  research: Object.freeze([
    'desktop/research',
    'desktop/reproduce',
    'desktop/research-brief.mts',
    'native/research',
    'native/bin/fairy-research',
    'scripts/build-research.mts',
    'scripts/research.mts',
    'scripts/research-eval.mts',
    'src/research-field.ts',
    'src/research-logic.ts',
    'src/research-view.css',
    'src/research-view.ts',
    'src/research-viewers.css',
    'src/research-viewers.ts',
    'docs/research-claude-science-plan.md',
    'docs/research-migration.md',
    'docs/research-workbench-summary.md',
    'docs/reproduce-plan.md',
  ]),
  analytics: Object.freeze([
    'desktop/analytics',
    'native/analytics',
    'src/analytics',
    'src/analytics-view.css',
    'src/analytics-view.ts',
    'docs/analytics-migration-plan.md',
  ]),
  academy: Object.freeze([
    'desktop/academy',
    'desktop/notebook',
    'desktop/phone-notebooks.mts',
    'native/notebook-engines',
    'native/Study.swift',
    'native/bin/fairy-study',
    'native/bin/fairy-engines',
    'scripts/build-engines.mts',
    'scripts/measure-fits.mts',
    'src/academy',
    'src/academy-view.css',
    'src/academy-view.ts',
    'src/notebook-graphic.ts',
    'src/notebook-home-theme.ts',
    'src/notebook-shelf.ts',
    'src/notebook-view.ts',
    'src/notebook.css',
    'docs/notebook-migration.md',
    'docs/phone-notebooks-plan.md',
    'docs/nocturne-courses.md',
  ]),
  studio: Object.freeze([
    'desktop/studio',
    'src/studio',
    'src/studio-view.ts',
    'src/studio-view.css',
    'src/diffusion-view.ts',
    'src/diffusion-view.css',
    'src/diffusion-ridge.ts',
    'docs/diffusion-plan.md',
  ]),
  worlds: Object.freeze([
    'desktop/worlds',
    'src/worlds',
    'src/worlds-view.ts',
    'src/worlds-view.css',
  ]),
  game: Object.freeze([
    'desktop/game',
    'desktop/pro-admin.json',
    'src/game',
    'src/game-view.ts',
    'src/game-view.css',
  ]),
} as const);

export const PRO_EXCLUDED_PATHS: readonly string[] = Object.freeze(
  Object.values(PRO_FEATURE_GROUPS).flat(),
);

function readPackageEdition(rootDir: string): BaryonEdition | '' {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { baryonEdition?: unknown };
    if (pkg?.baryonEdition === 'core' || pkg?.baryonEdition === 'pro') {
      return pkg.baryonEdition;
    }
  } catch {}
  return '';
}

export function resolveEdition({ env = process.env, rootDir = DEFAULT_ROOT }: ResolveEditionOptions = {}): EditionInfo {
  const hasPro = (rel: string): boolean => existsSync(join(rootDir, rel)) || existsSync(join(rootDir, rel.replace(/\.mjs$/, '.mts')));
  const hasResearch = hasPro('desktop/research/service.mjs');
  const hasReproduce = hasPro('desktop/reproduce/paper.mjs');
  const hasAnalytics = hasPro('desktop/analytics/calls.mjs');
  const hasAcademy = hasPro('desktop/academy/calls.mjs');
  const hasNotebooks = hasPro('desktop/notebook/calls.mjs');
  const hasStudio = hasPro('desktop/studio/calls.mjs');
  const hasWorlds = hasPro('desktop/worlds/calls.mjs');
  const hasGame = hasPro('desktop/game/calls.mjs');
  const anyProPresent = hasResearch || hasReproduce || hasAnalytics || hasAcademy || hasNotebooks || hasStudio || hasWorlds || hasGame;

  const requested = String(env?.BARYON_EDITION || '').trim().toLowerCase();
  const manifest = readPackageEdition(rootDir);

  let edition: BaryonEdition;
  if (requested === 'core' || requested === 'pro') {
    edition = requested;
  } else if (manifest) {
    edition = manifest;
  } else {
    edition = anyProPresent ? 'pro' : 'core';
  }

  const allowPro = edition === 'pro';
  const features: EditionFeatures = Object.freeze({
    research: allowPro && hasResearch,
    reproduce: allowPro && hasReproduce,
    analytics: allowPro && hasAnalytics,
    academy: allowPro && hasAcademy,
    notebooks: allowPro && hasNotebooks,
    studio: allowPro && hasStudio,
    worlds: allowPro && hasWorlds,
    game: allowPro && hasGame,
  });

  const resolvedEdition: BaryonEdition = Object.values(features).some(Boolean) ? 'pro' : 'core';
  return Object.freeze({
    edition: resolvedEdition,
    isCore: resolvedEdition === 'core',
    isPro: resolvedEdition === 'pro',
    features,
  });
}

const current: EditionInfo = resolveEdition();
export const EDITION: BaryonEdition = current.edition;
export const IS_CORE: boolean = current.isCore;
export const IS_PRO: boolean = current.isPro;
export const FEATURES: EditionFeatures = current.features;

export const ADMIN_EMAILS: readonly string[] = Object.freeze([]);

function readProAdminHashes(rootDir = DEFAULT_ROOT): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, 'desktop/pro-admin.json'), 'utf8')) as { hashes?: unknown };
    if (Array.isArray(raw?.hashes)) {
      return raw.hashes.map(h => String(h || '').trim().toLowerCase()).filter(Boolean);
    }
  } catch {}
  return [];
}

export function isAdminEmail(email: string | undefined, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env, rootDir = DEFAULT_ROOT): boolean {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return false;
  const extra = String(env?.BARYON_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (ADMIN_EMAILS.includes(clean) || extra.includes(clean)) return true;
  const hash = createHash('sha256').update(clean).digest('hex');
  return readProAdminHashes(rootDir).includes(hash);
}

export function resolveAccess({ editionInfo = current, email = '', env = process.env }: ResolveAccessOptions = {}): AccessInfo {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const isAdmin = isAdminEmail(cleanEmail, env);
  const plan: BaryonPlan = isAdmin ? 'admin' : editionInfo.isPro ? 'pro' : 'core';
  const privileges: readonly BaryonPrivilege[] = Object.freeze(
    isAdmin ? (['pro-all', 'admin-override', 'billing-bypass', 'edition-preview'] as const) : ([] as const),
  );
  return Object.freeze({
    edition: editionInfo.edition,
    isAdmin,
    email: cleanEmail,
    plan,
    privileges,
    features: editionInfo.features,
  });
}

export const hasFeature = (name: BaryonFeatureName | string): boolean =>
  Boolean((FEATURES as unknown as Record<string, boolean | undefined>)[name]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function optionalImport<T = any>(relativePath: string, fromUrl: string | URL = import.meta.url): Promise<T | null> {
  const target = new URL(relativePath, fromUrl);
  try {
    return (await import(target.href)) as T;
  } catch (error: unknown) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
