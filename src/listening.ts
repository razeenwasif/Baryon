import { isListeningCancellation } from './listening-start.js';
import workletURL from './listening-worklet.js?url&no-inline';
import { UtteranceDetector } from './voice-gate.js';
import { encodeWav } from './recording.js';

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface HandsFreeMicrophoneOptions<TWake = unknown> {
  blocked: () => boolean;
  transcribe: (wav: Uint8Array) => Promise<string>;
  onText: (text: string, startedAt: number, wake: TWake | null) => unknown;
  onStatus: (text: string) => void;
  onFailure: (message: string) => void;
  onActivity?: () => void;
  matchWake?: (samples: Float32Array, sampleRate: number) => TWake | null;
  idleMs?: number;
  schedule?: (fn: () => void, ms: number) => TimerHandle;
  clear?: (id: TimerHandle) => void;
}

export interface ListeningEngine {
  context: AudioContext;
  transition: Promise<unknown>;
  owner: ListeningSession | null;
  retired: boolean;
  sessions: number;
  ready?: Promise<ReadyListeningEngine>;
  node?: AudioWorkletNode;
  mute?: GainNode;
}

export interface ReadyListeningEngine extends ListeningEngine {
  ready: Promise<ReadyListeningEngine>;
  node: AudioWorkletNode;
  mute: GainNode;
}

export interface ListeningSession {
  stream: MediaStream | null;
  token: number;
  engine?: ReadyListeningEngine;
  context?: AudioContext | null;
  node?: AudioWorkletNode | null;
  detector?: UtteranceDetector | null;
  source?: MediaStreamAudioSourceNode | null;
  release?: Promise<void>;
  released?: boolean;
}

export interface StopListeningOptions {
  releaseEngine?: boolean;
}

// Tracks belong to a listening session. The suspended, input-free audio graph can
// be reused briefly across restarts; shutdown/lock/cooling dispose it immediately.
export class HandsFreeMicrophone<TWake = unknown> {
  blocked: () => boolean;
  transcribe: (wav: Uint8Array) => Promise<string>;
  onText: (text: string, startedAt: number, wake: TWake | null) => unknown;
  onStatus: (text: string) => void;
  onFailure: (message: string) => void;
  onActivity: () => void;
  matchWake: (samples: Float32Array, sampleRate: number) => TWake | null;
  idleMs: number;
  schedule: (fn: () => void, ms: number) => TimerHandle;
  clear: (id: TimerHandle) => void;
  epoch: number;
  running: boolean;
  starting: boolean;
  processing: boolean;
  session: ListeningSession | null;
  engine: ListeningEngine | null;
  idleTimer: TimerHandle | null;
  cleanup: Promise<void>;
  utteranceStarted = 0;

  constructor({
    blocked,
    transcribe,
    onText,
    onStatus,
    onFailure,
    onActivity = () => {},
    matchWake = () => null,
    idleMs = 30000,
    schedule = (fn, ms) => setTimeout(fn, ms),
    clear = id => clearTimeout(id),
  }: HandsFreeMicrophoneOptions<TWake>) {
    this.blocked = blocked;
    this.transcribe = transcribe;
    this.onText = onText;
    this.onStatus = onStatus;
    this.onFailure = onFailure;
    this.onActivity = onActivity;
    this.matchWake = matchWake;
    this.idleMs = idleMs;
    this.schedule = schedule;
    this.clear = clear;
    this.epoch = 0;
    this.running = false;
    this.starting = false;
    this.processing = false;
    this.session = null;
    this.engine = null;
    this.idleTimer = null;
    this.cleanup = Promise.resolve();
  }

  get node(): AudioWorkletNode | null | undefined {
    return this.session?.node;
  }

  get detector(): UtteranceDetector | null | undefined {
    return this.session?.detector;
  }

  cancelIdle(): void {
    if (this.idleTimer !== null) this.clear(this.idleTimer);
    this.idleTimer = null;
  }

  armIdle(): void {
    this.cancelIdle();
    if (!this.engine || this.engine.owner || this.running || this.starting) return;
    this.idleTimer = this.schedule(() => {
      this.idleTimer = null;
      if (!this.running && !this.starting) void this.closeEngine();
    }, this.idleMs);
    (this.idleTimer as { unref?: () => void } | null)?.unref?.();
  }

  transition<T>(engine: ListeningEngine, work: () => T | Promise<T>): Promise<T> {
    const result = engine.transition.catch(() => {}).then(work);
    engine.transition = result;
    return result;
  }

  async getEngine(): Promise<ReadyListeningEngine> {
    if ((this.engine?.sessions ?? 0) >= 32) await this.closeEngine();
    if (this.engine && !this.engine.retired && this.engine.ready) return this.engine.ready;
    const engine: ListeningEngine = {
      context: new AudioContext({ sampleRate: 48000 }),
      transition: Promise.resolve(),
      owner: null,
      retired: false,
      sessions: 0,
    };
    this.engine = engine;
    engine.ready = (async (): Promise<ReadyListeningEngine> => {
      try {
        await engine.context.audioWorklet.addModule(workletURL);
        if (engine.retired) throw Error('Microphone stopped.');
        engine.node = new AudioWorkletNode(engine.context, 'fairy-microphone');
        engine.mute = engine.context.createGain();
        engine.mute.gain.value = 0;
        engine.node.connect(engine.mute);
        engine.mute.connect(engine.context.destination);
        await engine.context.suspend();
        return engine as ReadyListeningEngine;
      } catch (error) {
        if (this.engine === engine) this.engine = null;
        engine.node?.port.close();
        engine.node?.disconnect();
        engine.mute?.disconnect();
        if (engine.context.state !== 'closed') await engine.context.close();
        throw error;
      }
    })();
    return engine.ready;
  }

  async closeEngine(): Promise<void> {
    this.cancelIdle();
    const engine = this.engine;
    if (!engine) return;
    this.engine = null;
    engine.retired = true;
    await engine.ready?.catch(() => {});
    await engine.transition.catch(() => {});
    if (engine.node) {
      engine.node.port.onmessage = null;
      engine.node.port.postMessage({ stop: true });
      engine.node.port.close();
      engine.node.disconnect();
    }
    engine.mute?.disconnect();
    if (engine.context.state !== 'closed') await engine.context.close();
  }

  release(session: ListeningSession | null | undefined): Promise<void> {
    if (!session) return Promise.resolve();
    if (session.release) return session.release;
    session.released = true;
    session.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    session.source?.disconnect();
    session.detector?.reset();
    const engine = session.engine;
    if (engine?.owner === session) {
      engine.owner = null;
      engine.node.port.onmessage = null;
      engine.node.port.postMessage({ token: 0 });
    }
    session.stream = session.source = session.detector = session.node = session.context = null;
    session.release = (async () => {
      if (engine && !engine.retired) {
        await this.transition(engine, () => (engine.context.state === 'closed' ? undefined : engine.context.suspend()));
      }
      this.armIdle();
    })();
    this.cleanup = session.release.catch(() => {});
    return session.release;
  }

  async start(): Promise<void> {
    if (this.running || this.starting) return;
    this.cancelIdle();
    this.starting = true;
    const token = ++this.epoch;
    let session: ListeningSession | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (token !== this.epoch) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      session = { stream, token };
      this.session = session;
      await this.cleanup;
      if (token !== this.epoch) return;
      const engine = await this.getEngine();
      if (token !== this.epoch || engine.retired) return;
      const detector = new UtteranceDetector(engine.context.sampleRate);
      session.engine = engine;
      session.context = engine.context;
      session.node = engine.node;
      session.detector = detector;
      engine.owner = session;
      engine.sessions++;
      session.source = engine.context.createMediaStreamSource(stream);
      session.source.connect(engine.node);
      stream.getAudioTracks()[0].onended = () => {
        if (token === this.epoch) {
          void this.stop({ releaseEngine: true });
          this.onFailure('Microphone disconnected. Reconnect it and resume listening.');
        }
      };
      engine.node.port.onmessage = async ({ data }: MessageEvent) => {
        const msg = data as { token?: unknown; samples?: unknown } | null | undefined;
        if (token !== this.epoch || msg?.token !== token || !(msg.samples instanceof Float32Array)) return;
        const wasStarted = detector.started;
        const segment = detector.push(msg.samples, this.processing || this.blocked());
        if (wasStarted !== detector.started) this.onActivity();
        if (!wasStarted && detector.started) this.utteranceStarted = Date.now() - 100;
        if (!segment) return;
        this.processing = true;
        this.onStatus('Recognizing locally…');
        try {
          const text = await this.transcribe(encodeWav([segment], engine.context.sampleRate));
          if (token === this.epoch) this.onStatus('');
          const wake = text ? this.matchWake(segment, engine.context.sampleRate) : null;
          if (token === this.epoch && !this.blocked() && text) await this.onText(text, this.utteranceStarted, wake);
        } catch (error) {
          if (token === this.epoch && !isListeningCancellation(error)) {
            void this.stop({ releaseEngine: true });
            this.onFailure(error instanceof Error ? error.message : String(error));
          }
        } finally {
          if (token === this.epoch) {
            this.processing = false;
            detector.reset();
            this.onStatus('');
          }
        }
      };
      engine.node.port.postMessage({ token });
      await this.transition(engine, () => (token === this.epoch && !engine.retired ? engine.context.resume() : undefined));
      if (token !== this.epoch) return;
      this.running = true;
      this.onStatus('');
    } catch (error) {
      if (token === this.epoch) {
        await this.release(session);
        await this.closeEngine();
        throw error;
      }
    } finally {
      if (token !== this.epoch || !this.running) {
        if (this.session === session) this.session = null;
        await this.release(session);
      }
      if (token === this.epoch) this.starting = false;
      this.armIdle();
    }
  }

  async stop({ releaseEngine = false }: StopListeningOptions = {}): Promise<void> {
    const token = ++this.epoch;
    this.starting = false;
    this.running = false;
    this.processing = false;
    const session = this.session;
    this.session = null;
    await this.release(session);
    if (releaseEngine) await this.closeEngine();
    else this.armIdle();
    if (token === this.epoch) this.onStatus('');
  }

  async dispose(): Promise<void> {
    await this.stop({ releaseEngine: true });
  }
}
