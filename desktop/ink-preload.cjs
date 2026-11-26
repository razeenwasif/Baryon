// The ink window's only bridge: drawings in, and the few things a card can ask for out.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fairyInk', {
  onScene: callback => ipcRenderer.on('fairy:ink-scene', (_event, state) => callback(state)),
  // How loud Fairy is speaking (0–1), for the pixel waveform on the newest card.
  onVoice: callback => ipcRenderer.on('fairy:ink-voice', (_event, level) => callback(Number(level) || 0)),
  // Quicker ways to ask: the listening badge and trail, area selection, and the area dragged over.
  // Ride along: show or hide Fairy beside the pointer.
  onRide: callback => ipcRenderer.on('fairy:ink-ride', (_event, state) => callback(state)),
  onRideAt: callback => ipcRenderer.on('fairy:ink-ride-at', (_event, point) => callback(point)),
  onQuick: callback => ipcRenderer.on('fairy:ink-quick', (_event, state) => callback(state)),
  onAreaStart: callback => ipcRenderer.on('fairy:ink-area-start', () => callback()),
  area: rect => ipcRenderer.send('fairy:ink-area', rect ? { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) } : null),
  // Show me how: each step to draw, and its [next] / [stop].
  onGuide: callback => ipcRenderer.on('fairy:ink-guide', (_event, state) => callback(state)),
  guide: action => ipcRenderer.send('fairy:ink-guide', action === 'stop' ? 'stop' : 'next'),
  interactive: value => ipcRenderer.send('fairy:ink-interactive', Boolean(value)),
  close: id => ipcRenderer.send('fairy:ink-close', String(id)),
  clear: () => ipcRenderer.send('fairy:ink-clear'),
  // The pen leaves Fairy ('out') and comes back to her ('in'), so she can turn into it and back.
  // A card asking Fairy something new, such as a quiz's "more like this".
  ask: text => ipcRenderer.send('fairy:ink-ask', String(text).slice(0, 2000)),
  pen: phase => ipcRenderer.send('fairy:ink-pen', phase === 'out' ? 'out' : 'in'),
});
