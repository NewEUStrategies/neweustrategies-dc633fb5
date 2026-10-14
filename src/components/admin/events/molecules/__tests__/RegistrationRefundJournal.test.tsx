// Dziennik zwrotów zgłoszeń (REG-03 + eskalacja INV-19c): odczyt, powód
// przeglądu, alarm, decyzje.
//
// CO TEN PLIK DOWODZI:
//  1. Odczyt czeka na rozwinięcie i jest zawężony do wydarzenia.
//  2. Każdy wiersz mówi, KTO zamknął zgłoszenie (pochodzenie) i DLACZEGO
//     zwrot czeka na organizatora - etykieta i wskazówka dla KAŻDEGO powodu
//     z CHECK-a (powody zamknięcia i powody eskalacji kolejki), ostatni błąd
//     operatora i chwila alarmu dla administratorów.
//  3. Wpłata ręczna (`payment_order_id = null`) jest wierszem, a nie błędem
//     wczytania; dostaje „oznacz jako zwrócone" zamiast zwrotu przez operatora.
//  4. Decyzja wymaga drugiego kliknięcia, „nie zwracaj" - notatki (3 znaki),
//     a wszystkie trzy jadą przez literalne `admin_event_refund_job_decide`;
//     zwrot niepotwierdzony przez operatora nie ma żadnej decyzji.
//  5. Link z alarmu (`?refund_job=`) otwiera dziennik na tym zleceniu.
//  6. Dane nieczytelne to błąd wczytania, a nie pusty dziennik.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { REFUND_JOB_REVIEW_REASONS } from "@/lib/events/registrationRefundJournal";
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
const JOB = "7d1f6c2e-4b8a-4c1e-9f3a-0123456789ab";
const row = {
  id: JOB,
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
  last_error: null,
  escalated_at: null,
  next_attempt_at: "2026-09-29T12:00:00Z",
  created_at: "2026-09-29T12:00:00Z",
};
beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData("admin_event_refund_jobs", [row]);
  h.rpc.setData(DECIDE, { job_id: JOB, state: "pending", action: "refund" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
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
    expect(
      await screen.findByText(`${base}.reasons.shared_payment.hint(days=7)`),
    ).toBeInTheDocument();
    expect(screen.getByText(`${base}.reasons.shared_payment.label`)).toBeInTheDocument();
    expect(
      screen.getByText(`${base}.states.needs_review · ${base}.origin.participant_cancelled`),
    ).toBeInTheDocument();
  });

  it.each(REFUND_JOB_REVIEW_REASONS)(
    "names the review reason %s, its next step, the provider error and the administrator alert",
    async (reason) => {
      h.rpc?.setData("admin_event_refund_jobs", [
        {
          ...row,
          review_reason: reason,
          last_error: "expired_or_canceled_card",
          escalated_at: "2026-09-29T12:05:00Z",
        },
      ]);
      open();
      expect(await screen.findByText(`${base}.reasons.${reason}.label`)).toBeInTheDocument();
      expect(screen.getByText(`${base}.reasons.${reason}.hint(days=7)`)).toBeInTheDocument();
      expect(
        screen.getByText(`${base}.lastError(error=expired_or_canceled_card)`),
      ).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`^${base}\\.escalated\\(date=.+\\)$`)),
      ).toBeInTheDocument();
      expect(screen.queryByText(`${base}.reviewHint`)).not.toBeInTheDocument();
    },
  );

  it("zamknięte zlecenie zostaje z samą etykietą powodu, bez wskazówki do działania", async () => {
    h.rpc?.setData("admin_event_refund_jobs", [
      { ...row, state: "cancelled", review_reason: "organizer_waived", review_note: "Regulamin" },
    ]);
    open();
    expect(await screen.findByText(`${base}.reasons.organizer_waived.label`)).toBeInTheDocument();
    expect(screen.queryByText(/\.reasons\.organizer_waived\.hint/)).toBeNull();
    expect(screen.getByText(`${base}.reviewNote(note=Regulamin)`)).toBeInTheDocument();
  });

  it("keeps a generic hint for a legacy review row without a reason", async () => {
    // Starsze RPC (bez kluczy powodu, pochodzenia i alarmu) nie może wywrócić panelu.
    const { review_reason: _reason, escalated_at: _escalated, origin: _origin, ...legacy } = row;
    h.rpc?.setData("admin_event_refund_jobs", [legacy]);
    open();
    expect(await screen.findByText(`${base}.reviewHint`)).toBeInTheDocument();
    expect(
      screen.getByText(`${base}.states.needs_review · ${base}.origin.organizer_rejected`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\.escalated\(/)).not.toBeInTheDocument();
  });

  it("tells the organiser how many attempts remain automatic while a refund is retried", async () => {
    h.rpc?.setData("admin_event_refund_jobs", [
      {
        ...row,
        state: "failed",
        attempts: 3,
        review_reason: null,
        escalated_at: null,
        last_error: "provider_unavailable",
      },
    ]);
    open();
    expect(await screen.findByText(`${base}.failedHint(budget=10)`)).toBeInTheDocument();
    expect(screen.getByText(`${base}.lastError(error=provider_unavailable)`)).toBeInTheDocument();
    expect(screen.queryByText(/\.reasons\./)).not.toBeInTheDocument();
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

  it.each([
    null,
    [{ ...row, state: "unknown" }],
    [{ ...row, origin: "z_kosmosu" }],
    [{ ...row, payment_order_id: 7 }],
    [{ ...row, review_reason: "guessed" }],
    [{ ...row, escalated_at: 17 }],
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

describe("wejście z alarmu dla administratorów", () => {
  it("opens on the job named by the administrator alert link", async () => {
    window.history.replaceState(
      null,
      "",
      `/admin/events/event-1/registration/list?refund_job=${JOB}`,
    );
    const other = { ...row, id: "11111111-2222-4333-8444-555555555555", person_name: "Jan Inny" };
    h.rpc?.setData("admin_event_refund_jobs", [other, row]);
    renderWithQueryClient(<RegistrationRefundJournal eventId="event-1" />);
    expect(screen.getByRole("button", { name: `${base}.title` })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const focused = (await screen.findByText("Anna Test")).closest("li");
    expect(focused).toHaveAttribute("aria-current", "true");
    const sibling = screen.getByText("Jan Inny").closest("li");
    expect(sibling).not.toHaveAttribute("aria-current");
    expect(
      within(focused as HTMLElement).getByText(
        `${base}.states.needs_review · ${base}.origin.participant_cancelled`,
      ),
    ).toBeVisible();
  });

  it("ignores a malformed refund_job parameter", () => {
    window.history.replaceState(null, "", "/admin/events/event-1/registration/list?refund_job=x'y");
    renderWithQueryClient(<RegistrationRefundJournal eventId="event-1" />);
    expect(screen.getByRole("button", { name: `${base}.title` })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(h.rpc?.calls).toHaveLength(0);
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
      job_id: JOB,
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
        job_id: JOB,
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
        job_id: JOB,
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

  it("zwrot niepotwierdzony przez operatora nie ma żadnej decyzji (pieniądze mogą być w drodze)", async () => {
    h.rpc?.setData("admin_event_refund_jobs", [
      { ...row, review_reason: "refund_unconfirmed", escalated_at: "2026-09-29T12:05:00Z" },
    ]);
    open();
    expect(
      await screen.findByText(`${base}.reasons.refund_unconfirmed.hint(days=7)`),
    ).toBeInTheDocument();
    for (const action of ["refund", "markRefunded", "dismiss"]) {
      expect(screen.queryByRole("button", { name: `${base}.actions.${action}` })).toBeNull();
    }
  });
});
