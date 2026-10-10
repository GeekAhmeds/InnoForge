'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the UI and the main process.
contextBridge.exposeInMainWorld('posBridge', {
  call: (ns, method, arg) => ipcRenderer.invoke('pos:call', ns, method, arg),
  printers: () => ipcRenderer.invoke('pos:printers'),
  print: (job) => ipcRenderer.invoke('pos:print', job),
  backup: () => ipcRenderer.invoke('pos:backup'),
  restore: () => ipcRenderer.invoke('pos:restore'),
  dataPath: () => ipcRenderer.invoke('pos:dataPath'),
});
