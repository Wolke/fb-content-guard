import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceError } from '../server/moderation.mjs';
import { createCloudHandler } from '../cloud/handler.mjs';

const origin = `chrome-extension://${'a'.repeat(32)}`;
const request = (body = { text: 'ordinary fixture', images: [] }, options = {}) =>
  new Request('https://service.example/v1/moderate', {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer test-session',
      'Content-Type': 'application/json', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
function fixture(overrides = {}) {
  const calls = [];
  const handler = createCloudHandler({ apiKey: 'fake-provider-key', extensionId: 'a'.repeat(32),
    verifySession: async token => { calls.push(['auth', token]); return { subject: 'verified-session' }; },
    reserveQuota: async subject => { calls.push(['quota', subject]); return true; },
    moderateImpl: async payload => { calls.push(['provider', payload]); return { decision: 'allow' }; },
    ...overrides });
  return { handler, calls };
}

test('cloud core cannot start without session verification and durable quota adapters', () => {
  assert.throws(() => createCloudHandler(), /CLOUD_CONFIGURATION_REQUIRED/);
  assert.throws(() => createCloudHandler({ apiKey: 'test', extensionId: 'a'.repeat(32),
    verifySession: async () => ({ subject: 'x' }) }), /CLOUD_CONFIGURATION_REQUIRED/);
});
test('forged extension origin is not sufficient: missing or rejected session never reaches provider', async () => {
  const f = fixture();
  assert.equal((await f.handler(request(undefined, { headers: { Authorization: '' } }))).status, 401);
  assert.equal(f.calls.length, 0);
  const denied = fixture({ verifySession: async () => null });
  assert.equal((await denied.handler(request())).status, 401);
  assert.equal(denied.calls.length, 0);
  assert.equal((await f.handler(request(undefined, { headers: { Origin: 'https://www.facebook.com' } }))).status, 403);
  assert.equal(f.calls.length, 0);
});
test('preflight only grants the packaged extension the required method and headers', async () => {
  const { handler, calls } = fixture();
  const response = await handler(new Request('https://service.example/v1/moderate', {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type' }
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(calls.length, 0);
});
test('quota identity is verified by backend, never taken from request data', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request({ text: 'fixture', images: [], subject: 'forged-session' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { decision: 'allow' });
  assert.deepEqual(calls, [['auth', 'test-session'], ['quota', 'verified-session'],
    ['provider', { text: 'fixture', images: [] }]]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('quota exhaustion or storage failure prevents all upstream moderation', async () => {
  for (const reserveQuota of [async () => false, async () => undefined,
    async () => { throw new Error('internal database details'); }]) {
    const { handler, calls } = fixture({ reserveQuota });
    const response = await handler(request());
    assert.ok([429, 503].includes(response.status));
    assert.equal(calls.some(([kind]) => kind === 'provider'), false);
    assert.equal((await response.text()).includes('internal database'), false);
  }
});
test('malformed or oversized input is rejected before reserving quota or calling provider', async () => {
  const { handler, calls } = fixture({ maxBodyBytes: 128 });
  for (const body of ['bad-json', 'x'.repeat(129), { text: 'x', images: ['https://private.example/'] }]) {
    const response = await handler(request(body));
    assert.ok([400, 413].includes(response.status));
  }
  assert.equal(calls.some(([kind]) => kind !== 'auth'), false);
});
test('provider failures and malformed results never release content or expose secrets', async () => {
  for (const moderateImpl of [async () => { throw Error('secret provider detail'); },
    async () => ({ decision: 'unknown' })]) {
    const { handler } = fixture({ moderateImpl });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'ANALYSIS_UNAVAILABLE' });
  }
});

test('cloud image limits are enforced on the server, not just in the extension', async () => {
  const { handler, calls } = fixture();
  const image = 'data:image/jpeg;base64,' + Buffer.alloc(128 * 1024 + 1).toString('base64');
  assert.equal((await handler(request({ text: 'fixture', images: [image] }))).status, 400);
  assert.equal(calls.some(([kind]) => kind === 'provider' || kind === 'quota'), false);
});

test('provider rate limits trigger cooldown without exposing provider text', async () => {
  const { handler } = fixture({ moderateImpl: async () => { throw new ServiceError('PROVIDER_RATE_LIMIT', 429); } });
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'SERVICE_COOLDOWN' });
});
