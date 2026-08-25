import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './local-env.mjs';

export const nsisInstallerTemplate = join(projectRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include', 'installer.nsh');
export const upstreamStoreCopy = '      !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"';
export const disabledStoreCopy = '      # NAI invariant: never persist the full installer in system LOCALAPPDATA.';

export function patchInstallerStoreCopy() {
  let source = readFileSync(nsisInstallerTemplate, 'utf8');
  if (source.includes(disabledStoreCopy) && !source.includes(upstreamStoreCopy)) {
    source = source.replace(disabledStoreCopy, upstreamStoreCopy);
  }
  const matches = source.split(upstreamStoreCopy).length - 1;
  if (matches !== 1) throw new Error(`Expected exactly one electron-builder installer-store copy, found ${matches}.`);
  writeFileSync(nsisInstallerTemplate, source.replace(upstreamStoreCopy, disabledStoreCopy), 'utf8');
}

export function restoreInstallerStoreCopy() {
  const source = readFileSync(nsisInstallerTemplate, 'utf8');
  if (source.includes(disabledStoreCopy)) {
    writeFileSync(nsisInstallerTemplate, source.replace(disabledStoreCopy, upstreamStoreCopy), 'utf8');
  }
}
