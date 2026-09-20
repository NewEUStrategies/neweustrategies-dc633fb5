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
//
// ── SKRÓCENIE 2026-09-20: 29 -> 15 wpisów (w cache dokumentów 26 -> 12) ─────
// Zapadka zadziałała w ZAMIERZONYM kierunku i to jest odbiór tej poprawy, a nie
// aktualizacja liczby. Ubyło CZTERNAŚCIE tras liściowych `/club/$clubSlug/**`:
//
//   about, board, calendar, documents, e/$eventSlug, experts, index, insights,
//   members, minisite, new, schedule, spotlight, t/$threadSlug
//
// Żadna z nich nie dostała własnego loadera. Wszystkie czternaście grzeje dziś
// JEDEN loader UKŁADU `src/routes/club.$clubSlug.tsx`, który pobiera kartę
// klubu pod budżetem 800 ms i zasiewa DOKŁADNIE ten klucz, który czyta komponent
// dla widza anonimowego (`clubKeys.bySlugViewer(slug, null)`). Wcześniej każda
// z tych tras robiła własny round-trip do `club_view` na klucz `clubKeys.bySlug`
// - czyli klucz, którego komponent nie czytał - więc ten sam odczyt leciał
// drugi raz po hydratacji, a SSR oddawał szkielet (audyt CWV 2026-09-20, F09).
// Rozjazdu tej klasy pilnuje od teraz reguła W4 bramki `check:loader-policy`
// (`src/lib/ci/loaderPolicy.ts`), żeby naprawa nie zależała od czyjejś pamięci.
//
// Pozostałe 15 wpisów to dług NIETKNIĘTY przez tę falę prac - lista niżej jest
// jego pełnym spisem imiennym, wygenerowanym `--print-baseline` ze stanu na
// dysku, a nie przepisanym ręcznie.
export const COLD_PUBLIC_ROUTE_BASELINE: readonly (readonly [string, string])[] = [
  ["src/routes/checkout.$planId.tsx", "/checkout/$planId"],
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
