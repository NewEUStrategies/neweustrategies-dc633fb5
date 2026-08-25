// Kontrakt payloadow panelu agendy wobec funkcji bazy.
//
// DLACZEGO TEN TEST ISTNIEJE. `admin_event_session_save` czyta pola po nazwie i
// NIE ODRZUCA pola, ktorego nie zna. `session_id` zamiast `id` nie konczy sie
// bledem, tylko utworzeniem DRUGIEJ sesji przy „edycji", z prawdziwym toastem
// sukcesu. Ta pomylka przechodzi przez `tsc`, przez przeglad i przez interfejs.
//
// DRUGI POWOD: rozroznienie „brak klucza" od „jawny null". Sesja bez sali i
// sesja z sala niezmieniona to dwa rozne zamiary, a w JSON-ie roznia sie
// wylacznie obecnoscia klucza.
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

const api = await import("@/lib/events/sessionsApi");

/** Klucze CZYTANE przez funkcje bazy (stan migracji 20260823140000). */
const KONTRAKT: Record<string, readonly string[]> = {
  admin_event_session_save: [
    "allow_overlap",
    "capacity",
    "chatham_house",
    "description_en",
    "description_pl",
    "ends_at",
    "event_id",
    "format",
    "id",
    "is_private",
    "min_tier_rank",
    "parent_session_id",
    "recording_url",
    "requires_signup",
    "room_id",
    "sort_order",
    "starts_at",
    "status",
    "stream_url",
    "title_en",
    "title_pl",
    "track_id",
  ],
  admin_event_track_save: [
    "accent_color",
    "event_id",
    "id",
    "is_active",
    "key",
    "name_en",
    "name_pl",
    "sort_order",
  ],
  admin_event_room_save: [
    "capacity",
    "event_id",
    "floor",
    "id",
    "is_active",
    "location_note",
    "name",
    "sort_order",
  ],
  admin_event_sessions_reorder: ["items"],
  admin_event_sessions_set_status: ["ids", "status"],
  admin_event_session_speakers_set: ["session_id", "speakers"],
  admin_event_session_signup_set: ["force", "session_id", "status", "user_id"],
};

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function payloadOf(name: string): Record<string, unknown> {
  const call = h.rpc?.lastCall(name);
  expect(call, `brak wywołania RPC ${name}`).toBeDefined();
  const p = call?.arg("p_payload");
  expect(p !== null && typeof p === "object", `${name}: payload nie jest obiektem`).toBe(true);
  return p as Record<string, unknown>;
}

function outsideContract(name: string, sent: string[]): string[] {
  const known = new Set(KONTRAKT[name]);
  return sent.filter((key) => !known.has(key));
}

const session: import("@/lib/events/sessionsApi").EventSessionInput = {
  id: null,
  eventId: EVENT,
  titlePl: "Panel otwarcia",
  titleEn: "Opening panel",
  descriptionPl: "",
  descriptionEn: "",
  startsAt: "2026-09-01T08:00:00.000Z",
  endsAt: "2026-09-01T09:00:00.000Z",
  format: "onsite",
  status: "draft",
  trackId: null,
  roomId: null,
  parentSessionId: null,
  requiresSignup: true,
  capacity: 80,
  minTierRank: 0,
  chathamHouse: false,
  isPrivate: false,
  allowOverlap: true,
  streamUrl: null,
  recordingUrl: null,
  sortOrder: 100,
};

describe("sessionsApi - kontrakt payloadów", () => {
  beforeEach(() => {
    h.rpc = supabaseRpcStub();
    for (const name of Object.keys(KONTRAKT)) h.rpc.setData(name, ID);
    h.rpc.setData("admin_event_sessions_reorder", 4);
    h.rpc.setData("admin_event_sessions_set_status", 2);
    h.rpc.setData("admin_event_session_speakers_set", 3);
    h.rpc.setData("admin_event_session_signup_set", { status: "registered" });
    h.rpc.setData("admin_event_sessions_list", []);
    h.rpc.setData("admin_event_tracks_list", []);
    h.rpc.setData("admin_event_rooms_list", []);
    h.rpc.setData("admin_event_session_signups_list", []);
    h.rpc.setData("admin_event_agenda_conflicts", []);
    h.rpc.setData("admin_event_session_detail", []);
  });

  it("nowa sesja wysyła wydarzenie, edycja już nie", async () => {
    await api.saveEventSession(session);
    const created = Object.keys(payloadOf("admin_event_session_save")).sort();
    expect(outsideContract("admin_event_session_save", created)).toEqual([]);
    expect(created).toContain("event_id");
    expect(created).not.toContain("id");

    await api.saveEventSession({ ...session, id: ID });
    const edited = Object.keys(payloadOf("admin_event_session_save"));
    // `event_immutable`: przeniesienie sesji do innego wydarzenia jest odmawiane.
    expect(edited).not.toContain("event_id");
    expect(edited).toContain("id");
  });

  it("`capacity: null` jest WYSYŁANE jako null, bo zdejmuje limit miejsc", async () => {
    await api.saveEventSession({ ...session, id: ID, capacity: null });
    const p = payloadOf("admin_event_session_save");
    expect("capacity" in p).toBe(true);
    expect(p.capacity).toBeNull();
  });

  it("odczepienie sesji od sali wysyła jawny null", async () => {
    await api.saveEventSession({ ...session, id: ID, roomId: null, trackId: null });
    const p = payloadOf("admin_event_session_save");
    expect(p.room_id).toBeNull();
    expect(p.track_id).toBeNull();
  });

  it("ścieżka: klucz tylko przy tworzeniu, bo po zapisie jest niezmienny", async () => {
    const track: import("@/lib/events/sessionsApi").EventTrackInput = {
      id: null,
      eventId: EVENT,
      key: "policy",
      namePl: "Polityka",
      nameEn: "Policy",
      accentColor: "#FA9346",
      sortOrder: 100,
      isActive: true,
    };
    await api.saveEventTrack(track);
    const created = Object.keys(payloadOf("admin_event_track_save")).sort();
    expect(outsideContract("admin_event_track_save", created)).toEqual([]);
    expect(created).toContain("key");

    await api.saveEventTrack({ ...track, id: ID, key: "ignored" });
    const edited = Object.keys(payloadOf("admin_event_track_save"));
    expect(edited).not.toContain("key");
    expect(edited).not.toContain("event_id");
  });

  it("sala: pełny kontrakt i brak pojemności jako jawny null", async () => {
    await api.saveEventRoom({
      id: ID,
      eventId: EVENT,
      name: "Sala A",
      capacity: null,
      floor: null,
      locationNote: null,
      sortOrder: 100,
      isActive: true,
    });
    const p = payloadOf("admin_event_room_save");
    expect(outsideContract("admin_event_room_save", Object.keys(p).sort())).toEqual([]);
    expect(p.capacity).toBeNull();
  });

  it("przestawianie kolejności wysyła tablicę {id, sort_order}", async () => {
    const count = await api.reorderSessions([
      { id: ID, sortOrder: 10 },
      { id: USER, sortOrder: 20 },
    ]);
    expect(count).toBe(4);
    const p = payloadOf("admin_event_sessions_reorder");
    expect(p.items).toEqual([
      { id: ID, sort_order: 10 },
      { id: USER, sort_order: 20 },
    ]);
  });

  it("zbiorcza zmiana stanu wysyła identyfikatory i stan", async () => {
    const count = await api.setSessionsStatus({ ids: [ID], status: "published" });
    expect(count).toBe(2);
    const p = payloadOf("admin_event_sessions_set_status");
    expect(p.ids).toEqual([ID]);
    expect(p.status).toBe("published");
  });

  it("obsada jest podmieniana w całości, z rolą i zgodą na nachodzenie", async () => {
    await api.setSessionSpeakers(ID, [
      { speakerProfileId: USER, role: "moderator", sortOrder: 10, allowOverlap: true },
    ]);
    const p = payloadOf("admin_event_session_speakers_set");
    expect(p.session_id).toBe(ID);
    expect(p.speakers).toEqual([
      { speaker_profile_id: USER, role: "moderator", sort_order: 10, allow_overlap: true },
    ]);
  });

  it("zapis na sesję ponad limit wysyła jawną zgodę organizatora", async () => {
    await api.setSessionSignup({ sessionId: ID, userId: USER, status: "registered", force: true });
    const p = payloadOf("admin_event_session_signup_set");
    expect(Object.keys(p).sort()).toEqual(["force", "session_id", "status", "user_id"]);
    expect(p.force).toBe(true);
  });

  it("filtr listy: `all` nie jest wysyłane jako stan", async () => {
    await api.fetchEventSessions({
      eventId: EVENT,
      status: "all",
      trackId: null,
      roomId: null,
      q: "  ",
    });
    const call = h.rpc?.lastCall("admin_event_sessions_list");
    expect(call?.has("p_status")).toBe(false);
    expect(call?.has("p_track_id")).toBe(false);
    expect(call?.has("p_q")).toBe(false);
    expect(call?.arg("p_event_id")).toBe(EVENT);
  });

  it("filtry wysyłają tylko wypełnione wartości", async () => {
    await api.fetchEventSessions({
      eventId: EVENT,
      status: "published",
      trackId: ID,
      roomId: USER,
      q: " otwarcie ",
    });
    const call = h.rpc?.lastCall("admin_event_sessions_list");
    expect(call?.arg("p_status")).toBe("published");
    expect(call?.arg("p_track_id")).toBe(ID);
    expect(call?.arg("p_room_id")).toBe(USER);
    expect(call?.arg("p_q")).toBe("otwarcie");
  });

  it("szczegół sesji bez wiersza oddaje null, nie undefined", async () => {
    expect(await api.fetchSessionDetail(ID)).toBeNull();
  });
});
