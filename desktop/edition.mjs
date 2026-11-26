// Baryon Open Core edition boundary and optional Pro module resolution.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PRO_FEATURE_GROUPS = Object.freeze({
  research: Object.freeze([
    'desktop/research',
    'desktop/reproduce',
    'desktop/research-brief.mjs',
    'native/research',
    'native/bin/fairy-research',
    'scripts/build-research.mjs',
    'src/research-field.js',
    'src/research-logic.js',
    'src/research-view.css',
    'src/research-view.js',
    'src/research-viewers.css',
    'src/research-viewers.js',
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
    'src/analytics-view.js',
    'docs/analytics-migration-plan.md',
  ]),
  academy: Object.freeze([
    'desktop/academy',
    'desktop/notebook',
    'desktop/phone-notebooks.mjs',
    'native/notebook-engines',
    'native/Study.swift',
    'native/bin/fairy-study',
    'native/bin/fairy-engines',
    'scripts/build-engines.mjs',
    'src/academy',
    'src/academy-view.css',
    'src/academy-view.js',
    'src/notebook-graphic.js',
    'src/notebook-home-theme.js',
    'src/notebook-shelf.js',
    'src/notebook-view.js',
    'src/notebook.css',
    'docs/notebook-migration.md',
    'docs/phone-notebooks-plan.md',
    'docs/nocturne-courses.md',
  ]),
  studio: Object.freeze([
    'desktop/studio',
    'src/studio',
    'src/studio-view.js',
    'src/studio-view.css',
    'src/diffusion-view.js',
    'src/diffusion-view.css',
    'src/diffusion-ridge.js',
    'docs/diffusion-plan.md',
  ]),
  worlds: Object.freeze([
    'desktop/worlds',
    'src/worlds',
    'src/worlds-view.js',
    'src/worlds-view.css',
  ]),
  game: Object.freeze([
    'desktop/game',
    'src/game',
    'src/game-view.js',
    'src/game-view.css',
  ]),
});

export const PRO_EXCLUDED_PATHS = Object.freeze(
  Object.values(PRO_FEATURE_GROUPS).flat(),
);

function readPackageEdition(rootDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    if (pkg?.baryonEdition === 'core' || pkg?.baryonEdition === 'pro') {
      return pkg.baryonEdition;
    }
  } catch {}
  return '';
}

export function resolveEdition({ env = process.env, rootDir = DEFAULT_ROOT } = {}) {
  const hasResearch = existsSync(join(rootDir, 'desktop/research/service.mjs'));
  const hasReproduce = existsSync(join(rootDir, 'desktop/reproduce/paper.mjs'));
  const hasAnalytics = existsSync(join(rootDir, 'desktop/analytics/calls.mjs'));
  const hasAcademy = existsSync(join(rootDir, 'desktop/academy/calls.mjs'));
  const hasNotebooks = existsSync(join(rootDir, 'desktop/notebook/calls.mjs'));
  const hasStudio = existsSync(join(rootDir, 'desktop/studio/calls.mjs'));
  const hasWorlds = existsSync(join(rootDir, 'desktop/worlds/calls.mjs'));
  const hasGame = existsSync(join(rootDir, 'desktop/game/calls.mjs'));
  const anyProPresent = hasResearch || hasReproduce || hasAnalytics || hasAcademy || hasNotebooks || hasStudio || hasWorlds || hasGame;

  const requested = String(env?.BARYON_EDITION || '').trim().toLowerCase();
  const manifest = readPackageEdition(rootDir);

  let edition;
  if (requested === 'core' || requested === 'pro') {
    edition = requested;
  } else if (manifest) {
    edition = manifest;
  } else {
    edition = anyProPresent ? 'pro' : 'core';
  }

  const allowPro = edition === 'pro';
  const features = Object.freeze({
    research: allowPro && hasResearch,
    reproduce: allowPro && hasReproduce,
    analytics: allowPro && hasAnalytics,
    academy: allowPro && hasAcademy,
    notebooks: allowPro && hasNotebooks,
    studio: allowPro && hasStudio,
    worlds: allowPro && hasWorlds,
    game: allowPro && hasGame,
  });

  const resolvedEdition = Object.values(features).some(Boolean) ? 'pro' : 'core';
  return Object.freeze({
    edition: resolvedEdition,
    isCore: resolvedEdition === 'core',
    isPro: resolvedEdition === 'pro',
    features,
  });
}

const current = resolveEdition();
export const EDITION = current.edition;
export const IS_CORE = current.isCore;
export const IS_PRO = current.isPro;
export const FEATURES = current.features;

export const ADMIN_EMAILS = Object.freeze(['razeen.wasif66@gmail.com']);

export function isAdminEmail(email, env = process.env) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return false;
  const extra = String(env?.BARYON_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return ADMIN_EMAILS.includes(clean) || extra.includes(clean);
}

export function resolveAccess({ editionInfo = current, email = '', env = process.env } = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const isAdmin = isAdminEmail(cleanEmail, env);
  return Object.freeze({
    edition: editionInfo.edition,
    isAdmin,
    email: cleanEmail,
    plan: isAdmin ? 'admin' : editionInfo.isPro ? 'pro' : 'core',
    privileges: Object.freeze(
      isAdmin ? ['pro-all', 'admin-override', 'billing-bypass', 'edition-preview'] : [],
    ),
    features: editionInfo.features,
  });
}

export const hasFeature = name => Boolean(FEATURES[name]);

export async function optionalImport(relativePath, fromUrl = import.meta.url) {
  const target = new URL(relativePath, fromUrl);
  try {
    return await import(target.href);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
