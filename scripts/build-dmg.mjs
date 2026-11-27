import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preferredIdentity, selectSigningIdentity } from './signing-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP = join(ROOT, 'release', 'Baryon-darwin-arm64', 'Baryon.app');
const RELEASE_DIR = join(ROOT, 'release');

function parseArgs(argv) {
  let appPath = DEFAULT_APP;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app' && argv[i + 1]) {
      appPath = resolve(argv[++i]);
    }
  }
  return { appPath };
}

function run(cmd, args, { allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.status}):\n${res.stderr || res.stdout}`);
  }
  return res;
}

function plistRead(plistPath, key, fallback) {
  const res = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], { allowFail: true });
  return res.status === 0 ? res.stdout.trim() : fallback;
}

function formatMB(bytes) {
  const mb = Math.round(bytes / (1000 * 1000));
  return `${mb} MB`;
}

function main() {
  const { appPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found: ${appPath}`);
  }

  const plistPath = join(appPath, 'Contents', 'Info.plist');
  const version = plistRead(plistPath, 'CFBundleShortVersionString', '0.1.0');
  const minMacOS = plistRead(plistPath, 'LSMinimumSystemVersion', '13.0');
  const filename = `Baryon-${version}-arm64.dmg`;
  const dmgPath = join(RELEASE_DIR, filename);
  const shaPath = `${dmgPath}.sha256`;
  const staging = `/tmp/baryon-dmg-${process.pid}`;

  mkdirSync(RELEASE_DIR, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  let signed = false;
  try {
    run('/usr/bin/ditto', [appPath, join(staging, basename(appPath))]);
    symlinkSync('/Applications', join(staging, 'Applications'));

    run('/usr/bin/hdiutil', [
      'create',
      '-volname',
      `Baryon ${version}`,
      '-srcfolder',
      staging,
      '-ov',
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      dmgPath,
    ]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const ids = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { allowFail: true });
  if (ids.status === 0) {
    const requested = process.env.FAIRY_SIGN_IDENTITY || process.env.BARYON_SIGN_IDENTITY || preferredIdentity(ids.stdout);
    let signTarget = '';
    try {
      signTarget = selectSigningIdentity(ids.stdout, requested);
    } catch {
      signTarget = '';
    }
    if (signTarget) {
      const signRes = run(
        '/usr/bin/codesign',
        ['--force', '--timestamp', '--sign', signTarget, dmgPath],
        { allowFail: true },
      );
      signed = signRes.status === 0;
    }
  }

  run('/usr/bin/hdiutil', ['verify', dmgPath]);

  const buf = readFileSync(dmgPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const bytes = statSync(dmgPath).size;
  writeFileSync(shaPath, `${sha256}  ${filename}\n`, 'utf8');

  const summary = {
    version,
    filename,
    dmgPath,
    shaPath,
    bytes,
    sizeLabel: formatMB(bytes),
    sha256,
    minMacOS,
    arch: 'Apple Silicon (arm64)',
    signed,
    builtAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
