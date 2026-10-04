export function allowedImageUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      (u.hostname === 'fbcdn.net' || u.hostname.endsWith('.fbcdn.net'));
  } catch { return false; }
}

export async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('IMAGE_TOO_LARGE');
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error('IMAGE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function imageDataUrl(url, fetchImpl = fetch) {
  if (!allowedImageUrl(url)) throw new Error('UNSUPPORTED_IMAGE');
  let response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000) });
  } catch { throw new Error('IMAGE_FETCH_FAILED'); }
  if (!response.ok) throw new Error('IMAGE_FETCH_FAILED');
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  // Animated GIF and unrecognized formats stay shielded in this still-image MVP.
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('UNSUPPORTED_IMAGE');
  const bytes = await readLimited(response, 4 * 1024 * 1024);
  if (!bytes.length) throw new Error('IMAGE_FETCH_FAILED');
  // Reject animated WebP/PNG rather than analyzing only their first frame.
  const ascii = new TextDecoder('latin1').decode(bytes);
  if ((mime === 'image/webp' && ascii.includes('ANIM')) || (mime === 'image/png' && ascii.includes('acTL'))) {
    throw new Error('ANIMATED_IMAGE');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: `data:${mime};base64,${btoa(binary)}`, size: bytes.length };
}
