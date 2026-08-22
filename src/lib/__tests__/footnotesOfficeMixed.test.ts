// Jeden dokument, wiele rodzajów przypisów: WordPress (footnote_referrer),
// MS Word (#_ftn1 + div#ftn1), LibreOffice (sdfootnote), Google Docs (ftnt)
// i pandoc (fn/li). Wszystkie muszą wyjść jako nasz `[fn]…[/fn]`, a bloki
// definicji zniknąć z treści - inaczej pełna bibliografia renderuje się
// dosłownie w akapicie zamiast w dymku i sekcji "Przypisy źródłowe".
import { describe, it, expect } from "vitest";
import { createCounter, expandFootnotes, normalizeLegacyFootnoteHtml } from "@/lib/footnotes";

const WORD = [
  '<p>Teza<a href="#_ftn1" name="_ftnref1"><sup>[1]</sup></a>.</p>',
  '<div id="ftn1"><p><a href="#_ftnref1">[1]</a> A. Legucka, <em>Geopolityka</em>, s. 33.</p></div>',
].join("");

const LIBRE = [
  '<p>Druga teza<a class="sdfootnoteanc" href="#sdfootnote1sym"><sup>1</sup></a>.</p>',
  '<div id="sdfootnote1"><p><a class="sdfootnotesym" href="#sdfootnote1anc">1</a> Raport NES 2025.</p></div>',
].join("");

const GDOCS = [
  '<p>Trzecia<sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup>.</p>',
  '<p><a href="#ftnt_ref1" id="ftnt1">[1]</a> Google Docs źródło.</p>',
].join("");

const PANDOC = [
  '<p>Czwarta<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>.</p>',
  '<section class="footnotes"><ol><li id="fn1"><p>Pandoc źródło.<a href="#fnref1" class="footnote-back">↩</a></p></li></ol></section>',
].join("");

const WP =
  '<p>Piąta<span class="footnote_referrer"><a href="#x"><sup>[5]</sup></a>' +
  '<span class="footnote_tooltip">WP źródło, <em>tytuł</em>.</span></span>.</p>';

describe("normalizeLegacyFootnoteHtml - eksporty biurowe", () => {
  it.each([
    ["MS Word", WORD, "A. Legucka, <em>Geopolityka</em>, s. 33."],
    ["LibreOffice", LIBRE, "Raport NES 2025."],
    ["Google Docs", GDOCS, "Google Docs źródło."],
    ["pandoc", PANDOC, "Pandoc źródło."],
  ])("konwertuje przypisy z %s na [fn]", (_name, html, body) => {
    const out = normalizeLegacyFootnoteHtml(html);
    expect(out).toContain(`[fn]${body}[/fn]`);
    expect(out).not.toContain("#_ftnref1");
    expect(out).not.toContain("footnote-back");
  });

  it("rozpoznaje wszystkie rodzaje w JEDNYM dokumencie i numeruje po kolei", () => {
    const col = createCounter(1);
    const out = expandFootnotes([WORD, LIBRE, GDOCS, PANDOC, WP].join(""), col);

    expect(col.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(col.notes[0]?.html).toContain("<em>Geopolityka</em>");
    expect(col.notes[4]?.html).toContain("WP źródło");
    // Treść przypisu nie może zostać w akapicie - tylko marker.
    expect(out).not.toContain("Raport NES 2025.<");
    expect(out.match(/<sup class="fn-ref">/g)).toHaveLength(5);
  });

  it("nie rusza treści bez przypisów", () => {
    const html = "<p>Zwykły akapit z linkiem <a href='#fn-1'>x</a></p>";
    expect(normalizeLegacyFootnoteHtml(html)).toBe(html);
  });
});
