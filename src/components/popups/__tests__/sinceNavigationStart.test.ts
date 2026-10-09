// Zegar „od startu nawigacji" dla opóźnień nakładek (P3.8, recenzja M1).
//
// Dokument wyrenderowany spekulacyjnie (Speculation Rules) zaczyna żyć przed
// kliknięciem, więc `performance.now()` po aktywacji zawiera cały czas
// prerenderu. Startem nawigacji takiego dokumentu jest `activationStart`
// wpisu `PerformanceNavigationTiming`; zwykły dokument ma tam zero (albo pola
// nie ma wcale).
import { afterEach, describe, expect, it, vi } from "vitest";
import { sinceNavigationStart } from "@/components/popups/sinceNavigationStart";

function navigationEntry(fields: Record<string, number>): PerformanceEntry[] {
  return [{ entryType: "navigation", name: "document", ...fields } as unknown as PerformanceEntry];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sinceNavigationStart", () => {
  it("zwykła nawigacja (`activationStart` = 0): tyle co `performance.now()`", () => {
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(
      navigationEntry({ activationStart: 0 }),
    );

    expect(sinceNavigationStart()).toBe(5_000);
  });

  it("dokument prerenderowany: liczy od aktywacji, nie od startu prerenderu", () => {
    vi.spyOn(performance, "now").mockReturnValue(12_000);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(
      navigationEntry({ activationStart: 9_000 }),
    );

    expect(sinceNavigationStart()).toBe(3_000);
  });

  it("przeglądarka bez pola albo bez wpisu nawigacji: od początku dokumentu", () => {
    vi.spyOn(performance, "now").mockReturnValue(4_000);
    const entries = vi.spyOn(performance, "getEntriesByType");

    entries.mockReturnValue(navigationEntry({}));
    expect(sinceNavigationStart()).toBe(4_000);

    entries.mockReturnValue([]);
    expect(sinceNavigationStart()).toBe(4_000);
  });
});
