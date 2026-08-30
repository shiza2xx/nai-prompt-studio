import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { localPaths, projectRoot } from './local-env.mjs';

export const upstreamNsisTemplatesDir = join(projectRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis');
export const nsisInstallerTemplate = join(upstreamNsisTemplatesDir, 'include', 'installer.nsh');
export const upstreamStoreCopy = '      !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"';
export const disabledStoreCopy = '      # NAI invariant: never persist the full installer in system LOCALAPPDATA.';

export function templateChecksum(file = nsisInstallerTemplate) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function prepareIsolatedNsisTemplates({ cacheRoot = join(localPaths.root, 'nsis-templates'), failpoint = null } = {}) {
  const sourceChecksum = templateChecksum();
  const stage = `${cacheRoot}.stage-${process.pid}-${randomBytes(5).toString('hex')}`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(dirname(cacheRoot), { recursive: true });
  try {
    failpoint?.('before-copy');
    cpSync(upstreamNsisTemplatesDir, stage, { recursive: true, force: false, errorOnExist: true });
    failpoint?.('after-copy');
    const copiedInstaller = join(stage, 'include', 'installer.nsh');
    const source = readFileSync(copiedInstaller, 'utf8');
    const matches = source.split(upstreamStoreCopy).length - 1;
    if (matches !== 1 || source.includes(disabledStoreCopy)) throw new Error(`Expected exactly one pristine electron-builder installer-store copy, found ${matches}.`);
    writeFileSync(copiedInstaller, source.replace(upstreamStoreCopy, disabledStoreCopy), 'utf8');
    failpoint?.('after-patch');
    rmSync(cacheRoot, { recursive: true, force: true });
    renameSync(stage, cacheRoot);
    if (templateChecksum() !== sourceChecksum) throw new Error('Upstream electron-builder NSIS template changed during isolated preparation.');
    return { templatesDir: cacheRoot, upstreamChecksum: sourceChecksum, patchedChecksum: templateChecksum(join(cacheRoot, 'include', 'installer.nsh')) };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (templateChecksum() !== sourceChecksum) throw new Error('Upstream electron-builder NSIS template was mutated while preparing the isolated copy.', { cause: error });
    throw error;
  }
}

export function patchInstallerStoreCopy() { throw new Error('In-place NSIS template patching is disabled; use prepareIsolatedNsisTemplates().'); }
export function restoreInstallerStoreCopy() { /* node_modules is immutable */ }
