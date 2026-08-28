import { closeSync, copyFileSync, createReadStream, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLocalEnvironment, localPaths, projectRoot } from '../local-env.mjs';
import { buildSelfExtractingSetup } from '../self-extract.mjs';

const proofDir = join(localPaths.root, 'installer-proof');
const sourceDir = join(projectRoot, 'tools', 'installer-proof');
const launcher = join(proofDir, 'D-temp-proof.exe');
const payload = join(proofDir, 'D-temp-proof.payload.exe');
const legacyPayload = join(proofDir, 'D-temp-proof.payload');
const installedLauncher = join(proofDir, 'Installed Uninstall.exe');
const installedPayload = join(proofDir, 'Installed Uninstall.payload');
const resultFile = join(proofDir, 'proof-result.txt');
const env = { ...createLocalEnvironment(), NAI_PROOF_RESULT: resultFile };

function run(command, args, cwd = projectRoot, environment = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  const output = [result.stdout, result.stderr].filter(Boolean).join('');
  if (output) process.stderr.write(output);
  if (result.error) throw new Error(`${command} failed: ${result.error.message}${output ? `\n${output}` : ''}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.${output ? `\n${output}` : ''}`);
}

async function sha512(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function createFatSource(installDirectory, firstByte) {
  const source = join(installDirectory, 'resources', 'app.asar');
  mkdirSync(join(installDirectory, 'resources'), { recursive: true });
  const descriptor = openSync(source, 'w');
  try {
    ftruncateSync(descriptor, 268435456);
    writeSync(descriptor, Buffer.from([firstByte]), 0, 1, 0);
    writeSync(descriptor, Buffer.from([firstByte ^ 0xff]), 0, 1, 268435455);
  } finally {
    closeSync(descriptor);
  }
  return source;
}

function legacyDestination(installDirectory) {
  return join(installDirectory, 'data', 'catalog', 'legacy', 'legacy-app.asar');
}

mkdirSync(proofDir, { recursive: true });
for (const file of [launcher, payload, legacyPayload, installedLauncher, installedPayload, resultFile]) if (existsSync(file)) rmSync(file, { force: true });

const nsisRoot = join(localPaths.electronBuilder, 'nsis-3.0.4.1');
const makensisRelative = existsSync(nsisRoot)
  ? readdirSync(nsisRoot, { recursive: true }).find(file => String(file).replaceAll('\\', '/').endsWith('/makensis.exe') || file === 'makensis.exe')
  : undefined;
if (!makensisRelative) throw new Error(`Copy the existing electron-builder NSIS cache to ${localPaths.electronBuilder} before running this proof.`);
const makensis = join(nsisRoot, String(makensisRelative));
copyFileSync(join(sourceDir, 'proof.nsi'), join(proofDir, 'proof.nsi'));
run(makensis, [`/DPROJECT_ROOT=${projectRoot}`, 'proof.nsi'], proofDir);

// Exercise the exact PreserveLegacyCatalog function from build/installer.nsh
// against D-local disposable installs. The 256 MiB sparse file is the
// production threshold, so this proof does not weaken the migration gate.
const hardlinkInstall = join(proofDir, "legacy install path with spaces and apostrophe's");
const canonicalInstall = join(proofDir, "canonical install path with spaces and apostrophe's");
const fallbackInstall = join(proofDir, "copy fallback install path with spaces and apostrophe's");
for (const directory of [hardlinkInstall, canonicalInstall, fallbackInstall]) if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
const hardlinkSource = createFatSource(hardlinkInstall, 0x2a);
run(payload, ['/S'], proofDir, { NAI_PROOF_INSTALL: hardlinkInstall });
const hardlinkDestination = legacyDestination(hardlinkInstall);
if (!existsSync(hardlinkDestination) || existsSync(`${hardlinkDestination}.partial`)) throw new Error('Hardlink preservation did not atomically produce a complete destination.');
if (!existsSync(hardlinkSource)) throw new Error('Hardlink preservation removed the source ASAR.');
if (statSync(hardlinkSource).size !== statSync(hardlinkDestination).size || await sha512(hardlinkSource) !== await sha512(hardlinkDestination)) throw new Error('Hardlink preservation changed bytes or SHA-512.');

// An existing valid canonical archive is immutable, even when the source has
// different bytes. This uses an independent copy so hardlink identity cannot
// make the assertion vacuous.
const canonicalSource = createFatSource(canonicalInstall, 0x31);
const canonicalDestination = legacyDestination(canonicalInstall);
mkdirSync(join(canonicalInstall, 'data', 'catalog', 'legacy'), { recursive: true });
copyFileSync(canonicalSource, canonicalDestination);
const canonicalHash = await sha512(canonicalDestination);
const canonicalSourceHandle = openSync(canonicalSource, 'r+');
try { writeSync(canonicalSourceHandle, Buffer.from([0x63]), 0, 1, 0); } finally { closeSync(canonicalSourceHandle); }
run(payload, ['/S'], proofDir, { NAI_PROOF_INSTALL: canonicalInstall });
if (await sha512(canonicalDestination) !== canonicalHash || existsSync(`${canonicalDestination}.partial`)) throw new Error('Valid canonical preservation was replaced or left a partial file.');

// Force the production fsutil branch to fall back to Copy-Item using a
// nonexistent D-local SystemRoot. PreserveLegacyCatalog supplies a valid root
// to PowerShell startup, while the captured root makes fsutil unavailable.
const fallbackSource = createFatSource(fallbackInstall, 0x4c);
run(payload, ['/S'], proofDir, { NAI_PROOF_INSTALL: fallbackInstall, SystemRoot: join(proofDir, 'missing-system-root') });
const fallbackDestination = legacyDestination(fallbackInstall);
if (!existsSync(fallbackDestination) || existsSync(`${fallbackDestination}.partial`)) throw new Error('Copy fallback did not atomically produce a complete destination.');
if (!existsSync(fallbackSource) || statSync(fallbackSource).size !== statSync(fallbackDestination).size || await sha512(fallbackSource) !== await sha512(fallbackDestination)) throw new Error('Copy fallback changed bytes or SHA-512.');

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
run(csc, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', `/out:${launcher}`, join(projectRoot, 'tools', 'installer-launcher', 'Program.cs')]);
const compiled = join(proofDir, 'D-temp-proof-launcher.exe');
copyFileSync(launcher, compiled);
await buildSelfExtractingSetup(compiled, payload, launcher);
const proofParent = join(proofDir, 'parent path with spaces');
run(launcher, ['/UPDATE', `/INSTALL_PARENT=${join(proofDir, 'parent')}`, 'path', 'with', 'spaces'], proofDir);

const proof = readFileSync(resultFile, 'utf8');
if (!/^TEMP=D:\\/mi.test(proof) || !/^PLUGINSDIR=D:\\/mi.test(proof) || !/^NAI_INSTALLER_CACHE=D:\\/mi.test(proof)) {
  throw new Error(`Proof escaped drive D:\n${proof}`);
}
if (!/^CMDLINE=.*\/UPDATE/mi.test(proof) || /^CMDLINE=.*\/INSTALL_PARENT=/mi.test(proof)) {
  throw new Error(`Launcher did not preserve ordinary arguments or leaked its parent-path transport argument:\n${proof}`);
}
if (!/^INSTALL_DIR=D:\\.*parent path with spaces\\NAI Prompt Studio\s*$/mi.test(proof)) {
  throw new Error(`Launcher did not convert the spaced install parent to NSIS' authoritative install directory:\n${proof}`);
}

copyFileSync(compiled, installedLauncher);
copyFileSync(payload, installedPayload);
run(installedLauncher, ['/S'], proofDir);
const uninstallProof = readFileSync(resultFile, 'utf8');
if (!new RegExp(`^CMDLINE=.* /S _\\?=${proofDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(uninstallProof)) {
  throw new Error(`Direct installed-uninstaller mode did not append its raw installation directory last:\n${uninstallProof}`);
}
rmSync(installedPayload, { force: true });

const launcherSource = readFileSync(join(projectRoot, 'tools', 'installer-launcher', 'Program.cs'), 'utf8');
if (!/start\.Arguments \+= " _\?=" \+ originalDirectoryArgumentValue/.test(launcherSource)) throw new Error('Launcher no longer appends _?= raw and last.');
if (!/start\.Arguments \+= " \/D=" \+ installDirectoryArgumentValue/.test(launcherSource)) throw new Error('Launcher no longer appends the native NSIS install path raw.');
if (/start\.EnvironmentVariables/.test(launcherSource)) throw new Error('Launcher must not rebuild a host environment that may contain both Path and PATH.');
if (existsSync(`${launcher}.payload`)) throw new Error('Proof unexpectedly produced a setup sidecar.');
if (statSync(launcher).size >= 10 * 1024 * 1024) throw new Error('Proof setup exceeds 10 MiB.');
console.log(proof.trim());
console.log(`SETUP_BYTES=${statSync(launcher).size}`);
