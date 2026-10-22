(() => {
  'use strict';
  const CANDIDATE = ':is([role="feed"], [role="main"]) :is([role="article"], [data-pagelet^="FeedUnit_"], div[aria-labelledby]:has([data-virtualized]))';
  const records = new Map();
  const cache = new Map();
  let enabled = true, consent = false, configured = false, running = 0, timer, url = location.href;
  const supported = () => location.hostname === 'www.facebook.com' && ['/', '/home.php'].includes(location.pathname);
  const active = () => enabled && supported();
  const setActive = () => document.documentElement?.setAttribute('data-fg-active', String(active()));
  setActive();
  const ERRORS = {
    CONSENT_REQUIRED: '請先在擴充功能設定中同意送出內容分析。',
    SERVICE_NOT_CONFIGURED: '此版本尚未連接正式服務，請等待開發者完成部署。',
    SESSION_REQUIRED: '連線已到期，請稍後重試。',
    SERVICE_UNREACHABLE: '暫時連不到分析服務，請稍後重試。',
    SERVICE_UNAVAILABLE: '分析服務暫時無法使用。',
    ANALYSIS_UNAVAILABLE: '內容分析未完成，保持遮擋。',
    SERVICE_PAUSED: '分析服務目前暫停。',
    SERVICE_COOLDOWN: '服務暫時忙碌或達到用量限制，請稍後重試。',
    USAGE_LIMIT: '已達免費服務的用量限制，請稍後重試。',
    REQUEST_TOO_LARGE: '貼文資料超過服務支援大小，保持遮擋。',
    BUSY: '目前正在檢查其他貼文，請稍後重試。',
    IMAGE_FETCH_FAILED: '部分圖片無法讀取，尚未完成檢查。',
    IMAGE_TOO_LARGE: '圖片超出第一版支援大小，保持遮擋。',
    IMAGES_TOO_LARGE: '圖片總量過大，保持遮擋。',
    UNSUPPORTED_EMBED: '包含尚不支援的嵌入內容。',
    UNSUPPORTED_VECTOR: '內嵌向量圖無法轉換，保持遮擋。',
    UNSUPPORTED_ROLE_IMAGE: '部分圖片缺少可讀取的來源，保持遮擋。',
    UNSUPPORTED_IMAGE: '包含目前不支援的圖片來源或格式。',
    ANIMATED_IMAGE: '第一版尚不分析動態圖片。',
    INCOMPLETE_IMAGES: '圖片尚未載入完成，保持遮擋。',
    TOO_MANY_IMAGES: '圖片超過 12 張，保持遮擋。',
    VIDEO_PREVIEW_UNAVAILABLE: '尚未取得影片封面或可讀取的畫面，載入後會自動重試。',
    LONG_TEXT: '貼文文字過長，保持遮擋。',
    EMPTY_CONTENT: '尚未取得可檢查的內容。',
    PROVIDER_UNREACHABLE: 'OpenAI 連線失敗或逾時，請重試。'
  };

  const inlineImages = new WeakMap();
  function inlineSvg(img, source) {
    const previous = inlineImages.get(img);
    if (previous?.source === source) return previous.data;
    const raw = source.slice(source.indexOf(',') + 1);
    const svg = new DOMParser().parseFromString(source.slice(0, source.indexOf(',')).includes(';base64') ? atob(raw) : decodeURIComponent(raw), 'image/svg+xml');
    // Only static inline vector artwork. Never silently classify an animated frame.
    if (svg.documentElement.localName !== 'svg' || svg.querySelector('parsererror,animate,animateMotion,animateTransform,set,script,style,foreignObject,image,use,[style]')) throw Error('UNSUPPORTED_IMAGE');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.75);
    inlineImages.set(img, { source, data });
    return data;
  }

  const videoPreviews = new WeakMap();
  const mediaIds = new WeakMap();
  let nextMediaId = 0;
  function mediaId(object) {
    if (!object) return null;
    if (!mediaIds.has(object)) mediaIds.set(object, ++nextMediaId);
    return mediaIds.get(object);
  }
  function videoPreview(video) {
    const source = JSON.stringify([mediaId(video), mediaId(video.srcObject), video.currentSrc, video.getAttribute('src'), video.poster,
      [...video.querySelectorAll('source')].map(node => [node.src, node.type])]);
    const prior = videoPreviews.get(video);
    if (prior?.source === source && prior.stream === video.srcObject) return prior;
    // Prefer the poster. Otherwise freeze one readable frame, never the whole video.
    let image = video.poster;
    if (!image && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        image = canvas.toDataURL('image/jpeg', 0.75);
      } catch { /* Cross-origin media may be unreadable; keep it shielded. */ }
    }
    const preview = { source, stream: video.srcObject, image };
    // Retry unavailable frames when loadeddata fires. Successful previews stay frozen.
    if (image) videoPreviews.set(video, preview);
    return preview;
  }

  function syncVideoPreviews(record, previews) {
    for (const [video, guard] of record.videos) {
      if (!previews.some(item => item.video === video)) {
        guard.ui.remove(); video.removeAttribute('data-fg-video-locked'); record.videos.delete(video);
      }
    }
    for (const { video, image } of previews) {
      let guard = record.videos.get(video);
      if (!guard) {
        const ui = document.createElement('div'); ui.setAttribute('data-fg-ui', 'video');
        const img = document.createElement('img'); img.alt = '已檢查的影片預覽';
        img.referrerPolicy = 'no-referrer';
        const detail = document.createElement('p');
        detail.textContent = '僅檢查封面／單張畫面，尚未檢查整段影片。';
        const play = document.createElement('button'); play.type = 'button';
        play.textContent = '播放影片（尚未完整檢查）';
        ui.append(img, detail, play);
        guard = { ui, img }; record.videos.set(video, guard);
        play.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          // Never apply a preview's approval to a recycled post or changed source.
          const snap = snapshot(record.root);
          if (snap.signature !== record.signature) { inspect(record); schedule(); return; }
          record.version++; render(record, 'manual');
          void video.play().catch(() => {});
        });
      }
      guard.image = image;
      if (guard.ui.previousSibling !== video) video.after(guard.ui);
      video.toggleAttribute('data-fg-video-locked', record.state !== 'manual');
      if (record.state !== 'manual') video.pause();
    }
  }

  function snapshot(root) {
    const copy = root.cloneNode(true);
    copy.querySelectorAll('[data-fg-ui],script,style').forEach(n => n.remove());
    // Known Facebook emoji assets carry their meaning in alt text; keep it for text classification.
    const isEmoji = img => {
      try { const u = new URL(img.currentSrc || img.src); return u.protocol === 'https:' && u.hostname === 'static.xx.fbcdn.net' && /^\/images\/emoji\.php\//.test(u.pathname) && Boolean(img.alt); }
      catch { return false; }
    };
    copy.querySelectorAll('img').forEach(img => { if (isEmoji(img)) img.replaceWith(document.createTextNode(img.alt)); });
    const text = copy.textContent.replace(/\s+/g, ' ').trim();
    const identity = [...root.querySelectorAll('a[href]')].filter(a => !a.closest('[data-fg-ui]'))
      .map(a => a.getAttribute('href')).filter(h => /\/posts\/|\/permalink\/|story_fbid=|\/photo/.test(h)).join('|');
    let problem = '';
    if (root.querySelector('iframe,canvas')) problem = 'UNSUPPORTED_EMBED';
    if (root.querySelector('object:not([type="nested/pressable"]),object[data],embed')) problem ||= 'UNSUPPORTED_EMBED';
    // Classify the currently loaded preview; expanding text/photos triggers a new snapshot.
    const images = [];
    const readiness = [];
    const previews = [...root.querySelectorAll('video')].map(video => ({ video, ...videoPreview(video) }));
    for (const preview of previews) {
      if (preview.image) images.push(preview.image);
      else problem ||= 'VIDEO_PREVIEW_UNAVAILABLE';
    }
    for (const img of root.querySelectorAll('img')) {
      if (img.closest('[data-fg-ui]') || isEmoji(img)) continue;
      let source = img.currentSrc || img.src;
      if (source.startsWith('data:image/svg+xml') && img.complete && img.naturalWidth) {
        try { source = inlineSvg(img, source); } catch { problem ||= 'UNSUPPORTED_VECTOR'; }
      }
      // Include avatars too: filtering by dimensions risks skipping real small pictures.
      images.push(source);
      readiness.push(Boolean(img.complete && img.naturalWidth > 0));
      if (!source || !img.complete || !img.naturalWidth) problem ||= 'INCOMPLETE_IMAGES';
    }
    // Facebook renders profile photos as SVG image nodes. Fetch and classify their full source too.
    for (const img of root.querySelectorAll('svg image')) {
      if (img.closest('[data-fg-ui]')) continue;
      const source = img.href?.baseVal || '';
      images.push(source);
      if (!source) problem ||= 'INCOMPLETE_IMAGES';
    }
    // Analyze complete background assets too, including sprite sheets (never crop them).
    for (const element of [root, ...root.querySelectorAll('[style],[role="img"]')]) {
      if (element.closest('[data-fg-ui]')) continue;
      const background = element.style.backgroundImage;
      if (/url\(/i.test(background)) {
        const urls = [...background.matchAll(/url\(["']?(.*?)["']?\)/g)].map(match => match[1]);
        if (!urls.length) problem ||= 'UNSUPPORTED_IMAGE';
        images.push(...urls);
      } else if (element.getAttribute('role') === 'img' && !['IMG', 'svg'].includes(element.tagName)) {
        problem ||= 'UNSUPPORTED_ROLE_IMAGE';
      }
    }
    if (new Set(images).size > 12) problem = 'TOO_MANY_IMAGES';
    if (text.length > 16000) problem = 'LONG_TEXT';
    if (!text && !images.length) problem ||= 'EMPTY_CONTENT';
    const payload = { text, images: [...new Set(images)] };
    // Readiness and identity participate in stale-response and recycled-node protection.
    const signature = JSON.stringify([payload, identity, readiness, problem, previews.map(p => p.source)]);
    return { payload, signature, problem, previews };
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
    for (const [video, guard] of record.videos) {
      // Only load the visible preview after consent and classification have passed.
      if (state === 'allow' && guard.image) guard.img.src = guard.image;
      else guard.img.removeAttribute('src');
      video.toggleAttribute('data-fg-video-locked', state !== 'manual');
      if (state !== 'manual') video.pause();
    }
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
    ui.setAttribute('data-fg-ui', 'post');
    const card = document.createElement('div'); card.className = 'fg-card';
    const title = document.createElement('span'); title.className = 'fg-title';
    const detail = document.createElement('p'); detail.className = 'fg-detail';
    const retry = document.createElement('button'); retry.textContent = '重試'; retry.type = 'button';
    const show = document.createElement('button'); show.textContent = '顯示此貼文'; show.type = 'button';
    card.append(title, detail, retry, show); ui.append(card);
    const record = { root, ui, title, detail, retry, inert: new Map(), videos: new Map(), signature: '', version: 0, state: 'pending', readyAt: 0 };
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
    syncVideoPreviews(record, snap.previews);
    if (record.signature === snap.signature) return;
    record.signature = snap.signature; record.version++;
    record.payload = snap.payload; record.problem = snap.problem;
    record.readyAt = Date.now() + 450;
    render(record, 'pending');
  }
  function cleanup(record) {
    record.version++;
    for (const [element, prior] of record.inert) element.inert = prior;
    record.inert.clear(); syncVideoPreviews(record, []); record.ui.remove(); record.root.removeAttribute('data-fg-state');
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
      if (!configured) throw new Error('SERVICE_NOT_CONFIGURED');
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
      const changed = enabled !== r.enabled || consent !== r.consent || configured !== r.configured;
      enabled = Boolean(r.enabled); consent = Boolean(r.consent); configured = Boolean(r.configured);
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
    attributeFilter: ['src', 'srcset', 'href', 'style', 'role', 'data-pagelet', 'aria-labelledby', 'data-virtualized', 'alt', 'data', 'type', 'poster'] });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLImageElement) {
      for (const r of records.values()) if (r.root.contains(event.target)) inspect(r);
      schedule();
    }
  }, true);
  for (const type of ['loadeddata', 'emptied']) document.addEventListener(type, event => {
    if (!active() || !(event.target instanceof HTMLVideoElement)) return;
    if (type === 'emptied') videoPreviews.delete(event.target);
    for (const r of records.values()) if (r.root.contains(event.target)) inspect(r);
    schedule();
  }, true);
  document.addEventListener('play', event => {
    if (!active() || !(event.target instanceof HTMLVideoElement)) return;
    const record = [...records.values()].find(r => r.root.contains(event.target));
    if (record) {
      inspect(record);
      if (record.state !== 'manual') event.target.pause();
    } else if (event.target.closest(CANDIDATE)) event.target.pause();
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
