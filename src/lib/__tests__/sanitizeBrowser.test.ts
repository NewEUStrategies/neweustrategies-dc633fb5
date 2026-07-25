// @vitest-environment happy-dom
//
// ŚCIEŻKA PRZEGLĄDARKOWA `sanitizeHtml` (gałąź DOMPurify), której lib/sanitize.test.ts
// celowo nie dotyka - tamten plik działa w środowisku `node`, więc bierze gałąź
// SSR (walker allowlisty).
//
// Ten plik jest bramką na DWIE strony jednocześnie:
//
//   1. SZCZELNOŚĆ - `<script>` / `<style>` / `<iframe>` oraz inline-handlery nie
//      mogą przejść. Gdyby ktoś podniósł `dompurify` do >= 3.4.8, sam DOMPurify
//      przestałby je usuwać pod happy-dom (getter `nodeName` z `Node.prototype`
//      zwraca tu pusty string) - wtedy szczelności pilnuje kanarek silnika,
//      który degraduje wynik do zaescape'owanego tekstu.
//
//   2. UŻYTECZNOŚĆ - bezpieczny markup MUSI przeżyć JAKO MARKUP. To druga
//      połowa bramki: gdyby kanarek zadziałał na przypiętej (sprawnej) wersji,
//      cała treść renderowałaby się jako widoczny tekst. Test poniżej odpada,
//      jeśli aplikacja wpadnie w tryb fail-closed przy zdrowym silniku.
import { describe, expect, it } from "vitest";
import { sanitizeHtml, sanitizeMarkdownHtml } from "../sanitize";

/**
 * Inwariant bezpieczeństwa formułowany na MARKUP, nie na podciągach tekstu:
 * musi być spełniony ZARÓWNO przy sprawnym silniku (tag usunięty), JAK I w
 * trybie fail-closed (tag zaescape'owany do `&lt;script&gt;`, więc nieaktywny).
 * Asercja na sam podciąg `"alert(1)"` mieszałaby te dwa stany - zaescape'owany
 * tekst skryptu jest bezpieczny z definicji.
 */
function expectNoExecutableMarkup(out: string): void {
  expect(out, "znacznik script").not.toMatch(/<\s*\/?\s*script/i);
  expect(out, "znacznik style").not.toMatch(/<\s*\/?\s*style/i);
  expect(out, "znacznik iframe").not.toMatch(/<\s*\/?\s*iframe/i);
  // Inline-handler LICZY SIĘ tylko wewnątrz znacznika.
  expect(out, "inline handler w znaczniku").not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  expect(out, "schemat javascript:").not.toMatch(/<[^>]*javascript\s*:/i);
}

describe("sanitizeHtml (browser / DOMPurify branch)", () => {
  it("never emits <script> markup", () => {
    expectNoExecutableMarkup(sanitizeHtml("<p>ok</p><script>alert(1)</script>"));
  });

  it("never emits <style> or <iframe> markup", () => {
    expectNoExecutableMarkup(sanitizeHtml("<p>ok</p><style>x{}</style>"));
    expectNoExecutableMarkup(sanitizeHtml('<p>ok</p><iframe src="//evil"></iframe>'));
  });

  it("never emits inline event handlers", () => {
    expectNoExecutableMarkup(
      sanitizeHtml('<a href="#" onclick="alert(1)">x</a><img src=x onerror="alert(1)">'),
    );
  });

  it("never emits a javascript: URL", () => {
    expectNoExecutableMarkup(sanitizeHtml('<a href="javascript:alert(1)">x</a>'));
  });

  it("keeps safe markup AS MARKUP - i.e. the engine is healthy, not fail-closed", () => {
    const out = sanitizeHtml("<p>ok</p><strong>bold</strong>");
    expect(out).toContain("<p>");
    expect(out).toContain("<strong>");
    // Fail-closed output would look like "&lt;p&gt;ok&lt;/p&gt;".
    expect(out).not.toContain("&lt;p&gt;");
  });

  it("returns an empty string for empty input without probing anything", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeMarkdownHtml("")).toBe("");
  });
});

describe("sanitizeMarkdownHtml (browser / DOMPurify branch)", () => {
  it("never emits executable markup", () => {
    expectNoExecutableMarkup(
      sanitizeMarkdownHtml("<blockquote>ok</blockquote><script>alert(1)</script>"),
    );
  });

  it("keeps richer safe markup as markup", () => {
    const out = sanitizeMarkdownHtml("<figure><blockquote>cyt</blockquote></figure>");
    expect(out).toContain("<figure>");
    expect(out).toContain("<blockquote>");
    expect(out).not.toContain("&lt;figure&gt;");
  });
});
