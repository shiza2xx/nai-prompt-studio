const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const MANIFEST_URL = 'https://github.com/shiza2xx/nai-prompt-studio/releases/latest/download/update-manifest.json';
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

function semver(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  return match ? match.slice(1).map(Number) : null;
}
function compareVersions(left, right) {
  const a = semver(left); const b = semver(right);
  if (!a || !b) throw new Error('Update manifest contains an invalid semantic version.');
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
function validateManifest(raw, currentVersion) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) throw new Error('Unsupported update manifest schema.');
  const asset = String(raw.asset || '');
  const url = new URL(String(raw.url || ''));
  const size = Number(raw.size);
  const sha512 = String(raw.sha512 || '').toLowerCase();
  if (!semver(raw.version)) throw new Error('Update manifest contains an invalid semantic version.');
  if (compareVersions(raw.version, currentVersion) <= 0) return { available: false, version: String(raw.version) };
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('Update asset host is not trusted.');
  if (!/^NAI-Prompt-Studio-V5-Setup-\d+\.\d+\.\d+\.exe$/.test(asset) || path.basename(url.pathname) !== asset) throw new Error('Update installer asset name is invalid.');
  if (!Number.isSafeInteger(size) || size < 1024 || size > 2 * 1024 * 1024 * 1024) throw new Error('Update installer size is invalid.');
  if (!/^[a-f0-9]{128}$/.test(sha512)) throw new Error('Update installer SHA-512 is invalid.');
  return { available: true, schemaVersion: 1, version: String(raw.version), asset, url: url.toString(), size, sha512, releaseNotes: String(raw.releaseNotes || '') };
}
function request(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many update redirects.'));
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) return Promise.reject(new Error('Update redirect host is not trusted.'));
  return new Promise((resolve, reject) => https.get(parsed, { headers: { 'User-Agent': 'NAI-Prompt-Studio-Updater', Accept: 'application/octet-stream, application/json' } }, response => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) { response.resume(); resolve(request(new URL(response.headers.location, parsed).toString(), redirects + 1)); return; }
    if (response.statusCode !== 200) { response.resume(); reject(new Error(`Update server returned HTTP ${response.statusCode}.`)); return; }
    resolve(response);
  }).on('error', reject));
}
async function checkForUpdate(currentVersion, fetchJson) {
  const raw = fetchJson ? await fetchJson(MANIFEST_URL) : await new Promise(async (resolve, reject) => {
    try { const response = await request(MANIFEST_URL); const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } }); response.on('error', reject); } catch (error) { reject(error); }
  });
  return validateManifest(raw, currentVersion);
}
async function downloadInstaller(manifest, updatesDir) {
  fs.mkdirSync(updatesDir, { recursive: true });
  const target = path.join(updatesDir, manifest.asset); const partial = `${target}.partial`;
  fs.rmSync(target, { force: true }); fs.rmSync(partial, { force: true });
  const response = await request(manifest.url); const hash = crypto.createHash('sha512'); let size = 0;
  await new Promise((resolve, reject) => { const output = fs.createWriteStream(partial, { flags: 'w' }); response.on('data', chunk => { size += chunk.length; hash.update(chunk); }); response.pipe(output); output.on('finish', resolve); output.on('error', reject); response.on('error', reject); });
  if (size !== manifest.size || hash.digest('hex') !== manifest.sha512) { fs.rmSync(partial, { force: true }); throw new Error('Downloaded update failed size or SHA-512 verification.'); }
  fs.renameSync(partial, target); return target;
}

module.exports = { MANIFEST_URL, ALLOWED_HOSTS, compareVersions, validateManifest, checkForUpdate, downloadInstaller };
