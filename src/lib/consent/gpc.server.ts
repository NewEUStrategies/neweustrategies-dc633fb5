// Global Privacy Control - warstwa serwerowa (SSR).
//
// PROBLEM DO ROZWIĄZANIA. `Sec-GPC` to nagłówek ŻĄDANIA - przeglądarka nie
// udostępnia go JS-owi, a `navigator.globalPrivacyControl` jest wspierane węziej
// niż sam nagłówek (część rozszerzeń prywatnościowych wysyła wyłącznie nagłówek).
// Bez mostu SSR sygnał od takich klientów byłby dla aplikacji niewidzialny.
//
// ROZWIĄZANIE I JEGO KOSZT DLA CACHE'A. Middleware odbija obserwowany nagłówek
// w cookie transportowym (`nes_gpc`) i dokłada `Vary: Sec-GPC`. Klucz jest tu
// tylko jeden i celowo: TREŚĆ dokumentu pozostaje niezależna od GPC (klamrę
// nakłada klient przy hydratacji), więc NES Edge Cache trzyma nadal JEDEN wpis
// na ścieżkę - kardynalność kluczy nie rośnie.
//
// Żeby to było prawdą, `gpcMiddleware` MUSI siedzieć POWYŻEJ
// `documentCacheMiddleware` w `src/start.ts`. Odpowiedź wraca z wnętrza na
// zewnątrz, więc `Set-Cookie` i `Vary` są doklejane PO odtworzeniu wpisu z
// cache'a - nigdy nie wchodzą do zapisanego wpisu i nigdy nie wyjdą do
// niewłaściwego klienta (cookie GPC innego użytkownika w cudzym dokumencie to
// dokładnie ta klasa błędu, którą ta kolejność wyklucza).
//
// Cookie jest ściśle niezbędne (art. 5 ust. 3 ePrivacy): nośnik prawnego
// opt-outu. Nie zawiera identyfikatora, ma `SameSite=Lax`, `Secure` na https i
// NIE jest `HttpOnly` - jego jedynym konsumentem jest kod klienta CMP.
import { createMiddleware } from "@tanstack/react-start";
import { GPC_COOKIE, GPC_COOKIE_VALUE, readGpcCookie, readGpcFromHeaders } from "@/lib/consent/gpc";
import { getMiddlewareResponse, withMiddlewareResponse } from "@/lib/http/middlewareResult";

/** Rok - sygnał jest odświeżany przy każdej nawigacji, więc TTL to tylko sufit. */
const GPC_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Minimalny wycinek Request, od którego zależy transport sygnału. Zawężenie jest
 * celowe - ta sama doktryna, co `DocumentCacheRequest`: (1) dokumentuje pełną
 * powierzchnię decyzji, (2) pozwala testować bez konstruktora `Request`
 * przeglądarki, który wycina nagłówki „zakazane" - a `Sec-GPC` i `Cookie` są
 * DOKŁADNIE takimi nagłówkami, więc bez tego typu ścieżki z sygnałem byłyby
 * nietestowalne.
 */
export type GpcTransportRequest = Pick<Request, "url"> & { headers: Pick<Headers, "get"> };

/** Czy żądanie niesie `Sec-GPC: 1`. Jedyne wejście serwerowe dla sygnału. */
export function requestHasGpc(request: GpcTransportRequest | null | undefined): boolean {
  return readGpcFromHeaders(request?.headers ?? null).active;
}

/** Wartość nagłówka `Set-Cookie` ustawiającego albo kasującego cookie sygnału. */
export function gpcCookieHeaderValue(active: boolean, secure: boolean): string {
  const flags = `Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  return active
    ? `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; Max-Age=${GPC_COOKIE_MAX_AGE}; ${flags}`
    : `${GPC_COOKIE}=; Max-Age=0; ${flags}`;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

function isSecureRequest(request: GpcTransportRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Dokleja `Vary` bez gubienia wartości ustawionych przez inne middleware. */
function appendVary(headers: Headers, token: string): void {
  const current = headers.get("vary");
  if (!current) {
    headers.set("vary", token);
    return;
  }
  const present = current
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .includes(token.toLowerCase());
  if (!present) headers.append("vary", token);
}

/**
 * Decyzja o transporcie sygnału dla JEDNEJ odpowiedzi. Wydzielona z middleware,
 * bo cała nietrywialna logika (kiedy pisać, kiedy kasować, kiedy nie ruszać) da
 * się wtedy przetestować bez frameworka.
 *
 * Zwraca `null`, gdy nie ma nic do zrobienia - wtedy middleware oddaje
 * odpowiedź w oryginale, bez przebudowy nagłówków.
 */
export function planGpcCookie(
  signalActive: boolean,
  cookiePresent: boolean,
): "set" | "clear" | null {
  if (signalActive) return cookiePresent ? null : "set";
  return cookiePresent ? "clear" : null;
}

/**
 * Nagłówki wyjściowe transportu GPC - CZYSTA funkcja (nowy obiekt `Headers`, bez
 * dotykania odpowiedzi). Wydzielona z `applyGpcTransport` z dwóch powodów:
 *
 *  1) cała decyzja (`Vary` + ewentualne `Set-Cookie`) jest tu w jednym miejscu,
 *  2) da się ją ASSERTOWAĆ. Implementacje `fetch` zgodne ze specem filtrują
 *     `Set-Cookie` z nagłówków odpowiedzi tworzonych skryptem (guard „response"),
 *     więc w środowisku testowym cookie byłoby niewidzialne przez `Response` -
 *     mimo że runtime serwerowy (workerd / adapter Node) je przepuszcza. Bez tej
 *     funkcji transport sygnału byłby niepokryty testem.
 *
 * Zwraca `null`, gdy odpowiedź nie jest dokumentem HTML - wtedy nie ruszamy nic.
 */
export function gpcTransportHeaders(
  request: GpcTransportRequest,
  response: Response,
): Headers | null {
  if (!isHtml(response)) return null;

  const signalActive = requestHasGpc(request);
  const cookiePresent = readGpcCookie(request.headers.get("cookie"));
  const plan = planGpcCookie(signalActive, cookiePresent);

  const headers = new Headers(response.headers);
  // `Vary` idzie na KAŻDY dokument, nie tylko na ten z sygnałem: bez tego cache
  // pośredniczący mógłby podać dokument (i cookie) klienta z GPC klientowi bez
  // GPC. To poprawność HTTP, nie optymalizacja.
  appendVary(headers, "Sec-GPC");
  if (plan) {
    headers.append("Set-Cookie", gpcCookieHeaderValue(plan === "set", isSecureRequest(request)));
  }
  return headers;
}

/**
 * Nakłada transport GPC na odpowiedź HTML. Nowa `Response` (nie mutacja): headers
 * odpowiedzi zbudowanych przez runtime Workera bywają immutable, a mutacja
 * wywala się po wyrenderowaniu trasy i h3 przykrywa to generycznym 500.
 */
export function applyGpcTransport(request: GpcTransportRequest, response: Response): Response {
  const headers = gpcTransportHeaders(request, response);
  if (!headers) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Middleware do `requestMiddleware` w `src/start.ts`. Musi stać POWYŻEJ
 * `documentCacheMiddleware` (patrz nagłówek pliku) - inaczej `Set-Cookie`
 * wpadłby do wpisu NES Edge Cache.
 */
export const gpcMiddleware = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  const response = getMiddlewareResponse(result);
  if (!response) return result;
  return withMiddlewareResponse(result, applyGpcTransport(request, response));
});
