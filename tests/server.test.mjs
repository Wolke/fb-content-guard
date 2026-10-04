import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.mjs';
import { moderate, parseModeration, validatePayload } from '../server/moderation.mjs';
import { allowedImageUrl, imageDataUrl, readLimited } from '../extension/net.js';

const token = 'a'.repeat(64);
const safe = { results: [{ categories: { sexual: false, 'sexual/minors': false }, flagged: true }] };
const image = 'data:image/png;base64,iVBORw0KGgo=';
async function withServer(options, callback) {
  const app = createApp({ token, apiKey: 'fake-test-key', ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.address().port}`;
  const call = (path = '/moderate', body = { text: 'A normal post', images: [] }, headers = {}) => fetch(url + path, {
    method: path === '/health' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(path === '/health' ? {} : { body: JSON.stringify(body) })
  });
  try { await callback(call, url); }
  finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
}

test('only sexual categories block; unrelated flagged categories do not', () => {
  assert.equal(parseModeration(safe).decision, 'allow');
  assert.equal(parseModeration({ results: [...safe.results, { categories: { sexual: true, 'sexual/minors': false } }] }).decision, 'block');
  assert.equal(parseModeration({ results: [{ categories: { sexual: false, 'sexual/minors': true } }] }).decision, 'block');
});
test('missing, null, and malformed provider classifications never allow', () => {
  for (const data of [{}, { results: [] }, { results: [{}] }, { results: [{ categories: { sexual: null } }] }]) {
    assert.throws(() => parseModeration(data), /INVALID_PROVIDER_RESPONSE/);
  }
});
test('validates all pictures, limits text and rejects remote URLs at server boundary', () => {
  assert.deepEqual(validatePayload({ text: 'post', images: [image] }), { text: 'post', images: [image] });
  assert.throws(() => validatePayload({ text: '', images: [] }), /EMPTY_CONTENT/);
  assert.throws(() => validatePayload({ text: 'x'.repeat(16001), images: [] }), /INVALID_CONTENT/);
  assert.throws(() => validatePayload({ text: 'post', images: Array(13).fill(image) }), /INVALID_CONTENT/);
  assert.throws(() => validatePayload({ text: 'post', images: [image, 'https://127.0.0.1/image'] }), /INVALID_IMAGE/);
});
test('provider request includes every image and fixed model; errors do not expose provider text', async () => {
  const result = await moderate({ text: 'test', images: [image, image] }, 'test-key', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/moderations');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'omni-moderation-latest');
    assert.equal(body.input.length, 3);
    assert.equal(body.input[2].image_url.url, image);
    return Response.json(safe);
  });
  assert.equal(result.decision, 'allow');
  await assert.rejects(moderate({ text: '', images: [image] }, 'test', async () => new Response('sensitive error', { status: 429 })), /PROVIDER_RATE_LIMIT/);
  await assert.rejects(moderate({ text: 'x', images: [] }, 'test', async () => { throw Error('secret'); }), /PROVIDER_UNREACHABLE/);
});
test('local service requires pairing and rejects webpage origins and rebound hostnames', async () => {
  await withServer({ moderateImpl: async () => ({ decision: 'allow' }) }, async (call, url) => {
    assert.equal((await call('/health', null, { Authorization: '' })).status, 401);
    assert.equal((await call('/health', null, { Origin: 'https://www.facebook.com' })).status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
      http.get(url + '/health', { headers: { Host: 'evil.example:43187', Authorization: `Bearer ${token}` } }, res => {
        res.resume(); resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(reboundStatus, 403);
    const good = await call('/health', null, { Origin: `chrome-extension://${'a'.repeat(32)}` });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('access-control-allow-origin'), null);
    assert.equal((await good.json()).configured, true);
  });
});
test('missing API key keeps service unhealthy for moderation and does not call provider', async () => {
  await withServer({ apiKey: '', moderateImpl: () => assert.fail('must not be called') }, async call => {
    assert.equal((await (await call('/health')).json()).configured, false);
    assert.equal((await (await call()).json()).error, 'API_KEY_MISSING');
  });
});
test('daily quota reserves calls atomically and rejects surplus requests', async () => {
  let calls = 0;
  await withServer({ dailyLimit: 1, moderateImpl: async () => { calls++; return { decision: 'block' }; } }, async call => {
    const results = await Promise.all([call(), call()]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
    assert.equal(calls, 1);
  });
});
test('provider failure frees concurrency slots and never returns an allow result', async () => {
  await withServer({ moderateImpl: async () => { throw Error('contains secret'); } }, async call => {
    for (let i = 0; i < 3; i++) assert.deepEqual(await (await call()).json(), { error: 'INTERNAL_ERROR' });
    assert.equal((await (await call('/health')).json()).active, 0);
  });
});
test('a failed picture fails the whole post; CDN boundary prevents arbitrary network access', async () => {
  for (const url of ['http://s.fbcdn.net/x', 'https://fbcdn.net.evil.test/x', 'https://evilfbcdn.net/x', 'https://127.0.0.1/x', 'https://user:pass@s.fbcdn.net/x', 'https://s.fbcdn.net:8080/x']) {
    assert.equal(allowedImageUrl(url), false, url);
  }
  assert.equal(allowedImageUrl('https://scontent.xx.fbcdn.net/p.jpg'), true);
  await assert.rejects(imageDataUrl('https://example.com/x', () => assert.fail('must not fetch')), /UNSUPPORTED_IMAGE/);
  await assert.rejects(imageDataUrl('https://s.fbcdn.net/x', async (_, init) => {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    return new Response('', { status: 403 });
  }), /IMAGE_FETCH_FAILED/);
});
test('downloads are byte bounded and reject animations', async () => {
  await assert.rejects(readLimited(new Response('12345'), 4), /IMAGE_TOO_LARGE/);
  await assert.rejects(imageDataUrl('https://s.fbcdn.net/x', async () => new Response('RIFF ANIM', { headers: { 'Content-Type': 'image/webp' } })), /ANIMATED_IMAGE/);
  const result = await imageDataUrl('https://s.fbcdn.net/x', async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }));
  assert.equal(result.data, 'data:image/jpeg;base64,AQID');
});
