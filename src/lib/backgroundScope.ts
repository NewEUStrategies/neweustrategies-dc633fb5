/** Owns lazy background services for one mounted effect. */
export function createBackgroundScope(
  report: (error: unknown) => void = (error) => console.warn("Background service failed", error),
) {
  let disposed = false;
  const cleanups = new Set<() => void>();
  return {
    async run<T>(module: Promise<T>, start: (module: T) => void | (() => void)): Promise<void> {
      try {
        const loaded = await module;
        if (disposed) return;
        const cleanup = start(loaded);
        if (cleanup) cleanups.add(cleanup);
      } catch (error) {
        if (!disposed) report(error);
      }
    },
    dispose(): void {
      disposed = true;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (error) {
          report(error);
        }
      }
      cleanups.clear();
    },
  };
}
