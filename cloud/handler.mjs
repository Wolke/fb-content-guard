// Transport-independent core. Production requires verified sessions and an atomic,
// persistent quota adapter; never substitute the old shared pairing token.
import { moderate, ServiceError, validatePayload } from '../server/moderation.mjs';

const BODY_LIMIT = 18 * 1024 * 1024;
const respond = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers }
});

async function readPayload(request, maxBytes) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new ServiceError('REQUEST_TOO_LARGE', 413);
  }
  if (!request.body) throw new ServiceError('INVALID_JSON');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  let timer, timedOut = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); reject(new ServiceError('REQUEST_TIMEOUT', 408)); }, 8000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (timedOut) throw new ServiceError('REQUEST_TIMEOUT', 408);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ServiceError('REQUEST_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ServiceError('INVALID_JSON'); }
  return validatePayload(value, { maxImageBytes: 128 * 1024, maxTotalImageBytes: 512 * 1024 });
}

/**
 * verifySession(token): verify a server-issued anonymous session and its expiry;
 * return { subject: sessionId } or null. This is not a user account or login.
 * reserveQuota(subject): atomically reserve per-session AND global/provider limits
 * in durable storage before returning true. Refuse on storage failure. Reservations
 * count failed provider requests too. CORS is not authentication.
 *
 * The Workers entry point supplies anonymous HMAC sessions and durable D1 quota.
 */
export function createCloudHandler({ apiKey, extensionId, verifySession, reserveQuota,
  moderateImpl = moderate, maxBodyBytes = BODY_LIMIT } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || !/^[a-p]{32}$/.test(extensionId || '') ||
      typeof verifySession !== 'function' || typeof reserveQuota !== 'function' ||
      !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > BODY_LIMIT) {
    throw new Error('CLOUD_CONFIGURATION_REQUIRED');
  }
  const extensionOrigin = `chrome-extension://${extensionId}`;
  return async request => {
    const origin = request.headers.get('origin');
    if (origin && origin !== extensionOrigin) return respond(403, { error: 'FORBIDDEN' });
    const cors = origin ? { 'Access-Control-Allow-Origin': extensionOrigin, Vary: 'Origin' } : {};
    const send = (status, body) => respond(status, body, cors);
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return send(400, { error: 'HTTPS_REQUIRED' });
    if (url.pathname !== '/v1/moderate' || url.search) return send(404, { error: 'NOT_FOUND' });
    if (request.method === 'OPTIONS') {
      if (origin !== extensionOrigin || request.headers.get('access-control-request-method') !== 'POST') {
        return send(403, { error: 'FORBIDDEN' });
      }
      const requested = (request.headers.get('access-control-request-headers') || '')
        .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (requested.some(name => !['authorization', 'content-type'].includes(name))) {
        return send(403, { error: 'FORBIDDEN' });
      }
      return new Response(null, { status: 204, headers: { ...cors,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return send(405, { error: 'METHOD_NOT_ALLOWED' });
    const authorization = request.headers.get('authorization') || '';
    if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(authorization)) {
      return send(401, { error: 'SESSION_REQUIRED' });
    }
    let session;
    try { session = await verifySession(authorization.slice(7)); }
    catch { return send(503, { error: 'SERVICE_UNAVAILABLE' }); }
    if (!session || typeof session.subject !== 'string' || !session.subject) {
      return send(401, { error: 'SESSION_REQUIRED' });
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return send(415, { error: 'JSON_REQUIRED' });
    }
    let payload;
    try { payload = await readPayload(request, maxBodyBytes); }
    catch (error) {
      return error instanceof ServiceError ? send(error.status, { error: error.code }) :
        send(400, { error: 'INVALID_CONTENT' });
    }
    try {
      // Must be literal true. Exceptions or unexpected adapter results fail closed.
      if (await reserveQuota(session.subject) !== true) return send(429, { error: 'USAGE_LIMIT' });
    } catch { return send(503, { error: 'SERVICE_UNAVAILABLE' }); }
    try {
      const result = await moderateImpl(payload, apiKey);
      if (!['allow', 'block'].includes(result?.decision)) throw new Error('INVALID_RESULT');
      return send(200, { decision: result.decision });
    } catch {
      // Never expose upstream error text, credentials or submitted post content.
      return send(503, { error: 'ANALYSIS_UNAVAILABLE' });
    }
  };
}
