import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactRelayState, compactSweepState, formatVorssaintPrompt, startVorssaintLink } from '../desktop/vorssaint-link.mjs';

function connectClient(sock) {
  return new Promise((resolve, reject) => {
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
    client.once('connect', () => resolve({ client, messages }));
    client.once('error', reject);
  });
}

test('compactRelayState, compactSweepState, vorssaint.ops, and pushOpsState work end-to-end', async () => {
  const relaySample = compactRelayState({
    installed: true,
    mini: { reachable: true, name: 'Mac mini', route: 'mini', free: 250e9 },
    schedule: { time: '02:00' },
    jobs: [{ id: 'a', enabled: true }, { id: 'b', enabled: false }],
    diff: { files: 4, bytes: 2048 },
    diffing: false,
    running: null,
  });
  assert.equal(relaySample.installed, true);
  assert.equal(relaySample.reachable, true);
  assert.equal(relaySample.enabledJobs, 1);
  assert.equal(relaySample.totalJobs, 2);
  assert.equal(relaySample.pendingFiles, 4);

  const sweepSample = compactSweepState({
    installed: true,
    disk: { free: 120e9, total: 500e9 },
    threshold: 50,
    below: false,
    lastSweepAt: 1700000000000,
    lastFreed: 4e9,
    totalFreed: 20e9,
    scan: { ready: 2.5e9 },
  });
  assert.equal(sweepSample.diskFreeBytes, 120e9);
  assert.equal(sweepSample.readyBytes, 2.5e9);

  const dir = mkdtempSync(join(tmpdir(), 'vs-link-ops-'));
  const sock = join(dir, 'vorssaint.sock');
  const opsCalls = [];
  const link = startVorssaintLink({
    socketPath: sock,
    role: 'face',
    onOps: payload => {
      opsCalls.push(payload);
      link.pushOpsState({ relay: relaySample, sweep: sweepSample });
    },
  });

  try {
    await link.ready;
    const { client, messages } = await connectClient(sock);
    client.write(`${JSON.stringify({ type: 'vorssaint.ops', target: 'sweep', action: 'clean', tier: 'safe' })}\n`);
    await new Promise(r => setTimeout(r, 60));

    assert.deepEqual(opsCalls, [{ target: 'sweep', action: 'clean', tier: 'safe' }]);
    const opsMsg = messages.find(m => m.type === 'vorssaint.opsState');
    assert.ok(opsMsg);
    assert.equal(opsMsg.relay.enabledJobs, 1);
    assert.equal(opsMsg.sweep.thresholdGB, 50);
    client.destroy();
  } finally {
    await link.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatVorssaintPrompt enriches prompts only when context fields exist', () => {
  assert.equal(formatVorssaintPrompt('hello world', {}), 'hello world');
  const enriched = formatVorssaintPrompt('Summarize', {
    source: 'shelf',
    files: ['/tmp/notes.md', '/tmp/spec.pdf'],
    ocrText: 'Header text',
  });
  assert.match(enriched, /\[Source: shelf\]/);
  assert.match(enriched, /- \/tmp\/notes\.md/);
  assert.match(enriched, /Captured OCR text:\nHeader text/);
  assert.match(enriched, /Summarize$/);
});

test('vorssaint-link routes fairy.contextAction from Shelf, Screenshot, Radial, and Command Bar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-link-ctx-'));
  const sock = join(dir, 'vorssaint.sock');
  const received = [];

  const link = startVorssaintLink({
    socketPath: sock,
    role: 'face',
    onContextAction: payload => received.push(payload),
  });

  try {
    await link.ready;
    const { client } = await connectClient(sock);
    client.write(`${JSON.stringify({ type: 'fairy.contextAction', action: 'notebook', text: 'notes.md', files: ['/tmp/notes.md'], source: 'shelf' })}\n`);
    client.write(`${JSON.stringify({ type: 'fairy.contextAction', action: 'screenshot', text: 'Error 500', files: ['/tmp/shot.png'], imagePath: '/tmp/shot.png', source: 'screenshot' })}\n`);
    client.write(`${JSON.stringify({ type: 'fairy.contextAction', action: 'memory', text: 'Always use bun test', source: 'radial' })}\n`);
    await new Promise(r => setTimeout(r, 50));

    assert.equal(received.length, 3);
    assert.deepEqual(received[0], { action: 'notebook', text: 'notes.md', files: ['/tmp/notes.md'], imagePath: '', source: 'shelf' });
    assert.deepEqual(received[1], { action: 'screenshot', text: 'Error 500', files: ['/tmp/shot.png'], imagePath: '/tmp/shot.png', source: 'screenshot' });
    assert.deepEqual(received[2], { action: 'memory', text: 'Always use bun test', files: [], imagePath: '', source: 'radial' });
    client.destroy();
  } finally {
    await link.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vorssaint-link dedupes fairy.state, syncs & clears approvals, routes decisions, streams asks, and controls teleprompter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-link-'));
  const sock = join(dir, 'vorssaint.sock');
  const decisions = [];
  let aborted = false;

  const link = startVorssaintLink({
    socketPath: sock,
    role: 'full',
    onApprovalDecision: d => decisions.push(d),
    ask: async ({ text, onText, signal }) => {
      signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      onText('Part 1 ');
      await new Promise(r => setTimeout(r, 20));
      return `Done: ${text}`;
    },
  });

  try {
    await link.ready;
    const { client, messages } = await connectClient(sock);

    client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 4321, protocol: 1, keptFeatures: ['notch'] })}\n`);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(messages[0].type, 'hello.ack');

    // State deduping
    assert.equal(link.pushState({ state: 'thinking', title: 'Working' }), true);
    assert.equal(link.pushState({ state: 'thinking', title: 'Working' }), false);
    assert.equal(link.pushState({ state: 'speaking', title: 'Reply', audioLevel: 0.7 }), true);

    // Approvals sync & clear
    assert.equal(link.syncApprovals([{ id: 'ap-1', chat: 'c1', title: 'Run tests', command: 'npm test', risk: 'write' }]), true);
    assert.equal(link.syncApprovals([{ id: 'ap-1', chat: 'c1', title: 'Run tests', command: 'npm test', risk: 'write' }]), false);
    assert.equal(link.syncApprovals([]), true);
    assert.equal(link.syncApprovals([]), false);

    // Teleprompter control & Toast
    link.controlTeleprompter({ action: 'load', text: 'Hello camera', title: 'Demo', wpm: 160, autoPlay: true });
    link.pushToast({ id: 't1', title: 'Quiz', detail: 'Active', accent: 'cyan' });

    // Approval decision from Notch -> Baryon
    client.write(`${JSON.stringify({ type: 'fairy.approvalDecision', id: 'ap-1', decision: 'allow' })}\n`);

    // Streaming ask from Notch -> Baryon -> Notch
    client.write(`${JSON.stringify({ type: 'fairy.ask', id: 'ask-1', text: 'Explain this' })}\n`);
    await new Promise(r => setTimeout(r, 80));

    assert.deepEqual(decisions, [{ id: 'ap-1', decision: 'allow' }]);
    assert.equal(messages.some(m => m.type === 'fairy.state' && m.state === 'thinking'), true);
    assert.equal(messages.some(m => m.type === 'fairy.state' && m.state === 'speaking' && m.audioLevel === 0.7), true);
    assert.equal(messages.some(m => m.type === 'fairy.approval' && m.id === 'ap-1'), true);
    assert.equal(messages.some(m => m.type === 'fairy.approval' && m.clear === true), true);
    assert.equal(messages.some(m => m.type === 'vorssaint.teleprompter' && m.action === 'load' && m.wpm === 160), true);
    assert.equal(messages.some(m => m.type === 'fairy.toast' && m.title === 'Quiz'), true);
    assert.equal(messages.some(m => m.type === 'fairy.text' && m.id === 'ask-1' && m.text === 'Part 1 '), true);
    assert.equal(messages.some(m => m.type === 'fairy.done' && m.id === 'ask-1' && m.text === 'Done: Explain this'), true);

    // Stop active ask check
    client.write(`${JSON.stringify({ type: 'fairy.ask', id: 'ask-2', text: 'Hold' })}\n`);
    await new Promise(r => setTimeout(r, 5));
    client.write(`${JSON.stringify({ type: 'fairy.stop' })}\n`);
    await new Promise(r => setTimeout(r, 35));
    assert.equal(aborted, true);

    client.destroy();
  } finally {
    await link.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
