import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localRoot = join(projectRoot, '.local-cache');

export const localPaths = Object.freeze({
  root: localRoot,
  temp: join(localRoot, 'temp'),
  npm: join(localRoot, 'npm'),
  electron: join(localRoot, 'electron'),
  electronBuilder: join(localRoot, 'electron-builder'),
  nuget: join(localRoot, 'nuget'),
  dotnet: join(localRoot, 'dotnet')
});

export function createLocalEnvironment(base = process.env) {
  for (const directory of Object.values(localPaths)) mkdirSync(directory, { recursive: true });
  return {
    ...base,
    TEMP: localPaths.temp,
    TMP: localPaths.temp,
    TMPDIR: localPaths.temp,
    ELECTRON_CACHE: localPaths.electron,
    ELECTRON_BUILDER_CACHE: localPaths.electronBuilder,
    npm_config_cache: localPaths.npm,
    NUGET_PACKAGES: localPaths.nuget,
    DOTNET_CLI_HOME: localPaths.dotnet,
    DOTNET_CLI_TELEMETRY_OPTOUT: '1'
  };
}

export function applyLocalEnvironment() {
  Object.assign(process.env, createLocalEnvironment());
  return process.env;
}
