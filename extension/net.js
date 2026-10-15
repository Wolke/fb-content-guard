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

async function imageBytes(url, fetchImpl, allowInline = false) {
  const inline = allowInline && typeof url === 'string' && url.length <= 180000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(url);
  if (!inline && !allowedImageUrl(url)) throw new Error('UNSUPPORTED_IMAGE');
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
  return { bytes, mime };
}
function asDataUrl(bytes, mime) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: `data:${mime};base64,${btoa(binary)}`, size: bytes.length };
}

export async function imageDataUrl(url, fetchImpl = fetch) {
  const { bytes, mime } = await imageBytes(url, fetchImpl);
  return asDataUrl(bytes, mime);
}

export async function cloudImageDataUrl(url, fetchImpl = fetch) {
  const { bytes, mime } = await imageBytes(url, fetchImpl, true);
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    if (!bitmap.width || !bitmap.height) throw Error('INVALID_IMAGE');
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Keep the complete image; never crop out content to meet the size budget.
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    if (blob.size > 128 * 1024) throw Error('IMAGE_TOO_LARGE');
    return asDataUrl(new Uint8Array(await blob.arrayBuffer()), 'image/jpeg');
  } catch (error) {
    throw Error(error.message === 'IMAGE_TOO_LARGE' ? error.message : 'IMAGE_FETCH_FAILED');
  } finally { bitmap?.close(); }
}
