import { statfsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createLocalEnvironment, projectRoot } from './local-env.mjs';

function freeBytes(root) {
  const stats = statfsSync(root, { bigint: true });
  return stats.bavail * stats.bsize;
}

const before = { C: freeBytes('C:\\'), D: freeBytes('D:\\') };
const minimum = { ...before };
const child = spawn(process.execPath, [join(projectRoot, 'tools', 'build-desktop.mjs')], {
  cwd: projectRoot,
  env: createLocalEnvironment(),
  stdio: 'inherit',
  windowsHide: true
});
const timer = setInterval(() => {
  minimum.C = minimum.C < freeBytes('C:\\') ? minimum.C : freeBytes('C:\\');
  minimum.D = minimum.D < freeBytes('D:\\') ? minimum.D : freeBytes('D:\\');
}, 250);

child.on('error', error => {
  clearInterval(timer);
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', code => {
  clearInterval(timer);
  const after = { C: freeBytes('C:\\'), D: freeBytes('D:\\') };
  console.log(JSON.stringify({
    before: { C: Number(before.C), D: Number(before.D) },
    minimum: { C: Number(minimum.C), D: Number(minimum.D) },
    after: { C: Number(after.C), D: Number(after.D) },
    peakConsumed: { C: Number(before.C - minimum.C), D: Number(before.D - minimum.D) },
    finalDelta: { C: Number(after.C - before.C), D: Number(after.D - before.D) }
  }));
  process.exitCode = code ?? 1;
});
