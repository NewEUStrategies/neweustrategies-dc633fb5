// Organizm „KOMUNIKACJA" studia wydarzenia (F1-F5, spec B.12).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. EKRAN NA WARTOŚCIACH DOMYŚLNYCH. Formularz, który rysuje się, zanim
//      przyszły ustawienia (albo mimo odmowy), wygląda jak „wydarzenie bez
//      ustawień" - a zapis nadpisuje prawdziwe ustawienia organizatora.
//   2. ŁADUNEK Z CUDZYMI KLUCZAMI. RPC ma regułę „brak klucza = bez zmian";
//      ekran komunikacji, który wyśle klucze zasad biletów albo certyfikatu,
//      nadpisze pracę drugiej karty.
//   3. SMS BEZ PLATFORMY. Przełącznik aktywny, gdy operator SMS nie jest
//      skonfigurowany, obiecuje wysyłkę, której nie będzie.
//   4. WALIDACJA TYLKO W BAZIE. Wartość spoza reguł (np. stary wiersz
//      z wyprzedzeniem 5 min) ma dać zdanie przy polu, a nie `invalid_*` z bazy.
//   5. DZIENNIK Z LUKĄ. Wczytywanie i odmowa dziennika mają własne stany.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł szkicu (`participantSettingsDraft.test.ts`),
// wnętrza pola wyprzedzeń (`ReminderLeadsField.test.tsx`), tabeli dziennika
// (`MessageDeliveryStatsTable.test.tsx`) i mapowania odmów bazy
// (`adminEventStudioErrors`). Droplista (Radix Select pod `FormSelect`) stoi na
// natywnej atrapie o tym samym kontrakcie - jak w `EventRegistrationSettingsPanel`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  sms: vi.fn<() => Promise<{ smsEnabled: boolean }>>(),
  /** RPC, które nigdy nie odpowiadają (stan „wczytywanie"). */
  wisi: new Set<string>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      if (h.wisi.has(name)) return new Promise(() => {});
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-participant", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.sms,
}));
vi.mock("@/lib/events/smsAvailability.functions", () => ({
  getParticipantSmsAvailability: { name: "getParticipantSmsAvailability" },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

const { EventCommunicationsPanel } =
  await import("@/components/admin/events/organisms/EventCommunicationsPanel");

const GET = "admin_event_participant_settings_get";
const SAVE = "admin_event_participant_settings_save";
const STATS = "admin_event_message_delivery_stats";
const C = "adminEventParticipant.communications.";

/** Odpowiedź `admin_event_participant_settings_get` (kolumny + metadane). */
function ustawienia(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: STUDIO_EVENT_ID,
    has_row: true,
    has_session_checkpoints: false,
    updated_at: "2026-09-01T10:00:00.000Z",
    calendar_export_enabled: true,
    reminders_enabled: true,
    reminder_event_leads_minutes: [1440, 60],
    session_reminders_enabled: true,
    session_reminder_lead_minutes: 15,
    reminder_sms_enabled: false,
    transfer_enabled: true,
    transfer_deadline_hours: 24,
    refund_mode: "policy",
    refund_deadline_hours: 168,
    waitlist_offer_hours: 24,
    certificate_enabled: false,
    certificate_eligibility: "attended",
    survey_enabled: false,
    ...over,
  };
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function pokaz() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <EventCommunicationsPanel row={adminEventDetailRow({ timezone: "Europe/Warsaw" })} />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

async function formularz(): Promise<void> {
  await screen.findByLabelText(`${C}reminders.enabled`);
}

function przelacznik(klucz: string): HTMLElement {
  return screen.getByRole("switch", { name: `${C}${klucz}` });
}

function zapisz(): void {
  fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.save" }));
}

function ladunek(): Record<string, unknown> {
  const arg = stub().lastCall(SAVE)?.arg("p_payload");
  if (arg === null || typeof arg !== "object") throw new Error("test: zapis nie dojechal");
  return { ...arg };
}

beforeEach(() => {
  h.wisi.clear();
  h.rpc = supabaseRpcStub();
  h.rpc.setData(GET, ustawienia());
  h.rpc.setResponse(SAVE, (call) => ({
    data: ustawienia({ ...(call.arg("p_payload") as Record<string, unknown>) }),
    error: null,
  }));
  h.rpc.setData(STATS, {
    rows: [
      { kind: "event_reminder", channel: "email", claimed: 0, sent: 3, skipped: 0, failed: 0 },
    ],
    last_sent_at: "2026-09-15T08:30:00.000Z",
  });
  h.sms.mockResolvedValue({ smsEnabled: false });
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

afterEach(cleanup);

describe("EventCommunicationsPanel - stany wczytania", () => {
  it("dopóki ustawień nie ma, stoi szkielet - a NIE formularz na wartościach domyślnych", () => {
    h.wisi.add(GET);
    const { container } = pokaz();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText(`${C}reminders.enabled`)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "adminEvents.studio.sections.communications",
    );
  });

  it("odmowa odczytu to zdanie z ponowieniem; po ponowieniu stoi formularz", async () => {
    stub().setError(GET, "forbidden: not an admin");
    pokaz();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("adminEventParticipant.loadError");
    expect(screen.queryByLabelText(`${C}reminders.enabled`)).toBeNull();

    stub().setData(GET, ustawienia());
    fireEvent.click(within(alert).getByRole("button", { name: "adminEventParticipant.retry" }));
    await formularz();
    expect(stub().lastCall(GET)?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
  });
});

describe("EventCommunicationsPanel - formularz", () => {
  it("każde pole niesie WARTOŚĆ Z BAZY", async () => {
    stub().setData(
      GET,
      ustawienia({
        reminders_enabled: false,
        reminder_event_leads_minutes: [4320],
        session_reminders_enabled: false,
        session_reminder_lead_minutes: 30,
        calendar_export_enabled: false,
      }),
    );
    pokaz();
    await formularz();

    expect(przelacznik("reminders.enabled").getAttribute("aria-checked")).toBe("false");
    expect(przelacznik("reminders.sessionEnabled").getAttribute("aria-checked")).toBe("false");
    expect(przelacznik("calendar.enabled").getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByRole("checkbox", { name: `${C}leads.p4320` }).getAttribute("aria-checked"),
    ).toBe("true");
    // Wyłączone przypomnienia wyłączają wybór wyprzedzeń.
    expect(screen.getByRole("checkbox", { name: `${C}leads.p4320` })).toBeDisabled();
    expect((screen.getByLabelText(`${C}reminders.sessionLead`) as HTMLSelectElement).value).toBe(
      "30",
    );
    expect(screen.queryByRole("button", { name: "adminEvents.studio.actions.save" })).toBeNull();
  });

  it("zapis wysyła WYŁĄCZNIE klucze ekranu komunikacji + `event_id`, wyprzedzenia malejąco", async () => {
    pokaz();
    await formularz();

    fireEvent.click(screen.getByRole("checkbox", { name: `${C}leads.p10080` }));
    fireEvent.click(przelacznik("reminders.sessionEnabled"));
    fireEvent.click(przelacznik("calendar.enabled"));
    fireEvent.change(screen.getByLabelText(`${C}reminders.sessionLead`), {
      target: { value: "60" },
    });
    zapisz();

    await waitFor(() => expect(stub().lastCall(SAVE)).toBeDefined());
    expect(ladunek()).toEqual({
      event_id: STUDIO_EVENT_ID,
      reminders_enabled: true,
      reminder_event_leads_minutes: [10080, 1440, 60],
      session_reminders_enabled: false,
      session_reminder_lead_minutes: 60,
      reminder_sms_enabled: false,
      calendar_export_enabled: false,
    });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventParticipant.save.saved"),
    );
    // Odpowiedź zapisu jest nowym stanem - pasek zapisu znika.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "adminEvents.studio.actions.save" })).toBeNull(),
    );
  });

  it("wyłączenie przypomnień jedzie do ładunku", async () => {
    pokaz();
    await formularz();

    fireEvent.click(przelacznik("reminders.enabled"));
    zapisz();

    await waitFor(() => expect(ladunek().reminders_enabled).toBe(false));
  });

  it("odmowa zapisu to zdanie z mapy studia, a wpisana praca zostaje", async () => {
    stub().setError(SAVE, "invalid_reminder_leads: too many");
    pokaz();
    await formularz();

    fireEvent.click(screen.getByRole("checkbox", { name: `${C}leads.p15` }));
    zapisz();

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_reminder_leads: too many"),
    );
    expect(
      screen.getByRole("checkbox", { name: `${C}leads.p15` }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("„odrzuć” wraca do wartości z bazy", async () => {
    pokaz();
    await formularz();

    fireEvent.click(przelacznik("calendar.enabled"));
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));

    expect(przelacznik("calendar.enabled").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "adminEvents.studio.actions.save" })).toBeNull();
  });

  it("wiersz spoza reguł (wyprzedzenie 5 min) daje zdanie przy polu i NIE jedzie do bazy", async () => {
    stub().setData(GET, ustawienia({ reminder_event_leads_minutes: [5] }));
    pokaz();
    await formularz();

    // Szkic, którego baza by nie przyjęła, jest zmianą wartą paska.
    zapisz();

    expect(await screen.findByText("adminEventParticipant.errors.reminderLeads")).toBeTruthy();
    expect(stub().callsFor(SAVE)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "adminEvents.studio.actions.save" })).toBeDisabled();
  });
});

describe("EventCommunicationsPanel - SMS zależy od platformy", () => {
  it("bez operatora SMS przełącznik jest WYŁĄCZONY, a podpowiedź mówi dlaczego", async () => {
    pokaz();
    await formularz();

    await waitFor(() => expect(h.sms).toHaveBeenCalled());
    expect(przelacznik("reminders.sms")).toBeDisabled();
    expect(screen.getByText(`${C}reminders.smsUnavailable`)).toBeTruthy();
    expect(screen.queryByText(`${C}reminders.smsHint`)).toBeNull();
  });

  it("z operatorem SMS przełącznik działa i jedzie do ładunku", async () => {
    h.sms.mockResolvedValue({ smsEnabled: true });
    pokaz();
    await formularz();

    await waitFor(() => expect(przelacznik("reminders.sms")).not.toBeDisabled());
    expect(screen.getByText(`${C}reminders.smsHint`)).toBeTruthy();
    fireEvent.click(przelacznik("reminders.sms"));
    zapisz();

    await waitFor(() => expect(ladunek().reminder_sms_enabled).toBe(true));
  });
});

describe("EventCommunicationsPanel - dziennik i drogowskaz", () => {
  it("dziennik doręczeń pokazuje tabelę tego wydarzenia", async () => {
    pokaz();
    await formularz();

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(stub().lastCall(STATS)?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
  });

  it("dopóki dziennik się wczytuje, stoi szkielet", async () => {
    h.wisi.add(STATS);
    const { container } = pokaz();
    await formularz();

    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("odmowa dziennika ma własne zdanie, a formularz działa dalej", async () => {
    stub().setError(STATS, "forbidden: nope");
    pokaz();
    await formularz();

    expect((await screen.findByRole("alert")).textContent).toBe(`${C}deliveries.loadError`);
    expect(przelacznik("calendar.enabled")).not.toBeDisabled();
  });

  it("kampanie i newsletter prowadzą do modułu globalnego", async () => {
    pokaz();
    await formularz();

    expect(screen.getByText("adminEvents.studio.external.communicationsTitle")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "adminEvents.studio.external.openModule" })
        .getAttribute("href"),
    ).toBe("/admin/newsletter/campaigns");
  });

  it("ekran nie ma naruszeń axe", async () => {
    const { container } = pokaz();
    await formularz();
    await screen.findByRole("table");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
