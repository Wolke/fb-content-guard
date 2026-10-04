export class ServiceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function validatePayload(value) {
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
    if (size > 4 * 1024 * 1024) throw new ServiceError('IMAGE_TOO_LARGE');
    bytes += size;
  }
  if (bytes > 12 * 1024 * 1024) throw new ServiceError('IMAGES_TOO_LARGE');
  return { text: value.text, images: value.images };
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

export async function moderate(payload, apiKey, fetchImpl = fetch) {
  const input = [];
  if (payload.text.trim()) input.push({ type: 'text', text: payload.text });
  input.push(...payload.images.map(url => ({ type: 'image_url', image_url: { url } })));
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: AbortSignal.timeout(22000)
    });
  } catch { throw new ServiceError('PROVIDER_UNREACHABLE', 502); }
  if (!response.ok) {
    const code = response.status === 429 ? 'PROVIDER_RATE_LIMIT' :
      response.status === 401 ? 'API_KEY_INVALID' : 'PROVIDER_ERROR';
    throw new ServiceError(code, response.status === 429 ? 429 : 502);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new ServiceError('INVALID_PROVIDER_RESPONSE', 502); }
  return parseModeration(data);
}
