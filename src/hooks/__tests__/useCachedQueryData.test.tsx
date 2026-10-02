// Odczyt danych zapytania prosto z cache'u, bez obserwatora - używany przez
// `<ThemeDesignStyle/>` do nasłuchu wpisów pochodnych panelu bez importu
// hooków z ciężkiego modułu Theme Design.
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useCachedQueryData } from "../useCachedQueryData";

const KEY = ["site_settings", "theme_design"] as const;

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useCachedQueryData", () => {
  it("zwraca undefined i NIE tworzy wpisu w cache'u, gdy zapytania nie ma", () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCachedQueryData(KEY), { wrapper });
    expect(result.current).toBeUndefined();
    // To różni hook od `useQuery({ enabled: false })`: zamiatarka SSR nie ma
    // czego usuwać ani o czym ostrzegać.
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("reaguje na setQueryData pod swoim kluczem", () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCachedQueryData<{ mode: string }>(KEY), { wrapper });
    act(() => {
      qc.setQueryData(KEY, { mode: "split" });
    });
    expect(result.current).toEqual({ mode: "split" });
    act(() => {
      qc.setQueryData(KEY, { mode: "shared" });
    });
    expect(result.current).toEqual({ mode: "shared" });
  });

  it("nie renderuje się ponownie od wpisów pod INNYMI kluczami", () => {
    const { qc, wrapper } = setup();
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useCachedQueryData(KEY);
      },
      { wrapper },
    );
    const before = renders;
    act(() => {
      qc.setQueryData(["site_settings", "theme_design_en"], { x: 1 });
    });
    expect(renders).toBe(before);
    expect(result.current).toBeUndefined();
  });

  it("widzi dane obecne w cache'u już przy pierwszym renderze (dehydratacja)", () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(KEY, { mode: "split" });
    const { result } = renderHook(() => useCachedQueryData(KEY), { wrapper });
    expect(result.current).toEqual({ mode: "split" });
  });
});
