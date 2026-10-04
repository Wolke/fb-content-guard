// Optional browser suite: npm install --no-save playwright, then npm run test:browser.
// Tests use synthetic posts and simulated classification; no Facebook/OpenAI requests.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const css = await readFile(new URL('../extension/content.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
context.setDefaultTimeout(7000);
let passed = 0;
const post = (id, text, extra = '') => `<div role="article" id="${id}"><div class="original"><h2>測試貼文</h2><p>${text}</p>${extra}</div></div>`;
async function fixture(html, config = {}) {
  const page = await context.newPage();
  const mock = `
    window.testConfig = ${JSON.stringify({ enabled: true, consent: true, paired: true, ...config })};
    window.calls = []; window.handlers = []; window.releaseHeld = null;
    window.chrome = { runtime: {
      onMessage: { addListener: fn => window.handlers.push(fn) },
      sendMessage: async message => {
        if (message.type === 'CONFIG') return {ok:true,...window.testConfig};
        window.calls.push(message.payload);
        if(message.payload.text.includes('HOLD')) return new Promise(resolve => window.releaseHeld = resolve);
        await new Promise(resolve => setTimeout(resolve, 120));
        if(message.payload.text.includes('FAIL')) return {ok:false,error:'PROVIDER_RATE_LIMIT'};
        return {ok:true,decision:message.payload.text.includes('BLOCK')?'block':'allow'};
      }
    }};
    window.updateConfig = value => {Object.assign(window.testConfig,value); window.handlers.forEach(fn=>fn({type:'CONFIG_CHANGED'}, {}, ()=>{}));};
  `;
  await page.route('https://www.facebook.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    body{background:#e9efeb;font-family:system-ui;margin:0}main{max-width:640px;margin:35px auto}
    header{color:#275642;margin-bottom:24px} [role=article]{background:white;margin-bottom:18px;padding:24px;border-radius:10px;min-height:180px;box-sizing:border-box}
    h2{font-size:16px}p{line-height:1.7}.original{min-height:150px}
    ${css}</style><script>${mock}</script><script>${script}</script></head><body><main role="main"><header><h1>清朗 · 測試動態牆</h1><p>合成內容與模擬分類，不是實際 Facebook。</p></header><div role="feed">${html}</div></main></body></html>` }));
  await page.route('https://s.fbcdn.net/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('https://www.facebook.com/');
  return page;
}
async function state(page, id, value) {
  await page.waitForFunction(([id, value]) => document.getElementById(id)?.getAttribute('data-fg-state') === value, [id, value], { timeout: 8000 });
}
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) {
    for (const page of context.pages()) console.log(await page.locator('[data-fg-ui]').evaluateAll(nodes => nodes.map(n => ({
      html: n.outerHTML, inert: n.inert, visibility: getComputedStyle(n).visibility, display: getComputedStyle(n).display,
      buttons: [...n.querySelectorAll('button')].map(b => ({ text: b.textContent, display: getComputedStyle(b).display, visibility: getComputedStyle(b).visibility, inert: b.inert }))
    }))));
    throw error;
  }
}
try {
  await run('shield before response, allow ordinary content, collapse flagged content', async () => {
    const page = await fixture(post('normal', 'NORMAL 一般文字') + post('blocked', 'BLOCK 分類測試佔位文字'));
    await state(page, 'normal', 'pending');
    assert.equal(await page.locator('#normal .original').evaluate(e => getComputedStyle(e).visibility), 'hidden');
    await state(page, 'normal', 'allow'); await state(page, 'blocked', 'block');
    assert.equal(await page.locator('#normal .original').evaluate(e => getComputedStyle(e).visibility), 'visible');
    assert.equal(await page.locator('#blocked .original').evaluate(e => getComputedStyle(e).display), 'none');
    await page.close();
  });
  await run('manual reveal is revoked when Facebook reuses a post node', async () => {
    const page = await fixture(post('p', 'BLOCK 初始內容'));
    await state(page, 'p', 'block');
    await page.getByRole('button', { name: '顯示此貼文' }).click(); await state(page, 'p', 'manual');
    await page.locator('#p .original p').evaluate(e => e.textContent = 'BLOCK 已經是另一則貼文');
    await state(page, 'p', 'pending'); await state(page, 'p', 'block');
    await page.close();
  });
  await run('late allow response cannot reveal replaced content', async () => {
    const page = await fixture(post('p', 'HOLD 第一則'));
    await page.waitForFunction(() => Boolean(window.releaseHeld));
    await page.locator('#p .original p').evaluate(e => e.textContent = 'BLOCK 新貼文');
    await page.evaluate(() => window.releaseHeld({ ok: true, decision: 'allow' }));
    await state(page, 'p', 'block');
    assert.equal(await page.locator('#p .original').evaluate(e => getComputedStyle(e).display), 'none');
    await page.close();
  });
  await run('provider failure stays shielded, retry runs again', async () => {
    const page = await fixture(post('p', 'FAIL 模擬連線錯誤'));
    await state(page, 'p', 'error');
    await page.getByRole('button', { name: '重試' }).click();
    await state(page, 'p', 'error');
    assert.equal(await page.evaluate(() => window.calls.length), 2);
    assert.equal(await page.locator('#p .original').evaluate(e => getComputedStyle(e).visibility), 'hidden');
    await page.close();
  });
  await run('no consent means no moderation calls; settings allow a retry', async () => {
    const page = await fixture(post('p', '一般文字'), { consent: false });
    await state(page, 'p', 'error'); assert.equal(await page.evaluate(() => window.calls.length), 0);
    await page.evaluate(() => window.updateConfig({ consent: true }));
    await state(page, 'p', 'allow'); await page.close();
  });
  await run('toggle restores inert state and re-enabling rechecks content', async () => {
    const page = await fixture(post('p', 'BLOCK 模擬封鎖'));
    await state(page, 'p', 'block');
    assert.equal(await page.locator('#p .original').evaluate(e => e.inert), true);
    await page.evaluate(() => window.updateConfig({ enabled: false }));
    await page.waitForFunction(() => !document.getElementById('p').hasAttribute('data-fg-state'));
    assert.equal(await page.locator('#p .original').evaluate(e => e.inert), false);
    await page.evaluate(() => window.updateConfig({ enabled: true }));
    await state(page, 'p', 'block'); await page.close();
  });
  await run('new feed posts shield dynamically and duplicate content uses session cache', async () => {
    const page = await fixture(post('p', 'NORMAL 重複內容'));
    await state(page, 'p', 'allow');
    await page.evaluate(html => document.querySelector('[role=feed]').insertAdjacentHTML('beforeend', html), post('duplicate', 'NORMAL 重複內容'));
    await state(page, 'duplicate', 'allow');
    assert.equal(await page.evaluate(() => window.calls.length), 1); await page.close();
  });
  await run('nested articles are checked as one post, avoiding stuck nested masks', async () => {
    const page = await fixture(post('p', 'NORMAL', '<div role="article"><p>分享內容</p></div>'));
    await state(page, 'p', 'allow');
    assert.equal(await page.locator('#p [role=article]').evaluate(e => getComputedStyle(e).opacity), '1');
    assert.equal(await page.evaluate(() => window.calls.length), 1); await page.close();
  });
  await run('all images go into one classification request', async () => {
    const page = await fixture(post('p', 'NORMAL 多圖', '<img src="https://s.fbcdn.net/one.png"><img src="https://s.fbcdn.net/two.png">'));
    await state(page, 'p', 'allow');
    assert.equal(await page.evaluate(() => window.calls[0].images.length), 2); await page.close();
  });
  await run('unsupported video and unexpanded content do not get marked safe', async () => {
    const page = await fixture(post('video', '影片', '<video></video>') + post('partial', '截斷文字', '<button>查看更多</button>'));
    await state(page, 'video', 'error'); await state(page, 'partial', 'error');
    assert.equal(await page.evaluate(() => window.calls.length), 0); await page.close();
  });
  await run('broken images and empty content stay shielded without provider calls', async () => {
    const page = await fixture(post('broken', '圖片', '<img src="https://s.fbcdn.net/missing.png">') + '<div role="article" id="empty"><div></div></div>');
    // Replace a previously loaded source with a deliberately invalid local data image.
    await page.locator('#broken img').evaluate(img => img.src = 'data:image/png;base64,invalid');
    await state(page, 'broken', 'error'); await state(page, 'empty', 'error');
    assert.equal(await page.evaluate(() => window.calls.length), 0); await page.close();
  });
  await run('SPA navigation outside homepage restores content', async () => {
    const page = await fixture(post('p', 'BLOCK'));
    await state(page, 'p', 'block');
    await page.evaluate(() => history.pushState({}, '', '/groups/test'));
    await page.waitForFunction(() => document.documentElement.dataset.fgActive === 'false');
    assert.equal(await page.locator('#p .original').evaluate(e => e.inert), false); await page.close();
  });
  await run('settings popup saves consent and pairing, and reports local service status', async () => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.saved = { enabled: true, consent: false, pairingToken: '' };
      window.chrome = {
        storage: { local: { setAccessLevel: async () => {}, get: async () => window.saved, set: async value => Object.assign(window.saved, value) } },
        runtime: { sendMessage: async () => ({ ok: true, configured: true, calls: 12, dailyLimit: 2000 }) },
        tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ supported: true, enabled: true, total: 3, blocked: 1, pending: 1, errors: 1 }) }
      };
    });
    for (const file of ['popup.html', 'popup.js', 'popup.css']) {
      const body = await readFile(new URL('../extension/' + file, import.meta.url), 'utf8');
      await page.route('https://extension.test/' + file, route => route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8', body }));
    }
    await page.goto('https://extension.test/popup.html');
    await page.locator('#token').fill('a'.repeat(64));
    await page.locator('#consent').check();
    await page.getByRole('button', { name: '儲存設定' }).click();
    assert.equal(await page.evaluate(() => window.saved.consent), true);
    assert.equal(await page.evaluate(() => window.saved.pairingToken.length), 64);
    await page.getByRole('button', { name: '檢查本機服務' }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('12／2000'));
    await page.close();
  });
  const preview = await fixture(post('safe', 'NORMAL 今天去河濱散步，天氣很好。') + post('blocked', 'BLOCK 疑似色情分類的模擬結果') + post('fail', 'FAIL 模擬服務暫時無法連線'));
  await state(preview, 'safe', 'allow'); await state(preview, 'blocked', 'block'); await state(preview, 'fail', 'error');
  const output = process.env.SCREENSHOT_PATH || fileURLToPath(new URL('../test-results/preview.png', import.meta.url));
  await mkdir(fileURLToPath(new URL('../test-results/', import.meta.url)), { recursive: true });
  await preview.screenshot({ path: output, fullPage: true });
  console.log(`${passed} browser scenarios passed. Screenshot: ${output}`);
} finally { await browser.close(); }
