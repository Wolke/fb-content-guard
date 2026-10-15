export const CONSENT_VERSION = 'cloud-v1';
export function validServiceOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      u.pathname === '/' && !u.search && !u.hash && u.origin === value &&
      !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.hostname.endsWith('.invalid');
  } catch { return false; }
}
export function createServiceClient({ origin, fetchImpl = fetch, readSession, saveSession }) {
  let opening, cooldownUntil = 0, generation = 0, writes = Promise.resolve();
  const writeSession = (value, expectedGeneration = generation) => {
    const next = writes.catch(() => {}).then(() => {
      if (expectedGeneration !== generation) throw Error('CONSENT_REQUIRED');
      return saveSession(value);
    });
    writes = next;
    return next;
  };
  const call = async (path, { token, payload, signal } = {}) => {
    if (!validServiceOrigin(origin)) throw Error('SERVICE_NOT_CONFIGURED');
    if (Date.now() < cooldownUntil && path !== '/v1/health') throw Error('SERVICE_COOLDOWN');
    let response;
    try {
      response = await fetchImpl(origin + path, {
        method: path === '/v1/health' ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { ...(path !== '/v1/health' ? { 'X-FG-Consent': CONSENT_VERSION } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(28000)]) : AbortSignal.timeout(28000)
      });
    } catch {
      if (signal?.aborted) throw Error('CONSENT_REQUIRED');
      cooldownUntil = Date.now() + 30000;
      throw Error('SERVICE_UNREACHABLE');
    }
    let value;
    try { value = await response.json(); } catch { throw Error('INVALID_RESPONSE'); }
    if (!response.ok) {
      if ([429, 503].includes(response.status)) cooldownUntil = Date.now() + 60000;
      const known = ['SESSION_REQUIRED', 'CONSENT_REQUIRED', 'USAGE_LIMIT', 'SERVICE_PAUSED',
        'SERVICE_NOT_CONFIGURED', 'SERVICE_UNAVAILABLE', 'ANALYSIS_UNAVAILABLE', 'REQUEST_TOO_LARGE'];
      throw Error(known.includes(value?.error) ? value.error : 'SERVICE_UNAVAILABLE');
    }
    return value;
  };
  const session = async signal => {
    const expectedGeneration = generation;
    const saved = await readSession();
    if (expectedGeneration !== generation) throw Error('CONSENT_REQUIRED');
    if (saved?.token && saved.expiresAt > Date.now() + 30000) return saved.token;
    if (!opening) opening = (async () => {
      const value = await call('/v1/session', { signal });
      if (typeof value.token !== 'string' || value.token.length > 1024 ||
          !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) throw Error('INVALID_RESPONSE');
      if (signal?.aborted) throw Error('CONSENT_REQUIRED');
      await writeSession(value, expectedGeneration);
      if (expectedGeneration !== generation) throw Error('CONSENT_REQUIRED');
      return value.token;
    })().finally(() => { opening = null; });
    return opening;
  };
  return {
    health: () => call('/v1/health'),
    clear: () => { generation++; return writeSession(null); },
    async moderate(payload, { signal, checkConsent }) {
      for (let attempt = 0; attempt < 2; attempt++) {
        await checkConsent();
        if (signal.aborted) throw Error('CONSENT_REQUIRED');
        const token = await session(signal);
        await checkConsent();
        if (signal.aborted) throw Error('CONSENT_REQUIRED');
        try {
          const value = await call('/v1/moderate', { token, payload, signal });
          if (!['allow', 'block'].includes(value?.decision)) throw Error('INVALID_RESPONSE');
          return { decision: value.decision };
        } catch (error) {
          if (error.message !== 'SESSION_REQUIRED' || attempt) throw error;
          await writeSession(null);
        }
      }
    }
  };
}
