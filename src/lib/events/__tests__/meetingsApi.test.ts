// Kontrakt payloadow gieldy spotkan 1-1 wobec funkcji bazy.
//
// DLACZEGO TEN TEST W OGOLE ISTNIEJE. Funkcje modulu przyjmuja JEDEN argument
// `p_payload jsonb` i czytaja z niego pola po nazwie. Postgres NIE ODRZUCA pola,
// ktorego nie zna - po prostu je pomija. Znaczy to, ze `window_starts_at` zamiast
// `day_start_time` nie konczy sie bledem, tylko formularzem, ktory zapisuje sie
// "poprawnie" i nie zmienia niczego. Taki blad przechodzi przez `tsc` (payload
// jest luznym obiektem), przez przeglad i przez interfejs (toast sukcesu jest
// prawdziwy). Lista nazw ponizej jest przepisana z definicji funkcji w bazie -
// zmiana kontraktu po stronie SQL ma tu polozyc test, a nie ekran organizatora.
//
// TESTUJEMY NAZWY KLUCZY, NIE WARTOSCI. Wartosc waliduje baza; nazwa jest jedyna
// rzecza, ktorej nikt po drodze nie sprawdza.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/meetingsApi");

/** Klucze, ktore dana funkcja bazy CZYTA z `p_payload` (stan migracji 20260823190000). */
const KONTRAKT: Record<string, readonly string[]> = {
  admin_event_meeting_table_save: [
    "capacity",
    "event_id",
    "id",
    "is_active",
    "label",
    "note",
    "room_id",
    "sort_order",
    "zone",
  ],
  admin_event_meeting_settings_save: [
    "break_minutes",
    "day_end_time",
    "day_start_time",
    "event_id",
    "intro_en",
    "intro_pl",
    "invite_expires_after_hours",
    "invitee_group_ids",
    "invites_close_at",
    "invites_open_at",
    "is_enabled",
    "max_invites_per_person",
    "max_meetings_per_day",
    "meeting_days",
    "requester_group_ids",
    "slot_minutes",
    "timezone",
    "visibility",
  ],
  admin_event_meetings_list: [
    "day",
    "event_id",
    "from",
    "group_id",
    "limit",
    "offset",
    "q",
    "sponsor_id",
    "status",
    "table_id",
    "to",
  ],
  admin_event_meeting_set_status: ["meeting_id", "reason", "status"],
  admin_event_meeting_free_slots: [
    "a_registration_id",
    "b_registration_id",
    "event_id",
    "from",
    "limit",
    "to",
  ],
  admin_event_meeting_arrange: [
    "event_id",
    "invitee_registration_id",
    "message",
    "requester_registration_id",
    "sponsor_id",
    "starts_at",
    "table_id",
    "topic",
  ],
  admin_event_meeting_availability_set: [
    "ends_at",
    "event_id",
    "id",
    "is_open",
    "note",
    "registration_id",
    "starts_at",
  ],
  event_meeting_exchange: ["event_id", "event_slug"],
  event_meeting_availability_set: [
    "ends_at",
    "event_id",
    "event_slug",
    "id",
    "is_open",
    "note",
    "starts_at",
  ],
  event_meeting_availability_delete: ["id"],
  event_meeting_free_slots: [
    "counterpart_registration_id",
    "event_id",
    "event_slug",
    "from",
    "limit",
    "to",
  ],
  event_meeting_invite: [
    "counterpart_registration_id",
    "event_id",
    "event_slug",
    "message",
    "sponsor_id",
    "starts_at",
    "topic",
  ],
  event_meeting_respond: ["decision", "decline_reason", "meeting_id", "table_id"],
  event_meeting_cancel: ["meeting_id", "reason"],
  event_meeting_reschedule: ["meeting_id", "message", "starts_at"],
  event_meetings_mine: ["event_id", "event_slug", "limit", "status"],
};

function wyslanePola(nazwa: string): string[] {
  const call = h.rpc?.lastCall(nazwa);
  expect(call, `brak wywołania RPC ${nazwa}`).toBeDefined();
  const p = call?.arg("p_payload");
  expect(p && typeof p === "object", `${nazwa}: payload nie jest obiektem`).toBe(true);
  return Object.keys(p as Record<string, unknown>).sort();
}

/** Zbior kluczy funkcji - do sprawdzenia, ze klient nie wysyla nazwy spoza kontraktu. */
function poza(nazwa: string, wyslane: string[]): string[] {
  const znane = new Set(KONTRAKT[nazwa]);
  return wyslane.filter((k) => !znane.has(k));
}

describe("meetingsApi - kontrakt payloadów", () => {
  beforeEach(() => {
    h.rpc = supabaseRpcStub();
    for (const nazwa of Object.keys(KONTRAKT)) h.rpc.setData(nazwa, []);
    h.rpc.setData("admin_event_meeting_settings_save", { configured: true });
    h.rpc.setData("admin_event_meeting_table_save", "11111111-1111-1111-1111-111111111111");
    h.rpc.setData("admin_event_meeting_availability_set", "22222222-2222-2222-2222-222222222222");
    h.rpc.setData("event_meeting_availability_set", "33333333-3333-3333-3333-333333333333");
  });

  it("konfiguracja giełdy wysyła wyłącznie pola, które czyta baza", async () => {
    await api.saveMeetingSettings({
      eventId: "e1",
      isEnabled: true,
      timezone: "Europe/Warsaw",
      slotMinutes: 20,
      breakMinutes: 5,
      dayStartTime: "09:00",
      dayEndTime: "17:00",
      meetingDays: ["2026-09-01"],
      invitesOpenAt: null,
      invitesCloseAt: null,
      inviteExpiresAfterHours: 72,
      maxInvitesPerPerson: 5,
      maxMeetingsPerDay: 8,
      visibility: "groups",
      introPl: "PL",
      introEn: "EN",
      requesterGroupIds: ["g1"],
      inviteeGroupIds: ["g2"],
    });
    const wyslane = wyslanePola("admin_event_meeting_settings_save");
    expect(poza("admin_event_meeting_settings_save", wyslane)).toEqual([]);
    expect(wyslane).toContain("day_start_time");
    expect(wyslane).toContain("meeting_days");
    expect(wyslane).toContain("visibility");
  });

  it("pominięte grupy nie trafiają do payloadu (zachowaj obecny przydział)", async () => {
    await api.saveMeetingSettings({
      eventId: "e1",
      isEnabled: true,
      timezone: "Europe/Warsaw",
      slotMinutes: 20,
      breakMinutes: 5,
      dayStartTime: "09:00",
      dayEndTime: "17:00",
      meetingDays: [],
      invitesOpenAt: null,
      invitesCloseAt: null,
      inviteExpiresAfterHours: 72,
      maxInvitesPerPerson: null,
      maxMeetingsPerDay: null,
      visibility: "everyone",
      introPl: "",
      introEn: "",
    });
    const wyslane = wyslanePola("admin_event_meeting_settings_save");
    expect(wyslane).not.toContain("requester_group_ids");
    expect(wyslane).not.toContain("invitee_group_ids");
  });

  it("stolik, lista, frekwencja i wolne terminy panelu trzymają kontrakt", async () => {
    await api.saveMeetingTable({
      id: null,
      eventId: "e1",
      label: "Stolik 12",
      zone: "Hala 2",
      roomId: null,
      capacity: 1,
      note: null,
      sortOrder: 10,
      isActive: true,
    });
    expect(poza("admin_event_meeting_table_save", wyslanePola("admin_event_meeting_table_save"))).toEqual([]);

    await api.fetchAdminMeetings({ eventId: "e1", groupId: "g1", search: "kowalski" });
    const lista = wyslanePola("admin_event_meetings_list");
    expect(poza("admin_event_meetings_list", lista)).toEqual([]);
    expect(lista).toContain("group_id");
    expect(lista).toContain("q");

    await api.setMeetingStatus({ meetingId: "m1", status: "held" });
    expect(poza("admin_event_meeting_set_status", wyslanePola("admin_event_meeting_set_status"))).toEqual([]);

    await api.fetchAdminFreeSlots({ eventId: "e1", aRegistrationId: "r1", bRegistrationId: "r2" });
    const sloty = wyslanePola("admin_event_meeting_free_slots");
    expect(poza("admin_event_meeting_free_slots", sloty)).toEqual([]);
    expect(sloty).toContain("a_registration_id");
    expect(sloty).toContain("b_registration_id");

    await api.arrangeMeeting({
      eventId: "e1",
      requesterRegistrationId: "r1",
      inviteeRegistrationId: "r2",
      startsAt: "2026-09-01T09:00:00Z",
    });
    expect(poza("admin_event_meeting_arrange", wyslanePola("admin_event_meeting_arrange"))).toEqual([]);

    await api.saveAdminAvailability({
      eventId: "e1",
      registrationId: "r1",
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-01T12:00:00Z",
      isOpen: true,
    });
    expect(
      poza("admin_event_meeting_availability_set", wyslanePola("admin_event_meeting_availability_set")),
    ).toEqual([]);
  });

  it("płaszczyzna uczestnika nazywa drugą stronę tak, jak baza", async () => {
    await api.fetchMeetingExchange({ eventSlug: "kongres" });
    expect(poza("event_meeting_exchange", wyslanePola("event_meeting_exchange"))).toEqual([]);

    await api.fetchMyFreeSlots({ eventSlug: "kongres", counterpartRegistrationId: "r2" });
    const sloty = wyslanePola("event_meeting_free_slots");
    expect(poza("event_meeting_free_slots", sloty)).toEqual([]);
    expect(sloty).toContain("counterpart_registration_id");

    await api.inviteToMeeting({
      eventSlug: "kongres",
      counterpartRegistrationId: "r2",
      startsAt: "2026-09-01T09:00:00Z",
    });
    const zaproszenie = wyslanePola("event_meeting_invite");
    expect(poza("event_meeting_invite", zaproszenie)).toEqual([]);
    expect(zaproszenie).toContain("counterpart_registration_id");

    await api.respondToMeeting({ meetingId: "m1", decision: "accept" });
    expect(poza("event_meeting_respond", wyslanePola("event_meeting_respond"))).toEqual([]);

    await api.cancelMeeting({ meetingId: "m1", reason: "kolizja" });
    expect(poza("event_meeting_cancel", wyslanePola("event_meeting_cancel"))).toEqual([]);

    await api.rescheduleMeeting({ meetingId: "m1", startsAt: "2026-09-01T11:00:00Z" });
    expect(poza("event_meeting_reschedule", wyslanePola("event_meeting_reschedule"))).toEqual([]);

    await api.saveMyAvailability({
      eventSlug: "kongres",
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-01T12:00:00Z",
    });
    expect(poza("event_meeting_availability_set", wyslanePola("event_meeting_availability_set"))).toEqual([]);

    await api.deleteMyAvailability("a1");
    expect(poza("event_meeting_availability_delete", wyslanePola("event_meeting_availability_delete"))).toEqual([]);

    await api.fetchMyMeetings({ eventSlug: "kongres", status: "accepted" });
    expect(poza("event_meetings_mine", wyslanePola("event_meetings_mine"))).toEqual([]);
  });
});
