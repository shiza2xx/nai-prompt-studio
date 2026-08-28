const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { resolveAppPaths, ensureWritable } = require('./app-paths.cjs');
const { containedAsset, validateImagePayload, writeAsset } = require('./custom-tag-assets.cjs');
const { loadCatalog, runUpdate, catalogAssetFromProtocolUrl, resolveActiveCatalogAsset } = require('./catalog-updater.cjs');
const { normalizeDescriptors, ensureComponent, ensureSelectedComponents, loadState, statuses, readInstallerSelections } = require('./catalog-components.cjs');
const { checkForUpdate, downloadInstaller, validateManifest, UpdateAbortError } = require('./app-updater.cjs');

const APP_USER_MODEL_ID = 'com.novelai.promptstudio';
const APP_ICON = path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'app-icon.png');

app.setName('NAI Prompt Studio');
app.setAppUserModelId(APP_USER_MODEL_ID);
protocol.registerSchemesAsPrivileged([
  { scheme: 'nai-custom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'nai-catalog', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'nai-library', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let appPaths;
let profileError = '';
try {
  appPaths = ensureWritable(resolveAppPaths({
    isPackaged: app.isPackaged,
    workspaceDir: path.resolve(__dirname, '..'),
    executablePath: process.execPath
  }));
  app.setPath('userData', appPaths.dataDir);
  app.setPath('sessionData', appPaths.dataDir);
  app.setPath('temp', appPaths.tempDir);
  app.commandLine.appendSwitch('disk-cache-dir', appPaths.cacheDir);
  try { app.setPath('logs', appPaths.logsDir); } catch { /* unavailable on older Electron */ }
  try { app.setPath('crashDumps', appPaths.crashDumpsDir); } catch { /* unavailable on older Electron */ }
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
  if (!fs.existsSync(file)) return { exists: false, data: { version: 3, sets: [], savedLibrary: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null } };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const merged = { version: 3, sets: [], savedLibrary: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null, ...data };
    if (Number(data.version) < 2) {
      merged.characterFavorites = Array.isArray(data.favorites) ? data.favorites.filter(value => String(value).startsWith('character-')) : [];
      merged.favorites = [];
      merged.version = 2;
    }
    if (!Array.isArray(merged.savedLibrary)) merged.savedLibrary = [];
    if (!Object.prototype.hasOwnProperty.call(data, 'savedLibrary')) merged.savedLibrary = undefined;
    merged.version = Math.max(3, Number(merged.version) || 3);
    return { exists: true, data: merged };
  } catch {
    return { exists: false, data: { version: 3, sets: [], savedLibrary: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null } };
  }
}

function saveStorageSection(section, value) {
  // Legacy section contract: ['sets', 'favorites', 'characterFavorites', 'draft', 'customTags', 'customTagPresets']; new saves use savedLibrary.
  if (!['sets', 'savedLibrary', 'favorites', 'characterFavorites', 'draft', 'customTags', 'customTagPresets', 'settings', 'artistMix'].includes(section)) return;
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
ipcMain.handle('library:image-save', async (_event, metadata, payload) => {
  if (!metadata || typeof metadata !== 'object') throw new Error('Saved Library cover metadata is required');
  const mime = metadata.mime;
  const bytes = validateImagePayload(payload, mime);
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
  const safeId = String(metadata.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '') || String(Date.now());
  const asset = `${safeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  writeAsset(appPaths.savedLibraryDir, asset, bytes, mime);
  return { imageAsset: asset, mime, originalName: typeof metadata.originalName === 'string' ? metadata.originalName.slice(0, 255) : '' };
});
ipcMain.handle('library:image-delete', async (_event, asset) => {
  try { fs.rmSync(containedAsset(appPaths.savedLibraryDir, asset), { force: true }); return true; } catch { return false; }
});

let catalogUpdateController = null;
let catalogUpdatePromise = null;
let appUpdateController = null;
let appUpdatePromise = null;
let appUpdateReady = null;
function embeddedCatalogPath() {
  const packaged = path.join(__dirname, '..', 'dist', 'catalog', 'catalog.json');
  const development = path.join(__dirname, '..', 'public', 'catalog', 'catalog.json');
  return fs.existsSync(packaged) ? packaged : development;
}
function componentDescriptors() {
  const candidates = [path.join(__dirname, '..', 'dist', 'catalog', 'catalog-components.json'), path.join(__dirname, '..', 'public', 'catalog', 'catalog-components.json')];
  for (const candidate of candidates) {
    try { const value = JSON.parse(fs.readFileSync(candidate, 'utf8')); const descriptors = normalizeDescriptors(value); if (descriptors.length) return descriptors; } catch { /* use the next build/development source */ }
  }
  return [];
}
function componentManifestPath() { return path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'catalog', 'catalog-components.json'); }
function emitComponentProgress(event) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('catalog:component-progress', event);
}
let componentController = null;
let componentPromise = null;
function packagedCatalogAssetMode() { return app.isPackaged; }
function emitCatalogProgress(event) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('catalog:progress', event);
}
ipcMain.handle('catalog:load', async () => loadCatalog({ embeddedPath: embeddedCatalogPath(), catalogDir: appPaths.catalogDir }));
ipcMain.handle('catalog:mode', async () => ({ packaged: packagedCatalogAssetMode() }));
ipcMain.handle('catalog:components', async () => {
  const descriptors = componentDescriptors();
  const state = loadState(appPaths.catalogDir);
  return { descriptors, components: statuses(appPaths.catalogDir, descriptors), selected: readInstallerSelections(appPaths.dataDir), state, manifest: componentManifestPath() };
});
ipcMain.handle('catalog:ensure-selected', async () => {
  if (!app.isPackaged) return { selected: { artists: true, guide: true, characters: false }, results: [], total: 0, development: true };
  if (componentPromise) return componentPromise;
  const descriptors = componentDescriptors();
  if (!descriptors.length) return { selected: readInstallerSelections(appPaths.dataDir), results: [], total: 0, missingManifest: true };
  componentController = new AbortController();
  componentPromise = ensureSelectedComponents({ catalogDir: appPaths.catalogDir, dataDir: appPaths.dataDir, descriptors, signal: componentController.signal, onProgress: emitComponentProgress })
    .finally(() => { componentController = null; componentPromise = null; });
  return componentPromise;
});
ipcMain.handle('catalog:component-download', async (_event, componentId, repair = false) => {
  if (!app.isPackaged) throw new Error('Catalog component downloads are disabled in development mode.');
  if (componentPromise) throw new Error('A catalog component transfer is already running.');
  const descriptor = componentDescriptors().find(item => item.id === String(componentId));
  if (!descriptor) throw new Error('Unknown catalog component.');
  componentController = new AbortController();
  componentPromise = ensureComponent({ catalogDir: appPaths.catalogDir, descriptor, repair: Boolean(repair), signal: componentController.signal, onProgress: emitComponentProgress })
    .finally(() => { componentController = null; componentPromise = null; });
  return componentPromise;
});
ipcMain.handle('catalog:component-cancel', async () => { if (!componentController) return false; componentController.abort(); return true; });
ipcMain.handle('catalog:component-repair', async (_event, componentId) => {
  if (!app.isPackaged) throw new Error('Catalog component repairs are disabled in development mode.');
  if (componentPromise) throw new Error('A catalog component transfer is already running.');
  const descriptor = componentDescriptors().find(item => item.id === String(componentId));
  if (!descriptor) throw new Error('Unknown catalog component.');
  componentController = new AbortController();
  componentPromise = ensureComponent({ catalogDir: appPaths.catalogDir, descriptor, repair: true, signal: componentController.signal, onProgress: emitComponentProgress })
    .finally(() => { componentController = null; componentPromise = null; });
  return componentPromise;
});
ipcMain.handle('catalog:update', async () => {
  if (catalogUpdatePromise) throw new Error('A V5 catalog update is already running.');
  catalogUpdateController = new AbortController();
  catalogUpdatePromise = runUpdate({ catalogDir: appPaths.catalogDir, embeddedPath: embeddedCatalogPath(), signal: catalogUpdateController.signal, onProgress: emitCatalogProgress })
    .finally(() => { catalogUpdateController = null; catalogUpdatePromise = null; });
  return catalogUpdatePromise;
});
ipcMain.handle('catalog:cancel', async () => { if (catalogUpdateController) catalogUpdateController.abort(); return Boolean(catalogUpdateController); });
ipcMain.handle('app-update:version', async () => app.getVersion());
ipcMain.handle('app-update:check', async () => app.isPackaged ? checkForUpdate(app.getVersion()) : { available: false, version: app.getVersion(), development: true });
function emitAppUpdateProgress(event) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('app-update:progress', event);
}
ipcMain.handle('app-update:download', async (_event, rawManifest) => {
  if (!app.isPackaged) throw new Error('Application updates are disabled in development mode.');
  if (appUpdatePromise) throw new Error('An application update download is already running.');
  const manifest = validateManifest(rawManifest, app.getVersion());
  if (!manifest.available) return { state: 'up-to-date', version: manifest.version, downloaded: false };
  appUpdateReady = null;
  appUpdateController = new AbortController();
  appUpdatePromise = downloadInstaller(manifest, appPaths.updatesDir, { signal: appUpdateController.signal, onProgress: emitAppUpdateProgress })
    .then(installer => { appUpdateReady = { manifest, installer }; return { state: 'ready', version: manifest.version, downloaded: true }; })
    .catch(error => {
      if (error instanceof UpdateAbortError || error?.code === 'ABORT_ERR') return { state: 'cancelled', version: manifest.version, downloaded: false };
      throw error;
    })
    .finally(() => { appUpdateController = null; appUpdatePromise = null; });
  return appUpdatePromise;
});
ipcMain.handle('app-update:cancel', async () => {
  if (!appUpdateController) return false;
  appUpdateController.abort();
  return true;
});
ipcMain.handle('app-update:install', async (_event, rawManifest) => {
  if (!app.isPackaged) throw new Error('Application updates are disabled in development mode.');
  if (appUpdatePromise) throw new Error('Wait for the application update download to finish.');
  if (!appUpdateReady) throw new Error('The application update is not verified and ready to install.');
  const manifest = rawManifest ? validateManifest(rawManifest, app.getVersion()) : appUpdateReady.manifest;
  if (!manifest.available || manifest.version !== appUpdateReady.manifest.version || manifest.sha512 !== appUpdateReady.manifest.sha512) throw new Error('The verified update record does not match this manifest.');
  if (!fs.existsSync(appUpdateReady.installer)) throw new Error('The verified update installer is no longer available.');
  const installer = appUpdateReady.installer;
  const installParent = path.dirname(path.dirname(process.execPath));
  const launcher = path.join(__dirname, 'update-launcher.cjs');
  const child = spawn(process.execPath, [launcher, String(process.pid), installer, installParent], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: path.dirname(installer),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  setTimeout(() => app.quit(), 40);
  appUpdateReady = null;
  return { state: 'installing', started: true };
});

function createWindow() {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#000000',
    title: 'NAI Prompt Studio',
    // Source icon pipeline: icon.png -> public/app-icon.png -> build/icon.ico.
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);
  window.removeMenu();
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

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
      if (!fs.existsSync(target)) return new Response('Not found', { status: 404 });
      // Electron's native ASAR fs integration reads archive.asar/inner/path.
      // Returning the bytes directly avoids relying on net.fetch(file://...)'s
      // handling of ASAR inner URLs and keeps MIME types deterministic.
      const bytes = fs.readFileSync(target);
      const extension = path.extname(asset).toLowerCase();
      const mime = extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'application/octet-stream';
      return new Response(bytes, { status: 200, headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  protocol.handle('nai-library', request => {
    try {
      const asset = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      const target = containedAsset(appPaths.savedLibraryDir, asset);
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
