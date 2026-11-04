// Strict metadata-only journal. Never accept content, URLs, tokens or model prose.
export const STAGES = ['precheck', 'images', 'session', 'cloud', 'openai', 'local', 'cache', 'display', 'health'];
export const OUTCOMES = ['start', 'sent', 'response', 'allow', 'block', 'uncertain', 'error', 'skipped', 'waiting', 'hidden', 'shown', 'stale'];
const ERRORS = new Set(`CONSENT_REQUIRED SERVICE_NOT_CONFIGURED SESSION_REQUIRED SERVICE_UNREACHABLE SERVICE_UNAVAILABLE ANALYSIS_UNAVAILABLE SERVICE_PAUSED SERVICE_COOLDOWN USAGE_LIMIT REQUEST_TOO_LARGE BUSY IMAGE_FETCH_FAILED IMAGE_TOO_LARGE IMAGES_TOO_LARGE UNSUPPORTED_EMBED UNSUPPORTED_VECTOR UNSUPPORTED_ROLE_IMAGE UNSUPPORTED_IMAGE ANIMATED_IMAGE INCOMPLETE_IMAGES TOO_MANY_IMAGES VIDEO_PREVIEW_UNAVAILABLE LONG_TEXT EMPTY_CONTENT PROVIDER_UNREACHABLE WAITING_CAPACITY LOCAL_NOT_READY LOCAL_UNCERTAIN LOCAL_INVALID_RESPONSE LOCAL_TIMEOUT LOCAL_FAILED LOCAL_CONTEXT_OVERFLOW LOCAL_CANCELLED LOCAL_BUSY INVALID_CONTENT INVALID_RESPONSE UNKNOWN_ERROR PROVIDER_RATE_LIMIT PROVIDER_ERROR PROVIDER_BAD_REQUEST INVALID_PROVIDER_RESPONSE API_KEY_INVALID`.split(' '));
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(x);
export function safeEvent(value) {
  if (!value || !STAGES.includes(value.stage) || !OUTCOMES.includes(value.outcome)) return null;
  const e = { stage: value.stage, outcome: value.outcome };
  for (const key of ['image', 'images', 'chars', 'ms', 'http', 'retryAfterMs']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 86400000) e[key] = value[key];
  }
  if (value.error) e.error = ERRORS.has(value.error) ? value.error : 'UNKNOWN_ERROR';
  if (typeof value.detailAvailable === 'boolean') e.detailAvailable = value.detailAvailable;
  for (const key of ['sexual', 'sexualMinors']) if (typeof value[key] === 'boolean') e[key] = value[key];
  for (const key of ['sexualScore', 'sexualMinorsScore']) if (Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1) e[key] = value[key];
  return e;
}
export function safeProviderEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map(e => safeEvent({ ...e, stage: 'openai' })).filter(Boolean);
}
export function createDiagnosticLog({ read, write, now = Date.now, debug = () => {} }) {
  let state = { enabled: false, epoch: crypto.randomUUID(), events: [] }, chain = Promise.resolve();
  const loaded = Promise.resolve().then(read).then(saved => {
    if (saved?.enabled === true && uuid(saved.epoch)) {
      state.enabled = true; state.epoch = saved.epoch;
      state.events = (Array.isArray(saved.events) ? saved.events : []).slice(-600).flatMap(e => {
        const event = safeEvent(e);
        return event && uuid(e.id) && uuid(e.page) && Number.isSafeInteger(e.post) && Number.isSafeInteger(e.tab) && Number.isFinite(e.at) && e.at > now() - 21600000
          ? [{ ...event, id: e.id, page: e.page, post: e.post, tab: e.tab, at: e.at }] : [];
      });
    }
  }).catch(() => {});
  const serial = fn => { const next = chain.then(() => loaded).then(fn); chain = next.catch(() => {}); return next; };
  const config = () => ({ enabled: state.enabled, epoch: state.epoch });
  return {
    async config() { await loaded; return config(); },
    snapshot: () => serial(async () => { const before = state.events.length; state.events = state.events.filter(e => e.at > now() - 21600000); if (before !== state.events.length) await write(state); return { ...config(), events: structuredClone(state.events) }; }),
    setEnabled: enabled => serial(async () => { state = { enabled: enabled === true, epoch: crypto.randomUUID(), events: [] }; await write(state); return config(); }),
    clear: () => serial(async () => { state.epoch = crypto.randomUUID(); state.events = []; await write(state); return config(); }),
    add: (context, value) => serial(async () => {
      if (!state.enabled || context?.epoch !== state.epoch || !uuid(context?.id) || !uuid(context?.page) ||
          !Number.isSafeInteger(context?.post) || context.post < 0 || !Number.isSafeInteger(context?.tab)) return;
      const event = safeEvent(value); if (!event) return;
      const entry = { ...event, id: context.id, page: context.page, post: context.post, tab: context.tab, at: now() };
      state.events = [...state.events.filter(e => e.at > now() - 21600000), entry].slice(-600);
      try { debug('[清朗診斷]', entry); } catch {}
      await write(state);
    })
  };
}
