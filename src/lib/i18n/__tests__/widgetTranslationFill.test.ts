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

// Szablon palety w kształcie `defaults()` z `registry.tsx` (animated-heading).
const paletteDefaults = (type: string) =>
  type === "animated-heading"
    ? {
        textBefore_pl: "Dołącz",
        textBefore_en: "Join",
        rotateWords_pl: ["szybko", "łatwo", "skutecznie"],
        rotateWords_en: ["fast", "easy", "effective"],
      }
    : undefined;

describe("needsTranslation - przypadki brzegowe", () => {
  it("EN identyczne z PL, które nie wygląda po polsku, zostaje (nazwy własne)", () => {
    expect(needsTranslation("Podcast", "Podcast")).toBe(false);
    expect(needsTranslation("<p>NES Talks</p>", "NES Talks")).toBe(false);
  });

  it("EN różne od szablonu nie jest szablonowe", () => {
    expect(needsTranslation("Poznaj nas", "Meet us", "Join", "Dołącz")).toBe(false);
  });

  it("szablonowe EN przy nietkniętym szablonowym PL NIE wymaga tłumaczenia", () => {
    expect(needsTranslation("Dołącz", "Join", "Join", "Dołącz")).toBe(false);
    expect(needsTranslation("<b>dołącz</b>", " join ", "Join", "Dołącz")).toBe(false);
    expect(needsTranslation("Poznaj nas", "Join", "Join", "Dołącz")).toBe(true);
  });
});

describe("szablon palety - spójnie z audytem (stale_default)", () => {
  it("nietknięty szablon nie jest wysyłany do tłumaczenia", () => {
    // Audyt nie zgłasza tej pary (PL = szablonowe PL), więc skrypt nie może
    // nadpisać kuratorowanego EN palety tłumaczeniem maszynowym.
    const untouched = {
      type: "animated-heading",
      content: { textBefore_pl: "Dołącz", textBefore_en: "Join" },
    };
    expect(collectTranslatableTexts(untouched, { getDefaults: paletteDefaults })).toEqual([]);
    const result = applyEnTranslations(
      untouched,
      { Dołącz: "Join in" },
      { getDefaults: paletteDefaults },
    );
    expect(result).toMatchObject({ applied: 0, untranslated: 0 });
    expect(result.document).toEqual(untouched);
  });

  it("zmienione PL przy szablonowym EN jest tłumaczone", () => {
    const changed = {
      type: "animated-heading",
      content: { textBefore_pl: "Poznaj nas", textBefore_en: "Join" },
    };
    expect(collectTranslatableTexts(changed, { getDefaults: paletteDefaults })).toEqual([
      "Poznaj nas",
    ]);
    const result = applyEnTranslations(
      changed,
      { "Poznaj nas": "Meet us" },
      { getDefaults: paletteDefaults },
    );
    expect(result.applied).toBe(1);
    expect((result.document as typeof changed).content.textBefore_en).toBe("Meet us");
  });

  it("widget zagnieżdżony bez własnego szablonu NIE dziedziczy szablonu rodzica", () => {
    // Szablon należy do typu widgetu: zagnieżdżony widget innego typu (tu bez
    // szablonu w palecie) ma `textBefore` zupełnie niezwiązane z szablonem
    // `animated-heading`, więc poprawne EN „Join" nie jest „szablonowe".
    const doc = {
      type: "animated-heading",
      content: {
        children: [
          { type: "custom-x", content: { textBefore_pl: "Poznaj nas", textBefore_en: "Join" } },
        ],
      },
    };
    expect(collectTranslatableTexts(doc, { getDefaults: paletteDefaults })).toEqual([]);
    const result = applyEnTranslations(
      doc,
      { "Poznaj nas": "Meet us" },
      { getDefaults: paletteDefaults },
    );
    expect(result).toMatchObject({ applied: 0, untranslated: 0 });
    expect(result.document).toEqual(doc);
  });

  it("listy: element zostawiony na szablonie EN przy zmienionym PL jest tłumaczony", () => {
    // Audyt zgłasza tu `stale_default` dla `rotateWords`; bez porównania
    // z szablonem element po elemencie skrypt nie miał czego wysłać.
    const doc = {
      type: "animated-heading",
      content: {
        rotateWords_pl: ["innowacyjnie", "łatwo", "skutecznie"],
        rotateWords_en: ["fast", "easy", "effective"],
      },
    };
    expect(collectTranslatableTexts(doc, { getDefaults: paletteDefaults })).toEqual([
      "innowacyjnie",
    ]);
    const result = applyEnTranslations(
      doc,
      { innowacyjnie: "innovatively" },
      { getDefaults: paletteDefaults },
    );
    expect(result).toMatchObject({ applied: 1, untranslated: 0 });
    expect((result.document as typeof doc).content.rotateWords_en).toEqual([
      "innovatively",
      "easy",
      "effective",
    ]);
  });
});

describe("kształty pól", () => {
  it("EN nietekstowe traktuje jak brak tłumaczenia i nadpisuje tekstem", () => {
    const doc = { content: { text_pl: "Zespół", text_en: 42 } };
    expect(collectTranslatableTexts(doc)).toEqual(["Zespół"]);
    const result = applyEnTranslations(doc, { Zespół: "Team" });
    expect((result.document as { content: Record<string, unknown> }).content.text_en).toBe("Team");
  });

  it("PL nietekstowe (liczba, null, lista mieszana) jest pomijane", () => {
    const doc = {
      content: {
        count_pl: 3,
        count_en: "",
        note_pl: null,
        mixed_pl: ["Zespół", 1],
        mixed_en: [],
      },
    };
    expect(collectTranslatableTexts(doc)).toEqual([]);
    const result = applyEnTranslations(doc, { Zespół: "Team" });
    expect(result).toMatchObject({ applied: 0, untranslated: 0 });
    expect(result.document).toEqual(doc);
  });

  it("lista PL bez listy EN dostaje nową listę EN", () => {
    const doc = { content: { bullets_pl: ["Raporty", "Zniżki na warsztaty"], bullets_en: "x" } };
    expect(collectTranslatableTexts(doc)).toEqual(["Raporty", "Zniżki na warsztaty"]);
    const result = applyEnTranslations(doc, {
      Raporty: "Reports",
      "Zniżki na warsztaty": "Workshop discounts",
    });
    expect(result.applied).toBe(2);
    expect((result.document as { content: Record<string, unknown> }).content.bullets_en).toEqual([
      "Reports",
      "Workshop discounts",
    ]);
  });

  it("element listy ponad limit znaków jest pomijany przy zbieraniu i zapisie", () => {
    const long = "ą".repeat(50);
    const doc = { content: { bullets_pl: [long, "Zespół"], bullets_en: [] } };
    expect(collectTranslatableTexts(doc, { maxFieldChars: 10 })).toEqual(["Zespół"]);
    const result = applyEnTranslations(
      doc,
      { [long]: "long", Zespół: "Team" },
      { maxFieldChars: 10 },
    );
    expect(result).toMatchObject({ applied: 1, untranslated: 0 });
    // Pominięty element zostaje dziurą, którą uzupełni kolejny przebieg.
    const out = (result.document as { content: { bullets_en: unknown[] } }).content.bullets_en;
    expect(out).toHaveLength(2);
    expect(out[1]).toBe("Team");
    expect(0 in out).toBe(false);
  });

  it("lista bez żadnego przetłumaczonego elementu zostaje nietknięta", () => {
    const doc = { content: { bullets_pl: ["Zespół"], bullets_en: ["Zespół"] } };
    const result = applyEnTranslations(doc, {});
    expect(result).toMatchObject({ applied: 0, untranslated: 1 });
    expect(result.document).toEqual(doc);
  });

  it("ten sam tekst w wielu polach: zebrany raz, zapisany wszędzie", () => {
    const doc = {
      widgets: [
        { type: "heading", content: { text_pl: "Zespół", text_en: "" } },
        { type: "heading", content: { text_pl: "Zespół", text_en: "Zespół" } },
        { type: "list", content: { items_pl: ["Zespół"], items_en: [] } },
      ],
    };
    expect(collectTranslatableTexts(doc)).toEqual(["Zespół"]);
    const result = applyEnTranslations(doc, new Map([["Zespół", "Team"]]));
    expect(result).toMatchObject({ applied: 3, untranslated: 0 });
    expect(result.document).toEqual({
      widgets: [
        { type: "heading", content: { text_pl: "Zespół", text_en: "Team" } },
        { type: "heading", content: { text_pl: "Zespół", text_en: "Team" } },
        { type: "list", content: { items_pl: ["Zespół"], items_en: ["Team"] } },
      ],
    });
  });
});
