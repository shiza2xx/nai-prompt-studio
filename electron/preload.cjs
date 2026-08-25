const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naiStorage', {
  load: () => ipcRenderer.sendSync('storage:load'),
  save: (section, value) => ipcRenderer.send('storage:save', section, value),
  saveSync: (section, value) => ipcRenderer.sendSync('storage:save-sync', section, value),
  saveCustomTag: (metadata, bytes) => ipcRenderer.invoke('custom-tag:save', metadata, bytes),
  deleteCustomTag: asset => ipcRenderer.invoke('custom-tag:delete', asset)
});

contextBridge.exposeInMainWorld('naiCatalog', {
  load: () => ipcRenderer.invoke('catalog:load'),
  update: () => ipcRenderer.invoke('catalog:update'),
  cancel: () => ipcRenderer.invoke('catalog:cancel'),
  onProgress: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('catalog:progress', handler);
    return () => ipcRenderer.removeListener('catalog:progress', handler);
  }
});

contextBridge.exposeInMainWorld('naiUpdater', {
  check: () => ipcRenderer.invoke('app-update:check'),
  downloadAndInstall: manifest => ipcRenderer.invoke('app-update:download-install', manifest),
  version: () => ipcRenderer.invoke('app-update:version')
});
