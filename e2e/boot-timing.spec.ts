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
//   3. TRANSFER ŚCIEŻKI BOOTOWANIA - suma `transferSize` zasobów
//      `initiatorType === "script"` z `PerformanceResourceTiming`. To liczba,
//      którą płaci pierwsze wejście, i jedyny pomiar, który potwierdza floor
//      `boot` z `scripts/check-bundle-size.ts` PO STRONIE PRZEGLĄDARKI: tamten
//      skrypt liczy domknięcie statyczne z grafu chunków, ten liczy to, co
//      karta faktycznie pobrała;
//   4. FCP z `PerformancePaintTiming` - patrz komentarz przy `FCP` niżej,
//      z powodem, dla którego NIE JEST bramkowany.
//
// CENA: ~3 s do przebiegu `test:e2e:artifact` (drugi `page.goto` na tym samym
// serwerze). Bez drugiego builda i bez drugiego serwera.
import { expect, test } from "@playwright/test";

// ── PROGI ───────────────────────────────────────────────────────────────────
//
// WSZYSTKIE progi są TUTAJ, każdy z pomiarem, z którego wynika. Zasada, którą
// się tu trzymam: bramkować DOWODLIWIE, a nie życzeniowo.
//
// SKĄD LICZBY BAZOWE. Host deweloperski tego repozytorium (sandbox, ten sam,
// na którym stoi `bun run dev`), artefakt `bun run build:smoke`, Chromium
// z `/opt/pw-browsers`, trasa `/cookies`, po dwa przebiegi w dwóch trybach:
// ZIMNY (tylko ten plik, pierwsze żądanie do świeżo wystartowanego procesu)
// i CIEPŁY (pełne `test:e2e:artifact`, więc po `boot-artifact.spec.ts`).
// Zmierzone wartości są wpisane przy każdej stałej.
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
 * ZMIERZONE: patrz `MEASURED_*` niżej. Próg jest bramką na klasę awarii
 * „render dokumentu zaczął czekać na coś, na co nie powinien" - synchroniczny
 * round-trip do bazy w renderze, utrata cache dokumentu, blokujący loader
 * w korzeniu. Każda z nich przenosi TTFB w sekundy, nie w dziesiątki ms.
 */
const MAX_TTFB_MS = 2_500;

/**
 * Czas od `__nesBootT0` do `__nesAppReady === true`.
 *
 * Górna granica jest ZAKOTWICZONA, nie wybrana: sonda bootu uznaje boot za
 * MARTWY po `BOOT_DEAD_TIMEOUT_MS` = 15 000 ms
 * (`lib/observability/bootProbeScript`). Próg poniżej tej granicy jest więc
 * jedyną wartością, która ma sens - powyżej dublowałby sygnał, który już
 * istnieje, tylko bez jego diagnostyki.
 */
const MAX_READY_MS = 10_000;

/**
 * Suma `transferSize` zasobów `initiatorType === "script"`, w kilobajtach.
 *
 * UWAGA NA JEDNOSTKĘ: to jest TRANSFER, nie rozmiar źródeł i nie gzip
 * z `check:bundle`. Artefakt `node-server` serwuje statyki BEZ KOMPRESJI
 * (nitro nie włącza jej domyślnie), więc ta liczba jest bliska sumie RAW plus
 * ~300 B nagłówków na zasób - i tak ją należy czytać. Odpowiednikiem po
 * stronie bramki bajtów jest kolumna RAW z `check:bundle` (`Boot closure:
 * ... KB raw`), nie floor gzip 577 KB.
 */
const MAX_SCRIPT_TRANSFER_KB = 3_600;

// ── ZMIERZONE WARTOŚCI BAZOWE (host deweloperski, nie runner) ───────────────
// Wpisane jako komentarz, nie jako asercja: to punkt odniesienia dla następnej
// osoby, która będzie te progi zacieśniać. Nie wolno ich zamienić w bramkę,
// bo runner ma inne liczby i nikt ich jeszcze nie widział.
//
//   TRYB    TTFB      READY      SCRIPTS            FCP
//   zimny   MEASURED_COLD
//   ciepły  MEASURED_WARM

/** Kopia PL z `src/routes/cookies.tsx` - dowód, że mierzymy stronę, a nie błąd. */
const UNDECIDED = "Nie zapisano jeszcze wyboru";

interface BootTiming {
  /** `responseStart - requestStart` z PerformanceNavigationTiming (ms). */
  ttfbMs: number;
  /** Od `__nesBootT0` do przypisania `__nesAppReady = true` (ms). */
  readyMs: number;
  /** Czy `readyMs` pochodzi z przechwyconego przypisania, czy z odpytania. */
  readyExact: boolean;
  /** Suma `transferSize` zasobów `initiatorType === "script"` (bajty). */
  scriptTransferBytes: number;
  /** Ile takich zasobów - bez tego suma nie mówi, czy to jeden plik, czy sto. */
  scriptCount: number;
  /** Suma `transferSize` plików `.js` pobranych przez `modulepreload` (bajty). */
  preloadJsTransferBytes: number;
  /** Ile takich zasobów. */
  preloadJsCount: number;
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
      | PerformanceNavigationTiming
      | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    // DWA WIADRA, NIE JEDNO - i to jest wynik pomiaru, nie ostrożność. Patrz
    // komentarz przy `MAX_BOOT_JS_TRANSFER_KB`: chunki objęte hintem
    // `modulepreload` mają `initiatorType === "link"`, nie `"script"`.
    const scripts = resources.filter((e) => e.initiatorType === "script");
    const preloads = resources.filter(
      (e) => e.initiatorType === "link" && new URL(e.name).pathname.endsWith(".js"),
    );
    const bytes = (list: PerformanceResourceTiming[]) =>
      list.reduce((sum, e) => sum + e.transferSize, 0);
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const t0 = w.__nesBootT0 ?? 0;
    const readyAt = w.__nesReadyAt;
    return {
      ttfbMs: nav ? nav.responseStart - nav.requestStart : -1,
      readyMs: readyAt !== undefined ? readyAt - t0 : Date.now() - t0,
      readyExact: readyAt !== undefined,
      scriptTransferBytes: bytes(scripts),
      scriptCount: scripts.length,
      preloadJsTransferBytes: bytes(preloads),
      preloadJsCount: preloads.length,
      fcpMs: paint ? paint.startTime : null,
    };
  });

  const scriptKb = timing.scriptTransferBytes / 1024;
  const preloadKb = timing.preloadJsTransferBytes / 1024;
  const bootJsKb = scriptKb + preloadKb;
  // Log jest CZĘŚCIĄ WARTOŚCI tego testu, nie ozdobą: dopóki nie ma ani jednej
  // liczby z runnera, przebieg CI jest jedynym sposobem, żeby ją zdobyć -
  // i musi ją WYPISAĆ także wtedy, gdy przechodzi.
  console.log(
    `[boot-timing] TTFB=${timing.ttfbMs.toFixed(1)}ms ` +
      `ready=${timing.readyMs}ms (exact=${timing.readyExact}) ` +
      `bootJS=${bootJsKb.toFixed(1)}KB ` +
      `(script ${scriptKb.toFixed(1)}KB/${timing.scriptCount} + ` +
      `modulepreload ${preloadKb.toFixed(1)}KB/${timing.preloadJsCount}) ` +
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

  // 3. TRANSFER ŚCIEŻKI BOOTOWANIA. Zero zasobów typu `script` znaczy, że
  // dokument nie wykonał ANI JEDNEGO importu modułowego - czyli jest statycznym
  // SSR-em, dokładnie tą awarią, którą pilnuje `boot-artifact.spec.ts`. Tu
  // wychodzi jako awaria przyrządu i tak jest sprawdzane. To samo dla wiadra
  // `modulepreload`: jego wyzerowanie znaczyłoby, że `localeChunkPlugin`
  // przestał wstawiać hinty, a wtedy liczba przestaje być porównywalna
  // z poprzednimi przebiegami (bajty przechodzą do wiadra `script`).
  expect(timing.scriptCount, "dokument nie pobrał żadnego skryptu").toBeGreaterThan(0);
  expect(timing.preloadJsCount, "dokument nie niesie hintów modulepreload").toBeGreaterThan(0);
  expect(
    bootJsKb,
    `transfer JS bootu ${bootJsKb.toFixed(1)} KB > ${MAX_BOOT_JS_TRANSFER_KB} KB`,
  ).toBeLessThan(MAX_BOOT_JS_TRANSFER_KB);

  // 4. FCP - ZMIERZONY, ŚWIADOMIE NIE BRAMKOWANY.
  //
  // Chromium W TYM TRYBIE RAPORTUJE `first-contentful-paint` - sprawdzone,
  // zmierzone niżej w tabeli. Powód, dla którego nie ma dla niego stałej
  // `MAX_*`, jest inny i mocniejszy niż „może nie przyjść": zmierzone
  // FCP = 5508,0 ms przy TTFB = 5110,7 ms, czyli SAM PAINT to ~397 ms, a 93%
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
