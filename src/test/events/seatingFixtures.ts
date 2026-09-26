// Fixture'y PLANU SALI dla testów warstwy danych i komponentów.
//
// Jeden plan, dwie sekcje (rzędy A 1x3 z kategorią VIP, stół T z 2 krzesłami),
// kategoria VIP dopuszczająca bilet `t-vip`, jedna osoba na miejscu A2.
// Funkcje zwracają ŚWIEŻE obiekty, żeby test mógł je zmieniać bez wycieku.
import type {
  Seat,
  SeatAssignment,
  SeatCategory,
  SeatMapDetail,
  SeatSection,
  SeatingCandidateRow,
  SeatMapRow,
  SeatExportRow,
  SeatLookupRow,
} from "@/lib/events/seatingApi";

export const SEAT_EVENT_ID = "e0000000-0000-4000-8000-000000000001";
export const SEAT_MAP_ID = "m0000000-0000-4000-8000-000000000001";

export function seatSection(overrides: Partial<SeatSection> = {}): SeatSection {
  return {
    id: "sec-a",
    label: "A",
    kind: "rows",
    categoryId: "cat-vip",
    originX: 100,
    originY: 200,
    rotationDeg: 0,
    rowsCount: 1,
    seatsPerRow: 3,
    rowLabelScheme: "alpha",
    rowLabelStart: 1,
    seatNumbering: "ltr",
    seatNumberStart: 1,
    seatPitch: 50,
    rowPitch: 60,
    aisleAfter: [],
    tableShape: null,
    tableSeats: null,
    sortOrder: 1,
    ...overrides,
  };
}

export function seat(overrides: Partial<Seat> = {}): Seat {
  return {
    id: "seat-a1",
    sectionId: "sec-a",
    sectionKind: "rows",
    sectionLabel: "A",
    rowLabel: "A",
    seatNumber: 1,
    x: 0,
    y: 0,
    sortKey: 0,
    categoryId: null,
    status: "available",
    blockReason: null,
    holdCompanyId: null,
    holdCompanyName: null,
    holdSponsorId: null,
    holdSponsorName: null,
    holdPackageOrderId: null,
    holdPackageBuyer: null,
    holdNote: null,
    isAccessible: false,
    ...overrides,
  };
}

export function seatCategory(overrides: Partial<SeatCategory> = {}): SeatCategory {
  return {
    id: "cat-vip",
    key: "vip",
    namePl: "Strefa VIP",
    nameEn: "VIP zone",
    color: "#AA3355",
    sortOrder: 1,
    ticketTypeIds: ["t-vip"],
    ...overrides,
  };
}

export function seatAssignment(overrides: Partial<SeatAssignment> = {}): SeatAssignment {
  return {
    id: "as-1",
    seatId: "seat-a2",
    registrationId: "reg-1",
    firstName: "Anna",
    lastName: "Kowalska",
    companyId: "co-1",
    company: "Firma Jeden",
    ticketTypeId: "t-vip",
    ticketNamePl: "VIP",
    ticketNameEn: "VIP pass",
    registrationStatus: "approved",
    source: "manual",
    note: null,
    ...overrides,
  };
}

export function seatMapDetail(overrides: Partial<SeatMapDetail> = {}): SeatMapDetail {
  const table = seatSection({
    id: "sec-t",
    label: "5",
    kind: "table",
    categoryId: null,
    originX: 600,
    originY: 400,
    rowsCount: null,
    seatsPerRow: null,
    rowLabelScheme: null,
    seatNumbering: null,
    tableShape: "round",
    tableSeats: 2,
    sortOrder: 2,
  });
  return {
    map: {
      id: SEAT_MAP_ID,
      eventId: SEAT_EVENT_ID,
      name: "Gala",
      roomId: null,
      sessionId: null,
      status: "draft",
      width: 1200,
      height: 800,
      stage: { x: 400, y: 20, w: 400, h: 80 },
      sortOrder: 1,
      publishedAt: null,
    },
    categories: [seatCategory()],
    sections: [seatSection(), table],
    seats: [
      seat(),
      seat({ id: "seat-a2", seatNumber: 2, x: 50, sortKey: 1 }),
      seat({ id: "seat-a3", seatNumber: 3, x: 100, sortKey: 2, status: "blocked", blockReason: "Filar" }),
      seat({
        id: "seat-t1",
        sectionId: "sec-t",
        sectionKind: "table",
        sectionLabel: "5",
        rowLabel: null,
        seatNumber: 1,
        y: -50,
        status: "held",
        holdCompanyId: "co-1",
        holdCompanyName: "Firma Jeden",
        holdNote: "Delegacja",
      }),
      seat({
        id: "seat-t2",
        sectionId: "sec-t",
        sectionKind: "table",
        sectionLabel: "5",
        rowLabel: null,
        seatNumber: 2,
        y: 50,
        sortKey: 1,
        isAccessible: true,
      }),
    ],
    assignments: [seatAssignment()],
    ...overrides,
  };
}

export function seatMapRow(overrides: Partial<SeatMapRow> = {}): SeatMapRow {
  return {
    created_at: "2099-01-01T00:00:00Z",
    event_id: SEAT_EVENT_ID,
    height: 800,
    id: SEAT_MAP_ID,
    name: "Gala",
    published_at: null,
    room_id: null,
    room_name: null,
    seatable_registrations: 10,
    seats_assigned: 4,
    seats_blocked: 1,
    seats_held: 2,
    seats_total: 20,
    sections_count: 2,
    session_id: null,
    session_title_en: null,
    session_title_pl: null,
    sort_order: 100,
    stage_h: null,
    stage_w: null,
    stage_x: null,
    stage_y: null,
    status: "draft",
    updated_at: "2099-01-01T00:00:00Z",
    width: 1200,
    ...overrides,
  };
}

export function seatingCandidate(overrides: Partial<SeatingCandidateRow> = {}): SeatingCandidateRow {
  return {
    company: "Firma Jeden",
    company_id: "co-1",
    first_name: "Anna",
    group_color: null,
    group_id: null,
    group_name_en: null,
    group_name_pl: null,
    last_name: "Kowalska",
    package_company_id: null,
    package_order_id: null,
    party_key: "reg-1",
    person_id: "p-1",
    registration_id: "reg-1",
    registration_status: "approved",
    seat_id: null,
    seat_label: null,
    ticket_name_en: "VIP pass",
    ticket_name_pl: "VIP",
    ticket_type_id: "t-vip",
    total_count: 1,
    ...overrides,
  };
}

export function seatLookupRow(overrides: Partial<SeatLookupRow> = {}): SeatLookupRow {
  return {
    category_color: null,
    category_key: null,
    category_name_en: null,
    category_name_pl: null,
    map_id: SEAT_MAP_ID,
    map_name: "Gala",
    map_status: "published",
    registration_id: "reg-1",
    row_label: "A",
    seat_number: 2,
    section_kind: "rows",
    section_label: "A",
    ...overrides,
  };
}

export function seatExportRow(overrides: Partial<SeatExportRow> = {}): SeatExportRow {
  return {
    category_key: "vip",
    category_name_en: "VIP zone",
    category_name_pl: "Strefa VIP",
    company: "Firma Jeden",
    company_id: "co-1",
    email: "anna@example.org",
    first_name: "Anna",
    hold_company_id: null,
    hold_company_name: null,
    hold_note: null,
    is_accessible: false,
    last_name: "Kowalska",
    registration_id: "reg-1",
    registration_status: "approved",
    row_label: "A",
    seat_id: "seat-a2",
    seat_number: 2,
    seat_status: "available",
    section_kind: "rows",
    section_label: "A",
    section_sort: 1,
    sort_key: 1,
    ticket_name_en: "VIP pass",
    ticket_name_pl: "VIP",
    ...overrides,
  };
}
