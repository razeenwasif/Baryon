import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calendarEvent } from '../desktop/calendar.mjs';
import { FaceApps } from '../desktop/face-apps.mjs';
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

test('calendarEvent extracts location, joinUrl across hangoutLink, conferenceData, and zoom description', () => {
  const meetEvent = calendarEvent({
    id: 'evt-1',
    summary: 'Design Sync',
    start: { dateTime: '2026-11-26T10:00:00+11:00' },
    end: { dateTime: '2026-11-26T10:30:00+11:00' },
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    location: 'Room 4B',
    organizer: { displayName: 'Baryon Team' },
    htmlLink: 'https://calendar.google.com/calendar/event?eid=123',
  });
  assert.equal(meetEvent.joinUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(meetEvent.location, 'Room 4B');
  assert.equal(meetEvent.calendarName, 'Baryon Team');
  assert.equal(meetEvent.allDay, false);

  const confEvent = calendarEvent({
    id: 'evt-2',
    summary: 'Standup',
    start: { dateTime: '2026-11-26T11:00:00+11:00' },
    end: { dateTime: '2026-11-26T11:15:00+11:00' },
    conferenceData: {
      entryPoints: [
        { entryPointType: 'phone', uri: 'tel:+1234567' },
        { entryPointType: 'video', uri: 'https://meet.google.com/xyz-uvwx-yz' },
      ],
    },
  });
  assert.equal(confEvent.joinUrl, 'https://meet.google.com/xyz-uvwx-yz');

  const zoomEvent = calendarEvent({
    id: 'evt-3',
    summary: 'Research Seminar',
    start: { date: '2026-11-27' },
    end: { date: '2026-11-28' },
    description: 'Join via https://us02web.zoom.us/j/98765432100?pwd=abc please',
  });
  assert.equal(zoomEvent.allDay, true);
  assert.equal(zoomEvent.joinUrl, 'https://us02web.zoom.us/j/98765432100?pwd=abc');
});

test('startVorssaintLink routes vorssaint.calendarRequest and replays vorssaint.calendarEvents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-sync-'));
  const sock = join(dir, 'vorssaint.sock');
  let requests = 0;

  const link = startVorssaintLink({
    socketPath: sock,
    onCalendarRequest: () => {
      requests += 1;
      link.pushCalendarEvents({
        connected: true,
        events: [{ id: 'g1', title: 'Sync', start: '2026-11-26T12:00:00Z', end: '2026-11-26T12:30:00Z', allDay: false, location: '', joinUrl: 'https://meet.google.com/aaa-bbbb-ccc', url: null, calendarName: 'Work', color: '#4C8BF5' }],
      });
    },
  });
  await link.ready;

  try {
    const first = await connectClient(sock);
    first.client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 1, protocol: 1 })}\n`);
    await waitFor(() => first.messages.some(m => m.type === 'hello.ack'));
    first.client.write(`${JSON.stringify({ type: 'vorssaint.calendarRequest' })}\n`);
    await waitFor(() => requests === 1 && first.messages.some(m => m.type === 'vorssaint.calendarEvents'));
    const pushed = first.messages.find(m => m.type === 'vorssaint.calendarEvents');
    assert.equal(pushed.connected, true);
    assert.equal(pushed.events.length, 1);
    assert.equal(pushed.events[0].joinUrl, 'https://meet.google.com/aaa-bbbb-ccc');
    first.client.destroy();

    // Wait for first socket disconnect to register before opening replacement client.
    await new Promise(r => setTimeout(r, 40));

    // Second client should receive cached calendar payload automatically on connect.
    const second = await connectClient(sock);
    second.client.write(`${JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 2, protocol: 1 })}\n`);
    await waitFor(() => second.messages.some(m => m.type === 'vorssaint.calendarEvents'));
    const replayed = second.messages.find(m => m.type === 'vorssaint.calendarEvents');
    assert.equal(replayed.events[0].title, 'Sync');
    second.client.destroy();
  } finally {
    await link.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FaceApps routes vorssaint calendarEvents RPC', async () => {
  const expected = { connected: true, events: [{ id: '1', title: 'Demo' }], updatedAt: 1234 };
  const apps = new FaceApps({
    apps: {
      vorssaint: {
        ask: async () => ({ text: 'ok' }),
        stop: () => {},
        reset: () => {},
        rpc: async (method: string) => {
          assert.equal(method, 'calendarEvents');
          return expected;
        },
      },
    },
  });

  const sent: Array<{ status: number; payload: any }> = [];
  const fakeReq = Object.assign(new EventEmitter(), { method: 'POST' });
  const fakeRes = {};
  await apps.handle(fakeReq as any, fakeRes as any, {
    pathname: '/v1/face/app/rpc',
    link: {
      body: async () => ({ app: 'vorssaint', method: 'calendarEvents', params: {} }),
      send: (_res: any, status: number, payload: any) => sent.push({ status, payload }),
    },
  } as any);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 200);
  assert.deepEqual(sent[0].payload, { ok: true, data: expected });
});
