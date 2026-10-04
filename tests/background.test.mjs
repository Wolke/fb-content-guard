import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let cfg = { enabled: true, consent: true, pairingToken: 'a'.repeat(64) };
const requests = [];
const fb = { tab: { id: 1 }, url: 'https://www.facebook.com/' };
const popup = { url: 'chrome-extension://test/popup.html' };
globalThis.chrome = {
  storage: { local: { setAccessLevel: async () => {}, get: async () => ({ ...cfg }) }, onChanged: { addListener: () => {} } },
  runtime: { getURL: path => 'chrome-extension://test/' + path, onMessage: { addListener: fn => listener = fn } },
  tabs: { query: async () => [], sendMessage: async () => {} }
};
globalThis.fetch = async (url, init) => {
  requests.push({ url, init });
  if (String(url).includes('fbcdn.net')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
  return Response.json({ decision: 'allow', ok: true, configured: true });
};
await import('../extension/background.js');
const send = (message, sender = fb) => new Promise(resolve => listener(message, sender, resolve));

test('content configuration never exposes pairing token', async () => {
  assert.deepEqual(await send({ type: 'CONFIG' }), { ok: true, enabled: true, consent: true, paired: true });
});
test('only Facebook content scripts can submit moderation', async () => {
  const payload = { text: 'normal', images: [] };
  assert.equal((await send({ type: 'MODERATE', payload }, { tab: { id: 1 }, url: 'https://evil.example' })).error, 'FORBIDDEN');
  assert.equal((await send({ type: 'MODERATE', payload }, popup)).error, 'FORBIDDEN');
});
test('no consent or pairing means no outgoing network requests', async () => {
  requests.length = 0;
  cfg.consent = false;
  assert.equal((await send({ type: 'MODERATE', payload: { text: 'x', images: ['https://s.fbcdn.net/x'] } })).error, 'CONSENT_REQUIRED');
  cfg.consent = true; cfg.pairingToken = '';
  assert.equal((await send({ type: 'MODERATE', payload: { text: 'x', images: ['https://s.fbcdn.net/x'] } })).error, 'PAIRING_REQUIRED');
  assert.equal(requests.length, 0);
  cfg.pairingToken = 'a'.repeat(64);
});
test('background fetches all images and forwards only image bytes and text to fixed local endpoint', async () => {
  requests.length = 0;
  const r = await send({ type: 'MODERATE', payload: { text: 'post', images: ['https://s.fbcdn.net/one', 'https://s.fbcdn.net/two'] } });
  assert.equal(r.decision, 'allow');
  assert.equal(requests.length, 3);
  const local = requests[2];
  assert.equal(local.url, 'http://127.0.0.1:43187/moderate');
  assert.deepEqual(JSON.parse(local.init.body), { text: 'post', images: ['data:image/jpeg;base64,AQID', 'data:image/jpeg;base64,AQID'] });
});
test('one unsupported image prevents text-only moderation from releasing a post', async () => {
  requests.length = 0;
  const r = await send({ type: 'MODERATE', payload: { text: 'post', images: ['https://s.fbcdn.net/one', 'https://evil.test/two'] } });
  assert.equal(r.error, 'UNSUPPORTED_IMAGE');
  assert.equal(requests.some(r => r.url.endsWith('/moderate')), false);
});
