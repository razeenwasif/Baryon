// Pre-flight repository Design System & Token Ingestion Adapter.
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export interface DesignScanResult {
  folder: string;
  hasDesignMd: boolean;
  designMd: string;
  tailwindConfigFound: boolean;
  tailwindConfigPath: string;
  stack: string[];
  cssFilesScanned: string[];
  tokens: Record<string, string>;
  fonts: string[];
  components: string[];
  summaryText: string;
}

const CSS_CANDIDATES = [
  'src/index.css',
  'src/globals.css',
  'src/app/globals.css',
  'app/globals.css',
  'src/styles/globals.css',
  'src/styles/tokens.css',
  'src/tokens.css',
  'src/workspace.css',
];

const UI_STACK_DEPS = [
  'react',
  'next',
  'vite',
  'tailwindcss',
  'lucide-react',
  '@radix-ui/react-dialog',
  'framer-motion',
  'class-variance-authority',
  'electron',
];

function validateFolder(folderPath: string, home?: string): string {
  const raw = String(folderPath || '').trim();
  if (!raw) throw new Error('Select a project folder first.');
  if (raw.includes('\0') || raw.split(/[\\/]+/).includes('..')) {
    throw new Error('Folder path cannot contain ".." or null bytes.');
  }
  const absHome = realpathSync(resolve(home || homedir()));
  if (!existsSync(raw)) throw new Error('Selected project folder does not exist.');
  const real = realpathSync(resolve(raw));
  if (real !== absHome && !real.startsWith(`${absHome}/`)) {
    throw new Error('Project folder must stay inside your home folder.');
  }
  return real;
}

async function safeRead(filePath: string, maxBytes = 60_000): Promise<string> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return '';
    const text = await readFile(filePath, 'utf8');
    return text.slice(0, maxBytes);
  } catch {
    return '';
  }
}

export function extractCssTokens(cssText: string, limit = 60): Record<string, string> {
  const tokens: Record<string, string> = {};
  const matches = String(cssText || '').matchAll(/(--[a-z0-9_-]{2,48})\s*:\s*([^;{}\n]{1,90});/gi);
  for (const m of matches) {
    if (Object.keys(tokens).length >= limit) break;
    const key = m[1].trim();
    const val = m[2].trim();
    if (val && !tokens[key]) tokens[key] = val;
  }
  return tokens;
}

export function extractFontsFromCss(text: string): string[] {
  const found = new Set<string>();
  for (const m of String(text || '').matchAll(/font-family\s*:\s*([^;{}\n]{2,120})/gi)) {
    const first = m[1].split(',')[0]?.replace(/['"]/g, '').trim();
    if (first && !/^(inherit|initial|var\(|serif|sans-serif|monospace)$/i.test(first)) {
      found.add(first);
    }
  }
  return [...found].slice(0, 12);
}

/**
 * Scan an existing project folder for DESIGN.md, Tailwind config, CSS variables, fonts, and UI primitives.
 */
export async function scanRepoDesignSystem(folderPath: string, { home = homedir() }: { home?: string } = {}): Promise<DesignScanResult> {
  const folder = validateFolder(folderPath, home);
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error('Target must be a directory.');

  const designMd = await safeRead(join(folder, 'DESIGN.md'), 24_000);
  const hasDesignMd = Boolean(designMd.trim());

  let tailwindConfigPath = '';
  for (const cand of ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs']) {
    if (existsSync(join(folder, cand))) {
      tailwindConfigPath = cand;
      break;
    }
  }

  let stack: string[] = [];
  const pkgText = await safeRead(join(folder, 'package.json'), 40_000);
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      stack = UI_STACK_DEPS.filter(dep => dep in allDeps);
    } catch {}
  }

  const cssFilesScanned: string[] = [];
  const tokens: Record<string, string> = {};
  const fontSet = new Set<string>();

  const ingestCss = async (rel: string): Promise<void> => {
    if (cssFilesScanned.length >= 8) return;
    const content = await safeRead(join(folder, rel), 45_000);
    if (!content) return;
    cssFilesScanned.push(rel);
    Object.assign(tokens, extractCssTokens(content, 60 - Object.keys(tokens).length));
    for (const f of extractFontsFromCss(content)) fontSet.add(f);
  };

  for (const rel of CSS_CANDIDATES) await ingestCss(rel);

  try {
    const srcDir = join(folder, 'src');
    if (existsSync(srcDir)) {
      for (const entry of await readdir(srcDir, { withFileTypes: true })) {
        if (cssFilesScanned.length >= 8) break;
        if (entry.isFile() && entry.name.endsWith('.css')) {
          const rel = join('src', entry.name);
          if (!cssFilesScanned.includes(rel)) await ingestCss(rel);
        }
      }
    }
  } catch {}

  const components: string[] = [];
  for (const dir of ['src/components/ui', 'src/components', 'components/ui']) {
    const abs = join(folder, dir);
    if (!existsSync(abs)) continue;
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (components.length >= 30) break;
        if (entry.isFile() && /\.(tsx|jsx|svelte|vue)$/.test(entry.name)) {
          components.push(basename(entry.name).replace(/\.[^.]+$/, ''));
        }
      }
    } catch {}
  }

  const fonts = [...fontSet];
  const tokenSample = Object.entries(tokens).slice(0, 18).map(([k, v]) => `${k}: ${v}`).join('; ');
  const summaryLines = [
    `Folder: ${folder}`,
    `Stack: ${stack.join(', ') || 'custom / HTML'} | Tailwind config: ${tailwindConfigPath || 'none'}`,
    `DESIGN.md: ${hasDesignMd ? 'present' : 'absent (Phase 1 should generate one)'}`,
    `CSS tokens (${Object.keys(tokens).length}): ${tokenSample || 'none detected'}`,
    `Fonts: ${fonts.join(', ') || 'none specified'}`,
    `UI primitives (${components.length}): ${components.slice(0, 16).join(', ') || 'none detected'}`,
  ];
  if (hasDesignMd) summaryLines.push(`DESIGN.md excerpt:\n${designMd.slice(0, 1800)}`);

  return {
    folder,
    hasDesignMd,
    designMd,
    tailwindConfigFound: Boolean(tailwindConfigPath),
    tailwindConfigPath,
    stack,
    cssFilesScanned,
    tokens,
    fonts,
    components,
    summaryText: summaryLines.join('\n'),
  };
}
