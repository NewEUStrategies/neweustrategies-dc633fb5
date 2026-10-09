import { expect, test, type Page } from "@playwright/test";

// LENIWA PUBLIKACJA `--sticky-header-h` NA ARTEFAKCIE (P3.1 A, klasa PB5): `/` na
// fixture `first-visit`, 1350×940 (ten sam serwer i backend co `boot-home`,
// `playwright.artifact.config.ts`).
//
// CO JEST PRZYPINANE (prawdziwa przeglądarka, prawdziwy CSS i przewijanie):
//  1. Bez interakcji (i bez ciszy) `Header.tsx` NIE zapisuje zmiennej na <html> -
//     zapis przy montażu kosztował przeliczenie stylu całego dokumentu w oknie
//     TBT (913 el. na desktop4x). Kółko myszy otwiera zatrzask „interakcja albo
//     cisza" i zmienna dostaje zmierzoną wysokość nagłówka.
//  2. Klik w kotwicę jako PIERWSZA interakcja publikuje synchronicznie, przed
//     domyślną akcją: cel ląduje tam, gdzie po wcześniejszej publikacji (±2 px),
//     a nie ~160 px pod paskiem (fallback 96 px wobec 259 px nagłówka).
//
// NAZWA PLIKU i MASKA AKTYWACJI jak w `motion-gate.boot-home.spec.ts`: konfiguracja
// artefaktu bierze wyłącznie `boot-(artifact|timing|home)`, a ewaluacje CDP
// nadają dokumentowi lepką aktywację, którą `firstInteraction` czytałby jako
// interakcję sprzed subskrypcji (zatrzask otwierałby się sam). Maska zwraca
// `true` dopiero po zaufanym zdarzeniu aktywującym.
//
// UTRZYMANIE RUCHU SIECI: strona co sekundę pobiera `/favicon.ico?…`, więc punkt
// ciszy nie zapada w czasie testu i zapis może dać tylko interakcja.

test.use({ viewport: { width: 1350, height: 940 } });

declare global {
  interface Window {
    __nesAppReady?: boolean;
  }
}

const TARGET_ID = "p31-target";

async function prepare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let activated = false;
    for (const type of ["keydown", "mousedown", "pointerdown", "pointerup", "touchend"]) {
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) activated = true;
        },
        { capture: true, passive: true },
      );
    }
    Object.defineProperty(Navigator.prototype, "userActivation", {
      configurable: true,
      get: () => ({ hasBeenActive: activated, isActive: activated }),
    });
    document.addEventListener("DOMContentLoaded", () => {
      let n = 0;
      window.setInterval(() => {
        n += 1;
        void fetch(`/favicon.ico?sticky-header-keepalive=${n}`, { cache: "no-store" }).catch(
          () => undefined,
        );
      }, 1_000);
    });
  });
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
}

async function openHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
}

function inlineVar(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--sticky-header-h").trim(),
  );
}

function headerHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const header = document.querySelector("header[data-site-header]");
    return header ? Math.round(header.getBoundingClientRect().height) : -1;
  });
}

/**
 * Kotwica (stała, przy lewej krawędzi w połowie wysokości, nad wszystkim) i cel z
 * `id` na dole strony, z zapasem pod spodem - przewinięcie nie może się oprzeć o
 * koniec dokumentu, bo wtedy `scroll-margin-top` nie miałby znaczenia.
 */
async function addAnchor(page: Page): Promise<void> {
  await page.evaluate((id) => {
    const target = document.createElement("div");
    target.id = id;
    target.style.cssText = "height:40px;background:#f0f";
    const spacer = document.createElement("div");
    spacer.style.cssText = "height:150vh";
    const link = document.createElement("a");
    link.href = `#${id}`;
    link.id = `${id}-link`;
    link.textContent = "do celu P3.1";
    link.style.cssText =
      "position:fixed;left:0;top:50%;z-index:2147483647;padding:8px;background:#fff;color:#000";
    document.body.append(target, spacer, link);
  }, TARGET_ID);
}

/** Pozycja celu po zakończeniu przewijania i animacji zwijania nagłówka. */
async function settledTargetTop(page: Page): Promise<number> {
  let previous = Number.NaN;
  await expect
    .poll(
      async () => {
        const top = await page.evaluate(
          (id) => document.getElementById(id)?.getBoundingClientRect().top ?? Number.NaN,
          TARGET_ID,
        );
        const stable = Math.abs(top - previous) < 0.5;
        previous = top;
        return stable;
      },
      { intervals: [400], timeout: 10_000 },
    )
    .toBe(true);
  return previous;
}

test.describe("leniwa publikacja --sticky-header-h (P3.1 A)", () => {
  test("bez interakcji 3 s bez zapisu; kółko myszy publikuje wysokość nagłówka", async ({
    page,
  }) => {
    await prepare(page);
    await openHome(page);
    await page.waitForTimeout(3_000);
    expect(await inlineVar(page)).toBe("");

    // Kółko w górę na szczycie strony: zdarzenie `wheel` bez przewinięcia,
    // więc nagłówek zostaje rozwinięty.
    await page.mouse.move(675, 600);
    await page.mouse.wheel(0, -200);
    await expect.poll(() => inlineVar(page), { timeout: 2_000 }).not.toBe("");
    const published = Number.parseFloat(await inlineVar(page));
    expect(Math.abs(published - (await headerHeight(page)))).toBeLessThanOrEqual(1);
  });

  test("klik w kotwicę jako pierwsza interakcja ląduje jak po wcześniejszej publikacji", async ({
    page,
  }) => {
    await prepare(page);

    // Przebieg 1: klik w kotwicę jest PIERWSZĄ interakcją, zmienna jeszcze pusta.
    await openHome(page);
    await addAnchor(page);
    expect(await inlineVar(page)).toBe("");
    const expanded = await headerHeight(page);
    await page.locator(`#${TARGET_ID}-link`).click();
    expect(Number.parseFloat(await inlineVar(page))).toBeGreaterThan(0);
    const firstClickTop = await settledTargetTop(page);

    // Przebieg 2: ta sama strona, zmienna opublikowana wcześniej (kółko + zatrzask).
    await openHome(page);
    await addAnchor(page);
    await page.mouse.move(675, 600);
    await page.mouse.wheel(0, -200);
    await expect.poll(() => inlineVar(page), { timeout: 2_000 }).toBe(`${expanded}px`);
    await page.locator(`#${TARGET_ID}-link`).click();
    const publishedTop = await settledTargetTop(page);

    expect(Math.abs(firstClickTop - publishedTop)).toBeLessThanOrEqual(2);
  });
});
