// Reguły produktowe warstwy sieciującej - te, które muszą znaczyć to samo
// w bazie i w interfejsie.
//
// Trzy z nich są tu, bo ROZJAZD JEST NIEWIDOCZNY: licznik znaków liczący
// inaczej niż CHECK w bazie, opis ucięty w połowie słowa i twarz bez
// identyfikatora nie wywracają ekranu - po prostu robią coś odrobinę innego,
// niż obiecuje reszta systemu.
import { describe, expect, it } from "vitest";
import {
  expertContribution,
  firstSentences,
  hasRosterContent,
  isNoticeBodyValid,
  isNoticeExpiringSoon,
  mondayOf,
  noticeDaysLeft,
  noticeOutcome,
  normalizeNoticeBody,
  parseRosterFaces,
  rosterRotationTick,
  rotateRosterFaces,
  spotlightBlurb,
  toClubNoticeKind,
  toRsvpPresentState,
  CLUB_ROSTER_ROTATION_MS,
  type ClubRosterFace,
  type ClubRosterSignal,
  type ClubSpotlightRow,
} from "@/lib/clubs/networkTypes";

describe("ogłoszenie: jedna linia", () => {
  it("zwija białe znaki dokładnie tak, jak zrobi to RPC", () => {
    // `club_board_notice_create` robi regexp_replace('\s+', ' ') + btrim.
    // Licznik pod polem MUSI liczyć ten sam tekst - inaczej pokazuje
    // "279 / 280" nad wpisem, który baza odrzuci.
    expect(normalizeNoticeBody("  Szukam   kontaktu w  MON  ")).toBe("Szukam kontaktu w MON");
    expect(normalizeNoticeBody("linia\npierwsza\tdruga")).toBe("linia pierwsza druga");
  });

  it("długość mierzy PO normalizacji, nie na surowym wejściu", () => {
    // "szukam x" to równo osiem znaków - próg z CHECK-a - mimo dwudziestu
    // spacji dookoła i w środku.
    expect(isNoticeBodyValid("   szukam    x   ")).toBe(true);
    // "szukam" po zwinięciu ma sześć znaków, czyli poniżej progu.
    expect(isNoticeBodyValid("   szukam   ")).toBe(false);
    expect(isNoticeBodyValid("  a   b  ")).toBe(false);
    expect(isNoticeBodyValid("x".repeat(281))).toBe(false);
    expect(isNoticeBodyValid("x".repeat(280))).toBe(true);
  });

  it("nieznany rodzaj degraduje do 'szukam', a nie wywraca listy", () => {
    expect(toClubNoticeKind("offering")).toBe("offering");
    expect(toClubNoticeKind("nowy_rodzaj_z_migracji")).toBe("seeking");
  });
});

describe("ogłoszenie: ważność", () => {
  const now = new Date("2026-08-10T12:00:00Z");

  it("liczy pełne dni w górę - ostatnia doba to nadal 'jutro'", () => {
    expect(noticeDaysLeft("2026-08-13T12:00:00Z", now)).toBe(3);
    expect(noticeDaysLeft("2026-08-10T23:00:00Z", now)).toBe(1);
  });

  it("wygasłe zwraca zero, nigdy liczby ujemnej", () => {
    // Ujemna liczba dni nie jest informacją, tylko usterką do pokazania.
    expect(noticeDaysLeft("2026-08-01T12:00:00Z", now)).toBe(0);
    expect(noticeDaysLeft("to nie jest data", now)).toBe(0);
  });

  it("ostrzega dopiero na ostatniej prostej i nigdy po wygaśnięciu", () => {
    expect(isNoticeExpiringSoon("2026-08-12T12:00:00Z", now)).toBe(true);
    expect(isNoticeExpiringSoon("2026-08-20T12:00:00Z", now)).toBe(false);
    expect(isNoticeExpiringSoon("2026-08-01T12:00:00Z", now)).toBe(false);
  });
});

describe("poznaj członka: trzy zdania", () => {
  it("tnie po granicy zdania, nie po liczbie znaków", () => {
    const text = "Pierwsze zdanie. Drugie zdanie! Trzecie zdanie? Czwarte zdanie.";
    expect(firstSentences(text)).toBe("Pierwsze zdanie. Drugie zdanie! Trzecie zdanie?");
  });

  it("tekst bez granicy zdania wraca w CAŁOŚCI", () => {
    // Lepiej cztery linijki niż ucięcie w losowym miejscu.
    const text = "Notka bez kropki, która ciągnie się i ciągnie";
    expect(firstSentences(text)).toBe(text);
  });

  it("krótszy tekst niż limit zostaje nietknięty", () => {
    expect(firstSentences("Jedno zdanie.")).toBe("Jedno zdanie.");
  });

  it("kropka po skrócie NIE kończy zdania - inaczej biogram urywa się na 'm.in.'", () => {
    expect(firstSentences("Pracował m.in. w MON. Drugie. Trzecie. Czwarte.")).toBe(
      "Pracował m.in. w MON. Drugie. Trzecie.",
    );
    expect(firstSentences("Doradzał np. Radzie. Drugie. Trzecie. Czwarte.")).toBe(
      "Doradzał np. Radzie. Drugie. Trzecie.",
    );
    expect(firstSentences("Advised e.g. the Council. Second. Third. Fourth.")).toBe(
      "Advised e.g. the Council. Second. Third.",
    );
  });

  it("skrót z wielkiej litery nadal kończy zdanie - 'NATO.' to nie skrót", () => {
    expect(firstSentences("Pracował w NATO. Drugie. Trzecie. Czwarte.")).toBe(
      "Pracował w NATO. Drugie. Trzecie.",
    );
  });

  it("normalizuje białe znaki, żeby opis z profilu nie rozbił szyny", () => {
    expect(firstSentences("Pierwsze\n\n  zdanie.  Drugie.")).toBe("Pierwsze zdanie. Drugie.");
  });
});

describe("poznaj członka: kolejność źródeł opisu", () => {
  const base: ClubSpotlightRow = {
    user_id: "u1",
    display_name: "Osoba",
    avatar_url: null,
    profile_slug: null,
    headline: "Analityk - NES",
    club_role: "member",
    bio_pl: null,
    bio_en: null,
    blurb_pl: null,
    blurb_en: null,
    topics: [],
    joined_at: "2026-01-01T00:00:00Z",
    curated: false,
    week_start: "2026-08-10",
  };

  it("blurb redakcyjny wygrywa z opisem profilu", () => {
    const row = { ...base, blurb_pl: "Redakcja o tej osobie.", bio_pl: "Własny opis." };
    expect(spotlightBlurb(row, "pl")).toBe("Redakcja o tej osobie.");
  });

  it("bez blurba schodzi na opis profilu w JĘZYKU INTERFEJSU", () => {
    const row = { ...base, bio_pl: "Opis polski.", bio_en: "English bio." };
    expect(spotlightBlurb(row, "pl")).toBe("Opis polski.");
    expect(spotlightBlurb(row, "en")).toBe("English bio.");
  });

  it("opis w drugim języku jest lepszy niż pusty moduł", () => {
    const row = { ...base, bio_en: "Only English." };
    expect(spotlightBlurb(row, "pl")).toBe("Only English.");
  });

  it("ostatnią deską jest stanowisko - nadal zdanie o człowieku", () => {
    expect(spotlightBlurb(base, "pl")).toBe("Analityk - NES");
  });

  it("brak wszystkiego zwraca pusty tekst, a nie 'undefined'", () => {
    expect(spotlightBlurb({ ...base, headline: null }, "pl")).toBe("");
  });
});

describe("skład: odczyt jsonb", () => {
  it("czyta twarz z kompletem sygnałów", () => {
    const faces = parseRosterFaces([
      {
        user_id: "u1",
        name: "Igor",
        avatar_url: "https://e.org/a.png",
        slug: "igor",
        headline: "Dyrektor - MSZ",
        role: "lead",
        joined_at: "2026-01-05T10:00:00Z",
        is_new: true,
        is_active: true,
        topics: ["geopolitics", "energy"],
      },
    ]);
    expect(faces).toEqual([
      {
        userId: "u1",
        name: "Igor",
        avatarUrl: "https://e.org/a.png",
        slug: "igor",
        headline: "Dyrektor - MSZ",
        role: "lead",
        joinedAt: "2026-01-05T10:00:00Z",
        isNew: true,
        isActive: true,
        topics: ["geopolitics", "energy"],
      },
    ]);
  });

  it("jeden zepsuty wpis nie zabiera z ekranu pozostałych", () => {
    // Ta sama doktryna, co w `workspaceTypes.mapJsonArray`.
    const faces = parseRosterFaces([
      { name: "Bez identyfikatora" },
      null,
      "tekst zamiast obiektu",
      { user_id: "u2", name: "Ktoś" },
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0].userId).toBe("u2");
    expect(faces[0].topics).toEqual([]);
    expect(faces[0].isActive).toBe(false);
    // Profil bez stanowiska ma dać `null`, a nie pusty napis - plakietka
    // rysuje linijkę opisu WYŁĄCZNIE wtedy, gdy jest co w niej napisać.
    expect(faces[0].headline).toBeNull();
    expect(faces[0].joinedAt).toBeNull();
  });

  it("wartość, która nie jest tablicą, daje pustą listę zamiast wyjątku", () => {
    expect(parseRosterFaces(null)).toEqual([]);
    expect(parseRosterFaces({ faces: [] })).toEqual([]);
  });
});

describe("skład: kiedy panel ma co pokazać", () => {
  const empty: ClubRosterSignal = {
    membersTotal: 0,
    new7d: 0,
    active24h: 0,
    active7d: 0,
    faces: [],
  };

  it("liczby BEZ twarzy to poprawny stan, nie pustka", () => {
    // Klub ukrywający skład oddaje liczby i zero awatarów - i to nadal jest
    // informacja, więc panel zostaje.
    expect(hasRosterContent({ ...empty, membersTotal: 12 })).toBe(true);
  });

  it("brak wszystkiego chowa panel", () => {
    expect(hasRosterContent(empty)).toBe(false);
    expect(hasRosterContent(null)).toBe(false);
  });
});

describe("skład: rotacja sześciu twarzy", () => {
  const face = (id: string, isActive = false): ClubRosterFace => ({
    userId: id,
    name: id,
    avatarUrl: null,
    slug: null,
    headline: null,
    role: "member",
    joinedAt: null,
    isNew: false,
    isActive,
    topics: [],
  });

  const ids = (faces: readonly ClubRosterFace[]): string[] => faces.map((f) => f.userId);

  it("klub mniejszy niż panel nie rotuje - wszyscy stoją zawsze", () => {
    // Rotacja w czteroosobowym klubie byłaby ruchem bez informacji: te same
    // cztery osoby przestawione co sześć godzin wyglądają jak usterka.
    const small = [face("a"), face("b"), face("c"), face("d")];
    expect(ids(rotateRosterFaces(small, 6, 0))).toEqual(["a", "b", "c", "d"]);
    expect(ids(rotateRosterFaces(small, 6, 77))).toEqual(["a", "b", "c", "d"]);
  });

  it("osoba aktywna w dobie NIE wypada z rotacji", () => {
    // Kropka obecności jest jedynym sygnałem "tu ktoś jest" na całej stronie
    // klubu. Gdyby zależała od numeru okna, znaczyłaby tyle, co rzut monetą.
    const pool = [face("live", true), ...["b", "c", "d", "e", "f", "g", "h"].map((i) => face(i))];
    for (const tick of [0, 1, 2, 3, 17, 100]) {
      expect(ids(rotateRosterFaces(pool, 6, tick))).toContain("live");
    }
  });

  it("kolejne okna pokazują KOGOŚ INNEGO z ogona", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((i) => face(i));
    const first = ids(rotateRosterFaces(pool, 6, 0));
    const second = ids(rotateRosterFaces(pool, 6, 1));
    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect(second).not.toEqual(first);
  });

  it("okno przesuwa się o SWOJĄ SZEROKOŚĆ, nie o jedną pozycję", () => {
    // To jest różnica między rotacją a pełzaniem. Krok jednopozycyjny daje
    // okna nachodzące na siebie w pięciu szóstych: 0-5, 1-6, 2-7 - i wtedy
    // dwudziestoosobowy klub potrzebuje prawie czterech dni, żeby pokazać
    // wszystkich, mimo czterech zmian dziennie.
    const pool = Array.from({ length: 20 }, (_, i) => face(`p${i}`));
    expect(ids(rotateRosterFaces(pool, 6, 0))).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(ids(rotateRosterFaces(pool, 6, 1))).toEqual(["p6", "p7", "p8", "p9", "p10", "p11"]);
    expect(ids(rotateRosterFaces(pool, 6, 2))).toEqual(["p12", "p13", "p14", "p15", "p16", "p17"]);
  });

  it("doba czterech okien pokazuje dwudziestoosobowy klub W KOMPLECIE", () => {
    // Obietnica z komentarza przy `CLUB_ROSTER_ROTATION_MS` - tu jest jej
    // egzekucja, żeby nie została samym zdaniem w dokumentacji.
    const pool = Array.from({ length: 20 }, (_, i) => face(`p${i}`));
    const seen = new Set<string>();
    for (const tick of [0, 1, 2, 3]) {
      ids(rotateRosterFaces(pool, 6, tick)).forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(20);
  });

  it("krok liczy się od WOLNYCH miejsc, a nie od wielkości panelu", () => {
    // Dwie osoby aktywne zabierają dwa miejsca, więc oknem rotacji są cztery
    // pozostałe - i o cztery, nie o sześć, ma się przesunąć.
    const pool = [
      face("live1", true),
      face("live2", true),
      ...Array.from({ length: 12 }, (_, i) => face(`p${i}`)),
    ];
    expect(ids(rotateRosterFaces(pool, 6, 0))).toEqual(["live1", "live2", "p0", "p1", "p2", "p3"]);
    expect(ids(rotateRosterFaces(pool, 6, 1))).toEqual(["live1", "live2", "p4", "p5", "p6", "p7"]);
  });

  it("okno zawija się na końcu puli i nie gubi miejsca", () => {
    // Ostatnie okno musi dobrać brakujące twarze z początku listy, a nie
    // pokazać czterech osób w sześciu miejscach.
    const pool = ["a", "b", "c", "d", "e", "f", "g"].map((i) => face(i));
    expect(rotateRosterFaces(pool, 6, 5)).toHaveLength(6);
    expect(rotateRosterFaces(pool, 6, 6)).toHaveLength(6);
    expect(new Set(ids(rotateRosterFaces(pool, 6, 5))).size).toBe(6);
  });

  it("to samo okno daje ten sam skład - rotacja jest deterministyczna", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g", "h"].map((i) => face(i));
    expect(ids(rotateRosterFaces(pool, 6, 42))).toEqual(ids(rotateRosterFaces(pool, 6, 42)));
  });

  it("ujemny numer okna nie wpuszcza dziury w listę twarzy", () => {
    // Data sprzed epoki daje ujemny `tick`; ujemny indeks tablicy dałby
    // `undefined` w środku rzędu awatarów.
    const pool = ["a", "b", "c", "d", "e", "f", "g"].map((i) => face(i));
    const shown = rotateRosterFaces(pool, 6, -3);
    expect(shown).toHaveLength(6);
    expect(shown.every((f) => f !== undefined)).toBe(true);
  });

  it("okno rotacji ma sześć godzin, liczone od epoki", () => {
    expect(rosterRotationTick(0)).toBe(0);
    expect(rosterRotationTick(CLUB_ROSTER_ROTATION_MS - 1)).toBe(0);
    expect(rosterRotationTick(CLUB_ROSTER_ROTATION_MS)).toBe(1);
    expect(rosterRotationTick(CLUB_ROSTER_ROTATION_MS * 4)).toBe(4);
  });
});

describe("ogłoszenie: jak się skończyło", () => {
  it("odróżnia trzy różne końce, a nie jeden 'zamknięte'", () => {
    // "Załatwione" jest SUKCESEM mechanizmu, "wygasło" - porażką ciszy,
    // "zdjęte" - decyzją moderacji. Jeden szary napis na wszystkie trzy
    // odbiera autorowi jedyną informację zwrotną, jaką ten moduł produkuje.
    expect(noticeOutcome({ status: "open", is_expired: false })).toBe("open");
    expect(noticeOutcome({ status: "closed", is_expired: false })).toBe("resolved");
    expect(noticeOutcome({ status: "removed", is_expired: false })).toBe("removed");
    expect(noticeOutcome({ status: "open", is_expired: true })).toBe("expired");
  });

  it("zamknięte przez autora zostaje 'załatwione', nawet gdy termin minął", () => {
    // Kolejność jest istotna: ogłoszenie zamknięte tydzień temu ma dziś
    // przeterminowaną datę ważności, ale skończyło się SUKCESEM.
    expect(noticeOutcome({ status: "closed", is_expired: true })).toBe("resolved");
    expect(noticeOutcome({ status: "removed", is_expired: true })).toBe("removed");
  });
});

describe("katalog ekspertów", () => {
  it("wątek waży tyle samo co odpowiedź", () => {
    // Założenie tematu i rozstrzygająca odpowiedź pod cudzym są w klubie
    // deliberacyjnym wkładem tej samej klasy - ważenie ich różnie zamieniłoby
    // katalog kompetencji w ranking autorów.
    expect(expertContribution({ thread_count: 2, reply_count: 5 })).toBe(7);
    expect(expertContribution({ thread_count: 0, reply_count: 0 })).toBe(0);
  });
});

describe("poznaj członka: tydzień redakcyjny", () => {
  it("dowolny dzień normalizuje do poniedziałku tego tygodnia", () => {
    // Redakcja wybiera datę z kalendarza, nie numer tygodnia ISO. Środa
    // odrzucona błędem zapisu byłaby podatkiem od tego, że kalendarz
    // pokazuje dni.
    expect(mondayOf(new Date(2026, 7, 12))).toBe("2026-08-10"); // środa
    expect(mondayOf(new Date(2026, 7, 10))).toBe("2026-08-10"); // poniedziałek
  });

  it("niedziela należy do tygodnia, który się KOŃCZY, a nie zaczyna", () => {
    // Tydzień ISO zaczyna się w poniedziałek - `getDay()` daje dla niedzieli
    // zero i naiwne odjęcie cofnęłoby o cały tydzień za dużo.
    expect(mondayOf(new Date(2026, 7, 16))).toBe("2026-08-10");
  });

  it("przekracza granicę miesiąca bez gubienia dnia", () => {
    expect(mondayOf(new Date(2026, 8, 2))).toBe("2026-08-31");
  });
});

describe("obecność na spotkaniu", () => {
  it("nieznany stan degraduje do 'będę', bo lista pokazuje tylko obecnych", () => {
    expect(toRsvpPresentState("going")).toBe("going");
    expect(toRsvpPresentState("maybe")).toBe("maybe");
    expect(toRsvpPresentState("cokolwiek")).toBe("going");
  });
});
