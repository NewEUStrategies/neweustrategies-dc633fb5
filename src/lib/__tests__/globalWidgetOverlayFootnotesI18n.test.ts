// Snapshot regresja PL vs EN: overlay globalnych widgetów rozwija
// `[fn]…[/fn]` w polach zmapowanych w WIDGET_TEXT_FIELDS i uwzględnia
// warianty lokalizowane. Rzeczywisty kontrakt silnika (patrz
// `localizedKeys` w src/lib/builder/widgetTextFields.ts):
//
//  - dla `lang` przetwarzane są warianty w kolejności:
//    `<base>_<lang>`, `<base>_<other>`, `<base>`,
//  - counter jest wspólny dla całego widgetu, więc jeśli payload zawiera
//    OBIE wersje językowe, current-language dostaje numery 1..N, a druga
//    wersja kontynuuje sekwencję N+1..M — to celowe (fallback + parity
//    między publikacją PL i EN w jednym dokumencie).
//
// Testy per-język używają OSOBNYCH widgetów z jednym polem językowym,
// żeby snapshoty PL i EN były niezależne. Ostatni test dokumentuje
// zachowanie payloadu bilingualnego (kolejność current-first).

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode } from "@/lib/builder/types";

type Lang = "pl" | "en";

function singleLangText(lang: Lang, html: string, id = "w-i18n"): WidgetNode {
  const key = lang === "pl" ? "html_pl" : "html_en";
  return {
    kind: "widget",
    id,
    type: "text",
    content: { [key]: html },
  } as unknown as WidgetNode;
}

function bilingualText(pl: string, en: string, id = "w-bi"): WidgetNode {
  return {
    kind: "widget",
    id,
    type: "text",
    content: { html_pl: pl, html_en: en },
  } as unknown as WidgetNode;
}

function readHtml(widget: WidgetNode, lang: Lang): string {
  const key = lang === "pl" ? "html_pl" : "html_en";
  return String((widget.content as Record<string, unknown>)[key] ?? "");
}

describe("footnote tooltip snapshots - PL vs EN", () => {
  it("PL only: single-language widget renders PL tooltips with numbering 1..N", () => {
    const raw = singleLangText("pl", "Kot[fn]ssak domowy[/fn] pije mleko[fn]płyn[/fn].");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");

    expect(readHtml(widget, "pl")).toMatchInlineSnapshot(
      `"Kot<sup class="fn-ref"><span title="ssak domowy" role="note">[1]</span></sup> pije mleko<sup class="fn-ref"><span title="płyn" role="note">[2]</span></sup>."`,
    );
    expect(notes.map((n) => `${n.id}:${n.html}`)).toEqual(["1:ssak domowy", "2:płyn"]);
  });

  it("EN only: single-language widget renders EN tooltips with numbering 1..N", () => {
    const raw = singleLangText("en", "Cat[fn]domestic mammal[/fn] drinks milk[fn]liquid[/fn].");
    const { widget, notes } = processWidgetFootnotes(raw, "en");

    expect(readHtml(widget, "en")).toMatchInlineSnapshot(
      `"Cat<sup class="fn-ref"><span title="domestic mammal" role="note">[1]</span></sup> drinks milk<sup class="fn-ref"><span title="liquid" role="note">[2]</span></sup>."`,
    );
    expect(notes.map((n) => `${n.id}:${n.html}`)).toEqual(["1:domestic mammal", "2:liquid"]);
  });

  it("PL and EN produce independent counters when processed separately (single-lang widgets)", () => {
    const pl = processWidgetFootnotes(singleLangText("pl", "A[fn]jeden[/fn] B[fn]dwa[/fn]"), "pl");
    const en = processWidgetFootnotes(singleLangText("en", "A[fn]one[/fn] B[fn]two[/fn]"), "en");

    expect(pl.notes.map((n) => n.id)).toEqual([1, 2]);
    expect(en.notes.map((n) => n.id)).toEqual([1, 2]);
    expect(pl.notes.map((n) => n.html)).toEqual(["jeden", "dwa"]);
    expect(en.notes.map((n) => n.html)).toEqual(["one", "two"]);
  });

  it("PL: escapes HTML specials in tooltip, keeps Polish diacritics literal", () => {
    const { widget } = processWidgetFootnotes(
      singleLangText("pl", `Zażółć[fn]gęślą jaźń — "cytat" & <em>tag</em>[/fn].`),
      "pl",
    );
    expect(readHtml(widget, "pl")).toMatchInlineSnapshot(
      `"Zażółć<sup class="fn-ref"><span title="gęślą jaźń — &quot;cytat&quot; &amp; tag" role="note">[1]</span></sup>."`,
    );
  });

  it("EN: escapes HTML specials in tooltip, keeps smart quotes/em-dash literal", () => {
    const { widget } = processWidgetFootnotes(
      singleLangText("en", `Note[fn]“smart quotes” — em‑dash & <b>bold</b>[/fn].`),
      "en",
    );
    expect(readHtml(widget, "en")).toMatchInlineSnapshot(
      `"Note<sup class="fn-ref"><span title="“smart quotes” — em‑dash &amp; bold" role="note">[1]</span></sup>."`,
    );
  });

  it("PL and EN stay byte-identical across repeated hydrations", () => {
    for (const lang of ["pl", "en"] as const) {
      const raw = singleLangText(lang, "X[fn]a[/fn] Y[fn]b[/fn]");
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

  it("bilingual payload: current language gets 1..N, fallback language continues N+1..M", () => {
    // Silnik przetwarza OBA warianty językowe w jednym przebiegu (fallback),
    // przy czym pole current-language idzie pierwsze. Snapshot łapie tę
    // kolejność - jakakolwiek zmiana priorytetu w `localizedKeys` wywali test.
    const rawPl = bilingualText(
      "PL-A[fn]pl-a[/fn] PL-B[fn]pl-b[/fn]",
      "EN-A[fn]en-a[/fn] EN-B[fn]en-b[/fn]",
      "w-bi-pl",
    );
    const pl = processWidgetFootnotes(rawPl, "pl", createCounter(1));

    expect(readHtml(pl.widget, "pl")).toMatchInlineSnapshot(
      `"PL-A<sup class="fn-ref"><span title="pl-a" role="note">[1]</span></sup> PL-B<sup class="fn-ref"><span title="pl-b" role="note">[2]</span></sup>"`,
    );
    expect(readHtml(pl.widget, "en")).toMatchInlineSnapshot(
      `"EN-A<sup class="fn-ref"><span title="en-a" role="note">[3]</span></sup> EN-B<sup class="fn-ref"><span title="en-b" role="note">[4]</span></sup>"`,
    );

    // Odwrotny wybór języka: EN idzie pierwsze (1..2), PL jako fallback (3..4).
    const rawEn = bilingualText(
      "PL-A[fn]pl-a[/fn] PL-B[fn]pl-b[/fn]",
      "EN-A[fn]en-a[/fn] EN-B[fn]en-b[/fn]",
      "w-bi-en",
    );
    const en = processWidgetFootnotes(rawEn, "en", createCounter(1));

    expect(readHtml(en.widget, "en")).toMatchInlineSnapshot(
      `"EN-A<sup class="fn-ref"><span title="en-a" role="note">[1]</span></sup> EN-B<sup class="fn-ref"><span title="en-b" role="note">[2]</span></sup>"`,
    );
    expect(readHtml(en.widget, "pl")).toMatchInlineSnapshot(
      `"PL-A<sup class="fn-ref"><span title="pl-a" role="note">[3]</span></sup> PL-B<sup class="fn-ref"><span title="pl-b" role="note">[4]</span></sup>"`,
    );
  });
});
