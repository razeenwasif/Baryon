// `Fairy --self-check`: a packaged Fairy checks that she can reach everything the way she's packed, and quits.
//
// Her code is in one sealed archive and her programs sit beside it (bundle-path.cjs). A path that points the wrong
// side of that line works in a checkout and in every test, and fails only in the installed app, when the feature is
// used. So the build (scripts/package-fairy.mjs) starts the finished app with this flag and refuses a build that
// fails. It opens no window you can see, takes no lock, and touches no data: its browser storage is a folder it makes
// and removes. It prints one line of JSON, { ok, checks: [{ name, ok, error? }] }, and exits 0 or 1.
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { constants, mkdirSync } = require('node:fs');
const { access, copyFile, mkdtemp, readdir, readFile } = require('node:fs/promises');
const childProcess = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const { nativeBin, beside } = require('./bundle-path.cjs');

const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms).unref())]);

async function selfCheck({ app, BrowserWindow, nativeImage }) {
  const guard = require('./helper-guard.cjs').install();
  const scratch = await mkdtemp(join(tmpdir(), 'fairy-self-check-'));
  mkdirSync(join(scratch, 'browser'));
  app.setPath('userData', join(scratch, 'browser'));
  app.dock?.hide();
  // Closing the one hidden window mustn't quit the app (with 0) before the answer is given.
  app.on('window-all-closed', () => {});
  const { FEATURES } = await import('./edition.mjs');
  const checks = [];
  const check = async (name, run) => {
    try { await within(Promise.resolve().then(run), 15000, name); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, error: String(error?.message || error) }); }
  };

  await check('the code is read from the archive', async () => {
    if (app.isPackaged && !/[\\/]app\.asar[\\/]/.test(__filename)) throw new Error(`running from ${__dirname}, not from app.asar`);
    JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf8'));
  });
  await check('every helper program is beside the archive and can be started', async () => {
    const names = await readdir(nativeBin(''));
    if (!names.includes('fairy-desktop')) throw new Error('the helpers folder has no fairy-desktop');
    for (const name of names) await access(nativeBin(name), name.endsWith('.node') ? constants.R_OK : constants.X_OK);
    if (/[\\/]app\.asar[\\/]/.test(nativeBin('fairy-desktop'))) throw new Error('helper paths point inside the archive');
  });
  await check('her own programs are checked before they start', () => {
    if (app.isPackaged && require('../package.json').signedByTeam && !guard.enforcing) throw new Error('this build names a team, but the guard is off');
    if (!guard.enforcing) return;
    if (!childProcess.spawn.fairyGuarded) throw new Error('spawn isn’t the guarded one');
    if (!guard.allowed(nativeBin('fairy-idle'))) throw new Error('fairy-idle doesn’t pass as signed by her team');
    guard.assertTrusted(beside(`node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`));
  });
  await check('a helper starts and answers', () => new Promise((resolve, reject) => {
    const child = childProcess.spawn(nativeBin('fairy-idle'), ['200'], { stdio: ['pipe', 'pipe', 'ignore'] });
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`fairy-idle quit with ${code} before answering`)));
    child.stdout.once('data', () => { child.removeAllListeners('exit'); child.kill(); resolve(); });
  }));
  await check('the notch module loads', () => { require(nativeBin('fairy-notch.node')); });
  await check('Codex’s program is beside the archive', async () => {
    const { codexExecutable } = await import('./codex.mjs');
    await access(codexExecutable(), constants.X_OK);
  });
  await check('a terminal starts', () => new Promise((resolve, reject) => {
    let said = '';
    const shell = require('node-pty').spawn('/bin/echo', ['fairy'], { cols: 80, rows: 24, cwd: tmpdir(), env: {} });
    shell.onData(data => { said += data; });
    shell.onExit(({ exitCode }) => (said.includes('fairy') ? resolve() : reject(new Error(`echo printed ${JSON.stringify(said)} and quit with ${exitCode}`))));
  }));
  await check('math is read aloud (KaTeX and the speech rules load)', async () => {
    const speech = await import('./math-speech.mjs');
    await speech.loadMathSpeech();
    const spoken = speech.mathSpeech('x^2');
    if (!/x/i.test(String(spoken))) throw new Error(`x^2 came out as ${JSON.stringify(spoken)}`);
  });
  await check('pages and notes render (markdown-it loads)', async () => {
    const { docPage } = await import('./page-types.mjs');
    if (!String(docPage('# Title')).includes('Title')) throw new Error('rendered nothing');
    if (FEATURES.notebooks) {
      const { phoneHTML } = await import('./notebook/phone-html.mjs');
      if (!/<strong>bold<\/strong>.*katex/.test(phoneHTML('**bold** $x$').html)) throw new Error('rendered nothing');
    }
  });
  await check('a worker runs from the archive and finds a helper', () => new Promise((resolve, reject) => {
    const worker = new Worker(pathToFileURL(join(__dirname, 'self-check-worker.mjs')));
    worker.once('message', message => {
      if (!message?.ok) return reject(new Error(message?.error || 'the worker answered without ok'));
      if (message.enforcing !== guard.enforcing || message.guarded !== guard.enforcing) return reject(new Error('the worker isn’t checking helpers the way the main process is'));
      resolve();
    });
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`the worker quit with ${code} before answering`)));
  }));
  if (FEATURES.research) {
    await check('a file is copied out of the archive (the cluster helper)', async () => {
      const { HELPER } = await import('./research/cluster.mjs');
      await copyFile(HELPER, join(scratch, 'proton_lab.py'));
      if (!(await readFile(join(scratch, 'proton_lab.py'), 'utf8')).length) throw new Error('the copy is empty');
    });
  }
  await check('the tray picture loads', () => {
    if (nativeImage.createFromPath(beside('assets/tray/trayTemplate.png')).isEmpty()) throw new Error('the picture is empty');
  });
  await check('the Vorssaint helper is signed and executable (when bundled)', async () => {
    const names = await readdir(nativeBin(''));
    if (!names.includes('baryon-vorssaint')) return;
    const bin = nativeBin('baryon-vorssaint');
    await access(bin, constants.X_OK);
    if (guard.enforcing && !guard.allowed(bin)) throw new Error('baryon-vorssaint doesn’t pass as signed by her team');
  });
  await check('her window’s page loads from the archive', async () => {
    await app.whenReady();
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    try {
      await window.loadFile(join(__dirname, '../dist/index.html'));
      const page = await readFile(join(__dirname, '../dist/index.html'), 'utf8');
      if (!/<script/.test(page)) throw new Error('dist/index.html has no script');
    } finally { window.destroy(); }
  });

  const ok = checks.every(item => item.ok);
  process.stdout.write(`${JSON.stringify({ ok, checks })}\n`);
  // Chromium writes to its folder until the process is gone, so the folder is removed just after, by a shell that outlives it.
  childProcess.spawn('/bin/sh', ['-c', 'sleep 2; /bin/rm -rf "$1"', 'sh', scratch], { detached: true, stdio: 'ignore' }).unref();
  app.exit(ok ? 0 : 1);
}

module.exports = { selfCheck };
