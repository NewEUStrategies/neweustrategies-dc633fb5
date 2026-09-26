// Szkice formularzy planu sali: plan, sekcja, kategoria, stan miejsc.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Edycja planu wysyła `event_id` zamiast `id` - baza zakłada DRUGI plan.
//   2. Wyłączenie sceny nie wysyła `stage: null`, więc scena zostaje w bazie.
//   3. Sekcja stołu wysyła parametry rzędów (i odwrotnie) - CHECK kształtu odrzuca.
//   4. Przecinek dziesiętny („12,5”) w rozstawie daje NaN zamiast 12.5.
//   5. Rezerwacja dla firmy wysyła jednocześnie sponsora ze starego wyboru.
import { describe, expect, it } from "vitest";

import {
  categoryDraftFromCategory,
  categoryDraftToInput,
  emptyCategoryDraft,
  emptyHoldDraft,
  emptyMapDraft,
  emptySectionDraft,
  holdDraftToInput,
  mapDraftFromMap,
  mapDraftToInput,
  parseAisles,
  sectionDraftFromSection,
  sectionDraftLayout,
  sectionDraftToInput,
  validateCategoryDraft,
  validateHoldDraft,
  validateMapDraft,
  validateSectionDraft,
  type SectionDraft,
} from "@/lib/events/seatingDraft";
import { seatCategory, seatMapDetail, seatSection } from "@/test/events/seatingFixtures";

const fields = (errors: { field: string }[]) => errors.map((error) => error.field);

describe("szkic planu", () => {
  it("nowy plan: poprawny szkic, wejście z `eventId` i sceną", () => {
    const draft = emptyMapDraft();
    expect(validateMapDraft({ ...draft, name: "Gala" })).toEqual([]);
    expect(mapDraftToInput({ ...draft, name: " Gala " }, "ev-1")).toEqual({
      eventId: "ev-1",
      name: "Gala",
      roomId: null,
      sessionId: null,
      width: 1200,
      height: 800,
      stage: { x: 400, y: 20, w: 400, h: 80 },
    });
  });

  it("edycja: `id` zamiast `eventId`, wyłączona scena = null, liczby zapasowe", () => {
    const draft = mapDraftFromMap({ ...seatMapDetail().map, stage: null, roomId: "room-1" });
    expect(draft.stageEnabled).toBe(false);
    expect(draft.stageX).toBe(emptyMapDraft().stageX);
    const input = mapDraftToInput({ ...draft, width: "x", height: "" }, "ev-1");
    expect(input).toMatchObject({ id: draft.id, roomId: "room-1", width: 1200, height: 800, stage: null });
    expect(input).not.toHaveProperty("eventId");
    const withStage = mapDraftFromMap(seatMapDetail().map);
    expect(withStage.stageW).toBe("400");
    expect(mapDraftToInput({ ...withStage, stageX: "", stageY: "", stageW: "", stageH: "" }, "e").stage).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });

  it("walidacja: nazwa, rozmiar, scena w granicach", () => {
    const base = { ...emptyMapDraft(), name: "Gala" };
    expect(fields(validateMapDraft({ ...base, name: "  " }))).toEqual(["name"]);
    expect(fields(validateMapDraft({ ...base, name: "x".repeat(121) }))).toEqual(["name"]);
    expect(fields(validateMapDraft({ ...base, width: "100", height: "abc" }))).toEqual([
      "width",
      "height",
      "stage",
    ]);
    expect(fields(validateMapDraft({ ...base, stageX: "1100" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageY: "790" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageW: "0" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageH: "-1" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageX: "-5" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageY: "-5" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageY: "" }))).toEqual(["stage"]);
    expect(fields(validateMapDraft({ ...base, stageEnabled: false, stageX: "zzz" }))).toEqual([]);
    // Szerokość nieczytelna - scena nie jest sprawdzana względem niej (błąd pola szerokości wystarcza).
    expect(fields(validateMapDraft({ ...base, width: "", height: "" }))).toEqual(["width", "height"]);
  });
});

describe("szkic sekcji", () => {
  const rows = (overrides: Partial<SectionDraft> = {}): SectionDraft => ({
    ...emptySectionDraft("rows"),
    label: "A",
    ...overrides,
  });

  it("przejścia: lista liczb bez powtórzeń, rosnąco; śmieci = null", () => {
    expect(parseAisles("7, 3;3  5")).toEqual([3, 5, 7]);
    expect(parseAisles("")).toEqual([]);
    expect(parseAisles("2, x")).toBeNull();
    expect(parseAisles("2.5")).toBeNull();
  });

  it("rzędy: poprawny szkic daje wejście bez parametrów stołu, z przecinkiem dziesiętnym", () => {
    const draft = rows({ seatPitch: "45,5", aisles: "5" });
    expect(validateSectionDraft(draft)).toEqual([]);
    expect(sectionDraftToInput(draft, "map-1")).toEqual({
      mapId: "map-1",
      label: "A",
      kind: "rows",
      categoryId: null,
      originX: 100,
      originY: 160,
      rotationDeg: 0,
      rowsCount: 5,
      seatsPerRow: 10,
      rowLabelScheme: "alpha",
      rowLabelStart: 1,
      seatNumbering: "ltr",
      seatNumberStart: 1,
      seatPitch: 45.5,
      rowPitch: 60,
      aisleAfter: [5],
      tableShape: null,
      tableSeats: null,
    });
    expect(sectionDraftLayout(draft)).toMatchObject({ kind: "rows", aisleAfter: [5], tableSeats: null });
  });

  it("stół: wejście bez parametrów rzędów; edycja wysyła `id`", () => {
    const table = sectionDraftFromSection(
      seatSection({ kind: "table", tableShape: "rect", tableSeats: 6, rowsCount: null, seatsPerRow: null }),
    );
    expect(table.rowsCount).toBe(emptySectionDraft("table").rowsCount);
    expect(validateSectionDraft(table)).toEqual([]);
    const input = sectionDraftToInput(table, "map-1");
    expect(input).toMatchObject({
      id: "sec-a",
      kind: "table",
      rowsCount: null,
      seatsPerRow: null,
      rowLabelScheme: null,
      seatNumbering: null,
      aisleAfter: [],
      tableShape: "rect",
      tableSeats: 6,
    });
    expect(input).not.toHaveProperty("mapId");
    expect(sectionDraftLayout(table)).toMatchObject({ kind: "table", rowsCount: null, tableShape: "rect" });
  });

  it("z sekcji z brakami: wartości domyślne zamiast null w polach formularza", () => {
    const draft = sectionDraftFromSection(
      seatSection({
        rowLabelScheme: null,
        seatNumbering: null,
        tableShape: null,
        tableSeats: null,
        aisleAfter: [3, 7],
      }),
    );
    expect(draft).toMatchObject({
      rowLabelScheme: "alpha",
      seatNumbering: "ltr",
      tableShape: "round",
      tableSeats: "8",
      aisles: "3, 7",
    });
  });

  it("walidacja rzędów: każdy limit ma swój komunikat", () => {
    expect(fields(validateSectionDraft(rows({ label: " " })))).toEqual(["label"]);
    expect(fields(validateSectionDraft(rows({ label: "x".repeat(61) })))).toEqual(["label"]);
    expect(fields(validateSectionDraft(rows({ rowsCount: "0" })))).toEqual(["rowsCount"]);
    expect(fields(validateSectionDraft(rows({ seatsPerRow: "201", aisles: "" })))).toEqual(["seatsPerRow"]);
    expect(fields(validateSectionDraft(rows({ rowsCount: "100", seatsPerRow: "30" })))).toEqual([
      "seatsPerRow",
    ]);
    expect(fields(validateSectionDraft(rows({ aisles: "10" })))).toEqual(["aisles"]);
    expect(fields(validateSectionDraft(rows({ aisles: "0" })))).toEqual(["aisles"]);
    expect(fields(validateSectionDraft(rows({ aisles: "x" })))).toEqual(["aisles"]);
    expect(
      fields(validateSectionDraft(rows({ seatsPerRow: "100", aisles: Array.from({ length: 21 }, (_, i) => i + 1).join(",") }))),
    ).toEqual(["aisles"]);
    // Nieczytelna liczba miejsc - przejścia sprawdzamy tylko od dołu.
    expect(fields(validateSectionDraft(rows({ seatsPerRow: "", aisles: "50" })))).toEqual(["seatsPerRow"]);
    expect(fields(validateSectionDraft(rows({ rowLabelStart: "0" })))).toEqual(["rowLabelStart"]);
  });

  it("walidacja wspólna i stołu", () => {
    const table = { ...emptySectionDraft("table"), label: "5" };
    expect(fields(validateSectionDraft({ ...table, tableSeats: "25" }))).toEqual(["tableSeats"]);
    expect(fields(validateSectionDraft({ ...table, seatNumberStart: "0" }))).toEqual(["seatNumberStart"]);
    expect(fields(validateSectionDraft({ ...table, seatPitch: "5", rowPitch: "501" }))).toEqual([
      "seatPitch",
      "rowPitch",
    ]);
    expect(fields(validateSectionDraft({ ...table, originX: "50000" }))).toEqual(["origin"]);
    expect(fields(validateSectionDraft({ ...table, originY: "" }))).toEqual(["origin"]);
    expect(fields(validateSectionDraft({ ...table, rotationDeg: "400" }))).toEqual(["rotationDeg"]);
    expect(sectionDraftLayout({ ...table, tableSeats: "0" })).toBeNull();
  });

  it("wejście z pustymi liczbami dostaje wartości domyślne (baza nie dostaje NaN)", () => {
    const input = sectionDraftToInput(
      rows({ originX: "", originY: "", rotationDeg: "", rowLabelStart: "", seatNumberStart: "", seatPitch: "", rowPitch: "", aisles: "x" }),
      "map-1",
    );
    expect(input).toMatchObject({
      originX: 0,
      originY: 0,
      rotationDeg: 0,
      rowLabelStart: 1,
      seatNumberStart: 1,
      seatPitch: 50,
      rowPitch: 60,
      aisleAfter: [],
    });
  });

  it("podgląd nieważnego szkicu rzędów = null; poprawny z pustym startem - domyślne", () => {
    expect(sectionDraftLayout(rows({ rowsCount: "" }))).toBeNull();
  });
});

describe("szkic kategorii", () => {
  it("nowa: klucz sprawdzany i wysyłany, kolor wielkimi literami", () => {
    const draft = { ...emptyCategoryDraft("#2563eb"), key: " vip ", namePl: "VIP", nameEn: "VIP", ticketTypeIds: ["t1"] };
    expect(validateCategoryDraft(draft)).toEqual([]);
    expect(categoryDraftToInput(draft, "ev-1")).toEqual({
      eventId: "ev-1",
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      color: "#2563EB",
      ticketTypeIds: ["t1"],
    });
  });

  it("edycja: klucz nie jest sprawdzany ani wysyłany; kopia listy biletów", () => {
    const category = seatCategory();
    const draft = categoryDraftFromCategory(category);
    draft.ticketTypeIds.push("t-inny");
    expect(category.ticketTypeIds).toEqual(["t-vip"]);
    expect(validateCategoryDraft({ ...draft, key: "ZŁY KLUCZ" })).toEqual([]);
    expect(categoryDraftToInput(draft, "ev-1")).not.toHaveProperty("key");
  });

  it("walidacja: klucz, nazwy, kolor", () => {
    expect(
      fields(validateCategoryDraft({ ...emptyCategoryDraft("red"), key: "V", namePl: "", nameEn: "x".repeat(81) })),
    ).toEqual(["key", "namePl", "nameEn", "color"]);
    expect(
      fields(validateCategoryDraft({ ...emptyCategoryDraft("#000000"), key: "ok_1", namePl: "x".repeat(81), nameEn: " " })),
    ).toEqual(["namePl", "nameEn"]);
  });
});

describe("szkic stanu miejsc", () => {
  it("blokada: powód i zwolnienie; bez pól rezerwacji", () => {
    const draft = { ...emptyHoldDraft("blocked"), blockReason: " Filar ", release: true, companyId: "co-1" };
    expect(validateHoldDraft(draft)).toEqual([]);
    expect(holdDraftToInput(draft, "map-1", ["s1", "s2"])).toEqual({
      mapId: "map-1",
      seatIds: ["s1", "s2"],
      status: "blocked",
      blockReason: "Filar",
      holdCompanyId: null,
      holdSponsorId: null,
      holdPackageOrderId: null,
      holdNote: null,
      release: true,
    });
    expect(fields(validateHoldDraft({ ...draft, blockReason: "x".repeat(201) }))).toEqual(["blockReason"]);
    expect(holdDraftToInput({ ...draft, blockReason: " " }, "m", []).blockReason).toBeNull();
  });

  it("rezerwacja: wysyła WYŁĄCZNIE wybrany cel", () => {
    const base = { ...emptyHoldDraft("held"), companyId: "co-1", sponsorId: "sp-1", packageOrderId: "po-1", note: " Prasa " };
    expect(holdDraftToInput(base, "m", ["s"])).toMatchObject({
      holdCompanyId: "co-1",
      holdSponsorId: null,
      holdPackageOrderId: null,
      holdNote: "Prasa",
      blockReason: null,
      release: undefined,
    });
    expect(holdDraftToInput({ ...base, target: "sponsor" }, "m", ["s"])).toMatchObject({
      holdCompanyId: null,
      holdSponsorId: "sp-1",
    });
    expect(holdDraftToInput({ ...base, target: "package" }, "m", ["s"])).toMatchObject({
      holdSponsorId: null,
      holdPackageOrderId: "po-1",
    });
    expect(holdDraftToInput({ ...base, target: "note" }, "m", ["s"])).toMatchObject({
      holdCompanyId: null,
      holdSponsorId: null,
      holdPackageOrderId: null,
      holdNote: "Prasa",
    });
  });

  it("wolne: wszystko wyczyszczone", () => {
    expect(holdDraftToInput({ ...emptyHoldDraft("available"), note: "x", companyId: "c" }, "m", ["s"])).toMatchObject({
      status: "available",
      holdCompanyId: null,
      holdNote: null,
      blockReason: null,
    });
    expect(validateHoldDraft(emptyHoldDraft("available"))).toEqual([]);
  });

  it("walidacja rezerwacji: brak celu, brak notatki, za długa notatka", () => {
    const held = emptyHoldDraft("held");
    expect(fields(validateHoldDraft(held))).toEqual(["target"]);
    expect(fields(validateHoldDraft({ ...held, target: "sponsor" }))).toEqual(["target"]);
    expect(fields(validateHoldDraft({ ...held, target: "package" }))).toEqual(["target"]);
    expect(fields(validateHoldDraft({ ...held, target: "note" }))).toEqual(["note"]);
    expect(fields(validateHoldDraft({ ...held, target: "note", note: "x".repeat(201) }))).toEqual(["note"]);
    expect(validateHoldDraft({ ...held, companyId: "co-1" })).toEqual([]);
  });
});
