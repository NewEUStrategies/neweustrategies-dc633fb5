import { expect, test } from "@playwright/test";

// LISTWA PRAWNA STOPKI NA ARTEFAKCIE PRODUKCYJNYM.
//
// Linki do regulaminu, polityki prywatności, zwrotów i reklamacji, cookies
// i RODO są wymogiem operatora płatności i muszą być osiągalne z każdej strony.
// Produkcyjna strona główna (2026-10-08) ich nie miała: `CopyrightBar` zszedł
// ze stopki 2026-09-08, a dokument buildera stopki linkuje tylko politykę
// prywatności. Listwa wróciła jako część stopki (`LegalLinks` w wyspie
// `site-footer`), niezależna od dokumentu buildera.
//
// CO TEN PLIK PRZYPINA, I DLACZEGO NA ARTEFAKCIE:
//   1. linki są w HTML-u SSR - wewnątrz `<footer data-site-footer>`, w landmarku
//      nawigacji z nazwą ze słownika - czyli widzi je crawler i czytelnik bez
//      JS-a, a adresy EN mają prefiks `/en` (przepisanie wyjścia routera
//      działa na serwerze, czego test jednostkowy z atrapą routera nie widzi);
//   2. kod listwy NIE jedzie w serii bootu strony głównej (`#nes-boot-set`):
//      serwer renderuje ją statycznie, a klient dociąga leniwy chunk dopiero
//      z wyspą stopki;
//   3. po hydratacji wyspy listwa nadal tam jest, z tymi samymi adresami, i nie
//      ma błędu hydratacji (rozjazd serwer/klient porzuciłby HTML wyspy);
//   4. kodu listwy nie ma w chunku wejściowym (`index-*.js`) - pułapka łączenia
//      małych chunków wkleiłaby go tam pod INNĄ nazwą pliku, więc sama nazwa
//      w serii bootu nie wystarcza - a jej `import()` nie ciągnie listy preloadu
//      (`modulePreload.resolveDependencies` w obu konfiguracjach Vite);
//   5. na telefonie (412 px) pływający przycisk „Wróć na górę" nie zasłania
//      żadnego linku listwy po przewinięciu do końca strony (recenzja 2, B2);
//   6. awaria chunku listwy degraduje do braku listwy: jedno przeładowanie
//      globalnej siatki cache-bustingu, potem strona bez listwy, a nie ekran
//      błędu całej strony (recenzja 2, B1).

interface BootSet {
  m: "lcp" | "now";
  e: string;
  u: string[];
}

const REQUIRED = [
  "/regulamin",
  "/polityka-prywatnosci",
  "/zwroty-i-reklamacje",
  "/cookies",
  "/rodo",
] as const;

/** Decyzja o cookies zapisana przed bootem: baner nie zasłania stopki. */
const CONSENT = JSON.stringify({
  version: 2,
  categories: { necessary: true, functional: false, analytics: false, marketing: false },
  ts: Date.now(),
});

const CASES = [
  { path: "/", lang: "pl", label: "Informacje prawne", prefix: "", terms: "Regulamin" },
  {
    path: "/en",
    lang: "en",
    label: "Legal information",
    prefix: "/en",
    terms: "Terms & conditions",
  },
] as const;

function bootSetsIn(html: string): BootSet[] {
  return [
    ...html.matchAll(/<script type="application\/json" id="nes-boot-set">([^<]*)<\/script>/g),
  ].map((m) => JSON.parse(m[1]) as BootSet);
}

/** Fragment `<footer data-site-footer>...</footer>` z dokumentu (bez JS-a). */
function footerHtml(html: string): string {
  const start = html.search(/<footer\b[^>]*\bdata-site-footer\b/);
  expect(start, "brak <footer data-site-footer> w HTML-u SSR").toBeGreaterThan(-1);
  const end = html.indexOf("</footer>", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

/** Treść `<nav>` o podanej nazwie dostępnej - albo `null`, gdy jej nie ma. */
function navByLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<nav\\b[^>]*aria-label="${escaped}"[^>]*>([\\s\\S]*?)</nav>`),
  );
  return match ? match[1] : null;
}

for (const { path, lang, label, prefix, terms } of CASES) {
  test.describe(`listwa prawna ${lang}`, () => {
    test.use({ locale: lang === "pl" ? "pl-PL" : "en-GB" });

    test(`linki prawne są w HTML-u SSR i przeżywają hydratację (${path})`, async ({
      page,
      request,
    }) => {
      await page.setExtraHTTPHeaders({ "accept-language": lang });
      const document = await request.get(path, {
        headers: { accept: "text/html", "accept-language": lang },
      });
      expect(document.status()).toBe(200);
      const html = await document.text();

      // 1. Linki w HTML-u serwera, w stopce, w nazwanym landmarku.
      const nav = navByLabel(footerHtml(html), label);
      expect(nav, `brak <nav aria-label="${label}"> w stopce SSR`).not.toBeNull();
      const hrefs = [...(nav ?? "").matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs).toEqual(expect.arrayContaining(REQUIRED.map((href) => `${prefix}${href}`)));
      if (prefix) expect(hrefs.every((href) => href.startsWith(`${prefix}/`))).toBe(true);

      // 2. Kod listwy poza serią bootu strony głównej.
      const sets = bootSetsIn(html);
      expect(sets).toHaveLength(1);
      expect(sets[0].u.filter((url) => /legal-links/i.test(url))).toEqual([]);
      // ...i nie wkleił się do chunku wejściowego: tam jest tylko leniwy `import()`
      // chunku listwy, bez wpisu w liście preloadu (`__vite__mapDeps`).
      const entry = await request.get(sets[0].e);
      expect(entry.status()).toBe(200);
      const entryCode = await entry.text();
      // Wartości logiczne, nie napis: porażka nie wypisuje do logu ~0,9 MB wejścia.
      expect(
        /import\("\.\/legal-links-[\w-]+\.js"\)/.test(entryCode),
        "wejście ładuje listwę leniwym import()",
      ).toBe(true);
      expect(entryCode.includes("footer.legal_nav"), "klucz nazwy listwy w wejściu").toBe(false);
      expect(
        entryCode.includes("min-h-6 items-center rounded-sm underline-offset-2"),
        "klasy linków listwy w wejściu",
      ).toBe(false);
      expect(
        /"assets\/legal-links-[\w-]+\.js"/.test(entryCode),
        "chunk listwy na liście preloadu (__vite__mapDeps) wejścia",
      ).toBe(false);

      // 3. Hydratacja wyspy stopki bez błędu i bez utraty linków.
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
      await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);

      const footer = page.locator("footer[data-site-footer]");
      await footer.scrollIntoViewIfNeeded();
      await expect(
        page.locator('[data-island-id="site-footer"][data-island-state="hydrated"]'),
      ).toHaveCount(1);

      const legal = footer.getByRole("navigation", { name: label });
      await expect(legal).toBeVisible();
      await expect(legal.getByRole("link", { name: terms })).toHaveAttribute(
        "href",
        `${prefix}/regulamin`,
      );
      const liveHrefs = await legal
        .getByRole("link")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(liveHrefs).toEqual(hrefs);

      // Osiągalna klawiaturą: link listwy przyjmuje fokus.
      const first = legal.getByRole("link").first();
      await first.focus();
      await expect(first).toBeFocused();

      expect(errors).toEqual([]);
    });
  });
}

// 5. TELEFON: przycisk „Wróć na górę" (`BackToTop`, `fixed bottom-6 right-6`)
// nie zasłania listwy. Listwa jest ostatnią treścią strony; przy 412 px zawija
// się na trzy wiersze, a ostatni link wiersza (RODO/GDPR) stał przed poprawką
// pod przyciskiem nawet po przewinięciu do końca. Sprawdzenie jak palec:
// `elementFromPoint` w środku każdego linku musi trafić w ten link, a prostokąt
// linku nie może przecinać prostokąta przycisku (fokus niezasłonięty, WCAG
// 2.4.11). Geometria jest wspólna dla motywów - PL w jasnym, EN w ciemnym.
const MOBILE_CASES = [
  { ...CASES[0], theme: "light", backToTop: "Wróć na górę" },
  { ...CASES[1], theme: "dark", backToTop: "Back to top" },
] as const;

for (const { path, lang, label, theme, backToTop } of MOBILE_CASES) {
  test.describe(`listwa prawna na telefonie (412 px, ${lang})`, () => {
    test.use({
      viewport: { width: 412, height: 823 },
      isMobile: true,
      hasTouch: true,
      locale: lang === "pl" ? "pl-PL" : "en-GB",
    });

    test(`przycisk „Wróć na górę" nie zasłania linków listwy (${path}, ${theme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setExtraHTTPHeaders({ "accept-language": lang });
      await page.addInitScript(
        ([consent, chosenTheme]) => {
          try {
            localStorage.setItem("consent:v2", consent);
            localStorage.setItem("theme", chosenTheme);
          } catch {
            // magazyn zablokowany - test i tak sprawdzi geometrię
          }
        },
        [CONSENT, theme] as const,
      );
      await page.goto(path);
      await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);

      const footer = page.locator("footer[data-site-footer]");
      await footer.scrollIntoViewIfNeeded();
      await expect(
        page.locator('[data-island-id="site-footer"][data-island-state="hydrated"]'),
      ).toHaveCount(1);
      const legal = footer.getByRole("navigation", { name: label });
      await expect(legal).toBeVisible();

      // Do samego końca dokumentu (stopka ma `content-visibility: auto`, więc
      // wysokość może dojść po pierwszym przewinięciu - przewijamy do skutku).
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const root = document.scrollingElement ?? document.documentElement;
            window.scrollTo(0, root.scrollHeight);
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            return root.scrollHeight - (window.scrollY + window.innerHeight) <= 1;
          }),
        )
        .toBe(true);

      // Przycisk jest pokazany i klikalny - inaczej test niczego by nie dowodził.
      const button = page.getByRole("button", { name: backToTop });
      await expect
        .poll(() => button.evaluate((element) => getComputedStyle(element).pointerEvents))
        .not.toBe("none");

      const problems = await legal.getByRole("link").evaluateAll((links, name) => {
        const control = [...document.querySelectorAll("button")].find(
          (element) => element.getAttribute("aria-label") === name,
        );
        const guard = control?.getBoundingClientRect();
        return links.flatMap((link) => {
          const box = link.getBoundingClientRect();
          const href = link.getAttribute("href");
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const issues: string[] = [];
          if (hit?.closest("a") !== link) {
            issues.push(`${href}: środek trafia w ${hit ? hit.outerHTML.slice(0, 80) : "nic"}`);
          }
          if (
            guard &&
            box.left < guard.right &&
            box.right > guard.left &&
            box.top < guard.bottom &&
            box.bottom > guard.top
          ) {
            issues.push(`${href}: prostokąt linku przecina przycisk`);
          }
          return issues;
        });
      }, backToTop);
      expect(problems).toEqual([]);
    });
  });
}

// 6. AWARIA CHUNKU LISTWY. Wyspa zgłasza odrzucony import (`reportError`),
// a globalna siatka `cacheBusting.ts` robi na każdy chunk-load error JEDNO
// twarde przeładowanie `?_v=` (z myślą o dokumencie sprzed wdrożenia); strażnik
// w `sessionStorage` blokuje kolejne przez 15 s. Po przeładowaniu chunk znów nie
// przychodzi, a `RenderErrorBoundary` wokół listwy (`Footer.tsx`) zostawia
// stronę: treść, nagłówek i dokument stopki zostają, znika sama listwa. Przed
// poprawką wyjątek dochodził do globalnego `ErrorBoundary` i cała strona była
// ekranem błędu.
test.describe("awaria chunku listwy prawnej", () => {
  test.use({ locale: "pl-PL" });

  test("jedno przeładowanie, potem strona bez listwy zamiast ekranu błędu", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "accept-language": "pl" });
    let chunkRequests = 0;
    await page.route(/\/assets\/legal-links-[\w-]+\.js(?:\?.*)?$/, (route) => {
      chunkRequests += 1;
      return route.abort();
    });
    const documents: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documents.push(request.url());
      }
    });
    const reloads = () => documents.filter((url) => new URL(url).searchParams.has("_v")).length;

    await page.goto("/");
    // Wyspa stopki otwiera się w punkcie ciszy albo przy widoczności - przewijamy,
    // dopóki siatka nie przeładuje dokumentu.
    await expect
      .poll(
        async () => {
          await page
            .evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
            .catch(() => {});
          return reloads();
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.__nesAppReady === true).catch(() => false))
      .toBe(true);

    const footer = page.locator("footer[data-site-footer]");
    await footer.scrollIntoViewIfNeeded();
    await expect(
      page.locator('[data-island-id="site-footer"][data-island-state="hydrated"]'),
    ).toHaveCount(1);
    await expect(footer.locator('[data-render-error="footer:legal-links"]')).toHaveCount(1);
    await expect(footer.getByRole("navigation", { name: "Informacje prawne" })).toHaveCount(0);
    // Strona żyje: treść, nagłówek i dokument buildera stopki są na miejscu.
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect(page.locator("header").first()).toBeVisible();
    await expect(footer.locator("[data-sec-id]").first()).toBeAttached();

    // Bez pętli: drugie odrzucenie (po przeładowaniu) nie przeładowuje ponownie.
    await page.waitForTimeout(2_000);
    expect(reloads()).toBe(1);
    expect(chunkRequests).toBeGreaterThanOrEqual(2);
  });
});
