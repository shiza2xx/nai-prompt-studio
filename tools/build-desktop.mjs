import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalEnvironment, projectRoot } from './local-env.mjs';
import { normalizeDescriptors } from '../electron/catalog-components.cjs';

const env = createLocalEnvironment();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Packaging is closed over a complete, freshly generated component set. This
// runs before electron-builder so a thin desktop build can never silently ship
// compact metadata with missing catalog descriptors/packs.
run(process.execPath, [join(projectRoot, 'tools', 'catalog-packs.mjs')]);
const descriptor = join(projectRoot, 'release-v5', 'catalog-packs', 'catalog-components.json');
if (!existsSync(descriptor)) throw new Error(`Catalog component descriptor is missing: ${descriptor}`);
const descriptors = normalizeDescriptors(JSON.parse(readFileSync(descriptor, 'utf8')));
if (descriptors.length !== 3 || descriptors.some(item => !existsSync(join(projectRoot, 'release-v5', 'catalog-packs', item.filename)))) throw new Error('Catalog component packs are incomplete; refusing desktop packaging.');
run(process.execPath, [join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);
run(process.execPath, [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'tools', 'thin-dist-catalog.ps1')]);
copyFileSync(descriptor, join(projectRoot, 'dist', 'catalog', 'catalog-components.json'));
run(process.execPath, [join(projectRoot, 'tools', 'build-installer.mjs')]);
