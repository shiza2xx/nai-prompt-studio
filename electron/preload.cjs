const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('naiStorage', {
  load: () => ipcRenderer.sendSync('storage:load'),
  retryLoad: () => ipcRenderer.sendSync('storage:retry-load'),
  openProfileFolder: () => ipcRenderer.invoke('storage:open-profile-folder'),
  save: (section, value) => ipcRenderer.send('storage:save', section, value),
  saveSync: (section, value) => ipcRenderer.sendSync('storage:save-sync', section, value),
  transactCustomTags: (operation, payload, bytes) => ipcRenderer.invoke('custom-tags:transact', operation, payload, bytes),
  importCustomTags: () => ipcRenderer.invoke('custom-tags:import'),
  importCustomTagsPath: filePath => ipcRenderer.invoke('custom-tags:import', filePath),
  exportCustomTags: presetId => ipcRenderer.invoke('custom-tags:export', presetId),
  getPathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  saveLibraryImage: (metadata, bytes) => ipcRenderer.invoke('library:image-save', metadata, bytes),
  deleteLibraryImage: asset => ipcRenderer.invoke('library:image-delete', asset)
});

contextBridge.exposeInMainWorld('naiMetadata', {
  // The main process validates the exact page URL and owns all remote I/O.
  loadPost: url => ipcRenderer.invoke('metadata:load-post', url),
  cancel: () => ipcRenderer.invoke('metadata:cancel-post'),
  cancelPost: () => ipcRenderer.invoke('metadata:cancel-post')
});

contextBridge.exposeInMainWorld('naiExternal', {
  openFeedback: () => ipcRenderer.invoke('external:open-feedback')
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
