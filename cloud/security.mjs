const encoder = new TextEncoder();
let cachedSecret, cachedKey;
function key(secret) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('BAD_SECRET');
  if (secret !== cachedSecret) {
    cachedSecret = secret;
    cachedKey = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  return cachedKey;
}
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('BAD_TOKEN');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}
export const utcDay = now => Math.floor(now / 86400);
export async function ipIdentity(ip, secret, now) {
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F.:]+$/.test(ip)) throw new Error('CLIENT_ADDRESS_REQUIRED');
  return encode(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(`ip:${utcDay(now)}:${ip}`)));
}
export async function issueSession({ secret, audience, ip, now }) {
  const payload = { v: 1, sub: crypto.randomUUID(), aud: audience, ip,
    day: utcDay(now), iat: now, exp: Math.min(now + 3600, (utcDay(now) + 1) * 86400) };
  const body = encode(encoder.encode(JSON.stringify(payload)));
  const signature = encode(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)));
  return { token: `${body}.${signature}`, expiresAt: payload.exp * 1000 };
}
export async function verifySession(token, { secret, audience, ip, now }) {
  try {
    if (typeof token !== 'string' || token.length > 1024) return null;
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(body))) return null;
    const value = JSON.parse(new TextDecoder().decode(decode(body)));
    if (value.v !== 1 || value.aud !== audience || value.ip !== ip || value.day !== utcDay(now) ||
        !Number.isInteger(value.exp) || !Number.isInteger(value.iat) || value.exp <= now || value.iat > now ||
        value.exp - value.iat > 3600 || !/^[a-f0-9-]{36}$/.test(value.sub)) return null;
    return { subject: value.sub };
  } catch { return null; }
}
