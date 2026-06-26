import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useSectionPreload,
  isSectionFresh,
  __resetSectionPrefetchRegistry,
} from "@/lib/builder/useSectionPreload";
import * as prefetchMod from "@/lib/builder/prefetch";
import type { SectionNode, WidgetNode } from "@/lib/builder/types";

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

const sectionEmpty: SectionNode = {
  id: "s-empty",
  children: [{ kind: "column", id: "c", span: { desktop: 12 }, children: [] }],
} as unknown as SectionNode;

function withWidgets(widgets: WidgetNode[], id = "s1"): SectionNode {
  return {
    id,
    children: [{ kind: "column", id: `${id}-c`, span: { desktop: 12 }, children: widgets }],
  } as unknown as SectionNode;
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useSectionPreload", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    __resetSectionPrefetchRegistry(qc);
    vi.spyOn(prefetchMod, "prefetchSectionQueries").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prefetches immediately when IntersectionObserver is unavailable", () => {
    renderHook(() => useSectionPreload(sectionEmpty, "pl"), { wrapper: makeWrapper(qc) });
    expect(prefetchMod.prefetchSectionQueries).toHaveBeenCalledTimes(1);
  });

  it("does not prefetch when disabled", () => {
    renderHook(() => useSectionPreload(sectionEmpty, "pl", { enabled: false }), {
      wrapper: makeWrapper(qc),
    });
    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();
  });

  it("dedupes repeated mounts of the same section + lang when data is fresh", () => {
    const section = withWidgets([makeWidget("post-list")]);
    // Seed cache so the SWR gate considers the section fresh.
    const targets = prefetchMod.sectionCacheTargets(
      prefetchMod.collectSectionWidgets(section),
      "pl",
    );
    targets.forEach(({ key }) => qc.setQueryData(key, []));

    const wrapper = makeWrapper(qc);
    const a = renderHook(() => useSectionPreload(section, "pl"), { wrapper });
    a.unmount();
    const b = renderHook(() => useSectionPreload(section, "pl"), { wrapper });
    b.unmount();

    // First mount may still prefetch (registry was empty). Second mount must skip
    // because the registry is populated AND every query target is fresh.
    expect(prefetchMod.prefetchSectionQueries).toHaveBeenCalledTimes(1);
  });

  it("re-prefetches when cached data has expired its staleTime", () => {
    const section = withWidgets([makeWidget("post-list")]);
    const targets = prefetchMod.sectionCacheTargets(
      prefetchMod.collectSectionWidgets(section),
      "pl",
    );
    // Seed cache with data, then manually expire it by rewriting dataUpdatedAt.
    targets.forEach(({ key }) => {
      qc.setQueryData(key, []);
      const state = qc.getQueryState(key);
      const q = qc.getQueryCache().find({ queryKey: key });
      if (q && state) q.setState({ ...state, dataUpdatedAt: 1 });
    });

    const wrapper = makeWrapper(qc);
    renderHook(() => useSectionPreload(section, "pl"), { wrapper }).unmount();
    renderHook(() => useSectionPreload(section, "pl"), { wrapper }).unmount();

    // Both mounts must prefetch since cache is stale on the second.
    expect(prefetchMod.prefetchSectionQueries).toHaveBeenCalledTimes(2);
  });
});

describe("isSectionFresh", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
  });

  it("returns true for a section with no data-bound widgets", () => {
    expect(isSectionFresh(qc, sectionEmpty, "pl")).toBe(true);
  });

  it("returns false when no cache entry exists for the section's widgets", () => {
    const section = withWidgets([makeWidget("post-list")]);
    expect(isSectionFresh(qc, section, "pl")).toBe(false);
  });

  it("returns true when every target has fresh cached data", () => {
    const section = withWidgets([makeWidget("post-list")]);
    const targets = prefetchMod.sectionCacheTargets(
      prefetchMod.collectSectionWidgets(section),
      "pl",
    );
    targets.forEach(({ key }) => qc.setQueryData(key, []));
    expect(isSectionFresh(qc, section, "pl")).toBe(true);
  });
});
