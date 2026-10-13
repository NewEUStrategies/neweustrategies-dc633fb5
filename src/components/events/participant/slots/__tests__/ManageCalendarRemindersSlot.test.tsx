// GNIAZDO `ManageCalendarRemindersSlot` - przypomnienia na stronie samoobsługi
// po kluczu z maila (WŁAŚCICIEL: tor A, REG-09 / REG-10).
//
// CO TEN PLIK DOWODZI:
//   1. KLUCZ JEST POŚWIADCZENIEM: preferencje i zapis jadą z `manage_token`,
//      BEZ identyfikatora zgłoszenia (gość nie ma sesji, a SQL i tak wybiera
//      gałąź klucza).
//   2. Gość bez konta nie widzi przełącznika dzwonka; zgoda na SMS idzie tą
//      samą drogą (`sms_consent: true` razem z kanałem i przypomnieniami).
//   3. Klucz wygasły z końcem wydarzenia - karta mówi to wprost (REG-17).
//   4. Bez klucza albo przy zgłoszeniu zamkniętym gniazdo jest puste.
//   5. Brak naruszeń axe.
//
// Kartę jako taką (przełączniki, zgoda, flagi organizatora) dowodzi
// `RegistrationCardRemindersSlot.test.tsx` - ten sam komponent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { ok } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import {
  PARTICIPANT_EVENT_SLUG,
  makeRegistrationManageView,
} from "@/test/events/participantFixtures";

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
vi.mock("@/lib/events/smsAvailability.functions", () => ({
  getParticipantSmsAvailability: { name: "getParticipantSmsAvailability" },
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => ({ smsEnabled: true }),
}));

const { ManageCalendarRemindersSlot } =
  await import("@/components/events/participant/slots/ManageCalendarRemindersSlot");

/** 24 bajty w base64url - kształt klucza `manage_token`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

function guestPrefs(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    registration_id: makeRegistrationManageView().registrationId,
    event_slug: PARTICIPANT_EVENT_SLUG,
    status: "approved",
    notify_email: true,
    notify_sms: false,
    remind_email: true,
    remind_push: true,
    remind_sms: false,
    remind_sessions: true,
    has_account: false,
    has_phone: true,
    phone_hint: "333",
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

function renderSlot(token: string | null = MANAGE_TOKEN, status = "approved") {
  return renderWithQueryClient(
    <ManageCalendarRemindersSlot
      slug={PARTICIPANT_EVENT_SLUG}
      token={token}
      view={makeRegistrationManageView({ status })}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rpc = supabaseRpcStub();
  h.rpc.setData("event_registration_preferences", guestPrefs());
  h.rpc.setResponse("event_registration_set_channels", (call) =>
    ok({ ...guestPrefs(), ...(call.arg("p_payload") as Record<string, unknown>) }),
  );
});

describe("ManageCalendarRemindersSlot - przypomnienia po kluczu", () => {
  it("odczyt i zgoda na SMS jadą kluczem z maila, bez identyfikatora zgłoszenia", async () => {
    renderSlot();
    fireEvent.click(await screen.findByText("participantTickets.reminders.show"));
    await screen.findByText("participantTickets.reminders.email");
    expect(payload("event_registration_preferences")).toEqual({ manage_token: MANAGE_TOKEN });

    // Gość bez konta: dzwonek nie ma dokąd trafić.
    expect(screen.queryByText("participantTickets.reminders.push")).toBeNull();

    fireEvent.click(screen.getByLabelText("participantTickets.reminders.sms"));
    fireEvent.click(await screen.findByText("participantTickets.channels.smsConsent.confirm"));
    await waitFor(() =>
      expect(payload("event_registration_set_channels")).toEqual({
        manage_token: MANAGE_TOKEN,
        remind_sms: true,
        notify_sms: true,
        sms_consent: true,
      }),
    );
  });

  it("klucz wygasły z końcem wydarzenia - karta mówi to wprost", async () => {
    rpc().setData("event_registration_preferences", { ok: false, reason: "expired" });
    renderSlot();
    fireEvent.click(await screen.findByText("participantTickets.reminders.show"));

    expect(await screen.findByText("participantTickets.reminders.expired")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("bez klucza gniazdo jest puste", () => {
    const { container } = renderSlot(null);
    expect(container.innerHTML).toBe("");
    expect(rpc().calls).toHaveLength(0);
  });

  it("zgłoszenie anulowane - gniazdo puste", () => {
    const { container } = renderSlot(MANAGE_TOKEN, "cancelled");
    expect(container.innerHTML).toBe("");
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = renderSlot();
    fireEvent.click(await screen.findByText("participantTickets.reminders.show"));
    await screen.findByText("participantTickets.reminders.email");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
