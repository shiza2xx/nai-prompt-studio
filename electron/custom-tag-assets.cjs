const fs = require('node:fs');
const path = require('node:path');

const MAX_CUSTOM_TAG_BYTES = 20 * 1024 * 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function isSupportedMime(mime) { return MIME_TYPES.has(mime); }

function canonicalPath(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function profileRoot(root) {
  const resolved = path.resolve(root);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { throw new Error('Custom tag profile directory is unavailable'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Custom tag profile directory must be a real directory');
  const real = fs.realpathSync.native(resolved);
  if (canonicalPath(real) !== canonicalPath(resolved)) throw new Error('Custom tag profile directory redirects outside its selected path');
  return { resolved, real };
}

function hasValidMagic(bytes, mime) {
  const value = Buffer.from(bytes);
  if (mime === 'image/png') return value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return value.length >= 3 && value.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === 'image/webp') return value.length >= 12 && value.toString('ascii', 0, 4) === 'RIFF' && value.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function validateImagePayload(bytes, mime) {
  const value = Buffer.from(bytes);
  if (!isSupportedMime(mime)) throw new Error('Unsupported custom tag image type');
  if (!value.length || value.length > MAX_CUSTOM_TAG_BYTES || !hasValidMagic(value, mime)) throw new Error('Custom tag image failed size or file signature validation');
  return value;
}

function containedAsset(root, name, { mustExist = true } = {}) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..')) throw new Error('Invalid custom tag asset name');
  const { resolved: base, real } = profileRoot(root);
  const target = path.resolve(base, name);
  if (!canonicalPath(target).startsWith(`${canonicalPath(base)}${path.sep}`)) throw new Error('Custom tag asset is outside the profile');
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) {
    if (error?.code === 'ENOENT' && !mustExist) return target;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error('Custom tag asset cannot be a symbolic link or junction');
  if (!stat.isFile()) throw new Error('Custom tag asset must be a regular file');
  const targetReal = fs.realpathSync.native(target);
  if (!canonicalPath(targetReal).startsWith(`${canonicalPath(real)}${path.sep}`)) throw new Error('Custom tag asset redirects outside the profile');
  return target;
}

function writeAsset(root, name, bytes, mime) {
  const value = validateImagePayload(bytes, mime);
  const target = containedAsset(root, name, { mustExist: false });
  const descriptor = fs.openSync(target, 'wx');
  try { fs.writeFileSync(descriptor, value); } finally { fs.closeSync(descriptor); }
  return target;
}

module.exports = { MAX_CUSTOM_TAG_BYTES, containedAsset, hasValidMagic, isSupportedMime, validateImagePayload, writeAsset };
