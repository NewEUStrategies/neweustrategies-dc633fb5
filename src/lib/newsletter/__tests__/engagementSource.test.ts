// Bramka: dokładnie JEDNO źródło zapisuje zdarzenia zaangażowania.
//
// Test istnieje, bo regresja tej reguły jest niewidoczna w runtime - nic się
// nie psuje, nic nie rzuca, po prostu liczby cicho rosną dwa razy szybciej
// i wskaźnik otwarć przekracza 100%. Sześć zgłoszeń tej usterki zaczęło się
// dokładnie tak.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGAGEMENT_SOURCE,
  ENGAGEMENT_SOURCES,
  isEngagementWriter,
  resolveEngagementSource,
  type EngagementSource,
} from "../engagementSource";

describe("resolveEngagementSource", () => {
  it("czyta obie prawidłowe wartości", () => {
    expect(resolveEngagementSource("first_party")).toBe("first_party");
    expect(resolveEngagementSource("provider")).toBe("provider");
  });

  it("normalizuje wielkość liter i białe znaki", () => {
    expect(resolveEngagementSource("  PROVIDER  ")).toBe("provider");
    expect(resolveEngagementSource("First_Party")).toBe("first_party");
  });

  it("spada na tracking własny dla braku, pustej i nieznanej wartości", () => {
    // Cisza jest gorsza od inflacji: inflację widać w panelu, ciszy nie widać
    // nigdzie. Dlatego literówka w konfiguracji NIE wyłącza obu ścieżek.
    for (const raw of [undefined, null, "", "   ", "resend", "both", "none"]) {
      expect(resolveEngagementSource(raw)).toBe("first_party");
    }
    expect(DEFAULT_ENGAGEMENT_SOURCE).toBe("first_party");
  });
});

describe("isEngagementWriter", () => {
  it("przepuszcza wyłącznie skonfigurowane źródło", () => {
    expect(isEngagementWriter("first_party", "first_party")).toBe(true);
    expect(isEngagementWriter("provider", "first_party")).toBe(false);
    expect(isEngagementWriter("provider", "provider")).toBe(true);
    expect(isEngagementWriter("first_party", "provider")).toBe(false);
  });

  it("dla KAŻDEJ konfiguracji pisze dokładnie jedno źródło", () => {
    // Sweep sterowany katalogiem: dołożenie trzeciego producenta bez decyzji,
    // kto jest źródłem prawdy, wywala ten test bez dopisywania asercji.
    for (const configured of ENGAGEMENT_SOURCES) {
      const writers = ENGAGEMENT_SOURCES.filter((source: EngagementSource) =>
        isEngagementWriter(source, configured),
      );
      expect(writers).toEqual([configured]);
    }
  });
});
