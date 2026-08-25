import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';
import { applyLocalEnvironment } from './local-env.mjs';

applyLocalEnvironment();

const electron = resolve('node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const viteCli = resolve('node_modules', 'vite', 'bin', 'vite.js');
const url = 'http://127.0.0.1:5173';
let vite;
let desktop;

function stop() {
  vite?.kill();
  desktop?.kill();
}

function waitForServer() {
  return new Promise((resolveReady, reject) => {
    const deadline = Date.now() + 30_000;
    const check = () => {
      const request = http.get(url, response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolveReady();
        else retry();
      });
      request.on('error', retry);
    };
    const retry = () => Date.now() > deadline ? reject(new Error('Vite did not start within 30 seconds.')) : setTimeout(check, 250);
    check();
  });
}

vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '5173'], { stdio: 'inherit' });
vite.on('exit', code => {
  if (!desktop) process.exitCode = code ?? 1;
  else stop();
});

try {
  await waitForServer();
  desktop = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
  desktop.on('exit', stop);
} catch (error) {
  console.error(error);
  stop();
  process.exitCode = 1;
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
