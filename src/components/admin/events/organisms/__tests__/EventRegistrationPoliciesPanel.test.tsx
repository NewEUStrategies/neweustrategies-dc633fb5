// Organizm „ZASADY BILETÓW" studia wydarzenia (F1-F5, spec B.12).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ŁADUNEK Z CUDZYMI KLUCZAMI. Zapis zasad biletów, który niesie klucze
//      komunikacji albo certyfikatu, nadpisuje pracę drugiej karty (reguła
//      „brak klucza = bez zmian").
//   2. ZASADA ZWROTU BEZ UZASADNIENIA. Wybór trybu to karty w `fieldset` z
//      legendą (R-A11Y), a tryb „bez zwrotu" MUSI ostrzegać, że wymaga zapisu
//      w regulaminie wydarzenia.
//   3. TERMIN LICZONY NIE TAK, JAK MYŚLI ORGANIZATOR. Stałe zdania o regule
//      `LEAST(start - godziny, zapłata + 30 dni)`, zapisie przy zapłacie i R-7
//      stoją na ekranie zawsze.
//   4. WALIDACJA TYLKO W BAZIE. Godziny spoza zakresu dają zdanie przy polu,
//      a zapis nie wychodzi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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

const { EventRegistrationPoliciesPanel } =
  await import("@/components/admin/events/organisms/EventRegistrationPoliciesPanel");

const GET = "admin_event_participant_settings_get";
const SAVE = "admin_event_participant_settings_save";
const P = "adminEventParticipant.policies.";

function ustawienia(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: STUDIO_EVENT_ID,
    has_row: false,
    has_session_checkpoints: false,
    updated_at: null,
    calendar_export_enabled: true,
    reminders_enabled: true,
    reminder_event_leads_minutes: [1440, 60],
    transfer_enabled: true,
    transfer_deadline_hours: 24,
    refund_mode: "policy",
    refund_deadline_hours: 168,
    waitlist_offer_hours: 24,
    ...over,
  };
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function pokaz() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventRegistrationPoliciesPanel row={adminEventDetailRow()} />
    </QueryClientProvider>,
  );
}

async function formularz(): Promise<void> {
  await screen.findByLabelText(`${P}transfer.enabled`);
}

function pole(klucz: string): HTMLInputElement {
  return screen.getByLabelText(`${P}${klucz}`) as HTMLInputElement;
}

/** Karta trybu po roli; nazwa dostępna zaczyna się od etykiety karty (dalej stoi jej opis). */
function karta(tryb: "policy" | "none"): HTMLInputElement {
  const etykieta = `${P}refund.modes.${tryb}`.replaceAll(".", "\\.");
  return screen.getByRole("radio", { name: new RegExp(`^${etykieta}`) }) as HTMLInputElement;
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
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

afterEach(cleanup);

describe("EventRegistrationPoliciesPanel - stany wczytania", () => {
  it("dopóki ustawień nie ma, stoi szkielet pod tytułem ekranu", () => {
    h.wisi.add(GET);
    const { container } = pokaz();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "adminEvents.studio.sections.registrationPolicies",
    );
    expect(screen.queryByLabelText(`${P}transfer.enabled`)).toBeNull();
  });

  it("odmowa odczytu to zdanie z ponowieniem", async () => {
    stub().setError(GET, "not_found: event does not exist in this tenant");
    pokaz();

    const alert = await screen.findByRole("alert");
    stub().setData(GET, ustawienia());
    fireEvent.click(within(alert).getByRole("button", { name: "adminEventParticipant.retry" }));

    await formularz();
  });
});

describe("EventRegistrationPoliciesPanel - formularz", () => {
  it("pola niosą wartości z bazy, a zasada zwrotu jest wyborem w `fieldset` z legendą", async () => {
    stub().setData(
      GET,
      ustawienia({
        transfer_enabled: false,
        transfer_deadline_hours: 48,
        refund_mode: "policy",
        refund_deadline_hours: 72,
        waitlist_offer_hours: 12,
      }),
    );
    pokaz();
    await formularz();

    expect(
      screen.getByRole("switch", { name: `${P}transfer.enabled` }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(pole("transfer.deadline").value).toBe("48");
    expect(pole("refund.deadline").value).toBe("72");
    expect(pole("waitlist.hours").value).toBe("12");
    const grupa = screen.getByRole("group", { name: `${P}refund.modeLegend` });
    expect(within(grupa).getAllByRole("radio")).toHaveLength(2);
    expect(karta("policy").checked).toBe(true);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("reguła terminu, zapis przy zapłacie i R-7 stoją na ekranie zawsze", async () => {
    pokaz();
    await formularz();

    expect(screen.getByText(`${P}refund.rule`)).toBeTruthy();
    expect(screen.getByText(`${P}refund.snapshot`)).toBeTruthy();
    expect(screen.getByText(`${P}refund.favourable`)).toBeTruthy();
    expect(screen.getByText(`${P}waitlist.ticketNote`)).toBeTruthy();
  });

  it("tryb „bez zwrotu” ostrzega o regulaminie i jedzie do ładunku razem z pozostałymi zasadami", async () => {
    pokaz();
    await formularz();

    fireEvent.click(karta("none"));
    expect(screen.getByRole("note").textContent).toBe(`${P}refund.noneWarning`);
    fireEvent.click(screen.getByRole("switch", { name: `${P}transfer.enabled` }));
    fireEvent.change(pole("transfer.deadline"), { target: { value: "0" } });
    fireEvent.change(pole("waitlist.hours"), { target: { value: "48" } });
    zapisz();

    await waitFor(() => expect(stub().lastCall(SAVE)).toBeDefined());
    expect(ladunek()).toEqual({
      event_id: STUDIO_EVENT_ID,
      transfer_enabled: false,
      transfer_deadline_hours: 0,
      refund_mode: "none",
      refund_deadline_hours: 168,
      waitlist_offer_hours: 48,
    });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventParticipant.save.saved"),
    );
  });

  it("powrót do „zwrotu według terminu” zdejmuje ostrzeżenie", async () => {
    stub().setData(GET, ustawienia({ refund_mode: "none" }));
    pokaz();
    await formularz();

    expect(screen.getByRole("note")).toBeTruthy();
    fireEvent.click(karta("policy"));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it.each([
    ["transfer.deadline", "721", "transferDeadline"],
    ["refund.deadline", "3000", "refundDeadline"],
    ["waitlist.hours", "1", "offerHours"],
  ])("pole %s = %s daje zdanie przy polu i NIE jedzie do bazy", async (klucz, wartosc, blad) => {
    pokaz();
    await formularz();

    fireEvent.change(pole(klucz), { target: { value: wartosc } });
    zapisz();

    expect(await screen.findByText(`adminEventParticipant.errors.${blad}`)).toBeTruthy();
    expect(pole(klucz).getAttribute("aria-invalid")).toBe("true");
    expect(stub().callsFor(SAVE)).toHaveLength(0);
  });

  it("odmowa zapisu to zdanie z mapy studia", async () => {
    stub().setError(SAVE, "invalid_refund_deadline: out of range");
    pokaz();
    await formularz();

    fireEvent.change(pole("refund.deadline"), { target: { value: "100" } });
    zapisz();

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_refund_deadline: out of range"),
    );
  });

  it("„odrzuć” wraca do wartości z bazy i gasi komunikaty", async () => {
    pokaz();
    await formularz();

    fireEvent.change(pole("waitlist.hours"), { target: { value: "1" } });
    zapisz();
    await screen.findByText("adminEventParticipant.errors.offerHours");
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));

    expect(pole("waitlist.hours").value).toBe("24");
    expect(screen.queryByText("adminEventParticipant.errors.offerHours")).toBeNull();
  });

  it("ekran nie ma naruszeń axe - także z ostrzeżeniem trybu „bez zwrotu”", async () => {
    stub().setData(GET, ustawienia({ refund_mode: "none" }));
    const { container } = pokaz();
    await formularz();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
