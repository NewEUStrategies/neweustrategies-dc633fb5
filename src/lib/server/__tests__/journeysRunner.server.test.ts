// Runner ścieżek (S5): kolejność ticku, termin 3 s, sufit 20 maili, odkładanie
// przy zaległości kolejki > 120 i blokadzie reputacji, idempotencja
// (`journey:{zapis}:{węzeł}` = message_id), awaryjny wyłącznik. Baza jest
// atrapą RPC - kontrakt samych RPC sprawdzają testy pgTAP; tu sprawdzamy, że
// runner woła je we właściwej kolejności i z właściwymi wynikami.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enqueueRawEmail: vi.fn(),
  evaluateSendGate: vi.fn(),
}));

vi.mock("@/lib/email/transactional.server", () => ({ enqueueRawEmail: h.enqueueRawEmail }));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: h.evaluateSendGate }));

import { deterministicMessageId } from "@/lib/email/messageId";
import { publicFacingOrigin } from "@/lib/http/host";
import { emailDoc, button, paragraph } from "@/lib/journeys/templates/doc";
import {
  JOURNEYS_BACKLOG_DEFER_MINUTES,
  JOURNEYS_CAP_DEFER_MINUTES,
  JOURNEYS_DEADLINE_MS,
  JOURNEYS_REPUTATION_DEFER_MINUTES,
  JOURNEY_TEST_SUBJECT_PREFIX,
  journeyTestSubject,
  journeyUrlVariables,
  queueBacklogged,
  runJourneysTick,
} from "@/lib/server/journeysRunner.server";

type Rpc = { data: unknown; error: { message: string } | null };
type Handler = (args: Record<string, unknown>) => Rpc | Promise<Rpc>;

const T = "e5000000-0000-0000-0000-0000000000a0";
const T2 = "e5000000-0000-0000-0000-0000000000b0";
const J = "e5000000-0000-0000-0000-0000000010a1";
const ok = (data: unknown): Rpc => ({ data, error: null });
const fail = (message: string): Rpc => ({ data: null, error: { message } });

function enrollment(n: number) {
  return `e5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

function emailStep(n: number, extra: Record<string, unknown> = {}) {
  return {
    status: "email",
    enrollment_id: enrollment(n),
    lock_token: `lock-${n}`,
    node_id: "mail",
    tenant_id: T,
    journey_id: J,
    category: "marketing",
    is_test: false,
    ...extra,
  };
}

const CONTACT = {
  ready: true,
  email: "anna@nes.example",
  first_name: "Anna",
  last_name: "Kowalska",
  locale: "pl",
  fallback_locale: false,
  variant: "A",
  subject: "Witaj {{first_name}}",
  preheader: "Na start",
  doc: emailDoc(
    paragraph("p1", "Próba kończy się {{trial_ends_at}}.", "Trial ends {{trial_ends_at}}."),
    button("b1", "Cennik", "Pricing", "{{pricing_url}}"),
  ),
  sender_name: "Redakcja NES",
  reply_to: "redakcja@nes.example",
  site_name: "NES",
  site_domain: "nes.example",
  vars: { plan_name: "Pro", trial_ends_at: "2026-10-24T10:00:00Z" },
};

/** Atrapa klienta: kolejka wyników per RPC + dziennik wywołań. */
function fakeDb(handlers: Partial<Record<string, Handler>>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      const handler = handlers[fn];
      return handler ? handler(args) : ok(null);
    }),
  };
  return { client, calls, names: () => calls.map((c) => c.fn) };
}

function happyHandlers(
  over: Partial<Record<string, Handler>> = {},
): Partial<Record<string, Handler>> {
  return {
    journey_ingest_inbox: () => ok({ ingested: 3, enrolled: 2, failed: 0, journeys: { [J]: 2 } }),
    journey_claim_due: () =>
      ok([
        { enrollment_id: enrollment(1), lock_token: "lock-1", tenant_id: T, journey_id: J },
        { enrollment_id: enrollment(2), lock_token: "lock-2", tenant_id: T, journey_id: J },
      ]),
    journey_advance: (args) =>
      ok(
        args.p_enrollment_id === enrollment(1)
          ? emailStep(1)
          : { status: "completed", journey_id: J },
      ),
    email_queue_depth: () => ok({ transactional_emails: 3 }),
    journey_can_send: () => ok("ok"),
    journey_contact_for_send: () => ok(CONTACT),
    journey_complete_email_step: () => ok({ status: "completed" }),
    journey_tick_emit_stats: () => ok(1),
    ...over,
  };
}

const run = (db: ReturnType<typeof fakeDb>, opts = {}) =>
  runJourneysTick(db.client as never, { deadlineAt: Date.now() + 60_000, ...opts });

const completes = (db: ReturnType<typeof fakeDb>) =>
  db.calls.filter((c) => c.fn === "journey_complete_email_step").map((c) => c.args);

const previousSecret = process.env.SESSION_SECRET;
beforeEach(() => {
  process.env.SESSION_SECRET = "runner-test-secret";
  delete process.env.JOURNEYS_ENGINE_DISABLED;
  h.enqueueRawEmail.mockReset().mockResolvedValue({ ok: true });
  h.evaluateSendGate.mockReset().mockResolvedValue({ allowed: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

describe("stałe i pomocnicze", () => {
  it("termin 3 s, zaległość kolejki > 120, adresy serwisu najemcy", () => {
    expect(JOURNEYS_DEADLINE_MS).toBe(3_000);
    expect(queueBacklogged({ transactional_emails: 120 })).toBe(false);
    expect(queueBacklogged({ transactional_emails: 121 })).toBe(true);
    expect(queueBacklogged(null)).toBe(false);
    expect(queueBacklogged({ transactional_emails: "500" })).toBe(false);
    expect(journeyUrlVariables("https://a.test")).toEqual({
      site_url: "https://a.test",
      pricing_url: "https://a.test/pricing",
      account_url: "https://a.test/profile/billing",
      newsletter_url: "https://a.test/profile/notifications",
    });
  });
});

describe("tick", () => {
  it("awaryjny wyłącznik: bez dostępu do bazy", async () => {
    process.env.JOURNEYS_ENGINE_DISABLED = "1";
    const db = fakeDb(happyHandlers());
    await expect(run(db)).resolves.toEqual({ error: "disabled" });
    expect(db.client.rpc).not.toHaveBeenCalled();
  });

  it("kolejność: skrzynka -> pobranie -> wykonanie -> kolejka -> mail -> domknięcie -> statystyki", async () => {
    const db = fakeDb(happyHandlers());
    const result = await run(db);
    expect(db.names()).toEqual([
      "journey_ingest_inbox",
      "journey_claim_due",
      "journey_advance",
      "journey_advance",
      "email_queue_depth",
      "journey_can_send",
      "journey_contact_for_send",
      "journey_complete_email_step",
      "journey_tick_emit_stats",
    ]);
    expect(result).toEqual({
      ingested: 3,
      enrolled: 2,
      advanced: 2,
      emailsQueued: 1,
      deferred: 0,
      failed: 0,
      journeysTouched: 1,
    });
    expect(db.calls[0].args).toEqual({ p_limit: 200 });
    expect(db.calls[1].args).toEqual({ p_limit: 50, p_lease_seconds: 120 });
    expect(db.calls[2].args).toEqual({
      p_enrollment_id: enrollment(1),
      p_lock_token: "lock-1",
      p_max_steps: 25,
    });
    const stats = db.calls.at(-1)?.args;
    expect(stats).toEqual({
      p_journey_ids: [J],
      p_counts: { [J]: { enrolled: 2, advanced: 2, finished: 2, emails_queued: 1 } },
    });
  });

  it("mail marketingowy: klucz idempotencji = message_id, wypis RFC 8058, nadawca z panelu", async () => {
    const db = fakeDb(happyHandlers());
    await run(db);
    const key = `journey:${enrollment(1)}:mail`;
    const messageId = await deterministicMessageId(key);
    const origin = publicFacingOrigin("nes.example");
    expect(h.enqueueRawEmail).toHaveBeenCalledTimes(1);
    const input = h.enqueueRawEmail.mock.calls[0][0];
    expect(input).toMatchObject({
      to: "anna@nes.example",
      subject: "Witaj Anna",
      label: "journey",
      category: "bulk",
      idempotencyKey: key,
      tenantId: T,
      fromName: "Redakcja NES",
      replyTo: "redakcja@nes.example",
    });
    expect(input.unsubscribeUrl).toMatch(
      new RegExp(`^${origin}/api/public/newsletter/unsubscribe\\?token=j`),
    );
    expect(input.html).toContain("24 października 2026");
    expect(input.html).toContain("nl-click?m=");
    // Kontakt bez pola `open_tracking` (baza sprzed I9c-X2) = piksel jak dotąd.
    expect(input.html).toContain("nl-open?m=");
    expect(input.text).toContain("Wypisz się");
    expect(completes(db)[0]).toEqual({
      p_enrollment_id: enrollment(1),
      p_lock_token: "lock-1",
      p_node_id: "mail",
      p_result: "queued",
      p_message_id: messageId,
      p_variant: "A",
      p_locale: "pl",
      p_detail: { fallback_locale: false },
    });
  });

  it("pomiar otwarć wyłączony przez najemcę: mail bez piksela, kliknięcia zostają (I9c-X2)", async () => {
    const db = fakeDb(
      happyHandlers({ journey_contact_for_send: () => ok({ ...CONTACT, open_tracking: false }) }),
    );
    await run(db);
    const input = h.enqueueRawEmail.mock.calls[0][0];
    expect(input.html).not.toContain("nl-open");
    expect(input.html).toContain("nl-click?m=");
  });

  it("usługa i test na żywo: poczta 1:1 bez wypisu; EN z datą po angielsku", async () => {
    const db = fakeDb(
      happyHandlers({
        journey_claim_due: () =>
          ok([
            { enrollment_id: enrollment(1), lock_token: "lock-1" },
            { enrollment_id: enrollment(2), lock_token: "lock-2" },
          ]),
        journey_advance: (args) =>
          ok(
            args.p_enrollment_id === enrollment(1)
              ? emailStep(1, { category: "service" })
              : emailStep(2, { is_test: true }),
          ),
        journey_contact_for_send: () => ok({ ...CONTACT, locale: "en", sender_name: null }),
      }),
    );
    await run(db);
    const [service, test] = h.enqueueRawEmail.mock.calls.map((c) => c[0]);
    expect(service).toMatchObject({
      label: "journey_service",
      category: "transactional",
      unsubscribeUrl: null,
    });
    expect(service.html).toContain("24 October 2026");
    expect(service.fromName).toBeNull();
    expect(test).toMatchObject({ label: "journey_test", category: "transactional" });
    expect(test.unsubscribeUrl).toMatch(/token=j/);
    // SPEC §6.3 (Integrator S8): tylko zapis testowy ma znacznik w temacie.
    expect(service.subject).toBe("Witaj Anna");
    expect(test.subject).toBe("[TEST] Witaj Anna");
  });

  it("„[TEST] ” w temacie zapisu testowego - PL i EN, raz, po renderze (SPEC §6.3)", async () => {
    for (const locale of ["pl", "en"] as const) {
      h.enqueueRawEmail.mockClear();
      const db = fakeDb(
        happyHandlers({
          journey_advance: (args) =>
            ok(
              args.p_enrollment_id === enrollment(1)
                ? emailStep(1, { is_test: true })
                : emailStep(2),
            ),
          journey_contact_for_send: () =>
            ok({ ...CONTACT, locale, subject: "Hello {{first_name}}" }),
        }),
      );
      await run(db);
      const [test, regular] = h.enqueueRawEmail.mock.calls.map((c) => c[0]);
      expect(test.subject, locale).toBe(`${JOURNEY_TEST_SUBJECT_PREFIX}Hello Anna`);
      expect(regular.subject, locale).toBe("Hello Anna");
    }
    // Ponowienie kroku nie dubluje znacznika.
    expect(journeyTestSubject("[TEST] Hello")).toBe("[TEST] Hello");
    expect(journeyTestSubject("Hello")).toBe("[TEST] Hello");
  });

  it("pusty temat zapisu testowego dalej zatrzymuje wysyłkę (prefiks nie omija walidacji)", async () => {
    const db = fakeDb(
      happyHandlers({
        journey_advance: (args) =>
          ok(
            args.p_enrollment_id === enrollment(1)
              ? emailStep(1, { is_test: true })
              : { status: "completed", journey_id: J },
          ),
        journey_contact_for_send: () => ok({ ...CONTACT, subject: "   " }),
      }),
    );
    await run(db);
    expect(h.enqueueRawEmail).not.toHaveBeenCalled();
    expect(completes(db)[0]).toMatchObject({
      p_result: "delivery_not_ready",
      p_detail: { reason: "subject_empty" },
    });
  });

  it("zaległość kolejki > 120: maile odłożone o 5 min, nic nie idzie do kolejki", async () => {
    const db = fakeDb(
      happyHandlers({ email_queue_depth: () => ok({ transactional_emails: 121 }) }),
    );
    h.enqueueRawEmail.mockClear();
    const result = await run(db);
    expect(h.enqueueRawEmail).not.toHaveBeenCalled();
    expect(completes(db)).toEqual([
      expect.objectContaining({
        p_result: "deferred",
        p_detail: { minutes: JOURNEYS_BACKLOG_DEFER_MINUTES },
      }),
    ]);
    expect(db.names()).not.toContain("journey_can_send");
    expect(result).toMatchObject({ emailsQueued: 0 });
  });

  it("sufit 20 maili na tick: reszta odłożona o minutę", async () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({
      enrollment_id: enrollment(i + 1),
      lock_token: `lock-${i + 1}`,
    }));
    const db = fakeDb(
      happyHandlers({
        journey_claim_due: () => ok(rows),
        journey_advance: (args) => ok(emailStep(Number(String(args.p_enrollment_id).slice(-12)))),
        journey_complete_email_step: (args) =>
          ok({ status: args.p_result === "deferred" ? "deferred" : "completed" }),
      }),
    );
    const result = await run(db, { claimLimit: 22 });
    expect(h.enqueueRawEmail).toHaveBeenCalledTimes(20);
    const deferred = completes(db).filter((c) => c.p_result === "deferred");
    expect(deferred).toHaveLength(2);
    expect(deferred[0].p_detail).toEqual({ minutes: JOURNEYS_CAP_DEFER_MINUTES });
    expect(result).toMatchObject({ emailsQueued: 20, deferred: 2 });
  });

  it("reputacja domeny: bramka RAZ na najemcę, zablokowany najemca odłożony o godzinę", async () => {
    h.evaluateSendGate.mockImplementation(async (_db: unknown, tenant: string) => ({
      allowed: tenant !== T2,
    }));
    const db = fakeDb(
      happyHandlers({
        journey_claim_due: () =>
          ok([1, 2, 3].map((n) => ({ enrollment_id: enrollment(n), lock_token: `lock-${n}` }))),
        journey_advance: (args) => {
          const n = Number(String(args.p_enrollment_id).slice(-12));
          return ok(emailStep(n, { tenant_id: n === 3 ? T2 : T }));
        },
      }),
    );
    await run(db);
    expect(h.evaluateSendGate).toHaveBeenCalledTimes(2);
    expect(h.enqueueRawEmail).toHaveBeenCalledTimes(2);
    expect(completes(db).find((c) => c.p_enrollment_id === enrollment(3))).toMatchObject({
      p_result: "deferred",
      p_detail: { minutes: JOURNEYS_REPUTATION_DEFER_MINUTES },
    });
  });

  it("werdykt bramki (limit D-03, cisza nocna, brak zgody) domyka krok bez wysyłki", async () => {
    for (const verdict of ["capped", "quiet", "no_consent", "unsubscribed"]) {
      h.enqueueRawEmail.mockClear();
      const db = fakeDb(happyHandlers({ journey_can_send: () => ok(verdict) }));
      await run(db);
      expect(h.enqueueRawEmail).not.toHaveBeenCalled();
      expect(completes(db)[0]).toMatchObject({ p_result: verdict, p_message_id: null });
    }
  });

  it("kontakt niegotowy, zły dokument, brak adresata: krok pominięty z powodem", async () => {
    let db = fakeDb(
      happyHandlers({
        journey_contact_for_send: () => ok({ ready: false, reason: "content_missing" }),
      }),
    );
    await run(db);
    expect(completes(db)[0]).toMatchObject({
      p_result: "delivery_not_ready",
      p_detail: { reason: "content_missing" },
    });

    db = fakeDb(happyHandlers({ journey_contact_for_send: () => ok({ ready: false }) }));
    await run(db);
    expect(completes(db)[0]).toMatchObject({ p_detail: { reason: "not_ready" } });

    db = fakeDb(
      happyHandlers({ journey_contact_for_send: () => ok({ ...CONTACT, doc: { version: 9 } }) }),
    );
    await run(db);
    expect(completes(db)[0]).toMatchObject({
      p_result: "delivery_not_ready",
      p_detail: { reason: "doc_invalid" },
    });

    h.enqueueRawEmail.mockResolvedValueOnce({ ok: false, skipped: "no_recipient" });
    db = fakeDb(happyHandlers());
    await run(db);
    expect(completes(db)[0]).toMatchObject({
      p_result: "delivery_not_ready",
      p_detail: { reason: "no_recipient" },
    });

    h.enqueueRawEmail.mockResolvedValueOnce({ ok: false, skipped: "suppressed" });
    db = fakeDb(happyHandlers());
    await run(db);
    expect(completes(db)[0]).toMatchObject({ p_result: "suppressed" });
  });

  it("idempotencja: duplikat w kolejce domyka krok i nie liczy maila drugi raz", async () => {
    h.enqueueRawEmail.mockResolvedValueOnce({ ok: true, skipped: "duplicate" });
    const db = fakeDb(happyHandlers());
    const result = await run(db);
    expect(completes(db)[0]).toMatchObject({ p_result: "queued" });
    expect(result).toMatchObject({ emailsQueued: 0 });
    expect(db.calls.at(-1)?.args.p_counts).toMatchObject({ [J]: { emails_queued: 0 } });
  });

  it("kolejny mail tego samego zapisu w tej samej dzierżawie", async () => {
    let step = 0;
    const db = fakeDb(
      happyHandlers({
        journey_claim_due: () => ok([{ enrollment_id: enrollment(1), lock_token: "lock-1" }]),
        journey_complete_email_step: () => {
          step += 1;
          return ok(step === 1 ? emailStep(1, { node_id: "mail_2" }) : { status: "goal_reached" });
        },
      }),
    );
    const result = await run(db);
    expect(h.enqueueRawEmail).toHaveBeenCalledTimes(2);
    expect(h.enqueueRawEmail.mock.calls[1][0].idempotencyKey).toBe(
      `journey:${enrollment(1)}:mail_2`,
    );
    expect(result).toMatchObject({ emailsQueued: 2 });
  });

  it("błąd wysyłki i błędy RPC maila: krok przez journey_fail_step (faza email)", async () => {
    h.enqueueRawEmail.mockResolvedValueOnce({ ok: false, error: "smtp down" });
    let db = fakeDb(happyHandlers());
    let result = await run(db);
    const failed = db.calls.find((c) => c.fn === "journey_fail_step")?.args;
    expect(failed).toEqual({
      p_enrollment_id: enrollment(1),
      p_lock_token: "lock-1",
      p_node_id: "mail",
      p_error: "enqueue: smtp down",
      p_phase: "email",
    });
    expect(result).toMatchObject({ failed: 1 });

    db = fakeDb(
      happyHandlers({ journey_can_send: () => fail("boom"), journey_fail_step: () => fail("x") }),
    );
    result = await run(db);
    expect(db.calls.find((c) => c.fn === "journey_fail_step")?.args.p_error).toBe("can_send: boom");

    db = fakeDb(happyHandlers({ journey_contact_for_send: () => ok("nie obiekt") }));
    await run(db);
    expect(db.calls.find((c) => c.fn === "journey_fail_step")?.args.p_error).toBe("contact: shape");

    db = fakeDb(happyHandlers({ journey_contact_for_send: () => fail("rls") }));
    await run(db);
    expect(db.calls.find((c) => c.fn === "journey_fail_step")?.args.p_error).toBe("contact: rls");
  });

  it("awarie etapów bazy liczone, tick kończy się czysto", async () => {
    const db = fakeDb(
      happyHandlers({
        journey_ingest_inbox: () => fail("ingest down"),
        journey_claim_due: () =>
          ok([
            { enrollment_id: enrollment(1), lock_token: "lock-1" },
            { enrollment_id: enrollment(2), lock_token: "lock-2" },
            { enrollment_id: enrollment(3), lock_token: "lock-3" },
            { enrollment_id: null, lock_token: "lock-x" },
            "śmieć",
          ]),
        journey_advance: (args) =>
          args.p_enrollment_id === enrollment(1)
            ? fail("advance down")
            : ok({
                status: args.p_enrollment_id === enrollment(2) ? "retry" : "dead",
                journey_id: J,
              }),
        journey_tick_emit_stats: () => fail("emit down"),
      }),
    );
    const result = await run(db);
    // skrzynka + wykonanie + ponowienie + martwy krok = 4.
    expect(result).toMatchObject({ ingested: 0, advanced: 2, failed: 4, emailsQueued: 0 });
    expect(db.names().filter((n) => n === "journey_advance")).toHaveLength(3);
    expect(db.names()).not.toContain("email_queue_depth");

    const claimFail = fakeDb(happyHandlers({ journey_claim_due: () => fail("claim down") }));
    await expect(run(claimFail)).resolves.toMatchObject({ failed: 1, advanced: 0 });

    const completeFail = fakeDb(happyHandlers({ journey_complete_email_step: () => fail("x") }));
    await expect(run(completeFail)).resolves.toMatchObject({ failed: 1, emailsQueued: 1 });
  });

  it("termin ticku: po przekroczeniu nic nowego nie startuje (dzierżawa wraca sama)", async () => {
    const db = fakeDb(happyHandlers());
    const result = await runJourneysTick(db.client as never, { deadlineAt: Date.now() - 1 });
    expect(db.names()).toEqual(["journey_ingest_inbox", "journey_tick_emit_stats"]);
    expect(result).toMatchObject({ advanced: 0, journeysTouched: 1 });

    const now = Date.now();
    let clock = now;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const slow = fakeDb(
      happyHandlers({
        journey_advance: () => {
          clock += 5_000;
          return ok(emailStep(1));
        },
      }),
    );
    await runJourneysTick(slow.client as never, { deadlineAt: now + 1_000 });
    expect(slow.names().filter((n) => n === "journey_advance")).toHaveLength(1);
    expect(slow.names()).not.toContain("journey_can_send");
  });
});
