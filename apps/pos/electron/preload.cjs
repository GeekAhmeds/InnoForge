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
  license: () => ipcRenderer.invoke('pos:license'),
  activate: (key) => ipcRenderer.invoke('pos:activate', key),
  copy: (text) => ipcRenderer.invoke('pos:copy', text),
  version: () => ipcRenderer.invoke('pos:version'),
  excelTemplate: (kind) => ipcRenderer.invoke('pos:excelTemplate', kind),
  excelPick: (kind) => ipcRenderer.invoke('pos:excelPick', kind),
  excelExport: (job) => ipcRenderer.invoke('pos:excelExport', job),
  savePdf: (job) => ipcRenderer.invoke('pos:savePdf', job),
  reportExcel: (job) => ipcRenderer.invoke('pos:reportExcel', job),
  kdsInfo: () => ipcRenderer.invoke('pos:kdsInfo'),
  openKds: (opts) => ipcRenderer.invoke('pos:openKds', opts),
  serialListOnly: () => ipcRenderer.invoke('pos:serialListOnly'),
  openDrawer: (opts) => ipcRenderer.invoke('pos:openDrawer', opts),
  display: (state) => ipcRenderer.invoke('pos:display', state),
  openCustomerDisplay: () => ipcRenderer.invoke('pos:openCustomerDisplay'),
  onSerialPorts: (fn) => {
    const listener = (_e, ports) => fn(ports);
    ipcRenderer.on('pos:serial-ports', listener);
    return () => ipcRenderer.removeListener('pos:serial-ports', listener);
  },
  updateState: () => ipcRenderer.invoke('pos:updateState'),
  updateCheck: () => ipcRenderer.invoke('pos:updateCheck'),
  updateInstall: () => ipcRenderer.invoke('pos:updateInstall'),
  onUpdateState: (fn) => {
    const listener = (_e, state) => fn(state);
    ipcRenderer.on('pos:update-state', listener);
    return () => ipcRenderer.removeListener('pos:update-state', listener);
  },
});
