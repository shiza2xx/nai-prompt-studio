const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naiStorage', {
  load: () => ipcRenderer.sendSync('storage:load'),
  save: (section, value) => ipcRenderer.send('storage:save', section, value),
  saveSync: (section, value) => ipcRenderer.sendSync('storage:save-sync', section, value),
  saveCustomTag: (metadata, bytes) => ipcRenderer.invoke('custom-tag:save', metadata, bytes),
  deleteCustomTag: asset => ipcRenderer.invoke('custom-tag:delete', asset),
  saveLibraryImage: (metadata, bytes) => ipcRenderer.invoke('library:image-save', metadata, bytes),
  deleteLibraryImage: asset => ipcRenderer.invoke('library:image-delete', asset)
});

contextBridge.exposeInMainWorld('naiCatalog', {
  load: () => ipcRenderer.invoke('catalog:load'),
  mode: () => ipcRenderer.invoke('catalog:mode'),
  components: () => ipcRenderer.invoke('catalog:components'),
  ensureSelected: () => ipcRenderer.invoke('catalog:ensure-selected'),
  downloadComponent: (id, repair = false) => ipcRenderer.invoke('catalog:component-download', id, repair),
  repairComponent: id => ipcRenderer.invoke('catalog:component-repair', id),
  cancelComponent: () => ipcRenderer.invoke('catalog:component-cancel'),
  onComponentProgress: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('catalog:component-progress', handler);
    return () => ipcRenderer.removeListener('catalog:component-progress', handler);
  },
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
  download: manifest => ipcRenderer.invoke('app-update:download', manifest),
  cancel: () => ipcRenderer.invoke('app-update:cancel'),
  install: manifest => ipcRenderer.invoke('app-update:install', manifest),
  version: () => ipcRenderer.invoke('app-update:version'),
  onProgress: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('app-update:progress', handler);
    return () => ipcRenderer.removeListener('app-update:progress', handler);
  }
});
