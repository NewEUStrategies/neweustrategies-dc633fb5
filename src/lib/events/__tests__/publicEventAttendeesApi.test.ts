// Kontrakt UCZESTNIKÓW i DYSKUSJI na styku z bazą: ładunek jadący do RPC
// i kształt wracający z `jsonb`.
//
// PO CO OSOBNY PLIK OD `publicEventApi.test.ts`. Tamten pilnuje ładunków
// istniejącej powierzchni (zapis na sesję, zakładki). Tutaj chodzi o dwie
// rzeczy, których tamten kontrakt nie zna, i o jedną, której nie zna ŻADEN
// test w repo: `jsonb` nie sprawdza się przy kompilacji, więc rozjazd nazwy
// klucza między SQL-em a parserem kończy się pustą listą na produkcji, a nie
// czerwonym `tsc`.
//
// CZEGO TU NIE MA: reguł widoczności. To, KTO wychodzi z `event_attendees`,
// rozstrzyga SQL (dwie zgody, zapis wołającego, reguła Chatham House)
// i dowodzą tego asercje runtime na żywym Postgresie
// (`scripts/events-harness/runtime_test.d`, sekcja 40). Test jednostkowy, który
// „sprawdzałby” filtr przez atrapę odpowiedzi, dowodziłby wyłącznie tego, że
// atrapa zwraca to, co mu wpisano.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/publicEventApi");

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

function attendeeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registration_id: "r1",
    name: "Anna Adamska",
    job_title: "Dyrektorka",
    company: "Alfa",
    avatar_url: "https://x/a.png",
    profile_slug: "anna-adamska",
    user_id: "u2",
    company_logo_url: "https://x/alfa.png",
    company_website: "https://alfa.example",
    industry: "Energetyka",
    specialization: "Polityka UE",
    seeking_pl: "Partnerów",
    offering_pl: "Analizy",
    bio_pl: "Ekspertka",
    social_links: { linkedin: "https://linkedin.com/in/anna" },
    groups: [{ id: "g1", name_pl: "Uczestnicy", name_en: "Attendees", color: "#2563eb" }],
    ...over,
  };
}

describe("event_attendees - ładunek", () => {
  it("puste pole wyszukiwania NIE JEDZIE jako filtr", async () => {
    h.rpc?.setData("event_attendees", {});
    await api.fetchEventAttendees({ slug: "kongres", q: "   ", limit: 24, offset: 0 });
    const call = h.rpc?.lastCall("event_attendees");
    expect(call?.arg("p_payload")).toEqual({ event_slug: "kongres", limit: 24, offset: 0 });
  });

  it("wpisane zapytanie i grupa jadą obcięte i pod nazwami z sygnatury", async () => {
    h.rpc?.setData("event_attendees", {});
    await api.fetchEventAttendees({
      slug: "kongres",
      q: "  nowak ",
      groupId: "g1",
      limit: 10,
      offset: 20,
    });
    expect(h.rpc?.lastCall("event_attendees")?.arg("p_payload")).toEqual({
      event_slug: "kongres",
      q: "nowak",
      group_id: "g1",
      limit: 10,
      offset: 20,
    });
  });
});

describe("event_attendees - odczyt kształtu", () => {
  it("czyta wiersze, grupy z licznikiem i trzy pola własnej widoczności", () => {
    const parsed = api.parseAttendeeDirectory({
      blocked: null,
      chatham_house: false,
      my_registration_id: "r1",
      my_listed: true,
      my_discoverable: true,
      my_opt_out: false,
      total_count: 7,
      rows: [attendeeRow()],
      groups: [
        { id: "g1", name_pl: "Uczestnicy", name_en: "Attendees", color: "#2563eb", count: 7 },
      ],
    });

    expect(parsed.blocked).toBeNull();
    expect(parsed.totalCount).toBe(7);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.name).toBe("Anna Adamska");
    expect(parsed.rows[0]?.companyLogoUrl).toBe("https://x/alfa.png");
    expect(parsed.rows[0]?.specialization).toBe("Polityka UE");
    expect(parsed.rows[0]?.socialLinks.linkedin).toBe("https://linkedin.com/in/anna");
    expect(parsed.rows[0]?.groups[0]?.namePl).toBe("Uczestnicy");
    expect(parsed.groups[0]?.count).toBe(7);
    expect(parsed.myListed).toBe(true);
    expect(parsed.myDiscoverable).toBe(true);
    expect(parsed.myOptOut).toBe(false);
  });

  it("wiersz bez identyfikatora zapisu albo bez nazwy WYPADA", () => {
    const parsed = api.parseAttendeeDirectory({
      rows: [
        attendeeRow(),
        attendeeRow({ registration_id: null }),
        attendeeRow({ registration_id: "r3", name: "   " }),
      ],
    });
    expect(parsed.rows.map((row) => row.registrationId)).toEqual(["r1"]);
  });

  it("odmowa Chatham House wraca jako powód, a liczba i grupy zostają", () => {
    const parsed = api.parseAttendeeDirectory({
      blocked: "chatham_house",
      chatham_house: true,
      total_count: 120,
      rows: [],
      groups: [{ id: "g1", name_pl: "Uczestnicy", name_en: "Attendees", count: 120 }],
    });
    expect(parsed.blocked).toBe("chatham_house");
    expect(parsed.chathamHouse).toBe(true);
    expect(parsed.rows).toEqual([]);
    expect(parsed.totalCount).toBe(120);
    expect(parsed.groups[0]?.count).toBe(120);
  });

  it("nieznany powód odmowy czyta się jako BRAK odmowy, nie jako nowy stan", () => {
    // Front ma dwie gałęzie odmowy i obie mają tekst. Trzeci, nieznany kod
    // pokazałby kartę bez zdania - lepiej narysować listę, która przyszła.
    expect(api.parseAttendeeDirectory({ blocked: "kosmos" }).blocked).toBeNull();
  });

  it("odpowiedź nie-obiekt daje pustą listę, a nie wyjątek w renderze", () => {
    expect(api.parseAttendeeDirectory(null).rows).toEqual([]);
    expect(api.parseAttendeeDirectory("nope").groups).toEqual([]);
    expect(api.parseAttendeeDirectory({ rows: "nie tablica" }).rows).toEqual([]);
  });
});

describe("własna widoczność", () => {
  it("jedzie do RPC giełdy, bo kolumna jest ta sama", async () => {
    h.rpc?.setData("event_meeting_directory_visibility_set", { listed: false });
    const listed = await api.setEventAttendeeVisibility({ slug: "kongres", listed: false });
    expect(listed).toBe(false);
    expect(h.rpc?.lastCall("event_meeting_directory_visibility_set")?.arg("p_payload")).toEqual({
      event_slug: "kongres",
      listed: false,
    });
  });
});

function threadRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    slug: "czy-europa-ma-plan",
    title: "Czy Europa ma plan",
    excerpt: "Treść wątku",
    kind: "question",
    status: "open",
    is_anonymous: false,
    author_name: "Anna Adamska",
    author_avatar: "https://x/a.png",
    author_slug: "anna-adamska",
    reply_count: 4,
    participant_count: 3,
    pinned_at: null,
    last_reply_at: "2026-09-01T10:00:00Z",
    created_at: "2026-08-30T10:00:00Z",
    ...over,
  };
}

describe("event_discussions", () => {
  it("woła RPC z samym slugiem - to dana strony, nie zapytanie z filtrami", async () => {
    h.rpc?.setData("event_discussions", { state: "not_configured" });
    await api.fetchEventDiscussions("kongres");
    expect(h.rpc?.lastCall("event_discussions")?.arg("p_slug")).toBe("kongres");
  });

  it("czyta klub, grupę i wątki", () => {
    const parsed = api.parseEventDiscussions({
      state: "ok",
      club: {
        id: "c1",
        slug: "klub",
        name_pl: "Klub",
        name_en: "Club",
        icon: "MessagesSquare",
        accent_color: null,
      },
      group: {
        id: "g1",
        slug: "kongres",
        name_pl: "Kongres",
        name_en: "Congress",
        status: "active",
      },
      attribution: "attributed",
      can_post: true,
      total_count: 1,
      threads: [threadRow()],
    });
    expect(parsed.state).toBe("ok");
    expect(parsed.club?.slug).toBe("klub");
    expect(parsed.group?.namePl).toBe("Kongres");
    expect(parsed.canPost).toBe(true);
    expect(parsed.threads[0]?.replyCount).toBe(4);
    expect(parsed.threads[0]?.authorName).toBe("Anna Adamska");
  });

  it("wątek w trybie Chatham House przychodzi BEZ autora i z flagą anonimowości", () => {
    const parsed = api.parseEventDiscussions({
      state: "ok",
      attribution: "chatham",
      threads: [
        threadRow({
          is_anonymous: true,
          author_name: null,
          author_slug: null,
          author_avatar: null,
        }),
      ],
    });
    expect(parsed.threads[0]?.isAnonymous).toBe(true);
    expect(parsed.threads[0]?.authorName).toBeNull();
    expect(parsed.threads[0]?.authorSlug).toBeNull();
  });

  it("wątek bez sluga WYPADA - karta bez odnośnika do klubu jest atrapą", () => {
    const parsed = api.parseEventDiscussions({
      state: "ok",
      threads: [threadRow(), threadRow({ id: "t2", slug: null })],
    });
    expect(parsed.threads.map((thread) => thread.id)).toEqual(["t1"]);
  });

  it("klub bez sluga czyta się jako brak klubu - trasa wątku potrzebuje obu", () => {
    const parsed = api.parseEventDiscussions({
      state: "ok",
      club: { id: "c1", slug: null },
      threads: [threadRow()],
    });
    expect(parsed.club).toBeNull();
  });

  it("nieznany stan dostępu czyta się jako no_access, a nie jako brak dyskusji", () => {
    expect(api.parseEventDiscussions({ state: "kosmiczny_powod" }).state).toBe("no_access");
    expect(api.parseEventDiscussions({ state: "not_open_yet" }).state).toBe("not_open_yet");
    // Śmieciowa odpowiedź nie udaje, że wydarzenie nie ma dyskusji: „nie ma
    // przypiętej grupy” to zdanie o WYDARZENIU i musi przyjść z bazy.
    expect(api.parseEventDiscussions(null).state).toBe("no_access");
  });
});
