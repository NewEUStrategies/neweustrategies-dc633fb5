// Panel ustawień uczestnika - kontrakt z RPC, bez sieci.
//
// STAWKI: (1) nazwy RPC i argumentów (`p_event_id` vs `p_payload`) - pomyłka
// daje błąd PostgREST dopiero na produkcji; (2) nieczytelna odpowiedź NIE może
// udawać wartości domyślnych, bo formularz z propozycją nadpisałby przy
// zapisie prawdziwy wiersz; (3) liczniki dziennika bez wierszy o nieznanym
// rodzaju/kanale i bez ujemnych liczb.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  fetchMessageDeliveryStats,
  fetchParticipantSettings,
  saveParticipantSettings,
} from "@/lib/events/participantSettingsApi";

const EVENT = "e1111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
});

describe("fetchParticipantSettings", () => {
  it("woła get z p_event_id i parsuje odpowiedź", async () => {
    rpc.mockResolvedValue({
      data: { event_id: EVENT, has_row: true, refund_mode: "none" },
      error: null,
    });
    const settings = await fetchParticipantSettings(EVENT);
    expect(rpc).toHaveBeenCalledWith("admin_event_participant_settings_get", {
      p_event_id: EVENT,
    });
    expect(settings.eventId).toBe(EVENT);
    expect(settings.hasRow).toBe(true);
    expect(settings.refundMode).toBe("none");
  });

  it("przenosi błąd RPC (forbidden/not_found) do wołającego", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("forbidden: admin only") });
    await expect(fetchParticipantSettings(EVENT)).rejects.toThrow("forbidden");
  });

  it("nieczytelna odpowiedź to błąd, nie wartości domyślne", async () => {
    rpc.mockResolvedValue({ data: { has_row: true }, error: null });
    await expect(fetchParticipantSettings(EVENT)).rejects.toThrow(/^unknown:/);
  });
});

describe("saveParticipantSettings", () => {
  it("wysyła ładunek w p_payload i zwraca nowy stan", async () => {
    rpc.mockResolvedValue({ data: { event_id: EVENT, has_row: true }, error: null });
    const payload = { event_id: EVENT, transfer_enabled: false };
    const saved = await saveParticipantSettings(payload);
    expect(rpc).toHaveBeenCalledWith("admin_event_participant_settings_save", {
      p_payload: payload,
    });
    expect(saved.hasRow).toBe(true);
  });

  it("przenosi kod walidacji bazy", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("invalid_offer_hours: 2..168") });
    await expect(saveParticipantSettings({ event_id: EVENT })).rejects.toThrow(
      "invalid_offer_hours",
    );
  });

  it("nieczytelna odpowiedź zapisu to błąd", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(saveParticipantSettings({ event_id: EVENT })).rejects.toThrow(/^unknown:/);
  });
});

describe("fetchMessageDeliveryStats", () => {
  it("mapuje wiersze i ostatnie wysłanie", async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [
          { kind: "event_reminder", channel: "email", claimed: 1, sent: 5, skipped: 2, failed: 0 },
          { kind: "survey_invite", channel: "inapp", claimed: 0, sent: 3, skipped: 0, failed: 1 },
        ],
        last_sent_at: "2030-06-09T08:00:00Z",
      },
      error: null,
    });
    await expect(fetchMessageDeliveryStats(EVENT)).resolves.toEqual({
      rows: [
        { kind: "event_reminder", channel: "email", claimed: 1, sent: 5, skipped: 2, failed: 0 },
        { kind: "survey_invite", channel: "inapp", claimed: 0, sent: 3, skipped: 0, failed: 1 },
      ],
      lastSentAt: "2030-06-09T08:00:00Z",
    });
    expect(rpc).toHaveBeenCalledWith("admin_event_message_delivery_stats", { p_event_id: EVENT });
  });

  it("pomija wiersze nieznanego rodzaju/kanału i zeruje złe liczniki", async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [
          null,
          "x",
          { kind: "unknown_kind", channel: "email", sent: 1 },
          { kind: "event_reminder", channel: "fax", sent: 1 },
          { kind: "waitlist_offer", channel: "sms", claimed: -1, sent: 1.5, skipped: "2" },
        ],
        last_sent_at: "",
      },
      error: null,
    });
    await expect(fetchMessageDeliveryStats(EVENT)).resolves.toEqual({
      rows: [
        { kind: "waitlist_offer", channel: "sms", claimed: 0, sent: 0, skipped: 0, failed: 0 },
      ],
      lastSentAt: null,
    });
  });

  it("pusta albo nieczytelna odpowiedź = brak wierszy", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchMessageDeliveryStats(EVENT)).resolves.toEqual({ rows: [], lastSentAt: null });
    rpc.mockResolvedValue({ data: { rows: "x", last_sent_at: 5 }, error: null });
    await expect(fetchMessageDeliveryStats(EVENT)).resolves.toEqual({ rows: [], lastSentAt: null });
  });

  it("przenosi błąd RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("forbidden: admin only") });
    await expect(fetchMessageDeliveryStats(EVENT)).rejects.toThrow("forbidden");
  });
});
