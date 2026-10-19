// Edycja treści PL/EN wzorca strony przed wstawieniem (`PatternPicker`, zakładka
// „Treść (PL / EN)"): `collectI18nFields` buduje listę pól, a
// `applyI18nOverrides` wpisuje poprawki z powrotem do kopii dokumentu.
//
// Sąsiedni `i18n.test.ts` sprawdza wzorzec z biblioteki. Tu dowodzimy
// przypadków, których biblioteka dziś nie zawiera, a które dokument buildera
// dopuszcza:
//  * widgety w sekcji WEWNĘTRZNEJ (inner-section) też są edytowalne i poprawka
//    wraca dokładnie do nich;
//  * pole bierzemy tylko z pary na białej liście kluczy tekstowych; wartość
//    złego typu pokazujemy jako pusty napis (nigdy „undefined" / „[object Object]");
//  * węzły uszkodzone (null, nie-widget w kolumnie) nie wywracają listy;
//  * brak poprawki dla pola i nieaktualna ścieżka nie zmieniają dokumentu.
//
// Moduł jest czysty - bez granic do mockowania.
import { describe, expect, it } from "vitest";
import type { BuilderDocument } from "@/lib/builder/types";
import { applyI18nOverrides, collectI18nFields } from "../i18n";

const doc = (): BuilderDocument =>
  ({
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            children: [
              {
                id: "w-head",
                kind: "widget",
                type: "heading",
                content: { text_pl: "Cześć", text_en: "Hello", url_pl: "/pl", level: 2 },
              },
              null,
              { id: "x", kind: "column", children: [] },
            ],
          },
          {
            id: "inner",
            kind: "inner-section",
            columns: [
              {
                id: "c2",
                kind: "column",
                children: [
                  {
                    id: "w-btn",
                    kind: "widget",
                    type: "button",
                    content: { label_en: "Go", label_pl: { bad: true }, cta_pl: 5 },
                  },
                ],
              },
            ],
          },
          "śmieć",
        ],
      },
    ],
  }) as unknown as BuilderDocument;

describe("collectI18nFields - pola z każdego poziomu dokumentu", () => {
  it("zbiera pary z kolumny i z sekcji wewnętrznej z dokładną ścieżką treści", () => {
    const fields = collectI18nFields(doc());
    expect(fields.map((f) => [f.widgetId, f.baseKey, f.path.join("/")])).toEqual([
      ["w-head", "text", "sections/0/children/0/children/0/content"],
      ["w-btn", "label", "sections/0/children/1/columns/0/children/0/content"],
      ["w-btn", "cta", "sections/0/children/1/columns/0/children/0/content"],
    ]);
  });

  it("wartość złego typu jest pustym napisem, a klucz spoza listy nie jest polem", () => {
    const [head, label, cta] = collectI18nFields(doc());
    expect([head.pl, head.en, head.widgetType]).toEqual(["Cześć", "Hello", "heading"]);
    expect([label.pl, label.en]).toEqual(["", "Go"]);
    expect([cta.pl, cta.en]).toEqual(["", ""]);
  });
});

describe("applyI18nOverrides - poprawka wraca do swojego widgetu", () => {
  it("wpisuje obie wersje językowe do widgetu w sekcji wewnętrznej", () => {
    const source = doc();
    const fields = collectI18nFields(source);
    const next = applyI18nOverrides(source, fields, [
      undefined as never,
      { pl: "Dalej", en: "Next" },
    ]);
    const content = (
      next.sections[0].children[1] as unknown as {
        columns: { children: { content: Record<string, unknown> }[] }[];
      }
    ).columns[0].children[0].content;
    expect(content).toMatchObject({ label_pl: "Dalej", label_en: "Next", cta_pl: 5 });
    // Pole bez poprawki i dokument źródłowy zostają nietknięte.
    expect(collectI18nFields(next)[0]).toMatchObject({ pl: "Cześć", en: "Hello" });
    expect(collectI18nFields(source)[1]).toMatchObject({ pl: "", en: "Go" });
  });

  it("nieaktualna ścieżka (dokument zmienił kształt) nie tworzy nowych węzłów", () => {
    const source = doc();
    const stale = [
      { ...collectI18nFields(source)[0], path: ["sections", 5, "children", 0, "content"] },
      { ...collectI18nFields(source)[0], path: ["sections", "x", "content"] },
      { ...collectI18nFields(source)[0], path: ["sections", 0, "children", 0, 3] },
    ];
    const next = applyI18nOverrides(
      source,
      stale,
      stale.map(() => ({ pl: "A", en: "B" })),
    );
    expect(next).toEqual(source);
  });
});
