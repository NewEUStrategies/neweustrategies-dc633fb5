import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSectionPreload } from "@/lib/builder/useSectionPreload";
import * as prefetchMod from "@/lib/builder/prefetch";
import type { SectionNode } from "@/lib/builder/types";

const section: SectionNode = {
  id: "s1",
  children: [
    { kind: "column", id: "c", span: { desktop: 12 }, children: [] },
  ],
} as unknown as SectionNode;

function makeWrapper() {
  const qc = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useSectionPreload", () => {
  beforeEach(() => {
    // jsdom has no IntersectionObserver -> hook should fall back to immediate prefetch.
    vi.spyOn(prefetchMod, "prefetchSectionQueries").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prefetches immediately when IntersectionObserver is unavailable", () => {
    const { result } = renderHook(() => useSectionPreload(section, "pl"), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toBeDefined();
    expect(prefetchMod.prefetchSectionQueries).toHaveBeenCalledTimes(1);
  });

  it("does not prefetch when disabled", () => {
    renderHook(() => useSectionPreload(section, "pl", { enabled: false }), {
      wrapper: makeWrapper(),
    });
    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();
  });
});
