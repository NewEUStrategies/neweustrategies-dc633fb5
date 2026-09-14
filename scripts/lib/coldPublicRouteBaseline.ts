// ZAMROŻONA LISTA: publiczne strony SSR, które czytają WYŁĄCZNIE zimne klucze
// (werdykt `brak-loadera` albo `loader-trywialny`) - czyli oddają czytelnikowi
// i wyszukiwarce szkielet ładowania zamiast treści.
//
// ZMIERZONE, nie przepisane:
//   bun run scripts/report-public-route-loaders.ts --print-baseline
//
// PO CO LISTA, SKORO SĄ SUFITY. `FROZEN_COLD_PUBLIC_ROUTES` /
// `FROZEN_COLD_CACHED_ROUTES` zamrażają OBJĘTOŚĆ długu, a objętość da się
// skompensować: naprawa jednej trasy „opłaca" zepsucie innej i licznik stoi
// w miejscu. Lista zamraża TOŻSAMOŚĆ - trasa spoza listy MUSI być rozgrzana,
// więc nowy kod nie startuje w długu, a nazwa winnej trasy pada w komunikacie
// bramki zamiast samej liczby. Pełne uzasadnienie z trzema scenariuszami
// kompensacji: sekcja „RATCHET PER TRASA" w `src/lib/ci/publicRouteLoaders.ts`.
//
// Klucz to PLIK trasy, wartość to jej adres. Oba są potrzebne: dopasowanie po
// samym pliku dawałoby fałszywą czerwień przy zmianie adresu, po samym adresie
// - przy zmianie nazwy pliku.
//
// Lista może się tylko SKRACAĆ. Naprawiona trasa znika stąd razem z obniżeniem
// obu sufitów.
export const COLD_PUBLIC_ROUTE_BASELINE: readonly (readonly [string, string])[] = [
  ["src/routes/checkout.$planId.tsx", "/checkout/$planId"],
  ["src/routes/club.$clubSlug.about.tsx", "/club/$clubSlug/about"],
  ["src/routes/club.$clubSlug.board.tsx", "/club/$clubSlug/board"],
  ["src/routes/club.$clubSlug.calendar.tsx", "/club/$clubSlug/calendar"],
  ["src/routes/club.$clubSlug.documents.tsx", "/club/$clubSlug/documents"],
  ["src/routes/club.$clubSlug.e.$eventSlug.tsx", "/club/$clubSlug/e/$eventSlug"],
  ["src/routes/club.$clubSlug.experts.tsx", "/club/$clubSlug/experts"],
  ["src/routes/club.$clubSlug.index.tsx", "/club/$clubSlug/"],
  ["src/routes/club.$clubSlug.insights.tsx", "/club/$clubSlug/insights"],
  ["src/routes/club.$clubSlug.members.tsx", "/club/$clubSlug/members"],
  ["src/routes/club.$clubSlug.minisite.tsx", "/club/$clubSlug/minisite"],
  ["src/routes/club.$clubSlug.new.tsx", "/club/$clubSlug/new"],
  ["src/routes/club.$clubSlug.schedule.tsx", "/club/$clubSlug/schedule"],
  ["src/routes/club.$clubSlug.spotlight.tsx", "/club/$clubSlug/spotlight"],
  ["src/routes/club.$clubSlug.t.$threadSlug.tsx", "/club/$clubSlug/t/$threadSlug"],
  ["src/routes/club.apply.tsx", "/club/apply"],
  ["src/routes/club.index.tsx", "/club"],
  ["src/routes/club.join.$token.tsx", "/club/join/$token"],
  ["src/routes/club.specialization.$slug.tsx", "/club/specialization/$slug"],
  ["src/routes/donate.tsx", "/donate"],
  ["src/routes/polityka-prywatnosci.tsx", "/polityka-prywatnosci"],
  ["src/routes/preview.$token.tsx", "/preview/$token"],
  ["src/routes/publications.tsx", "/publications"],
  ["src/routes/quiz.tsx", "/quiz"],
  ["src/routes/reading-list.tsx", "/reading-list"],
  ["src/routes/regulamin.tsx", "/regulamin"],
  ["src/routes/search.tsx", "/search"],
  ["src/routes/zatrudniamy.tsx", "/zatrudniamy"],
  ["src/routes/zwroty-i-reklamacje.tsx", "/zwroty-i-reklamacje"],
];
