import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVorssaintBridge } from '../desktop/vorssaint-bridge.mjs';

test('vorssaint bridge creates 0600 socket, completes hello handshake, ping/pong, and tolerates malformed JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-bridge-'));
  const sock = join(dir, 'vorssaint.sock');
  const received = [];
  const bridge = createVorssaintBridge({
    socketPath: sock,
    role: 'face',
    onMessage: msg => received.push(msg),
  });

  try {
    await bridge.start();
    const mode = statSync(sock).mode & 0o777;
    assert.equal(mode, 0o600, 'socket should be user-only 0600');

    const messages = [];
    const client = net.createConnection(sock);
    client.setEncoding('utf8');
    let buf = '';
    client.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) messages.push(JSON.parse(line));
      }
    });

    await new Promise(resolve => client.once('connect', resolve));
    client.write('not-json\n');
    client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 12345, protocol: 1, keptFeatures: ['notch', 'commandBar'] })}\n`);
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(messages[0].type, 'error');
    assert.equal(messages[1].type, 'hello.ack');
    assert.equal(messages[1].app, 'Baryon');
    assert.equal(messages[1].role, 'face');
    assert.equal(bridge.state().connected, true);
    assert.deepEqual(bridge.state().keptFeatures, ['notch', 'commandBar']);

    bridge.send({ type: 'ping' });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(messages.some(m => m.type === 'ping'), true);

    client.write(`${JSON.stringify({ type: 'pong', ts: 99 })}\n`);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(received[0], { type: 'pong', ts: 99 });

    client.destroy();
  } finally {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vorssaint bridge supervises child process, writes lockfile, and shuts down cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-sup-'));
  const sock = join(dir, 'vorssaint.sock');
  const lock = join(dir, 'vorssaint.lock');
  const script = join(dir, 'mock-helper.mjs');

  writeFileSync(script, `#!/usr/bin/env node
import net from 'node:net';
const idx = process.argv.indexOf('--socket');
const sock = process.argv[idx + 1];
const c = net.createConnection(sock, () => {
  c.write(JSON.stringify({ type: 'hello', app: 'vorssaint', pid: process.pid, protocol: 1, keptFeatures: ['notch'] }) + '\\n');
});
let b = '';
c.on('data', d => {
  b += d.toString('utf8');
  for (const line of b.split('\\n')) {
    if (line.includes('"shutdown"')) process.exit(0);
  }
});
`);
  chmodSync(script, 0o755);

  const states = [];
  const bridge = createVorssaintBridge({
    socketPath: sock,
    binaryPath: script,
    lockPath: lock,
    onStateChange: s => states.push(s),
  });

  try {
    await bridge.start();
    const deadline = Date.now() + 2000;
    while (!bridge.state().connected && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(bridge.state().connected, true, 'mock helper should connect');
    assert.equal(existsSync(lock), true, 'lockfile should exist while running');
    const savedLock = JSON.parse(readFileSync(lock, 'utf8'));
    assert.equal(savedLock.pid, bridge.state().pid);

    await bridge.stop();
    assert.equal(existsSync(sock), false, 'socket removed on stop');
    assert.equal(existsSync(lock), false, 'lockfile removed on stop');
    assert.equal(bridge.state().connected, false);
  } finally {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build:vorssaint script is registered in package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['build:vorssaint'], 'node scripts/build-vorssaint.mjs');
  const devBin = new URL('../native/bin/baryon-vorssaint', import.meta.url);
  if (existsSync(devBin)) {
    assert.ok(statSync(devBin).size > 100_000);
  }
});
