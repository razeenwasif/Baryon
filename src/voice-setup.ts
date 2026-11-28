import workletURL from './listening-worklet.js?url&no-inline';
import { UtteranceDetector } from './voice-gate.js';
import { encodeWav } from './recording.js';
import { buildWakeProfile, matchWake } from './wake-profile.js';
import type { WakeProfile, WakeTakeInput } from './wake-profile.js';

export interface VoiceTrainingApi {
  voiceSetupTranscribe: (bytes: Uint8Array) => Promise<string>;
  voiceProfileSave: (profile: WakeProfile) => Promise<WakeProfile>;
  voiceProfileClear: () => Promise<unknown>;
  voiceProfile: () => Promise<WakeProfile | null>;
}

export interface SetupVoiceTrainingOptions {
  api?: VoiceTrainingApi | null;
  root: HTMLElement;
  name: () => string;
  onProfile: (profile: WakeProfile | null) => void;
}

export interface VoiceTrainingController {
  cancel: () => void;
  load: () => Promise<void>;
}

interface MicrophoneSession {
  next: () => Promise<Float32Array | null>;
  close: () => Promise<void>;
}

const TAKES = ['hey', 'hey', 'hey', 'name', 'name', 'name'] as const;
const RATE = 48000, TAKE_TIMEOUT = 10000, LONGEST_TAKE = 4;
const errMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// One microphone session for the whole setup, with the same processing hands-free uses.
async function openMicrophone(): Promise<MicrophoneSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  const context = new AudioContext({ sampleRate: RATE });
  try {
    await context.audioWorklet.addModule(workletURL);
    const node = new AudioWorkletNode(context, 'fairy-microphone'), mute = context.createGain(), source = context.createMediaStreamSource(stream);
    mute.gain.value = 0; source.connect(node); node.connect(mute); mute.connect(context.destination);
    node.port.postMessage({ token: 1 });
    await context.resume();
    return {
      next: () => new Promise(resolve => {
        const detector = new UtteranceDetector(RATE), timer = setTimeout(() => { node.port.onmessage = null; resolve(null); }, TAKE_TIMEOUT);
        node.port.onmessage = ({ data }: MessageEvent<{ samples?: unknown }>) => {
          if (!(data?.samples instanceof Float32Array)) return;
          const segment = detector.push(data.samples, false);
          if (segment) { clearTimeout(timer); node.port.onmessage = null; resolve(segment); }
        };
      }),
      close: async () => {
        node.port.onmessage = null; node.port.postMessage({ stop: true }); node.port.close(); node.disconnect(); mute.disconnect(); source.disconnect();
        stream.getTracks().forEach(track => track.stop());
        await context.close();
      },
    };
  } catch (error) { stream.getTracks().forEach(track => track.stop()); await context.close(); throw error; }
}

export function setupVoiceTraining({ api, root, name, onProfile }: SetupVoiceTrainingOptions): VoiceTrainingController {
  root.insertAdjacentHTML('beforeend', `<section id="voice-training"><h4>Your voice</h4>
    <p id="voice-training-status" class="field-note" role="status"></p>
    <p id="voice-training-prompt" hidden></p>
    <p id="voice-training-heard" class="field-note" role="status" hidden></p>
    <div class="field-grid"><button type="button" id="voice-training-start" class="quiet"></button><button type="button" id="voice-training-remove" class="quiet" hidden>Remove</button></div></section>`);
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector(`#voice-training-${id}`) as T;
  let profile: WakeProfile | null = null;
  let run = 0;
  let microphone: MicrophoneSession | null = null;
  const describe = (): void => {
    $('status').textContent = profile ? 'Set up. Fairy uses how you say the name to confirm what the speech recognizer writes.' : 'Say the name a few times so Fairy learns how you say it. Only sound measurements stay on this Mac, not recordings.';
    $('start').textContent = profile ? 'Teach Fairy again' : 'Teach Fairy your voice';
    $('remove').hidden = !profile;
  };
  const finish = async (): Promise<void> => {
    run++;
    const open = microphone; microphone = null; await open?.close().catch(() => {});
    $('prompt').hidden = $('heard').hidden = true; describe();
  };
  const prompt = (take: 'hey' | 'name', index: number): void => {
    const companion = name();
    $('prompt').hidden = false;
    $('prompt').textContent = `${index + 1} of ${TAKES.length}: say “${take === 'hey' ? `Hey ${companion}` : companion}”`;
  };
  const start = async (): Promise<void> => {
    if (!api) return;
    const token = ++run, current = (): boolean => token === run;
    $('start').textContent = 'Cancel'; $('remove').hidden = true; $('heard').hidden = true;
    $('status').textContent = 'Speak as you normally would, one phrase at a time.';
    try {
      microphone = await openMicrophone();
      const takes: WakeTakeInput[] = [];
      for (let index = 0; index < TAKES.length && current();) {
        prompt(TAKES[index], index);
        const samples = await microphone.next();
        if (!current()) return;
        if (!samples || samples.length / RATE > LONGEST_TAKE) { $('heard').hidden = false; $('heard').textContent = samples ? 'That was longer than the phrase. Try again.' : 'Nothing heard yet. Try again.'; continue; }
        const heard = await api.voiceSetupTranscribe(encodeWav([samples], RATE));
        if (!current()) return;
        takes.push({ phrase: TAKES[index], samples, rate: RATE, heard });
        $('heard').hidden = false; $('heard').textContent = `The speech recognizer wrote: “${heard || 'nothing'}”`;
        index++;
      }
      if (!current()) return;
      const built = buildWakeProfile(takes, name());
      profile = await api.voiceProfileSave(built); onProfile(profile);
      // A last take that isn't part of the profile shows whether it works.
      $('prompt').textContent = `Now test it: say “${name()}”`; $('heard').hidden = true;
      const test = await microphone.next();
      if (!current()) return;
      const matched = test && matchWake(profile, test, RATE);
      await finish();
      $('heard').hidden = false;
      $('heard').textContent = matched ? 'Recognized. You can close Settings and try it.' : 'That one didn’t match. Try it anyway, or teach Fairy again somewhere quieter.';
    } catch (error: unknown) {
      if (!current()) return;
      await finish();
      $('heard').hidden = false; $('heard').textContent = errMessage(error);
    }
  };
  $<HTMLButtonElement>('start').onclick = () => { if ($('start').textContent === 'Cancel') void finish(); else void start(); };
  $<HTMLButtonElement>('remove').onclick = async () => {
    if (!api) return;
    try { await api.voiceProfileClear(); profile = null; onProfile(null); describe(); $('heard').hidden = true; }
    catch (error: unknown) { $('heard').hidden = false; $('heard').textContent = errMessage(error); }
  };
  describe();
  $<HTMLButtonElement>('start').disabled = !api;
  return {
    cancel: () => { if (microphone || $('start').textContent === 'Cancel') void finish(); },
    load: async () => { if (!api) return; try { profile = await api.voiceProfile(); onProfile(profile); describe(); } catch {} },
  };
}
