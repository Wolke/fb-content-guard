// Only the extension-owned model page can attach. No model text is trusted as a decision.
export function createLocalBridge({ runtime, onReady = () => {}, timeoutMs = 125000 }) {
  let port, ready = false;
  const pending = new Map();
  const unavailable = () => Error('LOCAL_NOT_READY');
  function assertReady() { if (!port || !ready) throw unavailable(); }
  function cancel() {
    for (const job of pending.values()) job.finish(Error('LOCAL_CANCELLED'));
  }
  runtime.onConnect.addListener(candidate => {
    if (candidate.name !== 'local-model' || candidate.sender?.id !== runtime.id ||
        candidate.sender?.url !== runtime.getURL('local-ai.html')) return;
    if (port) { candidate.disconnect(); return; }
    port = candidate;
    candidate.onMessage.addListener(message => {
      if (port !== candidate) return;
      if (message.type === 'READY') { ready = true; onReady(); return; }
      if (message.type === 'EVENT') { const job = pending.get(message.id); if (job) job.onEvent({ ...message.event, stage: 'local' }); return; }
      if (message.type !== 'RESULT') return;
      const job = pending.get(message.id);
      if (!job) return;
      if (!message.ok || !['allow', 'block'].includes(message.decision)) {
        const known = ['LOCAL_UNCERTAIN', 'LOCAL_INVALID_RESPONSE', 'LOCAL_CONTEXT_OVERFLOW', 'LOCAL_TIMEOUT', 'LOCAL_BUSY'];
        job.finish(Error(known.includes(message.error) ? message.error : 'LOCAL_FAILED'));
      } else job.finish(null, { decision: message.decision });
    });
    candidate.onDisconnect.addListener(() => {
      if (port !== candidate) return;
      port = undefined; ready = false;
      for (const job of pending.values()) job.finish(unavailable());
    });
  });
  function classify(images, { signal, onEvent = () => {} } = {}) {
    assertReady();
    if (pending.size) throw Object.assign(Error('BUSY'), { retryAfterMs: 2000 });
    signal?.throwIfAborted();
    const current = port, id = crypto.randomUUID(), started = Date.now();
    return new Promise((resolve, reject) => {
      const abort = () => finish(Error('LOCAL_CANCELLED'));
      const timer = setTimeout(() => finish(Error('LOCAL_TIMEOUT')), timeoutMs);
      function finish(error, result) {
        if (!pending.delete(id)) return;
        onEvent({ stage: 'local', outcome: error ? 'error' : result.decision, ...(error ? { error: error.message } : {}), ms: Date.now() - started });
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) { try { current.postMessage({ type: 'CANCEL', id }); } catch {} reject(error); }
        else resolve(result);
      }
      pending.set(id, { finish, onEvent });
      onEvent({ stage: 'local', outcome: 'sent', images: images.length });
      signal?.addEventListener('abort', abort, { once: true });
      try { current.postMessage({ type: 'CLASSIFY', id, images }); }
      catch { finish(unavailable()); }
    });
  }
  return { assertReady, classify, cancel, isReady: () => Boolean(port && ready) };
}
