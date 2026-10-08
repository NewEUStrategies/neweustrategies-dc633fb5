import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { noteDocumentDegradation } from "@/lib/http/responseHeaders";
import { HOME_CHROME_LATE_BUDGET_MS } from "./homeSsrBudget";

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
  /**
   * Dogrzanie z WŁASNYM budżetem (ms), niezależnym od terminu dokumentu
   * (fala 3, P3.6b, R2c). Podaje je wyłącznie strona główna: tam `warm`
   * jest związane wspólnym terminem 600 ms, więc po jego minięciu niczego już
   * nie dogrzewa. Brak = dawne zachowanie (wyczerpany termin to `failed`
   * od ręki).
   */
  warmLate?: (budgetMs: number) => Promise<unknown>;
  settled?: boolean;
  promise?: Promise<void>;
}

// A QueryClient belongs to one SSR request. Never share a pending render,
// tenant's settings or a degradation flag between requests.
const warmups = new WeakMap<QueryClient, ChromeWarmup>();

/**
 * Chrome renderuje się na fallbackach: dokument `no-store` (`failed`) i etykieta
 * `chrome` w linii logu dokumentu (R7c, `degradedBy`).
 */
function markFailed(warmup: ChromeWarmup): void {
  warmup.markDegraded("failed");
  if (import.meta.env.SSR) noteDocumentDegradation("chrome");
}

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
    .catch(() => markFailed(warmup));
}

/**
 * Dogrzanie po `warm()` do końca budżetu bramki (P3.6b, R2c): gdy dane wciąż
 * nie są gotowe, a wołający podał `warmLate`, granica nagłówka czeka dalej,
 * ale najwyżej do `deadline` liczonego od pierwszego odczytu bramki.
 *
 * Czeka na GOTOWOŚĆ (`ready()`), nie na całą pracę: `warmLate` grzeje też
 * dekorację (reklama nagłówka), której klucz nie wchodzi do listy gotowości.
 * Gdy dane powłoki już są, wolna emisja nie trzyma nagłówka do końca budżetu -
 * jak na zwykłej ścieżce, gdzie bramka z gotowymi danymi w ogóle nie czeka.
 * Reszta pracy biegnie dalej w tle (`withBudget` po stronie wołającego).
 */
function lateWarm(client: QueryClient, record: ChromeWarmup, deadline: number): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (!record.warmLate || record.ready() || remaining <= 0) return Promise.resolve();
  const work = record.warmLate(remaining);
  let stop: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    stop = client.getQueryCache().subscribe(() => {
      if (record.ready()) resolve();
    });
    // Dane mogły dojść synchronicznie już w trakcie startu `warmLate`.
    if (record.ready()) resolve();
  });
  return Promise.race([work, ready]).finally(() => stop());
}

export function readChromeWarmup(client: QueryClient): void {
  const record = warmups.get(client);
  if (!record || record.ready() || record.settled) return;
  if (!record.promise) {
    // Headers must be conservative BEFORE the shell flushes - we cannot know
    // yet whether `warm()` will make it before the stream ends.
    const expired = record.expired();
    if (expired && !record.warmLate) {
      // Wyczerpany budżet dokumentu, a wołający nie ma dogrzania z własnym
      // budżetem: nikt już nie dogrzeje powłoki, więc render pójdzie na
      // fallbackach - to degradacja treści, nie samego chrome'u.
      markFailed(record);
      record.settled = true;
      return;
    }
    // Rozgrzewka biegnie dalej i nagłówek dostrumieniuje się do dokumentu:
    // KRÓTKA polityka wspólna, nie `no-store`. Jeśli `warm()` padnie, catch
    // niżej zaostrza intencję do `"failed"` - reguła scalania w
    // `setCacheControlHeader` gwarantuje, że `no-store` wygra także po flushu,
    // a odroczony zapis do NES Edge Cache sprawdza dyrektywę ponownie na końcu
    // strumienia (`applyDeferredDocumentStore`).
    //
    // STRONA GŁÓWNA (`warmLate`, P3.6b): wyczerpany wspólny termin nie oznacza
    // już `failed` od ręki. Granica nagłówka czeka najwyżej
    // `HOME_CHROME_LATE_BUDGET_MS` od tego odczytu (także wtedy, gdy `warm()`
    // skończyło się z resztką terminu, a danych nadal brak), pasek „Na czasie"
    // dostrumieniowuje się, a o zapisie dokumentu decyduje predykat
    // kompletności na końcu strumienia. Gdy po tym czasie dane wciąż nie są
    // gotowe, nagłówek renderuje się na fallbackach i dokument jest `failed`.
    record.markDegraded("chrome");
    const deadline = Date.now() + HOME_CHROME_LATE_BUDGET_MS;
    const first = expired ? Promise.resolve() : record.warm();
    record.promise = first
      .then(() => lateWarm(client, record, deadline))
      .then(
        () => {
          if (record.warmLate && !record.ready()) markFailed(record);
        },
        () => markFailed(record),
      )
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
