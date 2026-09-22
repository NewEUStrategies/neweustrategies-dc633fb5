// Bilet z kodem QR dla każdej osoby z grupy.
//
// DLACZEGO TEN TEST ISTNIEJE. Jawny kod wejścia istnieje tylko w odpowiedzi
// `_event_issue_ticket_codes` - baza trzyma skrót. Zgubienie go między RPC
// a mailem (zły klucz, pominięty wiersz gościa, kod w zapytaniu zamiast we
// fragmencie adresu) znaczy gościa bez biletu, o czym dowiemy się przy bramce.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import { readTicketFragment } from "@/lib/events/manageToken";
import { DZIEN, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  sent: [] as TxSendInput[],
  sendResult: { ok: true } as TxSendResult,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return Promise.resolve(h.rpcResult);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (input: TxSendInput) => {
    h.sent.push(input);
    return Promise.resolve(h.sendResult);
  },
}));

const { buildTicketCodeNotice, issueAndSendTicketCodes } =
  await import("@/lib/events/ticketCodeNotify.server");

const QR_LEAD = "LeadQrToken_0123456789abcdefABCD";
const QR_GUEST = "GuestQrToken-0123456789abcdefABC";
const MANAGE_GUEST = "GuestManageToken_0123456789abcde";

const base = {
  tenant_id: "tenant-1",
  event_slug: "kongres",
  event_title_pl: "Kongres",
  event_title_en: "Congress",
  event_starts_at: relativeIso(30 * DZIEN),
  event_timezone: "Europe/Warsaw",
  event_location: "Warszawa",
  ticket_name_pl: "Grupowy",
  ticket_name_en: "Group",
};

const leadRow = {
  ...base,
  registration_id: "reg-lead",
  is_guest: false,
  qr_token: QR_LEAD,
  manage_token: null,
  email: "lead@example.com",
  first_name: "Anna",
  lang: "pl",
  lead_first_name: null,
  lead_last_name: null,
};

const guestRow = {
  ...base,
  registration_id: "reg-guest",
  is_guest: true,
  qr_token: QR_GUEST,
  manage_token: MANAGE_GUEST,
  email: "guest@example.com",
  first_name: "John",
  lang: "en",
  lead_first_name: "Anna",
  lead_last_name: "Nowak",
};

beforeEach(() => {
  h.rpcResult = { data: null, error: null };
  h.rpcCalls = [];
  h.sent = [];
  h.sendResult = { ok: true };
});

describe("buildTicketCodeNotice", () => {
  it("gość dostaje kod, klucz samoobsługi i nazwisko prowadzącego", () => {
    const notice = buildTicketCodeNotice(guestRow);
    expect(notice).not.toBeNull();
    expect(notice?.to).toBe("guest@example.com");
    expect(notice?.lang).toBe("en");
    expect(notice?.eventTitle).toBe("Congress");
    expect(notice?.details).toContainEqual({ label: "Registered by", value: "Anna Nowak" });
    expect(notice?.details).toContainEqual({ label: "Entry code", value: QR_GUEST });

    // Kod jedzie we FRAGMENCIE - nie może trafić do zapytania ani ścieżki.
    const [path, hash] = (notice?.ctaPath ?? "").split("#");
    expect(path).toBe("/events/kongres/ticket");
    expect(path).not.toContain(QR_GUEST);
    expect(readTicketFragment(`#${hash}`)).toEqual({
      qrToken: QR_GUEST,
      manageToken: MANAGE_GUEST,
    });
  });

  it("prowadzący nie dostaje wiersza „zgłoszenie od” ani nowego klucza", () => {
    const notice = buildTicketCodeNotice(leadRow);
    expect(notice?.details.map((d) => d.label)).not.toContain("Zgłoszenie od");
    expect(notice?.details).toContainEqual({ label: "Kod wejścia", value: QR_LEAD });
    const hash = (notice?.ctaPath ?? "").split("#")[1];
    expect(readTicketFragment(`#${hash}`)).toEqual({ qrToken: QR_LEAD, manageToken: null });
  });

  it("bez adresu albo kodu nie ma czego wysłać", () => {
    expect(buildTicketCodeNotice({ ...guestRow, email: "" })).toBeNull();
    expect(buildTicketCodeNotice({ ...guestRow, qr_token: null })).toBeNull();
    expect(buildTicketCodeNotice({ ...guestRow, event_slug: null })).toBeNull();
  });
});

describe("issueAndSendTicketCodes", () => {
  it("wysyła osobny mail do każdej osoby z grupy", async () => {
    h.rpcResult = { data: [leadRow, guestRow], error: null };

    const sent = await issueAndSendTicketCodes("reg-lead");

    expect(h.rpcCalls).toEqual([
      { name: "_event_issue_ticket_codes", args: { p_registration_id: "reg-lead" } },
    ]);
    expect(sent).toBe(2);
    expect(h.sent.map((m) => [m.type, m.to, m.idempotencyKey])).toEqual([
      ["event_ticket_issued", "lead@example.com", "event-ticket-code:reg-lead"],
      ["event_ticket_issued", "guest@example.com", "event-ticket-code:reg-guest"],
    ]);
    expect(h.sent[1]?.tenantId).toBe("tenant-1");
  });

  it("nic nie wydane (powtórzony webhook) - nic nie wysyła", async () => {
    h.rpcResult = { data: [], error: null };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it("błąd bazy nie rzuca i nie wysyła maili", async () => {
    h.rpcResult = { data: null, error: { message: "boom" } };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(h.sent).toHaveLength(0);
    errors.mockRestore();
  });

  it("odrzucona wysyłka nie liczy się jako wysłana", async () => {
    h.rpcResult = { data: [guestRow], error: null };
    h.sendResult = { ok: false, error: "queue_down" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(h.sent).toHaveLength(1);
    errors.mockRestore();
  });
});
