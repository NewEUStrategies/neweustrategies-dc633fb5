// Zapis zdarzeń maili ścieżek (S5). Najemcę ustala RPC z wiadomości - do RPC
// idzie wyłącznie `message_id` ze zweryfikowanego tokenu. Telemetria nigdy
// nie rzuca (piksel i przekierowanie zawsze odpowiadają), wypis dostaje
// `ok: false`, żeby trasa odpowiedziała 500 i klient ponowił.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));

import { isMailProxyUserAgent, recordJourneyMessageEvent } from "../tracking.server";

const M = "adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9";

beforeEach(() => h.rpc.mockReset());

describe("serwery pośredniczące poczty", () => {
  it("rozpoznaje proxy obrazków, przeglądarka i brak UA to człowiek", () => {
    expect(isMailProxyUserAgent("Mozilla/5.0 (via ggpht.com GoogleImageProxy)")).toBe(true);
    expect(isMailProxyUserAgent("YahooMailProxy; https://help.yahoo.com")).toBe(true);
    expect(isMailProxyUserAgent("Mozilla/5.0 (Macintosh) Safari/605")).toBe(false);
    expect(isMailProxyUserAgent(null)).toBe(false);
  });
});

describe("zapis", () => {
  it("otwarcie: indeks -1, bez adresu, flaga maszyny", async () => {
    h.rpc.mockResolvedValueOnce({ data: { recorded: true }, error: null });
    await expect(
      recordJourneyMessageEvent({ messageId: M, kind: "open", machine: true }),
    ).resolves.toEqual({ ok: true, recorded: true, known: true });
    expect(h.rpc).toHaveBeenCalledWith("journey_record_message_event", {
      p_message_id: M,
      p_kind: "open",
      p_link_index: -1,
      p_url: null,
      p_machine: true,
    });
  });

  it("kliknięcie: indeks przycięty do 0-999, adres celu", async () => {
    h.rpc.mockResolvedValue({ data: { recorded: false, reason: "duplicate" }, error: null });
    await recordJourneyMessageEvent({
      messageId: M,
      kind: "click",
      linkIndex: 5000,
      url: "https://a.test",
    });
    expect(h.rpc).toHaveBeenLastCalledWith("journey_record_message_event", {
      p_message_id: M,
      p_kind: "click",
      p_link_index: 999,
      p_url: "https://a.test",
      p_machine: false,
    });
    await expect(recordJourneyMessageEvent({ messageId: M, kind: "click" })).resolves.toEqual({
      ok: true,
      recorded: false,
      known: true,
    });
    expect(h.rpc).toHaveBeenLastCalledWith(
      "journey_record_message_event",
      expect.objectContaining({ p_link_index: 0, p_url: null }),
    );
  });

  it("nieznana wiadomość, błąd RPC i wyjątek - bez rzucania", async () => {
    h.rpc.mockResolvedValueOnce({
      data: { recorded: false, reason: "unknown_message" },
      error: null,
    });
    await expect(recordJourneyMessageEvent({ messageId: M, kind: "unsubscribe" })).resolves.toEqual(
      {
        ok: true,
        recorded: false,
        known: false,
      },
    );
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(recordJourneyMessageEvent({ messageId: M, kind: "unsubscribe" })).resolves.toEqual(
      {
        ok: false,
        error: "db down",
      },
    );
    h.rpc.mockRejectedValueOnce(new Error("network"));
    await expect(recordJourneyMessageEvent({ messageId: M, kind: "open" })).resolves.toEqual({
      ok: false,
      error: "network",
    });
    h.rpc.mockRejectedValueOnce("raw");
    await expect(recordJourneyMessageEvent({ messageId: M, kind: "open" })).resolves.toEqual({
      ok: false,
      error: "raw",
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(recordJourneyMessageEvent({ messageId: M, kind: "open" })).resolves.toEqual({
      ok: true,
      recorded: false,
      known: true,
    });
  });
});
