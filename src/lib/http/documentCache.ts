// NES Edge Cache - polityka cache'owania CAŁYCH dokumentów SSR (HTML), czysta
// i wolna od frameworka, w 100% testowalna jednostkowo. Warstwa wykonawcza
// (magazyn per-isolate + middleware) żyje w `src/lib/http/documentCache.server.ts`.
//
// Dlaczego własny mechanizm: platforma nie zakłada CDN-a, który honoruje
// `s-maxage` dla text/html (Cloudflare domyślnie NIE cache'uje HTML). Ten moduł
// pozwala workerowi samemu odpowiadać z pamięci na anonimowe GET-y dokumentów -
// TTFB trafienia to mikrosekundy zamiast pełnego renderu SSR + odczytów bazy.
//
// Kontrakt bezpieczeństwa (spójny z resztą platformy):
//   - publiczny SSR to ANONIMOWA skorupa (sesja żyje w localStorage, treści
//     gated wydaje RPC `get_entity_content` po hydracji) - dokument jest
//     identyczny dla gościa i zalogowanego, więc współdzielenie jest bezpieczne;
//   - mimo to każde żądanie z `Authorization`/ciasteczkiem sesji Supabase jest
//     BYPASS-owane (pas i szelki - np. przyszłe SSR-owe ścieżki z sesją);
//   - klucz jest zawsze prefiksowany hostem żądania, więc wpis rozgrzany dla
//     tenanta A nigdy nie zostanie podany na domenie tenanta B (ta sama
//     doktryna co `edgeTtlCache` - scoping per tenant "by construction").
import { parseCacheControl } from "./parseCacheControl";

/** Marka mechanizmu - pojawia się w nagłówkach odpowiedzi i karcie admina. */
export const NES_EDGE_CACHE_NAME = "NES Edge Cache";
/** Nagłówek diagnostyczny: HIT | STALE | MISS | BYPASS. */
export const NES_CACHE_HEADER = "x-nes-cache";
/** Wiek serwowanego wpisu w sekundach (tylko HIT/STALE). */
export const NES_CACHE_AGE_HEADER = "x-nes-cache-age";

export type NesCacheStatus = "HIT" | "STALE" | "MISS" | "BYPASS";

/**
 * Górny pułap świeżości wpisu NIEZALEŻNY od `s-maxage` odpowiedzi. Nagłówek
 * `s-maxage` adresuje ewentualny zewnętrzny CDN (może być długi), ale nasz
 * cache in-memory nie ma między-izolatowego purge'a - krótka świeżość + długie
 * okno stale-while-revalidate dają błyskawiczne odpowiedzi przy publikacjach
 * widocznych w minuty, nie kwadranse.
 */
export const DOCUMENT_CACHE_MAX_FRESH_MS = 180_000;
/** Górny pułap okna serwowania stale (rewalidacja w tle single-flight). */
export const DOCUMENT_CACHE_MAX_SWR_MS = 6 * 60 * 60 * 1000;

/** Limit rozmiaru pojedynczego dokumentu (większe nie wchodzą do cache). */
export const DOCUMENT_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;
/** Budżet bajtów całego magazynu per isolate (approx-LRU eviction). */
export const DOCUMENT_CACHE_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

// Ścieżki, których dokumenty NIGDY nie są cache'owane: powierzchnie zalogowane,
// transakcyjne albo per-użytkownik. Prefiks bez języka - wołający normalizuje
// (patrz `stripLangPrefix`). Eksportowane, bo tę samą listę konsumuje generator
// Speculation Rules (prefetch/prerender omija dokładnie te same powierzchnie).
export const PUBLIC_DOCUMENT_DENY_PREFIXES = [
  "/admin",
  "/api",
  "/profile",
  "/messages",
  "/checkout",
  "/login",
  "/reset-password",
  "/newsletter",
  "/reading-list",
  "/people",
  "/network",
  "/preview",
  "/mcp",
  "/.well-known",
  "/_",
] as const;

// Parametry trackingowe kampanii: nie wpływają na render SSR (loadery tras
// publicznych czytają wyłącznie ścieżkę), więc są USUWANE z klucza - wizyta
// z `?utm_source=...` trafia w ten sam wpis co wizyta czysta.
const TRACKING_PARAM_PREFIXES = ["utm_"] as const;
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "msclkid", "ref", "mc_cid", "mc_eid"]);

// Parametry, które REALNIE różnicują dokument (paginacja/sortowanie archiwów)
// i dlatego wchodzą do klucza. Każdy inny nieznany parametr = BYPASS, żeby
// śmieciowe query-stringi nie zaśmiecały przestrzeni kluczy (eviction-DoS).
const KEYED_PARAMS = new Set(["page", "sort"]);

/** Usuwa prefiks języka - PL żyje na gołej ścieżce, EN pod `/en`. */
export function stripLangPrefix(pathname: string): string {
  if (pathname === "/en") return "/";
  return pathname.startsWith("/en/") ? pathname.slice(3) : pathname;
}

function isDeniedPath(pathname: string): boolean {
  const bare = stripLangPrefix(pathname);
  return PUBLIC_DOCUMENT_DENY_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`));
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

export type DocumentCachePlan =
  | { kind: "bypass"; reason: "method" | "auth" | "path" | "query" }
  | { kind: "lookup"; key: string };

/**
 * Minimalny wycinek Request, od którego zależy polityka. Zawężenie jest
 * celowe: (1) dokumentuje pełną powierzchnię decyzji, (2) pozwala testować
 * bez konstruktora Request przeglądarki, który wycina "zakazane" nagłówki
 * (cookie) i uniemożliwiłby test ścieżki auth-bypass.
 */
export type DocumentCacheRequest = Pick<Request, "method" | "url"> & {
  headers: Pick<Headers, "get">;
};

/**
 * Decyzja per żądanie: BYPASS albo lookup pod stabilnym kluczem
 * `host::pathname?keyedParams`. Czysta funkcja - łatwa do testowania.
 */
export function planDocumentCache(
  request: DocumentCacheRequest,
  host: string | null,
): DocumentCachePlan {
  if (request.method !== "GET") return { kind: "bypass", reason: "method" };
  if (request.headers.get("authorization")) return { kind: "bypass", reason: "auth" };
  const cookie = request.headers.get("cookie") ?? "";
  // Supabase przechowuje sesję w localStorage (nie w cookie), ale gdyby
  // kiedykolwiek pojawiło się ciasteczko sesyjne `sb-*`, dokument przestaje
  // być anonimowy - fail-safe w stronę BYPASS.
  if (/(?:^|;\s*)sb-[^=]*=/.test(cookie)) return { kind: "bypass", reason: "auth" };

  const url = new URL(request.url);
  const { pathname } = url;
  // Zasoby z rozszerzeniem (xml/txt/js/obrazy) mają własne polityki cache -
  // ten mechanizm celuje wyłącznie w nawigacyjne dokumenty HTML.
  if (/\.[a-z0-9]+$/i.test(pathname)) return { kind: "bypass", reason: "path" };
  if (isDeniedPath(pathname)) return { kind: "bypass", reason: "path" };

  const kept: Array<[string, string]> = [];
  for (const [name, value] of url.searchParams.entries()) {
    if (isTrackingParam(name)) continue;
    if (!KEYED_PARAMS.has(name.toLowerCase())) return { kind: "bypass", reason: "query" };
    kept.push([name.toLowerCase(), value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = kept.map(([k, v]) => `${k}=${v}`).join("&");
  const scope = host ?? "no-host";
  return { kind: "lookup", key: `${scope}::${pathname}${query ? `?${query}` : ""}` };
}

export interface StorePolicy {
  store: boolean;
  freshMs: number;
  swrMs: number;
}

const NO_STORE: StorePolicy = { store: false, freshMs: 0, swrMs: 0 };

/**
 * Decyzja per odpowiedź: do cache trafiają wyłącznie pełne (200) dokumenty
 * HTML, które SAME zadeklarowały współdzielenie (`public` + `s-maxage>0` -
 * dokładnie to emituje `contentCacheControl()`; rendery personalized/preview
 * wysyłają `private, no-store` i naturalnie tu odpadają).
 */
export function documentStorePolicy(
  status: number,
  contentType: string | null,
  cacheControl: string | null,
): StorePolicy {
  if (status !== 200) return NO_STORE;
  if (!contentType || !contentType.includes("text/html")) return NO_STORE;
  const cc = parseCacheControl(cacheControl);
  if (!cc.public || cc.noStore || cc.private) return NO_STORE;
  if (!cc.sMaxAge || cc.sMaxAge <= 0) return NO_STORE;
  return {
    store: true,
    freshMs: Math.min(cc.sMaxAge * 1000, DOCUMENT_CACHE_MAX_FRESH_MS),
    swrMs: Math.min((cc.staleWhileRevalidate ?? 0) * 1000, DOCUMENT_CACHE_MAX_SWR_MS),
  };
}
