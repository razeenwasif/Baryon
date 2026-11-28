// Line icons drawn on a 24px grid. Strokes use currentColor; CSS makes them white.
const icon = (name: string, paths: string): string => `<svg class="line-icon icon-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;

export const icons = {
  microphone: icon('microphone', '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6"/>'),
  microphoneOff: icon('microphone-off', '<path d="M9 5a3 3 0 0 1 6 1v5M9 9v3a3 3 0 0 0 4.6 2.5M6 10v2a6 6 0 0 0 10.2 4.3M18 10v2M12 18v3M9 21h6M3 3l18 18"/>'),
  wave: icon('wave', '<path d="M8.6 13.2V6.4a1.35 1.35 0 0 1 2.7 0v5.1"/><path d="M11.3 11.2V4.9a1.35 1.35 0 0 1 2.7 0v6.3"/><path d="M14 11.3V6.3a1.35 1.35 0 0 1 2.7 0v5.4"/><path d="M16.7 11.7V8.9a1.35 1.35 0 0 1 2.7 0v5a6.5 6.5 0 0 1-6.5 6.5h-.8a5.4 5.4 0 0 1-4.2-2L4.7 14.5a1.35 1.35 0 0 1 2-1.8l1.9 1.8"/><path d="M4.2 8.6a5 5 0 0 1 1.9-3.3"/><path d="M19.6 2.9a4.6 4.6 0 0 1 1.7 2.6"/>'),
  speaker: icon('speaker', '<path d="M4 9.4h3.4L12 5.6v12.8l-4.6-3.8H4z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
  muted: icon('muted', '<path d="M4 9.4h3.4L12 5.6v12.8l-4.6-3.8H4z"/><path d="M15.6 9.6l4.8 4.8"/><path d="M20.4 9.6l-4.8 4.8"/>'),
  // A pen drawing a curve: Explain, where Fairy draws beside what you're reading.
  explain: icon('explain', '<path d="M3.5 19.5c3-1 4.6-3.4 6.2-5.6"/><path d="M14.6 4.6l4.8 4.8L11 17.8l-5.4.6.6-5.4z"/><path d="M13 6.2l4.8 4.8"/>'),
  transcribe: icon('transcribe', '<path d="M3.8 10.2v3.6"/><path d="M6.4 7.4v9.2"/><path d="M9 9.6v4.8"/><path d="M12.6 8h7.6"/><path d="M12.6 12h7.6"/><path d="M12.6 16h4.8"/>'),
};
