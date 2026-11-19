import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { HERO_SRCSET_SAMPLE } from "../src/lib/builder/__tests__/heroSrcsetSample";

// BAJTY OBRAZÓW W ŚCIEŻCE LCP W PRAWDZIWYM CHROMIUM (P3.2a; KRYTYKA L6, L7).
//
// 1. WYBÓR KANDYDATA `srcset` (strona testowa). Fixture `/` nie ma ani jednego
//    `srcset` (obrazy z `fixture.invalid` są nietransformowalne), więc wybór 640w
//    sprawdzamy na stronie testowej z PRÓBKĄ `heroSrcsetSample.ts` - tą samą, którą
//    `heroCandidateSelection.test.tsx` przypina do wyjścia renderera buildera i
//    preloadu dla hero w kształcie produkcji. Telefon PSI (412 x 823 @ 1,75) ma
//    wybrać wariant 640w (dawne `sizes` z `100vw` - 768w), desktop PSI (1350 @ 1) -
//    768w, każdy żądany przez parser dokładnie raz. Desktop żąda wyłącznie tego
//    wariantu. Telefon od Chromium 159 (Playwright 1.65.1, headless shell) bywa
//    poprzedzony JEDNYM spekulatywnym żądaniem skanera wstępnego liczonym dla
//    układu 980 px sprzed `<meta viewport>` (CI 2026-11-19: 1920w 19 ms po
//    dokumencie, 3 ms przed 640w; Chromium 153 i 157 go nie robią). To zachowanie
//    przeglądarki, nie wybór strony, więc test telefonu przypina kandydata parsera
//    (`currentSrc`) i dopuszcza najwyżej to jedno żądanie obok niego. Adresy są względne (`/media/...`), więc ta sama
//    strona dowodzi, że rozwiązują się na hoście dokumentu (P4.2).
// 2. MARGINES KOLUMNY (artefakt, `/`): `sizes` telefonu zakłada 32 px marginesu po
//    stronie (`MOBILE_COLUMN_GUTTER_PX`, cztery warstwy po 8 px z CSS). Obraz
//    kandydata LCP przy 412 px ma stać w `left: 32`, `width: 348` - zmiana CSS bez
//    zmiany stałej robi ten test czerwonym (zamiast testu tekstu arkusza).
//
// NAZWA PLIKU. Konfiguracja artefaktu bierze wyłącznie `boot-(artifact|timing|home)`
// (`testMatch`), więc spec jedzie razem z `boot-home` na tym samym serwerze.

const COVER_JPG = readFileSync(new URL("./fixtures/first-visit-cover.jpg", import.meta.url));
const COVER_SVG = readFileSync(new URL("./fixtures/first-visit-cover.svg", import.meta.url));

/** Obrazy fixture (`https://fixture.invalid/*`) z dysku - jak w harnessie Lighthouse. */
async function serveFixtureImages(page: Page): Promise<void> {
  await page.route("https://fixture.invalid/**", (route) => {
    const svg = route.request().url().endsWith(".svg");
    return route.fulfill({
      status: 200,
      contentType: svg ? "image/svg+xml" : "image/jpeg",
      body: svg ? COVER_SVG : COVER_JPG,
    });
  });
}

interface HeroRequests {
  /** Szerokości wszystkich żądań `/media/` w kolejności. */
  readonly widths: string[];
  /** Szerokość kandydata wybranego przez parser (`currentSrc`). */
  readonly selected: string;
}

/** Strona testowa z hero o danym `sizes`: żądane warianty `/media/` i wybrany kandydat. */
async function heroRequests(page: Page, baseURL: string, sizes: string): Promise<HeroRequests> {
  const widths: string[] = [];
  await page.route("**/media/**", (route) => {
    widths.push(new URL(route.request().url()).searchParams.get("width") ?? "oryginał");
    return route.fulfill({ status: 200, contentType: "image/jpeg", body: COVER_JPG });
  });
  const url = new URL("/__p32a-hero-srcset", baseURL).href;
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body:
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '</head><body style="margin:0"><img id="hero" alt="" loading="eager" fetchpriority="high"' +
        ` src="${HERO_SRCSET_SAMPLE.src}" srcset="${HERO_SRCSET_SAMPLE.srcset}" sizes="${sizes}"` +
        ' style="display:block;width:100%"></body></html>',
    }),
  );
  await page.goto(url);
  await page.waitForFunction(() => {
    const img = document.getElementById("hero") as HTMLImageElement | null;
    return img?.complete === true && img.naturalWidth > 0;
  });
  const current = await page.evaluate(
    () => (document.getElementById("hero") as HTMLImageElement).currentSrc,
  );
  // Adres względny rozwiązuje się na hoście dokumentu.
  expect(new URL(current).origin).toBe(new URL(baseURL).origin);
  return { widths, selected: new URL(current).searchParams.get("width") ?? "oryginał" };
}

/**
 * Telefon: parser wybiera `expected` i żąda go dokładnie raz; obok wolno być
 * najwyżej JEDNEMU spekulatywnemu żądaniu skanera wstępnego (nagłówek pliku).
 */
function expectPhoneCandidate({ widths, selected }: HeroRequests, expected: string): void {
  expect(selected).toBe(expected);
  expect(widths.filter((w) => w === expected)).toHaveLength(1);
  expect(widths.length).toBeLessThanOrEqual(2);
}

test.describe("wybór kandydata hero: telefon PSI 412 x 823 @ 1,75 (P3.2a)", () => {
  test.use({
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
  });

  test("`sizes` z marginesem kolumny: parser wybiera 640w i żąda go raz", async ({
    page,
    baseURL,
  }) => {
    expectPhoneCandidate(await heroRequests(page, baseURL!, HERO_SRCSET_SAMPLE.sizes), "640");
  });

  test("REGRESJA UDOKUMENTOWANA: dawne `100vw` na telefonie - 768w", async ({ page, baseURL }) => {
    expectPhoneCandidate(await heroRequests(page, baseURL!, HERO_SRCSET_SAMPLE.legacySizes), "768");
  });
});

test.describe("wybór kandydata hero: desktop PSI 1350 x 940 @ 1 (P3.2a)", () => {
  test.use({ viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 });

  test("kolumna 6/12 (`50vw`): wariant 768w bez zmian", async ({ page, baseURL }) => {
    const { widths, selected } = await heroRequests(page, baseURL!, HERO_SRCSET_SAMPLE.sizes);
    expect(selected).toBe("768");
    expect(widths).toEqual(["768"]);
  });
});

test.describe("artefakt `/` na telefonie 412 x 823 (P3.2a)", () => {
  test.use({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true });

  test("margines kolumny hero = 32 px po stronie (`MOBILE_COLUMN_GUTTER_PX`)", async ({ page }) => {
    await serveFixtureImages(page);
    await page.setExtraHTTPHeaders({ "accept-language": "pl" });
    await page.goto("/");
    const rect = await page.evaluate(() => {
      const r = document.querySelector("img[data-lcp-candidate]")?.getBoundingClientRect();
      return r ? { left: r.left, width: r.width } : null;
    });
    expect(rect).not.toBeNull();
    expect(rect!.left).toBeCloseTo(32, 0);
    expect(rect!.width).toBeCloseTo(412 - 2 * 32, 0);
  });
});
