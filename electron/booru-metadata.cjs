const { validateImagePayload } = require('./custom-tag-assets.cjs');

const MAX_REMOTE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'NAI-Prompt-Studio/0.6 (+https://github.com/shiza2xx/nai-prompt-studio)';
const MIME_EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const SITE_CONFIG = {
  danbooru: {
    label: 'Danbooru', host: 'danbooru.donmai.us', pagePath: /^\/posts\/(\d+)\/?$/,
    api: id => `https://danbooru.donmai.us/posts/${id}.json`, apiPath: /^\/posts\/\d+\.json$/,
    apiQuery: url => url.search === '',
    imageHosts: new Set(['cdn.donmai.us', 'danbooru.donmai.us', 'static.donmai.us', 'images.donmai.us']),
    // Preserve the original post bytes whenever the API exposes them.
    // Large/sample/preview variants are display-oriented fallbacks and may
    // be lower-resolution recompressed JPEGs.
    imageFields: ['file_url', 'large_file_url', 'preview_file_url']
  },
  konachan: {
    label: 'Konachan', host: 'konachan.com', pagePath: /^\/post\/show\/(\d+)\/?$/,
    api: id => `https://konachan.com/post.json?tags=id:${id}`, apiPath: /^\/post\.json$/,
    apiQuery: url => url.searchParams.getAll('tags').length === 1 && /^id:\d+$/.test(url.searchParams.get('tags') || '') && [...url.searchParams.keys()].length === 1,
    imageHosts: new Set(['konachan.com', 'img.konachan.com', 'images.konachan.com']),
    imageFields: ['file_url', 'jpeg_url', 'sample_url', 'preview_url']
  },
  safebooru: {
    label: 'Safebooru', host: 'safebooru.org', pagePath: /^\/index\.php$/,
    api: id => `https://safebooru.org/index.php?page=dapi&s=post&q=index&id=${id}&json=1`, apiPath: /^\/index\.php$/,
    apiQuery: url => { const keys = [...url.searchParams.keys()]; return keys.length === 5 && new Set(keys).size === 5 && url.searchParams.get('page') === 'dapi' && url.searchParams.get('s') === 'post' && url.searchParams.get('q') === 'index' && /^\d+$/.test(url.searchParams.get('id') || '') && url.searchParams.get('json') === '1'; },
    imageHosts: new Set(['safebooru.org', 'img.safebooru.org', 'images.safebooru.org']),
    imageFields: ['file_url', 'image', 'sample_url', 'preview_url']
  }
};

class BooruMetadataError extends Error {
  constructor(message, code = 'BOORU_ERROR') { super(message); this.name = 'BooruMetadataError'; this.code = code; }
}

function configFor(site) {
  const config = SITE_CONFIG[site];
  if (!config) throw new BooruMetadataError('Unsupported booru site.', 'INVALID_SITE');
  return config;
}

function parseId(value) {
  if (!/^[1-9]\d{0,17}$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) return null;
  return value;
}

function hasUnsafeRawUrlForm(value) {
  const raw = String(value ?? '').trim();
  return raw.includes('\\') || /[?#]$/.test(raw);
}

function parsePostUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new BooruMetadataError('Enter a booru post URL.', 'INVALID_URL');
  const input = value.trim();
  if (hasUnsafeRawUrlForm(input)) throw new BooruMetadataError('Use the exact HTTPS booru post URL format.', 'INVALID_URL');
  let url;
  try { url = new URL(input); } catch { throw new BooruMetadataError('Enter a valid HTTPS booru post URL.', 'INVALID_URL'); }
  // URL normalizes the default HTTPS port away, so inspect the raw authority
  // as well. The supported page grammar has no explicit port, including :443.
  const authority = input.match(/^https:\/\/([^/?#]*)/i)?.[1] || '';
  if (authority.includes(':')) throw new BooruMetadataError('Only HTTPS booru post URLs are supported.', 'INVALID_URL');
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new BooruMetadataError('Only HTTPS booru post URLs are supported.', 'INVALID_URL');
  const host = url.hostname.toLocaleLowerCase();
  let site = Object.keys(SITE_CONFIG).find(key => SITE_CONFIG[key].host === host);
  if (!site) throw new BooruMetadataError('That booru site is not supported.', 'INVALID_URL');
  const config = SITE_CONFIG[site];
  let id = null;
  if (site === 'safebooru') {
    if (!config.pagePath.test(url.pathname) || url.hash) throw new BooruMetadataError('Use a Safebooru post URL with page, s, and id parameters.', 'INVALID_URL');
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 3 || new Set(keys).size !== 3 || !keys.every(key => ['page', 's', 'id'].includes(key)) || url.searchParams.get('page') !== 'post' || url.searchParams.get('s') !== 'view') throw new BooruMetadataError('Use a Safebooru post URL with page=post, s=view, and an id.', 'INVALID_URL');
    id = parseId(url.searchParams.get('id') || '');
  } else {
    const match = config.pagePath.exec(url.pathname);
    if (!match || url.search || url.hash) throw new BooruMetadataError(`Use the exact ${config.label} post URL format.`, 'INVALID_URL');
    id = parseId(match[1]);
  }
  if (!id) throw new BooruMetadataError('The post ID must be a positive number.', 'INVALID_URL');
  return { site, siteKey: site, id, page: url.toString(), pageUrl: url.toString(), label: config.label };
}

const parseBooruUrl = parsePostUrl;

function normalizeTagToken(value) {
  return String(value ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatNovelAITags(value) {
  const source = (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(/[\s,]+/));
  const result = []; const seen = new Set();
  for (const item of source) {
    const tag = normalizeTagToken(item);
    const identity = tag.normalize('NFKC').toLocaleLowerCase();
    if (!tag || seen.has(identity)) continue;
    seen.add(identity); result.push(tag);
  }
  return result.join(', ');
}

function responseHeader(response, name) {
  try { return response.headers?.get?.(name) || ''; } catch { return ''; }
}

function hasExplicitPort(value) {
  const authority = String(value).match(/^(?:https:)?\/\/([^/?#]*)/i)?.[1] || '';
  return authority.includes(':');
}

function allowedUrl(urlValue, kind, site) {
  if (hasUnsafeRawUrlForm(urlValue)) return false;
  let url;
  try { url = new URL(urlValue); } catch { return false; }
  if (hasExplicitPort(urlValue) || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  const config = configFor(site);
  const host = url.hostname.toLocaleLowerCase();
  if (kind === 'api') return host === config.host && config.apiPath.test(url.pathname) && url.pathname === url.pathname.toLocaleLowerCase() && config.apiQuery(url);
  return config.imageHosts.has(host);
}

function abortError(signal) {
  if (signal?.reason instanceof BooruMetadataError || signal?.reason?.code === 'ABORT_ERR') return signal.reason;
  return new BooruMetadataError('The booru request was cancelled.', 'ABORT_ERR');
}

async function readBounded(response, maxBytes, signal, timeoutMs, onCancel) {
  const declared = Number.parseInt(responseHeader(response, 'content-length'), 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new BooruMetadataError('The booru response is larger than 20 MiB.', 'TOO_LARGE');
    try { await Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
    try { onCancel?.(error); } catch {}
    throw error;
  }
  if (signal?.aborted) throw abortError(signal);
  if (typeof response.body?.getReader === 'function') {
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    let finished = false; let cancellationError; let rejectCancellation; let cancelPromise;
    const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
    const cancelReader = () => {
      if (cancelPromise) return cancelPromise;
      try { cancelPromise = Promise.resolve(reader.cancel()).catch(() => {}); }
      catch { cancelPromise = Promise.resolve(); }
      return cancelPromise;
    };
    const cancel = error => {
      if (cancellationError) return cancelPromise;
      cancellationError = error;
      cancelReader();
      try { onCancel?.(error); } catch {}
      rejectCancellation(error);
      return cancelPromise;
    };
    const onSignalAbort = () => cancel(abortError(signal));
    const timer = setTimeout(() => cancel(new BooruMetadataError('The booru request timed out.', 'TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', onSignalAbort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) { cancel(abortError(signal)); }
        const next = await Promise.race([reader.read(), cancellation]);
        if (next.done) break;
        const chunk = Buffer.from(next.value || []); total += chunk.length;
        if (total > maxBytes) {
          const error = new BooruMetadataError('The booru response is larger than 20 MiB.', 'TOO_LARGE');
          cancel(error); throw error;
        }
        chunks.push(chunk);
      }
      if (Number.isFinite(declared) && declared !== total) throw new BooruMetadataError('The booru response was truncated.', 'TRUNCATED');
      finished = true;
      return Buffer.concat(chunks, total);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onSignalAbort);
      if (!finished) await cancelReader();
      try { reader.releaseLock(); } catch {}
    }
  }
  const error = new BooruMetadataError('The booru response body is not a supported stream.', 'UNSUPPORTED_BODY');
  try { await Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
  try { onCancel?.(error); } catch {}
  throw error;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) throw abortError(signal);
    signal.addEventListener('abort', onAbort, { once: true });
  }
  let timer;
  let cancelReject;
  let onCancelled;
  try {
    const request = Promise.resolve().then(() => fetchImpl(url, { ...init, signal: controller.signal, redirect: 'manual' }));
    // Keep the deadline meaningful even for injected fetch implementations
    // that do not observe AbortSignal themselves.
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(new BooruMetadataError('The booru request timed out.', 'TIMEOUT')); reject(new BooruMetadataError('The booru request timed out.', 'TIMEOUT')); }, timeoutMs); });
    const cancelled = signal ? new Promise((_, reject) => { cancelReject = reject; onCancelled = () => reject(abortError(signal)); signal.addEventListener('abort', onCancelled, { once: true }); }) : null;
    request.catch(() => {});
    const response = await Promise.race(cancelled ? [request, deadline, cancelled] : [request, deadline]);
    return { response, abort: reason => controller.abort(reason) };
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (controller.signal.aborted) throw new BooruMetadataError('The booru request timed out.', 'TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort); if (onCancelled) signal?.removeEventListener('abort', onCancelled); cancelReject = undefined; onCancelled = undefined;
  }
}

async function requestBytes(fetchImpl, initialUrl, { site, kind, signal, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_REMOTE_BYTES, label = 'booru response' } = {}) {
  if (typeof fetchImpl !== 'function') throw new BooruMetadataError('The booru network adapter is unavailable.', 'NO_FETCH');
  let target = initialUrl; const seen = new Set();
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!allowedUrl(target, kind, site)) throw new BooruMetadataError('The booru response redirected to an unapproved URL.', 'REDIRECT_BLOCKED');
    if (seen.has(target)) throw new BooruMetadataError('The booru response contained a redirect loop.', 'REDIRECT_LOOP');
    seen.add(target);
    const fetched = await fetchWithTimeout(fetchImpl, target, { headers: { Accept: kind === 'api' ? 'application/json' : 'image/png,image/jpeg,image/webp', 'User-Agent': USER_AGENT } }, timeoutMs, signal);
    const response = fetched.response;
    if (response.status >= 300 && response.status < 400) {
      if (redirect === MAX_REDIRECTS) {
        fetched.abort(new BooruMetadataError('The booru response used too many redirects.', 'REDIRECT_LIMIT'));
        throw new BooruMetadataError('The booru response used too many redirects.', 'REDIRECT_LIMIT');
      }
      const location = responseHeader(response, 'location');
      if (!location) {
        fetched.abort(new BooruMetadataError('The booru response had an invalid redirect.', 'REDIRECT_INVALID'));
        throw new BooruMetadataError('The booru response had an invalid redirect.', 'REDIRECT_INVALID');
      }
      if (hasUnsafeRawUrlForm(location)) {
        fetched.abort(new BooruMetadataError('The booru response redirected to an unapproved URL.', 'REDIRECT_BLOCKED'));
        throw new BooruMetadataError('The booru response redirected to an unapproved URL.', 'REDIRECT_BLOCKED');
      }
      if (hasExplicitPort(location)) {
        fetched.abort(new BooruMetadataError('The booru response redirected to an unapproved URL.', 'REDIRECT_BLOCKED'));
        throw new BooruMetadataError('The booru response redirected to an unapproved URL.', 'REDIRECT_BLOCKED');
      }
      fetched.abort(new BooruMetadataError('The booru response redirected.', 'REDIRECT'));
      try { target = new URL(location, target).toString(); } catch { throw new BooruMetadataError('The booru response had an invalid redirect.', 'REDIRECT_INVALID'); }
      continue;
    }
    const status = Number(response.status) || 200;
    if (response.ok === false || status < 200 || status >= 300) {
      fetched.abort(new BooruMetadataError(`${label} returned HTTP ${response.status || 0}.`, 'HTTP_ERROR'));
      throw new BooruMetadataError(`${label} returned HTTP ${response.status || 0}.`, 'HTTP_ERROR');
    }
    const bytes = await readBounded(response, maxBytes, signal, timeoutMs, error => fetched.abort(error));
    const mime = responseHeader(response, 'content-type').split(';', 1)[0].trim().toLocaleLowerCase();
    if (kind === 'api' && (!mime || (!mime.endsWith('/json') && !mime.endsWith('+json')))) {
      fetched.abort(new BooruMetadataError('The booru API returned an invalid JSON MIME type.', 'API_MIME_INVALID'));
      throw new BooruMetadataError('The booru API returned an invalid JSON MIME type.', 'API_MIME_INVALID');
    }
    return { bytes, mime, url: target };
  }
  throw new BooruMetadataError('The booru response used too many redirects.', 'REDIRECT_LIMIT');
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new BooruMetadataError('The booru API returned malformed JSON.', 'MALFORMED_JSON'); }
}

function firstString(value, keys) {
  for (const key of keys) if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  return '';
}

function postFromApi(site, value) {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new BooruMetadataError('The booru API returned no post.', 'EMPTY_POST');
  return source;
}

function numericText(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : '';
}

function normalizeRating(value) {
  const raw = String(value ?? '').trim().toLocaleLowerCase();
  return ({ g: 'safe', s: 'sensitive', q: 'questionable', e: 'explicit' })[raw] || raw;
}

function normalizePost(parsed, request) {
  const post = postFromApi(request.site, parsed);
  const id = numericText(post.id);
  if (!id || id !== request.id) throw new BooruMetadataError('The booru API returned a different post.', 'POST_MISMATCH');
  const tags = firstString(post, ['tag_string', 'tags']);
  const combined = tags || [post.tag_string_general, post.tag_string_character, post.tag_string_artist, post.tag_string_copyright, post.tag_string_meta].filter(value => typeof value === 'string').join(' ');
  const width = numericText(post.image_width ?? post.width);
  const height = numericText(post.image_height ?? post.height);
  const candidates = [];
  const config = configFor(request.site);
  for (const field of config.imageFields) { if (typeof post[field] === 'string' && post[field].trim()) candidates.push(post[field].trim()); }
  if (typeof post.file_url === 'string' && !candidates.includes(post.file_url)) candidates.push(post.file_url);
  if (!candidates.length) throw new BooruMetadataError('The booru post does not contain a supported image URL.', 'NO_IMAGE');
  return {
    site: request.site, siteKey: request.site, siteName: config.label, id: request.id, page: request.pageUrl, pageUrl: request.pageUrl,
    source: firstString(post, ['source', 'source_url']), tags: formatNovelAITags(combined), width, height,
    rating: normalizeRating(firstString(post, ['rating', 'score_rating'])), candidates
  };
}

function mimeFromMagic(bytes) {
  const value = Buffer.from(bytes);
  if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return 'image/jpeg';
  if (value.length >= 12 && value.toString('ascii', 0, 4) === 'RIFF' && value.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function imageName(urlValue, request, mime) {
  let name = '';
  try { name = decodeURIComponent(new URL(urlValue).pathname.split('/').pop() || ''); } catch {}
  name = name.normalize('NFKC').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 255);
  const extension = MIME_EXTENSION[mime];
  if (!name || !/\.(?:png|jpe?g|webp)$/i.test(name)) name = `${request.site}-${request.id}.${extension}`;
  return name;
}

async function loadPost(value, { fetch: fetchImpl = globalThis.fetch, fetchImpl: injectedFetch, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  fetchImpl = injectedFetch || fetchImpl;
  const request = typeof value === 'string' ? parsePostUrl(value) : value && typeof value === 'object' ? parsePostUrl(value.page || value.url) : parsePostUrl(value);
  const config = configFor(request.site);
  const api = await requestBytes(fetchImpl, config.api(request.id), { site: request.site, kind: 'api', signal, timeoutMs, maxBytes: MAX_JSON_BYTES, label: `${config.label} API` });
  const normalized = normalizePost(parseJson(api.bytes), request);
  let lastError = null;
  for (const candidate of normalized.candidates) {
    if (hasUnsafeRawUrlForm(candidate)) { lastError = new BooruMetadataError('The booru image URL is not approved.', 'IMAGE_HOST_BLOCKED'); continue; }
    let imageUrl;
    try { imageUrl = new URL(candidate, request.pageUrl).toString(); } catch { lastError = new BooruMetadataError('The booru image URL is invalid.', 'INVALID_IMAGE_URL'); continue; }
    if (!allowedUrl(imageUrl, 'image', request.site)) { lastError = new BooruMetadataError('The booru image URL is not approved.', 'IMAGE_HOST_BLOCKED'); continue; }
    try {
      const image = await requestBytes(fetchImpl, imageUrl, { site: request.site, kind: 'image', signal, timeoutMs, maxBytes: MAX_REMOTE_BYTES, label: `${config.label} image` });
      const detected = mimeFromMagic(image.bytes); const declared = image.mime;
      if (!detected || !MIME_EXTENSION[detected] || !declared || !MIME_EXTENSION[declared] || declared !== detected) throw new BooruMetadataError('The booru image MIME or file signature is invalid.', 'IMAGE_INVALID');
      validateImagePayload(image.bytes, detected);
      return { ...normalized, bytes: image.bytes, mime: detected, name: imageName(image.url, request, detected), originalName: imageName(image.url, request, detected), imageUrl: image.url };
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (error?.code === 'ABORT_ERR' || error?.code === 'TIMEOUT') throw error;
      lastError = error;
    }
  }
  throw lastError || new BooruMetadataError('No usable image was available for this booru post.', 'NO_IMAGE');
}

module.exports = {
  MAX_REMOTE_BYTES, MAX_JSON_BYTES, DEFAULT_TIMEOUT_MS, MAX_REDIRECTS, USER_AGENT,
  BooruMetadataError, SITE_CONFIG, parsePostUrl, parseBooruUrl, parseBooruPostUrl: parsePostUrl,
  formatNovelAITags, formatTags: formatNovelAITags, normalizeRating, normalizePost, normalizeBooruPost: normalizePost,
  requestBytes, loadPost, loadBooruPost: loadPost
};
