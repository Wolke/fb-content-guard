import { cloudImageDataUrl } from './net.js';
import { CONSENT_VERSION, createServiceClient, validServiceOrigin } from './service-client.js';

const DEFAULTS = { enabled: true, consentVersion: '' };
const active = new Set();
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.remove('pairingToken');
  const config = await (await fetch(chrome.runtime.getURL('cloud-config.json'))).json();
  if (config.consentVersion !== CONSENT_VERSION) throw Error('SERVICE_NOT_CONFIGURED');
  const origin = config.serviceOrigin;
  return { configured: validServiceOrigin(origin), client: createServiceClient({ origin,
    readSession: async () => (await chrome.storage.session.get('cloudSession')).cloudSession,
    saveSession: cloudSession => chrome.storage.session.set({ cloudSession }) }) };
})();
// Avoid unhandled startup rejection; requests report the configuration error.
ready.catch(() => {});
const settings = () => chrome.storage.local.get(DEFAULTS);
function isFacebook(sender) {
  try { return sender.tab && new URL(sender.url).origin === 'https://www.facebook.com'; }
  catch { return false; }
}
const isPopup = sender => !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
async function checkConsent() {
  const cfg = await settings();
  if (!cfg.enabled || cfg.consentVersion !== CONSENT_VERSION) throw Error('CONSENT_REQUIRED');
}
async function handle(message, sender) {
  if (!isFacebook(sender) && !isPopup(sender)) throw Error('FORBIDDEN');
  const cfg = await settings();
  const { configured, client } = await ready;
  if (message.type === 'CONFIG') return { enabled: cfg.enabled, consent: cfg.consentVersion === CONSENT_VERSION, configured };
  if (message.type === 'HEALTH' && isPopup(sender)) return client.health();
  if (message.type !== 'MODERATE' || !isFacebook(sender)) throw Error('FORBIDDEN');
  await checkConsent();
  if (!configured) throw Error('SERVICE_NOT_CONFIGURED');
  if (active.size >= 2) throw Error('BUSY');
  const p = message.payload;
  if (!p || typeof p.text !== 'string' || p.text.length > 16000 || !Array.isArray(p.images) || p.images.length > 12 ||
      p.images.some(x => typeof x !== 'string')) throw Error('INVALID_CONTENT');
  const controller = new AbortController();
  active.add(controller);
  try {
    const images = [];
    let size = 0;
    for (let i = 0; i < p.images.length; i += 3) {
      await checkConsent();
      if (controller.signal.aborted) throw Error('CONSENT_REQUIRED');
      const batch = await Promise.all(p.images.slice(i, i + 3).map(url => cloudImageDataUrl(url)));
      for (const item of batch) { size += item.size; images.push(item.data); }
      if (size > 512 * 1024) throw Error('IMAGES_TOO_LARGE');
    }
    await checkConsent();
    return await client.moderate({ text: p.text, images }, { signal: controller.signal, checkConsent });
  } finally { active.delete(controller); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message, sender).then(result => reply({ ok: true, ...result }))
    .catch(error => reply({ ok: false, error: error.message || 'UNKNOWN_ERROR' }));
  return true;
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !('enabled' in changes || 'consentVersion' in changes)) return;
  for (const controller of active) controller.abort();
  try { await (await ready).client.clear(); } catch { /* No external requests. */ }
  const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_CHANGED' }).catch(() => {});
});
