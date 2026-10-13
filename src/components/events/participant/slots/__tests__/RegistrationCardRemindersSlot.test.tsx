// GNIAZDO `RegistrationCardRemindersSlot` - karta przypomnień zgłoszenia
// w „Moich zgłoszeniach" (WŁAŚCICIEL: tor A, REG-09 / REG-10).
//
// CO TEN PLIK DOWODZI:
//   1. ZWINIĘTA I BEZ ZAPYTAŃ. Lista dwudziestu zgłoszeń nie robi dwudziestu
//      zapytań o preferencje - RPC pada dopiero po rozwinięciu, raz.
//   2. KAŻDY PRZEŁĄCZNIK WYSYŁA TYLKO SWÓJ KLUCZ (baza czyta obecność klucza).
//   3. SMS TYLKO ZA ZGODĄ: włączenie otwiera okno zgody z trzema ostatnimi
//      cyframi numeru; „Zgadzam się" wysyła `sms_consent: true` (i kanał SMS,
//      gdy był wyłączony), „Anuluj" nie wysyła nic.
//   4. POLA ZALEŻĄ OD STANU: SMS ukryty bez SMS-ów platformy albo organizatora,
//      nieaktywny bez numeru; dzwonek tylko dla konta; e-mail nieaktywny przy
//      wyłączonym kanale; komunikat, gdy organizator wyłączył przypomnienia.
//   5. Zgłoszenie zamknięte - gniazdo puste; brak naruszeń axe.
//
// ATRAPA OBEJMUJE WYŁĄCZNIE SIEĆ: `supabase.rpc` i funkcję serwerową
// dostępności SMS-ów. Moduł API, haki zapytań i molekuły jadą prawdziwe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { ok } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { makeParticipantRegistration } from "@/test/events/participantFixtures";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  smsEnabled: true,
}));

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

vi.mock("@/lib/events/smsAvailability.functions", () => ({
  getParticipantSmsAvailability: { name: "getParticipantSmsAvailability" },
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => ({ smsEnabled: h.smsEnabled }),
}));

const { toast } = await import("sonner");
const { RegistrationCardRemindersSlot } =
  await import("@/components/events/participant/slots/RegistrationCardRemindersSlot");

const REG = "3c4d0000-0000-4000-8000-000000000111";

/** Odpowiedź `event_registration_preferences` - właściciel z kontem, bez SMS-a. */
function prefs(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    registration_id: REG,
    event_id: "evt-1",
    event_slug: "forum-2030",
    status: "approved",
    notify_email: true,
    notify_sms: false,
    remind_email: true,
    remind_push: true,
    remind_sms: false,
    remind_sessions: true,
    sms_consent_at: null,
    sms_consent_via: null,
    has_account: true,
    has_phone: true,
    phone_hint: "200",
    reminders_enabled: true,
    reminder_sms_enabled: true,
    session_reminders_enabled: true,
    ...over,
  };
}

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: brak atrapy RPC");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  return (rpc().lastCall(name)?.arg("p_payload") ?? {}) as Record<string, unknown>;
}

async function expand(): Promise<void> {
  fireEvent.click(await screen.findByText("participantTickets.reminders.show"));
}

function renderSlot(over: Parameters<typeof makeParticipantRegistration>[0] = {}) {
  return renderWithQueryClient(
    <RegistrationCardRemindersSlot
      item={makeParticipantRegistration({ registrationId: REG, ...over })}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.smsEnabled = true;
  h.rpc = supabaseRpcStub();
  h.rpc.setData("event_registration_preferences", prefs());
  h.rpc.setResponse("event_registration_set_channels", (call) =>
    ok({ ...prefs(), ...(call.arg("p_payload") as Record<string, unknown>) }),
  );
});

describe("RegistrationCardRemindersSlot - karta przypomnień", () => {
  it("zwinięta nie pyta bazy; rozwinięcie robi JEDNO zapytanie po identyfikatorze", async () => {
    renderSlot();
    await screen.findByText("participantTickets.reminders.title");
    expect(rpc().callsFor("event_registration_preferences")).toHaveLength(0);

    await expand();
    await screen.findByText("participantTickets.reminders.email");
    expect(rpc().callsFor("event_registration_preferences")).toHaveLength(1);
    expect(payload("event_registration_preferences")).toEqual({ registration_id: REG });
  });

  it("przełącznik wysyła wyłącznie swój klucz", async () => {
    renderSlot();
    await expand();
    fireEvent.click(await screen.findByLabelText("participantTickets.reminders.sessions"));

    await waitFor(() =>
      expect(payload("event_registration_set_channels")).toEqual({
        registration_id: REG,
        remind_sessions: false,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("participantTickets.reminders.saved");
  });

  it("REG-10: włączenie SMS-a otwiera zgodę z końcówką numeru; zgoda wysyła kanał i przypomnienia", async () => {
    renderSlot();
    await expand();
    fireEvent.click(await screen.findByLabelText("participantTickets.reminders.sms"));

    expect(
      await screen.findByText("participantTickets.channels.smsConsent.body(hint=200)"),
    ).toBeTruthy();
    expect(rpc().callsFor("event_registration_set_channels")).toHaveLength(0);

    fireEvent.click(screen.getByText("participantTickets.channels.smsConsent.confirm"));
    await waitFor(() =>
      expect(payload("event_registration_set_channels")).toEqual({
        registration_id: REG,
        remind_sms: true,
        notify_sms: true,
        sms_consent: true,
      }),
    );
  });

  it("kanał SMS już włączony: zgoda wysyła tylko przypomnienia SMS", async () => {
    rpc().setData(
      "event_registration_preferences",
      prefs({ notify_sms: true, sms_consent_at: "2026-10-01T10:00:00Z" }),
    );
    renderSlot();
    await expand();
    fireEvent.click(await screen.findByLabelText("participantTickets.reminders.sms"));
    fireEvent.click(await screen.findByText("participantTickets.channels.smsConsent.confirm"));

    await waitFor(() =>
      expect(payload("event_registration_set_channels")).toEqual({
        registration_id: REG,
        remind_sms: true,
        sms_consent: true,
      }),
    );
  });

  it("„Anuluj” w oknie zgody nie wysyła nic", async () => {
    renderSlot();
    await expand();
    fireEvent.click(await screen.findByLabelText("participantTickets.reminders.sms"));
    fireEvent.click(await screen.findByText("participantTickets.channels.smsConsent.cancel"));

    await waitFor(() =>
      expect(
        screen.queryByText("participantTickets.channels.smsConsent.body(hint=200)"),
      ).toBeNull(),
    );
    expect(rpc().callsFor("event_registration_set_channels")).toHaveLength(0);
  });

  it("odmowa bazy ma własne zdanie (sms_consent_required)", async () => {
    rpc().setError(
      "event_registration_set_channels",
      "sms_consent_required: enabling SMS needs explicit consent",
    );
    renderSlot();
    await expand();
    fireEvent.click(await screen.findByLabelText("participantTickets.reminders.sms"));
    fireEvent.click(await screen.findByText("participantTickets.channels.smsConsent.confirm"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "participantTickets.channels.errors.smsConsentRequired",
      ),
    );
  });

  it("SMS ukryty, gdy platforma nie wysyła SMS-ów albo organizator je wyłączył", async () => {
    h.smsEnabled = false;
    const first = renderSlot();
    await expand();
    await screen.findByText("participantTickets.reminders.email");
    expect(screen.queryByText("participantTickets.reminders.sms")).toBeNull();
    first.unmount();

    h.smsEnabled = true;
    rpc().setData("event_registration_preferences", prefs({ reminder_sms_enabled: false }));
    renderSlot();
    await expand();
    await screen.findByText("participantTickets.reminders.email");
    expect(screen.queryByText("participantTickets.reminders.sms")).toBeNull();
  });

  it("bez numeru SMS jest nieaktywny z podpowiedzią; bez konta nie ma dzwonka", async () => {
    rpc().setData(
      "event_registration_preferences",
      prefs({ has_phone: false, phone_hint: null, has_account: false }),
    );
    renderSlot();
    await expand();

    expect(await screen.findByLabelText("participantTickets.reminders.sms")).toBeDisabled();
    expect(screen.getByText("participantTickets.reminders.smsNoPhone")).toBeTruthy();
    expect(screen.queryByText("participantTickets.reminders.push")).toBeNull();
  });

  it("wyłączony e-mail na zgłoszeniu: przełącznik przypomnień mailowych nieaktywny", async () => {
    rpc().setData("event_registration_preferences", prefs({ notify_email: false }));
    renderSlot();
    await expand();

    const email = await screen.findByLabelText("participantTickets.reminders.email");
    expect(email).toBeDisabled();
    expect(email).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("participantTickets.reminders.emailOff")).toBeTruthy();
  });

  it("organizator wyłączył przypomnienia - karta mówi to zamiast przełączników", async () => {
    rpc().setData("event_registration_preferences", prefs({ reminders_enabled: false }));
    renderSlot();
    await expand();

    expect(await screen.findByText("participantTickets.reminders.organizerOff")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("baza sprzed migracji: karta mówi, że ustawienia są chwilowo niedostępne", async () => {
    rpc().setError("event_registration_preferences", "function not found", "PGRST202");
    renderSlot();
    await expand();

    expect(await screen.findByText("participantTickets.reminders.unavailable")).toBeTruthy();
  });

  it.each(["cancelled", "rejected"])("zgłoszenie %s - gniazdo puste", (status) => {
    const { container } = renderSlot({ status });
    expect(container.innerHTML).toBe("");
  });

  it("nie wnosi naruszeń axe (rozwinięta karta)", async () => {
    const { container } = renderSlot();
    await expand();
    await screen.findByText("participantTickets.reminders.email");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
