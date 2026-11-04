import { createAnalysisBudget } from './analysis-budget.js';
import { cloudImageDataUrl } from './net.js';
import { CONSENT_VERSION, createServiceClient, validServiceOrigin } from './service-client.js';
import { createLocalBridge } from './local-bridge.js';

const DEFAULTS = { enabled: true, consentVersion: '', localImageCheck: false };
const active = new Set();
async function notifyConfig() {
  const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_CHANGED' }).catch(() => {});
}
const local = createLocalBridge({ runtime: chrome.runtime, onReady: () => { void notifyConfig().catch(() => {}); } });
let settingsRevision = 0;
const budget = createAnalysisBudget({
  read: async () => (await chrome.storage.session.get('analysisBudget')).analysisBudget,
  write: analysisBudget => chrome.storage.session.set({ analysisBudget })
});
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
  const revision = settingsRevision;
  const cfg = await settings();
  const { configured, client } = await ready;
  if (message.type === 'CONFIG') return { enabled: cfg.enabled, consent: cfg.consentVersion === CONSENT_VERSION, configured, localImageCheck: Boolean(cfg.localImageCheck) };
  if (message.type === 'HEALTH' && isPopup(sender)) return client.health();
  if (message.type !== 'MODERATE' || !isFacebook(sender)) throw Error('FORBIDDEN');
  await checkConsent();
  if (!configured) throw Error('SERVICE_NOT_CONFIGURED');
  if (active.size >= (cfg.localImageCheck ? 1 : 2)) throw Object.assign(Error('BUSY'), { retryAfterMs: 2000 });
  const p = message.payload;
  if (!p || typeof p.text !== 'string' || p.text.length > 16000 || !Array.isArray(p.images) || p.images.length > 12 ||
      p.images.some(x => typeof x !== 'string')) throw Error('INVALID_CONTENT');
  const units = Math.max(1, p.images.length);
  if (revision !== settingsRevision) throw Error('LOCAL_CANCELLED');
  if (cfg.localImageCheck && p.images.length) local.assertReady();
  await budget.check(units);
  if (active.size >= (cfg.localImageCheck ? 1 : 2)) throw Object.assign(Error('BUSY'), { retryAfterMs: 2000 });
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
    await budget.reserve(units);
    try {
      const result = await client.moderate({ text: p.text, images }, { signal: controller.signal, checkConsent });
      await budget.success();
      if (controller.signal.aborted || settingsRevision !== revision) throw Error('LOCAL_CANCELLED');
      if (!['allow', 'block'].includes(result.decision)) throw Error('INVALID_RESPONSE');
      const final = result.decision === 'allow' && cfg.localImageCheck && images.length
        ? await local.classify(images, { signal: controller.signal }) : result;
      await checkConsent();
      if (controller.signal.aborted || settingsRevision !== revision) throw Error('LOCAL_CANCELLED');
      return final;
    } catch (error) {
      if (['USAGE_LIMIT', 'SERVICE_COOLDOWN', 'SERVICE_UNREACHABLE', 'SERVICE_UNAVAILABLE', 'PROVIDER_UNREACHABLE'].includes(error.message)) {
        error.retryAfterMs = await budget.pause();
      }
      throw error;
    }
  } finally { active.delete(controller); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message, sender).then(result => reply({ ok: true, ...result }))
    .catch(error => reply({ ok: false, error: error.message || 'UNKNOWN_ERROR',
      ...(Number.isFinite(error.retryAfterMs) ? { retryAfterMs: error.retryAfterMs } : {}) }));
  return true;
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !('enabled' in changes || 'consentVersion' in changes || 'localImageCheck' in changes)) return;
  settingsRevision++;
  for (const controller of active) controller.abort();
  local.cancel();
  try { await (await ready).client.clear(); } catch { /* No external requests. */ }
  await notifyConfig();
});
