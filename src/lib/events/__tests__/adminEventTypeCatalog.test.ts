// Reguły katalogu rodzajów wydarzeń - TABELA PRZYPADKÓW.
//
// CO TEN PLIK DOWODZI.
//   1. WALIDACJA ODRZUCA PRZED ŻĄDANIEM i mówi, KTÓRE pole jest złe. Odmowa
//      CHECK-a wraca z bazy jako `23514` bez wskazania kolumny, więc formularz,
//      który polega na bazie, mówi redaktorowi „nie udało się" i nic więcej.
//   2. KOLEJNOŚĆ SPRAWDZEŃ jest kolejnością CZYTANIA FORMULARZA. Pierwszy
//      komunikat musi wskazywać pole najwyżej na ekranie, inaczej redaktor
//      poprawia dół i nie widzi, że góra nadal jest zła.
//   3. KLUCZ PODĄŻA ZA NAZWĄ TYLKO DO PIERWSZEGO TKNIĘCIA, a przy edycji jest
//      zamrożony - zmieniony osierociłby wydarzenia czytające legacy `events.kind`.
//   4. CO IDZIE DO RPC: nazwy przycięte, liczby jako `number | null` (nie pusty
//      napis), pusty akcent jako `null`, brakująca ikona jako domyślna.
//   5. ODCIĘCIE KOSZA MA DWA NIEZALEŻNE POWODY (systemowy, w użyciu), a przepięcie
//      pojawia się TYLKO gdy ma skutek - przycisk bez skutku uczy, że przyciski
//      nic nie robią.
//   6. ODMOWA BAZY MA DWIE DROGI: rozpoznana przyczyna -> klucz słownika,
//      wszystko inne -> SUROWY tekst z bazy (jedyna diagnostyka, jaką mamy).
import { describe, expect, it } from "vitest";
import type { EventTypeAdminRow } from "@/lib/events/eventTypes";
import {
  EMPTY_EVENT_TYPE_DRAFT,
  EVENT_TYPE_DEFAULT_ICON,
  activeEventTypeCount,
  eventTypeDeleteBlocked,
  eventTypeDeleteFailure,
  eventTypeDraftFromRow,
  eventTypeDraftIssue,
  eventTypeDraftWithNamePl,
  eventTypeReassignAvailable,
  eventTypeReassignFailure,
  eventTypeSaveFailure,
  eventTypeSaveKey,
  eventTypeUpsertPayload,
  newEventTypeDraft,
  nextEventTypeSortOrder,
  optionalNumberValue,
  type EventTypeDraft,
} from "@/lib/events/adminEventTypeCatalog";

/** Wiersz RPC w kształcie, w jakim go oddaje `admin_event_types_list`. */
function wiersz(patch: Partial<EventTypeAdminRow> = {}): EventTypeAdminRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    key: "roundtable",
    name_pl: "Okrągły stół",
    name_en: "Roundtable",
    description_pl: "Dyskusja przy stole.",
    description_en: "Table discussion.",
    icon: "Users",
    accent_color: "#1d4ed8",
    default_format: "onsite",
    default_registration_mode: "form",
    default_registration_flow: "approval",
    default_guest_mode: "teaser",
    default_capacity: 24,
    default_duration_minutes: 120,
    default_min_tier_rank: 2,
    default_chatham_house: true,
    requires_ticket: false,
    sort_order: 30,
    is_active: true,
    is_system: false,
    events_count: 0,
    published_events_count: 0,
    ...patch,
  };
}

/** Wersja robocza gotowa do zapisu - punkt wyjścia dla testów walidacji. */
function poprawnaWersja(patch: Partial<EventTypeDraft> = {}): EventTypeDraft {
  return {
    ...EMPTY_EVENT_TYPE_DRAFT,
    key: "panel_ekspertow",
    namePl: "Panel ekspertów",
    nameEn: "Expert panel",
    ...patch,
  };
}

describe("kolejność i pozycja w katalogu", () => {
  it("nowy wpis staje za ostatnim wierszem, o dziesięć dalej", () => {
    expect(nextEventTypeSortOrder([{ sort_order: 30 }, { sort_order: 60 }])).toBe(70);
  });

  it("pusty katalog startuje od stu, a nie od zera", () => {
    // Zero dawałoby dwóm pierwszym wpisom tę samą pozycję i losową kolejność.
    expect(nextEventTypeSortOrder([])).toBe(100);
    expect(newEventTypeDraft([]).sortOrder).toBe(100);
  });

  it("licznik aktywnych liczy wyłącznie włączone, nie długość listy", () => {
    expect(activeEventTypeCount([{ is_active: true }, { is_active: false }])).toBe(1);
  });
});

describe("wersja robocza z wiersza RPC", () => {
  it("przepisuje wszystkie osiemnaście pól, a NULL-e zamienia na pustkę pola", () => {
    const draft = eventTypeDraftFromRow(
      wiersz({ accent_color: null, default_capacity: null, default_duration_minutes: null }),
    );
    expect(draft.accentColor).toBe("");
    expect(draft.defaultCapacity).toBe("");
    expect(draft.defaultDurationMinutes).toBe("");
    // Pole tekstowe z wartością `null` przestaje być sterowane przez Reacta -
    // dlatego pustka jedzie jako pusty napis, nie jako NULL.
    expect(draft.namePl).toBe("Okrągły stół");
    expect(draft.defaultRegistrationFlow).toBe("approval");
    expect(draft.defaultChathamHouse).toBe(true);
    expect(draft.isSystem).toBe(false);
  });
});

describe("klucz techniczny", () => {
  it("nowy wpis normalizuje wpisaną treść", () => {
    expect(eventTypeSaveKey(poprawnaWersja({ id: null, key: "Panel Ekspertów" }))).toBe(
      "panel_ekspertow",
    );
  });

  it("edycja oddaje klucz BEZ ZMIANY, choćby pole zawierało śmieci", () => {
    // Klucz zmieniony po zapisie osierociłby wydarzenia czytające legacy `kind`.
    expect(eventTypeSaveKey(poprawnaWersja({ id: "abc", key: "Panel Ekspertów" }))).toBe(
      "Panel Ekspertów",
    );
  });

  it("podąża za nazwą polską, dopóki nikt nie tknął pola klucza", () => {
    const base = poprawnaWersja({ id: null, key: "" });
    expect(eventTypeDraftWithNamePl(base, "Śniadanie prasowe", false).key).toBe(
      "sniadanie_prasowe",
    );
  });

  it("po tknięciu pola przestaje podążać - ręczna poprawka nie znika", () => {
    const base = poprawnaWersja({ id: null, key: "moj_klucz" });
    const next = eventTypeDraftWithNamePl(base, "Śniadanie prasowe", true);
    expect(next.key).toBe("moj_klucz");
    expect(next.namePl).toBe("Śniadanie prasowe");
  });
});

describe("walidacja wersji roboczej", () => {
  it("przepuszcza wersję gotową", () => {
    expect(eventTypeDraftIssue(poprawnaWersja())).toBeNull();
  });

  it.each([
    ["brak nazwy EN", { nameEn: "" }, "adminEvents.types.errors.names"],
    ["nazwa PL za krótka", { namePl: "A" }, "adminEvents.types.errors.names"],
    ["nazwa PL tylko ze spacji", { namePl: "   " }, "adminEvents.types.errors.names"],
    ["nazwa za długa", { namePl: "x".repeat(81) }, "adminEvents.types.errors.namesTooLong"],
    [
      "opis za długi",
      { descriptionEn: "x".repeat(501) },
      "adminEvents.types.errors.descriptionTooLong",
    ],
    // Klucz zaczynający się cyfrą i klucz, z którego po normalizacji nie zostaje
    // nic - to jedyne dwa sposoby, żeby NOWY wpis nie przeszedł CHECK-a bazy.
    ["klucz od cyfry", { key: "2026" }, "adminEvents.types.errors.key"],
    ["klucz z samych znaków", { key: "!!!" }, "adminEvents.types.errors.key"],
    ["pojemność zero", { defaultCapacity: "0" }, "adminEvents.types.errors.capacity"],
    ["pojemność ujemna", { defaultCapacity: "-5" }, "adminEvents.types.errors.capacity"],
    ["pojemność nieliczbowa", { defaultCapacity: "dużo" }, "adminEvents.types.errors.capacity"],
    [
      "czas trwania poniżej minuty granicznej",
      { defaultDurationMinutes: "4" },
      "adminEvents.types.errors.duration",
    ],
    [
      "czas trwania powyżej tygodnia",
      { defaultDurationMinutes: "10081" },
      "adminEvents.types.errors.duration",
    ],
    ["ranga ujemna", { defaultMinTierRank: -1 }, "adminEvents.types.errors.tierRank"],
    ["akcent bez kratki", { accentColor: "1d4ed8" }, "adminEvents.types.errors.accentColor"],
    ["akcent nazwany", { accentColor: "red" }, "adminEvents.types.errors.accentColor"],
    ["akcent skrócony", { accentColor: "#fff" }, "adminEvents.types.errors.accentColor"],
  ])("odrzuca: %s", (_opis, patch, oczekiwanyKlucz) => {
    expect(eventTypeDraftIssue(poprawnaWersja(patch as Partial<EventTypeDraft>))).toBe(
      oczekiwanyKlucz,
    );
  });

  it("myślnik w kluczu NIE jest błędem - normalizacja zamienia go na podkreślenie", () => {
    // To jest zachowanie, nie ustępstwo: pole klucza podąża za nazwą polską,
    // więc redaktor wpisujący „Panel-ekspertów" dostaje `panel_ekspertow`,
    // a nie komunikat o niedozwolonym znaku.
    expect(eventTypeDraftIssue(poprawnaWersja({ id: null, key: "panel-ekspertow" }))).toBeNull();
    expect(eventTypeSaveKey(poprawnaWersja({ id: null, key: "panel-ekspertow" }))).toBe(
      "panel_ekspertow",
    );
  });

  it("pusta pojemność i pusty czas trwania są POPRAWNE - znaczą brak limitu", () => {
    expect(
      eventTypeDraftIssue(poprawnaWersja({ defaultCapacity: "", defaultDurationMinutes: "  " })),
    ).toBeNull();
  });

  it("pusty akcent jest POPRAWNY - znaczy dziedziczenie koloru marki", () => {
    expect(eventTypeDraftIssue(poprawnaWersja({ accentColor: "" }))).toBeNull();
  });

  it("nie sprawdza klucza przy EDYCJI, bo pole jest zamrożone", () => {
    // Wiersz zaseedowany mógł mieć klucz z innej epoki - edycja nazwy nie może
    // się o niego wywalić.
    expect(eventTypeDraftIssue(poprawnaWersja({ id: "abc", key: "LEGACY-KEY" }))).toBeNull();
  });

  it("pierwszy komunikat wskazuje pole NAJWYŻEJ na ekranie", () => {
    // Wersja zła w dwóch miejscach naraz: nazwa (góra) i pojemność (środek).
    expect(eventTypeDraftIssue(poprawnaWersja({ nameEn: "", defaultCapacity: "0" }))).toBe(
      "adminEvents.types.errors.names",
    );
  });
});

describe("liczba z pola tekstowego", () => {
  it("pustka i same spacje znaczą brak wartości, nie zero", () => {
    expect(optionalNumberValue("")).toBeNull();
    expect(optionalNumberValue("   ")).toBeNull();
  });

  it("treść nieliczbowa znaczy brak wartości, nie NaN", () => {
    // NaN przeszedłby przez `JSON.stringify` jako `null`, ale wcześniej zdążyłby
    // przejść przez walidację jako „coś podano".
    expect(optionalNumberValue("dużo")).toBeNull();
    expect(optionalNumberValue("12abc")).toBeNull();
  });

  it("oddaje liczbę dla treści liczbowej, także z otoczką spacji", () => {
    expect(optionalNumberValue(" 24 ")).toBe(24);
    expect(optionalNumberValue("-3")).toBe(-3);
  });
});

describe("payload RPC", () => {
  it("przycina nazwy i opisy - spacja na końcu nazwy to nie nazwa", () => {
    const payload = eventTypeUpsertPayload(
      poprawnaWersja({ namePl: "  Panel  ", nameEn: " Panel ", descriptionPl: "  Opis  " }),
    );
    expect(payload.namePl).toBe("Panel");
    expect(payload.nameEn).toBe("Panel");
    expect(payload.descriptionPl).toBe("Opis");
  });

  it("liczby jadą jako `number | null`, nigdy jako pusty napis", () => {
    const pusty = eventTypeUpsertPayload(
      poprawnaWersja({ defaultCapacity: "", defaultDurationMinutes: "" }),
    );
    expect(pusty.defaultCapacity).toBeNull();
    expect(pusty.defaultDurationMinutes).toBeNull();

    const pelny = eventTypeUpsertPayload(
      poprawnaWersja({ defaultCapacity: "24", defaultDurationMinutes: "120" }),
    );
    expect(pelny.defaultCapacity).toBe(24);
    expect(pelny.defaultDurationMinutes).toBe(120);
  });

  it("pusty akcent jedzie jako NULL, bo kolumna jest NULL-owalna", () => {
    expect(eventTypeUpsertPayload(poprawnaWersja({ accentColor: "  " })).accentColor).toBeNull();
    expect(eventTypeUpsertPayload(poprawnaWersja({ accentColor: "#ABCDEF" })).accentColor).toBe(
      "#ABCDEF",
    );
  });

  it("brak ikony podstawia domyślną - kolumna jest NOT NULL", () => {
    expect(eventTypeUpsertPayload(poprawnaWersja({ icon: "   " })).icon).toBe(
      EVENT_TYPE_DEFAULT_ICON,
    );
  });

  it("niesie klucz ROZSTRZYGNIĘTY, a nie treść pola", () => {
    expect(eventTypeUpsertPayload(poprawnaWersja({ id: null, key: "Panel X" })).key).toBe(
      "panel_x",
    );
  });
});

describe("odcięcie akcji na wierszu", () => {
  it("kosz jest odcięty dla wpisu systemowego, także nieużywanego", () => {
    expect(eventTypeDeleteBlocked({ is_system: true, events_count: 0 })).toBe(true);
  });

  it("kosz jest odcięty dla wpisu w użyciu, także nie-systemowego", () => {
    expect(eventTypeDeleteBlocked({ is_system: false, events_count: 1 })).toBe(true);
  });

  it("kosz działa tylko przy zerowym użyciu i braku flagi systemowej", () => {
    expect(eventTypeDeleteBlocked({ is_system: false, events_count: 0 })).toBe(false);
  });

  it("przepięcie pojawia się tylko wtedy, gdy ma co przepiąć I gdzie", () => {
    expect(eventTypeReassignAvailable({ events_count: 40 }, 2)).toBe(true);
    // Nie ma czego przepiąć.
    expect(eventTypeReassignAvailable({ events_count: 0 }, 2)).toBe(false);
    // Nie ma gdzie przepiąć - jedyny aktywny rodzaj to ten wiersz.
    expect(eventTypeReassignAvailable({ events_count: 40 }, 0)).toBe(false);
  });
});

describe("mapowanie odmowy bazy", () => {
  it("duplikat klucza jedzie zdaniem ze słownika", () => {
    const fail = eventTypeSaveFailure(
      new Error('duplicate key value violates unique constraint "event_types_tenant_key_unique"'),
    );
    expect(fail.key).toBe("adminEvents.types.errors.duplicate");
  });

  it("rozpoznaje wyjątki własne RPC zapisu", () => {
    expect(eventTypeSaveFailure(new Error("invalid_key: key must match")).key).toBe(
      "adminEvents.types.errors.key",
    );
    expect(eventTypeSaveFailure(new Error("invalid_names: both names are required")).key).toBe(
      "adminEvents.types.errors.names",
    );
  });

  it("każda inna odmowa jedzie SUROWYM tekstem z bazy", () => {
    // Zamiana na ogólne „nie udało się" kasuje jedyną diagnostykę, jaką mamy.
    const fail = eventTypeSaveFailure(new Error("permission denied for function"));
    expect(fail.key).toBeNull();
    expect(fail.text).toBe("permission denied for function");
  });

  it("usunięcie rozróżnia rodzaj w użyciu od rodzaju systemowego", () => {
    expect(eventTypeDeleteFailure(new Error("event_type_in_use: 12 event(s)")).key).toBe(
      "adminEvents.types.errors.inUse",
    );
    expect(eventTypeDeleteFailure(new Error("event_type_system: system types")).key).toBe(
      "adminEvents.types.errors.system",
    );
    expect(eventTypeDeleteFailure(new Error("42501")).key).toBeNull();
  });

  it("przepięcie rozróżnia ten sam cel od braku rodzaju", () => {
    expect(eventTypeReassignFailure(new Error("invalid_target: same")).key).toBe(
      "adminEvents.types.errors.sameTarget",
    );
    expect(eventTypeReassignFailure(new Error("not_found: target")).key).toBe(
      "adminEvents.types.errors.notFound",
    );
  });
});
