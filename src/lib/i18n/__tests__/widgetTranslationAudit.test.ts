import { describe, expect, it } from "vitest";

import {
  auditBuilderI18n,
  classifyPair,
  looksPolish,
  summarizeI18nIssues,
} from "@/lib/i18n/widgetTranslationAudit";

const defaults = (type: string) =>
  type === "animated-heading"
    ? {
        textBefore_pl: "Dołącz",
        textBefore_en: "Join",
        highlight_pl: "do nas",
        highlight_en: "us",
        rotateWords_pl: ["szybko", "łatwo", "skutecznie"],
        rotateWords_en: ["fast", "easy", "effective"],
      }
    : undefined;

describe("looksPolish", () => {
  it("wykrywa diakrytyki i polskie słowa funkcyjne", () => {
    expect(looksPolish("GEOPOLITYKA I WOJSKOWOŚĆ")).toBe(true);
    expect(looksPolish("Poznaj nas")).toBe(true);
    expect(looksPolish("Programme Council")).toBe(false);
  });

  it("poprawny angielski z polską nazwą własną NIE jest polskim tekstem", () => {
    expect(
      looksPolish(
        "Correspondence address: ul. Tytusa Chałubińskiego 8 (Oxford Tower, 22nd floor), 00-613 Warsaw, Poland - write to the data protection officer.",
      ),
    ).toBe(false);
  });
});

describe("classifyPair", () => {
  it("zgłasza brak tłumaczenia", () => {
    expect(classifyPair("Zespół", "")).toBe("missing");
  });

  it("zgłasza EN identyczne z PL jako ostrzeżenie", () => {
    expect(classifyPair("ANALITYCY", "ANALITYCY")).toBe("same_as_pl");
  });

  it("zgłasza polski tekst w polu EN", () => {
    expect(classifyPair("RADY PROGRAMOWE", "RADA PROGRAMOWA || GEOPOLITYKA I WOJSKOWOŚĆ")).toBe(
      "pl_text_in_en",
    );
  });

  it("zgłasza EN pozostawione na wartości domyślnej widgetu", () => {
    expect(classifyPair("Poznaj nas", "Join", { pl: "Dołącz", en: "Join" })).toBe("stale_default");
  });

  it("nie zgłasza poprawnej pary", () => {
    expect(classifyPair("O nas", "About us")).toBeNull();
  });

  it("nie zgłasza treści istniejącej wyłącznie po angielsku", () => {
    expect(classifyPair("", "English-only quote")).toBeNull();
  });

  it("porównuje listy słów", () => {
    expect(
      classifyPair(["szybko", "łatwo"], ["fast", "easy", "effective"], {
        pl: ["szybko", "łatwo", "skutecznie"],
        en: ["fast", "easy", "effective"],
      }),
    ).toBe("stale_default");
  });
});

describe("auditBuilderI18n", () => {
  const doc = {
    sections: [
      {
        id: "s1",
        columns: [
          {
            widgets: [
              {
                id: "w1",
                type: "animated-heading",
                content: {
                  textBefore_pl: "Poznaj nas",
                  textBefore_en: "Join",
                  highlight_pl: "bliżej",
                  highlight_en: "us",
                },
              },
              {
                id: "w2",
                type: "heading",
                content: { text_pl: "ANALITYCY", text_en: "ANALITYCY" },
              },
              {
                id: "w3",
                type: "tabs",
                content: {
                  items: [
                    { label_pl: "Raporty", label_en: "" },
                    { label_pl: "Wywiady", label_en: "Interviews" },
                  ],
                },
              },
              { id: "w4", type: "heading", content: { text_pl: "Kontakt", text_en: "Contact" } },
            ],
          },
        ],
      },
    ],
  };

  it("znajduje defekty w widgetach i w kolekcjach wewnątrz nich", () => {
    const issues = auditBuilderI18n(doc, defaults);
    expect(issues.map((i) => [i.widgetId, i.field, i.kind])).toEqual([
      ["w1", "textBefore", "stale_default"],
      ["w1", "highlight", "stale_default"],
      ["w2", "text", "same_as_pl"],
      ["w3", "label", "missing"],
    ]);
  });

  it("sumuje wyniki po klasie i wadze", () => {
    const summary = summarizeI18nIssues(auditBuilderI18n(doc, defaults));
    expect(summary).toMatchObject({ total: 4, errors: 3, warnings: 1 });
    expect(summary.byKind.stale_default).toBe(2);
  });

  it("nie wywraca się na nietypowym JSON-ie", () => {
    expect(auditBuilderI18n(null)).toEqual([]);
    expect(auditBuilderI18n({ a: [1, "x", null] })).toEqual([]);
  });
});
