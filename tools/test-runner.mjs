import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot } from './local-env.mjs';

const groups = ['renderer', 'storage-custom-tags', 'catalogs', 'metadata-preview', 'release-static'];
for (const group of groups) {
  console.log(`\n[test] ${group}`);
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join(projectRoot, 'tools', 'test-groups', `${group}.mjs`)], { cwd: projectRoot, env: process.env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nAll sequential test groups passed.');
