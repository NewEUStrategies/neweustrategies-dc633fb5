// Zadanie `runEventParticipantReminders` (F2): porcje rezerwacji, wysyłka
// e-mail/SMS i zamknięcie partii jednym RPC.
//
// STAWKI: (1) wynik każdej wysyłki trafia do dziennika - zarezerwowany wiersz
// bez zamknięcia czekałby 15 minut; (2) termin ticku jest sprawdzany PRZED
// porcją, nigdy w jej środku; (3) blokada listy wykluczeń to `skipped`, nie
// błąd do ponowienia; (4) przycisk prowadzi na domenę najemcy; (5) SMS jest
// rezerwowany tylko wtedy, gdy platforma ma operatora; (6) wyjątek jednej
// wysyłki nie zabiera reszty porcji.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/integrations/supabase/types";

const mail = vi.hoisted(() => ({ sendTxEmail: vi.fn() }));
vi.mock("@/lib/email/transactional.server", () => mail);
const origin = vi.hoisted(() => ({ tenantPublicUrl: vi.fn() }));
vi.mock("@/lib/events/tenantPublicOrigin.server", () => origin);
const notify = vi.hoisted(() => ({
  participantSmsEnabled: vi.fn(() => false),
  sendParticipantSms: vi.fn(),
}));
vi.mock("@/lib/events/participantNotify.server", () => notify);

import {
  REMINDER_CLAIM_CHUNK,
  REMINDER_RUN_LIMIT,
  runEventParticipantReminders,
} from "@/lib/events/jobs/reminderJob.server";

const TENANT = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

function row(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delivery_id: id(n),
    kind: "event_reminder",
    channel: "email",
    dedupe_key: `er:${id(n)}:email:60:1907164800`,
    tenant_id: TENANT,
    event_id: EVENT,
    registration_id: id(n),
    session_id: null,
    starts_at: "2030-06-10T16:00:00Z",
    lang: "pl",
    email: `osoba${n}@example.org`,
    phone: null,
    first_name: "Anna",
    event_slug: "kongres",
    event_title_pl: "Kongres",
    event_title_en: "Congress",
    event_timezone: "Europe/Warsaw",
    event_location: "Sala A",
    ...overrides,
  };
}

interface Harness {
  admin: SupabaseClient<Database>;
  rpc: ReturnType<typeof vi.fn>;
  /** Kolejne odpowiedzi `_event_reminders_claim`. */
  claims: unknown[][];
  confirmed: unknown[];
}

function harness(
  claims: unknown[][],
  opts: { claimError?: string; confirmError?: string } = {},
): Harness {
  const h: Harness = { admin: null as never, rpc: vi.fn(), claims: [...claims], confirmed: [] };
  h.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "_event_reminders_claim") {
      if (opts.claimError) return { data: null, error: { message: opts.claimError } };
      return { data: h.claims.shift() ?? [], error: null };
    }
    if (fn === "_event_delivery_confirm_many") {
      h.confirmed.push(args.p_items);
      if (opts.confirmError) return { data: null, error: { message: opts.confirmError } };
      return { data: (args.p_items as unknown[]).length, error: null };
    }
    throw new Error(`nieoczekiwane RPC ${fn}`);
  });
  h.admin = { rpc: h.rpc } as unknown as SupabaseClient<Database>;
  return h;
}

const farFuture = () => Date.now() + 60_000;

beforeEach(() => {
  // reset, nie clear: kolejki `mockResolvedValueOnce` nie mogą przeciekać między testami.
  vi.resetAllMocks();
  notify.participantSmsEnabled.mockReturnValue(false);
  mail.sendTxEmail.mockResolvedValue({ ok: true });
  origin.tenantPublicUrl.mockImplementation(
    async (tenant: string, path: string, lang: string) =>
      `https://${tenant}.example${lang === "en" ? "/en" : ""}${path}`,
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runEventParticipantReminders", () => {
  it("nic należnego: jedna rezerwacja, zero wysyłek i zamknięć", async () => {
    const h = harness([[]]);
    await expect(
      runEventParticipantReminders(h.admin, { deadlineAt: farFuture() }),
    ).resolves.toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0, note: "reminders" });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("_event_reminders_claim", {
      p_limit: REMINDER_CLAIM_CHUNK,
      p_sms: false,
    });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("e-mail: szablon event_reminder, przycisk na domenie najemcy, wynik w dzienniku", async () => {
    const h = harness([[row(1)]]);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
    expect(result).toEqual({ claimed: 1, sent: 1, skipped: 0, failed: 0, note: "reminders" });
    expect(origin.tenantPublicUrl).toHaveBeenCalledWith(TENANT, "/events/kongres", "pl");
    expect(mail.sendTxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event_reminder",
        to: "osoba1@example.org",
        lang: "pl",
        subjectName: "Kongres",
        ctaUrl: `https://${TENANT}.example/events/kongres`,
        tenantId: TENANT,
        idempotencyKey: `event-reminder:er:${id(1)}:email:60:1907164800`,
      }),
    );
    expect(h.confirmed).toEqual([[{ id: id(1), status: "sent" }]]);
  });

  it("przypomnienie o sesji: szablon sesji i link do planu w języku odbiorcy", async () => {
    const session = id(77);
    const h = harness([
      [
        row(1, {
          kind: "session_reminder",
          session_id: session,
          session_title_en: "Opening panel",
          lang: "en",
        }),
      ],
    ]);
    await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
    expect(origin.tenantPublicUrl).toHaveBeenCalledWith(
      TENANT,
      `/events/kongres/me?tab=schedule#event-session-${session}`,
      "en",
    );
    expect(mail.sendTxEmail).toHaveBeenCalledWith(
      expect.objectContaining({ type: "event_session_reminder", subjectName: "Opening panel" }),
    );
  });

  it("wykluczony adres i brak odbiorcy to skipped, błąd kolejki to failed, duplikat to sent", async () => {
    // Wysyłki biegną równolegle - odpowiedź zależy od adresu, nie od kolejności.
    const byRecipient: Record<string, unknown> = {
      "osoba1@example.org": { ok: false, skipped: "suppressed", reason: "suppressed:bounce" },
      "osoba2@example.org": { ok: false, error: "queue down" },
      "osoba3@example.org": { ok: true, skipped: "duplicate" },
    };
    mail.sendTxEmail.mockImplementation(async (input: { to: string }) => byRecipient[input.to]);
    const h = harness([[row(1), row(2), row(3), row(4, { email: null })]]);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
    expect(result).toEqual({ claimed: 4, sent: 1, skipped: 2, failed: 1, note: "reminders" });
    expect(h.confirmed).toEqual([
      [
        { id: id(1), status: "skipped", detail: "suppressed" },
        { id: id(2), status: "failed", detail: "email_send_failed" },
        { id: id(3), status: "sent", detail: "duplicate" },
        { id: id(4), status: "skipped", detail: "no_recipient" },
      ],
    ]);
    // Szczegół bez danych osobowych: ani adresu, ani treści błędu kolejki.
    expect(JSON.stringify(h.confirmed)).not.toContain("example.org");
    expect(JSON.stringify(h.confirmed)).not.toContain("queue down");
  });

  it("wyjątek jednej wysyłki nie zabiera reszty porcji; log bez adresu", async () => {
    mail.sendTxEmail.mockImplementation(async (input: { to: string }) => {
      if (input.to === "osoba1@example.org") throw new Error("render exploded");
      return { ok: true };
    });
    const h = harness([[row(1), row(2)]]);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
    expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    expect(h.confirmed).toEqual([
      [
        { id: id(1), status: "failed", detail: "exception" },
        { id: id(2), status: "sent" },
      ],
    ]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("example.org");
  });

  it("uszkodzony zarezerwowany wiersz jest zamykany jako skipped/invalid_row", async () => {
    const h = harness([[row(1, { kind: "nieznany" }), row(2)]]);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
    expect(result).toMatchObject({ claimed: 2, sent: 1, skipped: 1 });
    expect(h.confirmed[0]).toEqual([
      { id: id(2), status: "sent" },
      { id: id(1), status: "skipped", detail: "invalid_row" },
    ]);
  });

  it("pełna porcja -> kolejna porcja; krótsza porcja kończy przebieg", async () => {
    const first = Array.from({ length: REMINDER_CLAIM_CHUNK }, (_, i) => row(i + 1));
    const h = harness([first, [row(100)]]);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
    expect(result).toMatchObject({
      claimed: REMINDER_CLAIM_CHUNK + 1,
      sent: REMINDER_CLAIM_CHUNK + 1,
    });
    expect(h.rpc.mock.calls.filter(([fn]) => fn === "_event_reminders_claim")).toHaveLength(2);
    expect(h.confirmed).toHaveLength(2);
  });

  it("limit wołającego przycina porcję i kończy przebieg z note=limit", async () => {
    const h = harness([[row(1), row(2), row(3)]]);
    const result = await runEventParticipantReminders(h.admin, {
      deadlineAt: farFuture(),
      limit: 3,
    });
    expect(h.rpc).toHaveBeenCalledWith("_event_reminders_claim", { p_limit: 3, p_sms: false });
    expect(result).toMatchObject({ claimed: 3, note: "limit" });
  });

  it("limit wołającego nie przekracza sufitu zadania", async () => {
    const h = harness([[]]);
    await runEventParticipantReminders(h.admin, { deadlineAt: farFuture(), limit: 10_000 });
    expect(h.rpc).toHaveBeenCalledWith("_event_reminders_claim", {
      p_limit: Math.min(REMINDER_CLAIM_CHUNK, REMINDER_RUN_LIMIT),
      p_sms: false,
    });
  });

  it("limit spoza liczb skończonych -> sufit zadania, nie cichy przebieg", async () => {
    const h = harness([[]]);
    await runEventParticipantReminders(h.admin, { deadlineAt: farFuture(), limit: Number.NaN });
    expect(h.rpc).toHaveBeenCalledWith("_event_reminders_claim", {
      p_limit: REMINDER_CLAIM_CHUNK,
      p_sms: false,
    });
  });

  it("termin minął przed pierwszą porcją: zero RPC, note=deadline", async () => {
    const h = harness([[row(1)]]);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: Date.now() - 1 });
    expect(result).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0, note: "deadline" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("termin mija po porcji: porcja domknięta, kolejnej nie ma", async () => {
    const deadline = Date.now() + 60_000;
    const first = Array.from({ length: REMINDER_CLAIM_CHUNK }, (_, i) => row(i + 1));
    const h = harness([first, [row(100)]]);
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(deadline - 1).mockReturnValue(deadline + 1);
    const result = await runEventParticipantReminders(h.admin, { deadlineAt: deadline });
    expect(result).toMatchObject({ claimed: REMINDER_CLAIM_CHUNK, note: "deadline" });
    expect(h.confirmed).toHaveLength(1);
  });

  it("awaria rezerwacji jest zgłaszana harmonogramowi (wyjątek)", async () => {
    const h = harness([], { claimError: "permission denied" });
    await expect(
      runEventParticipantReminders(h.admin, { deadlineAt: farFuture() }),
    ).rejects.toThrow("permission denied");
  });

  it("awaria zamknięcia jest logowana, nie wywraca przebiegu", async () => {
    const h = harness([[row(1)]], { confirmError: "timeout" });
    await expect(
      runEventParticipantReminders(h.admin, { deadlineAt: farFuture() }),
    ).resolves.toMatchObject({ claimed: 1, sent: 1 });
    expect(console.warn).toHaveBeenCalledWith("[eventReminders] confirm failed", {
      error: "timeout",
    });
  });

  describe("SMS", () => {
    const smsRow = (n: number, overrides: Record<string, unknown> = {}) =>
      row(n, { channel: "sms", phone: "600 100 200", email: null, ...overrides });

    it("operator dostępny -> rezerwacja z p_sms=true i wysyłka na numer E.164", async () => {
      notify.participantSmsEnabled.mockReturnValue(true);
      notify.sendParticipantSms.mockResolvedValue({ ok: true });
      const h = harness([[smsRow(1)]]);
      const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
      expect(h.rpc).toHaveBeenCalledWith("_event_reminders_claim", {
        p_limit: REMINDER_CLAIM_CHUNK,
        p_sms: true,
      });
      expect(notify.sendParticipantSms).toHaveBeenCalledWith({
        tenantId: TENANT,
        to: "+48600100200",
        body: expect.stringContaining("NES przypomina: Kongres"),
        idempotencyKey: `event-reminder:er:${id(1)}:email:60:1907164800`,
      });
      expect(result).toMatchObject({ sent: 1 });
      expect(mail.sendTxEmail).not.toHaveBeenCalled();
    });

    it("budżet, wyłączony operator i zły numer to skipped; duplikat to sent; błąd to failed", async () => {
      notify.participantSmsEnabled.mockReturnValue(true);
      const byDelivery: Record<string, unknown> = {
        [id(1)]: { ok: false, skipped: "budget" },
        [id(2)]: { ok: true, skipped: "disabled" },
        [id(3)]: { ok: true, skipped: "duplicate" },
        [id(4)]: { ok: false, error: "operator 500" },
      };
      notify.sendParticipantSms.mockImplementation(
        async (input: { idempotencyKey: string }) =>
          byDelivery[input.idempotencyKey.split(":")[2] ?? ""],
      );
      const h = harness([[smsRow(1), smsRow(2), smsRow(3), smsRow(4), smsRow(5, { phone: "12" })]]);
      const result = await runEventParticipantReminders(h.admin, { deadlineAt: farFuture() });
      expect(h.confirmed[0]).toEqual([
        { id: id(1), status: "skipped", detail: "budget" },
        { id: id(2), status: "skipped", detail: "disabled" },
        { id: id(3), status: "sent", detail: "duplicate" },
        { id: id(4), status: "failed", detail: "sms_send_failed" },
        { id: id(5), status: "skipped", detail: "invalid_phone" },
      ]);
      expect(result).toMatchObject({ claimed: 5, sent: 1, skipped: 3, failed: 1 });
      expect(JSON.stringify(h.confirmed)).not.toContain("600");
    });
  });
});
