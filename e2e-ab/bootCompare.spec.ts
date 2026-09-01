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
 * Bufor po fladze gotowości, na dociągnięcie tego, co boot zaczął.
 *
 * TEN SAM w obu przebiegach, więc nie faworyzuje żadnej strony - i to jest cały
 * powód, dla którego jest stałą, a nie parametrem.
 */
const SETTLE_MS = 1_500;

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
  await page.goto(ROUTE, { waitUntil: "commit" });

  const readyMs = await page.evaluate(
    async ([budgetMs, intervalMs]): Promise<number | null> => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const deadline = performance.now() + budgetMs;
      while (performance.now() < deadline) {
        if ((window as Window & { __nesAppReady?: boolean }).__nesAppReady === true) {
          return performance.now() - nav.responseStart;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      return null;
    },
    [READY_POLL_BUDGET_MS, READY_POLL_INTERVAL_MS] as const,
  );

  await page.waitForTimeout(SETTLE_MS);

  const measured = await page.evaluate(
    (): Omit<BootSample, "linkHeader" | "readyMs" | "htmlBytes"> => {
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
        htmlTextChars: (document.body.innerText ?? "").length,
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

  // Rozmiar SUROWEGO dokumentu, osobnym żądaniem - `document.documentElement`
  // po hydratacji jest już DRZEWEM PO ZMIANACH KLIENTA, więc mierzyłby co
  // innego niż „ile bajtów schodzi z serwera".
  const raw = await page.request.get(ROUTE);
  const htmlBytes = (await raw.body()).byteLength;

  const sample: BootSample = { ...measured, readyMs, htmlBytes, linkHeader };
  console.log(`[A/B ${LABEL}] ${JSON.stringify(sample)}`);

  // Sonda jest POMIAREM, nie bramką. Jedyna asercja pilnuje, żeby pomiar był
  // o czymkolwiek - dokument doszedł i nie jest pusty. Bez niej cicha awaria
  // serwera dałaby próbkę zer, którą raport pokazałby jako „ogromny zysk".
  expect(sample.htmlBytes, "dokument SSR jest pusty - pomiar nie jest o niczym").toBeGreaterThan(
    1_000,
  );
});
