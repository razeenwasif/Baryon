import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, stat, readFile } from 'node:fs/promises';
import { LocalTranscription, validateRecording, validateLocalLanguage, type LocalTranscriptionSpawnFn } from '../desktop/local-transcription.mjs';
import { encodeWav } from '../src/recording.js';
import { cleanSettings, Providers } from '../desktop/core.mjs';

const wav = () => encodeWav([Float32Array.from([0, 0.5, -0.5, 1, -1])], 48000);
function fixture(callback: (child: any, request: any) => void): LocalTranscriptionSpawnFn {
  return ((exe: string, args: string[], { signal }: { signal?: AbortSignal }) => {
    assert(exe.endsWith('fairy-transcribe')); assert.deepEqual(args, []);
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', null)); };
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    const chunks: Buffer[] = [];
    child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on('end', () => callback(child, JSON.parse(Buffer.concat(chunks).toString())));
    return child;
  }) as LocalTranscriptionSpawnFn;
}
test('recording mixes channels, clips samples and generates bounded PCM WAV', () => {
  const bytes = encodeWav([Float32Array.from([1, -2, NaN]), Float32Array.from([0, -2, 0])], 16000);
  const pcm = validateRecording(bytes, 'audio/wav');
  assert.equal(pcm.readInt16LE(44), 16384); assert.equal(pcm.readInt16LE(46), -32768); assert.equal(pcm.readInt16LE(48), 0);
  assert.throws(() => encodeWav([new Float32Array(16000 * 66)], 16000), /Unsupported/);
  const corrupt = wav(); corrupt[40] = 255;
  assert.throws(() => validateRecording(corrupt, 'audio/wav'), /Invalid/);
  assert.throws(() => validateRecording(wav(), 'audio/webm'), /WAV/);
  assert.throws(() => validateLocalLanguage('../../file'), /language/);
});
test('local choice cannot accidentally send audio through a cloud adapter', async () => {
  const settings = cleanSettings({ transcriptionProvider: 'apple', localLanguage: 'en-AU' });
  assert.equal(settings.transcriptionProvider, 'apple');
  const provider = new Providers({}, () => assert.fail('Local audio must never reach a cloud API'));
  await assert.rejects(provider.transcribe(settings, wav(), 'audio/wav'), /on-device/);
  assert.throws(() => cleanSettings({ localLanguage: 'invalid value' }), /language/);
});
test('local transcription forwards progress and removes private recording after success', async () => {
  let path!: string; const progress: string[] = [];
  const local = new LocalTranscription({ spawnProcess: fixture(async (child, request) => {
    path = request.path;
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(path), Buffer.from(wav()));
    assert.equal(request.locale, 'en-AU');
    assert.deepEqual(request.vocabulary, ['Fairy', 'Hey Fairy']);
    child.stdout.write('{"progress":"Transcribing locally"}\n{"result":{"text":" Hello Fairy "}}\n');
    child.emit('close', 0);
  }) });
  assert.equal(await local.transcribe(wav(), 'audio/wav', 'en-AU', undefined, text => progress.push(text), ['Fairy', ' Hey Fairy ', 'Fairy', 7 as any, 'x'.repeat(41)]), 'Hello Fairy');
  assert.deepEqual(progress, ['Transcribing locally']);
  await assert.rejects(access(path), { code: 'ENOENT' });
});
test('helper failure removes audio and reports setup error without cloud fallback', async () => {
  let path!: string;
  const local = new LocalTranscription({ spawnProcess: fixture((child, request) => {
    path = request.path; child.stdout.write('{"error":"Model unavailable"}\n'); child.emit('close', 1);
  }) });
  await assert.rejects(local.transcribe(wav(), 'audio/wav', 'en-AU'), /Model unavailable/);
  await assert.rejects(access(path), { code: 'ENOENT' });
});
test('cancellation waits for helper exit and removes recording', async () => {
  let path!: string; const controller = new AbortController();
  const local = new LocalTranscription({ spawnProcess: fixture((_child, request) => { path = request.path; controller.abort(); }) });
  await assert.rejects(local.transcribe(wav(), 'audio/wav', 'en-AU', controller.signal), { name: 'AbortError' });
  await assert.rejects(access(path), { code: 'ENOENT' });
});
test('stalled model setup times out and invalid recordings never launch helper', async () => {
  const local = new LocalTranscription({ timeoutMs: 10, spawnProcess: fixture(() => {}) });
  await assert.rejects(local.prepare('en-AU'), /timed out/);
  const noSpawn = new LocalTranscription({ spawnProcess: () => assert.fail('Must reject before spawning') });
  await assert.rejects(noSpawn.transcribe(new Uint8Array(), 'audio/wav', 'en-AU'), /WAV/);
});
