// Testy czystego modułu domeny trackera legislacyjnego: kolejność etapów,
// monotoniczny postęp, obsługa etapów terminalnych i kompletność etykiet.
import { describe, it, expect } from "vitest";
import {
  POLICY_STAGES,
  TERMINAL_STAGES,
  POLICY_AREAS,
  STAGE_LABELS,
  stageIndex,
  stageProgress,
  isTerminal,
  stageLabel,
  areaLabel,
} from "@/lib/tracker/stages";

describe("tracker stages - kolejność i indeksy", () => {
  it("pozytywna ścieżka ma dokładnie 6 etapów w kolejności procedury", () => {
    expect(POLICY_STAGES).toEqual([
      "proposal",
      "parliament",
      "council",
      "trilogue",
      "adopted",
      "in_force",
    ]);
  });

  it("stageIndex odwzorowuje kolejne etapy na kolejne indeksy 0..5", () => {
    POLICY_STAGES.forEach((stage, i) => {
      expect(stageIndex(stage)).toBe(i);
    });
  });

  it("etapy terminalne mają indeks -1 (nie leżą na osi postępu)", () => {
    for (const stage of TERMINAL_STAGES) {
      expect(stageIndex(stage)).toBe(-1);
    }
  });

  it("nieznana wartość etapu też daje -1 (defensywnie)", () => {
    expect(stageIndex("plenary")).toBe(-1);
  });
});

describe("tracker stages - postęp", () => {
  it("postęp rośnie ściśle wzdłuż pozytywnej ścieżki", () => {
    const values = POLICY_STAGES.map((s) => stageProgress(s));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("proposal = 0, in_force = 1, wszystko pomiędzy w przedziale (0, 1)", () => {
    expect(stageProgress("proposal")).toBe(0);
    expect(stageProgress("in_force")).toBe(1);
    for (const stage of POLICY_STAGES.slice(1, -1)) {
      const p = stageProgress(stage);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it("etapy terminalne mają postęp 1 (procedura zakończona) i isTerminal = true", () => {
    for (const stage of TERMINAL_STAGES) {
      expect(stageProgress(stage)).toBe(1);
      expect(isTerminal(stage)).toBe(true);
    }
  });

  it("etapy pozytywnej ścieżki nie są terminalne", () => {
    for (const stage of POLICY_STAGES) {
      expect(isTerminal(stage)).toBe(false);
    }
  });

  it("nieznana wartość etapu daje postęp 0", () => {
    expect(stageProgress("plenary")).toBe(0);
  });
});

describe("tracker stages - kompletność etykiet", () => {
  it("każdy etap (pozytywny i terminalny) ma niepustą etykietę pl i en", () => {
    const allStages = [...POLICY_STAGES, ...TERMINAL_STAGES];
    for (const stage of allStages) {
      const entry = STAGE_LABELS.find((s) => s.key === stage);
      expect(entry, `brak etykiety etapu: ${stage}`).toBeDefined();
      expect(entry!.pl.trim()).not.toBe("");
      expect(entry!.en.trim()).not.toBe("");
    }
    // Żadnych nadmiarowych wpisów spoza CHECK-a kolumny stage.
    expect(STAGE_LABELS).toHaveLength(allStages.length);
  });

  it("lista obszarów polityki ma 10 pozycji, każda z niepustym pl i en", () => {
    expect(POLICY_AREAS).toHaveLength(10);
    const keys = POLICY_AREAS.map((a) => a.key);
    expect(new Set(keys).size).toBe(10);
    expect(keys).toContain("energy");
    expect(keys).toContain("enlargement");
    expect(keys).toContain("cohesion");
    for (const area of POLICY_AREAS) {
      expect(area.pl.trim()).not.toBe("");
      expect(area.en.trim()).not.toBe("");
    }
  });

  it("stageLabel i areaLabel zwracają etykietę wg języka, a nieznany klucz przechodzi bez zmian", () => {
    expect(stageLabel("proposal", "pl")).toBe("Projekt KE");
    expect(stageLabel("proposal", "en")).toBe("Commission proposal");
    expect(stageLabel("unknown-stage", "pl")).toBe("unknown-stage");
    expect(areaLabel("cohesion", "pl")).toBe("Spójność");
    expect(areaLabel("cohesion", "en")).toBe("Cohesion");
    expect(areaLabel("unknown-area", "en")).toBe("unknown-area");
  });
});
