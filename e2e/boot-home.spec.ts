import { expect, test } from "@playwright/test";

// Same production-artifact server as boot-timing. Backend-agnostic: this
// asserts content OR an honest recoverable fallback, never only body != empty.
//
// BOOT PO LCP (P2.1). Strona główna nie startuje JS-a z manifestu: dokument niesie zestaw
// `#nes-boot-set` (tryb `lcp`, wejście, seria modułów z rdzeniem słownika języka strony), a loader
// z `<head>` wstawia serię dopiero po wpisie LCP kandydata (albo po zapasach). Dlatego nagłówek
// `Link` dokumentu NIE ma prawa nieść `modulepreload` (każdy taki hint pobrałby JS przed LCP),
// a w HTML-u nie ma ani `<link rel=modulepreload>`, ani `<script type=module src>`.
// Domyślny UA Playwrighta (`HeadlessChrome`) jest botem dla `isbot`, więc ten plik mierzy też
// ścieżkę `allReady`, którą PSI dostaje na MISS.
//
// SERIA GRUPAMI (P3.4). Zestaw strony `lcp` niesie granice grup `g` (domknięcie wejścia | słownik
// + trasa | widgety nad zgięciem), a loader wstawia grupy w osobnych zadaniach i wejście dopiero po
// zażądaniu ostatniej. Na prawdziwym artefakcie sprawdzamy kształt granic i to, że każdy moduł
// serii był zażądany PRZED wstawieniem wejścia (żaden moduł nie ewaluuje się przed całą serią -
// warunek CLS leniwych granic widgetów nad zgięciem).

interface BootSet {
  m: "lcp" | "now";
  e: string;
  u: string[];
  g?: number[];
}

function bootSetsIn(html: string): BootSet[] {
  return [
    ...html.matchAll(/<script type="application\/json" id="nes-boot-set">([^<]*)<\/script>/g),
  ].map((m) => JSON.parse(m[1]) as BootSet);
}

for (const [path, lang] of [
  ["/", "pl"],
  ["/en", "en"],
] as const) {
  test.describe(`homepage locale ${lang}`, () => {
    test.use({ locale: lang === "pl" ? "pl-PL" : "en-GB" });
    test(`homepage SSR and hydration remain usable (${lang})`, async ({ page, request }) => {
      // The bare homepage negotiates Accept-Language. Pin the same input for
      // both the no-JS document request and the browser's navigation.
      await page.setExtraHTTPHeaders({ "accept-language": lang });
      const document = await request.get(path, {
        headers: { accept: "text/html", "accept-language": lang },
      });
      expect(document.status()).toBe(200);
      const html = await document.text();
      expect(html).toContain("data-site-shell");
      expect(html).toContain('id="main-content"');
      // The admin sheet has its own total budget and must never become a
      // public render-blocking dependency. Inspect real links, not JS strings
      // in the router manifest (which legitimately contains every route).
      expect(html).not.toMatch(/<link\b[^>]*href=["'][^"']*admin-styles[^"']*\.css/i);
      // Zestaw bootu: dokładnie jeden, tryb `lcp`, wejście na czele serii, słownik języka strony.
      const sets = bootSetsIn(html);
      expect(sets).toHaveLength(1);
      const [set] = sets;
      expect(set.m).toBe("lcp");
      expect(set.e).toMatch(/^\/assets\/index-[\w-]+\.js$/);
      expect(set.u[0]).toBe(set.e);
      const dictionary = set.u.filter((url) =>
        new RegExp(`^/assets/${lang}-[\\w-]+\\.js$`).test(url),
      );
      expect(dictionary).toHaveLength(1);
      // Granice grup: rosnące, wewnątrz serii, najwyżej trzy grupy; słownik poza pierwszą grupą
      // (domknięcie wejścia), więc granica przed nim zawsze istnieje.
      const bounds = set.g ?? [];
      expect(bounds.length).toBeGreaterThanOrEqual(1);
      expect(bounds.length).toBeLessThanOrEqual(2);
      bounds.forEach((at, i) => {
        expect(Number.isInteger(at)).toBe(true);
        expect(at).toBeGreaterThan(i === 0 ? 0 : bounds[i - 1]);
        expect(at).toBeLessThan(set.u.length);
      });
      expect(set.u.indexOf(dictionary[0])).toBeGreaterThanOrEqual(bounds[0]);
      // Nic nie startuje JS-a przed loaderem: ani znaczniki dokumentu, ani nagłówek `Link`.
      expect(html).not.toMatch(/<link\b[^>]*rel=["']?modulepreload/i);
      expect(html).not.toMatch(/<script\b[^>]*type=["']module["'][^>]*\bsrc=/i);
      expect(document.headers()["link"] ?? "").not.toMatch(/modulepreload/i);
      // Inspect the actual SSR body before JavaScript has a chance to repair it.
      if (html.includes("data-home-loading")) {
        expect(document.headers()["cache-control"]).toContain("no-store");
        expect(html).toContain(lang === "pl" ? "Wczytujemy stronę główną" : "Loading the homepage");
      }

      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          /hydration|hydrating|didn't match|Minified React error #(418|423|425)/i.test(
            message.text(),
          )
        ) {
          errors.push(message.text());
        }
      });
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("[data-site-shell]")).toBeVisible();
      await expect(page.locator("main#main-content")).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
      // Boot przez loader: powód zapisany, węzeł zestawu zdjęty przed hydratacją, wejście w DOM.
      expect(
        await page.evaluate(() =>
          ["lcp", "nocand", "load", "cap", "input"].includes(
            String((window as Window & { __nesBootWhy?: string }).__nesBootWhy),
          ),
        ),
      ).toBe(true);
      await expect(page.locator("#nes-boot-set")).toHaveCount(0);
      await expect(page.locator(`script[type="module"][src="${set.e}"]`)).toHaveCount(1);
      // Każdy moduł serii zażądany (`modulepreload` w DOM) przed wstawieniem wejścia (P3.4).
      const lateModules = await page.evaluate(
        ({ entry, urls }) => {
          // `window.document`: w tym teście `document` to odpowiedź żądania bez JS-a.
          const doc = window.document;
          const script = doc.querySelector(`script[type="module"][src="${entry}"]`);
          const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')];
          return urls.filter((url) => {
            const link = links.find((candidate) => new URL(candidate.href).pathname === url);
            return !link || !script || !(link.compareDocumentPosition(script) & 4);
          });
        },
        { entry: set.e, urls: set.u },
      );
      expect(lateModules).toEqual([]);
      await expect(page.locator('link[rel="stylesheet"][href*="admin-styles"]')).toHaveCount(0);
      const notice = page.locator("[data-home-loading]");
      if (await notice.count()) {
        await expect(notice.getByRole("status")).toBeVisible();
        await expect(notice.getByRole("button")).toBeEnabled();
      }
      expect(errors).toEqual([]);
    });
  });
}

// ZALOGOWANY BOOTUJE NATYCHMIAST (P2.1). Zapisana sesja Supabase w `localStorage`
// (`STORED_SESSION_EXPR`, P1.7) przełącza loader na tryb `now` także na stronie `lcp`: jego
// kontekst sesji i tak się zmieni, a odroczenie opóźniałoby panel członka. Wartość klucza nie
// musi być ważną sesją - liczy się sama obecność wpisu, jak w wyrażeniu loadera.
test("zapisana sesja: strona główna bootuje od razu (`now`), bez czekania na LCP", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("sb-e2e-auth-token", "nie-sesja");
  });
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __nesBootWhy?: string }).__nesBootWhy ?? null),
    )
    .toBe("now");
});
