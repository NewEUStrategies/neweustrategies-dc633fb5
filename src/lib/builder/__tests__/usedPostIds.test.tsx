import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { UsedPostIdsProvider, useUsedPostIds } from "@/lib/builder/usedPostIds";

const wrapper = ({ children }: { children: ReactNode }) => (
  <UsedPostIdsProvider>{children}</UsedPostIdsProvider>
);

describe("UsedPostIds context", () => {
  it("registers and snapshots ids across consumers", () => {
    const { result } = renderHook(() => useUsedPostIds(), { wrapper });
    expect(result.current.getSnapshot()).toEqual([]);
    act(() => result.current.register(["a", "b", "c"]));
    expect(result.current.getSnapshot().sort()).toEqual(["a", "b", "c"]);
    act(() => result.current.register(["b", "d"]));
    expect(result.current.getSnapshot().sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns no-op api outside provider", () => {
    const { result } = renderHook(() => useUsedPostIds());
    act(() => result.current.register(["x"]));
    expect(result.current.getSnapshot()).toEqual([]);
  });
});
