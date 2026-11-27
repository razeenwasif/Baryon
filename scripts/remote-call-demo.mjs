#!/usr/bin/env node
// Fairy away from the mini, Away 2: one window call from "another Mac", to try the bridge without the window. It pairs as
// a Mac with a full Fairy (a test copy, say) using a link from its Settings, Phone, Pair a Mac; opens a window session with
// the approve key it was given; lists the chats through /v1/face/call; and, with a message, sends it as the window would.
// The pairing lives in this script's memory only, and the window session is closed at the end.
//
//   node scripts/remote-call-demo.mjs "fairy://pair?…" ["a message to send"]
import { FaceClient } from '../desktop/face-client.mjs';
import { decode } from '../desktop/remote-codec.mjs';

const [link, message] = process.argv.slice(2);
if (!link) { console.error('Paste a pairing link from Settings, Phone, Pair a Mac on the other Fairy.'); process.exit(2); }

// FaceStore's shape, kept in memory: nothing is written to disk.
const memory = { pairing: null, read: '', approve: '' };
const store = { pairing: () => memory.pairing, readKey: () => memory.read, approveKey: () => memory.approve, state: () => ({ host: memory.pairing?.host ?? '' }),
  savePairing: async ({ readKey, approveKey, ...pairing }) => { Object.assign(memory, { pairing, read: readKey, approve: approveKey }); }, forget: async () => { memory.pairing = null; } };
const client = new FaceClient({ store, name: 'Remote call demo' });

await client.pair(link, 'Remote call demo');
client.stop();
const key = memory.read, window = await client.call('POST', '/v1/face/window', { body: { approveKey: memory.approve }, key });
console.log(`Window session open until ${window.expires}.`);
const call = async (channel, args = []) => {
  const answer = await client.call('POST', '/v1/face/call', { body: { channel, args }, key, headers: { 'X-Fairy-Window': window.token }, timeoutMs: 180000 });
  if (answer.error) throw new Error(`${channel}: ${answer.error}`);
  return decode(answer.result);
};
try {
  const state = await call('state');
  const chats = state.sessions?.sessions ?? state.sessions?.list ?? state.sessions?.items ?? [];
  console.log(`The other Mac’s window state (remote: ${state.remote === true}): ${chats.length} chats.`);
  for (const chat of chats.slice(0, 8)) console.log(`  ${chat.title || chat.id}`);
  if (message) {
    console.log(`Sending: ${message}`);
    const reply = await call('chat', [message, 'chat']);
    console.log(`Fairy: ${reply?.text ?? JSON.stringify(reply).slice(0, 300)}`);
  }
} finally {
  await client.call('POST', '/v1/face/window/close', { body: {}, key, headers: { 'X-Fairy-Window': window.token } }).catch(() => {});
}
