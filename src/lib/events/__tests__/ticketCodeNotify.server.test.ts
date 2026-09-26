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
  /** Wydanie rzuca (np. sieć padła przed odpowiedzią PostgREST). */
  rpcThrows: false,
  pending: [] as unknown,
  pendingError: null as { message: string } | null,
  /** Odpowiedź potwierdzenia: błąd bazy albo wyjątek transportu. */
  confirmError: null as { message: string } | null,
  confirmThrows: false,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  sent: [] as TxSendInput[],
  sendResult: { ok: true } as TxSendResult,
  sendThrows: false,
  /** Woła się przy każdym wydaniu - test terminu przesuwa w nim zegar. */
  onIssue: null as (() => void) | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      if (name === "_event_ticket_code_confirm") {
        if (h.confirmThrows) return Promise.reject(new Error("confirm: sieć"));
        return Promise.resolve({ data: h.confirmError === null, error: h.confirmError });
      }
      if (name === "_event_ticket_codes_pending") {
        return Promise.resolve({ data: h.pending, error: h.pendingError });
      }
      h.onIssue?.();
      if (h.rpcThrows) return Promise.reject(new Error("issue: sieć"));
      return Promise.resolve(h.rpcResult);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (input: TxSendInput) => {
    h.sent.push(input);
    if (h.sendThrows) return Promise.reject(new Error("resend: 500"));
    return Promise.resolve(h.sendResult);
  },
}));

const { buildTicketCodeNotice, issueAndSendTicketCodes, runPendingTicketCodes } =
  await import("@/lib/events/ticketCodeNotify.server");

const QR_LEAD = "LeadQrToken_0123456789abcdefABCD";
const QR_GUEST = "GuestQrToken-0123456789abcdefABC";
const MANAGE_GUEST = "GuestManageToken_0123456789abcde";

const CLAIM = relativeIso(-60_000);

const base = {
  tenant_id: "tenant-1",
  claimed_at: CLAIM,
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
  h.onIssue = null;
  h.rpcResult = { data: null, error: null };
  h.rpcThrows = false;
  h.rpcCalls = [];
  h.pending = [];
  h.pendingError = null;
  h.confirmError = null;
  h.confirmThrows = false;
  h.sent = [];
  h.sendResult = { ok: true };
  h.sendThrows = false;
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
    expect(buildTicketCodeNotice({ ...guestRow, registration_id: "  " })).toBeNull();
  });

  it("tytuł z drugiego języka, gdy brakuje własnego - i pusty, gdy brakuje obu", () => {
    // Mail w języku odbiorcy, ale bez tytułu w tym języku lepiej podać tytuł
    // obcy niż wysłać wiersz „Wydarzenie” bez treści.
    expect(buildTicketCodeNotice({ ...guestRow, event_title_en: null })?.eventTitle).toBe(
      "Kongres",
    );
    expect(buildTicketCodeNotice({ ...leadRow, event_title_pl: " " })?.eventTitle).toBe("Congress");
    const bare = buildTicketCodeNotice({
      ...leadRow,
      event_title_pl: null,
      event_title_en: null,
      event_starts_at: null,
      event_location: null,
      ticket_name_pl: null,
    });
    expect(bare?.eventTitle).toBe("");
    // Bez tytułu, terminu, miejsca i nazwy biletu zostaje wyłącznie kod.
    expect(bare?.details).toEqual([{ label: "Kod wejścia", value: QR_LEAD }]);
  });

  it("gość bez danych prowadzącego nie dostaje pustego wiersza „zgłoszenie od”", () => {
    const notice = buildTicketCodeNotice({
      ...guestRow,
      lead_first_name: null,
      lead_last_name: null,
    });
    expect(notice?.details.map((d) => d.label)).not.toContain("Registered by");
  });
});

/**
 * Wywołania potwierdzenia: [zgłoszenie, wysłane?] - i trzeci element, gdy serwer
 * podał `p_undeliverable`. Dwuelementowy wpis DOWODZI, że klucza nie było:
 * wysyłka i ponowienie muszą iść trójargumentowym wariantem, który zna też baza
 * sprzed migracji 20260926100000.
 */
const confirms = () =>
  h.rpcCalls
    .filter((c) => c.name === "_event_ticket_code_confirm")
    .map((c) => {
      const a = c.args as {
        p_registration_id: string;
        p_claimed_at: string;
        p_sent: boolean;
        p_undeliverable?: boolean;
      };
      expect(a.p_claimed_at).toBe(CLAIM);
      return "p_undeliverable" in a
        ? [a.p_registration_id, a.p_sent, a.p_undeliverable]
        : [a.p_registration_id, a.p_sent];
    });

describe("issueAndSendTicketCodes", () => {
  it("wysyła osobny mail do każdej osoby i DOPIERO WTEDY odnotowuje wysyłkę", async () => {
    h.rpcResult = { data: [leadRow, guestRow], error: null };

    const sent = await issueAndSendTicketCodes("reg-lead");

    expect(h.rpcCalls[0]).toEqual({
      name: "_event_issue_ticket_codes",
      args: { p_registration_id: "reg-lead" },
    });
    expect(sent).toBe(2);
    // Klucz niesie zajęcie - ponowienie z nowym kodem nie jest „duplikatem".
    expect(h.sent.map((m) => [m.type, m.to, m.idempotencyKey])).toEqual([
      ["event_ticket_issued", "lead@example.com", `event-ticket-code:reg-lead:${CLAIM}`],
      ["event_ticket_issued", "guest@example.com", `event-ticket-code:reg-guest:${CLAIM}`],
    ]);
    expect(h.sent[1]?.tenantId).toBe("tenant-1");
    expect(confirms()).toEqual([
      ["reg-lead", true],
      ["reg-guest", true],
    ]);
  });

  it("nic nie wydane (powtórzony webhook) - nic nie wysyła i nic nie potwierdza", async () => {
    h.rpcResult = { data: [], error: null };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(confirms()).toEqual([]);
  });

  it("błąd bazy nie rzuca i nie wysyła maili", async () => {
    h.rpcResult = { data: null, error: { message: "boom" } };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(h.sent).toHaveLength(0);
    errors.mockRestore();
  });

  it("nieudana wysyłka ZWALNIA zgłoszenie - kolejna próba wyda nowy kod", async () => {
    h.rpcResult = { data: [guestRow], error: null };
    h.sendResult = { ok: false, error: "queue_down" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(h.sent).toHaveLength(1);
    expect(confirms()).toEqual([["reg-guest", false]]);
    errors.mockRestore();
  });

  it("adres wypisany zamyka zgłoszenie - bez rotowania kodu przy każdym ticku", async () => {
    // KSZTAŁT Z `sendTxEmail`: lista wykluczeń to `ok: false` z powodem, a nie
    // sukces. Atrapa `{ ok: true, skipped: "suppressed" }` (sprzed poprawki)
    // zieleniła się, choć produkcja zwalniała zgłoszenie do ponowienia.
    h.rpcResult = { data: [guestRow, { ...leadRow, email: "" }], error: null };
    h.sendResult = { ok: false, skipped: "suppressed", reason: "suppressed:hard_bounce" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    // Zamknięte ZE znacznikiem niedoręczenia - panel nie pokaże „Bilet wysłany”.
    expect(confirms()).toEqual([
      ["reg-guest", true, true],
      ["reg-lead", true, true],
    ]);
    // Wypisany adres to stan, nie awaria - log błędów zostaje czysty.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("pusty adresat po stronie poczty też zamyka zgłoszenie", async () => {
    h.rpcResult = { data: [guestRow], error: null };
    h.sendResult = { ok: false, skipped: "no_recipient" };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(confirms()).toEqual([["reg-guest", true, true]]);
  });

  it("duplikat w dzienniku poczty liczy się jako wysłany", async () => {
    h.rpcResult = { data: [guestRow], error: null };
    h.sendResult = { ok: true, skipped: "duplicate" };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(1);
    expect(confirms()).toEqual([["reg-guest", true]]);
  });

  it("awaria dostawcy z powodem zwalnia zgłoszenie do ponowienia", async () => {
    h.rpcResult = { data: [guestRow], error: null };
    h.sendResult = { ok: false, reason: "resend:429" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(confirms()).toEqual([["reg-guest", false]]);
    expect(errors).toHaveBeenCalledWith(
      "[events] ticket code email failed",
      "reg-guest",
      "resend:429",
    );
    errors.mockRestore();
  });

  it("wyjątek wysyłki nie przerywa grupy - każde zgłoszenie wraca do ponowienia", async () => {
    h.rpcResult = { data: [guestRow, leadRow], error: null };
    h.sendThrows = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    expect(confirms()).toEqual([
      ["reg-guest", false],
      ["reg-lead", false],
    ]);
    errors.mockRestore();
  });

  it("wyjątek wydania (transport) nie rzuca dalej", async () => {
    h.rpcThrows = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(issueAndSendTicketCodes("reg-lead")).resolves.toBe(0);
    expect(h.sent).toHaveLength(0);
    errors.mockRestore();
  });

  it("odpowiedź, która nie jest listą wierszy, nie wysyła nic", async () => {
    h.rpcResult = { data: { registration_id: "reg-lead" }, error: null };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(0);
    h.rpcResult = { data: [null, "tekst", ["zagnieżdżona"], guestRow], error: null };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(1);
    expect(h.sent.map((m) => m.to)).toEqual(["guest@example.com"]);
  });

  it("wiersz bez zajęcia wysyła mail, ale nie ma czego potwierdzać", async () => {
    h.rpcResult = { data: [{ ...guestRow, claimed_at: null }], error: null };
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(1);
    // Bez stempla zajęcia klucz nie ma czym się różnić - zostaje pusty ogon.
    expect(h.sent[0]?.idempotencyKey).toBe("event-ticket-code:reg-guest:");
    expect(h.rpcCalls.map((c) => c.name)).not.toContain("_event_ticket_code_confirm");
  });

  it("błąd albo wyjątek potwierdzenia nie przerywa wysyłki reszcie grupy", async () => {
    h.rpcResult = { data: [leadRow, guestRow], error: null };
    h.confirmError = { message: "deadlock" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(2);
    expect(errors).toHaveBeenCalledWith(
      "[events] ticket code confirm failed",
      "reg-guest",
      "deadlock",
    );

    h.confirmError = null;
    h.confirmThrows = true;
    expect(await issueAndSendTicketCodes("reg-lead")).toBe(2);
    expect(errors).toHaveBeenCalledWith(
      "[events] ticket code confirm failed",
      "reg-guest",
      expect.any(Error),
    );
    errors.mockRestore();
  });
});

describe("runPendingTicketCodes", () => {
  it("domyślna partia to 50, śmieci z kolejki są pomijane", async () => {
    h.pending = ["reg-a", 7, null];
    h.rpcResult = { data: [], error: null };
    await expect(runPendingTicketCodes()).resolves.toEqual({
      registrations: 1,
      sent: 0,
      deferred: 0,
    });
    expect(h.rpcCalls[0]).toEqual({ name: "_event_ticket_codes_pending", args: { p_limit: 50 } });
  });

  it("odpowiedź bez listy znaczy „nic do wydania”", async () => {
    h.pending = null;
    await expect(runPendingTicketCodes(5)).resolves.toEqual({
      registrations: 0,
      sent: 0,
      deferred: 0,
    });
  });

  it("błąd kolejki RZUCA - krok crona ma zaświecić się na czerwono", async () => {
    h.pendingError = { message: "function _event_ticket_codes_pending does not exist" };
    await expect(runPendingTicketCodes(5)).rejects.toThrow(
      "function _event_ticket_codes_pending does not exist",
    );
  });

  it("wydaje bilety każdemu zgłoszeniu czekającemu w bazie", async () => {
    h.pending = ["reg-a", "reg-b"];
    h.rpcResult = { data: [leadRow], error: null };

    await expect(runPendingTicketCodes(25)).resolves.toEqual({
      registrations: 2,
      sent: 2,
      deferred: 0,
    });
    expect(h.rpcCalls[0]).toEqual({ name: "_event_ticket_codes_pending", args: { p_limit: 25 } });
    expect(
      h.rpcCalls
        .filter((c) => c.name === "_event_issue_ticket_codes")
        .map((c) => (c.args as { p_registration_id: string }).p_registration_id),
    ).toEqual(["reg-a", "reg-b"]);
  });

  // TERMIN: jedno zgloszenie bywa grupa do 50 osob, wiec partia bez terminu
  // potrafila przebic budzet ticku i limit CPU workera.
  it("termin sprawdzany PRZED kolejnym zgłoszeniem - reszta czeka na następny tick", async () => {
    h.pending = ["reg-a", "reg-b", "reg-c"];
    h.rpcResult = { data: [leadRow], error: null };
    const deadline = Date.now() + 60_000;
    const now = vi.spyOn(Date, "now");
    // Pierwsze wydanie "trwa" dluzej niz termin.
    h.onIssue = () => {
      now.mockReturnValue(deadline + 1);
    };
    try {
      await expect(runPendingTicketCodes(20, deadline)).resolves.toEqual({
        registrations: 1,
        sent: 1,
        deferred: 2,
      });
    } finally {
      now.mockRestore();
    }
    expect(
      h.rpcCalls
        .filter((c) => c.name === "_event_issue_ticket_codes")
        .map((c) => (c.args as { p_registration_id: string }).p_registration_id),
    ).toEqual(["reg-a"]);
  });

  it("termin miniony przed startem - nic nie wydaje, cała kolejka odłożona", async () => {
    h.pending = ["reg-a", "reg-b"];
    await expect(runPendingTicketCodes(20, Date.now() - 1)).resolves.toEqual({
      registrations: 0,
      sent: 0,
      deferred: 2,
    });
    expect(h.rpcCalls.filter((c) => c.name === "_event_issue_ticket_codes")).toHaveLength(0);
  });

  it("bez terminu od wołającego partia dostaje własny, 15-sekundowy budżet", async () => {
    // `community-cron` nie podaje terminu - bez domyślnego budżetu jego partia
    // 50 zgłoszeń nie miałaby żadnej granicy.
    h.pending = ["reg-a", "reg-b"];
    h.rpcResult = { data: [leadRow], error: null };
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    h.onIssue = () => {
      now.mockReturnValue(start + 15_001);
    };
    try {
      await expect(runPendingTicketCodes()).resolves.toEqual({
        registrations: 1,
        sent: 1,
        deferred: 1,
      });
    } finally {
      now.mockRestore();
    }
  });
});
