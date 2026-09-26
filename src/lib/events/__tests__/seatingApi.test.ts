// Kontrakt warstwy danych planu sali wobec funkcji bazy.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. `map_id` zamiast `id` przy edycji planu - baza tworzy DRUGI plan.
//   2. Brak klucza vs jawny `null` sklejone: nie da się odpiąć sali od planu.
//   3. Odpowiedź jsonb szczegółu planu z brakującymi polami wywraca ekran
//      zamiast pominąć wiersz.
//   4. Lookup miejsc dla eksportu > 200 zgłoszeń odbija się od limitu RPC.
//   5. Kandydaci do auto-przydziału ucięci do pierwszej strony (500).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { seatMapRow, seatingCandidate } from "@/test/events/seatingFixtures";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/seatingApi");

function stub(): SupabaseRpcStub {
  return h.rpc as SupabaseRpcStub;
}

function payloadOf(name: string): Record<string, unknown> {
  return stub().lastCall(name)?.arg("p_payload") as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const RAW_DETAIL = {
  map: {
    id: "m1",
    event_id: "e1",
    name: "Gala",
    room_id: null,
    session_id: "s1",
    status: "published",
    width: 1600,
    height: 900,
    stage: { x: 1, y: 2, w: 3, h: 4 },
    sort_order: 5,
    published_at: "2099-01-01T00:00:00Z",
  },
  categories: [
    {
      id: "c1",
      key: "vip",
      name_pl: "VIP",
      name_en: "VIP",
      color: "#112233",
      sort_order: 1,
      ticket_type_ids: ["t1", 3],
    },
    { key: "bez-id" },
    "śmieć",
  ],
  sections: [
    {
      id: "sa",
      label: "A",
      kind: "rows",
      category_id: "c1",
      origin_x: 10,
      origin_y: 20,
      rotation_deg: 15,
      rows_count: 2,
      seats_per_row: 3,
      row_label_scheme: "alpha",
      row_label_start: 1,
      seat_numbering: "odd_even",
      seat_number_start: 1,
      seat_pitch: 50,
      row_pitch: 60,
      aisle_after: [1, "x"],
      table_shape: null,
      table_seats: null,
      sort_order: 1,
    },
    { id: "st", kind: "nieznany", table_shape: "oval", row_label_scheme: "roman" },
    { label: "bez-id" },
    7,
  ],
  seats: [
    {
      id: "x1",
      section_id: "sa",
      row_label: "A",
      seat_number: 1,
      x: 0,
      y: 0,
      sort_key: 0,
      category_id: null,
      status: "held",
      hold_company_id: "co",
      hold_company_name: "Firma",
      hold_note: "N",
      is_accessible: true,
    },
    { id: "x2", section_id: "st", seat_number: 2, status: "nieznany" },
    { id: "x3", section_id: "brak", seat_number: 3 },
    { id: "x4", section_id: "sa" },
    { section_id: "sa", seat_number: 9 },
    { id: "x5", seat_number: 9 },
    [],
  ],
  assignments: [
    {
      id: "a1",
      seat_id: "x1",
      registration_id: "r1",
      first_name: "Anna",
      last_name: "K",
      source: "auto",
    },
    { id: "a2", registration_id: "r2" },
    { id: "a3", seat_id: "x2" },
    { seat_id: "x2", registration_id: "r3" },
    { id: "a4", seat_id: "x2", registration_id: "r4" },
    false,
  ],
};

describe("szczegół planu (jsonb)", () => {
  it("parsuje komplet i pomija wiersze bez identyfikatora lub sekcji", () => {
    const detail = api.parseSeatMapDetail(RAW_DETAIL);
    expect(detail?.map).toEqual({
      id: "m1",
      eventId: "e1",
      name: "Gala",
      roomId: null,
      sessionId: "s1",
      status: "published",
      width: 1600,
      height: 900,
      stage: { x: 1, y: 2, w: 3, h: 4 },
      sortOrder: 5,
      publishedAt: "2099-01-01T00:00:00Z",
    });
    expect(detail?.categories).toEqual([
      {
        id: "c1",
        key: "vip",
        namePl: "VIP",
        nameEn: "VIP",
        color: "#112233",
        sortOrder: 1,
        ticketTypeIds: ["t1"],
      },
    ]);
    expect(detail?.sections.map((section) => section.id)).toEqual(["sa", "st"]);
    expect(detail?.sections[0]).toMatchObject({
      seatNumbering: "odd_even",
      aisleAfter: [1],
      rotationDeg: 15,
    });
    // Wartości spoza słownika degradują do bezpiecznych domyślnych.
    expect(detail?.sections[1]).toMatchObject({
      kind: "rows",
      tableShape: null,
      rowLabelScheme: null,
      label: "",
      originX: 0,
      seatPitch: 50,
      rowPitch: 60,
      rowLabelStart: 1,
      seatNumberStart: 1,
      sortOrder: 100,
      aisleAfter: [],
    });
    expect(detail?.seats.map((seat) => seat.id)).toEqual(["x1", "x2"]);
    expect(detail?.seats[0]).toMatchObject({
      sectionKind: "rows",
      sectionLabel: "A",
      status: "held",
      holdCompanyName: "Firma",
      isAccessible: true,
    });
    expect(detail?.seats[1]).toMatchObject({
      status: "available",
      x: 0,
      y: 0,
      sortKey: 0,
      isAccessible: false,
    });
    expect(detail?.assignments).toEqual([
      {
        id: "a1",
        seatId: "x1",
        registrationId: "r1",
        firstName: "Anna",
        lastName: "K",
        companyId: null,
        company: null,
        ticketTypeId: null,
        ticketNamePl: null,
        ticketNameEn: null,
        registrationStatus: "approved",
        source: "auto",
        note: null,
      },
      expect.objectContaining({ id: "a4", firstName: "", lastName: "", source: "manual" }),
    ]);
  });

  it("brak planu = null; plan z brakami = wartości domyślne", () => {
    expect(api.parseSeatMapDetail(null)).toBeNull();
    expect(api.parseSeatMapDetail({ map: { id: "m" } })).toBeNull();
    const minimal = api.parseSeatMapDetail({ map: { id: "m", event_id: "e", stage: { x: 1 } } });
    expect(minimal).toEqual({
      map: {
        id: "m",
        eventId: "e",
        name: "",
        roomId: null,
        sessionId: null,
        status: "draft",
        width: 1200,
        height: 800,
        stage: null,
        sortOrder: 100,
        publishedAt: null,
      },
      categories: [],
      sections: [],
      seats: [],
      assignments: [],
    });
    expect(
      api.parseSeatMapDetail({ map: { id: "m", event_id: "e" }, categories: [{ id: "c" }] })
        ?.categories[0],
    ).toEqual({
      id: "c",
      key: "",
      namePl: "",
      nameEn: "",
      color: "#888888",
      sortOrder: 100,
      ticketTypeIds: [],
    });
  });

  it("fetchSeatMapDetail: pusta odpowiedź to odmowa not_found, błąd bazy przechodzi dalej", async () => {
    stub().setData("admin_event_seat_map_detail", RAW_DETAIL);
    await expect(api.fetchSeatMapDetail("m1")).resolves.toMatchObject({ map: { id: "m1" } });
    expect(stub().lastCall("admin_event_seat_map_detail")?.arg("p_map_id")).toBe("m1");
    stub().setData("admin_event_seat_map_detail", null);
    await expect(api.fetchSeatMapDetail("m1")).rejects.toThrow("not_found");
    stub().setError("admin_event_seat_map_detail", "forbidden: admin role required");
    await expect(api.fetchSeatMapDetail("m1")).rejects.toThrow("forbidden");
  });
});

describe("odczyty listowe", () => {
  it("lista planów, eksport i puste odpowiedzi", async () => {
    stub().setData("admin_event_seat_maps_list", [{ id: "m1" }]);
    await expect(api.fetchSeatMaps("e1")).resolves.toEqual([{ id: "m1" }]);
    expect(stub().lastCall("admin_event_seat_maps_list")?.arg("p_event_id")).toBe("e1");
    stub().setData("admin_event_seat_maps_list", null);
    await expect(api.fetchSeatMaps("e1")).resolves.toEqual([]);
    stub().setError("admin_event_seat_maps_list", "forbidden: x");
    await expect(api.fetchSeatMaps("e1")).rejects.toThrow("forbidden");

    stub().setData("admin_event_seating_export", null);
    await expect(api.fetchSeatingExport("m1")).resolves.toEqual([]);
    expect(payloadOf("admin_event_seating_export")).toEqual({ map_id: "m1" });
    await api.fetchSeatingExport("m1", "co-1");
    expect(payloadOf("admin_event_seating_export")).toEqual({ map_id: "m1", company_id: "co-1" });
  });

  it("kandydaci: filtry tylko gdy ustawione, licznik całości z pierwszego wiersza", async () => {
    stub().setData("admin_event_seating_candidates", [{ registration_id: "r1", total_count: 7 }]);
    await expect(api.fetchSeatingCandidates({ mapId: "m1", q: "  " })).resolves.toEqual({
      rows: [{ registration_id: "r1", total_count: 7 }],
      total: 7,
    });
    expect(payloadOf("admin_event_seating_candidates")).toEqual({ map_id: "m1" });
    await api.fetchSeatingCandidates({
      mapId: "m1",
      q: " kow ",
      ticketTypeId: "t1",
      groupId: "g1",
      companyId: "co",
      onlyUnassigned: true,
      limit: 20,
      offset: 40,
    });
    expect(payloadOf("admin_event_seating_candidates")).toEqual({
      map_id: "m1",
      q: "kow",
      ticket_type_id: "t1",
      group_id: "g1",
      company_id: "co",
      only_unassigned: true,
      limit: 20,
      offset: 40,
    });
    await api.fetchSeatingCandidates({ mapId: "m1", ticketTypeId: null, onlyUnassigned: false });
    expect(payloadOf("admin_event_seating_candidates")).toEqual({ map_id: "m1" });
    stub().setData("admin_event_seating_candidates", null);
    await expect(api.fetchSeatingCandidates({ mapId: "m1" })).resolves.toEqual({
      rows: [],
      total: 0,
    });
    stub().setError("admin_event_seating_candidates", "not_found: x");
    await expect(api.fetchSeatingCandidates({ mapId: "m1" })).rejects.toThrow("not_found");
  });

  it("wszyscy kandydaci: chodzi po stronach do licznika całości", async () => {
    const page = (offset: number, size: number) =>
      Array.from({ length: size }, (_, index) => ({
        registration_id: `r${offset + index}`,
        total_count: 1100,
      }));
    stub().setResponse("admin_event_seating_candidates", (call) => {
      const offset = Number((call.arg("p_payload") as { offset: number }).offset);
      return { data: page(offset, offset >= 1000 ? 100 : 500), error: null };
    });
    const rows = await api.fetchAllSeatingCandidates("m1");
    expect(rows).toHaveLength(1100);
    expect(
      stub()
        .callsFor("admin_event_seating_candidates")
        .map((call) => (call.arg("p_payload") as { offset: number }).offset),
    ).toEqual([0, 500, 1000]);
    // Pełna strona, ale licznik już osiągnięty - bez dodatkowego zapytania.
    stub().setData(
      "admin_event_seating_candidates",
      page(0, 500).map((row) => ({ ...row, total_count: 500 })),
    );
    stub().calls.length = 0;
    await expect(api.fetchAllSeatingCandidates("m1")).resolves.toHaveLength(500);
    expect(stub().callsFor("admin_event_seating_candidates")).toHaveLength(1);
  });

  it("wszyscy kandydaci: bezpiecznik 40 stron, gdy licznik całości kłamie", async () => {
    stub().setResponse("admin_event_seating_candidates", () => ({
      data: Array.from({ length: 500 }, () => ({ registration_id: "r", total_count: 1_000_000 })),
      error: null,
    }));
    await expect(api.fetchAllSeatingCandidates("m1")).resolves.toHaveLength(20_000);
    expect(stub().callsFor("admin_event_seating_candidates")).toHaveLength(40);
  });

  it("lookup miejsc: paczki po 200, pusta lista nie pyta sieci", async () => {
    await expect(api.fetchSeatLookup("e1", [])).resolves.toEqual([]);
    expect(stub().calls).toHaveLength(0);
    stub().setResponse("admin_event_seat_lookup", (call) => ({
      data:
        (call.arg("p_payload") as { registration_ids: string[] }).registration_ids.length === 200
          ? [{ registration_id: "a" }]
          : null,
      error: null,
    }));
    const ids = Array.from({ length: 250 }, (_, index) => `r${index}`);
    await expect(api.fetchSeatLookup("e1", ids)).resolves.toEqual([{ registration_id: "a" }]);
    const calls = stub().callsFor("admin_event_seat_lookup");
    expect(
      calls.map(
        (call) => (call.arg("p_payload") as { registration_ids: string[] }).registration_ids.length,
      ),
    ).toEqual([200, 50]);
    expect((calls[0].arg("p_payload") as { event_id: string }).event_id).toBe("e1");
    stub().setError("admin_event_seat_lookup", "too_many_ids: x");
    await expect(api.fetchSeatLookup("e1", ["r"])).rejects.toThrow("too_many_ids");
  });
});

describe("zapisy - kontrakt kluczy", () => {
  it("plan: nowy (event_id), edycja (id), null czyści, brak klucza zostawia", async () => {
    stub().setData("admin_event_seat_map_save", "m-new");
    await expect(
      api.saveSeatMap({ eventId: "e1", name: "Gala", stage: { x: 1, y: 2, w: 3, h: 4 } }),
    ).resolves.toBe("m-new");
    expect(payloadOf("admin_event_seat_map_save")).toEqual({
      event_id: "e1",
      name: "Gala",
      stage: { x: 1, y: 2, w: 3, h: 4 },
    });
    await api.saveSeatMap({
      id: "m1",
      roomId: null,
      stage: null,
      status: "published",
      width: 1,
      height: 2,
      sessionId: "s",
      sortOrder: 3,
    });
    expect(payloadOf("admin_event_seat_map_save")).toEqual({
      id: "m1",
      room_id: null,
      stage: null,
      status: "published",
      width: 1,
      height: 2,
      session_id: "s",
      sort_order: 3,
    });
    await api.saveSeatMap({ id: "m1" });
    expect(payloadOf("admin_event_seat_map_save")).toEqual({ id: "m1" });
    stub().setError("admin_event_seat_map_save", "name_taken: x");
    await expect(api.saveSeatMap({ id: "m1" })).rejects.toThrow("name_taken");
  });

  it("usunięcia planu, sekcji i kategorii", async () => {
    stub().setData("admin_event_seat_map_delete", true);
    stub().setData("admin_event_seat_section_delete", false);
    stub().setData("admin_event_seat_category_delete", true);
    await expect(api.deleteSeatMap("m1")).resolves.toBe(true);
    await expect(api.deleteSeatSection("s1")).resolves.toBe(false);
    await expect(api.deleteSeatCategory("c1")).resolves.toBe(true);
    expect(stub().lastCall("admin_event_seat_map_delete")?.arg("p_map_id")).toBe("m1");
    expect(stub().lastCall("admin_event_seat_section_delete")?.arg("p_section_id")).toBe("s1");
    expect(stub().lastCall("admin_event_seat_category_delete")?.arg("p_category_id")).toBe("c1");
    for (const [name, run] of [
      ["admin_event_seat_map_delete", () => api.deleteSeatMap("m")],
      ["admin_event_seat_section_delete", () => api.deleteSeatSection("s")],
      ["admin_event_seat_category_delete", () => api.deleteSeatCategory("c")],
    ] as const) {
      stub().setError(name, "not_found: x");
      await expect(run()).rejects.toThrow("not_found");
    }
  });

  it("kategoria: pełny zbiór biletów", async () => {
    stub().setData("admin_event_seat_category_save", "c1");
    await api.saveSeatCategory({
      eventId: "e1",
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      color: "#000000",
      sortOrder: 1,
      ticketTypeIds: [],
    });
    expect(payloadOf("admin_event_seat_category_save")).toEqual({
      event_id: "e1",
      key: "vip",
      name_pl: "VIP",
      name_en: "VIP",
      color: "#000000",
      sort_order: 1,
      ticket_type_ids: [],
    });
    stub().setError("admin_event_seat_category_save", "key_taken: x");
    await expect(api.saveSeatCategory({ id: "c1" })).rejects.toThrow("key_taken");
  });

  it("sekcja: wszystkie parametry i wynik regeneracji", async () => {
    stub().setData("admin_event_seat_section_save", {
      section_id: "s1",
      seats_created: 3,
      seats_removed: 1,
      seats_kept: 2,
    });
    await expect(
      api.saveSeatSection({
        mapId: "m1",
        label: "A",
        kind: "rows",
        categoryId: null,
        originX: 1,
        originY: 2,
        rotationDeg: 3,
        rowsCount: 4,
        seatsPerRow: 5,
        rowLabelScheme: "numeric",
        rowLabelStart: 6,
        seatNumbering: "rtl",
        seatNumberStart: 7,
        seatPitch: 8,
        rowPitch: 9,
        aisleAfter: [2],
        tableShape: null,
        tableSeats: null,
        sortOrder: 10,
      }),
    ).resolves.toEqual({ sectionId: "s1", seatsCreated: 3, seatsRemoved: 1, seatsKept: 2 });
    expect(Object.keys(payloadOf("admin_event_seat_section_save")).sort()).toEqual(
      [
        "aisle_after",
        "category_id",
        "kind",
        "label",
        "map_id",
        "origin_x",
        "origin_y",
        "row_label_scheme",
        "row_label_start",
        "row_pitch",
        "rotation_deg",
        "rows_count",
        "seat_number_start",
        "seat_numbering",
        "seat_pitch",
        "seats_per_row",
        "sort_order",
        "table_seats",
        "table_shape",
      ].sort(),
    );
    expect(api.parseSectionSaveResult(null)).toEqual({
      sectionId: "",
      seatsCreated: 0,
      seatsRemoved: 0,
      seatsKept: 0,
    });
    stub().setError("admin_event_seat_section_save", "seats_in_use: 2");
    await expect(api.saveSeatSection({ id: "s1" })).rejects.toThrow("seats_in_use");
  });

  it("zmiana miejsc: tylko podane klucze", async () => {
    stub().setData("admin_event_seats_update", 3);
    await expect(
      api.updateSeats({
        mapId: "m1",
        seatIds: ["a", "b"],
        status: "held",
        blockReason: null,
        holdCompanyId: "co",
        holdSponsorId: null,
        holdPackageOrderId: null,
        holdNote: "N",
        release: false,
        isAccessible: true,
        categoryId: null,
      }),
    ).resolves.toBe(3);
    expect(payloadOf("admin_event_seats_update")).toEqual({
      map_id: "m1",
      seat_ids: ["a", "b"],
      status: "held",
      block_reason: null,
      hold_company_id: "co",
      hold_sponsor_id: null,
      hold_package_order_id: null,
      hold_note: "N",
      release: false,
      is_accessible: true,
      category_id: null,
    });
    stub().setData("admin_event_seats_update", null);
    await expect(
      api.updateSeats({ mapId: "m1", seatIds: ["a"], isAccessible: false }),
    ).resolves.toBe(0);
    expect(payloadOf("admin_event_seats_update")).toEqual({
      map_id: "m1",
      seat_ids: ["a"],
      is_accessible: false,
    });
    stub().setError("admin_event_seats_update", "seat_assigned: 1");
    await expect(api.updateSeats({ mapId: "m1", seatIds: ["a"] })).rejects.toThrow("seat_assigned");
  });

  it("przydział: flagi tylko gdy podane; wynik z jsonb", async () => {
    stub().setData("admin_event_seat_assign", {
      assignment_id: "as1",
      moved_from_seat_id: "old",
      swapped_registration_id: null,
    });
    await expect(api.assignSeat({ mapId: "m", seatId: "s", registrationId: "r" })).resolves.toEqual(
      {
        assignmentId: "as1",
        movedFromSeatId: "old",
        swappedRegistrationId: null,
      },
    );
    expect(payloadOf("admin_event_seat_assign")).toEqual({
      map_id: "m",
      seat_id: "s",
      registration_id: "r",
    });
    stub().setData("admin_event_seat_assign", null);
    await expect(
      api.assignSeat({
        mapId: "m",
        seatId: "s",
        registrationId: "r",
        swap: true,
        force: false,
        note: null,
      }),
    ).resolves.toEqual({
      assignmentId: null,
      movedFromSeatId: null,
      swappedRegistrationId: null,
    });
    expect(payloadOf("admin_event_seat_assign")).toEqual({
      map_id: "m",
      seat_id: "s",
      registration_id: "r",
      swap: true,
      force: false,
      note: null,
    });
    stub().setError("admin_event_seat_assign", "seat_taken: x");
    await expect(api.assignSeat({ mapId: "m", seatId: "s", registrationId: "r" })).rejects.toThrow(
      "seat_taken",
    );
  });

  it("przydział zbiorczy: pozycje w kształcie SQL, odrzuty z kodem", async () => {
    stub().setData("admin_event_seat_assign_batch", {
      applied: 2,
      rejected: [{ seat_id: "s3", registration_id: "r3", code: "seat_taken" }, "śmieć", {}],
    });
    await expect(
      api.assignSeatsBatch({
        mapId: "m",
        source: "auto",
        items: [{ seatId: "s1", registrationId: "r1" }],
      }),
    ).resolves.toEqual({
      applied: 2,
      rejected: [
        { seatId: "s3", registrationId: "r3", code: "seat_taken" },
        { seatId: "", registrationId: "", code: "unknown" },
      ],
    });
    expect(payloadOf("admin_event_seat_assign_batch")).toEqual({
      map_id: "m",
      source: "auto",
      items: [{ seat_id: "s1", registration_id: "r1" }],
    });
    expect(api.parseBatchResult(null)).toEqual({ applied: 0, rejected: [] });
    stub().setError("admin_event_seat_assign_batch", "too_many_items: 501");
    await expect(api.assignSeatsBatch({ mapId: "m", source: "auto", items: [] })).rejects.toThrow(
      "too_many_items",
    );
  });

  it("zwolnienie: po miejscach, zgłoszeniach albo wszystko", async () => {
    stub().setData("admin_event_seat_release", 2);
    await expect(api.releaseSeats({ mapId: "m", seatIds: ["s"] })).resolves.toBe(2);
    expect(payloadOf("admin_event_seat_release")).toEqual({ map_id: "m", seat_ids: ["s"] });
    stub().setData("admin_event_seat_release", null);
    await expect(api.releaseSeats({ mapId: "m", registrationIds: ["r"], all: true })).resolves.toBe(
      0,
    );
    expect(payloadOf("admin_event_seat_release")).toEqual({
      map_id: "m",
      registration_ids: ["r"],
      all: true,
    });
    stub().setError("admin_event_seat_release", "invalid_payload: x");
    await expect(api.releaseSeats({ mapId: "m" })).rejects.toThrow("invalid_payload");
  });
});

describe("mapInfoFromRow", () => {
  it("niesie scenę tylko wtedy, gdy wszystkie cztery wymiary są w wierszu", () => {
    expect(api.mapInfoFromRow(seatMapRow()).stage).toBeNull();
    expect(
      api.mapInfoFromRow(seatMapRow({ stage_x: 1, stage_y: 2, stage_w: 3, stage_h: 4 })).stage,
    ).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(api.mapInfoFromRow(seatMapRow({ stage_x: 1, stage_y: 2, stage_w: 3 })).stage).toBeNull();
    expect(api.mapInfoFromRow(seatMapRow({ status: "cokolwiek" })).status).toBe("draft");
    expect(api.mapInfoFromRow(seatMapRow({ status: "published" })).status).toBe("published");
  });
});

describe("candidateName", () => {
  it("skleja imię i nazwisko bez wiszących spacji", () => {
    expect(api.candidateName(seatingCandidate({ first_name: "Ewa", last_name: "Lis" }))).toBe(
      "Ewa Lis",
    );
    expect(api.candidateName(seatingCandidate({ first_name: "", last_name: "Lis" }))).toBe("Lis");
  });
});
