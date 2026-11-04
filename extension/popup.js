import { CONSENT_VERSION } from './service-client.js';
const $ = id => document.getElementById(id);
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const cfg = await chrome.storage.local.get({ enabled: true, consentVersion: '', localImageCheck: false });
$('enabled').checked = cfg.enabled;
$('localImageCheck').checked = cfg.localImageCheck;
$('consent').checked = cfg.consentVersion === CONSENT_VERSION;
if (!$('consent').checked) $('status').textContent = '請先閱讀並同意雲端分析說明。未同意前不會送出貼文。';
const errors = {
  SERVICE_NOT_CONFIGURED: '此安裝包尚未連接正式服務，請等待開發者完成部署。',
  SERVICE_PAUSED: '服務目前暫停，請稍後再試。',
  SERVICE_UNREACHABLE: '暫時連不到服務，請檢查網路或稍後再試。',
  SERVICE_UNAVAILABLE: '服務暫時無法使用，請稍後再試。',
  USAGE_LIMIT: '已達服務用量上限，請稍後再試。'
};
$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ enabled: $('enabled').checked,
    localImageCheck: $('localImageCheck').checked,
    consentVersion: $('consent').checked ? CONSENT_VERSION : '' });
  $('status').textContent = $('consent').checked ? '已儲存。首次使用請重新整理 Facebook 首頁。' : '已停止新的雲端分析。已送出的請求可能仍會完成。';
});
$('openLocal').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('local-ai.html');
  const tabs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (tabs.length) await chrome.tabs.update(tabs[0].tabId, { active: true });
  else await chrome.tabs.create({ url });
});
$('health').addEventListener('click', async () => {
  $('health').disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'HEALTH' });
    $('status').textContent = r.ok ? '雲端服務可連線。此檢查不會上傳貼文，也不代表分類測試已通過。' : (errors[r.error] || '服務尚未就緒，請稍後重試。');
  } catch { $('status').textContent = '擴充功能連線失敗，請重新載入。'; }
  finally { $('health').disabled = false; }
});
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await chrome.tabs.sendMessage(tab.id, { type: 'STATUS' });
  const reasons = {
    UNSUPPORTED_IMAGE: '圖片來源／格式不支援', UNSUPPORTED_VECTOR: '向量圖片無法轉換',
    UNSUPPORTED_ROLE_IMAGE: '圖片缺少來源', UNSUPPORTED_EMBED: '嵌入內容不支援',
    TOO_MANY_IMAGES: '圖片超過 12 張', IMAGE_FETCH_FAILED: '圖片下載失敗',
    IMAGE_TOO_LARGE: '單張圖片過大', IMAGES_TOO_LARGE: '圖片總量過大',
    LONG_TEXT: '文字過長', ANIMATED_IMAGE: '動態圖片不支援', ANALYSIS_UNAVAILABLE: '雲端分析未完成',
    LOCAL_NOT_READY: '本機模型未啟用／分頁已關閉', LOCAL_UNCERTAIN: '本機模型不確定',
    LOCAL_INVALID_RESPONSE: '本機回覆無效', LOCAL_TIMEOUT: '本機檢查逾時',
    LOCAL_FAILED: '本機檢查失敗', LOCAL_CONTEXT_OVERFLOW: '本機內容超過容量', LOCAL_CANCELLED: '本機檢查已取消'
  };
  const details = Object.entries(s.errorReasons || {}).map(([code, count]) => `${reasons[code] || '其他分析錯誤'}：${count}`).join('；');
  $('stats').textContent = !s.supported ? '目前頁面不在支援範圍，請開啟 www.facebook.com 首頁。' :
    !s.enabled ? '遮擋已關閉。' :
    `目前辨識 ${s.total} 則 · 遮擋 ${s.blocked} · 檢查中 ${s.pending} · 等待額度 ${s.waiting || 0} · 等待內容 ${s.loading || 0} · 無法讀取 ${s.errors}` +
    (s.total === 0 ? '\n尚未找到貼文；可能正在載入，或 FB 版面需要適配。' : '') +
    (s.waiting ? '\n依額度自動排隊；反覆刷新不會增加可用額度。' : '') + (details ? '\n' + details : '');
} catch { $('stats').textContent = '請開啟或重新整理 FB 首頁，讓擴充功能開始運作。'; }
