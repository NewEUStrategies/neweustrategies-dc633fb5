// Skutek finansowy rezygnacji (REG-03): parser podglądu, potwierdzenie skutku
// i kontrakt RPC rezygnacji.
//
// CO TEN PLIK DOWODZI:
//  1. NIEZNANY SKUTEK TO „DECYDUJE ORGANIZATOR", NIGDY „NIC". Nowsza baza
//     z wartością spoza listy nie może zamienić się na ekranie w „rezygnacja
//     nie dotyczy pieniędzy".
//  2. ODMOWA Z GÓRY (zamknięte, zakończone wydarzenie) nie niesie skutku,
//     a nieznana odmowa nadal jest odmową.
//  3. POTWIERDZENIE JEDZIE TYLKO WTEDY, GDY BAZA GO WYMAGA - rezygnacja
//     bezpłatna wysyła ten sam ładunek co przed REG-03 (zgodność wstecz),
//     opłacona - dokładnie skutek z podglądu.
//  4. Podgląd woła RPC pod LITERALNĄ nazwą, a baza sprzed migracji
//     (PGRST202/42883) daje `unavailable` - inne błędy lecą dalej.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";
import {
  acknowledgedEffectFor,
  cancellationEffectOf,
  cancellationReady,
  parseCancellationPreview,
  parseCancellationRefund,
  parseCancellationRefundResult,
} from "@/lib/events/cancellationPreview";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("@/lib/events/eventRegistration.functions", () => ({
  submitEventRegistration: vi.fn(),
}));

const api = await import("@/lib/events/publicRegistrationApi");

const REG = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

function okPreview(refund: Record<string, unknown>) {
  return {
    ok: true,
    registration_id: REG,
    status: "approved",
    can_cancel: true,
    refusal: null,
    refund,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("parser skutku", () => {
  it.each(["none", "included_ticket", "full_refund", "no_refund", "organizer_review"] as const)(
    "zna skutek %s",
    (effect) => {
      expect(cancellationEffectOf(effect)).toBe(effect);
    },
  );

  it("nieznany albo brakujący skutek czyta się jako decyzję organizatora, NIGDY jako „nic”", () => {
    expect(cancellationEffectOf("partial_refund_v2")).toBe("organizer_review");
    expect(cancellationEffectOf(undefined)).toBe("organizer_review");
    expect(cancellationEffectOf(null)).toBe("organizer_review");
    // I taki skutek wymaga potwierdzenia - stara odpowiedź bez flagi nie zdejmie go.
    expect(parseCancellationRefund({ effect: "nowy_skutek" })?.acknowledgementRequired).toBe(true);
  });

  it("pełny zwrot niesie kwotę, walutę, termin i gości grupy", () => {
    const refund = parseCancellationRefund({
      effect: "full_refund",
      amount_cents: 10000,
      currency: "PLN",
      refund_mode: "policy",
      refund_deadline_at: "2026-11-01T10:00:00Z",
      group_guests_closing: 2,
      acknowledgement_required: true,
    });
    expect(refund).toEqual({
      effect: "full_refund",
      reviewReason: null,
      amountCents: 10000,
      currency: "PLN",
      refundMode: "policy",
      refundDeadlineAt: "2026-11-01T10:00:00Z",
      groupGuestsClosing: 2,
      acknowledgementRequired: true,
    });
  });

  it("wspólna wpłata nie ma kwoty (gość nie poznaje sumy płatnika)", () => {
    const refund = parseCancellationRefund({
      effect: "organizer_review",
      review_reason: "shared_payment",
      amount_cents: null,
    });
    expect(refund?.amountCents).toBeNull();
    expect(refund?.reviewReason).toBe("shared_payment");
  });

  it("podgląd z odmową z góry nie niesie skutku; nieznana odmowa nadal jest odmową", () => {
    expect(
      parseCancellationPreview({
        ok: true,
        registration_id: REG,
        status: "approved",
        can_cancel: false,
        refusal: "event_ended",
        refund: null,
      }),
    ).toEqual({
      kind: "ok",
      registrationId: REG,
      status: "approved",
      canCancel: false,
      refusal: "event_ended",
      refund: null,
    });
    const unknown = parseCancellationPreview({
      ok: true,
      registration_id: REG,
      can_cancel: true,
      refusal: "nowa_odmowa",
    });
    expect(unknown.kind === "ok" && unknown.canCancel).toBe(false);
  });

  it("odmowa wartością: wygasły klucz i nieznany klucz to dwa różne stany", () => {
    expect(parseCancellationPreview({ ok: false, reason: "expired" })).toEqual({ kind: "expired" });
    expect(parseCancellationPreview({ ok: false, reason: "not_found" })).toEqual({
      kind: "not_found",
    });
    expect(parseCancellationPreview(null)).toEqual({ kind: "not_found" });
  });

  it("wynik rezygnacji niesie stan zlecenia zwrotu", () => {
    expect(
      parseCancellationRefundResult({
        effect: "no_refund",
        job_state: "needs_review",
        review_reason: "outside_refund_window",
        amount_cents: null,
      }),
    ).toEqual({
      effect: "no_refund",
      jobState: "needs_review",
      reviewReason: "outside_refund_window",
      amountCents: null,
      currency: null,
      refundDeadlineAt: null,
    });
    expect(parseCancellationRefundResult("x")).toBeNull();
  });
});

describe("potwierdzenie skutku", () => {
  it("rezygnacja bezpłatna i bilet z planu nie potrzebują potwierdzenia", () => {
    expect(acknowledgedEffectFor(parseCancellationPreview(okPreview({ effect: "none" })))).toBe(
      undefined,
    );
    expect(
      acknowledgedEffectFor(parseCancellationPreview(okPreview({ effect: "included_ticket" }))),
    ).toBe(undefined);
  });

  it.each(["full_refund", "no_refund", "organizer_review"] as const)(
    "skutek %s jedzie z rezygnacją dokładnie tak, jak go pokazano",
    (effect) => {
      expect(acknowledgedEffectFor(parseCancellationPreview(okPreview({ effect })))).toBe(effect);
    },
  );

  it("rezygnacja startuje dopiero z podglądem; stara baza (unavailable) jej nie blokuje", () => {
    expect(cancellationReady(undefined)).toBe(false);
    expect(cancellationReady({ kind: "not_found" })).toBe(false);
    expect(cancellationReady({ kind: "expired" })).toBe(false);
    expect(cancellationReady({ kind: "unavailable" })).toBe(true);
    expect(cancellationReady(parseCancellationPreview(okPreview({ effect: "none" })))).toBe(true);
    expect(acknowledgedEffectFor({ kind: "unavailable" })).toBeUndefined();
  });
});

describe("RPC podglądu i rezygnacji", () => {
  it("podgląd woła literalne `event_registration_cancel_preview` z samym kluczem", async () => {
    h.rpc?.setData("event_registration_cancel_preview", okPreview({ effect: "full_refund" }));
    const preview = await api.fetchCancellationPreview({ manageToken: TOKEN });
    expect(h.rpc?.lastCall("event_registration_cancel_preview")?.arg("p_payload")).toEqual({
      manage_token: TOKEN,
    });
    expect(preview.kind === "ok" && preview.refund?.effect).toBe("full_refund");
  });

  it("baza sprzed migracji (PGRST202 / 42883) daje `unavailable`, inny błąd leci dalej", async () => {
    h.rpc?.setError("event_registration_cancel_preview", "function not found", "PGRST202");
    await expect(api.fetchCancellationPreview({ registrationId: REG })).resolves.toEqual({
      kind: "unavailable",
    });
    h.rpc?.setError("event_registration_cancel_preview", "undefined function", "42883");
    await expect(api.fetchCancellationPreview({ registrationId: REG })).resolves.toEqual({
      kind: "unavailable",
    });
    h.rpc?.setError("event_registration_cancel_preview", "rate_limited: wait", "P0001");
    await expect(api.fetchCancellationPreview({ registrationId: REG })).rejects.toThrow(
      /rate_limited/,
    );
  });

  it("rezygnacja wysyła `acknowledged_effect` tylko wtedy, gdy go podano", async () => {
    h.rpc?.setData("event_registration_cancel", { registration_id: REG });
    await api.cancelRegistration({ manageToken: TOKEN });
    expect(h.rpc?.lastCall("event_registration_cancel")?.arg("p_payload")).toEqual({
      manage_token: TOKEN,
    });

    await api.cancelRegistration({ manageToken: TOKEN, acknowledgedEffect: "full_refund" });
    expect(h.rpc?.lastCall("event_registration_cancel")?.arg("p_payload")).toEqual({
      manage_token: TOKEN,
      acknowledged_effect: "full_refund",
    });
  });

  it("wynik rezygnacji mówi o zleconym zwrocie; stara baza - `refund: null`", async () => {
    h.rpc?.setData("event_registration_cancel", {
      registration_id: REG,
      promoted_from_waitlist: 1,
      refund: { effect: "full_refund", job_state: "pending", amount_cents: 10000, currency: "PLN" },
    });
    const result = await api.cancelRegistration({
      manageToken: TOKEN,
      acknowledgedEffect: "full_refund",
    });
    expect(result.refund).toMatchObject({ jobState: "pending", amountCents: 10000 });

    h.rpc?.setData("event_registration_cancel", { registration_id: REG });
    expect((await api.cancelRegistration({ manageToken: TOKEN })).refund).toBeNull();
  });
});
