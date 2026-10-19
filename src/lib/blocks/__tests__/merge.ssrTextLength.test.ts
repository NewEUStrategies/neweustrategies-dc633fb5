import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlTextLength, mergeInlineIntoHtml } from "@/lib/blocks/merge";

// `htmlTextLength` wyznacza offset karetki po scaleniu bloków (Backspace na
// początku akapitu) i MUSI liczyć tak samo jak `textContent` edytowalnego
// DOM-u. Bez `DOMParser` (SSR, worker) działa fallback regexowy - ten plik
// dowodzi, że dla HTML-a, który realnie stoi w akapitach (formatowanie
// inline, linki, encje), fallback daje TEN SAM wynik co DOM. Encja `&amp;`
// rozwijana przed `&lt;` liczyła tekst „&lt;" jako „<" (naprawione 2026-10-18).
// Granica środowiska jest podmieniana `vi.stubGlobal`; wynik DOM-owy liczy
// prawdziwy parser happy-dom.

afterEach(() => {
  vi.unstubAllGlobals();
});

const CASES = [
  "Zwykły tekst",
  "<strong>Gruby</strong> i <em>pochylony</em>",
  '<a href="/x?a=1&amp;b=2">link</a> po',
  "A &amp; B",
  "1 &lt; 2 &gt; 0",
  "Cytat &quot;w cudzysłowie&quot;",
  "twarda&nbsp;spacja",
  "tekst &amp;lt; pokazany dosłownie",
  "<br>",
  "",
];

describe("htmlTextLength - fallback SSR zgodny z textContent", () => {
  it.each(CASES)("%j ma tę samą długość z DOMParser i bez niego", (html) => {
    const domLength = htmlTextLength(html);
    vi.stubGlobal("DOMParser", undefined);
    expect(htmlTextLength(html)).toBe(domLength);
  });

  it("scalenie bez DOMParser ustawia karetkę w tym samym punkcie złączenia", () => {
    const prev = "<p>A &amp;lt; B</p>";
    const withDom = mergeInlineIntoHtml(prev, "C");
    vi.stubGlobal("DOMParser", undefined);
    const withoutDom = mergeInlineIntoHtml(prev, "C");
    expect(withoutDom).toEqual(withDom);
    expect(withoutDom).toEqual({ html: "<p>A &amp;lt; BC</p>", caretOffset: 8 });
  });
});
