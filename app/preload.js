'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDefaults: () => ipcRenderer.invoke('app:defaults'),
  startRecon: (cfg) => ipcRenderer.invoke('recon:start', cfg),
  killRecon: () => ipcRenderer.invoke('recon:kill'),
  startViaProxy: (cfg) => ipcRenderer.invoke('viaproxy:start', cfg),
  stopViaProxy: () => ipcRenderer.invoke('viaproxy:stop'),
  generateReport: () => ipcRenderer.invoke('report:generate'),
  pickLoginFile: () => ipcRenderer.invoke('dialog:loginFile'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  lastPaths: () => ipcRenderer.invoke('app:lastPaths'),
  onLog: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('recon:log', handler);
    return () => ipcRenderer.removeListener('recon:log', handler);
  },
  onStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('recon:status', handler);
    return () => ipcRenderer.removeListener('recon:status', handler);
  },
});
