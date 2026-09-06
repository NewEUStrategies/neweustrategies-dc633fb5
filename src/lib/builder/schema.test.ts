import { describe, it, expect } from "vitest";
import { WIDGET_TYPES, isKnownWidgetType, safeParseBuilderDoc, isBuilderDoc } from "./schema";
import { WIDGET_MAP } from "./registry";
import type { WidgetType } from "./types";

describe("WIDGET_TYPES ↔ registry drift guard", () => {
  it("lists exactly the widget types the registry implements", () => {
    const listed = [...WIDGET_TYPES].sort();
    const registered = (Object.keys(WIDGET_MAP) as WidgetType[]).sort();
    expect(listed).toEqual(registered);
  });

  it("has no duplicates", () => {
    expect(new Set(WIDGET_TYPES).size).toBe(WIDGET_TYPES.length);
  });
});

describe("isKnownWidgetType", () => {
  it("accepts known types and rejects everything else", () => {
    expect(isKnownWidgetType("heading")).toBe(true);
    expect(isKnownWidgetType("post-list")).toBe(true);
    expect(isKnownWidgetType("definitely-not-a-widget")).toBe(false);
    expect(isKnownWidgetType("")).toBe(false);
    expect(isKnownWidgetType(42)).toBe(false);
    expect(isKnownWidgetType(null)).toBe(false);
    expect(isKnownWidgetType(undefined)).toBe(false);
  });
});

describe("safeParseBuilderDoc - top level", () => {
  it("returns an empty doc for non-objects", () => {
    expect(safeParseBuilderDoc(null).sections).toEqual([]);
    expect(safeParseBuilderDoc(undefined).sections).toEqual([]);
    expect(safeParseBuilderDoc("x").sections).toEqual([]);
    expect(safeParseBuilderDoc(42).sections).toEqual([]);
    expect(safeParseBuilderDoc([]).sections).toEqual([]);
  });

  it("returns an empty doc for the wrong version or missing/invalid sections", () => {
    expect(safeParseBuilderDoc({ version: 2, sections: [] }).sections).toEqual([]);
    expect(safeParseBuilderDoc({ version: 1 }).sections).toEqual([]);
    expect(safeParseBuilderDoc({ version: 1, sections: "x" }).sections).toEqual([]);
    expect(safeParseBuilderDoc({ version: 1, sections: {} }).sections).toEqual([]);
  });

  it("always pins version to 1", () => {
    expect(safeParseBuilderDoc({ version: 1, sections: [] }).version).toBe(1);
  });
});

describe("safeParseBuilderDoc - sections", () => {
  it("drops non-object sections but keeps valid ones", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [null, "x", 7, { id: "s1", kind: "section", children: [] }],
    });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe("s1");
  });

  it("defaults a missing kind to 'section' and a missing children to []", () => {
    const doc = safeParseBuilderDoc({ version: 1, sections: [{ id: "s1" }] });
    expect(doc.sections[0].kind).toBe("section");
    expect(doc.sections[0].children).toEqual([]);
  });

  it("synthesizes an id when one is missing", () => {
    const doc = safeParseBuilderDoc({ version: 1, sections: [{ kind: "section" }] });
    expect(typeof doc.sections[0].id).toBe("string");
    expect(doc.sections[0].id.length).toBeGreaterThan(0);
  });

  it("synthesizes DETERMINISTIC ids - two parses of the same doc agree", () => {
    // Parsing runs independently on the server and in the browser; a random
    // fallback id would put a different data-*-id in the SSR HTML than in the
    // client's hydration render, and React 19 answers a mismatch by rebuilding
    // the entire tree client-side. Position-derived ids keep both sides equal.
    const raw = {
      version: 1,
      sections: [
        {
          kind: "section",
          children: [{ kind: "column", children: [{ type: "heading", content: {} }] }],
        },
      ],
    };
    const a = safeParseBuilderDoc(raw);
    const b = safeParseBuilderDoc(raw);
    expect(a).toEqual(b);
    const col = a.sections[0].children[0];
    expect(a.sections[0].id).toBe(b.sections[0].id);
    expect(col.id).toBe(b.sections[0].children[0].id);
  });

  it("preserves cosmetic fields untouched", () => {
    const background = { type: "classic", imageUrl: "https://x/y.jpg" };
    const style = { bgColor: "#fff" };
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [],
          background,
          style,
          layout: { contentWidth: "full" },
        },
      ],
    });
    expect(doc.sections[0].background).toEqual(background);
    expect(doc.sections[0].style).toEqual(style);
    expect(doc.sections[0].layout).toEqual({ contentWidth: "full" });
  });
});

describe("safeParseBuilderDoc - columns & widgets", () => {
  const wrap = (children: unknown[]) => ({
    version: 1,
    sections: [{ id: "s1", kind: "section", children }],
  });

  it("coerces a column and drops unknown / malformed widgets", () => {
    const doc = safeParseBuilderDoc(
      wrap([
        {
          id: "c1",
          kind: "column",
          span: { desktop: 6 },
          children: [
            { id: "w1", kind: "widget", type: "heading", content: { text_pl: "Hi" } },
            { id: "w2", kind: "widget", type: "totally-unknown", content: {} },
            "garbage",
            { id: "w3", kind: "widget", type: "button" }, // missing content
          ],
        },
      ]),
    );
    const col = doc.sections[0].children[0] as {
      kind: string;
      span: unknown;
      children: Array<{ id: string; content: unknown }>;
    };
    expect(col.kind).toBe("column");
    expect(col.span).toEqual({ desktop: 6 });
    expect(col.children.map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(col.children[1].content).toEqual({}); // defaulted
  });

  it("coerces a span, keeping only numeric breakpoints", () => {
    const doc = safeParseBuilderDoc(
      wrap([
        { id: "c1", kind: "column", span: { desktop: 6, tablet: "x", mobile: 12 }, children: [] },
      ]),
    );
    const col = doc.sections[0].children[0] as unknown as { span: Record<string, number> };
    expect(col.span).toEqual({ desktop: 6, mobile: 12 });
  });

  it("falls back to an empty span object when span is absent or invalid", () => {
    const doc = safeParseBuilderDoc(wrap([{ id: "c1", kind: "column", children: [] }]));
    const col = doc.sections[0].children[0] as { span: unknown };
    expect(col.span).toEqual({});
  });

  it("treats non-array column children as empty", () => {
    const doc = safeParseBuilderDoc(wrap([{ id: "c1", kind: "column", children: "nope" }]));
    const col = doc.sections[0].children[0] as { children: unknown[] };
    expect(col.children).toEqual([]);
  });
});

describe("safeParseBuilderDoc - inner sections", () => {
  it("detects an inner-section by its kind discriminator", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "inner1",
              kind: "inner-section",
              columns: [{ id: "ic1", kind: "column", span: { desktop: 6 }, children: [] }],
            },
          ],
        },
      ],
    });
    const inner = doc.sections[0].children[0] as { kind: string; columns: unknown[] };
    expect(inner.kind).toBe("inner-section");
    expect(inner.columns).toHaveLength(1);
  });

  it("detects an inner-section by shape (columns without children) and drops bad columns", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            { id: "inner1", columns: [null, { id: "ic1", kind: "column", children: [] }] },
          ],
        },
      ],
    });
    const inner = doc.sections[0].children[0] as { kind: string; columns: Array<{ id: string }> };
    expect(inner.kind).toBe("inner-section");
    expect(inner.columns.map((c) => c.id)).toEqual(["ic1"]);
  });

  it("treats non-array inner-section columns as empty", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        { id: "s1", kind: "section", children: [{ id: "i", kind: "inner-section", columns: 5 }] },
      ],
    });
    const inner = doc.sections[0].children[0] as { columns: unknown[] };
    expect(inner.columns).toEqual([]);
  });

  it("drops non-object section children", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [{ id: "s1", kind: "section", children: [null, 3, "x"] }],
    });
    expect(doc.sections[0].children).toEqual([]);
  });
});

describe("isBuilderDoc", () => {
  it("accepts a structurally valid doc", () => {
    expect(
      isBuilderDoc({
        version: 1,
        sections: [
          {
            id: "s1",
            kind: "section",
            children: [
              {
                id: "c1",
                kind: "column",
                span: {},
                children: [{ id: "w1", kind: "widget", type: "heading", content: {} }],
              },
              { id: "i1", kind: "inner-section", columns: [] },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects invalid shapes", () => {
    expect(isBuilderDoc(null)).toBe(false);
    expect(isBuilderDoc({ version: 2, sections: [] })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: "x" })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: [{ id: "s1" }] })).toBe(false); // no children array
    expect(isBuilderDoc({ version: 1, sections: [{ children: "x" }] })).toBe(false);
    expect(
      isBuilderDoc({
        version: 1,
        sections: [{ children: [{ kind: "column", children: [{ type: "nope" }] }] }],
      }),
    ).toBe(false); // unknown widget type
    expect(isBuilderDoc({ version: 1, sections: [{ children: [3] }] })).toBe(false);
  });

  it("round-trips: safeParseBuilderDoc output is always a valid doc", () => {
    const messy = {
      version: 1,
      sections: [
        {
          id: "s1",
          children: [{ columns: [{ children: [{ type: "heading" }, { type: "junk" }] }] }],
        },
        "garbage",
      ],
    };
    expect(isBuilderDoc(safeParseBuilderDoc(messy))).toBe(true);
  });
});

// ODMOWY I PODMIANY, KTORYCH NIE WIDAC W TESTACH SCIEZKI SZCZESLIWEJ.
//
// Parser jest CELOWO wyrozumialy: zamiast odrzucic caly dokument, naprawia go
// wezel po wezle. Kazda taka naprawa to jednak decyzja, ktora zmienia to, co
// zobaczy czytelnik - i ponizsze przypadki przypinaja te decyzje na wejsciach,
// ktorych zaden test dotad nie podal:
//
// 1. IDENTYFIKATOR PUSTY, a nie brakujacy. `takeId` wymaga `length > 0`, wiec
//    `id: ""` z importu albo ze zlego zapisu dostaje identyfikator wyliczony
//    z POZYCJI. To nie kosmetyka: dwa wezly z pustym `id` bylyby dla edytora
//    tym samym wezlem, a dla Reacta - tym samym kluczem listy.
// 2. TRESC WIDGETU BEDACA TABLICA. `isObject` odrzuca tablice, wiec content
//    spada do `{}`. Bez tego renderer dostalby tablice tam, gdzie siega po
//    pola po nazwie, a `Array.prototype` dolozylby do tego wlasne skladniki.
// 3. `isBuilderDoc` na wpisach, ktore nie sa obiektami, i na sekcji wewnetrznej
//    z `columns` innym niz tablica.
//
// GRANICA DOWODU: `isBuilderDoc` NIE MA dzis ani jednego wywolania
// produkcyjnego (jedyne uzycia sa w testach). Ponizsze przypadki opisuja wiec
// kontrakt funkcji, a nie zachowanie widoczne na stronie - i dlatego opisana
// nizej asymetria (kolumny sprawdzane rekurencyjnie, `columns` sekcji
// wewnetrznej tylko po typie tablicy) jest tu przypieta jako STAN FAKTYCZNY,
// a nie zglaszana jako defekt: nie ma powierzchni, na ktorej moglaby zaszkodzic.

describe("safeParseBuilderDoc - identyfikator PUSTY zamiast brakujacego", () => {
  it("pusty string w id sekcji zostaje zastapiony identyfikatorem z pozycji", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [{ id: "", kind: "section", children: [] }],
    });

    expect(doc.sections[0].id).toBe("auto-s0");
  });

  it("pusty string w id kolumny, sekcji wewnetrznej i widgetu tez jest zastepowany", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            { id: "", kind: "column", children: [{ id: "", kind: "widget", type: "heading" }] },
            { id: "", kind: "inner-section", columns: [{ id: "", kind: "column", children: [] }] },
          ],
        },
      ],
    });

    const kolumna = doc.sections[0].children[0] as { id: string; children: Array<{ id: string }> };
    const wewnetrzna = doc.sections[0].children[1] as {
      id: string;
      columns: Array<{ id: string }>;
    };
    expect(kolumna.id).toBe("auto-s0.c0");
    expect(kolumna.children[0].id).toBe("auto-s0.c0.w0");
    expect(wewnetrzna.id).toBe("auto-s0.c1");
    expect(wewnetrzna.columns[0].id).toBe("auto-s0.c1.c0");
  });

  it("dwa wezly z pustym id dostaja ROZNE identyfikatory", () => {
    // Gdyby pusty string przechodzil dalej, oba wezly mialyby ten sam klucz -
    // zaznaczenie i usuwanie trafialyby w losowy z nich.
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        { id: "", kind: "section", children: [] },
        { id: "", kind: "section", children: [] },
      ],
    });

    expect(doc.sections[0].id).not.toBe(doc.sections[1].id);
  });

  it("identyfikator niebedacy stringiem tez jest zastepowany", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [{ id: 7, kind: "section", children: [] }],
    });

    expect(doc.sections[0].id).toBe("auto-s0");
  });
});

describe("safeParseBuilderDoc - tresc widgetu, ktora nie jest obiektem", () => {
  const wrapWidget = (content: unknown) => ({
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            children: [{ id: "w1", kind: "widget", type: "heading", content }],
          },
        ],
      },
    ],
  });

  const widgetZ = (raw: unknown): { content: unknown } => {
    const doc = safeParseBuilderDoc(raw);
    const col = doc.sections[0].children[0] as { children: Array<{ content: unknown }> };
    return col.children[0];
  };

  it("TABLICA w content spada do pustego obiektu", () => {
    // `isObject` jawnie odrzuca tablice. Bez tego renderer siegajacy po pola po
    // nazwie dostalby tablice - z jej wlasnymi skladnikami (`length`, metody
    // prototypu) w miejscu ustawien widgetu.
    expect(widgetZ(wrapWidget([{ text_pl: "Nagłówek" }])).content).toEqual({});
  });

  it("pusta tablica w content tez spada do pustego obiektu, a nie do tablicy", () => {
    const content = widgetZ(wrapWidget([])).content;

    expect(Array.isArray(content)).toBe(false);
    expect(content).toEqual({});
  });

  it("null, string i liczba w content tez spadaja do pustego obiektu", () => {
    expect(widgetZ(wrapWidget(null)).content).toEqual({});
    expect(widgetZ(wrapWidget("tekst")).content).toEqual({});
    expect(widgetZ(wrapWidget(12)).content).toEqual({});
  });
});

describe("coerceSpan - kazdy punkt przerwania osobno", () => {
  it("bierze wylacznie te punkty przerwania, ktore sa liczbami", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "c1",
              kind: "column",
              span: { desktop: "6", tablet: 4, mobile: null },
              children: [],
            },
          ],
        },
      ],
    });

    const col = doc.sections[0].children[0] as unknown as { span: Record<string, number> };
    expect(col.span).toEqual({ tablet: 4 });
  });

  it("span niebedacy obiektem daje pusty obiekt", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        { id: "s1", kind: "section", children: [{ id: "c1", kind: "column", span: [1, 2] }] },
      ],
    });

    const col = doc.sections[0].children[0] as unknown as { span: Record<string, number> };
    expect(col.span).toEqual({});
  });
});

describe("isBuilderDoc - odmowy bez dowodu", () => {
  it("odrzuca dokument, w ktorym wpis sekcji NIE JEST obiektem", () => {
    expect(isBuilderDoc({ version: 1, sections: [null] })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: ["sekcja"] })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: [7] })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: [[]] })).toBe(false);
  });

  it("odrzuca sekcje wewnetrzna, ktorej columns nie jest tablica", () => {
    const doc = (columns: unknown) => ({
      version: 1,
      sections: [{ id: "s1", kind: "section", children: [{ kind: "inner-section", columns }] }],
    });

    expect(isBuilderDoc(doc(5))).toBe(false);
    expect(isBuilderDoc(doc(undefined))).toBe(false);
    expect(isBuilderDoc(doc({}))).toBe(false);
    expect(isBuilderDoc(doc([]))).toBe(true);
  });

  it("STAN FAKTYCZNY: zawartosc columns sekcji wewnetrznej NIE jest sprawdzana", () => {
    // Asymetria z naglowka: kolumna jest weryfikowana rekurencyjnie (kazdy
    // widget musi miec znany typ), a sekcja wewnetrzna - tylko po tym, ze
    // `columns` jest tablica. Wpis `null` w srodku przechodzi.
    expect(
      isBuilderDoc({
        version: 1,
        sections: [
          { id: "s1", kind: "section", children: [{ kind: "inner-section", columns: [null] }] },
        ],
      }),
    ).toBe(true);
  });

  it("odrzuca kolumne, w ktorej wpis dziecka nie jest obiektem", () => {
    expect(
      isBuilderDoc({
        version: 1,
        sections: [{ children: [{ kind: "column", children: [null] }] }],
      }),
    ).toBe(false);
  });

  it("przyjmuje sekcje wewnetrzna rozpoznana po kind, nawet gdy niesie tez children", () => {
    // Dyskryminator wygrywa z ksztaltem: dla `isBuilderDoc` liczy sie wtedy
    // wylacznie `columns`.
    expect(
      isBuilderDoc({
        version: 1,
        sections: [{ children: [{ kind: "inner-section", columns: [], children: "cokolwiek" }] }],
      }),
    ).toBe(true);
  });
});
