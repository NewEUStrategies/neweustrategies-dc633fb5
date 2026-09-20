import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Rodzaj degradacji zgłaszany przez bramkę chrome:
 *   - `"chrome"`: dane powłoki NIE były gotowe przy flushu shella, ale
 *     rozgrzewka biegnie i nagłówek dostrumieniuje się przez Suspense. Dokument
 *     będzie KOMPLETNY - wolno go współdzielić krótko
 *     (`chromeDegradedCacheControl`, s-maxage=30);
 *   - `"failed"`: `warm()` faktycznie zawiodło albo budżet dokumentu jest
 *     wyczerpany (`expired()`) - powłoka renderuje się na fallbackach i taki
 *     dokument NIE MOŻE trafić do wspólnego cache'a (`private, no-store`).
 *
 * Do 2026-09-20 bramka nie rozróżniała tych przypadków i oznaczała `no-store`
 * przy każdym pierwszym odczycie bez gotowych danych, więc zdegradowany MISS
 * nigdy nie zasiewał L1/L2 (audyt CWV, F02).
 */
export type ChromeDegradation = "chrome" | "failed";

interface ChromeWarmup {
  ready: () => boolean;
  warm: () => Promise<unknown>;
  expired: () => boolean;
  /**
   * Bez argumentu = `"chrome"`. Implementacja korzenia, która ignoruje
   * argument i zawsze ustawia `no-store`, zachowuje dawne, konserwatywne
   * zachowanie - rozróżnienie włącza się dopiero po zmapowaniu rodzaju.
   */
  markDegraded: (kind?: ChromeDegradation) => void;
  settled?: boolean;
  promise?: Promise<void>;
}

// A QueryClient belongs to one SSR request. Never share a pending render,
// tenant's settings or a degradation flag between requests.
const warmups = new WeakMap<QueryClient, ChromeWarmup>();

export function registerChromeWarmup(client: QueryClient, warmup: ChromeWarmup): Promise<void> {
  warmups.set(client, warmup);
  // Begin while sibling loaders run. The caller can await this bounded work
  // to include navigation in the first shell. If it does not, the serialization
  // sweep may cancel queries; the render gate can restart them safely.
  //
  // `.catch(warmup.markDegraded)` przekazywałoby BŁĄD jako `kind` - stąd jawna
  // lambda: awaria rozgrzewki to zawsze `"failed"`.
  return warmup
    .warm()
    .then(() => undefined)
    .catch(() => warmup.markDegraded("failed"));
}

export function readChromeWarmup(client: QueryClient): void {
  const record = warmups.get(client);
  if (!record || record.ready() || record.settled) return;
  if (!record.promise) {
    // Headers must be conservative BEFORE the shell flushes - we cannot know
    // yet whether `warm()` will make it before the stream ends.
    if (record.expired()) {
      // Wyczerpany budżet dokumentu: nikt już nie dogrzeje powłoki, więc render
      // pójdzie na fallbackach - to degradacja treści, nie samego chrome'u.
      record.markDegraded("failed");
      record.settled = true;
      return;
    }
    // Rozgrzewka biegnie dalej i nagłówek dostrumieniuje się do dokumentu:
    // KRÓTKA polityka wspólna, nie `no-store`. Jeśli `warm()` padnie, catch
    // niżej zaostrza intencję do `"failed"` - reguła scalania w
    // `setCacheControlHeader` gwarantuje, że `no-store` wygra także po flushu,
    // a odroczony zapis do NES Edge Cache sprawdza dyrektywę ponownie na końcu
    // strumienia (`applyDeferredDocumentStore`).
    record.markDegraded("chrome");
    record.promise = record
      .warm()
      .catch(() => record.markDegraded("failed"))
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
