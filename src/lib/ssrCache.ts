import { currentTenantHost } from "@/lib/http/requestHost";
import type { EdgeTtlL2Adapter, EdgeTtlL2Snapshot } from "@/lib/ssrCacheL2.server";

type CacheEntry<T> = { at: number; data: T };

const store = new Map<string, CacheEntry<unknown>>();

// Hard cap on distinct cache entries per isolate. The store is keyed by
// host::key, so multi-tenant hosts x per-slug/per-variant keys make the key
// space effectively unbounded; expired entries are only overwritten when their
// exact key is re-fetched, never evicted otherwise. Without a cap the Map grows
// for the whole isolate lifetime -> memory climbs until workerd OOM-kills the
// isolate, taking every route down (the same "one fault, whole site" failure
// class this file's SSR sits behind). Map preserves insertion order, so evicting
// `keys().next().value` drops the oldest entry (approx-LRU, good enough for a
// warm-read cache).
const MAX_ENTRIES = 500;

// Okno serve-stale: po upływie ttlMs wpis jest serwowany NATYCHMIAST, a
// odświeżenie biegnie w tle (ten sam wzorzec, co katalog tenantów w
// tenant.server.ts i indeks przekierowań w redirects.server.ts). Bez tego
// pierwsze żądanie po wygaśnięciu TTL blokowało render SSR na pełnym
// round-tripie do Supabase - a że loader roota rozgrzewa kilka kluczy z tym
// samym TTL naraz, zimny render płacił kilka takich round-tripów w stosie.
// Powyżej STALE_FACTOR x ttlMs wracamy do blokującego fetcha, żeby rzadko
// odwiedzane klucze nie serwowały dowolnie starych danych.
const STALE_FACTOR = 5;

// ── Warstwa L2 (migawka w Cache API per-colo, `ssrCacheL2.server.ts`) ──────
//
// L1 znika z każdą rotacją izolatu, więc klucze decydujące o pierwszym bajcie
// każdej trasy były odbudowywane z bazy na każdym zimnym izolacie - także w
// kolonii z ciepłym L2 dokumentów (audyt CWV 2026-09-20, F03 / plan 1.3).
// L2 jest OPCJONALNE i ograniczone do anonimowych, publicznych, tenant-scoped
// odczytów z białej listy niżej: wartość w Cache API jest współdzielona przez
// wszystkie izolaty kolonii, więc nie ma tam prawa trafić nic, co zależy od
// sesji albo od użytkownika. Kontrakt `edgeTtlCache(key, ttlMs, fn)` bez zmian.

/**
 * Prefiksy kluczy, które wolno składować w L2. Świadomie WĄSKA lista kluczy
 * anonimowych, publicznych, rozgrzewanych w loaderze roota na każdej trasie
 * (ustawienia, tokeny motywu, menu, ticker, tryb/strona główna, rezolucja
 * ścieżki treści - zawsze projekcja anonimowa, body gated = null). Rozszerzenie
 * = dopisanie prefiksu tutaj albo `{ l2: true }` w opcjach wywołania; klucze
 * spoza listy nie dotykają L2 (ani odczytu, ani zapisu).
 */
export const EDGE_TTL_L2_KEY_PREFIXES: readonly string[] = [
  "site_settings_public:",
  "site_design_tokens:",
  "menu-with-items:",
  "trending_posts:",
  "public:home-",
  "public:resolved:",
];

/**
 * Sufit rozmiaru migawki (~512 KB JSON, mierzone w jednostkach kodu UTF-16 -
 * dla treści nie-ASCII zaniża bajty, ale to strażnik przed wartością
 * patologiczną, nie kwota). Cache API przyjmuje dużo więcej, ale każda migawka
 * jest serializowana w tle na CPU izolatu przy KAŻDYM zapisie i deserializowana
 * na ścieżce pierwszego bajtu przy każdym chybieniu L1; wartości rzędu
 * megabajtów (np. rezolucja strony z osadzonym builderem) kosztowałyby na tej
 * ścieżce więcej, niż oszczędza round-trip do bazy.
 */
export const EDGE_TTL_L2_MAX_BYTES = 512 * 1024;

/**
 * Termin odczytu L2 na chybieniu L1. Cache API w kolonii odpowiada w
 * pojedynczych ms; jeśli zwleka, czekanie na migawkę opóźniałoby TĘ SAMĄ falę
 * round-tripów, którą miało zastąpić - po terminie idziemy do `fn()` jak dotąd,
 * a spóźniony wynik jest ignorowany.
 */
export const EDGE_TTL_L2_READ_TIMEOUT_MS = 150;

export interface EdgeTtlCacheOptions {
  /**
   * Nadpisanie białej listy: `true` włącza L2 dla klucza spoza listy, `false`
   * wyłącza je dla klucza z listy. Domyślnie decyduje `EDGE_TTL_L2_KEY_PREFIXES`.
   */
  l2?: boolean;
}

// Single-flight: równoległe żądania tego samego klucza (normalny stan świeżo
// wystartowanego izolatu - każdy root loader rozgrzewa te same ustawienia)
// dzielą JEDEN fetch zamiast N identycznych round-tripów. Lot niesie swoją
// generację: żądanie złożone PO invalidacji nie może dołączyć do fetcha
// rozpoczętego przed nią (dostałoby sprzed-operatorskie dane, mimo że zapis
// do magazynu byłby odrzucony).
const inFlight = new Map<string, { gen: number; promise: Promise<unknown> }>();

// Klucze, których odświeżenie w tle już biegnie - drugi stale-hit nie
// startuje drugiego fetcha.
const refreshing = new Set<string>();

// Klucze unieważnione przez operatora W TYM izolacie, których najbliższe
// chybienie ma ominąć odczyt L2. Bez tego `invalidateEdgeTtlCache` kasowałoby
// wpis L1 tylko po to, by następny odczyt wciągnął TĘ SAMĄ wartość z migawki
// kolonii - a kontrakt „akcja operatora widoczna od razu w tej samej sesji"
// przestałby być prawdą. Wpis znika, gdy świeży fetch nadpisze L1 (i L2).
const l2Bypass = new Set<string>();

// Strażnik generacji: invalidateEdgeTtlCache podbija generację, więc fetch
// rozpoczęty PRZED unieważnieniem nie może zapisać sprzed-operatorskich danych
// ze świeżym znacznikiem czasu (kontrakt "akcja operatora widoczna od razu").
let generation = 0;

/**
 * Zapis do L1. `at` domyślnie „teraz"; wpis zasilony z migawki L2 dostaje
 * ORYGINALNY znacznik migawki, żeby świeżość liczyła się od pobrania z bazy,
 * a nie od odczytu z kolonii (inaczej 50-sekundowa migawka zyskiwałaby drugie
 * 60 s świeżości). Zwraca, czy zapis przeszedł strażnika generacji.
 */
function storeEntry(
  scopedKey: string,
  data: unknown,
  genAtFetchStart: number,
  at: number = Date.now(),
): boolean {
  if (genAtFetchStart !== generation) return false;
  // Refresh insertion order (so a re-fetched hot key is treated as recent) and
  // enforce the cap by evicting the oldest entries.
  store.delete(scopedKey);
  store.set(scopedKey, { at, data });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return true;
}

// Dokończenie odświeżenia za odpowiedzią: na Workers rejestrujemy pracę w
// ctx.waitUntil (inaczej workerd może ubić izolat w połowie fetcha), poza
// Workers moduł degraduje do fire-and-forget. Import dynamiczny, bo ten plik
// jest współdzielony z klientem - statyczna krawędź wciągnęłaby moduł .server
// do chunku wejściowego przeglądarki.
function completeAfterResponse(work: Promise<unknown>): void {
  void import("@/lib/http/waitUntil.server")
    .then((m) => m.runAfterResponse(work))
    .catch(() => undefined);
}

// ── Adapter L2 ─────────────────────────────────────────────────────────────
//
// `undefined` = jeszcze nie rozwiązany, `null` = brak (klient, vitest bez
// wstrzyknięcia, błąd importu). Rozwiązanie biegnie WYŁĄCZNIE za bramką
// `import.meta.env.SSR`, którą Vite podmienia statycznie: w bundlu klienta
// gałąź z `import()` jest martwa i znika razem z grafem server-only (Cache API,
// `process.env`) - ten sam wzorzec, co `currentTenantHost` w requestHost.ts.
// Pod vitestem `import.meta.env.SSR` jest fałszem, więc testy wstrzykują
// adapter jawnie przez `setEdgeTtlL2Adapter`.
let l2Adapter: EdgeTtlL2Adapter | null | undefined;
let l2AdapterLoading: Promise<EdgeTtlL2Adapter | null> | null = null;

/**
 * Wstrzyknięcie adaptera L2 (testy, alternatywne wejścia serwera). `null`
 * wyłącza L2 na stałe w tym izolacie, `undefined` przywraca rozwiązywanie
 * dynamiczne.
 */
export function setEdgeTtlL2Adapter(adapter: EdgeTtlL2Adapter | null | undefined): void {
  l2Adapter = adapter;
  l2AdapterLoading = null;
}

function resolveL2Adapter(): Promise<EdgeTtlL2Adapter | null> {
  if (l2Adapter !== undefined) return Promise.resolve(l2Adapter);
  if (!import.meta.env.SSR) {
    l2Adapter = null;
    return Promise.resolve(null);
  }
  l2AdapterLoading ??= import("@/lib/ssrCacheL2.server")
    .then((m) => (l2Adapter = m.edgeTtlL2Adapter))
    .catch(() => (l2Adapter = null));
  return l2AdapterLoading;
}

function l2Allowed(key: string, opts: EdgeTtlCacheOptions | undefined): boolean {
  if (opts?.l2 !== undefined) return opts.l2;
  return EDGE_TTL_L2_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Odczyt migawki z własnym terminem. Rozstrzyga się pierwszy: wynik, błąd
 * (= brak) albo zegar (= brak). Spóźniony wynik jest ignorowany - lot i tak
 * poszedł już do `fn()`, a zapis świeżej wartości nadpisze migawkę.
 */
function readL2WithTimeout<T>(
  adapter: EdgeTtlL2Adapter,
  scope: string,
  key: string,
  ttlMs: number,
): Promise<EdgeTtlL2Snapshot<T> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (snapshot: EdgeTtlL2Snapshot<T> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(snapshot);
    };
    const timer = setTimeout(() => finish(null), EDGE_TTL_L2_READ_TIMEOUT_MS);
    adapter.read<T>(scope, key, ttlMs, ttlMs * STALE_FACTOR).then(finish, () => finish(null));
  });
}

/**
 * Wartości, których w L2 być nie może: `undefined`/`null` (chybienie i „nie
 * znaleziono" zostają per izolat - kolonia nie ma utrwalać 404), wartości
 * nieserializowalne (cykle, BigInt) i większe niż `EDGE_TTL_L2_MAX_BYTES`.
 * Wyniki z błędu nigdy tu nie docierają - `fn()` rzuca, zanim cokolwiek
 * zostanie zapisane.
 */
function l2Storable(data: unknown): boolean {
  if (data === undefined || data === null) return false;
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" && json.length <= EDGE_TTL_L2_MAX_BYTES;
  } catch {
    return false;
  }
}

/**
 * Zapis L1 świeżo pobranej wartości + zapis migawki L2 w tle. Oba noszą TEN
 * SAM znacznik `at`, żeby izolat, który za chwilę wstanie z tej migawki,
 * liczył świeżość od tego samego momentu, co ten, który ją pobrał.
 */
function persistFetched(
  scopedKey: string,
  scope: string,
  key: string,
  data: unknown,
  genAtFetchStart: number,
  ttlMs: number,
  l2: EdgeTtlL2Adapter | null,
): void {
  const at = Date.now();
  if (!storeEntry(scopedKey, data, genAtFetchStart, at)) return;
  // Świeży fetch nadpisał L1 - od teraz migawka kolonii wolno znów zasilać
  // ten klucz (zapis niżej ją odświeży albo zostawi wygasającą TTL-em).
  l2Bypass.delete(scopedKey);
  if (l2 && l2Storable(data)) {
    completeAfterResponse(
      l2.write(scope, key, { at, value: data }, ttlMs, ttlMs * STALE_FACTOR).catch(() => undefined),
    );
  }
}

/**
 * Odświeżenie w tle (serve-stale). Fetcher startuje SYNCHRONICZNIE, jeszcze
 * wewnątrz żądania - kontekst AsyncLocalStorage (host tenanta, nagłówki)
 * wiąże się w momencie wywołania, nie w kontynuacji po odpowiedzi. Praca jest
 * rejestrowana „za odpowiedzią" (waitUntil) - patrz `completeAfterResponse`.
 */
function startBackgroundRefresh<T>(
  scopedKey: string,
  scope: string,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  l2: EdgeTtlL2Adapter | null,
): void {
  if (refreshing.has(scopedKey)) return;
  refreshing.add(scopedKey);
  const genAtFetchStart = generation;
  const refresh = fetcher()
    .then((data) => persistFetched(scopedKey, scope, key, data, genAtFetchStart, ttlMs, l2))
    // Błąd odświeżenia: wpis nieświeży zostaje (kolejny stale-hit spróbuje
    // ponownie); praca w tle jest zawsze best-effort.
    .catch(() => undefined)
    .finally(() => refreshing.delete(scopedKey));
  completeAfterResponse(refresh);
}

/**
 * Tiny per-isolate SSR/edge TTL cache for anonymous public data. TanStack
 * QueryClient is intentionally request-scoped, so this keeps slow, shared
 * reads warm across page requests without leaking user state.
 *
 * TENANT SCOPE: every entry is transparently keyed by the request host, so a
 * cache warmed while rendering tenant A's domain can never be served on
 * tenant B's domain. Callers keep passing plain keys - the scoping cannot be
 * forgotten at a call site because it happens here, by construction. Requests
 * without a resolvable host (background work) share the "no-host" scope,
 * which matches the database's default-tenant fallback.
 *
 * FRESHNESS MODEL: fresh hit (< ttlMs) -> cached data; stale hit
 * (< STALE_FACTOR x ttlMs) -> cached data natychmiast + odświeżenie w tle
 * (single-flight per klucz, dokończone przez waitUntil); zimny/twardo
 * wygasły miss -> blokujący fetch dzielony przez równoległe żądania.
 *
 * L2 (klucze z `EDGE_TTL_L2_KEY_PREFIXES`, tylko SSR na Workers): na chybieniu
 * L1 najpierw migawka kolonii z terminem `EDGE_TTL_L2_READ_TIMEOUT_MS` -
 * świeża zasila L1 i wraca bez `fn()`; nieświeża (< STALE_FACTOR x ttlMs)
 * wraca NATYCHMIAST, a `fn()` odświeża L1 i L2 w tle; brak/termin -> `fn()`
 * jak dotąd, a wynik ląduje w L1 od razu i w L2 za odpowiedzią. Poza Workers
 * L2 jest no-op z konstrukcji (`ssrCacheL2.server.ts`).
 */
export async function edgeTtlCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts?: EdgeTtlCacheOptions,
): Promise<T> {
  if (typeof window !== "undefined") return fetcher();
  const scope = (await currentTenantHost()) ?? "no-host";
  const scopedKey = `${scope}::${key}`;
  const now = Date.now();
  const cached = store.get(scopedKey) as CacheEntry<T> | undefined;
  const age = cached ? now - cached.at : Number.POSITIVE_INFINITY;
  if (cached && age < ttlMs) return cached.data;

  const l2Wanted = l2Allowed(key, opts);

  if (cached && age < ttlMs * STALE_FACTOR) {
    // Serve-stale + refresh-behind. Odświeżenie zapisuje też L2, żeby migawka
    // kolonii nie starzała się szybciej niż L1 izolatu, który ją odnawia.
    const l2 = l2Wanted ? await resolveL2Adapter() : null;
    startBackgroundRefresh(scopedKey, scope, key, ttlMs, fetcher, l2?.enabled() ? l2 : null);
    return cached.data;
  }

  // Zimny miss albo twarde wygaśnięcie: single-flight obejmuje CAŁY lot
  // (odczyt L2 + ewentualny fetch), więc równoległe chybienia dzielą jedną
  // migawkę albo jeden round-trip.
  const pending = inFlight.get(scopedKey);
  if (pending && pending.gen === generation) return pending.promise as Promise<T>;
  const genAtFetchStart = generation;
  const flight = (async (): Promise<T> => {
    const adapter = l2Wanted ? await resolveL2Adapter() : null;
    const l2 = adapter?.enabled() ? adapter : null;
    if (l2 && !l2Bypass.has(scopedKey)) {
      const snapshot = await readL2WithTimeout<T>(l2, scope, key, ttlMs);
      if (snapshot) {
        storeEntry(scopedKey, snapshot.value, genAtFetchStart, snapshot.at);
        // Nieświeża migawka: serwuj od ręki, odświeżenie (L1 + L2) w tle -
        // ta sama decyzja, którą L1 podejmuje dla własnego wpisu po TTL.
        if (snapshot.stale) startBackgroundRefresh(scopedKey, scope, key, ttlMs, fetcher, l2);
        return snapshot.value;
      }
    }
    const data = await fetcher();
    persistFetched(scopedKey, scope, key, data, genAtFetchStart, ttlMs, l2);
    return data;
  })().finally(() => {
    // Nowszy lot (po invalidacji) mógł nadpisać wpis - kasujemy tylko SWÓJ.
    const current = inFlight.get(scopedKey);
    if (current && current.promise === flight) inFlight.delete(scopedKey);
  });
  inFlight.set(scopedKey, { gen: genAtFetchStart, promise: flight });
  return flight;
}

/**
 * Drop one entry for the CURRENT request host. Best-effort by design: the
 * store is per-isolate, so a write handled by isolate A cannot expire isolate
 * B's copy - the TTL still bounds staleness everywhere. Use it where an
 * operator action must be visible immediately in the same session (e.g. the
 * donations reconciliation button), not as a correctness mechanism.
 *
 * Podbicie generacji unieważnia także fetche W LOCIE (tło i single-flight):
 * ich wynik nie zostanie zapisany, więc wyścig "stary fetch nadpisuje świeżo
 * unieważniony wpis" jest niemożliwy z konstrukcji.
 *
 * L2: najbliższe chybienie tego klucza w TYM izolacie omija migawkę kolonii i
 * idzie do bazy, a świeży wynik nadpisuje migawkę - inne izolaty kolonii
 * doganiają ją na swoim najbliższym chybieniu L1 (jak dotąd TTL-em).
 */
export async function invalidateEdgeTtlCache(key: string): Promise<void> {
  if (typeof window !== "undefined") return;
  const scope = (await currentTenantHost()) ?? "no-host";
  generation++;
  const scopedKey = `${scope}::${key}`;
  store.delete(scopedKey);
  l2Bypass.add(scopedKey);
}

/** Test hook: drop every cached entry (all host scopes). */
export function clearEdgeTtlCache(): void {
  generation++;
  store.clear();
  inFlight.clear();
  refreshing.clear();
  l2Bypass.clear();
}
