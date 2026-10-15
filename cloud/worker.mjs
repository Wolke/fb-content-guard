import { createCloudHandler } from './handler.mjs';
import { ipIdentity, issueSession, verifySession } from './security.mjs';
import { reserveQuota } from './quota.mjs';

export const VERSION = '0.2.0';
export const CONSENT_VERSION = 'cloud-v1';
const MAX_BODY = 800 * 1024;
async function emptyBody(request) {
  if (Number(request.headers.get('content-length')) > 0) return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('REQUEST_TIMEOUT')), 2000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) return true;
      if (value.byteLength) return false;
    }
  } finally { clearTimeout(timer); await reader.cancel(); reader.releaseLock(); }
}
const positive = (value, fallback, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('BAD_LIMIT');
  return n;
};
export async function handleCloudRequest(request, env, dependencies = {}) {
  const origin = request.headers.get('origin');
  const expected = `chrome-extension://${env.EXTENSION_ID}`;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
    ...(origin === expected ? { 'Access-Control-Allow-Origin': expected } : {}) };
  const send = (status, value) => new Response(JSON.stringify(value), { status, headers });
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return send(400, { error: 'HTTPS_REQUIRED' });
    if (origin && origin !== expected) return send(403, { error: 'FORBIDDEN' });
    if (!['/v1/health', '/v1/session', '/v1/moderate'].includes(url.pathname) || url.search) return send(404, { error: 'NOT_FOUND' });
    if (!/^[a-p]{32}$/.test(env.EXTENSION_ID || '') || !env.DB || !env.OPENAI_API_KEY ||
        !/^[a-f0-9]{64}$/.test(env.SESSION_SECRET || '')) return send(503, { error: 'SERVICE_NOT_CONFIGURED' });
    if (env.SERVICE_ENABLED !== 'true') return send(503, { error: 'SERVICE_PAUSED' });
    if (request.method === 'OPTIONS') {
      const requested = (request.headers.get('access-control-request-headers') || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (origin !== expected || !['POST', 'GET'].includes(request.headers.get('access-control-request-method')) ||
          requested.some(x => !['authorization', 'content-type', 'x-fg-consent'].includes(x))) return send(403, { error: 'FORBIDDEN' });
      return new Response(null, { status: 204, headers: { ...headers,
        'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-FG-Consent' } });
    }
    if (url.pathname === '/v1/health') {
      if (request.method !== 'GET') return send(405, { error: 'METHOD_NOT_ALLOWED' });
      return send(200, { ok: true, version: VERSION, consentVersion: CONSENT_VERSION });
    }
    if (request.method !== 'POST') return send(405, { error: 'METHOD_NOT_ALLOWED' });
    if (request.headers.get('x-fg-consent') !== CONSENT_VERSION) return send(403, { error: 'CONSENT_REQUIRED' });
    const now = dependencies.now?.() ?? Math.floor(Date.now() / 1000);
    // Cloudflare sets this header at the edge. Do not trust X-Forwarded-For.
    const ip = await ipIdentity(request.headers.get('cf-connecting-ip'), env.SESSION_SECRET, now);
    if (url.pathname === '/v1/session') {
      if (!await emptyBody(request)) return send(400, { error: 'UNEXPECTED_BODY' });
      if (!await reserveQuota(env.DB, { kind: 'session', subject: ip, ip, now,
        daily: 500, minute: 20, ipDaily: 30, ipMinute: 3, sessionDaily: 30 })) return send(429, { error: 'USAGE_LIMIT' });
      return send(200, await issueSession({ secret: env.SESSION_SECRET, audience: env.EXTENSION_ID, ip, now }));
    }
    const handler = createCloudHandler({ apiKey: env.OPENAI_API_KEY, extensionId: env.EXTENSION_ID,
      maxBodyBytes: MAX_BODY,
      verifySession: token => verifySession(token, { secret: env.SESSION_SECRET, audience: env.EXTENSION_ID, ip, now }),
      reserveQuota: (subject, units) => reserveQuota(env.DB, { kind: 'moderation', subject, ip, units,
        now: dependencies.now?.() ?? Math.floor(Date.now() / 1000),
        daily: positive(env.DAILY_LIMIT, 1000, 1000), minute: positive(env.MINUTE_LIMIT, 15, 15),
        ipDaily: 200, ipMinute: 15, sessionDaily: 100 }),
      ...(dependencies.moderateImpl ? { moderateImpl: dependencies.moderateImpl } : {})
    });
    return await handler(request);
  } catch { return send(503, { error: 'SERVICE_UNAVAILABLE' }); }
}
export default {
  fetch: (request, env) => handleCloudRequest(request, env),
  async scheduled(_event, env) {
    // Primary rows expire within 48–49 hours. Platform backups follow D1 policy.
    await env.DB.prepare('DELETE FROM usage_events WHERE created_at < ?1')
      .bind(Math.floor(Date.now() / 1000) - 48 * 3600).run();
  }
};
