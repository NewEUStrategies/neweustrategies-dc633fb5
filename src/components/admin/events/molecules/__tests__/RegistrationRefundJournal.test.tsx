// Dziennik zwrotów zgłoszeń (REG-03): odczyt, powód przeglądu, decyzje.
//
// CO TEN PLIK DOWODZI:
//  1. Odczyt czeka na rozwinięcie i jest zawężony do wydarzenia.
//  2. Każdy wiersz mówi, KTO zamknął zgłoszenie (pochodzenie) i DLACZEGO
//     zwrot czeka na organizatora (powód przeglądu - po jednym zdaniu na powód).
//  3. Wpłata ręczna (`payment_order_id = null`) jest wierszem, a nie błędem
//     wczytania; dostaje „oznacz jako zwrócone" zamiast zwrotu przez operatora.
//  4. Decyzja wymaga drugiego kliknięcia, „nie zwracaj" - notatki (3 znaki),
//     a wszystkie trzy jadą przez literalne `admin_event_refund_job_decide`.
//  5. Dane nieczytelne to błąd wczytania, a nie pusty dziennik.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { axeViolations } from "@/test/axe";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (!h.rpc) throw new Error("Missing RPC plan");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
const { RegistrationRefundJournal } = await import("../RegistrationRefundJournal");
const base = "adminEventRegistration.refundJournal";
const DECIDE = "admin_event_refund_job_decide";
const row = {
  id: "job-1",
  registration_id: "reg-1",
  payment_order_id: "order-1",
  person_name: "Anna Test",
  state: "needs_review",
  origin: "participant_cancelled",
  review_reason: "shared_payment",
  amount_cents: null,
  currency: null,
  refund_deadline_at: null,
  review_note: null,
  decided_at: null,
  attempts: 1,
  last_error: "active_registrations_share_payment",
  next_attempt_at: "2026-09-29T12:00:00Z",
  created_at: "2026-09-29T12:00:00Z",
};
beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData("admin_event_refund_jobs", [row]);
  h.rpc.setData(DECIDE, { job_id: "job-1", state: "pending", action: "refund" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});
afterEach(cleanup);
function open() {
  const view = renderWithQueryClient(<RegistrationRefundJournal eventId="event-1" />);
  fireEvent.click(screen.getByRole("button", { name: `${base}.title` }));
  return view;
}

describe("odczyt dziennika", () => {
  it("defers the read until expanded and scopes it to the event", async () => {
    const view = renderWithQueryClient(<RegistrationRefundJournal eventId="event-1" />);
    expect(h.rpc?.calls).toHaveLength(0);
    const trigger = screen.getByRole("button", { name: `${base}.title` });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(await screen.findByText("Anna Test")).toBeInTheDocument();
    expect(h.rpc?.lastCall("admin_event_refund_jobs")?.args).toEqual({ p_event_id: "event-1" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await axeViolations(view.container)).toEqual([]);
  });

  it("mówi, kto zamknął zgłoszenie i dlaczego zwrot czeka na decyzję", async () => {
    open();
    expect(await screen.findByText(`${base}.reason.shared_payment`)).toBeInTheDocument();
    expect(
      screen.getByText(`${base}.states.needs_review · ${base}.origin.participant_cancelled`),
    ).toBeInTheDocument();
  });

  it.each([
    "outside_refund_window",
    "refund_disabled",
    "shared_payment",
    "manual_payment",
    "organizer_waived",
    "closed_without_refund_decision",
  ])("powód przeglądu %s ma własne zdanie", async (reason) => {
    h.rpc?.setData("admin_event_refund_jobs", [{ ...row, review_reason: reason }]);
    open();
    expect(await screen.findByText(`${base}.reason.${reason}`)).toBeInTheDocument();
  });

  it("wpłata ręczna (bez zamówienia) jest wierszem z kwotą, a nie błędem wczytania", async () => {
    h.rpc?.setData("admin_event_refund_jobs", [
      {
        ...row,
        payment_order_id: null,
        review_reason: "manual_payment",
        amount_cents: 12000,
        currency: "PLN",
      },
    ]);
    open();
    expect(await screen.findByText(`${base}.manualOrder`)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // Zwrot przez operatora jest dla wpłaty ręcznej niemożliwy - przycisku nie ma.
    expect(screen.queryByRole("button", { name: `${base}.actions.refund` })).toBeNull();
    expect(
      screen.getByRole("button", { name: `${base}.actions.markRefunded` }),
    ).toBeInTheDocument();
  });

  it("baza sprzed REG-03 (bez pochodzenia) nadal się czyta - jako odrzucenie", async () => {
    const { origin: _origin, review_reason: _reason, ...legacy } = row;
    h.rpc?.setData("admin_event_refund_jobs", [{ ...legacy, review_reason: null }]);
    open();
    expect(
      await screen.findByText(`${base}.states.needs_review · ${base}.origin.organizer_rejected`),
    ).toBeInTheDocument();
  });

  it.each([
    null,
    [{ ...row, state: "unknown" }],
    [{ ...row, origin: "z_kosmosu" }],
    [{ ...row, payment_order_id: 7 }],
  ])("treats invalid data as a read failure, not an empty journal: %j", async (data) => {
    h.rpc?.setData("admin_event_refund_jobs", data);
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${base}.loadError`);
    expect(screen.queryByText(`${base}.empty`)).not.toBeInTheDocument();
  });

  it("retries a failed read and refreshes after registration mutation invalidation", async () => {
    h.rpc?.setError("admin_event_refund_jobs", "unavailable");
    const view = open();
    await screen.findByRole("alert");
    h.rpc?.setData("admin_event_refund_jobs", [row]);
    fireEvent.click(screen.getByRole("button", { name: `${base}.refresh` }));
    await screen.findByText("Anna Test");
    h.rpc?.setData("admin_event_refund_jobs", []);
    await view.queryClient.invalidateQueries({ queryKey: registrationKeys.event("event-1") });
    expect(await screen.findByText(`${base}.empty`)).toBeInTheDocument();
  });
});

describe("decyzje organizatora", () => {
  it("zwrot przez operatora wymaga drugiego kliknięcia i jedzie literalnym RPC", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: `${base}.actions.refund` }));
    expect(h.rpc?.callsFor(DECIDE)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: `${base}.actions.confirm` }));
    await waitFor(() => expect(h.rpc?.callsFor(DECIDE)).toHaveLength(1));
    expect(h.rpc?.lastCall(DECIDE)?.arg("p_payload")).toEqual({
      job_id: "job-1",
      action: "refund",
    });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${base}.toasts.refund`));
  });

  it("„nie zwracaj” wymaga notatki (3 znaki) i wysyła ją obciętą", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: `${base}.actions.dismiss` }));
    const confirm = screen.getByRole("button", { name: `${base}.actions.confirm` });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(`${base}.noteRequiredLabel`), {
      target: { value: "ok" },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`${base}.noteRequiredLabel`), {
      target: { value: "  Po terminie - regulamin  " },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(h.rpc?.lastCall(DECIDE)?.arg("p_payload")).toEqual({
        job_id: "job-1",
        action: "dismiss",
        note: "Po terminie - regulamin",
      }),
    );
  });

  it("oznaczenie zwrotu ręcznego jedzie z akcją mark_refunded", async () => {
    h.rpc?.setData("admin_event_refund_jobs", [
      { ...row, payment_order_id: null, review_reason: "manual_payment" },
    ]);
    open();
    fireEvent.click(await screen.findByRole("button", { name: `${base}.actions.markRefunded` }));
    fireEvent.click(screen.getByRole("button", { name: `${base}.actions.confirm` }));
    await waitFor(() =>
      expect(h.rpc?.lastCall(DECIDE)?.arg("p_payload")).toEqual({
        job_id: "job-1",
        action: "mark_refunded",
      }),
    );
  });

  it("odmowa bazy dochodzi zdaniem, a wiersz zostaje do ponowienia", async () => {
    h.rpc?.setError(DECIDE, "refund_shared_payment: other active registrations share this payment");
    open();
    fireEvent.click(await screen.findByRole("button", { name: `${base}.actions.refund` }));
    fireEvent.click(screen.getByRole("button", { name: `${base}.actions.confirm` }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "odmowa:refund_shared_payment: other active registrations share this payment",
      ),
    );
    expect(screen.getByText("Anna Test")).toBeInTheDocument();
  });

  it("zlecenie w drodze albo zakończone nie ma przycisków decyzji", async () => {
    h.rpc?.setData("admin_event_refund_jobs", [
      { ...row, state: "pending", review_reason: null },
      { ...row, id: "job-2", state: "completed", review_reason: null },
    ]);
    open();
    await screen.findAllByText("Anna Test");
    expect(screen.queryByRole("button", { name: `${base}.actions.refund` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${base}.actions.dismiss` })).toBeNull();
  });
});
