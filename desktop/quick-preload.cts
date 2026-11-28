// The quick box's only bridge: the question going to Fairy, or closing.
import type { BaryonQuickApi } from './ipc-contract.js';
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: BaryonQuickApi = {
  submit: (text: string) => ipcRenderer.send('fairy:quick-submit', String(text || '').slice(0, 4000)),
  close: () => ipcRenderer.send('fairy:quick-close'),
};

contextBridge.exposeInMainWorld('fairyQuick', api);
