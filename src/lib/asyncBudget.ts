// Cap a best-effort async task by a wall-clock budget. Never rejects: the work
// is expected to already be internally allSettled/try/catched, so a budget
// race can never surface an unhandled error into an SSR loader chain.
//
// Shared between the builder-widget prefetch (aboveFold, cached route) and the
// content-loader `/$`/`category`/`author` prefetches so a single slow upstream
// (blocks_data, related config, ...) cannot hang a public SSR response.
export function withBudget(work: Promise<unknown>, ms: number, deadlineAt?: number): Promise<void> {
  if (deadlineAt !== undefined) {
    ms = Math.min(ms, deadlineAt - Date.now());
    if (ms <= 0) {
      void work.then(noop, noop);
      return Promise.resolve();
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) return work.then(noop, noop);
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const maybeUnref = timer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === "function") maybeUnref.unref();
    work.then(finish, finish);
  });
}

function noop() {}
