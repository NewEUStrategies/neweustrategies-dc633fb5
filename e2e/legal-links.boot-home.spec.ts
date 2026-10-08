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
//      ma błędu hydratacji (rozjazd serwer/klient porzuciłby HTML wyspy).

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
