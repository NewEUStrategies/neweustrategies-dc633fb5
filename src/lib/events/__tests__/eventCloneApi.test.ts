// Warstwa danych KLONU EDYCJI - kontrakt RPC i parsery `jsonb`.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. PRZEMIANOWANY KLUCZ ŁADUNKU. `include.sponsorMaterials` jedzie do bazy
//      jako `sponsor_materials`; literówka w mapie przechodzi przez `tsc`
//      (ładunek to `Json`), a baza bierze wtedy wartość DOMYŚLNĄ - organizator
//      wyłącza sekcję, a kopia i tak ją kopiuje.
//   2. PUSTE POLE WYSŁANE JAKO `""`. Pole pominięte znaczy „weź ze źródła";
//      pusty napis znaczy „wyczyść" - adres zapisów zewnętrznych wysłany jako
//      `""` kończy się odmową `external_url_required`.
//   3. PARSER, KTÓRY WYWRACA EKRAN. `jsonb` z bazy jest nietypowany: liczba
//      zapisana napisem, brak daty, obcy element listy ostrzeżeń - każdy z nich
//      ma zdegradować do zera albo `null`, a nie rzucić w renderze.
//   4. CHWILA W INNYM KSZTAŁCIE NIŻ KALENDARZ. Baza oddaje `+01:00`, kalendarz
//      panelu czyta ISO w UTC - nieznormalizowana chwila pokazuje się jako pusta.
//   5. BŁĄD BEZ GŁOWY. Odmowa musi wyjść jako `Error(message)` z głową plpgsql
//      (`slug_taken: …`), bo tylko z niej mapa błędów zbuduje zdanie.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { freezeClock } from "@/test/time";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import {
  CLONE_NEW_ID,
  CLONE_SOURCE_ID,
  clonePreviewJson,
} from "@/test/events/eventCloneFixtures";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args),
  },
}));

const api = await import("@/lib/events/eventCloneApi");

freezeClock();

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const ALL_ON = Object.fromEntries(api.CLONE_INCLUDE_KEYS.map((key) => [key, true])) as Record<
  (typeof api.CLONE_INCLUDE_KEYS)[number],
  boolean
>;

describe("clonePayload - ładunek p_payload", () => {
  it("minimalne wejście niesie wyłącznie źródło (reszta = wartości bazy)", () => {
    expect(api.clonePayload({ sourceEventId: CLONE_SOURCE_ID })).toEqual({
      source_event_id: CLONE_SOURCE_ID,
    });
  });

  it("pełne wejście: snake_case, przełączniki i opcje po NAZWACH Z SQL", () => {
    const payload = api.clonePayload({
      sourceEventId: CLONE_SOURCE_ID,
      titlePl: "Kongres 2027",
      titleEn: "Congress 2027",
      startsAt: "2100-03-20T08:00:00.000Z",
      endsAt: "2100-03-21T17:00:00.000Z",
      timezone: "Europe/London",
      slug: "kongres-2027",
      externalRegistrationUrl: "https://tickets.example.org/2027",
      idempotencyKey: "event.clone:abc-123",
      include: { ...ALL_ON, sponsorMaterials: false },
      options: {
        includeCancelledSessions: true,
        sessionsAsDraft: false,
        sponsorsUnpublished: true,
        keepAccessCodes: false,
        refreshSponsorSnapshots: true,
        crmRenewalTasks: true,
        cfpReviewers: false,
        codeSuffix: "-2027",
        crmTaskDueDays: 14,
      },
    });
    expect(payload).toMatchObject({
      source_event_id: CLONE_SOURCE_ID,
      title_pl: "Kongres 2027",
      title_en: "Congress 2027",
      starts_at: "2100-03-20T08:00:00.000Z",
      ends_at: "2100-03-21T17:00:00.000Z",
      timezone: "Europe/London",
      slug: "kongres-2027",
      external_registration_url: "https://tickets.example.org/2027",
      idempotency_key: "event.clone:abc-123",
    });
    expect(payload.include).toEqual({
      agenda: true,
      speakers: true,
      registration: true,
      tickets: true,
      sponsors: true,
      sponsor_materials: false,
      home_ads: true,
      pages: true,
      onsite: true,
      meetings: true,
      cfp: true,
      seating: true,
      ad_campaigns: true,
      codes: true,
    });
    expect(payload.options).toEqual({
      include_cancelled_sessions: true,
      sessions_as_draft: false,
      sponsors_unpublished: true,
      keep_access_codes: false,
      refresh_sponsor_snapshots: true,
      crm_renewal_tasks: true,
      cfp_reviewers: false,
      code_suffix: "-2027",
      crm_task_due_days: 14,
    });
  });

  it("przyrostek `null` nie jedzie (baza: brak przyrostka), termin zadań jedzie zawsze", () => {
    const payload = api.clonePayload({
      sourceEventId: CLONE_SOURCE_ID,
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
    });
    expect(payload.options).not.toHaveProperty("code_suffix");
    expect(payload.options).toHaveProperty("crm_task_due_days", 30);
    expect(payload).not.toHaveProperty("include");
  });
});

describe("parseClonePreview - odporność na nietypowany jsonb", () => {
  it("normalizuje chwile do ISO w UTC i czyta pola źródła, celu i przesunięcia", () => {
    const preview = api.parseClonePreview(clonePreviewJson());
    expect(preview.source).toEqual({
      id: CLONE_SOURCE_ID,
      slug: "kongres-2026",
      titlePl: "Kongres 2026",
      titleEn: "Congress 2026",
      startsAt: "2099-03-20T08:00:00.000Z",
      endsAt: null,
      timezone: "Europe/Warsaw",
      status: "published",
      registrationMode: "external",
      externalRegistrationUrl: "https://tickets.example.org/2026",
    });
    expect(preview.target).toEqual({
      startsAt: "2100-03-20T08:00:00.000Z",
      endsAt: "2100-03-21T17:00:00.000Z",
      timezone: "Europe/Warsaw",
      suggestedStartsAt: "2100-03-20T08:00:00.000Z",
      slug: "kongres-2027",
      slugValid: false,
      slugAvailable: true,
    });
    expect(preview.shift).toEqual({
      delta: "365 days",
      dayShift: 365,
      sourceTz: "Europe/Warsaw",
      timezone: "Europe/Warsaw",
    });
  });

  it("przełącznik jest włączony WYŁĄCZNIE dla logicznego `true` (napis „tak” to wyłączony)", () => {
    const preview = api.parseClonePreview(clonePreviewJson());
    expect(preview.include.agenda).toBe(true);
    expect(preview.include.sponsorMaterials).toBe(true);
    expect(preview.include.homeAds).toBe(false);
    expect(preview.include.codes).toBe(false);
    expect(preview.include.tickets).toBe(false);
    expect(preview.options).toMatchObject({
      includeCancelledSessions: true,
      refreshSponsorSnapshots: false,
      codeSuffix: "-2027",
      crmTaskDueDays: 14,
    });
  });

  it("liczniki nie-liczbowe są zerem, zła data jest null, obce elementy listy ostrzeżeń odpadają", () => {
    const preview = api.parseClonePreview(clonePreviewJson());
    expect(preview.counts).toEqual({ sessions: 4, rooms: 0 });
    expect(preview.notCopied).toEqual({ registrations: 12 });
    expect(preview.dates).toEqual({
      rsvpOpensAt: "2100-02-01T08:00:00.000Z",
      salesFrom: null,
      salesTo: null,
      cfpOpensAt: null,
      cfpClosesAt: null,
      meetingDaysFirst: "2100-03-20",
      meetingDaysLast: null,
      firstSessionStartsAt: "2100-03-20T08:30:00.000Z",
      lastSessionEndsAt: null,
    });
    expect(preview.warnings).toEqual([
      { code: "sales_closed", count: 2 },
      { code: "type_inactive", count: 0 },
    ]);
    expect(preview.blockers).toEqual([{ code: "sessions_outside_window", count: 3 }]);
  });

  it("odpowiedź bez obiektu (null, tablica) daje pusty, ale RENDEROWALNY podgląd", () => {
    for (const raw of [null, [], "tekst"]) {
      const preview = api.parseClonePreview(raw);
      expect(preview.source.id).toBe("");
      expect(preview.target.slugValid).toBe(true);
      expect(preview.target.suggestedStartsAt).toBeNull();
      expect(preview.shift.dayShift).toBe(0);
      expect(preview.options.codeSuffix).toBeNull();
      expect(preview.warnings).toEqual([]);
      expect(preview.counts).toEqual({});
    }
  });
});

describe("parseCloneResult", () => {
  it("czyta identyfikatory, powtórkę, przesunięcie, liczniki i ostrzeżenia", () => {
    const result = api.parseCloneResult({
      event_id: CLONE_NEW_ID,
      slug: "kongres-2027",
      source_event_id: CLONE_SOURCE_ID,
      replayed: true,
      shift: { delta: "364 days", day_shift: 364, source_tz: "Europe/Warsaw", timezone: "UTC" },
      copied: { sessions: 3 },
      skipped: { registrations: 5 },
      warnings: [{ code: "starts_in_past", count: 1 }],
    });
    expect(result).toEqual({
      eventId: CLONE_NEW_ID,
      slug: "kongres-2027",
      sourceEventId: CLONE_SOURCE_ID,
      replayed: true,
      shift: { delta: "364 days", dayShift: 364, sourceTz: "Europe/Warsaw", timezone: "UTC" },
      copied: { sessions: 3 },
      skipped: { registrations: 5 },
      warnings: [{ code: "starts_in_past", count: 1 }],
    });
  });

  it("powtórka tylko dla logicznego `true`; pusty wynik nie rzuca", () => {
    expect(api.parseCloneResult({ replayed: "true" }).replayed).toBe(false);
    expect(api.parseCloneResult(null)).toMatchObject({ eventId: "", copied: {}, warnings: [] });
  });
});

describe("wywołania RPC", () => {
  it("previewEventClone woła admin_event_clone_preview z JEDNYM argumentem p_payload", async () => {
    h.rpc!.setData("admin_event_clone_preview", clonePreviewJson());
    const preview = await api.previewEventClone({ sourceEventId: CLONE_SOURCE_ID, titlePl: "X" });
    const call = h.rpc!.lastCall("admin_event_clone_preview");
    expect(call?.keys()).toEqual(["p_payload"]);
    expect(call?.arg("p_payload")).toEqual({ source_event_id: CLONE_SOURCE_ID, title_pl: "X" });
    expect(preview.source.slug).toBe("kongres-2026");
  });

  it("requestClonePreview przekazuje gotowy ładunek bez zmian", async () => {
    h.rpc!.setData("admin_event_clone_preview", {});
    await api.requestClonePreview({ source_event_id: CLONE_SOURCE_ID, slug: "a-b-c" });
    expect(h.rpc!.lastCall("admin_event_clone_preview")?.arg("p_payload")).toEqual({
      source_event_id: CLONE_SOURCE_ID,
      slug: "a-b-c",
    });
  });

  it("cloneEvent woła admin_event_clone i parsuje wynik", async () => {
    h.rpc!.setData("admin_event_clone", { event_id: CLONE_NEW_ID, source_event_id: CLONE_SOURCE_ID });
    const result = await api.cloneEvent({ sourceEventId: CLONE_SOURCE_ID, idempotencyKey: "k:1" });
    expect(h.rpc!.lastCall("admin_event_clone")?.arg("p_payload")).toEqual({
      source_event_id: CLONE_SOURCE_ID,
      idempotency_key: "k:1",
    });
    expect(result.eventId).toBe(CLONE_NEW_ID);
  });

  it("odmowa bazy wychodzi jako Error z głową plpgsql", async () => {
    h.rpc!.setError("admin_event_clone", "slug_taken: another event already uses this address");
    await expect(api.cloneEvent({ sourceEventId: CLONE_SOURCE_ID })).rejects.toThrow(/^slug_taken:/);
    h.rpc!.setError("admin_event_clone_preview", "invalid_timezone: unknown time zone name");
    await expect(api.previewEventClone({ sourceEventId: CLONE_SOURCE_ID })).rejects.toThrow(
      "invalid_timezone: unknown time zone name",
    );
  });

  it("fetchEventEditions: p_event_id, pusta odpowiedź = pusta lista, odmowa = Error", async () => {
    h.rpc!.setData("admin_event_editions", [{ id: CLONE_NEW_ID, relation: "next" }]);
    expect(await api.fetchEventEditions(CLONE_SOURCE_ID)).toEqual([
      { id: CLONE_NEW_ID, relation: "next" },
    ]);
    expect(h.rpc!.lastCall("admin_event_editions")?.arg("p_event_id")).toBe(CLONE_SOURCE_ID);
    h.rpc!.setData("admin_event_editions", null);
    expect(await api.fetchEventEditions(CLONE_SOURCE_ID)).toEqual([]);
    h.rpc!.setError("admin_event_editions", "forbidden: admin role required");
    await expect(api.fetchEventEditions(CLONE_SOURCE_ID)).rejects.toThrow("forbidden");
  });

  it("searchCloneSources: fraza, limit dziesięciu wyników, strona pierwsza", async () => {
    h.rpc!.setData("admin_events_list", [{ id: CLONE_SOURCE_ID }]);
    expect(await api.searchCloneSources("kongres")).toEqual([{ id: CLONE_SOURCE_ID }]);
    const call = h.rpc!.lastCall("admin_events_list");
    expect(call?.args).toEqual({ p_q: "kongres", p_limit: 10, p_offset: 0 });
    h.rpc!.setData("admin_events_list", null);
    expect(await api.searchCloneSources("kongres")).toEqual([]);
    h.rpc!.setError("admin_events_list", "forbidden: admin role required");
    await expect(api.searchCloneSources("kongres")).rejects.toThrow("forbidden");
  });
});
