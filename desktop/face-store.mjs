// Two Macs: the only file a Face keeps (face/face.json, in Electron's user-data folder, beside the data folder and never
// in it). Where its other Mac is, and the pin of that Mac's certificate; this Mac's two keys, sealed with this Mac's
// Keychain; and a few switches. No chats, memory or sign-ins.
import { readFile } from 'node:fs/promises';
import { atomicJSON } from './json-store.mjs';

// screen: whether the other Mac may ask for a picture of this Mac's screen, during a turn asked from here. Off until you turn it on.
const DEFAULTS = Object.freeze({ muted: false, openAtLogin: false, follow: 'pointer', place: null, screen: false });
const SWITCHES = {
  muted: value => typeof value === 'boolean',
  openAtLogin: value => typeof value === 'boolean',
  screen: value => typeof value === 'boolean',
  follow: value => value === 'pointer' || value === 'manual',
  place: value => value === null || (Number.isInteger(value?.x) && Number.isInteger(value?.y)),
};
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const validPairing = value => Boolean(value) && text(value.host, 253) && /^[a-z0-9.-]+$/i.test(value.host) && Number.isInteger(value.port) && value.port > 0 && value.port < 65536
  && /^[0-9a-f]{64}$/.test(value.pin) && text(value.device, 80) && text(value.readKey, 4096) && text(value.approveKey, 4096);

export class FaceStore {
  constructor({ path, seal, unseal }) {
    Object.assign(this, { path, seal, unseal });
    this.data = { pairing: null, ...DEFAULTS };
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      if (validPairing(saved?.pairing)) this.data.pairing = { ...saved.pairing };
      for (const [name, valid] of Object.entries(SWITCHES)) if (name in (saved ?? {}) && valid(saved[name])) this.data[name] = saved[name];
    } catch (error) { if (error.code !== 'ENOENT') console.warn('Could not read the face settings:', error.message); }
    return this.state();
  }
  // What the page and the menu may know: never a key.
  state() {
    const { pairing, ...switches } = this.data;
    return { paired: Boolean(pairing), host: pairing?.host ?? '', port: pairing?.port ?? 0, device: pairing?.device ?? '', ...switches };
  }
  pairing() {
    const saved = this.data.pairing;
    return saved ? { host: saved.host, port: saved.port, pin: saved.pin, device: saved.device } : null;
  }
  async savePairing({ host, port, pin, device, readKey, approveKey }) {
    const pairing = { host, port, pin, device, readKey: this.seal(readKey), approveKey: this.seal(approveKey) };
    if (!validPairing(pairing) || !readKey || !approveKey) throw new Error('That pairing isn’t complete.');
    this.data.pairing = { ...pairing, at: new Date().toISOString() };
    await this.save();
    return this.state();
  }
  readKey() { return this.data.pairing ? this.unseal(this.data.pairing.readKey) : ''; }
  approveKey() { return this.data.pairing ? this.unseal(this.data.pairing.approveKey) : ''; }
  async forget() { this.data.pairing = null; await this.save(); return this.state(); }
  async set(name, value) {
    if (!SWITCHES[name]) throw new Error(`There’s no face setting called ${name}.`);
    if (!SWITCHES[name](value)) throw new Error(`That isn’t a value for ${name}.`);
    this.data[name] = value;
    await this.save();
    return this.state();
  }
  save() { return atomicJSON(this.path, `${JSON.stringify(this.data, null, 2)}\n`); }
}
