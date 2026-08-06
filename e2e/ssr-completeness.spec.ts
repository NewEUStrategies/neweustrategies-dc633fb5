import { test, expect, type APIResponse } from "@playwright/test";
import {
  DOC_GUARD_HEADER,
  DOC_GUARD_TRUNCATION_MARKER,
} from "../src/lib/http/documentStreamGuard.server";

// BRAMKA KOMPLETNOŚCI SSR.
//
// Regresja źródłowa: wiszące zapytanie w fazie renderu zamrażało strumień
// dehydratacji w połowie payloadu, więc crawler dostawał HTTP 200 z uciętym
// HTML-em (bez `</html>`, bez skryptu hydratacji) i raportował stronę jako
// zepsutą.
//
// DLACZEGO TA BRAMKA BYŁA POZORNA (audyt 2026-08-06). Strażnik strumienia
// dokumentu (`documentStreamGuard.server.ts`) celowo DOSZTUKOWUJE domykający
// ogon `</body></html>`, gdy render nie dobił do końca - crawler ma dostać
// dokument parsowalny. Skutek uboczny: asercja "HTML kończy się `</html>`"
// przechodziła ZAWSZE, także dla dokumentu uciętego. Test sprawdzał więc
// zachowanie strażnika, nie kompletność renderu.
//
// CO PILNUJE TERAZ (trzy niezależne warstwy):
//   1. sygnatura ucięcia - strażnik znaczy dosztukowany ogon komentarzem
//      `<!--ssr-doc-guard:truncated ...-->`; jego OBECNOŚĆ oblewa bramkę,
//   2. uzbrojenie strażnika - nagłówek `x-ssr-doc-guard`; bez niego asercja
//      z punktu 1. byłaby pusta (przechodziłaby też przy SSR_DOC_GUARD=off),
//   3. asercje TREŚCI per szablon - dokument musi zawierać realny szkielet
//      aplikacji (`<main id="main-content">`, `<footer>`), dokładnie jeden
//      `h1` z sensowną treścią, poprawny `lang` i lokalizowaną kopię chrome'u.
//      Ucięcie w połowie body przechodzi punkty 1-2 tylko wtedy, gdy render
//      naprawdę dobiegł końca - stopka jest ostatnią rzeczą w drzewie.

/** Max time a fully-streamed SSR document may take. */
const SSR_BUDGET_MS = 20_000;

/** Kopia chrome'u renderowana serwerowo na KAŻDEJ trasie (SkipToContentLink). */
const SKIP_LINK_COPY = {
  pl: "Przejdź do treści",
  en: "Skip to content",
} as const;

interface PageCase {
  readonly path: string;
  readonly label: string;
  readonly lang: "pl" | "en";
  /** Nagłówek H1 tego szablonu - dowód, że wyrenderowała się TREŚĆ trasy. */
  readonly h1: RegExp;
}

const PAGES: readonly PageCase[] = [
  { path: "/", label: "home (PL)", lang: "pl", h1: /new european strategies/i },
  { path: "/en", label: "home (EN)", lang: "en", h1: /new european strategies/i },
  { path: "/blog", label: "blog listing", lang: "pl", h1: /blog/i },
  // Trasa PLIKOWA bez zapytań suspense: suita jest backend-agnostyczna
  // (placeholderowe Supabase w CI). Strony CMS-owe (np. /o-nas) nie istnieją
  // bez seeda, a /experts (useSuspenseQuery) odpowiada 500, gdy SSR-owe
  // zapytanie zostanie ubite po timeoucie. /cookies degraduje z założenia
  // (loader z catch -> null) - zweryfikowane: 200 + pełny dokument bez bazy.
  { path: "/cookies", label: "cookie policy", lang: "pl", h1: /cookie|ciasteczk/i },
];

/** Wszystkie `<h1 ...>tekst` dokumentu (SSR jest jednym stringiem, bez DOM-u). */
function headingsLevel1(html: string): string[] {
  return [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) =>
    match[1].replace(/<[^>]*>/g, "").trim(),
  );
}

function assertCompleteDocument(res: APIResponse, html: string, page: PageCase): void {
  const { path, lang } = page;

  expect(res.status(), `${path} status`).toBeLessThan(400);

  // --- 1. Strażnik strumienia jest uzbrojony -------------------------------
  // Bez tego asercja "brak sygnatury ucięcia" nic nie znaczy.
  expect(res.headers()[DOC_GUARD_HEADER], `${path} strażnik dokumentu uzbrojony`).toBe("on");

  // --- 2. Dokument NIE został domknięty awaryjnie --------------------------
  expect(
    html,
    `${path} dokument został dosztukowany przez strażnika (render nie dobiegł końca)`,
  ).not.toContain(DOC_GUARD_TRUNCATION_MARKER);

  // --- 3. Rama dokumentu ---------------------------------------------------
  expect(html, `${path} must open a document`).toContain("<html");
  expect(html.trimEnd().endsWith("</html>"), `${path} must close </html>`).toBe(true);
  expect(html, `${path} lang="${lang}"`).toMatch(new RegExp(`<html[^>]*lang="${lang}"`, "i"));
  expect(html, `${path} niepusty <title>`).toMatch(/<title[^>]*>[^<]+<\/title>/i);

  // --- 4. Szkielet aplikacji, nie sam <head> ------------------------------
  // `<main id="main-content">` otwiera treść, `<footer` zamyka chrome - jeśli
  // strumień urwał się w środku body, stopki w dokumencie NIE MA.
  expect(html, `${path} landmark <main id="main-content">`).toContain('id="main-content"');
  expect(html, `${path} stopka witryny (dowód, że body dobiegło końca)`).toMatch(/<footer\b/i);

  // --- 5. Treść trasy: dokładnie jeden H1, z sensowną treścią -------------
  const h1s = headingsLevel1(html);
  expect(h1s, `${path} dokładnie jeden <h1> (znaleziono: ${h1s.length})`).toHaveLength(1);
  expect(h1s[0], `${path} <h1> nie może być pusty`).not.toBe("");
  expect(h1s[0], `${path} treść <h1>`).toMatch(page.h1);

  // --- 6. i18n rozstrzygnięte SERWEROWO ------------------------------------
  // Surowy klucz (`nav.skipToContent`) albo kopia w złym języku = regresja
  // lokalizacji SSR, niewidoczna dla asercji strukturalnych.
  expect(html, `${path} kopia chrome'u w języku "${lang}"`).toContain(SKIP_LINK_COPY[lang]);
  expect(html, `${path} brak surowych kluczy i18n`).not.toContain("nav.skipToContent");
}

test.describe("SSR HTML completeness", () => {
  for (const page of PAGES) {
    test(`${page.label} (${page.path}) streams a complete document in time`, async ({
      request,
    }) => {
      const started = Date.now();
      const res = await request.get(page.path, { timeout: SSR_BUDGET_MS });
      const html = await res.text();
      const elapsed = Date.now() - started;

      assertCompleteDocument(res, html, page);
      expect(elapsed, `${page.path} SSR budget`).toBeLessThan(SSR_BUDGET_MS);
    });
  }

  // Hydratacja: SSR może być kompletny, a strona i tak "martwa" (błąd inicjalizacji
  // modułu, cykl w grafie chunków). Oba języki, bo /en ma własne wejście i18n.
  //
  // `locale` kontekstu jest USTAWIANE świadomie: goła strona główna negocjuje
  // język z `Accept-Language` (resolveHomepageLang -> redirect na /en dla
  // przeglądarki nie-polskiej), więc bez tego test mierzyłby ustawienia
  // przeglądarki CI, a nie hydratację. Przy okazji pilnuje kontraktu
  // negocjacji: polski gość zostaje na "/", angielski na "/en".
  const HYDRATION_CASES = [
    { path: "/", lang: "pl", locale: "pl-PL", label: "home (PL)" },
    { path: "/en", lang: "en", locale: "en-US", label: "home (EN)" },
  ] as const;

  for (const { path, lang, locale, label } of HYDRATION_CASES) {
    test.describe(`${label} hydration`, () => {
      test.use({ locale });

      test(`${label} hydrates without page errors`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(path, { waitUntil: "load", timeout: SSR_BUDGET_MS });

        const heading = page.getByRole("heading", { level: 1 });
        await expect(heading).toHaveCount(1);
        // `sr-only` nie jest "visible" dla Playwrighta, a strona główna właśnie
        // takiego H1 używa - liczy się obecność w drzewie dostępności i treść.
        await expect(heading).not.toBeEmpty();
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : `${path}/?$`}`));
        expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
      });
    });
  }
});
