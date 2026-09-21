import { describe, expect, it } from "vitest";

import {
  applyEnTranslations,
  collectTranslatableTexts,
  needsTranslation,
} from "../widgetTranslationFill";

describe("needsTranslation", () => {
  it("puste PL nigdy nie wymaga tłumaczenia", () => {
    expect(needsTranslation("   ", undefined)).toBe(false);
    expect(needsTranslation("<p> </p>", "")).toBe(false);
  });

  it("puste EN przy wypełnionym PL wymaga tłumaczenia", () => {
    expect(needsTranslation("Dołącz do nas", "")).toBe(true);
    expect(needsTranslation("Dołącz do nas", undefined)).toBe(true);
  });

  it("EN identyczne z PL (po normalizacji HTML) wymaga tłumaczenia", () => {
    expect(needsTranslation("<p>Wybierz swoją subskrypcję</p>", "Wybierz swoją subskrypcję")).toBe(
      true,
    );
  });

  it("polski tekst w polu EN wymaga tłumaczenia", () => {
    expect(needsTranslation("Roczna subskrypcja", "Roczna subskrypcja w cenie 10 miesięcy")).toBe(
      true,
    );
  });

  it("szablonowa wartość EN przy zmienionym PL wymaga tłumaczenia", () => {
    expect(needsTranslation("Poznaj nas bliżej", "Join us", "Join us")).toBe(true);
  });

  it("poprawne tłumaczenie zostaje nietknięte", () => {
    expect(needsTranslation("Poznaj nas bliżej", "Get to know us", "Join us")).toBe(false);
  });
});

const doc = {
  sections: [
    {
      widgets: [
        {
          id: "w1",
          type: "heading",
          content: { text_pl: "Wybierz swoją subskrypcję", text_en: "Wybierz swoją subskrypcję" },
        },
        {
          id: "w2",
          type: "faq",
          content: {
            title_pl: "Pytania",
            title_en: "Questions",
            items: [{ q_pl: "Ile to kosztuje?", q_en: "" }],
            bullets_pl: ["Dostęp do raportów", "Zniżki na warsztaty"],
            bullets_en: ["Access to reports"],
          },
        },
      ],
    },
  ],
};

describe("collectTranslatableTexts", () => {
  it("zbiera tylko pola wymagające tłumaczenia, bez duplikatów", () => {
    expect(collectTranslatableTexts(doc)).toEqual([
      "Wybierz swoją subskrypcję",
      "Zniżki na warsztaty",
      "Ile to kosztuje?",
    ]);
  });

  it("pomija pola ponad limit znaków", () => {
    const big = { content: { text_pl: "ą".repeat(50), text_en: "" } };
    expect(collectTranslatableTexts(big, { maxFieldChars: 10 })).toEqual([]);
    expect(collectTranslatableTexts(big, { maxFieldChars: 100 })).toHaveLength(1);
  });

  it("uwzględnia szablonową wartość EN z palety widgetu", () => {
    const stale = { type: "cta", content: { label_pl: "Zapisz się", label_en: "Join us" } };
    const getDefaults = () => ({ label_en: "Join us" });
    expect(collectTranslatableTexts(stale)).toEqual([]);
    expect(collectTranslatableTexts(stale, { getDefaults })).toEqual(["Zapisz się"]);
  });
});

describe("applyEnTranslations", () => {
  it("wypełnia pola ze słownika i nie mutuje wejścia", () => {
    const snapshot = JSON.stringify(doc);
    const result = applyEnTranslations(doc, {
      "Wybierz swoją subskrypcję": "Choose your subscription",
      "Ile to kosztuje?": "How much does it cost?",
      "Zniżki na warsztaty": "Workshop discounts",
    });
    expect(result.applied).toBe(3);
    expect(result.untranslated).toBe(0);
    expect(JSON.stringify(doc)).toBe(snapshot);

    const out = result.document as typeof doc;
    expect(out.sections[0].widgets[0].content["text_en"]).toBe("Choose your subscription");
    const faq = out.sections[0].widgets[1].content as {
      items: Array<{ q_en: string }>;
      bullets_en: string[];
      title_en: string;
    };
    expect(faq.items[0].q_en).toBe("How much does it cost?");
    expect(faq.bullets_en).toEqual(["Access to reports", "Workshop discounts"]);
    expect(faq.title_en).toBe("Questions");
  });

  it("liczy pola bez wpisu w słowniku i zostawia je bez zmian", () => {
    const result = applyEnTranslations(doc, { "Ile to kosztuje?": "How much does it cost?" });
    expect(result.applied).toBe(1);
    expect(result.untranslated).toBe(2);
    const out = result.document as typeof doc;
    expect(out.sections[0].widgets[0].content["text_en"]).toBe("Wybierz swoją subskrypcję");
  });

  it("akceptuje słownik jako Map i respektuje limit znaków", () => {
    const big = { content: { text_pl: "ą".repeat(50), text_en: "" } };
    const dict = new Map([["ą".repeat(50), "translated"]]);
    expect(applyEnTranslations(big, dict, { maxFieldChars: 10 }).applied).toBe(0);
    expect(applyEnTranslations(big, dict, { maxFieldChars: 100 }).applied).toBe(1);
  });

  it("dokument bez pól i18n przechodzi bez zmian", () => {
    const result = applyEnTranslations({ a: 1, b: [null, "x"] }, {});
    expect(result).toMatchObject({ applied: 0, untranslated: 0 });
    expect(result.document).toEqual({ a: 1, b: [null, "x"] });
  });
});
