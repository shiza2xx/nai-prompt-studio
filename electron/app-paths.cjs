const fs = require('node:fs');
const path = require('node:path');

/** Resolve all mutable Electron paths without consulting the host profile. */
function resolveAppPaths({ isPackaged, workspaceDir, executablePath }) {
  const workspace = path.resolve(workspaceDir);
  const executable = path.resolve(executablePath);
  const dataDir = isPackaged
    ? path.join(path.dirname(executable), 'data')
    : path.join(workspace, '.app-data');
  const logsDir = path.join(dataDir, 'logs');
  const crashDumpsDir = path.join(dataDir, 'crash-dumps');
  const customTagsDir = path.join(dataDir, 'custom-tags');
  const savedLibraryDir = path.join(dataDir, 'saved-library');
  const catalogDir = path.join(dataDir, 'catalog');
  const tempDir = path.join(dataDir, 'temp');
  const cacheDir = path.join(dataDir, 'cache');
  const updatesDir = path.join(dataDir, 'updates');
  return {
    workspace,
    executable,
    dataDir,
    logsDir,
    crashDumpsDir,
    customTagsDir, savedLibraryDir,
    catalogDir, tempDir, cacheDir, updatesDir,
    workspaceFile: path.join(dataDir, 'workspace.json')
  };
}

/** Make the selected profile usable, failing rather than falling back silently. */
function ensureWritable(paths) {
  try {
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.logsDir, { recursive: true });
    fs.mkdirSync(paths.crashDumpsDir, { recursive: true });
    fs.mkdirSync(paths.customTagsDir, { recursive: true });
    fs.mkdirSync(paths.savedLibraryDir, { recursive: true });
    fs.mkdirSync(paths.catalogDir, { recursive: true });
    fs.mkdirSync(paths.tempDir, { recursive: true });
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    fs.mkdirSync(paths.updatesDir, { recursive: true });
    const probe = path.join(paths.dataDir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`NAI Prompt Studio cannot write its profile at ${paths.dataDir}: ${detail}`);
  }
  return paths;
}

/** Copy the legacy profile only when the new profile does not exist. */
function migrateLegacyWorkspace(legacyFile, targetFile) {
  if (fs.existsSync(targetFile) || !legacyFile || !fs.existsSync(legacyFile)) return false;
  try {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(legacyFile, targetFile);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`NAI Prompt Studio could not migrate legacy profile ${legacyFile} to ${targetFile}: ${detail}`);
  }
}

module.exports = { resolveAppPaths, ensureWritable, migrateLegacyWorkspace };
