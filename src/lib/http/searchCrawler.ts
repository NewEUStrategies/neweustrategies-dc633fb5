// Crawlery INDEKSUJĄCE wyszukiwarek - lista celowo węższa niż `BOT_USER_AGENT`
// z `botFilter.ts`.
//
// PO CO OSOBNO. `isBotUserAgent` łapie każdy automat (podglądy linków, curl,
// przeglądarki bezgłowe, Lighthouse/PSI) i służy do odsiewu beaconów. Tutaj
// pytanie jest inne: czy ten render trafi do INDEKSU wyszukiwarki. Od tego
// zależy, czy dokument może wyjść zdegradowany (komunikat „Wczytujemy stronę
// główną" zamiast treści) - zgłoszenie 2026-10-09: Google zaindeksował stronę
// główną w tym stanie i pokazywał „Loading the homepage" jako tytuł wyniku na
// nazwę marki. Pomiar na produkcji tego dnia: 4 z 10 żądań z UA Googlebota
// dostało dokument bez treści.
//
// Lighthouse i PageSpeed Insights NIE należą do tej listy: ich UA nie zawiera
// żadnego z tokenów niżej, a dłuższy budżet dla nich zafałszowałby pomiar
// TTFB/LCP, którego pilnuje plan wydajności.
//
// Moduł bez importów - trafia do grafu tras przez `lib/seo/request.ts`.
const SEARCH_CRAWLER_USER_AGENT =
  /googlebot|google-inspectiontool|bingbot|yandexbot|baiduspider|duckduckbot|applebot|seznambot|petalbot/i;

export function isSearchCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  return SEARCH_CRAWLER_USER_AGENT.test(userAgent ?? "");
}
