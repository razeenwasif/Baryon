// The quick box's only bridge: the question going to Fairy, or closing.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fairyQuick', {
  submit: text => ipcRenderer.send('fairy:quick-submit', String(text || '').slice(0, 4000)),
  close: () => ipcRenderer.send('fairy:quick-close'),
});
