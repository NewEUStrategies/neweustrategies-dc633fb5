// Wejście z fragmentem, którego cel React odsłania PÓŹNO - `src/lib/scroll/fragmentLandingScript.ts`.
//
// SCENARIUSZ Z CI (38982787871, desktop): cel kotwicy leży w segmencie granicy strumienia
// (`<div hidden id="S:…">`), a React 19.2 odsłania segmenty partiami (`$RC` -> `$RV`, kolejne
// partie co >=300 ms). Na szybkim urządzeniu odsłonięcie wypada po `load` (koniec kotwicy
// Chromium) i po hydratacji (jednorazowe przewinięcie routera) - strona zostawała na górze.
// Test odtwarza to deterministycznie: opóźnia `$RV` o 1,5 s, czyli przesuwa odsłonięcie za
// `load` i za hydratację niezależnie od szybkości maszyny. Bez skryptu lądowania: `scrollY` 0
// (zmierzone na artefakcie); z nim - cel w widoku.
import { expect, test, type Page } from "@playwright/test";

const REVEAL_DELAY_MS = 1500;
const VIEWPORT = { width: 1350, height: 940 };

test.use({ viewport: VIEWPORT });

/** Ostatni element z `id` w segmencie strumienia HTML-u serwera `/` (cel daleko pod zgięciem). */
async function streamedTargetId(page: Page): Promise<string> {
  const response = await page.request.get("/", { headers: { "accept-language": "pl" } });
  const html = await response.text();
  const id = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const inSegments = [...doc.querySelectorAll('div[hidden][id^="S:"] [id]')];
    return inSegments.at(-1)?.id ?? null;
  }, html);
  expect(id, "HTML `/` fixture ma element z id w segmencie strumienia").not.toBeNull();
  return id!;
}

/** Opóźnia odsłanianie partii granic (`$RV` z runtime'u Fizz w dokumencie). */
async function delayReveals(page: Page): Promise<void> {
  await page.addInitScript((delay) => {
    const w = window as unknown as Record<string, unknown>;
    let reveal: unknown;
    Object.defineProperty(window, "$RV", {
      configurable: true,
      get: () => reveal,
      set: (fn: (...args: unknown[]) => void) => {
        w.__revealWrapped = true;
        reveal = (...args: unknown[]) => setTimeout(() => fn(...args), delay);
      },
    });
  }, REVEAL_DELAY_MS);
}

async function waitForReveal(page: Page, id: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((target) => {
        const el = document.getElementById(target);
        return !!el && !el.closest("[hidden]");
      }, id),
    )
    .toBe(true);
  // Kilka klatek po odsłonięciu: odpytywanie skryptu (100 ms) i klatka odczytu.
  await page.waitForTimeout(600);
}

const where = (id: string) => ({
  top: document.getElementById(id)!.getBoundingClientRect().top,
  scrollY,
  wrapped: (window as unknown as { __revealWrapped?: boolean }).__revealWrapped === true,
});

test("cel w segmencie odsłoniętym po `load` i po hydratacji: strona ląduje na celu", async ({
  page,
}) => {
  const id = await streamedTargetId(page);
  await delayReveals(page);
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  await page.goto(`/#${encodeURIComponent(id)}`);
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
  // Warunek scenariusza: aplikacja wystartowała, a cel jest wciąż w ukrytym segmencie.
  const beforeReveal = await page.evaluate(
    (target) => !!document.getElementById(target)?.closest("[hidden]"),
    id,
  );
  expect(beforeReveal, "odsłonięcie wypada po hydratacji").toBe(true);

  await waitForReveal(page, id);
  const landed = await page.evaluate(where, id);
  expect(landed.wrapped, "runtime Fizz nadal odsłania przez `$RV`").toBe(true);
  expect(landed.scrollY, JSON.stringify(landed)).toBeGreaterThan(VIEWPORT.height);
  expect(landed.top, JSON.stringify(landed)).toBeGreaterThanOrEqual(0);
  expect(landed.top, JSON.stringify(landed)).toBeLessThan(VIEWPORT.height);
});

test("użytkownik przewinął przed odsłonięciem: skrypt nie zabiera mu pozycji", async ({ page }) => {
  const id = await streamedTargetId(page);
  await delayReveals(page);
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  await page.goto(`/#${encodeURIComponent(id)}`);
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);

  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const reading = await page.evaluate(() => scrollY);

  await waitForReveal(page, id);
  const after = await page.evaluate(where, id);
  expect(after.wrapped).toBe(true);
  // Bez skoku do celu (~2400 px niżej); drobne przesunięcia z odsłaniania wyżej są dozwolone.
  expect(Math.abs(after.scrollY - reading), JSON.stringify({ reading, after })).toBeLessThan(
    VIEWPORT.height,
  );
});
