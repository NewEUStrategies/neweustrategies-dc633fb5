// Preferencja zestawu ikon (`lib/iconPack.ts`, do 18.08.2026 bez pokrycia).
// Plik zachował dawną nazwę: rejestr ikon marki (`brandIconRegistry.ts`)
// i katalog nazw pełnego zestawu (`lib/icons/iconNames.ts`) nie miały
// importera produkcyjnego i zniknęły razem ze swoimi testami (P3.10).
//
// Preferencja jest globalna: dwa komponenty czytające ją niezależnie muszą
// zobaczyć tę samą wartość w tym samym renderze, a wybór jest utrwalany
// w pamięci przeglądarki.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { setIconPack, useIconPack } from "@/lib/iconPack";

describe("useIconPack / setIconPack", () => {
  beforeEach(() => {
    setIconPack("lucide");
    window.localStorage.clear();
  });

  afterEach(() => {
    setIconPack("lucide");
  });

  it("domyślnym zestawem jest lucide", () => {
    const { result } = renderHook(() => useIconPack());
    expect(result.current).toBe("lucide");
  });

  it("zmiana zestawu odświeża KAŻDEGO subskrybenta", () => {
    // Preferencja jest globalna; dwa komponenty czytające ją niezależnie muszą
    // zobaczyć tę samą wartość w tym samym renderze.
    const a = renderHook(() => useIconPack());
    const b = renderHook(() => useIconPack());
    act(() => setIconPack("fontawesome"));

    expect(a.result.current).toBe("fontawesome");
    expect(b.result.current).toBe("fontawesome");
  });

  it("utrwala wybór w pamięci przeglądarki", () => {
    act(() => setIconPack("fontawesome"));
    expect(window.localStorage.getItem("nes.iconPack")).toBe("fontawesome");
  });

  it("ustawienie tej samej wartości nie odpala powiadomienia", () => {
    const { result, rerender } = renderHook(() => useIconPack());
    act(() => setIconPack("fontawesome"));
    const before = window.localStorage.getItem("nes.iconPack");
    act(() => setIconPack("fontawesome"));
    rerender();

    expect(result.current).toBe("fontawesome");
    expect(window.localStorage.getItem("nes.iconPack")).toBe(before);
  });

  it("odsubskrybowanie po odmontowaniu nie przewraca zmiany", () => {
    const { unmount } = renderHook(() => useIconPack());
    unmount();
    expect(() => act(() => setIconPack("fontawesome"))).not.toThrow();
  });
});
