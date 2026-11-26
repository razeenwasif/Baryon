import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { kindOf, NEEDS_APPROVAL } from '../desktop/remote-channels.mjs';

// Link security plan, finding 2: a window on another Mac may use only the terminals it started there (each with Touch
// ID), and is sent only their output. main.cjs is read as text, as its other wiring is checked.
test('a face’s window can only reach the terminals it started', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  for (const channel of ['terminal-write', 'terminal-resize', 'terminal-stop']) assert.equal(kindOf(channel), 'remote', channel);
  assert.ok(NEEDS_APPROVAL['terminal-start']([]), 'starting one still needs Touch ID');
  assert.match(main, /const ownTerminal = id => \{ if \(fromRemote\(\) && !remoteTerminals\.has\(id\)\) throw new Error\(/);
  assert.match(main, /handle\('terminal-write', \(id, data\) => terminals\.write\(ownTerminal\(id\), data\)/);
  assert.match(main, /handle\('terminal-resize', \(id, cols, rows\) => terminals\.resize\(ownTerminal\(id\), cols, rows\)/);
  assert.match(main, /handle\('terminal-stop', id => \{ terminals\.stop\(ownTerminal\(id\)\);/);
  // No handler passes a caller's id to the terminals without that check.
  assert.doesNotMatch(main, /terminals\.(write|resize|stop)\(id\b/);
});

test('this Mac’s own terminals’ output stays on this Mac', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  // Output and exit go through terminalNews, which uses the forwarding send only for a terminal a face started.
  assert.match(main, /onData: \(id, data\) => terminalNews\(id, 'fairy:terminal-data', \{ id, data \}\)/);
  assert.match(main, /onExit: \(id, code\) => \{ terminalNews\(id, 'fairy:terminal-exit', \{ id, code \}\); remoteTerminals\.delete\(id\); \}/);
  assert.match(main, /const terminalNews = \(id, channel, value\) => \{\s*if \(remoteTerminals\.has\(id\)\) return sendToWindow\(channel, value\);\s*if \(window && !window\.isDestroyed\(\)\) \(window\.ownSend \?\?/);
  assert.doesNotMatch(main, /sendToWindow\('fairy:terminal-(data|exit)'/);
});
