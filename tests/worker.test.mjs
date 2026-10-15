import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueSession, verifySession, ipIdentity } from '../cloud/security.mjs';
import { reserveQuota } from '../cloud/quota.mjs';
import worker, { handleCloudRequest } from '../cloud/worker.mjs';

const secret = 'a'.repeat(64), audience = 'b'.repeat(32), origin = `chrome-extension://${audience}`;
const epoch = Math.floor(Date.UTC(2026, 9, 15, 12) / 1000);
const schema = readFileSync(new URL('../cloud/migrations/0001_usage.sql', import.meta.url), 'utf8');
function database(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  sqlite.exec(schema);
  return { sqlite, prepare(sql) { return { bind(...values) { return { async run() {
    const value = sqlite.prepare(sql).run(...values);
    return { success: true, meta: { changes: Number(value.changes) } };
  } }; } }; } };
}
const req = (path, { token, body, ip = '192.0.2.1', ...options } = {}) => new Request('https://api.example' + path, {
  method: path === '/v1/health' ? 'GET' : 'POST',
  headers: { Origin: origin, 'CF-Connecting-IP': ip, 'X-FG-Consent': 'cloud-v1',
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}), ...options
});
function environment(DB) { return { DB, EXTENSION_ID: audience, SESSION_SECRET: secret,
  OPENAI_API_KEY: 'fake-test-key', SERVICE_ENABLED: 'true', DAILY_LIMIT: '1000', MINUTE_LIMIT: '15' }; }
const body = { text: 'safe synthetic fixture', images: [] };

test('HMAC sessions reject tampering, expiry, wrong IP/audience and UTC rollover', async () => {
  const ip = await ipIdentity('192.0.2.1', secret, epoch);
  const cfg = { secret, audience, ip, now: epoch };
  const session = await issueSession(cfg);
  assert.ok((await verifySession(session.token, cfg))?.subject);
  assert.equal(await verifySession(session.token + 'x', cfg), null);
  assert.equal(await verifySession(session.token, { ...cfg, now: epoch + 3600 }), null);
  assert.equal(await verifySession(session.token, { ...cfg, ip: 'different' }), null);
  assert.equal(await verifySession(session.token, { ...cfg, audience: 'c'.repeat(32) }), null);
  assert.notEqual(await ipIdentity('192.0.2.1', secret, epoch + 86400), ip);
  assert.equal(await verifySession(session.token, { ...cfg, now: epoch + 86400 }), null);
});
test('atomic quota reservations survive reconnects and cap concurrent callers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fg-quota-'));
  const path = join(directory, 'quota.sqlite');
  const db = database(path), db2 = database(path);
  try {
    const limits = { kind: 'moderation', subject: 'session', ip: 'derived-ip', now: epoch,
      daily: 1, minute: 1, ipDaily: 1, ipMinute: 1, sessionDaily: 1 };
    const accepted = await Promise.all(Array.from({ length: 12 }, (_, i) => reserveQuota(i % 2 ? db : db2, limits)));
    assert.equal(accepted.filter(Boolean).length, 1);
    db.sqlite.close();
    const restarted = database(path);
    try {
      assert.equal(await reserveQuota(restarted, limits), false);
      assert.equal(await reserveQuota(restarted, { ...limits, now: epoch + 86400 }), true);
    } finally { restarted.sqlite.close(); }
  } finally { db2.sqlite.close(); rmSync(directory, { recursive: true }); }
});
test('changing session cannot bypass IP/global quota, quota failure does not reserve unrelated capacity', async () => {
  const db = database();
  const limits = { kind: 'moderation', subject: 's1', ip: 'ip1', now: epoch,
    daily: 2, minute: 2, ipDaily: 1, ipMinute: 1, sessionDaily: 1 };
  try {
    assert.equal(await reserveQuota(db, limits), true);
    assert.equal(await reserveQuota(db, { ...limits, subject: 's2' }), false);
    assert.equal(await reserveQuota(db, { ...limits, subject: 's3', ip: 'ip2' }), true);
    assert.equal(await reserveQuota(db, { ...limits, subject: 's4', ip: 'ip3' }), false);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM usage_events').get().n, 2);
  } finally { db.sqlite.close(); }
});
test('anonymous session + moderation succeeds without a user account and never stores content', async () => {
  const db = database(); const env = environment(db); let providerCalls = 0;
  const deps = { now: () => epoch, moderateImpl: async payload => { providerCalls++; assert.deepEqual(payload, body); return { decision: 'block' }; } };
  try {
    const health = await handleCloudRequest(req('/v1/health'), env, deps);
    assert.equal(health.status, 200); assert.equal(providerCalls, 0);
    const session = await (await handleCloudRequest(req('/v1/session'), env, deps)).json();
    assert.ok(session.token);
    const result = await handleCloudRequest(req('/v1/moderate', { token: session.token, body }), env, deps);
    assert.deepEqual(await result.json(), { decision: 'block' }); assert.equal(providerCalls, 1);
    const rows = JSON.stringify(db.sqlite.prepare('SELECT * FROM usage_events').all());
    assert.equal(rows.includes(body.text), false); assert.equal(rows.includes('192.0.2.1'), false);
    assert.equal(rows.includes('fake-test-key'), false); assert.equal(rows.includes(session.token), false);
    assert.equal((await handleCloudRequest(req('/v1/moderate', { token: session.token, body, ip: '192.0.2.2' }), env, deps)).status, 401);
    assert.equal(providerCalls, 1);
  } finally { db.sqlite.close(); }
});
test('session issuance is rate limited; service switch and consent gate stop requests', async () => {
  const db = database(); const env = environment(db); const deps = { now: () => epoch };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await handleCloudRequest(req('/v1/session'), env, deps)).status, 200);
    assert.equal((await handleCloudRequest(req('/v1/session'), env, deps)).status, 429);
    const noConsent = req('/v1/session'); noConsent.headers.delete('X-FG-Consent');
    assert.equal((await handleCloudRequest(noConsent, env, deps)).status, 403);
    assert.equal((await handleCloudRequest(req('/v1/session'), { ...env, SERVICE_ENABLED: 'false' }, deps)).status, 503);
    const wrong = req('/v1/session'); wrong.headers.set('Origin', 'https://evil.example');
    assert.equal((await handleCloudRequest(wrong, env, deps)).status, 403);
  } finally { db.sqlite.close(); }
});
test('provider failure consumes the durable allowance; no free retry loop', async () => {
  const db = database(); const env = { ...environment(db), DAILY_LIMIT: '1' }; let calls = 0;
  const deps = { now: () => epoch, moderateImpl: async () => { calls++; throw Error('secret upstream body'); } };
  try {
    const session = await (await handleCloudRequest(req('/v1/session'), env, deps)).json();
    assert.equal((await handleCloudRequest(req('/v1/moderate', { token: session.token, body }), env, deps)).status, 503);
    assert.equal((await handleCloudRequest(req('/v1/moderate', { token: session.token, body }), env, deps)).status, 429);
    assert.equal(calls, 1);
  } finally { db.sqlite.close(); }
});
test('scheduled cleanup removes expired usage while preserving recent counters', async () => {
  const db = database();
  try {
    const now = Math.floor(Date.now() / 1000);
    const limits = { kind: 'session', subject: 'session', ip: 'hash', daily: 10, minute: 10, ipDaily: 10, ipMinute: 10, sessionDaily: 10 };
    await reserveQuota(db, { ...limits, now: now - 50 * 3600 });
    await reserveQuota(db, { ...limits, now });
    await worker.scheduled({}, { DB: db });
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM usage_events').get().n, 1);
  } finally { db.sqlite.close(); }
});
