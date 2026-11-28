// Browses directories on the Mac mini over SSH (`ssh -o BatchMode=yes`) for Fairy's face window,
// with automatic Tailscale fallback when the home SSH alias (`mini`) isn't reachable.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface SshRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MiniSshBrowseEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface MiniSshBrowseResponse {
  ok: boolean;
  home?: string;
  path?: string;
  parent?: string | null;
  canWorkHere?: boolean;
  isRepo?: boolean;
  entries: MiniSshBrowseEntry[];
  error?: string;
  host: string;
  via: string;
}

export interface CreateMiniSshBrowserOptions {
  sshBin?: string;
  pairedHost?: () => string;
  runSsh?: (bin: string, args: string[], options?: { timeoutMs?: number }) => Promise<SshRunResult>;
  sshConfig?: () => string;
}

const DEFAULT_HOST = 'mini';
const SSH_HOST_RE = /^[A-Za-z0-9._@-]+$/;
const PAIRED_HOST_RE = /^[A-Za-z0-9.-]+$/;

// Clean multi-line Python executed via `python3 -c 'import base64,sys;exec(base64.b64decode(sys.argv[1]))' <SCRIPT_B64> <PAYLOAD_B64>`.
// Both arguments match `^[A-Za-z0-9+/=]+$` and the `-c` runner has zero inner quotes, completely avoiding POSIX shell quoting issues.
const REMOTE_BROWSE_PY = `
import base64, json, os, sys

p = json.loads(base64.b64decode(sys.argv[2]).decode('utf-8'))
home = os.path.realpath(os.path.expanduser('~'))
raw = (p.get('path') or '').strip()
hidden = bool(p.get('showHidden'))
bad = {'.ssh', '.gnupg', '.aws', '.gemini', '.claude', '.codex', '.config', 'Library'}
icloud = os.path.join('Library', 'Mobile Documents', 'com~apple~CloudDocs')

def allowed_rel(r):
  if not r or r == '.':
    return True
  if r == icloud or r.startswith(icloud + os.sep):
    return True
  return r.split(os.sep, 1)[0] not in bad

def out(obj):
  print(json.dumps(obj))
  sys.exit(0)

if not raw:
  cand = os.path.join(home, 'Github')
  raw = cand if os.path.isdir(cand) else home
elif raw == '~':
  raw = home
elif raw.startswith('~/'):
  raw = os.path.join(home, raw[2:])

try:
  target = os.path.realpath(raw)
  if not os.path.isdir(target):
    raise OSError('Folder not found on mini.')
except Exception:
  out({'ok': False, 'error': 'Folder not found on mini.'})

rel = os.path.relpath(target, home)
if rel == '..' or rel.startswith('..' + os.sep) or os.path.isabs(rel):
  out({'ok': False, 'error': 'Choose a folder inside your home folder on the mini.'})

if not allowed_rel('' if target == home else rel):
  out({'ok': False, 'error': 'Choose a project folder, not one that holds your settings or keys.'})

lyra = os.path.realpath(os.path.join(home, 'Library', 'Application Support', 'lyra-companion'))
if target == lyra or target.startswith(lyra + os.sep):
  out({'ok': False, 'error': 'Choose a folder outside Fairy’s own data.'})

entries = []
try:
  with os.scandir(target) as it:
    for e in it:
      if e.is_symlink() or not e.is_dir(follow_symlinks=False):
        continue
      n = e.name
      if n == '.git' or (not hidden and n.startswith('.')):
        continue
      if target == home and n in bad:
        continue
      ep = os.path.join(target, n)
      entries.append({'name': n, 'path': ep, 'isRepo': os.path.exists(os.path.join(ep, '.git'))})
except PermissionError:
  out({'ok': False, 'error': 'Permission denied reading that folder on mini.'})

entries.sort(key=lambda x: (x['name'].lower(), x['name']))
entries = entries[:400]
parent = None if target == home else os.path.dirname(target)
out({
  'ok': True,
  'home': home,
  'path': target,
  'parent': parent,
  'canWorkHere': target != home,
  'isRepo': os.path.exists(os.path.join(target, '.git')),
  'entries': entries,
})
`.trim();

const REMOTE_SCRIPT_B64 = Buffer.from(REMOTE_BROWSE_PY, 'utf8').toString('base64');

export function isValidSshHost(host: unknown): host is string {
  return typeof host === 'string' && host.length > 0 && host.length <= 253 && SSH_HOST_RE.test(host) && !host.startsWith('-');
}

export function resolveSshFallback(host: string, {
  pairedHost = '',
  sshConfig = () => spawnSync(existsSync('/usr/bin/ssh') ? '/usr/bin/ssh' : 'ssh', ['-G', host], { encoding: 'utf8', timeout: 2500 }).stdout || '',
}: { pairedHost?: string; sshConfig?: () => string } = {}): string | null {
  const name = String(pairedHost || '').trim();
  if (!name || !PAIRED_HOST_RE.test(name) || name === host) return null;
  let user = '';
  try { user = /^user (\S+)$/m.exec(sshConfig() || '')?.[1] || ''; } catch { user = ''; }
  return user && /^[A-Za-z0-9._-]+$/.test(user) ? `${user}@${name}` : name;
}

export function buildSshBrowseArgs({ host = DEFAULT_HOST, path = '', showHidden = false }: { host?: string; path?: string; showHidden?: boolean } = {}): string[] {
  const cleanHost = String(host || DEFAULT_HOST).trim();
  if (!isValidSshHost(cleanHost)) throw new Error('Enter a valid SSH host name (for example “mini”).');
  const reqPath = String(path ?? '');
  if (reqPath.includes('\0') || reqPath.length > 1024) throw new Error('That folder path isn’t valid.');
  const payloadB64 = Buffer.from(JSON.stringify({ path: reqPath, showHidden: Boolean(showHidden) }), 'utf8').toString('base64');
  const remoteCmd = `/usr/bin/python3 -c 'import base64,sys;exec(base64.b64decode(sys.argv[1]))' ${REMOTE_SCRIPT_B64} ${payloadB64}`;
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '--', cleanHost, remoteCmd];
}

function defaultRunSsh(bin: string, args: string[], { timeoutMs = 8000 }: { timeoutMs?: number } = {}): Promise<SshRunResult> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const done = (res: SshRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      done({ code: 255, stdout, stderr: stderr || 'SSH timed out.' });
    }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (stdout.length < 512_000) stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 16_384) stderr += chunk; });
    child.on('error', err => done({ code: 255, stdout, stderr: err.message }));
    child.on('close', code => done({ code: code ?? 1, stdout, stderr }));
  });
}

export function createMiniSshBrowser({
  sshBin = existsSync('/usr/bin/ssh') ? '/usr/bin/ssh' : 'ssh',
  pairedHost = () => '',
  runSsh = defaultRunSsh,
  sshConfig,
}: CreateMiniSshBrowserOptions = {}): {
  browse: (opts?: { path?: string; host?: string; showHidden?: boolean }) => Promise<MiniSshBrowseResponse>;
} {
  let cachedDefaultHost = '';

  async function browse({ path = '', host = '', showHidden = false }: { path?: string; host?: string; showHidden?: boolean } = {}): Promise<MiniSshBrowseResponse> {
    const requestedHost = String(host || '').trim();
    const initialHost = requestedHost || cachedDefaultHost || DEFAULT_HOST;
    let usedHost = initialHost;
    let via = cachedDefaultHost && !requestedHost && cachedDefaultHost !== DEFAULT_HOST ? 'ssh-tailscale' : 'ssh';

    const args = buildSshBrowseArgs({ host: usedHost, path, showHidden });
    let result = await runSsh(sshBin, args, { timeoutMs: 8000 });

    if (result.code === 255 && !requestedHost) {
      // If cached fallback went stale (e.g. returned to LAN), retry primary `mini`; otherwise try Tailscale fallback.
      const fallbackHost = usedHost === DEFAULT_HOST
        ? resolveSshFallback(DEFAULT_HOST, { pairedHost: pairedHost(), sshConfig })
        : DEFAULT_HOST;
      if (fallbackHost && isValidSshHost(fallbackHost) && fallbackHost !== usedHost) {
        const retryArgs = buildSshBrowseArgs({ host: fallbackHost, path, showHidden });
        const retry = await runSsh(sshBin, retryArgs, { timeoutMs: 8000 });
        if (retry.code !== 255 || !result.stderr) {
          result = retry;
          usedHost = fallbackHost;
          via = fallbackHost === DEFAULT_HOST ? 'ssh' : 'ssh-tailscale';
        }
      }
    }

    const line = String(result.stdout || '').trim().split(/\r?\n/).find(Boolean) || '';
    let parsed: (Omit<MiniSshBrowseResponse, 'host' | 'via'>) | null = null;
    if (line) {
      try { parsed = JSON.parse(line) as Omit<MiniSshBrowseResponse, 'host' | 'via'>; } catch {}
    }

    if (parsed && parsed.ok === false) {
      throw new Error(parsed.error || 'Could not browse folders on the mini.');
    }
    if (result.code !== 0 || !parsed || !Array.isArray(parsed.entries)) {
      const detail = String(result.stderr || '').trim().replace(/\s+/g, ' ').slice(0, 180);
      throw new Error(detail ? `Couldn’t browse ${usedHost} over SSH (${detail}).` : `Couldn’t browse ${usedHost} over SSH.`);
    }

    if (!requestedHost) cachedDefaultHost = usedHost;
    return { ...parsed, host: usedHost, via };
  }

  return { browse };
}
