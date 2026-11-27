// The glow itself: voice-glow's VoiceBeam (MIT, transitions.dev), the one piece of Fairy drawn with React. It loads only
// the first time you talk to her, so a Fairy that's never spoken to never pays for React.
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceBeam } from 'voice-glow';

// White at the centre and Fairy's blues outwards: seven lobes, the centre first, then pairs going out.
export const GLOW_COLOURS = ['#cfe0ff', '#4f8dff', '#2d4dff', '#7fb4ff', '#3e5aec', '#a9c4ff', '#1f5bff'];
export const GLOW_BAND = { core: '#ffffff', above: '#c4d5ff', mid: '#7fb4ff', below: '#3e5aec' };

export function mountBeam(host) {
  const root = createRoot(host);
  return props => root.render(h(VoiceBeam, {
    theme: 'dark',
    colors: GLOW_COLOURS,
    bandColors: GLOW_BAND,
    hueRange: 10,
    borderRadius: 0,
    // Wide enough to run the whole bottom of the chat page, low enough that its brightest part stays under the buttons.
    scale: 1.45,
    rangeWidth: 1.7,
    reach: 0.6,
    bloomHeight: 0.62,
    innerHeight: 0.7,
    strength: 0.85,
    coreSize: 0.75,
    saturation: 1.45,
    idle: 0.12,
    ...props,
  }, h('div', { className: 'voice-glow-fill' })));
}
