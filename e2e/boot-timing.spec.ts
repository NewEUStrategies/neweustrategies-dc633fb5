// POMIAR CZASU NA ZBUDOWANYM ARTEFAKCIE. Uruchamiany WYŁĄCZNIE przez
// `playwright.artifact.config.ts` (`bun run test:e2e:artifact`), obok
// `boot-artifact.spec.ts` i na TYM SAMYM serwerze - jeden build, jeden proces
// `node .output/server/index.mjs`, dwa pliki testowe.
//
// Uzupełnia Lighthouse, który od 2026-09-01 również mierzy zbudowany artefakt.
// `lighthouserc.json` blokuje regresje TBT i CLS; pozostałe metryki są na warn
// z powodu zastępczego backendu. Raport LCP 31 215 ms zapisany historycznie
// w `.lighthouseci/` pochodzi z dev-servera i nie opisuje aktualnego buildu.
// `lighthouserc.deployed.json` wymusza także LCP, lecz wymaga wdrożonego URL-a
// w zmiennej repozytorium `LHCI_URL`. Faktyczny tryb widać w logu workflow.
//
// Ten plik zamyka tę część luki, która JEST w naszej mocy: liczba powstaje na
// ARTEFAKCIE (preset `node-server`, minifikacja, prawdziwe chunki), w CI, bez
// zewnętrznego URL-a i bez ani jednego wyjścia do sieci poza localhost.
//
// CZEGO TEN PLIK NIE ZASTĘPUJE. Nie mierzy LCP, CLS ani TBT - te wymagają
// throttlingu i modelu procesora, którego Playwright bez Lighthouse'a nie
// odtwarza. Mierzy CZTERY liczby, dla których zbudowany artefakt na localhoście
// jest ODPOWIEDNIM przyrządem, bo w każdej z nich dominuje koszt WŁASNY
// artefaktu, nie sieci:
//   1. TTFB dokumentu - `responseStart - requestStart`, czyli czas, w którym
//      serwer SSR-uje dokument. Bez DNS i bez połączenia, więc localhost nie
//      zaniża tej liczby względem produkcji przez brak RTT - zaniża ją tylko
//      o realny RTT sieci, a to składnik, którego artefakt nie kontroluje;
//   2. czas do GOTOWOŚCI HYDRATACJI - od `window.__nesBootT0` (znacznik sondy
//      z `lib/observability/bootProbeScript`, pierwszy skrypt w `<head>`) do
//      chwili, w której `window.__nesAppReady` staje się `true`
//      (`lib/watchdog/appReady`, pisane synchronicznie w efekcie montowania
//      korzenia). To JEDYNA liczba w repozytorium, która wycenia to, co
//      incydent 2026-07-20 zepsuł: drogę od pierwszego bajtu skryptu do
//      interaktywnej strony. `boot-artifact.spec.ts` sprawdza, że ta droga
//      ISTNIEJE; ten plik sprawdza, ile ona kosztuje;
//   3. TRANSFER ŚCIEŻKI BOOTOWANIA - suma `transferSize` wszystkich pobranych
//      plików `.js` z `PerformanceResourceTiming`, rozbita na domknięcie
//      STATYCZNE i importy DYNAMICZNE. To liczba, którą płaci pierwsze wejście,
//      i jedyny pomiar, który sprawdza floor `boot` ze
//      `scripts/check-bundle-size.ts` PO STRONIE PRZEGLĄDARKI: tamten skrypt
//      liczy domknięcie statyczne z grafu chunków (więc leniwych chunków
//      dociąganych W TRAKCIE bootu nie widzi w ogóle), ten liczy to, co karta
//      faktycznie pobrała. Dlaczego filtr jest po rozszerzeniu, a nie po
//      `initiatorType` - patrz stała `MAX_BOOT_JS_TRANSFER_KB`, tam jest pomiar;
//   4. FCP z `PerformancePaintTiming` - pierwszy moment, który czytelnik
//      odczuwa jako „strona się pojawiła". Od 2026-09-03 BRAMKOWANY, wraz
//      z jego składnikiem paintowym (FCP minus TTFB) - uzasadnienie
//      i arytmetyka przy `MAX_FCP_MS`.
//
// PLUS DRUGI TEST W TYM PLIKU: TTFB rozdzielnie na HIT i MISS cache'u
// dokumentów. Próg zbiorczy `MAX_TTFB_MS` nie mówi, którą z tych dwóch ścieżek
// zmierzył - a przy 5 sekundach to pytanie rozstrzyga, czy jest to cena
// pierwszej wizyty, czy KAŻDEJ.
//
// CENA: zmierzone 7,0 s w pełnym przebiegu `test:e2e:artifact` - z czego ~5,1 s
// to budżet zapytań SSR, a nie koszt samego pomiaru. Bez drugiego builda i bez
// drugiego serwera; oba pliki jadą na tym samym procesie.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { staticBootAssets, type BootAssetChunk } from "../scripts/lib/staticBootAssets";

// ── PROGI ───────────────────────────────────────────────────────────────────
//
// WSZYSTKIE progi są TUTAJ, każdy z pomiarem, z którego wynika. Zasada, którą
// się tu trzymam: bramkować DOWODLIWIE, a nie życzeniowo.
//
// SKĄD LICZBY BAZOWE. Host deweloperski tego repozytorium (sandbox, ten sam,
// na którym stoi `bun run dev`), artefakt `bun run build:smoke`, Chromium
// z `/opt/pw-browsers`, trasa `/cookies`, zaślepki Supabase takie jak w CI.
// Dwa TRYBY uruchomienia, pięć przebiegów: SAM TEN PLIK (`playwright test ...
// boot-timing`) i PEŁNA konfiguracja artefaktu (`bun run test:e2e:artifact`).
// Zmierzone wartości są wpisane przy każdej stałej i w tabeli niżej.
//
// SKĄD ZAPAS. Pierwsze progi powstały przed pomiarem na runnerze. Późniejsze
// przebiegi CI są zapisane w kronice poniżej; aktualny dowód dla PR znajduje
// się w docs/PLATFORM_SSR_REMEDIATION_2026-09-06.md. Czas zależy od obciążenia
// maszyny, a transfer dynamicznych importów również od kolejności pobrań.
// Dlatego pojedynczy szybki przebieg nie uzasadnia zacieśnienia wszystkich
// progów. Statyczną wagę startu osobno wymusza `scripts/check-bundle-size.ts`.
//
// ZASADA RATCHETU (jak w `scripts/check-bundle-size.ts`): te progi wolno
// WYŁĄCZNIE obniżać po zmierzeniu na runnerze. Podniesienie wymaga wpisu
// z przyczyną, dokładnie tak jak przy floorach bundla.

/**
 * TTFB dokumentu (`responseStart - requestStart`).
 *
 * TA LICZBA JEST WIĘKSZA, NIŻ WYGLĄDA NA ROZSĄDNĄ, I MA POWÓD. Zmierzone:
 * 5075,6 - 5194,9 ms w sześciu przebiegach. To nie jest wolny render - to
 * `SSR_QUERY_TIMEOUT_MS` = 5 000 ms z `lib/ssr/queryTimeout.ts`. Boot-test jedzie
 * z zaślepkami Supabase (`https://placeholder.supabase.co`, tak samo jak w CI),
 * więc DZIESIĘĆ zapytań loaderów korzenia nie ma dokąd pójść i render czeka na
 * cały budżet, po czym `postRenderSweep` je przycina (widać to w logu serwera:
 * `pruned=10`). Progu NIE WOLNO więc stawiać pod 5 000 - byłby bramką na to,
 * że w środowisku testowym nie ma bazy, a nie na wydajność artefaktu.
 *
 * CZEGO WIĘC PILNUJE. Jednego, bardzo konkretnego regresu: SZEREGOWANIA
 * BUDŻETÓW. Jeden budżet 5 s to 5 s; dwie fale loaderów w serii to 10 s, trzy
 * to 15 s - i to jest awaria, która na produkcji z żywą bazą przekłada się na
 * TTFB rzędu sekund, a nie milisekund. 8 000 ms leży między jednym budżetem
 * (zmierzone do 5 194,9) i dwoma (10 000), czyli dokładnie tam, gdzie oddziela
 * „czekamy raz" od „czekamy dwa razy po kolei".
 *
 * KIEDY TO PRZEFLOOROWAĆ. Gdy artefakt zacznie w CI dostawać PRAWDZIWE sekrety
 * Supabase (dziś `secrets.SUPABASE_URL || 'https://placeholder.supabase.co'`),
 * TTFB spadnie do czasu realnego renderu i próg trzeba będzie zaciąć o rząd
 * niżej. Do tego czasu ta liczba jest uczciwie luźna, nie ambitnie fałszywa.
 */
const MAX_TTFB_MS = 8_000;

/**
 * Czas od `__nesBootT0` do `__nesAppReady === true`.
 *
 * ZMIERZONE: 461 - 616 ms w sześciu przebiegach, za każdym razem
 * `readyExact=true`, czyli z przechwyconego przypisania, nie z odpytywania.
 * Próg 6 000 ms to ~9,7-krotność najgorszego z tych pomiarów.
 *
 * SKĄD AŻ TYLE ZAPASU - dwa niezależne powody, oba sprawdzone:
 *   * hydratacja jest jedyną z tych czterech liczb, która zależy WYŁĄCZNIE od
 *     CPU (parsowanie i wykonanie 33-37 plików JS, render Reacta). Runner
 *     nie gwarantuje stałej wydajności CPU. Pomiary z hosta i runnera są
 *     zapisane poniżej; próg zachowuje zapas na ich zmienność;
 *   * górna granica jest ZAKOTWICZONA, nie wybrana: sonda bootu uznaje boot za
 *     MARTWY po `BOOT_DEAD_TIMEOUT_MS` = 15 000 ms
 *     (`lib/observability/bootProbeScript`), a `boot-artifact.spec.ts` czeka na
 *     flagę 60 s. Próg musi zostać PONIŻEJ 15 000, żeby te trzy sygnały nie
 *     nakładały się na siebie i żeby awaria budżetu nie wyglądała jak martwa
 *     hydratacja.
 */
const MAX_READY_MS = 6_000;

/**
 * Transfer CAŁEGO JS-u pobranego do momentu gotowości, w kilobajtach.
 *
 * FILTR JEST PO ROZSZERZENIU, NIE PO `initiatorType` - I TO JEST POPRAWKA
 * Z POMIARU, nie swoboda interpretacji. Zlecenie mówiło „suma `transferSize`
 * zasobów `initiatorType === "script"`" i tak było napisane pierwsze podejście.
 * Zmierzone (host deweloperski, artefakt smoke, `/cookies`) rozbicie
 * WSZYSTKICH zasobów po `initiatorType`:
 *
 *   script: n=22  transfer 313 674 B   <- WYŁĄCZNIE importy dynamiczne
 *   other:  n=13  transfer 2 039 910 B <- CAŁE domknięcie statyczne bootu
 *   link:   n=3   transfer 616 024 B   <- CSS i fonty, ani jednego `.js`
 *
 * W wiadrze `other` leżą: `index-*.js` (924 353 B), `vendor-react`,
 * `vendor-tanstack`, `vendor-supabase`, `vendor-radix`, `vendor-lucide`,
 * `vendor-zod`, `vendor-i18n`, `vendor-tw-merge`, chunk trasy `cookies-*.js`
 * oraz `card`/`badge`. Czyli DOKŁADNIE to, co `scripts/check-bundle-size.ts`
 * nazywa domknięciem bootu - a `initiatorType === "script"` tego NIE WIDZI
 * (Chromium tak klasyfikuje moduły pobrane przez skaner preloadu dokumentu,
 * nie przez wykonanie `import()`). Bramkowanie samego `script` mierzyłoby więc
 * 13% właściwej liczby i rosłoby, gdy ścieżka bootowania się KURCZY.
 * Aktualizacja 2026-09-06: po włączeniu modulepreload CI raportuje także
 * statyczne moduły jako `script`. Podział statyczne/dynamiczne jest teraz
 * wyprowadzany z grafu builda, nigdy z initiatorType.
 *
 * ZMIERZONA SUMA: 2 270,1 - 2 294,2 KB (statyczne stale 1 965,9 KB w 12 plikach
 * + dynamiczne 304,1 - 328,2 KB), `decoded` równe transferowi (iloraz x1,00),
 * czyli artefakt `node-server` serwuje statyki BEZ KOMPRESJI - sprawdzone tą
 * właśnie parą liczb, nie założone. Liczba jest zatem porównywalna z kolumną RAW
 * z `check:bundle` (tam domknięcie bootu to ~1 876-2 179 KB raw; różnica to
 * ~300 B nagłówków na zasób plus chunki dociągane dynamicznie w trakcie bootu,
 * których statyczne domknięcie nie liczy), a NIE z floorem gzip 577 KB.
 * Test wypisuje `decoded` i iloraz na każdym przebiegu, żeby zmiana
 * konfiguracji kompresji na runnerze nie została odczytana jako regresja bajtów.
 *
 * PRÓG 3 000 KB to ~1,31-krotność najgorszego pomiaru (2 294,2 KB). Dla BAJTÓW zapas
 * mógłby być ciaśniejszy niż dla czasu (`check-bundle-size.ts` dokumentuje
 * rozbieżność host <-> runner rzędu 10 KB), ale nie tutaj i z konkretnego
 * powodu: dziś artefakt gada z zaślepką Supabase, więc widżety globalne
 * z loadera korzenia NIE renderują się i ich leniwe chunki nigdy się nie
 * dociągają. Gdy CI dostanie prawdziwe sekrety, wiadro DYNAMICZNE urośnie -
 * i to jest jedyna niepewność, której z tego hosta nie da się zmierzyć.
 */
const MAX_BOOT_JS_TRANSFER_KB = 3_000;

/**
 * `first-contentful-paint` z `PerformancePaintTiming` - PIERWSZY MOMENT, KTÓRY
 * CZYTELNIK ODCZUWA jako „strona się pojawiła".
 *
 * ODWRÓCENIE WCZEŚNIEJSZEJ DECYZJI TEGO PLIKU, powiedziane wprost. Do
 * 2026-09-03 stało tu, że FCP jest „ZMIERZONY, ŚWIADOMIE NIE BRAMKOWANY", bo
 * 91-95% jego wartości to czas serwera, a próg byłby „DRUGĄ, GŁOŚNIEJSZĄ KOPIĄ
 * bramki TTFB". (Samo „91-95%" było policzone tą samą wadliwą metodą, co dawne
 * „272 - 537 ms" - przez parowanie krańców dwóch niezależnych zakresów; z tych
 * zakresów wynika 88,5% - 97,1%. Szczegóły przy `MAX_PAINT_AFTER_TTFB_MS`.)
 * Ten argument był poprawny wtedy i JEST DZIŚ SŁABSZY z dwóch
 * niezależnych powodów:
 *   1. TTFB jest od dziś mierzony ROZDZIELNIE na HIT i MISS (osobny test
 *      niżej), więc „ta sama regresja" przestała być tym samym zdaniem;
 *   2. sam PAINT - czyli FCP minus TTFB - nie był bramkowany przez NIC, a to
 *      jedyna z czterech liczb, która rośnie od arkusza stylów blokującego
 *      render. Bramka na FCP przy stałym TTFB łapie dokładnie tę klasę.
 * Poprzednia wersja odmawiała nawet asercji NA OBECNOŚĆ liczby, uzasadniając
 * to brakiem pomiaru z runnera. Ten powód jest wydany: pomiar z runnera stoi
 * w kronice niżej (5 272,0 ms).
 *
 * ARYTMETYKA. Próg jest ZAKOTWICZONY w istniejącej stałej, nie wybrany:
 *   MAX_FCP_MS = MAX_TTFB_MS + 1 000 ms = 9 000 ms.
 * Czyli „dokument zdążył w swoim budżecie, plus sekunda na paint". Zmierzone
 * zapasy: 9 000 / 5 272,0 = 1,71x (runner) i 9 000 / 5 748,0 = 1,57x (host,
 * pomiar z 2026-09-03) - w tym samym przedziale, co pozostałe progi tego pliku
 * (1,17x - 16,9x). Kluczowe: 9 000 nadal leży PONIŻEJ dwóch szeregowych
 * budżetów zapytań SSR (2 x 5 000 = 10 000), więc bramka zachowuje to samo
 * znaczenie, co bramka TTFB - „czekamy raz" kontra „czekamy dwa razy".
 *
 * KIEDY TO PRZEFLOOROWAĆ: razem z MAX_TTFB_MS, gdy artefakt w CI dostanie
 * prawdziwe sekrety Supabase. Wtedy oba progi schodzą o rząd, a składnik
 * paintowy zostaje.
 *
 * POTWIERDZONE CZTEREMA POMIARAMI Z RUNNERA po postawieniu progu (2026-09-03
 * po południu): FCP 5 296,0 / 5 308,0 / 5 356,0 / 5 264,0 ms, zapas 1,70x /
 * 1,70x / 1,68x / 1,71x - dokładnie tam, gdzie wyliczyła arytmetyka wyżej
 * z jednego starszego logu. Próg nie jest zacieśniany: rządzi nim najgorszy
 * pomiar z hosta (5 748,0 ms, zapas 1,57x).
 */
const MAX_FCP_MS = MAX_TTFB_MS + 1_000;

/**
 * SAM PAINT, czyli FCP MINUS TTFB - jedyna liczba w tym pliku, która NIE
 * zawiera czasu serwera.
 *
 * PO CO ODDZIELNY PRÓG, skoro FCP już ma sufit. Bo bez niego zarzut, który ten
 * plik sam sobie postawił (próg na FCP jest „DRUGĄ, GŁOŚNIEJSZĄ KOPIĄ bramki
 * TTFB"), byłby trafny: przy TTFB rzędu 5 s paint to 4-12% wartości FCP, więc
 * regresja samego paintu schowałaby się w zapasie progu FCP. A paint jest
 * DOKŁADNIE tym składnikiem, który rośnie od ARKUSZA BLOKUJĄCEGO RENDER -
 * czyli od rzeczy, której pilnuje floor `css` w `scripts/check-bundle-size.ts`
 * i która ma dziś poniżej 1% zapasu. Ta para progów bramkuje więc dwie
 * NIEZALEŻNE przyczyny jednym pomiarem.
 *
 * PRÓG 2 000 ms, I DLACZEGO NIE 1 000.
 *
 * NAJPIERW O METODZIE, bo poprzednia wersja tego akapitu liczyła ŹLE i wolę to
 * zapisać, niż poprawić po cichu. Stało tu „272 - 537 ms na hoście", wyliczone
 * przez odjęcie KRAŃCÓW DWÓCH NIEZALEŻNYCH ZAKRESÓW z sześciu przebiegów
 * (FCP 5 348,0 - 5 732,0 minus TTFB 5 075,6 - 5 194,9). To nie jest zakres
 * różnicy: z dwóch niezależnych zakresów wynika tylko 153,1 - 656,4 ms, i to
 * przy założeniu, że skrajne wartości wypadły w tych samych przebiegach - czego
 * nikt nie zapisał. Różnicę wolno liczyć WYŁĄCZNIE W PARZE, z jednego przebiegu.
 *
 * PARY Z JEDNEGO PRZEBIEGU (2026-09-03, trzy przebiegi `test:e2e:artifact`,
 * FCP i TTFB z TEJ SAMEJ nawigacji):
 *   5 748,0 - 5 080,2 = 667,8 ms
 *   5 500,0 - 5 112,2 = 387,8 ms
 *   5 424,0 - 5 038,2 = 385,8 ms
 *   5 744,0 - 5 045,9 = 698,1 ms
 *   5 420,0 - 5 084,3 = 335,7 ms   <- dołożona 2026-09-03 po południu
 * Zakres SAMEGO PAINTU: 335,7 - 698,1 ms na pięciu parach (przed piątym
 * pomiarem stało tu 385,8 - 698,1). Do tego CZTERY pary z runnera: 241,9 ms
 * (5 272,0 - 5 030,1), 253,2 ms, 266,2 ms i 312,5 ms - każda z jednego
 * przebiegu, więc policzone poprawnie.
 *
 * PRÓG. 2 000 / 698,1 = 2,86x najgorszej ZMIERZONEJ W PARZE wartości
 * (rozrzut 335,7 - 698,1 ms na pięciu parach to 2,1x - sam paint jest tu
 * najbardziej rozrzuconą z mierzonych liczb, bo zależy wyłącznie od CPU).
 * Pierwotnie postawiłem 1 000 ms i następny pomiar zostawił na nim 1,50x - za
 * mało dla metryki zależnej od CPU na maszynie bez gwarancji sąsiedztwa: taki
 * próg jest bramką na kontencję runnera, nie na wagę arkusza. Przy 667,8 ms
 * gotowość hydratacji wyszła 735 ms, a przy 698,1 ms - 738 ms, wobec
 * 461 - 616 ms z 2026-09-01, czyli host
 * był tego dnia wolniejszy i paint pojechał razem z nim - dowód empiryczny, że
 * ta liczba mierzy też CPU. 2 000 ms nadal łapie klasę regresji, o którą tu
 * chodzi: podwojenie arkusza blokującego render to setki ms, nie dziesiątki.
 *
 * CZTERY PARY Z RUNNERA (2026-09-03 po południu): 253,2 / 266,2 / 312,5 /
 * 224,4 ms. Zakres 224,4 - 312,5 ms, rozrzut 1,39x, średnia 264,1 ms - wobec
 * 335,7 - 698,1 ms i rozrzutu 2,08x na hoście. Runner jest tu szybszy od hosta
 * 2,23x licząc kraniec do krańca (698,1 / 312,5) albo 1,87x licząc średnią do
 * średniej (495,0 / 264,1); podaję oba, bo mnożnik bez powiedzenia, co dzieli
 * co, jest dokładnie tym błędem, który ten plik prostuje wyżej.
 *
 * SPROSTOWANIE WŁASNEJ LICZBY, I TO SAMO ZDANIE PROSTOWANE DWA RAZY PO KOLEI -
 * co jest tu najważniejszą informacją, nie zawstydzeniem. Po DWÓCH parach
 * stało tu, że paint na runnerze jest „powtarzalny do 13 ms" (253,2 vs 266,2).
 * Trzecia para dała 312,5 ms - rozrzut 59,3 ms, cztery i pół raza więcej niż
 * moja własna miara powtarzalności; napisałem wtedy „rozrzut 1,23x" i regułę
 * „dwa punkty nie są rozkładem, zbierz pięć". CZWARTA para dała 224,4 ms
 * i rozrzut poszedł na 1,39x - czyli liczba, którą podałem PO sprostowaniu,
 * też się nie utrzymała.
 *
 * Wniosek JAKOŚCIOWY trzyma się przez wszystkie cztery: 1,39x na runnerze wobec
 * 2,08x na hoście, więc runner jest istotnie ciaśniejszy. Ale KAŻDA konkretna
 * liczba rozrzutu, którą tu wpisałem, przeżyła dokładnie jedną próbkę. To
 * czwarty raz w tym repozytorium ta sama klasa pomyłki (parowanie krańców przy
 * paincie wyżej, jeden pomiar niedeterministycznego pokrycia przy progu
 * `__root.tsx` w `vitest.config.ts`, „13 ms", teraz „1,23x") - więc reguła
 * „zbierz pięć" stoi w mocy i sam nadal jej nie spełniam. NIE wyprowadzaj
 * z tych czterech par żadnego progu; próg paintu stoi na pomiarze z HOSTA.
 *
 * Próg ZOSTAJE na 2 000 ms i NIE jest zacieśniany do liczby z runnera: rządzi
 * nim najgorszy pomiar (host, 698,1 ms, zapas 2,86x), nie najlepszy - inaczej
 * byłaby to bramka na kontencję hosta dewelopera. Tabele wszystkich przebiegów
 * - w kronice niżej.
 */
const MAX_PAINT_AFTER_TTFB_MS = 2_000;

// ── ZMIERZONE WARTOŚCI BAZOWE - HOST I RUNNER ──────────────────────────────
// Wpisane jako komentarz, nie jako asercja: to punkt odniesienia dla następnej
// osoby, która będzie te progi zacieśniać.
//
// PIERWSZY POMIAR Z RUNNERA GITHUBA (2026-09-01, przebieg 33512138238, job
// `build`, head `71b5dc8` - pierwszy przebieg, w którym ten krok w ogóle się
// wykonał; wcześniej był SKIPPED za czerwoną bramką bundla):
//
//   [boot-timing] TTFB=5030.1ms ready=356ms (exact=true)
//                 bootJS=2562.8KB/66 (statyczne 1982.3KB/12 + dynamiczne 580.5KB/54)
//                 decoded=2543.5KB (x0.99) FCP=5272.0ms
//
//   POMIAR    RUNNER       PRÓG        KROTNOŚĆ ZAPASU
//   TTFB      5030,1 ms    8000 ms     1,59x
//   READY       356   ms   6000 ms    16,9x
//   bootJS    2562,8 KB    3000 KB     1,17x
//   FCP       5272,0 ms    9000 ms     1,71x
//
// DWA WNIOSKI Z TEGO POMIARU, oba nieoczywiste przed nim:
//
// 1. RUNNER JEST SZYBSZY OD HOSTA, nie wolniejszy - gotowość 356 ms wobec
//    461-616 ms. Zakładałem odwrotnie, stawiając progi „z zapasem na wolniejszy
//    runner"; dla dwóch metryk czasowych zapas okazał się jeszcze większy.
//
// 2. I WŁAŚNIE DLATEGO TRANSFER WYSZEDŁ WYŻSZY: 2562,8 KB wobec 2270-2294 KB
//    na hoście. Wiadro STATYCZNE jest praktycznie identyczne (1982,3 KB/12 vs
//    1965,9 KB/12), a cała różnica siedzi w DYNAMICZNYM: 580,5 KB w 54 plikach
//    wobec 304,1 KB w 21. Szybsza maszyna zdąża dociągnąć więcej leniwych
//    chunków PRZED flagą gotowości, więc ta metryka rośnie ze SZYBKOŚCIĄ
//    MASZYNY, a nie z wagą artefaktu.
//    KONSEKWENCJA DLA PROGU: `MAX_BOOT_JS_TRANSFER_KB` ZOSTAJE na 3000 i NIE
//    jest zacieśniany, choć zapas spadł z zaprojektowanych 1,31x do 1,17x.
//    Zacieśnienie karałoby za szybszy runner, czyli mierzyłoby nie to, co ma.
//    Metryką, która pilnuje WAGI artefaktu, jest floor `boot` w
//    `scripts/check-bundle-size.ts` (domknięcie statyczne, gzip) - i wiadro
//    statyczne tego pomiaru potwierdza go niezależnie, bo jest stałe.
//
// 2026-09-01, artefakt `vite.smoke.config.ts`, `/cookies`, zaślepki Supabase.
// SZEŚĆ przebiegów (trzy razy sam ten plik, trzy razy pełne `test:e2e:artifact`),
// podane jako ZAKRESY, bo pojedyncza wartość udawałaby powtarzalność, której
// tu nie ma:
//
//   POMIAR    ZAKRES Z 6 PRZEBIEGÓW (HOST)  PRÓG       KROTNOŚĆ ZAPASU
//   TTFB      5075,6 - 5194,9 ms           8000 ms     1,54x
//   READY      461   -  616   ms           6000 ms     9,7x
//   bootJS    2270,1 - 2294,2 KB           3000 KB     1,31x
//   FCP       5348,0 - 5732,0 ms           9000 ms     1,57x
//
// SIÓDMY PRZEBIEG Z HOSTA (2026-09-03, `bun run test:e2e:artifact`, ten sam
// artefakt `build:smoke`) - wpisany, bo ROZSZERZA zakres w dwóch metrykach
// i to on wyznaczył próg paintu:
//
//   [boot-timing] TTFB=5080.2ms ready=735ms (exact=true)
//                 bootJS=2649.0KB/62 (statyczne 2098.8KB/12 + dynamiczne 550.3KB/50)
//                 decoded=2630.9KB (x0.99) FCP=5748.0ms
//
//   POMIAR      2026-09-03    PRÓG        KROTNOŚĆ ZAPASU
//   TTFB        5080,2 ms     8000 ms     1,57x
//   READY         735   ms    6000 ms     8,2x    <- POZA zakresem 461-616
//   bootJS      2649,0 KB     3000 KB     1,13x   <- POZA zakresem 2270-2294
//   FCP         5748,0 ms     9000 ms     1,57x   <- POZA zakresem 5348-5732
//   sam paint    667,8 ms     2000 ms     3,0x    <- POZA zakresem 272-537
//
// CO Z TEGO WYNIKA, powiedziane wprost: host był tego dnia WOLNIEJSZY (gotowość
// 735 ms wobec 461-616), a paint pojechał razem z nim - 667,8 ms wobec
// 272-537 ms. To jest dowód empiryczny na to, że paint zależy od CPU, i powód,
// dla którego jego próg stoi na 2 000 ms, a nie na 1 000 ms (pierwsza wersja
// tego wpisu stawiała 1 000 i ten sam pomiar zostawiłby na nim 1,50x zapasu -
// czyli bramkę na kontencję maszyny, nie na wagę arkusza).
// bootJS 2649,0 KB przy 62 plikach potwierdza też ustalenie #2 z runnera:
// metryka rośnie z liczbą dociągniętych leniwych chunków, nie z wagą artefaktu.
//
// Rozrzut NIE koreluje ani z trybem uruchomienia, ani z kolejnością plików
// (Playwright ustawiał `boot-timing` raz jako pierwszy, raz jako drugi, a
// skrajne wartości wypadły w różnych trybach) - to szum hosta, nie efekt
// rozgrzania serwera.
//
// Rozbicie bootJS: wiadro STATYCZNE to 1965,9 KB w 12 plikach i jest IDENTYCZNE
// co do 0,1 KB we wszystkich sześciu przebiegach - cała zmienność (304,1 do
// 328,2 KB, 21 do 25 plików) siedzi w wiadrze dynamicznym. To najlepsza
// dostępna miara szumu tego pomiaru: bajty domknięcia statycznego są stałe,
// bajty leniwych chunków zależą od tego, co zdąży się dociągnąć do gotowości.
// `decoded` równe transferowi (iloraz x1,00) w każdym przebiegu.
//
// ── 2026-09-03: FCP DOSTAJE PRÓG; TTFB ROZDZIELONY NA HIT I MISS ────────────
//
// FCP. Podstawą jest PIERWSZY POMIAR Z RUNNERA wpisany wyżej (5 272,0 ms,
// przebieg 33512138238) i sześć przebiegów z hosta (5 348,0 - 5 732,0 ms).
// Kolumna „PRÓG" w obu tabelach wyżej miała dla FCP wartość `brak` - jedyna
// z czterech metryk bez sufitu, i jednocześnie ta, którą czytelnik ODCZUWA.
// Wyprowadzenie (nie wybór):
//   MAX_FCP_MS = MAX_TTFB_MS + MAX_PAINT_AFTER_TTFB_MS = 8 000 + 1 000 = 9 000
// Zapas wobec runnera 1,71x, wobec najgorszego pomiaru z hosta 1,57x - czyli
// w tym samym przedziale co pozostałe progi (1,17x - 16,9x).
//
// DOŁOŻONY DRUGI PRÓG, KTÓRY NIE JEST KOPIĄ TTFB: `MAX_PAINT_AFTER_TTFB_MS` na
// SAMYM paincie (FCP minus TTFB). To odpowiedź na własny wcześniejszy argument
// tego pliku, że próg na FCP byłby „DRUGĄ, GŁOŚNIEJSZĄ KOPIĄ bramki TTFB" -
// argument był trafny wobec surowego FCP i przestaje być trafny wobec różnicy:
// paint jest składnikiem, którego bramka TTFB nie widzi Z DEFINICJI, a rośnie
// od arkusza blokującego render. Zmierzone: 241,9 ms (runner: 5272,0 - 5030,1)
// i 272 - 537 ms (host); próg 1 000 ms to 1,86x najgorszego z nich.
// (DWIE POPRAWKI DO TEGO ZDANIA, zostawionego bo pokazuje kolejność ustaleń.
// Para z runnera 241,9 ms jest POPRAWNA - policzona z jednego przebiegu. Zakres
// „272 - 537 ms (host)" NIE - powstał z parowania krańców dwóch niezależnych
// zakresów; sprostowanie przy `MAX_PAINT_AFTER_TTFB_MS`, gdzie pary z jednego
// przebiegu dają 335,7 - 698,1 ms. Próg stoi dziś na 2 000 ms, nie 1 000.
// Par z runnera są dziś TRZY: 241,9 / 253,2 / 266,2 ms.)
//
// TTFB HIT/MISS - ROZSTRZYGNIĘTE POMIAREM, i to jest najważniejsza liczba
// tego wpisu. Zlecenie wydania 9 pytało, czy 5 030,1 ms to cena pierwszej
// wizyty, czy KAŻDEJ, i stawiało dwie hipotezy: „HIT o rząd niższy" =>
// próg zbiorczy mierzy wyłącznie MISS; „HIT podobny" => cache dokumentów nie
// działa tak, jak go opisuje `documentCache.ts`, i to jest znalezisko wagi
// blokującej.
//
// ZMIERZONE 2026-09-03 (host, artefakt `build:smoke`, `bun run test:e2e:artifact`):
//
//   [boot-timing-cache] 1: MISS TTFB=5051.1ms | 2: HIT TTFB=8.3ms
//   [boot-timing-cache] 1: MISS TTFB=5039.1ms | 2: HIT TTFB=3.7ms
//   [boot-timing-cache] 1: MISS TTFB=5033.4ms | 2: HIT TTFB=3.8ms
//
//   ŚCIEŻKA   TTFB (3 PRZEBIEGI)     KROTNOŚĆ RÓŻNICY
//   MISS      5033,4 - 5051,1 ms     -
//   HIT           3,7 -    8,3 ms    608x - 1362x NIŻSZY
//
// WYGRYWA PIERWSZA HIPOTEZA, i to nie „o rząd", a o TRZY RZĘDY. Wnioski, oba
// nazwane wprost, bo oba zmieniają czytanie progu wyżej:
//
// 1. `MAX_TTFB_MS` = 8 000 ms MIERZY WYŁĄCZNIE MISS. Na HIT-cie ta bramka ma
//    zapas od 964x do 2162x i nie łapie niczego - regresja ścieżki odtworzenia (np. utrata
//    `x-nes-cache`, wypadnięcie middleware z listy) byłaby dla niej
//    niewidoczna. Dlatego HIT ma od teraz WŁASNY strażnik w teście niżej.
// 2. CACHE DOKUMENTÓW DZIAŁA tak, jak opisuje go `documentCache.ts` - drugie
//    żądanie o ten sam klucz nie renderuje ponownie. Znaleziska wagi
//    blokującej NIE MA i to jest odpowiedź na pytanie zlecenia.
//
// 5 sekund jest więc ceną PIERWSZEJ wizyty na zimny klucz (a w tym środowisku
// to prawie w całości `SSR_QUERY_TIMEOUT_MS` na zaślepce Supabase), nie ceną
// każdej. Progu na HIT nie zacieśniałem wtedy poniżej `MAX_TTFB_MS / 2`, bo
// pomiaru z RUNNERA dla tego rozbicia nie było ani jednego, i zapisałem tu, że
// pierwszy zielony log CI (`[boot-timing-cache] ...`) będzie podstawą liczby
// rzędu zmierzonych 8,3 ms. TEN WARUNEK JEST SPEŁNIONY - logi runnera stoją
// w akapicie niżej, a próg został zdjęty do `MAX_TTFB_MS / 16`. Zapis
// pozostawiony w kronice, żeby było widać, że to nie jest liczba dobrana
// po fakcie do wyniku.
//
// ── 2026-09-03, PO POŁUDNIU: POMIARY Z RUNNERA DLA NOWYCH PROGÓW ───────────
//
// Progi `MAX_FCP_MS`, `MAX_PAINT_AFTER_TTFB_MS` i rozbicie HIT/MISS zostały
// postawione WYŁĄCZNIE na pomiarach z hosta plus jeden stary log runnera
// (33512138238, sprzed rozbicia HIT/MISS). Poniżej PIERWSZE CZTERY przebiegi CI,
// w których nowy kształt tego pliku faktycznie się wykonał - a więc pierwsze
// liczby runnera dla samego paintu ORAZ pierwsze W OGÓLE dla HIT-a:
//
//   PRZEBIEG 33763700986, job `build`, krok „Boot test and first-load timing":
//   [boot-timing] TTFB=5042.8ms ready=641ms (exact=true)
//                 bootJS=2508.6KB/46 (statyczne 2098.9KB/12 + dynamiczne 409.7KB/34)
//                 decoded=2495.1KB (x0.99) FCP=5296.0ms
//   [boot-timing-cache] 1: MISS TTFB=5025.4ms | 2: HIT TTFB=3.1ms
//
//   PRZEBIEG 33765187255, head `2e1bdbd5e`, ten sam krok:
//   [boot-timing] TTFB=5041.8ms ready=573ms (exact=true)
//                 bootJS=2405.0KB/34 (statyczne 2098.9KB/12 + dynamiczne 306.1KB/22)
//                 decoded=2395.1KB (x1.00) FCP=5308.0ms
//   [boot-timing-cache] 1: MISS TTFB=5027.7ms | 2: HIT TTFB=2.8ms
//
//   PRZEBIEG 33768894559, head `84b9d75e9`, ten sam krok:
//   [boot-timing] TTFB=5043.5ms ready=674ms (exact=true)
//                 bootJS=2402.8KB/33 (statyczne 2098.9KB/12 + dynamiczne 303.9KB/21)
//                 decoded=2393.2KB (x1.00) FCP=5356.0ms
//   [boot-timing-cache] 1: MISS TTFB=5026.5ms | 2: HIT TTFB=2.3ms
//
//   PRZEBIEG 33770195154, head `47dcef06a`, ten sam krok:
//   [boot-timing] TTFB=5039.6ms ready=462ms (exact=true)
//                 bootJS=2543.8KB/48 (statyczne 2098.9KB/12 + dynamiczne 444.8KB/36)
//                 decoded=2529.7KB (x0.99) FCP=5264.0ms
//   [boot-timing-cache] 1: MISS TTFB=5020.4ms | 2: HIT TTFB=2.4ms
//
//   POMIAR      RUNNER #1  RUNNER #2  RUNNER #3  RUNNER #4  PRÓG     NAJCIAŚNIEJSZY ZAPAS
//   TTFB        5042,8 ms  5041,8 ms  5043,5 ms  5039,6 ms  8000 ms  1,59x
//   READY         641   ms   573   ms   674   ms   462   ms 6000 ms  8,9x
//   bootJS      2508,6 KB  2405,0 KB  2402,8 KB  2543,8 KB  3000 KB  1,18x  <- NAJCIAŚNIEJSZY W PLIKU
//   FCP         5296,0 ms  5308,0 ms  5356,0 ms  5264,0 ms  9000 ms  1,68x
//   sam paint    253,2 ms   266,2 ms   312,5 ms   224,4 ms  2000 ms  6,4x
//   TTFB MISS   5025,4 ms  5027,7 ms  5026,5 ms  5020,4 ms  8000 ms  1,59x
//   TTFB HIT        3,1 ms     2,8 ms     2,3 ms     2,4 ms  500 ms  161x
//
// Sam paint policzony W PARZE, z jednej nawigacji: 5296,0 - 5042,8 = 253,2 ms,
// 5308,0 - 5041,8 = 266,2 ms, 5356,0 - 5043,5 = 312,5 ms,
// 5264,0 - 5039,6 = 224,4 ms.
//
// TRZY USTALENIA, każde zmieniające czytanie progu wyżej:
//
// 1. `MAX_PAINT_AFTER_TTFB_MS` ZOSTAJE na 2 000 ms, choć runner daje na nim
//    6,4x - 7,9x zapasu. Nie obniżam, bo progiem rządzi NAJGORSZY pomiar,
//    a ten jest z HOSTA (698,1 ms, zapas 2,86x), nie z runnera. Runner jest
//    dla paintu szybszy 2,23x kraniec do krańca (698,1 / 312,5) i 1,79x
//    średnia do średniej (495,0 / 277,3) - dokładnie ta sama asymetria, którą
//    ustalenie #1 z 2026-09-01 opisało dla gotowości hydratacji. Zejście do liczby
//    wyprowadzonej z runnera zrobiłoby z tej bramki bramkę na kontencję
//    hosta dewelopera.
//
// 2. PAINT NA RUNNERZE JEST CIAŚNIEJSZY NIŻ NA HOŚCIE, ALE NIE „POWTARZALNY" -
//    i to jest SPROSTOWANIE tego, co stało tu po dwóch przebiegach. Miałem
//    wtedy 253,2 i 266,2 ms i napisałem „powtarzalny z dokładnością do 13 ms".
//    Trzeci przebieg dał 312,5 ms, czyli rozrzut 59,3 ms - cztery i pół raza
//    więcej niż moja własna miara powtarzalności. Co się trzyma: 1,23x na
//    runnerze wobec 2,08x na hoście, więc rozrzut tej metryki NAPRAWDĘ jest
//    w dużej mierze szumem maszyny. Co nie: liczba 13 ms i słowo
//    „powtarzalny", bo były wnioskiem z DWÓCH punktów.
//    WNIOSEK DLA NASTĘPNEJ OSOBY: dwa punkty nie są rozkładem. Ten plik
//    popełnia tę pomyłkę po raz TRZECI (wcześniej: parowanie krańców przy
//    paincie, jeden pomiar niedeterministycznego pokrycia w `vitest.config.ts`),
//    więc jeśli chcesz z tych liczb wyprowadzić próg - zbierz ich pięć.
//
// 3. bootJS: wiadro STATYCZNE jest identyczne co do 0,1 KB w CZTERECH
//    przebiegach (2098,9 KB / 12 w każdym), a całość waha się 2402,8 - 2543,8 KB
//    wyłącznie wiadrem DYNAMICZNYM (303,9 KB/21 do 444,8 KB/36). To domyka
//    ustalenie #2 z 2026-09-01: metryka mierzy „ile leniwych chunków zdążyło
//    wejść przed flagą gotowości", nie wagę artefaktu.
//    UWAGA NA PRÓG: 2 543,8 KB to NAJWYŻSZY zmierzony transfer i zapas spadł
//    do 1,18x - najciaśniejszy w tym pliku. Progu 3 000 KB NIE podnoszę (tu
//    wolno tylko obniżać) i nie zacieśniam. Gdy zapas zejdzie pod ~1,10x,
//    właściwą reakcją NIE jest ruszanie tej liczby, a rozdzielenie jej na
//    wiadro statyczne (stałe, bramkowalne) i dynamiczne (zależne od maszyny) -
//    dzisiejsza pojedyncza suma miesza sygnał z szumem.
//
//    CZEGO TU NIE TWIERDZĘ, choć kusi. Najszybszy przebieg (ready 462 ms) ma
//    JEDNOCZEŚNIE największy bootJS (2 543,8 KB), co pasuje do hipotezy
//    „szybsza maszyna zdąży dociągnąć więcej". Ale uporządkowanie tych czterech
//    par NIE jest monotoniczne: 462 -> 2543,8 | 573 -> 2405,0 | 641 -> 2508,6 |
//    674 -> 2402,8. Przy 641 ms transfer jest WYŻSZY niż przy 573 ms, więc to
//    jest ZGODNE z hipotezą, a nie jej dowodem. Cztery punkty i złamana
//    monotoniczność nie są korelacją - ta sama reguła, którą ten plik łamał
//    już cztery razy.
//
// HIT-y z runnera: 2,3 / 2,4 / 2,8 / 3,1 ms - wszystkie o TRZY RZĘDY pod
// MISS-em (2185x / 2092x / 1796x / 1621x). Najgorszy zmierzony HIT to nadal
// 8,3 ms Z HOSTA i to on wyznacza zapas progu 500 ms (60x), nie te cztery.
//
// ── KIEDY PRZESTAĆ DOPISYWAĆ PRÓBKI: REGUŁA STOPU ───────────────────────────
//
// Każdy commit do tego pliku uruchamia CI, CI produkuje kolejną próbkę, próbka
// bywa poza zakresem, a zakres w komentarzu kusi, żeby go poprawić - i tak
// powstaje pętla, w której plik rośnie, a NIC SIĘ NIE ROZSTRZYGA. Cztery
// próbki wyżej wystarczyły, żeby ustalić trzy rzeczy, i to jest cały ich
// dorobek: (a) próg zbiorczy TTFB mierzy wyłącznie MISS, (b) cache dokumentów
// działa, (c) runner jest dla paintu istotnie ciaśniejszy od hosta, ale każda
// konkretna liczba rozrzutu przeżywa jedną próbkę.
//
// OD TEJ CHWILI kolejną próbkę wolno dopisać TYLKO wtedy, gdy zachodzi jedno
// z trzech:
//   1. PRZEKRACZA któryś próg (wtedy to nie kronika, a czerwona bramka);
//   2. zjada zapas poniżej ~1,10x na którejkolwiek metryce (dziś najciaśniej
//      jest na bootJS: 1,18x) - wtedy właściwą reakcją jest rozdzielenie
//      metryki, nie ruszanie progu;
//   3. obala wniosek JAKOŚCIOWY (a), (b) albo (c) - np. HIT w tym samym rzędzie
//      co MISS, albo paint na runnerze GORSZY niż na hoście.
// Sama nowa wartość w środku albo tuż poza zakresem NIE jest powodem do
// commitu. Zakresy wyżej są punktem odniesienia, nie rejestrem do uzupełniania.
//
// ÓSMY PRZEBIEG Z HOSTA, wykonany PO zejściu z progiem HIT-a - żeby nowa liczba
// nie poszła do CI niesprawdzona (2026-09-03, `bun run test:e2e:artifact`, ten
// sam artefakt, z czterema zmiennymi środowiska z `ci.yml:944-947`):
//
//   [boot-timing] TTFB=5084.3ms ready=468ms (exact=true)
//                 bootJS=2388.6KB/28 (statyczne 2098.8KB/12 + dynamiczne 289.8KB/16)
//                 decoded=2380.4KB (x1.00) FCP=5420.0ms
//   [boot-timing-cache] 1: MISS TTFB=5025.0ms | 2: HIT TTFB=3.5ms
//
//   POMIAR         2026-09-03 #8   PRÓG        ZAPAS
//   TTFB           5084,3 ms       8000 ms     1,57x
//   READY            468   ms      6000 ms    12,8x
//   bootJS         2388,6 KB       3000 KB     1,26x
//   FCP            5420,0 ms       9000 ms     1,66x
//   sam paint       335,7 ms       2000 ms     6,0x   <- POZA zakresem, W DÓŁ
//   TTFB HIT          3,5 ms        500 ms   143x
//
// Sam paint 5 420,0 - 5 084,3 = 335,7 ms - to ROZSZERZA zakres hosta W DÓŁ, do
// 335,7 - 698,1 ms (było 385,8 - 698,1). Progu to nie zmienia, bo progiem
// rządzi górny kraniec; wpisane, bo przemilczenie pomiaru, który rozszerza
// zakres, byłoby tym samym błędem, co parowanie krańców opisane wyżej.
//
// UWAGA METODOLOGICZNA, warta zapisania: przebieg BEZ tych czterech zmiennych
// oblewa CZTERY z pięciu testów (`page.waitForFunction` na `__nesAppReady`
// wychodzi w timeout, bo aplikacja nie kończy bootu), a test HIT/MISS
// przechodzi - z MISS-em 1 050,3 ms zamiast ~5 025 ms, bo bez `SUPABASE_URL`
// loader nie dochodzi do `SSR_QUERY_TIMEOUT_MS`, tylko pada od razu. Kto
// zobaczy tu czerwień, niech NAJPIERW sprawdzi środowisko, a nie progi.

/** Kopia PL z `src/routes/cookies.tsx` - dowód, że mierzymy stronę, a nie błąd. */
const UNDECIDED = "Nie zapisano jeszcze wyboru";

interface BootTiming {
  /** `responseStart - requestStart` z PerformanceNavigationTiming (ms). */
  ttfbMs: number;
  /** Od `__nesBootT0` do przypisania `__nesAppReady = true` (ms). */
  readyMs: number;
  /** Czy `readyMs` pochodzi z przechwyconego przypisania, czy z odpytania. */
  readyExact: boolean;
  /** Suma `transferSize` WSZYSTKICH pobranych plików `.js` (bajty). */
  bootJsTransferBytes: number;
  /** Suma `decodedBodySize` tych samych plików - daje iloraz kompresji. */
  bootJsDecodedBytes: number;
  /** Ile plików `.js` - bez tego suma nie mówi, czy to jeden plik, czy sto. */
  bootJsCount: number;
  /** Część z domknięcia STATYCZNEGO (entry + importy zapisane w grafie builda). */
  staticGraphBytes: number;
  /** Ile plików w domknięciu statycznym. */
  staticGraphCount: number;
  /** Pozostałe chunki pobrane podczas bootu (dynamiczne importy i preloady locale). */
  dynamicImportBytes: number;
  /** Ile plików z importów dynamicznych. */
  dynamicImportCount: number;
  /** `first-contentful-paint` z PerformancePaintTiming (ms) albo null. */
  fcpMs: number | null;
}

test("zbudowany artefakt mieści się w budżecie czasu pierwszego wczytania (/cookies)", async ({
  page,
}) => {
  // PRZECHWYCENIE MOMENTU GOTOWOŚCI. `markAppReady()` ustawia BOOLEAN, nie
  // znacznik czasu - i celowo, bo produkcyjna flaga ma być najtańszym możliwym
  // sygnałem. Żeby dostać CZAS, a nie „już/jeszcze nie", podmieniamy właściwość
  // na akcesor JESZCZE PRZED pierwszym skryptem dokumentu (`addInitScript`
  // wykonuje się przed wszystkim, także przed sondą w `<head>`).
  //
  // DLACZEGO NIE ODPYTYWANIE. `waitForFunction` odpytuje co klatkę i przez
  // protokół CDP, więc jego rozdzielczość to ~16 ms plus round-trip - przy
  // liczbach rzędu setek ms to kilkuprocentowy szum W SAMYM PRZYRZĄDZIE.
  // Akcesor daje dokładny moment przypisania. CENA: mierzymy dokument z jedną
  // podmienioną właściwością `window`. Zachowanie produkcyjne jest nietknięte -
  // getter zwraca dokładnie to, co zapisano, więc `bootProbeScript` (czyta
  // flagę w timerze martwego bootu) i `previewWatchdog` widzą to samo.
  await page.addInitScript(() => {
    const w = window as unknown as { __nesAppReady?: boolean; __nesReadyAt?: number };
    let stored: boolean | undefined;
    try {
      Object.defineProperty(window, "__nesAppReady", {
        configurable: true,
        get: () => stored,
        set: (next: boolean) => {
          stored = next;
          if (next === true && w.__nesReadyAt === undefined) w.__nesReadyAt = Date.now();
        },
      });
    } catch {
      // Gdyby środowisko tego nie pozwoliło, test nadal działa - zejdzie do
      // odpytywania (`readyExact === false`) i tylko straci rozdzielczość.
    }
  });

  // TYLKO `pageerror`, ŚWIADOMIE BEZ `console` - i to nie jest przeoczenie ani
  // niekonsekwencja wobec `boot-artifact.spec.ts`, który zbiera oba.
  //
  // Ten plik jest bramką BUDŻETU, sąsiedni jest bramką POPRAWNOŚCI. Gdyby oba
  // czytały `console.error`, każdy defekt poprawności zapalałby DWIE bramki na
  // czerwono, a druga wiadomość („nie mieścisz się w budżecie czasu") byłaby
  // wtedy nieprawdziwa i myląca. ZMIERZONE 2026-09-01 na tym artefakcie:
  // `boot-artifact.spec.ts` oblewa się na `console.error: Error reading query
  // stream: TypeError: Cannot read properties of undefined (reading
  // 'mutations')` - i to jest poprawne zachowanie TAMTEJ bramki, natomiast ta
  // ma w tym samym przebiegu przejść i podać liczby. Rzut na stronie (`pageerror`)
  // to inna sprawa: on unieważnia sam POMIAR, bo mierzyłby boot, który
  // częściowo padł - dlatego jest tu zbierany i sprawdzany na końcu.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));

  await page.goto("/cookies", { waitUntil: "load" });

  // BRAMA POPRAWNOŚCI PRZED POMIAREM. Bez niej test mierzyłby czas do gotowości
  // strony błędu 500 i przechodziłby na zielono tym szybciej, im gorzej.
  await expect(page.locator("#main-content").getByText(UNDECIDED, { exact: false })).toBeVisible();

  await page.waitForFunction(
    () => (window as unknown as { __nesAppReady?: boolean }).__nesAppReady === true,
    undefined,
    { timeout: 60_000 },
  );

  // Pomiar PO gotowości: dopiero wtedy zbiór pobranych skryptów jest domknięty
  // (chunki locale i leniwe wyspy dociągają się w trakcie bootu).
  const entries = await page
    .locator('script[type="module"][src]')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src));
  const inventory = JSON.parse(readFileSync("reports/chunk-inventory.json", "utf8")) as {
    chunks: BootAssetChunk[];
  };
  const staticPaths = staticBootAssets(inventory.chunks, entries);
  const timing: BootTiming = await page.evaluate((bootPaths: string[]) => {
    const w = window as unknown as { __nesBootT0?: number; __nesReadyAt?: number };
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    // WSZYSTKIE `.js`, NIEZALEŻNIE OD `initiatorType` - i to jest POPRAWKA
    // Z POMIARU, nie ostrożność. Mechanizm pobrania (script/link/other)
    // nie wyznacza krawędzi statycznego importu; te czytamy z grafu builda.
    const js = resources.filter((e) => new URL(e.name).pathname.endsWith(".js"));
    const bytes = (list: PerformanceResourceTiming[]) =>
      list.reduce((sum, e) => sum + e.transferSize, 0);
    const staticSet = new Set(bootPaths);
    const staticGraph = js.filter((e) => staticSet.has(new URL(e.name).pathname));
    const dynamicImports = js.filter((e) => !staticSet.has(new URL(e.name).pathname));
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const t0 = w.__nesBootT0 ?? 0;
    const readyAt = w.__nesReadyAt;
    return {
      ttfbMs: nav ? nav.responseStart - nav.requestStart : -1,
      readyMs: readyAt !== undefined ? readyAt - t0 : Date.now() - t0,
      readyExact: readyAt !== undefined,
      bootJsTransferBytes: bytes(js),
      bootJsDecodedBytes: js.reduce((sum, e) => sum + e.decodedBodySize, 0),
      bootJsCount: js.length,
      staticGraphBytes: bytes(staticGraph),
      staticGraphCount: staticGraph.length,
      dynamicImportBytes: bytes(dynamicImports),
      dynamicImportCount: dynamicImports.length,
      fcpMs: paint ? paint.startTime : null,
    };
  }, staticPaths);

  const bootJsKb = timing.bootJsTransferBytes / 1024;
  const staticKb = timing.staticGraphBytes / 1024;
  const dynamicKb = timing.dynamicImportBytes / 1024;
  const decodedKb = timing.bootJsDecodedBytes / 1024;
  const ratio = bootJsKb > 0 ? decodedKb / bootJsKb : 0;
  // Log jest CZĘŚCIĄ WARTOŚCI tego testu, nie ozdobą: dopóki nie ma ani jednej
  // liczby z runnera, przebieg CI jest jedynym sposobem, żeby ją zdobyć -
  // i musi ją WYPISAĆ także wtedy, gdy przechodzi.
  console.log(
    `[boot-timing] TTFB=${timing.ttfbMs.toFixed(1)}ms ` +
      `ready=${timing.readyMs}ms (exact=${timing.readyExact}) ` +
      `bootJS=${bootJsKb.toFixed(1)}KB/${timing.bootJsCount} ` +
      `(statyczne ${staticKb.toFixed(1)}KB/${timing.staticGraphCount} + ` +
      `dynamiczne ${dynamicKb.toFixed(1)}KB/${timing.dynamicImportCount}) ` +
      `decoded=${decodedKb.toFixed(1)}KB (x${ratio.toFixed(2)}) ` +
      `FCP=${timing.fcpMs === null ? "brak" : `${timing.fcpMs.toFixed(1)}ms`}`,
  );

  // 1. TTFB. `-1` znaczy „nawigacja nie zaraportowała się" - to awaria
  // przyrządu, nie wynik, i nie wolno jej przemilczeć zielonym testem.
  expect(timing.ttfbMs, "PerformanceNavigationTiming nie zaraportował nawigacji").toBeGreaterThan(
    -1,
  );
  expect(timing.ttfbMs, `TTFB ${timing.ttfbMs.toFixed(1)} ms > ${MAX_TTFB_MS} ms`).toBeLessThan(
    MAX_TTFB_MS,
  );

  // 2. CZAS DO GOTOWOŚCI. Dodatnia liczba jest częścią kontraktu: `__nesBootT0`
  // i `__nesReadyAt` idą z tego samego zegara (`Date.now()`), więc wartość
  // niedodatnia znaczy, że jedno z nich nie istnieje.
  expect(timing.readyMs, "znacznik startu albo gotowości nie istnieje").toBeGreaterThan(0);
  expect(
    timing.readyMs,
    `hydratacja gotowa po ${timing.readyMs} ms > ${MAX_READY_MS} ms`,
  ).toBeLessThan(MAX_READY_MS);

  // 3. TRANSFER ŚCIEŻKI BOOTOWANIA. Zero pobranych plików `.js` znaczy, że
  // dokument jest statycznym SSR-em - dokładnie tą awarią, którą pilnuje
  // `boot-artifact.spec.ts`. Tu wychodzi jako awaria przyrządu i tak jest
  // sprawdzane. Puste wiadro DYNAMICZNE sprawdzam osobno, bo to ono niesie
  // chunk locale i wyspy zgód: jego wyzerowanie znaczyłoby, że dokument
  // przestał je ciągnąć, a wtedy spadek sumy wyglądałby na poprawę.
  expect(timing.staticGraphCount, "dokument nie pobrał domknięcia statycznego").toBeGreaterThan(0);
  expect(timing.dynamicImportCount, "dokument nie wykonał importu dynamicznego").toBeGreaterThan(0);
  expect(
    bootJsKb,
    `transfer JS bootu ${bootJsKb.toFixed(1)} KB > ${MAX_BOOT_JS_TRANSFER_KB} KB`,
  ).toBeLessThan(MAX_BOOT_JS_TRANSFER_KB);

  // 4. FCP - CZWARTY TWARDY PRÓG (od 2026-09-03; uzasadnienie i arytmetyka
  //    przy `MAX_FCP_MS`).
  //
  // OBECNOŚĆ LICZBY JEST CZĘŚCIĄ KONTRAKTU. `null` znaczy „Chromium nie
  // zaraportował wpisu paintu" - to awaria przyrządu, nie wynik, i nie wolno
  // jej przemilczeć zielonym testem (ta sama doktryna co `ttfbMs === -1` wyżej).
  // Wcześniejsza wersja odmawiała nawet tej asercji; powód (brak pomiaru
  // z runnera) jest wydany - patrz kronika.
  expect(
    timing.fcpMs,
    "PerformancePaintTiming nie zaraportował `first-contentful-paint`",
  ).not.toBeNull();
  // `?? Number.POSITIVE_INFINITY` zamiast `!`: `e2e/**` jest POZA `include`
  // w `tsconfig.json`, więc `bun run typecheck` NIE sprawdza tego pliku i
  // wymuszenie typu nie miałoby tu żadnego strażnika. Nieskończoność oblewa
  // asercję niżej, czyli brak liczby nie przechodzi „bokiem".
  const fcpMs = timing.fcpMs ?? Number.POSITIVE_INFINITY;
  expect(fcpMs, `FCP ${fcpMs.toFixed(1)} ms > ${MAX_FCP_MS} ms`).toBeLessThan(MAX_FCP_MS);

  // 4b. SAM PAINT, czyli FCP MINUS TTFB. To jedyna z mierzonych tu liczb, która
  //     NIE zawiera czasu serwera - i jedyna, która rośnie, gdy arkusz stylów
  //     blokujący render tyje. Bez tego rozbicia próg na FCP byłby faktycznie
  //     tylko luźniejszą kopią bramki TTFB; z nim bramkujemy DWIE niezależne
  //     przyczyny jednym pomiarem. ZMIERZONE: 241,9 ms (runner) i 272 - 537 ms
  //     (host, sześć przebiegów); próg 1 000 ms to 1,86x najgorszego z nich.
  const paintOnlyMs = fcpMs - timing.ttfbMs;
  expect(
    paintOnlyMs,
    `sam paint (FCP - TTFB) ${paintOnlyMs.toFixed(1)} ms > ${MAX_PAINT_AFTER_TTFB_MS} ms`,
  ).toBeLessThan(MAX_PAINT_AFTER_TTFB_MS);

  // Żaden błąd strony w trakcie pomiaru - inaczej mierzylibyśmy boot, który
  // częściowo padł, i nazywalibyśmy tę liczbę budżetem.
  expect(errors, errors.join(" | ")).toHaveLength(0);
});

// ── TTFB ROZDZIELNIE NA HIT I MISS CACHE'U DOKUMENTÓW ───────────────────────
//
// PO CO OSOBNY TEST. Próg `MAX_TTFB_MS` wyżej mierzy JEDNĄ liczbę i nie mówi,
// czy zmierzył render, czy odtworzenie z cache'u. Przy zapasie 1,59x
// (5 030,1 ms wobec 8 000) to pytanie przestaje być akademickie: 5 sekund jest
// dużo dla dokumentu, którego cache brzegowy powinien oddawać z HIT-a - więc
// trzeba wiedzieć, KTÓRA to była ścieżka.
//
// JAK TO JEST OBSERWOWALNE, i dlaczego akurat tak. `documentCacheMiddleware`
// dekoruje odpowiedź nagłówkiem `x-nes-cache` o wartości HIT | STALE | MISS
// (`src/lib/http/documentCache.ts:24`, ustawiany w
// `documentCache.server.ts:332-338` i `:374`). Na produkcji warstwa hostingu
// ten nagłówek ZDEJMUJE (komentarz `documentCache.server.ts:143`) - ale tu
// mierzymy `node .output/server/index.mjs` WPROST, bez niczego przed nim, więc
// nagłówek jest na drucie i Playwright go czyta. BYPASS nie ustawia nagłówka
// W OGÓLE, dlatego komunikaty poniżej wypisują wartość zaobserwowaną, a nie
// zakładają jej istnienia.
//
// DWIE PUŁAPKI, KTÓRE MUSIAŁY ZOSTAĆ OMINIĘTE, obie zmierzone w kodzie:
//
//   1. WSPÓLNY KLUCZ Z SĄSIEDNIM SPEKIEM. `boot-artifact.spec.ts` chodzi po
//      TYM SAMYM `/cookies` na TYM SAMYM procesie serwera, a oba pliki jadą
//      w RÓWNOLEGŁYCH workerach (`fullyParallel: false` serializuje testy
//      WEWNĄTRZ pliku, nie pliki między sobą - zmierzone: 2 workery na
//      4 rdzeniach). Pierwsze żądanie na `/cookies` mogłoby więc być już
//      HIT-em albo ścigać się o MISS. Dlatego ten test używa WŁASNEGO klucza:
//      `page` jest parametrem KLUCZOWANYM (`KEYED_PARAMS`,
//      `documentCache.ts:114`) i wchodzi do klucza, więc `/cookies?page=7`
//      to wpis, którego nie dotyka nikt inny.
//
//   2. CACHE PRZEGLĄDARKI. Dokument z cache'u niesie dla przeglądarki
//      `max-age=60` (`cachePolicy.ts`), więc drugie `goto` na TEN SAM URL
//      w tym samym kontekście bywa obsłużone z cache'u Chromium - a wtedy
//      Playwright oddaje nagłówki PIERWSZEJ odpowiedzi i TTFB bliskie zeru,
//      czyli test cicho nie mierzy niczego. Obejście jest z kodu, nie
//      z wyobraźni: `utm_*` jest USUWANY z klucza cache'u
//      (`TRACKING_PARAM_PREFIXES`, `documentCache.ts:108`), więc
//      `?page=7&utm_source=...` to INNY URL dla przeglądarki i TEN SAM wpis
//      dla serwera. Dokładnie to, czego ten pomiar potrzebuje.
//
// CO TEN TEST BRAMKUJE. Kontrakt JUŻ DZIŚ: drugie żądanie o ten sam klucz JEST
// odtworzeniem z cache'u. Bez tej asercji „cache dokumentów działa" jest
// przekonaniem, a nie ustaleniem - a jego brak jest właśnie tym, co czyni
// 5 sekund TTFB ceną KAŻDEJ wizyty, nie tylko pierwszej. Do tego, od
// 2026-09-03 po południu, GÓRNA GRANICA TTFB NA HIT-cie - patrz
// `MAX_TTFB_HIT_MS` na końcu tego testu. Pierwsza wersja tego pliku progu tam
// NIE stawiała i nazywała powód: progi tu wolno wyłącznie OBNIŻAĆ i tylko po
// pomiarze z runnera, a dla rozbicia HIT/MISS nie było go ani jednego. Są
// cztery (33763700986, 33765187255, 33768894559, 33770195154), więc powód
// jest wydany.
test("cache dokumentów oddaje drugie żądanie z HIT-a, a TTFB jest podany rozdzielnie", async ({
  page,
}) => {
  const CACHE_HEADER = "x-nes-cache";
  /** Klucz prywatny dla tego testu - patrz pułapka 1 w komentarzu wyżej. */
  const KEY_PATH = "/cookies?page=7";

  async function measure(url: string): Promise<{ status: string | null; ttfbMs: number }> {
    const response = await page.goto(url, { waitUntil: "load" });
    const status = response?.headers()[CACHE_HEADER] ?? null;
    const ttfbMs = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      return nav ? nav.responseStart - nav.requestStart : -1;
    });
    return { status, ttfbMs };
  }

  // ŻĄDANIE 1: zimny klucz. Oczekujemy MISS (render).
  const first = await measure(KEY_PATH);

  // ŻĄDANIE 2: ten sam klucz cache'u, inny URL dla przeglądarki.
  //
  // PONAWIANE, I TO NIE JEST ROZLUŹNIENIE ASERCJI. Zapis do cache'u jest
  // ODROCZONY I NIEOCZEKIWANY PRZEZ NIKOGO: `src/server.ts` woła
  // `applyDeferredDocumentStore(...)`, a ta oddaje pracę do
  // `runAfterResponse`, które poza Workers degraduje do fire-and-forget
  // (`lib/http/waitUntil.server.ts`). Nie ma też single-flightu na ścieżce
  // MISS. Między odpowiedzią na żądanie 1 i wejściem żądania 2 wpis więc
  // MOŻE jeszcze nie istnieć - i wtedy drugie żądanie jest kolejnym MISS-em,
  // co jest poprawnym zachowaniem systemu, a nie awarią cache'u.
  //
  // Bramką ma być „cache DOCHODZI do stanu, w którym odtwarza", a nie „zapis
  // zdążył w konkretnym oknie". Dlatego ponawiamy ograniczoną liczbę razy;
  // wyczerpanie prób ORAZ TAK oblewa test, więc cache, który nigdy nie oddaje
  // HIT-a, nadal jest znaleziskiem blokującym. Każde ponowienie ma własny
  // `utm_source`, żeby nie trafić w cache przeglądarki.
  let second = await measure(`${KEY_PATH}&utm_source=nes-boot-timing-1`);
  for (let attempt = 2; attempt <= 4 && second.status === "MISS"; attempt += 1) {
    second = await measure(`${KEY_PATH}&utm_source=nes-boot-timing-${attempt}`);
  }

  console.log(
    `[boot-timing-cache] 1: ${first.status ?? "brak nagłówka"} TTFB=${first.ttfbMs.toFixed(1)}ms | ` +
      `2: ${second.status ?? "brak nagłówka"} TTFB=${second.ttfbMs.toFixed(1)}ms`,
  );

  // Przyrząd: obie nawigacje MUSZĄ się zaraportować.
  expect(first.ttfbMs, "PerformanceNavigationTiming nie zaraportował 1. nawigacji").toBeGreaterThan(
    -1,
  );
  expect(
    second.ttfbMs,
    "PerformanceNavigationTiming nie zaraportował 2. nawigacji",
  ).toBeGreaterThan(-1);

  // KONTRAKT: pierwsze żądanie o zimny klucz to MISS. Gdyby wyszło HIT,
  // znaczyłoby, że klucz NIE JEST prywatny dla tego testu i całe rozbicie
  // mierzy coś innego, niż opisuje - więc to musi paść, a nie przejść.
  expect(first.status, `1. żądanie na zimny klucz: ${first.status ?? "brak nagłówka"}`).toBe(
    "MISS",
  );

  // KONTRAKT WŁAŚCIWY: drugie żądanie o ten sam klucz jest odtworzeniem.
  // STALE jest akceptowane obok HIT-a, bo oba znaczą „nie renderowaliśmy
  // ponownie"; MISS w tym miejscu znaczy, że cache dokumentów NIE DZIAŁA tak,
  // jak opisuje go `documentCache.ts` - i to jest znalezisko wagi blokującej,
  // nie kosmetyka.
  expect(
    second.status,
    `2. żądanie o ten sam klucz: ${second.status ?? "brak nagłówka"} (oczekiwane HIT albo STALE)`,
  ).toMatch(/^(HIT|STALE)$/);

  // GÓRNA GRANICA TTFB NA HIT-cie, ZDJĘTA 2026-09-03 z `MAX_TTFB_MS / 2`
  // (4 000 ms) DO `MAX_TTFB_MS / 16` (500 ms) - po pomiarach z runnera,
  // czyli po spełnieniu warunku, który poprzednia wersja tego komentarza sama
  // sobie postawiła.
  //
  // DLACZEGO STARY PRÓG BYŁ MARTWY. Zmierzone HIT-y: 2,3 / 2,4 / 2,8 / 3,1 ms
  // na runnerze, 3,5 - 8,3 ms na hoście. Wobec 4 000 ms to zapas 482x - 1739x. Bramka
  // z takim zapasem nie łapie ŻADNEJ regresji poza całkowitym zniknięciem
  // cache'u - a to łapie już asercja na `x-nes-cache` wyżej. Innymi słowy:
  // stary próg nie miał EFEKTU, którego naruszenie dawałoby czerwień.
  //
  // ARYTMETYKA NOWEGO. Liczba nadal jest ZAKOTWICZONA w istniejącej stałej,
  // nie wybrana: `MAX_TTFB_MS / 16` = 500 ms, czyli „HIT musi być o rząd
  // wielkości tańszy niż budżet renderu". Dwa zapasy, oba policzone:
  //   - 500 / 8,3 = 60x wobec NAJGORSZEGO zmierzonego HIT-a (host, nie runner);
  //   - 5 051,1 / 500 = 10,1x - czyli HIT zdegenerowany do kosztu MISS-a jest
  //     czerwony z dziesięciokrotnym marginesem, a nie „o włos".
  //
  // ŚCIEŻKA DEGRADACJI, sprawdzona przed zejściem z progiem, nie po. Na HIT-cie
  // middleware oddaje ciało z mapy w pamięci procesu i NIE renderuje
  // (`documentCache.server.ts:332-338`) - koszt nie zależy od budżetu zapytań
  // SSR ani od tego, czy Supabase jest zaślepką. STALE idzie tą samą ścieżką
  // (ciało z cache'u od razu, rewalidacja w tle przez `runAfterResponse`), więc
  // akceptowanie STALE obok HIT-a nie psuje tego progu. Warstwa L2 (Cache API)
  // pod presetem `node-server` nie istnieje, więc mierzymy wyłącznie L1;
  // gdy CI dostanie preset Workers, L2 doda pojedyncze do niskich dziesiątek
  // ms i 500 ms nadal je pomieści.
  const MAX_TTFB_HIT_MS = MAX_TTFB_MS / 16;
  expect(
    second.ttfbMs,
    `TTFB na HIT ${second.ttfbMs.toFixed(1)} ms > ${MAX_TTFB_HIT_MS} ms - odtworzenie z cache'u nie może kosztować jak render`,
  ).toBeLessThan(MAX_TTFB_HIT_MS);
});
