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

describe("UsedPostIds - odmowy i stabilnosc tozsamosci", () => {
  it("pusty identyfikator NIE wchodzi do zbioru", () => {
    // Pusty napis trafilby potem do `excludeIds` widgetu i - jako fragment
    // listy `.not("id","in",...)` - wyciąłby wiersz o pustym id albo zepsul
    // sklejony filtr. Zbior ma trzymac wylacznie realne identyfikatory.
    const { result } = renderHook(() => useUsedPostIds(), { wrapper });
    act(() => result.current.register(["", "a", ""]));
    expect(result.current.getSnapshot()).toEqual(["a"]);
  });

  it("obiekt api jest TEN SAM miedzy renderami rodzica, a zbior przezywa rerender", () => {
    // Gdyby `api` bylo nowe po kazdym renderze providera, kazdy widget
    // przeliczalby klucz zapytania (getSnapshot w zaleznosciach) i tracil
    // rozgrzany wpis cache przy kazdej zmianie stanu wyzej.
    const { result, rerender } = renderHook(() => useUsedPostIds(), { wrapper });
    const przed = result.current;
    act(() => result.current.register(["a"]));

    rerender();

    expect(result.current).toBe(przed);
    expect(result.current.getSnapshot()).toEqual(["a"]);
  });
});
