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
