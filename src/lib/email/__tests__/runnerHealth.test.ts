import { describe, it, expect } from "vitest";

import { resolveRunnerState, type RunnerHealthInput } from "../runnerHealth";

function settings(over: Partial<RunnerHealthInput> = {}): RunnerHealthInput {
  return {
    enabled: true,
    effective_base_url: "https://example.test",
    last_tick_at: "2026-07-31T07:00:00.000Z",
    last_tick_status: "dispatched",
    ...over,
  };
}

describe("resolveRunnerState", () => {
  it("działa, gdy tick dotarł do aplikacji", () => {
    expect(resolveRunnerState(settings())).toBe("running");
  });

  it("wyłączony przesłania wszystkie pozostałe sygnały", () => {
    // Nadrzędność jest istotna: przy wyłączonym runnerze świeży tick w
    // telemetrii to ślad po poprzedniej konfiguracji, nie dowód działania.
    expect(resolveRunnerState(settings({ enabled: false }))).toBe("disabled");
    expect(
      resolveRunnerState(settings({ enabled: false, effective_base_url: "", last_tick_at: null })),
    ).toBe("disabled");
  });

  it("brak adresu bije 'nie było ticku', bo jest jego PRZYCZYNĄ", () => {
    expect(resolveRunnerState(settings({ effective_base_url: "", last_tick_at: null }))).toBe(
      "misconfigured",
    );
  });

  it("błąd ostatniej próby jest widoczny nawet przy wcześniejszych sukcesach", () => {
    expect(resolveRunnerState(settings({ last_tick_status: "error" }))).toBe("error");
  });

  it("włączony bez ani jednego ticku to bezczynność, nie sukces", () => {
    expect(resolveRunnerState(settings({ last_tick_at: null, last_tick_status: null }))).toBe(
      "idle",
    );
  });

  it("tick pominięty (np. brak pg_net) NIE liczy się jako działanie", () => {
    // To była najbardziej myląca sytuacja: cron biegnie, pisze znacznik czasu,
    // ale nic nie wysyła. „running" byłoby tu wprost nieprawdą.
    expect(resolveRunnerState(settings({ last_tick_status: "skipped" }))).toBe("idle");
  });

  it("brak danych traktujemy jak wyłączony (fail-safe dla ładowania panelu)", () => {
    expect(resolveRunnerState(undefined)).toBe("disabled");
    expect(resolveRunnerState(null)).toBe("disabled");
  });
});
