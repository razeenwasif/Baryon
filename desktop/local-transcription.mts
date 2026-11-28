import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const { nativeBin } = createRequire(import.meta.url)('./bundle-path.cjs') as { nativeBin: (name: string) => string };

export interface LocalTranscriptionRequestPayload {
  command: string;
  locale: string;
  path?: string;
  vocabulary?: string[];
}

export interface LocalTranscriptionResult {
  text?: string;
  [key: string]: unknown;
}

export type LocalTranscriptionSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface LocalTranscriptionOptions {
  executable?: string;
  spawnProcess?: LocalTranscriptionSpawnFn;
  timeoutMs?: number;
}

export function validateLocalLanguage(locale: unknown): string {
  if (typeof locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(locale)) throw new Error('Enter a recognition language such as en-AU, en-US, or fr-FR.');
  return locale;
}

// Accept only the bounded PCM format produced by Fairy's recorder, not paths
// or arbitrary files from the renderer. The helper never contacts a cloud ASR.
export function validateRecording(bytes: unknown, mime: unknown): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 46 || bytes.byteLength > 65 * 48000 * 2 + 44 || mime !== 'audio/wav') throw new Error('Local transcription needs a WAV recording of up to 65 seconds.');
  const data = Buffer.from(bytes);
  const rate = data.readUInt32LE(24);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.readUInt32LE(4) !== data.length - 8 || data.toString('ascii', 8, 16) !== 'WAVEfmt ' || data.readUInt32LE(16) !== 16 || data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 || rate < 8000 || rate > 48000 || data.readUInt32LE(28) !== rate * 2 || data.readUInt16LE(32) !== 2 || data.readUInt16LE(34) !== 16 || data.toString('ascii', 36, 40) !== 'data' || data.readUInt32LE(40) !== data.length - 44 || (data.length - 44) % 2 || (data.length - 44) / (2 * rate) > 65) throw new Error('Invalid local PCM recording. Try recording again.');
  return data;
}

// Words the recognizer should expect, such as the companion's name. Bounded so the
// request stays under the helper's 8KB stdin limit.
export function cleanVocabulary(words: unknown): string[] {
  return [...new Set((Array.isArray(words) ? words : []).filter((w): w is string => typeof w === 'string').map(w => w.trim()).filter(w => w && w.length <= 40))].slice(0, 20);
}

export class LocalTranscription {
  executable: string;
  spawnProcess: LocalTranscriptionSpawnFn;
  timeoutMs: number;

  constructor({ executable = nativeBin('fairy-transcribe'), spawnProcess = spawn, timeoutMs = 15 * 60000 }: LocalTranscriptionOptions = {}) {
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
  }

  request(
    payload: LocalTranscriptionRequestPayload,
    signal?: AbortSignal,
    onProgress: (progress: string) => void = () => {},
  ): Promise<LocalTranscriptionResult> {
    signal?.throwIfAborted();
    validateLocalLanguage(payload.locale);
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], signal });
      let pending = '', count = 0, result: LocalTranscriptionResult | undefined, failure: string | undefined, timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, this.timeoutMs);
      child.stdout?.on('data', chunk => {
        count += chunk.length;
        if (count > 128 * 1024) { failure = 'Local transcription returned too much data.'; child.kill('SIGKILL'); return; }
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          try {
            const event = JSON.parse(line) as { progress?: unknown; error?: unknown; result?: unknown };
            if (typeof event.progress === 'string') onProgress(event.progress.slice(0, 500));
            if (typeof event.error === 'string') failure = event.error.slice(0, 2000);
            if (event.result && typeof event.result === 'object') result = event.result as LocalTranscriptionResult;
          } catch { failure = 'Local transcription returned an invalid response.'; }
        }
      });
      // Apple's diagnostics can include paths; only display structured errors.
      child.stderr?.resume();
      child.stdin?.on('error', () => {});
      // Wait for close (including on abort) before deleting the private audio file.
      child.on('error', (error: Error) => {
        const err = error as NodeJS.ErrnoException;
        failure = err.code === 'ENOENT' ? 'Build the local speech helper with npm run build:native.' : err.message;
      });
      child.on('close', code => {
        clearTimeout(timeout);
        if (signal?.aborted) return reject(signal.reason);
        if (timedOut) return reject(new Error('Local speech setup timed out. Check your internet connection for the first model download, then retry.'));
        if (code !== 0 || failure || !result) return reject(new Error(failure || 'Apple local transcription stopped unexpectedly.'));
        resolve(result);
      });
      child.stdin?.end(JSON.stringify(payload));
    });
  }

  prepare(locale: string, signal?: AbortSignal, onProgress?: (progress: string) => void): Promise<LocalTranscriptionResult> {
    return this.request({ command: 'prepare', locale }, signal, onProgress);
  }

  async transcribe(
    bytes: unknown,
    mime: unknown,
    locale: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: string) => void,
    vocabulary: unknown = [],
  ): Promise<string> {
    const data = validateRecording(bytes, mime);
    const validLocale = validateLocalLanguage(locale);
    signal?.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'fairy-recording-'));
    try {
      const path = join(directory, 'recording.wav');
      await writeFile(path, data, { mode: 0o600 });
      signal?.throwIfAborted();
      const result = await this.request({ command: 'transcribe', path, locale: validLocale, vocabulary: cleanVocabulary(vocabulary) }, signal, onProgress);
      if (typeof result.text !== 'string' || result.text.length > 12000) throw new Error('Local transcription returned invalid text.');
      return result.text.trim();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
