import { spawn, type SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';
const { nativeBin } = createRequire(import.meta.url)('./bundle-path.cjs') as { nativeBin: (name: string) => string };

export type NativePowerState =
  | { nativeAvailable: false }
  | {
      onBattery: boolean;
      lowPower: boolean;
      batteryPercent: number | null;
      nativeAvailable: true;
    };

export interface NativePowerChildLike {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: { resume(): unknown } | null;
  kill(signal?: NodeJS.Signals | number): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type NativePowerSpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => NativePowerChildLike;

export type NativePowerSchedule<TTimer = ReturnType<typeof setTimeout>> = (
  callback: () => void,
  ms: number,
) => TTimer;

export type NativePowerClear<TTimer = ReturnType<typeof setTimeout>> = (timer: TTimer) => void;

export interface NativePowerOptions<TTimer = ReturnType<typeof setTimeout>> {
  changed: (state: NativePowerState) => void;
  spawnProcess?: NativePowerSpawnProcess;
  schedule?: NativePowerSchedule<TTimer>;
  clear?: NativePowerClear<TTimer>;
}

export class NativePower<TTimer = ReturnType<typeof setTimeout>> {
  changed: (state: NativePowerState) => void;
  spawnProcess: NativePowerSpawnProcess;
  schedule: NativePowerSchedule<TTimer>;
  clear: NativePowerClear<TTimer>;
  child: NativePowerChildLike | null = null;
  timer: TTimer | null = null;
  stopped = false;
  failures = 0;

  constructor({
    changed,
    spawnProcess = spawn,
    schedule = setTimeout as unknown as NativePowerSchedule<TTimer>,
    clear = clearTimeout as unknown as NativePowerClear<TTimer>,
  }: NativePowerOptions<TTimer>) {
    this.changed = changed;
    this.spawnProcess = spawnProcess;
    this.schedule = schedule;
    this.clear = clear;
  }
  start(): void {
    if (this.stopped || this.child) return;
    const child = this.child = this.spawnProcess(nativeBin('fairy-power'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', failed = false;
    const fail = (): void => { if (failed || this.stopped) return; failed = true; this.changed({ nativeAvailable: false }); child.kill(); };
    child.stdin?.on('error', () => {}); child.stderr?.resume();
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (failed || this.stopped) return; buffer += chunk;
      if (buffer.length > 4096) { fail(); return; }
      let end: number; while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const x = JSON.parse(line) as { onBattery?: unknown; lowPower?: unknown; batteryPercent?: unknown };
          if (typeof x.onBattery !== 'boolean' || typeof x.lowPower !== 'boolean' || !(x.batteryPercent === null || typeof x.batteryPercent === 'number' && Number.isInteger(x.batteryPercent) && x.batteryPercent >= 0 && x.batteryPercent <= 100)) throw Error('bad power state');
          this.changed({ onBattery: x.onBattery, lowPower: x.lowPower, batteryPercent: x.batteryPercent, nativeAvailable: true });
        } catch { fail(); return; }
      }
    });
    child.on('error', fail);
    child.on('close', () => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.changed({ nativeAvailable: false });
      if (this.failures++ < 3) {
        this.timer = this.schedule(() => { this.timer = null; this.start(); }, Math.min(30000, 1000 * 2 ** this.failures));
        (this.timer as { unref?: () => void } | null)?.unref?.();
      }
    });
  }
  refresh(): void { if (!this.stopped && this.child) this.child.stdin?.write('refresh\n'); }
  stop(): void { this.stopped = true; if (this.timer !== null) this.clear(this.timer); this.timer = null; const child = this.child; this.child = null; child?.stdin?.end(); child?.kill(); }
}
