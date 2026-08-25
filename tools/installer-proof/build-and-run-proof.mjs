import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalEnvironment, localPaths, projectRoot } from '../local-env.mjs';

const proofDir = join(localPaths.root, 'installer-proof');
const sourceDir = join(projectRoot, 'tools', 'installer-proof');
const launcher = join(proofDir, 'D-temp-proof.exe');
const payload = join(proofDir, 'D-temp-proof.payload');
const resultFile = join(proofDir, 'proof-result.txt');
const env = createLocalEnvironment();

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
}

mkdirSync(proofDir, { recursive: true });
for (const file of [launcher, payload, resultFile]) if (existsSync(file)) rmSync(file, { force: true });

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
run(launcher, [], proofDir);

const proof = readFileSync(resultFile, 'utf8');
if (!/^TEMP=D:\\/mi.test(proof) || !/^PLUGINSDIR=D:\\/mi.test(proof) || !/^NAI_INSTALLER_CACHE=D:\\/mi.test(proof)) {
  throw new Error(`Proof escaped drive D:\n${proof}`);
}
if (statSync(payload).size >= 10 * 1024 * 1024) throw new Error('Proof payload exceeds 10 MiB.');
console.log(proof.trim());
console.log(`PAYLOAD_BYTES=${statSync(payload).size}`);
