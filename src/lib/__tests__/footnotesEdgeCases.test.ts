// Brzegi silnika przypisów, których pliki tematyczne nie dotykają:
// - numeracja ciągła także przez SEKCJĘ WEWNĘTRZNĄ (inner-section) buildera,
// - kolekcje widgetu w kształcie innym niż tablica obiektów (dane z bazy),
// - eksport biurowy z pustą definicją albo odsyłaczem bez definicji,
// - dymek WordPressa, z którego po odcięciu „Czytaj dalej” nic nie zostaje.
// Każdy z tych przypadków to treść, która realnie przychodzi z migracji
// i edytora - zgubiony albo podwojony numer widać od razu w sekcji końcowej.
import { describe, expect, it } from "vitest";
import {
  collectWpFootnoteTexts,
  createCounter,
  expandFootnotes,
  normalizeLegacyFootnoteHtml,
  normalizeOfficeFootnoteHtml,
  processDocFootnotes,
  processWidgetFootnotes,
} from "@/lib/footnotes";
import type {
  BuilderDocument,
  ColumnNode,
  InnerSectionNode,
  WidgetNode,
} from "@/lib/builder/types";

const text = (id: string, html: string): WidgetNode => ({
  id,
  kind: "widget",
  type: "text",
  content: { html_pl: html },
});

const column = (id: string, children: WidgetNode[]): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
  children,
});

const markerIds = (html: unknown): string[] =>
  [...String(html).matchAll(/data-fn="(\d+)"/g)].map((m) => m[1]);

describe("processDocFootnotes - sekcja wewnętrzna", () => {
  it("numeruje ciągle przez kolumnę i kolumny sekcji wewnętrznej", () => {
    const inner: InnerSectionNode = {
      id: "inner-1",
      kind: "inner-section",
      columns: [
        column("ic-1", [text("w2", "B[fn]druga[/fn]")]),
        column("ic-2", [text("w3", "C[fn]trzecia[/fn]")]),
      ],
    };
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [column("c1", [text("w1", "A[fn]pierwsza[/fn]")]), inner],
        },
      ],
    };

    const { doc: prepared, notes } = processDocFootnotes(doc, "pl");
    const preparedInner = prepared.sections[0]?.children[1];
    const innerColumns = preparedInner?.kind === "inner-section" ? preparedInner.columns : [];

    expect(notes).toEqual([
      { id: 1, html: "pierwsza" },
      { id: 2, html: "druga" },
      { id: 3, html: "trzecia" },
    ]);
    expect(innerColumns).toHaveLength(2);
    expect(markerIds(innerColumns[0]?.children[0]?.content.html_pl)).toEqual(["2"]);
    expect(markerIds(innerColumns[1]?.children[0]?.content.html_pl)).toEqual(["3"]);
    // Wejście zostaje nietknięte - przetwarzanie jest czyste.
    expect(inner.columns[0]?.children[0]?.content.html_pl).toBe("B[fn]druga[/fn]");
  });
});

describe("processWidgetFootnotes - kolekcje w nietypowym kształcie", () => {
  it("kolekcja, która nie jest tablicą, zostaje pominięta bez zmiany widgetu", () => {
    const widget: WidgetNode = {
      id: "acc",
      kind: "widget",
      type: "accordion",
      content: { items: "Odp[fn]nota[/fn]" },
    };

    const { widget: out, notes } = processWidgetFootnotes(widget, "pl");

    expect(out).toBe(widget);
    expect(notes).toEqual([]);
  });

  it("pozycje niebędące obiektem przechodzą bez zmian, obiekty dostają markery", () => {
    const untouched = { q_pl: "Bez przypisu" };
    const widget: WidgetNode = {
      id: "acc",
      kind: "widget",
      type: "accordion",
      content: {
        items: [
          null,
          "luźny tekst [fn]x[/fn]",
          ["a_pl"],
          untouched,
          { q_pl: "Pytanie", a_pl: "Odp[fn]źródło[/fn]" },
        ],
      },
    };

    const { widget: out, notes } = processWidgetFootnotes(widget, "pl");
    const items = Array.isArray(out.content.items) ? out.content.items : [];
    const answer = items[4];

    expect(items.slice(0, 3)).toEqual([null, "luźny tekst [fn]x[/fn]", ["a_pl"]]);
    // Pozycja bez przypisu zachowuje tożsamość - bez zbędnej kopii.
    expect(items[3]).toBe(untouched);
    expect(answer).toMatchObject({
      q_pl: "Pytanie",
      a_pl: expect.stringContaining('role="note">[1]</span>'),
    });
    expect(notes).toEqual([{ id: 1, html: "źródło" }]);
  });
});

describe("normalizeOfficeFootnoteHtml - niepełne eksporty", () => {
  it("definicja pusta po odcięciu backlinku nie kasuje odsyłacza ani bloku", () => {
    const html =
      '<p>Teza<a href="#_ftn1" name="_ftnref1">[1]</a>.</p>' +
      '<div id="ftn1"><p><a href="#_ftnref1">[1]</a></p></div>';

    // Bez żadnej definicji z treścią wynik jest dosłownie wejściem.
    expect(normalizeOfficeFootnoteHtml(html)).toBe(html);
  });

  it("odsyłacz bez definicji zostaje, odsyłacz z definicją staje się [fn]", () => {
    const html =
      '<p>Pierwsza<a href="#_ftn1" name="_ftnref1">[1]</a>, druga<a href="#_ftn2" name="_ftnref2">[2]</a>.</p>' +
      '<div id="ftn1"><p><a href="#_ftnref1">[1]</a> Raport NES, s. 4.</p></div>';

    const out = normalizeOfficeFootnoteHtml(html);

    expect(out).toContain("Pierwsza[fn]Raport NES, s. 4.[/fn]");
    expect(out).toContain('druga<a href="#_ftn2" name="_ftnref2">[2]</a>');
    expect(out).not.toContain('id="ftn1"');
  });
});

describe("WordPress - dymek i tabela źródeł bez treści", () => {
  it("dymek z samym „Czytaj dalej” i wielokropkiem znika bez pustego przypisu", () => {
    const html =
      '<p>Teza<span class="footnote_referrer"><a><sup>[3]</sup></a>' +
      '<span class="footnote_tooltip">&nbsp;&#x2026; <span class="footnote_tooltip_continue">Czytaj dalej</span></span></span>.</p>';

    const out = normalizeLegacyFootnoteHtml(html);

    expect(out).toBe("<p>Teza.</p>");
    expect(expandFootnotes(out, createCounter()).includes("fn-ref")).toBe(false);
  });

  it("wiersz tabeli z pustą komórką nie nadpisuje skróconego dymka pustką", () => {
    const table =
      '<table><tr><th><a id="footnote_plugin_reference_7_1">1</a></th><td class="footnote_plugin_text">  </td></tr>' +
      '<tr><th><a id="footnote_plugin_reference_7_2">2</a></th><td class="footnote_plugin_text">Pełna treść.</td></tr></table>';

    const map = collectWpFootnoteTexts([table, 42, null]);

    expect([...map.entries()]).toEqual([["7_2", "Pełna treść."]]);
  });
});

describe("createCounter", () => {
  it("bez argumentu numeruje od 1 i przesuwa licznik za ostatnią notę", () => {
    const col = createCounter();

    const out = expandFootnotes("A[fn]a[/fn] B[fn]b[/fn]", col);

    expect(markerIds(out)).toEqual(["1", "2"]);
    expect(col.counter).toBe(3);
  });
});

// Dokument buildera trzyma OBA języki w jednym drzewie (`html_pl` + `html_en`),
// a renderer pokazuje bieżący wariant, drugi tylko jako fallback pustego.
// Do tej naprawy ścieżka dokumentu rozwijała oba warianty jednym licznikiem:
// polska strona dwujęzycznego wpisu miała w treści markery [1] i [3],
// a „Przypisy źródłowe” listowały także angielskie noty 2 i 4 - przypisy-widma
// bez odsyłacza. Nakładka globalnych widgetów (markery samodzielne, bez sekcji
// końcowej) świadomie zostaje przy obu wariantach - patrz
// `globalWidgetOverlayFootnotesI18n.test.ts`.
describe("processDocFootnotes - dokument dwujęzyczny", () => {
  const bilingual = (id: string, pl: string, en: string): WidgetNode => ({
    id,
    kind: "widget",
    type: "text",
    content: { html_pl: pl, html_en: en },
  });
  const docOf = (...widgets: WidgetNode[]): BuilderDocument => ({
    version: 1,
    sections: [{ id: "s1", kind: "section", children: [column("c1", widgets)] }],
  });
  const widgetsOf = (doc: BuilderDocument): WidgetNode[] => {
    const first = doc.sections[0]?.children[0];
    return first?.kind === "column" ? first.children : [];
  };
  const doc = docOf(
    bilingual("w1", "A[fn]pl-a[/fn]", "A[fn]en-a[/fn]"),
    bilingual("w2", "B[fn]pl-b[/fn]", "B[fn]en-b[/fn]"),
  );

  it("strona polska numeruje i listuje wyłącznie polskie noty", () => {
    const { doc: prepared, notes } = processDocFootnotes(doc, "pl");
    const [w1, w2] = widgetsOf(prepared);

    expect(notes).toEqual([
      { id: 1, html: "pl-a" },
      { id: 2, html: "pl-b" },
    ]);
    expect(markerIds(w1?.content.html_pl)).toEqual(["1"]);
    expect(markerIds(w2?.content.html_pl)).toEqual(["2"]);
    // Wariant niewidoczny na tej stronie zostaje surowy - nie zużywa numerów.
    expect(w1?.content.html_en).toBe("A[fn]en-a[/fn]");
  });

  it("strona angielska - lustrzanie, z własną numeracją od 1", () => {
    const { notes } = processDocFootnotes(doc, "en");

    expect(notes).toEqual([
      { id: 1, html: "en-a" },
      { id: 2, html: "en-b" },
    ]);
  });

  it("pusty wariant bieżącego języka: rozwija fallback, który czytelnik zobaczy", () => {
    // Pusty napis, nie same spacje: renderer tekstu (`pickI18n`) nie przycina,
    // więc „   " czytelnik EN zobaczyłby jako pusty widget, nie fallback PL.
    const fallbackDoc = docOf(bilingual("w1", "A[fn]tylko po polsku[/fn]", ""));

    const { doc: prepared, notes } = processDocFootnotes(fallbackDoc, "en");

    expect(notes).toEqual([{ id: 1, html: "tylko po polsku" }]);
    expect(markerIds(widgetsOf(prepared)[0]?.content.html_pl)).toEqual(["1"]);
  });

  it("ta sama reguła obowiązuje pozycje kolekcji (akordeon)", () => {
    const accordion: WidgetNode = {
      id: "acc",
      kind: "widget",
      type: "accordion",
      content: {
        items: [
          { a_pl: "Odp[fn]pl-1[/fn]", a_en: "Ans[fn]en-1[/fn]" },
          { a_pl: "", a_en: "Ans[fn]en-2[/fn]" },
        ],
      },
    };

    const { notes } = processDocFootnotes(docOf(accordion), "pl");

    // Druga pozycja nie ma polskiej odpowiedzi - fallback EN jest widoczny.
    expect(notes).toEqual([
      { id: 1, html: "pl-1" },
      { id: 2, html: "en-2" },
    ]);
  });
});
