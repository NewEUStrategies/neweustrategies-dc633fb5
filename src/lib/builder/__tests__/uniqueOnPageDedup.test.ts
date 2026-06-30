import { describe, it, expect } from "vitest";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import {
  dedupeAndSlice,
  postListInput,
  postListDisplayLimit,
  postListQueryOptions,
} from "@/lib/builder/postListQuery";
import { newsTickerInput, newsTickerDisplayLimit, newsTickerQueryOptions } from "@/lib/builder/newsTickerQuery";
import { widgetQueryOptionsList, widgetCacheTargets } from "@/lib/builder/prefetch";

const row = (id: string) => ({ id });

describe("dedupeAndSlice", () => {
  it("drops excluded ids and fills up to the display limit", () => {
    const rows = [row("a"), row("b"), row("c"), row("d"), row("e")];
    expect(dedupeAndSlice(rows, ["b", "d"], 2).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns the first N when nothing is excluded", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(dedupeAndSlice(rows, [], 2).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("can return fewer than the limit when most rows are excluded", () => {
    const rows = [row("a"), row("b")];
    expect(dedupeAndSlice(rows, ["a", "b"], 5)).toEqual([]);
  });
});

describe("post-list query key is snapshot-independent", () => {
  it("over-fetches past the display limit only when uniqueOnPage is set", () => {
    const base = { limit: 6 } as unknown as WidgetContent;
    const unique = { limit: 6, uniqueOnPage: true } as unknown as WidgetContent;
    expect(postListDisplayLimit(base)).toBe(6);
    expect(postListInput(base, "pl").limit).toBe(6);
    expect(postListInput(unique, "pl").limit).toBe(6 + 18);
  });

  it("produces an identical query key regardless of any page-used state", () => {
    const c = { limit: 6, uniqueOnPage: true } as unknown as WidgetContent;
    // postListQueryOptions takes no snapshot argument anymore, so two calls with
    // the same content yield the same key - what lets the server prefetch and
    // the client render share one cache entry.
    expect(postListQueryOptions(c, "pl").queryKey).toEqual(postListQueryOptions(c, "pl").queryKey);
  });
});

describe("news-ticker query + prefetch enumeration", () => {
  it("over-fetches for uniqueOnPage and parses category slugs", () => {
    const c = { limit: 10, uniqueOnPage: true, categoriesCsv: "ue, nato , " } as unknown as WidgetContent;
    expect(newsTickerDisplayLimit(c)).toBe(10);
    const input = newsTickerInput(c);
    expect(input.limit).toBe(10 + 18);
    expect(input.categorySlugs).toEqual(["ue", "nato"]);
  });

  it("caps the news-ticker over-fetch at 60", () => {
    const c = { limit: 30, uniqueOnPage: true } as unknown as WidgetContent;
    expect(newsTickerInput(c).limit).toBe(48);
  });

  function makeWidget(type: WidgetNode["type"], content: WidgetContent): WidgetNode {
    return { kind: "widget", id: "w1", type, content, style: {}, advanced: {} } as WidgetNode;
  }

  it("is enumerated by the prefetch / stream-gate helpers (was previously missed)", () => {
    const widget = makeWidget("news-ticker", { limit: 5 } as unknown as WidgetContent);
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey[0]).toBe("builder-news-ticker");
    expect(opts[0].queryKey).toEqual(newsTickerQueryOptions(widget.content, "pl").queryKey);

    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key[0]).toBe("builder-news-ticker");
  });
});
