import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Degradacja silnika sanityzacji to zdarzenie BEZPIECZEŃSTWA: `sanitizeHtml`
// przechodzi wtedy w tryb fail-closed, ale ktoś musi się o tym dowiedzieć.
// Sąsiedni `sanitizeEngineGuard.test.ts` dowodzi werdyktu kanarka; ten plik -
// tego, co trafia do telemetrii: dokładnie JEDEN raport na cykl życia
// dokumentu (nie jeden na każde wywołanie sanitizera), z powodem i obciętym
// wynikiem kanarka, oraz że awaria transportu nigdy nie wraca do wołającego.
//
// Granica: wyłącznie `sendBeaconPayload` (transport do sieci). Budowa ładunku
// (`buildErrorPayload`) i adres endpointu są prawdziwe.

const send = vi.hoisted(() => vi.fn<(endpoint: string, payload: unknown) => boolean>());

vi.mock("@/lib/observability/report", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/observability/report")>();
  return { ...real, sendBeaconPayload: send };
});

import { assertSanitizerEngine, resetSanitizerEngineProbe } from "@/lib/sanitizeEngineGuard";
import { observabilityEndpoint } from "@/lib/observability/report";

/** Silnik, który przepuszcza `<script>` - kształt zmierzony na happy-dom. */
const leakyEngine = (dirty: string): string => dirty;

/** Czeka, aż dynamiczny import modułu raportu i jego mikrozadania się zakończą. */
async function settleReport(): Promise<void> {
  await vi.dynamicImportSettled();
  await Promise.resolve();
}

beforeEach(() => {
  send.mockReset().mockReturnValue(true);
});

afterEach(() => {
  resetSanitizerEngineProbe();
});

describe("assertSanitizerEngine - raport degradacji do telemetrii", () => {
  it("wysyła jeden raport z powodem, ścieżką i wynikiem kanarka", async () => {
    window.history.replaceState(null, "", "/analizy/wpis");
    expect(assertSanitizerEngine(leakyEngine)).toBe("degraded");
    await settleReport();

    expect(send).toHaveBeenCalledTimes(1);
    const [endpoint, payload] = send.mock.calls[0];
    expect(endpoint).toBe(observabilityEndpoint());
    expect(payload).toMatchObject({
      type: "error",
      source: "react_error_boundary",
      path: "/analizy/wpis",
      meta: {
        kind: "sanitizer_engine_degraded",
        reason: "leak: <p>ok</p><script>alert(1)</script>",
        canaryOutput: "<p>ok</p><script>alert(1)</script>",
      },
    });
    expect((payload as { message: string }).message).toContain("fail-closed");
  });

  it("kolejne wywołania sanitizera NIE mnożą raportów", async () => {
    assertSanitizerEngine(leakyEngine);
    assertSanitizerEngine(leakyEngine);
    assertSanitizerEngine(leakyEngine);
    await settleReport();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("wynik kanarka w raporcie jest obcięty do 200 znaków", async () => {
    const longLeak = (dirty: string) => `${dirty}${"x".repeat(500)}`;
    assertSanitizerEngine(longLeak);
    await settleReport();
    const payload = send.mock.calls[0][1] as { meta: { canaryOutput: string } };
    expect(payload.meta.canaryOutput).toHaveLength(200);
  });

  it("sprawny silnik nie wysyła niczego", async () => {
    const goodEngine = (dirty: string) =>
      dirty
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
        .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
        .replace(/<img\b[^>]*>/gi, "");
    expect(assertSanitizerEngine(goodEngine)).toBe("healthy");
    await settleReport();
    expect(send).not.toHaveBeenCalled();
  });

  it("awaria transportu telemetrii nie wraca do wołającego", async () => {
    send.mockImplementation(() => {
      throw new Error("beacon zablokowany");
    });
    expect(() => assertSanitizerEngine(leakyEngine)).not.toThrow();
    await settleReport();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
