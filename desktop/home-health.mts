// Fairy away from the mini, step Away 1: whether the Mac Fairy lives on will look after itself while you're away, for
// "Check before you leave" in a face's menu. Each check reads one of macOS's own reports; nothing here changes a setting.
// run(command, args) is passed in and resolves { code, stdout } (it never throws), so tests feed it saved output.
// The checks run only when asked, and each command at most once per report.

import { execFile } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult> | CommandResult;

export interface SignInStatus {
  id: string;
  name: string;
  ok: boolean;
}

export interface HealthCheckItem {
  id: string;
  ok: boolean | null;
  label: string;
  fix: string;
}

export interface HealthReportOptions {
  run: CommandRunner;
  signIns?: readonly SignInStatus[];
  version?: string;
  startedAt?: number;
  now?: number;
  uid?: number;
}

export interface TailscaleStatusSummary {
  running: boolean;
  online: boolean;
  keyExpiry: Date | null;
}

export const TAILSCALE = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
export const KEEPALIVE_LABEL = 'dev.razeen.fairy.keepalive';

// `pmset -g custom`: the mains-power section's settings, as numbers (the whole text when it has no sections).
export function parsePmset(text: unknown): Record<string, number> {
  const all = String(text ?? ''), ac = /AC Power:\n([\s\S]*?)(?:\n\S|$)/.exec(all)?.[1] ?? all;
  const settings: Record<string, number> = {};
  for (const [, name, value] of ac.matchAll(/^\s*([A-Za-z][A-Za-z ]*?)\s+(-?\d+)\s*$/gm)) settings[name.trim()] = Number(value);
  return settings;
}
// `pmset -g batt`: whether it's drawing from mains power.
export const parseBattery = (text: unknown): { mains: boolean } => ({ mains: /'AC Power'/.test(String(text ?? '')) });
// `tailscale status --json`: running and online, and when this Mac's key expires (null: it doesn't).
export function parseTailscale(json: unknown): TailscaleStatusSummary {
  let data: { BackendState?: unknown; Self?: { Online?: unknown; KeyExpiry?: string } } | null = null;
  try { data = (typeof json === 'string' ? JSON.parse(json) : json) as { BackendState?: unknown; Self?: { Online?: unknown; KeyExpiry?: string } } | null; } catch { data = null; }
  const self = data?.Self ?? {}, expiry = self.KeyExpiry ? new Date(self.KeyExpiry) : null;
  return { running: data?.BackendState === 'Running', online: self.Online === true, keyExpiry: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null };
}
// `fdesetup status`.
export const parseFdesetup = (text: unknown): { on: boolean } => ({ on: /FileVault is On/.test(String(text ?? '')) });

const day = 86_400_000;
const when = (date: Date): string => date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
const howLong = (ms: number): string => { const hours = Math.floor(ms / 3_600_000); return hours >= 48 ? `${Math.floor(hours / 24)} days` : hours >= 1 ? `${hours} h` : `${Math.max(1, Math.floor(ms / 60_000))} min`; };

// Returns [{ id, ok, label, fix }]: ok is true, false (with a fix to make), or null for something to know rather than fix.
// signIns: [{ id, name, ok }] from the full Fairy; uid: this user's id, for the launch agent's domain.
export async function healthReport({ run, signIns = [], version = '', startedAt = Date.now(), now = Date.now(), uid = process.getuid?.() ?? 501 }: HealthReportOptions): Promise<HealthCheckItem[]> {
  const asked = new Map<string, Promise<CommandResult>>();
  const once = (command: string, args: readonly string[]): Promise<CommandResult> => {
    const key = [command, ...args].join(' ');
    if (!asked.has(key)) asked.set(key, Promise.resolve(run(command, args)).catch(() => ({ code: 1, stdout: '' })));
    return asked.get(key)!;
  };
  const [power, battery, agent, tailscale, vault, sharing, login] = await Promise.all([
    once('pmset', ['-g', 'custom']), once('pmset', ['-g', 'batt']), once('launchctl', ['print', `gui/${uid}/${KEEPALIVE_LABEL}`]),
    once(TAILSCALE, ['status', '--json']), once('fdesetup', ['status']), once('launchctl', ['print', 'system/com.apple.screensharing']),
    once('nc', ['-z', '-G', '2', '127.0.0.1', '22'])]);
  const checks: HealthCheckItem[] = [];
  const pm = parsePmset(power.stdout), awake = pm.sleep === 0, restarts = pm.autorestart === 1;
  checks.push({ id: 'power', ok: awake && restarts,
    label: awake && restarts ? 'Never sleeps, and starts again after a power cut' : !awake ? 'Goes to sleep when idle' : 'Doesn’t start again after a power cut',
    fix: awake && restarts ? '' : 'On the mini, run: sudo pmset -a sleep 0 disksleep 0 womp 1 autorestart 1' });
  const mains = parseBattery(battery.stdout).mains;
  checks.push({ id: 'mains', ok: mains, label: mains ? 'On mains power' : 'Not on mains power', fix: mains ? '' : 'Plug the mini in.' });
  const kept = agent.code === 0;
  checks.push({ id: 'keepalive', ok: kept, label: kept ? 'Fairy starts at login and again after a crash' : 'Fairy isn’t started again if she crashes',
    fix: kept ? '' : 'From the MacBook, in the Lyra folder: node scripts/fairy-keepalive.mjs install --host mini' });
  const ts = parseTailscale(tailscale.stdout);
  const up = ts.running && ts.online, expires = ts.keyExpiry, soon = expires && expires.getTime() - now < 14 * day;
  checks.push({ id: 'tailscale', ok: up && !expires,
    label: !up ? 'Tailscale isn’t connected' : expires ? `Tailscale’s key expires on ${when(expires)}${soon ? ', soon' : ''}` : 'Tailscale is on, and its key doesn’t expire',
    fix: !up ? 'Open Tailscale on the mini and sign in.' : expires ? 'Turn off key expiry for the mini in Tailscale’s admin page.' : '' });
  const encrypted = parseFdesetup(vault.stdout).on;
  checks.push({ id: 'filevault', ok: null, label: encrypted ? 'FileVault is on: after a power cut the mini waits at its login screen until it’s unlocked there' : 'FileVault is off: the mini starts by itself after a power cut', fix: '' });
  for (const item of signIns) checks.push({ id: `sign-in-${item.id}`, ok: item.ok === true, label: `${item.name}: ${item.ok ? 'signed in' : 'not signed in'}`, fix: item.ok ? '' : `Sign in to ${item.name} on the mini, over Screen Sharing.` });
  const shared = sharing.code === 0, remote = login.code === 0;
  checks.push({ id: 'screen-sharing', ok: shared, label: shared ? 'Screen Sharing is on' : 'Screen Sharing is off', fix: shared ? '' : 'On the mini: System Settings, General, Sharing, Screen Sharing.' });
  checks.push({ id: 'remote-login', ok: remote, label: remote ? 'Remote Login is on' : 'Remote Login is off', fix: remote ? '' : 'On the mini: System Settings, General, Sharing, Remote Login.' });
  checks.push({ id: 'version', ok: null, label: `Fairy ${version || ''} on the mini, up ${howLong(Math.max(0, now - startedAt))}`.replace('  ', ' '), fix: '' });
  return checks;
}

// The real run(): a command's exit code and output, given 5 seconds; a missing command or a timeout is a failure, not a throw.
export function runCommand(command: string, args: readonly string[], { timeoutMs = 5000 }: { timeoutMs?: number } = {}): Promise<CommandResult> {
  return new Promise(resolve => execFile(command, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) =>
    resolve({ code: error ? (typeof error.code === 'number' && Number.isInteger(error.code) ? error.code : 1) : 0, stdout: String(stdout ?? '') })));
}
