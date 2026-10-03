import { describe, expect, it } from "vitest";

import {
  auditBuilderI18n,
  classifyPair,
  looksPolish,
  summarizeI18nIssues,
  type WidgetI18nIssue,
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

describe("looksPolish - progi", () => {
  // Słowa-wypełniacze bez polskich słów funkcyjnych: o wyniku decyduje
  // WYŁĄCZNIE udział wyrazów z diakrytykami.
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`);

  it("tekst krótszy niż 3 znaki (po zdjęciu HTML) nigdy nie jest polski", () => {
    expect(looksPolish("że")).toBe(false);
    expect(looksPolish("<strong>ąę</strong>")).toBe(false);
  });

  it("encje HTML nie liczą się jako tekst", () => {
    expect(looksPolish("&nbsp;&oacute;&nbsp;")).toBe(false);
    expect(looksPolish("&nbsp;Zespół&nbsp;")).toBe(true);
  });

  it("samo polskie słowo funkcyjne przesądza sprawę, nawet bez diakrytyków", () => {
    expect(looksPolish("Read the full strona here")).toBe(true);
    expect(looksPolish("Read the full page here")).toBe(false);
  });

  // Uwaga: przy progu 15% granica „6 wyrazów” nie jest obserwowalna - jeden
  // wyraz z diakrytykami na ≤ 6 to zawsze ≥ 1/6 ≈ 16,7%. Test przypina WYNIK
  // (krótki tekst z jednym polskim wyrazem jest polski), nie samą granicę.
  it("do 6 wyrazów wystarczy jeden wyraz z diakrytykami", () => {
    expect(looksPolish([...filler(5), "Łódź"].join(" "))).toBe(true);
  });

  it("powyżej 6 wyrazów decyduje udział wyrazów z diakrytykami (próg > 15%)", () => {
    // 1/7 ≈ 14% - nazwa własna w angielskim zdaniu.
    expect(looksPolish([...filler(6), "Łódź"].join(" "))).toBe(false);
    // 3/20 = 15% dokładnie - próg jest ostry, więc to jeszcze NIE polski.
    expect(looksPolish([...filler(17), "Łódź", "Gdańsk", "Kraków"].join(" "))).toBe(false);
    // 4/20 = 20%.
    expect(looksPolish([...filler(16), "Łódź", "Gdańsk", "Kraków", "Poznań"].join(" "))).toBe(true);
  });
});

describe("classifyPair - przypadki brzegowe", () => {
  it("wartości nietekstowe po obu stronach nie są parą do oceny", () => {
    expect(classifyPair(1, 2)).toBeNull();
    expect(classifyPair(undefined, undefined)).toBeNull();
    // Lista z elementem nietekstowym nie jest listą tekstów.
    expect(classifyPair(["Zespół", 1], "")).toBeNull();
  });

  it("puste (także po zdjęciu HTML) PL i EN to brak treści, nie brak tłumaczenia", () => {
    expect(classifyPair("", "")).toBeNull();
    expect(classifyPair("<p> </p>", "&nbsp;")).toBeNull();
  });

  it("brak PL przy wypełnionym EN to treść tylko po angielsku", () => {
    expect(classifyPair(undefined, "English only")).toBeNull();
  });

  it("brak klucza EN przy wypełnionym PL to brak tłumaczenia", () => {
    expect(classifyPair("Zespół", undefined)).toBe("missing");
    expect(classifyPair("Zespół", "<p></p>")).toBe("missing");
  });

  it("stale_default tylko wtedy, gdy PL odbiega od szablonu", () => {
    const tpl = { pl: "Dołącz", en: "Join" };
    // Nietknięty szablon: EN jest poprawnym tłumaczeniem szablonowego PL.
    expect(classifyPair("Dołącz", "Join", tpl)).toBeNull();
    // Porównanie po normalizacji (HTML, wielkość liter, spacje).
    expect(classifyPair("<b>dołącz</b>", " JOIN ", tpl)).toBeNull();
    expect(classifyPair("Poznaj nas", "<p>Join</p>", tpl)).toBe("stale_default");
    // Znany tylko szablon EN: każde niepuste PL od niego odbiega.
    expect(classifyPair("Poznaj nas", "Join", { en: "Join" })).toBe("stale_default");
  });

  it("polski tekst w EN ma pierwszeństwo przed same_as_pl", () => {
    expect(classifyPair("<p>Zespół</p>", "Zespół")).toBe("pl_text_in_en");
    expect(classifyPair("Podcast", "<em>podcast</em>")).toBe("same_as_pl");
  });
});

describe("auditBuilderI18n - kształty drzewa", () => {
  it("listy tekstów w treści widgetu porównuje z szablonem, a w kolekcjach pomija", () => {
    const issues = auditBuilderI18n(
      [
        {
          id: "ah",
          type: "animated-heading",
          content: {
            rotateWords_pl: ["innowacyjnie", "nowocześnie"],
            rotateWords_en: ["fast", "easy", "effective"],
            tags: ["a", "b"],
          },
        },
      ],
      defaults,
    );
    expect(issues).toEqual([
      {
        widgetId: "ah",
        widgetType: "animated-heading",
        field: "rotateWords",
        kind: "stale_default",
        severity: "error",
        pl: "innowacyjnie | nowocześnie",
        en: "fast | easy | effective",
      },
    ]);
  });

  it("znajduje pary w kolekcjach zagnieżdżonych głębiej niż jeden poziom", () => {
    // Kształty z prawdziwych domyślnych treści palety: mega-menu
    // (`columns[].links[]`, `columns[].featured`), program wydarzenia
    // (`days[].sessions[]`), sponsorzy (`tiers[].sponsors[]`). Renderer robi
    // fallback na PL, więc brak EN w tych polach to polski tekst na /en.
    const doc = {
      widgets: [
        {
          id: "mm",
          type: "mega-menu",
          content: {
            columns: [
              {
                title_pl: "Analizy",
                title_en: "Analyses",
                links: [
                  { label_pl: "Raporty", label_en: "Reports" },
                  { label_pl: "Komentarze", label_en: "" },
                ],
                featured: { title_pl: "Polecamy", title_en: "Polecamy" },
              },
            ],
          },
        },
        {
          id: "es",
          type: "event-schedule",
          content: {
            days: [
              {
                sessions: [
                  { title_pl: "Otwarcie", title_en: "Otwarcie", description_pl: "Sala A" },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(auditBuilderI18n(doc).map((i) => [i.widgetId, i.field, i.kind])).toEqual([
      ["mm", "label", "missing"],
      ["mm", "title", "same_as_pl"],
      ["es", "title", "same_as_pl"],
      ["es", "description", "missing"],
    ]);
  });

  it("widget zagnieżdżony w treści innego widgetu raportuje się pod WŁASNYM id, raz", () => {
    const doc = {
      id: "tabs-1",
      type: "tabs",
      content: {
        items: [
          {
            label_pl: "Raporty",
            label_en: "Reports",
            children: [
              { id: "inner", type: "heading", content: { text_pl: "Zespół", text_en: "" } },
            ],
          },
        ],
      },
    };
    expect(auditBuilderI18n(doc).map((i) => [i.widgetId, i.widgetType, i.field, i.kind])).toEqual([
      ["inner", "heading", "text", "missing"],
    ]);
  });

  it("pary poza treścią widgetu (sekcje, ustawienia) nie są audytowane", () => {
    const doc = {
      sections: [{ title_pl: "Sekcja", title_en: "", settings: { label_pl: "Etykieta" } }],
      widget: { id: "w", type: "heading", styles: { note_pl: "Notatka" }, content: {} },
    };
    expect(auditBuilderI18n(doc)).toEqual([]);
  });

  it("ten sam obiekt widziany dwa razy i cykl w drzewie nie dublują wyników", () => {
    const widget: Record<string, unknown> = {
      id: "w",
      type: "heading",
      content: { text_pl: "Zespół", text_en: "" },
    };
    widget["self"] = widget;
    const issues = auditBuilderI18n({ a: widget, b: [widget, { nested: widget }] });
    expect(issues.map((i) => [i.widgetId, i.kind])).toEqual([["w", "missing"]]);
  });

  it("`content` wskazujący sam na siebie nie wraca drugi raz jako kolekcja", () => {
    // Bez oznaczenia `content` jako odwiedzonego jego pary wróciłyby przez
    // cykl jako „kolekcja" i zostały zgłoszone ponownie.
    const content: Record<string, unknown> = { text_pl: "Zespół", text_en: "" };
    content["self"] = content;
    const issues = auditBuilderI18n({ id: "w", type: "heading", content });
    expect(issues.map((i) => [i.widgetId, i.field, i.kind])).toEqual([["w", "text", "missing"]]);
  });

  it("szablon widgetu nie dotyczy kolekcji w jego treści (bez stale_default)", () => {
    // Element kolekcji z kluczem o nazwie pola widgetu to INNE pole - szablon
    // `textBefore_en: "Join"` z palety nie jest jego szablonem.
    const doc = {
      id: "ah",
      type: "animated-heading",
      content: { items: [{ textBefore_pl: "Poznaj nas", textBefore_en: "Join" }] },
    };
    expect(auditBuilderI18n(doc, defaults)).toEqual([]);
  });

  it("pola `_pl` z wartością nietekstową w treści widgetu są pomijane", () => {
    const doc = {
      id: "w",
      type: "stats",
      content: { count_pl: 3, count_en: "", mixed_pl: ["Zespół", 1], mixed_en: [] },
    };
    expect(auditBuilderI18n(doc)).toEqual([]);
  });

  it("widget bez id dostaje pusty identyfikator, a brak klucza EN daje pusty podgląd", () => {
    const [issue] = auditBuilderI18n({ type: "heading", content: { text_pl: "Zespół" } });
    expect(issue).toMatchObject({ widgetId: "", field: "text", kind: "missing", pl: "Zespół" });
    expect(issue.en).toBe("");
  });

  it("bez funkcji szablonów nie zgłasza stale_default, ale resztę tak", () => {
    const doc = {
      id: "ah",
      type: "animated-heading",
      content: {
        textBefore_pl: "Poznaj nas",
        textBefore_en: "Join",
        highlight_pl: "bliżej",
        highlight_en: "",
      },
    };
    expect(auditBuilderI18n(doc).map((i) => [i.field, i.kind])).toEqual([["highlight", "missing"]]);
    expect(auditBuilderI18n(doc, defaults).map((i) => [i.field, i.kind])).toEqual([
      ["textBefore", "stale_default"],
      ["highlight", "missing"],
    ]);
  });

  it("podgląd zdejmuje HTML i przycina długi tekst do 120 znaków z wielokropkiem", () => {
    const long = `<p>${"Zażółć gęślą jaźń. ".repeat(12)}</p>`;
    const [issue] = auditBuilderI18n({
      id: "w",
      type: "text",
      content: { html_pl: long, html_en: "<p>Zobacz <b>więcej</b></p>" },
    });
    expect(issue.kind).toBe("pl_text_in_en");
    expect(issue.pl).toHaveLength(120);
    expect(issue.pl).toBe(`${"Zażółć gęślą jaźń. ".repeat(12).trim().slice(0, 119)}…`);
    // Tekst mieszczący się w limicie przechodzi bez wielokropka, ale bez HTML.
    expect(issue.en).toBe("Zobacz więcej");
  });

  it("podgląd i porównanie pomijają nazwane encje HTML (cudzysłowy, myślniki)", () => {
    // Edytor rich-text zapisuje typografię jako encje; w panelu mają się nie
    // pokazywać jako „&bdquo;”, a EN złożone z samych encji to brak treści.
    const issues = auditBuilderI18n({
      id: "w",
      type: "text",
      content: {
        quote_pl: "&bdquo;Zespół&rdquo;",
        quote_en: "&bdquo;Zespół&rdquo;",
        dash_pl: "Raport",
        dash_en: "&mdash;",
      },
    });
    expect(issues.map((i) => [i.field, i.kind, i.pl, i.en])).toEqual([
      ["quote", "pl_text_in_en", "Zespół", "Zespół"],
      ["dash", "missing", "Raport", ""],
    ]);
  });
});

describe("summarizeI18nIssues", () => {
  it("pusta lista daje same zera", () => {
    expect(summarizeI18nIssues([])).toEqual({
      total: 0,
      errors: 0,
      warnings: 0,
      byKind: { stale_default: 0, pl_text_in_en: 0, missing: 0, same_as_pl: 0 },
    });
  });

  it("liczy każdą klasę osobno, a ostrzeżenia jako różnicę", () => {
    const issue = (kind: WidgetI18nIssue["kind"]): WidgetI18nIssue => ({
      widgetId: "w",
      widgetType: "heading",
      field: "text",
      kind,
      severity: kind === "same_as_pl" ? "warning" : "error",
      pl: "",
      en: "",
    });
    expect(
      summarizeI18nIssues([
        issue("stale_default"),
        issue("pl_text_in_en"),
        issue("missing"),
        issue("missing"),
        issue("same_as_pl"),
      ]),
    ).toEqual({
      total: 5,
      errors: 4,
      warnings: 1,
      byKind: { stale_default: 1, pl_text_in_en: 1, missing: 2, same_as_pl: 1 },
    });
  });
});
