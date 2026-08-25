import { spawn } from 'node:child_process';
import { createLocalEnvironment, projectRoot } from './local-env.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node tools/run-local.mjs <command> [arguments...]');
  process.exit(2);
}

const executable = command === 'node' ? process.execPath : command;
const child = spawn(executable, args, {
  cwd: projectRoot,
  env: createLocalEnvironment(),
  stdio: 'inherit',
  windowsHide: true
});

child.on('error', error => {
  console.error(`Cannot start ${command}: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`${command} stopped by ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
