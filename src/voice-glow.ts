import type { VoiceGlowBeamProps } from './voice-glow-beam.js';

export type VoiceGlowPhase = 'off' | 'listening' | 'working';

export interface SetupVoiceGlowOptions {
  host: HTMLElement;
}

export interface VoiceGlowController {
  listen: (microphone: MediaStream | null) => void;
  work: () => void;
  off: () => void;
}

// A glow along the bottom of the chat page while you talk to Fairy, after transitions.dev's voice assistant card: it
// rises and blooms with your voice, then, while what you said is being worked out, gathers into one beam that sweeps
// along the edge, and fades away once it's sent. White and Fairy's blues. The drawing lives in voice-glow-beam.js,
// loaded the first time it's needed; until then, and once it has faded, nothing here runs.
export function setupVoiceGlow({ host }: SetupVoiceGlowOptions): VoiceGlowController {
  const box = document.createElement('div');
  box.className = 'voice-glow';
  box.setAttribute('aria-hidden', 'true');
  host.prepend(box);
  let render: ((props: VoiceGlowBeamProps) => void) | null = null;
  let loading: Promise<void> | null = null;
  let phase: VoiceGlowPhase = 'off';
  let stream: MediaStream | null = null;

  const load = (): Promise<void> => (loading ||= import('./voice-glow-beam.js').then(({ mountBeam }) => { render = mountBeam(box); }));
  function draw(): void {
    if (!render) return;
    box.hidden = false;
    render({
      stream: phase === 'listening' ? stream : null,
      processing: phase === 'working',
      active: phase !== 'off',
      // Gone from the page once it has faded, so a quiet window draws nothing.
      onDeactivate: () => { if (phase === 'off') box.hidden = true; },
    });
  }
  function set(next: VoiceGlowPhase, nextStream: MediaStream | null = null): void {
    if (next === phase && nextStream === stream) return;
    phase = next; stream = nextStream;
    if (phase === 'off' && !render) return;
    void load().then(draw).catch(() => {});
  }
  box.hidden = true;
  return {
    // Your voice, as it's recorded.
    listen: microphone => set('listening', microphone),
    // What you said, being turned into words.
    work: () => set('working'),
    off: () => set('off'),
  };
}
