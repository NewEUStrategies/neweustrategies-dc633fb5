// Hooki panelu ustawień uczestnika: klucze, brama `enabled` i skutki zapisu.
//
// KLUCZE SĄ KONTRAKTEM Z MAPĄ ZDARZEŃ DOMENOWYCH. `eventInvalidationMap`
// unieważnia `["admin-event-participant-settings", eventId]` po
// `event.participant_settings.updated.v1` i całą rodzinę
// `["event-participant-options"]`. Literały przypinamy tu i w teście mapy -
// rozjazd jednego z nich znaczy „drugi administrator widzi stare ustawienia".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchParticipantSettings: vi.fn(),
  saveParticipantSettings: vi.fn(),
  fetchMessageDeliveryStats: vi.fn(),
}));
vi.mock("@/lib/events/participantSettingsApi", () => api);

import {
  participantSettingsKeys,
  useMessageDeliveryStats,
  useParticipantSettings,
  useSaveParticipantSettings,
} from "@/lib/events/useParticipantSettings";
import { participantOptionsKeys } from "@/lib/events/useEventParticipantOptions";
import { makeParticipantSettings } from "@/test/events/participantFixtures";

const EVENT = "e1111111-1111-4111-8111-111111111111";
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("participantSettingsKeys", () => {
  it("literały kluczy (kontrakt z eventInvalidationMap)", () => {
    expect(participantSettingsKeys.one(EVENT)).toEqual(["admin-event-participant-settings", EVENT]);
    expect(participantSettingsKeys.deliveries(EVENT)).toEqual([
      "admin-event-message-deliveries",
      EVENT,
    ]);
  });
});

describe("useParticipantSettings", () => {
  it("pobiera ustawienia wydarzenia", async () => {
    const settings = makeParticipantSettings({ hasRow: true });
    api.fetchParticipantSettings.mockResolvedValue(settings);
    const { result } = renderHook(() => useParticipantSettings(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(settings);
    expect(api.fetchParticipantSettings).toHaveBeenCalledWith(EVENT);
  });

  it("bez identyfikatora wydarzenia nie pyta bazy", () => {
    renderHook(() => useParticipantSettings(""), { wrapper });
    expect(api.fetchParticipantSettings).not.toHaveBeenCalled();
  });
});

describe("useSaveParticipantSettings", () => {
  it("wstawia odpowiedź do cache i unieważnia publiczne flagi", async () => {
    const saved = makeParticipantSettings({ hasRow: true, transferEnabled: false });
    api.saveParticipantSettings.mockResolvedValue(saved);
    client.setQueryData(participantOptionsKeys.one("forum-2030"), null);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveParticipantSettings(EVENT), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ event_id: EVENT, transfer_enabled: false });
    });
    expect(api.saveParticipantSettings).toHaveBeenCalledWith({
      event_id: EVENT,
      transfer_enabled: false,
    });
    expect(client.getQueryData(participantSettingsKeys.one(EVENT))).toEqual(saved);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event-participant-options"] });
    expect(client.getQueryState(participantOptionsKeys.one("forum-2030"))?.isInvalidated).toBe(
      true,
    );
  });

  it("odmowa zapisu nie czyści cache", async () => {
    const before = makeParticipantSettings();
    client.setQueryData(participantSettingsKeys.one(EVENT), before);
    api.saveParticipantSettings.mockRejectedValue(new Error("invalid_offer_hours: x"));
    const { result } = renderHook(() => useSaveParticipantSettings(EVENT), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ event_id: EVENT })).rejects.toThrow(
        "invalid_offer_hours",
      );
    });
    expect(client.getQueryData(participantSettingsKeys.one(EVENT))).toBe(before);
  });
});

describe("useMessageDeliveryStats", () => {
  it("pobiera liczniki dziennika", async () => {
    api.fetchMessageDeliveryStats.mockResolvedValue({ rows: [], lastSentAt: null });
    const { result } = renderHook(() => useMessageDeliveryStats(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchMessageDeliveryStats).toHaveBeenCalledWith(EVENT);
  });

  it("bez identyfikatora nie pyta", () => {
    renderHook(() => useMessageDeliveryStats(""), { wrapper });
    expect(api.fetchMessageDeliveryStats).not.toHaveBeenCalled();
  });
});
