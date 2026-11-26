// Fairy away from the mini, Away 1: "Check before you leave" (desktop/home-health.mjs), on saved real output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { healthReport, KEEPALIVE_LABEL, parseBattery, parseFdesetup, parsePmset, parseTailscale, TAILSCALE } from '../desktop/home-health.mjs';

// The mini, 15 Nov 2026.
const MINI_PMSET = `AC Power:
 Sleep On Power Button 1
 autorestartatconnect 0
 lowpowermode         0
 standby              0
 ttyskeepawake        1
 powernap             1
 displaysleep         10
 womp                 1
 networkoversleep     0
 sleep                0
 tcpkeepalive         1
 autorestart          1
 disksleep            0
`;
// A laptop on battery that sleeps, with both sections.
const LAPTOP_PMSET = `Battery Power:
 sleep                1
 autorestart          0
 displaysleep         2
AC Power:
 sleep                10
 autorestart          0
 displaysleep         10
`;
const MINI_TAILSCALE = JSON.stringify({ BackendState: 'Running', Self: { Online: true, KeyExpiry: '2027-05-13T22:57:24Z', Relay: 'syd', CurAddr: '' } });
const NO_EXPIRY = JSON.stringify({ BackendState: 'Running', Self: { Online: true } });
const NOW = Date.parse('2026-11-15T07:00:00Z');

test('pmset’s mains section is read as numbers; a laptop’s battery section doesn’t count', () => {
  const mini = parsePmset(MINI_PMSET);
  assert.equal(mini.sleep, 0); assert.equal(mini.autorestart, 1); assert.equal(mini.disksleep, 0); assert.equal(mini['Sleep On Power Button'], 1);
  const laptop = parsePmset(LAPTOP_PMSET);
  assert.equal(laptop.sleep, 10); assert.equal(laptop.autorestart, 0);
  assert.deepEqual(parsePmset(''), {});
  assert.equal(parseBattery("Now drawing from 'AC Power'\n").mains, true);
  assert.equal(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t84%; discharging").mains, false);
});

test('Tailscale: running and online, and when the key expires, or that it doesn’t', () => {
  const mini = parseTailscale(MINI_TAILSCALE);
  assert.equal(mini.running, true); assert.equal(mini.online, true); assert.equal(mini.keyExpiry.toISOString(), '2027-05-13T22:57:24.000Z');
  assert.equal(parseTailscale(NO_EXPIRY).keyExpiry, null);
  assert.deepEqual(parseTailscale('not json'), { running: false, online: false, keyExpiry: null });
  assert.equal(parseTailscale(JSON.stringify({ BackendState: 'Stopped', Self: {} })).running, false);
  assert.equal(parseFdesetup('FileVault is On.\n').on, true);
  assert.equal(parseFdesetup('FileVault is Off.\n').on, false);
});

// A stand-in for macOS: each command's saved answer, and how many times it was asked.
function mac(answers) {
  const asked = [];
  return { asked, run: async (command, args) => { const key = [command, ...args].join(' '); asked.push(key); return answers[key] ?? { code: 1, stdout: '' }; } };
}
const READY = {
  'pmset -g custom': { code: 0, stdout: MINI_PMSET }, 'pmset -g batt': { code: 0, stdout: "Now drawing from 'AC Power'\n" },
  [`launchctl print gui/501/${KEEPALIVE_LABEL}`]: { code: 0, stdout: '' }, [`${TAILSCALE} status --json`]: { code: 0, stdout: NO_EXPIRY },
  'fdesetup status': { code: 0, stdout: 'FileVault is On.\n' }, 'launchctl print system/com.apple.screensharing': { code: 0, stdout: '' },
  'nc -z -G 2 127.0.0.1 22': { code: 0, stdout: '' },
};
const SIGNED_IN = [{ id: 'claude', name: 'Claude Code', ok: true }, { id: 'codex', name: 'Codex', ok: true }, { id: 'google', name: 'Google', ok: true }, { id: 'voice', name: 'Her voice', ok: true }];

test('a mini that will look after itself: a tick for each line, and FileVault and the version to know', async () => {
  const { run, asked } = mac(READY);
  const checks = await healthReport({ run, signIns: SIGNED_IN, version: '1.4.0', startedAt: NOW - 3 * 3_600_000, now: NOW, uid: 501 });
  assert.deepEqual(checks.filter(check => check.ok === false), []);
  assert.deepEqual(checks.filter(check => check.ok === null).map(check => check.id), ['filevault', 'version']);
  assert.match(checks.find(check => check.id === 'filevault').label, /waits at its login screen/);
  assert.equal(checks.find(check => check.id === 'version').label, 'Fairy 1.4.0 on the mini, up 3 h');
  assert.equal(new Set(asked).size, asked.length, 'no command is run twice in one report');
  assert.equal(asked.length, 7);
});

test('each problem names its fix: sleep, battery, no keep-alive, an expiring key, a sign-in, sharing off', async () => {
  const { run } = mac({ ...READY, 'pmset -g custom': { code: 0, stdout: LAPTOP_PMSET }, 'pmset -g batt': { code: 0, stdout: "Now drawing from 'Battery Power'" },
    [`launchctl print gui/501/${KEEPALIVE_LABEL}`]: { code: 113, stdout: '' }, [`${TAILSCALE} status --json`]: { code: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { Online: true, KeyExpiry: '2026-11-20T00:00:00Z' } }) },
    'launchctl print system/com.apple.screensharing': { code: 113, stdout: '' }, 'nc -z -G 2 127.0.0.1 22': { code: 1, stdout: '' } });
  const checks = await healthReport({ run, signIns: [{ id: 'claude', name: 'Claude Code', ok: false }], now: NOW, startedAt: NOW, uid: 501 });
  const failed = Object.fromEntries(checks.filter(check => check.ok === false).map(check => [check.id, check]));
  assert.deepEqual(Object.keys(failed).sort(), ['keepalive', 'mains', 'power', 'remote-login', 'screen-sharing', 'sign-in-claude', 'tailscale']);
  assert.match(failed.power.fix, /sudo pmset -a sleep 0 disksleep 0 womp 1 autorestart 1/);
  assert.match(failed.keepalive.fix, /fairy-keepalive\.mjs install --host mini/);
  assert.match(failed.tailscale.label, /expires on 20 November 2026, soon/);
  assert.match(failed.tailscale.fix, /key expiry/);
  assert.match(failed['sign-in-claude'].fix, /Screen Sharing/);
  for (const check of Object.values(failed)) assert.ok(check.fix, check.id);
});

test('the mini’s real Tailscale key is reported with its date, and a command that fails is a cross, not a crash', async () => {
  const { run } = mac({ ...READY, [`${TAILSCALE} status --json`]: { code: 0, stdout: MINI_TAILSCALE } });
  const checks = await healthReport({ run, now: NOW, startedAt: NOW, uid: 501 });
  // 22:57 UTC on 13 May, so the date shown depends on this Mac's time zone.
  assert.match(checks.find(check => check.id === 'tailscale').label, /expires on 1[34] May 2027$/);
  const broken = await healthReport({ run: async () => { throw new Error('gone'); }, now: NOW, startedAt: NOW, uid: 501 });
  assert.equal(broken.find(check => check.id === 'power').ok, false);
  assert.equal(broken.find(check => check.id === 'tailscale').ok, false);
});
