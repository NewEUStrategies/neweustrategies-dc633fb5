import { describe, expect, it } from "vitest";
import {
  HEALTHY_INTERVAL_MS,
  MAX_RECOVERY_ATTEMPTS,
  PROBE_MAX_MS,
  PROBE_MIN_MS,
  RECOVERY_COOLDOWN_MS,
  STUCK_MS,
  heartbeatStep,
  initialHeartbeatState,
  nextProbeDelayMs,
  type HeartbeatState,
} from "../heartbeatMachine";

const T0 = 1_000_000;

function ok(state: HeartbeatState, atMs: number, buildId: string | null = "b1") {
  return heartbeatStep(state, { type: "ok", atMs, buildId });
}
function fail(state: HeartbeatState, atMs: number) {
  return heartbeatStep(state, { type: "fail", atMs });
}

describe("heartbeatMachine", () => {
  it("zdrowy puls nie wywołuje żadnego efektu", () => {
    const first = ok(initialHeartbeatState, T0);
    expect(first.effect).toEqual({ kind: "none" });
    expect(first.state.phase).toBe("online");
    expect(ok(first.state, T0 + HEALTHY_INTERVAL_MS).effect).toEqual({ kind: "none" });
  });

  it("pojedyncza porażka to degradacja, nie utrata sesji", () => {
    const base = ok(initialHeartbeatState, T0).state;
    const step = fail(base, T0 + 1_000);
    expect(step.state.phase).toBe("degraded");
    expect(step.state.failingSinceMs).toBe(T0 + 1_000);
    expect(step.effect).toEqual({ kind: "none" });
  });

  it("puls milczący 30 s prosi powłokę podglądu o wznowienie", () => {
    let state = ok(initialHeartbeatState, T0).state;
    state = fail(state, T0 + 1_000).state;
    state = fail(state, T0 + 5_000).state;
    const stuck = fail(state, T0 + 1_000 + STUCK_MS);
    expect(stuck.state.phase).toBe("lost");
    expect(stuck.effect).toEqual({ kind: "ask-parent", reason: "session-stuck" });
  });

  it("kolejna próba po cooldownie przeładowuje dokument", () => {
    let state = ok(initialHeartbeatState, T0).state;
    state = fail(state, T0).state;
    state = fail(state, T0 + STUCK_MS).state; // ask-parent
    const tooSoon = fail(state, T0 + STUCK_MS + 5_000);
    expect(tooSoon.effect).toEqual({ kind: "none" });
    const retry = fail(tooSoon.state, T0 + STUCK_MS + RECOVERY_COOLDOWN_MS);
    expect(retry.effect.kind).toBe("reload");
  });

  it("liczba prób wskrzeszenia jest ograniczona", () => {
    let state = fail(initialHeartbeatState, T0).state;
    let at = T0 + STUCK_MS;
    let effects = 0;
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS + 3; i++) {
      const step = fail(state, at);
      state = step.state;
      if (step.effect.kind !== "none") effects++;
      at += RECOVERY_COOLDOWN_MS;
    }
    expect(effects).toBe(MAX_RECOVERY_ATTEMPTS);
    expect(state.recoveryAttempts).toBe(MAX_RECOVERY_ATTEMPTS);
  });

  it("powrót pulsu przy tym samym buildzie tylko odświeża dane", () => {
    let state = ok(initialHeartbeatState, T0).state;
    state = fail(state, T0 + 1_000).state;
    const back = ok(state, T0 + 4_000, "b1");
    expect(back.effect).toEqual({ kind: "soft-refresh", reason: "session-restored" });
    expect(back.state.phase).toBe("online");
    expect(back.state.consecutiveFailures).toBe(0);
  });

  it("powrót pulsu z nowym buildem przeładowuje dokument", () => {
    let state = ok(initialHeartbeatState, T0).state;
    state = fail(state, T0 + 1_000).state;
    const back = ok(state, T0 + 4_000, "b2");
    expect(back.effect).toEqual({ kind: "reload", reason: "build-changed" });
  });

  it("zdrowy puls kasuje budżet prób wskrzeszenia", () => {
    let state = fail(initialHeartbeatState, T0).state;
    state = fail(state, T0 + STUCK_MS).state;
    expect(state.recoveryAttempts).toBe(1);
    state = ok(state, T0 + STUCK_MS + 1_000).state;
    expect(state.recoveryAttempts).toBe(0);
    expect(state.lastRecoveryAtMs).toBeNull();
  });

  it("odstęp pulsu: rzadko gdy zdrowo, gęsto z backoffem gdy awaria", () => {
    expect(nextProbeDelayMs(initialHeartbeatState)).toBe(HEALTHY_INTERVAL_MS);
    const one = fail(initialHeartbeatState, T0).state;
    expect(nextProbeDelayMs(one)).toBe(PROBE_MIN_MS);
    let state = one;
    for (let i = 0; i < 8; i++) state = fail(state, T0 + i * 1_000).state;
    expect(nextProbeDelayMs(state)).toBe(PROBE_MAX_MS);
  });
});
