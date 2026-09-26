// Ścieżki z POŚWIADCZENIAMI przed wysłaniem do analityki i telemetrii.
//
// PO CO. Link przekazania biletu (`/tickets/transfer/<token>`), weryfikacja
// certyfikatu (`/certificates/<kod>`), zaproszenie (`/events/invite/<kod>`)
// i subskrypcja kalendarza (`/api/public/calendar/<token>/plan.ics`) niosą
// sekret W ŚCIEŻCE. Surowy adres w GA4 albo w `analytics_events` oddaje
// operatorowi analityki (i każdemu z dostępem do raportu) klucz, którym da się
// przejąć bilet albo czytać cudzy plan. Reguła `LONG_B64` z `redact.ts` tego
// nie łapie: tokeny mają 32 znaki, a reguła zaczyna się od 40.
//
// CO ROBIMY. Segment z sekretem zamieniamy na `[redacted]` (trasa zostaje
// czytelna w raportach), wartości parametrów `token`, `t` i `code` tak samo,
// a fragment (`#t=<token>` z linków gościa) odcinamy w całości.
//
// MAŁY Z KONIECZNOŚCI. Moduł jedzie w chunku wejściowym (analityka odsłon),
// który ma kilka kilobajtów zapasu budżetu - stąd jedno wyrażenie regularne
// na ścieżkę i jedno na parametr zamiast parsera adresów.

const REDACTED = "[redacted]";

/** Prefiks trasy z sekretem (grupa 1) + sam sekret (jeden segment ścieżki). */
const SECRET_SEGMENT =
  /^(\/(?:en\/)?(?:tickets\/transfer|certificates|events\/invite)\/|\/api\/public\/calendar\/)[^/?#]+/;

/** Parametr zapytania niosący sekret (nazwa bez rozróżniania wielkości liter). */
const SECRET_PARAM = /^(token|t|code)=.*/i;

/** Sama ścieżka (bez zapytania i fragmentu) z zamaskowanym segmentem sekretu. */
export function redactCredentialPath(pathname: string): string {
  return pathname.replace(SECRET_SEGMENT, `$1${REDACTED}`);
}

/** `ścieżka?zapytanie#fragment` -> ścieżka z maską, zapytanie z maską, bez fragmentu. */
export function redactTrackedPath(pathWithSearch: string): string {
  const head = pathWithSearch.split("#", 1)[0];
  const q = head.indexOf("?");
  const path = redactCredentialPath(q === -1 ? head : head.slice(0, q));
  const query =
    q === -1
      ? ""
      : head
          .slice(q + 1)
          .split("&")
          .map((part) => part.replace(SECRET_PARAM, `$1=${REDACTED}`))
          .join("&");
  return query === "" ? path : `${path}?${query}`;
}

/** Pełny adres -> origin + `redactTrackedPath`; adres względny zostaje względny. */
export function redactTrackedHref(href: string): string {
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(href)?.[0] ?? "";
  return origin + redactTrackedPath(href.slice(origin.length));
}
