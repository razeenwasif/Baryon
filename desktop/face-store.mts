// Two Macs: the only file a Face keeps (face/face.json, in Electron's user-data folder, beside the data folder and never
// in it). Where its other Mac is, and the pin of that Mac's certificate; this Mac's two keys, sealed with this Mac's
// Keychain; and a few switches. No chats, memory or sign-ins.
import { readFile } from 'node:fs/promises';
import { atomicJSON } from './json-store.mjs';

export type FaceFollowMode = 'pointer' | 'manual';

export interface FacePlace {
  x: number;
  y: number;
}

export interface FacePairingInput {
  host: string;
  port: number;
  pin: string;
  device: string;
  readKey: string;
  approveKey: string;
}

export interface FacePairingRecord extends FacePairingInput {
  at?: string;
}

export interface FaceSwitches {
  muted: boolean;
  openAtLogin: boolean;
  follow: FaceFollowMode;
  place: FacePlace | null;
  screen: boolean;
}

export type FaceSwitchName = keyof FaceSwitches;

export interface FaceStoreData extends FaceSwitches {
  pairing: FacePairingRecord | null;
}

export interface FaceStoreState extends FaceSwitches {
  paired: boolean;
  host: string;
  port: number;
  device: string;
}

export interface FacePairingPublic {
  host: string;
  port: number;
  pin: string;
  device: string;
}

export interface FaceStoreOptions {
  path: string;
  seal: (value: string) => string;
  unseal: (value: string) => string;
}

// screen: whether the other Mac may ask for a picture of this Mac's screen, during a turn asked from here. Off until you turn it on.
const DEFAULTS: Readonly<FaceSwitches> = Object.freeze({ muted: false, openAtLogin: false, follow: 'pointer', place: null, screen: false });
const SWITCHES: Record<FaceSwitchName, (value: unknown) => boolean> = {
  muted: value => typeof value === 'boolean',
  openAtLogin: value => typeof value === 'boolean',
  screen: value => typeof value === 'boolean',
  follow: value => value === 'pointer' || value === 'manual',
  place: value => value === null || (Boolean(value) && typeof value === 'object' && Number.isInteger((value as FacePlace).x) && Number.isInteger((value as FacePlace).y)),
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const validPairing = (value: unknown): value is FacePairingRecord => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<FacePairingRecord>;
  return text(p.host, 253) && /^[a-z0-9.-]+$/i.test(p.host) && Number.isInteger(p.port) && (p.port as number) > 0 && (p.port as number) < 65536
    && typeof p.pin === 'string' && /^[0-9a-f]{64}$/.test(p.pin) && text(p.device, 80) && text(p.readKey, 4096) && text(p.approveKey, 4096);
};

export class FaceStore {
  path: string;
  seal: (value: string) => string;
  unseal: (value: string) => string;
  data: FaceStoreData;

  constructor({ path, seal, unseal }: FaceStoreOptions) {
    this.path = path;
    this.seal = seal;
    this.unseal = unseal;
    this.data = { pairing: null, ...DEFAULTS };
  }
  async load(): Promise<FaceStoreState> {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown> | null;
      if (validPairing(saved?.pairing)) this.data.pairing = { ...saved.pairing };
      for (const [name, valid] of Object.entries(SWITCHES) as Array<[FaceSwitchName, (value: unknown) => boolean]>) {
        if (saved && name in saved && valid(saved[name])) {
          (this.data as unknown as Record<FaceSwitchName, unknown>)[name] = saved[name];
        }
      }
    } catch (error: unknown) {
      const err = error as { code?: unknown; message?: unknown };
      if (err?.code !== 'ENOENT') console.warn('Could not read the face settings:', err?.message ?? error);
    }
    return this.state();
  }
  // What the page and the menu may know: never a key.
  state(): FaceStoreState {
    const { pairing, ...switches } = this.data;
    return { paired: Boolean(pairing), host: pairing?.host ?? '', port: pairing?.port ?? 0, device: pairing?.device ?? '', ...switches };
  }
  pairing(): FacePairingPublic | null {
    const saved = this.data.pairing;
    return saved ? { host: saved.host, port: saved.port, pin: saved.pin, device: saved.device } : null;
  }
  async savePairing({ host, port, pin, device, readKey, approveKey }: FacePairingInput): Promise<FaceStoreState> {
    const pairing: FacePairingRecord = { host, port, pin, device, readKey: this.seal(readKey), approveKey: this.seal(approveKey) };
    if (!validPairing(pairing) || !readKey || !approveKey) throw new Error('That pairing isn’t complete.');
    this.data.pairing = { ...pairing, at: new Date().toISOString() };
    await this.save();
    return this.state();
  }
  readKey(): string { return this.data.pairing ? this.unseal(this.data.pairing.readKey) : ''; }
  approveKey(): string { return this.data.pairing ? this.unseal(this.data.pairing.approveKey) : ''; }
  async forget(): Promise<FaceStoreState> { this.data.pairing = null; await this.save(); return this.state(); }
  async set(name: FaceSwitchName | string, value: unknown): Promise<FaceStoreState> {
    const validator = Object.hasOwn(SWITCHES, name) ? SWITCHES[name as FaceSwitchName] : undefined;
    if (!validator) throw new Error(`There’s no face setting called ${name}.`);
    if (!validator(value)) throw new Error(`That isn’t a value for ${name}.`);
    (this.data as unknown as Record<FaceSwitchName, unknown>)[name as FaceSwitchName] = value;
    await this.save();
    return this.state();
  }
  save(): Promise<void> { return atomicJSON(this.path, `${JSON.stringify(this.data, null, 2)}\n`); }
}
