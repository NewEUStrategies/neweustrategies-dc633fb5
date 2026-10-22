// Parytet strumienia SSR dla Lighthouse'a / PageSpeed Insights (server-only).
//
// PROBLEM (pomiar 2026-10-22, PSI mobile SI 11,0 s / desktop 2,9 s). Lighthouse
// emuluje przeglądarkę czytelnika (Moto G Power / desktop Chrome), ale do jej UA
// dopisuje token `Chrome-Lighthouse`. Router renderuje dokument przez
// `renderRouterToStream`, który pyta `isbot(User-Agent)` - a `isbot` uznaje ten
// token za automat. Dla automatów framework CZEKA na `stream.allReady` i oddaje
// dokument dopiero po wyrenderowaniu WSZYSTKICH sekcji spod zgięcia
// (@tanstack/react-router/ssr/renderRouterToStream: `if (rendererAbort) await
// waitForRequest(stream.allReady, ...)`). Czytelnik w Chrome dostaje w tym czasie
// powłokę z pierwszym ekranem od razu, a resztę strumieniem.
//
// Pomiar mierzył więc INNY dokument niż ten, który widzi człowiek: na MISS-ie
// pierwszy bajt dla PSI czekał na komplet zapytań (n=27 zamiast n=13 powłoki)
// i na render całej strony. Speed Index jako jedyna metryka Lantern widzi
// rzeczywisty TTFB (składnik `observedSpeedIndex`, x1,4 na mobile), więc cały
// ogon sekcji spod zgięcia lądował w wyniku, choć żaden czytelnik na niego nie
// czeka.
//
// ROZWIĄZANIE: decyzję „strumień czy `allReady`" podejmujemy na UA emulowanej
// przeglądarki - czyli UA Lighthouse'a bez tokenu. Dotyczy to WYŁĄCZNIE tej
// decyzji (`renderRouterToStream` czyta z żądania tylko `signal` i nagłówek
// `User-Agent`): aplikacja, middleware, cache dokumentów i log widzą oryginalne
// żądanie, a linia logu nadal ma klasę UA "lighthouse". Prawdziwe crawlery
// (Googlebot, Bingbot, ...) nie niosą tego tokenu, więc dalej dostają dokument
// kompletny - ich wariant się nie zmienia.
//
// Klucz cache dokumentów nie zależy od UA, a wariant zapisywany w L1/L2 przestaje
// zależeć od tego, czy MISS trafił akurat PSI (ta sama doktryna co
// `REVALIDATION_USER_AGENT` w src/server.ts: wpis zawsze w wariancie strumieniowym).

/** Token, który Lighthouse (także w PSI) dopisuje do emulowanego UA przeglądarki. */
const LIGHTHOUSE_TOKEN = /\s*\bChrome-Lighthouse\b/i;
const LIGHTHOUSE_TOKEN_ALL = /\s*\bChrome-Lighthouse\b/gi;

/**
 * UA, na którym router ma podjąć decyzję o strumieniowaniu: dla Lighthouse'a UA
 * emulowanej przeglądarki (bez tokenu), dla każdego innego - null (bez zmian).
 */
export function lighthouseBrowserAgent(userAgent: string | null): string | null {
  if (!userAgent || !LIGHTHOUSE_TOKEN.test(userAgent)) return null;
  const browserAgent = userAgent.replace(LIGHTHOUSE_TOKEN_ALL, "").trim();
  return browserAgent || null;
}

/**
 * Żądanie dla `renderRouterToStream`: dla Lighthouse'a natywny `Request` z UA
 * emulowanej przeglądarki i TYM SAMYM sygnałem zerwania (sprzątanie renderu przy
 * rozłączeniu), dla każdego innego UA - to samo żądanie (ta sama tożsamość).
 *
 * Kopia powstaje z adresu, nie z żądania wejściowego: pod Nitro na Node żądanie
 * wejściowe nie jest natywnym `Request` (konstruktor `new Request(req, init)`
 * rzuca), a w workerd niesie kontekst runtime'u - żaden z nich nie jest tu
 * potrzebny, bo kopię czyta wyłącznie decyzja o strumieniu.
 */
export function streamDecisionRequest(request: Request): Request {
  const browserAgent = lighthouseBrowserAgent(request.headers.get("user-agent"));
  if (!browserAgent) return request;
  const headers = new Headers(request.headers);
  headers.set("user-agent", browserAgent);
  return new Request(request.url, { headers, signal: request.signal });
}
