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
export const NES_EDGE_CACHE_NAME = "New European Strategies Edge Cache";
/** Nagłówek diagnostyczny: HIT | STALE | MISS | BYPASS. */
export const NES_CACHE_HEADER = "x-nes-cache";
/** Wiek serwowanego wpisu w sekundach (tylko HIT/STALE). */
export const NES_CACHE_AGE_HEADER = "x-nes-cache-age";
/**
 * Znacznik żądania ODŚWIEŻAJĄCEGO wpis w tle (nie wizyta czytelnika): pomija
 * serwowanie z cache'a i wymusza pełny render, którego wynik ląduje w L1/L2.
 *
 * Wartością jest losowy nonce izolatu (`documentCache.server.ts`), nie stała:
 * rewalidacja biegnie W PROCESIE (ten sam izolat wywołuje ten sam handler),
 * więc nonce nigdy nie opuszcza pamięci workera i nie da się go podrobić
 * z zewnątrz. Bez tego nagłówek byłby darmowym cache-busterem dla każdego.
 */
export const NES_REVALIDATE_HEADER = "x-nes-revalidate";

export type NesCacheStatus = "HIT" | "STALE" | "MISS" | "BYPASS";

/**
 * Górny pułap świeżości wpisu NIEZALEŻNY od `s-maxage` odpowiedzi. Nagłówek
 * `s-maxage` adresuje ewentualny zewnętrzny CDN (może być długi), ale nasz
 * cache in-memory nie ma między-izolatowego purge'a - krótka świeżość + długie
 * okno stale-while-revalidate dają błyskawiczne odpowiedzi przy publikacjach
 * widocznych w minuty, nie kwadranse.
 */
export const DOCUMENT_CACHE_MAX_FRESH_MS = 180_000;
/**
 * Górny pułap okna serwowania stale (rewalidacja w tle single-flight).
 * 24 h (pełne okno `stale-while-revalidate` z contentCacheControl), nie 6 h:
 * przy niskim ruchu pierwszy czytelnik kolonii po dłuższej ciszy płacił pełny
 * render (sekundy TTFB), choć L2 wciąż trzymał poprawny dokument. Serwowanie
 * stale jest bezpieczne z konstrukcji: publikacja robi purge (bump wersji L2 -
 * wpis natychmiast nieosiągalny w całej kolonii), a rewalidacja i tak biegnie
 * ZA odpowiedzią przy pierwszym trafieniu w okno stale.
 */
export const DOCUMENT_CACHE_MAX_SWR_MS = 24 * 60 * 60 * 1000;

/**
 * Limit rozmiaru pojedynczego dokumentu (większe nie wchodzą do cache).
 *
 * 2026-08-18: 1 MiB -> 2 MiB. Strona główna niesie w HTML-u dehydratowane
 * dane WSZYSTKICH sekcji plus pełną mapę site_settings z builder_data
 * chrome'u; dokument potrafi
 * przekroczyć 1 MiB i wtedy NAJWAŻNIEJSZA trasa serwisu wypadała z cache'a
 * PO CICHU - każdy czytelnik płacił pełny render SSR (sekundy TTFB), a
 * liczniki pokazywały wyłącznie rosnące MISS-y bez śladu przyczyny. Odrzut
 * jest teraz zliczany (stats.oversize) i logowany w documentCache.server.ts,
 * więc następne przekroczenie limitu będzie widoczne w /admin/performance
 * zamiast objawiać się wolnym pierwszym wejściem. Budżet całego magazynu
 * (24 MiB, approx-LRU) pozostaje nadrzędny, więc koszt pamięci jest
 * ograniczony z konstrukcji.
 *
 * 2026-09-01: limit ZOSTAJE na 2 MiB, choć strona główna strumieniuje już
 * sekcje spod zgięcia. Strumieniowanie przenosi te dane z początkowej paczki
 * dehydratacji do strumienia zapytań, ale NIE zdejmuje ich z dokumentu - ciało
 * zapisywane w cache'u jest zbierane do końca strumienia
 * (`applyDeferredDocumentStore`), więc presja na ten limit jest ta sama.
 */
export const DOCUMENT_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
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
  // Powierzchnie z POŚWIADCZENIEM w ścieżce (S26): link przekazania biletu
  // (`/tickets/transfer/<token>`) i weryfikacja certyfikatu
  // (`/certificates/<kod>`). Obie trasy są `ssr: false`, a ich dokument nie
  // może trafić do wspólnego cache'u pod kluczem zawierającym sekret.
  "/tickets",
  "/certificates",
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

// Parametry IGNOROWANE na konkretnych trasach: nie zmieniają dokumentu SSR,
// więc wypadają z klucza zamiast wymuszać BYPASS. Panel „moje wydarzenie"
// (`/events/<slug>/me?tab=…`) renderuje na serwerze ten sam szkielet dla
// każdej zakładki - zakładkę wybiera klient po hydratacji, a dane osobowe
// nigdy nie są w HTML-u (MIN-2). Bez tej reguły każde `?tab=` omijało cache.
const ROUTE_IGNORED_PARAMS: ReadonlyArray<{ pattern: RegExp; params: ReadonlySet<string> }> = [
  { pattern: /^\/(?:en\/)?events\/[^/]+\/me$/, params: new Set(["tab"]) },
];

function isRouteIgnoredParam(pathname: string, name: string): boolean {
  const lower = name.toLowerCase();
  return ROUTE_IGNORED_PARAMS.some((rule) => rule.pattern.test(pathname) && rule.params.has(lower));
}

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
    if (isTrackingParam(name) || isRouteIgnoredParam(pathname, name)) continue;
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
 *
 * Dwie dyrektywy walidacyjne rozstrzygamy tak, jak ten magazyn potrafi:
 *   * `no-cache` -> NIE ZAPISUJEMY. RFC 9111 5.2.2.4 pozwala przechować, ale
 *     zabrania PODAĆ bez walidacji u źródła, a tu nie ma czym walidować:
 *     `replay()` odtwarza bajty z pamięci (żadnego ETagu ani żądania
 *     warunkowego na `DocumentCacheEntry`), a odświeżenie biegnie ZA
 *     odpowiedzią. „Przechowany" znaczy w tym magazynie „podany bez
 *     walidacji", czyli dokładnie to, czego `no-cache` zakazuje. `freshMs = 0`
 *     nie jest wyjściem pośrednim: wpis byłby serwowany STALE od pierwszej
 *     milisekundy, czyli ODWROTNIE niż każe dyrektywa.
 *   * `must-revalidate` -> zapisujemy, ale BEZ okna stale. Dyrektywa
 *     (RFC 9111 5.2.2.2) nie skraca świeżości, tylko zabrania ponownego użycia
 *     wpisu NIEŚWIEŻEGO bez walidacji - a jedyne, co ten magazyn robi po
 *     świeżości, to serwowanie stale. Zerowe okno stale zamienia wygaśnięcie
 *     w zwykły MISS (pełny render), co jest jedyną wierną interpretacją.
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
  if (cc.noCache) return NO_STORE;
  if (!cc.sMaxAge || cc.sMaxAge <= 0) return NO_STORE;
  return {
    store: true,
    freshMs: Math.min(cc.sMaxAge * 1000, DOCUMENT_CACHE_MAX_FRESH_MS),
    swrMs: cc.mustRevalidate
      ? 0
      : Math.min((cc.staleWhileRevalidate ?? 0) * 1000, DOCUMENT_CACHE_MAX_SWR_MS),
  };
}

/**
 * Normalizacja ścieżki dokumentu do postaci, w jakiej `planDocumentCache`
 * kluczuje wpisy: wiodący `/`, bez końcowego `/` (poza korzeniem), bez query
 * i fragmentu, bez prefiksu języka. Null dla wejścia, które nie jest ścieżką
 * względną tego serwisu (pełny URL, pusty napis) - purge nie zgaduje.
 */
export function normalizeDocumentPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? "";
  const collapsed = withoutQuery.replace(/\/+$/, "") || "/";
  return stripLangPrefix(collapsed);
}

/**
 * Oba warianty językowe jednego dokumentu: PL na gołej ścieżce i EN pod `/en`.
 * Publikacja zmienia oba, więc purge per ścieżka ZAWSZE unieważnia parę -
 * czytelnik EN nie może dostawać starej wersji tylko dlatego, że redaktor
 * pracował po polsku. Duplikaty (np. `/x` i `/en/x` na wejściu) są scalane.
 */
export function documentPathVariants(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of paths) {
    const bare = normalizeDocumentPath(raw);
    if (!bare) continue;
    out.add(bare);
    out.add(bare === "/" ? "/en" : `/en${bare}`);
  }
  return [...out];
}

/**
 * Publiczne dokumenty zależne od WPISU - wejście dla purge'a selektywnego
 * przy publikacji/aktualizacji wpisu (`purgeDocumentPaths`):
 *   - adres kanoniczny (`<ścieżka-rodzica>/<slug>`), jeśli wołający go zna;
 *     przy zmianie sluga/rodzica trzeba podać STARY i NOWY wpis - stary
 *     dokument w cache'u serwowałby inaczej nieaktualną treść pod adresem,
 *     który już przekierowuje;
 *   - adres legacy `/post/<slug>` - własne listingi wciąż go generują
 *     (audyt CWV F13), a jego 301 też siedzi w potoku dokumentów;
 *   - strona główna i listing bloga, które pokazują najnowsze wpisy.
 * Archiwa kategorii/tagów/autora wołający dokłada sam, gdy zna ich slugi -
 * tu nie są deterministycznie znane. Bez prefiksu języka: warianty `/en`
 * dokłada `documentPathVariants` w purge'u.
 */
export function postDocumentPaths(
  posts: ReadonlyArray<{ slug: string; canonicalPath?: string | null }>,
): string[] {
  const out = new Set<string>(["/", "/blog"]);
  for (const post of posts) {
    const slug = post.slug.trim().replace(/^\/+|\/+$/g, "");
    if (slug) out.add(`/post/${slug}`);
    if (post.canonicalPath) {
      const canonical = post.canonicalPath.trim();
      out.add(canonical.startsWith("/") ? canonical : `/${canonical}`);
    }
  }
  return [...out];
}
