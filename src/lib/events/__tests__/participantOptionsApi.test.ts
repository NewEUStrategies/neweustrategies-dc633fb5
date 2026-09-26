// Publiczne flagi funkcji uczestnika - kontrakt z `event_participant_options`.
//
// STAWKA: brak albo zły typ flagi ma WYŁĄCZAĆ funkcję (menu kalendarza nie
// pokaże eksportu, którego organizator nie włączył), a `{"ok":false}`
// (wydarzenie szkicowe albo cudze) nie może zamienić się w obiekt flag.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  fetchEventParticipantOptions,
  parseEventParticipantOptions,
} from "@/lib/events/participantOptionsApi";
import { DEFAULT_PARTICIPANT_SETTINGS } from "@/lib/events/participantSettings";
import { makeEventParticipantOptions } from "@/test/events/participantFixtures";

const RAW = {
  ok: true,
  event_id: "a1111111-1111-4111-8111-111111111111",
  timezone: "Europe/Warsaw",
  starts_at: "2030-06-10T08:00:00.000Z",
  ends_at: "2030-06-10T16:00:00.000Z",
  effective_end: "2030-06-10T16:00:00.000Z",
  calendar_export_enabled: true,
  reminders_enabled: true,
  reminder_event_leads_minutes: [1440, 60],
  session_reminders_enabled: true,
  session_reminder_lead_minutes: 15,
  reminder_sms_enabled: false,
  transfer_enabled: true,
  transfer_deadline_at: "2030-06-09T08:00:00.000Z",
  refund_mode: "policy",
  refund_deadline_hours: 168,
  waitlist_offer_hours: 24,
  certificate_enabled: false,
  survey_enabled: false,
  survey_opens_at: "2030-06-10T16:00:00.000Z",
  survey_closes_at: "2030-06-24T16:00:00.000Z",
};

beforeEach(() => {
  rpc.mockReset();
});

describe("parseEventParticipantOptions", () => {
  it("mapuje pełną odpowiedź (kształt fabryki testowej)", () => {
    expect(parseEventParticipantOptions(RAW)).toEqual(makeEventParticipantOptions());
  });

  it("brak/zły typ flagi = funkcja wyłączona; liczby wracają do DEFAULT-ów", () => {
    const parsed = parseEventParticipantOptions({
      ok: true,
      event_id: "e1",
      calendar_export_enabled: "true",
      reminder_event_leads_minutes: [60, "15", 30.5],
      session_reminder_lead_minutes: "15",
      refund_mode: "partial",
      refund_deadline_hours: null,
      waitlist_offer_hours: 1.5,
      timezone: "",
    });
    expect(parsed).toMatchObject({
      eventId: "e1",
      timezone: "Europe/Warsaw",
      startsAt: null,
      calendarExportEnabled: false,
      remindersEnabled: false,
      transferEnabled: false,
      certificateEnabled: false,
      surveyEnabled: false,
      reminderEventLeadsMinutes: [60],
      sessionReminderLeadMinutes: 15,
      refundMode: "none",
      refundDeadlineHours: 168,
      waitlistOfferHours: 24,
    });
  });

  // Moduł publiczny NIE importuje wartości domyślnych panelu (bundle strony
  // wydarzenia), więc liczby zapasowe są w nim przepisane. Ten test trzyma je
  // w parze z `DEFAULT_PARTICIPANT_SETTINGS`, który z kolei pilnuje parytet
  // z DDL tabeli - zmiana DEFAULT-u w migracji zapali oba testy, nie żaden.
  it("liczby zapasowe = DEFAULT_PARTICIPANT_SETTINGS (parytet z kolumnami)", () => {
    const parsed = parseEventParticipantOptions({ ok: true, event_id: "e1" });
    expect(parsed).toMatchObject({
      sessionReminderLeadMinutes: DEFAULT_PARTICIPANT_SETTINGS.sessionReminderLeadMinutes,
      refundDeadlineHours: DEFAULT_PARTICIPANT_SETTINGS.refundDeadlineHours,
      waitlistOfferHours: DEFAULT_PARTICIPANT_SETTINGS.waitlistOfferHours,
    });
  });

  it("wyprzedzenia spoza tablicy = brak przypomnień o wydarzeniu", () => {
    expect(
      parseEventParticipantOptions({ ok: true, event_id: "e1", reminder_event_leads_minutes: 60 })
        ?.reminderEventLeadsMinutes,
    ).toEqual([]);
  });

  it.each([null, "x", [], { ok: false }, { ok: "true", event_id: "e1" }, { ok: true }])(
    "zwraca null dla %j",
    (raw) => {
      expect(parseEventParticipantOptions(raw)).toBeNull();
    },
  );
});

describe("fetchEventParticipantOptions", () => {
  it("woła RPC ze slugiem", async () => {
    rpc.mockResolvedValue({ data: RAW, error: null });
    await expect(fetchEventParticipantOptions("forum-2030")).resolves.toEqual(
      makeEventParticipantOptions(),
    );
    expect(rpc).toHaveBeenCalledWith("event_participant_options", { p_slug: "forum-2030" });
  });

  it("`{ok:false}` -> null", async () => {
    rpc.mockResolvedValue({ data: { ok: false }, error: null });
    await expect(fetchEventParticipantOptions("draft")).resolves.toBeNull();
  });

  it("przenosi błąd RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("network") });
    await expect(fetchEventParticipantOptions("x")).rejects.toThrow("network");
  });
});
