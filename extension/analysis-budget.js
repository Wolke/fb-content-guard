// One budget shared by all Facebook tabs. Only timestamps/counts are persisted.
export function createAnalysisBudget({ read, write, now = Date.now }) {
  const windowMs = 65000, limit = 15;
  let tail = Promise.resolve();
  const locked = fn => {
    const next = tail.catch(() => {}).then(async () => {
      const time = now(), stored = await read();
      const state = {
        events: (stored?.events || []).filter(e => Number.isFinite(e.at) && e.at > time - windowMs &&
          Number.isInteger(e.units) && e.units > 0 && e.units <= limit),
        until: Number.isFinite(stored?.until) ? stored.until : 0,
        failures: Number.isInteger(stored?.failures) ? Math.max(0, Math.min(6, stored.failures)) : 0
      };
      return fn(state, time);
    });
    tail = next;
    return next;
  };
  const waitError = delay => Object.assign(Error('WAITING_CAPACITY'), { retryAfterMs: Math.max(1000, delay) });
  const available = (state, time, units) => {
    if (!Number.isInteger(units) || units < 1 || units > 12) throw Error('INVALID_CONTENT');
    if (state.until > time) throw waitError(state.until - time);
    let used = state.events.reduce((sum, e) => sum + e.units, 0);
    if (used + units <= limit) return;
    for (const e of [...state.events].sort((a, b) => a.at - b.at)) {
      used -= e.units;
      if (used + units <= limit) throw waitError(e.at + windowMs - time);
    }
  };
  return {
    check: units => locked((state, time) => available(state, time, units)),
    reserve: units => locked(async (state, time) => {
      available(state, time, units);
      state.events.push({ at: time, units });
      await write(state);
    }),
    pause: () => locked(async (state, time) => {
      state.failures = Math.min(6, state.failures + 1);
      state.until = Math.max(state.until, time + Math.min(1800000, windowMs * 2 ** (state.failures - 1)));
      await write(state);
      return state.until - time;
    }),
    success: () => locked(async (state, time) => {
      // A request that was already in flight must not undo another request's cooldown.
      if (state.until > time) return;
      state.failures = 0;
      await write(state);
    })
  };
}
