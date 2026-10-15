import test from 'node:test';
import assert from 'node:assert/strict';
let listener, changeListener;
let cfg = { enabled: true, consentVersion: 'cloud-v1' };
let session;
const requests = [];
const fb = { tab: { id: 1 }, url: 'https://www.facebook.com/' };
const popup = { url: 'chrome-extension://test/popup.html' };
globalThis.chrome = {
  storage: { local: { setAccessLevel: async () => {}, get: async () => ({ ...cfg }), remove: async () => {} },
    session: { setAccessLevel: async () => {}, get: async () => ({ cloudSession: session }), set: async v => { session = v.cloudSession; } },
    onChanged: { addListener: fn => { changeListener = fn; } } },
  runtime: { getURL: path => 'chrome-extension://test/' + path, onMessage: { addListener: fn => listener = fn } },
  tabs: { query: async () => [], sendMessage: async () => {} }
};
globalThis.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
globalThis.OffscreenCanvas = class {
  getContext() { return { fillRect() {}, drawImage() {} }; }
  async convertToBlob() { return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }); }
};
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('cloud-config.json')) return Response.json({ serviceOrigin: 'https://api.example', consentVersion: 'cloud-v1' });
  requests.push({ url, init });
  if (String(url).includes('fbcdn.net')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
  if (String(url).endsWith('/session')) return Response.json({ token: 'anonymous-session', expiresAt: Date.now() + 3600000 });
  return Response.json({ decision: 'allow', ok: true });
};
await import('../extension/background.js');
const send = (message, sender = fb) => new Promise(resolve => listener(message, sender, resolve));
test('content configuration exposes neither anonymous token nor old pairing secret', async () => {
  assert.deepEqual(await send({ type: 'CONFIG' }), { ok: true, enabled: true, consent: true, configured: true });
});
test('only Facebook content scripts can submit moderation', async () => {
  const payload = { text: 'normal', images: [] };
  assert.equal((await send({ type: 'MODERATE', payload }, { tab: { id: 1 }, url: 'https://evil.example' })).error, 'FORBIDDEN');
  assert.equal((await send({ type: 'MODERATE', payload }, popup)).error, 'FORBIDDEN');
});
test('old local-service consent does not authorize cloud upload', async () => {
  requests.length = 0;
  cfg = { enabled: true, consent: true, pairingToken: 'a'.repeat(64), consentVersion: '' };
  assert.equal((await send({ type: 'MODERATE', payload: { text: 'x', images: ['https://s.fbcdn.net/x'] } })).error, 'CONSENT_REQUIRED');
  assert.equal(requests.length, 0);
  cfg = { enabled: true, consentVersion: 'cloud-v1' };
});
test('all images are resized and forwarded to the configured HTTPS endpoint without source URLs', async () => {
  requests.length = 0;
  const r = await send({ type: 'MODERATE', payload: { text: 'post', images: ['https://s.fbcdn.net/one', 'https://s.fbcdn.net/two'] } });
  assert.equal(r.decision, 'allow');
  const cloud = requests.find(x => x.url.endsWith('/moderate'));
  assert.equal(cloud.url, 'https://api.example/v1/moderate');
  assert.deepEqual(JSON.parse(cloud.init.body), { text: 'post', images: ['data:image/jpeg;base64,AQID', 'data:image/jpeg;base64,AQID'] });
  assert.equal(requests.some(r => r.url.includes('127.0.0.1')), false);
});
test('an unsupported image prevents text-only classification', async () => {
  requests.length = 0;
  assert.equal((await send({ type: 'MODERATE', payload: { text: 'post', images: ['https://evil.test/two'] } })).error, 'UNSUPPORTED_IMAGE');
  assert.equal(requests.some(r => r.url.endsWith('/moderate')), false);
});
test('withdrawing consent clears the anonymous session and blocks subsequent uploads', async () => {
  assert.ok(session);
  cfg.consentVersion = '';
  await changeListener({ consentVersion: { newValue: '' } }, 'local');
  assert.equal(session, null);
  requests.length = 0;
  assert.equal((await send({ type: 'MODERATE', payload: { text: 'private', images: [] } })).error, 'CONSENT_REQUIRED');
  assert.equal(requests.length, 0);
});
