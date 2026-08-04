import { test, expect, devices } from "@playwright/test";

// Publiczne strony nie mogą przesuwać się w bok - dopuszczalny jest wyłącznie
// ruch w pionie. Regresja z sierpnia 2026: zwijany header trzymał chrome w
// układzie szerszy niż viewport (width: 100%/scale), przez co na iOS Safari
// dało się przeciągnąć całą stronę w prawo, a pasek czytania wpisu chował się
// poza kadrem. Test jest backend-agnostyczny (CI używa zastępczych danych
// Supabase): mierzy geometrię shellu, która renderuje się bez danych.
//
// Uzupełnia gate źródłowy src/lib/ci/__tests__/horizontalPanGuard.test.ts:
// tam sprawdzamy reguły CSS, tutaj realne wymiary w przeglądarce.

const MOBILE = devices["iPhone 14"].viewport ?? { width: 390, height: 844 };
const ROUTES = ["/", "/blog", "/login"];

test.describe("brak poziomego przesuwania strony", () => {
  test.use({ viewport: MOBILE });

  for (const route of ROUTES) {
    test(`${route} mieści się w szerokości ekranu (mobile)`, async ({ page }) => {
      await page.goto(route);
      // Zwijanie headera i paski pojawiające się po scrollu włączają się dopiero
      // w trakcie przewijania - mierzymy PO scrollu, bo to tam był problem.
      await page.evaluate(() => window.scrollTo({ top: 900 }));
      await page.waitForTimeout(700);

      const metrics = await page.evaluate(() => {
        const de = document.documentElement;
        de.scrollLeft = 500;
        const scrollLeft = de.scrollLeft;
        de.scrollLeft = 0;
        const offenders: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.right > de.clientWidth + 1) {
            offenders.push(
              `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)} right=${Math.round(box.right)}`,
            );
          }
        }
        return {
          clientWidth: de.clientWidth,
          scrollWidth: de.scrollWidth,
          scrollLeft,
          touchAction: window.getComputedStyle(de).touchAction,
          offenders: offenders.slice(0, 8),
        };
      });

      expect(metrics.scrollWidth, "dokument nie jest szerszy niż viewport").toBeLessThanOrEqual(
        metrics.clientWidth + 1,
      );
      expect(metrics.scrollLeft, "dokumentu nie da się przewinąć w poziomie").toBe(0);
      expect(metrics.offenders, "elementy wychodzące poza prawą krawędź").toEqual([]);
    });
  }

  test("gest poziomy jest zablokowany, pinch-zoom zostaje", async ({ page }) => {
    await page.goto("/");
    const touchAction = await page.evaluate(
      () => window.getComputedStyle(document.documentElement).touchAction,
    );
    expect(touchAction).toContain("pan-y");
    expect(touchAction).toContain("pinch-zoom");
  });
});
