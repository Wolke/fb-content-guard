const $ = id => document.getElementById(id);
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const cfg = await chrome.storage.local.get({ enabled: true, consent: false, pairingToken: '' });
$('enabled').checked = cfg.enabled;
$('consent').checked = cfg.consent;
$('token').value = cfg.pairingToken;
const errors = {
  PAIRING_REQUIRED: '配對碼不正確，請確認與本機設定一致。',
  LOCAL_UNREACHABLE: '連不到本機服務，請先執行 npm start。',
  API_KEY_MISSING: '本機服務尚未設定 OpenAI API key。'
};
$('save').addEventListener('click', async () => {
  const pairingToken = $('token').value.trim();
  if (pairingToken && !/^[a-f0-9]{64}$/.test(pairingToken)) {
    $('status').textContent = '請填入 setup 顯示的 64 字元配對碼，不是 OpenAI API key。'; return;
  }
  await chrome.storage.local.set({ enabled: $('enabled').checked, consent: $('consent').checked, pairingToken });
  $('status').textContent = '已儲存。設定會套用至已開啟的 FB 分頁。';
});
$('health').addEventListener('click', async () => {
  $('health').disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'HEALTH' });
    $('status').textContent = r.ok ? (r.configured ? `已連線 · 本次服務今日已呼叫 ${r.calls}／${r.dailyLimit} 次` : errors.API_KEY_MISSING) : (errors[r.error] || '連線失敗，請檢查本機設定。');
  } catch { $('status').textContent = '擴充功能連線失敗，請重新載入。'; }
  finally { $('health').disabled = false; }
});
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await chrome.tabs.sendMessage(tab.id, { type: 'STATUS' });
  $('stats').textContent = !s.supported ? '目前頁面不在支援範圍，請開啟 www.facebook.com 首頁。' :
    !s.enabled ? '遮擋已關閉。' :
    `目前辨識 ${s.total} 則 · 遮擋 ${s.blocked} · 待檢查 ${s.pending} · 無法檢查 ${s.errors}` +
    (s.total === 0 ? '\n尚未找到貼文；可能正在載入，或 FB 版面需要適配。' : '');
} catch { $('stats').textContent = '請開啟或重新整理 FB 首頁，讓擴充功能開始運作。'; }
