// Strona główna BEZ TREŚCI dla crawlera indeksującego -> HTTP 503.
//
// PO CO (zgłoszenie 2026-10-09). Dokument zdegradowany - komunikat
// „Wczytujemy stronę główną" zamiast treści - wychodził z HTTP 200, więc dla
// wyszukiwarki BYŁ nową wersją adresu "/": Google zaindeksował go i pokazywał
// „Loading the homepage" jako tytuł wyniku na nazwę marki. Dłuższy termin treści
// dla crawlera (`HOME_CRAWLER_CONTENT_BUDGET_MS`) zmniejsza częstość, ale nie
// zmienia tego, co się dzieje po jego przekroczeniu.
//
// 503 z `Retry-After` jest standardowym sygnałem CHWILOWEJ niedostępności:
// Google nie indeksuje treści takiej odpowiedzi, zachowuje dotychczasową
// wersję adresu i ponawia pobranie
// (https://developers.google.com/search/docs/crawling-indexing/http-network-errors).
// Czytelnik nadal dostaje 200 z komunikatem i dociągnięciem treści
// w przeglądarce - status zmienia się WYŁĄCZNIE dla crawlera indeksującego.
//
// Odpowiedź inna niż 200 nigdy nie trafia do NES Edge Cache
// (`documentStorePolicy`), a `no-store` domyka to samo na każdym pośredniku.
export const CRAWLER_RETRY_AFTER_SECONDS = 120;

/** Ta sama odpowiedź (body strumieniowane bez zmian) ze statusem 503. */
export function crawlerUnavailableResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("retry-after", String(CRAWLER_RETRY_AFTER_SECONDS));
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: 503,
    statusText: "Service Unavailable",
    headers,
  });
}
