import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { routeClientBackend, serveFixtureImages } from "./helpers/artifactFixture";

const articleFixture = JSON.parse(
  readFileSync(new URL("./fixtures/article-reading-post.json", import.meta.url), "utf8"),
) as { post: { takeaways_pl: string[] }; post_layout_settings: Record<string, unknown> };

// KOLUMNA TEKSTU WPISU NA ARTEFAKCIE: `/blog/fixture-2` w przypadku `artifact-boot`
// (`scripts/performance/homeFixture.ts`) niesie treść bloków wpisu
// /blog/droga-obalenia-hegemonii-funta-i-ustanowienie-imperium-dolara, automatyczną
// zajawkę WordPressa (`[&hellip;]`), trzy punkty „Z tego materiału dowiesz się, że”
// i ustawienia układu produkcji (kolumna treści 1180 px, `paragraph_spacing_rem` 1,5).
// Ten plik przypina w prawdziwym Chromium to, czego testy jednostkowe nie zmierzą:
//  1. desktop 1440: kolumna tekstu 820-880 px, mediana 95-115 znaków w wierszu,
//     akapit 17 px / 1,65; nagłówek, punkty i tekst w jednej lewej krawędzi;
//  2. telefon 390: akapit 16 px / 1,6, brak poziomego przewijania;
//  3. odstęp między sąsiednimi akapitami = `paragraph_spacing_rem` (> 0), pusty blok
//     z importu nie dokłada drugiego;
//  4. lead powtarzający początek treści nie jest renderowany; `[infogram …]` nie ma
//     w DOM, jest ramka `e.infogram.com`;
//  5. okładka dalej jedynym kandydatem LCP, CLS w normie, HTML serwera = po hydratacji,
//     ciemny motyw i wydruk bez regresji.

const POST_PATH = "/blog/fixture-2";
/** Ten sam wpis z sidebarem obok tekstu (`layout_overrides.has_sidebar`), jak na produkcji. */
const SIDEBAR_POST_PATH = "/blog/fixture-2-sidebar";
const INFOGRAM_ID = "70a51249-9c3c-4ce0-9929-83c21de9113a";

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __readingCls?: number;
  }
}

async function openPost(page: Page, path = POST_PATH): Promise<string[]> {
  const mismatches: string[] = [];
  const hydration = /hydrat|did not match|server rendered html/i;
  page.on("console", (m) => {
    if (m.type() === "error" && hydration.test(m.text())) mismatches.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (hydration.test(String(e))) mismatches.push(String(e));
  });
  await page.addInitScript(() => {
    window.__readingCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) window.__readingCls = (window.__readingCls ?? 0) + entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await serveFixtureImages(page);
  // Klient odświeża ustawienia układu po punkcie ciszy - ten sam wiersz co SSR.
  await routeClientBackend(page, {
    "/rest/v1/post_layout_settings": articleFixture.post_layout_settings,
  });
  await page.route("https://e.infogram.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>i</title>",
    }),
  );
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
  return mismatches;
}

interface Measure {
  paragraphWidth: number;
  paragraphLeft: number;
  fontSize: number;
  lineHeight: number;
  innerPFontSize: number | null;
  medianCharsPerLine: number;
  gaps: number[];
  gapAroundEmpty: number;
  emptyDisplay: string;
  expectedSpacing: number;
  headerLeft: number;
  headerWidth: number;
  takeawaysLeft: number | null;
  takeawaysWidth: number | null;
  leadPresent: boolean;
  scrollX: number;
  coverCandidates: number;
}

function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[data-reading="article"] .blocks-content');
    if (!body) throw new Error("brak .blocks-content w [data-reading=article]");
    const blocks = [...body.children] as HTMLElement[];
    const paragraphs = blocks.filter(
      (el) =>
        el.dataset.blockType === "paragraph" &&
        !el.hasAttribute("data-block-empty") &&
        (el.textContent ?? "").trim().length > 200,
    );
    const first = paragraphs[0];
    const cs = getComputedStyle(first);
    const innerP = first.querySelector("p");

    // Znaki w wierszu: znaki pogrupowane po górnej krawędzi wiersza; pełne wiersze
    // (bez ostatniego w akapicie), pięć najdłuższych akapitów.
    const perLine: number[] = [];
    for (const el of [...paragraphs]
      .sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)
      .slice(0, 5)) {
      const tops = new Map<number, number>();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        for (let i = 0; i < text.length; i += 1) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect) continue;
          const top = Math.round(rect.top);
          tops.set(top, (tops.get(top) ?? 0) + 1);
        }
      }
      const counts = [...tops.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
      perLine.push(...counts.slice(0, -1));
    }
    perLine.sort((a, b) => a - b);
    const median = perLine.length ? perLine[Math.floor(perLine.length / 2)] : 0;

    // Odstępy między sąsiednimi akapitami (blok po bloku, bez nagłówków i list).
    const gaps: number[] = [];
    for (let i = 1; i < blocks.length; i += 1) {
      const prev = blocks[i - 1];
      const next = blocks[i];
      if (prev.dataset.blockType !== "paragraph" || next.dataset.blockType !== "paragraph")
        continue;
      if (prev.hasAttribute("data-block-empty") || next.hasAttribute("data-block-empty")) continue;
      gaps.push(next.getBoundingClientRect().top - prev.getBoundingClientRect().bottom);
    }
    const empty = body.querySelector<HTMLElement>("[data-block-empty]");
    if (!empty) throw new Error("brak pustego bloku z fixture");
    const before = empty.previousElementSibling as HTMLElement;
    const after = empty.nextElementSibling as HTMLElement;
    const gapAroundEmpty =
      after.getBoundingClientRect().top - before.getBoundingClientRect().bottom;

    const spacing = getComputedStyle(document.querySelector('[data-reading="article"]')!)
      .getPropertyValue("--cms-paragraph-spacing")
      .trim();
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const expectedSpacing = spacing.endsWith("rem")
      ? parseFloat(spacing) * rootPx
      : parseFloat(spacing);

    const header = document.querySelector<HTMLElement>("[data-post-layout] header")!;
    const takeaways = document.querySelector<HTMLElement>(
      '[data-reading="article"] > .key-takeaways',
    );
    const pRect = first.getBoundingClientRect();
    return {
      paragraphWidth: pRect.width,
      paragraphLeft: pRect.left,
      fontSize: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
      innerPFontSize: innerP ? parseFloat(getComputedStyle(innerP).fontSize) : null,
      medianCharsPerLine: median,
      gaps,
      gapAroundEmpty,
      emptyDisplay: getComputedStyle(empty).display,
      expectedSpacing,
      headerLeft: header.getBoundingClientRect().left,
      headerWidth: header.getBoundingClientRect().width,
      takeawaysLeft: takeaways ? takeaways.getBoundingClientRect().left : null,
      takeawaysWidth: takeaways ? takeaways.getBoundingClientRect().width : null,
      leadPresent: !!document.querySelector(".header-excerpt-typography"),
      // Próba przewinięcia w bok: strona nie może się przesunąć.
      scrollX: (() => {
        const y = window.scrollY;
        window.scrollTo(10_000, y);
        const x = window.scrollX;
        window.scrollTo(0, y);
        return x;
      })(),
      coverCandidates: document.querySelectorAll("img[data-lcp-candidate]").length,
    };
  });
}

/** Lewa krawędź ikony i listy karty „Z tego materiału dowiesz się, że”. */
function takeawaysGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(`.key-takeaways ${sel}`)?.getBoundingClientRect() ?? null;
    return {
      iconLeft: rect(".key-takeaways__icon")?.left ?? null,
      listLeft: rect(".key-takeaways__list")?.left ?? null,
    };
  });
}

test.describe("kolumna tekstu wpisu, desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "pl-PL" });

  test("miara, rozmiar, odstępy, lead, shortcode i punkty", async ({ page }) => {
    const mismatches = await openPost(page);
    const m = await measure(page);
    test.info().annotations.push({ type: "pomiar 1440", description: JSON.stringify(m) });

    expect(m.paragraphWidth).toBeGreaterThanOrEqual(820);
    expect(m.paragraphWidth).toBeLessThanOrEqual(880);
    expect(m.medianCharsPerLine).toBeGreaterThanOrEqual(95);
    expect(m.medianCharsPerLine).toBeLessThanOrEqual(115);
    expect(m.fontSize).toBe(17);
    expect(m.lineHeight).toBeCloseTo(1.65, 2);
    // Akapit z `<p>` w środku (pierwszy blok z importu) ma ten sam rozmiar.
    if (m.innerPFontSize !== null) expect(m.innerPFontSize).toBe(17);

    // Odstęp = `paragraph_spacing_rem` z /admin/content-area, bez zera i bez podwojenia.
    expect(m.expectedSpacing).toBeGreaterThan(0);
    expect(m.gaps.length).toBeGreaterThan(10);
    for (const gap of m.gaps) expect(gap).toBeCloseTo(m.expectedSpacing, 0);
    expect(m.emptyDisplay).toBe("none");
    expect(m.gapAroundEmpty).toBeCloseTo(m.expectedSpacing, 0);

    // Nagłówek i sekcja „Z tego materiału dowiesz się, że” w tej samej kolumnie co tekst.
    expect(Math.abs(m.headerLeft - m.paragraphLeft)).toBeLessThanOrEqual(1);
    expect(m.headerWidth).toBeLessThanOrEqual(m.paragraphWidth + 1);
    expect(m.takeawaysLeft).not.toBeNull();
    expect(Math.abs((m.takeawaysLeft ?? 0) - m.paragraphLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs((m.takeawaysWidth ?? 0) - m.paragraphWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator(".key-takeaways li")).toHaveCount(
      articleFixture.post.takeaways_pl.length,
    );
    // Punkty na całą szerokość karty, od lewej krawędzi - pod ikoną.
    const kt = await takeawaysGeometry(page);
    expect(kt.iconLeft).not.toBeNull();
    expect(Math.abs((kt.listLeft ?? 0) - (kt.iconLeft ?? 0))).toBeLessThanOrEqual(1);

    // Zajawka WordPressa to pierwsze zdania treści - lead nie jest renderowany.
    expect(m.leadPresent).toBe(false);

    // Shortcode: zero surowego tekstu, jest ramka Infogram z walidowanym adresem.
    expect(await page.locator("body").textContent()).not.toContain("[infogram");
    await expect(
      page.locator(`iframe[src="https://e.infogram.com/${INFOGRAM_ID}?src=embed"]`),
    ).toHaveCount(1);

    // Okładka dalej jedynym kandydatem LCP; CLS w normie; bez niezgodności hydratacji.
    expect(m.coverCandidates).toBe(1);
    const cls = await page.evaluate(() => window.__readingCls ?? 0);
    test.info().annotations.push({ type: "CLS 1440", description: cls.toFixed(4) });
    expect(cls).toBeLessThan(0.1);
    expect(mismatches).toEqual([]);
  });

  test("HTML serwera niesie kolumnę, osadzenie i brak leadu (SSR = hydratacja)", async ({
    page,
  }) => {
    await serveFixtureImages(page);
    const response = await page.request.get(POST_PATH, { headers: { "accept-language": "pl" } });
    // Znaczniki strony bez skryptów: zdehydratowany stan routera niesie surowe dane
    // bloków (także tekst shortcode'u) - to dane, nie treść widoczna dla czytelnika.
    const html = (await response.text()).replace(/<script\b[\s\S]*?<\/script>/gi, "");
    expect(html).toContain('data-reading="article"');
    expect(html).toContain(`https://e.infogram.com/${INFOGRAM_ID}?src=embed`);
    expect(html).not.toContain("[infogram");
    expect(html).not.toContain("header-excerpt-typography");
    expect(html).toContain('data-block-type="paragraph"');
  });

  test("ciemny motyw: ta sama geometria; wydruk: typografia i szerokość wydruku", async ({
    page,
  }) => {
    await openPost(page);
    const light = await measure(page);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await measure(page);
    expect(dark.paragraphWidth).toBe(light.paragraphWidth);
    expect(dark.fontSize).toBe(light.fontSize);
    expect(dark.gaps).toEqual(light.gaps);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    await page.emulateMedia({ media: "print" });
    const print = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-reading="article"] .blocks-content > [data-block-type="paragraph"]',
      )!;
      const cs = getComputedStyle(el);
      const body = el.parentElement!.getBoundingClientRect();
      return {
        fontSize: parseFloat(cs.fontSize),
        marginLeft: parseFloat(cs.marginLeft),
        width: el.getBoundingClientRect().width,
        bodyWidth: body.width,
      };
    });
    // Wydruk dziedziczy 11.5pt z `@media print`, a tekst zajmuje całą szerokość strony.
    expect(print.fontSize).not.toBe(17);
    expect(print.marginLeft).toBe(0);
    expect(print.width).toBeCloseTo(print.bodyWidth, 0);
  });
});

test.describe("kolumna tekstu wpisu, telefon 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: "pl-PL", isMobile: true });

  test("akapit 16 px / 1,6, odstępy i brak poziomego przewijania", async ({ page }) => {
    const mismatches = await openPost(page);
    const m = await measure(page);
    test.info().annotations.push({ type: "pomiar 390", description: JSON.stringify(m) });

    expect(m.fontSize).toBe(16);
    expect(m.lineHeight).toBeCloseTo(1.6, 2);
    expect(m.scrollX).toBe(0);
    expect(m.expectedSpacing).toBeGreaterThan(0);
    for (const gap of m.gaps) expect(gap).toBeCloseTo(m.expectedSpacing, 0);
    expect(m.gapAroundEmpty).toBeCloseTo(m.expectedSpacing, 0);
    expect(m.leadPresent).toBe(false);
    expect(await page.locator("body").textContent()).not.toContain("[infogram");
    expect(m.coverCandidates).toBe(1);
    // Telefon: punkty na całą szerokość karty, od lewej krawędzi - pod ikoną.
    const kt = await takeawaysGeometry(page);
    expect(kt.iconLeft).not.toBeNull();
    expect(Math.abs((kt.listLeft ?? 0) - (kt.iconLeft ?? 0))).toBeLessThanOrEqual(1);
    expect(mismatches).toEqual([]);
  });
});

/** Krawędzie tekstu, nagłówka, punktów i sidebara wpisu z sidebarem. */
function sidebarGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const paragraph = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-reading="article"] .blocks-content > [data-block-type="paragraph"]',
      ),
    ].find((el) => (el.textContent ?? "").trim().length > 200);
    const p = paragraph?.getBoundingClientRect() ?? null;
    const aside = rect('[data-layout-sidebar="true"] > .grid > aside');
    const header = rect("[data-post-layout] header");
    const kt = rect('[data-reading="article"] > .key-takeaways');
    return {
      layoutSidebar: document
        .querySelector("[data-post-layout]")
        ?.getAttribute("data-layout-sidebar"),
      paragraphLeft: p?.left ?? null,
      paragraphRight: p?.right ?? null,
      fontSize: paragraph ? parseFloat(getComputedStyle(paragraph).fontSize) : null,
      headerLeft: header?.left ?? null,
      headerRight: header?.right ?? null,
      asideLeft: aside?.left ?? null,
      asideWidth: aside?.width ?? null,
      takeawaysLeft: kt?.left ?? null,
      takeawaysRight: kt?.right ?? null,
      // `gap-10` siatki = 2,5rem (korzeń jest płynny od `lg`).
      gap: 2.5 * parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
}

// Wpis z sidebarem obok tekstu (od `lg`): tekst wypełnia całą kolumnę artykułu - od lewej
// krawędzi nagłówka do sidebara (odstęp siatki `gap-10`) - zamiast stać w mierze pośrodku.
// Od `xl` sidebar ma 384 px, na `lg` 320 px.
for (const { width, sidebar } of [
  { width: 1440, sidebar: 384 },
  { width: 1100, sidebar: 320 },
]) {
  test.describe(`kolumna tekstu wpisu z sidebarem, desktop ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, locale: "pl-PL" });

    test("tekst od lewej krawędzi nagłówka do sidebara, sidebar po prawej", async ({ page }) => {
      const mismatches = await openPost(page, SIDEBAR_POST_PATH);
      const g = await sidebarGeometry(page);
      test.info().annotations.push({ type: `sidebar ${width}`, description: JSON.stringify(g) });

      expect(g.layoutSidebar).toBe("true");
      expect(g.fontSize).toBe(17);
      expect(g.asideWidth).toBeCloseTo(sidebar, 0);
      // Tekst zaczyna się na lewej krawędzi nagłówka i kończy odstęp siatki przed sidebarem.
      expect(Math.abs((g.paragraphLeft ?? 0) - (g.headerLeft ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((g.paragraphRight ?? 0) - (g.headerRight ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((g.asideLeft ?? 0) - (g.paragraphRight ?? 0) - g.gap)).toBeLessThanOrEqual(1);
      // Punkty „Z tego materiału dowiesz się, że” na całą szerokość tej samej kolumny.
      expect(Math.abs((g.takeawaysLeft ?? 0) - (g.paragraphLeft ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((g.takeawaysRight ?? 0) - (g.paragraphRight ?? 0))).toBeLessThanOrEqual(1);
      expect(mismatches).toEqual([]);
    });
  });
}
