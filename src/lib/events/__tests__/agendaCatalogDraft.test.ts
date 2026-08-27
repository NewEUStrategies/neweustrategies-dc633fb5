// Szkice ścieżki i sali: klucz niezmienny, pojemność dodatnia, kolor bezpieczny.
//
// DLACZEGO TEN TEST ISTNIEJE. Trzy pułapki tego formularza są ciche: (1) klucz
// wysłany przy edycji baza ignoruje, więc pole musi być zablokowane, a nie
// „prawdziwe"; (2) pojemność `0` przechodzi jako liczba i zamyka salę, choć
// autor chciał „bez deklaracji"; (3) dowolny tekst w kolorze trafiłby na
// publiczną agendę do atrybutu `style`.
import { describe, expect, it } from "vitest";
import {
  AGENDA_KEY_PATTERN,
  deriveTrackKey,
  emptyRoomDraft,

  emptyTrackDraft,
  roomDraftFromRow,
  roomDraftToInput,
  trackDraftFromRow,
  trackDraftToInput,
  validateRoomDraft,
  validateTrackDraft,
  type RoomDraft,
  type TrackDraft,
} from "@/lib/events/agendaCatalogDraft";
import type { EventRoomRow, EventTrackRow } from "@/lib/events/sessionsApi";

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function track(overrides: Partial<TrackDraft> = {}): TrackDraft {
  return {
    ...emptyTrackDraft(100),
    key: "policy",
    namePl: "Polityka",
    nameEn: "Policy",
    ...overrides,
  };
}

function room(overrides: Partial<RoomDraft> = {}): RoomDraft {
  return { ...emptyRoomDraft(100), name: "Sala A", ...overrides };
}

describe("trackDraft", () => {
  it("poprawny szkic nie ma błędów", () => {
    expect(validateTrackDraft(track())).toEqual([]);
  });

  it("klucza nie pytamy w formularzu - wyprowadzamy go z nazwy", () => {
    expect(validateTrackDraft(track({ key: "" }))).toEqual([]);
    expect(deriveTrackKey({ namePl: "Ścieżka Główna 2026", nameEn: "Main" })).toBe(
      "sciezka_glowna_2026",
    );
    expect(AGENDA_KEY_PATTERN.test(deriveTrackKey({ namePl: "Только", nameEn: "" }))).toBe(true);
  });


  it("wymaga obu nazw", () => {
    expect(validateTrackDraft(track({ nameEn: " " })).map((e) => e.field)).toEqual(["nameEn"]);
  });

  it("kolor spoza wzoru #RRGGBB nie trafia do bazy", () => {
    expect(
      trackDraftToInput(track({ accentColor: "red; content:x" }), EVENT).accentColor,
    ).toBeNull();
    expect(trackDraftToInput(track({ accentColor: "#FA9346" }), EVENT).accentColor).toBe("#fa9346");
    expect(trackDraftToInput(track({ accentColor: "" }), EVENT).accentColor).toBeNull();
  });

  it("wiersz bazy bez koloru wraca jako puste pole", () => {
    const row = {
      id: ID,
      key: "policy",
      name_pl: "Polityka",
      name_en: "Policy",
      accent_color: null,
      sort_order: 30,
      is_active: false,
    } as unknown as EventTrackRow;
    const converted = trackDraftFromRow(row);
    expect(converted.accentColor).toBe("");
    expect(converted.sortOrder).toBe("30");
    expect(converted.isActive).toBe(false);
  });
});

describe("roomDraft", () => {
  it("nazwa jest wymagana", () => {
    expect(validateRoomDraft(room({ name: "  " })).map((e) => e.field)).toEqual(["name"]);
  });

  it("pusta pojemność przechodzi, a zero i ujemna nie", () => {
    expect(validateRoomDraft(room({ capacity: "" }))).toEqual([]);
    expect(validateRoomDraft(room({ capacity: "0" })).map((e) => e.field)).toEqual(["capacity"]);
    expect(validateRoomDraft(room({ capacity: "-5" })).map((e) => e.field)).toEqual(["capacity"]);
    expect(validateRoomDraft(room({ capacity: "12,5" })).map((e) => e.field)).toEqual(["capacity"]);
  });

  it("pusta pojemność jedzie jako null - brak deklaracji, nie brak miejsc", () => {
    expect(roomDraftToInput(room({ capacity: "" }), EVENT).capacity).toBeNull();
    expect(roomDraftToInput(room({ capacity: "120" }), EVENT).capacity).toBe(120);
  });

  it("puste piętro i wskazówka jadą jako null", () => {
    const input = roomDraftToInput(room({ floor: " ", locationNote: "  wejście B " }), EVENT);
    expect(input.floor).toBeNull();
    expect(input.locationNote).toBe("wejście B");
  });

  it("wiersz bazy bez pojemności wraca jako puste pole", () => {
    const row = { id: ID, name: "Sala A", capacity: null } as unknown as EventRoomRow;
    expect(roomDraftFromRow(row).capacity).toBe("");
  });
});
