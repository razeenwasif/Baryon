const { basename, dirname, resolve } = require('node:path') as typeof import('node:path');

/**
 * Resolves the workspace/bundle root consistently across:
 * 1) direct checkout execution (`<repo>/desktop` or `<repo>/desktop/<sub>`),
 * 2) compiled dev/test output (`<repo>/build-ts/desktop` or `<repo>/build-ts/desktop/<sub>`), and
 * 3) packaged Electron app (`.../Contents/Resources/app.asar/desktop`).
 */
function resolveAppRoot(fromDir: string): string {
  let cur = resolve(fromDir);
  while (cur !== dirname(cur)) {
    const seg = basename(cur);
    const parent = dirname(cur);
    if (seg === 'desktop') {
      if (basename(parent) === 'build-ts') {
        return dirname(parent);
      }
      return parent;
    }
    cur = parent;
  }
  return resolve(fromDir, '..');
}

function isCompiledBuildDir(dir: string): boolean {
  const normalized = resolve(dir).replaceAll('\\', '/');
  return normalized.includes('/build-ts/') || normalized.endsWith('/build-ts');
}

module.exports = { resolveAppRoot, isCompiledBuildDir };
