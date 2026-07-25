// Snapshot regresja PL vs EN: overlay globalnych widgetów musi rozwijać
// `[fn]…[/fn]` w polu odpowiednim dla języka renderu i pomijać wariant
// drugiego języka (żeby licznik dokumentu nie łapał "cieni" z innej wersji).
//
// Testy per język trzymają osobne inline snapshoty - jakakolwiek zmiana
// tooltipa (title), numeracji, escape'owania lub selekcji pola językowego
// od razu wywala odpowiedni snapshot bez fałszywego dzielenia stanu między
// PL i EN.

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode } from "@/lib/builder/types";

type Lang = "pl" | "en";

function bilingualTextWidget(pl: string, en: string, id = "w-i18n"): WidgetNode {
  return {
    kind: "widget",
    id,
    type: "text",
    content: { html_pl: pl, html_en: en },
  } as unknown as WidgetNode;
}

function readHtml(widget: WidgetNode, lang: Lang): string {
  const key = lang === "pl" ? "html_pl" : "html_en";
  return String((widget.content as Record<string, unknown>)[key]);
}

describe("footnote tooltip snapshots - PL vs EN parity", () => {
  it("PL: expands only the html_pl field and leaves html_en untouched", () => {
    const raw = bilingualTextWidget(
      "Kot[fn]ssak domowy[/fn] pije mleko[fn]płyn[/fn].",
      "Cat[fn]domestic mammal[/fn] drinks milk[fn]liquid[/fn].",
    );
    const { widget, notes } = processWidgetFootnotes(raw, "pl");

    expect(readHtml(widget, "pl")).toMatchInlineSnapshot(
      `"Kot<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="ssak domowy" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup> pije mleko<sup class="fn-ref"><a href="#fn-2" id="fnref-2" data-fn="2" title="płyn" aria-describedby="footnotes-heading" role="doc-noteref">[2]</a></sup>."`,
    );
    // Wariant EN musi pozostać nietknięty - inaczej licznik "kradłby"
    // numery z drugiego języka i psuł numerację publikacji.
    expect(readHtml(widget, "en")).toBe(
      "Cat[fn]domestic mammal[/fn] drinks milk[fn]liquid[/fn].",
    );
    expect(notes.map((n) => `${n.id}:${n.html}`)).toEqual([
      "1:ssak domowy",
      "2:płyn",
    ]);
  });

  it("EN: expands only the html_en field and leaves html_pl untouched", () => {
    const raw = bilingualTextWidget(
      "Kot[fn]ssak domowy[/fn] pije mleko[fn]płyn[/fn].",
      "Cat[fn]domestic mammal[/fn] drinks milk[fn]liquid[/fn].",
    );
    const { widget, notes } = processWidgetFootnotes(raw, "en");

    expect(readHtml(widget, "en")).toMatchInlineSnapshot(
      `"Cat<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="domestic mammal" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup> drinks milk<sup class="fn-ref"><a href="#fn-2" id="fnref-2" data-fn="2" title="liquid" aria-describedby="footnotes-heading" role="doc-noteref">[2]</a></sup>."`,
    );
    expect(readHtml(widget, "pl")).toBe(
      "Kot[fn]ssak domowy[/fn] pije mleko[fn]płyn[/fn].",
    );
    expect(notes.map((n) => `${n.id}:${n.html}`)).toEqual([
      "1:domestic mammal",
      "2:liquid",
    ]);
  });

  it("PL and EN produce independent counters when processed separately", () => {
    // Ta sama zawartość, dwa równoległe przebiegi - każdy język startuje
    // od 1. Numeracja nie może wyciekać między PL i EN.
    const raw = bilingualTextWidget(
      "A[fn]jeden[/fn] B[fn]dwa[/fn]",
      "A[fn]one[/fn] B[fn]two[/fn]",
    );
    const pl = processWidgetFootnotes(raw, "pl");
    const en = processWidgetFootnotes(raw, "en");

    expect(pl.notes.map((n) => n.id)).toEqual([1, 2]);
    expect(en.notes.map((n) => n.id)).toEqual([1, 2]);
    expect(pl.notes.map((n) => n.html)).toEqual(["jeden", "dwa"]);
    expect(en.notes.map((n) => n.html)).toEqual(["one", "two"]);
  });

  it("PL escapes locale-specific characters (Polish diacritics stay literal)", () => {
    // Polskie znaki nie są znakami specjalnymi HTML - MUSZĄ trafić do
    // `title` bez konwersji na encje. Odwrotnie: `<`, `>`, `&`, `"`, `'`
    // muszą być zescape'owane.
    const { widget } = processWidgetFootnotes(
      bilingualTextWidget(
        `Zażółć[fn]gęślą jaźń — "cytat" & <em>tag</em>[/fn].`,
        `Placeholder[fn]en[/fn].`,
      ),
      "pl",
    );
    expect(readHtml(widget, "pl")).toMatchInlineSnapshot(
      `"Zażółć<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="gęślą jaźń — &quot;cytat&quot; &amp; tag" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup>."`,
    );
  });

  it("EN escapes locale-specific characters (smart quotes stay literal)", () => {
    const { widget } = processWidgetFootnotes(
      bilingualTextWidget(
        `Placeholder[fn]pl[/fn].`,
        `Note[fn]“smart quotes” — em‑dash & <b>bold</b>[/fn].`,
      ),
      "en",
    );
    expect(readHtml(widget, "en")).toMatchInlineSnapshot(
      `"Note<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="“smart quotes” — em‑dash &amp; bold" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup>."`,
    );
  });

  it("PL and EN remain byte-identical across repeated hydrations", () => {
    const raw = bilingualTextWidget(
      "X[fn]a[/fn] Y[fn]b[/fn]",
      "X[fn]a[/fn] Y[fn]b[/fn]",
    );
    for (const lang of ["pl", "en"] as const) {
      const first = processWidgetFootnotes(raw, lang);
      const firstHtml = readHtml(first.widget, lang);
      let current = first.widget;
      for (let i = 0; i < 3; i += 1) {
        const step = processWidgetFootnotes(current, lang);
        expect(readHtml(step.widget, lang)).toBe(firstHtml);
        expect(step.notes).toEqual([]);
        current = step.widget;
      }
    }
  });

  it("shared counter across languages continues numbering monotonically", () => {
    // Rzadki, ale realny scenariusz: builder renderuje najpierw sekcję PL,
    // potem EN, w jednym dokumencie z ciągłym licznikiem. Snapshoty
    // gwarantują, że EN startuje dokładnie tam gdzie skończyło PL.
    const col = createCounter(1);
    const raw = bilingualTextWidget(
      "PL-A[fn]pl-a[/fn] PL-B[fn]pl-b[/fn]",
      "EN-A[fn]en-a[/fn] EN-B[fn]en-b[/fn]",
    );
    const pl = processWidgetFootnotes(raw, "pl", col);
    const en = processWidgetFootnotes(pl.widget, "en", col);

    expect(readHtml(en.widget, "pl")).toMatchInlineSnapshot(
      `"PL-A<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="pl-a" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup> PL-B<sup class="fn-ref"><a href="#fn-2" id="fnref-2" data-fn="2" title="pl-b" aria-describedby="footnotes-heading" role="doc-noteref">[2]</a></sup>"`,
    );
    expect(readHtml(en.widget, "en")).toMatchInlineSnapshot(
      `"EN-A<sup class="fn-ref"><a href="#fn-3" id="fnref-3" data-fn="3" title="en-a" aria-describedby="footnotes-heading" role="doc-noteref">[3]</a></sup> EN-B<sup class="fn-ref"><a href="#fn-4" id="fnref-4" data-fn="4" title="en-b" aria-describedby="footnotes-heading" role="doc-noteref">[4]</a></sup>"`,
    );
    expect(en.notes.map((n) => n.id)).toEqual([1, 2, 3, 4]);
  });
});
