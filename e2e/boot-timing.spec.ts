// POMIAR CZASU NA ZBUDOWANYM ARTEFAKCIE. Uruchamiany WYŁĄCZNIE przez
// `playwright.artifact.config.ts` (`bun run test:e2e:artifact`), obok
// `boot-artifact.spec.ts` i na TYM SAMYM serwerze - jeden build, jeden proces
// `node .output/server/index.mjs`, dwa pliki testowe.
//
// PO CO TO ISTNIEJE, skoro repozytorium ma Lighthouse'a.
//
// Bo Lighthouse w tym repozytorium NIE ZMIERZYŁ ARTEFAKTU ANI RAZU:
//   * `lighthouserc.json` startuje aplikację przez `bun run dev` - mierzy więc
//     dev-server, gdzie nie ma ani chunków, ani minifikacji, i wszystkie jego
//     asercje są na `warn`. Zapisane w `.lighthouseci/` liczby to LCP 31 215 ms
//     przy budżecie 2 500 - są nieprzenoszalne i nikogo nie zatrzymały;
//   * `lighthouserc.deployed.json` ma WSZYSTKIE asercje na `error` (LCP 2500,
//     TBT 300), ale wymaga `LHCI_URL`, czyli ZMIENNEJ REPOZYTORIUM GitHuba.
//     Nigdy nie była ustawiona, więc tryb blokujący nie włączył się ani razu -
//     i nie da się tego naprawić z kodu w gałęzi.
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
// SKĄD ZAPAS. Tego pomiaru NIE MA ANI RAZU Z RUNNERA GitHuba. Runner
// `ubuntu-latest` to 2 vCPU bez gwarancji sąsiedztwa; `scripts/check-bundle-size.ts`
// dokumentuje dla samych bajtów rozbieżność host <-> runner ~10 KB na OVERALL,
// a dla CZASU rozbieżność jest o rząd większa i nieprzewidywalna. Dlatego progi
// niżej NIE są ciasnym opakowaniem pomiaru z hosta - są bramką na REGRESJĘ
// KLASOWĄ (dwucyfrowa krotność, nie kilkadziesiąt procent). PIERWSZY PRZEBIEG
// W CI JEST PODSTAWĄ DO PRZEFLOOROWANIA i dopóki go nie ma, każde zacieśnienie
// tych liczb byłoby zgadywaniem, które zamieni bramkę w migotanie.
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
 *     `ubuntu-latest` ma 2 vCPU bez gwarancji sąsiedztwa, a tego pomiaru nie ma
 *     stamtąd ANI RAZU. Zacieśnianie progu przed pierwszym przebiegiem byłoby
 *     zgadywaniem, które zamienia bramkę w migotanie;
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
 * Sprawdzone też: ZERO zasobów `.js` z `initiatorType === "link"`, więc żadne
 * wiadro dla hintów `modulepreload` nie jest potrzebne.
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
 * bramki TTFB". Ten argument był poprawny wtedy i JEST DZIŚ SŁABSZY z dwóch
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
 * PRÓG 2 000 ms, I DLACZEGO NIE 1 000. Zmierzone: 241,9 ms na runnerze
 * (5 272,0 - 5 030,1) i 272 - 537 ms na hoście w sześciu przebiegach z
 * 2026-09-01 - ale W POMIARZE Z 2026-09-03 na tym samym hoście wyszło
 * 667,8 ms (5 748,0 - 5 080,2), przy gotowości hydratacji 735 ms wobec
 * wcześniejszych 461 - 616 ms. Czyli host był tego dnia WOLNIEJSZY, a paint
 * pojechał razem z nim - co jest oczekiwane, bo paint zależy od CPU.
 * Pierwotnie postawiłem tu 1 000 ms (1,86x najgorszego pomiaru z 2026-09-01)
 * i NASTĘPNY POMIAR ZOSTAWIŁ NA TYM PROGU 1,50x ZAPASU. To za mało dla metryki
 * zależnej od CPU na maszynie bez gwarancji sąsiedztwa: taki próg jest bramką
 * na kontencję runnera, nie na wagę arkusza. 2 000 ms to 3,0x najgorszego
 * ZMIERZONEGO paintu i nadal łapie klasę regresji, o którą tu chodzi
 * (podwojenie arkusza render-blocking to setki ms, nie dziesiątki).
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
// każdej. Progu na HIT nie zacieśniam poniżej `MAX_TTFB_MS / 2`, bo pomiaru
// z RUNNERA dla tego rozbicia nie ma jeszcze ani jednego - pierwszy zielony
// log CI (`[boot-timing-cache] ...`) jest podstawą do postawienia tam liczby
// rzędu zmierzonych 8,3 ms.

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
  /** Część z domknięcia STATYCZNEGO (entry + vendory; `initiatorType !== "script"`). */
  staticGraphBytes: number;
  /** Ile plików w domknięciu statycznym. */
  staticGraphCount: number;
  /** Część z importów DYNAMICZNYCH w trakcie bootu (`initiatorType === "script"`). */
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
  const timing: BootTiming = await page.evaluate(() => {
    const w = window as unknown as { __nesBootT0?: number; __nesReadyAt?: number };
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    // WSZYSTKIE `.js`, NIEZALEŻNIE OD `initiatorType` - i to jest POPRAWKA
    // Z POMIARU, nie ostrożność. Patrz komentarz przy `MAX_BOOT_JS_TRANSFER_KB`:
    // domknięcie statyczne bootu przychodzi z `initiatorType === "other"`.
    const js = resources.filter((e) => new URL(e.name).pathname.endsWith(".js"));
    const bytes = (list: PerformanceResourceTiming[]) =>
      list.reduce((sum, e) => sum + e.transferSize, 0);
    const staticGraph = js.filter((e) => e.initiatorType !== "script");
    const dynamicImports = js.filter((e) => e.initiatorType === "script");
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
  });

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
// CZEGO TEN TEST NIE ROBI: nie stawia progu na TTFB HIT-a. Progi w tym pliku
// wolno wyłącznie OBNIŻAĆ i tylko po pomiarze z runnera, a tego pomiaru dla
// rozbicia HIT/MISS nie ma jeszcze ANI JEDNEGO. Test WYPISUJE obie liczby
// (pierwszy przebieg CI będzie podstawą progu) i bramkuje to, co jest
// kontraktem JUŻ DZIŚ: że drugie żądanie o ten sam klucz JEST odtworzeniem
// z cache'u. Bez tej asercji „cache dokumentów działa" jest przekonaniem,
// a nie ustaleniem - a jego brak jest właśnie tym, co czyni 5 sekund TTFB
// ceną KAŻDEJ wizyty, nie tylko pierwszej.
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
  const second = await measure(`${KEY_PATH}&utm_source=nes-boot-timing`);

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

  // Górna granica dla HIT-a NIE JEST progiem tego pliku, tylko strażnikiem
  // sensu: odtworzenie z pamięci procesu nie może kosztować tyle, co pełny
  // render z budżetem zapytań SSR. Liczba jest ZAKOTWICZONA w istniejącej
  // stałej, a nie wybrana - `MAX_TTFB_MS` mierzy ścieżkę renderu, więc HIT
  // musi zmieścić się w jej połowie. Zapas jest ogromny z premedytacją:
  // pomiaru HIT-a z runnera nie ma jeszcze ani jednego (patrz wyżej).
  const MAX_TTFB_HIT_MS = MAX_TTFB_MS / 2;
  expect(
    second.ttfbMs,
    `TTFB na HIT ${second.ttfbMs.toFixed(1)} ms > ${MAX_TTFB_HIT_MS} ms - odtworzenie z cache'u nie może kosztować jak render`,
  ).toBeLessThan(MAX_TTFB_HIT_MS);
});
