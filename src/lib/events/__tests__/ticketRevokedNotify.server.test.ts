// Zawiadomienie gościa grupy o bilecie odwołanym razem z grupą.
//
// DLACZEGO TEN TEST ISTNIEJE. Od 20260926120000 odwołanie grupy unieważnia
// kod QR gościa w bazie, ale gość dowiadywał się o tym dopiero przy bramce.
// Test pilnuje, że każde zawiadomienie zajęte przez bazę kończy się mailem
// albo świadomym zamknięciem - i że rozliczenie trafia do TEGO zajęcia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";

const h = vi.hoisted(() => ({
  claim: { data: null as unknown, error: null as { message: string; code: string } | null },
  settleError: null as { message: string } | null,
  settleThrows: false,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  sent: [] as TxSendInput[],
  sendResults: [] as Array<TxSendResult | "throw">,
  onSend: null as (() => void) | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      if (name === "_event_ticket_revoked_notices_settle") {
        if (h.settleThrows) return Promise.reject(new Error("settle: sieć"));
        return Promise.resolve({ data: 1, error: h.settleError });
      }
      return Promise.resolve(h.claim);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (input: TxSendInput) => {
    h.sent.push(input);
    h.onSend?.();
    const next = h.sendResults.shift() ?? { ok: true };
    if (next === "throw") return Promise.reject(new Error("resend: 500"));
    return Promise.resolve(next);
  },
}));

const { buildTicketRevokedNotice, runPendingTicketRevocations } =
  await import("@/lib/events/ticketRevokedNotify.server");

const CLAIMED = "2099-06-15T12:00:00.000000+00:00";
const REVOKED = "2099-06-15T11:59:00.000000+00:00";

const row = {
  registration_id: "guest-1",
  tenant_id: "tenant-1",
  revoked_at: REVOKED,
  email: " gosc@example.org ",
  first_name: "Ewa",
  lang: "pl",
  lead_first_name: "Anna",
  lead_last_name: "Nowak",
  event_slug: "kongres",
  event_title_pl: "Kongres",
  event_title_en: "Congress",
  event_starts_at: "2099-07-01T16:00:00Z",
  event_timezone: "Europe/Warsaw",
  ticket_name_pl: "Standard",
  ticket_name_en: "Standard pass",
};

const settleCalls = () =>
  h.rpcCalls.filter((c) => c.name === "_event_ticket_revoked_notices_settle");

beforeEach(() => {
  h.claim = { data: { claimed_at: CLAIMED, notices: [] }, error: null };
  h.settleError = null;
  h.settleThrows = false;
  h.rpcCalls = [];
  h.sent = [];
  h.sendResults = [];
  h.onSend = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTicketRevokedNotice", () => {
  it("składa polski mail: wydarzenie, termin, bilet, kto zapisał - bez kodu wejścia", () => {
    const notice = buildTicketRevokedNotice(row);
    expect(notice).toMatchObject({
      registrationId: "guest-1",
      to: "gosc@example.org",
      lang: "pl",
      eventTitle: "Kongres",
      firstName: "Ewa",
      tenantId: "tenant-1",
      ctaPath: "/events/kongres",
      idempotencyKey: `event-ticket-revoked:guest-1:${REVOKED}`,
    });
    expect(notice?.details.map((d) => d.label)).toEqual([
      "Wydarzenie",
      "Termin",
      "Rodzaj wejściówki",
      "Zgłoszenie od",
    ]);
    expect(notice?.details.at(-1)?.value).toBe("Anna Nowak");
  });

  it("angielski mail bierze angielski tytuł i nazwę biletu", () => {
    const notice = buildTicketRevokedNotice({ ...row, lang: "en" });
    expect(notice?.eventTitle).toBe("Congress");
    expect(notice?.details.map((d) => d.value)).toContain("Standard pass");
    expect(notice?.details.at(-1)?.label).toBe("Registered by");
  });

  it("brak tytułu w języku odbiorcy - tytuł z drugiego języka, a bez obu - bez wiersza", () => {
    expect(buildTicketRevokedNotice({ ...row, lang: "en", event_title_en: null })?.eventTitle).toBe(
      "Kongres",
    );
    expect(buildTicketRevokedNotice({ ...row, event_title_pl: "  " })?.eventTitle).toBe("Congress");
    const bare = buildTicketRevokedNotice({
      ...row,
      event_title_pl: null,
      event_title_en: null,
      event_starts_at: null,
      ticket_name_pl: null,
      lead_first_name: null,
      lead_last_name: null,
      event_slug: null,
      first_name: null,
      tenant_id: null,
    });
    expect(bare).toMatchObject({
      eventTitle: "",
      details: [],
      ctaPath: "/events",
      firstName: null,
    });
    expect(bare?.tenantId).toBeNull();
  });

  it("samo nazwisko prowadzącego też mówi, czyje zgłoszenie odwołano", () => {
    const notice = buildTicketRevokedNotice({ ...row, lead_first_name: null });
    expect(notice?.details.at(-1)).toEqual({ label: "Zgłoszenie od", value: "Nowak" });
  });

  it.each(["registration_id", "email", "revoked_at"])("bez %s nie ma czego wysłać", (key) => {
    expect(buildTicketRevokedNotice({ ...row, [key]: null })).toBeNull();
    expect(buildTicketRevokedNotice({ ...row, [key]: 42 })).toBeNull();
  });
});

describe("runPendingTicketRevocations", () => {
  it("termin miniony przed startem - nic nie zajmuje", async () => {
    await expect(runPendingTicketRevocations(20, Date.now() - 1)).resolves.toEqual({
      notices: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
    });
    expect(h.rpcCalls).toEqual([]);
  });

  it.each(["PGRST202", "42883"])(
    "brak funkcji w bazie (%s) to migracja w drodze, nie awaria ticku",
    async (code) => {
      h.claim = { data: null, error: { message: "function not found", code } };
      await expect(runPendingTicketRevocations()).resolves.toEqual({
        notices: 0,
        sent: 0,
        failed: 0,
        deferred: 0,
        skipped: "migration_pending",
      });
    },
  );

  it("inny błąd zajęcia RZUCA - krok crona ma zaświecić się na czerwono", async () => {
    h.claim = { data: null, error: { message: "permission denied", code: "42501" } };
    await expect(runPendingTicketRevocations()).rejects.toThrow("permission denied");
  });

  it.each([null, [], { claimed_at: CLAIMED, notices: "x" }])(
    "odpowiedź bez listy (%j) znaczy „nic do wysłania” - bez rozliczenia",
    async (data) => {
      h.claim = { data, error: null };
      await expect(runPendingTicketRevocations(5)).resolves.toMatchObject({ notices: 0 });
      expect(settleCalls()).toEqual([]);
      expect(h.rpcCalls[0]).toEqual({
        name: "_event_ticket_revoked_notices_claim",
        args: { p_limit: 5 },
      });
    },
  );

  it("wysyła każdemu gościowi osobny mail i rozlicza partię JEDNYM wywołaniem", async () => {
    h.claim = {
      data: {
        claimed_at: CLAIMED,
        notices: [row, { ...row, registration_id: "guest-2" }, "śmieć", { email: "x" }],
      },
      error: null,
    };
    await expect(runPendingTicketRevocations()).resolves.toEqual({
      notices: 2,
      sent: 2,
      failed: 0,
      deferred: 0,
    });
    expect(h.rpcCalls[0].args).toEqual({ p_limit: 20 });
    expect(h.sent.map((s) => [s.type, s.idempotencyKey, s.tenantId])).toEqual([
      ["event_ticket_revoked", `event-ticket-revoked:guest-1:${REVOKED}`, "tenant-1"],
      ["event_ticket_revoked", `event-ticket-revoked:guest-2:${REVOKED}`, "tenant-1"],
    ]);
    expect(settleCalls()).toEqual([
      {
        name: "_event_ticket_revoked_notices_settle",
        args: { p_claimed_at: CLAIMED, p_done: ["guest-1", "guest-2"], p_retry: [] },
      },
    ]);
  });

  it("pominięcie (lista wykluczeń, pusty adres, duplikat) i brak adresu zamykają bez liczenia wysyłki", async () => {
    h.claim = {
      data: {
        claimed_at: CLAIMED,
        notices: [
          { ...row, registration_id: "a" },
          { ...row, registration_id: "b" },
          { ...row, registration_id: "c" },
          { ...row, registration_id: "d", email: null },
        ],
      },
      error: null,
    };
    h.sendResults = [
      { ok: false, skipped: "suppressed", reason: "suppressed:complaint" },
      { ok: false, skipped: "no_recipient" },
      { ok: true, skipped: "duplicate" },
    ];
    await expect(runPendingTicketRevocations()).resolves.toEqual({
      notices: 4,
      sent: 0,
      failed: 0,
      deferred: 0,
    });
    expect(h.sent).toHaveLength(3);
    expect(settleCalls()[0].args).toEqual({
      p_claimed_at: CLAIMED,
      p_done: ["a", "b", "c", "d"],
      p_retry: [],
    });
  });

  it("nieudana wysyłka i wyjątek wracają do kolejki od razu", async () => {
    h.claim = {
      data: {
        claimed_at: CLAIMED,
        notices: [
          { ...row, registration_id: "a" },
          { ...row, registration_id: "b" },
          { ...row, registration_id: "c" },
        ],
      },
      error: null,
    };
    h.sendResults = [{ ok: false, error: "queue down" }, { ok: false }, "throw"];
    await expect(runPendingTicketRevocations()).resolves.toEqual({
      notices: 3,
      sent: 0,
      failed: 3,
      deferred: 0,
    });
    expect(settleCalls()[0].args).toEqual({
      p_claimed_at: CLAIMED,
      p_done: [],
      p_retry: ["a", "b", "c"],
    });
    expect(console.error).toHaveBeenCalledTimes(3);
  });

  it("termin w trakcie partii - reszta zwolniona do następnego ticku", async () => {
    h.claim = {
      data: {
        claimed_at: CLAIMED,
        notices: [
          { ...row, registration_id: "a" },
          { ...row, registration_id: "b" },
        ],
      },
      error: null,
    };
    const deadline = Date.now() + 60_000;
    const now = vi.spyOn(Date, "now");
    h.onSend = () => {
      now.mockReturnValue(deadline + 1);
    };
    await expect(runPendingTicketRevocations(20, deadline)).resolves.toEqual({
      notices: 2,
      sent: 1,
      failed: 0,
      deferred: 1,
    });
    expect(settleCalls()[0].args).toEqual({ p_claimed_at: CLAIMED, p_done: ["a"], p_retry: ["b"] });
  });

  it("bez terminu od wołającego partia dostaje własny, 10-sekundowy budżet", async () => {
    h.claim = {
      data: {
        claimed_at: CLAIMED,
        notices: [
          { ...row, registration_id: "a" },
          { ...row, registration_id: "b" },
        ],
      },
      error: null,
    };
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    h.onSend = () => {
      now.mockReturnValue(start + 10_001);
    };
    await expect(runPendingTicketRevocations()).resolves.toMatchObject({ sent: 1, deferred: 1 });
  });

  it("bez chwili zajęcia nie ma czego rozliczyć - dzierżawa wygaśnie sama", async () => {
    h.claim = { data: { notices: [row] }, error: null };
    await expect(runPendingTicketRevocations()).resolves.toMatchObject({ notices: 1, sent: 1 });
    expect(settleCalls()).toEqual([]);
  });

  it("błąd i wyjątek rozliczenia nie psują wyniku partii", async () => {
    h.claim = { data: { claimed_at: CLAIMED, notices: [row] }, error: null };
    h.settleError = { message: "timeout" };
    await expect(runPendingTicketRevocations()).resolves.toMatchObject({ sent: 1 });
    h.settleThrows = true;
    await expect(runPendingTicketRevocations()).resolves.toMatchObject({ sent: 1 });
    expect(console.error).toHaveBeenCalledWith("[events] ticket revoked settle failed", "timeout");
  });
});
