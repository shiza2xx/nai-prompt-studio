const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { resolveAppPaths, ensureWritable, migrateLegacyWorkspace } = require('./app-paths.cjs');
const { containedAsset, validateImagePayload, writeAsset } = require('./custom-tag-assets.cjs');
const { loadCatalog, runUpdate, catalogAssetFromProtocolUrl, resolveActiveCatalogAsset } = require('./catalog-updater.cjs');

app.setName('NAI Prompt Studio');
protocol.registerSchemesAsPrivileged([
  { scheme: 'nai-custom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'nai-catalog', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let appPaths;
let profileError = '';
try {
  const legacyUserData = (() => {
    try { return app.getPath('userData'); } catch { return null; }
  })();
  appPaths = ensureWritable(resolveAppPaths({
    isPackaged: app.isPackaged,
    workspaceDir: path.resolve(__dirname, '..'),
    executablePath: process.execPath
  }));
  app.setPath('userData', appPaths.dataDir);
  app.setPath('sessionData', appPaths.dataDir);
  try { app.setPath('logs', appPaths.logsDir); } catch { /* unavailable on older Electron */ }
  try { app.setPath('crashDumps', appPaths.crashDumpsDir); } catch { /* unavailable on older Electron */ }
  migrateLegacyWorkspace(legacyUserData && path.join(legacyUserData, 'workspace.json'), appPaths.workspaceFile);
} catch (error) {
  profileError = error instanceof Error ? error.message : String(error);
}

if (profileError) {
  const showProfileError = () => {
    dialog.showErrorBox('NAI Prompt Studio profile error', `${profileError}\n\nThe application will now quit. No system profile fallback was used.`);
    app.quit();
  };
  if (app.isReady()) showProfileError();
  else app.whenReady().then(showProfileError);
} else {

function storageFile() {
  return appPaths.workspaceFile;
}

function readStorage() {
  const file = storageFile();
  if (!fs.existsSync(file)) return { exists: false, data: { version: 2, sets: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null } };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const merged = { version: 2, sets: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null, ...data };
    if (Number(data.version) < 2) {
      merged.characterFavorites = Array.isArray(data.favorites) ? data.favorites.filter(value => String(value).startsWith('character-')) : [];
      merged.favorites = [];
      merged.version = 2;
    }
    return { exists: true, data: merged };
  } catch {
    return { exists: false, data: { version: 2, sets: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null } };
  }
}

function saveStorageSection(section, value) {
  // Legacy section contract: ['sets', 'favorites', 'characterFavorites', 'draft', 'customTags', 'customTagPresets']
  if (!['sets', 'favorites', 'characterFavorites', 'draft', 'customTags', 'customTagPresets', 'settings', 'artistMix'].includes(section)) return;
  const file = storageFile();
  const current = readStorage().data;
  current[section] = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
}

ipcMain.on('storage:load', event => {
  event.returnValue = readStorage();
});
ipcMain.on('storage:save', (_event, section, value) => {
  try { saveStorageSection(section, value); }
  catch (error) { console.error(`[storage] ${error instanceof Error ? error.message : String(error)}`); }
});
ipcMain.on('storage:save-sync', (event, section, value) => {
  try {
    saveStorageSection(section, value);
    event.returnValue = true;
  } catch (error) {
    console.error(`[storage] ${error instanceof Error ? error.message : String(error)}`);
    event.returnValue = false;
  }
});

ipcMain.handle('custom-tag:save', async (_event, metadata, payload) => {
  if (!metadata || typeof metadata !== 'object') throw new Error('Custom tag metadata is required');
  const mime = metadata.mime;
  const bytes = validateImagePayload(payload, mime);
  const asset = `${String(metadata.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '')}-${Date.now()}.${mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length)}`;
  writeAsset(appPaths.customTagsDir, asset, bytes, mime);
  return { ...metadata, imageAsset: asset };
});
ipcMain.handle('custom-tag:delete', async (_event, asset) => {
  try { fs.rmSync(containedAsset(appPaths.customTagsDir, asset), { force: true }); return true; } catch { return false; }
});

let catalogUpdateController = null;
let catalogUpdatePromise = null;
function embeddedCatalogPath() {
  const packaged = path.join(__dirname, '..', 'dist', 'catalog', 'catalog.json');
  const development = path.join(__dirname, '..', 'public', 'catalog', 'catalog.json');
  return fs.existsSync(packaged) ? packaged : development;
}
function emitCatalogProgress(event) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('catalog:progress', event);
}
ipcMain.handle('catalog:load', async () => loadCatalog({ embeddedPath: embeddedCatalogPath(), catalogDir: appPaths.catalogDir }));
ipcMain.handle('catalog:update', async () => {
  if (catalogUpdatePromise) throw new Error('A V5 catalog update is already running.');
  catalogUpdateController = new AbortController();
  catalogUpdatePromise = runUpdate({ catalogDir: appPaths.catalogDir, embeddedPath: embeddedCatalogPath(), signal: catalogUpdateController.signal, onProgress: emitCatalogProgress })
    .finally(() => { catalogUpdateController = null; catalogUpdatePromise = null; });
  return catalogUpdatePromise;
});
ipcMain.handle('catalog:cancel', async () => { if (catalogUpdateController) catalogUpdateController.abort(); return Boolean(catalogUpdateController); });

function createWindow() {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#100b13',
    title: 'NAI Prompt Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);
  window.removeMenu();
  window.webContents.on('will-navigate', event => event.preventDefault());

  const devServer = process.env.VITE_DEV_SERVER_URL;
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer load failed:${code}] ${description}: ${url}`);
  });
  if (devServer) window.loadURL(devServer);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  protocol.handle('nai-custom', request => {
    try {
      const asset = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      const target = containedAsset(appPaths.customTagsDir, asset);
      return fs.existsSync(target) ? net.fetch(pathToFileURL(target).toString()) : new Response('Not found', { status: 404 });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  protocol.handle('nai-catalog', request => {
    try {
      const asset = catalogAssetFromProtocolUrl(request.url);
      const target = resolveActiveCatalogAsset(appPaths.catalogDir, asset);
      return fs.existsSync(target) ? net.fetch(pathToFileURL(target).toString()) : new Response('Not found', { status: 404 });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
}
