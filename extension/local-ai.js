import { MODEL_OPTIONS, classifyLocalImages } from './local-model.js';
import { CONSENT_VERSION } from './service-client.js';
const $ = id => document.getElementById(id);
let session, port, job, heartbeat, completed = 0, incomplete = 0;
const status = text => { $('status').textContent = text; };
function connect() {
  port = chrome.runtime.connect({ name: 'local-model' });
  port.onDisconnect.addListener(() => {
    clearInterval(heartbeat); job?.controller.abort(); session?.destroy(); session = undefined;
    status('模型連線已停止，或已有另一個模型分頁。請關閉重複分頁後重新啟用。'); $('start').disabled = false;
  });
  port.onMessage.addListener(async message => {
    if (message.type === 'CANCEL') { if (job?.id === message.id) job.controller.abort(); return; }
    if (message.type !== 'CLASSIFY') return;
    if (job) { port.postMessage({ type: 'RESULT', id: message.id, ok: false, error: 'LOCAL_BUSY' }); return; }
    const controller = new AbortController();
    const current = { id: message.id, controller }; job = current;
    const timer = setTimeout(() => controller.abort(Error('LOCAL_TIMEOUT')), 120000);
    try {
      const cfg = await chrome.storage.local.get({ enabled: true, consentVersion: '', localImageCheck: false });
      if (!cfg.enabled || cfg.consentVersion !== CONSENT_VERSION || !cfg.localImageCheck) throw Error('LOCAL_CANCELLED');
      status('正在本機檢查圖片；Facebook 上的內容保持隱藏。');
      const result = await classifyLocalImages(session, message.images, { signal: controller.signal, onEvent: event => { try { port.postMessage({ type: 'EVENT', id: message.id, event }); } catch {} } });
      controller.signal.throwIfAborted();
      port.postMessage({ type: 'RESULT', id: message.id, ok: true, ...result });
      completed++; $('stats').textContent = `本次判定完成 ${completed} 則 · 未完成 ${incomplete} 則（不保存圖片或文案）`;
      status('模型已就緒，等候下一則圖片。');
    } catch (error) {
      try { port.postMessage({ type: 'RESULT', id: message.id, ok: false, error: error.message }); } catch {}
      incomplete++;
      const known = ['LOCAL_UNCERTAIN', 'LOCAL_INVALID_RESPONSE', 'LOCAL_CONTEXT_OVERFLOW', 'LOCAL_TIMEOUT', 'LOCAL_CANCELLED', 'INVALID_CONTENT'];
      const code = known.includes(error.message) ? error.message : 'LOCAL_FAILED';
      $('stats').textContent = `本次判定完成 ${completed} 則 · 未完成 ${incomplete} 則（不保存圖片或文案）`;
      status(`這次檢查未完成（${code}），內容保持隱藏。可在「查看 API 與判定紀錄」啟用診斷後查看後續明細。`);
    } finally { clearTimeout(timer); if (job === current) job = undefined; }
  });
  port.postMessage({ type: 'READY' });
  // A message (not merely an open port) keeps the MV3 worker alive while inference runs.
  heartbeat = setInterval(() => { try { port.postMessage({ type: 'HEARTBEAT' }); } catch {} }, 20000);
}
$('start').onclick = async () => {
  $('start').disabled = true; status('正在下載／啟用模型…');
  try {
    session = await LanguageModel.create({ ...MODEL_OPTIONS, monitor(m) {
      m.addEventListener('downloadprogress', e => { $('progress').value = e.loaded; });
    } });
    $('progress').value = 1; connect(); status('模型已就緒。請保留此分頁，並在清朗設定啟用加強圖片檢查。');
  } catch { status('模型無法啟用，請確認 Chrome 版本、可用磁碟與硬體支援。'); $('start').disabled = false; }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['enabled', 'consentVersion', 'localImageCheck'].some(k => k in changes)) job?.controller.abort();
});
window.addEventListener('pagehide', () => { clearInterval(heartbeat); job?.controller.abort(); session?.destroy(); port?.disconnect(); });
try {
  const available = typeof LanguageModel === 'undefined' ? 'unavailable' : await LanguageModel.availability(MODEL_OPTIONS);
  if (available === 'unavailable') status('這台電腦目前不支援本機圖片模型。請勿啟用加強圖片檢查。');
  else { $('start').disabled = false; status('可啟用本機圖片模型。首次可能需要下載，請按上方按鈕。'); }
} catch { status('無法確認模型支援能力。請勿啟用加強圖片檢查。'); }
