// Dziennik doręczeń po stronie serwera: rezerwacja i potwierdzenie.
//
// STAWKI: (1) ładunek rezerwacji ma dokładnie te klucze, które zna
// `_event_delivery_claim` - pola opcjonalne tylko, gdy są; (2) duplikat
// (`null` z bazy) znaczy „nie wysyłaj"; (3) nic tu nie rzuca - awaria dziennika
// nie może wywrócić porcji zadania; (4) log bez klucza deduplikacji.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), broken: false }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    if (db.broken) throw new Error("client unavailable");
    return { rpc: db.rpc };
  },
}));

import { claimDelivery, confirmDelivery } from "@/lib/events/participantDelivery.server";

const BASE = {
  tenantId: "t1",
  eventId: "e1",
  kind: "event_reminder" as const,
  channel: "email" as const,
  dedupeKey: "er:p1:r1:e1:email:60:1900000000",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.broken = false;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("claimDelivery", () => {
  it("minimalny ładunek - tylko wymagane klucze", async () => {
    db.rpc.mockResolvedValue({ data: "d1", error: null });
    await expect(claimDelivery(BASE)).resolves.toBe("d1");
    expect(db.rpc).toHaveBeenCalledWith("_event_delivery_claim", {
      p_payload: {
        tenant_id: "t1",
        event_id: "e1",
        kind: "event_reminder",
        channel: "email",
        dedupe_key: BASE.dedupeKey,
      },
    });
  });

  it("pola opcjonalne jadą, gdy są (null/undefined pominięte)", async () => {
    db.rpc.mockResolvedValue({ data: "d2", error: null });
    await claimDelivery({
      ...BASE,
      registrationId: "r1",
      personId: "p1",
      userId: null,
      sessionId: undefined,
      leadMinutes: 60,
      startsAt: "2030-06-10T08:00:00Z",
    });
    expect(db.rpc.mock.calls[0][1]).toEqual({
      p_payload: {
        tenant_id: "t1",
        event_id: "e1",
        kind: "event_reminder",
        channel: "email",
        dedupe_key: BASE.dedupeKey,
        registration_id: "r1",
        person_id: "p1",
        lead_minutes: 60,
        starts_at: "2030-06-10T08:00:00Z",
      },
    });
  });

  it("zero minut wyprzedzenia to wartość, nie brak", async () => {
    db.rpc.mockResolvedValue({ data: "d3", error: null });
    await claimDelivery({ ...BASE, leadMinutes: 0, userId: "u1", sessionId: "s1" });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({
      p_payload: { lead_minutes: 0, user_id: "u1", session_id: "s1" },
    });
  });

  it.each([null, "", 5])("duplikat / zła odpowiedź (%j) -> null", async (data) => {
    db.rpc.mockResolvedValue({ data, error: null });
    await expect(claimDelivery(BASE)).resolves.toBeNull();
  });

  it("błąd RPC -> null, log bez klucza deduplikacji", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "invalid_payload: unknown kind" } });
    await expect(claimDelivery(BASE)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith("[participantDelivery] claim failed", {
      kind: "event_reminder",
      channel: "email",
      error: "invalid_payload: unknown kind",
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(BASE.dedupeKey);
  });

  it.each([
    ["rzut klienta", () => (db.broken = true)],
    ["odrzucona obietnica", () => db.rpc.mockRejectedValue(new Error("network"))],
    ["rzut nie-Error", () => db.rpc.mockRejectedValue("boom")],
  ])("%s -> null (nigdy nie rzuca)", async (_label, arrange) => {
    arrange();
    await expect(claimDelivery(BASE)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "[participantDelivery] claim threw",
      expect.objectContaining({ kind: "event_reminder" }),
    );
  });
});

describe("confirmDelivery", () => {
  it("sent bez szczegółu", async () => {
    db.rpc.mockResolvedValue({ data: true, error: null });
    await expect(confirmDelivery("d1", "sent")).resolves.toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("_event_delivery_confirm", {
      p_id: "d1",
      p_status: "sent",
    });
  });

  it("szczegół przycięty do 500 znaków; pusty pominięty", async () => {
    db.rpc.mockResolvedValue({ data: true, error: null });
    await confirmDelivery("d1", "skipped", "x".repeat(600));
    expect(db.rpc.mock.calls[0][1]).toEqual({
      p_id: "d1",
      p_status: "skipped",
      p_detail: "x".repeat(500),
    });
    await confirmDelivery("d1", "failed", "");
    await confirmDelivery("d1", "failed", null);
    expect(db.rpc.mock.calls[1][1]).toEqual({ p_id: "d1", p_status: "failed" });
    expect(db.rpc.mock.calls[2][1]).toEqual({ p_id: "d1", p_status: "failed" });
  });

  it("wpis nie w stanie claimed -> false", async () => {
    db.rpc.mockResolvedValue({ data: false, error: null });
    await expect(confirmDelivery("d1", "sent")).resolves.toBe(false);
  });

  it("błąd RPC -> false", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "invalid_status" } });
    await expect(confirmDelivery("d1", "sent")).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledWith("[participantDelivery] confirm failed", {
      status: "sent",
      error: "invalid_status",
    });
  });

  it.each([
    ["rzut klienta", () => (db.broken = true)],
    ["rzut nie-Error", () => db.rpc.mockRejectedValue(42)],
  ])("%s -> false", async (_label, arrange) => {
    arrange();
    await expect(confirmDelivery("d1", "failed", "deadline")).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      "[participantDelivery] confirm threw",
      expect.objectContaining({ status: "failed" }),
    );
  });
});
