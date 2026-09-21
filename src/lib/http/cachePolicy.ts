// Cache-Control policy for SSR document responses. Pure + framework-free so it
// is fully unit-testable; the isomorphic setter in responseHeaders.ts applies
// the result on the server only.
//
// Before this, only sitemap.xml / robots.txt carried cache headers - every
// content page was re-rendered from scratch on every request, with no edge or
// browser caching. These policies turn the public site into an ISR-like setup:
// the CDN serves a cached render for `s-maxage`, then serves it stale (up to
// `stale-while-revalidate`) while revalidating in the background, so visitors
// almost never wait on a cold render.
import { parseCacheControl } from "./parseCacheControl";

export interface CacheControlInput {
  /** When false, the response must never be stored by a shared/browser cache. */
  cacheable: boolean;
  /** Browser freshness in seconds. Default 0 (revalidate via the shared cache). */
  browserMaxAge?: number;
  /** Shared/CDN freshness in seconds. */
  sharedMaxAge?: number;
  /** Window (seconds) a shared cache may serve a stale response while revalidating. */
  staleWhileRevalidate?: number;
}

/** Build a Cache-Control header value from a policy. */
export function cacheControlHeader(input: CacheControlInput): string {
  if (!input.cacheable) return "private, no-store";
  const parts = ["public", `max-age=${Math.max(0, Math.floor(input.browserMaxAge ?? 0))}`];
  if (input.sharedMaxAge != null)
    parts.push(`s-maxage=${Math.max(0, Math.floor(input.sharedMaxAge))}`);
  if (input.staleWhileRevalidate != null) {
    parts.push(`stale-while-revalidate=${Math.max(0, Math.floor(input.staleWhileRevalidate))}`);
  }
  return parts.join(", ");
}

// Defaults tuned for a content site: a tiny browser TTL (snappy back/forward
// without serving long-stale content from the user's own cache), shared/CDN
// freshness measured in minutes, and a full day of stale-while-revalidate.
//
// `s-maxage` addresses any shared cache in front of the app; the in-process
// NES Edge Cache (src/lib/http/documentCache.server.ts) independently CAPS
// its own freshness at DOCUMENT_CACHE_MAX_FRESH_MS (3 min) and is purged on
// publish, so a longer s-maxage here never delays editorial updates on the
// surface we control - browsers only ever see max-age (60 s).
export const PUBLIC_CONTENT_MAX_AGE = 60; // s, browser
export const PUBLIC_CONTENT_S_MAXAGE = 900; // s, CDN/edge
export const PUBLIC_CONTENT_SWR = 86400; // s, serve-stale window

export interface ContentCachePolicy {
  /** Personalized render (depends on the visitor's session) → never shared-cache. */
  personalized?: boolean;
  /** Editor / preview render → never cache. */
  preview?: boolean;
}

/**
 * Cache-Control for a public content document (home, post, page). The public
 * SSR output is the anonymous shell (session-specific UI hydrates on the
 * client and gated bodies are fetched client-side), so it is safe to share-
 * cache. Personalized or preview renders opt out entirely.
 *
 * Language is no longer a cacheability concern: it now lives in the URL path
 * (PL at the bare path, EN under `/en`), so the CDN keys each language as its
 * own entry. A content render is fully determined by its URL - there is no
 * cookie-driven, no-store path and no language cache-poisoning.
 */
export function contentCacheControl(policy: ContentCachePolicy = {}): string {
  if (policy.personalized || policy.preview) return cacheControlHeader({ cacheable: false });
  return cacheControlHeader({
    cacheable: true,
    browserMaxAge: PUBLIC_CONTENT_MAX_AGE,
    sharedMaxAge: PUBLIC_CONTENT_S_MAXAGE,
    staleWhileRevalidate: PUBLIC_CONTENT_SWR,
  });
}

/**
 * Degradacja WYŁĄCZNIE chrome'u (nagłówek/stopka/ticker), a nie TREŚCI.
 *
 * Do 2026-09-20 bramka `ChromeDataGate` (src/lib/ssr/chromeWarmup.tsx)
 * oznaczała dokument `private, no-store` ZAWSZE, gdy dane powłoki nie były
 * gotowe przy flushu shella - także wtedy, gdy `warm()` kończyło się
 * sukcesem i nagłówek dostrumieniowywał się poprawnie przez Suspense. Taki
 * dokument jest KOMPLETNY: kopia do L1/L2 zbiera się do końca strumienia
 * (`applyDeferredDocumentStore`), więc niesie już nagłówek - od czystego
 * renderu różni go tylko to, że nagłówek przyjechał w drugiej paczce. Wolno go
 * współdzielić, ale krótko: świeżość w sekundach, żeby czysty render (albo
 * rewalidacja w tle) szybko go zastąpił, i krótkie okno stale, żeby nikt nie
 * oglądał tej wersji kwadrans po publikacji. Skutek bez tej polityki: na
 * zimnym izolacie KAŻDY czytelnik płacił pełny render, a L1/L2 kolonii nie
 * rosło (audyt CWV 2026-09-20, F02).
 */
export const CHROME_DEGRADED_S_MAXAGE = 30; // s, CDN/edge
export const CHROME_DEGRADED_SWR = 300; // s, serve-stale window

/** Cache-Control dokumentu, którego chrome dostrumieniował się po flushu shella. */
export function chromeDegradedCacheControl(): string {
  return cacheControlHeader({
    cacheable: true,
    browserMaxAge: 0,
    sharedMaxAge: CHROME_DEGRADED_S_MAXAGE,
    staleWhileRevalidate: CHROME_DEGRADED_SWR,
  });
}

/**
 * Degradacja WARSTWY OPCJONALNEJ nad treścią, która w całości żyje w KODZIE.
 *
 * Dotyczy stron prawnych i statycznych (`LEGAL_SSR_BUDGET_MS`, `/support`):
 * tekst dokumentu stoi w słowniku/rejestrze w repozytorium, a z bazy dokłada
 * się wyłącznie DEKORACJA - nadpisania SEO z `/admin/pages` i opublikowana
 * wersja z `legal_documents`. Gdy baza nie odpowie, czytelnik dostaje
 * dokument KOMPLETNY, tylko niekanoniczny dla brzegu - dokładnie ta sama klasa
 * co degradacja chrome'u, więc i ta sama odpowiedź: KRÓTKA świeżość wspólna
 * z rewalidacją w tle (`chromeDegradedCacheControl`), a nie `no-store`.
 *
 * RÓŻNICA WOBEC `resilientCacheControl` (src/lib/ssr/resilientLoad.ts) jest
 * różnicą w tym, CZYM JEST FALLBACK, a nie w stopniu ostrożności:
 *   * tam fallback to KOMUNIKAT DEGRADACJI albo pusta powłoka (archiwa, trasy
 *     tożsamościowe, karta klubu) - dokument NIE NIESIE swojej treści, więc
 *     utrwalenie go na brzegu rozdaje awarię kolejnym czytelnikom i jedyną
 *     poprawną odpowiedzią jest `no-store`;
 *   * tutaj fallback to PEŁNA TREŚĆ z kodu - `no-store` nie chroniłby przed
 *     niczym, a kosztowałby pełny render każdego czytelnika przez cały czas
 *     trwania blipu bazy. Zmierzony skutek: w teście rozruchowym na artefakcie
 *     (poświadczenia zastępcze = każde zapytanie do bazy pada) drugie żądanie
 *     `/cookies` było MISS-em zamiast HIT-a, bo `no-store` z trasy zawężał
 *     (`narrowestCacheControl`) politykę całego dokumentu i
 *     `documentStorePolicy` nie zapisywała go wcale.
 */
export function staticFallbackCacheControl(
  degraded: boolean,
  cleanPolicy: string = contentCacheControl(),
): string {
  return degraded ? chromeDegradedCacheControl() : cleanPolicy;
}

/**
 * Scalenie dwóch intencji cache'owych JEDNEGO żądania - loadery (korzeń, trasa,
 * bramka chrome) biegną równolegle i każdy ustawia własną politykę, a wygrać
 * musi zawsze ta OSTRZEJSZA:
 *   1. `private` / `no-store` / `no-cache` wygrywa z każdą inną i nie da się
 *      go cofnąć (raz zdegradowany render nie staje się znów cache'owalny);
 *   2. między dwiema politykami `public` wygrywa MNIEJSZE `s-maxage` (brak
 *      `s-maxage` liczy się jak 0), a przy równym - mniejsze okno stale.
 *      Krótka świeżość ustawiona przez bramkę chrome nie może zostać
 *      PODNIESIONA przez późniejszy czysty loader trasy do 900 s;
 *   3. przy pełnym remisie zostaje wartość późniejsza.
 * Czysta funkcja: kolejność wywołań nie zmienia wyniku (poza remisem, gdzie
 * obie wartości są równoważne dla magazynu).
 */
export function narrowestCacheControl(previous: string | null | undefined, next: string): string {
  if (!previous) return next;
  const before = parseCacheControl(previous);
  if (before.private || before.noStore || before.noCache) return previous;
  const after = parseCacheControl(next);
  if (after.private || after.noStore || after.noCache) return next;
  const beforeFresh = before.sMaxAge ?? 0;
  const afterFresh = after.sMaxAge ?? 0;
  if (afterFresh !== beforeFresh) return afterFresh < beforeFresh ? next : previous;
  const beforeSwr = before.staleWhileRevalidate ?? 0;
  const afterSwr = after.staleWhileRevalidate ?? 0;
  if (afterSwr !== beforeSwr) return afterSwr < beforeSwr ? next : previous;
  return next;
}
