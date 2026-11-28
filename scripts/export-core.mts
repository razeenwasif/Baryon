// Clean public Open Core exporter & standalone verification script for Baryon.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRO_EXCLUDED_PATHS } from '../desktop/edition.mjs';
import { resolveRepoRoot } from './repo-root.mjs';

export interface PackageJsonLike {
  name?: string;
  private?: boolean;
  license?: string;
  baryonEdition?: string;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export interface ExportCoreOptions {
  rootDir?: string;
  outDir?: string;
  dryRun?: boolean;
  verify?: boolean;
}

export interface ExportCoreResult {
  outDir: string;
  keptCount: number;
  excludedCount: number;
  kept: string[];
  excluded: string[];
  dryRun?: boolean;
  verified?: boolean;
}

interface OpsecLeak {
  file: string;
  match: string;
}

const REPO_ROOT = resolveRepoRoot(import.meta.url);
const DEFAULT_OUT = join(REPO_ROOT, '.local-data/baryon-core-export');

const PRIVATE_EXCLUDED_PATHS = Object.freeze([
  'SANDBOX_LOG.md',
  'VERDICT.md',
  'RESEARCH_PLAN.md',
  'MIGRATION_SPEC.md',
  'BACKLOG.md',
  'docs/local',
  'docs/diffusion-plan.md',
  'docs/research-workbench-summary.md',
  'docs/fairy-status-and-plan.html',
  'docs/fairy-status-and-plan.md',
  'docs/vorssaint-integration-plan.md',
  'avatar-work',
  'audio-work',
  'assets/stella.vrm',
  'LICENSE-APACHE-2.0',
  'examples/decomposition-practice',
  '.antigravity',
  '.claude',
  '.gemini',
]);

const PRO_TEST_NAME_RE = /^test\/.*(?:research|repro|notebook|analytics|academy|phone-notebooks|study-helper|studio|diffusion|worlds|game-mode).*\.test\.m?[jt]s$/;
const PRO_IMPORT_RE = /(?:from\s+['"]|import\s*\(\s*['"])(?:\.\.?\/)+(?:desktop\/|src\/)?(?:research|reproduce|analytics|academy|notebook|phone-notebooks|studio|diffusion|worlds|game)/;

function matchesPrefix(relPath: string, prefix: string): boolean {
  const clean = prefix.replace(/\/+$/, '');
  return relPath === clean || relPath.startsWith(`${clean}/`);
}

export function isProOrPrivatePath(relPath: string, content = ''): boolean {
  if (PRO_EXCLUDED_PATHS.some(prefix => matchesPrefix(relPath, prefix))) return true;
  if (PRIVATE_EXCLUDED_PATHS.some(prefix => matchesPrefix(relPath, prefix))) return true;
  if (PRO_TEST_NAME_RE.test(relPath)) return true;
  if (relPath.startsWith('test/') && content && PRO_IMPORT_RE.test(content)) return true;
  return false;
}

export function sanitizeCorePackageJson(pkg: PackageJsonLike): PackageJsonLike {
  const next = JSON.parse(JSON.stringify(pkg)) as PackageJsonLike;
  next.name = 'baryon-core';
  next.private = false;
  next.license = 'Apache-2.0';
  next.baryonEdition = 'core';
  if (next.scripts) {
    delete next.scripts['build:study'];
    delete next.scripts['build:engines'];
    delete next.scripts['build:research'];
    delete next.scripts['test:research'];
    delete next.scripts['export:core'];
    delete next.scripts['export:core:verify'];
    delete next.scripts['package:core'];
    if (typeof next.scripts['package:fairy'] === 'string') {
      next.scripts['package:fairy'] = next.scripts['package:fairy']
        .replace(/\s*&&\s*npm run build:study/g, '')
        .replace(/\s*&&\s*npm run build:engines/g, '');
    }
  }
  return next;
}

export async function exportCore({
  rootDir = REPO_ROOT,
  outDir = DEFAULT_OUT,
  dryRun = false,
  verify = false,
}: ExportCoreOptions = {}): Promise<ExportCoreResult> {
  const trackedRaw = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: rootDir, encoding: 'utf8' });
  const tracked = trackedRaw.split('\0').filter(Boolean);

  const kept: string[] = [];
  const excluded: string[] = [];

  for (const rel of tracked) {
    if (rel === 'package.json') {
      kept.push(rel);
      continue;
    }
    let content = '';
    if (rel.startsWith('test/') && /\.(?:mjs|mts|ts)$/.test(rel)) {
      try {
        content = await readFile(join(rootDir, rel), 'utf8');
      } catch {}
    }
    if (isProOrPrivatePath(rel, content)) {
      excluded.push(rel);
    } else {
      kept.push(rel);
    }
  }

  if (dryRun) {
    return { outDir, keptCount: kept.length, excludedCount: excluded.length, kept, excluded, dryRun: true };
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const BINARY_EXT_RE = /\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|vrm|glb|bin|dmg|zip|node|so|dylib|a|o|pdf|mp3|wav|m4a|mov|mp4)$/i;
  const OPSEC_FORBIDDEN_RE = new RegExp(
    [
      ['/Users/', 'razeen'].join(''),
      ['razeen', 'wasif66'].join('\\.'),
      ['kagut', 'suchi'].join(''),
      ['tail', 'bc1fab'].join(''),
      ['100', '97', '247', '34'].join('\\.'),
      ['192', '168', '68', '61'].join('\\.'),
      ['RAZEEN', 'WASIF'].join(' '),
      ['C63K', '728GC6'].join(''),
    ].join('|'),
  );

  async function scanOpsecLeaks(scanRoot: string, curDir = scanRoot): Promise<OpsecLeak[]> {
    const leaks: OpsecLeak[] = [];
    for (const entry of await readdir(curDir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build-ts') continue;
      const full = join(curDir, entry.name);
      if (entry.isDirectory()) {
        leaks.push(...(await scanOpsecLeaks(scanRoot, full)));
      } else if (entry.isFile() && !BINARY_EXT_RE.test(entry.name)) {
        const buf = await readFile(full);
        if (buf.includes(0)) continue;
        const text = buf.toString('utf8');
        const match = OPSEC_FORBIDDEN_RE.exec(text);
        if (match) leaks.push({ file: full.slice(scanRoot.length + 1), match: match[0] });
      }
    }
    return leaks;
  }

  for (const rel of kept) {
    if (rel === 'package.json') continue;
    const src = join(rootDir, rel);
    if (!existsSync(src)) continue;
    const dst = join(outDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    if (rel === 'ios/Fairy.xcodeproj/project.pbxproj') {
      const raw = await readFile(src, 'utf8');
      await writeFile(dst, raw.replace(/DEVELOPMENT_TEAM = [A-Z0-9]{10};/g, 'DEVELOPMENT_TEAM = "";'), 'utf8');
      continue;
    }
    await cp(src, dst, { recursive: true });
  }

  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')) as PackageJsonLike;
  const sanitized = sanitizeCorePackageJson(pkg);
  await writeFile(join(outDir, 'package.json'), `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');

  const licenseSrc = join(rootDir, 'LICENSE-APACHE-2.0');
  if (existsSync(licenseSrc)) {
    await cp(licenseSrc, join(outDir, 'LICENSE'));
  }

  if (verify) {
    for (const prefix of PRO_EXCLUDED_PATHS) {
      const target = join(outDir, prefix);
      if (existsSync(target)) {
        throw new Error(`Pro path leaked into Core export: ${prefix}`);
      }
    }

    const opsecLeaks = await scanOpsecLeaks(outDir);
    if (opsecLeaks.length > 0) {
      throw new Error(`OPSEC trace leaked into Core export: ${opsecLeaks.map(l => `${l.file} (${l.match})`).join(', ')}`);
    }

    const nmLink = join(outDir, 'node_modules');
    const nmTarget = join(rootDir, 'node_modules');
    const createdLink = !existsSync(nmLink) && existsSync(nmTarget);
    if (createdLink) await symlink(nmTarget, nmLink, 'dir');
    try {
      const tsrsBin = join(outDir, 'node_modules', '.bin', 'tsrs');
      execFileSync(process.execPath, [join(outDir, 'scripts/build-desktop.mjs')], {
        cwd: outDir,
        env: { ...process.env, BARYON_EDITION: 'core' },
        stdio: 'inherit',
      });
      execFileSync(tsrsBin, ['-p', join(outDir, 'tsconfig.renderer.json'), '--noEmit', '--fast'], {
        cwd: outDir,
        env: { ...process.env, BARYON_EDITION: 'core' },
        stdio: 'inherit',
      });
      execFileSync(tsrsBin, ['-p', join(outDir, 'tsconfig.desktop.json'), '--noEmit', '--fast'], {
        cwd: outDir,
        env: { ...process.env, BARYON_EDITION: 'core' },
        stdio: 'inherit',
      });
      execFileSync(tsrsBin, ['-p', join(outDir, 'tsconfig.scripts.json'), '--noEmit', '--fast'], {
        cwd: outDir,
        env: { ...process.env, BARYON_EDITION: 'core' },
        stdio: 'inherit',
      });
      execFileSync(tsrsBin, ['-p', join(outDir, 'tsconfig.web.json'), '--noEmit', '--fast'], {
        cwd: outDir,
        env: { ...process.env, BARYON_EDITION: 'core' },
        stdio: 'inherit',
      });

      const coreModules = [
        'desktop/edition.mjs',
        'desktop/work-tools.mjs',
        'desktop/goals.mjs',
        'desktop/goal-check.mjs',
        'desktop/runs.mjs',
        'desktop/benchmark-watch.mjs',
        'desktop/phone-pages.mjs',
        'desktop/web-pdf.mjs',
      ];
      const importUrls = coreModules.map(m => pathToFileURL(join(outDir, m)).href);
      execFileSync(
        process.execPath,
        [
          '--import',
          './scripts/ts-build-loader.mjs',
          '--input-type=module',
          '-e',
          `for (const u of ${JSON.stringify(importUrls)}) { await import(u); } console.log('CORE_IMPORTS_OK');`,
        ],
        { cwd: outDir, env: { ...process.env, BARYON_EDITION: 'core' }, stdio: 'inherit' },
      );

      execFileSync('npx', ['vite', 'build'], {
        cwd: outDir,
        env: { ...process.env, BARYON_EDITION: 'core' },
        stdio: 'inherit',
      });
      const distAssets = await readdir(join(outDir, 'dist', 'assets'));
      for (const forbidden of ['research-view', 'analytics-view', 'academy-view', 'notebook-view', 'studio-view', 'diffusion-view', 'worlds-view', 'game-view']) {
        if (distAssets.some(f => f.startsWith(forbidden))) {
          throw new Error(`Forbidden Pro Vite asset emitted in Core export: ${forbidden}`);
        }
      }
    } finally {
      await rm(join(outDir, 'dist'), { recursive: true, force: true });
      await rm(join(outDir, 'build-ts'), { recursive: true, force: true });
      if (createdLink) await rm(nmLink, { force: true });
    }
  }

  return { outDir, keptCount: kept.length, excludedCount: excluded.length, kept, excluded, verified: verify };
}

function parseCli(argv: string[]): { outDir: string; dryRun: boolean; verify: boolean } {
  let outDir = DEFAULT_OUT;
  let dryRun = false;
  let verify = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') outDir = resolve(argv[++i]);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--verify') verify = true;
  }
  return { outDir, dryRun, verify };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseCli(process.argv.slice(2));
  const res = await exportCore(opts);
  console.log(
    `Baryon Core export (${opts.dryRun ? 'dry-run' : opts.verify ? 'verified' : 'written'}): ${res.keptCount} files kept, ${res.excludedCount} Pro/private files excluded -> ${res.outDir}`,
  );
}
