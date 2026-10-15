import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.route('https://extension.test/index.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Image preprocessing fixture</body></html>' }));
  const module = await readFile(new URL('../extension/net.js', import.meta.url), 'utf8');
  await page.route('https://extension.test/net.js', route => route.fulfill({ contentType: 'text/javascript', body: module }));
  await page.goto('https://extension.test/index.html');
  const result = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1600, 800);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#146a4c'; ctx.fillRect(0, 0, 1600, 800);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const { cloudImageDataUrl } = await import('./net.js');
    const item = await cloudImageDataUrl('https://s.fbcdn.net/test.png', async () => new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
    const image = new Image(); image.src = item.data; await image.decode();
    return { width: image.width, height: image.height, size: item.size, prefix: item.data.slice(0, 23) };
  });
  assert.equal(result.width, 512); assert.equal(result.height, 256);
  assert.ok(result.size > 0 && result.size <= 128 * 1024);
  assert.equal(result.prefix, 'data:image/jpeg;base64,');
  console.log('PASS native Chrome image decode/resize/JPEG: complete 1600×800 image becomes 512×256 within size budget');
} finally { await browser.close(); }
