// Registers both ESM module resolve hooks and CJS require fallback for build-ts/ during incremental migration.
import { existsSync, realpathSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, relative as relativePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function realRoot(p) {
  const abs = resolve(p);
  try { return realpathSync(abs); } catch { return abs; }
}

function normalizeCandidate(absPath) {
  const abs = resolve(absPath);
  let cur = dirname(abs);
  while (cur !== dirname(cur) && !existsSync(cur)) {
    cur = dirname(cur);
  }
  try {
    const tail = relativePath(cur, abs);
    return tail ? resolve(realpathSync(cur), tail) : realpathSync(cur);
  } catch {
    return abs;
  }
}

const ROOT = realRoot(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const BUILD_ROOT = realRoot(resolve(ROOT, 'build-ts'));
const MANAGED_PREFIXES = ['desktop/', 'src/', 'scripts/', 'test/', 'evals/', 'web/'];

register('./ts-build-hooks.mjs', import.meta.url);

const require = createRequire(import.meta.url);
const Module = require('node:module');
const origResolve = Module._resolveFilename;

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  try {
    return origResolve.call(this, request, parent, isMain, options);
  } catch (err) {
    if (err?.code === 'MODULE_NOT_FOUND' && (request.startsWith('./') || request.startsWith('../')) && parent?.filename) {
      const resolvedAbs = normalizeCandidate(resolve(dirname(parent.filename), request));
      const normRoot = ROOT.replaceAll('\\', '/');
      const normBuild = BUILD_ROOT.replaceAll('\\', '/');
      const normPath = resolvedAbs.replaceAll('\\', '/');

      let rel = '';
      let inBuild = false;
      if (normPath.startsWith(`${normBuild}/`)) {
        rel = normPath.slice(normBuild.length + 1);
        inBuild = true;
      } else if (normPath.startsWith(`${normRoot}/`)) {
        rel = normPath.slice(normRoot.length + 1);
      }

      if (rel && MANAGED_PREFIXES.some(p => rel.startsWith(p))) {
        const altAbs = inBuild ? resolve(ROOT, rel) : resolve(BUILD_ROOT, rel);
        if (existsSync(altAbs)) {
          return origResolve.call(this, altAbs, parent, isMain, options);
        }
      }
    }
    throw err;
  }
};
