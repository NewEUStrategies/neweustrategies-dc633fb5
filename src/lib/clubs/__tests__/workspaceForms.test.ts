// Reguły trzech formularzy przestrzeni roboczej - TABELA PRZYPADKÓW na czystych
// funkcjach, bez montowania czegokolwiek.
//
// CO TO DOWODZI. Te reguły są kontraktem z bazą, a nie układem ekranu: CHECK-i
// migracji 20260808300000 odrzucają tytuł krótszy niż dwa (wydarzenie) i trzy
// (pozycja wątku) znaki, wymagają adresu dla źródła innego niż notatka,
// odrzucają koniec przed początkiem i wymagają sluga przy TWORZENIU wydarzenia.
// Do niedawna każda z nich żyła wewnątrz domknięcia komponentu, więc jedynym
// sposobem sprawdzenia „co dokładnie poleci do RPC” było zamontowanie okna
// z atrapą Radiksa - test, który pada przy zmianie układu i milczy przy zmianie
// reguły. Tutaj sprawdzamy REGUŁĘ.
//
// Trzy rzeczy pilnowane najostrzej, bo każda z nich zdarzyła się już na innych
// powierzchniach tego repozytorium:
//   1. PUSTY NAPIS vs `null`. Klucz nieobecny znaczy „nie ruszaj pola”, `null`
//      znaczy „wyczyść”, a `""` przeszłoby przez CHECK długości i zostało
//      w bazie jako wydawca o nazwie zero znaków.
//   2. STREFA CZASOWA. Termin całodniowy kotwiczy w POŁUDNIE czasu lokalnego -
//      północ po przeliczeniu na UTC wypada dzień wcześniej dla całej Europy.
//   3. `slug` PRZY REDAKCJI. Adres wydarzenia stoi w rozesłanych zaproszeniach,
//      więc patch redakcyjny nie ma prawa go zawierać.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `toIsoValue`/`toLocalInputValue`: obieg tam i z powrotem oraz kotwica
//   południa mają własny zakres w `src/components/clubs/__tests__/
//   workspaceFormatting.test.ts` (te funkcje przeniosły się tutaj z molekuły
//   harmonogramu i zostały re-eksportowane tamtą ścieżką). Tutaj wołamy je
//   wyłącznie jako narzędzie asercji.
// - `clubEventSlug`: transliteracja i sufiks mają `src/lib/clubs/eventSlug.test.ts`.
//   Tutaj dowodzimy TYLKO tego, że payload tworzenia go zawiera, a payload
//   redakcji nie.
// - `clubDocumentNeedsUrl`: słownik „notatka może bez adresu” jest w
//   `threadWorkspaceTypes`. Tutaj sprawdzamy złożenie tej reguły z pustym polem.
// - ZACHOWANIA formularzy (co robi klik, kiedy przycisk jest wyłączony):
//   `src/components/clubs/__tests__/clubWorkspaceForms.test.tsx` i
//   `clubEventForm.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  buildClubDocumentPayload,
  buildClubEventUpsert,
  buildClubMilestonePayload,
  clubAllDayFieldValue,
  clubDocumentFormInvalid,
  clubDocumentUrlMissing,
  clubEventCapacityValue,
  clubEventDurationLabelKey,
  clubEventEndFromDuration,
  clubEventEndValue,
  clubEventFormInvalid,
  clubEventPreviewTitle,
  clubEventRangeLabel,
  clubEventShowsSlug,
  clubEventStartPreset,
  clubFormLocalDate,
  clubFormLocalDateTime,
  clubMilestoneFormInvalid,
  clubMilestoneRangeInvalid,
  clubModeFieldValue,
  toLocalInputValue,
  type ClubDocumentFormDraft,
  type ClubEventFormDraft,
  type ClubMilestoneFormDraft,
} from "@/lib/clubs/workspaceForms";
import { isValidClubEventSlug } from "@/lib/clubs/eventSlug";
import { CLUB_IDS } from "@/test/clubs/fixtures";

/**
 * Zegar testowy zbudowany z pól LOKALNYCH, nie z ISO. Presety liczą w czasie
 * lokalnym, więc asercja na dokładny napis byłaby zależna od strefy maszyny
 * CI - a ta jest ustawiona na UTC tylko przypadkiem.
 */
const NOW_LOCAL = new Date(2026, 7, 18, 9, 30, 15, 250);

/** Ten sam znacznik jako liczba - `buildClubEventUpsert` bierze `nowMs`. */
const NOW_MS = NOW_LOCAL.getTime();

function eventDraft(overrides: Partial<ClubEventFormDraft> = {}): ClubEventFormDraft {
  return {
    titlePl: "Panel o pakiecie cyfrowym",
    titleEn: "",
    descriptionPl: "",
    descriptionEn: "",
    kind: "meeting",
    status: "scheduled",
    allDay: false,
    startsAt: "2026-09-14T17:30",
    endsAt: "",
    location: "",
    meetingUrl: "",
    rsvpEnabled: true,
    capacity: "",
    ...overrides,
  };
}

function milestoneDraft(overrides: Partial<ClubMilestoneFormDraft> = {}): ClubMilestoneFormDraft {
  return {
    title: "Deadline konsultacji",
    description: "",
    kind: "deadline",
    status: "planned",
    allDay: false,
    startsAt: "2026-09-14T17:30",
    endsAt: "",
    location: "",
    url: "",
    ...overrides,
  };
}

function documentDraft(overrides: Partial<ClubDocumentFormDraft> = {}): ClubDocumentFormDraft {
  return {
    kind: "document",
    title: "Stanowisko Rady",
    url: "https://example.test/a.pdf",
    description: "",
    sourceLabel: "",
    publishedOn: "",
    isPrimary: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("clubFormLocalDate / clubFormLocalDateTime", () => {
  it("dopełnia miesiąc, dzień, godzinę i minutę do dwóch cyfr", () => {
    // Bez dopełnienia pole `datetime-local` dostaje "2026-1-5T7:9" i
    // przeglądarka czyści je po cichu.
    const date = new Date(2026, 0, 5, 7, 9);
    expect(clubFormLocalDate(date)).toBe("2026-01-05");
    expect(clubFormLocalDateTime(date)).toBe("2026-01-05T07:09");
  });

  it("czyta pola LOKALNE, więc nie przesuwa dnia jak toISOString", () => {
    // 23:30 czasu lokalnego zostaje tym samym dniem niezależnie od strefy.
    const date = new Date(2026, 11, 31, 23, 30);
    expect(clubFormLocalDate(date)).toBe("2026-12-31");
    expect(clubFormLocalDateTime(date)).toBe("2026-12-31T23:30");
  });
});

describe("clubAllDayFieldValue - przycięcie wartości pola (kalendarz klubu)", () => {
  it("wejście w tryb całodniowy zdejmuje godzinę", () => {
    expect(clubAllDayFieldValue("2026-08-10T18:00", true)).toBe("2026-08-10");
  });

  it("wyjście z trybu całodniowego zostawia wartość bez zmian", () => {
    // Godziny nie ma skąd wziąć, więc pole zostaje datą - dopiero kurator
    // dopisze godzinę. Zerowanie pola kosztowałoby go wpisany termin.
    expect(clubAllDayFieldValue("2026-08-10", false)).toBe("2026-08-10");
  });

  it("puste pole zostaje puste", () => {
    expect(clubAllDayFieldValue("", true)).toBe("");
    expect(clubAllDayFieldValue("", false)).toBe("");
  });
});

describe("clubModeFieldValue - przeliczenie wartości pola (harmonogram wątku)", () => {
  it("puste pole zostaje puste, bo nie ma czego przeliczać", () => {
    expect(clubModeFieldValue("", false, true)).toBe("");
  });

  it("z godzinowego na całodniowy zostawia dzień", () => {
    expect(clubModeFieldValue("2026-09-14T17:30", false, true)).toBe("2026-09-14");
  });

  it("z całodniowego na godzinowy daje POŁUDNIE, nie przypadkową północ", () => {
    // Kotwica południa jest tu widoczna wprost: termin całodniowy wraca jako
    // 12:00, więc nie wygląda jak spotkanie o 00:00.
    expect(clubModeFieldValue("2026-09-14", true, false)).toBe("2026-09-14T12:00");
  });
});

// ---------------------------------------------------------------------------

describe("clubEventFormInvalid - kiedy wydarzenie NIE MA PRAWA pojechać do RPC", () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly titlePl: string;
    readonly titleEn: string;
    readonly startsAt: string;
    readonly expected: boolean;
  }> = [
    {
      name: "brak tytułu w obu językach",
      titlePl: "",
      titleEn: "",
      startsAt: "2026-09-14T17:30",
      expected: true,
    },
    {
      name: "jednoznakowy tytuł to nie tytuł",
      titlePl: "A",
      titleEn: "",
      startsAt: "2026-09-14T17:30",
      expected: true,
    },
    {
      name: "same spacje nie są tytułem",
      titlePl: "   ",
      titleEn: "",
      startsAt: "2026-09-14T17:30",
      expected: true,
    },
    {
      name: "tytuł jest, terminu nie ma",
      titlePl: "Panel",
      titleEn: "",
      startsAt: "",
      expected: true,
    },
    {
      name: "wystarczy tytuł POLSKI",
      titlePl: "Panel",
      titleEn: "",
      startsAt: "2026-09-14T17:30",
      expected: false,
    },
    {
      name: "wystarczy tytuł ANGIELSKI",
      titlePl: "",
      titleEn: "Panel",
      startsAt: "2026-09-14T17:30",
      expected: false,
    },
    {
      name: "dwa znaki to już tytuł",
      titlePl: "PL",
      titleEn: "",
      startsAt: "2026-09-14T17:30",
      expected: false,
    },
  ];

  for (const item of CASES) {
    it(item.name, () => {
      expect(
        clubEventFormInvalid({
          titlePl: item.titlePl,
          titleEn: item.titleEn,
          startsAt: item.startsAt,
        }),
      ).toBe(item.expected);
    });
  }
});

describe("clubEventPreviewTitle", () => {
  it("polski tytuł wygrywa", () => {
    expect(clubEventPreviewTitle("Panel", "Panel EN")).toBe("Panel");
  });

  it("pusty polski oddaje pole angielskiemu", () => {
    expect(clubEventPreviewTitle("  ", "Panel EN")).toBe("Panel EN");
  });

  it("bez żadnego tytułu jest pusto, a nie undefined", () => {
    expect(clubEventPreviewTitle("", "")).toBe("");
  });
});

describe("clubEventCapacityValue - limit miejsc z pola tekstowego", () => {
  const CASES: ReadonlyArray<readonly [string, number | null]> = [
    ["", null],
    ["   ", null],
    ["12", 12],
    [" 8 ", 8],
    ["0", null],
    ["-3", null],
    ["nie wiem", null],
    ["12.9", 12],
  ];

  for (const [input, expected] of CASES) {
    it(`"${input}" -> ${String(expected)}`, () => {
      expect(clubEventCapacityValue(input)).toBe(expected);
    });
  }
});

describe("buildClubEventUpsert - kształt patcha wydarzenia", () => {
  it("TWORZENIE niesie slug wyprowadzony z tytułu i nie niesie id", () => {
    const payload = buildClubEventUpsert(
      eventDraft({ titlePl: "Panel o pakiecie cyfrowym" }),
      null,
      NOW_MS,
    );

    expect(payload.id).toBeUndefined();
    expect(payload.slug).toBeDefined();
    expect(payload.slug ?? "").toContain("panel-o-pakiecie-cyfrowym");
    expect(isValidClubEventSlug(payload.slug ?? "")).toBe(true);
  });

  it("REDAKCJA niesie id i NIE RUSZA sluga", () => {
    // Adres stoi w rozesłanych zaproszeniach - patch z nowym slugiem zerwałby
    // wszystkie linki do wydarzenia.
    const payload = buildClubEventUpsert(eventDraft(), "event-7", NOW_MS);

    expect(payload.id).toBe("event-7");
    expect("slug" in payload).toBe(false);
  });

  it("tytuł podany TYLKO po polsku wypełnia oba pola", () => {
    const payload = buildClubEventUpsert(
      eventDraft({ titlePl: "  Panel  ", titleEn: "" }),
      null,
      NOW_MS,
    );

    expect(payload.title_pl).toBe("Panel");
    expect(payload.title_en).toBe("Panel");
  });

  it("tytuł podany TYLKO po angielsku wypełnia oba pola", () => {
    const payload = buildClubEventUpsert(
      eventDraft({ titlePl: "", titleEn: "Digital package panel" }),
      null,
      NOW_MS,
    );

    expect(payload.title_pl).toBe("Digital package panel");
    expect(payload.title_en).toBe("Digital package panel");
  });

  it("puste pola opcjonalne jadą jako null, nie jako pusty napis", () => {
    const payload = buildClubEventUpsert(eventDraft(), null, NOW_MS);

    expect(payload.description_pl).toBeNull();
    expect(payload.description_en).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.meeting_url).toBeNull();
    expect(payload.capacity).toBeNull();
    expect(payload.ends_at).toBeNull();
  });

  it("wypełnione pola opcjonalne jadą OBCIĘTE z białych znaków", () => {
    const payload = buildClubEventUpsert(
      eventDraft({
        descriptionPl: "  Opis PL  ",
        descriptionEn: "  Opis EN  ",
        location: "  Bruksela  ",
        meetingUrl: "  https://meet.test/x  ",
        capacity: " 40 ",
        endsAt: "2026-09-14T19:00",
        kind: "workshop",
        status: "cancelled",
        rsvpEnabled: false,
      }),
      null,
      NOW_MS,
    );

    expect(payload.description_pl).toBe("Opis PL");
    expect(payload.description_en).toBe("Opis EN");
    expect(payload.location).toBe("Bruksela");
    expect(payload.meeting_url).toBe("https://meet.test/x");
    expect(payload.capacity).toBe(40);
    expect(payload.kind).toBe("workshop");
    expect(payload.status).toBe("cancelled");
    expect(payload.rsvp_enabled).toBe(false);
    expect(toLocalInputValue(payload.ends_at ?? null, false)).toBe("2026-09-14T19:00");
  });

  it("termin godzinowy wraca z bazy na tę samą godzinę lokalną", () => {
    const payload = buildClubEventUpsert(eventDraft(), null, NOW_MS);

    expect(payload.all_day).toBe(false);
    expect(toLocalInputValue(payload.starts_at ?? null, false)).toBe("2026-09-14T17:30");
  });

  it("termin CAŁODNIOWY kotwiczy w południe, więc nie ucieka na poprzedni dzień", () => {
    const payload = buildClubEventUpsert(
      eventDraft({ allDay: true, startsAt: "2026-09-14", endsAt: "2026-09-15" }),
      null,
      NOW_MS,
    );

    expect(payload.all_day).toBe(true);
    expect(new Date(payload.starts_at ?? "").getHours()).toBe(12);
    expect(toLocalInputValue(payload.starts_at ?? null, true)).toBe("2026-09-14");
    expect(toLocalInputValue(payload.ends_at ?? null, true)).toBe("2026-09-15");
  });

  it("termin, którego nie da się sparsować, dostaje awaryjnie znacznik `nowMs`", () => {
    // Ta gałąź jest ostatnią linią obrony: RPC odrzuca wpis bez daty, więc
    // lepiej zapisać „teraz” niż wywrócić zapis na null.
    const payload = buildClubEventUpsert(eventDraft({ startsAt: "nie-jest-data" }), null, NOW_MS);

    expect(payload.starts_at).toBe(new Date(NOW_MS).toISOString());
  });

  it("limit miejsc równy zero znaczy BEZ LIMITU, nie zero miejsc", () => {
    const payload = buildClubEventUpsert(eventDraft({ capacity: "0" }), null, NOW_MS);
    expect(payload.capacity).toBeNull();
  });
});

describe("clubEventStartPreset", () => {
  it("preset godzinowy ląduje na 18:00 tego samego dnia", () => {
    expect(clubEventStartPreset(NOW_LOCAL, 0, false)).toBe("2026-08-18T18:00");
  });

  it("jutro i za tydzień przesuwają DZIEŃ, nie godzinę", () => {
    expect(clubEventStartPreset(NOW_LOCAL, 1, false)).toBe("2026-08-19T18:00");
    expect(clubEventStartPreset(NOW_LOCAL, 7, false)).toBe("2026-08-25T18:00");
  });

  it("przesunięcie przez koniec miesiąca liczy kalendarzowo", () => {
    expect(clubEventStartPreset(new Date(2026, 7, 30, 9, 0), 7, false)).toBe("2026-09-06T18:00");
  });

  it("w trybie całodniowym oddaje sam dzień, bez godziny", () => {
    expect(clubEventStartPreset(NOW_LOCAL, 1, true)).toBe("2026-08-19");
  });

  it("nie mutuje podanego zegara", () => {
    const now = new Date(2026, 7, 18, 9, 30);
    clubEventStartPreset(now, 7, false);
    expect(clubFormLocalDateTime(now)).toBe("2026-08-18T09:30");
  });
});

describe("clubEventEndFromDuration", () => {
  it("dokłada minuty do początku", () => {
    expect(clubEventEndFromDuration("2026-09-14T17:30", 90, false)).toBe("2026-09-14T19:00");
  });

  it("przechodzi przez północ na następny dzień", () => {
    expect(clubEventEndFromDuration("2026-09-14T23:30", 60, false)).toBe("2026-09-15T00:30");
  });

  it("w trybie całodniowym nie ma czego liczyć", () => {
    expect(clubEventEndFromDuration("2026-09-14", 60, true)).toBeNull();
  });

  it("bez początku nie ma czego liczyć", () => {
    expect(clubEventEndFromDuration("", 60, false)).toBeNull();
  });

  it("początek nie do sparsowania daje null, a nie Invalid Date w polu", () => {
    expect(clubEventEndFromDuration("nie-jest-data", 60, false)).toBeNull();
  });
});

describe("clubEventEndValue - wartość pola końca po kliknięciu długości", () => {
  it("policzalna długość nadpisuje wartość obecną", () => {
    expect(clubEventEndValue("2026-09-14T18:00", "2026-09-14T17:30", 90, false)).toBe(
      "2026-09-14T19:00",
    );
  });

  it("gdy nie ma czego liczyć, pole ZOSTAJE nietknięte", () => {
    // Klik nie ma prawa wyczyścić końca wpisanego ręcznie - to jest cała
    // różnica między „nie policzyłem” a „wyczyściłem”.
    expect(clubEventEndValue("2026-09-16", "2026-09-14", 60, true)).toBe("2026-09-16");
    expect(clubEventEndValue("2026-09-16T19:00", "", 60, false)).toBe("2026-09-16T19:00");
    expect(clubEventEndValue("2026-09-16T19:00", "nie-jest-data", 60, false)).toBe(
      "2026-09-16T19:00",
    );
  });
});

describe("clubEventShowsSlug", () => {
  it("adres pokazuje się TYLKO przy tworzeniu i tylko gdy jest", () => {
    expect(clubEventShowsSlug(false, "panel-abcde")).toBe(true);
    expect(clubEventShowsSlug(false, "")).toBe(false);
    expect(clubEventShowsSlug(true, "panel-abcde")).toBe(false);
    expect(clubEventShowsSlug(true, "")).toBe(false);
  });
});

describe("clubEventDurationLabelKey", () => {
  it("każda długość z paska dostaje własny klucz", () => {
    expect(clubEventDurationLabelKey(30)).toBe("club.eventForm.duration30");
    expect(clubEventDurationLabelKey(60)).toBe("club.eventForm.duration60");
    expect(clubEventDurationLabelKey(90)).toBe("club.eventForm.duration90");
    expect(clubEventDurationLabelKey(120)).toBe("club.eventForm.duration120");
  });

  it("długość spoza paska ląduje w bezpiecznej gałęzi, a nie w pustym kluczu", () => {
    expect(clubEventDurationLabelKey(45)).toBe("club.eventForm.duration120");
  });
});

describe("clubEventRangeLabel - zakres w podsumowaniu", () => {
  it("wpis BEZ końca jest punktem w czasie, bez wiszącego separatora", () => {
    expect(clubEventRangeLabel("2026-09-14T17:30", "", false)).toBe("2026-09-14, 17:30");
  });

  it("wpis całodniowy bez końca zostaje samą datą", () => {
    expect(clubEventRangeLabel("2026-09-14", "", true)).toBe("2026-09-14");
  });

  it("zakres godzinowy rozdziela oba końce i zdejmuje literę T", () => {
    expect(clubEventRangeLabel("2026-09-14T17:30", "2026-09-14T19:00", false)).toBe(
      "2026-09-14, 17:30 - 2026-09-14, 19:00",
    );
  });

  it("zakres całodniowy pokazuje dwie daty", () => {
    expect(clubEventRangeLabel("2026-09-14", "2026-09-15", true)).toBe("2026-09-14 - 2026-09-15");
  });
});

// ---------------------------------------------------------------------------

describe("clubMilestoneRangeInvalid", () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly start: string | null;
    readonly end: string | null;
    readonly expected: boolean;
  }> = [
    {
      name: "bez początku nie ma czego porównać",
      start: null,
      end: "2026-09-14T10:00:00.000Z",
      expected: false,
    },
    {
      name: "bez końca nie ma czego porównać",
      start: "2026-09-14T10:00:00.000Z",
      end: null,
      expected: false,
    },
    {
      name: "koniec PRZED początkiem to błąd",
      start: "2026-09-14T10:00:00.000Z",
      end: "2026-09-14T09:00:00.000Z",
      expected: true,
    },
    {
      name: "koniec RÓWNY początkowi jest dozwolony",
      start: "2026-09-14T10:00:00.000Z",
      end: "2026-09-14T10:00:00.000Z",
      expected: false,
    },
    {
      name: "koniec PO początku jest dozwolony",
      start: "2026-09-14T10:00:00.000Z",
      end: "2026-09-14T11:00:00.000Z",
      expected: false,
    },
  ];

  for (const item of CASES) {
    it(item.name, () => {
      expect(clubMilestoneRangeInvalid(item.start, item.end)).toBe(item.expected);
    });
  }
});

describe("clubMilestoneFormInvalid", () => {
  it("tytuł krótszy niż trzy znaki nie przechodzi", () => {
    expect(clubMilestoneFormInvalid("Ok", "2026-09-14T10:00:00.000Z", false)).toBe(true);
    expect(clubMilestoneFormInvalid("   ", "2026-09-14T10:00:00.000Z", false)).toBe(true);
  });

  it("brak początku nie przechodzi", () => {
    expect(clubMilestoneFormInvalid("Deadline konsultacji", null, false)).toBe(true);
  });

  it("zły zakres nie przechodzi nawet z poprawnym tytułem", () => {
    expect(clubMilestoneFormInvalid("Deadline konsultacji", "2026-09-14T10:00:00.000Z", true)).toBe(
      true,
    );
  });

  it("tytuł, początek i poprawny zakres przechodzą", () => {
    expect(
      clubMilestoneFormInvalid("Deadline konsultacji", "2026-09-14T10:00:00.000Z", false),
    ).toBe(false);
  });
});

describe("buildClubMilestonePayload - kształt patcha harmonogramu", () => {
  const START = "2026-09-14T15:30:00.000Z";

  it("TWORZENIE nie niesie id", () => {
    const payload = buildClubMilestonePayload(milestoneDraft(), CLUB_IDS.thread, null, START, null);

    expect("id" in payload).toBe(false);
    expect(payload.thread_id).toBe(CLUB_IDS.thread);
  });

  it("REDAKCJA niesie id pozycji", () => {
    const payload = buildClubMilestonePayload(
      milestoneDraft(),
      CLUB_IDS.thread,
      "milestone-3",
      START,
      null,
    );

    expect(payload.id).toBe("milestone-3");
  });

  it("puste pola opcjonalne jadą jako null", () => {
    const payload = buildClubMilestonePayload(milestoneDraft(), CLUB_IDS.thread, null, START, null);

    expect(payload.description).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.url).toBeNull();
    expect(payload.ends_at).toBeNull();
  });

  it("wypełnione pola jadą obcięte, a rodzaj i stan bez zmian", () => {
    const payload = buildClubMilestonePayload(
      milestoneDraft({
        title: "  Deadline konsultacji  ",
        description: "  Opis  ",
        location: "  Zdalnie  ",
        url: "  https://example.test/x  ",
        kind: "consultation",
        status: "active",
        allDay: true,
      }),
      CLUB_IDS.thread,
      null,
      START,
      "2026-09-20T15:30:00.000Z",
    );

    expect(payload.title).toBe("Deadline konsultacji");
    expect(payload.description).toBe("Opis");
    expect(payload.location).toBe("Zdalnie");
    expect(payload.url).toBe("https://example.test/x");
    expect(payload.kind).toBe("consultation");
    expect(payload.status).toBe("active");
    expect(payload.all_day).toBe(true);
    expect(payload.starts_at).toBe(START);
    expect(payload.ends_at).toBe("2026-09-20T15:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------

describe("clubDocumentUrlMissing", () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
    readonly url: string;
    readonly expected: boolean;
  }> = [
    { name: "notatka może istnieć bez adresu", kind: "note", url: "", expected: false },
    { name: "dokument bez adresu jest pustą obietnicą", kind: "document", url: "", expected: true },
    { name: "same spacje nie są adresem", kind: "dataset", url: "   ", expected: true },
    { name: "link bez adresu jest pustą obietnicą", kind: "link", url: "", expected: true },
    {
      name: "dokument z adresem przechodzi",
      kind: "document",
      url: "https://example.test",
      expected: false,
    },
  ];

  for (const item of CASES) {
    it(item.name, () => {
      expect(clubDocumentUrlMissing(item.kind, item.url)).toBe(item.expected);
    });
  }
});

describe("clubDocumentFormInvalid", () => {
  it("tytuł krótszy niż trzy znaki nie przechodzi", () => {
    expect(clubDocumentFormInvalid("Ok", false)).toBe(true);
  });

  it("brakujący adres nie przechodzi nawet z tytułem", () => {
    expect(clubDocumentFormInvalid("Stanowisko Rady", true)).toBe(true);
  });

  it("tytuł plus spełniony wymóg adresu przechodzi", () => {
    expect(clubDocumentFormInvalid("Stanowisko Rady", false)).toBe(false);
  });
});

describe("buildClubDocumentPayload - kształt patcha źródła", () => {
  it("TWORZENIE nie niesie id, REDAKCJA niesie", () => {
    expect("id" in buildClubDocumentPayload(documentDraft(), CLUB_IDS.thread, null, false)).toBe(
      false,
    );
    expect(buildClubDocumentPayload(documentDraft(), CLUB_IDS.thread, "doc-9", false).id).toBe(
      "doc-9",
    );
  });

  it("bez uprawnienia kuratorskiego klucz `is_primary` NIE JEDZIE wcale", () => {
    // Klucz nieobecny znaczy „nie ruszaj pola”: członek bez uprawnienia nie
    // zdejmie cudzego wyróżnienia samym zapisem opisu.
    const payload = buildClubDocumentPayload(
      documentDraft({ isPrimary: true }),
      CLUB_IDS.thread,
      "doc-9",
      false,
    );

    expect("is_primary" in payload).toBe(false);
  });

  it("z uprawnieniem kuratorskim jedzie także wyłączone wyróżnienie", () => {
    // `false` musi dojechać, inaczej nie da się wyróżnienia ZDJĄĆ.
    const payload = buildClubDocumentPayload(
      documentDraft({ isPrimary: false }),
      CLUB_IDS.thread,
      "doc-9",
      true,
    );

    expect(payload.is_primary).toBe(false);
  });

  it("puste pola opcjonalne jadą jako null", () => {
    const payload = buildClubDocumentPayload(
      documentDraft({ kind: "note", url: "" }),
      CLUB_IDS.thread,
      null,
      true,
    );

    expect(payload.url).toBeNull();
    expect(payload.description).toBeNull();
    expect(payload.source_label).toBeNull();
    expect(payload.published_on).toBeNull();
  });

  it("wypełnione pola jadą obcięte, a data publikacji bez zmian", () => {
    const payload = buildClubDocumentPayload(
      documentDraft({
        title: "  Stanowisko Rady  ",
        url: "  https://example.test/a.pdf  ",
        description: "  Opis  ",
        sourceLabel: "  Rada UE  ",
        publishedOn: "2026-05-04",
        kind: "recording",
      }),
      CLUB_IDS.thread,
      null,
      true,
    );

    expect(payload.title).toBe("Stanowisko Rady");
    expect(payload.url).toBe("https://example.test/a.pdf");
    expect(payload.description).toBe("Opis");
    expect(payload.source_label).toBe("Rada UE");
    expect(payload.published_on).toBe("2026-05-04");
    expect(payload.kind).toBe("recording");
    expect(payload.thread_id).toBe(CLUB_IDS.thread);
  });
});
