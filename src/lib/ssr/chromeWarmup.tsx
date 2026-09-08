import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

interface ChromeWarmup {
  ready: () => boolean;
  warm: () => Promise<unknown>;
  expired: () => boolean;
  markDegraded: () => void;
  settled?: boolean;
  promise?: Promise<void>;
}

// A QueryClient belongs to one SSR request. Never share a pending render,
// tenant's settings or a degradation flag between requests.
const warmups = new WeakMap<QueryClient, ChromeWarmup>();

export function registerChromeWarmup(client: QueryClient, warmup: ChromeWarmup): void {
  warmups.set(client, warmup);
  // Begin while sibling loaders run, without putting decoration on the root
  // loader's critical path. The serialization sweep may cancel these queries;
  // the render gate below can restart them safely after that sweep.
  void warmup.warm().catch(warmup.markDegraded);
}

export function readChromeWarmup(client: QueryClient): void {
  const record = warmups.get(client);
  if (!record || record.ready() || record.settled) return;
  if (!record.promise) {
    // Headers must be conservative BEFORE the shell flushes. A cold chrome
    // boundary can still exhaust its budget later; that document is no-store.
    record.markDegraded();
    if (record.expired()) {
      record.settled = true;
      return;
    }
    record.promise = record
      .warm()
      .catch(record.markDegraded)
      .then(() => {
        record.settled = true;
      });
  }
  throw record.promise;
}

/** Uses the Header/Footer Suspense boundary; the route's content is a sibling
 * and can flush immediately. Both hydration trees keep the same wrapper.
 */
export function ChromeDataGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  if (import.meta.env.SSR) readChromeWarmup(client);
  return <>{children}</>;
}
