'use strict';

// Puente seguro renderer <-> main. El renderer no tiene acceso a Node:
// todo pasa por estos canales. Las apikeys de providers NUNCA cruzan al
// renderer (solo `hasKey`).

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

  // LLM
  llmDigest: (jsonPath) => ipcRenderer.invoke('llm:digest', jsonPath),
  llmProviders: () => ipcRenderer.invoke('llm:providers'),
  llmProvidersSave: (providers) => ipcRenderer.invoke('llm:providers:save', providers),
  llmAnalyze: (cfg) => ipcRenderer.invoke('llm:analyze', cfg),

  // Tools / skills / docs / diagnóstico
  runTool: (cfg) => ipcRenderer.invoke('tools:run', cfg),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  readDoc: (rel) => ipcRenderer.invoke('docs:read', rel),
  runDiag: () => ipcRenderer.invoke('diag:run'),

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
