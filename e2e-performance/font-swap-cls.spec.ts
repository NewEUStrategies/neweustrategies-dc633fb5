import { expect, test } from "@playwright/test";
import {
  fixtureImageFor,
  fixtureResponse,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

// PODMIANA FONTU BEZ PRZESUNIĘCIA UKŁADU (P3.2b, fala 3).
//
// PO CO. Lokalny Lighthouse ma CLS 0, bo serwer artefaktu oddaje fonty przed
// pierwszym malowaniem i podmiany w ogóle nie ma. Produkcja (2026-10-08,
// desktop) miała CLS 0,0163 przy załadowaniu Red Hat Display: tytuły kart
// renderowały się do czasu fontu `system-ui` (stos z CMS bez kroju zastępczego),
// a etykieta paska tickera syntetycznym pogrubieniem jednej twarzy Regular.
// Ten spec WSTRZYMUJE każdy woff2 do jawnego zwolnienia, więc strona maluje się
// i hydratuje krojem zastępczym, a podmiana dzieje się pod obserwacją.
//
// ASERCJE (kandydat): po zwolnieniu fontu suma przesunięć <= 0,001 (kryterium
// akceptacji P3.2b), a liczba linii tytułów, zajawek, nagłówków sekcji i etykiet
// tickera W WIDOKU bez zmian - desktop 1350x940 @1 i mobile 412x823 @1,75, PL
// i EN. Liczy się widok, bo tylko tam przesunięcie wchodzi do CLS; tekst poniżej
// zgięcia jest w chwili podmiany niewidoczny. Pojedynczego progu 0,0005 z planu
// nie ma: na mobile tytuł hero fixture (3 linie, ta sama liczba) przełamuje się
// wewnątrz tego samego prostokąta i daje ~0,0006 (raport IMPL P3.2b).
//
// KONTROLA NEGATYWNA (raport P3.2b): ten sam spec na artefakcie bazy (stary stos
// z CMS, jedna twarz zastępcza) daje na desktopie 0,0021 (PL) i 0,0212 (EN),
// z tytułami kart dłuższymi o linię. Wiersz `FONT_SWAP_CLS {...}` w logu niesie
// zmierzone wartości obu artefaktów.
//   NES_PERFORMANCE_ARTIFACT_ROOT=<artefakt> npx playwright test \
//     --config playwright.performance.config.ts e2e-performance/font-swap-cls.spec.ts
//
// STRAŻNIK ŚRODOWISKA. Krój zastępczy powstaje z `local()` (Arial, Liberation
// Sans, Arimo, Helvetica). Runner bez żadnego z nich nie ma czego mierzyć - test
// jest wtedy pomijany z komunikatem, a nie zielony przez przypadek.

interface Shift {
  at: number;
  value: number;
  hadRecentInput: boolean;
  nodes: string[];
}

interface Box {
  selector: string;
  index: number;
  lines: number;
  top: number;
  height: number;
  width: number;
  inView: boolean;
}

declare global {
  interface Window {
    __fontSwap: { shifts: Shift[] };
  }
}

/** Węzły, których łamanie zależy od kroju: tytuły i zajawki kart, nagłówki sekcji, ticker. */
const TEXT_SELECTORS = [
  ".cms-post-title",
  ".cms-post-excerpt",
  "[data-title-root]",
  ".tt-chip-text",
] as const;

const CASES = [
  { name: "desktop PL", path: "/", lang: "pl", width: 1350, height: 940, scale: 1, mobile: false },
  { name: "mobile PL", path: "/", lang: "pl", width: 412, height: 823, scale: 1.75, mobile: true },
  {
    name: "desktop EN",
    path: "/en",
    lang: "en",
    width: 1350,
    height: 940,
    scale: 1,
    mobile: false,
  },
  {
    name: "mobile EN",
    path: "/en",
    lang: "en",
    width: 412,
    height: 823,
    scale: 1.75,
    mobile: true,
  },
] as const;

for (const c of CASES) {
  test.describe(`podmiana fontu: ${c.name}`, () => {
    test.use({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: c.scale,
      isMobile: c.mobile,
      hasTouch: c.mobile,
      locale: c.lang === "pl" ? "pl-PL" : "en-GB",
    });

    test(`podmiana Red Hat Display nie przesuwa układu (${c.name})`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      let releaseFonts!: () => void;
      const fontsReleased = new Promise<void>((resolve) => {
        releaseFonts = resolve;
      });
      const heldFonts: string[] = [];
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = request.url();
        if (isFixtureBackend(url)) {
          const reply = await fixtureResponse(
            new Request(url, {
              method: request.method(),
              headers: request.headers(),
              body: request.method() === "POST" ? request.postData() : undefined,
            }),
          );
          return route.fulfill({
            status: reply.status,
            headers: Object.fromEntries(reply.headers),
            body: await reply.text(),
          });
        }
        if (isAnalyticsScript(url)) {
          return route.fulfill({ body: "", contentType: "application/javascript" });
        }
        if (request.resourceType() === "image") {
          const image = fixtureImageFor(url);
          return route.fulfill({ body: image.body, contentType: image.contentType });
        }
        if (new URL(url).pathname.endsWith(".woff2")) {
          heldFonts.push(new URL(url).pathname);
          await fontsReleased;
        }
        await route.continue();
      });
      await page.addInitScript(() => {
        window.__fontSwap = { shifts: [] };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources?: Array<{
                node?: Node;
                previousRect: DOMRectReadOnly;
                currentRect: DOMRectReadOnly;
              }>;
            }
          >) {
            // Źródłem bywa węzeł tekstowy: opis przez rodzica + przesunięcie prostokąta.
            const describe = (node: Node | undefined) => {
              const element = node instanceof Element ? node : node?.parentElement;
              if (!element) return "detached";
              const text =
                node instanceof Element ? "" : ` text="${node?.textContent?.slice(0, 40)}"`;
              return `${element.outerHTML.slice(0, 160)}${text}`;
            };
            const rect = (r: DOMRectReadOnly) =>
              `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
            window.__fontSwap.shifts.push({
              at: entry.startTime,
              value: entry.value,
              hadRecentInput: entry.hadRecentInput,
              nodes: (entry.sources ?? []).map(
                (s) => `${describe(s.node)} [${rect(s.previousRect)} -> ${rect(s.currentRect)}]`,
              ),
            });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.setExtraHTTPHeaders({ "accept-language": c.lang });

      try {
        await page.goto(c.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("html")).toHaveAttribute("lang", c.lang);
        await expect
          .poll(
            () =>
              page.evaluate(
                () => (window as Window & { __nesAppReady?: boolean }).__nesAppReady === true,
              ),
            { timeout: 30_000 },
          )
          .toBe(true);

        // Strażnik: czy krój zastępczy w ogóle powstaje (Regular i Bold).
        const fallbackResolves = await page.evaluate(async () => {
          const ctx = window.document.createElement("canvas").getContext("2d")!;
          const sample = "Między wielkością a zanikiem: Rzecz o Polsce";
          const results: boolean[] = [];
          for (const weight of [400, 700]) {
            await window.document.fonts.load(`${weight} 20px "Red Hat Display Fallback"`);
            ctx.font = `${weight} 20px "Red Hat Display Fallback", monospace`;
            const fallback = ctx.measureText(sample).width;
            ctx.font = `${weight} 20px monospace`;
            results.push(Math.abs(fallback - ctx.measureText(sample).width) > 1);
          }
          return results.every(Boolean);
        });
        test.skip(
          !fallbackResolves,
          "krój zastępczy nie powstaje: brak Arial/Liberation Sans/Arimo/Helvetica na runnerze",
        );

        // Font naprawdę wstrzymany: zażądany i żadna twarz RHD nie jest załadowana.
        expect(heldFonts.length).toBeGreaterThan(0);
        expect(
          await page.evaluate(
            () =>
              [...window.document.fonts].filter(
                (f) => f.family.replace(/["']/g, "") === "Red Hat Display" && f.status === "loaded",
              ).length,
          ),
        ).toBe(0);

        // Cisza przed zwolnieniem: 600 ms bez nowych przesunięć (hydratacja, wyspy, obrazy).
        await page.evaluate(async () => {
          const deadline = performance.now() + 15_000;
          let seen = window.__fontSwap.shifts.length;
          let quietSince = performance.now();
          while (performance.now() - quietSince < 600 && performance.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (window.__fontSwap.shifts.length !== seen) {
              seen = window.__fontSwap.shifts.length;
              quietSince = performance.now();
            }
          }
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });

        const measure = (selectors: readonly string[]) =>
          page.evaluate((list) => {
            const out: Box[] = [];
            for (const selector of list) {
              window.document.querySelectorAll(selector).forEach((element, index) => {
                const range = window.document.createRange();
                range.selectNodeContents(element);
                const rects = [...range.getClientRects()].filter((r) => r.width && r.height);
                const box = element.getBoundingClientRect();
                out.push({
                  selector,
                  index,
                  lines: new Set(rects.map((r) => Math.round(r.top))).size,
                  top: Math.round(box.top),
                  height: Math.round(box.height),
                  width: Math.round(box.width),
                  inView: box.bottom > 0 && box.top < window.innerHeight,
                });
              });
            }
            return out;
          }, selectors);

        const before = await measure(TEXT_SELECTORS);
        const releaseAt = await page.evaluate(() => performance.now());
        releaseFonts();
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                [...window.document.fonts].some(
                  (f) =>
                    f.family.replace(/["']/g, "") === "Red Hat Display" && f.status === "loaded",
                ),
              ),
            { timeout: 15_000 },
          )
          .toBe(true);
        await page.evaluate(async () => {
          await window.document.fonts.ready;
          for (let i = 0; i < 4; i++) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        });
        const after = await measure(TEXT_SELECTORS);
        const shifts = await page.evaluate(
          (from) => window.__fontSwap.shifts.filter((s) => s.at >= from && !s.hadRecentInput),
          releaseAt,
        );
        const total = shifts.reduce((sum, s) => sum + s.value, 0);
        const largest = shifts.reduce((max, s) => Math.max(max, s.value), 0);
        const changed = after.flatMap((box) => {
          const prior = before.find((b) => b.selector === box.selector && b.index === box.index);
          return prior && prior.lines !== box.lines
            ? [
                {
                  inView: prior.inView,
                  text: `${box.selector}[${box.index}]: ${prior.lines} -> ${box.lines} linii`,
                },
              ]
            : [];
        });
        const lineChanges = changed.filter((ch) => ch.inView).map((ch) => ch.text);
        const belowFold = changed.filter((ch) => !ch.inView).map((ch) => ch.text);
        const report = {
          case: c.name,
          heldFonts,
          shiftCount: shifts.length,
          total: Number(total.toFixed(6)),
          largest: Number(largest.toFixed(6)),
          lineChanges,
          belowFold,
          measured: before.length,
          shifts: shifts.map((s) => ({
            at: Math.round(s.at),
            value: Number(s.value.toFixed(6)),
            nodes: s.nodes,
          })),
        };
        console.log(`FONT_SWAP_CLS ${JSON.stringify(report)}`);
        await testInfo.attach("font-swap-cls", {
          body: JSON.stringify(report, null, 2),
          contentType: "application/json",
        });

        expect(before.length, "brak mierzonych tekstów na stronie").toBeGreaterThan(0);
        expect(lineChanges).toEqual([]);
        expect(total).toBeLessThanOrEqual(0.001);
      } finally {
        releaseFonts();
      }
    });
  });
}
