import { imageDataUrl } from './net.js';

const BASE = 'http://127.0.0.1:43187';
const DEFAULTS = { enabled: true, consent: false, pairingToken: '' };
// Keep the pairing secret in trusted extension contexts, away from content scripts.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const settings = async () => { await ready; return chrome.storage.local.get(DEFAULTS); };

function isFacebook(sender) {
  try { return sender.tab && new URL(sender.url).origin === 'https://www.facebook.com'; }
  catch { return false; }
}
function isPopup(sender) {
  return !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
}
async function callLocal(path, cfg, payload) {
  if (!/^[a-f0-9]{64}$/.test(cfg.pairingToken)) throw new Error('PAIRING_REQUIRED');
  let response;
  try {
    response = await fetch(BASE + path, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${cfg.pairingToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(28000), cache: 'no-store', redirect: 'error'
    });
  } catch { throw new Error('LOCAL_UNREACHABLE'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('LOCAL_INVALID_RESPONSE'); }
  if (!response.ok) throw new Error(data.error || 'LOCAL_ERROR');
  return data;
}

async function handle(message, sender) {
  if (!isFacebook(sender) && !isPopup(sender)) throw new Error('FORBIDDEN');
  const cfg = await settings();
  if (message.type === 'CONFIG') return { enabled: cfg.enabled, consent: cfg.consent, paired: Boolean(cfg.pairingToken) };
  if (message.type === 'HEALTH' && isPopup(sender)) return callLocal('/health', cfg);
  if (message.type !== 'MODERATE' || !isFacebook(sender)) throw new Error('FORBIDDEN');
  if (!cfg.enabled || !cfg.consent) throw new Error('CONSENT_REQUIRED');
  const p = message.payload;
  if (!p || typeof p.text !== 'string' || p.text.length > 16000 || !Array.isArray(p.images) || p.images.length > 12 ||
      p.images.some(x => typeof x !== 'string')) throw new Error('INVALID_CONTENT');
  // Check pairing before any network request for images.
  if (!/^[a-f0-9]{64}$/.test(cfg.pairingToken)) throw new Error('PAIRING_REQUIRED');
  const images = [];
  let size = 0;
  // Bounded batches avoid a burst of downloads on posts with multiple pictures.
  for (let i = 0; i < p.images.length; i += 3) {
    const batch = await Promise.all(p.images.slice(i, i + 3).map(url => imageDataUrl(url)));
    for (const item of batch) { size += item.size; images.push(item.data); }
    if (size > 12 * 1024 * 1024) throw new Error('IMAGES_TOO_LARGE');
  }
  const latest = await settings();
  if (!latest.enabled || !latest.consent) throw new Error('CONSENT_REQUIRED');
  const result = await callLocal('/moderate', latest, { text: p.text, images });
  if (!['allow', 'block'].includes(result.decision)) throw new Error('LOCAL_INVALID_RESPONSE');
  return { decision: result.decision };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message, sender).then(result => reply({ ok: true, ...result }))
    .catch(error => reply({ ok: false, error: error.message || 'UNKNOWN_ERROR' }));
  return true;
});
chrome.storage.onChanged.addListener(async (_, area) => {
  if (area !== 'local') return;
  const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_CHANGED' }).catch(() => {});
});
