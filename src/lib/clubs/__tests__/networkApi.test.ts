// Sieć klubu (A33) - `networkApi.ts`, 304 linie, 0/17 funkcji do dziś.
//
// Ogłoszenia „szukam / oferuję", katalog ekspertów, obecność na spotkaniach,
// puls składu i „poznaj członka". Wszystko RPC-only, więc kontraktem jest
// nazwa funkcji i nazwy argumentów - patrz nagłówek `api.test.ts`.
//
// DWIE RZECZY MAJĄ TU WŁASNĄ LOGIKĘ PO STRONIE KLIENTA i to one są sednem
// tego pliku:
//
//   1. PRÓG FRAZY W KATALOGU EKSPERTÓW. `fetchClubExperts` odsiewa frazę
//      krótszą niż dwa znaki PRZED wysłaniem - nie dlatego, że jest brzydka,
//      tylko dlatego, że kosztuje pełne skanowanie ILIKE po trzech kolumnach
//      profilu, nie zawężając niczego sensownie. Próg jest zachowaniem, więc
//      ma być testem, a nie komentarzem.
//
//   2. PARSOWANIE `faces` W PULSIE SKŁADU. `club_roster_signal` oddaje twarze
//      jako jsonb, więc jest to JEDYNE miejsce w module, gdzie klient
//      naprawdę interpretuje surowe dane: wiersz bez `user_id` albo bez
//      `name` musi WYPAŚĆ, a nie wylądować w interfejsie jako pusty awatar
//      bez nazwiska.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/clubs/fixtures")).clubSupabaseMock,
);

import { CLUB_BASE_ISO, CLUB_IDS, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import {
  closeClubBoardNotice,
  createClubBoardNotice,
  deleteClubSpotlight,
  fetchClubBoardNotices,
  fetchClubEvent,
  fetchClubEventAttendees,
  fetchClubExpertiseAreas,
  fetchClubExperts,
  fetchClubRosterSignal,
  fetchClubSpotlight,
  fetchClubSpotlightHistory,
  fetchClubThreadExperts,
  fetchMyClubExpertise,
  pinClubSpotlight,
  pingClubThreadExpert,
  setMyClubExpertise,
} from "@/lib/clubs/networkApi";

beforeEach(() => resetClubRpc());

describe("tablica ogłoszeń", () => {
  it("domyślnie 8 pozycji od zera, bez filtrów", async () => {
    clubRpc.setData("club_board_notices_list", []);

    await fetchClubBoardNotices({ clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("club_board_notices_list")?.args).toEqual({
      p_club_id: CLUB_IDS.club,
      p_kind: undefined,
      p_topic: undefined,
      p_limit: 8,
      p_offset: 0,
      p_mine: undefined,
      p_include_closed: undefined,
    });
  });

  it("filtry rodzaju, obszaru i widoczności jadą pod swoimi nazwami", async () => {
    clubRpc.setData("club_board_notices_list", [{ id: "n1", total_count: 31 }]);

    const page = await fetchClubBoardNotices({
      clubId: CLUB_IDS.club,
      kind: "offering",
      topic: "energy",
      mine: true,
      includeClosed: true,
    });

    const call = clubRpc.lastCall("club_board_notices_list");
    expect(call?.arg("p_kind")).toBe("offering");
    expect(call?.arg("p_mine")).toBe(true);
    expect(call?.arg("p_include_closed")).toBe(true);
    expect(page.total).toBe(31);
  });

  it("null z bazy daje pustą stronę z sumą zero", async () => {
    clubRpc.setData("club_board_notices_list", null);
    expect(await fetchClubBoardNotices({ clubId: CLUB_IDS.club })).toEqual({ rows: [], total: 0 });
  });

  it("utworzenie ogłoszenia zwraca id i przekazuje okno ważności", async () => {
    clubRpc.setData("club_board_notice_create", "notice-1");

    const id = await createClubBoardNotice({
      clubId: CLUB_IDS.club,
      kind: "seeking",
      body: "Szukam danych o rynku mocy",
      topic: "energy",
      days: 30,
    });

    expect(id).toBe("notice-1");
    expect(clubRpc.lastCall("club_board_notice_create")?.arg("p_days")).toBe(30);
  });

  it("brak okna ważności zostawia decyzję bazie (serwerowy DEFAULT)", async () => {
    clubRpc.setData("club_board_notice_create", "notice-1");

    await createClubBoardNotice({ clubId: CLUB_IDS.club, kind: "seeking", body: "B" });

    expect(clubRpc.lastCall("club_board_notice_create")?.arg("p_days")).toBeUndefined();
  });

  it("zamknięcie ogłoszenia zwraca boolean", async () => {
    clubRpc.setData("club_board_notice_close", true);
    expect(await closeClubBoardNotice("notice-1")).toBe(true);

    clubRpc.setData("club_board_notice_close", "ok");
    expect(await closeClubBoardNotice("notice-1")).toBe(false);
  });
});

describe("deklaracje kompetencji", () => {
  it("odczyt spłaszcza wiersze do samych obszarów", async () => {
    clubRpc.setData("club_expertise_mine", [{ topic: "energy" }, { topic: "transport" }]);

    expect(await fetchMyClubExpertise(CLUB_IDS.club)).toEqual(["energy", "transport"]);
  });

  it("odczyt: null daje pustą listę", async () => {
    clubRpc.setData("club_expertise_mine", null);
    expect(await fetchMyClubExpertise(CLUB_IDS.club)).toEqual([]);
  });

  it("zapis ZASTĘPUJE cały zbiór - jedno wywołanie z pełną listą", async () => {
    clubRpc.setData("club_expertise_set", 2);
    const topics = ["energy", "transport"] as const;

    expect(await setMyClubExpertise(CLUB_IDS.club, topics)).toBe(2);
    expect(clubRpc.callsFor("club_expertise_set")).toHaveLength(1);
    const sent = clubRpc.lastCall("club_expertise_set")?.arg("p_topics");
    expect(sent).toEqual(["energy", "transport"]);
    expect(sent).not.toBe(topics);
  });

  it("zapis PUSTEJ listy to skasowanie deklaracji, nie brak zmiany", async () => {
    clubRpc.setData("club_expertise_set", 0);

    expect(await setMyClubExpertise(CLUB_IDS.club, [])).toBe(0);
    expect(clubRpc.lastCall("club_expertise_set")?.arg("p_topics")).toEqual([]);
  });

  it("zapis: null z bazy schodzi na zero", async () => {
    clubRpc.setData("club_expertise_set", null);
    expect(await setMyClubExpertise(CLUB_IDS.club, ["energy"])).toBe(0);
  });

  it("obszary kompetencji klubu: null daje pustą listę", async () => {
    clubRpc.setData("club_expertise_areas", null);
    expect(await fetchClubExpertiseAreas(CLUB_IDS.club)).toEqual([]);
  });
});

describe("katalog ekspertów - próg frazy", () => {
  it("fraza krótsza niż 2 znaki NIE jedzie jako filtr", async () => {
    clubRpc.setData("club_experts_list", []);

    for (const search of ["a", " ", "  x  ".slice(0, 3)]) {
      await fetchClubExperts({ clubId: CLUB_IDS.club, search });
      expect(clubRpc.lastCall("club_experts_list")?.arg("p_search")).toBeUndefined();
    }
  });

  it("fraza dwuznakowa już zawęża i jest przycięta", async () => {
    clubRpc.setData("club_experts_list", []);

    await fetchClubExperts({ clubId: CLUB_IDS.club, search: "  no  " });

    expect(clubRpc.lastCall("club_experts_list")?.arg("p_search")).toBe("no");
  });

  it("null i undefined w frazie zachowują się tak samo (brak filtra)", async () => {
    clubRpc.setData("club_experts_list", []);

    await fetchClubExperts({ clubId: CLUB_IDS.club, search: null });
    expect(clubRpc.lastCall("club_experts_list")?.arg("p_search")).toBeUndefined();

    await fetchClubExperts({ clubId: CLUB_IDS.club });
    expect(clubRpc.lastCall("club_experts_list")?.arg("p_search")).toBeUndefined();
  });

  it("domyślna strona to 24 pozycje, suma z wiersza", async () => {
    clubRpc.setData("club_experts_list", [{ user_id: "u", total_count: 55 }]);

    const page = await fetchClubExperts({ clubId: CLUB_IDS.club });

    expect(page.total).toBe(55);
    expect(clubRpc.lastCall("club_experts_list")?.arg("p_limit")).toBe(24);
  });

  it("null z bazy daje pustą stronę", async () => {
    clubRpc.setData("club_experts_list", null);
    expect(await fetchClubExperts({ clubId: CLUB_IDS.club })).toEqual({ rows: [], total: 0 });
  });
});

describe("eksperci wątku", () => {
  it("domyślnie sześć osób", async () => {
    clubRpc.setData("club_thread_experts", []);

    await fetchClubThreadExperts(CLUB_IDS.thread);

    expect(clubRpc.lastCall("club_thread_experts")?.arg("p_limit")).toBe(6);
  });

  it("zaproszenie eksperta do wątku zwraca boolean", async () => {
    clubRpc.setData("club_thread_expert_ping", true);

    expect(await pingClubThreadExpert(CLUB_IDS.thread, CLUB_IDS.member)).toBe(true);
    expect(clubRpc.lastCall("club_thread_expert_ping")?.arg("p_user_id")).toBe(CLUB_IDS.member);
  });

  it("null z bazy daje pustą listę ekspertów", async () => {
    clubRpc.setData("club_thread_experts", null);
    expect(await fetchClubThreadExperts(CLUB_IDS.thread)).toEqual([]);
  });
});

describe("wydarzenia klubu", () => {
  it("lista obecnych: domyślnie dwanaście twarzy", async () => {
    clubRpc.setData("club_event_attendees", null);

    expect(await fetchClubEventAttendees("ev-1")).toEqual([]);
    expect(clubRpc.lastCall("club_event_attendees")?.arg("p_limit")).toBe(12);
  });

  it("karta wydarzenia: brak wiersza to null (404, nie 403)", async () => {
    clubRpc.setData("club_event_view", []);
    expect(await fetchClubEvent(CLUB_IDS.club, "spotkanie")).toBeNull();

    clubRpc.setData("club_event_view", null);
    expect(await fetchClubEvent(CLUB_IDS.club, "spotkanie")).toBeNull();
  });

  it("karta wydarzenia: pierwszy wiersz jest wynikiem", async () => {
    clubRpc.setData("club_event_view", [{ id: "ev-1", slug: "spotkanie" }]);

    expect(await fetchClubEvent(CLUB_IDS.club, "spotkanie")).toMatchObject({ id: "ev-1" });
    expect(clubRpc.lastCall("club_event_view")?.arg("p_slug")).toBe("spotkanie");
  });
});

describe("puls składu - parsowanie twarzy z jsonb", () => {
  it("brak wiersza to null, nie pusty panel z zerami", async () => {
    clubRpc.setData("club_roster_signal", []);
    expect(await fetchClubRosterSignal(CLUB_IDS.club)).toBeNull();

    clubRpc.setData("club_roster_signal", null);
    expect(await fetchClubRosterSignal(CLUB_IDS.club)).toBeNull();
  });

  it("liczniki i twarze przechodzą do kształtu widoku", async () => {
    clubRpc.setData("club_roster_signal", [
      {
        members_total: 42,
        new_7d: 3,
        active_24h: 5,
        active_7d: 11,
        faces: [
          {
            user_id: CLUB_IDS.member,
            name: "Anna Nowak",
            avatar_url: null,
            slug: "anna-nowak",
            headline: "Analityk",
            role: "moderator",
            joined_at: CLUB_BASE_ISO,
            is_new: true,
            is_active: true,
            topics: ["energy"],
          },
        ],
      },
    ]);

    const signal = await fetchClubRosterSignal(CLUB_IDS.club);

    expect(signal).toMatchObject({ membersTotal: 42, new7d: 3, active24h: 5, active7d: 11 });
    expect(signal?.faces).toHaveLength(1);
    expect(signal?.faces[0]).toMatchObject({
      userId: CLUB_IDS.member,
      name: "Anna Nowak",
      role: "moderator",
      isNew: true,
      topics: ["energy"],
    });
  });

  it("twarz BEZ user_id albo BEZ name WYPADA z listy", async () => {
    clubRpc.setData("club_roster_signal", [
      {
        members_total: 3,
        new_7d: 0,
        active_24h: 0,
        active_7d: 0,
        faces: [
          { user_id: null, name: "Bez id" },
          { user_id: "u2", name: null },
          { user_id: "u3", name: "Poprawna" },
        ],
      },
    ]);

    // Wiersz bez tożsamości nie może wylądować w interfejsie jako pusty
    // awatar bez nazwiska - to jedyne miejsce modułu, gdzie klient naprawdę
    // interpretuje surowy jsonb.
    const signal = await fetchClubRosterSignal(CLUB_IDS.club);

    expect(signal?.faces).toHaveLength(1);
    expect(signal?.faces[0]?.name).toBe("Poprawna");
  });

  it("twarz bez roli dostaje 'member', a nie pustą etykietę", async () => {
    clubRpc.setData("club_roster_signal", [
      {
        members_total: 1,
        new_7d: 0,
        active_24h: 0,
        active_7d: 0,
        faces: [{ user_id: "u1", name: "Bez roli" }],
      },
    ]);

    expect((await fetchClubRosterSignal(CLUB_IDS.club))?.faces[0]?.role).toBe("member");
  });

  it("faces spoza tablicy (null, obiekt) nie wywraca panelu", async () => {
    clubRpc.setData("club_roster_signal", [
      { members_total: 1, new_7d: 0, active_24h: 0, active_7d: 0, faces: null },
    ]);

    expect((await fetchClubRosterSignal(CLUB_IDS.club))?.faces).toEqual([]);
  });

  it("limit twarzy jedzie do RPC (domyślnie 24)", async () => {
    clubRpc.setData("club_roster_signal", []);

    await fetchClubRosterSignal(CLUB_IDS.club);
    expect(clubRpc.lastCall("club_roster_signal")?.arg("p_limit")).toBe(24);

    await fetchClubRosterSignal(CLUB_IDS.club, 6);
    expect(clubRpc.lastCall("club_roster_signal")?.arg("p_limit")).toBe(6);
  });
});

describe("poznaj członka", () => {
  it("bieżący wybór: brak wiersza to null", async () => {
    clubRpc.setData("club_member_spotlight_current", []);
    expect(await fetchClubSpotlight(CLUB_IDS.club)).toBeNull();
  });

  it("historia: domyślnie dwanaście tygodni", async () => {
    clubRpc.setData("club_member_spotlight_history", null);

    expect(await fetchClubSpotlightHistory(CLUB_IDS.club)).toEqual([]);
    expect(clubRpc.lastCall("club_member_spotlight_history")?.arg("p_limit")).toBe(12);
  });

  it("przypięcie przekazuje osobę i opcjonalny tydzień oraz notki", async () => {
    clubRpc.setData("club_member_spotlight_upsert", "spot-1");

    const id = await pinClubSpotlight(CLUB_IDS.club, {
      userId: CLUB_IDS.member,
      weekStart: CLUB_BASE_ISO,
      blurbPl: "Notka",
    });

    expect(id).toBe("spot-1");
    const call = clubRpc.lastCall("club_member_spotlight_upsert");
    expect(call?.arg("p_user_id")).toBe(CLUB_IDS.member);
    expect(call?.arg("p_week_start")).toBe(CLUB_BASE_ISO);
    expect(call?.arg("p_blurb_en")).toBeUndefined();
  });

  it("usunięcie wyboru zwraca boolean", async () => {
    clubRpc.setData("club_member_spotlight_delete", true);

    expect(await deleteClubSpotlight("spot-1")).toBe(true);
    expect(clubRpc.lastCall("club_member_spotlight_delete")?.arg("p_id")).toBe("spot-1");
  });
});

describe("networkApi: spójność kontraktu błędu", () => {
  const cases: ReadonlyArray<readonly [string, string, () => Promise<unknown>]> = [
    [
      "fetchClubBoardNotices",
      "club_board_notices_list",
      () => fetchClubBoardNotices({ clubId: "c" }),
    ],
    [
      "createClubBoardNotice",
      "club_board_notice_create",
      () => createClubBoardNotice({ clubId: "c", kind: "seeking", body: "B" }),
    ],
    ["closeClubBoardNotice", "club_board_notice_close", () => closeClubBoardNotice("n")],
    ["fetchMyClubExpertise", "club_expertise_mine", () => fetchMyClubExpertise("c")],
    ["setMyClubExpertise", "club_expertise_set", () => setMyClubExpertise("c", [])],
    ["fetchClubExperts", "club_experts_list", () => fetchClubExperts({ clubId: "c" })],
    ["fetchClubExpertiseAreas", "club_expertise_areas", () => fetchClubExpertiseAreas("c")],
    ["fetchClubThreadExperts", "club_thread_experts", () => fetchClubThreadExperts("t")],
    ["pingClubThreadExpert", "club_thread_expert_ping", () => pingClubThreadExpert("t", "u")],
    ["fetchClubEventAttendees", "club_event_attendees", () => fetchClubEventAttendees("e")],
    ["fetchClubEvent", "club_event_view", () => fetchClubEvent("c", "s")],
    ["fetchClubRosterSignal", "club_roster_signal", () => fetchClubRosterSignal("c")],
    ["fetchClubSpotlight", "club_member_spotlight_current", () => fetchClubSpotlight("c")],
    [
      "fetchClubSpotlightHistory",
      "club_member_spotlight_history",
      () => fetchClubSpotlightHistory("c"),
    ],
    [
      "pinClubSpotlight",
      "club_member_spotlight_upsert",
      () => pinClubSpotlight("c", { userId: "u" }),
    ],
    ["deleteClubSpotlight", "club_member_spotlight_delete", () => deleteClubSpotlight("s")],
  ];

  it.each(cases)("%s rzuca, gdy %s odmawia", async (_label, rpcName, run) => {
    clubRpc.setError(rpcName, "odmowa bazy", "42501");
    await expect(run()).rejects.toThrow("odmowa bazy");
  });

  it("lista przypadków pokrywa KAŻDĄ funkcję eksportowaną z networkApi", async () => {
    const api = await import("@/lib/clubs/networkApi");
    const exported = Object.entries(api)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    const covered = new Set(cases.map(([label]) => label));

    expect(exported.filter((name) => !covered.has(name))).toEqual([]);
  });
});
