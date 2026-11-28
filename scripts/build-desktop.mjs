// Compiles TypeScript desktop + shared modules into build-ts/ via tsrs and copies runtime non-JS sibling assets.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = join(ROOT, 'build-ts');
const TSRS_BIN = join(ROOT, 'node_modules', '.bin', 'tsrs');
const SKIP_EXT_RE = /\.(?:[cm]?ts|[cm]?js|tsx|jsx|d\.ts)$/i;

async function copyRuntimeAssets(srcDir, dstDir) {
  if (!existsSync(srcDir)) return;
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.venv') continue;
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyRuntimeAssets(srcPath, dstPath);
    } else if (entry.isFile()) {
      const isBrowserAssetScript =
        entry.name.endsWith('.js') &&
        /(?:^|[\\/])desktop[\\/](?:page-kinds|phone)$/.test(srcDir) &&
        !existsSync(dstPath);
      if (isBrowserAssetScript || !SKIP_EXT_RE.test(entry.name)) {
        await mkdir(dirname(dstPath), { recursive: true });
        await cp(srcPath, dstPath);
      }
    }
  }
}

export async function buildDesktop(rootDir = ROOT) {
  const outDir = join(rootDir, 'build-ts');
  await rm(outDir, { recursive: true, force: true });

  const tsrsCmd = existsSync(join(rootDir, 'node_modules', '.bin', 'tsrs'))
    ? join(rootDir, 'node_modules', '.bin', 'tsrs')
    : TSRS_BIN;
  execFileSync(tsrsCmd, ['-p', join(rootDir, 'tsconfig.desktop.json')], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (existsSync(join(rootDir, 'tsconfig.src-emit.json'))) {
    execFileSync(tsrsCmd, ['-p', join(rootDir, 'tsconfig.src-emit.json')], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }
  if (existsSync(join(rootDir, 'tsconfig.scripts-emit.json'))) {
    execFileSync(tsrsCmd, ['-p', join(rootDir, 'tsconfig.scripts-emit.json')], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }
  if (existsSync(join(rootDir, 'tsconfig.web-emit.json'))) {
    execFileSync(tsrsCmd, ['-p', join(rootDir, 'tsconfig.web-emit.json')], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }

  await copyRuntimeAssets(join(rootDir, 'desktop'), join(outDir, 'desktop'));

  for (const rel of ['build-ts/desktop/app-root.cjs', 'build-ts/desktop/main.cjs', 'build-ts/desktop/preload.cjs']) {
    const abs = join(rootDir, rel);
    if (existsSync(abs)) {
      execFileSync(process.execPath, ['--check', abs], { cwd: rootDir, stdio: 'inherit' });
    }
  }
  return { outDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop(ROOT);
}
