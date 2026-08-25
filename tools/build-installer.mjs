import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalEnvironment, localPaths, projectRoot } from './local-env.mjs';
import { patchInstallerStoreCopy, restoreInstallerStoreCopy } from './electron-builder-nsis-store.mjs';
import { buildSelfExtractingSetup } from './self-extract.mjs';

const packageJson = (await import('../package.json', { with: { type: 'json' } })).default;
const version = packageJson.version;
const releaseDir = join(projectRoot, 'release-v5');
const rawName = `NAI-Prompt-Studio-V5-Payload-${version}.exe`;
const payloadName = `NAI-Prompt-Studio-V5-Setup-${version}.payload.exe`;
const launcherName = `NAI-Prompt-Studio-V5-Setup-${version}.exe`;
const rawPath = join(releaseDir, rawName);
const rawBlockmapPath = `${rawPath}.blockmap`;
const payloadPath = join(releaseDir, payloadName);
const launcherPath = join(releaseDir, launcherName);
const compiledLauncherDir = join(localPaths.root, 'installer-launcher');
const compiledLauncher = join(compiledLauncherDir, 'NAI-Installer-Launcher.exe');
const env = createLocalEnvironment();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(command)} exited with ${result.status}.`);
}

mkdirSync(releaseDir, { recursive: true });
mkdirSync(compiledLauncherDir, { recursive: true });
for (const output of [rawPath, rawBlockmapPath, payloadPath, launcherPath]) {
  if (existsSync(output)) rmSync(output, { force: true });
}

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
if (!existsSync(csc)) throw new Error(`Required Windows C# compiler is missing: ${csc}`);
if (existsSync(compiledLauncher)) rmSync(compiledLauncher, { force: true });
run(csc, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', `/out:${compiledLauncher}`, join(projectRoot, 'tools', 'installer-launcher', 'Program.cs')]);

patchInstallerStoreCopy();
try {
  run(process.execPath, [join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), '--win', 'nsis']);
} finally {
  restoreInstallerStoreCopy();
}
if (!existsSync(rawPath)) throw new Error(`electron-builder did not create ${rawPath}.`);
await import('node:fs/promises').then(({ rename }) => rename(rawPath, payloadPath));
await buildSelfExtractingSetup(compiledLauncher, payloadPath, launcherPath);
rmSync(payloadPath, { force: true });
rmSync(rawBlockmapPath, { force: true });

console.log(`Single-file setup: ${launcherPath}`);
console.log(`Mutable build roots: ${localPaths.root}`);
