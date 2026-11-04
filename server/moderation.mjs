export class ServiceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function validatePayload(value, { maxImageBytes = 4 * 1024 * 1024, maxTotalImageBytes = 12 * 1024 * 1024 } = {}) {
  if (!value || typeof value.text !== 'string' || value.text.length > 16000 ||
      !Array.isArray(value.images) || value.images.length > 12) {
    throw new ServiceError('INVALID_CONTENT');
  }
  if (!value.text.trim() && !value.images.length) throw new ServiceError('EMPTY_CONTENT');
  let bytes = 0;
  for (const image of value.images) {
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      throw new ServiceError('INVALID_IMAGE');
    }
    const data = image.slice(image.indexOf(',') + 1);
    const size = Buffer.byteLength(data, 'base64');
    if (size > maxImageBytes) throw new ServiceError('IMAGE_TOO_LARGE');
    bytes += size;
  }
  if (bytes > maxTotalImageBytes) throw new ServiceError('IMAGES_TOO_LARGE');
  return { text: value.text, images: value.images, ...(value.diagnostics === true ? { diagnostics: true } : {}) };
}

export function parseModeration(data) {
  // Missing or changed provider fields must never accidentally release a post.
  if (!Array.isArray(data?.results) || !data.results.length) throw new ServiceError('INVALID_PROVIDER_RESPONSE', 502);
  for (const result of data.results) {
    if (typeof result?.categories?.sexual !== 'boolean' ||
        typeof result?.categories?.['sexual/minors'] !== 'boolean') {
      throw new ServiceError('INVALID_PROVIDER_RESPONSE', 502);
    }
  }
  return {
    decision: data.results.some(r => r.categories.sexual || r.categories['sexual/minors']) ? 'block' : 'allow'
  };
}

async function moderateSingle(payload, apiKey, fetchImpl, signal, events, image = 0) {
  const started = Date.now();
  let http;
  try {
  const input = [];
  if (payload.text.trim()) input.push({ type: 'text', text: payload.text });
  input.push(...payload.images.map(url => ({ type: 'image_url', image_url: { url } })));
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal
    });
  } catch { throw new ServiceError('PROVIDER_UNREACHABLE', 502); }
  http = response.status;
  if (!response.ok) {
    const code = response.status === 429 ? 'PROVIDER_RATE_LIMIT' :
      response.status === 401 ? 'API_KEY_INVALID' : response.status === 400 ? 'PROVIDER_BAD_REQUEST' : 'PROVIDER_ERROR';
    throw new ServiceError(code, response.status === 429 ? 429 : 502);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new ServiceError('INVALID_PROVIDER_RESPONSE', 502); }
  const result = parseModeration(data);
  if (events) {
    // Only fixed category fields. Never retain provider bodies, request ids or content.
    const item = { stage: 'openai', image, outcome: result.decision, http, ms: Date.now() - started,
      sexual: data.results.some(r => r.categories.sexual), sexualMinors: data.results.some(r => r.categories['sexual/minors']) };
    for (const [key, name] of [['sexual', 'sexualScore'], ['sexual/minors', 'sexualMinorsScore']]) {
      const scores = data.results.map(r => r.category_scores?.[key]);
      if (scores.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) item[name] = Math.max(...scores);
    }
    events.push(item);
  }
  return result;
  } catch (error) {
    if (events) events.push({ stage: 'openai', image, outcome: 'error', ...(http ? { http } : {}), ms: Date.now() - started,
      error: error instanceof ServiceError ? error.code : 'PROVIDER_ERROR' });
    throw error;
  }
}

// The live endpoint rejects multi-image input. Check one complete image per request,
// retain the post text with each image, and only allow after every image passed.
export async function moderate(payload, apiKey, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(22000);
  const events = payload.diagnostics === true ? [] : undefined;
  const report = () => ({ version: 1, providerAttempted: true, events: [...events].sort((a, b) => a.image - b.image).slice(0, 12) });
  const finish = result => ({ ...result, ...(events ? { diagnostics: report() } : {}) });
  try {
    if (payload.images.length <= 1) return finish(await moderateSingle(payload, apiKey, fetchImpl, signal, events, payload.images.length));
    for (let i = 0; i < payload.images.length; i += 2) {
      const results = await Promise.allSettled(payload.images.slice(i, i + 2).map((image, offset) =>
        moderateSingle({ text: payload.text, images: [image] }, apiKey, fetchImpl, signal, events, i + offset + 1)));
      const failure = results.find(r => r.status === 'rejected');
      if (failure) throw failure.reason;
      if (results.some(r => r.value.decision === 'block')) return finish({ decision: 'block' });
    }
    return finish({ decision: 'allow' });
  } catch (error) {
    if (events) error.diagnostics = report();
    throw error;
  }
}
