import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createLocalEnvironment, projectRoot } from './local-env.mjs';

const env = createLocalEnvironment();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);
run(process.execPath, [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'tools', 'optimize-desktop-catalog.ps1')]);
run(process.execPath, [join(projectRoot, 'tools', 'build-installer.mjs')]);
