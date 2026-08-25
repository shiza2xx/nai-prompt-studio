const { spawn } = require('node:child_process');

const parentPid = Number(process.argv[2]);
const installer = process.argv[3];
const installParent = process.argv[4];

if (!Number.isSafeInteger(parentPid) || parentPid < 1 || !installer || !installParent) process.exit(2);

function parentIsAlive() {
  try { process.kill(parentPid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function launchWhenClosed() {
  if (parentIsAlive()) { setTimeout(launchWhenClosed, 150); return; }
  const child = spawn(installer, ['/UPDATE', `/INSTALL_PARENT=${installParent}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: require('node:path').dirname(installer)
  });
  child.once('error', () => process.exit(3));
  child.once('spawn', () => { child.unref(); process.exit(0); });
}

launchWhenClosed();
