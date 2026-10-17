// Zwarta typografia panelu admina nie wchodzi do widgetów w kanwie buildera.
//
// REGRESJA (zgłoszenie z kanwy, slider z tytułem 26 px): reguła
// `.admin-compact span:not([class*="text-"]) { font-size: 13px }` trafiała
// w `span.cms-title-underline` wewnątrz `h3.cms-post-title`. Nagłówek miał
// 26 px (interlinia z 26 px), a litery 13 px - „mały tytuł z wielkimi
// odstępami”, a autor obok (tytuł - 2 px = 24 px) wyglądał na większy od
// tytułu. Na stronie publicznej `.admin-compact` nie istnieje, więc kanwa
// i „Podgląd na żywo” pokazywały co innego niż strona.
//
// Arkusz `admin-styles.css` czytamy jako DANE (selektory): happy-dom nie
// rozwiązuje złożonego `:not(A *, B *)` wewnątrz `:where()`, więc samą kaskadę
// sprawdzono w Chromium (span tytułu 26 px w kanwie i w „Podglądzie na żywo”,
// tekst panelu 13 px).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCssRules } from "@/test/cssRules";

const ADMIN_CSS = readFileSync("src/admin-styles.css", "utf8");
const EXCLUDED = ":where(:not([data-w-id] *, .cms-post-title *))";

describe("admin-compact: rozmiary tekstu kończą się na ramce widgetu", () => {
  it("każda reguła rozmiaru tekstu treści omija widget i tytuł wpisu", () => {
    const textRules = parseCssRules(ADMIN_CSS).filter(
      (rule) =>
        rule.context.length === 0 &&
        rule.declarations.has("font-size") &&
        rule.selectors.some((s) =>
          /^\.admin-compact (?:p|li|label|span|small|\.text-(?:xs|sm|base|lg|[234]?xl))\b/.test(s),
        ),
    );
    expect(textRules.length).toBeGreaterThanOrEqual(9);
    for (const rule of textRules) {
      for (const selector of rule.selectors) expect(selector).toContain(EXCLUDED);
    }
  });

  it("`revert` nagłówków w kanwie nie przykrywa tytułu wpisu (ten sam rozmiar co na stronie)", () => {
    const revert = parseCssRules(ADMIN_CSS).filter(
      (rule) => rule.declarations.get("font-size") === "revert",
    );
    expect(revert.length).toBeGreaterThan(0);
    for (const rule of revert) {
      for (const selector of rule.selectors) {
        expect(selector).toContain(":where(:not(.cms-post-title))");
      }
    }
  });
});
