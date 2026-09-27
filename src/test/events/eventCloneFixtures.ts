// Fikstury KLONU EDYCJI: podglad i wynik w ksztalcie po parserze
// (`EventClonePreview`, `EventCloneResult`) oraz surowy `jsonb` z RPC.
//
// DLACZEGO DWA KSZTALTY. Testy warstwy danych dowodza PARSERA, wiec dostaja
// surowy `jsonb` (snake_case, chwile z przesunieciem strefy). Testy
// komponentow dowodza EKRANU, wiec dostaja gotowy obiekt - przepuszczanie ich
// przez parser mieszaloby dwie odpowiedzialnosci w jednym bledzie.
//
// Pliki importujace te fikstury zamrazaja zegar (`freezeClock`) - daty ponizej
// sa literalami (bramka `check:clock-freeze`).
import type { EventClonePreview, EventCloneResult } from "@/lib/events/eventCloneApi";

export const CLONE_SOURCE_ID = "5e5e5e5e-0000-4000-8000-000000000001";
export const CLONE_NEW_ID = "5e5e5e5e-0000-4000-8000-000000000002";

/** Podglad zrodla po parserze: "Kongres 2026" w Warszawie, domyslne przelaczniki. */
export function clonePreview(overrides: Partial<EventClonePreview> = {}): EventClonePreview {
  return {
    source: {
      id: CLONE_SOURCE_ID,
      slug: "kongres-2026",
      titlePl: "Kongres 2026",
      titleEn: "Congress 2026",
      startsAt: "2099-03-20T08:00:00.000Z",
      endsAt: "2099-03-21T17:00:00.000Z",
      timezone: "Europe/Warsaw",
      status: "published",
      registrationMode: "form",
      externalRegistrationUrl: null,
    },
    target: {
      startsAt: "2100-03-20T08:00:00.000Z",
      endsAt: "2100-03-21T17:00:00.000Z",
      timezone: "Europe/Warsaw",
      suggestedStartsAt: "2100-03-20T08:00:00.000Z",
      slug: "kongres-2027",
      slugValid: true,
      slugAvailable: true,
    },
    shift: {
      delta: "365 days",
      dayShift: 365,
      sourceTz: "Europe/Warsaw",
      timezone: "Europe/Warsaw",
    },
    include: {
      agenda: true,
      speakers: true,
      registration: true,
      tickets: true,
      sponsors: true,
      sponsorMaterials: false,
      homeAds: false,
      pages: true,
      onsite: true,
      meetings: true,
      cfp: true,
      seating: true,
      adCampaigns: false,
      codes: false,
    },
    options: {
      includeCancelledSessions: false,
      sessionsAsDraft: false,
      sponsorsUnpublished: true,
      keepAccessCodes: false,
      refreshSponsorSnapshots: true,
      crmRenewalTasks: false,
      cfpReviewers: false,
      codeSuffix: null,
      crmTaskDueDays: 30,
    },
    counts: {
      rooms: 2,
      tracks: 1,
      sessions: 4,
      speakers: 2,
      sponsors: 2,
      renewal_contacts: 2,
      participant_settings: 1,
    },
    notCopied: { registrations: 12, scanner_devices: 1, session_saves: 3, wallet_passes: 2 },
    dates: {
      rsvpOpensAt: "2100-02-01T08:00:00.000Z",
      salesFrom: "2100-01-10T11:00:00.000Z",
      salesTo: null,
      cfpOpensAt: null,
      cfpClosesAt: null,
      meetingDaysFirst: "2100-03-20",
      meetingDaysLast: "2100-03-21",
      firstSessionStartsAt: "2100-03-20T08:30:00.000Z",
      lastSessionEndsAt: "2100-03-21T16:30:00.000Z",
    },
    warnings: [{ code: "sponsors_unpublished", count: 2 }],
    blockers: [],
    ...overrides,
  };
}

/** Wynik klonu po parserze. */
export function cloneResult(overrides: Partial<EventCloneResult> = {}): EventCloneResult {
  return {
    eventId: CLONE_NEW_ID,
    slug: "kongres-2027",
    sourceEventId: CLONE_SOURCE_ID,
    replayed: false,
    shift: {
      delta: "365 days",
      dayShift: 365,
      sourceTz: "Europe/Warsaw",
      timezone: "Europe/Warsaw",
    },
    copied: { sessions: 3, rooms: 2, crm_tasks: 0, participant_settings: 1 },
    skipped: { sessions: 1, registrations: 12, session_signups: 4 },
    warnings: [{ code: "cancelled_sessions_skipped", count: 1 }],
    ...overrides,
  };
}

/** Surowy `jsonb` podgladu (ksztalt `admin_event_clone_preview`). */
export function clonePreviewJson(): Record<string, unknown> {
  return {
    source: {
      id: CLONE_SOURCE_ID,
      slug: "kongres-2026",
      title_pl: "Kongres 2026",
      title_en: "Congress 2026",
      starts_at: "2099-03-20T09:00:00+01:00",
      ends_at: null,
      timezone: "Europe/Warsaw",
      status: "published",
      registration_mode: "external",
      external_registration_url: "https://tickets.example.org/2026",
    },
    target: {
      starts_at: "2100-03-20T09:00:00+01:00",
      ends_at: "2100-03-21T18:00:00+01:00",
      timezone: "Europe/Warsaw",
      suggested_starts_at: "2100-03-20T09:00:00+01:00",
      slug: "kongres-2027",
      slug_valid: false,
      slug_available: true,
    },
    shift: {
      delta: "365 days",
      day_shift: 365,
      source_tz: "Europe/Warsaw",
      timezone: "Europe/Warsaw",
    },
    include: { agenda: true, sponsor_materials: true, home_ads: "tak", codes: false },
    options: {
      include_cancelled_sessions: true,
      refresh_sponsor_snapshots: false,
      code_suffix: "-2027",
      crm_task_due_days: 14,
    },
    counts: { sessions: 4, rooms: "dwa" },
    not_copied: { registrations: 12 },
    dates: {
      rsvp_opens_at: "2100-02-01T09:00:00+01:00",
      sales_from: "nie-data",
      meeting_days_first: "2100-03-20",
      meeting_days_last: "",
      first_session_starts_at: "2100-03-20T09:30:00+01:00",
    },
    warnings: [{ code: "sales_closed", count: 2 }, { code: 5 }, "tekst", { code: "type_inactive" }],
    blockers: [{ code: "sessions_outside_window", count: 3 }],
  };
}
