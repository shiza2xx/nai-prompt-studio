import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
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
run(makensis, ['proof.nsi'], proofDir);

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
run(csc, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', `/out:${launcher}`, join(projectRoot, 'tools', 'installer-launcher', 'Program.cs')]);
const compiled = join(proofDir, 'D-temp-proof-launcher.exe');
copyFileSync(launcher, compiled);
await buildSelfExtractingSetup(compiled, payload, launcher);
const proofParent = join(proofDir, 'parent path with spaces');
run(launcher, ['/UPDATE', `/INSTALL_PARENT=${proofParent}`], proofDir);

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
if (existsSync(`${launcher}.payload`)) throw new Error('Proof unexpectedly produced a setup sidecar.');
if (statSync(launcher).size >= 10 * 1024 * 1024) throw new Error('Proof setup exceeds 10 MiB.');
console.log(proof.trim());
console.log(`SETUP_BYTES=${statSync(launcher).size}`);
