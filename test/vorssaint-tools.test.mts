import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolset } from '../desktop/tool-registry.mjs';
import { createVorssaintTools } from '../desktop/vorssaint-tools.mjs';
import { startVorssaintLink } from '../desktop/vorssaint-link.mjs';

function connectClient(sock: string): Promise<{ client: net.Socket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const client = net.createConnection(sock);
    client.setEncoding('utf8');
    let buf = '';
    client.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
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

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('Timed out waiting for condition');
}

test('createVorssaintTools gates mutating actions behind approve and protects Baryon & PID<=1', async () => {
  const invoked: Array<{ tool: string; args: any }> = [];
  const approvals: string[] = [];
  let allowNext = false;

  const { all } = createVorssaintTools({
    invoke: async (tool: string, args: any) => {
      invoked.push({ tool, args });
      return { ok: true, tool };
    },
    approve: async (info: any) => {
      approvals.push(info.tool);
      return allowNext;
    },
  });

  const set = toolset(all);

  // Read-only tools never prompt approve.
  const snap = await set.call('mac_system_snapshot', {});
  assert.equal(snap.outcome, 'ok');
  assert.equal(approvals.length, 0);
  assert.equal(invoked.length, 1);

  // Denied mutating tool returns cancelled without invoking Vorssaint.
  allowNext = false;
  const denied = await set.call('mac_keep_awake', { enabled: true, minutes: 30 });
  assert.equal(denied.outcome, 'refused');
  assert.equal((denied.result as any).cancelled, true);
  assert.deepEqual(approvals, ['mac_keep_awake']);
  assert.equal(invoked.length, 1);

  // Approved mutating tool executes.
  allowNext = true;
  const laidOut = await set.call('mac_window_layout', { action: 'left', app: 'Ghostty' });
  assert.equal(laidOut.outcome, 'ok');
  assert.equal(invoked[1].tool, 'mac_window_layout');

  // Guards refuse muting Baryon/Fairy and killing PID <= 1.
  const muteBaryon = await set.call('mac_audio_mixer', { app: 'Baryon', muted: true });
  assert.equal(muteBaryon.outcome, 'refused');
  const killInit = await set.call('mac_port_kill', { pid: 1 });
  assert.equal(killInit.outcome, 'refused');
});

test('startVorssaintLink supports invokeTool, pushPreset, pushUsage replay, and vorssaint.alert', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-tools-'));
  const sock = join(dir, 'vorssaint.sock');
  const alerts: any[] = [];

  const link = startVorssaintLink({
    socketPath: sock,
    onAlert: (alert: any) => alerts.push(alert),
  });
  await link.ready;

  try {
    const first = await connectClient(sock);
    first.client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 10, protocol: 1 })}\n`);
    await waitFor(() => first.messages.some(m => m.type === 'hello.ack'));

    const callPromise = link.invokeTool('mac_port_list', { query: '3000' });
    await waitFor(() => first.messages.some(m => m.type === 'vorssaint.tool'));
    const req = first.messages.find(m => m.type === 'vorssaint.tool');
    assert.equal(req.tool, 'mac_port_list');

    first.client.write(`${JSON.stringify({ type: 'vorssaint.toolResult', id: req.id, ok: true, result: [{ port: 3000 }] })}\n`);
    const result = await callPromise;
    assert.deepEqual(result, [{ port: 3000 }]);

    link.pushPreset('meeting');
    link.pushUsage({ updatedAt: 1000, todayCostUsd: 1.25, todayTokens: 42000, providers: [{ id: 'claude', name: 'Claude', percentUsed: 18, resetText: '3pm' }] });
    first.client.write(`${JSON.stringify({ type: 'vorssaint.alert', kind: 'cpu_high', title: 'High CPU', detail: '95% for 20s' })}\n`);

    await waitFor(() => alerts.length === 1 && first.messages.some(m => m.type === 'vorssaint.preset') && first.messages.some(m => m.type === 'vorssaint.usage'));
    assert.equal(alerts[0].kind, 'cpu_high');
    first.client.destroy();

    await new Promise(r => setTimeout(r, 40));

    // Reconnecting client receives cached usage automatically.
    const second = await connectClient(sock);
    second.client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 11, protocol: 1 })}\n`);
    await waitFor(() => second.messages.some(m => m.type === 'vorssaint.usage'));
    const replayed = second.messages.find(m => m.type === 'vorssaint.usage');
    assert.equal(replayed.todayCostUsd, 1.25);
    second.client.destroy();
  } finally {
    await link.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
