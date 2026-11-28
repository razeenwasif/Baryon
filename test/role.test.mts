import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { readRole, writeRole } = require('../desktop/role.cjs');

test('a role is home unless the file or FAIRY_ROLE says face, and the environment wins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-role-'));
  try {
    assert.equal(readRole({ userData: dir, env: {} }), 'home');
    writeRole(dir, 'face');
    assert.equal(readRole({ userData: dir, env: {} }), 'face');
    assert.equal(readRole({ userData: dir, env: { FAIRY_ROLE: 'home' } }), 'home');
    assert.equal(readRole({ userData: join(dir, 'none'), env: { FAIRY_ROLE: 'face' } }), 'face');
    // Anything else in the environment is ignored, and a damaged or strange file means home.
    assert.equal(readRole({ userData: dir, env: { FAIRY_ROLE: 'mini' } }), 'face');
    await writeFile(join(dir, 'role.json'), '{"role":"tablet"}');
    assert.equal(readRole({ userData: dir, env: {} }), 'home');
    await writeFile(join(dir, 'role.json'), 'not json');
    assert.equal(readRole({ userData: dir, env: {} }), 'home');
    assert.throws(() => writeRole(dir, 'tablet'), /home or face/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('main.cjs hands a face over before it takes the single-instance lock or waits for Electron', async () => {
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  const branch = main.indexOf("require('./role.cjs').readRole({ userData: app.getPath('userData') }) === 'face'");
  assert.ok(branch > 0);
  assert.ok(branch > main.indexOf("app.setPath('userData'"), 'after the user-data folder is chosen');
  assert.ok(branch < main.indexOf('app.requestSingleInstanceLock()'));
  assert.ok(branch < main.indexOf('app.whenReady()'));
  assert.match(main.slice(branch, branch + 200), /require\('\.\/face-main\.cjs'\)\.start\(\{ app \}\);\s*earlyExit = true;/);
  // Becoming a face asks first, then restarts with the role written.
  assert.match(main, /handle\('role-set-face'[\s\S]{0,700}showMessageBox[\s\S]{0,700}writeRole\(app\.getPath\('userData'\), 'face'\)[\s\S]{0,80}app\.relaunch\(\);\s*app\.quit\(\);/);
});
