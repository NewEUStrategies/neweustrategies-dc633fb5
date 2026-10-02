import { describe, expect, it } from "vitest";
import { widgetPreloadHeaders } from "../widgetPreloads";
import type { BuilderDocument, SectionNode, WidgetNode } from "@/lib/builder/types";

const widget = (type: WidgetNode["type"], content = {}): WidgetNode => ({
  id: type,
  kind: "widget",
  type,
  content,
});
const section = (...widgets: WidgetNode[]): SectionNode => ({
  id: "section",
  kind: "section",
  children: [{ id: "column", kind: "column", span: { desktop: 12 }, children: widgets }],
});
const chunks = {
  "search-button": ["/assets/search-hash.js"],
  slider: ["/assets/posts-hash.js", "/assets/slider-hash.js"],
  "image-slider": ["/assets/slider-hash.js"],
  text: ["/assets/text-hash.js"],
};

describe("widget preload selection", () => {
  it("preloads only the leading sections and deduplicates nested widgets", () => {
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        section(widget("search-button")),
        {
          id: "nested",
          kind: "section",
          children: [
            {
              id: "inner",
              kind: "inner-section",
              columns: section(
                widget("search-button"),
                widget("slider", { source: "posts" }),
              ).children.filter((node) => node.kind === "column"),
            },
          ],
        },
        section(widget("text")),
      ],
    };
    expect(widgetPreloadHeaders(doc, 2, chunks)).toEqual([
      '</assets/search-hash.js>; rel="modulepreload"; crossorigin',
      '</assets/posts-hash.js>; rel="modulepreload"; crossorigin',
      '</assets/slider-hash.js>; rel="modulepreload"; crossorigin',
    ]);
  });

  it("does not load post queries for a slider containing manually chosen images", () => {
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        section(widget("slider", { items: [{ image: "https://example.com/slide.jpg" }] })),
      ],
    };
    expect(widgetPreloadHeaders(doc, 1, chunks)).toEqual([
      '</assets/slider-hash.js>; rel="modulepreload"; crossorigin',
    ]);
    expect(widgetPreloadHeaders(doc, 1)).toEqual([]);
    expect(widgetPreloadHeaders(doc, 0, chunks)).toEqual([]);
  });
});

// ── PRZYPADKI BRZEGOWE ───────────────────────────────────────────────────────
//
// Dwa przypadki z audytu (tylko sekcje wiodące + deduplikacja; slider z samych
// obrazów jako `image-slider`) są wyżej. Niżej: granice `sectionCount`,
// głębokość drzewa, typy spoza mapy i dokument, który nie trzyma się typu -
// loader korzenia woła tę funkcję na SUROWYM `header.builder_data`.
describe("widget preload selection - edge cases", () => {
  const hint = (url: string) => `<${url}>; rel="modulepreload"; crossorigin`;
  const doc = (...sections: SectionNode[]): BuilderDocument => ({ version: 1, sections });

  it("empty document yields no hints", () => {
    expect(widgetPreloadHeaders(doc(), 3, chunks)).toEqual([]);
    expect(widgetPreloadHeaders(doc(section()), 3, chunks)).toEqual([]);
  });

  it("sectionCount larger than the document takes every section, without padding", () => {
    const d = doc(section(widget("search-button")), section(widget("text")));
    expect(widgetPreloadHeaders(d, 50, chunks)).toEqual([
      hint("/assets/search-hash.js"),
      hint("/assets/text-hash.js"),
    ]);
  });

  it.each([0, -1, -3, Number.NaN])(
    "sectionCount %s yields nothing (slice(0, -1) would mean 'all but last')",
    (n) => {
      const d = doc(section(widget("search-button")), section(widget("text")));
      expect(widgetPreloadHeaders(d, n, chunks)).toEqual([]);
    },
  );

  it("the section cut-off is exact: the widget in section N+1 is not hinted", () => {
    const d = doc(section(widget("search-button")), section(widget("text")));
    expect(widgetPreloadHeaders(d, 1, chunks)).toEqual([hint("/assets/search-hash.js")]);
  });

  it("walks section -> inner-section -> column -> widget across several inner sections", () => {
    const columns = (...widgets: WidgetNode[]) =>
      section(...widgets).children.filter((node) => node.kind === "column");
    const d = doc({
      id: "deep",
      kind: "section",
      children: [
        { id: "inner-a", kind: "inner-section", columns: columns(widget("text")) },
        ...columns(widget("search-button")),
        {
          id: "inner-b",
          kind: "inner-section",
          columns: [...columns(), ...columns(widget("slider", { source: "posts" }))],
        },
      ],
    });
    // Kolejność = kolejność w dokumencie; dedupe po adresie, nie po typie.
    expect(widgetPreloadHeaders(d, 1, chunks)).toEqual([
      hint("/assets/text-hash.js"),
      hint("/assets/search-hash.js"),
      hint("/assets/posts-hash.js"),
      hint("/assets/slider-hash.js"),
    ]);
  });

  it("unknown and eager widget types contribute nothing, known neighbours still do", () => {
    const d = doc(
      section(
        widget("heading"),
        widget("not-a-widget" as WidgetNode["type"]),
        widget("search-button"),
      ),
    );
    expect(widgetPreloadHeaders(d, 1, chunks)).toEqual([hint("/assets/search-hash.js")]);
  });

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
    "type `%s` from the data does not hit Object.prototype (no TypeError)",
    (type) => {
      const d = doc(section(widget(type as WidgetNode["type"]), widget("text")));
      expect(() => widgetPreloadHeaders(d, 1, chunks)).not.toThrow();
      expect(widgetPreloadHeaders(d, 1, chunks)).toEqual([hint("/assets/text-hash.js")]);
    },
  );

  it("slider image-only vs posts-sourced: the two are not merged into one decision", () => {
    // Negatyw do przypadku z audytu: pusty slider (bez pozycji) i slider
    // z pozycjami BEZ obrazu/wpisu ciągną źródło z wpisów, więc dostają oba chunki.
    for (const content of [{}, { items: [] }, { items: [{ title: "no image" }] }]) {
      expect(widgetPreloadHeaders(doc(section(widget("slider", content))), 1, chunks)).toEqual([
        hint("/assets/posts-hash.js"),
        hint("/assets/slider-hash.js"),
      ]);
    }
    expect(
      widgetPreloadHeaders(
        doc(section(widget("slider", { items: [{ postId: "p1" }] }))),
        1,
        chunks,
      ),
    ).toEqual([hint("/assets/slider-hash.js")]);
  });

  it("a malformed document (raw jsonb) never throws and keeps the well-formed parts", () => {
    const raw = {
      version: 1,
      sections: [
        null,
        "section",
        { id: "a", kind: "section", children: { not: "an array" } },
        {
          id: "b",
          kind: "section",
          children: [null, { id: "i", kind: "inner-section", columns: "x" }],
        },
        section({ id: "w", kind: "widget", type: "text", content: null } as unknown as WidgetNode),
      ],
    } as unknown as BuilderDocument;
    expect(() => widgetPreloadHeaders(raw, 10, chunks)).not.toThrow();
    expect(widgetPreloadHeaders(raw, 10, chunks)).toEqual([hint("/assets/text-hash.js")]);
    expect(widgetPreloadHeaders({ version: 1 } as unknown as BuilderDocument, 3, chunks)).toEqual(
      [],
    );
    expect(
      widgetPreloadHeaders(
        { version: 1, sections: "abc" } as unknown as BuilderDocument,
        3,
        chunks,
      ),
    ).toEqual([]);
  });

  it("a non-array chunk entry is ignored instead of iterated", () => {
    const broken = { text: "/assets/text-hash.js" } as unknown as typeof chunks;
    expect(widgetPreloadHeaders(doc(section(widget("text"))), 1, broken)).toEqual([]);
  });
});
