// Bounded long polls carry revision hints only. The API rechecks the session and
// budget ownership before returning a hint or letting a client fetch a snapshot.
export function createBudgetChanges({ timeoutMs = 15000, maxPerUser = 8, maxTotal = 256 } = {}) {
  const waiting = new Set();
  return {
    wait(userId, budgetId, signal) {
      if (waiting.size >= maxTotal || [...waiting].filter(item => item.userId === userId).length >= maxPerUser) {
        return Promise.resolve('busy');
      }
      return new Promise(resolve => {
        let timer;
        const item = { userId, budgetId, finish };
        function finish(reason) {
          if (!waiting.delete(item)) return;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          resolve(reason);
        }
        const abort = () => finish('closed');
        waiting.add(item);
        timer = setTimeout(() => finish('timeout'), timeoutMs);
        timer.unref?.();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    },
    publish(userId, budgetId) {
      for (const item of waiting) if (item.userId === userId && item.budgetId === budgetId) item.finish('changed');
    },
    close() { for (const item of waiting) item.finish('closed'); },
  };
}
