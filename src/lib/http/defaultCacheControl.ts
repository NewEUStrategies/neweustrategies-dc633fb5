// Domyślna polityka Cache-Control dla publicznych dokumentów SSR - czysta i
// wolna od frameworka (testowalna jednostkowo); wpięcie w potok żądań żyje w
// `src/start.ts` (defaultCacheControlMiddleware).
//
// Problem, który ten moduł rozwiązuje: nagłówek cache ustawiały dotąd tylko
// trzy trasy (index, $, sitemap) - każda pozostała publiczna trasa (kategorie,
// tagi, blog, autorzy, podcasty, programy...) wychodziła BEZ Cache-Control,
// więc `documentStorePolicy` wykluczał ją z NES Edge Cache, a przeglądarka
// nie miała żadnej polityki świeżości. Efekt: pełny render SSR + komplet
// zapytań do bazy na każde żądanie ~20 tras.
//
// Zasada: polityka jest DOMYŚLNA, nigdy nadrzędna. Trasa, która ustawiła
// własny nagłówek (np. home z opt-outem `private, no-store` przy degradacji,
// preview/personalized), zawsze wygrywa - middleware dokłada nagłówek tylko
// wtedy, gdy odpowiedź w ogóle go nie niesie. Kwalifikują się wyłącznie pełne
// (200) dokumenty HTML z żądań GET poza deny-listą powierzchni zalogowanych /
// transakcyjnych (współdzieloną z NES Edge Cache i Speculation Rules - jedna
// lista, jedna doktryna).
//
// Kontrakt bezpieczeństwa jest ten sam co dla całego publicznego SSR:
// dokument to anonimowa skorupa (sesja w localStorage, treści gated wydaje
// RPC po hydracji), więc współdzielenie odpowiedzi między odwiedzającymi jest
// bezpieczne z konstrukcji. Żądania z `Authorization`/ciasteczkiem `sb-*` są
// i tak BYPASS-owane przez NES Edge Cache, a tu dodatkowo wykluczone.
import {
  PUBLIC_DOCUMENT_DENY_PREFIXES,
  stripLangPrefix,
  type DocumentCacheRequest,
} from "./documentCache";
import { cacheControlHeader, contentCacheControl } from "./cachePolicy";
import { parseCacheControl } from "./parseCacheControl";

/**
 * Powierzchnie "żywe" (live blog): dokument jest publiczny i cache'owalny,
 * ale świeżość musi być mierzona w sekundach, nie minutach - czytelnik relacji
 * na żywo nie może dostawać wpisu sprzed 15 minut. Krótki `s-maxage` + krótkie
 * okno stale zachowują ochronę przed stampede bez zamrażania relacji.
 */
const LIVE_PATH_PREFIXES = ["/live"] as const;

/** Cache-Control dla powierzchni live: świeżość w sekundach. */
export function liveCacheControl(): string {
  return cacheControlHeader({
    cacheable: true,
    browserMaxAge: 0,
    sharedMaxAge: 30,
    staleWhileRevalidate: 300,
  });
}

function isLivePath(pathname: string): boolean {
  const bare = stripLangPrefix(pathname);
  return LIVE_PATH_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`));
}

function isDeniedPath(pathname: string): boolean {
  const bare = stripLangPrefix(pathname);
  return PUBLIC_DOCUMENT_DENY_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`));
}

/** Minimalny wycinek Response, od którego zależy decyzja (testy bez fetch). */
export type DefaultCacheControlResponse = Pick<Response, "status"> & {
  headers: Pick<Headers, "get">;
};

/**
 * Czy dyrektywa trasy WYKLUCZA zapis w jakimkolwiek cache. Taka wartość wolno
 * nadać odpowiedzi bezwarunkowo - tylko zawęża, nigdy nie poszerza uprawnień
 * pośrednika.
 */
function forbidsStorage(directive: string): boolean {
  const cc = parseCacheControl(directive);
  return cc.noStore || cc.private;
}

/**
 * Nagłówek Cache-Control, który należy domyślnie nadać odpowiedzi, albo null,
 * gdy odpowiedź ma zostać nietknięta. Czysta funkcja - pełna macierz decyzji
 * jest pokryta testami jednostkowymi.
 *
 * `routeDirective` to intencja ustawiona przez loader trasy
 * (`setCacheControlHeader` -> `readRouteCacheDirective`). Nagłówek zdarzenia h3
 * scala się z odpowiedzią dopiero ZA tym middleware, więc bez tego argumentu
 * decyzja trasy nie ma jak dotrzeć do polityki ZAPISU w NES Edge Cache -
 * szczegóły i dowód w `responseHeaders.ts` przy `routeCacheDirectives`.
 * Dyrektywa trasy jest NADRZĘDNA nad polityką domyślną; jej wartość powstaje
 * w czystych politykach (`cachePolicy.ts`, `liveCacheControl` niżej,
 * `resilientCacheControl`), więc warstwa wykonawcza nadal nie wymyśla polityk.
 */
export function planDefaultCacheControl(
  request: DocumentCacheRequest,
  response: DefaultCacheControlResponse,
  routeDirective?: string | null,
): string | null {
  if (request.method !== "GET") return null;
  // Trasa wie lepiej: jakikolwiek własny nagłówek JUŻ NA ODPOWIEDZI (feedy,
  // sitemapy, mapy statyczne) wygrywa i nie jest ruszany.
  if (response.headers.get("cache-control")) return null;
  if (response.status !== 200) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;

  // Opt-out trasy (render zdegradowany, preview, personalizacja) obowiązuje
  // BEZWARUNKOWO i jako pierwszy: `no-store`/`private` wyłącznie zawęża, więc
  // nie da się nim popsuć żadnej z decyzji niżej. To jest ta jedna ścieżka,
  // której brak zamrażał pustą powłokę na brzegu na 24 h.
  if (routeDirective && forbidsStorage(routeDirective)) return routeDirective;

  // Sesyjne żądania nie dostają współdzielonej polityki (pas i szelki - NES
  // Edge Cache i tak je BYPASS-uje, ale nagłówek public na odpowiedzi dla
  // żądania z tokenem byłby mylący dla pośredników). Dotyczy to także
  // dyrektywy trasy: `public` z loadera nie może obejść tej bariery.
  if (request.headers.get("authorization")) return null;
  const cookie = request.headers.get("cookie") ?? "";
  if (/(?:^|;\s*)sb-[^=]*=/.test(cookie)) return null;

  const url = new URL(request.url);
  const { pathname } = url;
  // Zasoby z rozszerzeniem mają własne polityki (sitemapy, feedy, robots).
  if (/\.[a-z0-9]+$/i.test(pathname)) return null;
  if (isDeniedPath(pathname)) return null;
  // Czysty render: intencja trasy nadal wygrywa z domyślną, bo trasa zna swoją
  // powierzchnię lepiej (np. `/live` deklaruje świeżość w sekundach).
  if (routeDirective) return routeDirective;
  if (isLivePath(pathname)) return liveCacheControl();
  return contentCacheControl();
}
