import { packager } from '@electron/packager';
import { access, chmod, cp, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative as relativeTo } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { selectSigningIdentity, preferredIdentity, identityName, isDeveloperID } from './signing-identity.mjs';
import { getRawHeader } from '@electron/asar';
import { lockFuses, assertFuses, LOCKED } from './fuses.mjs';
import { requirementFor } from '../desktop/helper-guard.cjs';
import { PRO_EXCLUDED_PATHS } from '../desktop/edition.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const isCore = process.env.BARYON_EDITION === 'core';
const coreExcluded = isCore ? new Set(PRO_EXCLUDED_PATHS.map(p => p.replace(/\/+$/, ''))) : null;
if (process.platform !== 'darwin') throw new Error('Build Lyra.app on macOS.');

// Sign with your Developer ID Application certificate, else your Apple Development one (both have your Team ID, so the
// Keychain and privacy permissions trust every build), else the shared "Stella Local Development" one;
// FAIRY_SIGN_IDENTITY (or the older LYRA_ / STELLA_SIGN_IDENTITY) chooses another.
const identities = execFileSync('/usr/bin/security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' });
const signingIdentity = selectSigningIdentity(identities, process.env.FAIRY_SIGN_IDENTITY || process.env.LYRA_SIGN_IDENTITY || process.env.STELLA_SIGN_IDENTITY || preferredIdentity(identities));
// A Developer ID build is hardened: macOS then refuses code injected into Fairy, and libraries her team didn't sign.
const hardened = isDeveloperID(identityName(identities, signingIdentity));
// A Developer ID's name ends with its Team ID. It's written into the archive, and the packaged app then starts a
// program from beside the archive only if that team signed it (desktop/helper-guard.cjs). Other builds check nothing.
const team = hardened ? /\(([A-Z0-9]{10})\)\s*$/.exec(identityName(identities, signingIdentity))?.[1] ?? '' : '';
if (hardened && !team) throw new Error('The Developer ID certificate’s name doesn’t end with a Team ID.');
// FAIRY_NOTARIZE names a sign-in saved with `xcrun notarytool store-credentials`. With it, the build is sent to Apple
// to be notarized (a few minutes, and the app is uploaded) and the ticket is stapled on. Off by default, so everyday
// builds stay quick and stay on this Mac.
const notaryProfile = process.env.FAIRY_NOTARIZE || '';
if (notaryProfile && !hardened) throw new Error('Apple only notarizes a build signed with a Developer ID Application certificate. Create one, or leave FAIRY_NOTARIZE unset.');

// Every Mach-O file under a folder, as paths from it: what macOS has to start or load itself.
async function programsIn(folder, from = folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await programsIn(path, from));
    else if (entry.isFile()) {
      const file = await open(path), head = Buffer.alloc(4);
      try { await file.read(head, 0, 4, 0); } finally { await file.close(); }
      if (['cffaedfe', 'cefaedfe', 'cafebabe', 'feedfacf'].includes(head.toString('hex'))) found.push(relativeTo(from, path));
    }
  }
  return found;
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const electron = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8'));
const temp = await mkdtemp(join(tmpdir(), 'fairy-package-'));

try {
  // Build Baryon.icns from app-icon.png
  const iconset = join(temp, 'Baryon.iconset');
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync('/usr/bin/sips', [
        '-z', String(size * scale), String(size * scale),
        join(root, 'assets/app-icon.png'),
        '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
      ], { stdio: 'ignore' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/Baryon.icns')]);

  // The folders that stay outside the archive: the helper programs, the tray picture a helper is handed, Codex's own
  // program, and node-pty's shell starter. Every program in the app has to be in one of these (checked below).
  const UNPACKED_DIRS = '{native/bin,native/analytics,assets/tray,node_modules/@openai,node_modules/node-pty/prebuilds}';
  const stage = join(temp, 'source');
  await mkdir(stage);

  // Full screen around the notch needs its small native module; a checkout that copied native/bin from elsewhere may lack it.
  if (!existsSync(join(root, 'native/bin/fairy-notch.node'))) execFileSync(process.execPath, [join(root, 'scripts/build-notch.mjs')], { stdio: 'inherit' });

  // Explicit allowlist: no user data, API keys, development caches, or unrelated files enter the app.
  const runtime = `node_modules/@openai/codex-darwin-${process.arch}`;
  const coreBinsToSkip = new Set(['native/bin/fairy-study', 'native/bin/fairy-engines']);
  for (const relative of [
    'dist', 'desktop', 'src/defaults.js', 'src/pane-layout.js', 'src/wake-profile.js', 'src/chat-routing.js', 'src/work-context.js', 'src/token-split.js', 'src/note-heading.js', 'src/clipboard-request.js', 'src/local-file-types.js', 'src/conditional-task.js', 'src/model-menu.js', 'src/auto-caption.js', 'src/diff-walkthrough.js', 'src/usage-logic.js',
    'native/bin/fairy-desktop', 'native/bin/fairy-transcribe',
    'native/bin/fairy-quiz-ocr', 'native/bin/fairy-quiz-overlay', 'native/bin/fairy-guide',
    'native/bin/fairy-notes', 'native/bin/fairy-power', 'native/bin/fairy-meeting', 'native/bin/fairy-screen', 'native/bin/fairy-idle', 'native/bin/fairy-document', 'native/bin/fairy-study', 'native/bin/fairy-engines', 'native/bin/fairy-simulator', 'native/bin/fairy-resource-monitor', 'native/bin/fairy-notch.node', 'assets/tray', runtime,
  ]) {
    if (isCore && coreBinsToSkip.has(relative)) continue;
    const destination = join(stage, relative);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(root, relative), destination, {
      recursive: true,
      ...(coreExcluded ? {
        filter: src => {
          const rel = relativeTo(root, src).replaceAll('\\', '/');
          return !coreExcluded.has(rel);
        },
      } : {}),
    });
  }

  // The research engine (npm run build:research) goes in when it's built; nothing in the app needs it before
  // Research's board (docs/research-migration.md, stage 5), and building it needs Proton's checkout. The fixture build
  // (fairy-research-fixture) is for tests only and never goes in.
  if (!isCore) {
    if (existsSync(join(root, 'native/bin/fairy-research'))) await cp(join(root, 'native/bin/fairy-research'), join(stage, 'native/bin/fairy-research'));
    else console.warn('native/bin/fairy-research isn’t built (npm run build:research), so this build has no research engine.');
  }
  if (existsSync(join(root, 'native/bin/baryon-vorssaint'))) await cp(join(root, 'native/bin/baryon-vorssaint'), join(stage, 'native/bin/baryon-vorssaint'));
  else console.warn('native/bin/baryon-vorssaint isn’t built (npm run build:vorssaint), so Vorssaint runs externally.');
  if (!isCore) {
    for (const rel of ['worker.py', 'local_automl.py', 'ai_ops.py', 'cpu_backend.py', 'embeddings_3d.py', 'pyproject.toml', 'UPSTREAM.json', 'autoML', 'recordLinkage', 'forge']) {
      const src = join(root, 'native/analytics', rel);
      if (existsSync(src)) await cp(src, join(stage, 'native/analytics', rel), { recursive: true, filter: p => !p.includes('__pycache__') && !p.endsWith('.pyc') && !p.includes('/.venv') });
    }
  }

  // Copy only the local math reader and its runtime dependency tree.
  const copied = new Set();
  async function copyDependency(name, from = join(root, 'package.json')) {
    let manifest;
    for (const base of createRequire(from).resolve.paths(name) || []) {
      const candidate = join(base, name, 'package.json');
      try { await access(candidate); manifest = candidate; break; } catch {}
    }
    if (!manifest) throw new Error(`Missing math dependency: ${name}`);
    const directory = dirname(manifest);
    if (copied.has(directory)) return;
    copied.add(directory);
    const relative = directory.slice(root.length);
    if (!relative.startsWith('node_modules/')) throw new Error('Unexpected math dependency path');
    await mkdir(dirname(join(stage, relative)), { recursive: true });
    await cp(directory, join(stage, relative), { recursive: true });
    const dependency = JSON.parse(await readFile(manifest, 'utf8'));
    for (const child of Object.keys(dependency.dependencies || {})) await copyDependency(child, manifest);
  }
  await copyDependency('katex');
  await copyDependency('speech-rule-engine');
  await copyDependency('node-pty');
  await copyDependency('markdown-it');
  // Only this Mac's build of node-pty goes in; the Windows and other ones are no use here and would sit beside the archive.
  for (const entry of await readdir(join(stage, 'node_modules/node-pty/prebuilds'))) {
    if (entry !== `darwin-${process.arch}`) await rm(join(stage, 'node_modules/node-pty/prebuilds', entry), { recursive: true });
  }
  // npm drops the execute bit from node-pty's helper, and the shell can't start without it.
  await chmod(join(stage, `node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`), 0o755);

  // Copy the Fairy sprite assets into the app bundle.
  await mkdir(join(stage, 'assets'), { recursive: true });
  for (const assetName of [
    'casual-outfit.png',
  ]) {
    try {
      await access(join(root, 'assets', assetName));
      await cp(join(root, 'assets', assetName), join(stage, 'assets', assetName));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  // Also copy the VRM if present (for the Fairy avatar option in the dialog).
  for (const assetName of ['stella.vrm']) {
    try {
      await access(join(root, 'assets', assetName));
      await cp(join(root, 'assets', assetName), join(stage, 'assets', assetName));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  await writeFile(
    join(stage, 'package.json'),
    JSON.stringify({ name: isCore ? 'baryon-core' : pkg.name, version: pkg.version, main: pkg.main, type: 'module', private: true, baryonEdition: isCore ? 'core' : 'pro', ...(team ? { signedByTeam: team } : {}) }),
  );

  let electronZipDir;
  const cache = join(homedir(), 'Library/Caches/electron');
  for (const entry of await readdir(cache).catch(() => [])) {
    const directory = join(cache, entry);
    try {
      await access(join(directory, `electron-v${electron.version}-darwin-${process.arch}.zip`));
      electronZipDir = directory;
      break;
    } catch {}
  }

  const apps = await packager({
    dir: stage, out: join(root, isCore ? 'release-core' : 'release'), name: 'Baryon', executableName: 'Baryon',
    platform: 'darwin', arch: process.arch, electronVersion: electron.version, electronZipDir,
    appBundleId: 'dev.razeen.lyra', appVersion: pkg.version, appCategoryType: 'public.app-category.productivity',
    icon: join(root, 'build/Baryon.icns'), prune: false, overwrite: true,
    // The packager's working folder is this build's own. Left alone it's one folder shared by every build on the Mac,
    // which each build empties as it starts, so two builds at once delete each other's files.
    tmpdir: temp,
    // Her code goes into one archive, Resources/app.asar. Electron hashes it into the Info.plist, the signature seals
    // that, and the two asar fuses make Electron check the hash and run nothing else. What macOS itself has to start
    // or load, and the one file handed to a helper, stay outside it in app.asar.unpacked (desktop/bundle-path.cjs).
    asar: { unpack: '*.node', unpackDir: UNPACKED_DIRS },
    darwinDarkModeSupport: true,
    extendInfo: {
      CFBundleDisplayName: 'Baryon',
      NSMicrophoneUsageDescription: 'Baryon uses the microphone when you record a message or enable hands-free listening. Hands-free wake-name recognition runs locally and pauses when your Mac locks or sleeps.',
      NSScreenCaptureUsageDescription: 'Baryon shares screen snapshots for screen questions and desktop tasks. Optional screen awareness refreshes your selected display while awake and shares a snapshot with conversations.',
    },
    // The fuses are set in Electron's own copy as soon as it's unpacked, long before signing, which seals the change in.
    afterExtract: [async ({ buildPath }) => { await lockFuses(join(buildPath, 'Electron.app')); }],
    // The same two entitlements on every program inside: JIT for Chromium, and the microphone, which the hardened
    // runtime otherwise refuses however macOS's own permission is set.
    osxSign: {
      identity: signingIdentity, identityValidation: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      optionsForFile: file => ({
        hardenedRuntime: hardened, ...(hardened ? {} : { timestamp: 'none' }),
        entitlements: file?.endsWith('baryon-vorssaint')
          ? [
              'com.apple.security.automation.apple-events',
              'com.apple.security.device.camera',
              'com.apple.security.device.audio-input',
              'com.apple.security.personal-information.calendars',
            ]
          : ['com.apple.security.cs.allow-jit', 'com.apple.security.device.audio-input'],
      }),
    },
    ...(notaryProfile ? { osxNotarize: { keychainProfile: notaryProfile } } : {}),
  });

  const built = join(apps[0], 'Baryon.app');
  if (execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleDisplayName', join(built, 'Contents/Info.plist')], {encoding:'utf8'}).trim() !== 'Baryon') throw new Error('Packaged display name is not Baryon.');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', built]);
  await assertFuses(built, LOCKED);
  // The archive is there, the Info.plist carries the hash of its header, and no folder of loose code sits beside it.
  const resources = join(built, 'Contents/Resources'), archive = join(resources, 'app.asar');
  if (existsSync(join(resources, 'app'))) throw new Error('The built app has a loose app folder beside its archive. Do not install this build.');
  const sealed = createHash('sha256').update(getRawHeader(archive).headerString).digest('hex');
  const recorded = JSON.parse(execFileSync('/usr/bin/plutil', ['-extract', 'ElectronAsarIntegrity', 'json', '-o', '-', join(built, 'Contents/Info.plist')], { encoding: 'utf8' }))['Resources/app.asar'];
  if (recorded?.algorithm !== 'SHA256' || recorded.hash !== sealed) throw new Error('The Info.plist doesn’t carry the hash of app.asar, so Electron would refuse to start it. Do not install this build.');
  // A program packed into the archive can't be started, and nothing would say so until the feature was used.
  for (const program of await programsIn(stage)) {
    if (!existsSync(join(resources, 'app.asar.unpacked', program))) throw new Error(`${program} is a program, and it was packed into the archive, where macOS can't start it. Add its folder to UNPACKED_DIRS.`);
    // And each one passes the check the app will make before starting it, or she'd refuse her own helper.
    if (team && spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirementFor(team)}`, join(resources, 'app.asar.unpacked', program)], { stdio: 'ignore' }).status !== 0) throw new Error(`${program} isn’t signed by team ${team}, so the app would refuse to start it. Do not install this build.`);
  }
  // codesign prints what it finds on stderr.
  const signature = spawnSync('/usr/bin/codesign', ['-dv', built], { encoding: 'utf8' }).stderr || '';
  if (team && !signature.includes(`TeamIdentifier=${team}\n`)) throw new Error(`The app isn’t signed by team ${team}, the team written into it. Do not install this build.`);
  if (hardened && !/flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(signature)) throw new Error('Baryon was signed with a Developer ID but without the hardened runtime. Do not install this build.');
  if (notaryProfile) {
    // Gatekeeper's own verdict, and the stapled ticket, so a notarized build that Apple didn't accept can't be installed.
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', built], { stdio: 'inherit' });
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', built], { stdio: 'inherit' });
  }
  // Last, the app is asked itself (desktop/self-check.cjs): a path on the wrong side of the archive fails only in a
  // packaged app, so this is the one place it can be caught before an install. A changed archive fails here too.
  const asked = spawnSync(join(built, 'Contents/MacOS/Baryon'), ['--self-check'], { encoding: 'utf8', timeout: 120000 });
  let answer; try { answer = JSON.parse((asked.stdout || '').trim().split('\n').pop()); } catch { answer = null; }
  if (asked.status !== 0 || !answer?.ok) {
    const failed = answer?.checks?.filter(item => !item.ok).map(item => `  ${item.name}: ${item.error}`).join('\n');
    throw new Error(`The built app failed its own check. Do not install this build.\n${failed || `It quit with ${asked.status ?? asked.signal} and said: ${(asked.stderr || asked.stdout || '').slice(-600)}`}`);
  }
  const requirement = execFileSync(
    '/usr/bin/codesign', ['-d', '-r-', join(apps[0], 'Baryon.app')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (!requirement.includes('certificate') || requirement.includes('cdhash')) {
    throw new Error('Baryon did not receive a stable certificate-based signing identity. Do not install this build.');
  }
  console.log(`\nBuilt: ${built}\nSigned as ${identityName(identities, signingIdentity) || signingIdentity}${hardened ? ', hardened' : ', not hardened'}${notaryProfile ? ', notarized' : ', not notarized'}; fuses locked, code sealed in app.asar, ${answer.checks.length} self-checks passed.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
