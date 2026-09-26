// Funkcje serwerowe maili naboru: CO wolno wysłać, pod JAKIM kluczem
// idempotencji i jaki ślad zostaje w bazie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
//   1. RODZAJ MAILA Z BAZY. Panel mówi „wyślij", ładunek mówi „o czym"
//      (`notice`). Stan bez maila = `not_applicable`, zero wysyłki.
//   2. KLUCZ ZE STEMPLEM PRZEJŚCIA (`decided_at` / `submitted_at`) - nowa
//      decyzja wysyła nowy mail, ponowny klik tej samej - nie.
//   3. WYNIK WRACA DO BAZY - udana wysyłka stempluje, nieudana zapisuje błąd.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const { sendTxEmail } = vi.hoisted(() => ({ sendTxEmail: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail }));

const { notifyCfpDecision, confirmCfpSubmissionEmail } =
  await import("@/lib/events/cfpNotify.functions");

const ID = "11111111-1111-4111-8111-111111111111";

const PAYLOAD = {
  submission_id: ID,
  tenant_id: "t1",
  status: "accepted",
  notice: "accepted",
  decided_at: "2026-09-10T10:00:00+00:00",
  submitted_at: "2026-09-01T10:00:00+00:00",
  email: " anna@example.com ",
  first_name: "Anna",
  lang: "en",
  title_pl: "T",
  title_en: "Title",
  event_slug: "kongres",
  event_title_pl: "Kongres",
  event_title_en: "Congress",
};

function client(payload: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn(async (name: string) =>
    name === "admin_event_cfp_notify_payload" || name === "event_cfp_submission_notice"
      ? { data: payload, error }
      : { data: true, error: null },
  );
  return { rpc };
}

function markCalls(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls
    .filter((call) => call[0] === "admin_event_cfp_mark_notified")
    .map((call) => call[1]);
}

beforeEach(() => {
  sendTxEmail.mockReset();
  sendTxEmail.mockResolvedValue({ ok: true });
});

describe("kontrakt wejścia", () => {
  it("obie funkcje wymagają sesji i identyfikatora w kształcie UUID", () => {
    expect(serverFnMiddlewareNames(notifyCfpDecision)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(confirmCfpSubmissionEmail)).toEqual(["requireSupabaseAuth"]);
    expect(validateServerFnInput(notifyCfpDecision, { submissionId: ID })).toEqual({
      submissionId: ID,
    });
    expect(() => validateServerFnInput(notifyCfpDecision, { submissionId: "x" })).toThrow();
    expect(() => validateServerFnInput(confirmCfpSubmissionEmail, {})).toThrow();
  });
});

describe("notifyCfpDecision", () => {
  it("wysyła mail o decyzji z kluczem ze stemplem decyzji i stempluje wysyłkę", async () => {
    const supabase = client(PAYLOAD);
    const result = await callServerFn(notifyCfpDecision, {
      data: { submissionId: ID },
      context: { supabase },
    });
    expect(result).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith("admin_event_cfp_notify_payload", {
      p_submission_id: ID,
    });
    expect(sendTxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event_cfp_submission_accepted",
        to: "anna@example.com",
        lang: "en",
        subjectName: "Congress",
        ctaPath: "/events/kongres/speaker",
        metaName: "Anna",
        tenantId: "t1",
        idempotencyKey: `event-cfp:${ID}:accepted:2026-09-10T10:00:00+00:00`,
      }),
    );
    expect(markCalls(supabase.rpc)).toEqual([
      { p_payload: { submission_id: ID, status: "accepted" } },
    ]);
  });

  it("duplikat to sukces (i stempel), bez drugiego maila", async () => {
    sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    const supabase = client({ ...PAYLOAD, notice: "rejected", decided_at: null });
    const result = await callServerFn(notifyCfpDecision, {
      data: { submissionId: ID },
      context: { supabase },
    });
    expect(result).toEqual({ ok: true, skipped: "duplicate" });
    expect(sendTxEmail.mock.calls[0]?.[0].idempotencyKey).toBe(`event-cfp:${ID}:rejected:0`);
    expect(markCalls(supabase.rpc)).toHaveLength(1);
  });

  it("nieudana wysyłka zapisuje błąd w bazie i wraca jako odmowa", async () => {
    sendTxEmail.mockResolvedValue({
      ok: false,
      skipped: "suppressed",
      reason: "suppressed:bounce",
    });
    const supabase = client({ ...PAYLOAD, notice: "changes_requested" });
    const result = await callServerFn(notifyCfpDecision, {
      data: { submissionId: ID },
      context: { supabase },
    });
    expect(result).toEqual({ ok: false, error: "suppressed:bounce" });
    expect(markCalls(supabase.rpc)).toEqual([
      { p_payload: { submission_id: ID, status: "changes_requested", error: "suppressed:bounce" } },
    ]);

    sendTxEmail.mockResolvedValue({ ok: false, error: "smtp" });
    expect(
      await callServerFn(notifyCfpDecision, {
        data: { submissionId: ID },
        context: { supabase: client(PAYLOAD) },
      }),
    ).toEqual({ ok: false, error: "smtp" });
    sendTxEmail.mockResolvedValue({ ok: false, skipped: "no_recipient" });
    expect(
      await callServerFn(notifyCfpDecision, {
        data: { submissionId: ID },
        context: { supabase: client(PAYLOAD) },
      }),
    ).toEqual({ ok: false, error: "no_recipient" });
    sendTxEmail.mockResolvedValue({ ok: false });
    expect(
      await callServerFn(notifyCfpDecision, {
        data: { submissionId: ID },
        context: { supabase: client(PAYLOAD) },
      }),
    ).toEqual({ ok: false, error: "send_failed" });
  });

  it("stan bez maila, brak adresu, brak ładunku i odmowa bazy - bez wysyłki", async () => {
    const run = (payload: unknown, error: { message: string } | null = null) =>
      callServerFn(notifyCfpDecision, {
        data: { submissionId: ID },
        context: { supabase: client(payload, error) },
      });
    expect(await run({ ...PAYLOAD, notice: null })).toEqual({
      ok: true,
      skipped: "not_applicable",
    });
    expect(await run({ ...PAYLOAD, email: "  " })).toEqual({ ok: false, error: "no_recipient" });
    expect(await run({ ...PAYLOAD, email: 5 })).toEqual({ ok: false, error: "no_recipient" });
    expect(await run(null)).toEqual({ ok: false, error: "not_found" });
    expect(await run([])).toEqual({ ok: false, error: "not_found" });
    expect(await run(null, { message: "forbidden: x" })).toEqual({
      ok: false,
      error: "forbidden: x",
    });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });
});

describe("confirmCfpSubmissionEmail", () => {
  it("potwierdza wysłane zgłoszenie z kluczem ze stemplem wysłania", async () => {
    const supabase = client({ ...PAYLOAD, status: "submitted", notice: undefined });
    const result = await callServerFn(confirmCfpSubmissionEmail, {
      data: { submissionId: ID },
      context: { supabase },
    });
    expect(result).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith("event_cfp_submission_notice", {
      p_submission_id: ID,
    });
    expect(sendTxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event_cfp_submission_received",
        idempotencyKey: `event-cfp:${ID}:received:2026-09-01T10:00:00+00:00`,
      }),
    );
    // Potwierdzenie nie zostawia śladu w polach decyzji.
    expect(markCalls(supabase.rpc)).toEqual([]);
  });

  it("zgłoszenie w ocenie też dostaje potwierdzenie; duplikat to sukces", async () => {
    sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    const result = await callServerFn(confirmCfpSubmissionEmail, {
      data: { submissionId: ID },
      context: { supabase: client({ ...PAYLOAD, status: "under_review", submitted_at: "" }) },
    });
    expect(result).toEqual({ ok: true, skipped: "duplicate" });
    expect(sendTxEmail.mock.calls[0]?.[0].idempotencyKey).toBe(`event-cfp:${ID}:received:0`);
  });

  it("szkic, brak adresu, brak ładunku, odmowa bazy i nieudana wysyłka", async () => {
    const run = (payload: unknown, error: { message: string } | null = null) =>
      callServerFn(confirmCfpSubmissionEmail, {
        data: { submissionId: ID },
        context: { supabase: client(payload, error) },
      });
    expect(await run({ ...PAYLOAD, status: "draft" })).toEqual({
      ok: true,
      skipped: "not_applicable",
    });
    expect(await run({ ...PAYLOAD, status: "submitted", email: "" })).toEqual({
      ok: false,
      error: "no_recipient",
    });
    expect(await run({ ...PAYLOAD, status: "submitted", email: null })).toEqual({
      ok: false,
      error: "no_recipient",
    });
    expect(await run("x")).toEqual({ ok: false, error: "not_found" });
    expect(await run(null, { message: "auth_required: x" })).toEqual({
      ok: false,
      error: "auth_required: x",
    });
    expect(sendTxEmail).not.toHaveBeenCalled();

    sendTxEmail.mockResolvedValue({ ok: false, reason: "suppressed:complaint" });
    expect(await run({ ...PAYLOAD, status: "submitted" })).toEqual({
      ok: false,
      error: "suppressed:complaint",
    });
    sendTxEmail.mockResolvedValue({ ok: false, error: "smtp" });
    expect(await run({ ...PAYLOAD, status: "submitted" })).toEqual({ ok: false, error: "smtp" });
    sendTxEmail.mockResolvedValue({ ok: false, skipped: "no_recipient" });
    expect(await run({ ...PAYLOAD, status: "submitted" })).toEqual({
      ok: false,
      error: "no_recipient",
    });
    sendTxEmail.mockResolvedValue({ ok: false });
    expect(await run({ ...PAYLOAD, status: "submitted" })).toEqual({
      ok: false,
      error: "send_failed",
    });
  });
});
