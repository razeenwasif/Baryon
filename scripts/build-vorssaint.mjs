// Builds Vorssaint (~/Github/Applications/vorssaint-utils) into native/bin/baryon-vorssaint via SwiftPM and signs it.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeveloperID, preferredIdentity, selectSigningIdentity } from './signing-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vorssaintRepo = process.env.VORSSAINT_REPO
  ? resolve(process.env.VORSSAINT_REPO)
  : resolve(root, '..', '..', 'Applications', 'vorssaint-utils');
const entitlements = join(vorssaintRepo, 'Resources', 'Vorssaint.entitlements');
const target = join(root, 'native', 'bin', 'baryon-vorssaint');

if (!existsSync(join(vorssaintRepo, 'Package.swift'))) {
  console.error(`vorssaint-utils Package.swift not found at ${vorssaintRepo}. Set VORSSAINT_REPO or clone vorssaint-utils there.`);
  process.exit(1);
}

try {
  execFileSync('swift', ['build', '-c', 'release', '--product', 'Vorssaint'], {
    cwd: vorssaintRepo,
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'swift wasn’t found.' : 'Vorssaint Swift build failed.');
  process.exit(1);
}

const binDir = execFileSync('swift', ['build', '-c', 'release', '--show-bin-path'], {
  cwd: vorssaintRepo,
  encoding: 'utf8',
}).trim();
const built = join(binDir, 'Vorssaint');
if (!existsSync(built)) {
  console.error(`Expected Vorssaint binary at ${built}, but it was not found.`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(built, target);
chmodSync(target, 0o755);

const identitiesOutput = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
const requested = process.env.STELLA_SIGN_IDENTITY || preferredIdentity(identitiesOutput);
const identity = selectSigningIdentity(identitiesOutput, requested);
const signArgs = ['--force', '--sign', identity];
if (existsSync(entitlements)) signArgs.push('--entitlements', entitlements);
if (isDeveloperID(requested) || process.env.VORSSAINT_HARDENED === '1') {
  signArgs.push('--options', 'runtime', '--timestamp');
}
signArgs.push(target);

execFileSync('/usr/bin/codesign', signArgs, { stdio: 'inherit' });
console.log(`Built and signed ${target} (${requested})`);
