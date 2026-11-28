// Node module resolve hooks mapping uncompiled source paths to build-ts/ outputs during incremental TS migration.
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative as relativePath, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function realRoot(p) {
  const abs = resolvePath(p);
  try { return realpathSync(abs); } catch { return abs; }
}

const ROOT = realRoot(resolvePath(dirname(fileURLToPath(import.meta.url)), '..'));
const BUILD_ROOT = realRoot(resolvePath(ROOT, 'build-ts'));
const MANAGED_PREFIXES = ['desktop/', 'src/', 'scripts/', 'test/', 'evals/', 'web/'];

function normalizeCandidate(absPath) {
  const abs = resolvePath(absPath);
  let cur = dirname(abs);
  while (cur !== dirname(cur) && !existsSync(cur)) {
    cur = dirname(cur);
  }
  try {
    const tail = relativePath(cur, abs);
    return tail ? resolvePath(realpathSync(cur), tail) : realpathSync(cur);
  } catch {
    return abs;
  }
}

function toRepoRelative(absPath) {
  const normRoot = ROOT.replaceAll('\\', '/');
  const normBuild = BUILD_ROOT.replaceAll('\\', '/');
  const normPath = normalizeCandidate(absPath).replaceAll('\\', '/');
  if (normPath.startsWith(`${normBuild}/`)) {
    return { rel: normPath.slice(normBuild.length + 1), inBuild: true };
  }
  if (normPath.startsWith(`${normRoot}/`)) {
    return { rel: normPath.slice(normRoot.length + 1), inBuild: false };
  }
  return null;
}

function candidateForSpecifier(specifier, parentURL) {
  if (!specifier || (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('file://'))) {
    return null;
  }
  let resolvedAbs;
  if (specifier.startsWith('file://')) {
    resolvedAbs = fileURLToPath(specifier);
  } else if (parentURL && parentURL.startsWith('file://')) {
    resolvedAbs = resolvePath(dirname(fileURLToPath(parentURL)), specifier);
  } else {
    return null;
  }

  const info = toRepoRelative(resolvedAbs);
  if (!info || !MANAGED_PREFIXES.some(p => info.rel.startsWith(p))) {
    return null;
  }

  // If the file itself already exists in its original location, prefer it.
  if (existsSync(resolvedAbs)) return null;

  const altAbs = info.inBuild ? resolvePath(ROOT, info.rel) : resolvePath(BUILD_ROOT, info.rel);
  if (existsSync(altAbs)) {
    return pathToFileURL(altAbs).href;
  }
  return null;
}

const ASSET_SPECIFIER_RE = /\.(?:css|svg|png|jpe?g|webp|gif|mp4|webm|woff2?)(?:\?.*)?$/i;
const ASSET_QUERY_RE = /[?&](?:url|raw)(?:&|$)/;

export async function resolve(specifier, context, nextResolve) {
  if (ASSET_SPECIFIER_RE.test(specifier) || ASSET_QUERY_RE.test(specifier)) {
    return { url: `baryon-asset:///${encodeURIComponent(specifier)}`, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      const remapped = candidateForSpecifier(specifier, context.parentURL);
      if (remapped) {
        return nextResolve(remapped, context);
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('baryon-asset:///')) {
    return { format: 'module', shortCircuit: true, source: 'export default "";' };
  }
  if (url.startsWith('file://') && url.endsWith('.mts')) {
    const abs = fileURLToPath(url);
    const info = toRepoRelative(abs);
    if (info && !info.inBuild && MANAGED_PREFIXES.some(p => info.rel.startsWith(p))) {
      const compiled = resolvePath(BUILD_ROOT, info.rel.replace(/\.mts$/, '.mjs'));
      if (existsSync(compiled)) {
        return { format: 'module', shortCircuit: true, source: await readFile(compiled, 'utf8') };
      }
    }
  }
  return nextLoad(url, context);
}
