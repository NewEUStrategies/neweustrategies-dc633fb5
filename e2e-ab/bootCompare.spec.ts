// SONDA POMIARU PORÓWNAWCZEGO PIERWSZEGO WCZYTANIA.
//
// Jedna próbka na przebieg, wypisana jako JSON. Sonda NIE MA PROGÓW i nie jest
// bramką - progów pilnuje `e2e/boot-timing.spec.ts`. Tu chodzi o coś innego:
// zmierzyć DWA artefakty tą samą miarą i pokazać różnicę
// (`scripts/measure-boot-ab.ts`).
//
// ── DLACZEGO WŁASNY KATALOG `e2e-ab/`, A NIE `e2e/` ────────────────────────
//
// To jest naprawa z góry, nie ostrożność. `playwright.config.ts` ma
// `testDir: "./e2e"` i BIERZE CAŁY KATALOG, a raz już to kosztowało czerwony
// przebieg CI: specy artefaktowe pojechały po dev-serwerze i zmierzyły
// kompilację ESM zamiast produktu (`readyMs` 19 963 ms wobec budżetu 6 000,
// `staticGraphCount` = 0, sonda uznała boot za martwy po 15 001 ms - przebieg
// 33512138275). Lekarstwem był wtedy `testIgnore` plus bramka parytetu
// wzorców. Trzeci spec w tym samym katalogu znaczyłby TRZECI wzorzec do
// utrzymania w dwóch miejscach; własny katalog zdejmuje ten problem
// STRUKTURALNIE: `testDir: "./e2e"` nie widzi `e2e-ab/` z definicji, więc nie
// ma czego rozjechać. Pilnuje tego rozdziału
// `src/lib/ci/__tests__/playwrightConfigParity.test.ts`.
//
// ── DLACZEGO SONDA JEST PRZENOŚNA I CO TO ZNACZY ──────────────────────────
//
// Ten plik jedzie po artefakcie zbudowanym z DOWOLNEJ rewizji, w tym sprzed
// zmiany, którą mierzy. Nie wolno mu więc zależeć od niczego, co ta zmiana
// dodała - inaczej mierzyłby własną obecność i „nowe" wychodziłoby lepiej
// z definicji. Świadomie NIE UŻYWAM:
//   * `__nesBootT0`, `__nesBootDead`, `__nesBootErrors` - stawia je sonda bootu
//     dodana razem z tą pracą; zamiast nich czas liczę od `responseStart`
//     z Navigation Timing, czyli od przeglądarki, nie od aplikacji;
//   * `window.__nesHydrationBudget` i pozostałych globali diagnostycznych.
// Zostaje `__nesAppReady`, obecny w OBU drzewach - i to jest jedyny wyjątek,
// oparty na sprawdzeniu, nie na założeniu (baza: `previewWatchdog.ts:18`).
import { expect, test } from "@playwright/test";

const LABEL = process.env.NES_AB_LABEL ?? "?";
const ROUTE = process.env.NES_AB_ROUTE ?? "/cookies";

/**
 * Budżet odpytywania flagi gotowości.
 *
 * `null` po tym czasie NIE JEST awarią sondy i tak trzeba go czytać - to
 * ZMIERZONY stan bazy `1d5d0ed`: jedyny pisarz `__nesAppReady`
 * (`markPreviewAppReady`) stał tam wewnątrz gałęzi `if (inPreviewIframe)`
 * w `__root.tsx:493`, więc na publikowanej stronie flaga nie pojawiała się
 * NIGDY. 30 s to dwukrotność progu martwej hydratacji sondy bootu
 * (`BOOT_DEAD_TIMEOUT_MS` = 15 000), żeby „nie ma flagi" nie dało się pomylić
 * z „flaga przyszła późno".
 */
const READY_POLL_BUDGET_MS = 30_000;

/** Odstęp odpytywania - na tyle gęsty, żeby nie zaokrąglać 500 ms w górę. */
const READY_POLL_INTERVAL_MS = 20;

/**
 * WSPÓLNE OKIENKO OBSERWACJI: ile czekamy od nawigacji do próbkowania zasobów.
 *
 * TO JEST NAPRAWA REALNEGO DEFEKTU METODY, znalezionego w recenzji. Pierwsza
 * wersja czekała `gotowość + 1500 ms`, a gotowość jest po obu stronach RÓŻNA -
 * i to skrajnie: rewizja, która flagi nie stawia wcale (udokumentowany przypadek
 * bazy `1d5d0ed`), wyczerpywała cały 30-sekundowy budżet, a rewizja, która
 * stawia ją po ~0,5 s, próbkowała po ~2 s. Metryki zasobów są KUMULATYWNE
 * W CZASIE, więc porównywały się dwa okienka: ~31,5 s wobec ~2 s. Każdy leniwy
 * import albo zmiana treści po hydratacji byłaby wtedy przypisana REWIZJI,
 * a nie nierównym okienkom.
 *
 * ILE TO KOSZTOWAŁO W PRAKTYCE - ZMIERZONE, nie oszacowane. Jedno wczytanie
 * artefaktu `ecff3f2`, próbki w t=2 s i t=31,5 s, trasa `/cookies`:
 *
 *   METRYKA        t=2 s        t=31,5 s     DRYF
 *   JS razem       2591,6 KB    2591,6 KB    0
 *   plików JS      71           71           0
 *   dynamiczne     625,4 KB/59  625,4 KB/59  0
 *   statyczne      1966,2 KB/12 1966,2 KB/12 0
 *   CSS            557,3 KB     557,3 KB     0
 *   tekst          2622 zn.     2622 zn.     0
 *
 * Czyli na TEJ trasie i przy zaślepce Supabase dryfu nie ma żadnego, więc
 * pierwsze opublikowane liczby nie są skażone. Defekt naprawiam mimo to i to
 * nie jest formalizm: narzędzie pomiarowe nie może opierać poprawności na tym,
 * że „na trasie, którą sprawdziłem, akurat nic się nie doładowuje". Na trasie
 * z leniwymi widżetami, odpytywaniem albo importem wyzwalanym widocznością
 * dryf byłby realny i CICHY.
 *
 * SKĄD 3 000 ms. Musi z zapasem przekraczać moment, w którym boot się kończy po
 * OBU stronach (zmierzona gotowość: 568,4 ms na `ecff3f2`; na bazie hydratacja
 * kończy się podobnie, tylko nie zapala flagi), a jednocześnie nie wydłużać
 * przebiegu bez powodu. Eksperyment powyżej pokazuje, że wszystko, co miało się
 * dociągnąć, jest na miejscu grubo przed 2 s.
 */
const OBSERVATION_WINDOW_MS = 3_000;

interface BootSample {
  ttfbMs: number;
  fcpMs: number | null;
  readyMs: number | null;
  htmlBytes: number;
  htmlTextChars: number;
  jsTransferKb: number;
  jsCount: number;
  staticKb: number;
  staticCount: number;
  dynamicKb: number;
  dynamicCount: number;
  cssKb: number;
  modulepreloadCount: number;
  linkHeader: string | null;
}

test(`[A/B ${LABEL}] pierwsze wczytanie na ${ROUTE}`, async ({ page }) => {
  let linkHeader: string | null = null;
  page.on("response", (res) => {
    if (res.request().resourceType() !== "document") return;
    if (new URL(res.url()).pathname !== ROUTE) return;
    linkHeader = res.headers()["link"] ?? null;
  });

  // `commit` zamiast `load`: chcemy zacząć mierzyć, gdy dokument dojdzie, a nie
  // gdy skończy się cała kaskada zasobów.
  const navigation = await page.goto(ROUTE, { waitUntil: "commit" });

  // STATUS MUSI BYĆ SUKCESEM - i to jest naprawa znaleziska z recenzji, które
  // trafia dokładnie w sposób użycia tego narzędzia. `page.goto()` ROZWIĄZUJE
  // SIĘ dla 4xx i 5xx, a ten pomiar służy porównywaniu DWÓCH REWIZJI: trasa
  // dodana mierzoną zmianą po prostu NIE ISTNIEJE na rewizji bazowej. Bez tego
  // sprawdzenia sonda zmierzyłaby tam stronę błędu, a asercja na 1 000 bajtów
  // niżej by ją przepuściła, bo aplikacja renderuje dla 404 pełną powłokę
  // z nawigacją i stopką. Wynikiem byłoby wiarygodnie wyglądające porównanie
  // DWÓCH RÓŻNYCH STRON - najgorszy możliwy tryb awarii dla narzędzia
  // pomiarowego, bo cicho oddaje liczby, które nie znaczą tego, co mówią.
  if (!navigation) throw new Error(`nawigacja na ${ROUTE} nie oddała odpowiedzi`);
  const status = navigation.status();
  if (status >= 400) {
    throw new Error(
      `${ROUTE} oddało HTTP ${status} - pomiar zmierzyłby stronę błędu. ` +
        "Jeśli porównujesz rewizje, sprawdź, czy ta trasa istnieje w OBU.",
    );
  }

  // ── REJESTRATOR GOTOWOŚCI: NIEBLOKUJĄCY ────────────────────────────────
  //
  // Zapisuje CHWILĘ przewrotu flagi do zmiennej w stronie i nic nie blokuje.
  // Dzięki temu moment PRÓBKOWANIA ZASOBÓW nie zależy od tego, kiedy (i czy)
  // flaga się pojawi - patrz komentarz przy `OBSERVATION_WINDOW_MS`.
  await page.evaluate((intervalMs) => {
    const w = window as Window & { __nesAbReadyAt?: number | null; __nesAppReady?: boolean };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    w.__nesAbReadyAt = null;
    const timer = window.setInterval(() => {
      if (w.__nesAppReady === true) {
        w.__nesAbReadyAt = performance.now() - nav.responseStart;
        window.clearInterval(timer);
      }
    }, intervalMs);
  }, READY_POLL_INTERVAL_MS);

  // WSPÓLNY, STAŁY MOMENT PRÓBKOWANIA - identyczny po obu stronach.
  await page.waitForTimeout(OBSERVATION_WINDOW_MS);

  const measured = await page.evaluate(
    (): Omit<BootSample, "linkHeader" | "readyMs" | "htmlBytes" | "htmlTextChars"> => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];

      const pathOf = (url: string): string => new URL(url, location.href).pathname;
      const isJs = (url: string): boolean => /\.m?js$/.test(pathOf(url));
      const isCss = (url: string): boolean => /\.css$/.test(pathOf(url));

      // PODZIAŁ PO `initiatorType`, ten sam co w `e2e/boot-timing.spec.ts` i z tego
      // samego pomiaru: Chromium klasyfikuje moduły pobrane przez skaner preloadu
      // dokumentu jako `other`/`link`, a jako `script` WYŁĄCZNIE te z `import()`.
      // Filtrowanie po `initiatorType === "script"` widziałoby więc ~13% ścieżki
      // bootowania i ROSŁO, gdy ta ścieżka się kurczy.
      const js = resources.filter((r) => isJs(r.name));
      const dynamic = js.filter((r) => r.initiatorType === "script");
      const staticClosure = js.filter((r) => r.initiatorType !== "script");
      const css = resources.filter((r) => isCss(r.name));

      const kb = (list: readonly PerformanceResourceTiming[]): number =>
        Math.round((list.reduce((sum, r) => sum + r.transferSize, 0) / 1024) * 10) / 10;
      const ms = (value: number): number => Math.round(value * 10) / 10;

      return {
        ttfbMs: ms(nav.responseStart - nav.requestStart),
        fcpMs: fcp ? ms(fcp.startTime) : null,
        jsTransferKb: kb(js),
        jsCount: js.length,
        staticKb: kb(staticClosure),
        staticCount: staticClosure.length,
        dynamicKb: kb(dynamic),
        dynamicCount: dynamic.length,
        cssKb: kb(css),
        modulepreloadCount: document.querySelectorAll('link[rel="modulepreload"]').length,
      };
    },
  );

  // ── DOKUMENT SSR: BAJTY I TEKST, OBA Z SUROWEJ ODPOWIEDZI ───────────────
  //
  // Bierzemy ciało ODPOWIEDZI NAWIGACYJNEJ, czyli dokładnie tego dokumentu,
  // który dostała przeglądarka - nie drugiego żądania. Drugie żądanie mogłoby
  // trafić w inny stan (cache brzegowy, rozstrzygnięcie najemcy) i wtedy
  // mierzyłoby inny dokument niż ten, z którego wzięły się liczby zasobów.
  const rawHtml = await navigation.text();
  const htmlBytes = (await navigation.body()).byteLength;

  // TEKST SSR LICZONY Z SUROWEGO HTML-a - naprawa znaleziska z recenzji, które
  // trafiało w moją własną interpretację wyniku. Poprzednia wersja brała
  // `document.body.innerText` PO hydratacji i po całym okienku obserwacji,
  // a wynik nazywała „treść tekstowa w SSR". Na trasie, gdzie hydratacja,
  // efekty albo leniwe dane zmieniają stronę, taki pomiar PRZYPISUJE SSR-owi
  // tekst wyrenderowany przez klienta - albo gubi tekst serwerowy usunięty przy
  // hydratacji. Ważniejsze: tej właśnie liczby użyłem w raporcie, żeby
  // stwierdzić „bez danych obie wersje renderują tę samą statyczną powłokę",
  // czyli postawiłem tezę o SSR na pomiarze zrobionym PO hydratacji.
  //
  // `DOMParser` NIE WYKONUJE SKRYPTÓW - to gwarancja specyfikacji, nie
  // właściwość implementacji - więc sparsowanie surowego dokumentu jest
  // bezpieczne i nie zmienia mierzonej strony.
  //
  // `textContent`, nie `innerText`: dokument z `DOMParser` nie ma layoutu, więc
  // `innerText` nie miałby czego czytać. `textContent` bierze natomiast również
  // treść `script`/`style`, dlatego te węzły usuwamy, a białe znaki normalizujemy
  // - bez tego liczba mierzyłaby w większości wcięcia formatowania HTML-a.
  const htmlTextChars = await page.evaluate((html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const node of doc.querySelectorAll("script,style,template,noscript")) node.remove();
    return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim().length;
  }, rawHtml);

  // GOTOWOŚĆ ODCZYTANA PO PRÓBKOWANIU. Rejestrator działa od nawigacji, więc
  // jeśli flaga przewróciła się w okienku obserwacji, wartość jest już zapisana
  // i to wywołanie wraca natychmiast. Jeśli nie - czekamy do końca budżetu, ale
  // to już NIE WPŁYWA na żadną inną metrykę, bo tamte są zebrane.
  const readyMs = await page
    .waitForFunction(
      () => (window as Window & { __nesAbReadyAt?: number | null }).__nesAbReadyAt ?? false,
      undefined,
      { timeout: READY_POLL_BUDGET_MS - OBSERVATION_WINDOW_MS, polling: READY_POLL_INTERVAL_MS },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);

  const sample: BootSample = { ...measured, readyMs, htmlBytes, htmlTextChars, linkHeader };
  console.log(`[A/B ${LABEL}] ${JSON.stringify(sample)}`);

  // Sonda jest POMIAREM, nie bramką. Jedyna asercja pilnuje, żeby pomiar był
  // o czymkolwiek - dokument doszedł i nie jest pusty. Bez niej cicha awaria
  // serwera dałaby próbkę zer, którą raport pokazałby jako „ogromny zysk".
  expect(sample.htmlBytes, "dokument SSR jest pusty - pomiar nie jest o niczym").toBeGreaterThan(
    1_000,
  );
});
