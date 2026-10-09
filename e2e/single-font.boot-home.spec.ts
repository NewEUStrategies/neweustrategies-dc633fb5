import { expect, test } from "@playwright/test";

// JEDEN FONT W ŚCIEŻCE KRYTYCZNEJ NA ARTEFAKCIE PRODUKCYJNYM (P3.2b, fala 3).
//
// Decyzja właściciela (2026-10-08): jedynym fontem ścieżki krytycznej jest Red Hat
// Display - jeden plik latin + polskie litery (`red-hat-display-latin-pl.woff2`),
// ten sam dla PL i EN. Zasady pilnują dwie bramki CI: `fontPreloadCount` w
// `check:document-weight` (statycznie, z dokumentu) i ten plik (w przeglądarce,
// po hydratacji - czyli także fonty, które dociągnęłaby treść wyrenderowana
// dopiero przez klienta).
//
// CO TEN PLIK PRZYPINA, na `/` (PL) i `/en` (EN):
//   1. dokument preloaduje dokładnie jeden font, a nagłówek `Link` zapowiada ten
//      sam plik (rozjazd = dwa pobrania albo hint w próżnię);
//   2. jedyne żądanie woff2 z buildu (`/assets/*.woff2`) to ten plik - w
//      szczególności PL nie pobiera już `latin-ext` (polskie litery są w pliku
//      głównym, a `unicode-range` latin-ext ich nie obejmuje);
//   3. przeglądarka ma załadowaną dokładnie jedną twarz Red Hat Display.
//
// Kroje dodane w CMS (`@font-face` z `site_design_tokens`) przychodzą spoza
// `/assets/` i nie mają preloadu, więc ta bramka ich nie blokuje (decyzja
// właściciela: „bez blokowania krojów dodawanych w CMS”).

/** Ścieżka pliku woff2 z buildu (`/assets/...`) albo `null`. */
function buildFont(url: string): string | null {
  const { pathname } = new URL(url);
  return /^\/assets\/[^/]+\.woff2$/.test(pathname) ? pathname : null;
}

/** `href` każdego `<link rel=preload as=font>` z `<head>` dokumentu. */
function documentFontPreloads(html: string): string[] {
  const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)));
  return [...head.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /\brel=["']?preload\b/i.test(tag) && /\bas=["']?font\b/i.test(tag))
    .map((tag) => /\bhref=["']([^"']+)["']/i.exec(tag)?.[1] ?? "");
}

/** Pliki fontów zapowiedziane w nagłówku `Link` (`as="font"`). */
function headerFontPreloads(link: string): string[] {
  return link
    .split(/,\s*(?=<)/)
    .filter((value) => /;\s*as="?font"?/i.test(value))
    .map((value) => value.slice(value.indexOf("<") + 1, value.indexOf(">")));
}

for (const [path, lang] of [
  ["/", "pl"],
  ["/en", "en"],
] as const) {
  test.describe(`jeden font ${lang}`, () => {
    test.use({ locale: lang === "pl" ? "pl-PL" : "en-GB" });

    test(`jedno żądanie woff2 z buildu i jest nim preload Red Hat Display (${path})`, async ({
      page,
      request,
    }) => {
      await page.setExtraHTTPHeaders({ "accept-language": lang });
      const document = await request.get(path, {
        headers: { accept: "text/html", "accept-language": lang },
      });
      expect(document.status()).toBe(200);

      // 1. Dokument i nagłówek `Link`: ten sam jeden font.
      const preloads = documentFontPreloads(await document.text());
      expect(preloads).toHaveLength(1);
      expect(preloads[0]).toMatch(/^\/assets\/red-hat-display-latin-pl-[\w-]+\.woff2$/);
      expect(headerFontPreloads(document.headers()["link"] ?? "")).toEqual(preloads);

      // 2. Przeglądarka po hydratacji: jedyne żądanie woff2 z buildu to ten plik.
      const requested: string[] = [];
      page.on("request", (req) => {
        const font = buildFont(req.url());
        if (font) requested.push(font);
      });
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as Window & { __nesAppReady?: boolean }).__nesAppReady === true,
          ),
        )
        .toBe(true);
      await page.evaluate(() => window.document.fonts.ready);
      // Dwie klatki po hydratacji: treść klienta zdąży zażądać brakujących twarzy.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.evaluate(() => window.document.fonts.ready);
      expect(requested).toEqual(preloads);

      // 3. Dokładnie jedna załadowana twarz Red Hat Display.
      const loaded = await page.evaluate(
        () =>
          [...window.document.fonts].filter(
            (face) =>
              face.family.replace(/["']/g, "") === "Red Hat Display" && face.status === "loaded",
          ).length,
      );
      expect(loaded).toBe(1);
    });
  });
}
