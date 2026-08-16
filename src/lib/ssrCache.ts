import { currentTenantHost } from "@/lib/http/requestHost";

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

// Strażnik generacji: invalidateEdgeTtlCache podbija generację, więc fetch
// rozpoczęty PRZED unieważnieniem nie może zapisać sprzed-operatorskich danych
// ze świeżym znacznikiem czasu (kontrakt "akcja operatora widoczna od razu").
let generation = 0;

function storeEntry(scopedKey: string, data: unknown, genAtFetchStart: number): void {
  if (genAtFetchStart !== generation) return;
  // Refresh insertion order (so a re-fetched hot key is treated as recent) and
  // enforce the cap by evicting the oldest entries.
  store.delete(scopedKey);
  store.set(scopedKey, { at: Date.now(), data });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
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
 */
export async function edgeTtlCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (typeof window !== "undefined") return fetcher();
  const scope = (await currentTenantHost()) ?? "no-host";
  const scopedKey = `${scope}::${key}`;
  const now = Date.now();
  const cached = store.get(scopedKey) as CacheEntry<T> | undefined;
  const age = cached ? now - cached.at : Number.POSITIVE_INFINITY;
  if (cached && age < ttlMs) return cached.data;

  if (cached && age < ttlMs * STALE_FACTOR) {
    // Serve-stale + refresh-behind. Fetcher startuje SYNCHRONICZNIE, jeszcze
    // wewnątrz żądania - kontekst AsyncLocalStorage (host tenanta, nagłówki)
    // wiąże się w momencie wywołania, nie w kontynuacji po odpowiedzi.
    if (!refreshing.has(scopedKey)) {
      refreshing.add(scopedKey);
      const genAtFetchStart = generation;
      const refresh = fetcher()
        .then((data) => storeEntry(scopedKey, data, genAtFetchStart))
        // Błąd odświeżenia: wpis nieświeży zostaje (kolejny stale-hit spróbuje
        // ponownie); praca w tle jest zawsze best-effort.
        .catch(() => undefined)
        .finally(() => refreshing.delete(scopedKey));
      completeAfterResponse(refresh);
    }
    return cached.data;
  }

  // Zimny miss albo twarde wygaśnięcie: blokujący fetch, single-flight.
  const pending = inFlight.get(scopedKey);
  if (pending && pending.gen === generation) return pending.promise as Promise<T>;
  const genAtFetchStart = generation;
  const flight = fetcher()
    .then((data) => {
      storeEntry(scopedKey, data, genAtFetchStart);
      return data;
    })
    .finally(() => {
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
 */
export async function invalidateEdgeTtlCache(key: string): Promise<void> {
  if (typeof window !== "undefined") return;
  const scope = (await currentTenantHost()) ?? "no-host";
  generation++;
  store.delete(`${scope}::${key}`);
}

/** Test hook: drop every cached entry (all host scopes). */
export function clearEdgeTtlCache(): void {
  generation++;
  store.clear();
  inFlight.clear();
  refreshing.clear();
}
