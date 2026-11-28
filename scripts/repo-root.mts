import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the repository root from any module under `scripts/`, `evals/`, or compiled `build-ts/` mirrors. */
export function resolveRepoRoot(metaUrl: string): string {
  const dir = dirname(fileURLToPath(metaUrl));
  const parts = dir.split(sep);
  const buildIdx = parts.lastIndexOf('build-ts');
  if (buildIdx > 0) return parts.slice(0, buildIdx).join(sep) || sep;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'scripts' || parts[i] === 'evals') {
      return parts.slice(0, i).join(sep) || sep;
    }
  }
  return resolve(dir, '..');
}
