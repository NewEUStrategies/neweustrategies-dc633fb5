import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  collectBuilderWidgets,
  collectSectionWidgets,
  prefetchSectionQueries,
  prefetchBuilderDocumentQueries,
} from "@/lib/builder/prefetch";

function makeWidget(type: WidgetNode["type"], extra: Partial<WidgetNode> = {}): WidgetNode {
  return {
    kind: "widget",
    id: `w-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content: { items: [] },
    style: {},
    advanced: {},
    ...extra,
  } as WidgetNode;
}

function makeSection(widgets: WidgetNode[], id = "s1"): SectionNode {
  return {
    id,
    children: [
      {
        kind: "column",
        id: `${id}-c`,
        span: { desktop: 12 },
        children: widgets,
      },
    ],
  } as unknown as SectionNode;
}

describe("section prefetch helpers", () => {
  it("collects widgets from a section (flat columns)", () => {
    const w1 = makeWidget("post-list");
    const w2 = makeWidget("heading");
    const section = makeSection([w1, w2]);
    const widgets = collectSectionWidgets(section);
    expect(widgets.map((w) => w.id).sort()).toEqual([w1.id, w2.id].sort());
  });

  it("collects widgets from inner-sections", () => {
    const inner: WidgetNode = makeWidget("post-list");
    const section: SectionNode = {
      id: "s",
      children: [
        {
          kind: "inner-section",
          id: "is",
          columns: [
            { kind: "column", id: "c", span: { desktop: 12 }, children: [inner] },
          ],
        },
      ],
    } as unknown as SectionNode;
    expect(collectSectionWidgets(section).map((w) => w.id)).toEqual([inner.id]);
  });

  it("collectBuilderWidgets flattens across sections", () => {
    const a = makeWidget("post-list");
    const b = makeWidget("slider");
    const doc: BuilderDocument = {
      sections: [makeSection([a], "s1"), makeSection([b], "s2")],
    } as unknown as BuilderDocument;
    expect(collectBuilderWidgets(doc).map((w) => w.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("prefetchSectionQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("invokes queryClient.prefetchQuery for post-list widgets", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const section = makeSection([makeWidget("post-list"), makeWidget("heading")]);
    await prefetchSectionQueries(qc, section, "pl");
    // post-list -> 1 prefetch, heading -> 0
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("schedules slider fallback + post refs for slider widgets", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const slider = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { postId: "p2" }, { postId: "p1" }] },
    } as Partial<WidgetNode>);
    const section = makeSection([slider]);
    await prefetchSectionQueries(qc, section, "en");
    // 2 unique post refs + 1 fallback images query
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does not throw when an underlying prefetch rejects", async () => {
    vi.spyOn(qc, "prefetchQuery").mockRejectedValue(new Error("net"));
    const section = makeSection([makeWidget("post-list")]);
    await expect(prefetchSectionQueries(qc, section, "pl")).resolves.toBeUndefined();
  });

  it("whole-document prefetch fans out across sections", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const doc: BuilderDocument = {
      sections: [
        makeSection([makeWidget("post-list")], "s1"),
        makeSection([makeWidget("carousel")], "s2"),
      ],
    } as unknown as BuilderDocument;
    await prefetchBuilderDocumentQueries(qc, doc, "pl");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
