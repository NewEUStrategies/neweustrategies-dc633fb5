import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  collectBuilderWidgets,
  collectSectionWidgets,
  collectAboveFoldWidgets,
  prefetchSectionQueries,
  prefetchBuilderDocumentQueries,
  prefetchAboveFoldQueries,
  prefetchCachedRouteQueries,
  widgetQueryOptionsList,
  sectionQueryOptionsList,
  pendingSectionQueries,
  ABOVE_FOLD_SECTION_COUNT,
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
    // safeParseBuilderDoc (used by collectBuilderWidgets) only trusts a document
    // tagged `version: 1` - the canonical BuilderDocument shape.
    const doc: BuilderDocument = {
      version: 1,
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
      version: 1,
      sections: [
        makeSection([makeWidget("post-list")], "s1"),
        makeSection([makeWidget("carousel")], "s2"),
      ],
    } as unknown as BuilderDocument;
    await prefetchBuilderDocumentQueries(qc, doc, "pl");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("collectAboveFoldWidgets", () => {
  function docOfSections(n: number): BuilderDocument {
    return {
      sections: Array.from({ length: n }, (_, i) =>
        makeSection([makeWidget("post-list")], `s${i}`),
      ),
    } as unknown as BuilderDocument;
  }

  it("returns widgets only from the first N sections", () => {
    const doc = docOfSections(5);
    expect(collectAboveFoldWidgets(doc, 2)).toHaveLength(2);
    expect(collectAboveFoldWidgets(doc, 4)).toHaveLength(4);
  });

  it("caps at the available section count", () => {
    const doc = docOfSections(2);
    expect(collectAboveFoldWidgets(doc, 10)).toHaveLength(2);
  });

  it("treats a non-positive count as zero", () => {
    const doc = docOfSections(3);
    expect(collectAboveFoldWidgets(doc, 0)).toHaveLength(0);
    expect(collectAboveFoldWidgets(doc, -1)).toHaveLength(0);
  });
});

describe("prefetchAboveFoldQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function docOfSections(n: number): BuilderDocument {
    return {
      sections: Array.from({ length: n }, (_, i) =>
        makeSection([makeWidget("post-list")], `s${i}`),
      ),
    } as unknown as BuilderDocument;
  }

  it("prefetches only the above-the-fold sections", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    await prefetchAboveFoldQueries(qc, docOfSections(6), "pl", { sections: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("defaults to ABOVE_FOLD_SECTION_COUNT leading sections", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    await prefetchAboveFoldQueries(qc, docOfSections(10), "pl");
    expect(spy).toHaveBeenCalledTimes(ABOVE_FOLD_SECTION_COUNT);
  });

  it("does nothing when no data-bound widgets are above the fold", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const doc: BuilderDocument = {
      sections: [makeSection([makeWidget("heading"), makeWidget("text")], "s0")],
    } as unknown as BuilderDocument;
    await prefetchAboveFoldQueries(qc, doc, "pl");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves within the latency budget even if a query never settles", async () => {
    vi.spyOn(qc, "prefetchQuery").mockReturnValue(new Promise<void>(() => {}));
    const start = Date.now();
    await prefetchAboveFoldQueries(qc, docOfSections(3), "pl", { budgetMs: 40 });
    // Returned because the budget elapsed, not because the prefetch settled.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("awaits fully when the budget is disabled", async () => {
    let resolved = false;
    vi.spyOn(qc, "prefetchQuery").mockImplementation(
      () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            resolved = true;
            r();
          }, 5),
        ),
    );
    await prefetchAboveFoldQueries(qc, docOfSections(1), "pl", { budgetMs: 0 });
    expect(resolved).toBe(true);
  });
});

describe("prefetchCachedRouteQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function docOfSections(n: number): BuilderDocument {
    return {
      sections: Array.from({ length: n }, (_, i) =>
        makeSection([makeWidget("post-list")], `s${i}`),
      ),
    } as unknown as BuilderDocument;
  }

  it("warms EVERY section, not just the above-the-fold cap", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const sectionCount = ABOVE_FOLD_SECTION_COUNT + 5;
    await prefetchCachedRouteQueries(qc, docOfSections(sectionCount), "pl");
    // One post-list prefetch per section - the whole document, uncapped.
    expect(spy).toHaveBeenCalledTimes(sectionCount);
  });

  it("stays bounded by the budget if a query never settles", async () => {
    vi.spyOn(qc, "prefetchQuery").mockReturnValue(new Promise<void>(() => {}));
    const start = Date.now();
    await prefetchCachedRouteQueries(qc, docOfSections(4), "pl", 40);
    // Returned because the budget elapsed, not because the prefetch settled.
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("widgetQueryOptionsList", () => {
  it("maps post-list / carousel to one list query each", () => {
    expect(widgetQueryOptionsList(makeWidget("post-list"), "pl")).toHaveLength(1);
    expect(widgetQueryOptionsList(makeWidget("carousel"), "pl")).toHaveLength(1);
    const [opts] = widgetQueryOptionsList(makeWidget("post-list"), "pl");
    expect(opts.queryKey[0]).toBe("builder-post-list");
  });

  it("maps a slider to one ref per UNIQUE post id plus a fallback-images query", () => {
    const slider = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { postId: "p2" }, { postId: "p1" }] },
    } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(slider, "en");
    expect(opts).toHaveLength(3);
    const keys = opts.map((o) => o.queryKey[0]);
    expect(keys.filter((k) => k === "post-ref")).toHaveLength(2);
    expect(keys).toContain("builder-slider-fallback-images");
  });

  it("returns nothing for widgets with no data binding", () => {
    expect(widgetQueryOptionsList(makeWidget("heading"), "pl")).toHaveLength(0);
    expect(widgetQueryOptionsList(makeWidget("text"), "pl")).toHaveLength(0);
  });

  it("is the single source of truth behind prefetchWidgets' fan-out count", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const slider = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { postId: "p2" }] },
    } as Partial<WidgetNode>);
    const section = makeSection([makeWidget("post-list"), slider, makeWidget("heading")]);
    const expected = sectionQueryOptionsList(section, "pl").length;
    await prefetchSectionQueries(qc, section, "pl");
    expect(spy).toHaveBeenCalledTimes(expected);
    expect(expected).toBe(4); // 1 post-list + (2 refs + 1 fallback)
  });
});

describe("sectionQueryOptionsList", () => {
  it("flattens every data query across a section's widgets", () => {
    expect(
      sectionQueryOptionsList(makeSection([makeWidget("post-list"), makeWidget("heading")]), "pl"),
    ).toHaveLength(1);
    expect(
      sectionQueryOptionsList(makeSection([makeWidget("heading"), makeWidget("text")]), "pl"),
    ).toHaveLength(0);
  });
});

describe("pendingSectionQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("treats a section with no data queries as fully settled", () => {
    const section = makeSection([makeWidget("heading")]);
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(0);
  });

  it("reports every query as pending when the cache is cold", () => {
    const section = makeSection([makeWidget("post-list")]);
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(1);
  });

  it("drops queries whose cache entry has resolved (success)", () => {
    const section = makeSection([makeWidget("post-list")]);
    sectionQueryOptionsList(section, "pl").forEach((o) => qc.setQueryData(o.queryKey, []));
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(0);
  });

  it("treats an errored query as settled (the widget renders its own fallback)", () => {
    const section = makeSection([makeWidget("post-list")]);
    const [opts] = sectionQueryOptionsList(section, "pl");
    qc.setQueryData(opts.queryKey, []);
    const query = qc.getQueryCache().find({ queryKey: opts.queryKey });
    const state = qc.getQueryState(opts.queryKey);
    if (query && state) query.setState({ ...state, status: "error", error: new Error("boom") });
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(0);
  });
});
