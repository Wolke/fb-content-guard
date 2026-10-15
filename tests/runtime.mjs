// Runs the compiled Worker in Cloudflare's local workerd with real local D1.
// All outbound requests are intercepted; no real OpenAI or Facebook traffic.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const extensionId = 'pgncaeldodjlhkgmkknppnjephnnoobf';
let calls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: fileURLToPath(new URL('../cloud/dist/worker/entry.js', import.meta.url)),
  compatibilityDate: '2026-10-15', compatibilityFlags: ['nodejs_compat'],
  cf: false, telemetry: { enabled: false },
  bindings: { EXTENSION_ID: extensionId, OPENAI_API_KEY: 'fake-test-key', SESSION_SECRET: 'a'.repeat(64),
    SERVICE_ENABLED: 'true', DAILY_LIMIT: '2', MINUTE_LIMIT: '2' },
  d1Databases: { DB: 'runtime-test' },
  outboundService: async request => {
    assert.equal(request.url, 'https://api.openai.com/v1/moderations');
    const body = await request.json();
    assert.equal(body.model, 'omni-moderation-latest');
    assert.equal(request.headers.get('authorization'), 'Bearer fake-test-key');
    calls++;
    return new Response(JSON.stringify({ results: [{ categories: { sexual: false, 'sexual/minors': false } }] }),
      { headers: { 'Content-Type': 'application/json' } });
  }
}));
try {
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../cloud/migrations/0001_usage.sql', import.meta.url), 'utf8');
  for (const statement of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const request = (path, token, body) => mf.dispatchFetch('https://api.example' + path, {
    method: path === '/v1/health' ? 'GET' : 'POST',
    headers: { Origin: `chrome-extension://${extensionId}`, 'CF-Connecting-IP': '192.0.2.1', 'X-FG-Consent': 'cloud-v1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  assert.equal((await request('/v1/health')).status, 200);
  const sessionResponse = await request('/v1/session');
  assert.equal(sessionResponse.status, 200, await sessionResponse.clone().text());
  const { token } = await sessionResponse.json();
  const body = { text: 'synthetic fixture', images: ['data:image/png;base64,iVBORw0KGgo='] };
  const results = await Promise.all(Array.from({ length: 6 }, () => request('/v1/moderate', token, body)));
  assert.equal(results.filter(x => x.status === 200).length, 2);
  assert.equal(results.filter(x => x.status === 429).length, 4);
  assert.equal(calls, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE kind='moderation'").first()).n, 2);
  for (const response of results.filter(x => x.status === 200)) assert.deepEqual(await response.json(), { decision: 'allow' });
  console.log('PASS workerd: anonymous session, HMAC, D1 migration, image payload, provider boundary and atomic quota under six simultaneous requests');
} finally { await mf.dispose(); }
