// Rdzeń bramki wierności ustawień testowany BEZ Reacta i DOM-u.
//
// Bramka jest tylko tak dobra, jak jej narzędzie pomiarowe: Proxy, które
// przeoczy odczyt, "dowodzi" martwego ustawienia, a generator próbek, który nie
// spełni warunku widoczności, produkuje fałszywe alarmy. Dlatego mechanizm ma
// własne testy - na syntetycznych schematach, których nikt nie renderuje.
import { describe, it, expect } from "vitest";
import { WIDGET_SCHEMAS, type SchemaField } from "../../schemas";
import {
  applyWaivers,
  baseContentKey,
  contentProbes,
  diffFidelity,
  isLangScopedKey,
  RESERVED_CONTENT_READS,
  schemaStorageKeys,
  trackContentReads,
  unreachableSchemaFields,
  withLangSiblings,
} from "../settingsFidelity";

describe("trackContentReads", () => {
  it("notuje odczyt pojedynczego klucza", () => {
    const { tracked, log } = trackContentReads({ a: 1, b: 2 });
    void tracked.a;
    expect([...log.reads]).toEqual(["a"]);
    expect(log.enumerated).toBe(false);
  });

  it("notuje odczyt klucza NIEOBECNEGO w treści", () => {
    // Renderer czytający `getStr(c, "autoplay")` z domyślną wartością nadal
    // "używa" ustawienia - inaczej domyślne treści maskowałyby każdy odczyt.
    const { tracked, log } = trackContentReads<Record<string, unknown>>({});
    void tracked.autoplay;
    expect([...log.reads]).toEqual(["autoplay"]);
  });

  it("notuje `in` i deskryptory, bo to też pytanie o ustawienie", () => {
    const { tracked, log } = trackContentReads({ a: 1 });
    expect("a" in tracked).toBe(true);
    Object.getOwnPropertyDescriptor(tracked, "b");
    expect([...log.reads].sort()).toEqual(["a", "b"]);
  });

  it("oznacza hurtowe wyliczenie kluczy zamiast liczyć je jako pokrycie", () => {
    const { tracked, log } = trackContentReads({ a: 1, b: 2 });
    const copy = { ...tracked };
    expect(copy).toEqual({ a: 1, b: 2 });
    expect(log.enumerated).toBe(true);
  });

  it("nie zwraca wartości innej niż źródłowa", () => {
    const { tracked } = trackContentReads({ a: "x", nested: { deep: 1 } });
    expect(tracked.a).toBe("x");
    expect(tracked.nested).toEqual({ deep: 1 });
  });

  it("pomija nazwy techniczne, o które pyta React i silnik obietnic", () => {
    const { tracked, log } = trackContentReads<Record<string, unknown>>({});
    for (const reserved of RESERVED_CONTENT_READS) void tracked[reserved];
    expect([...log.reads]).toEqual([]);
  });

  it("pomija klucze symboliczne", () => {
    const { tracked, log } = trackContentReads<Record<string | symbol, unknown>>({});
    void tracked[Symbol.iterator];
    expect([...log.reads]).toEqual([]);
  });

  it("żadna nazwa techniczna nie jest jednocześnie realnym kluczem ustawienia", () => {
    // Gdyby jakiś widget nazwał pole `length` albo `key`, filtr nazw
    // technicznych cicho wyjąłby je z bramki - i akurat ten defekt przeszedłby
    // niezauważony. Kolizja MUSI wywalić test, żeby wymusić zmianę nazwy pola.
    const schemaKeys = new Set<string>();
    for (const schema of Object.values(WIDGET_SCHEMAS)) {
      for (const field of schema ?? []) schemaKeys.add(field.key);
    }
    const collisions = [...RESERVED_CONTENT_READS].filter((name) => schemaKeys.has(name));
    expect(collisions).toEqual([]);
  });
});

describe("klucze językowe", () => {
  it("zdejmuje sufiks języka tylko z kluczy, które go mają", () => {
    expect(baseContentKey("title_pl")).toBe("title");
    expect(baseContentKey("title_en")).toBe("title");
    expect(baseContentKey("title")).toBe("title");
    expect(baseContentKey("published_at")).toBe("published_at");
  });

  it("rozpoznaje klucz zlokalizowany", () => {
    expect(isLangScopedKey("items_pl")).toBe(true);
    expect(isLangScopedKey("items")).toBe(false);
  });

  it("domyka rodzeństwo językowe, ale NIE zrównuje `items` z `items_pl`", () => {
    expect([...withLangSiblings(["title_pl"])].sort()).toEqual(["title_en", "title_pl"]);
    const offered = withLangSiblings(["items"]);
    const read = withLangSiblings(["items_pl"]);
    // Dokładnie ta różnica ujawniła rozjazd kontrolki TOC (pisała `items`)
    // i widgetu (czytał `items_${lang}`).
    expect(diffFidelity(offered, read)).toEqual({
      dead: ["items"],
      hidden: ["items_en", "items_pl"],
    });
  });
});

describe("schemaStorageKeys", () => {
  it("pole i18n obiecuje PARĘ kluczy, zwykłe - jeden", () => {
    const schema: SchemaField[] = [
      { key: "text", type: "i18nText", label: "Tekst" },
      { key: "align", type: "select", label: "Wyrównanie" },
    ];
    expect([...schemaStorageKeys(schema)].sort()).toEqual(["align", "text_en", "text_pl"]);
  });
});

describe("contentProbes", () => {
  const schema: SchemaField[] = [
    { key: "variant", type: "select", label: "Wariant", options: [{ value: "a" }, { value: "b" }] },
    {
      key: "gradientFrom",
      type: "color",
      label: "Kolor",
      visibleWhen: (c) => c.variant === "b",
    },
    { key: "widthPct", type: "number", label: "Szerokość", min: 10, max: 100, default: 100 },
    { key: "sticky", type: "bool", label: "Przyklejony", default: false },
  ];

  it("zawsze zawiera defaulty oraz pełne wypełnienie w obu stanach przełączników", () => {
    const labels = contentProbes({ variant: "a" }, schema).map((p) => p.label);
    expect(labels).toContain("defaults");
    expect(labels).toContain("filled/switches-on");
    expect(labels).toContain("filled/switches-off");
  });

  it("enumeruje opcje pola, od którego zależy widoczność innego pola", () => {
    const labels = contentProbes({}, schema, "panel").map((p) => p.label);
    expect(labels).toContain("filled/variant=a");
    expect(labels).toContain("filled/variant=b");
  });

  it("próbkuje oba końce zakresu pól liczbowych", () => {
    const probes = contentProbes({}, schema);
    const min = probes.find((p) => p.label === "filled/numbers-min");
    const max = probes.find((p) => p.label === "filled/numbers-max");
    expect(min?.content.widthPct).toBe(10);
    expect(max?.content.widthPct).toBe(100);
  });

  it("listy dostają URL-e, żeby renderery mediów nie wypadły w stan pusty", () => {
    const listSchema: SchemaField[] = [{ key: "images", type: "stringArray", label: "Obrazki" }];
    const filled = contentProbes({}, listSchema)[1].content.images;
    expect(Array.isArray(filled)).toBe(true);
    for (const item of filled as string[]) expect(item).toMatch(/^https:\/\//);
  });

  it("pole i18n wypełnia OBA języki", () => {
    const i18nSchema: SchemaField[] = [{ key: "text", type: "i18nText", label: "Tekst" }];
    const filled = contentProbes({}, i18nSchema)[1].content;
    expect(filled.text_pl).toBeTruthy();
    expect(filled.text_en).toBeTruthy();
  });

  it("dokłada zadeklarowane stany widgetu", () => {
    const probes = contentProbes({}, schema, "renderer", [
      { label: "source=manual", patch: { source: "manual" } },
    ]);
    const state = probes.find((p) => p.label === "state/source=manual");
    expect(state?.content.source).toBe("manual");
  });

  it("zakres panelu nie enumeruje opcji, których żaden warunek nie wymienia", () => {
    const plain: SchemaField[] = [
      { key: "tag", type: "select", label: "Tag", options: [{ value: "h1" }, { value: "h2" }] },
    ];
    const labels = contentProbes({}, plain, "panel").map((p) => p.label);
    expect(labels).not.toContain("filled/tag=h1");
    // Renderer rozgałęzia się sam po wariantach, więc tam enumerujemy szerzej.
    expect(contentProbes({}, plain, "renderer").map((p) => p.label)).not.toContain("filled/tag=h1");
  });
});

describe("unreachableSchemaFields", () => {
  it("zgłasza pole, którego warunek nie spełnia ŻADNA próbka", () => {
    const schema: SchemaField[] = [
      { key: "variant", type: "select", label: "Wariant", options: [{ value: "a" }] },
      { key: "ghost", type: "text", label: "Widmo", visibleWhen: (c) => c.variant === "nie-ma" },
    ];
    expect(unreachableSchemaFields(schema, contentProbes({}, schema))).toEqual(["ghost"]);
  });

  it("milczy, gdy któraś próbka warunek spełnia", () => {
    const schema: SchemaField[] = [
      {
        key: "variant",
        type: "select",
        label: "Wariant",
        options: [{ value: "a" }, { value: "b" }],
      },
      { key: "extra", type: "text", label: "Dodatek", visibleWhen: (c) => c.variant === "b" },
    ];
    expect(unreachableSchemaFields(schema, contentProbes({}, schema))).toEqual([]);
  });

  it("predykat, który rzuca wyjątkiem, liczy się jako niespełniony", () => {
    const schema: SchemaField[] = [
      {
        key: "boom",
        type: "text",
        label: "Bum",
        visibleWhen: () => {
          throw new Error("boom");
        },
      },
    ];
    expect(unreachableSchemaFields(schema, contentProbes({}, schema))).toEqual(["boom"]);
  });
});

describe("diffFidelity", () => {
  it("rozdziela martwe od ukrytych i sortuje deterministycznie", () => {
    const diff = diffFidelity(new Set(["b", "a", "shared"]), new Set(["shared", "z", "y"]));
    expect(diff.dead).toEqual(["a", "b"]);
    expect(diff.hidden).toEqual(["y", "z"]);
  });

  it("zgodne zbiory dają pustą różnicę", () => {
    expect(diffFidelity(new Set(["a"]), new Set(["a"]))).toEqual({ dead: [], hidden: [] });
  });
});

describe("applyWaivers", () => {
  it("przepuszcza zwolniony klucz i zgłasza pozostałe", () => {
    const verdict = applyWaivers(["a", "b"], { a: "powód" });
    expect(verdict.unexpected).toEqual(["b"]);
    expect(verdict.stale).toEqual([]);
  });

  it("zgłasza zwolnienie, które przestało być potrzebne", () => {
    const verdict = applyWaivers([], { a: "powód" });
    expect(verdict.unexpected).toEqual([]);
    expect(verdict.stale).toEqual(["a"]);
  });

  it("brak listy zwolnień = wszystko jest nieoczekiwane", () => {
    expect(applyWaivers(["a"], undefined).unexpected).toEqual(["a"]);
  });
});
