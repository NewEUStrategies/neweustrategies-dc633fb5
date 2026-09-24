// Obsada sesji w panelu: parser szczegolu sesji i operacje edytora obsady.
//
// DLACZEGO TEN TEST ISTNIEJE. Zapis obsady to PODMIANA calej listy
// (`admin_event_session_speakers_set` usuwa wiersze nieobecne w tablicy), wiec
// kazdy blad tej warstwy jest cichy i trwaly: zgubiony duplikat, zla
// kolejnosc albo kandydat legacy bez nakladki konczy sie obsada w programie
// inna niz ta, ktora redaktor widzial w edytorze. Od 0048 szczegol sesji
// zwraca tez osoby BEZ konta - parser nie moze ich odsiewac.
import { describe, expect, it } from "vitest";

import type { EventSpeakerEntry } from "@/lib/admin/community";
import {
  castCandidates,
  castMemberFromEntry,
  moveCastMember,
  parseSessionCast,
  sessionCastSignature,
  sessionCastToInput,
  sessionSpeakerRole,
  type SessionCastMember,
} from "@/lib/events/sessionCast";
import { SESSION_SPEAKER_ROLES } from "@/lib/events/sessionsApi";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const P3 = "33333333-3333-3333-3333-333333333333";

function rawMember(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    speaker_profile_id: P1,
    display_name: "Anna Nowak",
    avatar_url: "https://cdn.example/anna.jpg",
    headline_pl: "Dyrektorka programowa",
    job_title: "Director",
    is_public: true,
    role: "moderator",
    sort_order: 10,
    allow_overlap: false,
    ...overrides,
  };
}

function member(overrides: Partial<SessionCastMember> = {}): SessionCastMember {
  return {
    speakerProfileId: P1,
    displayName: "Anna Nowak",
    avatarUrl: null,
    jobTitle: null,
    isPublic: true,
    role: "speaker",
    allowOverlap: false,
    ...overrides,
  };
}

function entry(overrides: Partial<EventSpeakerEntry> = {}): EventSpeakerEntry {
  return {
    entry_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    speaker_profile_id: P1,
    user_id: null,
    person_id: "99999999-9999-9999-9999-999999999999",
    display_name: "Anna Nowak",
    avatar_url: "https://cdn.example/anna.jpg",
    job_title: "Director",
    company: "NES",
    email: "anna@example.com",
    is_public: true,
    sort_order: 0,
    is_legacy: false,
    ...overrides,
  };
}

const ids = (cast: readonly SessionCastMember[]) => cast.map((m) => m.speakerProfileId);

describe("sessionSpeakerRole", () => {
  it.each(SESSION_SPEAKER_ROLES)("przepuszcza znana role %s", (role) => {
    expect(sessionSpeakerRole(role)).toBe(role);
  });

  it.each([null, undefined, "", "Speaker", "keynote", 1, {}])(
    "nieznana wartosc %p -> prelegent",
    (value) => {
      expect(sessionSpeakerRole(value)).toBe("speaker");
    },
  );
});

describe("parseSessionCast", () => {
  it("zwraca pusta liste dla wejscia, ktore nie jest tablica", () => {
    expect(parseSessionCast(null)).toEqual([]);
    expect(parseSessionCast(undefined)).toEqual([]);
    expect(parseSessionCast(rawMember())).toEqual([]);
    expect(parseSessionCast("[]")).toEqual([]);
  });

  it("mapuje pelny wpis na czlonka obsady", () => {
    expect(parseSessionCast([rawMember({ allow_overlap: true })])).toEqual([
      {
        speakerProfileId: P1,
        displayName: "Anna Nowak",
        avatarUrl: "https://cdn.example/anna.jpg",
        jobTitle: "Dyrektorka programowa",
        isPublic: true,
        role: "moderator",
        allowOverlap: true,
      },
    ]);
  });

  it("osoba bez konta (bez nazwy, zdjecia i stanowiska) zostaje w obsadzie", () => {
    const [only] = parseSessionCast([
      {
        speaker_profile_id: P2,
        display_name: null,
        avatar_url: "  ",
        headline_pl: null,
        job_title: null,
      },
    ]);
    expect(only).toEqual({
      speakerProfileId: P2,
      displayName: "",
      avatarUrl: null,
      jobTitle: null,
      isPublic: true,
      role: "speaker",
      allowOverlap: false,
    });
  });

  it("naglowek sceniczny ma pierwszenstwo przed stanowiskiem, pusty go nie przykrywa", () => {
    expect(parseSessionCast([rawMember()])[0].jobTitle).toBe("Dyrektorka programowa");
    expect(parseSessionCast([rawMember({ headline_pl: "  " })])[0].jobTitle).toBe("Director");
    expect(parseSessionCast([rawMember({ headline_pl: undefined })])[0].jobTitle).toBe("Director");
  });

  it("obcina spacje w id i nazwie", () => {
    const [only] = parseSessionCast([
      rawMember({ speaker_profile_id: `  ${P1} `, display_name: " Anna Nowak " }),
    ]);
    expect(only.speakerProfileId).toBe(P1);
    expect(only.displayName).toBe("Anna Nowak");
  });

  it("ustawia kolejnosc po sort_order (takze podanym jako napis)", () => {
    const cast = parseSessionCast([
      rawMember({ speaker_profile_id: P1, sort_order: 30 }),
      rawMember({ speaker_profile_id: P2, sort_order: "10" }),
      rawMember({ speaker_profile_id: P3, sort_order: 20 }),
    ]);
    expect(ids(cast)).toEqual([P2, P3, P1]);
  });

  it("brak albo nieliczbowy sort_order liczy jako 0, remisy zachowuja kolejnosc z bazy", () => {
    const cast = parseSessionCast([
      rawMember({ speaker_profile_id: P1, sort_order: 5 }),
      rawMember({ speaker_profile_id: P2, sort_order: "abc" }),
      rawMember({ speaker_profile_id: P3, sort_order: undefined }),
    ]);
    expect(ids(cast)).toEqual([P2, P3, P1]);
  });

  it("odsiewa duplikat osoby - pierwszy wpis w kolejnosci z bazy wygrywa", () => {
    const cast = parseSessionCast([
      rawMember({ speaker_profile_id: P1, role: "host", sort_order: 20 }),
      rawMember({ speaker_profile_id: P2, sort_order: 10 }),
      rawMember({ speaker_profile_id: ` ${P1}`, role: "panelist", sort_order: 1 }),
    ]);
    expect(ids(cast)).toEqual([P2, P1]);
    expect(cast[1].role).toBe("host");
  });

  it("pomija wpisy nie-obiektowe i bez identyfikatora nakladki", () => {
    const cast = parseSessionCast([
      null,
      undefined,
      "P1",
      7,
      [rawMember()],
      rawMember({ speaker_profile_id: null }),
      rawMember({ speaker_profile_id: "   " }),
      rawMember({ speaker_profile_id: 123 }),
      rawMember({ speaker_profile_id: P3 }),
    ]);
    expect(ids(cast)).toEqual([P3]);
  });

  it("is_public: tylko jawne false ukrywa osobe z publicznego programu", () => {
    const visibility = [false, true, undefined, null, "false", 0].map(
      (is_public) => parseSessionCast([rawMember({ is_public })])[0].isPublic,
    );
    expect(visibility).toEqual([false, true, true, true, true, true]);
  });

  it("allow_overlap: tylko jawne true jest zgoda na kolizje", () => {
    const overlap = [true, false, undefined, "true", 1].map(
      (allow_overlap) => parseSessionCast([rawMember({ allow_overlap })])[0].allowOverlap,
    );
    expect(overlap).toEqual([true, false, false, false, false]);
  });

  it("nieznana rola z bazy staje sie rola prelegenta", () => {
    expect(parseSessionCast([rawMember({ role: "keynote" })])[0].role).toBe("speaker");
    expect(parseSessionCast([rawMember({ role: undefined })])[0].role).toBe("speaker");
  });
});

describe("castMemberFromEntry", () => {
  it("wpis rejestru -> nowy czlonek z rola prelegenta i bez zgody na kolizje", () => {
    expect(castMemberFromEntry(entry({ headline_pl: "Dyrektorka programowa" }))).toEqual({
      speakerProfileId: P1,
      displayName: "Anna Nowak",
      avatarUrl: "https://cdn.example/anna.jpg",
      jobTitle: "Dyrektorka programowa",
      isPublic: true,
      role: "speaker",
      allowOverlap: false,
    });
  });

  it("bez naglowka scenicznego bierze stanowisko", () => {
    expect(castMemberFromEntry(entry()).jobTitle).toBe("Director");
    expect(castMemberFromEntry(entry({ headline_pl: null })).jobTitle).toBe("Director");
    expect(castMemberFromEntry(entry({ headline_pl: null, job_title: null })).jobTitle).toBeNull();
  });

  it("brak nazwy -> pusty napis; nakladka niepubliczna zostaje niepubliczna", () => {
    const result = castMemberFromEntry(
      entry({ display_name: null, avatar_url: null, is_public: false }),
    );
    expect(result).toMatchObject({ displayName: "", avatarUrl: null, isPublic: false });
  });
});

describe("castCandidates", () => {
  it("bez rejestru (zapytanie jeszcze nie wrocilo) -> pusta lista", () => {
    expect(castCandidates(undefined, [])).toEqual([]);
    expect(castCandidates([], [member()])).toEqual([]);
  });

  it("pomija osoby juz obsadzone i zachowuje kolejnosc rejestru", () => {
    const entries = [
      entry({ speaker_profile_id: P3 }),
      entry({ speaker_profile_id: P1 }),
      entry({ speaker_profile_id: P2 }),
    ];
    const result = castCandidates(entries, [member({ speakerProfileId: P1 })]);
    expect(result.map((e) => e.speaker_profile_id)).toEqual([P3, P2]);
    expect(result[0]).toBe(entries[0]);
  });

  it("pomija rzad legacy bez nakladki (pusty speaker_profile_id)", () => {
    const entries = [
      entry({ speaker_profile_id: "", entry_id: null, is_legacy: true }),
      entry({ speaker_profile_id: P2 }),
    ];
    expect(castCandidates(entries, []).map((e) => e.speaker_profile_id)).toEqual([P2]);
  });

  it("gdy wszyscy sa obsadzeni, nie ma kandydatow", () => {
    const entries = [entry({ speaker_profile_id: P1 }), entry({ speaker_profile_id: P2 })];
    const cast = [member({ speakerProfileId: P2 }), member({ speakerProfileId: P1 })];
    expect(castCandidates(entries, cast)).toEqual([]);
  });

  it("nie zmienia tablicy wejsciowej", () => {
    const entries = [entry({ speaker_profile_id: P1 }), entry({ speaker_profile_id: P2 })];
    castCandidates(entries, [member({ speakerProfileId: P1 })]);
    expect(entries.map((e) => e.speaker_profile_id)).toEqual([P1, P2]);
  });
});

describe("sessionCastToInput", () => {
  it("numeruje co 10 wedlug pozycji na liscie i przenosi role oraz zgode na kolizje", () => {
    const cast = [
      member({ speakerProfileId: P2, role: "moderator" }),
      member({ speakerProfileId: P1, role: "panelist", allowOverlap: true }),
      member({ speakerProfileId: P3, role: "host" }),
    ];
    expect(sessionCastToInput(cast)).toEqual([
      { speakerProfileId: P2, role: "moderator", sortOrder: 10, allowOverlap: false },
      { speakerProfileId: P1, role: "panelist", sortOrder: 20, allowOverlap: true },
      { speakerProfileId: P3, role: "host", sortOrder: 30, allowOverlap: false },
    ]);
  });

  it("nie wysyla pol widoku (nazwa, zdjecie, widocznosc) do RPC", () => {
    const [only] = sessionCastToInput([member()]);
    expect(Object.keys(only).sort()).toEqual(
      ["allowOverlap", "role", "sortOrder", "speakerProfileId"].sort(),
    );
  });

  it("pusta obsada -> pusta tablica (zapis zdejmuje wszystkich)", () => {
    expect(sessionCastToInput([])).toEqual([]);
  });

  it("przestawienie w edytorze jest przestawieniem numeracji", () => {
    const cast = [member({ speakerProfileId: P1 }), member({ speakerProfileId: P2 })];
    const moved = sessionCastToInput(moveCastMember(cast, 1, -1));
    expect(moved.map((s) => [s.speakerProfileId, s.sortOrder])).toEqual([
      [P2, 10],
      [P1, 20],
    ]);
  });
});

describe("sessionCastSignature", () => {
  it("sklada id i role w kolejnosci listy", () => {
    expect(
      sessionCastSignature([
        member({ speakerProfileId: P1, role: "moderator" }),
        member({ speakerProfileId: P2 }),
      ]),
    ).toBe(`${P1}:moderator|${P2}:speaker`);
    expect(sessionCastSignature([])).toBe("");
  });

  it("wykrywa zmiane kolejnosci, roli i skladu", () => {
    const base = [member({ speakerProfileId: P1 }), member({ speakerProfileId: P2 })];
    const signature = sessionCastSignature(base);
    expect(sessionCastSignature([...base].reverse())).not.toBe(signature);
    expect(sessionCastSignature([base[0], { ...base[1], role: "host" }])).not.toBe(signature);
    expect(sessionCastSignature([base[0]])).not.toBe(signature);
    expect(sessionCastSignature([...base, member({ speakerProfileId: P3 })])).not.toBe(signature);
  });

  it("ignoruje pola widoku, ktorych edytor nie zapisuje", () => {
    // Edytor obsady nie edytuje nazwy, zdjecia, widocznosci ani zgody na
    // kolizje - odswiezenie tych pol z serwera nie jest „niezapisana zmiana".
    const base = [member({ speakerProfileId: P1 })];
    expect(
      sessionCastSignature([
        {
          ...base[0],
          displayName: "Inna",
          avatarUrl: "https://x",
          isPublic: false,
          allowOverlap: true,
        },
      ]),
    ).toBe(sessionCastSignature(base));
  });
});

describe("moveCastMember", () => {
  const cast = [
    member({ speakerProfileId: P1 }),
    member({ speakerProfileId: P2 }),
    member({ speakerProfileId: P3 }),
  ];

  it("przesuwa o jedna pozycje w gore i w dol", () => {
    expect(ids(moveCastMember(cast, 1, -1))).toEqual([P2, P1, P3]);
    expect(ids(moveCastMember(cast, 1, 1))).toEqual([P1, P3, P2]);
    expect(ids(moveCastMember(cast, 0, 1))).toEqual([P2, P1, P3]);
    expect(ids(moveCastMember(cast, 2, -1))).toEqual([P1, P3, P2]);
  });

  it("na brzegu listy zostawia kolejnosc bez zmian", () => {
    expect(ids(moveCastMember(cast, 0, -1))).toEqual([P1, P2, P3]);
    expect(ids(moveCastMember(cast, 2, 1))).toEqual([P1, P2, P3]);
  });

  it("indeks poza lista zostawia kolejnosc bez zmian", () => {
    expect(ids(moveCastMember(cast, -1, 1))).toEqual([P1, P2, P3]);
    expect(ids(moveCastMember(cast, 3, -1))).toEqual([P1, P2, P3]);
    expect(ids(moveCastMember(cast, 10, 1))).toEqual([P1, P2, P3]);
    expect(moveCastMember([], 0, 1)).toEqual([]);
  });

  it("zawsze zwraca NOWA tablice i nie zmienia wejscia", () => {
    const moved = moveCastMember(cast, 0, 1);
    const unchanged = moveCastMember(cast, 0, -1);
    expect(moved).not.toBe(cast);
    expect(unchanged).not.toBe(cast);
    expect(ids(cast)).toEqual([P1, P2, P3]);
    expect(moved[0]).toBe(cast[1]);
  });
});
