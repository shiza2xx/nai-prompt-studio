const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { resolveAppPaths, ensureWritable } = require('./app-paths.cjs');
const { containedAsset, validateImagePayload, writeAsset } = require('./custom-tag-assets.cjs');
const { createCustomTagLibrary, writeWorkspaceSection } = require('./custom-tag-library.cjs');
const { loadCatalog, runUpdate, catalogAssetFromProtocolUrl, readActiveCatalogAsset } = require('./catalog-updater.cjs');
const { normalizeDescriptors, ensureComponent, ensureSelectedComponents, loadState, statuses, readInstallerSelections } = require('./catalog-components.cjs');
const { ComponentProgressCoalescer } = require('./component-progress-coalescer.cjs');
const { checkForUpdate, downloadInstaller, validateManifest, UpdateAbortError } = require('./app-updater.cjs');
const { loadPost: loadBooruPost } = require('./booru-metadata.cjs');

const APP_USER_MODEL_ID = 'com.novelai.promptstudio';
const APP_ICON = path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'app-icon.png');
const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSea7082Hc8y4QoltvP8Yro32QeJifYppLCb6iKxPgV6dg6wmw/viewform?usp=dialog';

function isFeedbackUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'docs.google.com' && parsed.pathname === '/forms/d/e/1FAIpQLSea7082Hc8y4QoltvP8Yro32QeJifYppLCb6iKxPgV6dg6wmw/viewform' && parsed.search === '?usp=dialog' && parsed.hash === '';
  } catch { return false; }
}

app.setName('NAI Prompt Studio');
app.setAppUserModelId(APP_USER_MODEL_ID);
protocol.registerSchemesAsPrivileged([
  { scheme: 'nai-custom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'nai-catalog', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'nai-library', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let appPaths;
let customTagLibrary;
let profileError = '';
try {
  appPaths = ensureWritable(resolveAppPaths({
    isPackaged: app.isPackaged,
    workspaceDir: path.resolve(__dirname, '..'),
    executablePath: process.execPath
  }));
  // Keep every runtime temporary file (including Electron/ASAR helper work)
  // under the validated application profile. This is set before constructing
  // any storage, catalog, or BrowserWindow work and never touches historical
  // files in the host's system TEMP directory.
  process.env.TEMP = appPaths.tempDir;
  process.env.TMP = appPaths.tempDir;
  process.env.TMPDIR = appPaths.tempDir;
  app.setPath('temp', appPaths.tempDir);
  app.setPath('userData', appPaths.dataDir);
  customTagLibrary = createCustomTagLibrary({ customTagsDir: appPaths.customTagsDir, workspaceFile: appPaths.workspaceFile });
  app.setPath('sessionData', appPaths.dataDir);
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

function emptyStorage(library) {
  return { version: 3, sets: [], savedLibrary: [], favorites: [], characterFavorites: [], draft: null, customTags: library.tags, customTagPresets: library.presets, customTagLibrary: library, settings: null, artistMix: null };
}
let cachedStorageHealth = null;
function rememberStorageHealth(snapshot) { cachedStorageHealth = snapshot; return snapshot; }

// Storage health is deliberately distinct from file existence.  In particular,
// an unreadable or malformed workspace must never look like a fresh profile:
// doing so would invite the renderer to overwrite the only recovery source.
function readStorage() {
  const file = storageFile();
  try {
    if (!fs.existsSync(file)) {
      const library = customTagLibrary.load();
      return rememberStorageHealth({ state: 'missing', exists: false, data: emptyStorage(library) });
    }
  } catch (error) {
    return rememberStorageHealth({ state: 'error', exists: true, error: `The workspace file could not be checked: ${error instanceof Error ? error.message : String(error)}` });
  }
  try {
    const text = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The workspace root must be a JSON object.');
    const merged = { version: 3, sets: [], savedLibrary: [], favorites: [], characterFavorites: [], draft: null, customTags: [], customTagPresets: [], settings: null, artistMix: null, ...data };
    if (Number(data.version) < 2) {
      merged.characterFavorites = Array.isArray(data.favorites) ? data.favorites.filter(value => String(value).startsWith('character-')) : [];
      merged.favorites = [];
      merged.version = 2;
    }
    if (!Array.isArray(merged.savedLibrary)) merged.savedLibrary = [];
    if (!Object.prototype.hasOwnProperty.call(data, 'savedLibrary')) merged.savedLibrary = undefined;
    merged.version = Math.max(3, Number(merged.version) || 3);
    const library = customTagLibrary.load();
    merged.customTags = library.tags;
    merged.customTagPresets = library.presets;
    merged.customTagLibrary = library;
    return rememberStorageHealth({ state: 'ready', exists: true, data: merged });
  } catch (error) {
    return rememberStorageHealth({ state: 'error', exists: true, error: `The workspace file could not be read safely: ${error instanceof Error ? error.message : String(error)}` });
  }
}

const STORAGE_SECTIONS = new Set(['sets', 'savedLibrary', 'favorites', 'characterFavorites', 'draft', 'settings', 'artistMix']);
function saveStorageSection(section, value) {
  if (!STORAGE_SECTIONS.has(section)) {
    const diagnostic = `Unsupported generic storage section: ${String(section)}`;
    console.error(`[storage] ${diagnostic}`);
    throw new Error(diagnostic);
  }
  const health = cachedStorageHealth ?? readStorage();
  if (health.state === 'error') throw new Error('Workspace recovery is required before changes can be saved.');
  const file = storageFile();
  try {
    if (!fs.existsSync(file)) customTagLibrary.load();
    writeWorkspaceSection(file, section, value);
    if (health.state === 'missing') cachedStorageHealth = { state: 'ready', exists: true };
  } catch (error) {
    // writeWorkspaceSection is the last line of defense against an on-disk
    // malformed root. Once it rejects, do not allow later generic writes.
    rememberStorageHealth({ state: 'error', exists: true, error: `The workspace file could not be saved safely: ${error instanceof Error ? error.message : String(error)}` });
    throw error;
  }
}

function customTagResultError(error) {
  return { status: 'error', message: error instanceof Error ? error.message : String(error) };
}

function safeNaipackPath(value) {
  if (typeof value !== 'string' || !value) throw new Error('A .naipack path is required.');
  const resolved = path.resolve(value);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (error) { if (error?.code !== 'ENOENT') throw error; return resolved; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('The selected .naipack target must be a regular file.');
  return resolved;
}

function safeTaskTempDir() {
  const resolved = path.resolve(appPaths.tempDir);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { throw new Error('The profile temporary directory is unavailable.'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The profile temporary directory must be a real directory.');
  const canonical = value => process.platform === 'win32' ? value.toLocaleLowerCase() : value;
  const real = path.resolve(fs.realpathSync.native(resolved));
  const dataRoot = path.resolve(appPaths.dataDir);
  if (!canonical(real).startsWith(`${canonical(dataRoot)}${path.sep}`)) throw new Error('The profile temporary directory redirects outside the profile.');
  return resolved;
}

function customTagNameForFile(value) {
  const clean = String(value ?? 'Custom Tags').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 100);
  return `${clean || 'Custom Tags'}.naipack`;
}

function replaceNaipackRecoverably(staged, selected) {
  const target = safeNaipackPath(selected);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const backup = `${target}.bak-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let displaced = false;
  try {
    if (fs.existsSync(target)) { fs.renameSync(target, backup); displaced = true; }
    fs.renameSync(staged, target);
    if (displaced) { try { fs.rmSync(backup, { force: true }); } catch {} }
    return target;
  } catch (error) {
    try { if (!fs.existsSync(target) && displaced && fs.existsSync(backup)) fs.renameSync(backup, target); } catch {}
    throw error;
  }
}

async function importCustomTagPack(sourcePath) {
  try {
    if (!customTagLibrary) throw new Error('Custom Tags are unavailable because the profile could not be opened.');
    const source = safeNaipackPath(sourcePath);
    return customTagLibrary.importPack(source, { stagingDir: safeTaskTempDir() });
  } catch (error) { return customTagResultError(error); }
}

async function showCustomTagPackImport() {
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? undefined, {
    title: 'Import Custom Tags',
    properties: ['openFile'],
    filters: [{ name: 'NAI Custom Tags pack', extensions: ['naipack'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
  return importCustomTagPack(result.filePaths[0]);
}

async function exportCustomTagPack(presetId) {
  try {
    if (!customTagLibrary) throw new Error('Custom Tags are unavailable because the profile could not be opened.');
    const preset = customTagLibrary.exportablePreset(presetId);
    const tempDir = safeTaskTempDir();
    const suggested = customTagNameForFile(preset.preset.name);
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? undefined, {
      title: `Export ${preset.preset.name}`,
      defaultPath: path.join(tempDir, suggested),
      filters: [{ name: 'NAI Custom Tags pack', extensions: ['naipack'] }]
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    const selected = path.extname(result.filePath).toLocaleLowerCase() === '.naipack' ? result.filePath : `${result.filePath}.naipack`;
    const staged = path.join(tempDir, `.naipack-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.naipack`);
    try {
      await customTagLibrary.exportPack(presetId, staged, tempDir);
      replaceNaipackRecoverably(staged, selected);
      return { status: 'exported', presetId: preset.preset.id, name: preset.preset.name, cardCount: preset.cards.length };
    } finally { try { fs.rmSync(staged, { force: true }); } catch {} }
  } catch (error) { return customTagResultError(error); }
}

ipcMain.on('storage:load', event => {
  event.returnValue = readStorage();
});
ipcMain.on('storage:retry-load', event => { event.returnValue = readStorage(); });
ipcMain.handle('storage:open-profile-folder', async () => {
  const target = appPaths.dataDir;
  const result = await shell.openPath(target);
  if (result) throw new Error(result);
  return true;
});
ipcMain.handle('external:open-feedback', async () => {
  if (!isFeedbackUrl(FEEDBACK_URL)) return false;
  try {
    await shell.openExternal(FEEDBACK_URL);
    return true;
  } catch (error) {
    console.error(`[external] ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
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

ipcMain.handle('custom-tags:transact', async (_event, operation, payload, bytes) => customTagLibrary.transact(operation, payload, bytes));
ipcMain.handle('custom-tags:import', async (_event, sourcePath) => {
  try { return sourcePath ? importCustomTagPack(sourcePath) : await showCustomTagPackImport(); }
  catch (error) { return customTagResultError(error); }
});
ipcMain.handle('custom-tags:export', async (_event, presetId) => exportCustomTagPack(presetId));

// Renderer code receives no general network primitive. Each webContents owns
// at most one bounded booru request; a new load or tab disposal cancels the
// previous one before the main-process adapter performs any network I/O.
const booruRequests = new Map();
ipcMain.handle('metadata:load-post', async (event, url) => {
  const senderId = event.sender.id;
  booruRequests.get(senderId)?.abort();
  const controller = new AbortController();
  booruRequests.set(senderId, controller);
  const onDestroyed = () => controller.abort();
  event.sender.once('destroyed', onDestroyed);
  try {
    const result = await loadBooruPost(url, { signal: controller.signal });
    return { ...result, bytes: new Uint8Array(result.bytes) };
  } finally {
    event.sender.removeListener('destroyed', onDestroyed);
    if (booruRequests.get(senderId) === controller) booruRequests.delete(senderId);
  }
});
ipcMain.handle('metadata:cancel-post', async event => {
  const controller = booruRequests.get(event.sender.id);
  if (!controller) return false;
  controller.abort();
  booruRequests.delete(event.sender.id);
  return true;
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
function sendComponentProgress(event) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('catalog:component-progress', event);
}
const componentProgressCoalescer = new ComponentProgressCoalescer(sendComponentProgress);
function emitComponentProgress(event) { componentProgressCoalescer.push(event); }
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
  componentProgressCoalescer.clear();
  componentPromise = ensureSelectedComponents({ catalogDir: appPaths.catalogDir, dataDir: appPaths.dataDir, descriptors, signal: componentController.signal, onProgress: emitComponentProgress })
    .finally(() => { componentProgressCoalescer.clear(); componentController = null; componentPromise = null; });
  return componentPromise;
});
ipcMain.handle('catalog:component-download', async (_event, componentId, repair = false) => {
  if (!app.isPackaged) throw new Error('Catalog component downloads are disabled in development mode.');
  if (componentPromise) throw new Error('A catalog component transfer is already running.');
  const descriptor = componentDescriptors().find(item => item.id === String(componentId));
  if (!descriptor) throw new Error('Unknown catalog component.');
  componentController = new AbortController();
  componentProgressCoalescer.clear();
  componentPromise = ensureComponent({ catalogDir: appPaths.catalogDir, descriptor, repair: Boolean(repair), signal: componentController.signal, onProgress: emitComponentProgress })
    .finally(() => { componentProgressCoalescer.clear(); componentController = null; componentPromise = null; });
  return componentPromise;
});
ipcMain.handle('catalog:component-cancel', async () => { if (!componentController) return false; componentProgressCoalescer.clear(); componentController.abort(); return true; });
ipcMain.handle('catalog:component-repair', async (_event, componentId) => {
  if (!app.isPackaged) throw new Error('Catalog component repairs are disabled in development mode.');
  if (componentPromise) throw new Error('A catalog component transfer is already running.');
  const descriptor = componentDescriptors().find(item => item.id === String(componentId));
  if (!descriptor) throw new Error('Unknown catalog component.');
  componentController = new AbortController();
  componentProgressCoalescer.clear();
  componentPromise = ensureComponent({ catalogDir: appPaths.catalogDir, descriptor, repair: true, signal: componentController.signal, onProgress: emitComponentProgress })
    .finally(() => { componentProgressCoalescer.clear(); componentController = null; componentPromise = null; });
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
      const parsed = new URL(request.url);
      const asset = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
      const parts = asset.replace(/\\/g, '/').split('/');
      let target;
      if (parsed.hostname === 'card' && parts.length === 2) target = customTagLibrary.resolveCardPreview(parts[0], parts[1]);
      else if (parts.length === 3 && parts[1] === 'previews') target = customTagLibrary.resolvePreview(parts[0], `previews/${parts[2]}`);
      else target = containedAsset(appPaths.customTagsDir, asset);
      return fs.existsSync(target) ? net.fetch(pathToFileURL(target).toString()) : new Response('Not found', { status: 404 });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  protocol.handle('nai-catalog', async request => {
    try {
      const asset = catalogAssetFromProtocolUrl(request.url);
      // Component and legacy catalog entries are read directly from their
      // ASAR data regions; no archive.asar/inner/path virtual filesystem path
      // is opened (which would otherwise extract UUID-named temporary files).
      // The former loose-file branch used fs.promises.readFile(target); the
      // descriptor reader now handles loose files and ASAR entries uniformly.
      const bytes = await readActiveCatalogAsset(appPaths.catalogDir, asset, { embeddedPath: embeddedCatalogPath() });
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
