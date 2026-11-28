import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL } from '../desktop/remote-channels.mjs';
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

test('startVorssaintLink caches vorssaint.featuresState and sends vorssaint.features commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-p6-'));
  const sock = join(dir, 'vorssaint.sock');
  const receivedStates: any[] = [];

  const link = startVorssaintLink({
    socketPath: sock,
    onFeaturesState: (s: any) => receivedStates.push(s),
  });
  await link.ready;

  try {
    const clientWrap = await connectClient(sock);
    clientWrap.client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 42, protocol: 1 })}\n`);
    await waitFor(() => clientWrap.messages.some(m => m.type === 'hello.ack'));

    clientWrap.client.write(`${JSON.stringify({
      type: 'vorssaint.featuresState',
      keptFeatures: ['notch', 'commandBar', 'radialMenu'],
      unifiedTray: true,
      iCloudNotesSync: true,
      aiLauncherFolder: '/Users/test/Github',
      permissions: { accessibility: true, calendar: 'notDetermined' },
    })}\n`);

    await waitFor(() => receivedStates.length === 1);
    const snapshot = link.featuresState();
    assert.equal(snapshot.connected, true);
    assert.equal(snapshot.unifiedTray, true);
    assert.equal(snapshot.iCloudNotesSync, true);
    assert.deepEqual(snapshot.keptFeatures, ['notch', 'commandBar', 'radialMenu']);

    link.sendFeaturesCommand({ action: 'setUnifiedTray', enabled: false });
    await waitFor(() => clientWrap.messages.some(m => m.type === 'vorssaint.features'));
    const cmd = clientWrap.messages.find(m => m.type === 'vorssaint.features');
    assert.equal(cmd.action, 'setUnifiedTray');
    assert.equal(cmd.enabled, false);
    clientWrap.client.destroy();
  } finally {
    await link.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Phase 6 packaging, self-check, and remote-channels include Vorssaint helper integration', () => {
  assert.ok(LOCAL.includes('vorssaint-status'));
  assert.ok(LOCAL.includes('vorssaint-action'));

  const pkgScript = readFileSync(new URL('../build-ts/scripts/package-fairy.mjs', import.meta.url), 'utf8');
  assert.match(pkgScript, /baryon-vorssaint/);
  assert.match(pkgScript, /com\.apple\.security\.automation\.apple-events/);

  const selfCheckScript = readFileSync(new URL('../desktop/self-check.cts', import.meta.url), 'utf8');
  assert.match(selfCheckScript, /baryon-vorssaint/);
});
