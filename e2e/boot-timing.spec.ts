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
//   4. FCP z `PerformancePaintTiming` - patrz komentarz przy `FCP` niżej,
//      z powodem, dla którego NIE JEST bramkowany.
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

// ── ZMIERZONE WARTOŚCI BAZOWE (host deweloperski, NIE runner) ───────────────
// Wpisane jako komentarz, nie jako asercja: to punkt odniesienia dla następnej
// osoby, która będzie te progi zacieśniać. Nie wolno ich zamienić w bramkę,
// bo runner ma inne liczby i nikt ich jeszcze nie widział.
//
// 2026-09-01, artefakt `vite.smoke.config.ts`, `/cookies`, zaślepki Supabase.
// SZEŚĆ przebiegów (trzy razy sam ten plik, trzy razy pełne `test:e2e:artifact`),
// podane jako ZAKRESY, bo pojedyncza wartość udawałaby powtarzalność, której
// tu nie ma:
//
//   POMIAR    ZAKRES Z 6 PRZEBIEGÓW        PRÓG        KROTNOŚĆ ZAPASU
//   TTFB      5075,6 - 5194,9 ms           8000 ms     1,54x
//   READY      461   -  616   ms           6000 ms     9,7x
//   bootJS    2270,1 - 2294,2 KB           3000 KB     1,31x
//   FCP       5348,0 - 5732,0 ms           brak        -
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

  // 4. FCP - ZMIERZONY, ŚWIADOMIE NIE BRAMKOWANY.
  //
  // Chromium W TYM TRYBIE RAPORTUJE `first-contentful-paint` - sprawdzone,
  // wartości w tabeli progów. Powód, dla którego nie ma dla niego stałej
  // `MAX_*`, jest inny i mocniejszy niż „może nie przyjść": zmierzone
  // FCP = 5348,0 ms przy TTFB = 5075,6 ms, czyli SAM PAINT to ~272 ms (w sześciu
  // przebiegach 272 - 537 ms), a 91-95%
  // liczby to czas serwera, który jest już bramkowany osobno i lepiej -
  // z własnym komunikatem błędu. Próg na FCP byłby DRUGĄ, GŁOŚNIEJSZĄ KOPIĄ
  // bramki TTFB: padałby na tej samej regresji, tylko wskazując gorsze miejsce.
  // Liczba jest za to WYPISYWANA, bo od niej zacznie się rozmowa o LCP, gdy
  // `LHCI_URL` w końcu powstanie. Świadomie BEZ asercji nawet na jej obecność:
  // to pierwszy przebieg tego pomiaru w CI i nie chcę, żeby bramka budżetu
  // padła na szczególe przyrządu, którego na runnerze nikt jeszcze nie widział.

  // Żaden błąd strony w trakcie pomiaru - inaczej mierzylibyśmy boot, który
  // częściowo padł, i nazywalibyśmy tę liczbę budżetem.
  expect(errors, errors.join(" | ")).toHaveLength(0);
});
