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

  it("lista prelegentow sesji jest pusta - panel oddaje ich osobnym zapytaniem", () => {
    expect(oneSession({}).speakers).toEqual([]);
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
    ).toEqual({ id: "trk-1", key: null, namePl: null, nameEn: null, accentColor: null });
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
