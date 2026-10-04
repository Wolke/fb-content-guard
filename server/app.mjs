import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ServiceError, moderate, validatePayload } from './moderation.mjs';

const BODY_LIMIT = 18 * 1024 * 1024;
function authorized(header, token) {
  const actual = Buffer.from(header || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > BODY_LIMIT) throw new ServiceError('REQUEST_TOO_LARGE', 413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new ServiceError('INVALID_JSON'); }
}

export function createApp({ token, apiKey, dailyLimit = 2000, moderateImpl = moderate }) {
  if (!token || token.length < 32) throw new Error('A pairing token of at least 32 characters is required.');
  let active = 0, calls = 0, day = new Date().toISOString().slice(0, 10);
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      // Reject browser-page origins and DNS-rebinding hostnames; no permissive CORS.
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) throw new ServiceError('BAD_HOST', 403);
      const origin = req.headers.origin;
      if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new ServiceError('BAD_ORIGIN', 403);
      if (!authorized(req.headers.authorization, token)) throw new ServiceError('PAIRING_REQUIRED', 401);
      const today = new Date().toISOString().slice(0, 10);
      if (day !== today) { calls = 0; day = today; }
      if (req.method === 'GET' && req.url === '/health') {
        return send(200, { ok: true, configured: Boolean(apiKey), calls, dailyLimit, active, model: 'omni-moderation-latest' });
      }
      if (req.method !== 'POST' || req.url !== '/moderate') throw new ServiceError('NOT_FOUND', 404);
      if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new ServiceError('JSON_REQUIRED', 415);
      if (!apiKey) throw new ServiceError('API_KEY_MISSING', 503);
      if (calls >= dailyLimit) throw new ServiceError('DAILY_LIMIT', 429);
      if (active >= 2) throw new ServiceError('BUSY', 429);
      active++;
      try {
        const payload = validatePayload(await readBody(req));
        // Recheck after the asynchronous body read, before reserving the allowance.
        if (calls >= dailyLimit) throw new ServiceError('DAILY_LIMIT', 429);
        calls++;
        const result = await moderateImpl(payload, apiKey);
        if (!['allow', 'block'].includes(result?.decision)) throw new ServiceError('INVALID_PROVIDER_RESPONSE', 502);
        send(200, { decision: result.decision });
      } finally { active--; }
    } catch (error) {
      // Do not log request bodies, image URLs, keys, or provider error bodies.
      if (!res.headersSent && !res.destroyed) send(error instanceof ServiceError ? error.status : 500,
        { error: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR' });
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  server.timeout = 45000;
  return server;
}
