import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectWorkFolders,
  discoverGitRepos,
  listLocalWorkDir,
  validateRemoteWorkFolder,
} from '../desktop/work-folders.mjs';
import {
  buildSshBrowseArgs,
  createMiniSshBrowser,
  isValidSshHost,
  resolveSshFallback,
} from '../desktop/mini-ssh-browse.mjs';
import {
  buildPathBreadcrumbs,
  filterWorkFolders,
  groupWorkFolders,
} from '../src/work-folder-picker.js';

function makeTempHome(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-work-folders-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test('discoverGitRepos finds nested repos including Applications/flux across depth 1-3 and skips bare/hidden/build dirs', t => {
  const home = makeTempHome(t);
  const dataDir = join(home, 'Library', 'Application Support', 'lyra-companion');
  const repos = [
    join(home, 'Github', 'Photon'),
    join(home, 'Github', 'Applications', 'flux'),
    join(home, 'Github', 'desktop-buddies', 'Lyra'),
    join(home, 'Projects', 'org', 'team', 'deep-app'),
  ];
  for (const r of repos) mkdirSync(join(r, '.git'), { recursive: true });
  // Should be skipped:
  mkdirSync(join(home, 'Github', '.hidden-repo', '.git'), { recursive: true });
  mkdirSync(join(home, 'Github', 'mirror.git', 'objects'), { recursive: true });
  mkdirSync(join(home, 'Github', 'node_modules', 'pkg', '.git'), { recursive: true });
  // Worktree/nested repo inside Photon must not recurse:
  mkdirSync(join(home, 'Github', 'Photon', '.antigravity', 'worktrees', 'feat', '.git'), { recursive: true });
  mkdirSync(join(home, 'Github', 'Photon', 'sub-repo', '.git'), { recursive: true });
  // Symlink should be skipped:
  symlinkSync(join(home, 'Github', 'Applications', 'flux'), join(home, 'Github', 'flux-link'));
  // Data dir inside Library should be skipped:
  mkdirSync(join(dataDir, 'fake-repo', '.git'), { recursive: true });

  const found = discoverGitRepos({ home, dataDir });
  const names = found.map(r => r.name);
  assert.deepEqual(names, ['deep-app', 'flux', 'Lyra', 'Photon']);
  const flux = found.find(r => r.name === 'flux');
  assert.equal(flux.path, join(home, 'Github', 'Applications', 'flux'));
  assert.equal(flux.group, 'Github/Applications');
  assert.equal(flux.repo, true);
  assert.equal(flux.source, 'repo');
});

test('collectWorkFolders removes the 10-item cap and merges recent sessions with discovered Git repos', t => {
  const home = makeTempHome(t);
  const dataDir = join(home, 'Library', 'Application Support', 'lyra-companion');
  const recentPaths = [];
  for (let i = 1; i <= 14; i += 1) {
    const p = join(home, 'Github', `recent-${i}`);
    mkdirSync(p, { recursive: true });
    recentPaths.push(p);
  }
  const fluxPath = join(home, 'Github', 'Applications', 'flux');
  mkdirSync(join(fluxPath, '.git'), { recursive: true });
  // Also make recent-1 a git repo so merge enriches it rather than duplicating.
  mkdirSync(join(recentPaths[0], '.git'), { recursive: true });

  const fakeSessions = recentPaths.map((folder, idx) => ({
    id: `c-${idx}`,
    work: folder.split('/').at(-1),
    updatedAt: `2026-11-${String(idx + 10).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const folderById = new Map(recentPaths.map((folder, idx) => [`c-${idx}`, folder]));

  const list = collectWorkFolders({
    defaultFolder: recentPaths[0],
    sessions: fakeSessions,
    resolveFolder: id => folderById.get(id),
    home,
    dataDir,
  });

  assert.equal(list.length, 15, 'all 14 recent folders + discovered flux kept with no 10-item cap');
  assert.equal(list[0].default, true);
  assert.equal(list[0].repo, true, 'existing recent folder annotated as repo when discovered');
  const flux = list.find(item => item.path === fluxPath);
  assert.ok(flux, 'flux surfaced even though 14 more recent work sessions exist');
  assert.equal(flux.group, 'Github/Applications');
  assert.equal(flux.source, 'repo');
});

test('validateRemoteWorkFolder & listLocalWorkDir enforce home boundary and block secrets/settings', t => {
  const home = makeTempHome(t);
  const dataDir = join(home, 'Library', 'Application Support', 'lyra-companion');
  const flux = join(home, 'Github', 'Applications', 'flux');
  mkdirSync(join(flux, '.git'), { recursive: true });
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const icloudProj = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'NotesProj');
  mkdirSync(icloudProj, { recursive: true });
  writeFileSync(join(home, 'Github', 'file.txt'), 'not a dir');

  assert.equal(validateRemoteWorkFolder(flux, { home, dataDir }), flux);
  assert.equal(validateRemoteWorkFolder(icloudProj, { home, dataDir }), icloudProj);
  for (const bad of [home, '/', '/etc', join(home, '.ssh'), dataDir, join(home, 'Github', 'file.txt'), join(home, 'nope'), '../..']) {
    assert.throws(() => validateRemoteWorkFolder(bad, { home, dataDir }));
  }

  const listing = listLocalWorkDir('~/Github/Applications', { home, dataDir });
  assert.equal(listing.path, join(home, 'Github', 'Applications'));
  assert.equal(listing.canWorkHere, true);
  assert.deepEqual(listing.entries, [{ name: 'flux', path: flux, isRepo: true }]);

  const atHome = listLocalWorkDir('~', { home, dataDir });
  assert.equal(atHome.canWorkHere, false);
  assert.ok(!atHome.entries.some(e => e.name === '.ssh'));
  assert.throws(() => listLocalWorkDir('~/.ssh', { home, dataDir }), /settings or keys/);
});

test('mini-ssh-browse validates hosts/paths without shell injection and handles Tailscale fallback + caching', async () => {
  assert.equal(isValidSshHost('mini'), true);
  assert.equal(isValidSshHost('razeen@kagutsuchi.tailbc1fab.ts.net'), true);
  assert.equal(isValidSshHost('-oProxyCommand=id'), false);
  assert.equal(isValidSshHost('mini; rm -rf ~'), false);

  // Path with hostile shell metacharacters only travels inside base64 payload (`^[A-Za-z0-9+/=]+$`).
  const args = buildSshBrowseArgs({ host: 'mini', path: `~/Github/'; $(id); \`whoami\`\n"` });
  assert.equal(args[0], '-o');
  assert.equal(args[4], '--');
  assert.equal(args[5], 'mini');
  const b64Token = args[6].split(' ').at(-1);
  assert.match(b64Token, /^[A-Za-z0-9+/=]+$/);

  assert.equal(
    resolveSshFallback('mini', { pairedHost: 'kagutsuchi.tailbc1fab.ts.net', sshConfig: () => 'user razeenwasif\n' }),
    'razeenwasif@kagutsuchi.tailbc1fab.ts.net',
  );

  const calls = [];
  const browser = createMiniSshBrowser({
    pairedHost: () => 'kagutsuchi.tailbc1fab.ts.net',
    sshConfig: () => 'user razeenwasif\n',
    runSsh: async (_bin, sshArgs) => {
      const targetHost = sshArgs[5];
      calls.push(targetHost);
      if (targetHost === 'mini') return { code: 255, stdout: '', stderr: 'Connection timed out' };
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          home: '/Users/razeenwasif',
          path: '/Users/razeenwasif/Github/Applications',
          parent: '/Users/razeenwasif/Github',
          canWorkHere: true,
          isRepo: false,
          entries: [{ name: 'flux', path: '/Users/razeenwasif/Github/Applications/flux', isRepo: true }],
        }),
      };
    },
  });

  const first = await browser.browse({ path: '~/Github/Applications' });
  assert.equal(first.host, 'razeenwasif@kagutsuchi.tailbc1fab.ts.net');
  assert.equal(first.via, 'ssh-tailscale');
  assert.equal(first.entries[0].name, 'flux');

  // Second call uses cached Tailscale target directly without wasting 6s timing out on `mini`.
  await browser.browse({ path: '~/Github' });
  assert.deepEqual(calls, ['mini', 'razeenwasif@kagutsuchi.tailbc1fab.ts.net', 'razeenwasif@kagutsuchi.tailbc1fab.ts.net']);
});

test('work-folder-picker pure helpers rank, group, and breadcrumb paths accurately', () => {
  const sample = [
    { path: '/Users/u/Github/default-proj', name: 'default-proj', group: 'Github', default: true, recent: true, repo: true, source: 'recent' },
    { path: '/Users/u/Github/Applications/flux-ui', name: 'flux-ui', group: 'Github/Applications', repo: true, source: 'repo' },
    { path: '/Users/u/Github/Applications/flux', name: 'flux', group: 'Github/Applications', repo: true, source: 'repo' },
  ];
  const filtered = filterWorkFolders(sample, 'flux');
  assert.deepEqual(filtered.map(f => f.name), ['flux', 'flux-ui'], 'exact match ranked ahead of prefix');

  const grouped = groupWorkFolders(sample);
  assert.equal(grouped.recent.length, 1);
  assert.equal(grouped.repos.length, 2);

  const crumbs = buildPathBreadcrumbs('/Users/u/Github/Applications/flux', '/Users/u');
  assert.deepEqual(crumbs, [
    { label: '~', path: '/Users/u' },
    { label: 'Github', path: '/Users/u/Github' },
    { label: 'Applications', path: '/Users/u/Github/Applications' },
    { label: 'flux', path: '/Users/u/Github/Applications/flux' },
  ]);
});
