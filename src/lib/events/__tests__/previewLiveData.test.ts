// Zywe dane podgladu studia: wiersze PANELU sprowadzone do ksztaltu STRONY.
//
// PO CO TEN PLIK. Podglad rysuje szkic tymi samymi komponentami, co strona
// publiczna, ale karmi je wierszami z RPC administracyjnych. Kazde rozjechanie
// tego mapowania jest bledem, ktorego NIE WIDAC na ekranie redaktora: rysunek
// dalej sie sklada, tylko obiecuje cos innego, niz zobaczy uczestnik.
//
// TRZY KLASY BLEDU, KTORE TU LAPIEMY.
//
// 1) OBIETNICA BEZ POKRYCIA. Wiersz, ktorego powierzchnia publiczna NIE
//    pokaze - sesja odwolana albo prywatna, prelegent niepubliczny, zgloszenie
//    z listy rezerwowej - narysowany w podgladzie znaczy, ze redaktor
//    zatwierdza uklad, ktorego po publikacji nie bedzie. Kazdy filtr ma tu
//    przypadek po obu stronach: wiersz wpuszczony I wiersz odsiany.
//
// 2) PUSTKA UDAJACA WARTOSC. Kolumny panelu bywaja NULL-em albo pustym
//    napisem, a komponenty strony rozrozniaja `null` (nie ma czego rysowac) od
//    napisu (narysuj). Napis z samych spacji przepuszczony jako nazwa daje
//    kafel-widmo: pasmo bez nazwy, sala bez nazwy, karta bez nazwiska.
//    Dlatego kazde pole „nullowalne" ma przypadek na null, "" i "   ".
//
// 3) CICHY DOMYSL. `format` spoza slownika, `is_active`/`is_public` jako NULL,
//    brakujace liczniki - to sa galezie, ktore w zyciu odpalaja na starych
//    wierszach, a w kodzie wygladaja na nieosiagalne.
//
// STREFA CZASU WCHODZI Z WYDARZENIA, nie z sesji - lista panelu jej nie oddaje,
// wiec pusta strefa MUSI zejsc do `null`, zeby widok nie narysowal godzin
// w strefie przegladarki redaktora, udajac strefe wydarzenia.
import { describe, expect, it } from "vitest";
import type { EventSpeakerEntry } from "@/lib/admin/community";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";
import type { EventSessionRow, EventTrackRow } from "@/lib/events/sessionsApi";
import {
  agendaSessionsFromAdminRows,
  attendeeEntriesFromRegistrationRows,
  publishedSponsorIdSet,
  speakerRowsFromAdminEntries,
  trackChipsFromAdminRows,
} from "@/lib/events/previewLiveData";

/* ----------------------------------------------------------- wytwornice --- */
// Wiersze RPC maja w typach generowanych kolumny NIE-nullowalne, a baza
// zwraca w nich NULL - dlatego wytwornice przyjmuja luzny zapis nadpisan
// i rzutuja raz, zamiast zasmiecac kazdy przypadek asercja typu.

type SessionOverrides = Partial<Record<keyof EventSessionRow, unknown>>;

function sessionRow(overrides: SessionOverrides = {}): EventSessionRow {
  return {
    id: "ses-1",
    event_id: "ev-1",
    parent_session_id: null,
    title_pl: "Panel otwarcia",
    title_en: "Opening panel",
    description_pl: "Opis",
    description_en: "Description",
    starts_at: "2026-09-01T08:00:00Z",
    ends_at: "2026-09-01T09:00:00Z",
    format: "onsite",
    status: "published",
    is_private: false,
    sort_order: 3,
    chatham_house: false,
    min_tier_rank: 0,
    requires_signup: false,
    capacity: 100,
    registered_count: 12,
    seats_left: 88,
    track_id: null,
    track_key: null,
    track_name_pl: null,
    track_name_en: null,
    track_accent_color: null,
    room_id: null,
    room_name: null,
    has_stream: false,
    has_recording: false,
    ...overrides,
  } as unknown as EventSessionRow;
}

/** Jedna sesja w srodku - skrot na przypadki o jednym wierszu. */
function oneSession(overrides: SessionOverrides = {}, timezone = "Europe/Warsaw") {
  const [session] = agendaSessionsFromAdminRows([sessionRow(overrides)], timezone);
  return session;
}

function speakerEntry(overrides: Partial<EventSpeakerEntry> = {}): EventSpeakerEntry {
  return {
    entry_id: "entry-1",
    speaker_profile_id: "sp-1",
    user_id: "user-1",
    person_id: null,
    display_name: "Anna Kowalska",
    avatar_url: "https://cdn.test/anna.jpg",
    job_title: "Dyrektor",
    company: "NES",
    email: "anna@example.org",
    is_public: true,
    sort_order: 2,
    is_legacy: false,
    ...overrides,
  };
}

type RegistrationOverrides = Partial<Record<keyof EventRegistrationRow, unknown>>;

function registrationRow(overrides: RegistrationOverrides = {}): EventRegistrationRow {
  return {
    id: "reg-1",
    status: "approved",
    first_name: "Anna",
    last_name: "Kowalska",
    job_title: "Dyrektor",
    company_name: null,
    company_text: null,
    group_id: null,
    group_name_pl: null,
    group_name_en: null,
    group_color: null,
    ...overrides,
  } as unknown as EventRegistrationRow;
}

function oneAttendee(overrides: RegistrationOverrides = {}) {
  const [entry] = attendeeEntriesFromRegistrationRows([registrationRow(overrides)]);
  return entry;
}

type TrackOverrides = Partial<Record<keyof EventTrackRow, unknown>>;

function trackRow(overrides: TrackOverrides = {}): EventTrackRow {
  return {
    id: "trk-1",
    name_pl: "Polityka",
    name_en: "Policy",
    accent_color: "#FA9346",
    sessions_count: 4,
    draft_count: 1,
    is_active: true,
    is_public: true,
    ...overrides,
  } as unknown as EventTrackRow;
}

function oneChip(overrides: TrackOverrides = {}) {
  const [chip] = trackChipsFromAdminRows([trackRow(overrides)]);
  return chip;
}

/* ------------------------------------------------- sesje programu (agenda) -- */

describe("agendaSessionsFromAdminRows - co w ogole wchodzi do programu", () => {
  it("BRAK ODPOWIEDZI to pusty program, a nie wyjatek", () => {
    // Zapytanie jeszcze leci albo jest wylaczone (`enabled: false`) - podglad ma
    // wtedy narysowac pusty program, a nie wywrocic cala nakladke.
    expect(agendaSessionsFromAdminRows(undefined, "Europe/Warsaw")).toEqual([]);
  });

  it("pusta lista wierszy daje pusty program", () => {
    expect(agendaSessionsFromAdminRows([], "Europe/Warsaw")).toEqual([]);
  });

  it("sesja ODWOLANA nie trafia do podgladu", () => {
    // Strona publiczna jej nie pokaze - narysowana obiecywalaby punkt programu,
    // ktorego po publikacji nie bedzie.
    expect(agendaSessionsFromAdminRows([sessionRow({ status: "cancelled" })], "UTC")).toEqual([]);
  });

  it("sesja PRYWATNA nie trafia do podgladu", () => {
    expect(agendaSessionsFromAdminRows([sessionRow({ is_private: true })], "UTC")).toEqual([]);
  });

  it("sesja jednoczesnie odwolana i prywatna tez odpada", () => {
    expect(
      agendaSessionsFromAdminRows([sessionRow({ status: "cancelled", is_private: true })], "UTC"),
    ).toEqual([]);
  });

  it("SZKIC sesji wchodzi do podgladu i jest w nim oznaczony jako opublikowany", () => {
    // ZACHOWANIE OBECNE, swiadome: redaktor sklada program, wiec musi widziec
    // sesje, ktorej jeszcze nie opublikowal. Powierzchnia publiczna zna tylko
    // `published`/`cancelled`, wiec szkic dostaje tu `published` - inaczej
    // komponent strony dostalby status spoza swojego slownika.
    const session = oneSession({ status: "draft" });
    expect(session.status).toBe("published");
  });

  it("zachowuje kolejnosc i przepuszcza wiele wierszy naraz, odsiewajac tylko zabronione", () => {
    const rows = [
      sessionRow({ id: "a" }),
      sessionRow({ id: "b", status: "cancelled" }),
      sessionRow({ id: "c", is_private: true }),
      sessionRow({ id: "d", status: "draft" }),
    ];
    expect(agendaSessionsFromAdminRows(rows, "UTC").map((s) => s.id)).toEqual(["a", "d"]);
  });
});

describe("agendaSessionsFromAdminRows - strefa czasu wchodzi z wydarzenia", () => {
  it("strefa wydarzenia lezy na KAZDEJ sesji, bo lista panelu jej nie oddaje", () => {
    const sessions = agendaSessionsFromAdminRows(
      [sessionRow({ id: "a" }), sessionRow({ id: "b" })],
      "Europe/Brussels",
    );
    expect(sessions.map((s) => s.timezone)).toEqual(["Europe/Brussels", "Europe/Brussels"]);
  });

  it("PUSTA strefa schodzi do null, zamiast udawac strefe", () => {
    // Napis pusty przepuszczony dalej kazalby widokowi formatowac godziny
    // w strefie przegladarki redaktora i podpisywac je jako strefe wydarzenia.
    expect(oneSession({}, "").timezone).toBeNull();
    expect(oneSession({}, "   ").timezone).toBeNull();
  });
});

describe("agendaSessionsFromAdminRows - stan zapisu opisuje SESJE, nie widza", () => {
  it("sesja z zapisem dostaje stan „wymaga zapisu”", () => {
    const session = oneSession({ requires_signup: true });
    expect(session.accessState).toBe("signup_required");
    expect(session.requiresSignup).toBe(true);
  });

  it("sesja bez zapisu jest „otwarta”", () => {
    const session = oneSession({ requires_signup: false });
    expect(session.accessState).toBe("open");
    expect(session.requiresSignup).toBe(false);
  });

  it("MOJ zapis jest zawsze pusty - organizator nie ma tu wlasnego stanu", () => {
    expect(oneSession({ requires_signup: true }).mySignupStatus).toBeNull();
    expect(oneSession({ requires_signup: false }).mySignupStatus).toBeNull();
  });
});

describe("agendaSessionsFromAdminRows - format sesji", () => {
  it("przepuszcza kazdy format ze slownika agendy", () => {
    expect(oneSession({ format: "onsite" }).format).toBe("onsite");
    expect(oneSession({ format: "online" }).format).toBe("online");
    expect(oneSession({ format: "hybrid" }).format).toBe("hybrid");
  });

  it("format SPOZA slownika schodzi do „onsite”, zamiast trafic do widoku", () => {
    // Nieznana wartosc w polu formatu to w widoku brak ikony i brak etykiety;
    // „onsite" jest jedyna odpowiedzia, ktora niczego nie obiecuje online.
    expect(oneSession({ format: "webinar" }).format).toBe("onsite");
    expect(oneSession({ format: "" }).format).toBe("onsite");
    expect(oneSession({ format: "ONSITE" }).format).toBe("onsite");
  });
});

describe("agendaSessionsFromAdminRows - pola tekstowe i puste napisy", () => {
  it("teksty sesji przechodza w calosci, gdy sa niepuste", () => {
    const session = oneSession({
      id: "ses-9",
      event_id: "ev-9",
      parent_session_id: "ses-1",
      title_pl: "Tytul",
      title_en: "Title",
      description_pl: "Opis",
      description_en: "Description",
      starts_at: "2026-09-02T07:30:00Z",
      ends_at: "2026-09-02T08:30:00Z",
    });
    expect(session).toMatchObject({
      id: "ses-9",
      eventId: "ev-9",
      parentSessionId: "ses-1",
      titlePl: "Tytul",
      titleEn: "Title",
      descriptionPl: "Opis",
      descriptionEn: "Description",
      startsAt: "2026-09-02T07:30:00Z",
      endsAt: "2026-09-02T08:30:00Z",
    });
  });

  it("NULL, pusty napis i same spacje znacza to samo: nie ma czego rysowac", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const session = oneSession({
        parent_session_id: empty,
        title_pl: empty,
        title_en: empty,
        description_pl: empty,
        description_en: empty,
      });
      expect(session.parentSessionId).toBeNull();
      expect(session.titlePl).toBeNull();
      expect(session.titleEn).toBeNull();
      expect(session.descriptionPl).toBeNull();
      expect(session.descriptionEn).toBeNull();
    }
  });

  it("napis z bialymi znakami po bokach zostaje NIENARUSZONY, gdy ma tresc", () => {
    // Przyciecie sluzy TYLKO decyzji „pusto czy nie" - wartosc jedzie dalej
    // taka, jaka jest w bazie, zeby podglad nie klamal o tresci pola.
    expect(oneSession({ title_pl: "  Panel  " }).titlePl).toBe("  Panel  ");
  });
});

describe("agendaSessionsFromAdminRows - miejsca, licznik i flagi", () => {
  it("BRAK LIMITU miejsc zostaje brakiem limitu, a nie zerem", () => {
    const session = oneSession({ capacity: null, seats_left: null });
    expect(session.capacity).toBeNull();
    expect(session.seatsLeft).toBeNull();
  });

  it("ZERO wolnych miejsc to liczba, a nie brak limitu", () => {
    // Zero i null znacza w widoku co innego: „brak miejsc" kontra „bez limitu".
    const session = oneSession({ capacity: 0, seats_left: 0, registered_count: 0 });
    expect(session.capacity).toBe(0);
    expect(session.seatsLeft).toBe(0);
    expect(session.registeredCount).toBe(0);
  });

  it("liczby i flagi sesji jada bez zmian", () => {
    const session = oneSession({
      sort_order: 7,
      chatham_house: true,
      min_tier_rank: 3,
      registered_count: 21,
      capacity: 30,
      seats_left: 9,
      has_stream: true,
      has_recording: true,
    });
    expect(session).toMatchObject({
      sortOrder: 7,
      chathamHouse: true,
      minTierRank: 3,
      registeredCount: 21,
      capacity: 30,
      seatsLeft: 9,
      hasStream: true,
      hasRecording: true,
    });
  });

  it("BEZ rejestru prelegentow w kontekscie lista prelegentow sesji jest pusta", () => {
    // Kontekst `speakers` jest opcjonalny: lista sesji panelu oddaje tylko
    // liczbe prelegentow, wiec bez rejestru nie ma skad wziac obsady.
    expect(oneSession({}).speakers).toEqual([]);
    const [withEmptyContext] = agendaSessionsFromAdminRows([sessionRow()], "UTC", {});
    expect(withEmptyContext?.speakers).toEqual([]);
    const [withEmptyRegistry] = agendaSessionsFromAdminRows([sessionRow()], "UTC", {
      speakers: [],
    });
    expect(withEmptyRegistry?.speakers).toEqual([]);
  });
});

/* ------------------------------------------ obsada sesji z rejestru panelu -- */

describe("agendaSessionsFromAdminRows - obsada sesji z rejestru prelegentow", () => {
  /** Program jednej albo kilku sesji z rejestrem prelegentow w kontekscie. */
  function withCast(
    speakers: readonly EventSpeakerEntry[],
    rows: readonly EventSessionRow[] = [sessionRow()],
  ) {
    return agendaSessionsFromAdminRows(rows, "Europe/Warsaw", { speakers });
  }

  const link = (sessionId: string, role = "speaker", sortOrder = 0) => ({
    sessionId,
    role,
    sortOrder,
  });

  it("prelegent przypisany do sesji wchodzi do jej obsady w ksztalcie programu", () => {
    const [session] = withCast([
      speakerEntry({
        headline_pl: "Dyrektor programu",
        headline_en: "Programme director",
        sessions: [link("ses-1", "moderator", 4)],
      }),
    ]);
    expect(session?.speakers).toEqual([
      {
        userId: "user-1",
        slug: null,
        displayName: "Anna Kowalska",
        avatarUrl: "https://cdn.test/anna.jpg",
        headlinePl: "Dyrektor programu",
        headlineEn: "Programme director",
        role: "moderator",
        sortOrder: 4,
      },
    ]);
  });

  it("sesja BEZ obsady dostaje pusta liste, a sasiednia - swoja obsade", () => {
    const sessions = withCast(
      [speakerEntry({ sessions: [link("ses-1")] })],
      [sessionRow({ id: "ses-1" }), sessionRow({ id: "ses-2" })],
    );
    expect(sessions.map((s) => [s.id, s.speakers.map((sp) => sp.userId)])).toEqual([
      ["ses-1", ["user-1"]],
      ["ses-2", []],
    ]);
  });

  it("wpis bez listy sesji (stary wiersz, legacy) nie wchodzi do zadnej obsady", () => {
    const [session] = withCast([speakerEntry({ sessions: undefined })]);
    expect(session?.speakers).toEqual([]);
    const [emptyLinks] = withCast([speakerEntry({ sessions: [] })]);
    expect(emptyLinks?.speakers).toEqual([]);
  });

  // Klasa 1: `event_agenda` wpuszcza do obsady tylko nakladke publiczna.
  it("prelegent NIEPUBLICZNY nie trafia do obsady, publiczny obok - tak", () => {
    const [session] = withCast([
      speakerEntry({ user_id: "u-hidden", is_public: false, sessions: [link("ses-1")] }),
      speakerEntry({ user_id: "u-shown", sessions: [link("ses-1")] }),
    ]);
    expect(session?.speakers.map((sp) => sp.userId)).toEqual(["u-shown"]);
  });

  // Klasa 2: osoba bez nazwy do wyswietlenia to chip-widmo w programie.
  it("osoba BEZ nazwy do wyswietlenia nie trafia do obsady", () => {
    for (const empty of [null, "", "   "]) {
      const [session] = withCast([
        speakerEntry({ display_name: empty, sessions: [link("ses-1")] }),
      ]);
      expect(session?.speakers).toEqual([]);
    }
  });

  it("nazwa z bialymi znakami po bokach jedzie NIENARUSZONA, gdy ma tresc", () => {
    const [session] = withCast([
      speakerEntry({ display_name: "  Anna  ", sessions: [link("ses-1")] }),
    ]);
    expect(session?.speakers[0]?.displayName).toBe("  Anna  ");
  });

  it("tozsamosc to konto, w jego braku osoba z kartoteki, a na koncu wpis rejestru", () => {
    // Ten sam COALESCE, co klucz `user_id` w `event_agenda` - inaczej indeks
    // sciezek prelegentow mialby w podgladzie inne klucze niz na stronie.
    const [session] = withCast([
      speakerEntry({
        user_id: "u-1",
        person_id: "per-1",
        speaker_profile_id: "sp-1",
        display_name: "A",
        sessions: [link("ses-1", "speaker", 1)],
      }),
      speakerEntry({
        user_id: null,
        person_id: "per-2",
        speaker_profile_id: "sp-2",
        display_name: "B",
        sessions: [link("ses-1", "speaker", 2)],
      }),
      speakerEntry({
        user_id: null,
        person_id: null,
        speaker_profile_id: "sp-3",
        display_name: "C",
        sessions: [link("ses-1", "speaker", 3)],
      }),
    ]);
    expect(session?.speakers.map((sp) => sp.userId)).toEqual(["u-1", "per-2", "sp-3"]);
  });

  it("naglowek sceniczny wygrywa ze stanowiskiem, a w jego braku wchodzi stanowisko", () => {
    const [withHeadline] = withCast([
      speakerEntry({
        job_title: "Dyrektor",
        headline_pl: "Szefowa programu",
        headline_en: "Head of programme",
        sessions: [link("ses-1")],
      }),
    ]);
    expect(withHeadline?.speakers[0]).toMatchObject({
      headlinePl: "Szefowa programu",
      headlineEn: "Head of programme",
    });

    // COALESCE(headline, pe.job_title) - kazdy jezyk osobno; stanowisko
    // wchodzi tylko u osoby BEZ konta (kartoteka `event_people`).
    for (const empty of [null, undefined, "", "   "]) {
      const [fallback] = withCast([
        speakerEntry({
          user_id: null,
          person_id: "person-1",
          job_title: "Dyrektor",
          headline_pl: empty,
          headline_en: "Director",
          sessions: [link("ses-1")],
        }),
      ]);
      expect(fallback?.speakers[0]).toMatchObject({
        headlinePl: "Dyrektor",
        headlineEn: "Director",
      });
    }
  });

  it("osoba Z KONTEM bez naglowka nie dostaje stanowiska z profilu autora - jak w agendzie", () => {
    const [session] = withCast([
      speakerEntry({
        job_title: "Dyrektor",
        headline_pl: null,
        headline_en: "Director of Programme",
        sessions: [link("ses-1")],
      }),
    ]);
    expect(session?.speakers[0]).toMatchObject({
      headlinePl: null,
      headlineEn: "Director of Programme",
    });
  });

  it("bez naglowka i bez stanowiska rola sceniczna jest NULL-em, a nie pustym napisem", () => {
    const [session] = withCast([
      speakerEntry({
        job_title: "  ",
        headline_pl: null,
        headline_en: "",
        sessions: [link("ses-1")],
      }),
    ]);
    expect(session?.speakers[0]).toMatchObject({ headlinePl: null, headlineEn: null });
  });

  it("puste zdjecie schodzi do NULL, zamiast dawac pusty obrazek", () => {
    for (const empty of [null, "", "   "]) {
      const [session] = withCast([speakerEntry({ avatar_url: empty, sessions: [link("ses-1")] })]);
      expect(session?.speakers[0]?.avatarUrl).toBeNull();
    }
  });

  it("rola w sesji przychodzi z powiazania, a pusta rola schodzi do NULL", () => {
    const [moderated, blank] = withCast(
      [
        speakerEntry({
          sessions: [link("ses-1", "moderator", 0), link("ses-2", "", 0)],
        }),
      ],
      [sessionRow({ id: "ses-1" }), sessionRow({ id: "ses-2" })],
    );
    expect(moderated?.speakers[0]?.role).toBe("moderator");
    expect(blank?.speakers[0]?.role).toBeNull();
  });

  it("ta sama osoba w dwoch sesjach wchodzi do obu, kazda z wlasna rola i kolejnoscia", () => {
    const sessions = withCast(
      [
        speakerEntry({
          sessions: [link("ses-1", "speaker", 2), link("ses-2", "moderator", 0)],
        }),
      ],
      [sessionRow({ id: "ses-1" }), sessionRow({ id: "ses-2" })],
    );
    expect(sessions.map((s) => s.speakers.map((sp) => [sp.userId, sp.role, sp.sortOrder]))).toEqual(
      [[["user-1", "speaker", 2]], [["user-1", "moderator", 0]]],
    );
  });

  it("obsada jest sortowana po kolejnosci w sesji, NIE po kolejnosci w rejestrze", () => {
    const [session] = withCast([
      speakerEntry({ user_id: "u-3", display_name: "Adam", sessions: [link("ses-1", "s", 3)] }),
      speakerEntry({ user_id: "u-1", display_name: "Zenon", sessions: [link("ses-1", "s", 1)] }),
      speakerEntry({ user_id: "u-2", display_name: "Maria", sessions: [link("ses-1", "s", 2)] }),
    ]);
    expect(session?.speakers.map((sp) => sp.displayName)).toEqual(["Zenon", "Maria", "Adam"]);
  });

  it("przy rownej kolejnosci rozstrzyga nazwisko wg POLSKIEGO porzadku alfabetu", () => {
    // W porzadku polskim „C" stoi przed „Ć" jako osobna litera, wiec „Czarny"
    // wyprzedza „Ćwik"; porzadek bez lokalizacji traktuje „Ć" jak „C" z akcentem
    // i odwraca te dwie pozycje. Tak samo „L" przed „Ł".
    const [session] = withCast([
      speakerEntry({ user_id: "u-1", display_name: "Ćwik", sessions: [link("ses-1", "s", 1)] }),
      speakerEntry({ user_id: "u-2", display_name: "Łucja", sessions: [link("ses-1", "s", 1)] }),
      speakerEntry({ user_id: "u-3", display_name: "Czarny", sessions: [link("ses-1", "s", 1)] }),
      speakerEntry({ user_id: "u-4", display_name: "Lucyna", sessions: [link("ses-1", "s", 1)] }),
      speakerEntry({ user_id: "u-5", display_name: "Adam", sessions: [link("ses-1", "s", 0)] }),
    ]);
    expect(session?.speakers.map((sp) => sp.displayName)).toEqual([
      "Adam",
      "Czarny",
      "Ćwik",
      "Lucyna",
      "Łucja",
    ]);
  });

  it("obsada sesji odwolanej albo prywatnej nie wycieka do innych sesji programu", () => {
    const sessions = withCast(
      [
        speakerEntry({
          sessions: [link("ses-cancelled"), link("ses-private"), link("ses-ok")],
        }),
      ],
      [
        sessionRow({ id: "ses-cancelled", status: "cancelled" }),
        sessionRow({ id: "ses-private", is_private: true }),
        sessionRow({ id: "ses-ok" }),
      ],
    );
    expect(sessions.map((s) => [s.id, s.speakers.length])).toEqual([["ses-ok", 1]]);
  });

  it("powiazanie z sesja spoza listy nie tworzy sesji ani nie psuje programu", () => {
    const sessions = withCast([speakerEntry({ sessions: [link("ses-nieznana")] })]);
    expect(sessions.map((s) => [s.id, s.speakers])).toEqual([["ses-1", []]]);
  });
});

describe("agendaSessionsFromAdminRows - pasmo i sala", () => {
  it("sesja BEZ pasma nie dostaje pustego kafla pasma", () => {
    for (const empty of [null, undefined, "", "  "]) {
      expect(oneSession({ track_id: empty, track_name_pl: "Polityka" }).track).toBeNull();
    }
  });

  it("pasmo z identyfikatorem wchodzi w calosci", () => {
    expect(
      oneSession({
        track_id: "trk-1",
        track_key: "policy",
        track_name_pl: "Polityka",
        track_name_en: "Policy",
        track_accent_color: "#FA9346",
      }).track,
    ).toEqual({
      id: "trk-1",
      key: "policy",
      namePl: "Polityka",
      nameEn: "Policy",
      accentColor: "#FA9346",
      // Lista sesji nie niesie sponsora sciezki - bez listy sciezek go nie ma.
      sponsor: null,
    });
  });

  it("pasmo bez nazw i koloru ma je NULL-em, a nie pustym napisem", () => {
    expect(
      oneSession({
        track_id: "trk-1",
        track_key: "",
        track_name_pl: "   ",
        track_name_en: null,
        track_accent_color: "",
      }).track,
    ).toEqual({
      id: "trk-1",
      key: null,
      namePl: null,
      nameEn: null,
      accentColor: null,
      sponsor: null,
    });
  });

  it("sesja BEZ sali nie dostaje pustego kafla sali", () => {
    for (const empty of [null, undefined, "", "  "]) {
      expect(oneSession({ room_id: empty, room_name: "Sala A" }).room).toBeNull();
    }
  });

  it("sala wchodzi z nazwa, a pietro zostaje puste - panel go nie oddaje", () => {
    expect(oneSession({ room_id: "room-1", room_name: "Sala A" }).room).toEqual({
      id: "room-1",
      name: "Sala A",
      floor: null,
    });
  });

  it("sala bez nazwy ma nazwe NULL, a nie pusty napis", () => {
    expect(oneSession({ room_id: "room-1", room_name: "" }).room).toEqual({
      id: "room-1",
      name: null,
      floor: null,
    });
  });
});

describe("agendaSessionsFromAdminRows - sponsor debaty i sciezki", () => {
  const SPONSORED = {
    sponsor_id: "spn-1",
    sponsor_name: "Orlen",
    sponsor_logo_url: "https://cdn.example.org/orlen.svg",
    sponsor_role: "partner",
  };

  it("sponsor sesji wchodzi w ksztalcie strony, a afiliacja jako tekst", () => {
    const session = oneSession({
      ...SPONSORED,
      affiliation_pl: "Rada Programowa",
      affiliation_en: "",
    });
    expect(session.sponsor).toEqual({
      id: "spn-1",
      name: "Orlen",
      logoUrl: "https://cdn.example.org/orlen.svg",
      role: "partner",
    });
    expect(session.affiliationPl).toBe("Rada Programowa");
    expect(session.affiliationEn).toBeNull();
  });

  // Klasa 1: `event_agenda` dolacza sponsora warunkiem `is_published`.
  it("przypiecie NIEOGLOSZONE nie trafia do podgladu, ogloszone - tak", () => {
    const [hidden] = agendaSessionsFromAdminRows([sessionRow(SPONSORED)], "Europe/Warsaw", {
      publishedSponsorIds: new Set(["spn-inny"]),
    });
    expect(hidden?.sponsor).toBeNull();
    const [shown] = agendaSessionsFromAdminRows([sessionRow(SPONSORED)], "Europe/Warsaw", {
      publishedSponsorIds: new Set(["spn-1"]),
    });
    expect(shown?.sponsor?.id).toBe("spn-1");
  });

  it("sponsor sciezki przychodzi z listy sciezek, bo lista sesji go nie niesie", () => {
    const tracks = [
      trackRow({
        id: "trk-1",
        sponsor_id: "spn-2",
        sponsor_name: "PGE",
        sponsor_logo_url: null,
        sponsor_role: "sponsor",
      }),
    ];
    const [session] = agendaSessionsFromAdminRows(
      [sessionRow({ track_id: "trk-1", track_name_pl: "Energia" })],
      "Europe/Warsaw",
      { tracks, publishedSponsorIds: new Set(["spn-2"]) },
    );
    expect(session?.track?.sponsor).toEqual({
      id: "spn-2",
      name: "PGE",
      logoUrl: null,
      role: "sponsor",
    });
    const [unpublished] = agendaSessionsFromAdminRows(
      [sessionRow({ track_id: "trk-1" })],
      "Europe/Warsaw",
      { tracks, publishedSponsorIds: new Set() },
    );
    expect(unpublished?.track?.sponsor).toBeNull();
  });
});

/* -------------------------------------------------------------- prelegenci -- */

describe("speakerRowsFromAdminEntries", () => {
  it("BRAK ODPOWIEDZI to pusta lista prelegentow", () => {
    expect(speakerRowsFromAdminEntries(undefined)).toEqual([]);
  });

  it("pusty rejestr daje pusta liste", () => {
    expect(speakerRowsFromAdminEntries([])).toEqual([]);
  });

  it("prelegent NIEPUBLICZNY nie trafia do podgladu", () => {
    // Strona publiczna go nie pokaze, wiec karta w podgladzie obiecywalaby
    // nazwisko, ktorego po publikacji na stronie nie bedzie.
    expect(speakerRowsFromAdminEntries([speakerEntry({ is_public: false })])).toEqual([]);
  });

  it("z mieszanego rejestru zostaja WYLACZNIE publiczni, w kolejnosci wejscia", () => {
    const rows = speakerRowsFromAdminEntries([
      speakerEntry({ speaker_profile_id: "sp-1", display_name: "Anna" }),
      speakerEntry({ speaker_profile_id: "sp-2", display_name: "Bartek", is_public: false }),
      speakerEntry({ speaker_profile_id: "sp-3", display_name: "Celina" }),
    ]);
    expect(rows.map((row) => row.display_name)).toEqual(["Anna", "Celina"]);
  });

  it("prelegent BEZ KONTA ma pusty `user_id`, bo tego oczekuje karta publiczna", () => {
    // Klucz karty stoi na pustym napisie, nie na NULL-u - `null` w tym polu
    // rozjechalby porownania w komponencie strony.
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({ user_id: null, person_id: "per-1" }),
    ]);
    expect(row.user_id).toBe("");
    expect(row.person_id).toBe("per-1");
  });

  it("prelegent Z KONTEM zachowuje swoj identyfikator uzytkownika", () => {
    const [row] = speakerRowsFromAdminEntries([speakerEntry({ user_id: "user-7" })]);
    expect(row.user_id).toBe("user-7");
  });

  it("wpis LEGACY (bez profilu prelegenta) jest oznaczony jako karta bez profilu", () => {
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({ speaker_profile_id: "", entry_id: null, is_legacy: true }),
    ]);
    expect(row.has_speaker_profile).toBe(false);
    expect(row.speaker_profile_id).toBe("");
  });

  it("wpis z profilem prelegenta jest oznaczony jako karta z profilem", () => {
    const [row] = speakerRowsFromAdminEntries([speakerEntry({ speaker_profile_id: "sp-9" })]);
    expect(row.has_speaker_profile).toBe(true);
  });

  it("pola, ktorych panel nie zna, sa PUSTE, a nie zmyslone", () => {
    // Podglad nie ma skad wziac biogramu ani ocen - kazde takie pole musi byc
    // puste, zeby karta nie chwalila sie danymi, ktorych nie ma.
    const [row] = speakerRowsFromAdminEntries([speakerEntry()]);
    expect(row).toMatchObject({
      slug: null,
      headline_pl: null,
      headline_en: null,
      bio_pl: null,
      bio_en: null,
      topics_pl: [],
      topics_en: [],
      languages: [],
      talks_count: 0,
      rating: 0,
      reviews_count: 0,
      is_expert: false,
    });
  });

  it("dane widoczne na karcie jada z rejestru bez zmian, razem z kolejnoscia", () => {
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({
        display_name: "Anna Kowalska",
        avatar_url: "https://cdn.test/a.jpg",
        job_title: "Dyrektor",
        company: "NES",
        sort_order: 5,
      }),
    ]);
    expect(row).toMatchObject({
      display_name: "Anna Kowalska",
      avatar_url: "https://cdn.test/a.jpg",
      job_title: "Dyrektor",
      company: "NES",
      sort_order: 5,
    });
  });

  it("puste pola opisowe wchodza NULL-em tak, jak je oddal panel", () => {
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({ display_name: null, avatar_url: null, job_title: null, company: null }),
    ]);
    expect(row).toMatchObject({
      display_name: null,
      avatar_url: null,
      job_title: null,
      company: null,
    });
  });

  it("wpis BEZ JAKIEJKOLWIEK tozsamosci wchodzi do podgladu (prawdopodobna usterka)", () => {
    // ZACHOWANIE OBECNE. `fetchEventSpeakers` (strona publiczna) odsiewa wiersz
    // bez konta i bez osoby z kartoteki: `user_id !== "" || person_id !== ""`,
    // bo baza tez go nie wypuszcza. Tu taki wiersz przechodzi - podglad
    // narysuje karte, ktorej po publikacji na stronie nie bedzie, czyli dokladnie
    // to, przed czym broni filtr `is_public` obok. Test opisuje stan dzisiejszy,
    // zeby zmiana byla widoczna.
    const rows = speakerRowsFromAdminEntries([speakerEntry({ user_id: null, person_id: null })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("");
    expect(rows[0].person_id).toBeNull();
  });
});

describe("speakerRowsFromAdminEntries - naglowek i pola karty rozwijanej", () => {
  it("naglowek sceniczny jedzie do karty w obu jezykach", () => {
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({ headline_pl: "Szefowa programu", headline_en: "Head of programme" }),
    ]);
    expect(row).toMatchObject({
      headline_pl: "Szefowa programu",
      headline_en: "Head of programme",
    });
  });

  it("naglowek karty NIE spada na stanowisko - stanowisko ma na karcie wlasne pole", () => {
    // Inaczej niz w programie (COALESCE w obsadzie sesji): wiersz karty niesie
    // stanowisko osobnym polem `job_title`, tak jak `event_speakers_public`.
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({ job_title: "Dyrektor", headline_pl: null, headline_en: undefined }),
    ]);
    expect(row).toMatchObject({ headline_pl: null, headline_en: null, job_title: "Dyrektor" });
  });

  it("pola karty jada z rejestru bez zmian, wiec podglad rozwija karte jak strona", () => {
    const [row] = speakerRowsFromAdminEntries([
      speakerEntry({
        card_photo_url: "https://cdn.test/anna-full.jpg",
        card_cta_label_pl: "Zobacz wystapienie",
        card_cta_label_en: "Watch the talk",
        card_cta_url: "https://example.org/talk",
        card_cta_color: "#FA9346",
      }),
    ]);
    expect(row).toMatchObject({
      card_photo_url: "https://cdn.test/anna-full.jpg",
      card_cta_label_pl: "Zobacz wystapienie",
      card_cta_label_en: "Watch the talk",
      card_cta_url: "https://example.org/talk",
      card_cta_color: "#FA9346",
    });
  });

  it("wiersz BEZ pol karty (legacy, stary wpis cache) dostaje NULL-e, a nie undefined", () => {
    // Brak pola = karta z ustawieniami domyslnymi; `undefined` w wierszu
    // rozjechalby porownania z wierszem strony, ktory niesie jawne NULL-e.
    const [missing] = speakerRowsFromAdminEntries([speakerEntry()]);
    const [explicitNull] = speakerRowsFromAdminEntries([
      speakerEntry({
        card_photo_url: null,
        card_cta_label_pl: null,
        card_cta_label_en: null,
        card_cta_url: null,
        card_cta_color: null,
      }),
    ]);
    for (const row of [missing, explicitNull]) {
      expect(row).toMatchObject({
        card_photo_url: null,
        card_cta_label_pl: null,
        card_cta_label_en: null,
        card_cta_url: null,
        card_cta_color: null,
      });
    }
  });
});

describe("speakerRowsFromAdminEntries - sciezki prelegenta", () => {
  const PANEL_TRACK = {
    id: "trk-panel",
    key: "panel",
    namePl: "Z listy panelu",
    nameEn: "From the panel list",
    accentColor: "#123456",
    sessionsCount: 5,
  };

  const link = (sessionId: string) => ({ sessionId, role: "speaker", sortOrder: 0 });

  const trackSession = (id: string, track: string | null, overrides: SessionOverrides = {}) =>
    sessionRow({
      id,
      track_id: track,
      track_key: track === null ? null : `key-${track}`,
      track_name_pl: track === null ? null : `Sciezka ${track}`,
      track_name_en: track === null ? null : `Track ${track}`,
      track_accent_color: track === null ? null : "#FA9346",
      ...overrides,
    });

  function tracksOf(entry: EventSpeakerEntry, sessions?: readonly EventSessionRow[]) {
    const [row] = speakerRowsFromAdminEntries([entry], sessions);
    return row?.tracks;
  }

  it("BEZ listy sesji karta dostaje sciezki z listy panelu", () => {
    expect(tracksOf(speakerEntry({ tracks: [PANEL_TRACK] }))).toEqual([PANEL_TRACK]);
  });

  it("BEZ listy sesji i bez sciezek wpisu karta ma pusta liste, a nie undefined", () => {
    expect(tracksOf(speakerEntry({ tracks: undefined }))).toEqual([]);
  });

  it("Z lista sesji sciezki licza sie z obsady, a lista panelu jest pomijana", () => {
    // Lista panelu liczy takze sesje prywatne - podglad ma pokazac karte taka,
    // jaka zobaczy uczestnik obok programu podgladu.
    const entry = speakerEntry({ tracks: [PANEL_TRACK], sessions: [link("ses-a")] });
    expect(tracksOf(entry, [trackSession("ses-a", "t1")])).toEqual([
      {
        id: "t1",
        key: "key-t1",
        namePl: "Sciezka t1",
        nameEn: "Track t1",
        accentColor: "#FA9346",
        sessionsCount: 1,
      },
    ]);
    // Pusta lista sesji to tez odpowiedz: prelegent nie wystepuje w zadnej.
    expect(tracksOf(entry, [])).toEqual([]);
  });

  it("wpis bez obsady ma pusta liste sciezek, nawet gdy program ma sesje w sciezkach", () => {
    expect(tracksOf(speakerEntry({ sessions: undefined }), [trackSession("ses-a", "t1")])).toEqual(
      [],
    );
  });

  // Klasa 1: sesja, ktorej program podgladu nie pokaze, nie daje sciezki.
  it("sesja ODWOLANA i PRYWATNA nie daja sciezki, widoczna obok - daje", () => {
    const entry = speakerEntry({
      sessions: [link("ses-cancelled"), link("ses-private"), link("ses-ok")],
    });
    const tracks = tracksOf(entry, [
      trackSession("ses-cancelled", "t-cancelled", { status: "cancelled" }),
      trackSession("ses-private", "t-private", { is_private: true }),
      trackSession("ses-ok", "t-ok"),
    ]);
    expect(tracks?.map((t) => t.id)).toEqual(["t-ok"]);
  });

  it("sesja BEZ sciezki nie daje kafla sciezki", () => {
    for (const empty of [null, "", "   "]) {
      const entry = speakerEntry({ sessions: [link("ses-a")] });
      expect(tracksOf(entry, [trackSession("ses-a", null, { track_id: empty })])).toEqual([]);
    }
  });

  it("powiazanie z sesja spoza listy nie daje sciezki", () => {
    const entry = speakerEntry({ sessions: [link("ses-nieznana")] });
    expect(tracksOf(entry, [trackSession("ses-a", "t1")])).toEqual([]);
  });

  it("kilka sesji w tej samej sciezce SUMUJE sie w jeden kafel z licznikiem", () => {
    const entry = speakerEntry({
      sessions: [link("ses-a"), link("ses-b"), link("ses-c"), link("ses-d")],
    });
    const tracks = tracksOf(entry, [
      trackSession("ses-a", "t1"),
      trackSession("ses-b", "t1"),
      trackSession("ses-c", "t2"),
      trackSession("ses-d", "t1"),
    ]);
    expect(tracks?.map((t) => [t.id, t.sessionsCount])).toEqual([
      ["t1", 3],
      ["t2", 1],
    ]);
  });

  it("sesja niewidoczna w tej samej sciezce NIE podbija licznika", () => {
    const entry = speakerEntry({ sessions: [link("ses-a"), link("ses-b"), link("ses-c")] });
    const tracks = tracksOf(entry, [
      trackSession("ses-a", "t1"),
      trackSession("ses-b", "t1", { status: "cancelled" }),
      trackSession("ses-c", "t1", { is_private: true }),
    ]);
    expect(tracks).toEqual([expect.objectContaining({ id: "t1", sessionsCount: 1 })]);
  });

  it("sciezki sa uporzadkowane po kluczu, a przy rownym kluczu po identyfikatorze", () => {
    const entry = speakerEntry({
      sessions: [link("s1"), link("s2"), link("s3"), link("s4"), link("s5")],
    });
    const tracks = tracksOf(entry, [
      trackSession("s1", "t-z", { track_key: "policy" }),
      trackSession("s2", "t-b", { track_key: "energy" }),
      trackSession("s3", "t-a", { track_key: "energy" }),
      // Brak klucza sortuje sie jak pusty napis - na poczatek, a dwa takie
      // miedzy soba - po identyfikatorze.
      trackSession("s4", "t-y", { track_key: null }),
      trackSession("s5", "t-x", { track_key: "" }),
    ]);
    expect(tracks?.map((t) => t.id)).toEqual(["t-x", "t-y", "t-a", "t-b", "t-z"]);
  });

  it("puste klucz, nazwy i kolor sciezki schodza do NULL, zamiast dawac kafel-widmo", () => {
    const entry = speakerEntry({ sessions: [link("ses-a")] });
    const tracks = tracksOf(entry, [
      trackSession("ses-a", "t1", {
        track_key: "",
        track_name_pl: "   ",
        track_name_en: null,
        track_accent_color: "",
      }),
    ]);
    expect(tracks).toEqual([
      { id: "t1", key: null, namePl: null, nameEn: null, accentColor: null, sessionsCount: 1 },
    ]);
  });

  it("kazdy prelegent dostaje WLASNE sciezki z tej samej listy sesji", () => {
    const rows = speakerRowsFromAdminEntries(
      [
        speakerEntry({ speaker_profile_id: "sp-1", sessions: [link("ses-a"), link("ses-b")] }),
        speakerEntry({ speaker_profile_id: "sp-2", sessions: [link("ses-b")] }),
      ],
      [trackSession("ses-a", "t1"), trackSession("ses-b", "t2")],
    );
    expect(rows.map((row) => row.tracks?.map((t) => t.id))).toEqual([["t1", "t2"], ["t2"]]);
  });
});

/* ------------------------------------------------------------- uczestnicy -- */

describe("attendeeEntriesFromRegistrationRows - kto wchodzi do katalogu", () => {
  it("BRAK ODPOWIEDZI to pusty katalog uczestnikow", () => {
    expect(attendeeEntriesFromRegistrationRows(undefined)).toEqual([]);
  });

  it("pusta lista zgloszen daje pusty katalog", () => {
    expect(attendeeEntriesFromRegistrationRows([])).toEqual([]);
  });

  it("wchodza zgloszenia ZATWIERDZONE i OBECNE", () => {
    const rows = attendeeEntriesFromRegistrationRows([
      registrationRow({ id: "a", status: "approved" }),
      registrationRow({ id: "b", status: "attended" }),
    ]);
    expect(rows.map((row) => row.registrationId)).toEqual(["a", "b"]);
  });

  it("NIE wchodzi nic poza tymi dwoma stanami", () => {
    // Katalog publiczny nie zna listy rezerwowej ani zgloszen odrzuconych.
    for (const status of ["pending", "waitlist", "cancelled", "rejected", "", "APPROVED"]) {
      expect(attendeeEntriesFromRegistrationRows([registrationRow({ status })])).toEqual([]);
    }
  });
});

describe("attendeeEntriesFromRegistrationRows - nazwisko decyduje o wpisie", () => {
  it("sklada imie i nazwisko jedna spacja", () => {
    expect(oneAttendee({ first_name: "Anna", last_name: "Kowalska" }).name).toBe("Anna Kowalska");
  });

  it("przycina obie czesci, zamiast wpuszczac podwojne spacje z bazy", () => {
    expect(oneAttendee({ first_name: "  Anna ", last_name: " Kowalska  " }).name).toBe(
      "Anna Kowalska",
    );
  });

  it("z jedna czescia nazwiska nie zostaje wiszaca spacja", () => {
    expect(oneAttendee({ first_name: "Anna", last_name: null }).name).toBe("Anna");
    expect(oneAttendee({ first_name: null, last_name: "Kowalska" }).name).toBe("Kowalska");
    expect(oneAttendee({ first_name: "", last_name: "Kowalska" }).name).toBe("Kowalska");
  });

  it("zgloszenie BEZ NAZWISKA wypada z katalogu, zamiast dawac pusta karte", () => {
    for (const [first, last] of [
      [null, null],
      ["", ""],
      ["   ", "  "],
      [null, "   "],
    ]) {
      expect(
        attendeeEntriesFromRegistrationRows([
          registrationRow({ first_name: first, last_name: last }),
        ]),
      ).toEqual([]);
    }
  });

  it("odsiew pustych nazwisk nie rusza pozostalych wpisow", () => {
    const rows = attendeeEntriesFromRegistrationRows([
      registrationRow({ id: "a", first_name: "Anna", last_name: "Kowalska" }),
      registrationRow({ id: "b", first_name: null, last_name: null }),
      registrationRow({ id: "c", first_name: "Celina", last_name: null }),
    ]);
    expect(rows.map((row) => row.registrationId)).toEqual(["a", "c"]);
  });
});

describe("attendeeEntriesFromRegistrationRows - firma, stanowisko i grupa", () => {
  it("stanowisko puste schodzi do NULL, niepuste jedzie dalej", () => {
    expect(oneAttendee({ job_title: "Dyrektor" }).jobTitle).toBe("Dyrektor");
    expect(oneAttendee({ job_title: null }).jobTitle).toBeNull();
    expect(oneAttendee({ job_title: "" }).jobTitle).toBeNull();
    expect(oneAttendee({ job_title: "   " }).jobTitle).toBeNull();
  });

  it("firma z KARTOTEKI wygrywa z firma wpisana recznie", () => {
    expect(oneAttendee({ company_name: "NES", company_text: "recznie" }).company).toBe("NES");
  });

  it("bez firmy z kartoteki wchodzi wpis reczny", () => {
    expect(oneAttendee({ company_name: null, company_text: "Firma z formularza" }).company).toBe(
      "Firma z formularza",
    );
    // Pusty napis w kolumnie kartoteki tez znaczy „nie ma firmy".
    expect(oneAttendee({ company_name: "  ", company_text: "Firma" }).company).toBe("Firma");
  });

  it("bez zadnej firmy zostaje NULL", () => {
    expect(oneAttendee({ company_name: null, company_text: null }).company).toBeNull();
    expect(oneAttendee({ company_name: "", company_text: "   " }).company).toBeNull();
  });

  it("zgloszenie BEZ GRUPY nie dostaje kafla grupy", () => {
    for (const empty of [null, undefined, "", "  "]) {
      expect(oneAttendee({ group_id: empty, group_name_pl: "Delegacja" }).groups).toEqual([]);
    }
  });

  it("grupa wchodzi jako jeden kafel z nazwami i kolorem", () => {
    expect(
      oneAttendee({
        group_id: "grp-1",
        group_name_pl: "Delegacja",
        group_name_en: "Delegation",
        group_color: "#123456",
      }).groups,
    ).toEqual([{ id: "grp-1", namePl: "Delegacja", nameEn: "Delegation", color: "#123456" }]);
  });

  it("grupa bez nazw ma PUSTE NAPISY, a kolor NULL", () => {
    // Nazwa grupy jest w widoku napisem (etykieta kafla), a kolor - opcja
    // stylu; dlatego te dwa pola maja rozne „puste".
    expect(
      oneAttendee({
        group_id: "grp-1",
        group_name_pl: null,
        group_name_en: null,
        group_color: "",
      }).groups,
    ).toEqual([{ id: "grp-1", namePl: "", nameEn: "", color: null }]);
  });

  it("pola, ktorych panel nie zna, sa puste - profil nalezy do uczestnika", () => {
    const entry = oneAttendee({ id: "reg-9" });
    expect(entry).toMatchObject({
      registrationId: "reg-9",
      userId: null,
      avatarUrl: null,
      profileSlug: null,
      companyLogoUrl: null,
      companyWebsite: null,
      industry: null,
      specialization: null,
      seekingPl: null,
      seekingEn: null,
      offeringPl: null,
      offeringEn: null,
      bioPl: null,
      bioEn: null,
      socialLinks: {},
    });
  });
});

/* ------------------------------------------------------------------ pasma -- */

describe("trackChipsFromAdminRows", () => {
  it("BRAK ODPOWIEDZI to pusty pasek pasm", () => {
    expect(trackChipsFromAdminRows(undefined)).toEqual([]);
  });

  it("pusta lista sciezek daje pusty pasek", () => {
    expect(trackChipsFromAdminRows([])).toEqual([]);
  });

  it("sciezka WYLACZONA znika z paska", () => {
    expect(trackChipsFromAdminRows([trackRow({ is_active: false })])).toEqual([]);
  });

  it("sciezka bez rozstrzygniecia o aktywnosci ZOSTAJE - odsiewamy tylko jawne `false`", () => {
    // Stare wiersze maja tu NULL; potraktowanie ich jako wylaczonych kasowaloby
    // z podgladu pasma, ktore na stronie sa widoczne.
    expect(trackChipsFromAdminRows([trackRow({ is_active: null })])).toHaveLength(1);
    expect(trackChipsFromAdminRows([trackRow({ is_active: undefined })])).toHaveLength(1);
    expect(trackChipsFromAdminRows([trackRow({ is_active: true })])).toHaveLength(1);
  });

  it("sciezka NIEPUBLICZNA zostaje na pasku, ale jest oznaczona", () => {
    // Redaktor musi zobaczyc pasmo, ktore wlasnie zalozyl - dlatego jedzie
    // z flaga, a nie wypada z listy.
    expect(oneChip({ is_public: false }).isPublic).toBe(false);
    expect(oneChip({ is_public: true }).isPublic).toBe(true);
    expect(oneChip({ is_public: null }).isPublic).toBe(true);
  });

  it("sponsor pasma wchodzi tylko z OGLOSZONEGO przypiecia", () => {
    const sponsored = trackRow({
      sponsor_id: "spn-1",
      sponsor_name: "Orlen",
      sponsor_logo_url: "https://cdn.example.org/orlen.svg",
    });
    expect(trackChipsFromAdminRows([sponsored])[0]).toMatchObject({
      sponsorName: "Orlen",
      sponsorLogoUrl: "https://cdn.example.org/orlen.svg",
    });
    expect(trackChipsFromAdminRows([sponsored], new Set(["spn-1"]))[0]?.sponsorName).toBe("Orlen");
    expect(trackChipsFromAdminRows([sponsored], new Set())[0]).toMatchObject({
      sponsorName: null,
      sponsorLogoUrl: null,
    });
  });

  it("SZKICE licza sie osobno, zamiast filtrowac pasmo", () => {
    expect(oneChip({ sessions_count: 4, draft_count: 3 })).toMatchObject({
      sessionsCount: 4,
      draftCount: 3,
    });
  });

  it("BRAK licznika to zero, a ZERO zostaje zerem", () => {
    expect(oneChip({ sessions_count: null, draft_count: null })).toMatchObject({
      sessionsCount: 0,
      draftCount: 0,
    });
    expect(oneChip({ sessions_count: undefined, draft_count: undefined })).toMatchObject({
      sessionsCount: 0,
      draftCount: 0,
    });
    expect(oneChip({ sessions_count: 0, draft_count: 0 })).toMatchObject({
      sessionsCount: 0,
      draftCount: 0,
    });
  });

  it("nazwy i kolor pasma jada dalej, gdy sa niepuste", () => {
    expect(oneChip({ id: "trk-9", name_pl: "Polityka", name_en: "Policy" })).toMatchObject({
      id: "trk-9",
      namePl: "Polityka",
      nameEn: "Policy",
      accentColor: "#FA9346",
    });
  });

  it("puste nazwy i kolor schodza do NULL, zamiast dawac kafel-widmo", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(oneChip({ name_pl: empty, name_en: empty, accent_color: empty })).toMatchObject({
        namePl: null,
        nameEn: null,
        accentColor: null,
      });
    }
  });

  it("z mieszanej listy zostaja tylko aktywne, w kolejnosci wejscia", () => {
    const chips = trackChipsFromAdminRows([
      trackRow({ id: "a" }),
      trackRow({ id: "b", is_active: false }),
      trackRow({ id: "c", is_active: null }),
    ]);
    expect(chips.map((chip) => chip.id)).toEqual(["a", "c"]);
  });
});

describe("publishedSponsorIdSet", () => {
  it("lista krotsza od limitu jest pelna - daje zbior do filtra", () => {
    expect(publishedSponsorIdSet([{ id: "a" }, { id: "b" }], 200)).toEqual(new Set(["a", "b"]));
    expect(publishedSponsorIdSet([], 200)).toEqual(new Set());
  });

  // Nakladka pyta dzis o WSZYSTKIE przypiecia (pas i sekcja „Partnerzy" rysuja
  // tez nieogloszone, z plakietka). Program i sciezki maja dalej brac sponsora
  // TYLKO z ogloszonego - wiec filtr odsiewa nieogloszone sam.
  it("z pelnej listy do zbioru wchodza tylko przypiecia OGLOSZONE", () => {
    expect(
      publishedSponsorIdSet(
        [
          { id: "a", is_published: true },
          { id: "b", is_published: false },
        ],
        200,
      ),
    ).toEqual(new Set(["a"]));
  });

  // Pelna strona moze byc ucieta: brak przypiecia na niej nie dowodzi, ze jest
  // nieogloszone, wiec podglad nie moze zdjac sponsora widocznego na stronie.
  it("pelna strona albo brak odpowiedzi to brak filtra", () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}` }));
    expect(publishedSponsorIdSet(full, 200)).toBeUndefined();
    expect(publishedSponsorIdSet(undefined, 200)).toBeUndefined();
  });

  it("limit liczy CALA liste, a nie same ogloszone - to ona moze byc ucieta", () => {
    const mixed = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      is_published: i % 2 === 0,
    }));
    expect(publishedSponsorIdSet(mixed, 200)).toBeUndefined();
  });
});
