// MOLEKUŁA `ChannelWithdrawCard` - wyłączenie SMS-ów i e-maili kluczem
// z maila, gdy zgłoszenie jest zamknięte albo wydarzenie się skończyło
// (przegląd R67, REG-10 / REG-17).
//
// CO TEN PLIK DOWODZI:
//   1. Klucz wygasły (`reason="expired"`): karta NIE pyta o preferencje (klucz
//      po końcu wydarzenia nie otwiera podglądu), mówi o końcu wydarzenia,
//      a przyciski wysyłają kluczem WYŁĄCZNIE `false` - bez zgody, bez
//      identyfikatora zgłoszenia. Stan po wyłączeniu bierze z odpowiedzi.
//   2. Zgłoszenie zamknięte (`reason="closed"`, klucz ważny): stan z podglądu
//      preferencji, kanał już wyłączony ma nieaktywny przycisk.
//   3. Odmowa bazy -> zdanie z mapy pisarza (`channelErrorKey`), nie surowy
//      komunikat.
//   4. Brak naruszeń axe.
//
// Wpięcie w stronę samoobsługi dowodzą `ManageCalendarRemindersSlot.test.tsx`
// (zgłoszenie zamknięte) i `RegistrationManagePanel.test.tsx` (klucz wygasły).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import { ok } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ChannelWithdrawCard } =
  await import("@/components/events/participant/molecules/ChannelWithdrawCard");

/** 24 bajty w base64url - kształt klucza `manage_token`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const REG = "44444444-4444-4444-4444-444444444444";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: brak atrapy RPC");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  return (rpc().lastCall(name)?.arg("p_payload") ?? {}) as Record<string, unknown>;
}

function channels(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registration_id: REG,
    notify_email: true,
    notify_sms: true,
    remind_email: true,
    remind_push: true,
    remind_sms: true,
    remind_sessions: true,
    sms_consent_at: "2026-10-01T10:00:00Z",
    sms_consent_via: "token",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rpc = supabaseRpcStub();
  h.rpc.setResponse("event_registration_set_channels", (call) =>
    ok(channels(call.arg("p_payload") as Record<string, unknown>)),
  );
  h.rpc.setData("event_registration_preferences", {
    ok: true,
    ...channels({ notify_sms: false, remind_sms: false }),
    status: "cancelled",
    has_account: false,
    has_phone: true,
    phone_hint: "222",
  });
});

describe("ChannelWithdrawCard - klucz po końcu wydarzenia", () => {
  it("bez podglądu preferencji; „Wyłącz SMS-y” wysyła kluczem same false", async () => {
    renderWithQueryClient(<ChannelWithdrawCard manageToken={MANAGE_TOKEN} reason="expired" />);

    expect(screen.getByText("participantTickets.withdraw.expiredBody")).toBeTruthy();
    const smsOff = screen.getByRole("button", { name: "participantTickets.withdraw.smsOff" });
    // Stan nieznany (klucz nie otwiera podglądu) - oba przyciski czynne.
    expect(smsOff).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "participantTickets.withdraw.emailOff" }),
    ).toBeEnabled();

    fireEvent.click(smsOff);
    await waitFor(() =>
      expect(payload("event_registration_set_channels")).toEqual({
        manage_token: MANAGE_TOKEN,
        notify_sms: false,
        remind_sms: false,
      }),
    );
    expect(await screen.findByText("participantTickets.withdraw.smsDone")).toBeTruthy();
    expect(smsOff).toBeDisabled();
    expect(toast.success).toHaveBeenCalledWith("participantTickets.withdraw.saved");
    // Klucz po końcu wydarzenia: podgląd nie istnieje, karta o niego nie pyta.
    expect(rpc().calls.map((call) => call.name)).toEqual(["event_registration_set_channels"]);
  });

  it("„Wyłącz e-maile” wysyła sam główny przełącznik notify_email=false", async () => {
    renderWithQueryClient(<ChannelWithdrawCard manageToken={MANAGE_TOKEN} reason="expired" />);
    fireEvent.click(screen.getByRole("button", { name: "participantTickets.withdraw.emailOff" }));
    await waitFor(() =>
      expect(payload("event_registration_set_channels")).toEqual({
        manage_token: MANAGE_TOKEN,
        notify_email: false,
      }),
    );
    expect(await screen.findByText("participantTickets.withdraw.emailDone")).toBeTruthy();
  });

  it("odmowa bazy -> zdanie z mapy pisarza, nie surowy komunikat", async () => {
    rpc().setError("event_registration_set_channels", "not_found: registration does not exist");
    renderWithQueryClient(<ChannelWithdrawCard manageToken={MANAGE_TOKEN} reason="expired" />);
    fireEvent.click(screen.getByRole("button", { name: "participantTickets.withdraw.smsOff" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("participantTickets.channels.errors.notFound"),
    );
    expect(screen.queryByText("participantTickets.withdraw.smsDone")).toBeNull();
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = renderWithQueryClient(
      <ChannelWithdrawCard manageToken={MANAGE_TOKEN} reason="expired" />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("ChannelWithdrawCard - zgłoszenie zamknięte (klucz ważny)", () => {
  it("stan z podglądu: SMS już wyłączony, e-maile nadal do wyłączenia", async () => {
    renderWithQueryClient(
      <ChannelWithdrawCard manageToken={MANAGE_TOKEN} registrationId={REG} reason="closed" />,
    );
    expect(screen.getByText("participantTickets.withdraw.closedBody")).toBeTruthy();
    expect(await screen.findByText("participantTickets.withdraw.smsDone")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "participantTickets.withdraw.smsOff" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "participantTickets.withdraw.emailOff" }),
    ).toBeEnabled();
    // Podgląd kluczem, bez identyfikatora zgłoszenia (gość nie ma sesji).
    expect(payload("event_registration_preferences")).toEqual({ manage_token: MANAGE_TOKEN });
  });
});
