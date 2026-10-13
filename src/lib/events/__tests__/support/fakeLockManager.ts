// Działająca atrapa Web Locks (`navigator.locks`) - happy-dom zwraca `null`.
//
// Odtwarza wyłącznie to, czego używa `scannerRuntimeLock.ts`: blokady
// wyłączne po nazwie, kolejkę oczekujących i `ifAvailable` (wywołanie zwrotne
// dostaje `null`, gdy blokadę trzyma ktoś inny). Jedna atrapa = jeden origin -
// wszystkie „karty" testu dzielą ją jak prawdziwe karty jednej przeglądarki.

type Callback = (lock: { name: string; mode: "exclusive" } | null) => unknown;

export interface FakeLockManager {
  request: (name: string, optionsOrCallback: unknown, maybeCallback?: Callback) => Promise<unknown>;
  /** Nazwy blokad trzymanych w tej chwili. */
  held: () => string[];
}

export function createFakeLockManager(): FakeLockManager {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();

  const release = (name: string) => {
    held.delete(name);
    const next = waiting.get(name)?.shift();
    if (next !== undefined) next();
  };

  const grant = (name: string, callback: Callback): Promise<unknown> => {
    held.add(name);
    return Promise.resolve()
      .then(() => callback({ name, mode: "exclusive" }))
      .finally(() => release(name));
  };

  return {
    request: (name, optionsOrCallback, maybeCallback) => {
      const callback = (
        typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
      ) as Callback;
      const options =
        typeof optionsOrCallback === "object" && optionsOrCallback !== null
          ? (optionsOrCallback as { ifAvailable?: boolean })
          : {};
      if (!held.has(name)) return grant(name, callback);
      if (options.ifAvailable === true) return Promise.resolve().then(() => callback(null));
      return new Promise((resolve, reject) => {
        const queue = waiting.get(name) ?? [];
        queue.push(() => void grant(name, callback).then(resolve, reject));
        waiting.set(name, queue);
      });
    },
    held: () => [...held],
  };
}

/** Podmienia `navigator.locks` na atrapę; zwraca funkcję przywracającą. */
export function installFakeLockManager(locks: FakeLockManager): () => void {
  Object.defineProperty(window.navigator, "locks", { configurable: true, get: () => locks });
  return () => {
    delete (window.navigator as unknown as Record<string, unknown>).locks;
  };
}
