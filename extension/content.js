(() => {
  'use strict';
  const CANDIDATE = ':is([role="feed"], [role="main"]) :is([role="article"], [data-pagelet^="FeedUnit_"])';
  const records = new Map();
  const cache = new Map();
  let enabled = true, consent = false, paired = false, running = 0, timer, url = location.href;
  const supported = () => location.hostname === 'www.facebook.com' && ['/', '/home.php'].includes(location.pathname);
  const active = () => enabled && supported();
  const setActive = () => document.documentElement?.setAttribute('data-fg-active', String(active()));
  setActive();
  const ERRORS = {
    CONSENT_REQUIRED: '請先在擴充功能設定中同意送出內容分析。',
    PAIRING_REQUIRED: '請先設定本機配對碼。',
    LOCAL_UNREACHABLE: '本機服務未啟動或連線逾時，請執行 npm start。',
    API_KEY_MISSING: '本機服務尚未設定 OpenAI API key。',
    API_KEY_INVALID: 'OpenAI 金鑰無效，請更新本機設定。',
    PROVIDER_RATE_LIMIT: 'OpenAI 暫時限流，請稍後重試。',
    DAILY_LIMIT: '已達本次服務的每日檢查上限。',
    BUSY: '本機服務忙碌，請稍後重試。',
    IMAGE_FETCH_FAILED: '部分圖片無法讀取，尚未完成檢查。',
    IMAGE_TOO_LARGE: '圖片超出第一版支援大小，保持遮擋。',
    IMAGES_TOO_LARGE: '圖片總量過大，保持遮擋。',
    UNSUPPORTED_IMAGE: '包含目前不支援的圖片來源或格式。',
    ANIMATED_IMAGE: '第一版尚不分析動態圖片。',
    INCOMPLETE_IMAGES: '圖片尚未載入完成，保持遮擋。',
    TOO_MANY_IMAGES: '圖片超過 12 張，保持遮擋。',
    VIDEO: '第一版尚不分析影片或 Reels。',
    PARTIAL_CONTENT: '貼文有未展開的內容，無法完整檢查。',
    LONG_TEXT: '貼文文字過長，保持遮擋。',
    EMPTY_CONTENT: '尚未取得可檢查的內容。',
    PROVIDER_UNREACHABLE: 'OpenAI 連線失敗或逾時，請重試。'
  };

  function snapshot(root) {
    const copy = root.cloneNode(true);
    copy.querySelectorAll('[data-fg-ui],script,style').forEach(n => n.remove());
    const text = copy.textContent.replace(/\s+/g, ' ').trim();
    const identity = [...root.querySelectorAll('a[href]')].filter(a => !a.closest('[data-fg-ui]'))
      .map(a => a.getAttribute('href')).filter(h => /\/posts\/|\/permalink\/|story_fbid=|\/photo/.test(h)).join('|');
    let problem = '';
    if (root.querySelector('video,iframe,canvas')) problem = 'VIDEO';
    if (root.querySelector('svg image,object,embed,[role="img"]:not(img):not(svg)')) problem ||= 'UNSUPPORTED_IMAGE';
    if ([...root.querySelectorAll('a[href]')].some(a => /\/reel\/|\/watch\//.test(a.getAttribute('href') || ''))) problem = 'VIDEO';
    if (/(?:^|\s)\+\d+(?:\s|$)/.test(text) || [...copy.querySelectorAll('button,[role="button"]')]
      .some(b => /^(查看更多|顯示更多|更多內容|See more)$/i.test(b.textContent.trim()))) problem = 'PARTIAL_CONTENT';
    const images = [];
    const readiness = [];
    for (const img of root.querySelectorAll('img')) {
      if (img.closest('[data-fg-ui]')) continue;
      const source = img.currentSrc || img.src;
      // Include avatars too: filtering by dimensions risks skipping real small pictures.
      images.push(source);
      readiness.push(Boolean(img.complete && img.naturalWidth > 0));
      if (!source || !img.complete || !img.naturalWidth) problem ||= 'INCOMPLETE_IMAGES';
    }
    // FB may use CSS background photos. An unhandled one must not be released as text-only.
    for (const element of [root, ...root.querySelectorAll('[style]')]) {
      if (!element.closest('[data-fg-ui]') && /url\(/i.test(element.style.backgroundImage)) problem ||= 'UNSUPPORTED_IMAGE';
    }
    if (images.length > 12) problem = 'TOO_MANY_IMAGES';
    if (text.length > 16000) problem = 'LONG_TEXT';
    if (!text && !images.length) problem ||= 'EMPTY_CONTENT';
    const payload = { text, images: [...new Set(images)] };
    // Readiness and identity participate in stale-response and recycled-node protection.
    const signature = JSON.stringify([payload, identity, readiness, problem]);
    return { payload, signature, problem };
  }

  function render(record, state, error = '') {
    record.state = state;
    record.root.setAttribute('data-fg-state', state);
    const names = { pending: '正在檢查貼文', block: '已隱藏：疑似色情', error: '這則貼文尚未通過檢查' };
    record.title.textContent = names[state] || '';
    record.detail.textContent = state === 'pending' ? '先遮住內容，完成檢查後再顯示。' :
      state === 'block' ? '由 OpenAI 色情內容分類判定；你可以選擇顯示。' : (ERRORS[error] || '檢查未完成，請稍後重試或手動顯示。');
    record.retry.hidden = state !== 'error';
    // inert prevents focus/keyboard interaction with invisible original content.
    const shielded = !['allow', 'manual'].includes(state) && active();
    if (shielded) record.root.querySelectorAll('video').forEach(video => video.pause());
    for (const child of record.root.children) {
      if (child === record.ui) continue;
      if (shielded) {
        if (!record.inert.has(child)) record.inert.set(child, child.inert);
        child.inert = true;
      } else if (record.inert.has(child)) {
        child.inert = record.inert.get(child); record.inert.delete(child);
      }
    }
  }

  function create(root) {
    const ui = document.createElement('div');
    ui.setAttribute('data-fg-ui', '');
    const card = document.createElement('div'); card.className = 'fg-card';
    const title = document.createElement('span'); title.className = 'fg-title';
    const detail = document.createElement('p'); detail.className = 'fg-detail';
    const retry = document.createElement('button'); retry.textContent = '重試'; retry.type = 'button';
    const show = document.createElement('button'); show.textContent = '顯示此貼文'; show.type = 'button';
    card.append(title, detail, retry, show); ui.append(card);
    const record = { root, ui, title, detail, retry, inert: new Map(), signature: '', version: 0, state: 'pending', readyAt: 0 };
    root.append(ui); records.set(root, record);
    show.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); record.version++;
      // Pin the manual override to this exact content, not to the reusable DOM node.
      const snap = snapshot(root); record.signature = snap.signature;
      render(record, 'manual');
    });
    retry.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); record.version++;
      record.signature = ''; inspect(record); schedule();
    });
    return record;
  }

  function inspect(record) {
    const snap = snapshot(record.root);
    if (record.signature === snap.signature) return;
    record.signature = snap.signature; record.version++;
    record.payload = snap.payload; record.problem = snap.problem;
    record.readyAt = Date.now() + 450;
    render(record, 'pending');
  }
  function cleanup(record) {
    record.version++;
    for (const [element, prior] of record.inert) element.inert = prior;
    record.inert.clear(); record.ui.remove(); record.root.removeAttribute('data-fg-state');
    records.delete(record.root);
  }
  function scan() {
    setActive();
    if (!active()) { for (const r of [...records.values()]) cleanup(r); return; }
    const nodes = [...document.querySelectorAll(CANDIDATE)];
    const set = new Set(nodes);
    const roots = new Set();
    for (const node of nodes) {
      let parent = node.parentElement, nested = false;
      while (parent) { if (set.has(parent)) { nested = true; break; } parent = parent.parentElement; }
      if (nested) node.setAttribute('data-fg-nested', 'true');
      else { node.removeAttribute('data-fg-nested'); roots.add(node); }
    }
    for (const r of [...records.values()]) if (!roots.has(r.root) || !r.root.isConnected) cleanup(r);
    for (const root of roots) {
      const record = records.get(root) || create(root);
      // Reattach if React replaced all the post's children.
      if (record.ui.parentNode !== root) root.append(record.ui);
      inspect(record);
    }
    pump();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 40); }
  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function remember(key, decision) {
    cache.delete(key); cache.set(key, decision);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  async function check(record) {
    const version = record.version;
    const sig = record.signature;
    const payload = record.payload;
    const current = () => active() && record.root.isConnected && record.version === version && record.signature === sig;
    running++; record.checking = version;
    try {
      if (!consent) throw new Error('CONSENT_REQUIRED');
      if (!paired) throw new Error('PAIRING_REQUIRED');
      if (record.problem) throw new Error(record.problem);
      const key = await digest(sig);
      let decision = cache.get(key);
      if (!decision) {
        const result = await chrome.runtime.sendMessage({ type: 'MODERATE', payload });
        if (!result?.ok) throw new Error(result?.error || 'UNKNOWN_ERROR');
        if (!['allow', 'block'].includes(result.decision)) throw new Error('INVALID_RESPONSE');
        decision = result.decision; remember(key, decision);
      }
      if (!current()) return;
      // Check again after the API response even if an observer callback was delayed.
      if (snapshot(record.root).signature !== sig) { inspect(record); return; }
      render(record, decision);
    } catch (error) {
      if (current()) render(record, 'error', error.message);
    } finally {
      running--; if (record.checking === version) record.checking = undefined;
      schedule();
    }
  }
  function pump() {
    if (!active()) return;
    const queued = [...records.values()].filter(r => r.state === 'pending' && r.checking === undefined)
      .map(r => ({ r, rect: r.root.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom >= -200 && rect.top <= innerHeight + 1200)
      .sort((a, b) => Math.abs(a.rect.top) - Math.abs(b.rect.top));
    for (const { r } of queued) {
      if (running >= 2) break;
      if (Date.now() < r.readyAt) { setTimeout(pump, Math.max(10, r.readyAt - Date.now())); continue; }
      void check(r);
    }
  }
  async function configure() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'CONFIG' });
      if (!r?.ok) return;
      const changed = enabled !== r.enabled || consent !== r.consent || paired !== r.paired;
      enabled = Boolean(r.enabled); consent = Boolean(r.consent); paired = Boolean(r.paired);
      if (changed) for (const record of records.values()) { record.signature = ''; record.version++; }
      else for (const record of records.values()) if (record.state === 'error') { record.signature = ''; record.version++; }
      setActive(); scan();
    } catch { /* Keep the initial shield if extension messaging fails. */ }
  }

  const observer = new MutationObserver(mutations => {
    let rescan = false;
    for (const m of mutations) {
      const element = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      if (element?.closest('[data-fg-ui]')) continue;
      if (m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-fg-ui'))) continue;
      if (m.type === 'attributes' && (m.attributeName.startsWith('data-fg-') || m.attributeName === 'inert')) continue;
      if (!active()) continue;
      // Shield known posts synchronously in the observer, before the next paint.
      for (const record of records.values()) if (record.root.contains(element)) inspect(record);
      rescan = true;
    }
    if (rescan) schedule();
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['src', 'srcset', 'href', 'style', 'role', 'data-pagelet'] });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLImageElement) {
      for (const r of records.values()) if (r.root.contains(event.target)) inspect(r);
      schedule();
    }
  }, true);
  document.addEventListener('play', event => {
    if (!active() || !(event.target instanceof HTMLVideoElement)) return;
    for (const r of records.values()) if (r.root.contains(event.target) && !['allow', 'manual'].includes(r.state)) event.target.pause();
  }, true);
  addEventListener('scroll', pump, { passive: true });
  addEventListener('resize', pump, { passive: true });
  setInterval(() => {
    if (location.href !== url) { url = location.href; cache.clear(); scan(); }
  }, 250);
  chrome.runtime.onMessage.addListener((m, _, reply) => {
    if (m.type === 'CONFIG_CHANGED') { void configure(); return; }
    if (m.type === 'STATUS') {
      const list = [...records.values()];
      reply({ supported: supported(), enabled, total: list.length,
        blocked: list.filter(r => r.state === 'block').length,
        pending: list.filter(r => r.state === 'pending').length,
        errors: list.filter(r => r.state === 'error').length });
    }
  });
  document.addEventListener('DOMContentLoaded', scan, { once: true });
  void configure();
})();
