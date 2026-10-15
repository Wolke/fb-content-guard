import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceClient, validServiceOrigin } from '../extension/service-client.js';
function fixture(reply) {
  const calls = []; let stored;
  const client = createServiceClient({ origin: 'https://api.example', readSession: async () => stored,
    saveSession: async value => { stored = value; }, fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      return reply ? reply(url, init, calls) : Response.json(url.endsWith('/session') ?
        { token: 'anonymous-token', expiresAt: Date.now() + 3600000 } : { decision: 'allow' });
    } });
  return { client, calls };
}
const opts = () => ({ signal: new AbortController().signal, checkConsent: async () => {} });
test('cloud origin must be an exact HTTPS origin with no credentials/path', () => {
  for (const origin of ['', 'http://api.example', 'https://user:pass@api.example', 'https://api.example/path', 'https://127.0.0.1', 'https://service.invalid']) assert.equal(validServiceOrigin(origin), false);
  assert.equal(validServiceOrigin('https://api.example'), true);
});
test('automatic anonymous sessions are shared across concurrent requests', async () => {
  const { client, calls } = fixture();
  const payload = { text: 'test', images: [] };
  await Promise.all([client.moderate(payload, opts()), client.moderate(payload, opts())]);
  assert.equal(calls.filter(x => x.url.endsWith('/session')).length, 1);
  assert.equal(calls.filter(x => x.url.endsWith('/moderate')).length, 2);
  assert.ok(calls.every(x => x.init.headers['X-FG-Consent'] === 'cloud-v1'));
});
test('consent revoked while obtaining a session prevents any post upload', async () => {
  const { client, calls } = fixture(); let checks = 0;
  await assert.rejects(client.moderate({ text: 'private fixture', images: [] }, {
    signal: new AbortController().signal, checkConsent: async () => { if (++checks > 1) throw Error('CONSENT_REQUIRED'); }
  }), /CONSENT_REQUIRED/);
  assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith('/session'));
  assert.equal(calls[0].init.body, undefined);
});
test('a changed network triggers at most one automatic session refresh', async () => {
  let attempts = 0;
  const { client, calls } = fixture(url => {
    if (url.endsWith('/session')) return Response.json({ token: 'session', expiresAt: Date.now() + 3600000 });
    attempts++;
    return attempts === 1 ? Response.json({ error: 'SESSION_REQUIRED' }, { status: 401 }) : Response.json({ decision: 'block' });
  });
  assert.deepEqual(await client.moderate({ text: 'test', images: [] }, opts()), { decision: 'block' });
  assert.equal(calls.length, 4);
});
test('quota failure backs off and cannot accidentally return an allow result', async () => {
  const { client, calls } = fixture(() => Response.json({ error: 'USAGE_LIMIT' }, { status: 429 }));
  await assert.rejects(client.moderate({ text: 'x', images: [] }, opts()), /USAGE_LIMIT/);
  await assert.rejects(client.moderate({ text: 'x', images: [] }, opts()), /SERVICE_COOLDOWN/);
  assert.equal(calls.length, 1);
});
test('clearing consent cannot let an in-flight bootstrap restore the session', async () => {
  let release, stored;
  const pending = new Promise(resolve => { release = resolve; });
  const client = createServiceClient({ origin: 'https://api.example',
    readSession: async () => stored, saveSession: async value => { stored = value; },
    fetchImpl: async () => pending });
  const request = client.moderate({ text: 'private fixture', images: [] }, opts());
  const rejected = assert.rejects(request, /CONSENT_REQUIRED/);
  await new Promise(resolve => setTimeout(resolve, 0));
  await client.clear();
  release(Response.json({ token: 'session', expiresAt: Date.now() + 3600000 }));
  await rejected;
  assert.equal(stored, null);
});
