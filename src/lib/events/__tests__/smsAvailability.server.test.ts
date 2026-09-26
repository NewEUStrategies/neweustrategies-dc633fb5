// Dostępność SMS-ów uczestnika: logika serwerowa i funkcja serwerowa GET.
//
// Odpowiedź nie zależy od wołającego - to lustro `participantSmsEnabled()`
// (token operatora ORAZ `EVENT_SMS_ENABLED=1`). Funkcja serwerowa jest wołana
// przez harness, bo bez runtime'u TanStack Start handlera nie da się wywołać.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callServerFn } from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

const { getParticipantSmsAvailability } = await import("@/lib/events/smsAvailability.functions");
const { readParticipantSmsAvailability } = await import("@/lib/events/smsAvailability.server");

const ENV = ["SMSAPI_TOKEN", "EVENT_SMS_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("readParticipantSmsAvailability", () => {
  it("domyślnie wyłączone", () => {
    expect(readParticipantSmsAvailability()).toEqual({ smsEnabled: false });
  });

  it("włączone wyłącznie z tokenem i jawną zgodą środowiska", () => {
    process.env.SMSAPI_TOKEN = "token-atrapa";
    expect(readParticipantSmsAvailability()).toEqual({ smsEnabled: false });
    process.env.EVENT_SMS_ENABLED = "1";
    expect(readParticipantSmsAvailability()).toEqual({ smsEnabled: true });
  });
});

describe("getParticipantSmsAvailability", () => {
  it("oddaje stan platformy bez sesji", async () => {
    await expect(
      callServerFn<{ smsEnabled: boolean }>(getParticipantSmsAvailability, {
        context: { supabase: null },
      }),
    ).resolves.toEqual({ smsEnabled: false });
    process.env.SMSAPI_TOKEN = "token-atrapa";
    process.env.EVENT_SMS_ENABLED = "1";
    await expect(
      callServerFn<{ smsEnabled: boolean }>(getParticipantSmsAvailability, {
        context: { supabase: null },
      }),
    ).resolves.toEqual({ smsEnabled: true });
  });
});
