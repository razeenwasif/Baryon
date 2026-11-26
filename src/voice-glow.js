// A glow along the bottom of the chat page while you talk to Fairy, after transitions.dev's voice assistant card: it
// rises and blooms with your voice, then, while what you said is being worked out, gathers into one beam that sweeps
// along the edge, and fades away once it's sent. White and Fairy's blues. The drawing lives in voice-glow-beam.js,
// loaded the first time it's needed; until then, and once it has faded, nothing here runs.
export function setupVoiceGlow({ host }) {
  const box = document.createElement('div');
  box.className = 'voice-glow';
  box.setAttribute('aria-hidden', 'true');
  host.prepend(box);
  let render = null, loading = null, phase = 'off', stream = null;

  const load = () => loading ||= import('./voice-glow-beam.js').then(({ mountBeam }) => { render = mountBeam(box); });
  function draw() {
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
  function set(next, nextStream = null) {
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
